import { nanoid } from "nanoid";

import { assertCreativeHistorySnapshot } from "@/lib/creative-history";
import { localForageStorage } from "@/lib/localforage-storage";
import { createGenerationLogStore } from "@/services/generation-log-store";

export const CREATIVE_TRACKING_VERSION = 1 as const;
export const CREATIVE_ACTIVITY_UPDATED_EVENT = "fourj-canvas:creative-activity-updated";

export type CreativeSource = "workbench" | "canvas" | "agent";
export type CreativeCategory = "image" | "video" | "audio" | "text" | "prompt";
export type CreativeOperation = "generate" | "edit" | "outpaint" | "upscale" | "three-view" | "text-create" | "text-edit" | "text-import" | "prompt-polish";
export type CreativeStatus = "success" | "partial" | "failed" | "canceled";
export type CreativeTextSource = "manual" | "ai" | "mixed" | "imported" | "unknown";

export type CreativeHistoryEntry = {
    eventId: string;
    schemaVersion: typeof CREATIVE_TRACKING_VERSION;
    occurredAt: number;
    recordedAt: number;
    category: CreativeCategory;
    source: CreativeSource;
    operation: CreativeOperation;
    status: CreativeStatus;
    projectId?: string;
    projectTitle?: string;
    nodeId?: string;
    nodeTitle?: string;
    model?: string;
    size?: string;
    quality?: string;
    resolution?: string;
    durationSeconds?: number;
    format?: string;
    requestedCount?: number;
    successCount?: number;
    failureCount?: number;
    canceledCount?: number;
    textSource?: CreativeTextSource;
    characterCount?: number;
};

/** Compatibility shape consumed by the existing statistics page. */
export type CreativeActivityRecord = CreativeHistoryEntry & { id: string; updatedAt: number; failCount?: number };

export type CreativeHistorySnapshot = {
    schemaVersion: typeof CREATIVE_TRACKING_VERSION;
    startedAt: number;
    clearedAt?: number;
    entries: CreativeHistoryEntry[];
};

export type CreativeHistoryInput = Omit<CreativeHistoryEntry, "eventId" | "schemaVersion" | "recordedAt"> & { eventId?: string };

type CreativeHistoryState = Omit<CreativeHistorySnapshot, "entries"> & { entries: Record<string, CreativeHistoryEntry> };
type LegacyActivity = Partial<CreativeHistoryEntry> & { id?: string; updatedAt?: number; failCount?: number };
type LegacyActivityState = { schemaVersion?: number; startedAt?: number; records?: Record<string, LegacyActivity> };
type StoredGenerationLog = Record<string, unknown> & {
    id?: string;
    createdAt?: number;
    updatedAt?: number;
    trackedAt?: number;
    source?: "workbench" | "canvas";
    operation?: CreativeOperation;
    projectId?: string;
    projectTitle?: string;
    nodeId?: string;
    nodeTitle?: string;
    model?: string;
    size?: string;
    quality?: string;
    resolution?: string;
    seconds?: string | number;
    status?: "running" | "pending" | "success" | "failed";
    imageCount?: number;
    successCount?: number;
    failCount?: number;
    references?: unknown[];
    videoReferences?: unknown[];
    audioReferences?: unknown[];
    video?: unknown;
};

const HISTORY_STORAGE_KEY = "infinite-canvas:creative_history_v1";
const LEGACY_STORAGE_KEY = "infinite-canvas:creative_activity_v1";
const LEGACY_RECOVERY_KEY = "infinite-canvas:creative_activity_v1:recovery";
const CANVAS_STORAGE_KEY = "infinite-canvas:canvas_store";
const imageLogStore = createGenerationLogStore<StoredGenerationLog>("image_generation_logs");
const videoLogStore = createGenerationLogStore<StoredGenerationLog>("video_generation_logs");
const textTimers = new Map<string, ReturnType<typeof setTimeout>>();
let historyQueue = Promise.resolve();

