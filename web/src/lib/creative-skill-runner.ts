import { compileCreativeSkillRecipeV1 } from "./creative-skills/compiler.ts";
import type { CompiledCreativeSkillCallV1, CompiledCreativeSkillPlanV1, CreativeSkillParameterValue, CreativeSkillRecipeV1 } from "./creative-skills/types.ts";
import type { CanvasCreativeSkillProvenance } from "../types/canvas.ts";
import type { CreativeSkillRunMode, CreativeSkillRunOutput, CreativeSkillRunRecord, createCreativeSkillRunLedger } from "./creative-skill-run-ledger.ts";

export const CREATIVE_SKILL_RECOVERY_SCHEMA_VERSION = 1 as const;

export type CreativeSkillRunnerImage = {
    sha256?: string;
    nodeId?: string;
    storageKey?: string;
    url?: string;
    dataUrl?: string;
    mimeType?: string;
    skillAsset?:
        | { kind: "published"; skillId: string; versionId: string; sha256: string }
        | { kind: "draft"; draftId: string; draftRevision: number; sha256: string };
};

export type CreativeSkillRunnerProvider = {
    model: string;
    size?: string;
    quality?: string;
};

export type CreativeSkillRunRequest = {
    commandId: string;
    mode: CreativeSkillRunMode;
    skill: CreativeSkillRunRecord["skill"];
    origin: CreativeSkillRunRecord["origin"];
    recipe: CreativeSkillRecipeV1;
    parameters: Record<string, CreativeSkillParameterValue>;
    target?: CreativeSkillRunnerImage & { sha256: string };
    references: Array<CreativeSkillRunnerImage & { sha256: string }>;
    assets: Array<CreativeSkillRunnerImage & { sha256: string }>;
    provider: CreativeSkillRunnerProvider;
};

export type CreativeSkillRecoveryCall = {
    outputId: string;
    idempotencyKey: string;
    call: CompiledCreativeSkillCallV1;
};

export type CreativeSkillRecoveryEntry = {
    runId: string;
    commandId: string;
    planHash: string;
    mode: CreativeSkillRunMode;
    skill: CreativeSkillRunRecord["skill"];
    origin: CreativeSkillRunRecord["origin"];
    provider: CreativeSkillRunnerProvider;
    target?: CreativeSkillRunnerImage;
    references: CreativeSkillRunnerImage[];
    assets: CreativeSkillRunnerImage[];
    plan: CompiledCreativeSkillPlanV1;
    calls: CreativeSkillRecoveryCall[];
    createdAt: number;
    updatedAt: number;
};

export type CreativeSkillRecoverySnapshot = {
    schemaVersion: typeof CREATIVE_SKILL_RECOVERY_SCHEMA_VERSION;
    revision: number;
    entries: CreativeSkillRecoveryEntry[];
};

export type CreativeSkillRecoveryStorage = {
    read: () => Promise<CreativeSkillRecoverySnapshot | undefined>;
    write: (snapshot: CreativeSkillRecoverySnapshot, expectedRevision?: number) => Promise<void>;
};

export class CreativeSkillRecoveryRevisionConflictError extends Error {
    constructor() {
        super("创作 Skill 恢复记录已被更新，请重新合并");
        this.name = "CreativeSkillRecoveryRevisionConflictError";
    }
}

export type CreativeSkillProviderInput = {
    runId: string;
    outputId: string;
    call: CompiledCreativeSkillCallV1;
    provider: CreativeSkillRunnerProvider;
    references: CreativeSkillRunnerImage[];
    idempotencyKey: string;
    resumeTaskId?: string;
    onRemoteHandle: (handle: { taskId: string }) => Promise<void>;
    signal?: AbortSignal;
};

export type CreativeSkillProviderImage = string | Blob | { dataUrl?: string; url?: string; mimeType?: string };
export type CreativeSkillProviderResult = CreativeSkillProviderImage | CreativeSkillProviderImage[];
export type StoredCreativeSkillOutput = Omit<CreativeSkillRunOutput, "outputId" | "stepIndex" | "materializedNodeId">;

type CreativeSkillRunLedger = ReturnType<typeof createCreativeSkillRunLedger>;
type CreativeSkillRunnerCoordinator = {
    runQueues: Map<string, Promise<unknown>>;
    executionOperations: Map<string, Promise<CreativeSkillRunRecord>>;
    abortControllers: Map<string, AbortController>;
    commandAcceptances: Map<string, Promise<string | undefined>>;
    cancellationOperations: Map<string, Promise<CreativeSkillRunRecord>>;
    cancellationRequests: Set<string>;
    outputStorageOperations: Map<string, Promise<{ output: CreativeSkillRunOutput; run: CreativeSkillRunRecord }>>;
    materializationOperations: Map<string, Promise<boolean>>;
};
const ledgerCoordinators = new WeakMap<CreativeSkillRunLedger, CreativeSkillRunnerCoordinator>();

export type CreativeSkillRunnerDependencies = {
    ledger: CreativeSkillRunLedger;
    recoveryStorage: CreativeSkillRecoveryStorage;
    createId: () => string;
    now: () => number;
    provider: (input: CreativeSkillProviderInput) => Promise<CreativeSkillProviderResult>;
    cancelProvider?: (taskId: string, provider: CreativeSkillRunnerProvider) => Promise<"canceled" | "unknown">;
    resolveImage: (image: CreativeSkillRunnerImage) => Promise<CreativeSkillRunnerImage>;
    storeOutput: (input: { runId: string; outputId: string; call: CompiledCreativeSkillCallV1; image: CreativeSkillProviderImage }) => Promise<StoredCreativeSkillOutput>;
    findStoredOutput?: (input: { runId: string; outputId: string; call: CompiledCreativeSkillCallV1 }) => Promise<StoredCreativeSkillOutput | undefined>;
    materializeOutput: (input: {
        run: CreativeSkillRunRecord;
        output: CreativeSkillRunOutput;
        anchorNodeId: string;
        provenance: CanvasCreativeSkillProvenance;
    }) => Promise<string>;
};

