import assert from "node:assert/strict";
import test from "node:test";

import { shouldCanvasHandleWheel } from "./wheel-routing.ts";

test("可滚动节点内容接管滚轮，不触发画布缩放", () => {
    const target = { closest: (selector: string) => selector.includes("data-canvas-no-zoom") ? {} : null };
    assert.equal(shouldCanvasHandleWheel(target), false);
    assert.equal(shouldCanvasHandleWheel(target, true), false);
});

test("文本节点允许组合键滚轮穿透到画布缩放", () => {
    const target = { closest: (selector: string) => selector.includes("data-canvas-modified-wheel") ? {} : selector.includes("data-canvas-no-zoom") ? {} : null };
    assert.equal(shouldCanvasHandleWheel(target, true), true);
    assert.equal(shouldCanvasHandleWheel(target), false);
});

test("画布背景仍由画布处理滚轮", () => {
    assert.equal(shouldCanvasHandleWheel({ closest: () => null }), true);
});
