export const CREATIVE_SKILL_RUN_SCHEMA_VERSION = 1 as const;

export type CreativeSkillRunMode = "production" | "test";
export type CreativeSkillRunSource = "builtin" | "manual" | "canvas" | "package" | "unknown";
export type CreativeSkillRunPhase = "queued" | "running" | "waiting-provider" | "materializing" | "blocked" | "settled";
export type CreativeSkillRunSettlement = "success" | "partial" | "failed" | "canceled" | "interrupted";
export type CreativeSkillAttemptState = "submitting" | "waiting-provider" | "completed" | "failed" | "submission-unknown" | "canceled";

export type CreativeSkillAttempt = {
    attemptId: string;
    stepIndex: number;
    outputId: string;
    idempotencyKey: string;
    state: CreativeSkillAttemptState;
    taskId?: string;
    errorCode?: string;
    startedAt: number;
    updatedAt: number;
};

export type CreativeSkillRunOutput = {
    outputId: string;
    stepIndex: number;
    storageKey: string;
    url: string;
    mimeType: string;
    bytes: number;
    width: number;
    height: number;
    materializedNodeId?: string;
};

export type CreativeSkillRunRecord = {
    schemaVersion: typeof CREATIVE_SKILL_RUN_SCHEMA_VERSION;
    runId: string;
    revision: number;
    commandId: string;
    mode: CreativeSkillRunMode;
    skill: { skillId: string; versionId: string; definitionHash: string; nameSnapshot: string; source?: CreativeSkillRunSource };
    origin: { projectId: string; anchorNodeId: string; threadId?: string; clientMessageId?: string };
    phase: CreativeSkillRunPhase;
    settlement?: CreativeSkillRunSettlement;
    cancelRequested?: boolean;
    block?: { kind: "submission-unknown" | "missing-asset" | "materialization-failed" | "workspace-unavailable"; possibleCharge: boolean };
    plannedModelCalls: number;
    plannedFinalOutputs: number;
    planHash: string;
    attempts: CreativeSkillAttempt[];
    outputs: CreativeSkillRunOutput[];
    createdAt: number;
    updatedAt: number;
};

export type CreativeSkillRunSnapshot = {
    schemaVersion: typeof CREATIVE_SKILL_RUN_SCHEMA_VERSION;
    revision: number;
    runs: CreativeSkillRunRecord[];
    syncedRuns?: CreativeSkillRunSyncRecord[];
    commandReceipts?: CreativeSkillRunCommandReceipt[];
};

export type CreativeSkillRunCommandReceipt = {
    runId: string;
    commandHash: string;
    planFingerprint: string;
};

export type CreativeSkillRunSyncRecord = {
    runId: string;
    revision: number;
    mode: CreativeSkillRunMode;
    skillId: string;
    versionId: string;
    source: CreativeSkillRunSource;
    settlement: CreativeSkillRunSettlement;
    durationMs: number;
    modelCalls: number;
    outputCount: number;
    createdAt: number;
    updatedAt: number;
};

export type CreativeSkillRunSyncSnapshot = {
    schemaVersion: typeof CREATIVE_SKILL_RUN_SCHEMA_VERSION;
    revision: number;
    runs: CreativeSkillRunSyncRecord[];
};

export type CreativeSkillRunStorage = {
    read: () => Promise<CreativeSkillRunSnapshot | undefined>;
    write: (snapshot: CreativeSkillRunSnapshot, expectedRevision?: number) => Promise<void>;
};

export class CreativeSkillRunRevisionConflictError extends Error {
    constructor() {
        super("创作 Skill 运行记录已被更新，请重新合并");
        this.name = "CreativeSkillRunRevisionConflictError";
    }
}

type AcceptRunInput = Pick<CreativeSkillRunRecord, "commandId" | "mode" | "skill" | "origin" | "plannedModelCalls" | "plannedFinalOutputs" | "planHash"> & { runId?: string };
type RunListener = (run: CreativeSkillRunRecord) => void;

