import assert from "node:assert/strict";
import test from "node:test";

import {
    HOME_CONTENT_GATE_X,
    SIDEBAR_WIDTH,
    claimRouteTransition,
    deriveSidebarPresentation,
    discardPendingRouteTransition,
    enqueueRouteTransition,
    finishRouteTransition,
    getRouteShellKind,
    getRouteTransitionDirection,
    markRouteTransitionRunning,
    getRouteTransitionViewName,
    planCommittedRouteTransition,
    planRouteTransition,
    reduceSidebarState,
    selectRouteTransitionForCapture,
    updateSidebarHoldOwners,
    type RouteTransitionState,
    type RouteTransitionTransaction,
    type SidebarState,
} from "./app-shell-state.ts";

test("从普通页面返回首页时保留 224px 侧栏槽位", () => {
    const initial: SidebarState = { kind: "route-docked" };
    const state = reduceSidebarState(initial, { type: "ROUTE_COMMITTED", fromPathname: "/image", toPathname: "/" });

    assert.deepEqual(state, { kind: "home-return-docked" });
    assert.equal(deriveSidebarPresentation(state, "home").slotWidth, SIDEBAR_WIDTH);
});

test("暂时停靠侧栏仅越过边界时不启动收回", () => {
    const state: SidebarState = { kind: "home-return-docked" };

    assert.deepEqual(reduceSidebarState(state, { type: "SIDEBAR_LEAVE", token: 1 }), state);
});

test("指针进入首页内容命中区后才进入等待收回", () => {
    const state = reduceSidebarState(
        { kind: "home-return-docked" },
        { type: "HOME_CONTENT_GATE_ENTER", token: 7 },
    );

    assert.equal(HOME_CONTENT_GATE_X, 352);
    assert.deepEqual(state, { kind: "home-close-pending", origin: "docked", token: 7 });
});

test("等待收回期间返回侧栏会取消收回并忽略旧计时器", () => {
    const pending: SidebarState = { kind: "home-close-pending", origin: "docked", token: 7 };
    const reopened = reduceSidebarState(pending, { type: "SIDEBAR_ENTER" });

    assert.deepEqual(reopened, { kind: "home-return-docked" });
    assert.deepEqual(reduceSidebarState(reopened, { type: "GRACE_ELAPSED", token: 7 }), reopened);
});

test("暂时停靠进入收回时同步释放槽位", () => {
    const pending: SidebarState = { kind: "home-close-pending", origin: "docked", token: 8 };
    const closing = reduceSidebarState(pending, { type: "GRACE_ELAPSED", token: 8 });
    const presentation = deriveSidebarPresentation(closing, "home");

    assert.deepEqual(closing, { kind: "home-closing", origin: "docked", token: 8 });
    assert.equal(presentation.slotWidth, 0);
    assert.equal(presentation.exiting, true);
});

test("首页隐藏侧栏不可交互且只显示宽容热区", () => {
    const presentation = deriveSidebarPresentation({ kind: "home-hidden" }, "home");

    assert.deepEqual(presentation, {
        slotWidth: 0,
        visible: false,
        interactive: false,
        ariaHidden: true,
        showHotzone: true,
        showHotzoneHint: true,
        overlay: false,
        exiting: false,
    });
});

test("首页热区打开的侧栏是不占槽位的覆盖层", () => {
    const state = reduceSidebarState({ kind: "home-hidden" }, { type: "EDGE_OPEN" });
    const presentation = deriveSidebarPresentation(state, "home");

    assert.deepEqual(state, { kind: "home-overlay-open" });
    assert.equal(presentation.slotWidth, 0);
    assert.equal(presentation.visible, true);
    assert.equal(presentation.interactive, true);
    assert.equal(presentation.overlay, true);
    assert.equal(presentation.showHotzone, false);
    assert.equal(presentation.showHotzoneHint, false);
});

test("首页侧栏内部动作期间保持展开并在动作结束后恢复悬停模型", () => {
    const held = reduceSidebarState(
        { kind: "home-overlay-open" },
        { type: "SIDEBAR_HOLD" },
    );

    assert.deepEqual(held, { kind: "home-interaction-held", origin: "overlay", holds: 1 });
    assert.deepEqual(reduceSidebarState(held, { type: "HOME_CONTENT_GATE_ENTER", token: 10 }), held);
    assert.deepEqual(
        reduceSidebarState(held, { type: "SIDEBAR_RELEASE" }),
        { kind: "home-overlay-open" },
    );
});

