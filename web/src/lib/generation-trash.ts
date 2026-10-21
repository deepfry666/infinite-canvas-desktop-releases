export type GenerationRecordKind = "image" | "video";

export type GenerationRecordRef = {
    kind: GenerationRecordKind;
    id: string;
};

export type GenerationTrashRecord = {
    id: string;
    createdAt: number;
    updatedAt?: number;
    trashedAt?: number;
    purgedAt?: number;
    formerOutputStorageKeys?: string[];
    status?: string;
};

export type GenerationTrashTombstone = {
    id: string;
    createdAt: number;
    updatedAt: number;
    trashedAt: number;
    purgedAt: number;
    formerOutputStorageKeys: string[];
};

export type GenerationTrashStoredRecord<TRecord extends GenerationTrashRecord> = TRecord | GenerationTrashTombstone;

export type GenerationTrashRecordStore<TRecord extends GenerationTrashRecord> = {
    list: () => Promise<readonly GenerationTrashStoredRecord<TRecord>[]>;
    save: (record: GenerationTrashStoredRecord<TRecord>) => Promise<void>;
    rollback: (record: GenerationTrashStoredRecord<TRecord>, expected: GenerationTrashStoredRecord<TRecord>) => Promise<void>;
    outputStorageKeys: (record: TRecord) => Iterable<string | null | undefined>;
    inputStorageKeys?: (record: TRecord) => Iterable<string | null | undefined>;
    referencedStorageKeys?: (record: TRecord) => Iterable<string | null | undefined>;
};

export type GenerationTrashListItem<TImageRecord extends GenerationTrashRecord, TVideoRecord extends GenerationTrashRecord> =
    | { ref: { kind: "image"; id: string }; record: TImageRecord; deletedAt: number }
    | { ref: { kind: "video"; id: string }; record: TVideoRecord; deletedAt: number };

export type GenerationTrashMoveResult = {
    moved: GenerationRecordRef[];
    skipped: GenerationRecordRef[];
};

export type GenerationTrashRestoreResult = {
    restored: GenerationRecordRef[];
    skipped: GenerationRecordRef[];
};

export type GenerationTrashPurgeResult = {
    purged: GenerationRecordRef[];
    deletedFiles: string[];
    protectedFiles: string[];
    failedFiles: string[];
    skipped: GenerationRecordRef[];
};

export type GenerationTrashOptions<TImageRecord extends GenerationTrashRecord, TVideoRecord extends GenerationTrashRecord> = {
    image: GenerationTrashRecordStore<TImageRecord>;
    video: GenerationTrashRecordStore<TVideoRecord>;
    deleteOutputs: (storageKeys: readonly string[]) => Promise<{ deleted: readonly string[]; protected: readonly string[]; failed?: readonly string[] } | void>;
    additionalProtectedStorageKeys?: () => Iterable<string | null | undefined> | Promise<Iterable<string | null | undefined>>;
    now?: () => number;
};

export function assertGenerationProtectionStoresReady(states: readonly { hydrationError: boolean }[]) {
    if (states.some((state) => state.hydrationError)) throw new Error("本地画布或素材数据读取失败，请先修复或重新载入后再删除");
}

type ErasedRecordStore = {
    list: () => Promise<readonly GenerationTrashRecord[]>;
    save: (record: GenerationTrashRecord) => Promise<void>;
    rollback: (record: GenerationTrashRecord, expected: GenerationTrashRecord) => Promise<void>;
    outputStorageKeys: (record: GenerationTrashRecord) => Iterable<string | null | undefined>;
    inputStorageKeys: (record: GenerationTrashRecord) => Iterable<string | null | undefined>;
    referencedStorageKeys: (record: GenerationTrashRecord) => Iterable<string | null | undefined>;
};

