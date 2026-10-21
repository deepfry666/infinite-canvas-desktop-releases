import { create } from "zustand";

import {
    claimRouteTransition,
    createSidebarState,
    discardPendingRouteTransition,
    enqueueRouteTransition,
    finishRouteTransition as finishTransaction,
    markRouteTransitionRunning as markTransactionRunning,
    planCommittedRouteTransition,
    planRouteTransition,
    reduceSidebarState,
    type RouteTransitionTransaction,
    type SidebarState,
} from "@/lib/app-shell-state";

type AppShellStore = {
    sidebarState: SidebarState;
    committedPathname: string;
    pendingRouteTransitions: RouteTransitionTransaction[];
    activeRouteTransition: RouteTransitionTransaction | null;
    syncRoute: (fromPathname: string, toPathname: string, automaticViewTransition?: boolean) => RouteTransitionTransaction | null;
    openHomeSidebar: () => void;
    enterSidebar: () => void;
    leaveSidebar: () => void;
    holdSidebar: () => void;
    releaseSidebar: () => void;
    enterHomeContentGate: () => void;
    advanceSidebarGrace: (token: number) => void;
    escapeSidebar: () => void;
    finishSidebarTransition: (token: number) => void;
    prepareRouteTransition: (fromPathname: string, toPathname: string, allowViewTransition?: boolean, capture?: RouteTransitionTransaction["capture"]) => RouteTransitionTransaction | null;
    markRouteTransitionRunning: (id: number) => void;
    finishRouteTransition: (id: number, expectedPhase?: RouteTransitionTransaction["phase"]) => void;
};

let sidebarToken = 0;
let routeTransitionId = 0;
const PREPARED_ROUTE_EXPIRY_MS = 1_000;

function nextSidebarToken() {
    sidebarToken += 1;
    return sidebarToken;
}

function nextRouteTransition(plan: NonNullable<ReturnType<typeof planRouteTransition>>, phase: RouteTransitionTransaction["phase"] = "prepared"): RouteTransitionTransaction {
    routeTransitionId += 1;
    return { ...plan, id: routeTransitionId, phase };
}

function reducedMotion() {
    return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export const useAppShellStore = create<AppShellStore>((set, get) => ({
    sidebarState: createSidebarState(typeof window === "undefined" ? "/" : window.location.pathname),
    committedPathname: typeof window === "undefined" ? "/" : window.location.pathname,
    pendingRouteTransitions: [],
    activeRouteTransition: null,
    syncRoute: (fromPathname, toPathname, automaticViewTransition = false) => {
        const current = get();
        const plan = planCommittedRouteTransition(fromPathname, toPathname, { reducedMotion: reducedMotion(), automaticViewTransition });
        const hasPreparedTarget = current.pendingRouteTransitions.some((transaction) => transaction.toPathname === toPathname);
        const transitionState = claimRouteTransition(
            { pending: current.pendingRouteTransitions, active: current.activeRouteTransition },
            fromPathname,
            toPathname,
            !hasPreparedTarget && plan ? nextRouteTransition(plan, "committed") : null,
            plan,
        );
        set((state) => ({
            sidebarState: reduceSidebarState(state.sidebarState, { type: "ROUTE_COMMITTED", fromPathname, toPathname }),
            committedPathname: toPathname,
            pendingRouteTransitions: transitionState.pending,
            activeRouteTransition: transitionState.active,
        }));
        return transitionState.active;
    },
    openHomeSidebar: () => set((state) => ({ sidebarState: reduceSidebarState(state.sidebarState, { type: "EDGE_OPEN" }) })),
    enterSidebar: () => set((state) => ({ sidebarState: reduceSidebarState(state.sidebarState, { type: "SIDEBAR_ENTER" }) })),
    leaveSidebar: () => {
        const sidebarState = get().sidebarState;
        if (sidebarState.kind !== "home-overlay-open" && !(sidebarState.kind === "home-interaction-held" && sidebarState.origin === "overlay")) return;
        const token = nextSidebarToken();
        set((state) => ({ sidebarState: reduceSidebarState(state.sidebarState, { type: "SIDEBAR_LEAVE", token }) }));
    },
    holdSidebar: () => set((state) => ({ sidebarState: reduceSidebarState(state.sidebarState, { type: "SIDEBAR_HOLD" }) })),
    releaseSidebar: () => set((state) => ({ sidebarState: reduceSidebarState(state.sidebarState, { type: "SIDEBAR_RELEASE" }) })),
    enterHomeContentGate: () => {
        const sidebarState = get().sidebarState;
        if (sidebarState.kind !== "home-return-docked" && !(sidebarState.kind === "home-interaction-held" && sidebarState.origin === "docked")) return;
        const token = nextSidebarToken();
        set((state) => ({ sidebarState: reduceSidebarState(state.sidebarState, { type: "HOME_CONTENT_GATE_ENTER", token }) }));
    },
    advanceSidebarGrace: (token) => set((state) => ({ sidebarState: reduceSidebarState(state.sidebarState, { type: "GRACE_ELAPSED", token }) })),
    escapeSidebar: () => {
        const token = nextSidebarToken();
        set((state) => ({ sidebarState: reduceSidebarState(state.sidebarState, { type: "ESCAPE", token }) }));
    },
    finishSidebarTransition: (token) => set((state) => ({ sidebarState: reduceSidebarState(state.sidebarState, { type: "TRANSITION_END", token }) })),
    prepareRouteTransition: (fromPathname, toPathname, allowViewTransition = true, capture) => {
        const plan = planRouteTransition(fromPathname, toPathname, {
            reducedMotion: capture === "automatic" ? false : reducedMotion(),
            viewTransition: allowViewTransition && typeof document !== "undefined" && typeof document.startViewTransition === "function",
        });
        if (!plan) return null;
        const transaction = nextRouteTransition(capture ? { ...plan, capture } : plan);
        set((state) => {
            const transitionState = enqueueRouteTransition({ pending: state.pendingRouteTransitions, active: state.activeRouteTransition }, transaction);
            return { pendingRouteTransitions: transitionState.pending };
        });
        if (typeof window !== "undefined") window.setTimeout(() => set((state) => {
            if (!state.pendingRouteTransitions.some(({ id }) => id === transaction.id)) return state;
            const transitionState = discardPendingRouteTransition({ pending: state.pendingRouteTransitions, active: state.activeRouteTransition }, transaction.id);
            return { pendingRouteTransitions: transitionState.pending };
        }), PREPARED_ROUTE_EXPIRY_MS);
        return transaction;
    },
    markRouteTransitionRunning: (id) => set((state) => {
        const transitionState = markTransactionRunning({ pending: state.pendingRouteTransitions, active: state.activeRouteTransition }, id);
        return { activeRouteTransition: transitionState.active };
    }),
    finishRouteTransition: (id, expectedPhase) => set((state) => {
        const transitionState = finishTransaction({ pending: state.pendingRouteTransitions, active: state.activeRouteTransition }, id, expectedPhase);
        return { activeRouteTransition: transitionState.active };
    }),
}));