export async function readCreativeHistorySnapshot(): Promise<CreativeHistorySnapshot> {
    const state = await enqueue(readOrCreateState);
    return stateToSnapshot(state);
}

export async function readCreativeActivitySnapshot() {
    const snapshot = await readCreativeHistorySnapshot();
    return { startedAt: snapshot.startedAt, clearedAt: snapshot.clearedAt, records: snapshot.entries.map(toActivityRecord) };
}

export function recordCreativeHistory(input: CreativeHistoryInput) {
    // Capture labels before the queued write runs; a generation can finish
    // after its canvas was removed from the live store.
    const titleSnapshot = input.projectTitle || input.nodeTitle
        ? Promise.resolve({ projectTitle: input.projectTitle, nodeTitle: input.nodeTitle })
        : canvasTitles(input.projectId, input.nodeId);
    return enqueue(async () => {
        const state = await readOrCreateState(false);
        const eventId = input.eventId || nanoid();
        // A debounced or background completion may reach the queue after the
        // user has explicitly cleared history. Do not let that older event
        // silently repopulate the cleared timeline.
        if (state.clearedAt && input.occurredAt <= state.clearedAt) return null;
        if (state.entries[eventId]) return state.entries[eventId];
        const titles = await titleSnapshot.catch(() => ({ projectTitle: undefined, nodeTitle: undefined }));
        const entry = normalizeEntry({ ...input, eventId, schemaVersion: CREATIVE_TRACKING_VERSION, recordedAt: Date.now(), projectTitle: input.projectTitle || titles.projectTitle, nodeTitle: input.nodeTitle || titles.nodeTitle });
        state.entries[eventId] = entry;
        state.startedAt = Math.min(state.startedAt, entry.occurredAt);
        await writeState(state);
        notifyCreativeActivityUpdated();
        return entry;
    });
}

export function recordImageCreativeActivity(input: {
    id: string;
    occurredAt: number;
    source: "workbench" | "canvas";
    operation: Extract<CreativeOperation, "generate" | "edit" | "outpaint" | "upscale" | "three-view">;
    status: "success" | "failed";
    projectId?: string;
    nodeId?: string;
    model?: string;
    size?: string;
    quality?: string;
    resolution?: string;
    requestedCount: number;
    successCount: number;
    failCount: number;
}) {
    return recordCreativeHistory({
        eventId: input.id,
        occurredAt: input.occurredAt,
        category: "image",
        source: input.source,
        operation: input.operation,
        status: resolveStatus(input.successCount, input.failCount, 0, input.status),
        projectId: input.projectId,
        nodeId: input.nodeId,
        model: input.model,
        size: input.size,
        quality: input.quality,
        resolution: input.resolution,
        requestedCount: input.requestedCount,
        successCount: input.successCount,
        failureCount: input.failCount,
        canceledCount: 0,
    });
}

export function recordCanvasTextActivity(input: {
    projectId: string;
    nodeId: string;
    operation: "text-create" | "text-edit" | "text-import";
    textSource: CreativeTextSource;
    characterCount: number;
    source?: "canvas" | "agent";
    projectTitle?: string;
    nodeTitle?: string;
}) {
    const key = `${input.source || "canvas"}:${input.projectId}:${input.nodeId}`;
    const activity: CreativeHistoryInput = {
        occurredAt: Date.now(),
        category: "text",
        source: input.source || "canvas",
        operation: input.operation,
        status: "success",
        projectId: input.projectId,
        projectTitle: input.projectTitle,
        nodeId: input.nodeId,
        nodeTitle: input.nodeTitle,
        textSource: input.textSource,
        characterCount: integer(input.characterCount),
        requestedCount: 1,
        successCount: 1,
        failureCount: 0,
        canceledCount: 0,
    };
    if (input.operation !== "text-edit") return recordCreativeHistory(activity).catch(() => null);
    const previous = textTimers.get(key);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
        textTimers.delete(key);
        void recordCreativeHistory({ ...activity, eventId: `text:${nanoid()}` }).catch(() => undefined);
    }, 800);
    textTimers.set(key, timer);
    return Promise.resolve(null);
}