export function createGenerationTrash<TImageRecord extends GenerationTrashRecord, TVideoRecord extends GenerationTrashRecord>(options: GenerationTrashOptions<TImageRecord, TVideoRecord>) {
    const stores: Record<GenerationRecordKind, ErasedRecordStore> = {
        image: eraseRecordStore(options.image),
        video: eraseRecordStore(options.video),
    };
    const now = options.now || Date.now;

    const readAll = async () => {
        const image = await stores.image.list();
        const video = await stores.video.list();
        return { image, video };
    };

    const listTrash = async (): Promise<GenerationTrashListItem<TImageRecord, TVideoRecord>[]> => {
        const records = await readAll();
        const items: GenerationTrashListItem<TImageRecord, TVideoRecord>[] = [];
        for (const kind of ["image", "video"] as const) {
            for (const record of records[kind]) {
                if (record.trashedAt === undefined || record.purgedAt !== undefined) continue;
                items.push({ ref: { kind, id: record.id }, record, deletedAt: record.trashedAt } as GenerationTrashListItem<TImageRecord, TVideoRecord>);
            }
        }
        return items.sort((a, b) => b.deletedAt - a.deletedAt || b.record.createdAt - a.record.createdAt);
    };

    const move = async (refs: readonly GenerationRecordRef[]): Promise<GenerationTrashMoveResult> => {
        const records = await readAll();
        const timestamp = now();
        const moved: GenerationRecordRef[] = [];
        const skipped: GenerationRecordRef[] = [];
        const updates: BatchRecordUpdate[] = [];
        for (const ref of uniqueRefs(refs)) {
            const record = records[ref.kind].find((item) => item.id === ref.id);
            if (!record || record.trashedAt !== undefined || record.purgedAt !== undefined || record.status === "running" || record.status === "pending") {
                skipped.push(ref);
                continue;
            }
            const updatedAt = nextRecordTime(record, timestamp);
            updates.push({ ref, record, next: { ...record, updatedAt, trashedAt: updatedAt } });
            moved.push(ref);
        }
        await saveBatchOrRollback(stores, updates, timestamp);
        return { moved, skipped };
    };

    const restore = async (refs: readonly GenerationRecordRef[]): Promise<GenerationTrashRestoreResult> => {
        const records = await readAll();
        const timestamp = now();
        const restored: GenerationRecordRef[] = [];
        const skipped: GenerationRecordRef[] = [];
        const updates: BatchRecordUpdate[] = [];
        for (const ref of uniqueRefs(refs)) {
            const record = records[ref.kind].find((item) => item.id === ref.id);
            if (!record || record.trashedAt === undefined || record.purgedAt !== undefined) {
                skipped.push(ref);
                continue;
            }
            const { trashedAt: _trashedAt, ...remaining } = record;
            updates.push({ ref, record, next: { ...remaining, updatedAt: nextRecordTime(record, timestamp) } });
            restored.push(ref);
        }
        await saveBatchOrRollback(stores, updates, timestamp);
        return { restored, skipped };
    };

    const purge = async (refs: readonly GenerationRecordRef[]): Promise<GenerationTrashPurgeResult> => {
        const records = await readAll();
        const timestamp = now();
        const purged: GenerationRecordRef[] = [];
        const skipped: GenerationRecordRef[] = [];
        const candidates = new Set<string>();
        const originals: Array<{ ref: GenerationRecordRef; record: GenerationTrashRecord }> = [];
        for (const ref of uniqueRefs(refs)) {
            const record = records[ref.kind].find((item) => item.id === ref.id);
            if (!record || record.trashedAt === undefined || record.purgedAt !== undefined) {
                skipped.push(ref);
                continue;
            }
            const formerOutputStorageKeys = uniqueStorageKeys(stores[ref.kind].outputStorageKeys(record));
            formerOutputStorageKeys.forEach((key) => candidates.add(key));
            originals.push({ ref, record });
            purged.push(ref);
        }

        const targetRefs = new Set(originals.map(({ ref }) => `${ref.kind}:${ref.id}`));
        const protectedStorageKeys = new Set<string>();
        try {
            originals.forEach(({ ref, record }) => {
                uniqueStorageKeys(stores[ref.kind].inputStorageKeys(record)).forEach((key) => protectedStorageKeys.add(key));
            });
            for (const kind of ["image", "video"] as const) {
                for (const record of records[kind]) {
                    if (record.purgedAt !== undefined || targetRefs.has(`${kind}:${record.id}`)) continue;
                    uniqueStorageKeys(stores[kind].referencedStorageKeys(record)).forEach((key) => protectedStorageKeys.add(key));
                }
            }
            if (options.additionalProtectedStorageKeys) uniqueStorageKeys(await options.additionalProtectedStorageKeys()).forEach((key) => protectedStorageKeys.add(key));
        } catch (error) {
            throw error;
        }

        await saveBatchOrRollback(
            stores,
            originals.map(({ ref, record }) => ({
                ref,
                record,
                next: {
                    id: record.id,
                    createdAt: record.createdAt,
                    updatedAt: nextRecordTime(record, timestamp),
                    trashedAt: record.trashedAt!,
                    purgedAt: nextRecordTime(record, timestamp),
                    formerOutputStorageKeys: uniqueStorageKeys(stores[ref.kind].outputStorageKeys(record)),
                },
            })),
            timestamp,
        );

        const protectedFiles = [...candidates].filter((key) => protectedStorageKeys.has(key));
        const requestedDeletes = [...candidates].filter((key) => !protectedStorageKeys.has(key));
        let deletedFiles = requestedDeletes;
        let failedFiles: string[] = [];
        try {
            if (requestedDeletes.length) {
                const result = await options.deleteOutputs(requestedDeletes);
                if (result) {
                    const deleted = new Set(result.deleted);
                    const additionallyProtected = new Set(result.protected);
                    const failed = new Set(result.failed || []);
                    deletedFiles = requestedDeletes.filter((key) => deleted.has(key) && !additionallyProtected.has(key) && !failed.has(key));
                    protectedFiles.push(...requestedDeletes.filter((key) => additionallyProtected.has(key)));
                    failedFiles = requestedDeletes.filter((key) => failed.has(key) || (!deleted.has(key) && !additionallyProtected.has(key)));
                }
            }
        } catch {
            deletedFiles = [];
            failedFiles = requestedDeletes;
        }
        return { purged, deletedFiles, protectedFiles, failedFiles, skipped };
    };

    return { listTrash, move, restore, purge };
}

