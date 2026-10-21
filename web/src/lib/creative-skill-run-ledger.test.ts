import assert from "node:assert/strict";
import test from "node:test";

import {
    createCreativeSkillRunLedger,
    mergeCreativeSkillRunSyncIntoStorage,
    mergeCreativeSkillRunSyncSnapshots,
    readCreativeSkillRunSnapshot,
    readCreativeSkillRunSyncSnapshot,
    summarizeCreativeSkillRunSnapshot,
    summarizeCreativeSkillRuns,
    toCreativeSkillRunSyncSnapshot,
    type CreativeSkillRunSnapshot,
} from "./creative-skill-run-ledger.ts";

function memoryStorage(initial?: CreativeSkillRunSnapshot) {
    let value = initial;
    return {
        read: async () => value,
        write: async (next: CreativeSkillRunSnapshot) => {
            value = structuredClone(next);
        },
        snapshot: () => value,
    };
}

function runInput(commandId = "command-1") {
    return {
        commandId,
        mode: "production" as const,
        skill: { skillId: "warm-film", versionId: "v1", definitionHash: "hash-1", nameSnapshot: "暖调胶片" },
        origin: { projectId: "project-1", anchorNodeId: "image-1" },
        plannedModelCalls: 2,
        plannedFinalOutputs: 2,
        planHash: "plan-1",
    };
}

test("同一个 command 只接受一次并返回同一个 run", async () => {
    const storage = memoryStorage();
    let ids = 0;
    const ledger = createCreativeSkillRunLedger({ storage, createId: () => `id-${++ids}`, now: () => 1000 });

    const first = await ledger.accept(runInput());
    const replay = await ledger.accept(runInput());

    assert.equal(replay.runId, first.runId);
    assert.equal(storage.snapshot()?.runs.length, 1);
});

test("远端 task ID 在轮询前持久化并可在重启后恢复", async () => {
    const storage = memoryStorage();
    let now = 1000;
    const first = createCreativeSkillRunLedger({ storage, createId: () => "run-1", now: () => now++ });
    const run = await first.accept(runInput());
    const attempt = await first.startAttempt(run.runId, { stepIndex: 0, outputId: "output-1", idempotencyKey: "run-1:output-1:0" });
    await first.markRemoteAccepted(run.runId, attempt.attemptId, { taskId: "remote-42" });

    const restored = createCreativeSkillRunLedger({ storage, createId: () => "unused", now: () => now++ });
    const recoverable = await restored.recoverable();

    assert.deepEqual(recoverable, [{ runId: run.runId, attemptId: attempt.attemptId, taskId: "remote-42", stepIndex: 0, outputId: "output-1" }]);
});

test("WebDAV 摘要抢先写入时重试并保留远端 task ID", async () => {
    const initial = memoryStorage();
    let ids = 0;
    const setup = createCreativeSkillRunLedger({ storage: initial, createId: () => `id-${++ids}`, now: () => 1000 + ids });
    const run = await setup.accept(runInput());
    const attempt = await setup.startAttempt(run.runId, { stepIndex: 0, outputId: "output-1", idempotencyKey: "key-1" });
    let current = structuredClone(initial.snapshot()!);
    let injectSyncWrite = true;
    const storage = {
        read: async () => structuredClone(current),
        write: async (next: CreativeSkillRunSnapshot, expectedRevision?: number) => {
            if (injectSyncWrite) {
                injectSyncWrite = false;
                current = {
                    ...current,
                    revision: current.revision + 1,
                    syncedRuns: [{ runId: "remote-summary", revision: 1, mode: "test", skillId: "remote", versionId: "v1", source: "package", settlement: "success", durationMs: 1, modelCalls: 1, outputCount: 1, createdAt: 1, updatedAt: 2 }],
                };
                const error = new Error("revision conflict");
                error.name = "CreativeSkillRunRevisionConflictError";
                throw error;
            }
            assert.equal(expectedRevision, current.revision);
            current = structuredClone(next);
        },
    };
    const ledger = createCreativeSkillRunLedger({ storage, createId: () => `id-${++ids}`, now: () => 2000 + ids });

    const updated = await ledger.markRemoteAccepted(run.runId, attempt.attemptId, { taskId: "remote-after-sync" });

    assert.equal(updated.attempts[0].taskId, "remote-after-sync");
    assert.deepEqual(current.syncedRuns?.map((item) => item.runId), ["remote-summary"]);
});

