import assert from "node:assert/strict";
import test from "node:test";

import {
    assertGenerationProtectionStoresReady,
    createGenerationTrash,
    type GenerationRecordKind,
    type GenerationTrashRecord,
    type GenerationTrashRecordStore,
    type GenerationTrashStoredRecord,
} from "./generation-trash.ts";
import { matchesExpectedGenerationTombstone } from "./generation-log-merge.ts";

type TestRecord = GenerationTrashRecord & {
    title?: string;
    prompt?: string;
    outputs?: string[];
    references?: Array<{ storageKey: string }>;
};

test("画布或素材持久化恢复失败时拒绝永久删除保护扫描", () => {
    assert.doesNotThrow(() => assertGenerationProtectionStoresReady([{ hydrationError: false }, { hydrationError: false }]));
    assert.throws(() => assertGenerationProtectionStoresReady([{ hydrationError: false }, { hydrationError: true }]), /数据读取失败/);
});

test("首次读取按顺序初始化生图和视频记录库", async () => {
    let activeReads = 0;
    let maxActiveReads = 0;
    const store = (): GenerationTrashRecordStore<TestRecord> => ({
        async list() {
            activeReads += 1;
            maxActiveReads = Math.max(maxActiveReads, activeReads);
            await new Promise<void>((resolve) => setImmediate(resolve));
            activeReads -= 1;
            return [];
        },
        async save() {},
        async rollback() {},
        outputStorageKeys: () => [],
    });
    const trash = createGenerationTrash({ image: store(), video: store(), async deleteOutputs() {} });

    assert.deepEqual(await trash.listTrash(), []);
    assert.equal(maxActiveReads, 1);
});

test("软删除保留完整记录和输出文件，并出现在回收站列表", async () => {
    const memory = createMemoryTrash({
        image: [{ id: "image-1", createdAt: 10, status: "success", title: "春日", outputs: ["image:result"], references: [{ storageKey: "image:reference" }] }],
    });

    const result = await memory.trash.move([{ kind: "image", id: "image-1" }]);

    assert.deepEqual(result, { moved: [{ kind: "image", id: "image-1" }], skipped: [] });
    assert.deepEqual(memory.image.get("image-1"), {
        id: "image-1",
        createdAt: 10,
        status: "success",
        title: "春日",
        outputs: ["image:result"],
        references: [{ storageKey: "image:reference" }],
        updatedAt: 100,
        trashedAt: 100,
    });
    assert.deepEqual(memory.deletedBatches, []);
    const items = await memory.trash.listTrash();
    assert.equal(items.length, 1);
    assert.deepEqual(items[0].ref, { kind: "image", id: "image-1" });
    assert.equal(items[0].deletedAt, 100);
    assert.equal(items[0].record.title, "春日");
});

test("恢复记录会移除删除时间并更新 updatedAt", async () => {
    const memory = createMemoryTrash({ image: [{ id: "image-restore", createdAt: 10, status: "success", title: "待恢复", outputs: ["image:restore"] }] });
    await memory.trash.move([{ kind: "image", id: "image-restore" }]);
    memory.setNow(250);

    const result = await memory.trash.restore([{ kind: "image", id: "image-restore" }]);

    assert.deepEqual(result, { restored: [{ kind: "image", id: "image-restore" }], skipped: [] });
    assert.deepEqual(memory.image.get("image-restore"), {
        id: "image-restore",
        createdAt: 10,
        status: "success",
        title: "待恢复",
        outputs: ["image:restore"],
        updatedAt: 250,
    });
    assert.deepEqual(await memory.trash.listTrash(), []);
    assert.deepEqual(memory.deletedBatches, []);
});

test("系统时间回拨时软删除和恢复仍使用单调递增的更新时间", async () => {
    const memory = createMemoryTrash({ image: [{ id: "image-clock", createdAt: 10, updatedAt: 1_000, outputs: ["image:clock"] }] });

    await memory.trash.move([{ kind: "image", id: "image-clock" }]);
    assert.equal(memory.image.get("image-clock")?.updatedAt, 1_001);
    assert.equal(memory.image.get("image-clock")?.trashedAt, 1_001);

    memory.setNow(200);
    await memory.trash.restore([{ kind: "image", id: "image-clock" }]);
    assert.equal(memory.image.get("image-clock")?.updatedAt, 1_002);
    assert.equal(memory.image.get("image-clock")?.trashedAt, undefined);
});

