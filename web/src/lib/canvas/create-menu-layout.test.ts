import assert from "node:assert/strict";
import test from "node:test";

import { canvasPointToScreen, resolveCanvasMenuLayout } from "./create-menu-layout.ts";

test("画布菜单锚点随视口变换转换为屏幕坐标", () => {
    assert.deepEqual(canvasPointToScreen({ x: 200, y: 100 }, { x: -20, y: 30, k: 0.5 }), { x: 80, y: 80 });
    assert.deepEqual(canvasPointToScreen({ x: 40, y: 60 }, { x: 100, y: -50, k: 2 }), { x: 180, y: 70 });
});

test("画布菜单在四角翻转并保持在安全区内", () => {
    const size = { width: 800, height: 600 };
    assert.deepEqual(resolveCanvasMenuLayout({ x: 20, y: 20 }, size), { left: 20, top: 20, width: 300, maxHeight: 568 });
    assert.deepEqual(resolveCanvasMenuLayout({ x: 780, y: 20 }, size), { right: 20, top: 20, width: 300, maxHeight: 568 });
    assert.deepEqual(resolveCanvasMenuLayout({ x: 20, y: 580 }, size), { left: 20, bottom: 20, width: 300, maxHeight: 568 });
    assert.deepEqual(resolveCanvasMenuLayout({ x: 780, y: 580 }, size), { right: 20, bottom: 20, width: 300, maxHeight: 568 });
});

test("窄画布会收窄菜单而不会横向越界", () => {
    assert.deepEqual(resolveCanvasMenuLayout({ x: 90, y: 200 }, { width: 180, height: 400 }), { left: 12, top: 200, width: 156, maxHeight: 188 });
});

test("画布外的锚点会夹取到最近的安全边缘", () => {
    const size = { width: 800, height: 600 };
    assert.deepEqual(resolveCanvasMenuLayout({ x: -100, y: -80 }, size), { left: 12, top: 12, width: 300, maxHeight: 576 });
    assert.deepEqual(resolveCanvasMenuLayout({ x: 900, y: 680 }, size), { right: 12, bottom: 12, width: 300, maxHeight: 576 });
});
