export const SIDEBAR_WIDTH = 224;
export const HOME_CONTENT_GATE_X = SIDEBAR_WIDTH + 128;

export type RouteShellKind = "home" | "standard" | "immersive";
export type SidebarHoldOwner = "config" | "theme";

export type SidebarState =
    | { kind: "route-docked" }
    | { kind: "home-return-docked" }
    | { kind: "home-hidden" }
    | { kind: "home-overlay-open" }
    | { kind: "home-interaction-held"; origin: "docked" | "overlay"; holds: number; closeToken?: number }
    | { kind: "home-close-pending"; origin: "docked" | "overlay"; token: number }
    | { kind: "home-closing"; origin: "docked" | "overlay"; token: number };

export type SidebarEvent =
    | { type: "ROUTE_COMMITTED"; fromPathname: string; toPathname: string }
    | { type: "EDGE_OPEN" }
    | { type: "SIDEBAR_ENTER" }
    | { type: "SIDEBAR_LEAVE"; token: number }
    | { type: "SIDEBAR_HOLD" }
    | { type: "SIDEBAR_RELEASE" }
    | { type: "HOME_CONTENT_GATE_ENTER"; token: number }
    | { type: "GRACE_ELAPSED"; token: number }
    | { type: "ESCAPE"; token: number }
    | { type: "TRANSITION_END"; token: number };

export type SidebarPresentation = {
    slotWidth: number;
    visible: boolean;
    interactive: boolean;
    ariaHidden: boolean;
    showHotzone: boolean;
    showHotzoneHint: boolean;
    overlay: boolean;
    exiting: boolean;
};

function reopenHomeSidebar(state: SidebarState): SidebarState {
    if (state.kind !== "home-close-pending" && state.kind !== "home-closing") return state;
    return state.origin === "docked" ? { kind: "home-return-docked" } : { kind: "home-overlay-open" };
}

export function getRouteShellKind(pathname: string): RouteShellKind {
    if (pathname === "/") return "home";
    return /^\/canvas\/[^/]+\/?$/.test(pathname) ? "immersive" : "standard";
}

export function createSidebarState(pathname: string): SidebarState {
    return getRouteShellKind(pathname) === "home" ? { kind: "home-hidden" } : { kind: "route-docked" };
}

export function updateSidebarHoldOwners(owners: Set<SidebarHoldOwner>, owner: SidebarHoldOwner, active: boolean) {
    if (active) {
        if (owners.has(owner)) return false;
        owners.add(owner);
        return true;
    }
    return owners.delete(owner);
}

export function reduceSidebarState(state: SidebarState, event: SidebarEvent): SidebarState {
    switch (event.type) {
        case "ROUTE_COMMITTED": {
            const routeKind = getRouteShellKind(event.toPathname);
            if (routeKind !== "home") return { kind: "route-docked" };
            if (getRouteShellKind(event.fromPathname) === "immersive") return { kind: "home-hidden" };
            return event.fromPathname !== "/" ? { kind: "home-return-docked" } : state;
        }
        case "HOME_CONTENT_GATE_ENTER":
            if (state.kind === "home-return-docked") return { kind: "home-close-pending", origin: "docked", token: event.token };
            return state.kind === "home-interaction-held" && state.origin === "docked" ? { ...state, closeToken: event.token } : state;
        case "EDGE_OPEN":
            return state.kind === "home-hidden" ? { kind: "home-overlay-open" } : reopenHomeSidebar(state);
        case "SIDEBAR_LEAVE":
            if (state.kind === "home-overlay-open") return { kind: "home-close-pending", origin: "overlay", token: event.token };
            return state.kind === "home-interaction-held" && state.origin === "overlay" ? { ...state, closeToken: event.token } : state;
        case "SIDEBAR_ENTER": {
            if (state.kind === "home-interaction-held" && state.closeToken !== undefined) {
                const { closeToken: _closeToken, ...held } = state;
                return held;
            }
            return reopenHomeSidebar(state);
        }
        case "SIDEBAR_HOLD": {
            if (state.kind === "home-interaction-held") return { ...state, holds: state.holds + 1 };
            if (state.kind === "home-return-docked") return { kind: "home-interaction-held", origin: "docked", holds: 1 };
            if (state.kind === "home-overlay-open") return { kind: "home-interaction-held", origin: "overlay", holds: 1 };
            if (state.kind === "home-close-pending" || state.kind === "home-closing") return { kind: "home-interaction-held", origin: state.origin, holds: 1, closeToken: state.token };
            return state;
        }
        case "SIDEBAR_RELEASE":
            if (state.kind !== "home-interaction-held") return state;
            if (state.holds > 1) return { ...state, holds: state.holds - 1 };
            if (state.closeToken !== undefined) return { kind: "home-close-pending", origin: state.origin, token: state.closeToken };
            return state.origin === "docked" ? { kind: "home-return-docked" } : { kind: "home-overlay-open" };
        case "GRACE_ELAPSED":
            return state.kind === "home-close-pending" && state.token === event.token ? { kind: "home-closing", origin: state.origin, token: state.token } : state;
        case "ESCAPE": {
            if (state.kind === "home-hidden" || state.kind === "route-docked") return state;
            const origin = state.kind === "home-return-docked" || state.kind === "home-interaction-held" && state.origin === "docked" || state.kind === "home-close-pending" && state.origin === "docked" || state.kind === "home-closing" && state.origin === "docked" ? "docked" : "overlay";
            return { kind: "home-closing", origin, token: event.token };
        }
        case "TRANSITION_END":
            return state.kind === "home-closing" && state.token === event.token ? { kind: "home-hidden" } : state;
    }
}