test("覆盖侧栏在内部动作期间移出，最后释放时恢复容错收回", () => {
    const held = reduceSidebarState({ kind: "home-overlay-open" }, { type: "SIDEBAR_HOLD" });
    const left = reduceSidebarState(held, { type: "SIDEBAR_LEAVE", token: 9 });

    assert.deepEqual(left, { kind: "home-interaction-held", origin: "overlay", holds: 1, closeToken: 9 });
    assert.deepEqual(reduceSidebarState(left, { type: "SIDEBAR_RELEASE" }), { kind: "home-close-pending", origin: "overlay", token: 9 });
});

test("持有期间移出后重新进入侧栏会取消收回请求", () => {
    const left: SidebarState = { kind: "home-interaction-held", origin: "overlay", holds: 1, closeToken: 9 };
    const entered = reduceSidebarState(left, { type: "SIDEBAR_ENTER" });

    assert.deepEqual(entered, { kind: "home-interaction-held", origin: "overlay", holds: 1 });
    assert.deepEqual(reduceSidebarState(entered, { type: "SIDEBAR_RELEASE" }), { kind: "home-overlay-open" });
});

test("暂时停靠的首页侧栏在内部动作期间保留槽位", () => {
    const held = reduceSidebarState({ kind: "home-return-docked" }, { type: "SIDEBAR_HOLD" });

    assert.deepEqual(held, { kind: "home-interaction-held", origin: "docked", holds: 1 });
    assert.equal(deriveSidebarPresentation(held, "home").slotWidth, SIDEBAR_WIDTH);
    assert.deepEqual(reduceSidebarState(held, { type: "SIDEBAR_RELEASE" }), { kind: "home-return-docked" });
});

test("暂时停靠侧栏持有期间进入内容区，释放后继续容错收回", () => {
    const held = reduceSidebarState({ kind: "home-return-docked" }, { type: "SIDEBAR_HOLD" });
    const gated = reduceSidebarState(held, { type: "HOME_CONTENT_GATE_ENTER", token: 11 });

    assert.deepEqual(gated, { kind: "home-interaction-held", origin: "docked", holds: 1, closeToken: 11 });
    assert.deepEqual(reduceSidebarState(gated, { type: "SIDEBAR_RELEASE" }), { kind: "home-close-pending", origin: "docked", token: 11 });
});

test("持有期间按 Esc 仍可收回且旧释放事件不会重新打开", () => {
    const closing = reduceSidebarState(
        { kind: "home-interaction-held", origin: "overlay", holds: 1 },
        { type: "ESCAPE", token: 12 },
    );

    assert.deepEqual(closing, { kind: "home-closing", origin: "overlay", token: 12 });
    assert.deepEqual(reduceSidebarState(closing, { type: "SIDEBAR_RELEASE" }), closing);
});

test("重叠的侧栏内部动作必须全部结束后才恢复悬停模型", () => {
    const first = reduceSidebarState({ kind: "home-overlay-open" }, { type: "SIDEBAR_HOLD" });
    const second = reduceSidebarState(first, { type: "SIDEBAR_HOLD" });

    assert.deepEqual(second, { kind: "home-interaction-held", origin: "overlay", holds: 2 });
    assert.deepEqual(reduceSidebarState(second, { type: "SIDEBAR_RELEASE" }), { kind: "home-interaction-held", origin: "overlay", holds: 1 });
    assert.deepEqual(reduceSidebarState(reduceSidebarState(second, { type: "SIDEBAR_RELEASE" }), { type: "SIDEBAR_RELEASE" }), { kind: "home-overlay-open" });
});

test("侧栏内部动作按 owner 幂等持有与释放", () => {
    const owners = new Set<"config" | "theme">();

    assert.equal(updateSidebarHoldOwners(owners, "config", true), true);
    assert.equal(updateSidebarHoldOwners(owners, "config", true), false);
    assert.equal(updateSidebarHoldOwners(owners, "theme", true), true);
    assert.equal(owners.size, 2);
    assert.equal(updateSidebarHoldOwners(owners, "config", false), true);
    assert.equal(updateSidebarHoldOwners(owners, "config", false), false);
    assert.deepEqual([...owners], ["theme"]);
});

