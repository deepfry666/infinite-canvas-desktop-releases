import { BarChart3, Bot, Home, Menu, Settings2, Trash2, type LucideIcon } from "lucide-react";
import { Link, useLocation, useViewTransitionState } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type MouseEvent } from "react";

import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { AppConfigModal } from "@/components/layout/app-config-modal";
import { AppShortcutsDialog } from "@/components/layout/app-shortcuts-dialog";
import { MobileNavDrawer } from "@/components/layout/mobile-nav-drawer";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { usePointerHalo } from "@/hooks/use-pointer-halo";
import { isPlainRouteClick, prepareRouteTransitionFromClick, shouldUseRouteTransition } from "@/hooks/use-route-navigate";
import { deriveSidebarPresentation, getRouteShellKind, getRouteTransitionViewName, selectRouteTransitionForCapture, SIDEBAR_WIDTH, updateSidebarHoldOwners, type SidebarHoldOwner } from "@/lib/app-shell-state";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/stores/use-agent-store";
import { useAppShellStore } from "@/stores/use-app-shell-store";

type SidebarItem = {
    path: string;
    label: string;
    icon: LucideIcon;
};

const HOME_EDGE_HINT_KEY = "fourj:home-edge-hint-seen";
const HOME_SIDEBAR_GRACE_MS = 420;

function isRouteActive(pathname: string, path: string) {
    return path === "/" ? pathname === path : pathname === path || pathname.startsWith(`${path}/`);
}

