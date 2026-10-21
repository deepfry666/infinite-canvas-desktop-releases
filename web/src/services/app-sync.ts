import i18n from "@/i18n";
import { deleteStoredMedia, getMediaBlob, resolveMediaUrl, setMediaBlob } from "@/services/file-storage";
import { deleteStoredImages, getImageBlob, resolveImageUrl, setImageBlob } from "@/services/image-storage";
import { mergeAssetLibraries, readAssetLibrarySnapshot, type AssetLibrary } from "@/lib/asset-library";
import {
    assertMatchingCreativeSkillSyncSnapshot,
    CREATIVE_SKILL_SYNC_MEDIA_TYPE,
    MAX_CREATIVE_SKILL_SYNC_PACKAGE_BYTES,
    creativeSkillSyncItemCount,
    decideCreativeSkillSync,
    readAppSyncManifestFiles,
    readCreativeSkillSyncData,
    validateDownloadedSyncFile,
    type AppSyncManifestFile,
    type CreativeSkillSyncData,
} from "@/lib/app-sync-manifest";
import {
    CREATIVE_SKILL_RUN_SCHEMA_VERSION,
    mergeCreativeSkillRunSyncIntoStorage,
    readCreativeSkillRunSyncSnapshot,
    type CreativeSkillRunSyncSnapshot,
} from "@/lib/creative-skill-run-ledger";
import {
    assertWebdavCasSupport,
    downloadVersionedWebdavFile,
    downloadWebdavFile,
    uploadVersionedWebdavFile,
    uploadWebdavFile,
    WebdavConditionalConflictError,
    WEBDAV_MANIFEST_FILE_NAME,
} from "@/services/webdav-sync";
import { createCreativeSkillRunStorage, CreativeSkillRunRevisionConflictError } from "@/services/creative-skill-run-storage";
import type { Asset } from "@/stores/use-asset-store";
import { useAssetStore } from "@/stores/use-asset-store";
import type { WebdavSyncConfig } from "@/stores/use-config-store";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { createGenerationLogStore, runGenerationLogOperation } from "@/services/generation-log-store";
import { mergeGenerationLogsById, preferredGenerationLog } from "@/lib/generation-log-merge";
import { mergeCreativeHistorySnapshot, mergeCreativeHistorySnapshots, readCreativeHistorySnapshot, type CreativeHistorySnapshot } from "@/services/creative-activity";
import type { CreativeSkillDesktopBridge, CreativeSkillSyncImportInput } from "@/types/creative-skill";

type StoredLog = Record<string, unknown> & { id?: string; createdAt?: number; updatedAt?: number; purgedAt?: number };
export type AppSyncDomainKey = "canvas" | "assets" | "image-workbench" | "video-workbench" | "creative-history" | "creative-skills" | "creative-skill-runs";
type DomainKey = AppSyncDomainKey;
type CanvasDomainData = { projects: CanvasProject[] };
type AssetDomainData = AssetLibrary;
type LogDomainData = { logs: StoredLog[] };
type AppSyncFile = AppSyncManifestFile;

type DomainManifest<T> = {
    app: "infinite-canvas";
    version: 1;
    domain: DomainKey;
    exportedAt: string;
    data: T;
    files: AppSyncFile[];
};

type VersionedDomainManifest<T> = DomainManifest<T> & { entityTag: string };

type SyncDomainOptions<T> = {
    key: DomainKey;
    label: string;
    localData: () => Promise<T>;
    emptyData: T;
    mergeData: (local: T, remote: T) => T;
    readData?: (value: unknown) => T;
    applyData?: (data: T) => Promise<void>;
};

type SyncDomainResult<T> = {
    data: T;
    mergedRemote: boolean;
    files: number;
    manifestBytes: number;
    uploadedFiles: number;
    uploadedBytes: number;
};

export type AppSyncResult = {
    syncedAt: string;
    mergedRemote: boolean;
    projects: number;
    assets: number;
    imageLogs: number;
    videoLogs: number;
    creativeHistory: number;
    creativeSkills: number;
    creativeSkillRuns: number;
    skillsConflict: boolean;
    skillsRecoveryAvailable: boolean;
    skillSyncError?: string;
    files: number;
    manifestBytes: number;
    uploadedFiles: number;
    uploadedBytes: number;
};

export type AppSyncProgressEvent = {
    domain?: AppSyncDomainKey;
    label?: string;
    stage: string;
    current?: number;
    total?: number;
    status?: "active" | "success" | "exception";
};

export type AppSyncProgress = (event: AppSyncProgressEvent) => void;