test("覆盖侧栏的等待与收回阶段都不改变首页宽度", () => {
    const pending = reduceSidebarState({ kind: "home-overlay-open" }, { type: "SIDEBAR_LEAVE", token: 9 });
    const closing = reduceSidebarState(pending, { type: "GRACE_ELAPSED", token: 9 });

    assert.deepEqual(pending, { kind: "home-close-pending", origin: "overlay", token: 9 });
    assert.equal(deriveSidebarPresentation(pending, "home").slotWidth, 0);
    assert.equal(deriveSidebarPresentation(pending, "home").overlay, true);
    assert.equal(deriveSidebarPresentation(closing, "home").slotWidth, 0);
    assert.equal(deriveSidebarPresentation(closing, "home").overlay, true);
});

test("收回中返回侧栏或热区会恢复原来的停靠方式", () => {
    assert.equal(deriveSidebarPresentation({ kind: "home-closing", origin: "docked", token: 3 }, "home").showHotzone, true);
    assert.equal(deriveSidebarPresentation({ kind: "home-closing", origin: "docked", token: 3 }, "home").showHotzoneHint, false);
    assert.deepEqual(reduceSidebarState({ kind: "home-closing", origin: "docked", token: 3 }, { type: "SIDEBAR_ENTER" }), { kind: "home-return-docked" });
    assert.deepEqual(reduceSidebarState({ kind: "home-closing", origin: "overlay", token: 4 }, { type: "EDGE_OPEN" }), { kind: "home-overlay-open" });
});

test("Esc 立即进入收回且只有匹配的结束事件能隐藏", () => {
    const closing = reduceSidebarState({ kind: "home-overlay-open" }, { type: "ESCAPE", token: 11 });
    assert.deepEqual(closing, { kind: "home-closing", origin: "overlay", token: 11 });
    assert.deepEqual(reduceSidebarState(closing, { type: "TRANSITION_END", token: 10 }), closing);
    assert.deepEqual(reduceSidebarState(closing, { type: "TRANSITION_END", token: 11 }), { kind: "home-hidden" });
});

test("沉浸路由与普通路由的侧栏表现正交", () => {
    assert.equal(getRouteShellKind("/canvas/project-1"), "immersive");
    assert.equal(getRouteShellKind("/canvas"), "standard");
    assert.equal(deriveSidebarPresentation({ kind: "route-docked" }, "immersive").slotWidth, 0);
    assert.equal(deriveSidebarPresentation({ kind: "home-hidden" }, "standard").slotWidth, SIDEBAR_WIDTH);
});

test("画布列表与项目页方向可逆，同层项目切换为 neutral", () => {
    assert.equal(getRouteTransitionDirection("/canvas", "/canvas/a"), "forward");
    assert.equal(getRouteTransitionDirection("/canvas/a", "/canvas"), "backward");
    assert.equal(getRouteTransitionDirection("/canvas/a", "/canvas/b"), "neutral");
});

test("回收站位于统计与设置之间，路由方向保持与侧栏顺序一致", () => {
    assert.equal(getRouteTransitionDirection("/stats", "/trash"), "forward");
    assert.equal(getRouteTransitionDirection("/trash", "/config"), "forward");
    assert.equal(getRouteTransitionDirection("/config", "/trash"), "backward");
});

test("创作 Skill 位于资产区与系统区之间", () => {
    assert.equal(getRouteTransitionDirection("/prompts", "/skills"), "forward");
    assert.equal(getRouteTransitionDirection("/skills", "/stats"), "forward");
    assert.equal(getRouteTransitionDirection("/stats", "/skills"), "backward");
});

test("重复 pathname 及 query/hash 变化不创建整页事务", () => {
    const capabilities = { reducedMotion: false, viewTransition: true };
    assert.equal(planRouteTransition("/image", "/image?result=1", capabilities), null);
    assert.equal(planRouteTransition("/image#top", "/image#bottom", capabilities), null);
});

test("一次导航只选择一种过渡驱动", () => {
    assert.equal(planRouteTransition("/", "/image", { reducedMotion: false, viewTransition: true })?.driver, "view-transition");
    assert.equal(planRouteTransition("/", "/image", { reducedMotion: false, viewTransition: false })?.driver, "fallback");
    assert.equal(planRouteTransition("/", "/image", { reducedMotion: true, viewTransition: true })?.driver, "none");
});

