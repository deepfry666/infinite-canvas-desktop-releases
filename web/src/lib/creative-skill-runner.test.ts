import assert from "node:assert/strict";
import test from "node:test";

import { createCreativeSkillRunLedger, type CreativeSkillRunSnapshot } from "./creative-skill-run-ledger.ts";
import { createCreativeSkillRunner, type CreativeSkillProviderInput, type CreativeSkillRecoverySnapshot } from "./creative-skill-runner.ts";

function memoryStorage<T>(initial?: T) {
    let value = initial;
    return {
        read: async () => structuredClone(value),
        write: async (next: T) => { value = structuredClone(next); },
        snapshot: () => structuredClone(value),
    };
}

function concurrentRecoveryStorage() {
    let value: CreativeSkillRecoverySnapshot | undefined;
    let writeQueue = Promise.resolve();
    let initialReads = 0;
    let releaseInitialReads: () => void = () => undefined;
    const initialReadBarrier = new Promise<void>((resolve) => { releaseInitialReads = resolve; });
    return {
        async read() {
            const snapshot = structuredClone(value);
            if (initialReads < 2) {
                initialReads += 1;
                if (initialReads === 2) releaseInitialReads();
                await initialReadBarrier;
            }
            return snapshot;
        },
        write(next: CreativeSkillRecoverySnapshot, expectedRevision?: number) {
            const operation = writeQueue.then(async () => {
                if (expectedRevision !== undefined && (value?.revision || 0) !== expectedRevision) {
                    const error = new Error("恢复记录 revision 冲突");
                    error.name = "CreativeSkillRecoveryRevisionConflictError";
                    throw error;
                }
                value = structuredClone(next);
            });
            writeQueue = operation.then(() => undefined, () => undefined);
            return operation;
        },
        snapshot: () => structuredClone(value),
    };
}

function request() {
    return {
        commandId: "command-1",
        mode: "production" as const,
        skill: { skillId: "poster", versionId: "version-1", definitionHash: "definition-1", nameSnapshot: "海报" },
        origin: { projectId: "project-1", anchorNodeId: "node-1" },
        recipe: {
            schemaVersion: 1 as const,
            kind: "linear-image" as const,
            parameters: [{ key: "user-request", label: "要求", required: true, type: "text" as const, maxLength: 100 }],
            steps: [{ operation: "image.edit" as const, prompt: [{ type: "parameter" as const, key: "user-request" }] }],
            finalOutputCount: 1,
        },
        parameters: { "user-request": "保留人物，改成纸张海报" },
        target: { sha256: "a".repeat(64), nodeId: "node-1", storageKey: "workspace:assets/images/a.png" },
        references: [],
        assets: [],
        provider: { model: "image-model", size: "4:5", quality: "high" },
    };
}

test("运行器按持久化计划执行单图请求并把最终输出物化到关联节点", async () => {
    const runStorage = memoryStorage<CreativeSkillRunSnapshot>();
    const recoveryStorage = memoryStorage<CreativeSkillRecoverySnapshot>();
    let ids = 0;
    const ledger = createCreativeSkillRunLedger({ storage: runStorage, createId: () => `id-${++ids}`, now: () => 1000 + ids });
    const providerCalls: unknown[] = [];
    const runner = createCreativeSkillRunner({
        ledger,
        recoveryStorage,
        createId: () => `runner-${++ids}`,
        now: () => 2000 + ids,
        provider: async (input) => {
            providerCalls.push(input);
            return { dataUrl: "data:image/png;base64,AA==" };
        },
        resolveImage: async (image) => ({ ...image, dataUrl: `data:image/png;base64,${image.sha256?.slice(0, 4) || "AAAA"}` }),
        storeOutput: async () => ({ storageKey: "workspace:assets/images/output.png", url: "workspace://local/assets/images/output.png", mimeType: "image/png", bytes: 1, width: 800, height: 1000 }),
        materializeOutput: async () => "child-node-1",
    });

    const run = await runner.run(request());

    assert.equal(run.settlement, "success");
    assert.equal(run.outputs[0].materializedNodeId, "child-node-1");
    assert.equal(providerCalls.length, 1);
    assert.equal((providerCalls[0] as { call: { options: { count: number } } }).call.options.count, 1);
    assert.equal(recoveryStorage.snapshot()?.entries.length, 0);
});

test("已结算命令在应用重启后不会再次提交 Provider", async () => {
    const runStorage = memoryStorage<CreativeSkillRunSnapshot>();
    const recoveryStorage = memoryStorage<CreativeSkillRecoverySnapshot>();
    let ids = 0;
    let providerCalls = 0;
    const dependencies = {
        recoveryStorage,
        createId: () => `runner-${++ids}`,
        now: () => 2000 + ids,
        provider: async () => {
            providerCalls += 1;
            return { dataUrl: "data:image/png;base64,AA==" };
        },
        resolveImage: async (image: { sha256?: string }) => ({ ...image, dataUrl: "data:image/png;base64,AAAA" }),
        storeOutput: async () => ({ storageKey: "workspace:assets/images/output.png", url: "workspace://local/assets/images/output.png", mimeType: "image/png", bytes: 1, width: 800, height: 1000 }),
        materializeOutput: async () => "child-node-1",
    };
    const first = await createCreativeSkillRunner({
        ...dependencies,
        ledger: createCreativeSkillRunLedger({ storage: runStorage, createId: () => `ledger-${++ids}`, now: () => 1000 + ids }),
    }).run(request());

    const replay = await createCreativeSkillRunner({
        ...dependencies,
        ledger: createCreativeSkillRunLedger({ storage: runStorage, createId: () => `ledger-${++ids}`, now: () => 3000 + ids }),
    }).run(request());

    assert.equal(first.runId, replay.runId);
    assert.equal(replay.settlement, "success");
    assert.equal(providerCalls, 1);
    assert.deepEqual(recoveryStorage.snapshot()?.entries, []);
});

test("已持久化远端任务 ID 的运行可在重启后续查而不重新提交", async () => {
    const runStorage = memoryStorage<CreativeSkillRunSnapshot>();
    const recoveryStorage = memoryStorage<CreativeSkillRecoverySnapshot>();
    let ids = 0;
    const ledger = createCreativeSkillRunLedger({ storage: runStorage, createId: () => `id-${++ids}`, now: () => 1000 + ids });
    const providerCalls: Array<{ resumeTaskId?: string }> = [];
    const dependencies = {
        ledger,
        recoveryStorage,
        createId: () => `runner-${++ids}`,
        now: () => 2000 + ids,
        resolveImage: async (image: { sha256?: string }) => ({ ...image, dataUrl: "data:image/png;base64,AAAA" }),
        storeOutput: async () => ({ storageKey: "workspace:assets/images/output.png", url: "workspace://local/assets/images/output.png", mimeType: "image/png", bytes: 1, width: 800, height: 1000 }),
        materializeOutput: async () => "child-node-1",
    };
    const firstRunner = createCreativeSkillRunner({
        ...dependencies,
        provider: async (input) => {
            providerCalls.push(input);
            await input.onRemoteHandle({ taskId: "remote-task-1" });
            throw Object.assign(new Error("任务仍在处理中"), { pending: true, taskId: "remote-task-1" });
        },
    });

    const waiting = await firstRunner.run(request());
    assert.equal(waiting.phase, "waiting-provider");
    assert.equal(recoveryStorage.snapshot()?.entries.length, 1);

    const restartedRunner = createCreativeSkillRunner({
        ...dependencies,
        provider: async (input) => {
            providerCalls.push(input);
            assert.equal(input.resumeTaskId, "remote-task-1");
            return { dataUrl: "data:image/png;base64,AA==" };
        },
    });
    const [recovered] = await restartedRunner.recover();

    assert.equal(recovered.settlement, "success");
    assert.equal(providerCalls.length, 2);
    assert.equal(recoveryStorage.snapshot()?.entries.length, 0);
});

