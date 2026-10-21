export type AppSyncManifestFile = {
    storageKey: string;
    path: string;
    mimeType: string;
    bytes: number;
};

export const CREATIVE_SKILL_SYNC_MEDIA_TYPE = "application/vnd.fourj.skill-library+zip" as const;
export const MAX_CREATIVE_SKILL_SYNC_PACKAGE_BYTES = 64 * 1024 * 1024;

export type CreativeSkillSyncData = {
    schemaVersion: 1;
    head: string;
    publishedSkillCount: number;
    tombstoneCount: number;
    package: {
        path: string;
        sha256: string;
        bytes: number;
        mediaType: typeof CREATIVE_SKILL_SYNC_MEDIA_TYPE;
    };
};

export function requireStrongEntityTag(value: string | null) {
    if (!value || value.startsWith("W/") || !/^"[^"\r\n]+"$/.test(value)) throw new Error("WebDAV server did not provide a strong ETag; conditional sync was refused");
    return value;
}

export function conditionalWriteHeaders(expectedEntityTag: string | null): Record<string, string> {
    return expectedEntityTag === null
        ? { "If-None-Match": "*" }
        : { "If-Match": requireStrongEntityTag(expectedEntityTag) };
}

export function readCreativeSkillSyncData(value: unknown): CreativeSkillSyncData {
    if (!isRecord(value)) throw new Error("invalid creative skill sync data");
    assertExactKeys(value, ["schemaVersion", "head", "publishedSkillCount", "tombstoneCount", "package"], "creative skill sync data");
    if (
        value.schemaVersion !== 1 || !sha256String(value.head) ||
        !nonNegativeInteger(value.publishedSkillCount) || !nonNegativeInteger(value.tombstoneCount)
    ) throw new Error("invalid creative skill sync data");
    if (!isRecord(value.package)) throw new Error("invalid creative skill package");
    assertExactKeys(value.package, ["path", "sha256", "bytes", "mediaType"], "creative skill package");
    const descriptor = value.package;
    if (!sha256String(descriptor.sha256)) throw new Error("invalid creative skill package hash");
    if (descriptor.path !== `creative-skills/packages/${descriptor.sha256}.fourj-skills`) throw new Error("invalid creative skill package path");
    if (!nonNegativeInteger(descriptor.bytes) || descriptor.bytes < 1 || descriptor.bytes > MAX_CREATIVE_SKILL_SYNC_PACKAGE_BYTES) throw new Error("invalid creative skill package bytes");
    if (descriptor.mediaType !== CREATIVE_SKILL_SYNC_MEDIA_TYPE) throw new Error("invalid creative skill package media type");
    return value as unknown as CreativeSkillSyncData;
}

export function decideCreativeSkillSync(local: CreativeSkillSyncData, remote: CreativeSkillSyncData | null, checkpointHead: string | null) {
    const localHasState = creativeSkillSyncItemCount(local) > 0;
    if (!remote) return { data: local, action: localHasState ? "upload" as const : "none" as const };
    if (remote.head === local.head) return { data: local, action: "none" as const };
    if (checkpointHead) {
        if (remote.head === checkpointHead) return { data: local, action: "upload" as const };
        if (local.head === checkpointHead) return { data: local, action: "recovery" as const };
        return { data: local, action: "conflict" as const };
    }
    const remoteHasState = creativeSkillSyncItemCount(remote) > 0;
    if (localHasState && !remoteHasState) return { data: local, action: "upload" as const };
    if (!localHasState && remoteHasState) return { data: local, action: "recovery" as const };
    return { data: local, action: "conflict" as const };
}

export function assertMatchingCreativeSkillSyncSnapshot(local: CreativeSkillSyncData, remote: CreativeSkillSyncData) {
    if (local.head !== remote.head) throw new Error("创作 Skill 资料库 head 不一致");
    if (
        local.publishedSkillCount !== remote.publishedSkillCount ||
        local.tombstoneCount !== remote.tombstoneCount
    ) throw new Error("创作 Skill 相同 head 的清单计数不一致，已拒绝确认备份");
    if (
        local.package.path !== remote.package.path ||
        local.package.sha256 !== remote.package.sha256 ||
        local.package.bytes !== remote.package.bytes ||
        local.package.mediaType !== remote.package.mediaType
    ) throw new Error("创作 Skill 相同 head 的便携包描述不一致，已拒绝确认备份");
}

export function creativeSkillSyncItemCount(data: CreativeSkillSyncData) {
    return data.publishedSkillCount + data.tombstoneCount;
}

export function readAppSyncManifestFiles(value: unknown, domain: string): AppSyncManifestFile[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error("invalid sync media manifest");
    const files = value.map((item) => readManifestFile(item, domain));
    assertUnique(files.map((item) => item.storageKey), "sync storageKey");
    assertUnique(files.map((item) => item.path), "sync media path");
    return files;
}

export function validateDownloadedSyncFile(blob: Blob | null, file: AppSyncManifestFile) {
    if (!blob) throw new Error(`missing remote media for ${file.storageKey}`);
    if (blob.size !== file.bytes) throw new Error(`damaged remote media for ${file.storageKey}`);
    return blob.type === file.mimeType ? blob : blob.slice(0, blob.size, file.mimeType);
}

function readManifestFile(value: unknown, domain: string): AppSyncManifestFile {
    if (!isRecord(value)) throw new Error("invalid sync media entry");
    const storageKey = requiredString(value.storageKey, "sync storageKey");
    const path = requiredString(value.path, "sync media path");
    const mimeType = requiredString(value.mimeType, "sync media type");
    const bytes = value.bytes;
    const prefix = `${domain}/files/`;
    const fileName = path.startsWith(prefix) ? path.slice(prefix.length) : "";
    if (!fileName || fileName === "." || fileName === ".." || fileName.includes("/") || /[\\\u0000-\u001f]/.test(fileName)) throw new Error("invalid sync media path");
    if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 0) throw new Error("invalid sync media bytes");
    return { storageKey, path, mimeType, bytes };
}

function requiredString(value: unknown, label: string) {
    if (typeof value !== "string" || !value.trim()) throw new Error(`invalid ${label}`);
    return value;
}

function assertUnique(values: string[], label: string) {
    if (new Set(values).size !== values.length) throw new Error(`duplicate ${label}`);
}

function assertExactKeys(value: Record<string, unknown>, keys: string[], label: string) {
    const allowed = new Set(keys);
    if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error(`invalid ${label}`);
}

function sha256String(value: unknown): value is string {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function nonNegativeInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
