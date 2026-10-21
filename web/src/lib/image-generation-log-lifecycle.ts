type GenerationRecord = { id: string };
type OrderedGenerationRecord = GenerationRecord & { createdAt: number };

type GenerationLifecycleOptions<TResult, TRecord extends GenerationRecord> = {
    runningRecord: TRecord;
    tasks: () => Promise<TResult>[];
    complete: (runningRecord: TRecord, results: PromiseSettledResult<TResult>[]) => TRecord;
    persist: (record: TRecord) => Promise<void>;
};

export async function runPersistedGenerationLifecycle<TResult, TRecord extends GenerationRecord>({ runningRecord, tasks, complete, persist }: GenerationLifecycleOptions<TResult, TRecord>) {
    const persistenceErrors: unknown[] = [];
    try {
        await persist(runningRecord);
    } catch (error) {
        persistenceErrors.push(error);
    }
    const results = await Promise.allSettled(tasks());
    const completedRecord = complete(runningRecord, results);
    try {
        await persist(completedRecord);
    } catch (error) {
        persistenceErrors.push(error);
    }
    const persistenceError = persistenceErrors.length > 1 ? new AggregateError(persistenceErrors, "Failed to persist generation records") : persistenceErrors[0];
    return { results, completedRecord, persistenceError };
}

export function upsertGenerationRecord<TRecord extends OrderedGenerationRecord>(records: TRecord[], record: TRecord) {
    return [record, ...records.filter((item) => item.id !== record.id)].sort((a, b) => b.createdAt - a.createdAt);
}