test("已有远端任务 ID 时查询错误保留恢复计划且只允许继续查询", async () => {
    const runStorage = memoryStorage<CreativeSkillRunSnapshot>();
    const recoveryStorage = memoryStorage<CreativeSkillRecoverySnapshot>();
    let ids = 0;
    let providerCalls = 0;
    const ledger = createCreativeSkillRunLedger({ storage: runStorage, createId: () => `id-${++ids}`, now: () => 1000 + ids });
    const dependencies = {
        ledger,
        recoveryStorage,
        createId: () => `runner-${++ids}`,
        now: () => 2000 + ids,
        resolveImage: async (image: { sha256?: string }) => ({ ...image, dataUrl: "data:image/png;base64,AAAA" }),
        storeOutput: async () => ({ storageKey: "workspace:assets/images/output.png", url: "workspace://local/assets/images/output.png", mimeType: "image/png", bytes: 1, width: 800, height: 1000 }),
        materializeOutput: async () => "child-node-1",
    };
    const firstRunner = createCreativeSkillRunner({
        ...dependencies,
        provider: async (input) => {
            providerCalls += 1;
            await input.onRemoteHandle({ taskId: "remote-query-error" });
            throw Object.assign(new Error("查询凭证暂时不可用"), { code: "HTTP_401", submissionState: "rejected" as const });
        },
    });

    const blocked = await firstRunner.run(request());

    assert.equal(blocked.block?.kind, "submission-unknown");
    assert.equal(blocked.attempts[0].taskId, "remote-query-error");
    assert.equal(recoveryStorage.snapshot()?.entries.length, 1);

    const resumed = await createCreativeSkillRunner({
        ...dependencies,
        provider: async (input) => {
            providerCalls += 1;
            assert.equal(input.resumeTaskId, "remote-query-error");
            return { dataUrl: "data:image/png;base64,AA==" };
        },
    }).resume(blocked.runId);

    assert.equal(resumed.settlement, "success");
    assert.equal(providerCalls, 2);
    assert.deepEqual(recoveryStorage.snapshot()?.entries, []);
});

test("远端任务明确进入失败终态后才结算失败并清理恢复计划", async () => {
    const runStorage = memoryStorage<CreativeSkillRunSnapshot>();
    const recoveryStorage = memoryStorage<CreativeSkillRecoverySnapshot>();
    let ids = 0;
    const ledger = createCreativeSkillRunLedger({ storage: runStorage, createId: () => `id-${++ids}`, now: () => 1000 + ids });
    const runner = createCreativeSkillRunner({
        ledger,
        recoveryStorage,
        createId: () => `runner-${++ids}`,
        now: () => 2000 + ids,
        provider: async (input) => {
            await input.onRemoteHandle({ taskId: "remote-terminal-failure" });
            throw Object.assign(new Error("远端任务失败"), { code: "REMOTE_TASK_FAILED", remoteTaskState: "terminal-failure" as const });
        },
        resolveImage: async (image) => ({ ...image, dataUrl: "data:image/png;base64,AAAA" }),
        storeOutput: async () => { throw new Error("不应保存输出"); },
        materializeOutput: async () => { throw new Error("不应物化输出"); },
    });

    const failed = await runner.run(request());

    assert.equal(failed.settlement, "failed");
    assert.equal(failed.attempts[0].state, "failed");
    assert.deepEqual(recoveryStorage.snapshot()?.entries, []);
});

test("终态摘要已存在时恢复会清理缺少活动账本的陈旧计划", async () => {
    const runStorage = memoryStorage<CreativeSkillRunSnapshot>();
    const recoveryStorage = memoryStorage<CreativeSkillRecoverySnapshot>();
    let ids = 0;
    let providerCalls = 0;
    const ledger = createCreativeSkillRunLedger({ storage: runStorage, createId: () => `id-${++ids}`, now: () => 1000 + ids });
    const dependencies = {
        ledger,
        recoveryStorage,
        createId: () => `runner-${++ids}`,
        now: () => 2000 + ids,
        resolveImage: async (image: { sha256?: string }) => ({ ...image, dataUrl: "data:image/png;base64,AAAA" }),
        storeOutput: async () => ({ storageKey: "workspace:assets/images/output.png", url: "workspace://local/assets/images/output.png", mimeType: "image/png", bytes: 1, width: 800, height: 1000 }),
        materializeOutput: async () => "child-node-1",
    };
    const firstRunner = createCreativeSkillRunner({
        ...dependencies,
        provider: async (input) => {
            providerCalls += 1;
            await input.onRemoteHandle({ taskId: "remote-stale-recovery" });
            throw Object.assign(new Error("任务仍在处理中"), { pending: true, taskId: "remote-stale-recovery" });
        },
    });
    const waiting = await firstRunner.run(request());
    await ledger.settle(waiting.runId, "interrupted");
    const restartedRunner = createCreativeSkillRunner({
        ...dependencies,
        provider: async () => {
            providerCalls += 1;
            throw new Error("不应重新请求 Provider");
        },
    });

    const recovered = await restartedRunner.recover();

    assert.deepEqual(recovered, []);
    assert.equal(providerCalls, 1);
    assert.deepEqual(recoveryStorage.snapshot()?.entries, []);
});

test("提交结果未知时锁定运行且恢复过程不会自动重发", async () => {
    const runStorage = memoryStorage<CreativeSkillRunSnapshot>();
    const recoveryStorage = memoryStorage<CreativeSkillRecoverySnapshot>();
    let ids = 0;
    let providerCalls = 0;
    const ledger = createCreativeSkillRunLedger({ storage: runStorage, createId: () => `id-${++ids}`, now: () => 1000 + ids });
    const runner = createCreativeSkillRunner({
        ledger,
        recoveryStorage,
        createId: () => `runner-${++ids}`,
        now: () => 2000 + ids,
        provider: async () => {
            providerCalls += 1;
            throw new Error("连接在提交期间中断");
        },
        resolveImage: async (image) => ({ ...image, dataUrl: "data:image/png;base64,AAAA" }),
        storeOutput: async () => { throw new Error("不应保存输出"); },
        materializeOutput: async () => { throw new Error("不应物化输出"); },
    });

    const blocked = await runner.run(request());
    assert.equal(blocked.block?.kind, "submission-unknown");
    assert.equal(blocked.attempts[0].state, "submission-unknown");
    await runner.recover();
    assert.equal(providerCalls, 1);
    assert.equal(recoveryStorage.snapshot()?.entries.length, 1);
});

test("恢复计划写入失败时不会在账本留下排队运行", async () => {
    const runStorage = memoryStorage<CreativeSkillRunSnapshot>();
    const recoveryStorage = {
        read: async () => undefined,
        write: async () => { throw new Error("恢复记录写入失败"); },
    };
    let ids = 0;
    let providerCalls = 0;
    const ledger = createCreativeSkillRunLedger({ storage: runStorage, createId: () => `id-${++ids}`, now: () => 1000 + ids });
    const runner = createCreativeSkillRunner({
        ledger,
        recoveryStorage,
        createId: () => `runner-${++ids}`,
        now: () => 2000 + ids,
        provider: async () => {
            providerCalls += 1;
            return { dataUrl: "data:image/png;base64,AA==" };
        },
        resolveImage: async (image: { sha256?: string }) => ({ ...image, dataUrl: "data:image/png;base64,AAAA" }),
        storeOutput: async () => ({ storageKey: "workspace:assets/images/output.png", url: "workspace://local/assets/images/output.png", mimeType: "image/png", bytes: 1, width: 800, height: 1000 }),
        materializeOutput: async () => "child-node-1",
    });

    await assert.rejects(() => runner.run(request()), /恢复记录写入失败/);

    assert.deepEqual(await ledger.list(), []);
    assert.equal(providerCalls, 0);
});

