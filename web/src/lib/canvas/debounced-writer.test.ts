import assert from "node:assert/strict";
import test from "node:test";

import { createDebouncedWriter } from "./debounced-writer.ts";

test("显式排空只保存尚未开始写入的最新画布快照", async () => {
    const writes: number[] = [];
    const writer = createDebouncedWriter<number>(async (value) => { writes.push(value); });

    writer.schedule(1);
    writer.schedule(2);
    await writer.flush();

    assert.deepEqual(writes, [2]);
});

test("排空期间产生的新快照会在旧写入之后落盘", async () => {
    const writes: number[] = [];
    let firstStarted: () => void = () => undefined;
    let releaseFirst: () => void = () => undefined;
    const started = new Promise<void>((resolve) => { firstStarted = resolve; });
    const release = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const writer = createDebouncedWriter<number>(async (value) => {
        writes.push(value);
        if (value === 1) {
            firstStarted();
            await release;
        }
    });

    writer.schedule(1);
    const flushing = writer.flush();
    await started;
    writer.schedule(2);
    releaseFirst();
    await flushing;

    assert.deepEqual(writes, [1, 2]);
});

test("写入失败会保留最新快照供下次排空重试", async () => {
    let attempts = 0;
    const writer = createDebouncedWriter<number>(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("磁盘不可写");
    });

    writer.schedule(1);
    await assert.rejects(() => writer.flush(), /磁盘不可写/);
    await writer.flush();

    assert.equal(attempts, 2);
});

test("旧写入失败不能在并发排空后覆盖更新的画布快照", async () => {
    const writes: string[] = [];
    let rejectOld: (reason: Error) => void = () => undefined;
    let oldStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => { oldStarted = resolve; });
    const oldWrite = new Promise<void>((_resolve, reject) => { rejectOld = reject; });
    const writer = createDebouncedWriter<string>(async (value) => {
        writes.push(value);
        if (value === "old") {
            oldStarted();
            await oldWrite;
        }
    });

    writer.schedule("old");
    const firstFlush = writer.flush();
    await started;
    writer.schedule("new");
    const secondFlush = writer.flush();
    rejectOld(new Error("旧快照写入失败"));

    await assert.rejects(() => firstFlush, /旧快照写入失败/);
    await secondFlush;
    await writer.flush();

    assert.deepEqual(writes, ["old", "new"]);
});