export function deriveSidebarPresentation(state: SidebarState, routeKind: RouteShellKind): SidebarPresentation {
    if (routeKind === "standard") return { slotWidth: SIDEBAR_WIDTH, visible: true, interactive: true, ariaHidden: false, showHotzone: false, showHotzoneHint: false, overlay: false, exiting: false };
    if (routeKind === "immersive") return { slotWidth: 0, visible: false, interactive: false, ariaHidden: true, showHotzone: false, showHotzoneHint: false, overlay: false, exiting: false };

    const docked = state.kind === "route-docked" || state.kind === "home-return-docked" || state.kind === "home-interaction-held" && state.origin === "docked" || state.kind === "home-close-pending" && state.origin === "docked";
    const overlay = state.kind === "home-overlay-open" || state.kind === "home-interaction-held" && state.origin === "overlay" || (state.kind === "home-close-pending" || state.kind === "home-closing") && state.origin === "overlay";
    const exiting = state.kind === "home-closing";
    const visible = state.kind !== "home-hidden";
    const interactive = visible && !exiting;
    return {
        slotWidth: docked ? SIDEBAR_WIDTH : 0,
        visible,
        interactive,
        ariaHidden: !interactive,
        showHotzone: state.kind === "home-hidden" || state.kind === "home-closing",
        showHotzoneHint: state.kind === "home-hidden",
        overlay,
        exiting,
    };
}

const ROUTE_ORDER = ["/", "/canvas", "/image", "/video", "/assets", "/prompts", "/skills", "/stats", "/trash", "/config"] as const;

export type RouteTransitionDirection = "forward" | "backward" | "neutral";
export type RouteTransitionDriver = "view-transition" | "fallback" | "none";
export type RouteTransitionCapture = "automatic";
export type RouteTransitionPlan = {
    fromPathname: string;
    toPathname: string;
    direction: RouteTransitionDirection;
    driver: RouteTransitionDriver;
    capture?: RouteTransitionCapture;
};
export type RouteTransitionTransaction = RouteTransitionPlan & { id: number; phase: "prepared" | "committed" | "running" };
export type RouteTransitionState = {
    pending: RouteTransitionTransaction[];
    active: RouteTransitionTransaction | null;
};

const MAX_PENDING_ROUTE_TRANSITIONS = 6;