test("运行中和排队中的生成记录不能移入回收站", async () => {
    const memory = createMemoryTrash({
        image: [{ id: "image-running", createdAt: 10, status: "running" }],
        video: [{ id: "video-pending", createdAt: 20, status: "pending" }],
    });
    const refs = [
        { kind: "image", id: "image-running" },
        { kind: "video", id: "video-pending" },
    ] as const;

    const result = await memory.trash.move(refs);

    assert.deepEqual(result, { moved: [], skipped: refs });
    assert.equal(memory.image.get("image-running")?.trashedAt, undefined);
    assert.equal(memory.video.get("video-pending")?.trashedAt, undefined);
    assert.deepEqual(memory.saved, []);
});

test("共享输出键仍被其他生成记录使用时不删除文件", async () => {
    const memory = createMemoryTrash({
        image: [{ id: "image-trash", createdAt: 10, status: "success", trashedAt: 50, outputs: ["workspace:assets/shared/result"] }],
        video: [{ id: "video-live", createdAt: 20, status: "success", outputs: ["workspace:assets/shared/result"] }],
    });

    const result = await memory.trash.purge([{ kind: "image", id: "image-trash" }]);

    assert.deepEqual(result, {
        purged: [{ kind: "image", id: "image-trash" }],
        deletedFiles: [],
        protectedFiles: ["workspace:assets/shared/result"],
        failedFiles: [],
        skipped: [],
    });
    assert.deepEqual(memory.deletedBatches, []);
    assert.equal((memory.video.get("video-live") as TestRecord | undefined)?.outputs?.[0], "workspace:assets/shared/result");
});

test("成果被另一条生成记录当作参考素材时仍会保留文件", async () => {
    const sharedKey = "image:reused-output";
    const memory = createMemoryTrash({
        image: [
            { id: "image-trash", createdAt: 10, status: "success", trashedAt: 50, outputs: [sharedKey] },
            { id: "image-live", createdAt: 20, status: "success", references: [{ storageKey: sharedKey }] },
        ],
    });

    const result = await memory.trash.purge([{ kind: "image", id: "image-trash" }]);

    assert.deepEqual(result.deletedFiles, []);
    assert.deepEqual(result.protectedFiles, [sharedKey]);
    assert.deepEqual(memory.deletedBatches, []);
});

test("同一记录的参考输入与生成成果复用同一文件时绝不删除用户输入", async () => {
    const sharedKey = "workspace:assets/images/content-reused.png";
    const memory = createMemoryTrash({
        image: [{ id: "image-alias", createdAt: 10, trashedAt: 50, outputs: [sharedKey], references: [{ storageKey: sharedKey }] }],
    });

    const result = await memory.trash.purge([{ kind: "image", id: "image-alias" }]);

    assert.deepEqual(result.deletedFiles, []);
    assert.deepEqual(result.protectedFiles, [sharedKey]);
    assert.deepEqual(memory.deletedBatches, []);
});

test("批量清除中的共享输出键只删除一次", async () => {
    const sharedKey = "workspace:assets/images/shared.png";
    const memory = createMemoryTrash({
        image: [
            { id: "image-a", createdAt: 10, status: "success", trashedAt: 50, outputs: [sharedKey] },
            { id: "image-b", createdAt: 20, status: "success", trashedAt: 60, outputs: [sharedKey, sharedKey] },
        ],
    });

    const result = await memory.trash.purge([
        { kind: "image", id: "image-a" },
        { kind: "image", id: "image-b" },
        { kind: "image", id: "image-a" },
    ]);

    assert.deepEqual(result.deletedFiles, [sharedKey]);
    assert.deepEqual(result.protectedFiles, []);
    assert.deepEqual(memory.deletedBatches, [[sharedKey]]);
    assert.deepEqual(result.purged, [
        { kind: "image", id: "image-a" },
        { kind: "image", id: "image-b" },
    ]);
});

test("彻底删除先收集保护键，再写入最小 tombstone 并删除输出而非参考素材", async () => {
    const memory = createMemoryTrash({
        image: [
            {
                id: "image-tombstone",
                createdAt: 10,
                updatedAt: 20,
                trashedAt: 30,
                status: "success",
                title: "不应保留",
                prompt: "不应保留",
                outputs: ["image:result"],
                references: [{ storageKey: "image:reference" }],
            },
        ],
    });

    const result = await memory.trash.purge([{ kind: "image", id: "image-tombstone" }]);

    assert.deepEqual(memory.image.get("image-tombstone"), {
        id: "image-tombstone",
        createdAt: 10,
        updatedAt: 100,
        trashedAt: 30,
        purgedAt: 100,
        formerOutputStorageKeys: ["image:result"],
    });
    assert.deepEqual(result.deletedFiles, ["image:result"]);
    assert.deepEqual(memory.deletedBatches, [["image:result"]]);
    assert.equal(memory.deletedBatches.flat().includes("image:reference"), false);
    const saveIndex = memory.events.indexOf("save:image:image-tombstone");
    const protectionReadIndex = memory.events.lastIndexOf("list:image");
    const deleteIndex = memory.events.indexOf("delete:image:result");
    assert.ok(protectionReadIndex >= 0 && protectionReadIndex < saveIndex && saveIndex < deleteIndex);
    assert.deepEqual(await memory.trash.listTrash(), []);
});

