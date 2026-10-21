import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useViewTransitionState } from "react-router-dom";

import { AgentPanel } from "@/components/agent/agent-panel";
import { AppTopNav } from "@/components/layout/app-top-nav";
import { deriveSidebarPresentation, getRouteShellKind, getRouteTransitionViewName, HOME_CONTENT_GATE_X, selectRouteTransitionForCapture } from "@/lib/app-shell-state";
import { cn } from "@/lib/utils";
import { useAppShellStore } from "@/stores/use-app-shell-store";

export default function UserLayout({ children }: { children: ReactNode }) {
    const location = useLocation();
    const sidebarState = useAppShellStore((state) => state.sidebarState);
    const committedPathname = useAppShellStore((state) => state.committedPathname);
    const pendingRouteTransitions = useAppShellStore((state) => state.pendingRouteTransitions);
    const activeRouteTransition = useAppShellStore((state) => state.activeRouteTransition);
    const syncRoute = useAppShellStore((state) => state.syncRoute);
    const enterHomeContentGate = useAppShellStore((state) => state.enterHomeContentGate);
    const markRouteTransitionRunning = useAppShellStore((state) => state.markRouteTransitionRunning);
    const finishRouteTransition = useAppShellStore((state) => state.finishRouteTransition);
    const routeKind = getRouteShellKind(location.pathname);
    const sidebar = deriveSidebarPresentation(sidebarState, routeKind);
    const captureRouteTransition = selectRouteTransitionForCapture({ pending: pendingRouteTransitions, active: activeRouteTransition }, location.pathname);
    const routeTransitioning = useViewTransitionState(activeRouteTransition?.toPathname || location.pathname);
    const automaticViewTransition = useViewTransitionState(location.pathname);
    const contentRef = useRef<HTMLDivElement>(null);
    const previousPathRef = useRef(committedPathname);
    const windowsDesktop = window.infiniteCanvasDesktop?.platform === "win32";

    useLayoutEffect(() => {
        const previousPathname = previousPathRef.current;
        if (previousPathname === location.pathname) return;
        previousPathRef.current = location.pathname;
        const transaction = syncRoute(previousPathname, location.pathname, automaticViewTransition);
        if (!transaction) return;
        if (transaction.driver === "none") {
            finishRouteTransition(transaction.id);
            return;
        }
        if (transaction.driver !== "fallback" || !contentRef.current) return;

        markRouteTransitionRunning(transaction.id);
        const entryOffset = transaction.direction === "forward" ? 14 : transaction.direction === "backward" ? -14 : 0;
        const animation = contentRef.current.animate(
            [
                { opacity: 0.38, transform: `translate3d(0, ${entryOffset}px, 0)` },
                { opacity: 1, transform: "none" },
            ],
            { duration: 400, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
        );
        void animation.finished.then(() => {
            animation.cancel();
            finishRouteTransition(transaction.id);
        }).catch(() => undefined);
        return () => animation.cancel();
    }, [automaticViewTransition, finishRouteTransition, location.pathname, markRouteTransitionRunning, syncRoute]);

    useEffect(() => {
        if (!activeRouteTransition || activeRouteTransition.driver !== "view-transition") return;
        if (routeTransitioning) {
            if (activeRouteTransition.phase !== "running") markRouteTransitionRunning(activeRouteTransition.id);
            return;
        }
        if (activeRouteTransition.phase === "running") {
            finishRouteTransition(activeRouteTransition.id);
            return;
        }
        const transactionId = activeRouteTransition.id;
        let settleFrame = 0;
        const startFrame = window.requestAnimationFrame(() => {
            settleFrame = window.requestAnimationFrame(() => finishRouteTransition(transactionId, "committed"));
        });
        return () => {
            window.cancelAnimationFrame(startFrame);
            window.cancelAnimationFrame(settleFrame);
        };
    }, [activeRouteTransition, finishRouteTransition, markRouteTransitionRunning, routeTransitioning]);

    const routeStageStyle = {
        "--app-sidebar-slot": `${sidebar.slotWidth}px`,
        viewTransitionName: getRouteTransitionViewName(captureRouteTransition, automaticViewTransition),
    } as CSSProperties;

    return (
        <div className="app-surface flex h-dvh flex-col overflow-hidden bg-background text-foreground" style={{ "--desktop-titlebar-height": windowsDesktop ? "38px" : "0px" } as CSSProperties}>
            {windowsDesktop ? <div aria-hidden="true" className="desktop-titlebar h-[38px] shrink-0" /> : null}
            <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
                    <AppTopNav />
                    <div
                        data-route-stage
                        tabIndex={-1}
                        className={cn(
                            "route-stage min-h-0 min-w-0 flex-1 overflow-hidden outline-none md:pl-[var(--app-sidebar-slot)]",
                            routeKind === "home" && (!captureRouteTransition || sidebarState.kind === "home-closing") && "transition-[padding-left] duration-[380ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
                        )}
                        style={routeStageStyle}
                        onPointerMove={(event) => {
                            if (routeKind === "home" && event.clientX >= HOME_CONTENT_GATE_X) enterHomeContentGate();
                        }}
                    >
                        <div ref={contentRef} data-route-content className="h-full min-h-0 min-w-0 overflow-hidden">
                            {children}
                        </div>
                    </div>
                </div>
                <AgentPanel />
            </div>
        </div>
    );
}
