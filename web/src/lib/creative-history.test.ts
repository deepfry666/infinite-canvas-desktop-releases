import assert from "node:assert/strict";
import test from "node:test";

import { assertCreativeHistorySnapshot, resolveProjectTitles, summarizeCreativeHistory } from "./creative-history.ts";

const validEntry = {
    eventId: "event-1",
    schemaVersion: 1,
    occurredAt: 100,
    recordedAt: 101,
    category: "image",
    source: "canvas",
    operation: "generate",
    status: "partial",
    requestedCount: 3,
    successCount: 1,
    failureCount: 1,
    canceledCount: 1,
};

function snapshot(entry: Record<string, unknown> = validEntry) {
    return { schemaVersion: 1, startedAt: 100, entries: [entry] };
}

test("创作历史接受合法的部分成功和取消记录", () => {
    assert.doesNotThrow(() => assertCreativeHistorySnapshot(snapshot(), 1));
    assert.doesNotThrow(() => assertCreativeHistorySnapshot(snapshot({ ...validEntry, status: "canceled", requestedCount: 2, successCount: 0, failureCount: 0, canceledCount: 2 }), 1));
});

test("创作历史拒绝非法枚举和缺失的必需字段", () => {
    for (const field of ["category", "source", "operation", "status"] as const) {
        assert.throws(() => assertCreativeHistorySnapshot(snapshot({ ...validEntry, [field]: "invalid" }), 1), /数据损坏/);
    }
    const { eventId: _eventId, ...withoutEventId } = validEntry;
    assert.throws(() => assertCreativeHistorySnapshot(snapshot(withoutEventId), 1), /数据损坏/);
});

test("创作历史拒绝无效时间、计数和超过请求数的终态总数", () => {
    for (const time of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        assert.throws(() => assertCreativeHistorySnapshot({ ...snapshot(), startedAt: time }, 1), /数据损坏/);
        assert.throws(() => assertCreativeHistorySnapshot({ ...snapshot(), clearedAt: time }, 1), /数据损坏/);
        assert.throws(() => assertCreativeHistorySnapshot(snapshot({ ...validEntry, occurredAt: time }), 1), /数据损坏/);
        assert.throws(() => assertCreativeHistorySnapshot(snapshot({ ...validEntry, recordedAt: time }), 1), /数据损坏/);
    }
    for (const field of ["requestedCount", "successCount", "failureCount", "canceledCount", "characterCount"] as const) {
        for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
            assert.throws(() => assertCreativeHistorySnapshot(snapshot({ ...validEntry, [field]: value }), 1), /数据损坏/);
        }
    }
    assert.throws(() => assertCreativeHistorySnapshot(snapshot({ ...validEntry, requestedCount: 2 }), 1), /数据损坏/);
});

test("已删除项目使用最新非空标题，当前项目标题始终优先", () => {
    const titles = resolveProjectTitles(
        [{ id: "current", title: "当前名称" }],
        [
            { projectId: "deleted", projectTitle: "较早名称", occurredAt: 10 },
            { projectId: "deleted", projectTitle: "  ", occurredAt: 30 },
            { projectId: "deleted", projectTitle: "最新名称", occurredAt: 20 },
            { projectId: "current", projectTitle: "历史新名称", occurredAt: 40 },
        ],
    );

    assert.equal(titles.get("deleted"), "最新名称");
    assert.equal(titles.get("current"), "当前名称");
});

test("创作历史汇总覆盖图片、文字、视频、音频和提示词润色", () => {
    const history = summarizeCreativeHistory([
        { category: "image", operation: "generate", requestedCount: 3, successCount: 2, failureCount: 1, canceledCount: 0 },
        { category: "text", operation: "text-create", successCount: 1, characterCount: 12 },
        { category: "video", operation: "generate", successCount: 2 },
        { category: "audio", operation: "generate", successCount: 3 },
        { category: "prompt", operation: "prompt-polish", successCount: 4 },
        { category: "prompt", operation: "generate", successCount: 5 },
    ]);

    assert.deepEqual(history, {
        activities: 6,
        requestedImages: 3,
        successImages: 2,
        failedImages: 1,
        canceledImages: 0,
        successVideos: 2,
        successAudios: 3,
        successfulPromptPolishes: 4,
        textEntries: 1,
        textCharacters: 12,
    });
});
