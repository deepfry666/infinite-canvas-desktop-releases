import assert from "node:assert/strict";
import test from "node:test";

import { beginThemeViewTransition, cancelThemeViewTransition, isThemeViewTransitionActive } from "./view-transition-ownership.ts";

test("路由抢占快照前同步跳过主题过渡并清理 ownership", (context) => {
    const originalDocument = globalThis.document;
    const documentElement = {
        dataset: { magicuiThemeVt: "active" } as Record<string, string>,
        style: { removeProperty: () => undefined },
    };
    Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement } });
    context.after(() => Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument }));

    let skipped = 0;
    let cleaned = 0;
    const session = beginThemeViewTransition(() => {
        delete documentElement.dataset.magicuiThemeVt;
        cleaned += 1;
    });
    session.attach({ skipTransition: () => { skipped += 1; } });

    assert.equal(isThemeViewTransitionActive(), true);
    assert.equal(cancelThemeViewTransition(), true);
    assert.equal(skipped, 1);
    assert.equal(cleaned, 1);
    assert.equal(isThemeViewTransitionActive(), false);
    assert.equal(cancelThemeViewTransition(), false);

});

test("浏览器拒绝 skipTransition 时仍释放主题 ownership", (context) => {
    const originalDocument = globalThis.document;
    const documentElement = {
        dataset: { magicuiThemeVt: "active" } as Record<string, string>,
        style: { removeProperty: () => undefined },
    };
    Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement } });
    context.after(() => Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument }));

    const session = beginThemeViewTransition(() => delete documentElement.dataset.magicuiThemeVt);
    session.attach({ skipTransition: () => { throw new Error("invalidated"); } });

    assert.doesNotThrow(() => cancelThemeViewTransition());
    assert.equal(isThemeViewTransitionActive(), false);
});

test("没有活动 session 时也会清理遗留的主题快照标记", (context) => {
    const originalDocument = globalThis.document;
    const removed: string[] = [];
    const documentElement = {
        dataset: { magicuiThemeVt: "active" } as Record<string, string>,
        style: { removeProperty: (name: string) => { removed.push(name); } },
    };
    Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement } });
    context.after(() => Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument }));

    assert.equal(cancelThemeViewTransition(), true);
    assert.equal(isThemeViewTransitionActive(), false);
    assert.deepEqual(removed, ["--magicui-theme-toggle-vt-duration", "--magicui-theme-vt-clip-from"]);
});
