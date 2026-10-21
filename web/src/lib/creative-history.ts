const creativeCategories = ["image", "video", "audio", "text", "prompt"] as const;
const creativeSources = ["workbench", "canvas", "agent"] as const;
const creativeOperations = ["generate", "edit", "outpaint", "upscale", "three-view", "text-create", "text-edit", "text-import", "prompt-polish"] as const;
const creativeStatuses = ["success", "partial", "failed", "canceled"] as const;
const creativeTextSources = ["manual", "ai", "mixed", "imported", "unknown"] as const;
const countFields = ["requestedCount", "successCount", "failureCount", "canceledCount", "characterCount"] as const;
const optionalStringFields = ["projectId", "projectTitle", "nodeId", "nodeTitle", "model", "size", "quality", "resolution", "format"] as const;
const INVALID_HISTORY_MESSAGE = "创作历史版本未知或数据损坏，已拒绝覆盖原记录";

type HistorySummaryEntry = {
    category: string;
    operation: string;
    requestedCount?: number;
    successCount?: number;
    failureCount?: number;
    failCount?: number;
    canceledCount?: number;
    characterCount?: number;
};

type ProjectTitleSnapshot = {
    projectId?: string;
    projectTitle?: string;
    occurredAt: number;
};

export function assertCreativeHistorySnapshot(snapshot: unknown, expectedSchemaVersion: number) {
    if (!isRecord(snapshot)
        || snapshot.schemaVersion !== expectedSchemaVersion
        || !positiveFinite(snapshot.startedAt)
        || !Array.isArray(snapshot.entries)
        || (snapshot.clearedAt !== undefined && !positiveFinite(snapshot.clearedAt))) invalidHistory();

    const ids = new Set<string>();
    snapshot.entries.forEach((entry) => {
        if (!isRecord(entry)
            || entry.schemaVersion !== expectedSchemaVersion
            || !nonEmptyString(entry.eventId)
            || ids.has(entry.eventId)
            || !positiveFinite(entry.occurredAt)
            || !positiveFinite(entry.recordedAt)
            || !includes(creativeCategories, entry.category)
            || !includes(creativeSources, entry.source)
            || !includes(creativeOperations, entry.operation)
            || !includes(creativeStatuses, entry.status)
            || (entry.textSource !== undefined && !includes(creativeTextSources, entry.textSource))
            || optionalStringFields.some((field) => entry[field] !== undefined && typeof entry[field] !== "string")
            || countFields.some((field) => entry[field] !== undefined && !nonNegativeInteger(entry[field]))
            || (entry.durationSeconds !== undefined && !nonNegativeFinite(entry.durationSeconds))) invalidHistory();

        const requested = count(entry.requestedCount);
        const settled = count(entry.successCount) + count(entry.failureCount) + count(entry.canceledCount);
        if (settled > requested) invalidHistory();
        ids.add(entry.eventId);
    });
}

export function resolveProjectTitles(currentProjects: ReadonlyArray<{ id: string; title: string }>, snapshots: readonly ProjectTitleSnapshot[]) {
    const currentIds = new Set(currentProjects.map((project) => project.id));
    const titles = new Map(currentProjects.map((project) => [project.id, project.title.trim()]));
    const latest = new Map<string, { title: string; occurredAt: number }>();

    snapshots.forEach((snapshot) => {
        const projectId = snapshot.projectId?.trim();
        const title = snapshot.projectTitle?.trim();
        if (!projectId || !title || currentIds.has(projectId) || !positiveFinite(snapshot.occurredAt)) return;
        const previous = latest.get(projectId);
        if (!previous || snapshot.occurredAt >= previous.occurredAt) latest.set(projectId, { title, occurredAt: snapshot.occurredAt });
    });
    latest.forEach((snapshot, projectId) => titles.set(projectId, snapshot.title));
    return titles;
}

export function summarizeCreativeHistory(entries: readonly HistorySummaryEntry[]) {
    const images = entries.filter((entry) => entry.category === "image");
    const texts = entries.filter((entry) => entry.category === "text");
    return {
        activities: entries.length,
        requestedImages: sum(images, "requestedCount"),
        successImages: sum(images, "successCount"),
        failedImages: images.reduce((total, entry) => total + count(entry.failureCount ?? entry.failCount), 0),
        canceledImages: sum(images, "canceledCount"),
        successVideos: sum(entries.filter((entry) => entry.category === "video"), "successCount"),
        successAudios: sum(entries.filter((entry) => entry.category === "audio"), "successCount"),
        successfulPromptPolishes: sum(entries.filter((entry) => entry.category === "prompt" && entry.operation === "prompt-polish"), "successCount"),
        textEntries: texts.length,
        textCharacters: sum(texts, "characterCount"),
    };
}

function sum(entries: readonly HistorySummaryEntry[], field: keyof HistorySummaryEntry) {
    return entries.reduce((total, entry) => total + count(entry[field]), 0);
}

function count(value: unknown) {
    return nonNegativeInteger(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function includes(values: readonly string[], value: unknown): value is string {
    return typeof value === "string" && values.includes(value);
}

function nonEmptyString(value: unknown): value is string {
    return typeof value === "string" && Boolean(value.trim());
}

function positiveFinite(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function nonNegativeFinite(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function nonNegativeInteger(value: unknown): value is number {
    return nonNegativeFinite(value) && Number.isInteger(value);
}

function invalidHistory(): never {
    throw new Error(INVALID_HISTORY_MESSAGE);
}