test("账本接受失败时清理预先持久化的恢复计划", async () => {
    const runStorage = {
        read: async () => undefined,
        write: async () => { throw new Error("运行账本写入失败"); },
    };
    const recoveryStorage = memoryStorage<CreativeSkillRecoverySnapshot>();
    let ids = 0;
    const ledger = createCreativeSkillRunLedger({ storage: runStorage, createId: () => `id-${++ids}`, now: () => 1000 + ids });
    const runner = createCreativeSkillRunner({
        ledger,
        recoveryStorage,
        createId: () => `runner-${++ids}`,
        now: () => 2000 + ids,
        provider: async () => { throw new Error("不应请求 Provider"); },
        resolveImage: async (image) => image,
        storeOutput: async () => { throw new Error("不应保存输出"); },
        materializeOutput: async () => { throw new Error("不应物化输出"); },
    });

    await assert.rejects(() => runner.run(request()), /运行账本写入失败/);

    assert.deepEqual(recoveryStorage.snapshot()?.entries, []);
    assert.deepEqual(await ledger.list(), []);
});

test("恢复会终结旧版本已接受但缺少恢复计划的排队运行", async () => {
    const runStorage = memoryStorage<CreativeSkillRunSnapshot>();
    const recoveryStorage = memoryStorage<CreativeSkillRecoverySnapshot>();
    let ids = 0;
    let providerCalls = 0;
    const ledger = createCreativeSkillRunLedger({ storage: runStorage, createId: () => `id-${++ids}`, now: () => 1000 + ids });
    const input = request();
    const queued = await ledger.accept({
        commandId: input.commandId,
        mode: input.mode,
        skill: input.skill,
        origin: input.origin,
        plannedModelCalls: 1,
        plannedFinalOutputs: 1,
        planHash: `sha256:${"a".repeat(64)}`,
    });
    const runner = createCreativeSkillRunner({
        ledger,
        recoveryStorage,
        createId: () => `runner-${++ids}`,
        now: () => 2000 + ids,
        provider: async () => {
            providerCalls += 1;
            return { dataUrl: "data:image/png;base64,AA==" };
        },
        resolveImage: async (image) => image,
        storeOutput: async () => { throw new Error("不应保存输出"); },
        materializeOutput: async () => { throw new Error("不应物化输出"); },
    });

    const recovered = await runner.recover();

    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].runId, queued.runId);
    assert.equal(recovered[0].settlement, "interrupted");
    assert.equal(providerCalls, 0);
});

test("重启恢复拒绝执行被篡改的持久化计划", async () => {
    const runStorage = memoryStorage<CreativeSkillRunSnapshot>();
    const recoveryStorage = memoryStorage<CreativeSkillRecoverySnapshot>();
    let ids = 0;
    const ledger = createCreativeSkillRunLedger({ storage: runStorage, createId: () => `id-${++ids}`, now: () => 1000 + ids });
    const dependencies = {
        ledger,
        recoveryStorage,
        createId: () => `runner-${++ids}`,
        now: () => 2000 + ids,
        resolveImage: async (image: { sha256?: string }) => ({ ...image, dataUrl: "data:image/png;base64,AAAA" }),
        storeOutput: async () => ({ storageKey: "workspace:assets/images/output.png", url: "workspace://local/assets/images/output.png", mimeType: "image/png", bytes: 1, width: 800, height: 1000 }),
        materializeOutput: async () => "child-node-1",
    };
    const firstRunner = createCreativeSkillRunner({
        ...dependencies,
        provider: async (input) => {
            await input.onRemoteHandle({ taskId: "remote-tamper-1" });
            throw Object.assign(new Error("任务仍在处理中"), { pending: true, taskId: "remote-tamper-1" });
        },
    });
    await firstRunner.run(request());
    const corrupted = recoveryStorage.snapshot()!;
    corrupted.entries[0].plan.calls[0].prompt = "篡改后的付费请求";
    await recoveryStorage.write(corrupted);
    let providerCalls = 0;
    const restartedRunner = createCreativeSkillRunner({
        ...dependencies,
        provider: async () => {
            providerCalls += 1;
            return { dataUrl: "data:image/png;base64,AA==" };
        },
    });

    await assert.rejects(() => restartedRunner.recover(), /恢复计划完整性/);
    assert.equal(providerCalls, 0);
    assert.equal(recoveryStorage.snapshot()?.entries.length, 1);
});

test("恢复快照拒绝缺失计划与来源的伪造记录", async () => {
    const runStorage = memoryStorage<CreativeSkillRunSnapshot>();
    const recoveryStorage = memoryStorage<CreativeSkillRecoverySnapshot>({
        schemaVersion: 1,
        revision: 1,
        entries: [{ runId: "broken-run", planHash: `sha256:${"a".repeat(64)}`, calls: [] } as unknown as CreativeSkillRecoverySnapshot["entries"][number]],
    });
    const ledger = createCreativeSkillRunLedger({ storage: runStorage, createId: () => "unused", now: () => 1 });
    const runner = createCreativeSkillRunner({
        ledger,
        recoveryStorage,
        createId: () => "unused",
        now: () => 1,
        provider: async () => { throw new Error("不应请求 Provider"); },
        resolveImage: async (image) => image,
        storeOutput: async () => { throw new Error("不应保存输出"); },
        materializeOutput: async () => { throw new Error("不应物化输出"); },
    });

    await assert.rejects(() => runner.readRecovery(), /版本未知|数据损坏|已拒绝覆盖/);
});

test("两个运行器并发创建任务时保留全部恢复记录", async () => {
    const runStorage = memoryStorage<CreativeSkillRunSnapshot>();
    const recoveryStorage = concurrentRecoveryStorage();
    let ids = 0;
    const ledger = createCreativeSkillRunLedger({ storage: runStorage, createId: () => `id-${++ids}`, now: () => 1000 + ids });
    const dependencies = {
        ledger,
        recoveryStorage,
        createId: () => `runner-${++ids}`,
        now: () => 2000 + ids,
        provider: async (input: CreativeSkillProviderInput) => {
            await input.onRemoteHandle({ taskId: `remote-${input.runId}` });
            throw Object.assign(new Error("任务仍在处理中"), { pending: true, taskId: `remote-${input.runId}` });
        },
        resolveImage: async (image: { sha256?: string }) => ({ ...image, dataUrl: "data:image/png;base64,AAAA" }),
        storeOutput: async () => ({ storageKey: "workspace:assets/images/output.png", url: "workspace://local/assets/images/output.png", mimeType: "image/png", bytes: 1, width: 800, height: 1000 }),
        materializeOutput: async () => "child-node-1",
    };
    const firstRequest = request();
    firstRequest.commandId = "command-a";
    const secondRequest = request();
    secondRequest.commandId = "command-b";

    await Promise.all([
        createCreativeSkillRunner(dependencies).run(firstRequest),
        createCreativeSkillRunner(dependencies).run(secondRequest),
    ]);

    assert.deepEqual(recoveryStorage.snapshot()?.entries.map((entry) => entry.commandId).sort(), ["command-a", "command-b"]);
});

