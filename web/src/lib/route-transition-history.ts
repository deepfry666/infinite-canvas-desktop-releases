import type { RouteTransitionTransaction } from "./app-shell-state.ts";

type AutomaticRouteTransitionDependencies = {
    getCommittedPathname: () => string;
    getLocationPathname: () => string;
    hasAutomaticTransition: () => boolean;
    cancelThemeTransition: () => void;
    prepareTransition: (fromPathname: string, toPathname: string) => RouteTransitionTransaction | null;
    captureTransition: (transaction: RouteTransitionTransaction | null) => void;
};

type PopStateTarget = Pick<Window, "addEventListener" | "removeEventListener"> & {
    __fourjRouteTransitionPopstateBridge__?: { token: symbol; listener: EventListener };
};

export function applyAutomaticRouteTransitionCapture(target: Document, transaction: RouteTransitionTransaction | null) {
    if (transaction?.capture !== "automatic") return;
    const routeName = `route-${transaction.direction}`;
    const stage = target.querySelector<HTMLElement>("[data-route-stage]");
    const sidebar = target.querySelector<HTMLElement>("[data-route-sidebar]");
    const mobileHeader = target.querySelector<HTMLElement>("[data-route-mobile-header]");
    if (stage) stage.style.viewTransitionName = routeName;
    if (sidebar) sidebar.style.viewTransitionName = "app-sidebar";
    if (mobileHeader) mobileHeader.style.viewTransitionName = "app-mobile-header";
}

export function createAutomaticRouteTransitionPopStateHandler(dependencies: AutomaticRouteTransitionDependencies) {
    let observedPathname = dependencies.getLocationPathname();
    return () => {
        const toPathname = dependencies.getLocationPathname();
        const fromPathname = dependencies.hasAutomaticTransition() ? observedPathname : dependencies.getCommittedPathname();
        observedPathname = toPathname;
        dependencies.cancelThemeTransition();
        const transaction = dependencies.prepareTransition(fromPathname, toPathname);
        dependencies.captureTransition(transaction);
    };
}

export function installAutomaticRouteTransitionPopStateBridge(target: PopStateTarget, dependencies: AutomaticRouteTransitionDependencies) {
    const previous = target.__fourjRouteTransitionPopstateBridge__;
    if (previous) target.removeEventListener("popstate", previous.listener);

    const token = Symbol("route-transition-popstate-bridge");
    const listener = createAutomaticRouteTransitionPopStateHandler(dependencies) as EventListener;
    target.addEventListener("popstate", listener);
    target.__fourjRouteTransitionPopstateBridge__ = { token, listener };

    return () => {
        if (target.__fourjRouteTransitionPopstateBridge__?.token !== token) return;
        target.removeEventListener("popstate", listener);
        delete target.__fourjRouteTransitionPopstateBridge__;
    };
}