export function startCreativeHistoryEvent(input: Omit<CreativeHistoryInput, "status" | "successCount" | "failureCount" | "canceledCount"> & { signal?: AbortSignal }) {
    const { signal, ...base } = input;
    const eventId = base.eventId || nanoid();
    const titleSnapshot = base.projectTitle || base.nodeTitle
        ? Promise.resolve({ projectTitle: base.projectTitle, nodeTitle: base.nodeTitle })
        : canvasTitles(base.projectId, base.nodeId);
    let settled = false;
    const cancel = () => void finish({ status: "canceled", canceledCount: base.requestedCount || 1 }).catch(() => undefined);
    const finish = (outcome: { status?: CreativeStatus; successCount?: number; failureCount?: number; canceledCount?: number }) => {
        if (settled) return Promise.resolve(null);
        settled = true;
        signal?.removeEventListener("abort", cancel);
        const successCount = integer(outcome.successCount);
        const failureCount = integer(outcome.failureCount);
        const canceledCount = integer(outcome.canceledCount);
        const historyInput = { ...base, eventId, status: outcome.status || resolveStatus(successCount, failureCount, canceledCount), successCount, failureCount, canceledCount };
        return titleSnapshot.then((titles) => recordCreativeHistory({ ...historyInput, ...titles })).catch(() => recordCreativeHistory(historyInput));
    };
    if (signal?.aborted) cancel();
    else signal?.addEventListener("abort", cancel, { once: true });
    return { eventId, finish, cancel };
}

export function startCanvasImageGeneration(input: {
    projectId: string;
    projectTitle?: string;
    nodeId: string;
    nodeTitle?: string;
    outputNodeIds?: string[];
    operation: Extract<CreativeOperation, "generate" | "edit" | "outpaint" | "upscale" | "three-view">;
    model?: string;
    size?: string;
    quality?: string;
    imageCount?: number;
    signal?: AbortSignal;
}) {
    const count = Math.max(1, integer(input.imageCount));
    const tracker = startCreativeHistoryEvent({ occurredAt: Date.now(), category: "image", source: "canvas", operation: input.operation, projectId: input.projectId, projectTitle: input.projectTitle, nodeId: input.nodeId, nodeTitle: input.nodeTitle, model: input.model, size: input.size, quality: input.quality, requestedCount: count, signal: input.signal });
    return {
        id: tracker.eventId,
        // Telemetry persistence must never turn a completed canvas result
        // into a failed generation or create an unhandled rejection.
        finish: (successCount: number, failCount: number, canceledCount = 0) => tracker.finish({ successCount, failureCount: failCount, canceledCount }).catch(() => null),
        cancel: tracker.cancel,
    };
}

export function recordCanvasMediaActivity(input: { projectId: string; projectTitle?: string; nodeId: string; nodeTitle?: string; category: "video" | "audio"; operation?: "generate" | "edit"; model?: string; status: CreativeStatus; successCount?: number; failureCount?: number; occurredAt?: number }) {
    return recordCreativeHistory({ eventId: `${input.category}:${nanoid()}`, occurredAt: input.occurredAt || Date.now(), category: input.category, source: "canvas", operation: input.operation || "generate", projectId: input.projectId, projectTitle: input.projectTitle, nodeId: input.nodeId, nodeTitle: input.nodeTitle, model: input.model, requestedCount: 1, successCount: input.successCount ?? (input.status === "success" ? 1 : 0), failureCount: input.failureCount ?? (input.status === "failed" ? 1 : 0), status: input.status });
}

export async function clearCreativeHistory() {
    await enqueue(async () => {
        textTimers.forEach((timer) => clearTimeout(timer));
        textTimers.clear();
        const now = Date.now();
        await writeState({ schemaVersion: CREATIVE_TRACKING_VERSION, startedAt: now, clearedAt: now, entries: {} });
        notifyCreativeActivityUpdated();
    });
}