test("两个运行器并发执行同一命令时只提交一次 Provider", async () => {
    const runStorage = memoryStorage<CreativeSkillRunSnapshot>();
    const recoveryStorage = memoryStorage<CreativeSkillRecoverySnapshot>();
    let ids = 0;
    let providerCalls = 0;
    let resolutionCount = 0;
    let firstResolutionStarted: () => void = () => undefined;
    let finishResolution: () => void = () => undefined;
    let secondAcceptanceFinished: () => void = () => undefined;
    const firstStarted = new Promise<void>((resolve) => { firstResolutionStarted = resolve; });
    const resolved = new Promise<void>((resolve) => { finishResolution = resolve; });
    const secondAccepted = new Promise<void>((resolve) => { secondAcceptanceFinished = resolve; });
    const baseLedger = createCreativeSkillRunLedger({ storage: runStorage, createId: () => `id-${++ids}`, now: () => 1000 + ids });
    let acceptances = 0;
    const ledger = {
        ...baseLedger,
        async accept(input: Parameters<typeof baseLedger.accept>[0]) {
            const accepted = await baseLedger.accept(input);
            acceptances += 1;
            if (acceptances === 2) secondAcceptanceFinished();
            return accepted;
        },
    };
    const dependencies = {
        ledger,
        recoveryStorage,
        createId: () => `runner-${++ids}`,
        now: () => 2000 + ids,
        provider: async () => {
            providerCalls += 1;
            return { dataUrl: "data:image/png;base64,AA==" };
        },
        resolveImage: async (image: { sha256?: string }) => {
            resolutionCount += 1;
            if (resolutionCount === 1) firstResolutionStarted();
            await resolved;
            return { ...image, dataUrl: "data:image/png;base64,AAAA" };
        },
        storeOutput: async () => ({ storageKey: "workspace:assets/images/output.png", url: "workspace://local/assets/images/output.png", mimeType: "image/png", bytes: 1, width: 800, height: 1000 }),
        materializeOutput: async () => "child-node-1",
    };
    const firstRunner = createCreativeSkillRunner(dependencies);
    const secondRunner = createCreativeSkillRunner(dependencies);

    const firstRunning = firstRunner.run(request());
    await firstStarted;
    const secondRunning = secondRunner.run(request());
    await secondAccepted;
    await new Promise<void>((resolve) => setImmediate(resolve));
    finishResolution();
    const [first, second] = await Promise.all([firstRunning, secondRunning]);

    assert.equal(first.runId, second.runId);
    assert.equal(first.settlement, "success");
    assert.equal(second.settlement, "success");
    assert.equal(providerCalls, 1);
});

test("其他运行器恢复时不会把本进程活动提交误判为未知", async () => {
    const runStorage = memoryStorage<CreativeSkillRunSnapshot>();
    const recoveryStorage = memoryStorage<CreativeSkillRecoverySnapshot>();
    let ids = 0;
    let providerCalls = 0;
    let providerStarted: () => void = () => undefined;
    let finishProvider: () => void = () => undefined;
    const started = new Promise<void>((resolve) => { providerStarted = resolve; });
    const finished = new Promise<void>((resolve) => { finishProvider = resolve; });
    const ledger = createCreativeSkillRunLedger({ storage: runStorage, createId: () => `id-${++ids}`, now: () => 1000 + ids });
    const dependencies = {
        ledger,
        recoveryStorage,
        createId: () => `runner-${++ids}`,
        now: () => 2000 + ids,
        provider: async () => {
            providerCalls += 1;
            providerStarted();
            await finished;
            return { dataUrl: "data:image/png;base64,AA==" };
        },
        resolveImage: async (image: { sha256?: string }) => ({ ...image, dataUrl: "data:image/png;base64,AAAA" }),
        storeOutput: async () => ({ storageKey: "workspace:assets/images/output.png", url: "workspace://local/assets/images/output.png", mimeType: "image/png", bytes: 1, width: 800, height: 1000 }),
        materializeOutput: async () => "child-node-1",
    };
    const running = createCreativeSkillRunner(dependencies).run(request());
    await started;
    const recovering = createCreativeSkillRunner(dependencies).recover();
    await new Promise<void>((resolve) => setImmediate(resolve));
    finishProvider();
    const [result, recovered] = await Promise.all([running, recovering]);

    assert.equal(result.settlement, "success");
    assert.equal(recovered[0].settlement, "success");
    assert.equal(recovered[0].attempts[0].state, "completed");
    assert.equal(providerCalls, 1);
});

test("恢复计划持久化完成前其他运行器不会看到可误判的排队运行", async () => {
    const runStorage = memoryStorage<CreativeSkillRunSnapshot>();
    let recoverySnapshot: CreativeSkillRecoverySnapshot | undefined;
    let recoveryWriteStarted: () => void = () => undefined;
    let finishRecoveryWrite: () => void = () => undefined;
    const writeStarted = new Promise<void>((resolve) => { recoveryWriteStarted = resolve; });
    const writeAllowed = new Promise<void>((resolve) => { finishRecoveryWrite = resolve; });
    const recoveryStorage = {
        read: async () => structuredClone(recoverySnapshot),
        write: async (next: CreativeSkillRecoverySnapshot) => {
            recoveryWriteStarted();
            await writeAllowed;
            recoverySnapshot = structuredClone(next);
        },
    };
    let ids = 0;
    const firstLedger = createCreativeSkillRunLedger({ storage: runStorage, createId: () => `ledger-${++ids}`, now: () => 1000 + ids });
    const secondLedger = createCreativeSkillRunLedger({ storage: runStorage, createId: () => `ledger-${++ids}`, now: () => 2000 + ids });
    const dependencies = {
        recoveryStorage,
        createId: () => `runner-${++ids}`,
        now: () => 3000 + ids,
        provider: async () => ({ dataUrl: "data:image/png;base64,AA==" }),
        resolveImage: async (image: { sha256?: string }) => ({ ...image, dataUrl: "data:image/png;base64,AAAA" }),
        storeOutput: async () => ({ storageKey: "workspace:assets/images/output.png", url: "workspace://local/assets/images/output.png", mimeType: "image/png", bytes: 1, width: 800, height: 1000 }),
        materializeOutput: async () => "child-node-1",
    };
    const running = createCreativeSkillRunner({ ...dependencies, ledger: firstLedger }).run(request());
    await writeStarted;
    const visibleBeforeRecoveryWrite = await secondLedger.list();
    const recovered = await createCreativeSkillRunner({ ...dependencies, ledger: secondLedger }).recover();
    finishRecoveryWrite();
    const result = await running;

    assert.equal(visibleBeforeRecoveryWrite.length, 0);
    assert.deepEqual(recovered, []);
    assert.equal(result.settlement, "success");
});

test("多步配方严格串行执行且只把终态输出物化到画布", async () => {
    const runStorage = memoryStorage<CreativeSkillRunSnapshot>();
    const recoveryStorage = memoryStorage<CreativeSkillRecoverySnapshot>();
    let ids = 0;
    const ledger = createCreativeSkillRunLedger({ storage: runStorage, createId: () => `id-${++ids}`, now: () => 1000 + ids });
    const calls: string[] = [];
    const materialized: string[] = [];
    const runner = createCreativeSkillRunner({
        ledger,
        recoveryStorage,
        createId: () => `runner-${++ids}`,
        now: () => 2000 + ids,
        provider: async (input) => {
            calls.push(`${input.call.stepIndex}:${input.call.outputIndex}`);
            return { dataUrl: `data:image/png;base64,${input.call.stepIndex}${input.call.outputIndex}` };
        },
        resolveImage: async (image) => ({ ...image, dataUrl: image.dataUrl || "data:image/png;base64,AAAA" }),
        storeOutput: async ({ outputId }) => ({ storageKey: `workspace:assets/images/${outputId}.png`, url: `workspace://local/${outputId}.png`, mimeType: "image/png", bytes: 1, width: 800, height: 1000 }),
        materializeOutput: async ({ output }) => {
            materialized.push(output.outputId);
            return `node-${materialized.length}`;
        },
    });
    const input = request();
    input.recipe.steps.push({ operation: "image.edit", prompt: [{ type: "parameter", key: "user-request" }] });
    input.recipe.finalOutputCount = 2;

    const run = await runner.run(input);

    assert.equal(run.settlement, "success");
    assert.deepEqual(calls, ["0:0", "1:0", "1:1"]);
    assert.equal(run.outputs.length, 3);
    assert.equal(materialized.length, 2);
    assert.equal(run.outputs.filter((output) => output.materializedNodeId).length, 2);
});

