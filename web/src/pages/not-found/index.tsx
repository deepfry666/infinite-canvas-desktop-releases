import { Home } from "lucide-react";
import { useEffect, useLayoutEffect } from "react";
import { Link, useLocation, useViewTransitionState } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { prepareRouteTransitionFromClick, shouldUseRouteTransition } from "@/hooks/use-route-navigate";
import { getRouteTransitionViewName, selectRouteTransitionForCapture } from "@/lib/app-shell-state";
import { useAppShellStore } from "@/stores/use-app-shell-store";

export default function NotFound() {
    const { t } = useTranslation();
    const { pathname } = useLocation();
    const committedPathname = useAppShellStore((state) => state.committedPathname);
    const pendingRouteTransitions = useAppShellStore((state) => state.pendingRouteTransitions);
    const activeRouteTransition = useAppShellStore((state) => state.activeRouteTransition);
    const syncRoute = useAppShellStore((state) => state.syncRoute);
    const markRouteTransitionRunning = useAppShellStore((state) => state.markRouteTransitionRunning);
    const finishRouteTransition = useAppShellStore((state) => state.finishRouteTransition);
    const captureRouteTransition = selectRouteTransitionForCapture({ pending: pendingRouteTransitions, active: activeRouteTransition }, pathname);
    const routeTransitioning = useViewTransitionState(activeRouteTransition?.toPathname || pathname);
    const automaticViewTransition = useViewTransitionState(pathname);

    useLayoutEffect(() => {
        if (committedPathname === pathname) return;
        const transaction = syncRoute(committedPathname, pathname, automaticViewTransition);
        if (transaction && transaction.driver !== "view-transition") finishRouteTransition(transaction.id);
    }, [automaticViewTransition, committedPathname, finishRouteTransition, pathname, syncRoute]);

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

    return (
        <div data-route-stage className="flex h-dvh flex-col overflow-hidden bg-background text-foreground" style={{ viewTransitionName: getRouteTransitionViewName(captureRouteTransition, automaticViewTransition) }}>
            <main
                data-route-focus-target
                tabIndex={-1}
                className="flex h-full min-h-0 items-center justify-center overflow-y-auto bg-background px-6 py-10 text-foreground"
                style={{ backgroundImage: "radial-gradient(ellipse 58% 38% at 50% 0%, color-mix(in srgb, var(--foreground) 5%, transparent), transparent 72%)" }}
            >
                <section className="w-full max-w-md text-center">
                    <div className="type-numeric mx-auto mb-7 flex items-center justify-center gap-4 text-3xl text-muted-foreground" aria-hidden="true">
                        <span className="h-px w-10 bg-border" />
                        404
                        <span className="h-px w-10 bg-border" />
                    </div>
                    <h1 className="type-page-title">{t("notFound.title")}</h1>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("notFound.description")}</p>
                    <div className="mt-8 flex flex-wrap justify-center gap-3">
                        <Link to="/" viewTransition={shouldUseRouteTransition("/", pathname)} onClick={(event) => prepareRouteTransitionFromClick(event, "/", pathname)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-85">
                            <Home className="size-4" />
                            {t("notFound.home")}
                        </Link>
                    </div>
                </section>
            </main>
        </div>
    );
}