const FILE_CONCURRENCY = 3;
const CREATIVE_SKILL_SYNC_CHECKPOINT_KEY = "fourj-canvas:creative-skill-sync-checkpoints";
const CREATIVE_SKILL_WORKSPACE_IDENTITY_ERROR = "创作 Skill 同步权威工作区身份不可用，已拒绝建立同步 lineage";
const imageLogStore = createGenerationLogStore<StoredLog>("image_generation_logs");
const videoLogStore = createGenerationLogStore<StoredLog>("video_generation_logs");
const creativeSkillRunStorage = createCreativeSkillRunStorage();
type LogStore = typeof imageLogStore;
const storageKeyPattern = /^(image|video|audio|file|video-reference|audio-reference):|^workspace:assets\//;

export function syncAppDataToWebdav(config: WebdavSyncConfig, onProgress?: AppSyncProgress): Promise<AppSyncResult> {
    return runGenerationLogOperation(() => syncAppDataToWebdavExclusive(config, onProgress));
}

async function syncAppDataToWebdavExclusive(config: WebdavSyncConfig, onProgress?: AppSyncProgress): Promise<AppSyncResult> {
    emitProgress(onProgress, { stage: "等待本地数据加载" });
    await Promise.all([waitForHydration(useCanvasStore), waitForHydration(useAssetStore)]);

    const [canvas, assets, imageLogs, videoLogs] = await Promise.all([
        syncDomain<CanvasDomainData>(config, onProgress, {
            key: "canvas",
            label: "画布",
            emptyData: { projects: [] },
            localData: async () => ({ projects: useCanvasStore.getState().projects }),
            mergeData: (local, remote) => ({ projects: mergeById(local.projects, remote.projects, "updatedAt") }),
            applyData: async (data) => useCanvasStore.getState().replaceProjects(data.projects),
        }),
        syncDomain<AssetDomainData>(config, onProgress, {
            key: "assets",
            label: "我的资产",
            emptyData: { assets: [], folders: [], assetTombstones: [] },
            localData: async () => ({ assets: useAssetStore.getState().assets, folders: useAssetStore.getState().folders, assetTombstones: useAssetStore.getState().assetTombstones }),
            mergeData: mergeAssetLibraries,
            readData: readAssetLibrarySnapshot,
            applyData: async (data) => useAssetStore.getState().replaceLibrary({ ...data, assets: await Promise.all(data.assets.map(hydrateAsset)) }),
        }),
        syncDomain<LogDomainData>(config, onProgress, {
            key: "image-workbench",
            label: "生图工作台",
            emptyData: { logs: [] },
            localData: async () => ({ logs: await readStoredLogs(imageLogStore) }),
            mergeData: (local, remote) => ({ logs: mergeGenerationLogsById(local.logs, remote.logs) }),
            applyData: async (data) => replaceStoredLogs(imageLogStore, data.logs),
        }),
        syncDomain<LogDomainData>(config, onProgress, {
            key: "video-workbench",
            label: "视频创作台",
            emptyData: { logs: [] },
            localData: async () => ({ logs: await readStoredLogs(videoLogStore) }),
            mergeData: (local, remote) => ({ logs: mergeGenerationLogsById(local.logs, remote.logs) }),
            applyData: async (data) => replaceStoredLogs(videoLogStore, data.logs),
        }),
    ]);
    // History is derived from both workbench logs and canvas activity. Sync it
    // after those domains finish so a remote log merged in this pass cannot
    // be missed by the history snapshot.
    const creativeHistory = await syncDomain<CreativeHistorySnapshot>(config, onProgress, {
        key: "creative-history",
        label: "创作历史",
        emptyData: { schemaVersion: 1, startedAt: Date.now(), entries: [] },
        localData: readCreativeHistorySnapshot,
        mergeData: mergeCreativeHistorySnapshots,
        applyData: mergeCreativeHistorySnapshot,
    });

    let creativeSkills: (SyncDomainResult<CreativeSkillSyncData> & { conflict: boolean; recoveryAvailable: boolean }) | undefined;
    let creativeSkillRuns = emptySyncResult<CreativeSkillRunSyncSnapshot>({ schemaVersion: CREATIVE_SKILL_RUN_SCHEMA_VERSION, revision: 0, runs: [] });
    let skillsConflict = false;
    let skillsRecoveryAvailable = false;
    const skillSyncErrors: string[] = [];
    try {
        await assertWebdavCasSupport(config);
        const [skillsResult, runsResult] = await Promise.allSettled([
            syncCreativeSkills(config, onProgress),
            syncCreativeSkillRuns(config, onProgress),
        ]);
        if (skillsResult.status === "fulfilled") {
            creativeSkills = skillsResult.value;
            skillsConflict = skillsResult.value.conflict;
            skillsRecoveryAvailable = skillsResult.value.recoveryAvailable;
        } else skillSyncErrors.push(errorMessage(skillsResult.reason));
        if (runsResult.status === "fulfilled") creativeSkillRuns = runsResult.value;
        else skillSyncErrors.push(errorMessage(runsResult.reason));
    } catch (error) {
        const message = errorMessage(error);
        skillSyncErrors.push(message);
        emitProgress(onProgress, { domain: "creative-skills", label: domainLabel("creative-skills"), stage: message, status: "exception" });
        emitProgress(onProgress, { domain: "creative-skill-runs", label: domainLabel("creative-skill-runs"), stage: message, status: "exception" });
    }

    const result = {
        syncedAt: new Date().toISOString(),
        mergedRemote: [canvas, assets, imageLogs, videoLogs, creativeHistory, creativeSkillRuns].some((item) => item.mergedRemote) || Boolean(creativeSkills?.mergedRemote),
        projects: canvas.data.projects.length,
        assets: assets.data.assets.length,
        imageLogs: imageLogs.data.logs.length,
        videoLogs: videoLogs.data.logs.length,
        creativeHistory: creativeHistory.data.entries.length,
        creativeSkills: creativeSkills?.data.publishedSkillCount || 0,
        creativeSkillRuns: creativeSkillRuns.data.runs.length,
        skillsConflict,
        skillsRecoveryAvailable,
        skillSyncError: skillSyncErrors.length ? [...new Set(skillSyncErrors)].join("；") : undefined,
        files: canvas.files + assets.files + imageLogs.files + videoLogs.files + creativeHistory.files + (creativeSkills?.files || 0) + creativeSkillRuns.files,
        manifestBytes: canvas.manifestBytes + assets.manifestBytes + imageLogs.manifestBytes + videoLogs.manifestBytes + creativeHistory.manifestBytes + (creativeSkills?.manifestBytes || 0) + creativeSkillRuns.manifestBytes,
        uploadedFiles: canvas.uploadedFiles + assets.uploadedFiles + imageLogs.uploadedFiles + videoLogs.uploadedFiles + creativeHistory.uploadedFiles + (creativeSkills?.uploadedFiles || 0) + creativeSkillRuns.uploadedFiles,
        uploadedBytes: canvas.uploadedBytes + assets.uploadedBytes + imageLogs.uploadedBytes + videoLogs.uploadedBytes + creativeHistory.uploadedBytes + (creativeSkills?.uploadedBytes || 0) + creativeSkillRuns.uploadedBytes,
    };
    emitProgress(onProgress, { stage: "同步完成", status: "success" });
    return result;
}