test("输出已落盘但节点创建失败时只重试物化", async () => {
    const runStorage = memoryStorage<CreativeSkillRunSnapshot>();
    const recoveryStorage = memoryStorage<CreativeSkillRecoverySnapshot>();
    let ids = 0;
    let providerCalls = 0;
    let materializeCalls = 0;
    const ledger = createCreativeSkillRunLedger({ storage: runStorage, createId: () => `id-${++ids}`, now: () => 1000 + ids });
    const runner = createCreativeSkillRunner({
        ledger,
        recoveryStorage,
        createId: () => `runner-${++ids}`,
        now: () => 2000 + ids,
        provider: async () => {
            providerCalls += 1;
            return { dataUrl: "data:image/png;base64,AA==" };
        },
        resolveImage: async (image) => ({ ...image, dataUrl: "data:image/png;base64,AAAA" }),
        storeOutput: async () => ({ storageKey: "workspace:assets/images/output.png", url: "workspace://local/assets/images/output.png", mimeType: "image/png", bytes: 1, width: 800, height: 1000 }),
        materializeOutput: async () => {
            materializeCalls += 1;
            if (materializeCalls === 1) throw new Error("画布暂不可写");
            return "child-node-1";
        },
    });

    const blocked = await runner.run(request());
    assert.equal(blocked.block?.kind, "materialization-failed");
    const resumed = await runner.resume(blocked.runId);

    assert.equal(resumed.settlement, "success");
    assert.equal(providerCalls, 1);
    assert.equal(materializeCalls, 2);
});

test("输出已暂存但账本登记失败时重启只补记账不重复提交 Provider", async () => {
    const runStorage = memoryStorage<CreativeSkillRunSnapshot>();
    const recoveryStorage = memoryStorage<CreativeSkillRecoverySnapshot>();
    let ids = 0;
    let providerCalls = 0;
    let storeCalls = 0;
    let materializeCalls = 0;
    let staged: { storageKey: string; url: string; mimeType: string; bytes: number; width: number; height: number } | undefined;
    const baseLedger = createCreativeSkillRunLedger({ storage: runStorage, createId: () => `id-${++ids}`, now: () => 1000 + ids });
    let rejectFirstCompletion = true;
    const failingLedger = {
        ...baseLedger,
        completeAttempt: async (...args: Parameters<typeof baseLedger.completeAttempt>) => {
            if (rejectFirstCompletion) {
                rejectFirstCompletion = false;
                throw new Error("模拟账本写入失败");
            }
            return baseLedger.completeAttempt(...args);
        },
    };
    const dependencies = {
        recoveryStorage,
        createId: () => `runner-${++ids}`,
        now: () => 2000 + ids,
        provider: async () => {
            providerCalls += 1;
            return { dataUrl: "data:image/png;base64,AA==" };
        },
        resolveImage: async (image: { sha256?: string }) => ({ ...image, dataUrl: "data:image/png;base64,AAAA" }),
        storeOutput: async () => {
            storeCalls += 1;
            staged = { storageKey: "workspace:assets/images/staged.png", url: "workspace://local/assets/images/staged.png", mimeType: "image/png", bytes: 1, width: 800, height: 1000 };
            return staged;
        },
        findStoredOutput: async () => staged,
        materializeOutput: async () => {
            materializeCalls += 1;
            return "child-node-1";
        },
    };

    const blocked = await createCreativeSkillRunner({ ...dependencies, ledger: failingLedger }).run(request());
    const restartedLedger = createCreativeSkillRunLedger({ storage: runStorage, createId: () => `id-${++ids}`, now: () => 3000 + ids });
    const [recovered] = await createCreativeSkillRunner({ ...dependencies, ledger: restartedLedger }).recover();

    assert.equal(blocked.block?.kind, "workspace-unavailable");
    assert.equal(recovered.settlement, "success");
    assert.equal(providerCalls, 1);
    assert.equal(storeCalls, 1);
    assert.equal(materializeCalls, 1);
});

test("本地停止不等待运行队列，并在提交状态无法确认时锁定记录", async () => {
    const runStorage = memoryStorage<CreativeSkillRunSnapshot>();
    const recoveryStorage = memoryStorage<CreativeSkillRecoverySnapshot>();
    let ids = 0;
    let started: () => void = () => undefined;
    const providerStarted = new Promise<void>((resolve) => { started = resolve; });
    const ledger = createCreativeSkillRunLedger({ storage: runStorage, createId: () => `id-${++ids}`, now: () => 1000 + ids });
    const runner = createCreativeSkillRunner({
        ledger,
        recoveryStorage,
        createId: () => `runner-${++ids}`,
        now: () => 2000 + ids,
        provider: ({ signal }) => new Promise((_, reject) => {
            started();
            signal?.addEventListener("abort", () => reject(new DOMException("已停止", "AbortError")), { once: true });
        }),
        resolveImage: async (image) => ({ ...image, dataUrl: "data:image/png;base64,AAAA" }),
        storeOutput: async () => { throw new Error("不应保存输出"); },
        materializeOutput: async () => { throw new Error("不应物化输出"); },
    });

    const running = runner.run(request());
    await providerStarted;
    const canceled = await runner.cancelCommand("command-1");
    const result = await running;

    assert.equal(canceled?.block?.kind, "submission-unknown");
    assert.equal(result.block?.kind, "submission-unknown");
    assert.equal(result.attempts[0].errorCode, "CANCEL_DURING_SUBMISSION");
    assert.equal(recoveryStorage.snapshot()?.entries.length, 1);
});

test("远端确认取消后运行进入已取消终态并清除恢复计划", async () => {
    const runStorage = memoryStorage<CreativeSkillRunSnapshot>();
    const recoveryStorage = memoryStorage<CreativeSkillRecoverySnapshot>();
    let ids = 0;
    let started: () => void = () => undefined;
    const providerStarted = new Promise<void>((resolve) => { started = resolve; });
    const ledger = createCreativeSkillRunLedger({ storage: runStorage, createId: () => `id-${++ids}`, now: () => 1000 + ids });
    const runner = createCreativeSkillRunner({
        ledger,
        recoveryStorage,
        createId: () => `runner-${++ids}`,
        now: () => 2000 + ids,
        provider: async ({ onRemoteHandle, signal }) => {
            await onRemoteHandle({ taskId: "remote-cancel-1" });
            started();
            return new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new DOMException("已停止", "AbortError")), { once: true }));
        },
        cancelProvider: async (taskId, provider) => {
            assert.equal(taskId, "remote-cancel-1");
            assert.equal(provider.model, "image-model");
            return "canceled";
        },
        resolveImage: async (image) => ({ ...image, dataUrl: "data:image/png;base64,AAAA" }),
        storeOutput: async () => { throw new Error("不应保存输出"); },
        materializeOutput: async () => { throw new Error("不应物化输出"); },
    });

    const running = runner.run(request());
    await providerStarted;
    const canceled = await runner.cancelCommand("command-1");
    const result = await running;

    assert.equal(canceled?.settlement, "canceled");
    assert.equal(result.settlement, "canceled");
    assert.equal(result.attempts[0].state, "canceled");
    assert.equal(recoveryStorage.snapshot()?.entries.length, 0);
});