export function createCreativeSkillRunLedger({ storage, createId, now }: { storage: CreativeSkillRunStorage; createId: () => string; now: () => number }) {
    let queue = Promise.resolve();
    const listeners = new Set<RunListener>();
    const terminalRecords = new Map<string, CreativeSkillRunRecord>();
    const enqueue = <T>(operation: () => Promise<T>) => {
        const result = queue.then(async () => {
            for (let attempt = 0; attempt < 8; attempt += 1) {
                try {
                    return await operation();
                } catch (error) {
                    if (!isRunRevisionConflict(error) || attempt === 7) throw error;
                }
            }
            throw new Error("创作 Skill 运行记录并发更新次数过多");
        });
        queue = result.then(() => undefined, () => undefined);
        return result;
    };
    const read = async () => {
        return readCreativeSkillRunSnapshot(await storage.read());
    };
    const write = async (snapshot: CreativeSkillRunSnapshot, changed?: CreativeSkillRunRecord) => {
        await storage.write(snapshot, snapshot.revision - 1);
        if (changed) listeners.forEach((listener) => listener(structuredClone(changed)));
    };
    const mutate = (runId: string, update: (run: CreativeSkillRunRecord) => CreativeSkillRunRecord | undefined) => enqueue(async () => {
        const snapshot = await read();
        const current = snapshot.runs.find((run) => run.runId === runId);
        if (!current) throw new Error("创作 Skill 运行记录不存在");
        const updated = update(structuredClone(current));
        if (!updated) return structuredClone(current);
        const changed = { ...updated, revision: current.revision + 1, updatedAt: now() };
        const next = { ...snapshot, revision: snapshot.revision + 1, runs: snapshot.runs.map((run) => run.runId === runId ? changed : run) };
        await write(next, changed);
        return structuredClone(changed);
    });

    return {
        accept(input: AcceptRunInput) {
            return enqueue(async () => {
                const snapshot = await read();
                const existing = snapshot.runs.find((run) => run.commandId === input.commandId);
                if (existing) {
                    if (existing.planHash !== input.planHash) throw new Error("相同命令对应的执行计划已变化，已拒绝重复提交");
                    return structuredClone(existing);
                }
                const cached = [...terminalRecords.values()].find((run) => run.commandId === input.commandId);
                if (cached) {
                    if (cached.planHash !== input.planHash) throw new Error("相同命令对应的执行计划已变化，已拒绝重复提交");
                    return structuredClone(cached);
                }
                const commandHash = await privateFingerprint(input.commandId);
                const receipt = snapshot.commandReceipts?.find((item) => item.commandHash === commandHash);
                if (receipt) {
                    if (receipt.planFingerprint !== await privateFingerprint(input.planHash)) throw new Error("相同命令对应的执行计划已变化，已拒绝重复提交");
                    const summary = snapshot.syncedRuns?.find((run) => run.runId === receipt.runId);
                    if (!summary) throw runSnapshotError();
                    return terminalRecordFromSummary(input, summary);
                }
                const timestamp = now();
                const run: CreativeSkillRunRecord = {
                    schemaVersion: CREATIVE_SKILL_RUN_SCHEMA_VERSION,
                    revision: 1,
                    ...structuredClone(input),
                    runId: input.runId || createId(),
                    phase: "queued",
                    attempts: [],
                    outputs: [],
                    createdAt: timestamp,
                    updatedAt: timestamp,
                };
                await write({ ...snapshot, revision: snapshot.revision + 1, runs: [...snapshot.runs, run] }, run);
                return structuredClone(run);
            });
        },
        async get(runId: string) {
            return structuredClone((await read()).runs.find((run) => run.runId === runId) || terminalRecords.get(runId));
        },
        async getSummary(runId: string) {
            return structuredClone((await read()).syncedRuns?.find((run) => run.runId === runId));
        },
        async list() {
            return structuredClone((await read()).runs);
        },
        startAttempt(runId: string, input: Pick<CreativeSkillAttempt, "stepIndex" | "outputId" | "idempotencyKey">) {
            return mutate(runId, (run) => {
                const existing = run.attempts.find((attempt) => attempt.idempotencyKey === input.idempotencyKey);
                if (existing) return run;
                if (run.phase === "settled" || run.cancelRequested) throw new Error("创作 Skill 运行已结束，不能开始新的尝试");
                const timestamp = now();
                run.phase = "running";
                run.block = undefined;
                run.attempts.push({ attemptId: createId(), ...input, state: "submitting", startedAt: timestamp, updatedAt: timestamp });
                return run;
            }).then((run) => run.attempts.find((attempt) => attempt.idempotencyKey === input.idempotencyKey)!);
        },
        markRemoteAccepted(runId: string, attemptId: string, handle: { taskId: string }) {
            return mutateAttempt(runId, attemptId, (run, attempt) => {
                if (attempt.taskId && attempt.taskId !== handle.taskId) throw new Error("Provider 返回的任务 ID 与运行记录不一致");
                attempt.taskId = handle.taskId;
                if (attempt.state === "submission-unknown") return;
                if (attempt.state !== "submitting" && attempt.state !== "waiting-provider") throw new Error("创作 Skill 尝试已结束，不能写入远端任务 ID");
                attempt.state = "waiting-provider";
                run.phase = "waiting-provider";
            });
        },
        completeAttempt(runId: string, attemptId: string, output: CreativeSkillRunOutput) {
            return mutateAttempt(runId, attemptId, (run, attempt) => {
                if (attempt.state !== "canceled" && !run.cancelRequested) attempt.state = "completed";
                else attempt.state = "canceled";
                run.phase = "materializing";
                run.block = undefined;
                if (!run.outputs.some((item) => item.outputId === output.outputId)) run.outputs.push(structuredClone(output));
            });
        },
        failAttempt(runId: string, attemptId: string, errorCode = "PROVIDER_REJECTED") {
            return mutateAttempt(runId, attemptId, (run, attempt) => {
                attempt.state = "failed";
                attempt.errorCode = errorCode;
                run.phase = "running";
            });
        },
        markSubmissionUnknown(runId: string, attemptId: string, errorCode = "SUBMISSION_UNKNOWN") {
            return mutateAttempt(runId, attemptId, (run, attempt) => {
                attempt.state = "submission-unknown";
                attempt.errorCode = errorCode;
                run.phase = "blocked";
                run.block = { kind: "submission-unknown", possibleCharge: true };
            });
        },
        reopenUnknownAttempt(runId: string, attemptId: string) {
            return mutateAttempt(runId, attemptId, (run, attempt) => {
                if (attempt.state !== "submission-unknown" || !attempt.taskId) {
                    throw new Error("只有带远端任务 ID 的未知提交才能继续查询");
                }
                attempt.state = "waiting-provider";
                attempt.errorCode = undefined;
                run.phase = "waiting-provider";
                run.block = undefined;
                run.cancelRequested = false;
            });
        },
        requestCancel(runId: string) {
            return enqueue(async () => {
                const snapshot = await read();
                const current = snapshot.runs.find((run) => run.runId === runId);
                if (!current) {
                    const terminal = terminalRecords.get(runId);
                    if (terminal) return structuredClone(terminal);
                    throw new Error("创作 Skill 运行记录不存在");
                }
                if (current.cancelRequested) return structuredClone(current);
                const changed = { ...structuredClone(current), cancelRequested: true, revision: current.revision + 1, updatedAt: now() };
                await write({ ...snapshot, revision: snapshot.revision + 1, runs: snapshot.runs.map((run) => run.runId === runId ? changed : run) }, changed);
                return structuredClone(changed);
            });
        },
        cancelAttempt(runId: string, attemptId: string) {
            return mutateAttempt(runId, attemptId, (run, attempt) => {
                attempt.state = "canceled";
                run.phase = "running";
                run.block = undefined;
            });
        },
        block(runId: string, block: NonNullable<CreativeSkillRunRecord["block"]>) {
            return mutate(runId, (run) => {
                if (run.phase === "settled") return undefined;
                run.phase = "blocked";
                run.block = structuredClone(block);
                return run;
            });
        },
        markOutputMaterialized(runId: string, outputId: string, nodeId: string) {
            return mutate(runId, (run) => {
                if (run.phase === "settled") return undefined;
                const output = run.outputs.find((item) => item.outputId === outputId);
                if (!output) throw new Error("创作 Skill 输出不存在");
                if (output.materializedNodeId && output.materializedNodeId !== nodeId) throw new Error("创作 Skill 输出已物化到其他节点");
                output.materializedNodeId = nodeId;
                run.phase = "materializing";
                run.block = undefined;
                return run;
            });
        },
        settle(runId: string, settlement: CreativeSkillRunSettlement) {
            return enqueue(async () => {
                const snapshot = await read();
                const current = snapshot.runs.find((run) => run.runId === runId);
                if (!current) {
                    const terminal = terminalRecords.get(runId);
                    if (terminal) return structuredClone(terminal);
                    throw new Error("创作 Skill 运行记录不存在");
                }
                const timestamp = now();
                const changed: CreativeSkillRunRecord = {
                    ...structuredClone(current),
                    revision: current.revision + 1,
                    phase: "settled",
                    settlement: current.cancelRequested && settlement !== "interrupted" ? "canceled" : settlement,
                    block: undefined,
                    updatedAt: timestamp,
                };
                const summary = terminalRunSummary(changed);
                const receipt = {
                    runId,
                    commandHash: await privateFingerprint(changed.commandId),
                    planFingerprint: await privateFingerprint(changed.planHash),
                };
                const next = {
                    ...snapshot,
                    revision: snapshot.revision + 1,
                    runs: snapshot.runs.filter((run) => run.runId !== runId),
                    syncedRuns: [...(snapshot.syncedRuns || []).filter((run) => run.runId !== runId), summary],
                    commandReceipts: [...(snapshot.commandReceipts || []).filter((item) => item.runId !== runId && item.commandHash !== receipt.commandHash), receipt],
                };
                await write(next, changed);
                rememberTerminalRecord(terminalRecords, changed);
                return structuredClone(changed);
            });
        },
        reconcileInterrupted(protectedRunIds: ReadonlySet<string> = new Set()) {
            return enqueue(async () => {
                const snapshot = await read();
                let changed = false;
                const runs = snapshot.runs.map((source) => {
                    if (source.phase === "settled" || protectedRunIds.has(source.runId)) return source;
                    const run = structuredClone(source);
                    const unknown = run.attempts.filter((attempt) => attempt.state === "submitting" && !attempt.taskId);
                    if (!unknown.length) return source;
                    unknown.forEach((attempt) => {
                        attempt.state = "submission-unknown";
                        attempt.updatedAt = now();
                    });
                    run.phase = "blocked";
                    run.block = { kind: "submission-unknown", possibleCharge: true };
                    run.revision += 1;
                    run.updatedAt = now();
                    changed = true;
                    return run;
                });
                const next = changed ? { ...snapshot, revision: snapshot.revision + 1, runs } : snapshot;
                if (changed) await write(next);
                return structuredClone(next.runs);
            });
        },
        async recoverable() {
            return (await read()).runs.flatMap((run) => run.attempts.flatMap((attempt) => attempt.state === "waiting-provider" && attempt.taskId
                ? [{ runId: run.runId, attemptId: attempt.attemptId, taskId: attempt.taskId, stepIndex: attempt.stepIndex, outputId: attempt.outputId }]
                : []));
        },
        subscribe(listener: RunListener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };

    function mutateAttempt(runId: string, attemptId: string, update: (run: CreativeSkillRunRecord, attempt: CreativeSkillAttempt) => void) {
        return mutate(runId, (run) => {
            if (run.phase === "settled") return undefined;
            const attempt = run.attempts.find((item) => item.attemptId === attemptId);
            if (!attempt) throw new Error("创作 Skill 尝试记录不存在");
            update(run, attempt);
            attempt.updatedAt = now();
            return run;
        });
    }
}

function isRunRevisionConflict(error: unknown) {
    return error instanceof CreativeSkillRunRevisionConflictError ||
        (error instanceof Error && error.name === "CreativeSkillRunRevisionConflictError");
}

export function toCreativeSkillRunSyncSnapshot(runs: readonly CreativeSkillRunRecord[], revision = 0): CreativeSkillRunSyncSnapshot {
    return {
        schemaVersion: CREATIVE_SKILL_RUN_SCHEMA_VERSION,
        revision,
        runs: runs.flatMap((run): CreativeSkillRunSyncRecord[] => run.phase === "settled" && run.settlement
            ? [terminalRunSummary(run)]
            : []),
    };
}

export function readCreativeSkillRunSyncSnapshot(value: unknown): CreativeSkillRunSyncSnapshot {
    if (!isRecord(value) || value.schemaVersion !== CREATIVE_SKILL_RUN_SCHEMA_VERSION || !nonNegativeInteger(value.revision) || !Array.isArray(value.runs)) {
        throw new Error("创作 Skill 同步运行摘要版本未知或数据损坏");
    }
    if (Object.keys(value).some((key) => key !== "schemaVersion" && key !== "revision" && key !== "runs")) {
        throw new Error("创作 Skill 同步运行摘要包含隐私字段");
    }
    const runs = value.runs.map(readSyncRecord);
    if (new Set(runs.map((run) => run.runId)).size !== runs.length) {
        throw new Error("创作 Skill 同步运行摘要无效");
    }
    return {
        schemaVersion: CREATIVE_SKILL_RUN_SCHEMA_VERSION,
        revision: value.revision,
        runs,
    };
}

export function mergeCreativeSkillRunSyncSnapshots(local: CreativeSkillRunSyncSnapshot, remote: CreativeSkillRunSyncSnapshot, protectedLocalRunIds = new Set<string>()): CreativeSkillRunSyncSnapshot {
    const merged = new Map<string, CreativeSkillRunSyncRecord>();
    [...local.runs, ...remote.runs].forEach((run) => {
        if (protectedLocalRunIds.has(run.runId)) return;
        const current = merged.get(run.runId);
        if (!current || run.revision > current.revision || (run.revision === current.revision && run.updatedAt > current.updatedAt)) merged.set(run.runId, run);
    });
    const runs = [...merged.values()].sort((left, right) => left.createdAt - right.createdAt || left.runId.localeCompare(right.runId));
    const localMatches = sameSyncRuns(runs, local.runs);
    const remoteMatches = sameSyncRuns(runs, remote.runs);
    return {
        schemaVersion: CREATIVE_SKILL_RUN_SCHEMA_VERSION,
        revision: localMatches ? local.revision : remoteMatches ? remote.revision : Math.max(local.revision, remote.revision) + 1,
        runs,
    };
}

export function mergeCreativeSkillRunLedgerSnapshot(local: CreativeSkillRunSnapshot, remote: CreativeSkillRunSyncSnapshot): CreativeSkillRunSnapshot {
    const localSynced = readCreativeSkillRunSyncSnapshot({
        schemaVersion: CREATIVE_SKILL_RUN_SCHEMA_VERSION,
        revision: local.revision,
        runs: local.syncedRuns || [],
    });
    const merged = mergeCreativeSkillRunSyncSnapshots(localSynced, remote, new Set(local.runs.map((run) => run.runId)));
    return { ...local, revision: local.revision + 1, syncedRuns: merged.runs };
}

export async function mergeCreativeSkillRunSyncIntoStorage(
    storage: CreativeSkillRunStorage,
    remote: CreativeSkillRunSyncSnapshot,
    isRevisionConflict: (error: unknown) => boolean,
    maxAttempts = 3,
) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const local = readCreativeSkillRunSnapshot(await storage.read());
        const localIds = new Set(local.runs.map((run) => run.runId));
        const activeIds = new Set(local.runs.filter((run) => run.phase !== "settled").map((run) => run.runId));
        const historical = mergeCreativeSkillRunSyncSnapshots(
            { schemaVersion: CREATIVE_SKILL_RUN_SCHEMA_VERSION, revision: local.revision, runs: local.syncedRuns || [] },
            remote,
            localIds,
        );
        const merged = mergeCreativeSkillRunSyncSnapshots(historical, toCreativeSkillRunSyncSnapshot(local.runs, local.revision), activeIds);
        if (sameSyncRuns(historical.runs, local.syncedRuns || [])) return merged;
        try {
            await storage.write({ ...local, revision: local.revision + 1, syncedRuns: historical.runs }, local.revision);
            return merged;
        } catch (error) {
            if (!isRevisionConflict(error)) throw error;
            if (attempt === maxAttempts - 1) throw new Error("创作 Skill 运行记录持续变化，已拒绝覆盖", { cause: error });
        }
    }
    throw new Error("创作 Skill 运行记录持续变化，已拒绝覆盖");
}