test("旧事务完成回调不能清理较新的事务", () => {
    const current: RouteTransitionTransaction = {
        id: 2,
        fromPathname: "/image",
        toPathname: "/video",
        direction: "forward",
        driver: "view-transition",
        phase: "running",
    };
    const state: RouteTransitionState = { pending: [], active: current };
    assert.equal(finishRouteTransition(state, 1), state);
    assert.deepEqual(finishRouteTransition(state, 2), { pending: [], active: null });
});

test("快速连续导航按实际到达顺序领取，事务不互相覆盖", () => {
    const first: RouteTransitionTransaction = {
        id: 1,
        fromPathname: "/",
        toPathname: "/image",
        direction: "forward",
        driver: "view-transition",
        phase: "prepared",
    };
    const second: RouteTransitionTransaction = {
        id: 2,
        fromPathname: "/",
        toPathname: "/video",
        direction: "forward",
        driver: "view-transition",
        phase: "prepared",
    };
    let state = enqueueRouteTransition(enqueueRouteTransition({ pending: [], active: null }, first), second);

    state = claimRouteTransition(state, "/", "/image", null);
    assert.equal(state.active?.id, 1);
    assert.deepEqual(state.pending.map(({ id }) => id), [2]);

    state = claimRouteTransition(state, "/image", "/video", null);
    assert.deepEqual(state.active, {
        ...second,
        fromPathname: "/image",
        phase: "committed",
    });
    assert.deepEqual(state.pending, []);
    assert.equal(finishRouteTransition(state, 1), state);
    assert.deepEqual(finishRouteTransition(state, 2), { pending: [], active: null });
});

test("跳过的目标不残留，浏览器回退使用实际路径新事务", () => {
    const stale: RouteTransitionTransaction = {
        id: 3,
        fromPathname: "/video",
        toPathname: "/config",
        direction: "forward",
        driver: "view-transition",
        phase: "prepared",
    };
    const fallback: RouteTransitionTransaction = {
        id: 4,
        fromPathname: "/video",
        toPathname: "/image",
        direction: "backward",
        driver: "fallback",
        phase: "committed",
    };
    const state = claimRouteTransition(enqueueRouteTransition({ pending: [], active: null }, stale), "/video", "/image", fallback);

    assert.deepEqual(state, { pending: [], active: fallback });
});

test("跳过 View Transition 的兜底只清理尚未运行的同 id 事务", () => {
    const transaction: RouteTransitionTransaction = {
        id: 5,
        fromPathname: "/image",
        toPathname: "/video",
        direction: "forward",
        driver: "view-transition",
        phase: "committed",
    };
    const committed: RouteTransitionState = { pending: [], active: transaction };
    const running = markRouteTransitionRunning(committed, 5);

    assert.equal(finishRouteTransition(committed, 4, "committed"), committed);
    assert.deepEqual(finishRouteTransition(committed, 5, "committed"), { pending: [], active: null });
    assert.equal(finishRouteTransition(running, 5, "committed"), running);
});

test("未到达的 prepared 事务可按 id 过期，不会误删更新的导航", () => {
    const pending = [
        { id: 6, fromPathname: "/", toPathname: "/image", direction: "forward", driver: "view-transition", phase: "prepared" },
        { id: 7, fromPathname: "/", toPathname: "/video", direction: "forward", driver: "view-transition", phase: "prepared" },
    ] satisfies RouteTransitionTransaction[];
    const state: RouteTransitionState = { pending, active: null };

    assert.deepEqual(discardPendingRouteTransition(state, 6).pending.map(({ id }) => id), [7]);
    assert.equal(discardPendingRouteTransition(state, 8), state);
});

test("旧页面优先为从当前路径发起的 pending 事务提供快照名", () => {
    const pending = { id: 8, fromPathname: "/", toPathname: "/image", direction: "forward", driver: "view-transition", phase: "prepared" } satisfies RouteTransitionTransaction;

    assert.equal(selectRouteTransitionForCapture({ pending: [pending], active: null }, "/"), pending);
});

test("新页面不会被从旧路径准备的更新 pending 覆盖 active 快照名", () => {
    const active = { id: 9, fromPathname: "/", toPathname: "/image", direction: "forward", driver: "view-transition", phase: "committed" } satisfies RouteTransitionTransaction;
    const pending = { id: 10, fromPathname: "/", toPathname: "/video", direction: "forward", driver: "view-transition", phase: "prepared" } satisfies RouteTransitionTransaction;

    assert.equal(selectRouteTransitionForCapture({ pending: [pending], active }, "/image"), active);
});