type ProviderError = Error & {
    code?: string;
    submissionState?: "rejected" | "unknown";
    remoteTaskState?: "terminal-failure";
    pending?: boolean;
    taskId?: string;
};

export function createCreativeSkillRunner(dependencies: CreativeSkillRunnerDependencies) {
    const { ledger, recoveryStorage, createId, now } = dependencies;
    const coordinator = ledgerCoordinators.get(ledger) || {
        runQueues: new Map<string, Promise<unknown>>(),
        executionOperations: new Map<string, Promise<CreativeSkillRunRecord>>(),
        abortControllers: new Map<string, AbortController>(),
        commandAcceptances: new Map<string, Promise<string | undefined>>(),
        cancellationOperations: new Map<string, Promise<CreativeSkillRunRecord>>(),
        cancellationRequests: new Set<string>(),
        outputStorageOperations: new Map<string, Promise<{ output: CreativeSkillRunOutput; run: CreativeSkillRunRecord }>>(),
        materializationOperations: new Map<string, Promise<boolean>>(),
    };
    ledgerCoordinators.set(ledger, coordinator);
    const {
        runQueues,
        executionOperations,
        abortControllers,
        commandAcceptances,
        cancellationOperations,
        cancellationRequests,
        outputStorageOperations,
        materializationOperations,
    } = coordinator;
    let recoveryQueue = Promise.resolve();

    const readRecovery = async () => {
        const snapshot = await recoveryStorage.read();
        if (!snapshot) return emptyRecoverySnapshot();
        return readCreativeSkillRecoverySnapshot(snapshot);
    };

    const mutateRecovery = <T>(operation: (snapshot: CreativeSkillRecoverySnapshot) => T | Promise<T>) => {
        const result = recoveryQueue.then(async () => {
            for (let attempt = 0; attempt < 8; attempt += 1) {
                const snapshot = await readRecovery();
                try {
                    return await operation(snapshot);
                } catch (error) {
                    if (!isRecoveryRevisionConflict(error) || attempt === 7) throw error;
                }
            }
            throw new Error("创作 Skill 恢复记录并发更新次数过多");
        });
        recoveryQueue = result.then(() => undefined, () => undefined);
        return result;
    };

    const ensureRecoveryEntry = (entry: CreativeSkillRecoveryEntry) => mutateRecovery(async (snapshot) => {
        const existing = snapshot.entries.find((item) => item.runId === entry.runId || item.commandId === entry.commandId);
        if (existing) {
            if (existing.planHash !== entry.planHash || existing.commandId !== entry.commandId) {
                throw new Error("创作 Skill 恢复计划与运行账本不一致，已拒绝覆盖");
            }
            return structuredClone(existing);
        }
        const next = { ...snapshot, revision: snapshot.revision + 1, entries: [...snapshot.entries, structuredClone(entry)] };
        await recoveryStorage.write(next, snapshot.revision);
        return structuredClone(entry);
    });

    const removeRecoveryEntry = (runId: string) => mutateRecovery(async (snapshot) => {
        if (!snapshot.entries.some((entry) => entry.runId === runId)) return;
        await recoveryStorage.write({ ...snapshot, revision: snapshot.revision + 1, entries: snapshot.entries.filter((entry) => entry.runId !== runId) }, snapshot.revision);
    });

    const serializeRun = <T>(runId: string, operation: () => Promise<T>) => {
        const previous = runQueues.get(runId) || Promise.resolve();
        const result = previous.then(operation, operation);
        const settled = result.then(() => undefined, () => undefined);
        runQueues.set(runId, settled);
        void settled.finally(() => {
            if (runQueues.get(runId) === settled) {
                runQueues.delete(runId);
                if (cancellationRequests.delete(runId)) cancellationOperations.delete(runId);
            }
        });
        return result;
    };

    const executeSerialized = (runId: string, operation: () => Promise<CreativeSkillRunRecord>) => {
        const existing = executionOperations.get(runId);
        if (existing) return existing;
        const result = serializeRun(runId, operation);
        executionOperations.set(runId, result);
        void result.then(
            () => { if (executionOperations.get(runId) === result) executionOperations.delete(runId); },
            () => { if (executionOperations.get(runId) === result) executionOperations.delete(runId); },
        );
        return result;
    };

    const run = async (request: CreativeSkillRunRequest) => {
        let resolveAcceptance: (runId: string | undefined) => void = () => undefined;
        const acceptance = new Promise<string | undefined>((resolve) => { resolveAcceptance = resolve; });
        commandAcceptances.set(request.commandId, acceptance);
        try {
            const plan = compileCreativeSkillRecipeV1(request.recipe, {
                parameters: request.parameters,
                target: request.target && { sha256: request.target.sha256 },
                references: request.references.map(({ sha256 }) => ({ sha256 })),
            });
            const planHash = await hashRecoveryPlan({
                skill: request.skill,
                origin: request.origin,
                provider: request.provider,
                target: recoveryImageIdentity(request.target),
                references: request.references.map(recoveryImageIdentity),
                assets: request.assets.map(recoveryImageIdentity),
                plan,
            });
            let entry = await ensureRecoveryEntry(createRecoveryEntry(createId(), request, plan, planHash, now()));
            let accepted: CreativeSkillRunRecord;
            try {
                accepted = await ledger.accept({
                    runId: entry.runId,
                    commandId: request.commandId,
                    mode: request.mode,
                    skill: request.skill,
                    origin: request.origin,
                    plannedModelCalls: plan.providerCallCount,
                    plannedFinalOutputs: plan.finalOutputCount,
                    planHash,
                });
            } catch (error) {
                let persisted: CreativeSkillRunRecord | undefined;
                try {
                    persisted = await ledger.get(entry.runId);
                } catch {
                    throw error;
                }
                if (!persisted) await removeRecoveryEntry(entry.runId);
                throw error;
            }
            resolveAcceptance(accepted.runId);
            if (accepted.runId !== entry.runId) {
                await removeRecoveryEntry(entry.runId);
                if (accepted.phase !== "settled") {
                    entry = await ensureRecoveryEntry(createRecoveryEntry(accepted.runId, request, plan, planHash, now()));
                }
            }
            if (accepted.phase === "settled" || accepted.block?.kind === "submission-unknown") return accepted;
            return executeSerialized(accepted.runId, () => execute(entry));
        } catch (error) {
            resolveAcceptance(undefined);
            throw error;
        } finally {
            if (commandAcceptances.get(request.commandId) === acceptance) commandAcceptances.delete(request.commandId);
        }
    };

    const recover = async (filter?: { projectId?: string }) => {
        const reconciled = await ledger.reconcileInterrupted(new Set(runQueues.keys()));
        const snapshot = await readRecovery();
        const results: CreativeSkillRunRecord[] = [];
        const recoveryRunIds = new Set(snapshot.entries.map((entry) => entry.runId));
        for (const current of reconciled.filter((runRecord) =>
            (!filter?.projectId || runRecord.origin.projectId === filter.projectId) &&
            runRecord.phase === "queued" &&
            runRecord.attempts.length === 0 &&
            !recoveryRunIds.has(runRecord.runId) &&
            !commandAcceptances.has(runRecord.commandId)
        )) {
            results.push(await ledger.settle(current.runId, "interrupted"));
        }
        for (const entry of snapshot.entries.filter((item) => !filter?.projectId || item.origin.projectId === filter.projectId)) {
            const executing = executionOperations.get(entry.runId);
            if (executing) {
                results.push(await executing);
                continue;
            }
            const current = (await ledger.list()).find((runRecord) => runRecord.runId === entry.runId);
            if (!current) {
                if (await ledger.getSummary(entry.runId)) await removeRecoveryEntry(entry.runId);
                continue;
            }
            if (current.phase === "settled") {
                await removeRecoveryEntry(entry.runId);
                results.push(current);
                continue;
            }
            results.push(await executeSerialized(entry.runId, () => execute(entry)));
        }
        return results;
    };

    const resume = async (runId: string) => {
        const entry = (await readRecovery()).entries.find((item) => item.runId === runId);
        if (!entry) throw new Error("创作 Skill 恢复计划不存在");
        const current = await requireRun(ledger, runId);
        await assertRecoveryPlanIntegrity(entry, current);
        if (current.block?.kind === "submission-unknown") {
            const unknown = [...current.attempts].reverse().find((attempt) => attempt.state === "submission-unknown");
            if (!unknown?.taskId) throw new Error("提交结果未知且没有远端任务 ID，不能安全重试");
            await ledger.reopenUnknownAttempt(runId, unknown.attemptId);
        }
        return executeSerialized(runId, () => execute(entry));
    };

    const cancel = (runId: string) => {
        const existing = cancellationOperations.get(runId);
        if (existing) return existing;
        cancellationRequests.add(runId);
        let commandId: string | undefined;
        const operation = (async () => {
            const current = await ledger.requestCancel(runId);
            commandId = current.commandId;
            if (current.phase === "settled") return current;
            if (current.block?.kind === "submission-unknown") {
                const unknown = [...current.attempts].reverse().find((attempt) => attempt.state === "submission-unknown" && attempt.taskId);
                const entry = unknown && (await readRecovery()).entries.find((item) => item.runId === runId);
                if (!unknown?.taskId || !entry) return current;
                let canceled: "canceled" | "unknown" = "unknown";
                try {
                    canceled = await dependencies.cancelProvider?.(unknown.taskId, entry.provider) || "unknown";
                } catch {
                    canceled = "unknown";
                }
                if (canceled !== "canceled") return current;
                await ledger.cancelAttempt(runId, unknown.attemptId);
                const settled = await ledger.settle(runId, "canceled");
                await removeRecoveryEntry(runId);
                return settled;
            }
            abortControllers.get(runId)?.abort();
            const activeAttempt = [...current.attempts].reverse().find((attempt) => attempt.state === "submitting" || attempt.state === "waiting-provider");
            if (activeAttempt && outputStorageOperations.has(runId)) {
                await ledger.cancelAttempt(runId, activeAttempt.attemptId);
            } else if (activeAttempt?.taskId) {
                const entry = (await readRecovery()).entries.find((item) => item.runId === runId);
                let canceled: "canceled" | "unknown" = "unknown";
                try {
                    if (entry) canceled = await dependencies.cancelProvider?.(activeAttempt.taskId, entry.provider) || "unknown";
                } catch {
                    canceled = "unknown";
                }
                if (canceled !== "canceled") return ledger.markSubmissionUnknown(runId, activeAttempt.attemptId, "CANCEL_STATUS_UNKNOWN");
                await ledger.cancelAttempt(runId, activeAttempt.attemptId);
            } else if (activeAttempt) {
                return ledger.markSubmissionUnknown(runId, activeAttempt.attemptId, "CANCEL_DURING_SUBMISSION");
            }
            try {
                await outputStorageOperations.get(runId);
            } catch {
                return ledger.block(runId, { kind: "workspace-unavailable", possibleCharge: true });
            }
            await materializationOperations.get(runId);
            const latest = await requireRun(ledger, runId);
            if (latest.phase === "settled") return latest;
            const settled = await ledger.settle(runId, "canceled");
            await removeRecoveryEntry(runId);
            return settled;
        })();
        cancellationOperations.set(runId, operation);
        void operation.then(
            (result) => {
                const release =
                    cancellationOperations.get(runId) === operation &&
                    (result.settlement !== "canceled" || (!runQueues.has(runId) && (!commandId || !commandAcceptances.has(commandId))));
                if (release) {
                    cancellationOperations.delete(runId);
                    cancellationRequests.delete(runId);
                } else if (result.settlement !== "canceled") cancellationRequests.delete(runId);
            },
            () => {
                if (cancellationOperations.get(runId) === operation) cancellationOperations.delete(runId);
                cancellationRequests.delete(runId);
            },
        );
        return operation;
    };

    const cancelCommand = async (commandId: string) => {
        const current = (await ledger.list()).find((runRecord) => runRecord.commandId === commandId);
        const runId = current?.runId || await commandAcceptances.get(commandId);
        return runId ? cancel(runId) : undefined;
    };

    const dismiss = (runId: string) => serializeRun(runId, async () => {
        const current = await requireRun(ledger, runId);
        if (current.phase === "settled") return current;
        const unknown = [...current.attempts].reverse().find((attempt) => attempt.state === "submission-unknown");
        if (unknown) await ledger.cancelAttempt(runId, unknown.attemptId);
        const settled = await ledger.settle(runId, "interrupted");
        await removeRecoveryEntry(runId);
        return settled;
    });

    const execute = async (entry: CreativeSkillRecoveryEntry): Promise<CreativeSkillRunRecord> => {
        let current = await ledger.get(entry.runId);
        if (!current) {
            const canceled = cancellationOperations.get(entry.runId);
            if (canceled) return canceled;
            throw new Error("创作 Skill 运行记录不存在");
        }
        await assertRecoveryPlanIntegrity(entry, current);
        if (current.phase === "settled") {
            await removeRecoveryEntry(entry.runId);
            return current;
        }
        if (current.cancelRequested) return cancel(entry.runId);
        for (const planned of entry.calls) {
            current = await requireRun(ledger, entry.runId);
            let attempt = current.attempts.find((item) => item.outputId === planned.outputId);
            let stored = current.outputs.find((output) => output.outputId === planned.outputId);
            if (!stored && attempt && dependencies.findStoredOutput) {
                try {
                    const staged = await dependencies.findStoredOutput({ runId: entry.runId, outputId: planned.outputId, call: planned.call });
                    if (staged) {
                        const stagedOutput = { outputId: planned.outputId, stepIndex: planned.call.stepIndex, ...staged };
                        current = await ledger.completeAttempt(entry.runId, attempt.attemptId, stagedOutput);
                        stored = current.outputs.find((output) => output.outputId === planned.outputId);
                        attempt = current.attempts.find((item) => item.outputId === planned.outputId);
                    }
                } catch {
                    return ledger.block(entry.runId, { kind: "workspace-unavailable", possibleCharge: true });
                }
            }
            if (stored) {
                if (attempt?.state === "canceled" || current.cancelRequested) break;
                if (planned.call.terminal && !stored.materializedNodeId && !(await materialize(entry, current, stored))) {
                    return cancellationOperations.get(entry.runId) || requireRun(ledger, entry.runId);
                }
                continue;
            }

            if (attempt?.state === "submission-unknown") return current;
            if (attempt?.state === "submitting" && !attempt.taskId) return ledger.markSubmissionUnknown(entry.runId, attempt.attemptId);
            if (attempt?.state === "completed") return ledger.block(entry.runId, { kind: "workspace-unavailable", possibleCharge: true });
            if (attempt?.state === "canceled") break;
            if (attempt?.state === "failed") {
                if (!planned.call.terminal) break;
                continue;
            }

            let references: CreativeSkillRunnerImage[];
            try {
                references = await resolveCallImages(entry, planned.call, current.outputs, dependencies.resolveImage);
            } catch {
                return ledger.block(entry.runId, { kind: "missing-asset", possibleCharge: false });
            }

            const beforeAttempt = await requireRun(ledger, entry.runId);
            if (beforeAttempt.phase === "settled" || beforeAttempt.phase === "blocked" || beforeAttempt.cancelRequested || cancellationRequests.has(entry.runId)) {
                return cancellationOperations.get(entry.runId) || beforeAttempt;
            }

            if (!attempt) {
                try {
                    attempt = await ledger.startAttempt(entry.runId, {
                        stepIndex: planned.call.stepIndex,
                        outputId: planned.outputId,
                        idempotencyKey: planned.idempotencyKey,
                    });
                } catch (error) {
                    const latest = await requireRun(ledger, entry.runId);
                    if (latest.phase === "settled" || cancellationRequests.has(entry.runId)) {
                        return cancellationOperations.get(entry.runId) || latest;
                    }
                    throw error;
                }
            }
            if (cancellationRequests.has(entry.runId)) {
                return cancellationOperations.get(entry.runId) || requireRun(ledger, entry.runId);
            }
            const controller = new AbortController();
            abortControllers.set(entry.runId, controller);
            try {
                const beforeProvider = await requireRun(ledger, entry.runId);
                if (beforeProvider.phase === "settled" || beforeProvider.phase === "blocked" || beforeProvider.cancelRequested) return cancellationOperations.get(entry.runId) || beforeProvider;
                const result = await dependencies.provider({
                    runId: entry.runId,
                    outputId: planned.outputId,
                    call: planned.call,
                    provider: entry.provider,
                    references,
                    idempotencyKey: planned.idempotencyKey,
                    resumeTaskId: attempt.taskId,
                    onRemoteHandle: async (handle) => {
                        const latest = await requireRun(ledger, entry.runId);
                        const latestAttempt = latest.attempts.find((item) => item.attemptId === attempt!.attemptId);
                        if (latestAttempt?.taskId && latestAttempt.taskId !== handle.taskId) throw new Error("Provider 返回的任务 ID 与恢复记录不一致");
                        if (!latestAttempt?.taskId) await ledger.markRemoteAccepted(entry.runId, attempt!.attemptId, handle);
                    },
                    signal: controller.signal,
                });
                if (controller.signal.aborted) return cancellationOperations.get(entry.runId) || requireRun(ledger, entry.runId);
                const beforeStore = await requireRun(ledger, entry.runId);
                const beforeStoreAttempt = beforeStore.attempts.find((item) => item.attemptId === attempt!.attemptId);
                if (beforeStore.phase === "settled" || beforeStore.phase === "blocked" || beforeStore.cancelRequested || !beforeStoreAttempt || beforeStoreAttempt.state === "canceled") return cancellationOperations.get(entry.runId) || beforeStore;
                const image = oneProviderImage(result);
                let output: CreativeSkillRunOutput;
                try {
                    const storageOperation = (async () => {
                        const storedOutput: CreativeSkillRunOutput = {
                            outputId: planned.outputId,
                            stepIndex: planned.call.stepIndex,
                            ...await dependencies.storeOutput({ runId: entry.runId, outputId: planned.outputId, call: planned.call, image }),
                        };
                        return { output: storedOutput, run: await ledger.completeAttempt(entry.runId, attempt!.attemptId, storedOutput) };
                    })();
                    outputStorageOperations.set(entry.runId, storageOperation);
                    const stored = await storageOperation;
                    output = stored.output;
                    current = stored.run;
                } catch {
                    return ledger.block(entry.runId, { kind: "workspace-unavailable", possibleCharge: true });
                } finally {
                    outputStorageOperations.delete(entry.runId);
                }
                if (controller.signal.aborted || cancellationRequests.has(entry.runId)) {
                    return cancellationOperations.get(entry.runId) || requireRun(ledger, entry.runId);
                }
                if (current.phase === "settled") return current;
                if (planned.call.terminal && !(await materialize(entry, current, output))) {
                    return cancellationOperations.get(entry.runId) || requireRun(ledger, entry.runId);
                }
            } catch (error) {
                const latest = await requireRun(ledger, entry.runId);
                if (controller.signal.aborted) return cancellationOperations.get(entry.runId) || latest;
                const latestAttempt = latest.attempts.find((item) => item.attemptId === attempt!.attemptId);
                const providerError = toProviderError(error);
                if (latestAttempt?.taskId && isPendingProviderError(providerError)) return latest;
                if (latestAttempt?.taskId && providerError.remoteTaskState !== "terminal-failure") {
                    return ledger.markSubmissionUnknown(entry.runId, attempt.attemptId, providerError.code || "REMOTE_TASK_STATUS_UNKNOWN");
                }
                if (!latestAttempt?.taskId && providerError.submissionState !== "rejected") {
                    return ledger.markSubmissionUnknown(entry.runId, attempt.attemptId, providerError.code || "SUBMISSION_UNKNOWN");
                }
                await ledger.failAttempt(entry.runId, attempt.attemptId, providerError.code || "PROVIDER_REJECTED");
                if (!planned.call.terminal) break;
            } finally {
                if (abortControllers.get(entry.runId) === controller) abortControllers.delete(entry.runId);
            }
        }

        current = await requireRun(ledger, entry.runId);
        if (current.phase === "settled") return current;
        if (current.phase === "blocked") return current;
        if (current.cancelRequested || cancellationRequests.has(entry.runId)) {
            return cancellationOperations.get(entry.runId) || cancel(entry.runId);
        }
        const terminalOutputIds = new Set(entry.calls.filter((item) => item.call.terminal).map((item) => item.outputId));
        const materialized = current.outputs.filter((output) => terminalOutputIds.has(output.outputId) && output.materializedNodeId).length;
        const canceled = current.cancelRequested || current.attempts.some((attempt) => attempt.state === "canceled");
        const settlement = canceled
            ? "canceled"
            : materialized === entry.plan.finalOutputCount
                ? "success"
                : materialized > 0
                    ? "partial"
                    : "failed";
        const settled = await ledger.settle(entry.runId, settlement);
        await removeRecoveryEntry(entry.runId);
        return settled;
    };

    const materialize = (entry: CreativeSkillRecoveryEntry, runRecord: CreativeSkillRunRecord, output: CreativeSkillRunOutput) => {
        const operation = (async () => {
            const beforeMaterialization = await requireRun(ledger, entry.runId);
            if (beforeMaterialization.phase === "settled" || beforeMaterialization.cancelRequested || cancellationRequests.has(entry.runId)) return false;
            try {
                const nodeId = await dependencies.materializeOutput({
                    run: runRecord,
                    output,
                    anchorNodeId: entry.origin.anchorNodeId,
                    provenance: {
                        skillId: entry.skill.skillId,
                        skillRevision: entry.skill.versionId,
                        runId: entry.runId,
                        stepIndex: output.stepIndex,
                        outputId: output.outputId,
                        sourceNodeIds: sourceNodeIds(entry),
                        createdAt: new Date(now()).toISOString(),
                    },
                });
                const latest = await requireRun(ledger, entry.runId);
                if (latest.phase === "settled") return false;
                const marked = await ledger.markOutputMaterialized(entry.runId, output.outputId, nodeId);
                return marked.phase !== "settled" && !cancellationRequests.has(entry.runId);
            } catch {
                await ledger.block(entry.runId, { kind: "materialization-failed", possibleCharge: false });
                return false;
            }
        })();
        materializationOperations.set(entry.runId, operation);
        void operation.then(
            () => { if (materializationOperations.get(entry.runId) === operation) materializationOperations.delete(entry.runId); },
            () => { if (materializationOperations.get(entry.runId) === operation) materializationOperations.delete(entry.runId); },
        );
        return operation;
    };

    return { run, recover, resume, cancel, cancelCommand, dismiss, readRecovery };
}