export function mergeCreativeHistorySnapshots(local: CreativeHistorySnapshot, remote: CreativeHistorySnapshot): CreativeHistorySnapshot {
    validateSnapshot(local);
    validateSnapshot(remote);
    const clearedAt = Math.max(local.clearedAt || 0, remote.clearedAt || 0) || undefined;
    const map = new Map<string, CreativeHistoryEntry>();
    [...remote.entries, ...local.entries].forEach((entry) => {
        if (clearedAt && entry.occurredAt <= clearedAt) return;
        const current = map.get(entry.eventId);
        if (!current) map.set(entry.eventId, entry);
        else map.set(entry.eventId, entry.recordedAt >= current.recordedAt ? fillMissingEntryDetails(entry, current) : fillMissingEntryDetails(current, entry));
    });
    const entries = [...map.values()].sort(compareEntries);
    return { schemaVersion: CREATIVE_TRACKING_VERSION, startedAt: entries.length ? Math.min(...entries.map((entry) => entry.occurredAt)) : Math.max(clearedAt || 0, Math.min(local.startedAt, remote.startedAt)), ...(clearedAt ? { clearedAt } : {}), entries };
}

export async function replaceCreativeHistorySnapshot(snapshot: CreativeHistorySnapshot) {
    validateSnapshot(snapshot);
    await enqueue(async () => {
        textTimers.forEach((timer) => clearTimeout(timer));
        textTimers.clear();
        await writeState(snapshotToState(snapshot));
        notifyCreativeActivityUpdated();
    });
}

export async function mergeCreativeHistorySnapshot(snapshot: CreativeHistorySnapshot) {
    validateSnapshot(snapshot);
    await enqueue(async () => {
        const current = await readOrCreateState(false);
        const merged = mergeCreativeHistorySnapshots(stateToSnapshot(current), snapshot);
        await writeState(snapshotToState(merged));
        notifyCreativeActivityUpdated();
    });
}

async function readOrCreateState(mergeLogs = true): Promise<CreativeHistoryState> {
    const serialized = await localForageStorage.getItem(HISTORY_STORAGE_KEY);
    if (serialized !== null) {
        const state = parseState(serialized);
        return mergeLogs ? mergeMissingGenerationLogs(state) : state;
    }
    const state = await migrateInitialState();
    await backfillMissingCanvasTitles(state);
    await writeInitialState(state);
    return state;
}

async function mergeMissingGenerationLogs(state: CreativeHistoryState) {
    const [imageLogs, videoLogs] = await Promise.all([readLogs(imageLogStore), readLogs(videoLogStore)]);
    let changed = false;
    [...imageLogs.map((log) => generationEntry(log, "image")), ...videoLogs.map((log) => generationEntry(log, "video"))].forEach((entry) => {
        if (!entry || (state.clearedAt && entry.occurredAt <= state.clearedAt)) return;
        const current = state.entries[entry.eventId];
        const merged = current ? fillMissingEntryDetails(current, entry) : entry;
        if (merged === current) return;
        state.entries[entry.eventId] = merged;
        changed = true;
    });
    changed = await backfillMissingCanvasTitles(state) || changed;
    if (changed) {
        const entries = Object.values(state.entries).sort(compareEntries);
        state.startedAt = entries.length ? Math.min(state.startedAt, entries[0].occurredAt) : state.startedAt;
        await writeState(state);
    }
    return state;
}

