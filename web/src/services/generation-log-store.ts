import localforage from "localforage";
import {
    isPurgedGenerationLog,
    matchesExpectedGenerationTombstone,
    preferredGenerationLog,
    resolveGenerationLogWrite,
    type MergeableGenerationLog,
} from "@/lib/generation-log-merge";

export { runGenerationLogOperation } from "@/lib/generation-log-operation";

type LogValue = object;

export type GenerationLogStore<T extends LogValue> = {
    setItem: (key: string, value: T) => Promise<T>;
    rollbackPurgedItem: (key: string, value: T, expectedTombstone: T) => Promise<T>;
    removeItem: (key: string) => Promise<void>;
    clear: () => Promise<void>;
    retainVolatileItem: (key: string, value: T) => void;
    discardVolatileItem: (key: string) => void;
    volatileEntries: () => Array<[string, T]>;
    iterate: <U extends T = T, V = void>(callback: (value: U, key: string, iterationNumber: number) => V) => Promise<V | undefined>;
};

const stores = new Map<string, GenerationLogStore<LogValue>>();

export function createGenerationLogStore<T extends LogValue>(storeName: string): GenerationLogStore<T> {
    const existing = stores.get(storeName);
    if (existing) return existing as unknown as GenerationLogStore<T>;
    const legacy = localforage.createInstance({ name: "infinite-canvas", storeName });
    const workspaceStateName = `infinite-canvas:records:${storeName}`;
    const volatileItems = new Map<string, T>();
    let operationQueue = Promise.resolve();

    const enqueue = <R>(operation: () => Promise<R>) => {
        const result = operationQueue.then(operation);
        operationQueue = result.then(
            () => undefined,
            () => undefined,
        );
        return result;
    };

    const readWorkspaceRecords = async () => {
        const desktop = window.infiniteCanvasDesktop;
        if (!desktop) return null;
        const value = await desktop.readWorkspaceState(workspaceStateName);
        if (value) return JSON.parse(value) as Record<string, T>;
        const workspace = await desktop.getWorkspaceInfo();
        if (workspace.isCustom && !workspace.allowLegacyImport) return {};
        const migrated: Record<string, T> = {};
        await legacy.iterate<T, void>((item, key) => {
            migrated[key] = item;
        });
        if (Object.keys(migrated).length) await desktop.writeWorkspaceState(workspaceStateName, JSON.stringify(migrated));
        return migrated;
    };

    const readRecords = () => enqueue(async () => {
        const workspaceRecords = await readWorkspaceRecords();
        if (workspaceRecords) return workspaceRecords;
        const records: Record<string, T> = {};
        await legacy.iterate<T, void>((item, key) => {
            records[key] = item;
        });
        return records;
    });

    const updatePersistedItem = (key: string, update: (current: T | undefined) => T | undefined) =>
        enqueue(async () => {
            const desktop = window.infiniteCanvasDesktop;
            if (!desktop) {
                const current = (await legacy.getItem<T>(key)) || undefined;
                const next = update(current);
                if (next === current) return next;
                if (next === undefined) await legacy.removeItem(key);
                else await legacy.setItem(key, next);
                return next;
            }
            const records = (await readWorkspaceRecords()) || {};
            const current = records[key];
            const next = update(current);
            if (next === current) return next;
            if (next === undefined) delete records[key];
            else records[key] = next;
            await desktop.writeWorkspaceState(workspaceStateName, JSON.stringify(records));
            return next;
        });

    const settleVolatileItem = (key: string, persistedValue: T) => {
        const volatileItem = volatileItems.get(key);
        if (!volatileItem || preferredGenerationLog(persistedValue as MergeableGenerationLog, volatileItem as MergeableGenerationLog) === persistedValue) volatileItems.delete(key);
    };

    const store: GenerationLogStore<T> = {
        async setItem(key: string, value: T) {
            const persistedValue = await updatePersistedItem(key, (current) => resolveGenerationLogWrite(current as MergeableGenerationLog | undefined, value as MergeableGenerationLog) as T);
            settleVolatileItem(key, persistedValue!);
            return persistedValue!;
        },
        async rollbackPurgedItem(key, value, expectedTombstone) {
            const persistedValue = await updatePersistedItem(key, (current) => {
                if (!current) throw new Error("无法回滚不存在的生成记录");
                if (!matchesExpectedGenerationTombstone(current as MergeableGenerationLog, expectedTombstone as MergeableGenerationLog)) {
                    if (!isPurgedGenerationLog(current as MergeableGenerationLog)) return current;
                    throw new Error("生成记录墓碑已变化，拒绝覆盖");
                }
                return value;
            });
            settleVolatileItem(key, persistedValue!);
            return persistedValue!;
        },
        async removeItem(key: string) {
            await updatePersistedItem(key, () => undefined);
            volatileItems.delete(key);
        },
        async clear() {
            await enqueue(async () => {
                const desktop = window.infiniteCanvasDesktop;
                if (!desktop) await legacy.clear();
                else {
                    const records = (await readWorkspaceRecords()) || {};
                    Object.keys(records).forEach((key) => delete records[key]);
                    await desktop.writeWorkspaceState(workspaceStateName, JSON.stringify(records));
                }
            });
            volatileItems.clear();
        },
        retainVolatileItem(key, value) {
            const current = volatileItems.get(key);
            if (!current || preferredGenerationLog(value as MergeableGenerationLog, current as MergeableGenerationLog) === value) volatileItems.set(key, value);
        },
        discardVolatileItem(key) {
            volatileItems.delete(key);
        },
        volatileEntries: () => [...volatileItems.entries()],
        async iterate<U extends T = T, V = void>(callback: (value: U, key: string, iterationNumber: number) => V) {
            const records = await readRecords();
            let index = 1;
            for (const [key, value] of Object.entries(records)) {
                const result = callback(value as U, key, index++);
                if (result !== undefined) return result;
            }
            return undefined;
        },
    };
    stores.set(storeName, store as unknown as GenerationLogStore<LogValue>);
    return store;
}

export function hasVolatileGenerationLogs() {
    return [...stores.values()].some((store) => store.volatileEntries().length > 0);
}
