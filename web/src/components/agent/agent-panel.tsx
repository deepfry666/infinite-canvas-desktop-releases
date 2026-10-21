import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";

import { BuiltinAgentPanel } from "./builtin-agent-panel";
import { deriveSidebarPresentation, getRouteShellKind } from "@/lib/app-shell-state";
import { canvasThemes } from "@/lib/canvas-theme";
import { useAppShellStore } from "@/stores/use-app-shell-store";
import { CANVAS_AGENT_PANEL_MOTION_MS, clampAgentPanelWidth, persistAgentPanelWidth, useAgentStore } from "@/stores/use-agent-store";
import { useCanvasSidePanelStore } from "@/stores/use-canvas-side-panel-store";
import { useThemeStore } from "@/stores/use-theme-store";

const PANEL_MOTION_SECONDS = CANVAS_AGENT_PANEL_MOTION_MS / 1000;

function useMediaQuery(query: string) {
    const [matches, setMatches] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches);

    useEffect(() => {
        if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
        const media = window.matchMedia(query);
        const syncQuery = () => setMatches(media.matches);
        syncQuery();
        media.addEventListener("change", syncQuery);
        return () => media.removeEventListener("change", syncQuery);
    }, [query]);

    return matches;
}

function isVisibleFocusTarget(target: HTMLElement | null): target is HTMLElement {
    if (!target?.isConnected || target.closest('[inert], [aria-hidden="true"]')) return false;
    const rect = target.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
}

