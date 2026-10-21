import assert from "node:assert/strict";
import test from "node:test";

import { decideWindowClose } from "./window-close-policy.mjs";

test("默认关闭行为隐藏到托盘，不中断正在运行的任务", () => {
  assert.equal(decideWindowClose({ behavior: "tray", activeGenerationCount: 3, quitting: false }), "hide-to-tray");
});

test("直接退出在有任务时确认，空闲时立即退出", () => {
  assert.equal(decideWindowClose({ behavior: "quit", activeGenerationCount: 2, quitting: false }), "confirm-quit");
  assert.equal(decideWindowClose({ behavior: "quit", activeGenerationCount: 0, quitting: false }), "quit");
  assert.equal(decideWindowClose({ behavior: "tray", activeGenerationCount: 2, quitting: true }), "quit");
});
