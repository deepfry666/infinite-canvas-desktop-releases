import assert from "node:assert/strict";
import test from "node:test";

import { createImageWorkbenchStore } from "./use-image-workbench-store.ts";

test("生图页面离开后当前任务与结果仍由全局会话保留", () => {
    const store = createImageWorkbenchStore();
    store.getState().setPrompt("保留当前创作");
    store.getState().setActiveLogId("log-1");
    store.getState().setRunning(true);
    store.getState().setResults([{ id: "slot-1", status: "pending" }]);

    const unsubscribe = store.subscribe(() => undefined);
    unsubscribe();
    store.getState().setResults([{ id: "slot-1", status: "success", image: { id: "image-1", dataUrl: "workspace://local/result.png", durationMs: 1000, width: 1024, height: 1024, bytes: 8 } }]);
    store.getState().setRunning(false);

    assert.equal(store.getState().prompt, "保留当前创作");
    assert.equal(store.getState().results[0].status, "success");
    assert.equal(store.getState().activeLogId, "log-1");
    assert.equal(store.getState().running, false);
});
