import assert from "node:assert/strict";
import test from "node:test";

import { runGenerationLogOperation } from "./generation-log-operation.ts";

test("生成记录操作串行执行且前一项失败后队列仍继续", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const events: string[] = [];
    const first = runGenerationLogOperation(async () => {
        events.push("first:start");
        await gate;
        events.push("first:end");
    });
    const second = runGenerationLogOperation(async () => {
        events.push("second");
        throw new Error("expected failure");
    });
    const third = runGenerationLogOperation(async () => {
        events.push("third");
        return 3;
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(events, ["first:start"]);
    release();
    await first;
    await assert.rejects(second, /expected failure/);
    assert.equal(await third, 3);
    assert.deepEqual(events, ["first:start", "first:end", "second", "third"]);
});