export function summarizeCreativeSkillRuns(runs: readonly (CreativeSkillRunRecord | CreativeSkillRunSyncRecord)[]) {
    const terminalRuns = runs.flatMap((run) => {
        if (!run.settlement) return [];
        const local = "skill" in run;
        return [{
            mode: run.mode,
            skillId: local ? run.skill.skillId : run.skillId,
            versionId: local ? run.skill.versionId : run.versionId,
            source: local ? normalizeRunSource(run.skill.source, run.skill.skillId) : run.source,
            settlement: run.settlement,
            durationMs: local ? Math.max(0, run.updatedAt - run.createdAt) : run.durationMs,
            modelCalls: local ? run.attempts.length : run.modelCalls,
            outputCount: local ? run.outputs.filter((output) => output.materializedNodeId).length : run.outputCount,
        }];
    });
    const terminalProductionRuns = terminalRuns.filter((run) => run.mode === "production");
    const groups = new Map<string, {
        skillId: string;
        versionId: string;
        source: CreativeSkillRunSource;
        runs: number;
        productionUses: number;
        testRuns: number;
        durationMs: number;
        modelCalls: number;
        outputCount: number;
        outcomes: Record<CreativeSkillRunSettlement, number>;
    }>();
    terminalRuns.forEach((run) => {
        const key = JSON.stringify([run.skillId, run.versionId, run.source]);
        const group = groups.get(key) || {
            skillId: run.skillId,
            versionId: run.versionId,
            source: run.source,
            runs: 0,
            productionUses: 0,
            testRuns: 0,
            durationMs: 0,
            modelCalls: 0,
            outputCount: 0,
            outcomes: emptyOutcomes(),
        };
        group.runs += 1;
        group.productionUses += run.mode === "production" ? 1 : 0;
        group.testRuns += run.mode === "test" ? 1 : 0;
        group.durationMs += run.durationMs;
        group.modelCalls += run.modelCalls;
        group.outputCount += run.outputCount;
        group.outcomes[run.settlement] += 1;
        groups.set(key, group);
    });
    return {
        productionUses: terminalProductionRuns.length,
        testRuns: terminalRuns.filter((run) => run.mode === "test").length,
        modelCalls: terminalRuns.reduce((total, run) => total + run.modelCalls, 0),
        outputCount: terminalRuns.reduce((total, run) => total + run.outputCount, 0),
        averageDurationMs: terminalRuns.length ? Math.round(terminalRuns.reduce((total, run) => total + run.durationMs, 0) / terminalRuns.length) : 0,
        outcomes: countOutcomes(terminalProductionRuns),
        groups: [...groups.values()]
            .map(({ durationMs, ...group }) => ({ ...group, averageDurationMs: Math.round(durationMs / group.runs) }))
            .sort((left, right) => right.runs - left.runs || left.skillId.localeCompare(right.skillId) || left.versionId.localeCompare(right.versionId)),
    };
}

