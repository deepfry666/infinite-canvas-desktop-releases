import {
    assertGenerationProtectionStoresReady,
    createGenerationTrash,
    type GenerationRecordRef,
    type GenerationTrashListItem,
    type GenerationTrashRecord,
    type GenerationTrashStoredRecord,
} from "@/lib/generation-trash";
import { assertStoredGenerationLog, preferredGenerationLog } from "@/lib/generation-log-merge";
import { deleteStoredMedia, resolveMediaUrl } from "@/services/file-storage";
import { createGenerationLogStore, runGenerationLogOperation } from "@/services/generation-log-store";
import { deleteStoredImages, resolveImageUrl } from "@/services/image-storage";
import { notifyImageUsageUpdated } from "@/services/image-usage-stats";
import { useAssetStore } from "@/stores/use-asset-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useImageWorkbenchStore } from "@/stores/use-image-workbench-store";
import { useVideoWorkbenchStore } from "@/stores/use-video-workbench-store";

type StoredImageRecord = GenerationTrashRecord & Record<string, unknown> & {
    images?: Array<Record<string, unknown>>;
    thumbnails?: string[];
};

type StoredVideoRecord = GenerationTrashRecord & Record<string, unknown> & {
    video?: Record<string, unknown>;
};

export type { GenerationRecordRef };
export type GenerationTrashEntry = GenerationTrashListItem<StoredImageRecord, StoredVideoRecord>;
export type GenerationReferenceKind = "canvas" | "asset" | "image-record" | "video-record" | "image-workbench" | "video-workbench" | "record-input";
export type GenerationReferenceSource = { kind: GenerationReferenceKind; title: string; storageKeys: string[] };
export type GenerationReferenceReport = { outputStorageKeys: string[]; sources: GenerationReferenceSource[] };

const imageLogStore = createGenerationLogStore<GenerationTrashStoredRecord<StoredImageRecord>>("image_generation_logs");
const videoLogStore = createGenerationLogStore<GenerationTrashStoredRecord<StoredVideoRecord>>("video_generation_logs");
const storageKeyPattern = /^(?:image|video|audio|file|video-reference|audio-reference):|^workspace:assets\//;

const generationTrash = createGenerationTrash({
    image: {
        list: () => listRecords(imageLogStore),
        save: (record) => imageLogStore.setItem(record.id, record).then(() => undefined),
        rollback: (record, expected) => rollbackRecord(imageLogStore, record, expected),
        outputStorageKeys: imageOutputStorageKeys,
        inputStorageKeys: imageInputStorageKeys,
        referencedStorageKeys: collectStorageKeys,
    },
    video: {
        list: () => listRecords(videoLogStore),
        save: (record) => videoLogStore.setItem(record.id, record).then(() => undefined),
        rollback: (record, expected) => rollbackRecord(videoLogStore, record, expected),
        outputStorageKeys: videoOutputStorageKeys,
        inputStorageKeys: videoInputStorageKeys,
        referencedStorageKeys: collectStorageKeys,
    },
    deleteOutputs,
    additionalProtectedStorageKeys: collectAdditionalProtectedStorageKeys,
});

export async function listGenerationTrash(): Promise<GenerationTrashEntry[]> {
    const entries = await runGenerationLogOperation(() => generationTrash.listTrash());
    return Promise.all(entries.map(hydrateEntry));
}

export async function moveGenerationRecordsToTrash(refs: readonly GenerationRecordRef[]) {
    const result = await runGenerationLogOperation(async () => {
        const moved = await generationTrash.move(refs);
        moved.moved.forEach((ref) => logStoreForKind(ref.kind).discardVolatileItem(ref.id));
        return moved;
    });
    notifyImageChanges(result.moved);
    return { moved: result.moved.length, skipped: result.skipped.length, movedRefs: result.moved, skippedRefs: result.skipped };
}

export async function restoreGenerationRecords(refs: readonly GenerationRecordRef[]) {
    const result = await runGenerationLogOperation(async () => {
        const restored = await generationTrash.restore(refs);
        restored.restored.forEach((ref) => logStoreForKind(ref.kind).discardVolatileItem(ref.id));
        return restored;
    });
    notifyImageChanges(result.restored);
    return { restored: result.restored.length, skipped: result.skipped.length, restoredRefs: result.restored, skippedRefs: result.skipped };
}

export async function purgeGenerationRecords(refs: readonly GenerationRecordRef[]) {
    const result = await runGenerationLogOperation(async () => {
        const purged = await generationTrash.purge(refs);
        purged.purged.forEach((ref) => logStoreForKind(ref.kind).discardVolatileItem(ref.id));
        return purged;
    });
    notifyImageChanges(result.purged);
    return {
        purged: result.purged.length,
        deletedFiles: result.deletedFiles.length,
        protectedFiles: result.protectedFiles.length,
        failedFiles: result.failedFiles.length,
        skipped: result.skipped.length,
        purgedRefs: result.purged,
        skippedRefs: result.skipped,
    };
}

