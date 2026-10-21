import assert from "node:assert/strict";
import test from "node:test";

import { placeFloatingToolbar, resolvePromptPanelLayout } from "./floating-toolbar-layout.ts";

test("画布首开时空节点不会读取提示面板布局", () => {
    assert.equal(resolvePromptPanelLayout(null, null, null), undefined);

    const layout = { nodeId: "node-1", placement: "above" as const, top: 100, bottom: 320 };
    assert.equal(resolvePromptPanelLayout(layout, "node-1", "node-1"), layout);
    assert.equal(resolvePromptPanelLayout(layout, null, "node-1"), undefined);
    assert.equal(resolvePromptPanelLayout(layout, "node-1", null), undefined);
});

test("靠近画布左右边缘的节点工具条始终保持在可见区域", () => {
    assert.deepEqual(placeFloatingToolbar({ anchorX: 20, nodeTop: 220, nodeBottom: 460, toolbarWidth: 420, toolbarHeight: 48, viewportWidth: 900, viewportHeight: 700 }), { left: 12, top: 158, compact: false });
    assert.deepEqual(placeFloatingToolbar({ anchorX: 880, nodeTop: 220, nodeBottom: 460, toolbarWidth: 420, toolbarHeight: 48, viewportWidth: 900, viewportHeight: 700 }), { left: 468, top: 158, compact: false });
});

test("工具条比可用画布宽时改为紧凑图标并占满安全区域", () => {
    assert.deepEqual(placeFloatingToolbar({ anchorX: 320, nodeTop: 80, nodeBottom: 320, toolbarWidth: 760, toolbarHeight: 48, viewportWidth: 640, viewportHeight: 520 }), { left: 12, top: 334, compact: true });
});

test("节点移出上下边缘后工具条仍停留在可见区域", () => {
    assert.equal(placeFloatingToolbar({ anchorX: 400, nodeTop: 900, nodeBottom: 1140, toolbarWidth: 320, toolbarHeight: 48, viewportWidth: 800, viewportHeight: 700 }).top, 568);
});

test("提示面板被边缘夹住时工具条避让其实际占用区域", () => {
    assert.equal(placeFloatingToolbar({ anchorX: 400, nodeTop: 900, nodeBottom: 1140, toolbarWidth: 320, toolbarHeight: 48, viewportWidth: 800, viewportHeight: 700, placement: "below", blockedRect: { top: 380, bottom: 616 } }).top, 318);
    assert.equal(placeFloatingToolbar({ anchorX: 400, nodeTop: -440, nodeBottom: -200, toolbarWidth: 320, toolbarHeight: 48, viewportWidth: 800, viewportHeight: 700, placement: "above", blockedRect: { top: 72, bottom: 308 } }).top, 322);
});

test("短窗口仍为顶部栏与底部 Dock 保留固定安全区域", () => {
    const result = placeFloatingToolbar({ anchorX: 240, nodeTop: 100, nodeBottom: 200, toolbarWidth: 260, toolbarHeight: 48, viewportWidth: 480, viewportHeight: 320 });
    assert.ok(result.top >= 72);
    assert.ok(result.top + 48 <= 236);
});