async function migrateInitialState(): Promise<CreativeHistoryState> {
    const [legacySerialized, imageLogs, videoLogs] = await Promise.all([localForageStorage.getItem(LEGACY_STORAGE_KEY), readLogs(imageLogStore), readLogs(videoLogStore)]);
    const map = new Map<string, CreativeHistoryEntry>();
    if (legacySerialized !== null) {
        const legacy = JSON.parse(legacySerialized) as LegacyActivityState;
        if (legacy.schemaVersion !== CREATIVE_TRACKING_VERSION || !legacy.records || typeof legacy.records !== "object" || Array.isArray(legacy.records)) throw new Error("创作统计旧记录版本未知或数据损坏，已拒绝覆盖原记录");
        await createLegacyRecoveryPoint(legacySerialized);
        Object.values(legacy.records).forEach((record) => {
            if (!record.id || !record.category || !record.source || !record.operation || !record.status || !Number.isFinite(record.occurredAt)) return;
            const success = integer(record.successCount ?? (record.status === "success" ? 1 : 0));
            const failure = integer(record.failureCount ?? record.failCount ?? (record.status === "failed" ? 1 : 0));
            map.set(record.id, normalizeEntry({ eventId: record.id, schemaVersion: CREATIVE_TRACKING_VERSION, occurredAt: record.occurredAt!, recordedAt: record.updatedAt || record.occurredAt!, category: record.category, source: record.source, operation: record.operation, status: resolveStatus(success, failure, 0, record.status), projectId: record.projectId, projectTitle: record.projectTitle, nodeId: record.nodeId, nodeTitle: record.nodeTitle, model: record.model, requestedCount: record.requestedCount, successCount: success, failureCount: failure, canceledCount: 0, textSource: record.textSource, characterCount: record.characterCount }));
        });
    }
    [...imageLogs.map((log) => generationEntry(log, "image")), ...videoLogs.map((log) => generationEntry(log, "video"))].forEach((entry) => {
        if (!entry) return;
        const current = map.get(entry.eventId);
        map.set(entry.eventId, current ? fillMissingEntryDetails(current, entry) : entry);
    });
    const entries = [...map.values()].sort(compareEntries);
    return { schemaVersion: CREATIVE_TRACKING_VERSION, startedAt: entries.length ? entries[0].occurredAt : Date.now(), entries: Object.fromEntries(entries.map((entry) => [entry.eventId, entry])) };
}

async function createLegacyRecoveryPoint(payload: string) {
    const existing = await localForageStorage.getItem(LEGACY_RECOVERY_KEY);
    if (existing !== null) {
        try {
            const recovery = JSON.parse(existing) as { schemaVersion?: number; source?: string; payload?: string };
            if (recovery.schemaVersion !== CREATIVE_TRACKING_VERSION || recovery.source !== LEGACY_STORAGE_KEY || typeof recovery.payload !== "string") throw new Error("invalid recovery");
            if (recovery.source === LEGACY_STORAGE_KEY && recovery.payload === payload) return;
        } catch {
            throw new Error("创作统计恢复点损坏，已拒绝覆盖原记录");
        }
        throw new Error("创作统计恢复点与当前旧记录冲突，已拒绝覆盖原记录");
    }
    const recovery = JSON.stringify({ schemaVersion: CREATIVE_TRACKING_VERSION, source: LEGACY_STORAGE_KEY, backedUpAt: Date.now(), payload });
    await localForageStorage.setItem(LEGACY_RECOVERY_KEY, recovery);
    if (await localForageStorage.getItem(LEGACY_RECOVERY_KEY) !== recovery) throw new Error("创作统计恢复点写入失败，已拒绝覆盖原记录");
}

async function writeInitialState(state: CreativeHistoryState) {
    await writeState(state);
    try {
        const serialized = await localForageStorage.getItem(HISTORY_STORAGE_KEY);
        if (serialized === null) throw new Error("empty history");
        parseState(serialized);
    } catch {
        try {
            await localForageStorage.removeItem(HISTORY_STORAGE_KEY);
        } catch {
            // Keep the legacy key untouched even when cleanup of the new key fails.
        }
        throw new Error("创作统计迁移校验失败，已保留原记录");
    }
}

async function readLogs(store: ReturnType<typeof createGenerationLogStore<StoredGenerationLog>>) {
    const map = new Map<string, StoredGenerationLog>();
    await store.iterate<StoredGenerationLog, void>((value, key) => {
        const id = value.id || key;
        map.set(id, value.id ? value : { ...value, id });
    });
    store.volatileEntries().forEach(([key, value]) => {
        const id = value.id || key;
        map.set(id, value.id ? value : { ...value, id });
    });
    return [...map.values()];
}

