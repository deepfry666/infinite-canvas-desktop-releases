import assert from "node:assert/strict";
import test from "node:test";

import type { RouteTransitionTransaction } from "./app-shell-state.ts";
import {
    applyAutomaticRouteTransitionCapture,
    createAutomaticRouteTransitionPopStateHandler,
    installAutomaticRouteTransitionPopStateBridge,
} from "./route-transition-history.ts";

const automaticBackward = {
    id: 1,
    fromPathname: "/video",
    toPathname: "/image",
    direction: "backward",
    driver: "view-transition",
    capture: "automatic",
    phase: "prepared",
} satisfies RouteTransitionTransaction;

test("POP bridge 在路由监听继续前完成主题取消、事务预备和旧快照命名", () => {
    const events: string[] = [];
    const handler = createAutomaticRouteTransitionPopStateHandler({
        getCommittedPathname: () => "/video",
        getLocationPathname: () => "/image",
        hasAutomaticTransition: () => false,
        cancelThemeTransition: () => { events.push("cancel-theme"); },
        prepareTransition: (fromPathname, toPathname) => {
            events.push(`prepare:${fromPathname}->${toPathname}`);
            return automaticBackward;
        },
        captureTransition: (transaction) => { events.push(`capture:${transaction?.direction}`); },
    });

    handler();

    assert.deepEqual(events, ["cancel-theme", "prepare:/video->/image", "capture:backward"]);
});

test("POP bridge 重复安装时只保留最新监听，旧 cleanup 不会删除新监听", () => {
    const target = new EventTarget();
    const calls: string[] = [];
    const dependencies = (label: string) => ({
        getCommittedPathname: () => "/video",
        getLocationPathname: () => "/image",
        hasAutomaticTransition: () => false,
        cancelThemeTransition: () => { calls.push(`${label}:cancel`); },
        prepareTransition: () => automaticBackward,
        captureTransition: () => undefined,
    });

    const disposeOld = installAutomaticRouteTransitionPopStateBridge(target as unknown as Window, dependencies("old"));
    const disposeNew = installAutomaticRouteTransitionPopStateBridge(target as unknown as Window, dependencies("new"));
    disposeOld();
    target.dispatchEvent(new Event("popstate"));
    disposeNew();
    target.dispatchEvent(new Event("popstate"));

    assert.deepEqual(calls, ["new:cancel"]);
});

test("首个 POP 尚未提交时，立即反向使用上一个浏览器目标作为真实起点", () => {
    let locationPathname = "/";
    let automaticTransition = false;
    const pairs: string[] = [];
    const handler = createAutomaticRouteTransitionPopStateHandler({
        getCommittedPathname: () => "/",
        getLocationPathname: () => locationPathname,
        hasAutomaticTransition: () => automaticTransition,
        cancelThemeTransition: () => undefined,
        prepareTransition: (fromPathname, toPathname) => {
            pairs.push(`${fromPathname}->${toPathname}`);
            automaticTransition = true;
            return automaticBackward;
        },
        captureTransition: () => undefined,
    });

    locationPathname = "/image";
    handler();
    locationPathname = "/";
    handler();

    assert.deepEqual(pairs, ["/->/image", "/image->/"]);
});

test("旧 DOM 在 View Transition 捕获前同步获得方向、侧栏与移动顶栏快照名", () => {
    const elements = new Map([
        ["[data-route-stage]", { style: { viewTransitionName: "route-auto" } }],
        ["[data-route-sidebar]", { style: { viewTransitionName: "none" } }],
        ["[data-route-mobile-header]", { style: { viewTransitionName: "none" } }],
    ]);
    const target = {
        querySelector: (selector: string) => elements.get(selector) ?? null,
    } as unknown as Document;

    applyAutomaticRouteTransitionCapture(target, automaticBackward);

    assert.equal(elements.get("[data-route-stage]")?.style.viewTransitionName, "route-backward");
    assert.equal(elements.get("[data-route-sidebar]")?.style.viewTransitionName, "app-sidebar");
    assert.equal(elements.get("[data-route-mobile-header]")?.style.viewTransitionName, "app-mobile-header");
});