export function summarizeCreativeSkillRunSnapshot(snapshot: CreativeSkillRunSnapshot) {
    validateSnapshot(snapshot);
    const localRunIds = new Set(snapshot.runs.map((run) => run.runId));
    return summarizeCreativeSkillRuns([...snapshot.runs, ...(snapshot.syncedRuns || []).filter((run) => !localRunIds.has(run.runId))]);
}

export function readCreativeSkillRunSnapshot(value?: unknown): CreativeSkillRunSnapshot {
    if (value === undefined) return { schemaVersion: CREATIVE_SKILL_RUN_SCHEMA_VERSION, revision: 0, runs: [] };
    if (!isRecord(value)) throw new Error("创作 Skill 运行记录版本未知或数据损坏，已拒绝覆盖原记录");
    validateSnapshot(value as CreativeSkillRunSnapshot);
    return structuredClone(value as CreativeSkillRunSnapshot);
}

function validateSnapshot(snapshot: CreativeSkillRunSnapshot) {
    runKeys(snapshot, ["schemaVersion", "revision", "runs", "syncedRuns", "commandReceipts"]);
    if (snapshot.schemaVersion !== CREATIVE_SKILL_RUN_SCHEMA_VERSION || !nonNegativeInteger(snapshot.revision) || !Array.isArray(snapshot.runs)) throw runSnapshotError();
    const runs = snapshot.runs.map(readRunRecord);
    if (new Set(runs.map((run) => run.runId)).size !== runs.length) throw runSnapshotError();
    if (new Set(runs.map((run) => run.commandId)).size !== runs.length) throw runSnapshotError();
    if (runs.some((run) => run.phase === "settled")) throw new Error("创作 Skill 终态记录包含隐私字段，已拒绝覆盖原记录");
    if (snapshot.syncedRuns !== undefined) {
        readCreativeSkillRunSyncSnapshot({ schemaVersion: CREATIVE_SKILL_RUN_SCHEMA_VERSION, revision: snapshot.revision, runs: snapshot.syncedRuns });
    }
    if (snapshot.commandReceipts !== undefined) {
        if (!Array.isArray(snapshot.commandReceipts)) throw runSnapshotError();
        const receipts = snapshot.commandReceipts.map(readCommandReceipt);
        if (new Set(receipts.map((receipt) => receipt.runId)).size !== receipts.length) throw runSnapshotError();
        if (new Set(receipts.map((receipt) => receipt.commandHash)).size !== receipts.length) throw runSnapshotError();
        const summaryIds = new Set((snapshot.syncedRuns || []).map((run) => run.runId));
        if (receipts.some((receipt) => !summaryIds.has(receipt.runId))) throw runSnapshotError();
    }
}