function generationEntry(log: StoredGenerationLog, category: "image" | "video") {
    if (!log.id || (log.status !== "success" && log.status !== "failed")) return null;
    const occurredAt = finite(log.trackedAt) || finite(log.createdAt) || finite(log.updatedAt);
    if (!occurredAt) return null;
    const success = category === "image" ? integer(log.successCount ?? (log.status === "success" ? log.imageCount || 1 : 0)) : log.status === "success" || Boolean(log.video) ? 1 : 0;
    const failure = category === "image" ? integer(log.failCount ?? (log.status === "failed" ? log.imageCount || 1 : 0)) : success ? 0 : 1;
    return normalizeEntry({ eventId: `${category}:${log.id}`, schemaVersion: CREATIVE_TRACKING_VERSION, occurredAt, recordedAt: finite(log.updatedAt) || occurredAt, category, source: log.source === "canvas" ? "canvas" : "workbench", operation: normalizeOperation(log.operation, Boolean(log.references?.length || log.videoReferences?.length || log.audioReferences?.length)), projectId: log.projectId, projectTitle: text(log.projectTitle), nodeId: log.nodeId, nodeTitle: text(log.nodeTitle), model: text(log.model), size: text(log.size), quality: text(log.quality), resolution: text(log.resolution), durationSeconds: number(log.seconds), requestedCount: category === "image" ? Math.max(integer(log.imageCount), success + failure, 1) : 1, successCount: success, failureCount: failure, canceledCount: 0, status: resolveStatus(success, failure, 0, log.status) });
}

function normalizeOperation(operation: CreativeOperation | undefined, refs: boolean): CreativeOperation {
    return operation === "generate" || operation === "edit" || operation === "outpaint" || operation === "upscale" || operation === "three-view" ? operation : refs ? "edit" : "generate";
}

function fillMissingEntryDetails(current: CreativeHistoryEntry, fallback: CreativeHistoryEntry) {
    const merged = normalizeEntry({
        ...current,
        projectId: current.projectId || fallback.projectId,
        projectTitle: current.projectTitle || fallback.projectTitle,
        nodeId: current.nodeId || fallback.nodeId,
        nodeTitle: current.nodeTitle || fallback.nodeTitle,
        model: current.model || fallback.model,
        size: current.size || fallback.size,
        quality: current.quality || fallback.quality,
        resolution: current.resolution || fallback.resolution,
        durationSeconds: current.durationSeconds ?? fallback.durationSeconds,
        format: current.format || fallback.format,
        recordedAt: Math.max(current.recordedAt, fallback.recordedAt),
    });
    return JSON.stringify(merged) === JSON.stringify(current) ? current : merged;
}

async function canvasTitles(projectId?: string, nodeId?: string) {
    if (!projectId) return {} as { projectTitle?: string; nodeTitle?: string };
    const project = (await readCanvasTitleProjects()).find((item) => item.id === projectId);
    const node = project?.nodes?.find((item) => item.id === nodeId);
    return { projectTitle: text(project?.title) || undefined, nodeTitle: text(node?.title) || undefined };
}

type CanvasTitleProject = { id?: string; title?: string; nodes?: Array<{ id?: string; title?: string }> };

async function readCanvasTitleProjects(): Promise<CanvasTitleProject[]> {
    try {
        const serialized = await localForageStorage.getItem(CANVAS_STORAGE_KEY);
        const value = serialized ? JSON.parse(serialized) as { state?: { projects?: CanvasTitleProject[] } } : null;
        return Array.isArray(value?.state?.projects) ? value.state.projects : [];
    } catch { return []; }
}