export async function listProtectedGenerationStorageKeys() {
    await ensureProtectionStoresReady();
    const [imageRecords, videoRecords] = await Promise.all([listRecords(imageLogStore), listRecords(videoLogStore)]);
    return [...collectStorageKeys([imageRecords, videoRecords], collectProtectionStoreKeys())];
}

export async function inspectGenerationRecordReferences(ref: GenerationRecordRef): Promise<GenerationReferenceReport> {
    await ensureProtectionStoresReady();
    const [imageRecords, videoRecords] = await Promise.all([listRecords(imageLogStore), listRecords(videoLogStore)]);
    const records = ref.kind === "image" ? imageRecords : videoRecords;
    const target = records.find((record) => record.id === ref.id && record.purgedAt === undefined);
    if (!target) throw new Error("未找到对应的回收站记录");
    const outputStorageKeys = [...new Set(ref.kind === "image" ? imageOutputStorageKeys(target as StoredImageRecord) : videoOutputStorageKeys(target as StoredVideoRecord))].filter(Boolean);
    const outputSet = new Set(outputStorageKeys);
    const sources: GenerationReferenceSource[] = [];
    const addSource = (kind: GenerationReferenceKind, title: string, value: unknown) => {
        const storageKeys = [...collectStorageKeys(value)].filter((key) => outputSet.has(key));
        if (storageKeys.length) sources.push({ kind, title, storageKeys });
    };

    addSource("record-input", recordTitle(target), ref.kind === "image" ? (target as StoredImageRecord).references : [(target as StoredVideoRecord).references, (target as StoredVideoRecord).videoReferences, (target as StoredVideoRecord).audioReferences]);
    useCanvasStore.getState().projects.forEach((project) => addSource("canvas", project.title, project));
    useAssetStore.getState().assets.forEach((asset) => addSource("asset", asset.title, asset));
    imageRecords.forEach((record) => {
        if (ref.kind !== "image" || record.id !== ref.id) addSource("image-record", recordTitle(record), record);
    });
    videoRecords.forEach((record) => {
        if (ref.kind !== "video" || record.id !== ref.id) addSource("video-record", recordTitle(record), record);
    });
    addSource("image-workbench", "", useImageWorkbenchStore.getState());
    addSource("video-workbench", "", useVideoWorkbenchStore.getState());
    return { outputStorageKeys, sources };
}

async function listRecords<TRecord extends GenerationTrashRecord>(store: ReturnType<typeof createGenerationLogStore<GenerationTrashStoredRecord<TRecord>>>) {
    const records = new Map<string, GenerationTrashStoredRecord<TRecord>>();
    await store.iterate<GenerationTrashStoredRecord<TRecord>, void>((record, key) => {
        assertStoredGenerationLog(key, record);
        records.set(record.id, record);
    });
    store.volatileEntries().forEach(([key, record]) => {
        assertStoredGenerationLog(key, record);
        const current = records.get(key);
        if (!current || preferredGenerationLog(record, current) === record) records.set(key, record);
    });
    return [...records.values()];
}

function imageOutputStorageKeys(record: StoredImageRecord) {
    return Array.isArray(record.images) ? record.images.map((image) => stringField(image, "storageKey")) : [];
}

function rollbackRecord<TRecord extends GenerationTrashRecord>(
    store: ReturnType<typeof createGenerationLogStore<GenerationTrashStoredRecord<TRecord>>>,
    record: GenerationTrashStoredRecord<TRecord>,
    expected: GenerationTrashStoredRecord<TRecord>,
) {
    const operation = expected.purgedAt === undefined ? store.setItem(record.id, record) : store.rollbackPurgedItem(record.id, record, expected);
    return operation.then(() => undefined);
}

function videoOutputStorageKeys(record: StoredVideoRecord) {
    return record.video ? [stringField(record.video, "storageKey")] : [];
}

function imageInputStorageKeys(record: StoredImageRecord) {
    return collectStorageKeys(record.references);
}

function videoInputStorageKeys(record: StoredVideoRecord) {
    return collectStorageKeys([record.references, record.videoReferences, record.audioReferences]);
}

function collectStorageKeys(value: unknown, keys = new Set<string>()): Set<string> {
    if (typeof value === "string") {
        if (storageKeyPattern.test(value)) keys.add(value);
        return keys;
    }
    if (!value || typeof value !== "object") return keys;
    const record = value as Record<string, unknown>;
    Object.entries(record).forEach(([key, item]) => {
        if (key === "formerOutputStorageKeys" && record.purgedAt) return;
        collectStorageKeys(item, keys);
    });
    return keys;
}

