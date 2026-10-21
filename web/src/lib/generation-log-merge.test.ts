import assert from "node:assert/strict";
import test from "node:test";

import {
    assertStoredGenerationLog,
    matchesExpectedGenerationTombstone,
    mergeGenerationLogsById,
    resolveGenerationLogWrite,
    type MergeableGenerationLog,
} from "./generation-log-merge.ts";

type TestLog = MergeableGenerationLog & { status?: string; title?: string };

test("本地永久删除墓碑不会被时间戳更晚的远端旧记录复活", () => {
    const tombstone: TestLog = { id: "image-1", createdAt: 10, updatedAt: 100, purgedAt: 100 };
    const remoteRecord: TestLog = { id: "image-1", createdAt: 10, updatedAt: 1_000, status: "success" };

    assert.deepEqual(mergeGenerationLogsById([tombstone], [remoteRecord]), [tombstone]);
});

test("远端永久删除墓碑不会被时间戳更晚的本地旧记录复活", () => {
    const localRecord: TestLog = { id: "video-1", createdAt: 10, updatedAt: 1_000, status: "success" };
    const tombstone: TestLog = { id: "video-1", createdAt: 10, updatedAt: 100, purgedAt: 100 };

    assert.deepEqual(mergeGenerationLogsById([localRecord], [tombstone]), [tombstone]);
});

test("相同删除状态仍按更新时间合并并忽略无标识记录", () => {
    const older = { id: "image-1", createdAt: 10, updatedAt: 20, title: "旧" };
    const newer = { id: "image-1", createdAt: 10, updatedAt: 30, title: "新" };
    const second = { id: "image-2", createdAt: 40, title: "第二条" };

    assert.deepEqual(mergeGenerationLogsById([newer, second, { createdAt: 100 }], [older]), [second, newer]);
});

test("普通持久化写入不能用活记录覆盖现有墓碑", () => {
    const tombstone: TestLog = { id: "image-1", createdAt: 10, updatedAt: 100, purgedAt: 100 };
    const active: TestLog = { id: "image-1", createdAt: 10, updatedAt: 1_000, status: "success" };

    assert.equal(resolveGenerationLogWrite(tombstone, active), tombstone);
    assert.equal(resolveGenerationLogWrite(active, tombstone), tombstone);
});

test("回滚校验只接受当前事务写入的完整墓碑标识", () => {
    const expected = { id: "image-1", createdAt: 10, updatedAt: 100, purgedAt: 100, formerOutputStorageKeys: ["image:a"] };

    assert.equal(matchesExpectedGenerationTombstone({ ...expected }, expected), true);
    assert.equal(matchesExpectedGenerationTombstone({ ...expected, purgedAt: 101 }, expected), false);
    assert.equal(matchesExpectedGenerationTombstone({ ...expected, formerOutputStorageKeys: ["image:b"] }, expected), false);
    assert.equal(matchesExpectedGenerationTombstone({ id: "image-1", createdAt: 10, updatedAt: 101 }, expected), false);
});

test("持久化记录损坏或存储键与 id 不一致时拒绝继续删除", () => {
    assert.doesNotThrow(() => assertStoredGenerationLog("image-1", { id: "image-1", createdAt: 10 }));
    assert.throws(() => assertStoredGenerationLog("image-1", null), /结构损坏/);
    assert.throws(() => assertStoredGenerationLog("image-1", { storageKey: "image:shared" }), /结构损坏/);
    assert.throws(() => assertStoredGenerationLog("image-1", { id: "image-2", storageKey: "image:shared" }), /结构损坏/);
});