async function syncCreativeSkills(config: WebdavSyncConfig, onProgress?: AppSyncProgress) {
    const key = "creative-skills" as const;
    try {
        const checkpointTarget = await createCreativeSkillSyncCheckpointTarget(config);
        emitProgress(onProgress, { domain: key, label: domainLabel(key), stage: "读取远端清单", status: "active" });
        const remote = await readVersionedDomainManifest(config, key, readCreativeSkillSyncData);
        emitProgress(onProgress, { domain: key, label: domainLabel(key), stage: "读取本地数据", status: "active" });
        const local = await createAuthoritativeCreativeSkillPackage();
        const decision = decideCreativeSkillSync(local.data, remote?.data || null, readCreativeSkillSyncCheckpoint(checkpointTarget));
        if (decision.action === "conflict") {
            emitProgress(onProgress, { domain: key, label: domainLabel(key), stage: "检测到资料库冲突", status: "exception" });
            return { ...emptySyncResult(local.data), mergedRemote: true, files: 1, conflict: true, recoveryAvailable: false };
        }
        if (decision.action === "recovery") {
            emitProgress(onProgress, { domain: key, label: domainLabel(key), stage: "保留远端备份", current: 1, total: 1, status: "exception" });
            return { ...emptySyncResult(local.data), mergedRemote: true, files: 1, conflict: false, recoveryAvailable: true };
        }
        if (decision.action === "none") {
            let packageUpload = { uploaded: false };
            if (remote) {
                assertMatchingCreativeSkillSyncSnapshot(local.data, remote.data);
                packageUpload = await ensureCreativeSkillPackage(config, local.data, local.file);
            }
            writeCreativeSkillSyncCheckpoint(checkpointTarget, remote ? local.data.head : null);
            emitProgress(onProgress, { domain: key, label: domainLabel(key), stage: remote ? "内容已一致" : "本机无个人 Skill", current: 1, total: 1, status: "success" });
            return {
                ...emptySyncResult(local.data),
                mergedRemote: Boolean(remote),
                files: remote ? 1 : 0,
                uploadedFiles: packageUpload.uploaded ? 1 : 0,
                uploadedBytes: packageUpload.uploaded ? local.file.size : 0,
                conflict: false,
                recoveryAvailable: false,
            };
        }
        const packageUpload = await ensureCreativeSkillPackage(config, local.data, local.file);
        const manifestFile = createDomainManifestFile(key, local.data);
        emitProgress(onProgress, { domain: key, label: domainLabel(key), stage: `上传清单 ${formatBytes(manifestFile.size)}`, status: "active" });
        try {
            await uploadVersionedWebdavFile(config, domainPath(key, WEBDAV_MANIFEST_FILE_NAME), manifestFile, remote?.entityTag || null);
        } catch (error) {
            if (!(error instanceof WebdavConditionalConflictError)) throw error;
            const concurrent = await readVersionedDomainManifest(config, key, readCreativeSkillSyncData);
            if (concurrent?.data.head !== local.data.head) {
                emitProgress(onProgress, { domain: key, label: domainLabel(key), stage: "检测到资料库冲突", status: "exception" });
                return { ...emptySyncResult(local.data), mergedRemote: true, files: 1, conflict: true, recoveryAvailable: false };
            }
        }
        writeCreativeSkillSyncCheckpoint(checkpointTarget, local.data.head);
        emitProgress(onProgress, { domain: key, label: domainLabel(key), stage: "完成", current: 1, total: 1, status: "success" });
        return {
            ...emptySyncResult(local.data),
            files: 1,
            manifestBytes: manifestFile.size,
            uploadedFiles: packageUpload.uploaded ? 1 : 0,
            uploadedBytes: packageUpload.uploaded ? local.file.size : 0,
            conflict: false,
            recoveryAvailable: false,
        };
    } catch (error) {
        emitProgress(onProgress, { domain: key, label: domainLabel(key), stage: errorMessage(error), status: "exception" });
        throw error;
    }
}

