import { modelOptionName } from "@/stores/use-config-store";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasTextSource } from "@/types/canvas";
import { resolveProjectTitles, summarizeCreativeHistory } from "@/lib/creative-history";
import {
    CREATIVE_ACTIVITY_UPDATED_EVENT,
    readCreativeActivitySnapshot,
    type CreativeActivityRecord,
    type CreativeOperation,
    type CreativeSource,
} from "@/services/creative-activity";
import { createGenerationLogStore } from "@/services/generation-log-store";

export type ImageUsagePeriod = "day" | "week" | "month" | "quarter" | "year";
export type ImageUsageRange = "30d" | "90d" | "1y" | "all";

export type ImageUsageRecord = {
    id: string;
    createdAt: number;
    source: CreativeSource;
    operation: CreativeOperation;
    projectId?: string;
    projectTitle?: string;
    nodeId?: string;
    model: string;
    size: string;
    requests: number;
    requestedImages: number;
    successImages: number;
    failedImages: number;
    canceledImages: number;
};

export type ImageUsageBreakdown = {
    value: string;
    count: number;
    percentage: number;
};

export type ImageUsageBucket = {
    key: string;
    startAt: number;
    activities: number;
    requests: number;
    requestedImages: number;
    successImages: number;
    failedImages: number;
    canceledImages: number;
};

export type CanvasOutputBreakdown = ImageUsageBreakdown & { projectId: string };

export type ImageUsageStats = {
    trackedSince: number;
    history: {
        activities: number;
        requestedImages: number;
        successImages: number;
        failedImages: number;
        canceledImages: number;
        successVideos: number;
        successAudios: number;
        successfulPromptPolishes: number;
        textEntries: number;
        textCharacters: number;
    };
    current: {
        textNodes: number;
        textCharacters: number;
        imageNodes: number;
        videoNodes: number;
        audioNodes: number;
    };
    buckets: ImageUsageBucket[];
    summary: {
        activities: number;
        activeDays: number;
        streakDays: number;
        requests: number;
        requestedImages: number;
        successImages: number;
        failedImages: number;
        canceledImages: number;
        successRate: number;
        textNodes: number;
        textCharacters: number;
        topSize?: ImageUsageBreakdown;
    };
    textRatio: { manual: number; ai: number; knownNodes: number; excludedNodes: number };
    models: ImageUsageBreakdown[];
    sizes: ImageUsageBreakdown[];
    sources: ImageUsageBreakdown[];
    operations: ImageUsageBreakdown[];
    textSources: ImageUsageBreakdown[];
    timeSlots: ImageUsageBreakdown[];
    canvasOutputs: CanvasOutputBreakdown[];
};

type CreativeUsageData = {
    trackedSince: number;
    records: ImageUsageRecord[];
    activities: CreativeActivityRecord[];
    projects: CanvasProject[];
};

type StoredImageLog = {
    id?: string;
    createdAt?: number;
    updatedAt?: number;
    trackedAt?: number;
    trackingVersion?: number;
    source?: CreativeSource;
    operation?: CreativeOperation;
    projectId?: string;
    projectTitle?: string;
    nodeId?: string;
    model?: string;
    size?: string;
    status?: "running" | "pending" | "success" | "failed";
    config?: { model?: string; imageModel?: string; size?: string };
    successCount?: number;
    failCount?: number;
    imageCount?: number;
    references?: unknown[];
    trashedAt?: number;
    purgedAt?: number;
};

const logStore = createGenerationLogStore<StoredImageLog>("image_generation_logs");
const textSources: CanvasTextSource[] = ["manual", "ai", "mixed", "imported", "unknown"];
const operations: CreativeOperation[] = ["generate", "edit", "outpaint", "upscale", "three-view"];
export const IMAGE_USAGE_UPDATED_EVENT = CREATIVE_ACTIVITY_UPDATED_EVENT;