test("远端取消确认后忽略晚到的成功响应", async () => {
    const runStorage = memoryStorage<CreativeSkillRunSnapshot>();
    const recoveryStorage = memoryStorage<CreativeSkillRecoverySnapshot>();
    let ids = 0;
    let started: () => void = () => undefined;
    let finishProvider: (value: { dataUrl: string }) => void = () => undefined;
    const providerStarted = new Promise<void>((resolve) => { started = resolve; });
    const providerResult = new Promise<{ dataUrl: string }>((resolve) => { finishProvider = resolve; });
    let storedOutputs = 0;
    let materializedOutputs = 0;
    const ledger = createCreativeSkillRunLedger({ storage: runStorage, createId: () => `id-${++ids}`, now: () => 1000 + ids });
    const runner = createCreativeSkillRunner({
        ledger,
        recoveryStorage,
        createId: () => `runner-${++ids}`,
        now: () => 2000 + ids,
        provider: async ({ onRemoteHandle }) => {
            await onRemoteHandle({ taskId: "remote-late-success" });
            started();
            return providerResult;
        },
        cancelProvider: async () => "canceled",
        resolveImage: async (image) => ({ ...image, dataUrl: "data:image/png;base64,AAAA" }),
        storeOutput: async () => {
            storedOutputs += 1;
            return { storageKey: "workspace:assets/images/output.png", url: "workspace://local/assets/images/output.png", mimeType: "image/png", bytes: 1, width: 800, height: 1000 };
        },
        materializeOutput: async () => {
            materializedOutputs += 1;
            return "child-node-1";
        },
    });

    const running = runner.run(request());
    await providerStarted;
    const canceled = await runner.cancelCommand("command-1");
    finishProvider({ dataUrl: "data:image/png;base64,AA==" });
    const result = await running;

    assert.equal(canceled?.settlement, "canceled");
    assert.equal(result.settlement, "canceled");
    assert.equal(storedOutputs, 0);
    assert.equal(materializedOutputs, 0);
    assert.equal(recoveryStorage.snapshot()?.entries.length, 0);
});

test("图片解析进行中停止后不会重新启动已取消运行", async () => {
    const runStorage = memoryStorage<CreativeSkillRunSnapshot>();
    const recoveryStorage = memoryStorage<CreativeSkillRecoverySnapshot>();
    let ids = 0;
    let resolveStarted: () => void = () => undefined;
    let finishResolution: () => void = () => undefined;
    const started = new Promise<void>((resolve) => { resolveStarted = resolve; });
    const resolved = new Promise<void>((resolve) => { finishResolution = resolve; });
    let providerCalls = 0;
    const ledger = createCreativeSkillRunLedger({ storage: runStorage, createId: () => `id-${++ids}`, now: () => 1000 + ids });
    const runner = createCreativeSkillRunner({
        ledger,
        recoveryStorage,
        createId: () => `runner-${++ids}`,
        now: () => 2000 + ids,
        provider: async () => {
            providerCalls += 1;
            return { dataUrl: "data:image/png;base64,AA==" };
        },
        resolveImage: async (image) => {
            resolveStarted();
            await resolved;
            return { ...image, dataUrl: "data:image/png;base64,AAAA" };
        },
        storeOutput: async () => { throw new Error("不应保存输出"); },
        materializeOutput: async () => { throw new Error("不应物化输出"); },
    });

    const running = runner.run(request());
    await started;
    const canceling = runner.cancelCommand("command-1");
    finishResolution();
    const [canceled, result] = await Promise.all([canceling, running]);

    assert.equal(canceled?.settlement, "canceled");
    assert.equal(result.settlement, "canceled");
    assert.equal(result.attempts.length, 0);
    assert.equal(providerCalls, 0);
    assert.equal(recoveryStorage.snapshot()?.entries.length, 0);
});