function readCommandReceipt(value: unknown): CreativeSkillRunCommandReceipt {
    const receipt = runRecord(value);
    runKeys(receipt, ["runId", "commandHash", "planFingerprint"]);
    if (!runString(receipt.runId) || !privateHash(receipt.commandHash) || !privateHash(receipt.planFingerprint)) throw runSnapshotError();
    return value as CreativeSkillRunCommandReceipt;
}

function readRunRecord(value: unknown): CreativeSkillRunRecord {
    const run = runRecord(value);
    runKeys(run, [
        "schemaVersion", "runId", "revision", "commandId", "mode", "skill", "origin", "phase", "settlement", "cancelRequested", "block",
        "plannedModelCalls", "plannedFinalOutputs", "planHash", "attempts", "outputs", "createdAt", "updatedAt",
    ]);
    if (
        run.schemaVersion !== CREATIVE_SKILL_RUN_SCHEMA_VERSION ||
        !runString(run.runId) || !positiveInteger(run.revision) || !runString(run.commandId) ||
        (run.mode !== "production" && run.mode !== "test") || !isRunPhase(run.phase) ||
        !nonNegativeInteger(run.plannedModelCalls) || !nonNegativeInteger(run.plannedFinalOutputs) || !runString(run.planHash) ||
        !Array.isArray(run.attempts) || !Array.isArray(run.outputs) ||
        !nonNegativeInteger(run.createdAt) || !nonNegativeInteger(run.updatedAt) || run.updatedAt < run.createdAt
    ) throw runSnapshotError();
    readRunSkill(run.skill);
    readRunOrigin(run.origin);
    if (run.settlement !== undefined && !isSettlement(run.settlement)) throw runSnapshotError();
    if (run.cancelRequested !== undefined && typeof run.cancelRequested !== "boolean") throw runSnapshotError();
    if (run.block !== undefined) readRunBlock(run.block);
    if ((run.phase === "settled") !== (run.settlement !== undefined)) throw runSnapshotError();
    if ((run.phase === "blocked") !== (run.block !== undefined)) throw runSnapshotError();

    const attempts = run.attempts.map(readRunAttempt);
    const outputs = run.outputs.map(readRunOutput);
    if (new Set(attempts.map((attempt) => attempt.attemptId)).size !== attempts.length) throw runSnapshotError();
    if (new Set(attempts.map((attempt) => attempt.idempotencyKey)).size !== attempts.length) throw runSnapshotError();
    if (new Set(outputs.map((output) => output.outputId)).size !== outputs.length) throw runSnapshotError();
    return value as CreativeSkillRunRecord;
}