async function deleteOutputs(storageKeys: readonly string[]) {
    const deleted: string[] = [];
    const protectedKeys: string[] = [];
    const failed: string[] = [];
    const localImages: string[] = [];
    const localMedia: string[] = [];
    const desktop = window.infiniteCanvasDesktop;
    const currentlyProtected = await collectAllProtectedStorageKeys();

    for (const storageKey of storageKeys) {
        if (currentlyProtected.has(storageKey)) {
            protectedKeys.push(storageKey);
        } else if (storageKey.startsWith("workspace:") && desktop) {
            try {
                if (await desktop.deleteUnusedAsset(storageKey)) deleted.push(storageKey);
                else protectedKeys.push(storageKey);
            } catch {
                failed.push(storageKey);
            }
        } else if (isImageStorageKey(storageKey)) {
            localImages.push(storageKey);
        } else {
            localMedia.push(storageKey);
        }
    }

    await Promise.all(
        [...localImages.map((storageKey) => ({ storageKey, remove: deleteStoredImages })), ...localMedia.map((storageKey) => ({ storageKey, remove: deleteStoredMedia }))].map(async ({ storageKey, remove }) => {
            try {
                await remove([storageKey]);
                deleted.push(storageKey);
            } catch {
                failed.push(storageKey);
            }
        }),
    );
    return { deleted, protected: protectedKeys, failed };
}

async function collectAdditionalProtectedStorageKeys() {
    const overview = await window.infiniteCanvasDesktop?.getStorageOverview();
    if (overview && !overview.workspace.health.ok) throw new Error("工作区包含损坏的数据文件，请先修复或恢复后再删除");
    await ensureProtectionStoresReady();
    return collectProtectionStoreKeys();
}

function collectProtectionStoreKeys() {
    return collectStorageKeys([
        useAssetStore.getState().assets,
        useCanvasStore.getState().projects,
        useImageWorkbenchStore.getState(),
        useVideoWorkbenchStore.getState(),
    ]);
}

async function ensureProtectionStoresReady() {
    await Promise.all([waitForHydration(useAssetStore), waitForHydration(useCanvasStore)]);
    assertGenerationProtectionStoresReady([useAssetStore.getState(), useCanvasStore.getState()]);
}

async function collectAllProtectedStorageKeys() {
    const protectedKeys = await collectAdditionalProtectedStorageKeys();
    const [imageRecords, videoRecords] = await Promise.all([listRecords(imageLogStore), listRecords(videoLogStore)]);
    return collectStorageKeys([imageRecords, videoRecords], protectedKeys);
}

async function hydrateEntry(entry: GenerationTrashEntry): Promise<GenerationTrashEntry> {
    if (entry.ref.kind === "image") {
        const record = entry.record as StoredImageRecord;
        const images = await Promise.all(
            (record.images || []).map(async (image) => ({
                ...image,
                dataUrl: await resolveImageUrl(stringField(image, "storageKey"), stringField(image, "dataUrl")),
            })),
        );
        return { ...entry, record: { ...record, images, thumbnails: images.map((image) => stringField(image, "dataUrl")).filter(Boolean) } } as GenerationTrashEntry;
    }
    const record = entry.record as StoredVideoRecord;
    if (!record.video) return entry;
    return {
        ...entry,
        record: {
            ...record,
            video: {
                ...record.video,
                url: await resolveMediaUrl(stringField(record.video, "storageKey"), stringField(record.video, "url")),
            },
        },
    } as GenerationTrashEntry;
}

function stringField(value: Record<string, unknown>, key: string) {
    return typeof value[key] === "string" ? value[key] : "";
}

function recordTitle(record: GenerationTrashRecord) {
    const value = record as GenerationTrashRecord & Record<string, unknown>;
    return stringField(value, "title") || stringField(value, "prompt").slice(0, 48) || record.id;
}

function isImageStorageKey(storageKey: string) {
    return storageKey.startsWith("image:") || storageKey.startsWith("workspace:assets/images/");
}

function notifyImageChanges(refs: readonly GenerationRecordRef[]) {
    if (refs.some((ref) => ref.kind === "image")) notifyImageUsageUpdated();
}

function logStoreForKind(kind: GenerationRecordRef["kind"]) {
    return kind === "image" ? imageLogStore : videoLogStore;
}

function waitForHydration<T extends { hydrated: boolean; hydrationError: boolean }>(store: { getState: () => T; subscribe: (listener: (state: T) => void) => () => void }) {
    if (store.getState().hydrated) return Promise.resolve();
    return new Promise<void>((resolve) => {
        const unsubscribe = store.subscribe((state) => {
            if (!state.hydrated) return;
            unsubscribe();
            resolve();
        });
    });
}