test("提交响应未保存的 attempt 标记为 submission-unknown 且不进入自动恢复", async () => {
    const storage = memoryStorage();
    const ledger = createCreativeSkillRunLedger({ storage, createId: (() => { let id = 0; return () => `id-${++id}`; })(), now: () => 1000 });
    const run = await ledger.accept(runInput());
    await ledger.startAttempt(run.runId, { stepIndex: 0, outputId: "output-1", idempotencyKey: "key" });

    const repaired = await ledger.reconcileInterrupted();

    assert.equal(repaired[0].phase, "blocked");
    assert.equal(repaired[0].block?.kind, "submission-unknown");
    assert.deepEqual(await ledger.recoverable(), []);
});

test("运行进入终态后本地账本只保留统计摘要", async () => {
    const storage = memoryStorage();
    let timestamp = 1000;
    const ledger = createCreativeSkillRunLedger({ storage, createId: (() => { let id = 0; return () => `id-${++id}`; })(), now: () => timestamp++ });
    const run = await ledger.accept({
        ...runInput(),
        origin: { projectId: "/private/project.fourj", anchorNodeId: "node-secret", threadId: "thread-secret", clientMessageId: "message-secret" },
    });
    const attempt = await ledger.startAttempt(run.runId, { stepIndex: 0, outputId: "output-secret", idempotencyKey: "private-key" });
    await ledger.markRemoteAccepted(run.runId, attempt.attemptId, { taskId: "provider-task-secret" });
    await ledger.completeAttempt(run.runId, attempt.attemptId, {
        outputId: "output-secret",
        stepIndex: 0,
        storageKey: "workspace:assets/images/private.png",
        url: "file:///private/output.png",
        mimeType: "image/png",
        bytes: 12,
        width: 2,
        height: 2,
        materializedNodeId: "result-node-secret",
    });

    const result = await ledger.settle(run.runId, "success");
    const persisted = storage.snapshot()!;

    assert.equal(result.outputs.length, 1);
    assert.deepEqual(await ledger.get(run.runId), result);
    assert.deepEqual(persisted.runs, []);
    assert.equal(persisted.syncedRuns?.length, 1);
    assert.deepEqual(await ledger.getSummary(run.runId), persisted.syncedRuns?.[0]);
    assert.doesNotMatch(JSON.stringify(persisted), /private|thread-secret|message-secret|provider-task-secret|storageKey|file:\/\/|node-secret|attempt|command-1|plan-1/i);
    assert.throws(() => readCreativeSkillRunSnapshot({ ...persisted, runs: [result] }), /隐私字段/);
});

test("持久化取消意图原子优先于旧协程的成功结算且重复结算幂等", async () => {
    const storage = memoryStorage();
    let timestamp = 1000;
    const ledger = createCreativeSkillRunLedger({ storage, createId: () => "run-cancel-race", now: () => timestamp++ });
    const run = await ledger.accept(runInput());
    await ledger.requestCancel(run.runId);

    const first = await ledger.settle(run.runId, "success");
    const replay = await ledger.settle(run.runId, "failed");

    assert.equal(first.settlement, "canceled");
    assert.deepEqual(replay, first);
    assert.equal(storage.snapshot()?.syncedRuns?.[0].settlement, "canceled");
});

test("终态命令重启后只返回原结果摘要且不会再次接受运行", async () => {
    const storage = memoryStorage();
    let timestamp = 1000;
    const firstLedger = createCreativeSkillRunLedger({ storage, createId: () => "run-original", now: () => timestamp++ });
    const accepted = await firstLedger.accept(runInput());
    const settled = await firstLedger.settle(accepted.runId, "success");
    const revision = storage.snapshot()!.revision;
    const restartedLedger = createCreativeSkillRunLedger({ storage, createId: () => "run-duplicate", now: () => timestamp++ });

    const duplicate = await restartedLedger.accept(runInput());

    assert.equal(duplicate.runId, settled.runId);
    assert.equal(duplicate.phase, "settled");
    assert.equal(duplicate.settlement, "success");
    assert.equal(storage.snapshot()!.revision, revision);
    assert.deepEqual(storage.snapshot()!.runs, []);
    await assert.rejects(() => restartedLedger.accept({ ...runInput(), planHash: "changed-plan" }), /执行计划已变化/);
});