export function AppTopNav() {
    const { t } = useTranslation();
    const { pathname } = useLocation();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const [edgeHintIntro, setEdgeHintIntro] = useState(false);
    const navPointerHalo = usePointerHalo<HTMLElement>();
    const asideRef = useRef<HTMLElement>(null);
    const edgeTriggerRef = useRef<HTMLButtonElement>(null);
    const focusSidebarAfterOpenRef = useRef(false);
    const suppressEdgeOpenUntilLeaveRef = useRef(false);
    const edgeOpenSuppressionTimerRef = useRef<number | null>(null);
    const sidebarHoldOwnersRef = useRef(new Set<SidebarHoldOwner>());
    const sidebarState = useAppShellStore((state) => state.sidebarState);
    const pendingRouteTransitions = useAppShellStore((state) => state.pendingRouteTransitions);
    const activeRouteTransition = useAppShellStore((state) => state.activeRouteTransition);
    const openHomeSidebar = useAppShellStore((state) => state.openHomeSidebar);
    const enterSidebar = useAppShellStore((state) => state.enterSidebar);
    const leaveSidebar = useAppShellStore((state) => state.leaveSidebar);
    const holdSidebar = useAppShellStore((state) => state.holdSidebar);
    const releaseSidebar = useAppShellStore((state) => state.releaseSidebar);
    const enterHomeContentGate = useAppShellStore((state) => state.enterHomeContentGate);
    const advanceSidebarGrace = useAppShellStore((state) => state.advanceSidebarGrace);
    const escapeSidebar = useAppShellStore((state) => state.escapeSidebar);
    const finishSidebarTransition = useAppShellStore((state) => state.finishSidebarTransition);
    const routeKind = getRouteShellKind(pathname);
    const sidebar = deriveSidebarPresentation(sidebarState, routeKind);
    const captureRouteTransition = selectRouteTransitionForCapture({ pending: pendingRouteTransitions, active: activeRouteTransition }, pathname);
    const automaticViewTransition = useViewTransitionState(pathname);
    const routeViewTransitionName = getRouteTransitionViewName(captureRouteTransition, automaticViewTransition);
    const homeRoute = routeKind === "home";
    const slug = pathname.split("/").filter(Boolean)[0];
    const activeToolSlug = navigationTools.some((tool) => tool.slug === slug) ? (slug as NavigationToolSlug) : undefined;
    const togglePanel = useAgentStore((state) => state.togglePanel);
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const updateSidebarHold = useCallback((owner: SidebarHoldOwner, active: boolean) => {
        if (!updateSidebarHoldOwners(sidebarHoldOwnersRef.current, owner, active)) return;
        if (active) holdSidebar();
        else releaseSidebar();
    }, [holdSidebar, releaseSidebar]);
    const toolItems = navigationTools.map<SidebarItem>((tool) => ({ path: `/${tool.slug}`, label: t(`navigation.${tool.slug}`), icon: tool.icon }));
    const pickToolItems = (paths: string[]) => paths.flatMap((path) => toolItems.filter((item) => item.path === path));
    const sidebarGroups = [
        {
            id: "creation",
            label: t("topNav.creationSection"),
            items: [{ path: "/", label: t("topNav.home"), icon: Home }, ...pickToolItems(["/canvas", "/image", "/video"])],
        },
        {
            id: "library",
            label: t("topNav.librarySection"),
            items: pickToolItems(["/assets", "/prompts", "/skills"]),
        },
        {
            id: "system",
            label: t("topNav.systemSection"),
            items: [
                { path: "/stats", label: t("topNav.imageStats"), icon: BarChart3 },
                { path: "/trash", label: t("navigation.trash"), icon: Trash2 },
                { path: "/config", label: t("navigation.config"), icon: Settings2 },
            ],
        },
    ];

    useEffect(() => {
        const handleShortcut = (event: KeyboardEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.key !== "?" || target?.closest("input, textarea, select, [contenteditable='true'], [data-canvas-shortcuts-ignore]")) return;
            event.preventDefault();
            setShortcutsOpen(true);
        };
        window.addEventListener("keydown", handleShortcut);
        return () => window.removeEventListener("keydown", handleShortcut);
    }, []);

    useEffect(() => {
        if (!homeRoute || window.sessionStorage.getItem(HOME_EDGE_HINT_KEY)) return;
        window.sessionStorage.setItem(HOME_EDGE_HINT_KEY, "1");
        setEdgeHintIntro(true);
    }, [homeRoute]);

    useEffect(() => () => {
        if (edgeOpenSuppressionTimerRef.current !== null) window.clearTimeout(edgeOpenSuppressionTimerRef.current);
    }, []);

    useEffect(() => {
        if (sidebarState.kind !== "home-close-pending") return;
        const timer = window.setTimeout(() => advanceSidebarGrace(sidebarState.token), HOME_SIDEBAR_GRACE_MS);
        return () => window.clearTimeout(timer);
    }, [advanceSidebarGrace, sidebarState]);

    useEffect(() => {
        if (sidebarState.kind !== "home-closing") return;
        const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 420;
        const timer = window.setTimeout(() => finishSidebarTransition(sidebarState.token), delay);
        return () => window.clearTimeout(timer);
    }, [finishSidebarTransition, sidebarState]);

    useLayoutEffect(() => {
        if (sidebar.interactive || !asideRef.current?.contains(document.activeElement)) return;
        const target = document.querySelector<HTMLElement>("[data-route-focus-target]") || document.querySelector<HTMLElement>("[data-route-stage]");
        target?.focus({ preventScroll: true });
    }, [sidebar.interactive]);

    useEffect(() => {
        if (!focusSidebarAfterOpenRef.current || sidebarState.kind !== "home-overlay-open") return;
        focusSidebarAfterOpenRef.current = false;
        const frame = window.requestAnimationFrame(() => asideRef.current?.querySelector<HTMLElement>("a, button")?.focus({ preventScroll: true }));
        return () => window.cancelAnimationFrame(frame);
    }, [sidebarState]);

    const handleRouteClick = (event: MouseEvent<HTMLElement>, path: string, active: boolean, allowViewTransition = false) => {
        if (!isPlainRouteClick(event)) return;
        if (active) {
            event.preventDefault();
            return;
        }
        prepareRouteTransitionFromClick(event, path, pathname, allowViewTransition);
    };
    const handleSidebarBlur = (event: FocusEvent<HTMLElement>) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        leaveSidebar();
        enterHomeContentGate();
    };
    const handleEdgePointerOpen = () => {
        if (!suppressEdgeOpenUntilLeaveRef.current) openHomeSidebar();
    };
    const activateEdgeTrigger = () => {
        suppressEdgeOpenUntilLeaveRef.current = false;
        if (edgeOpenSuppressionTimerRef.current !== null) window.clearTimeout(edgeOpenSuppressionTimerRef.current);
        edgeOpenSuppressionTimerRef.current = null;
        focusSidebarAfterOpenRef.current = true;
        openHomeSidebar();
    };

    return (
        <>
            <button
                ref={edgeTriggerRef}
                type="button"
                data-home-edge-trigger
                className={cn(
                    "home-edge-trigger group absolute inset-y-0 left-0 z-50 hidden items-center justify-start outline-none transition-[width] duration-[380ms] md:flex",
                    homeRoute && sidebar.showHotzone ? "pointer-events-auto" : "pointer-events-none",
                )}
                style={{ width: sidebar.exiting ? SIDEBAR_WIDTH : 48 }}
                aria-label={t("topNav.openMenu")}
                aria-expanded={sidebar.visible && !sidebar.exiting}
                aria-hidden={!homeRoute || !sidebar.showHotzoneHint}
                tabIndex={homeRoute && sidebar.showHotzoneHint ? 0 : -1}
                onPointerEnter={handleEdgePointerOpen}
                onPointerLeave={() => {
                    suppressEdgeOpenUntilLeaveRef.current = false;
                    if (edgeOpenSuppressionTimerRef.current !== null) window.clearTimeout(edgeOpenSuppressionTimerRef.current);
                    edgeOpenSuppressionTimerRef.current = null;
                }}
                onFocus={activateEdgeTrigger}
                onClick={activateEdgeTrigger}
            >
                <span
                    aria-hidden="true"
                    className={cn("home-edge-affordance", !sidebar.showHotzoneHint && "home-edge-affordance-hidden", edgeHintIntro && sidebar.showHotzoneHint && "home-edge-affordance-intro")}
                    onAnimationEnd={() => setEdgeHintIntro(false)}
                >
                    <span className="home-edge-brush" />
                    <span className="home-edge-label type-display">{t("topNav.toolbar")}</span>
                </span>
            </button>

            <aside
                ref={asideRef}
                data-route-sidebar
                data-home-edge-nav={homeRoute ? "" : undefined}
                data-home-edge-open={homeRoute && sidebar.visible && !sidebar.exiting ? "" : undefined}
                data-sidebar-overlay={sidebar.overlay ? "" : undefined}
                className="absolute inset-y-0 left-0 z-40 hidden w-[224px] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform duration-[380ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none md:flex"
                style={{
                    transform: sidebar.visible && !sidebar.exiting ? "translate3d(0,0,0)" : "translate3d(-100%,0,0)",
                    viewTransitionName: routeViewTransitionName !== "none" ? "app-sidebar" : "none",
                }}
                aria-label={t("topNav.navigation")}
                aria-hidden={sidebar.ariaHidden}
                inert={!sidebar.interactive}
                onPointerEnter={enterSidebar}
                onPointerLeave={leaveSidebar}
                onFocusCapture={enterSidebar}
                onBlurCapture={handleSidebarBlur}
                onTransitionEnd={(event) => {
                    if (event.propertyName === "transform" && sidebarState.kind === "home-closing") finishSidebarTransition(sidebarState.token);
                }}
                onTransitionCancel={(event) => {
                    if (event.propertyName === "transform" && sidebarState.kind === "home-closing") finishSidebarTransition(sidebarState.token);
                }}
                onKeyDown={(event) => {
                    if (!homeRoute || event.key !== "Escape") return;
                    event.preventDefault();
                    event.stopPropagation();
                    suppressEdgeOpenUntilLeaveRef.current = true;
                    if (edgeOpenSuppressionTimerRef.current !== null) window.clearTimeout(edgeOpenSuppressionTimerRef.current);
                    edgeOpenSuppressionTimerRef.current = window.setTimeout(() => {
                        suppressEdgeOpenUntilLeaveRef.current = false;
                        edgeOpenSuppressionTimerRef.current = null;
                    }, 450);
                    escapeSidebar();
                }}
            >
                <Link
                    to="/"
                    viewTransition={false}
                    onClick={(event) => handleRouteClick(event, "/", pathname === "/")}
                    className="app-sidebar-brand flex h-[84px] shrink-0 items-center gap-3 border-b border-sidebar-border px-5 outline-none transition-colors hover:bg-sidebar-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sidebar-ring"
                    aria-label={t("meta.fullTitle")}
                >
                    <span className="size-8 shrink-0 bg-brand" style={{ mask: "url(/logo.svg) center / contain no-repeat", WebkitMask: "url(/logo.svg) center / contain no-repeat" }} />
                    <span className="min-w-0 leading-none">
                        <span className="type-section-title block truncate text-[17px] !leading-none">{t("meta.title")}</span>
                        <span className="mt-1.5 block truncate font-sans text-[11px] font-normal tracking-[0.06em] text-muted-foreground">FOURJ CANVAS</span>
                    </span>
                </Link>

                <nav className="app-sidebar-scroll min-h-0 flex-1 overflow-y-auto px-4 py-5" aria-label={t("topNav.navigation")}>
                    <div className="app-sidebar-groups relative flex flex-col gap-7">
                        {sidebarGroups.map((group) => (
                            <section key={group.id} aria-labelledby={`sidebar-group-${group.id}`}>
                                <div className="app-sidebar-group-heading mb-2.5 flex items-center gap-3 px-3">
                                    <h2 id={`sidebar-group-${group.id}`} className="shrink-0 text-[13px] font-normal tracking-[0.03em] text-muted-foreground/75">{group.label}</h2>
                                    <span aria-hidden="true" className="h-px flex-1 bg-sidebar-border/80" />
                                </div>
                                <div className="app-sidebar-group-items flex flex-col gap-1">
                                    {group.items.map((item) => {
                                        const Icon = item.icon;
                                        const active = isRouteActive(pathname, item.path);
                                        return (
                                            <Link
                                                key={item.path}
                                                to={item.path}
                                                viewTransition={false}
                                                aria-current={active ? "page" : undefined}
                                                onClick={(event) => handleRouteClick(event, item.path, active)}
                                                onPointerEnter={navPointerHalo.onPointerEnter}
                                                onPointerMove={navPointerHalo.onPointerMove}
                                                onPointerLeave={navPointerHalo.onPointerLeave}
                                                onPointerDown={navPointerHalo.onPointerDown}
                                                onPointerCancel={navPointerHalo.onPointerCancel}
                                                className={cn(
                                                    "app-sidebar-nav-link sidebar-nav-item relative z-10 flex h-11 items-center gap-3 rounded-lg px-3 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/50",
                                                    active ? "sidebar-nav-item-active font-medium text-sidebar-accent-foreground" : "text-muted-foreground hover:text-sidebar-accent-foreground",
                                                )}
                                            >
                                                <span aria-hidden="true" className="sidebar-nav-halo" />
                                                <span aria-hidden="true" data-halo-bloom className="interaction-halo-bloom" />
                                                <Icon className="relative z-[1] size-[18px] shrink-0 transition-[stroke-width] duration-300" strokeWidth={active ? 1.9 : 1.6} />
                                                <span className="relative z-[1] truncate">{item.label}</span>
                                            </Link>
                                        );
                                    })}
                                </div>
                            </section>
                        ))}
                    </div>
                </nav>

                <div className="app-sidebar-footer shrink-0 border-t border-sidebar-border p-4">
                    {routeKind === "immersive" ? (
                        <button
                            type="button"
                            className={cn(
                                "app-sidebar-agent sidebar-nav-item relative flex h-11 w-full items-center gap-3 rounded-lg px-3 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/50",
                                panelOpen ? "sidebar-nav-item-active font-medium text-sidebar-accent-foreground" : "text-muted-foreground hover:text-sidebar-accent-foreground",
                            )}
                            onClick={togglePanel}
                            onPointerEnter={navPointerHalo.onPointerEnter}
                            onPointerMove={navPointerHalo.onPointerMove}
                            onPointerLeave={navPointerHalo.onPointerLeave}
                            onPointerDown={navPointerHalo.onPointerDown}
                            onPointerCancel={navPointerHalo.onPointerCancel}
                            aria-expanded={panelOpen}
                            aria-label={t(panelOpen ? "topNav.closeAgent" : "topNav.openAgent")}
                        >
                            <span aria-hidden="true" className="sidebar-nav-halo" />
                            <span aria-hidden="true" data-halo-bloom className="interaction-halo-bloom" />
                            <Bot className="relative z-[1] size-[18px] shrink-0" strokeWidth={panelOpen ? 1.9 : 1.6} />
                            <span className="relative z-[1] truncate">{t("agent.builtin.title")}</span>
                        </button>
                    ) : null}
                    <div className={cn("app-sidebar-status border-t border-sidebar-border pt-2 [&>div]:w-full [&>div]:justify-between", routeKind === "immersive" && "mt-2")}>
                        <UserStatusActions showConfig={false} popoversEnabled={sidebar.interactive} onSidebarHoldChange={updateSidebarHold} />
                    </div>
                </div>
            </aside>

            {routeKind !== "immersive" ? (
                <header
                    data-route-mobile-header
                    className="z-20 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-sidebar-border bg-background/90 px-4 backdrop-blur-xl md:hidden"
                    style={{ viewTransitionName: routeViewTransitionName !== "none" ? "app-mobile-header" : "none" }}
                >
                    <div className="flex min-w-0 items-center">
                        <Link
                            to="/"
                            viewTransition={shouldUseRouteTransition("/", pathname)}
                            onClick={(event) => handleRouteClick(event, "/", pathname === "/", true)}
                            aria-label={t("meta.fullTitle")}
                            className="flex min-w-0 items-center gap-2 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                        >
                            <span className="size-5 shrink-0 bg-brand" style={{ mask: "url(/logo.svg) center / contain no-repeat", WebkitMask: "url(/logo.svg) center / contain no-repeat" }} />
                            <span className="min-w-0 leading-none">
                                <span className="type-section-title block truncate text-[15px] !leading-none">{t("meta.title")}</span>
                                <span className="mt-1 block truncate font-sans text-[10px] font-normal tracking-[0.05em] text-muted-foreground">FOURJ CANVAS</span>
                            </span>
                        </Link>
                        <button type="button" className="ml-2 inline-flex size-8 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground" onClick={() => setMobileNavOpen(true)} aria-label={t("topNav.openMenu")} title={t("topNav.menu")}>
                            <Menu className="size-5" />
                        </button>
                    </div>

                    <div className="flex min-w-0 shrink-0 items-center gap-1">
                        <UserStatusActions showConfig={false} />
                    </div>
                </header>
            ) : null}

            <MobileNavDrawer open={mobileNavOpen} activeToolSlug={activeToolSlug} onClose={() => setMobileNavOpen(false)} />
            <AppShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
            <AppConfigModal onAfterClose={() => updateSidebarHold("config", false)} />
        </>
    );
}