type BatchRecordUpdate = {
    ref: GenerationRecordRef;
    record: GenerationTrashRecord;
    next: GenerationTrashRecord;
};

function eraseRecordStore<TRecord extends GenerationTrashRecord>(store: GenerationTrashRecordStore<TRecord>): ErasedRecordStore {
    return {
        list: store.list,
        save: (record) => store.save(record as GenerationTrashStoredRecord<TRecord>),
        rollback: (record, expected) => store.rollback(record as GenerationTrashStoredRecord<TRecord>, expected as GenerationTrashStoredRecord<TRecord>),
        outputStorageKeys: (record) => store.outputStorageKeys(record as TRecord),
        inputStorageKeys: (record) => store.inputStorageKeys?.(record as TRecord) || [],
        referencedStorageKeys: (record) => (store.referencedStorageKeys || store.outputStorageKeys)(record as TRecord),
    };
}

async function saveBatchOrRollback(stores: Record<GenerationRecordKind, ErasedRecordStore>, updates: BatchRecordUpdate[], timestamp: number) {
    const writes = await Promise.allSettled(updates.map(({ ref, next }) => stores[ref.kind].save(next)));
    const writeErrors = rejectedReasons(writes);
    if (!writeErrors.length) return;

    const rollbackBase = Math.max(timestamp + 1, Date.now());
    const rollbacks = await Promise.allSettled(
        updates.map(({ ref, record, next }) => stores[ref.kind].rollback({ ...record, updatedAt: Math.max(nextRecordTime(record, rollbackBase), nextRecordTime(next, rollbackBase)) }, next)),
    );
    const rollbackErrors = rejectedReasons(rollbacks);
    if (rollbackErrors.length) throw new AggregateError([...writeErrors, ...rollbackErrors], "生成记录批量写入失败，且部分记录无法回滚");
    if (writeErrors.length === 1) throw writeErrors[0];
    throw new AggregateError(writeErrors, "生成记录批量写入失败");
}

function rejectedReasons(results: PromiseSettledResult<unknown>[]) {
    return results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
}

function nextRecordTime(record: GenerationTrashRecord, timestamp: number) {
    return Math.max(timestamp, (record.updatedAt || record.createdAt || 0) + 1);
}

function uniqueRefs(refs: readonly GenerationRecordRef[]) {
    const seen = new Set<string>();
    return refs.filter((ref) => {
        const key = `${ref.kind}:${ref.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function uniqueStorageKeys(keys: Iterable<string | null | undefined>) {
    return [...new Set([...keys].filter((key): key is string => typeof key === "string" && Boolean(key)))];
}
