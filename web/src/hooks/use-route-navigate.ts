import { useCallback, type MouseEvent as ReactMouseEvent } from "react";
import { resolvePath, useNavigate, type NavigateFunction, type NavigateOptions, type To } from "react-router-dom";

import { getRouteTransitionDirection, planRouteTransition, type RouteTransitionDirection } from "@/lib/app-shell-state";
import { applyAutomaticRouteTransitionCapture, installAutomaticRouteTransitionPopStateBridge } from "@/lib/route-transition-history";
import { cancelThemeViewTransition, isThemeViewTransitionActive } from "@/lib/view-transition-ownership";
import { useAppShellStore } from "@/stores/use-app-shell-store";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export type { RouteTransitionDirection };
export { getRouteTransitionDirection };

function targetPathname(to: To, pathname: string) {
    return resolvePath(to, pathname).pathname;
}

export function isPlainRouteClick(event: Pick<ReactMouseEvent<HTMLElement>, "altKey" | "button" | "ctrlKey" | "defaultPrevented" | "metaKey" | "shiftKey" | "currentTarget">) {
    const target = event.currentTarget.getAttribute("target");
    return !event.defaultPrevented && event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && (!target || target === "_self");
}

export function prepareRouteTransition(to: To, pathname = window.location.pathname, allowViewTransition = true) {
    const themeTransitionActive = isThemeViewTransitionActive();
    if (themeTransitionActive) cancelThemeViewTransition();
    return useAppShellStore.getState().prepareRouteTransition(pathname, targetPathname(to, pathname), allowViewTransition && !themeTransitionActive);
}

export function prepareRouteTransitionFromClick(event: ReactMouseEvent<HTMLElement>, to: To, pathname = window.location.pathname, allowViewTransition = true) {
    if (!isPlainRouteClick(event)) return null;
    return prepareRouteTransition(to, pathname, allowViewTransition);
}

export function installAutomaticRouteTransitionHistoryBridge() {
    return installAutomaticRouteTransitionPopStateBridge(window, {
        getCommittedPathname: () => useAppShellStore.getState().committedPathname,
        getLocationPathname: () => window.location.pathname,
        hasAutomaticTransition: () => {
            const state = useAppShellStore.getState();
            return state.activeRouteTransition?.capture === "automatic" || state.pendingRouteTransitions.some(({ capture }) => capture === "automatic");
        },
        cancelThemeTransition: cancelThemeViewTransition,
        prepareTransition: (fromPathname, toPathname) => useAppShellStore.getState().prepareRouteTransition(fromPathname, toPathname, true, "automatic"),
        captureTransition: (transaction) => applyAutomaticRouteTransitionCapture(document, transaction),
    });
}

export function shouldUseRouteTransition(to: To, pathname = window.location.pathname) {
    const plan = planRouteTransition(pathname, targetPathname(to, pathname), {
        reducedMotion: window.matchMedia(REDUCED_MOTION_QUERY).matches,
        viewTransition: !isThemeViewTransitionActive() && typeof document.startViewTransition === "function",
    });
    return plan?.driver === "view-transition";
}

export function useRouteNavigate() {
    const navigate = useNavigate();

    return useCallback<NavigateFunction>(
        (to: To | number, options?: NavigateOptions) => {
            if (typeof to === "number") return navigate(to);
            const transaction = prepareRouteTransition(to, window.location.pathname, options?.viewTransition !== false);
            return navigate(to, {
                ...options,
                viewTransition: transaction?.driver === "view-transition",
            });
        },
        [navigate],
    );
}