test("已稳定页面优先为它新发起的 pending 事务提供旧快照名", () => {
    const active = { id: 11, fromPathname: "/", toPathname: "/image", direction: "forward", driver: "view-transition", phase: "running" } satisfies RouteTransitionTransaction;
    const pending = { id: 12, fromPathname: "/image", toPathname: "/video", direction: "forward", driver: "view-transition", phase: "prepared" } satisfies RouteTransitionTransaction;

    assert.equal(selectRouteTransitionForCapture({ pending: [pending], active }, "/image"), pending);
});

test("location 已切换但尚未 claim 时使用目标匹配的 pending 新快照名", () => {
    const pending = { id: 13, fromPathname: "/", toPathname: "/image", direction: "forward", driver: "view-transition", phase: "prepared" } satisfies RouteTransitionTransaction;

    assert.equal(selectRouteTransitionForCapture({ pending: [pending], active: null }, "/image"), pending);
});

test("快速反向 POP 优先使用最新事务，不被旧事务的 from 路径污染", () => {
    const forward = { id: 14, fromPathname: "/", toPathname: "/image", direction: "forward", driver: "view-transition", capture: "automatic", phase: "prepared" } satisfies RouteTransitionTransaction;
    const backward = { id: 15, fromPathname: "/image", toPathname: "/", direction: "backward", driver: "view-transition", capture: "automatic", phase: "prepared" } satisfies RouteTransitionTransaction;

    assert.equal(selectRouteTransitionForCapture({ pending: [forward, backward], active: null }, "/"), backward);
});

test("React Router 已自动启动 POP View Transition 时不再规划 fallback", () => {
    const plan = planCommittedRouteTransition("/canvas/project-1", "/canvas", {
        reducedMotion: false,
        automaticViewTransition: true,
    });

    assert.equal(plan?.driver, "view-transition");
    assert.equal(plan?.capture, "automatic");
});

test("没有自动 View Transition 的普通 POP 仍使用 fallback", () => {
    assert.equal(planCommittedRouteTransition("/image", "/canvas", { reducedMotion: false, automaticViewTransition: false })?.driver, "fallback");
    assert.equal(planCommittedRouteTransition("/image", "/canvas", { reducedMotion: true, automaticViewTransition: false })?.driver, "none");
});

test("自动 POP 在事务领取前后保留实际路由方向", () => {
    const automatic = planCommittedRouteTransition("/canvas/project-1", "/canvas", {
        reducedMotion: false,
        automaticViewTransition: true,
    });
    const transaction = automatic && { ...automatic, id: 14, phase: "committed" as const };

    assert.equal(getRouteTransitionViewName(null, true), "route-auto");
    assert.equal(getRouteTransitionViewName(transaction, false), "route-backward");
});

test("预备的自动 POP 在浏览器未启动 View Transition 时改用同一 fallback 事务", () => {
    const prepared = {
        id: 15,
        fromPathname: "/video",
        toPathname: "/image",
        direction: "backward",
        driver: "view-transition",
        capture: "automatic",
        phase: "prepared",
    } satisfies RouteTransitionTransaction;
    const committedPlan = planCommittedRouteTransition("/video", "/image", {
        reducedMotion: false,
        automaticViewTransition: false,
    });
    const state = claimRouteTransition({ pending: [prepared], active: null }, "/video", "/image", null, committedPlan);

    assert.deepEqual(state, {
        pending: [],
        active: {
            id: 15,
            fromPathname: "/video",
            toPathname: "/image",
            direction: "backward",
            driver: "fallback",
            phase: "committed",
        },
    });
});

test("已准备的方向事务与 fallback 仍保持原有快照语义", () => {
    const directional = { id: 16, fromPathname: "/", toPathname: "/image", direction: "forward", driver: "view-transition", phase: "prepared" } satisfies RouteTransitionTransaction;
    const fallback = { ...directional, id: 17, driver: "fallback", phase: "committed" } satisfies RouteTransitionTransaction;

    assert.equal(getRouteTransitionViewName(directional, true), "route-forward");
    assert.equal(getRouteTransitionViewName(fallback, false), "none");
});