function readRunSkill(value: unknown) {
    const skill = runRecord(value);
    runKeys(skill, ["skillId", "versionId", "definitionHash", "nameSnapshot", "source"]);
    if (![skill.skillId, skill.versionId, skill.definitionHash, skill.nameSnapshot].every(runString)) throw runSnapshotError();
    if (skill.source !== undefined && !isRunSource(skill.source)) throw runSnapshotError();
}

function readRunOrigin(value: unknown) {
    const origin = runRecord(value);
    runKeys(origin, ["projectId", "anchorNodeId", "threadId", "clientMessageId"]);
    if (!runString(origin.projectId) || !runString(origin.anchorNodeId)) throw runSnapshotError();
    if (origin.threadId !== undefined && !runString(origin.threadId)) throw runSnapshotError();
    if (origin.clientMessageId !== undefined && !runString(origin.clientMessageId)) throw runSnapshotError();
}

function readRunBlock(value: unknown) {
    const block = runRecord(value);
    runKeys(block, ["kind", "possibleCharge"]);
    if (!isRunBlockKind(block.kind) || typeof block.possibleCharge !== "boolean") throw runSnapshotError();
}

function readRunAttempt(value: unknown): CreativeSkillAttempt {
    const attempt = runRecord(value);
    runKeys(attempt, ["attemptId", "stepIndex", "outputId", "idempotencyKey", "state", "taskId", "errorCode", "startedAt", "updatedAt"]);
    if (
        !runString(attempt.attemptId) || !nonNegativeInteger(attempt.stepIndex) || !runString(attempt.outputId) ||
        !runString(attempt.idempotencyKey) || !isAttemptState(attempt.state) ||
        (attempt.taskId !== undefined && !runString(attempt.taskId)) ||
        (attempt.errorCode !== undefined && !runString(attempt.errorCode)) ||
        !nonNegativeInteger(attempt.startedAt) || !nonNegativeInteger(attempt.updatedAt) || attempt.updatedAt < attempt.startedAt
    ) throw runSnapshotError();
    return value as CreativeSkillAttempt;
}