export async function readImageUsageRecords(activitySnapshot?: Awaited<ReturnType<typeof readCreativeActivitySnapshot>>) {
    if (typeof window === "undefined") return [];
    const history = activitySnapshot || await readCreativeActivitySnapshot();
    // The independent history is authoritative for events it contains, but
    // older installations can already have a history record created before
    // their generation logs were migrated. Merge both stores and deduplicate
    // by the stable `image:<logId>` identity instead of dropping legacy rows.
    const records = new Map<string, ImageUsageRecord>();
    history.records
        .filter((entry) => entry.category === "image")
        .forEach((entry) => {
            const record = {
                id: entry.id,
                createdAt: entry.occurredAt,
                source: entry.source,
                operation: entry.operation as CreativeOperation,
                projectId: entry.projectId,
                projectTitle: entry.projectTitle,
                nodeId: entry.nodeId,
                model: modelOptionName((entry.model || "").trim()),
                size: entry.size || "",
                requests: 1,
                requestedImages: entry.requestedCount || 0,
                successImages: entry.successCount || 0,
                failedImages: entry.failureCount || entry.failCount || 0,
                canceledImages: entry.canceledCount || 0,
            } satisfies ImageUsageRecord;
            records.set(entry.id, record);
        });
    await logStore.iterate<StoredImageLog, void>((log, key) => {
        const record = normalizeImageUsageRecord(log, key);
        if (!record) return;
        if (history.clearedAt && record.createdAt <= history.clearedAt) return;
        const historyId = record.id.startsWith("image:") ? record.id : `image:${record.id}`;
        if (!records.has(historyId) && !records.has(record.id)) records.set(historyId, record);
    });
    logStore.volatileEntries().forEach(([key, log]) => {
        const record = normalizeImageUsageRecord(log, key);
        if (!record) return;
        if (history.clearedAt && record.createdAt <= history.clearedAt) return;
        const historyId = record.id.startsWith("image:") ? record.id : `image:${record.id}`;
        if (!records.has(historyId) && !records.has(record.id)) records.set(historyId, record);
    });
    return [...records.values()].sort((left, right) => right.createdAt - left.createdAt);
}

export async function readCreativeUsageData(): Promise<CreativeUsageData> {
    const hydration = waitForCanvasHydration();
    const activity = await readCreativeActivitySnapshot();
    const records = await readImageUsageRecords(activity);
    await hydration;
    return { trackedSince: activity.startedAt, records, activities: activity.records, projects: useCanvasStore.getState().projects };
}

export function notifyImageUsageUpdated() {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(IMAGE_USAGE_UPDATED_EVENT));
}