async function syncCreativeSkillRuns(config: WebdavSyncConfig, onProgress?: AppSyncProgress) {
    const key = "creative-skill-runs" as const;
    try {
        let mergedRemote = false;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            emitProgress(onProgress, { domain: key, label: domainLabel(key), stage: "读取远端清单", status: "active" });
            const remote = await readVersionedDomainManifest(config, key, readCreativeSkillRunSyncSnapshot);
            mergedRemote ||= Boolean(remote);
            emitProgress(onProgress, { domain: key, label: domainLabel(key), stage: "读取本地数据", status: "active" });
            const data = await mergeCreativeSkillRunSyncIntoStorage(
                creativeSkillRunStorage,
                remote?.data || { schemaVersion: CREATIVE_SKILL_RUN_SCHEMA_VERSION, revision: 0, runs: [] },
                (error) => error instanceof CreativeSkillRunRevisionConflictError,
            );
            if (remote && sameJson(remote.data, data)) {
                emitProgress(onProgress, { domain: key, label: domainLabel(key), stage: "内容已一致", current: 1, total: 1, status: "success" });
                return { ...emptySyncResult(data), mergedRemote: true };
            }
            const manifestFile = createDomainManifestFile(key, data);
            emitProgress(onProgress, { domain: key, label: domainLabel(key), stage: `上传清单 ${formatBytes(manifestFile.size)}`, status: "active" });
            try {
                await uploadVersionedWebdavFile(config, domainPath(key, WEBDAV_MANIFEST_FILE_NAME), manifestFile, remote?.entityTag || null);
                emitProgress(onProgress, { domain: key, label: domainLabel(key), stage: "完成", current: 1, total: 1, status: "success" });
                return { ...emptySyncResult(data), mergedRemote, manifestBytes: manifestFile.size };
            } catch (error) {
                if (!(error instanceof WebdavConditionalConflictError)) throw error;
                if (attempt === 2) throw new Error("创作 Skill 运行摘要在同步期间持续变化，已拒绝覆盖", { cause: error });
            }
        }
        throw new Error("创作 Skill 运行摘要在同步期间持续变化，已拒绝覆盖");
    } catch (error) {
        emitProgress(onProgress, { domain: key, label: domainLabel(key), stage: errorMessage(error), status: "exception" });
        throw error;
    }
}

async function createAuthoritativeCreativeSkillPackage() {
    const bridge = requireCreativeSkillSyncBridge();
    if (!bridge.createSyncPackage) throw new Error("当前桌面端不支持可恢复的创作 Skill 备份，已拒绝写入不完整快照");
    const result = await bridge.createSyncPackage();
    if (result.schemaVersion !== 1 || result.mediaType !== CREATIVE_SKILL_SYNC_MEDIA_TYPE || !(result.payload instanceof ArrayBuffer)) {
        throw new Error("桌面端创作 Skill 便携包格式无效，已拒绝同步");
    }
    if (!result.payload.byteLength || result.payload.byteLength > MAX_CREATIVE_SKILL_SYNC_PACKAGE_BYTES) {
        throw new Error("创作 Skill 便携包大小无效，已拒绝同步");
    }
    const sha256 = await sha256Hex(result.payload);
    const data = readCreativeSkillSyncData({
        schemaVersion: 1,
        head: result.head,
        publishedSkillCount: result.publishedSkillCount,
        tombstoneCount: result.tombstoneCount,
        package: {
            path: `creative-skills/packages/${sha256}.fourj-skills`,
            sha256,
            bytes: result.payload.byteLength,
            mediaType: CREATIVE_SKILL_SYNC_MEDIA_TYPE,
        },
    });
    return { data, file: new Blob([result.payload], { type: CREATIVE_SKILL_SYNC_MEDIA_TYPE }) };
}