function readRunOutput(value: unknown): CreativeSkillRunOutput {
    const output = runRecord(value);
    runKeys(output, ["outputId", "stepIndex", "storageKey", "url", "mimeType", "bytes", "width", "height", "materializedNodeId"]);
    if (
        !runString(output.outputId) || !nonNegativeInteger(output.stepIndex) || !runString(output.storageKey) ||
        !runString(output.url) || !runString(output.mimeType) || !nonNegativeInteger(output.bytes) ||
        !nonNegativeInteger(output.width) || !nonNegativeInteger(output.height) ||
        (output.materializedNodeId !== undefined && !runString(output.materializedNodeId))
    ) throw runSnapshotError();
    return value as CreativeSkillRunOutput;
}

function readSyncRecord(value: unknown): CreativeSkillRunSyncRecord {
    if (!isRecord(value)) throw new Error("创作 Skill 同步运行摘要无效");
    const allowed = new Set(["runId", "revision", "mode", "skillId", "versionId", "source", "settlement", "durationMs", "modelCalls", "outputCount", "createdAt", "updatedAt"]);
    if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error("创作 Skill 同步运行摘要包含隐私字段");
    if (
        !safeSyncIdentifier(value.runId) || !nonNegativeInteger(value.revision) ||
        (value.mode !== "production" && value.mode !== "test") ||
        !safeSyncIdentifier(value.skillId) || !safeSyncIdentifier(value.versionId) || !isRunSource(value.source) ||
        !isSettlement(value.settlement) ||
        !nonNegativeInteger(value.durationMs) || !nonNegativeInteger(value.modelCalls) || !nonNegativeInteger(value.outputCount) ||
        !nonNegativeInteger(value.createdAt) || !nonNegativeInteger(value.updatedAt) ||
        value.updatedAt < value.createdAt || value.durationMs !== value.updatedAt - value.createdAt
    ) throw new Error("创作 Skill 同步运行摘要无效");
    return value as CreativeSkillRunSyncRecord;
}