function createRecoveryEntry(runId: string, request: CreativeSkillRunRequest, plan: CompiledCreativeSkillPlanV1, planHash: string, timestamp: number): CreativeSkillRecoveryEntry {
    return {
        runId,
        commandId: request.commandId,
        planHash,
        mode: request.mode,
        skill: structuredClone(request.skill),
        origin: structuredClone(request.origin),
        provider: structuredClone(request.provider),
        target: request.target && withoutInlineData(request.target),
        references: request.references.map(withoutInlineData),
        assets: request.assets.map(withoutInlineData),
        plan: structuredClone(plan),
        calls: plan.calls.map((call) => ({
            call: structuredClone(call),
            outputId: `${runId}:step-${call.stepIndex}:output-${call.outputIndex}`,
            idempotencyKey: `${planHash}:${call.stepIndex}:${call.outputIndex}`,
        })),
        createdAt: timestamp,
        updatedAt: timestamp,
    };
}

async function resolveCallImages(
    entry: CreativeSkillRecoveryEntry,
    call: CompiledCreativeSkillCallV1,
    outputs: CreativeSkillRunOutput[],
    resolveImage: CreativeSkillRunnerDependencies["resolveImage"],
) {
    const images = call.images.map((image): CreativeSkillRunnerImage => {
        if (image.type === "input-target") return requireImage(entry.target, image.sha256);
        if (image.type === "input-reference") return requireImage(entry.references[image.index], image.sha256);
        if (image.type === "asset") return requireImage(entry.assets.find((asset) => asset.sha256 === image.sha256), image.sha256);
        const outputId = `${entry.runId}:step-${image.stepIndex}:output-${image.outputIndex}`;
        const output = outputs.find((item) => item.outputId === outputId);
        if (!output) throw new Error("创作 Skill 上一步输出不存在");
        return { storageKey: output.storageKey, url: output.url, mimeType: output.mimeType };
    });
    return Promise.all(images.map(async (image) => {
        const resolved = await resolveImage(image);
        if (!resolved.dataUrl && !resolved.url && !resolved.storageKey) throw new Error("创作 Skill 图片资产不可用");
        return resolved;
    }));
}