async function ensureCreativeSkillPackage(config: WebdavSyncConfig, data: CreativeSkillSyncData, file: Blob) {
    const existing = await downloadWebdavFile(config, data.package.path);
    if (existing) {
        await validateCreativeSkillPackage(existing, data);
        return { uploaded: false };
    }
    try {
        await uploadVersionedWebdavFile(config, data.package.path, file, null, data.package.mediaType);
        return { uploaded: true };
    } catch (error) {
        if (!(error instanceof WebdavConditionalConflictError)) throw error;
        await validateCreativeSkillPackage(await downloadWebdavFile(config, data.package.path), data);
        return { uploaded: false };
    }
}

export async function downloadCreativeSkillSyncPackage(
    config: WebdavSyncConfig,
    resolution?: CreativeSkillSyncImportInput["resolution"],
): Promise<CreativeSkillSyncImportInput> {
    const checkpointTarget = await createCreativeSkillSyncCheckpointTarget(config);
    const remote = await readVersionedDomainManifest(config, "creative-skills", readCreativeSkillSyncData);
    if (!remote || !creativeSkillSyncItemCount(remote.data)) throw new Error("WebDAV 中没有可恢复的创作 Skill 备份");
    const payload = await validateCreativeSkillPackage(await downloadWebdavFile(config, remote.data.package.path), remote.data);
    const local = await createAuthoritativeCreativeSkillPackage();
    const checkpointHead = readCreativeSkillSyncCheckpoint(checkpointTarget);
    return {
        kind: "sync-import",
        payload,
        expectedHead: local.data.head,
        sourceHead: remote.data.head,
        ...(checkpointHead ? { checkpointHead } : {}),
        ...(resolution ? { resolution } : {}),
    };
}

async function validateCreativeSkillPackage(file: Blob | null, data: CreativeSkillSyncData) {
    if (!file || file.size !== data.package.bytes) throw new Error("WebDAV 创作 Skill 便携包缺失或大小不符");
    const payload = await file.arrayBuffer();
    if (await sha256Hex(payload) !== data.package.sha256) throw new Error("WebDAV 创作 Skill 便携包完整性校验失败");
    return payload;
}

function requireCreativeSkillSyncBridge() {
    const desktop = window.infiniteCanvasDesktop as (typeof window.infiniteCanvasDesktop & { creativeSkills?: CreativeSkillDesktopBridge }) | undefined;
    if (!desktop?.creativeSkills) throw new Error("桌面端创作 Skill 权威资料库不可用，已拒绝同步");
    return desktop.creativeSkills;
}

function readCreativeSkillSyncCheckpoint(target: string) {
    try {
        const value = JSON.parse(window.localStorage.getItem(CREATIVE_SKILL_SYNC_CHECKPOINT_KEY) || "null") as unknown;
        if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.targets)) return null;
        const head = value.targets[target];
        return typeof head === "string" && /^[a-f0-9]{64}$/.test(head) ? head : null;
    } catch {
        return null;
    }
}

function writeCreativeSkillSyncCheckpoint(target: string, head: string | null) {
    let targets: Record<string, string> = {};
    try {
        const value = JSON.parse(window.localStorage.getItem(CREATIVE_SKILL_SYNC_CHECKPOINT_KEY) || "null") as unknown;
        if (isRecord(value) && value.schemaVersion === 1 && isRecord(value.targets)) {
            targets = Object.fromEntries(Object.entries(value.targets).filter((entry): entry is [string, string] => typeof entry[1] === "string" && /^[a-f0-9]{64}$/.test(entry[1])));
        }
    } catch {
        // A damaged checkpoint cannot establish lineage; a successful sync replaces it.
    }
    if (head) targets[target] = head;
    else delete targets[target];
    if (Object.keys(targets).length) window.localStorage.setItem(CREATIVE_SKILL_SYNC_CHECKPOINT_KEY, JSON.stringify({ schemaVersion: 1, targets }));
    else window.localStorage.removeItem(CREATIVE_SKILL_SYNC_CHECKPOINT_KEY);
}

export async function createCreativeSkillSyncCheckpointTarget(config: Pick<WebdavSyncConfig, "url" | "directory" | "username">) {
    const desktop = typeof window === "undefined" ? undefined : window.infiniteCanvasDesktop;
    if (!desktop?.getWorkspaceInfo) throw new Error(CREATIVE_SKILL_WORKSPACE_IDENTITY_ERROR);
    const workspace = await desktop.getWorkspaceInfo().catch(() => null);
    const workspacePath = workspace?.path?.trim();
    const skillsPath = workspace?.locations?.skills?.path?.trim();
    if (!workspacePath || !skillsPath) throw new Error(CREATIVE_SKILL_WORKSPACE_IDENTITY_ERROR);
    const workspaceIdentity = await sha256Hex(new TextEncoder().encode(JSON.stringify(["fourj-creative-skill-workspace-v1", workspacePath, skillsPath])).buffer);
    return JSON.stringify([
        config.url.trim().replace(/\/+$/, ""),
        config.directory.trim().replace(/^\/+|\/+$/g, ""),
        config.username.trim(),
        workspaceIdentity,
    ]);
}

