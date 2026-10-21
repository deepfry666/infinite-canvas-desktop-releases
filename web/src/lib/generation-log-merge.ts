export type MergeableGenerationLog = {
    id?: string;
    createdAt?: number | string;
    updatedAt?: number | string;
    trashedAt?: number | string;
    purgedAt?: number | string;
    formerOutputStorageKeys?: string[];
};

export function mergeGenerationLogsById<T extends MergeableGenerationLog>(local: T[], remote: T[]) {
    const items = new Map<string, T>();
    remote.forEach((item) => {
        if (item.id) items.set(item.id, item);
    });
    local.forEach((item) => {
        if (!item.id) return;
        const current = items.get(item.id);
        if (!current || preferredGenerationLog(item, current) === item) items.set(item.id, item);
    });
    return [...items.values()].sort((a, b) => generationLogTime(b) - generationLogTime(a));
}

export function preferredGenerationLog<T extends MergeableGenerationLog>(incoming: T, current: T): T {
    const incomingPurged = isPurgedGenerationLog(incoming);
    const currentPurged = isPurgedGenerationLog(current);
    if (incomingPurged !== currentPurged) return incomingPurged ? incoming : current;
    return generationLogTime(incoming) >= generationLogTime(current) ? incoming : current;
}

export function resolveGenerationLogWrite<T extends MergeableGenerationLog>(current: T | undefined, incoming: T): T {
    if (!current || !isPurgedGenerationLog(current)) return incoming;
    return preferredGenerationLog(incoming, current);
}

export function matchesExpectedGenerationTombstone(current: MergeableGenerationLog, expected: MergeableGenerationLog) {
    if (!isPurgedGenerationLog(current) || !isPurgedGenerationLog(expected)) return false;
    return (
        current.id === expected.id &&
        current.createdAt === expected.createdAt &&
        current.updatedAt === expected.updatedAt &&
        current.trashedAt === expected.trashedAt &&
        current.purgedAt === expected.purgedAt &&
        arrayEquals(tombstoneKeys(current), tombstoneKeys(expected))
    );
}

export function isPurgedGenerationLog(record: MergeableGenerationLog) {
    return timeValue(record.purgedAt) > 0;
}

export function assertStoredGenerationLog(key: string, value: unknown): asserts value is MergeableGenerationLog & { id: string } {
    if (!value || typeof value !== "object" || Array.isArray(value) || typeof (value as MergeableGenerationLog).id !== "string" || (value as MergeableGenerationLog).id !== key) {
        throw new Error("生成记录结构损坏，请先修复或恢复后再删除");
    }
}

export function generationLogTime(record: MergeableGenerationLog) {
    return timeValue(record.updatedAt) || timeValue(record.createdAt);
}

function timeValue(value: unknown) {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    if (typeof value === "string") return Date.parse(value) || 0;
    return 0;
}

function tombstoneKeys(record: MergeableGenerationLog) {
    return record.formerOutputStorageKeys || [];
}

function arrayEquals(left: unknown[], right: unknown[]) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}