test("统计只聚合终态 run，并按 Skill、版本和来源汇总实际耗时、调用与输出", () => {
    const attempts = [
        { attemptId: "attempt-1", stepIndex: 0, outputId: "output-1", idempotencyKey: "key-1", state: "completed" as const, startedAt: 1, updatedAt: 2 },
        { attemptId: "attempt-2", stepIndex: 1, outputId: "output-2", idempotencyKey: "key-2", state: "failed" as const, startedAt: 2, updatedAt: 3 },
    ];
    const base = {
        schemaVersion: 1 as const,
        revision: 1,
        commandId: "command",
        skill: { skillId: "skill", versionId: "v1", definitionHash: "hash", nameSnapshot: "风格", source: "manual" as const },
        origin: { projectId: "project", anchorNodeId: "node" },
        phase: "settled" as const,
        plannedModelCalls: 3,
        plannedFinalOutputs: 2,
        planHash: "plan",
        attempts,
        outputs: [{ outputId: "output-1", stepIndex: 0, storageKey: "image:one", url: "workspace://one", mimeType: "image/png", bytes: 1, width: 1, height: 1, materializedNodeId: "node-1" }],
        createdAt: 100,
        updatedAt: 600,
    };
    const stats = summarizeCreativeSkillRuns([
        { ...base, runId: "production", mode: "production", settlement: "partial" },
        { ...base, runId: "test", commandId: "test", mode: "test", settlement: "success", plannedModelCalls: 1 },
        { ...base, runId: "active-test", commandId: "active-test", mode: "test", phase: "running", settlement: undefined },
    ]);

    assert.deepEqual(stats, {
        productionUses: 1,
        testRuns: 1,
        modelCalls: 4,
        outputCount: 2,
        averageDurationMs: 500,
        outcomes: { success: 0, partial: 1, failed: 0, canceled: 0, interrupted: 0 },
        groups: [{
            skillId: "skill",
            versionId: "v1",
            source: "manual",
            runs: 2,
            productionUses: 1,
            testRuns: 1,
            modelCalls: 4,
            outputCount: 2,
            outcomes: { success: 1, partial: 1, failed: 0, canceled: 0, interrupted: 0 },
            averageDurationMs: 500,
        }],
    });
});

test("同步快照只保留终态统计字段，不包含 prompt、媒体、文件名或路径", () => {
    const run = {
        schemaVersion: 1 as const,
        revision: 3,
        runId: "run-1",
        commandId: "command-1",
        mode: "production" as const,
        skill: { skillId: "skill-1", versionId: "v1", definitionHash: "hash", nameSnapshot: "隐私名称", source: "package" as const },
        origin: { projectId: "/private/project.fourj", anchorNodeId: "node-1", threadId: "thread-1" },
        phase: "settled" as const,
        settlement: "success" as const,
        plannedModelCalls: 2,
        plannedFinalOutputs: 1,
        planHash: "secret-prompt-hash",
        attempts: [{ attemptId: "attempt-1", stepIndex: 0, outputId: "output-1", idempotencyKey: "key", state: "completed" as const, taskId: "provider-task", startedAt: 1, updatedAt: 2 }],
        outputs: [{ outputId: "output-1", stepIndex: 0, storageKey: "image:secret.png", url: "file:///private/secret.png", mimeType: "image/png", bytes: 8, width: 1, height: 1, materializedNodeId: "private-node" }],
        createdAt: 1,
        updatedAt: 2,
    };

    const snapshot = toCreativeSkillRunSyncSnapshot([run, { ...run, runId: "active", phase: "running", settlement: undefined }]);
    assert.equal(snapshot.runs.length, 1);
    assert.deepEqual(snapshot.runs[0], {
        runId: "run-1",
        revision: 3,
        mode: "production",
        skillId: "skill-1",
        versionId: "v1",
        source: "package",
        settlement: "success",
        durationMs: 1,
        modelCalls: 1,
        outputCount: 1,
        createdAt: 1,
        updatedAt: 2,
    });
    assert.doesNotMatch(JSON.stringify(snapshot), /secret|prompt|storageKey|url|path|filename|attempt|private|provider-task|project|node|隐私名称/i);
    assert.throws(() => readCreativeSkillRunSyncSnapshot({ ...snapshot, runs: [{ ...snapshot.runs[0], prompt: "secret" }] }), /隐私字段/);
    assert.throws(() => readCreativeSkillRunSyncSnapshot({ ...snapshot, prompt: "secret" }), /隐私字段/);
    assert.throws(() => readCreativeSkillRunSyncSnapshot({ ...snapshot, runs: [{ ...snapshot.runs[0], skillId: "file:///private/secret.png" }] }), /无效/);
    assert.throws(() => readCreativeSkillRunSyncSnapshot({ ...snapshot, runs: [{ ...snapshot.runs[0], runId: "prompt text" }] }), /无效/);
});