function pathnameOnly(value: string) {
    return value.split(/[?#]/, 1)[0] || "/";
}

function routeIndex(pathname: string) {
    const index = ROUTE_ORDER.findIndex((route) => route === "/" ? pathname === route : pathname === route || pathname.startsWith(`${route}/`));
    return index < 0 ? ROUTE_ORDER.length : index;
}

export function getRouteTransitionDirection(from: string, to: string): RouteTransitionDirection {
    const fromPathname = pathnameOnly(from);
    const toPathname = pathnameOnly(to);
    if (fromPathname === toPathname) return "neutral";
    const fromIndex = routeIndex(fromPathname);
    const toIndex = routeIndex(toPathname);
    if (fromIndex !== toIndex) return toIndex > fromIndex ? "forward" : "backward";
    const fromParts = fromPathname.split("/").filter(Boolean);
    const toParts = toPathname.split("/").filter(Boolean);
    if (fromParts.length !== toParts.length) return toParts.length > fromParts.length ? "forward" : "backward";
    return "neutral";
}

export function planRouteTransition(from: string, to: string, capabilities: { reducedMotion: boolean; viewTransition: boolean }): RouteTransitionPlan | null {
    const fromPathname = pathnameOnly(from);
    const toPathname = pathnameOnly(to);
    if (fromPathname === toPathname) return null;
    return {
        fromPathname,
        toPathname,
        direction: getRouteTransitionDirection(fromPathname, toPathname),
        driver: capabilities.reducedMotion ? "none" : capabilities.viewTransition ? "view-transition" : "fallback",
    };
}

export function planCommittedRouteTransition(
    from: string,
    to: string,
    capabilities: { reducedMotion: boolean; automaticViewTransition: boolean },
): RouteTransitionPlan | null {
    const plan = planRouteTransition(from, to, {
        reducedMotion: capabilities.automaticViewTransition ? false : capabilities.reducedMotion,
        viewTransition: capabilities.automaticViewTransition,
    });
    return plan && capabilities.automaticViewTransition ? { ...plan, capture: "automatic" } : plan;
}

export function getRouteTransitionViewName(transaction: RouteTransitionTransaction | null, automaticViewTransition = false) {
    if (transaction?.driver === "view-transition") return `route-${transaction.direction}`;
    return automaticViewTransition ? "route-auto" : "none";
}

export function enqueueRouteTransition(state: RouteTransitionState, transaction: RouteTransitionTransaction): RouteTransitionState {
    return {
        ...state,
        pending: [...state.pending, transaction].slice(-MAX_PENDING_ROUTE_TRANSITIONS),
    };
}

export function discardPendingRouteTransition(state: RouteTransitionState, id: number): RouteTransitionState {
    if (!state.pending.some((transaction) => transaction.id === id)) return state;
    return { ...state, pending: state.pending.filter((transaction) => transaction.id !== id) };
}

export function selectRouteTransitionForCapture(state: RouteTransitionState, currentPathname: string): RouteTransitionTransaction | null {
    const pathname = pathnameOnly(currentPathname);
    for (let index = state.pending.length - 1; index >= 0; index -= 1) {
        if (state.pending[index].fromPathname === pathname || state.pending[index].toPathname === pathname) return state.pending[index];
    }
    if (state.active?.toPathname === pathname) return state.active;
    return null;
}

export function claimRouteTransition(
    state: RouteTransitionState,
    fromPathname: string,
    toPathname: string,
    fallback: RouteTransitionTransaction | null,
    committedPlan?: RouteTransitionPlan | null,
): RouteTransitionState {
    let matchingIndex = -1;
    for (let index = state.pending.length - 1; index >= 0; index -= 1) {
        if (state.pending[index].toPathname === toPathname) {
            matchingIndex = index;
            break;
        }
    }
    const prepared = matchingIndex >= 0 ? state.pending[matchingIndex] : null;
    const reconciledPrepared = prepared ? { ...prepared } : null;
    if (reconciledPrepared?.capture === "automatic" && committedPlan) {
        reconciledPrepared.driver = committedPlan.driver;
        if (committedPlan.capture) reconciledPrepared.capture = committedPlan.capture;
        else delete reconciledPrepared.capture;
    }
    const active = reconciledPrepared ? {
        ...reconciledPrepared,
        fromPathname,
        toPathname,
        direction: getRouteTransitionDirection(fromPathname, toPathname),
        phase: "committed" as const,
    } : fallback;
    return {
        pending: matchingIndex >= 0 ? state.pending.slice(matchingIndex + 1) : [],
        active,
    };
}

export function markRouteTransitionRunning(state: RouteTransitionState, id: number): RouteTransitionState {
    if (state.active?.id !== id || state.active.phase === "running") return state;
    return { ...state, active: { ...state.active, phase: "running" } };
}

export function finishRouteTransition(
    state: RouteTransitionState,
    id: number,
    expectedPhase?: RouteTransitionTransaction["phase"],
): RouteTransitionState {
    if (state.active?.id !== id || (expectedPhase && state.active.phase !== expectedPhase)) return state;
    return { ...state, active: null };
}