function requireImage(image: CreativeSkillRunnerImage | undefined, sha256: string) {
    if (!image || image.sha256 !== sha256) throw new Error("创作 Skill 图片资产缺失或哈希不匹配");
    return image;
}

function oneProviderImage(result: CreativeSkillProviderResult) {
    const images = Array.isArray(result) ? result : [result];
    if (images.length !== 1) throw Object.assign(new Error("Creative Skill 的每次 Provider 调用必须只返回一张图片"), { submissionState: "rejected" as const, remoteTaskState: "terminal-failure" as const, code: "INVALID_OUTPUT_COUNT" });
    const image = images[0];
    if (typeof image === "string" || isBlob(image)) return image;
    if (image && (image.dataUrl || image.url)) return image;
    throw Object.assign(new Error("Provider 没有返回可保存的图片"), { submissionState: "rejected" as const, remoteTaskState: "terminal-failure" as const, code: "MISSING_OUTPUT" });
}

function isBlob(value: unknown): value is Blob {
    return typeof Blob !== "undefined" && value instanceof Blob;
}

function sourceNodeIds(entry: CreativeSkillRecoveryEntry) {
    return [...new Set([entry.target?.nodeId, ...entry.references.map((image) => image.nodeId)].filter((id): id is string => Boolean(id)))];
}