function terminalRunSummary(run: CreativeSkillRunRecord): CreativeSkillRunSyncRecord {
    if (run.phase !== "settled" || !run.settlement) throw runSnapshotError();
    return {
        runId: run.runId,
        revision: run.revision,
        mode: run.mode,
        skillId: run.skill.skillId,
        versionId: run.skill.versionId,
        source: normalizeRunSource(run.skill.source, run.skill.skillId),
        settlement: run.settlement,
        durationMs: Math.max(0, run.updatedAt - run.createdAt),
        modelCalls: run.attempts.length,
        outputCount: run.outputs.filter((output) => output.materializedNodeId).length,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
    };
}

function terminalRecordFromSummary(input: AcceptRunInput, summary: CreativeSkillRunSyncRecord): CreativeSkillRunRecord {
    if (input.mode !== summary.mode || input.skill.skillId !== summary.skillId || input.skill.versionId !== summary.versionId) {
        throw new Error("相同命令对应的执行计划已变化，已拒绝重复提交");
    }
    return {
        schemaVersion: CREATIVE_SKILL_RUN_SCHEMA_VERSION,
        revision: summary.revision,
        commandId: input.commandId,
        mode: input.mode,
        skill: structuredClone(input.skill),
        origin: structuredClone(input.origin),
        phase: "settled",
        settlement: summary.settlement,
        plannedModelCalls: input.plannedModelCalls,
        plannedFinalOutputs: input.plannedFinalOutputs,
        planHash: input.planHash,
        attempts: [],
        outputs: [],
        runId: summary.runId,
        createdAt: summary.createdAt,
        updatedAt: summary.updatedAt,
    };
}

function rememberTerminalRecord(records: Map<string, CreativeSkillRunRecord>, run: CreativeSkillRunRecord) {
    records.delete(run.runId);
    records.set(run.runId, structuredClone(run));
    while (records.size > 128) records.delete(records.keys().next().value!);
}

async function privateFingerprint(value: string) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function privateHash(value: unknown): value is string {
    return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function emptyOutcomes(): Record<CreativeSkillRunSettlement, number> {
    return { success: 0, partial: 0, failed: 0, canceled: 0, interrupted: 0 };
}

function countOutcomes(runs: readonly { settlement: CreativeSkillRunSettlement }[]) {
    const outcomes = emptyOutcomes();
    runs.forEach((run) => { outcomes[run.settlement] += 1; });
    return outcomes;
}

function normalizeRunSource(source: CreativeSkillRunSource | undefined, skillId: string): CreativeSkillRunSource {
    if (isRunSource(source)) return source;
    return skillId === "fourj.editorial-poster-v1" ? "builtin" : "unknown";
}

function isRunSource(value: unknown): value is CreativeSkillRunSource {
    return value === "builtin" || value === "manual" || value === "canvas" || value === "package" || value === "unknown";
}

function isSettlement(value: unknown): value is CreativeSkillRunSettlement {
    return value === "success" || value === "partial" || value === "failed" || value === "canceled" || value === "interrupted";
}

function isRunPhase(value: unknown): value is CreativeSkillRunPhase {
    return value === "queued" || value === "running" || value === "waiting-provider" || value === "materializing" || value === "blocked" || value === "settled";
}

function isAttemptState(value: unknown): value is CreativeSkillAttemptState {
    return value === "submitting" || value === "waiting-provider" || value === "completed" || value === "failed" || value === "submission-unknown" || value === "canceled";
}

function isRunBlockKind(value: unknown): value is NonNullable<CreativeSkillRunRecord["block"]>["kind"] {
    return value === "submission-unknown" || value === "missing-asset" || value === "materialization-failed" || value === "workspace-unavailable";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function positiveInteger(value: unknown): value is number {
    return nonNegativeInteger(value) && value > 0;
}

function runString(value: unknown): value is string {
    return typeof value === "string" && Boolean(value.trim());
}

function runRecord(value: unknown): Record<string, unknown> {
    if (!isRecord(value)) throw runSnapshotError();
    return value;
}

function runKeys(value: object, allowed: string[]) {
    if (Object.keys(value).some((key) => !allowed.includes(key))) throw runSnapshotError();
}

function runSnapshotError() {
    return new Error("创作 Skill 运行记录版本未知或数据损坏，已拒绝覆盖原记录");
}

function safeSyncIdentifier(value: unknown): value is string {
    return typeof value === "string" && /^[A-Za-z0-9_-][A-Za-z0-9._:-]{0,199}$/.test(value);
}

function sameSyncRuns(left: readonly CreativeSkillRunSyncRecord[], right: readonly CreativeSkillRunSyncRecord[]) {
    if (left.length !== right.length) return false;
    const sortedRight = [...right].sort((first, second) => first.createdAt - second.createdAt || first.runId.localeCompare(second.runId));
    return left.every((run, index) => JSON.stringify(run) === JSON.stringify(sortedRight[index]));
}