test("底层文件拒绝删除时按受保护文件返回", async () => {
    const key = "workspace:assets/images/protected.png";
    const memory = createMemoryTrash({ image: [{ id: "image-protected", createdAt: 10, trashedAt: 20, outputs: [key] }] }, [key]);

    const result = await memory.trash.purge([{ kind: "image", id: "image-protected" }]);

    assert.deepEqual(result.deletedFiles, []);
    assert.deepEqual(result.protectedFiles, [key]);
});

test("文件删除失败时保留墓碑并返回失败文件，不伪装成可恢复记录", async () => {
    const memory = createMemoryTrash({ image: [{ id: "image-retry", createdAt: 10, trashedAt: 20, title: "可重试", outputs: ["image:retry"] }] }, [], true);

    const result = await memory.trash.purge([{ kind: "image", id: "image-retry" }]);

    assert.deepEqual(result.failedFiles, ["image:retry"]);
    assert.equal(memory.image.get("image-retry")?.purgedAt, 100);
    assert.equal((await memory.trash.listTrash()).length, 0);
});

test("部分文件删除失败时仅报告失败项，且保留墓碑", async () => {
    const memory = createMemoryTrash({ image: [{ id: "image-partial", createdAt: 10, trashedAt: 20, outputs: ["image:deleted", "image:failed"] }] }, [], false, false, ["image:failed"]);

    const result = await memory.trash.purge([{ kind: "image", id: "image-partial" }]);

    assert.deepEqual(result.deletedFiles, ["image:deleted"]);
    assert.deepEqual(result.failedFiles, ["image:failed"]);
    assert.deepEqual(result.protectedFiles, []);
    assert.equal(memory.image.get("image-partial")?.purgedAt, 100);
});

test("保护键扫描失败时不写墓碑也不删除文件", async () => {
    const memory = createMemoryTrash({ image: [{ id: "image-scan-failed", createdAt: 10, trashedAt: 20, title: "保留原记录", outputs: ["image:scan-failed"] }] }, [], false, true);

    await assert.rejects(() => memory.trash.purge([{ kind: "image", id: "image-scan-failed" }]), /scan failed/);

    assert.equal(memory.image.get("image-scan-failed")?.purgedAt, undefined);
    assert.equal((memory.image.get("image-scan-failed") as TestRecord | undefined)?.title, "保留原记录");
    assert.deepEqual(memory.deletedBatches, []);
});

test("批量软删除部分写入失败时等待其他写入结束并回滚全部记录", async () => {
    const memory = createMemoryTrash(
        {
            image: [
                { id: "image-delayed", createdAt: 10, outputs: ["image:delayed"] },
                { id: "image-failed", createdAt: 20, outputs: ["image:failed"] },
            ],
        },
        [],
        false,
        false,
        [],
        ["image:image-failed"],
        ["image:image-delayed"],
    );

    await assert.rejects(() => memory.trash.move([
        { kind: "image", id: "image-delayed" },
        { kind: "image", id: "image-failed" },
    ]), /save failed/);

    assert.equal(memory.image.get("image-delayed")?.trashedAt, undefined);
    assert.equal(memory.image.get("image-failed")?.trashedAt, undefined);
});

test("批量永久删除部分墓碑写入失败时回滚全部记录且不删除文件", async () => {
    const memory = createMemoryTrash(
        {
            image: [
                { id: "image-delayed", createdAt: 10, trashedAt: 30, outputs: ["image:delayed"] },
                { id: "image-failed", createdAt: 20, trashedAt: 40, outputs: ["image:failed"] },
            ],
        },
        [],
        false,
        false,
        [],
        ["image:image-failed"],
        ["image:image-delayed"],
    );

    await assert.rejects(() => memory.trash.purge([
        { kind: "image", id: "image-delayed" },
        { kind: "image", id: "image-failed" },
    ]), /save failed/);

    assert.equal(memory.image.get("image-delayed")?.purgedAt, undefined);
    assert.equal(memory.image.get("image-failed")?.purgedAt, undefined);
    assert.deepEqual(memory.deletedBatches, []);
});