test("输出落盘进行中停止时先记录已保存输出且不创建节点", async () => {
    const runStorage = memoryStorage<CreativeSkillRunSnapshot>();
    const recoveryStorage = memoryStorage<CreativeSkillRecoverySnapshot>();
    let ids = 0;
    let storeStarted: () => void = () => undefined;
    let finishStore: () => void = () => undefined;
    const started = new Promise<void>((resolve) => { storeStarted = resolve; });
    const stored = new Promise<void>((resolve) => { finishStore = resolve; });
    let materializedOutputs = 0;
    const ledger = createCreativeSkillRunLedger({ storage: runStorage, createId: () => `id-${++ids}`, now: () => 1000 + ids });
    const runner = createCreativeSkillRunner({
        ledger,
        recoveryStorage,
        createId: () => `runner-${++ids}`,
        now: () => 2000 + ids,
        provider: async ({ onRemoteHandle }) => {
            await onRemoteHandle({ taskId: "remote-store-window" });
            return { dataUrl: "data:image/png;base64,AA==" };
        },
        cancelProvider: async () => "canceled",
        resolveImage: async (image) => ({ ...image, dataUrl: "data:image/png;base64,AAAA" }),
        storeOutput: async () => {
            storeStarted();
            await stored;
            return { storageKey: "workspace:assets/images/output.png", url: "workspace://local/assets/images/output.png", mimeType: "image/png", bytes: 1, width: 800, height: 1000 };
        },
        materializeOutput: async () => {
            materializedOutputs += 1;
            return "child-node-1";
        },
    });

    const running = runner.run(request());
    await started;
    let cancellationSettled = false;
    const canceling = runner.cancelCommand("command-1").then((result) => {
        cancellationSettled = true;
        return result;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const settledBeforeOutputReturned = cancellationSettled;
    finishStore();
    const [canceled, result] = await Promise.all([canceling, running]);

    assert.equal(settledBeforeOutputReturned, false);
    assert.equal(canceled?.settlement, "canceled");
    assert.equal(result.settlement, "canceled");
    assert.equal(materializedOutputs, 0);
    assert.equal(result.outputs.length, 1);
    assert.equal(result.outputs[0].storageKey, "workspace:assets/images/output.png");
    assert.equal(result.outputs[0].materializedNodeId, undefined);
    assert.equal(recoveryStorage.snapshot()?.entries.length, 0);
});

test("取消输出已记账但未结算时重启不会物化并恢复为取消终态", async () => {
    const runStorage = memoryStorage<CreativeSkillRunSnapshot>();
    const recoveryStorage = memoryStorage<CreativeSkillRecoverySnapshot>();
    let ids = 0;
    let storeStarted: () => void = () => undefined;
    let finishStore: () => void = () => undefined;
    const started = new Promise<void>((resolve) => { storeStarted = resolve; });
    const stored = new Promise<void>((resolve) => { finishStore = resolve; });
    const baseLedger = createCreativeSkillRunLedger({ storage: runStorage, createId: () => `id-${++ids}`, now: () => 1000 + ids });
    let failCanceledSettlement = true;
    const ledger = {
        ...baseLedger,
        async settle(runId: string, settlement: Parameters<typeof baseLedger.settle>[1]) {
            if (settlement === "canceled" && failCanceledSettlement) {
                failCanceledSettlement = false;
                throw new Error("模拟取消结算前退出");
            }
            return baseLedger.settle(runId, settlement);
        },
    };
    let materializedOutputs = 0;
    const dependencies = {
        ledger,
        recoveryStorage,
        createId: () => `runner-${++ids}`,
        now: () => 2000 + ids,
        provider: async ({ onRemoteHandle }: CreativeSkillProviderInput) => {
            await onRemoteHandle({ taskId: "remote-canceled-stored" });
            return { dataUrl: "data:image/png;base64,AA==" };
        },
        cancelProvider: async () => "canceled" as const,
        resolveImage: async (image: { sha256?: string }) => ({ ...image, dataUrl: "data:image/png;base64,AAAA" }),
        storeOutput: async () => {
            storeStarted();
            await stored;
            return { storageKey: "workspace:assets/images/output.png", url: "workspace://local/assets/images/output.png", mimeType: "image/png", bytes: 1, width: 800, height: 1000 };
        },
        materializeOutput: async () => {
            materializedOutputs += 1;
            return "child-node-1";
        },
    };
    const runner = createCreativeSkillRunner(dependencies);
    const running = runner.run(request());
    await started;
    const canceling = runner.cancelCommand("command-1");
    finishStore();
    await assert.rejects(canceling, /模拟取消结算前退出/);
    await assert.rejects(running, /模拟取消结算前退出/);

    const [recovered] = await createCreativeSkillRunner(dependencies).recover();

    assert.equal(recovered.settlement, "canceled");
    assert.equal(recovered.outputs.length, 1);
    assert.equal(recovered.outputs[0].materializedNodeId, undefined);
    assert.equal(materializedOutputs, 0);
    assert.deepEqual(recoveryStorage.snapshot()?.entries, []);
});

test("物化进行中停止时先记录已创建节点再进入取消终态", async () => {
    const runStorage = memoryStorage<CreativeSkillRunSnapshot>();
    const recoveryStorage = memoryStorage<CreativeSkillRecoverySnapshot>();
    let ids = 0;
    let materializeStarted: () => void = () => undefined;
    let finishMaterialization: (nodeId: string) => void = () => undefined;
    const started = new Promise<void>((resolve) => { materializeStarted = resolve; });
    const materialized = new Promise<string>((resolve) => { finishMaterialization = resolve; });
    const ledger = createCreativeSkillRunLedger({ storage: runStorage, createId: () => `id-${++ids}`, now: () => 1000 + ids });
    const runner = createCreativeSkillRunner({
        ledger,
        recoveryStorage,
        createId: () => `runner-${++ids}`,
        now: () => 2000 + ids,
        provider: async () => ({ dataUrl: "data:image/png;base64,AA==" }),
        resolveImage: async (image) => ({ ...image, dataUrl: "data:image/png;base64,AAAA" }),
        storeOutput: async () => ({ storageKey: "workspace:assets/images/output.png", url: "workspace://local/assets/images/output.png", mimeType: "image/png", bytes: 1, width: 800, height: 1000 }),
        materializeOutput: async () => {
            materializeStarted();
            return materialized;
        },
    });

    const running = runner.run(request());
    await started;
    let cancellationSettled = false;
    const canceling = runner.cancelCommand("command-1").then((result) => {
        cancellationSettled = true;
        return result;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const settledBeforeNodeReturned = cancellationSettled;
    finishMaterialization("child-node-1");
    const [canceled, result] = await Promise.all([canceling, running]);

    assert.equal(settledBeforeNodeReturned, false);
    assert.equal(canceled?.settlement, "canceled");
    assert.equal(result.settlement, "canceled");
    assert.equal(result.outputs[0].materializedNodeId, "child-node-1");
    assert.equal(recoveryStorage.snapshot()?.entries.length, 0);
});

test("取消已结算时旧执行协程不会再次结算并向调用方报错", async () => {
    const runStorage = memoryStorage<CreativeSkillRunSnapshot>();
    const recoveryStorage = memoryStorage<CreativeSkillRecoverySnapshot>();
    let ids = 0;
    let outputMaterialized = false;
    let finalReadHeld = false;
    let finalReadStarted: () => void = () => undefined;
    let releaseFinalRead: () => void = () => undefined;
    const finalRead = new Promise<void>((resolve) => { finalReadStarted = resolve; });
    const release = new Promise<void>((resolve) => { releaseFinalRead = resolve; });
    const baseLedger = createCreativeSkillRunLedger({ storage: runStorage, createId: () => `id-${++ids}`, now: () => 1000 + ids });
    const ledger = {
        ...baseLedger,
        async markOutputMaterialized(runId: string, outputId: string, nodeId: string) {
            const result = await baseLedger.markOutputMaterialized(runId, outputId, nodeId);
            outputMaterialized = true;
            return result;
        },
        async get(runId: string) {
            const current = await baseLedger.get(runId);
            if (outputMaterialized && !finalReadHeld && current?.phase !== "settled") {
                finalReadHeld = true;
                finalReadStarted();
                await release;
            }
            return current;
        },
    };
    const runner = createCreativeSkillRunner({
        ledger,
        recoveryStorage,
        createId: () => `runner-${++ids}`,
        now: () => 2000 + ids,
        provider: async () => ({ dataUrl: "data:image/png;base64,AA==" }),
        resolveImage: async (image) => ({ ...image, dataUrl: "data:image/png;base64,AAAA" }),
        storeOutput: async () => ({ storageKey: "workspace:assets/images/output.png", url: "workspace://local/assets/images/output.png", mimeType: "image/png", bytes: 1, width: 800, height: 1000 }),
        materializeOutput: async () => "child-node-1",
    });

    const running = runner.run(request());
    await finalRead;
    const canceled = await runner.cancelCommand("command-1");
    releaseFinalRead();
    const result = await running;

    assert.equal(canceled?.settlement, "canceled");
    assert.equal(result.settlement, "canceled");
    assert.equal(result.outputs[0].materializedNodeId, "child-node-1");
    assert.deepEqual(recoveryStorage.snapshot()?.entries, []);
});

test("物化完成但取消结算前退出时重启仍保持取消意图", async () => {
    const runStorage = memoryStorage<CreativeSkillRunSnapshot>();
    const recoveryStorage = memoryStorage<CreativeSkillRecoverySnapshot>();
    let ids = 0;
    let providerCalls = 0;
    let materializeCalls = 0;
    let materializeStarted: () => void = () => undefined;
    let finishMaterialization: () => void = () => undefined;
    const started = new Promise<void>((resolve) => { materializeStarted = resolve; });
    const materialized = new Promise<void>((resolve) => { finishMaterialization = resolve; });
    const baseLedger = createCreativeSkillRunLedger({ storage: runStorage, createId: () => `id-${++ids}`, now: () => 1000 + ids });
    const failingLedger = {
        ...baseLedger,
        settle: async (runId: string, settlement: Parameters<typeof baseLedger.settle>[1]) => {
            if (settlement === "canceled") throw new Error("模拟取消结算前退出");
            return baseLedger.settle(runId, settlement);
        },
    };
    const dependencies = {
        recoveryStorage,
        createId: () => `runner-${++ids}`,
        now: () => 2000 + ids,
        provider: async () => {
            providerCalls += 1;
            return { dataUrl: "data:image/png;base64,AA==" };
        },
        resolveImage: async (image: { sha256?: string }) => ({ ...image, dataUrl: "data:image/png;base64,AAAA" }),
        storeOutput: async () => ({ storageKey: "workspace:assets/images/output.png", url: "workspace://local/assets/images/output.png", mimeType: "image/png", bytes: 1, width: 800, height: 1000 }),
        materializeOutput: async () => {
            materializeCalls += 1;
            materializeStarted();
            await materialized;
            return "child-node-1";
        },
    };
    const runner = createCreativeSkillRunner({ ...dependencies, ledger: failingLedger });
    const running = runner.run(request());
    await started;
    const canceling = runner.cancelCommand("command-1");
    finishMaterialization();

    await assert.rejects(canceling, /模拟取消结算前退出/);
    await assert.rejects(running, /模拟取消结算前退出/);
    assert.equal(runStorage.snapshot()?.runs[0].cancelRequested, true);
    assert.equal(runStorage.snapshot()?.runs[0].outputs[0].materializedNodeId, "child-node-1");

    const restartedLedger = createCreativeSkillRunLedger({ storage: runStorage, createId: () => `id-${++ids}`, now: () => 3000 + ids });
    const [recovered] = await createCreativeSkillRunner({ ...dependencies, ledger: restartedLedger }).recover();

    assert.equal(recovered.settlement, "canceled");
    assert.equal(providerCalls, 1);
    assert.equal(materializeCalls, 1);
    assert.deepEqual(recoveryStorage.snapshot()?.entries, []);
});

test("其他运行器停止物化中的任务时也会先记录已创建节点", async () => {
    const runStorage = memoryStorage<CreativeSkillRunSnapshot>();
    const recoveryStorage = memoryStorage<CreativeSkillRecoverySnapshot>();
    let ids = 0;
    let materializeStarted: () => void = () => undefined;
    let finishMaterialization: (nodeId: string) => void = () => undefined;
    const started = new Promise<void>((resolve) => { materializeStarted = resolve; });
    const materialized = new Promise<string>((resolve) => { finishMaterialization = resolve; });
    const ledger = createCreativeSkillRunLedger({ storage: runStorage, createId: () => `id-${++ids}`, now: () => 1000 + ids });
    const dependencies = {
        ledger,
        recoveryStorage,
        createId: () => `runner-${++ids}`,
        now: () => 2000 + ids,
        provider: async () => ({ dataUrl: "data:image/png;base64,AA==" }),
        resolveImage: async (image: { sha256?: string }) => ({ ...image, dataUrl: "data:image/png;base64,AAAA" }),
        storeOutput: async () => ({ storageKey: "workspace:assets/images/output.png", url: "workspace://local/assets/images/output.png", mimeType: "image/png", bytes: 1, width: 800, height: 1000 }),
        materializeOutput: async () => {
            materializeStarted();
            return materialized;
        },
    };
    const running = createCreativeSkillRunner(dependencies).run(request());
    await started;
    const [active] = await ledger.list();
    let cancellationSettled = false;
    const canceling = createCreativeSkillRunner(dependencies).cancel(active.runId).then((result) => {
        cancellationSettled = true;
        return result;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const settledBeforeNodeReturned = cancellationSettled;
    finishMaterialization("child-node-1");
    const [canceled, result] = await Promise.all([canceling, running]);

    assert.equal(settledBeforeNodeReturned, false);
    assert.equal(canceled.settlement, "canceled");
    assert.equal(result.settlement, "canceled");
    assert.equal(result.outputs[0].materializedNodeId, "child-node-1");
    assert.equal(recoveryStorage.snapshot()?.entries.length, 0);
});

test("带远端任务 ID 的未知取消可由用户明确继续查询", async () => {
    const runStorage = memoryStorage<CreativeSkillRunSnapshot>();
    const recoveryStorage = memoryStorage<CreativeSkillRecoverySnapshot>();
    let ids = 0;
    let calls = 0;
    let started: () => void = () => undefined;
    const providerStarted = new Promise<void>((resolve) => { started = resolve; });
    const ledger = createCreativeSkillRunLedger({ storage: runStorage, createId: () => `id-${++ids}`, now: () => 1000 + ids });
    const runner = createCreativeSkillRunner({
        ledger,
        recoveryStorage,
        createId: () => `runner-${++ids}`,
        now: () => 2000 + ids,
        provider: async ({ onRemoteHandle, resumeTaskId, signal }) => {
            calls += 1;
            if (resumeTaskId) {
                assert.equal(resumeTaskId, "remote-resume-1");
                return { dataUrl: "data:image/png;base64,AA==" };
            }
            await onRemoteHandle({ taskId: "remote-resume-1" });
            started();
            return new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new DOMException("已停止", "AbortError")), { once: true }));
        },
        cancelProvider: async () => "unknown",
        resolveImage: async (image) => ({ ...image, dataUrl: "data:image/png;base64,AAAA" }),
        storeOutput: async () => ({ storageKey: "workspace:assets/images/output.png", url: "workspace://local/assets/images/output.png", mimeType: "image/png", bytes: 1, width: 800, height: 1000 }),
        materializeOutput: async () => "child-node-1",
    });

    const running = runner.run(request());
    await providerStarted;
    const blocked = await runner.cancelCommand("command-1");
    await running;
    const resumed = await runner.resume(blocked!.runId);

    assert.equal(blocked?.block?.kind, "submission-unknown");
    assert.equal(resumed.settlement, "success");
    assert.equal(calls, 2);
    assert.equal(recoveryStorage.snapshot()?.entries.length, 0);
});

test("远端取消结果未知时结束本地记录不会声称任务已取消", async () => {
    const runStorage = memoryStorage<CreativeSkillRunSnapshot>();
    const recoveryStorage = memoryStorage<CreativeSkillRecoverySnapshot>();
    let ids = 0;
    let started: () => void = () => undefined;
    const providerStarted = new Promise<void>((resolve) => { started = resolve; });
    const ledger = createCreativeSkillRunLedger({ storage: runStorage, createId: () => `id-${++ids}`, now: () => 1000 + ids });
    const runner = createCreativeSkillRunner({
        ledger,
        recoveryStorage,
        createId: () => `runner-${++ids}`,
        now: () => 2000 + ids,
        provider: async ({ onRemoteHandle, signal }) => {
            await onRemoteHandle({ taskId: "remote-dismiss-unknown" });
            started();
            return new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new DOMException("已停止", "AbortError")), { once: true }));
        },
        cancelProvider: async () => "unknown",
        resolveImage: async (image) => ({ ...image, dataUrl: "data:image/png;base64,AAAA" }),
        storeOutput: async () => { throw new Error("不应保存输出"); },
        materializeOutput: async () => { throw new Error("不应物化输出"); },
    });

    const running = runner.run(request());
    await providerStarted;
    const blocked = await runner.cancelCommand("command-1");
    await running;
    const dismissed = await runner.dismiss(blocked!.runId);

    assert.equal(blocked?.block?.kind, "submission-unknown");
    assert.equal(dismissed.settlement, "interrupted");
    assert.deepEqual(recoveryStorage.snapshot()?.entries, []);
});