test("终态摘要按 revision 和 updatedAt 合并，活动本地 run 永远优先", () => {
    const local = {
        schemaVersion: 1 as const,
        revision: 2,
        runs: [{ runId: "same", revision: 4, mode: "production" as const, skillId: "skill", versionId: "v1", source: "unknown" as const, settlement: "failed" as const, durationMs: 9, modelCalls: 1, outputCount: 0, createdAt: 1, updatedAt: 10 }],
    };
    const remote = {
        schemaVersion: 1 as const,
        revision: 3,
        runs: [
            { ...local.runs[0], revision: 5, settlement: "success" as const, durationMs: 8, updatedAt: 9 },
            { ...local.runs[0], runId: "remote", revision: 1, settlement: "partial" as const, durationMs: 7, updatedAt: 8 },
        ],
    };
    const merged = mergeCreativeSkillRunSyncSnapshots(local, remote, new Set(["same"]));

    assert.deepEqual(merged.runs.map((run) => [run.runId, run.settlement]), [["remote", "partial"]]);
    assert.equal(merged.revision, 4);
});

test("统计直接读取本地终态摘要", () => {
    const summary = summarizeCreativeSkillRunSnapshot({
        schemaVersion: 1,
        revision: 2,
        runs: [],
        syncedRuns: [{ runId: "same", revision: 3, mode: "production", skillId: "skill", versionId: "v1", source: "unknown", settlement: "success", durationMs: 2, modelCalls: 0, outputCount: 0, createdAt: 1, updatedAt: 3 }],
    });

    assert.deepEqual(summary, {
        productionUses: 1,
        testRuns: 0,
        modelCalls: 0,
        outputCount: 0,
        averageDurationMs: 2,
        outcomes: { success: 1, partial: 0, failed: 0, canceled: 0, interrupted: 0 },
        groups: [{
            skillId: "skill",
            versionId: "v1",
            source: "unknown",
            runs: 1,
            productionUses: 1,
            testRuns: 0,
            modelCalls: 0,
            outputCount: 0,
            outcomes: { success: 1, partial: 0, failed: 0, canceled: 0, interrupted: 0 },
            averageDurationMs: 2,
        }],
    });
});

test("同步摘要遇到 runner 并发写入时按新 revision 重试且保留活动 run", async () => {
    class RevisionConflict extends Error {}
    const initial = memoryStorage();
    let now = 10;
    const ledger = createCreativeSkillRunLedger({ storage: initial, createId: (() => { let id = 0; return () => `id-${++id}`; })(), now: () => now++ });
    const settled = await ledger.accept(runInput("settled-command"));
    await ledger.settle(settled.runId, "success");
    await ledger.accept(runInput("active-seed"));
    let current: CreativeSkillRunSnapshot = structuredClone(initial.snapshot()!);
    let firstWrite = true;
    const expectedRevisions: number[] = [];
    const storage = {
        read: async () => structuredClone(current),
        write: async (next: CreativeSkillRunSnapshot, expectedRevision?: number) => {
            expectedRevisions.push(expectedRevision!);
            if (firstWrite) {
                firstWrite = false;
                const active = {
                    ...structuredClone(current.runs[0]),
                    runId: "active-run",
                    commandId: "active-command",
                    revision: 1,
                    phase: "queued" as const,
                    settlement: undefined,
                    attempts: [],
                    outputs: [],
                    createdAt: now++,
                    updatedAt: now++,
                };
                current = { ...current, revision: current.revision + 1, runs: [...current.runs, active] };
                throw new RevisionConflict();
            }
            assert.equal(current.revision, expectedRevision);
            current = structuredClone(next);
        },
    };
    const remote = {
        schemaVersion: 1 as const,
        revision: 1,
        runs: [{ runId: "remote-run", revision: 1, mode: "test" as const, skillId: "remote", versionId: "v1", source: "package" as const, settlement: "partial" as const, durationMs: 1, modelCalls: 1, outputCount: 1, createdAt: 1, updatedAt: 2 }],
    };

    const merged = await mergeCreativeSkillRunSyncIntoStorage(storage, remote, (error) => error instanceof RevisionConflict);

    assert.deepEqual(expectedRevisions, [3, 4]);
    assert.equal(current.runs.some((run) => run.runId === "active-run" && run.phase === "queued"), true);
    assert.deepEqual(current.syncedRuns?.map((run) => run.runId), ["remote-run", settled.runId]);
    assert.deepEqual(merged.runs.map((run) => run.runId), ["remote-run", settled.runId]);
});