export function buildImageUsageStats(data: CreativeUsageData, period: ImageUsagePeriod, range: ImageUsageRange, now = new Date()): ImageUsageStats {
    const rangeStart = getRangeStart(range, now);
    const visibleFrom = rangeStart?.getTime() || 0;
    const filteredRecords = data.records.filter((record) => record.createdAt >= Math.max(data.trackedSince, visibleFrom));
    const filteredActivities = data.activities.filter((activity) => activity.occurredAt >= Math.max(data.trackedSince, visibleFrom));
    const activityIds = new Set(filteredActivities.map((activity) => activity.id));
    const activityTimes = [
        ...filteredActivities.map((activity) => activity.occurredAt),
        ...filteredRecords.filter((record) => !activityIds.has(record.id) && !activityIds.has(`image:${record.id}`)).map((record) => record.createdAt),
    ];
    const bucketMap = new Map<string, ImageUsageBucket>();

    activityTimes.forEach((occurredAt) => {
        const start = bucketStart(new Date(occurredAt), period);
        const key = bucketKey(start, period);
        const current = bucketMap.get(key) || createBucket(key, start);
        current.activities += 1;
        bucketMap.set(key, current);
    });
    filteredRecords.forEach((record) => {
        const start = bucketStart(new Date(record.createdAt), period);
        const key = bucketKey(start, period);
        const current = bucketMap.get(key) || createBucket(key, start);
        current.requests += record.requests;
        current.requestedImages += record.requestedImages;
        current.successImages += record.successImages;
        current.failedImages += record.failedImages;
        current.canceledImages += record.canceledImages;
        bucketMap.set(key, current);
    });

    const earliestActivity = activityTimes.length ? Math.min(...activityTimes) : 0;
    const visibleStart = bucketStart(new Date(visibleFrom || earliestActivity || data.trackedSince), period);
    const visibleEnd = bucketStart(now, period);
    for (let cursor = visibleStart; cursor.getTime() <= visibleEnd.getTime(); cursor = addPeriod(cursor, period)) {
        const key = bucketKey(cursor, period);
        if (!bucketMap.has(key)) bucketMap.set(key, createBucket(key, cursor));
    }

    const buckets = Array.from(bucketMap.values()).sort((left, right) => left.startAt - right.startAt);
    const imageSummary = filteredRecords.reduce(
        (total, record) => {
            total.requests += record.requests;
            total.requestedImages += record.requestedImages;
            total.successImages += record.successImages;
            total.failedImages += record.failedImages;
            total.canceledImages += record.canceledImages;
            return total;
        },
        { requests: 0, requestedImages: 0, successImages: 0, failedImages: 0, canceledImages: 0 },
    );
    const textNodes = data.projects.flatMap((project) => project.nodes.filter((node) => node.type === CanvasNodeType.Text));
    const textSourceValues = textNodes.map((node) => (textSources.includes(node.metadata?.textSource || "unknown") ? node.metadata?.textSource || "unknown" : "unknown"));
    const textSourceCounts = countValues(textSourceValues);
    const manualNodes = textSourceCounts.get("manual") || 0;
    const aiNodes = textSourceCounts.get("ai") || 0;
    const mixedNodes = textSourceCounts.get("mixed") || 0;
    const knownNodes = manualNodes + aiNodes + mixedNodes;
    const activeDayKeys = new Set(activityTimes.map((time) => dayKey(new Date(time))));
    const projectTitles = resolveProjectTitles(data.projects, [
        ...data.activities.map((activity) => ({ projectId: activity.projectId, projectTitle: activity.projectTitle, occurredAt: activity.occurredAt })),
        ...data.records.map((record) => ({ projectId: record.projectId, projectTitle: record.projectTitle, occurredAt: record.createdAt })),
    ]);
    const canvasOutputCounts = new Map<string, number>();
    filteredRecords.forEach((record) => {
        if (record.source !== "canvas" || !record.projectId) return;
        canvasOutputCounts.set(record.projectId, (canvasOutputCounts.get(record.projectId) || 0) + record.successImages);
    });
    const canvasOutputTotal = Array.from(canvasOutputCounts.values()).reduce((total, value) => total + value, 0);

    const history = summarizeCreativeHistory(filteredActivities);
    const currentTextNodes = textNodes.length;
    const currentTextCharacters = textNodes.reduce((total, node) => total + Array.from(node.metadata?.content || "").length, 0);
    return {
        trackedSince: data.trackedSince,
        history,
        current: {
            textNodes: currentTextNodes,
            textCharacters: currentTextCharacters,
            imageNodes: data.projects.flatMap((project) => project.nodes).filter((node) => node.type === CanvasNodeType.Image).length,
            videoNodes: data.projects.flatMap((project) => project.nodes).filter((node) => node.type === CanvasNodeType.Video).length,
            audioNodes: data.projects.flatMap((project) => project.nodes).filter((node) => node.type === CanvasNodeType.Audio).length,
        },
        buckets,
        summary: {
            activities: activityTimes.length,
            activeDays: activeDayKeys.size,
            streakDays: consecutiveDayCount(activeDayKeys),
            ...imageSummary,
            successRate: percentage(imageSummary.successImages, imageSummary.successImages + imageSummary.failedImages),
            textNodes: textNodes.length,
            textCharacters: textNodes.reduce((total, node) => total + Array.from(node.metadata?.content || "").length, 0),
            topSize: breakdown(filteredRecords.map((record) => record.size)).at(0),
        },
        textRatio: {
            manual: percentage(manualNodes + mixedNodes / 2, knownNodes),
            ai: percentage(aiNodes + mixedNodes / 2, knownNodes),
            knownNodes,
            excludedNodes: textNodes.length - knownNodes,
        },
        models: breakdown(filteredRecords.map((record) => record.model)),
        sizes: breakdown(filteredRecords.map((record) => record.size)),
        sources: breakdown(filteredRecords.map((record) => record.source)),
        operations: breakdown(filteredRecords.map((record) => record.operation)),
        textSources: breakdown(textSourceValues),
        timeSlots: breakdown(activityTimes.map(timeSlot)),
        canvasOutputs: Array.from(canvasOutputCounts.entries())
            .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
            .map(([projectId, count]) => ({ projectId, value: projectTitles.get(projectId) || projectId, count, percentage: percentage(count, canvasOutputTotal) })),
    };
}

function normalizeImageUsageRecord(log: StoredImageLog, key: string): ImageUsageRecord | null {
    if (!Number.isFinite(log.trackedAt || log.createdAt) || log.status === "running" || log.status === "pending") return null;
    const successImages = Math.max(0, numberValue(log.successCount));
    const failedImages = Math.max(0, numberValue(log.failCount));
    const configuredImages = Math.max(0, numberValue(log.imageCount));
    const requestedImages = Math.max(successImages + failedImages, configuredImages, 1);
    const hasExplicitResultCounts = log.successCount !== undefined || log.failCount !== undefined;
    const actualSuccessImages = Math.min(!hasExplicitResultCounts && log.status === "success" ? requestedImages : successImages, requestedImages);
    const source: CreativeSource = log.source === "canvas" ? "canvas" : "workbench";
    const inferredOperation: CreativeOperation = log.references?.length ? "edit" : "generate";
    const operation: CreativeOperation = operations.includes(log.operation || inferredOperation) ? log.operation || inferredOperation : inferredOperation;
    return {
        id: log.id || key,
        createdAt: log.trackedAt || log.createdAt!,
        source,
        operation,
        projectId: log.projectId,
        projectTitle: log.projectTitle,
        nodeId: log.nodeId,
        model: modelOptionName((log.model || log.config?.imageModel || log.config?.model || "").trim()),
        size: log.size || log.config?.size || "",
        requests: 1,
        requestedImages,
        successImages: actualSuccessImages,
        failedImages: Math.min(requestedImages - actualSuccessImages, Math.max(failedImages, requestedImages - actualSuccessImages)),
        canceledImages: 0,
    };
}