async function readVersionedDomainManifest<T>(config: WebdavSyncConfig, domain: DomainKey, readData: (value: unknown) => T): Promise<VersionedDomainManifest<T> | null> {
    const remote = await downloadVersionedWebdavFile(config, domainPath(domain, WEBDAV_MANIFEST_FILE_NAME));
    if (!remote.file || !remote.entityTag) return null;
    const value = JSON.parse(await remote.file.text()) as unknown;
    if (!isRecord(value) || value.app !== "infinite-canvas" || value.version !== 1 || value.domain !== domain) throw new Error(i18n.t("config.webdav.errors.invalidManifest", { domain }));
    const files = readAppSyncManifestFiles(value.files, domain);
    if (files.length) throw new Error("创作 Skill 同步域禁止包含媒体文件");
    return {
        app: "infinite-canvas",
        version: 1,
        domain,
        exportedAt: typeof value.exportedAt === "string" ? value.exportedAt : new Date().toISOString(),
        data: readData(value.data),
        files,
        entityTag: remote.entityTag,
    };
}

function createDomainManifestFile<T>(domain: DomainKey, data: T) {
    const manifest: DomainManifest<T> = { app: "infinite-canvas", version: 1, domain, exportedAt: new Date().toISOString(), data, files: [] };
    return new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
}

function emptySyncResult<T>(data: T): SyncDomainResult<T> {
    return { data, mergedRemote: false, files: 0, manifestBytes: 0, uploadedFiles: 0, uploadedBytes: 0 };
}

async function syncDomain<T>(config: WebdavSyncConfig, onProgress: AppSyncProgress | undefined, options: SyncDomainOptions<T>): Promise<SyncDomainResult<T>> {
    try {
        emitProgress(onProgress, { domain: options.key, label: options.label, stage: "读取远端清单", status: "active" });
        const remoteManifest = await readDomainManifest(config, options.key, options.emptyData, options.readData);
        emitProgress(onProgress, { domain: options.key, label: options.label, stage: "读取本地数据", status: "active" });
        const localData = await options.localData();
        const mergedData = remoteManifest ? options.mergeData(localData, remoteManifest.data) : localData;

        if (remoteManifest) {
            emitProgress(onProgress, { domain: options.key, label: options.label, stage: "下载缺失媒体", status: "active" });
            await downloadMissingFiles(config, options.key, mergedData, remoteManifest.files, onProgress);
            emitProgress(onProgress, { domain: options.key, label: options.label, stage: "写入本地合并结果", status: "active" });
            await options.applyData?.(mergedData);
        }

        emitProgress(onProgress, { domain: options.key, label: options.label, stage: "上传新增媒体", status: "active" });
        const uploaded = await uploadChangedFiles(config, options.key, mergedData, remoteManifest?.files || [], onProgress);
        const manifest: DomainManifest<T> = { app: "infinite-canvas", version: 1, domain: options.key, exportedAt: new Date().toISOString(), data: mergedData, files: uploaded.files };
        const manifestFile = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
        emitProgress(onProgress, { domain: options.key, label: options.label, stage: `上传清单 ${formatBytes(manifestFile.size)}`, status: "active" });
        await uploadWebdavFile(config, domainPath(options.key, WEBDAV_MANIFEST_FILE_NAME), manifestFile, "application/json");
        emitProgress(onProgress, { domain: options.key, label: options.label, stage: "完成", current: 1, total: 1, status: "success" });

        return {
            data: mergedData,
            mergedRemote: Boolean(remoteManifest),
            files: uploaded.files.length,
            manifestBytes: manifestFile.size,
            uploadedFiles: uploaded.uploadedFiles,
            uploadedBytes: uploaded.uploadedBytes,
        };
    } catch (error) {
        emitProgress(onProgress, { domain: options.key, label: options.label, stage: error instanceof Error ? error.message : i18n.t("config.webdav.errors.syncFailed"), status: "exception" });
        throw error;
    }
}