async function backfillMissingCanvasTitles(state: CreativeHistoryState) {
    const projects = new Map((await readCanvasTitleProjects()).filter((project) => project.id).map((project) => [project.id!, project]));
    let changed = false;
    Object.values(state.entries).forEach((entry) => {
        const project = entry.projectId ? projects.get(entry.projectId) : undefined;
        const projectTitle = text(project?.title);
        const nodeTitle = text(project?.nodes?.find((node) => node.id === entry.nodeId)?.title);
        if (!entry.projectTitle && projectTitle) { entry.projectTitle = projectTitle; changed = true; }
        if (!entry.nodeTitle && nodeTitle) { entry.nodeTitle = nodeTitle; changed = true; }
    });
    return changed;
}

function parseState(serialized: string) {
    const value = JSON.parse(serialized) as CreativeHistoryState;
    const snapshot = stateToSnapshot(value);
    validateSnapshot(snapshot);
    return snapshotToState(snapshot);
}

function stateToSnapshot(state: CreativeHistoryState): CreativeHistorySnapshot {
    if (!state || typeof state !== "object" || !state.entries || typeof state.entries !== "object" || Array.isArray(state.entries)) throw new Error("创作历史版本未知或数据损坏，已拒绝覆盖原记录");
    const snapshot = { schemaVersion: state.schemaVersion, startedAt: state.startedAt, ...(state.clearedAt !== undefined ? { clearedAt: state.clearedAt } : {}), entries: Object.values(state.entries) };
    validateSnapshot(snapshot);
    return { ...snapshot, entries: snapshot.entries.sort(compareEntries) };
}

function snapshotToState(snapshot: CreativeHistorySnapshot): CreativeHistoryState {
    return { schemaVersion: CREATIVE_TRACKING_VERSION, startedAt: snapshot.startedAt, ...(snapshot.clearedAt ? { clearedAt: snapshot.clearedAt } : {}), entries: Object.fromEntries(snapshot.entries.map((entry) => [entry.eventId, normalizeEntry(entry)])) };
}

function validateSnapshot(snapshot: CreativeHistorySnapshot) {
    assertCreativeHistorySnapshot(snapshot, CREATIVE_TRACKING_VERSION);
}

function normalizeEntry(entry: CreativeHistoryEntry): CreativeHistoryEntry {
    const success = integer(entry.successCount);
    const failure = integer(entry.failureCount);
    const canceled = integer(entry.canceledCount);
    return { ...entry, requestedCount: Math.max(integer(entry.requestedCount), success + failure + canceled), successCount: success, failureCount: failure, canceledCount: canceled, characterCount: entry.characterCount === undefined ? undefined : integer(entry.characterCount), durationSeconds: entry.durationSeconds === undefined ? undefined : Math.max(0, number(entry.durationSeconds)), status: resolveStatus(success, failure, canceled, entry.status) };
}

function toActivityRecord(entry: CreativeHistoryEntry): CreativeActivityRecord {
    return { ...entry, id: entry.eventId, updatedAt: entry.recordedAt, failCount: entry.failureCount };
}

function writeState(state: CreativeHistoryState) { stateToSnapshot(state); return localForageStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(state)); }
function enqueue<T>(operation: () => Promise<T>) { const result = historyQueue.then(operation); historyQueue = result.then(() => undefined, () => undefined); return result; }
function resolveStatus(success: number, failure: number, canceled: number, fallback?: CreativeStatus | "success" | "failed"): CreativeStatus { if (success && (failure || canceled)) return "partial"; if (success) return "success"; if (failure) return "failed"; if (canceled) return "canceled"; return fallback || "success"; }
function compareEntries(left: CreativeHistoryEntry, right: CreativeHistoryEntry) { return left.occurredAt - right.occurredAt || left.recordedAt - right.recordedAt || left.eventId.localeCompare(right.eventId); }
function integer(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0; }
function finite(value: unknown) { return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0; }
function number(value: unknown) { if (typeof value === "number" && Number.isFinite(value)) return value; if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value); return 0; }
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function notifyCreativeActivityUpdated() { if (typeof window !== "undefined") window.dispatchEvent(new Event(CREATIVE_ACTIVITY_UPDATED_EVENT)); }