function withoutInlineData(image: CreativeSkillRunnerImage) {
    const { dataUrl: _dataUrl, ...rest } = image;
    return rest;
}

function recoveryImageIdentity(image?: CreativeSkillRunnerImage) {
    if (!image) return undefined;
    return { sha256: image.sha256, nodeId: image.nodeId, storageKey: image.storageKey, url: image.url, mimeType: image.mimeType, skillAsset: image.skillAsset };
}

async function hashRecoveryPlan(value: unknown) {
    const bytes = new TextEncoder().encode(stableStringify(value));
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function assertRecoveryPlanIntegrity(entry: CreativeSkillRecoveryEntry, current: CreativeSkillRunRecord) {
    await assertRecoveryEntryIntegrity(entry);
    if (
        current.planHash !== entry.planHash ||
        current.commandId !== entry.commandId ||
        current.mode !== entry.mode ||
        current.plannedModelCalls !== entry.plan.providerCallCount ||
        current.plannedFinalOutputs !== entry.plan.finalOutputCount
    ) throw new Error("创作 Skill 恢复计划完整性校验失败，已拒绝执行");
}

async function assertRecoveryEntryIntegrity(entry: CreativeSkillRecoveryEntry) {
    const planHash = await hashRecoveryPlan({
        skill: entry.skill,
        origin: entry.origin,
        provider: entry.provider,
        target: recoveryImageIdentity(entry.target),
        references: entry.references.map(recoveryImageIdentity),
        assets: entry.assets.map(recoveryImageIdentity),
        plan: entry.plan,
    });
    const callsMatch = entry.calls.length === entry.plan.calls.length && entry.calls.every((stored, index) => {
        const call = entry.plan.calls[index];
        return stableStringify(stored.call) === stableStringify(call) &&
            stored.outputId === `${entry.runId}:step-${call.stepIndex}:output-${call.outputIndex}` &&
            stored.idempotencyKey === `${entry.planHash}:${call.stepIndex}:${call.outputIndex}`;
    });
    if (
        planHash !== entry.planHash ||
        !callsMatch
    ) throw new Error("创作 Skill 恢复计划完整性校验失败，数据损坏，已拒绝覆盖");
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.entries(value)
            .filter(([, item]) => item !== undefined)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
            .join(",")}}`;
    }
    return JSON.stringify(value);
}

function emptyRecoverySnapshot(): CreativeSkillRecoverySnapshot {
    return { schemaVersion: CREATIVE_SKILL_RECOVERY_SCHEMA_VERSION, revision: 0, entries: [] };
}

export async function readCreativeSkillRecoverySnapshot(value: unknown): Promise<CreativeSkillRecoverySnapshot> {
    const snapshot = recoveryRecord(value);
    recoveryKeys(snapshot, ["schemaVersion", "revision", "entries"]);
    if (
        snapshot.schemaVersion !== CREATIVE_SKILL_RECOVERY_SCHEMA_VERSION ||
        !recoveryInteger(snapshot.revision) ||
        !Array.isArray(snapshot.entries)
    ) throw recoverySnapshotError();
    const entries = snapshot.entries.map(readRecoveryEntry);
    if (new Set(entries.map((entry) => entry.runId)).size !== entries.length) throw recoverySnapshotError();
    if (new Set(entries.map((entry) => entry.commandId)).size !== entries.length) throw recoverySnapshotError();
    await Promise.all(entries.map(assertRecoveryEntryIntegrity));
    return value as CreativeSkillRecoverySnapshot;
}

function readRecoveryEntry(value: unknown): CreativeSkillRecoveryEntry {
    const entry = recoveryRecord(value);
    recoveryKeys(entry, ["runId", "commandId", "planHash", "mode", "skill", "origin", "provider", "target", "references", "assets", "plan", "calls", "createdAt", "updatedAt"]);
    recoveryString(entry.runId);
    recoveryString(entry.commandId);
    if (typeof entry.planHash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(entry.planHash)) throw recoverySnapshotError();
    if (entry.mode !== "production" && entry.mode !== "test") throw recoverySnapshotError();
    readRecoverySkill(entry.skill);
    readRecoveryOrigin(entry.origin);
    readRecoveryProvider(entry.provider);
    if (entry.target !== undefined) readRecoveryImage(entry.target);
    if (!Array.isArray(entry.references) || !Array.isArray(entry.assets)) throw recoverySnapshotError();
    entry.references.forEach(readRecoveryImage);
    entry.assets.forEach(readRecoveryImage);
    const plan = readRecoveryPlan(entry.plan);
    if (!Array.isArray(entry.calls) || entry.calls.length !== plan.calls.length) throw recoverySnapshotError();
    entry.calls.forEach((value) => {
        const stored = recoveryRecord(value);
        recoveryKeys(stored, ["outputId", "idempotencyKey", "call"]);
        recoveryString(stored.outputId);
        recoveryString(stored.idempotencyKey);
        readCompiledCall(stored.call);
    });
    if (!recoveryInteger(entry.createdAt) || !recoveryInteger(entry.updatedAt) || entry.updatedAt < entry.createdAt) throw recoverySnapshotError();
    return value as CreativeSkillRecoveryEntry;
}

function readRecoverySkill(value: unknown) {
    const skill = recoveryRecord(value);
    recoveryKeys(skill, ["skillId", "versionId", "definitionHash", "nameSnapshot", "source"]);
    [skill.skillId, skill.versionId, skill.definitionHash, skill.nameSnapshot].forEach(recoveryString);
    if (skill.source !== undefined && !["builtin", "manual", "canvas", "package", "unknown"].includes(String(skill.source))) throw recoverySnapshotError();
}

function readRecoveryOrigin(value: unknown) {
    const origin = recoveryRecord(value);
    recoveryKeys(origin, ["projectId", "anchorNodeId", "threadId", "clientMessageId"]);
    [origin.projectId, origin.anchorNodeId].forEach(recoveryString);
    [origin.threadId, origin.clientMessageId].forEach((item) => { if (item !== undefined) recoveryString(item); });
}

function readRecoveryProvider(value: unknown) {
    const provider = recoveryRecord(value);
    recoveryKeys(provider, ["model", "size", "quality"]);
    recoveryString(provider.model);
    [provider.size, provider.quality].forEach((item) => { if (item !== undefined) recoveryString(item); });
}

function readRecoveryImage(value: unknown) {
    const image = recoveryRecord(value);
    recoveryKeys(image, ["sha256", "nodeId", "storageKey", "url", "mimeType", "skillAsset"]);
    if (typeof image.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(image.sha256)) throw recoverySnapshotError();
    [image.nodeId, image.storageKey, image.url, image.mimeType].forEach((item) => { if (item !== undefined) recoveryString(item); });
    if (image.skillAsset === undefined) return;
    const asset = recoveryRecord(image.skillAsset);
    if (asset.kind === "published") {
        recoveryKeys(asset, ["kind", "skillId", "versionId", "sha256"]);
        [asset.skillId, asset.versionId].forEach(recoveryString);
    } else if (asset.kind === "draft") {
        recoveryKeys(asset, ["kind", "draftId", "draftRevision", "sha256"]);
        recoveryString(asset.draftId);
        if (!recoveryInteger(asset.draftRevision)) throw recoverySnapshotError();
    } else throw recoverySnapshotError();
    if (typeof asset.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw recoverySnapshotError();
}

function readRecoveryPlan(value: unknown): CompiledCreativeSkillPlanV1 {
    const plan = recoveryRecord(value);
    recoveryKeys(plan, ["schemaVersion", "parameterValues", "finalOutputCount", "providerCallCount", "calls"]);
    const parameterValues = recoveryRecord(plan.parameterValues);
    if (Object.values(parameterValues).some((item) => typeof item !== "string" && !recoverySafeInteger(item))) throw recoverySnapshotError();
    if (
        plan.schemaVersion !== 1 || !recoveryInteger(plan.finalOutputCount) || plan.finalOutputCount < 1 || plan.finalOutputCount > 4 ||
        !recoveryInteger(plan.providerCallCount) || plan.providerCallCount < 1 || !Array.isArray(plan.calls) || plan.calls.length !== plan.providerCallCount
    ) throw recoverySnapshotError();
    plan.calls.forEach(readCompiledCall);
    return value as CompiledCreativeSkillPlanV1;
}

function readCompiledCall(value: unknown) {
    const call = recoveryRecord(value);
    recoveryKeys(call, ["stepIndex", "outputIndex", "task", "prompt", "images", "options", "terminal"]);
    if (!recoveryInteger(call.stepIndex) || !recoveryInteger(call.outputIndex)) throw recoverySnapshotError();
    if (call.task !== "image.generate" && call.task !== "image.edit") throw recoverySnapshotError();
    if (typeof call.prompt !== "string" || !Array.isArray(call.images) || typeof call.terminal !== "boolean") throw recoverySnapshotError();
    call.images.forEach(readCompiledImage);
    const options = recoveryRecord(call.options);
    recoveryKeys(options, ["count"]);
    if (options.count !== 1) throw recoverySnapshotError();
}

function readCompiledImage(value: unknown) {
    const image = recoveryRecord(value);
    if (image.type === "input-target" || image.type === "asset") recoveryKeys(image, ["type", "sha256"]);
    else if (image.type === "input-reference") {
        recoveryKeys(image, ["type", "index", "sha256"]);
        if (!recoveryInteger(image.index)) throw recoverySnapshotError();
    } else if (image.type === "step-output") {
        recoveryKeys(image, ["type", "stepIndex", "outputIndex"]);
        if (!recoveryInteger(image.stepIndex) || !recoveryInteger(image.outputIndex)) throw recoverySnapshotError();
        return;
    } else throw recoverySnapshotError();
    if (typeof image.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(image.sha256)) throw recoverySnapshotError();
}

function recoveryRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw recoverySnapshotError();
    return value as Record<string, unknown>;
}

function recoveryKeys(value: Record<string, unknown>, allowed: string[]) {
    if (Object.keys(value).some((key) => !allowed.includes(key))) throw recoverySnapshotError();
}

function recoveryString(value: unknown) {
    if (typeof value !== "string" || !value.trim()) throw recoverySnapshotError();
}

function recoveryInteger(value: unknown): value is number {
    return recoverySafeInteger(value) && value >= 0;
}

function recoverySafeInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value);
}

function recoverySnapshotError() {
    return new Error("创作 Skill 恢复计划版本未知或数据损坏，已拒绝覆盖");
}

async function requireRun(ledger: CreativeSkillRunLedger, runId: string) {
    const run = await ledger.get(runId);
    if (!run) throw new Error("创作 Skill 运行记录不存在");
    return run;
}

function toProviderError(error: unknown): ProviderError {
    if (error instanceof Error) return error as ProviderError;
    return Object.assign(new Error(String(error)), { submissionState: "unknown" as const });
}

function isPendingProviderError(error: ProviderError) {
    return error.pending === true || error.name === "ProviderTaskPendingError" || Boolean(error.taskId && /pending|processing|处理中|稍后继续/.test(error.message));
}

function isRecoveryRevisionConflict(error: unknown) {
    return error instanceof CreativeSkillRecoveryRevisionConflictError ||
        (error instanceof Error && error.name === "CreativeSkillRecoveryRevisionConflictError");
}
