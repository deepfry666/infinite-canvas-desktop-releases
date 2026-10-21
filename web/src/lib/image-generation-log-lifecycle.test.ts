import assert from "node:assert/strict";
import test from "node:test";

import { runPersistedGenerationLifecycle, upsertGenerationRecord } from "./image-generation-log-lifecycle.ts";

test("生图任务开始即持久化运行记录，完成后原位更新同一条", async () => {
    let finishTask!: (value: string) => void;
    const task = new Promise<string>((resolve) => {
        finishTask = resolve;
    });
    const writes: Array<{ id: string; status: string }> = [];
    const lifecycle = runPersistedGenerationLifecycle({
        runningRecord: { id: "log-1", status: "running" },
        tasks: () => [task],
        complete: (record) => ({ ...record, status: "success" }),
        persist: async (record) => {
            writes.push({ ...record });
        },
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    let startAssertion: unknown;
    try {
        assert.deepEqual(writes, [{ id: "log-1", status: "running" }]);
    } catch (error) {
        startAssertion = error;
    }

    finishTask("image-1");
    await lifecycle;
    if (startAssertion) throw startAssertion;
    assert.deepEqual(writes, [
        { id: "log-1", status: "running" },
        { id: "log-1", status: "success" },
    ]);
    assert.equal(new Set(writes.map((record) => record.id)).size, 1);
});

test("生图任务失败后也原位更新同一条运行记录", async () => {
    const writes: Array<{ id: string; status: string }> = [];
    const { completedRecord } = await runPersistedGenerationLifecycle({
        runningRecord: { id: "log-failed", status: "running" },
        tasks: () => [Promise.reject(new Error("provider failed"))],
        complete: (record, results) => ({ ...record, status: results[0].status === "rejected" ? "failed" : "success" }),
        persist: async (record) => {
            writes.push({ ...record });
        },
    });

    assert.equal(completedRecord.status, "failed");
    assert.deepEqual(writes, [
        { id: "log-failed", status: "running" },
        { id: "log-failed", status: "failed" },
    ]);
    assert.equal(new Set(writes.map((record) => record.id)).size, 1);
});

test("运行记录无法保存时仍启动生成请求并返回持久化错误", async () => {
    let started = false;
    let writeCount = 0;
    const { completedRecord, persistenceError } = await runPersistedGenerationLifecycle({
        runningRecord: { id: "log-write-failed", status: "running" },
        tasks: () => {
            started = true;
            return [Promise.resolve("image-1")];
        },
        complete: (record) => ({ ...record, status: "success" }),
        persist: async () => {
            writeCount += 1;
            if (writeCount === 1) throw new Error("storage failed");
        },
    });

    assert.equal(started, true);
    assert.equal(completedRecord.status, "success");
    assert.equal((persistenceError as Error).message, "storage failed");
    assert.equal(writeCount, 2);
});

test("完成记录无法保存时不会把成功生成误报为失败", async () => {
    let writeCount = 0;
    const { results, completedRecord, persistenceError } = await runPersistedGenerationLifecycle({
        runningRecord: { id: "log-complete-write-failed", status: "running" },
        tasks: () => [Promise.resolve("image-1")],
        complete: (record, settled) => ({ ...record, status: settled[0].status === "fulfilled" ? "success" : "failed" }),
        persist: async () => {
            writeCount += 1;
            if (writeCount === 2) throw new Error("completed storage failed");
        },
    });

    assert.equal(results[0].status, "fulfilled");
    assert.equal(completedRecord.status, "success");
    assert.equal((persistenceError as Error).message, "completed storage failed");
});

test("左侧记录按 id 乐观更新，不追加重复卡片", () => {
    const current = [
        { id: "log-1", createdAt: 100, status: "running" },
        { id: "older", createdAt: 50, status: "success" },
    ];
    const next = upsertGenerationRecord(current, { id: "log-1", createdAt: 100, status: "failed" });

    assert.deepEqual(next, [
        { id: "log-1", createdAt: 100, status: "failed" },
        { id: "older", createdAt: 50, status: "success" },
    ]);
});