function breakdown(values: string[]): ImageUsageBreakdown[] {
    const counts = countValues(values);
    const total = values.length;
    return Array.from(counts.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([value, count]) => ({ value, count, percentage: percentage(count, total) }));
}

function countValues(values: string[]) {
    const counts = new Map<string, number>();
    values.forEach((value) => counts.set(value || "", (counts.get(value || "") || 0) + 1));
    return counts;
}

function timeSlot(time: number) {
    const hour = new Date(time).getHours();
    if (hour < 6) return "lateNight";
    if (hour < 12) return "morning";
    if (hour < 18) return "afternoon";
    return "evening";
}

function consecutiveDayCount(days: Set<string>) {
    if (!days.size) return 0;
    const latest = Array.from(days).map(Number).sort((left, right) => right - left)[0];
    let count = 0;
    for (let cursor = startOfDay(new Date(latest)); days.has(dayKey(cursor)); cursor.setDate(cursor.getDate() - 1)) count += 1;
    return count;
}

function percentage(value: number, total: number) {
    return total ? value / total : 0;
}

function numberValue(value: number | undefined) {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function waitForCanvasHydration() {
    if (useCanvasStore.getState().hydrated) return Promise.resolve();
    return new Promise<void>((resolve) => {
        const unsubscribe = useCanvasStore.subscribe((state) => {
            if (!state.hydrated) return;
            unsubscribe();
            resolve();
        });
    });
}

function getRangeStart(range: ImageUsageRange, now: Date) {
    if (range === "all") return null;
    const days = range === "30d" ? 29 : range === "90d" ? 89 : 364;
    const start = startOfDay(now);
    start.setDate(start.getDate() - days);
    return start;
}

function createBucket(key: string, start: Date): ImageUsageBucket {
    return { key, startAt: start.getTime(), activities: 0, requests: 0, requestedImages: 0, successImages: 0, failedImages: 0, canceledImages: 0 };
}

function bucketKey(date: Date, period: ImageUsagePeriod) {
    const year = date.getFullYear();
    if (period === "year") return String(year);
    if (period === "quarter") return `${year}-Q${Math.floor(date.getMonth() / 3) + 1}`;
    if (period === "month") return `${year}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    if (period === "week") return `W${date.getFullYear()}-${String(getWeekNumber(date)).padStart(2, "0")}`;
    return `${year}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function bucketStart(date: Date, period: ImageUsagePeriod) {
    const start = startOfDay(date);
    if (period === "year") return new Date(start.getFullYear(), 0, 1);
    if (period === "quarter") return new Date(start.getFullYear(), Math.floor(start.getMonth() / 3) * 3, 1);
    if (period === "month") return new Date(start.getFullYear(), start.getMonth(), 1);
    if (period === "week") {
        const day = start.getDay() || 7;
        start.setDate(start.getDate() - day + 1);
    }
    return start;
}

function addPeriod(date: Date, period: ImageUsagePeriod) {
    const next = new Date(date);
    if (period === "year") next.setFullYear(next.getFullYear() + 1);
    else if (period === "quarter") next.setMonth(next.getMonth() + 3);
    else if (period === "month") next.setMonth(next.getMonth() + 1);
    else if (period === "week") next.setDate(next.getDate() + 7);
    else next.setDate(next.getDate() + 1);
    return next;
}

function dayKey(date: Date) {
    return String(startOfDay(date).getTime());
}

function startOfDay(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getWeekNumber(date: Date) {
    const firstDay = new Date(date.getFullYear(), 0, 1);
    const dayOfYear = Math.floor((startOfDay(date).getTime() - firstDay.getTime()) / 86_400_000) + 1;
    return Math.ceil((dayOfYear + (firstDay.getDay() || 7) - 1) / 7);
}