export function AgentPanel() {
    const { t } = useTranslation();
    const location = useLocation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const width = useAgentStore((state) => state.width);
    const sidebarState = useAppShellStore((state) => state.sidebarState);
    const routeKind = getRouteShellKind(location.pathname);
    const canvasSidebarWidth = useCanvasSidePanelStore((state) => routeKind === "immersive" && state.panelMounted ? state.width + 1 : 0);
    const reservedSidebarWidth = deriveSidebarPresentation(sidebarState, routeKind).slotWidth + canvasSidebarWidth;
    const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
    const compactPanel = useMediaQuery("(max-width: 767px)");
    const [resizing, setResizing] = useState(false);
    const shellRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLElement>(null);
    const returnFocusRef = useRef<HTMLElement | null>(null);
    const focusInsideRef = useRef(false);
    const panelMounted = useAgentStore((state) => state.panelMounted);
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const panelClosing = useAgentStore((state) => state.panelClosing);
    const setAgentState = useAgentStore((state) => state.setAgentState);
    const interactive = panelOpen && !panelClosing;
    const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = width;
        let nextWidth = startWidth;
        const onMove = (moveEvent: PointerEvent) => {
            nextWidth = clampAgentPanelWidth(startWidth + startX - moveEvent.clientX, window.visualViewport?.width ?? window.innerWidth, reservedSidebarWidth);
            setAgentState({ width: nextWidth });
        };
        const onUp = () => {
            nextWidth = persistAgentPanelWidth(nextWidth, window.visualViewport?.width ?? window.innerWidth, reservedSidebarWidth);
            setAgentState({ width: nextWidth });
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            setResizing(false);
        };
        setResizing(true);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    useLayoutEffect(() => {
        const agent = useAgentStore.getState();
        if (agent.panelOpen && !/^\/canvas\/[^/]+\/?$/.test(location.pathname)) agent.closePanel();
    }, [location.pathname]);

    useLayoutEffect(() => {
        if (compactPanel) return;
        const handleResize = () => {
            const store = useAgentStore.getState();
            const nextWidth = clampAgentPanelWidth(store.width, window.visualViewport?.width ?? window.innerWidth, reservedSidebarWidth);
            if (nextWidth === store.width) return;
            store.setAgentState({ width: persistAgentPanelWidth(nextWidth, window.visualViewport?.width ?? window.innerWidth, reservedSidebarWidth) });
        };
        handleResize();
        window.addEventListener("resize", handleResize);
        window.visualViewport?.addEventListener("resize", handleResize);
        return () => {
            window.removeEventListener("resize", handleResize);
            window.visualViewport?.removeEventListener("resize", handleResize);
        };
    }, [compactPanel, reservedSidebarWidth]);

    useEffect(() => {
        if (!compactPanel || !interactive) return;
        const appContent = shellRef.current?.previousElementSibling;
        if (!(appContent instanceof HTMLElement)) return;
        const previousInert = appContent.hasAttribute("inert");
        const previousAriaHidden = appContent.getAttribute("aria-hidden");
        appContent.setAttribute("inert", "");
        appContent.setAttribute("aria-hidden", "true");
        const focusFrame = window.requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            useAgentStore.getState().closePanel();
        };
        window.addEventListener("keydown", closeOnEscape, true);
        return () => {
            window.cancelAnimationFrame(focusFrame);
            window.removeEventListener("keydown", closeOnEscape, true);
            if (!previousInert) appContent.removeAttribute("inert");
            if (previousAriaHidden === null) appContent.removeAttribute("aria-hidden");
            else appContent.setAttribute("aria-hidden", previousAriaHidden);
        };
    }, [compactPanel, interactive]);

    useEffect(() => {
        const handleFocusIn = (event: FocusEvent) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;
            if (panelRef.current?.contains(target)) {
                focusInsideRef.current = true;
            } else if (target !== document.body) {
                focusInsideRef.current = false;
                returnFocusRef.current = target;
            }
        };
        document.addEventListener("focusin", handleFocusIn);
        return () => document.removeEventListener("focusin", handleFocusIn);
    }, []);

    useEffect(() => useAgentStore.subscribe((state, previous) => {
        if (!previous.panelOpen || state.panelOpen) return;
        const activeElement = document.activeElement;
        if (!focusInsideRef.current && (!activeElement || !panelRef.current?.contains(activeElement))) return;
        focusInsideRef.current = false;
        const savedTarget = returnFocusRef.current;
        window.requestAnimationFrame(() => {
            const triggerLabels = new Set([t("topNav.openAgent"), t("topNav.closeAgent")]);
            const fallbackTarget = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
                (button) => triggerLabels.has(button.getAttribute("aria-label") || "") && isVisibleFocusTarget(button),
            );
            const routeStage = document.querySelector<HTMLElement>("[data-route-stage]");
            const target = isVisibleFocusTarget(savedTarget) ? savedTarget : fallbackTarget || (isVisibleFocusTarget(routeStage) ? routeStage : null);
            target?.focus({ preventScroll: true });
        });
    }), [t]);

    if (!panelMounted) return null;

    const transitionDuration = resizing || reducedMotion ? 0 : PANEL_MOTION_SECONDS;

    return (
        <motion.div
            ref={shellRef}
            className={compactPanel ? "fixed inset-x-0 bottom-0 top-[var(--desktop-titlebar-height)] z-[100] flex" : "relative z-[70] flex h-full shrink-0"}
            initial={false}
            animate={{ width: compactPanel ? "100%" : panelOpen ? width + 1 : 0, opacity: panelOpen ? 1 : 0 }}
            transition={{ duration: transitionDuration, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: "clip", pointerEvents: interactive ? undefined : "none" }}
            aria-hidden={!interactive}
            inert={interactive ? undefined : true}
        >
            <motion.aside
                ref={panelRef}
                className={compactPanel ? "relative flex h-full w-full shrink-0 flex-col" : "relative flex h-full shrink-0 flex-col border-l"}
                data-canvas-shortcuts-ignore
                role={compactPanel && interactive ? "dialog" : undefined}
                aria-modal={compactPanel && interactive ? true : undefined}
                aria-label={compactPanel && interactive ? t("agent.builtin.title") : undefined}
                tabIndex={compactPanel ? -1 : undefined}
                initial={false}
                animate={{ x: panelClosing ? 28 : 0 }}
                transition={{ duration: transitionDuration, ease: [0.22, 1, 0.36, 1] }}
                style={{ width: compactPanel ? "100%" : width, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            >
                {!compactPanel ? <button type="button" className="absolute inset-y-0 left-0 z-40 w-4 -translate-x-1/2 cursor-col-resize" onPointerDown={startResize} aria-label={t("agent.panel.resize")} /> : null}
                <BuiltinAgentPanel embedded />
            </motion.aside>
        </motion.div>
    );
}