async function readDomainManifest<T>(config: WebdavSyncConfig, domain: DomainKey, emptyData: T, readData?: (value: unknown) => T): Promise<DomainManifest<T> | null> {
    const file = await downloadWebdavFile(config, domainPath(domain, WEBDAV_MANIFEST_FILE_NAME));
    if (!file) return null;
    const data = JSON.parse(await file.text()) as unknown;
    if (!isRecord(data) || data.app !== "infinite-canvas" || data.version !== 1 || data.domain !== domain) throw new Error(i18n.t("config.webdav.errors.invalidManifest", { domain }));
    const rawData = data.data ?? emptyData;
    return {
        app: "infinite-canvas",
        version: 1,
        domain,
        exportedAt: typeof data.exportedAt === "string" ? data.exportedAt : new Date().toISOString(),
        data: readData ? readData(rawData) : rawData as T,
        files: readAppSyncManifestFiles(data.files, domain),
    };
}

async function downloadMissingFiles<T>(config: WebdavSyncConfig, domain: DomainKey, data: T, remoteFiles: AppSyncFile[], onProgress?: AppSyncProgress) {
    const remoteFileMap = new Map(remoteFiles.map((item) => [item.storageKey, item]));
    const tasks: AppSyncFile[] = [];
    const storageKeys = collectStorageKeys(data);
    let scanned = 0;
    for (const storageKey of storageKeys) {
        const localBlob = isImageStorageKey(storageKey) ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
        scanned += 1;
        if (localBlob) {
            emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "检查缺失媒体", current: scanned, total: storageKeys.length, status: "active" });
            continue;
        }
        const remoteFile = remoteFileMap.get(storageKey);
        if (!remoteFile) throw new Error(`远端清单缺少媒体：${storageKey}`);
        tasks.push(remoteFile);
        emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "检查缺失媒体", current: scanned, total: storageKeys.length, status: "active" });
    }
    if (!tasks.length) {
        emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "媒体已齐全", current: 1, total: 1, status: "active" });
        return;
    }
    let downloaded = 0;
    const downloadedImages = new Set<string>();
    const downloadedMedia = new Set<string>();
    try {
        await runWithConcurrency(tasks, FILE_CONCURRENCY, async (remoteFile) => {
            const typedBlob = validateDownloadedSyncFile(await downloadWebdavFile(config, remoteFile.path), remoteFile);
            if (isImageStorageKey(remoteFile.storageKey)) {
                await setImageBlob(remoteFile.storageKey, typedBlob);
                downloadedImages.add(remoteFile.storageKey);
            } else {
                await setMediaBlob(remoteFile.storageKey, typedBlob);
                downloadedMedia.add(remoteFile.storageKey);
            }
            downloaded += 1;
            emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "下载媒体", current: downloaded, total: tasks.length, status: "active" });
        });
    } catch (error) {
        await Promise.allSettled([deleteStoredImages(downloadedImages), deleteStoredMedia(downloadedMedia)]);
        throw error;
    }
}

async function uploadChangedFiles<T>(config: WebdavSyncConfig, domain: DomainKey, data: T, remoteFiles: AppSyncFile[], onProgress?: AppSyncProgress) {
    const remoteFileMap = new Map(remoteFiles.map((item) => [item.storageKey, item]));
    const files: AppSyncFile[] = [];
    const tasks: Array<{ item: AppSyncFile; blob: Blob }> = [];
    let uploadedFiles = 0;
    let uploadedBytes = 0;

    const storageKeys = collectStorageKeys(data);
    let scanned = 0;
    for (const storageKey of storageKeys) {
        const blob = isImageStorageKey(storageKey) ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
        const remoteFile = remoteFileMap.get(storageKey);
        if (!blob) throw new Error(`本地缺少同步媒体：${storageKey}`);
        const item: AppSyncFile = {
            storageKey,
            path: remoteFile?.path || domainPath(domain, `files/${safeFileName(storageKey)}.${fileExtension(blob.type, storageKey)}`),
            mimeType: blob.type || remoteFile?.mimeType || "application/octet-stream",
            bytes: blob.size,
        };
        files.push(item);
        if (!remoteFile || remoteFile.bytes !== blob.size) tasks.push({ item, blob });
        scanned += 1;
        emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "检查本地媒体", current: scanned, total: storageKeys.length, status: "active" });
    }

    if (!tasks.length) {
        emitProgress(onProgress, { domain, label: domainLabel(domain), stage: "媒体无需上传", current: 1, total: 1, status: "active" });
        return { files, uploadedFiles, uploadedBytes };
    }

    await runWithConcurrency(tasks, FILE_CONCURRENCY, async ({ item, blob }) => {
        await uploadWebdavFile(config, item.path, blob, item.mimeType);
        uploadedFiles += 1;
        uploadedBytes += blob.size;
        emitProgress(onProgress, { domain, label: domainLabel(domain), stage: `上传媒体 ${formatBytes(blob.size)}`, current: uploadedFiles, total: tasks.length, status: "active" });
    });

    return { files, uploadedFiles, uploadedBytes };
}