test("远端取消结果未知后再次取消会沿用原任务 ID 重试", async () => {
    const runStorage = memoryStorage<CreativeSkillRunSnapshot>();
    const recoveryStorage = memoryStorage<CreativeSkillRecoverySnapshot>();
    let ids = 0;
    let cancelCalls = 0;
    let started: () => void = () => undefined;
    const providerStarted = new Promise<void>((resolve) => { started = resolve; });
    const ledger = createCreativeSkillRunLedger({ storage: runStorage, createId: () => `id-${++ids}`, now: () => 1000 + ids });
    const runner = createCreativeSkillRunner({
        ledger,
        recoveryStorage,
        createId: () => `runner-${++ids}`,
        now: () => 2000 + ids,
        provider: async ({ onRemoteHandle, signal }) => {
            await onRemoteHandle({ taskId: "remote-retry-cancel" });
            started();
            return new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new DOMException("已停止", "AbortError")), { once: true }));
        },
        cancelProvider: async (taskId) => {
            assert.equal(taskId, "remote-retry-cancel");
            cancelCalls += 1;
            return cancelCalls === 1 ? "unknown" : "canceled";
        },
        resolveImage: async (image) => ({ ...image, dataUrl: "data:image/png;base64,AAAA" }),
        storeOutput: async () => { throw new Error("不应保存输出"); },
        materializeOutput: async () => { throw new Error("不应物化输出"); },
    });

    const running = runner.run(request());
    await providerStarted;
    const blocked = await runner.cancelCommand("command-1");
    await running;
    const canceled = await runner.cancel(blocked!.runId);

    assert.equal(blocked?.block?.kind, "submission-unknown");
    assert.equal(canceled.settlement, "canceled");
    assert.equal(cancelCalls, 2);
    assert.deepEqual(recoveryStorage.snapshot()?.entries, []);
});

test("无远端任务 ID 的未知提交不能重试，但可人工结束记录", async () => {
    const runStorage = memoryStorage<CreativeSkillRunSnapshot>();
    const recoveryStorage = memoryStorage<CreativeSkillRecoverySnapshot>();
    let ids = 0;
    const ledger = createCreativeSkillRunLedger({ storage: runStorage, createId: () => `id-${++ids}`, now: () => 1000 + ids });
    const runner = createCreativeSkillRunner({
        ledger,
        recoveryStorage,
        createId: () => `runner-${++ids}`,
        now: () => 2000 + ids,
        provider: async () => { throw new Error("连接在提交期间中断"); },
        resolveImage: async (image) => ({ ...image, dataUrl: "data:image/png;base64,AAAA" }),
        storeOutput: async () => { throw new Error("不应保存输出"); },
        materializeOutput: async () => { throw new Error("不应物化输出"); },
    });

    const blocked = await runner.run(request());
    await assert.rejects(() => runner.resume(blocked.runId), /不能安全重试/);
    const dismissed = await runner.dismiss(blocked.runId);

    assert.equal(dismissed.settlement, "interrupted");
    assert.equal(recoveryStorage.snapshot()?.entries.length, 0);
});