test("批量回滚不会覆盖不属于当前事务的墓碑", async () => {
    const memory = createMemoryTrash(
        {
            image: [
                { id: "image-changed", createdAt: 10, trashedAt: 30, outputs: ["image:changed"] },
                { id: "image-failed", createdAt: 20, trashedAt: 40, outputs: ["image:failed"] },
            ],
        },
        [],
        false,
        false,
        [],
        ["image:image-failed"],
        ["image:image-changed"],
        ["image:image-changed"],
    );

    await assert.rejects(
        () => memory.trash.purge([
            { kind: "image", id: "image-changed" },
            { kind: "image", id: "image-failed" },
        ]),
        /部分记录无法回滚/,
    );

    assert.equal(memory.image.get("image-changed")?.purgedAt, 101);
    assert.deepEqual(memory.deletedBatches, []);
});

function createMemoryTrash(
    initial: { image?: TestRecord[]; video?: TestRecord[] },
    protectedDeletes: string[] = [],
    failDelete = false,
    failProtectionScan = false,
    failedDeletes: string[] = [],
    failedInitialSaves: string[] = [],
    delayedInitialSaves: string[] = [],
    changedBeforeRollback: string[] = [],
) {
    const image = new Map<string, GenerationTrashStoredRecord<TestRecord>>((initial.image || []).map((record) => [record.id, record]));
    const video = new Map<string, GenerationTrashStoredRecord<TestRecord>>((initial.video || []).map((record) => [record.id, record]));
    const saved: Array<{ kind: GenerationRecordKind; id: string }> = [];
    const deletedBatches: string[][] = [];
    const events: string[] = [];
    const saveAttempts = new Map<string, number>();
    let timestamp = 100;
    const store = (kind: GenerationRecordKind, records: Map<string, GenerationTrashStoredRecord<TestRecord>>): GenerationTrashRecordStore<TestRecord> => ({
        async list() {
            events.push(`list:${kind}`);
            return [...records.values()];
        },
        async save(record) {
            const key = `${kind}:${record.id}`;
            const attempt = (saveAttempts.get(key) || 0) + 1;
            saveAttempts.set(key, attempt);
            events.push(`save:${kind}:${record.id}`);
            saved.push({ kind, id: record.id });
            if (attempt === 1 && delayedInitialSaves.includes(key)) await new Promise<void>((resolve) => setImmediate(resolve));
            if (attempt === 1 && failedInitialSaves.includes(key)) throw new Error("save failed");
            records.set(record.id, record);
        },
        async rollback(record, expected) {
            const key = `${kind}:${record.id}`;
            let current = records.get(record.id);
            events.push(`rollback:${kind}:${record.id}`);
            if (!current) throw new Error("rollback record missing");
            if (expected.purgedAt !== undefined) {
                if (current.purgedAt === undefined) return;
                if (changedBeforeRollback.includes(key) && current.purgedAt === expected.purgedAt) {
                    current = { ...current, updatedAt: expected.updatedAt! + 1, purgedAt: expected.purgedAt + 1 };
                    records.set(record.id, current);
                }
                if (!matchesExpectedGenerationTombstone(current, expected)) throw new Error("rollback tombstone mismatch");
            }
            records.set(record.id, record);
        },
        outputStorageKeys: (record) => record.outputs || [],
        inputStorageKeys: (record) => (record.references || []).map((item) => item.storageKey),
        referencedStorageKeys: (record) => [...(record.outputs || []), ...(record.references || []).map((item) => item.storageKey)],
    });
    const trash = createGenerationTrash({
        image: store("image", image),
        video: store("video", video),
        now: () => timestamp,
        additionalProtectedStorageKeys: failProtectionScan
            ? async () => {
                  throw new Error("scan failed");
              }
            : undefined,
        async deleteOutputs(keys) {
            const batch = [...keys];
            events.push(`delete:${batch.join(",")}`);
            deletedBatches.push(batch);
            if (failDelete) throw new Error("delete failed");
            return {
                deleted: batch.filter((key) => !protectedDeletes.includes(key) && !failedDeletes.includes(key)),
                protected: batch.filter((key) => protectedDeletes.includes(key)),
                failed: batch.filter((key) => failedDeletes.includes(key)),
            };
        },
    });
    return { trash, image, video, saved, deletedBatches, events, setNow: (value: number) => (timestamp = value) };
}