async function hydrateAsset(asset: Asset): Promise<Asset> {
    if (asset.kind === "image" && asset.data.storageKey) {
        const dataUrl = await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl);
        return { ...asset, coverUrl: asset.coverUrl.startsWith("blob:") ? dataUrl : asset.coverUrl, data: { ...asset.data, dataUrl } };
    }
    if (asset.kind === "video" && asset.data.storageKey) {
        const url = await resolveMediaUrl(asset.data.storageKey, asset.data.url);
        return { ...asset, coverUrl: asset.coverUrl.startsWith("blob:") ? url : asset.coverUrl, data: { ...asset.data, url } };
    }
    return asset;
}

async function readStoredLogs(store: LogStore) {
    const logs = new Map<string, StoredLog>();
    await store.iterate<StoredLog, void>((value) => {
        const id = getStringField(value, "id");
        if (id) logs.set(id, value);
    });
    store.volatileEntries().forEach(([key, value]) => {
        const current = logs.get(key);
        if (!current || preferredGenerationLog(value, current) === value) logs.set(key, value);
    });
    return [...logs.values()];
}

async function replaceStoredLogs(store: LogStore, logs: StoredLog[]) {
    await runWithConcurrency(logs, FILE_CONCURRENCY, async (log) => {
        const id = getStringField(log, "id");
        if (id) await store.setItem(id, log);
    });
}

function mergeById<T extends { id?: string }>(local: T[], remote: T[], timeKey: string) {
    const items = new Map<string, T>();
    remote.forEach((item) => {
        const id = item.id || "";
        if (id) items.set(id, item);
    });
    local.forEach((item) => {
        const id = item.id || "";
        if (!id) return;
        const current = items.get(id);
        if (!current || getTime(item as Record<string, unknown>, timeKey) >= getTime(current as Record<string, unknown>, timeKey)) items.set(id, item);
    });
    return Array.from(items.values()).sort((a, b) => getTime(b as Record<string, unknown>, timeKey) - getTime(a as Record<string, unknown>, timeKey));
}

function collectStorageKeys(value: unknown, keys = new Set<string>()) {
    if (typeof value === "string") {
        if (storageKeyPattern.test(value)) keys.add(value);
        return [...keys];
    }
    if (!value || typeof value !== "object") return [...keys];
    if ("storageKey" in value && typeof value.storageKey === "string" && storageKeyPattern.test(value.storageKey)) keys.add(value.storageKey);
    Object.entries(value).forEach(([key, item]) => {
        if (key === "formerOutputStorageKeys" && "purgedAt" in value && value.purgedAt) return;
        if (Array.isArray(item)) item.forEach((child) => collectStorageKeys(child, keys));
        else collectStorageKeys(item, keys);
    });
    return [...keys];
}

function isImageStorageKey(storageKey: string) {
    return storageKey.startsWith("image:") || storageKey.startsWith("workspace:assets/images/");
}

function domainPath(domain: DomainKey, path: string) {
    return `${domain}/${path}`;
}

function domainLabel(domain: DomainKey) {
    if (domain === "canvas") return "画布";
    if (domain === "assets") return "我的资产";
    if (domain === "image-workbench") return "生图工作台";
    if (domain === "creative-history") return "创作历史";
    if (domain === "creative-skills") return "创作 Skill";
    if (domain === "creative-skill-runs") return "创作 Skill 运行摘要";
    return "视频创作台";
}

function emitProgress(onProgress: AppSyncProgress | undefined, event: AppSyncProgressEvent) {
    onProgress?.(event);
}

function getStringField(item: Record<string, unknown>, key: string) {
    const value = item[key];
    return typeof value === "string" ? value : "";
}

function getTime(item: Record<string, unknown>, key: string) {
    const value = item[key];
    if (typeof value === "number") return value;
    if (typeof value === "string") return Date.parse(value) || 0;
    if (key === "updatedAt") return getTime(item, "createdAt");
    return 0;
}

function safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, "_");
}

function fileExtension(mimeType: string, storageKey: string) {
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("webm")) return "webm";
    if (mimeType.includes("wav")) return "wav";
    if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
    return storageKey.startsWith("image:") ? "png" : "bin";
}

function waitForHydration<T extends { hydrated: boolean }>(store: { getState: () => T; subscribe: (listener: (state: T) => void) => () => void }) {
    if (store.getState().hydrated) return Promise.resolve();
    return new Promise<void>((resolve) => {
        const unsubscribe = store.subscribe((state) => {
            if (!state.hydrated) return;
            unsubscribe();
            resolve();
        });
    });
}

async function runWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>) {
    const results = new Array<R>(items.length);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (nextIndex < items.length) {
                const index = nextIndex++;
                results[index] = await worker(items[index], index);
            }
        });
    const settled = await Promise.allSettled(workers);
    const failed = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) throw failed.reason;
    return results;
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : i18n.t("config.webdav.errors.syncFailed");
}

function sameJson(left: unknown, right: unknown) {
    return JSON.stringify(left) === JSON.stringify(right);
}

async function sha256Hex(value: ArrayBuffer) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", value);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
