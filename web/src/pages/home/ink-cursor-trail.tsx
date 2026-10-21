import { type CSSProperties, type RefObject, useEffect, useRef } from "react";

import {
    advanceBrandVisual,
    advancePointerMotion,
    beginPointerVisual,
    beginSettlingVisual,
    brandGrid,
    createBrandVisualState,
    createIdlePulse,
    createPointerMotionState,
    createSeededRandom,
    isPointerMotionSettled,
    pauseBrandVisual,
    pickIdleCandidate,
    updatePointerTarget,
    type IdleCandidate,
    type PointerMotionState,
} from "./home-brand-motion";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const IDLE_CELL_RESIZE_SETTLE_MS = 96;

type MotionStyle = CSSProperties & Record<`--${string}`, string>;

const fieldStyle: MotionStyle = {
    "--idle-layer-opacity": "0",
    "--core-opacity": "0",
    "--body-opacity": "0",
    "--core-front-x": "50%",
    "--core-front-y": "50%",
    "--core-back-x": "50%",
    "--core-back-y": "50%",
    "--body-front-x": "50%",
    "--body-front-y": "50%",
    "--body-back-x": "50%",
    "--body-back-y": "50%",
    "--core-front-radius": "215px",
    "--core-back-radius": "188px",
    "--body-front-radius": "380px",
    "--body-back-radius": "344px",
    contain: "layout paint style",
    isolation: "isolate",
};

const idleLayerStyle: CSSProperties = { opacity: "var(--idle-layer-opacity)" };

const bodyRevealStyle: CSSProperties = {
    WebkitMaskImage:
        "radial-gradient(circle var(--body-front-radius) at var(--body-front-x) var(--body-front-y), #000 0%, rgba(0,0,0,.8) 34%, rgba(0,0,0,.4) 66%, transparent 92%), radial-gradient(circle var(--body-back-radius) at var(--body-back-x) var(--body-back-y), rgba(0,0,0,.76) 0%, rgba(0,0,0,.56) 38%, rgba(0,0,0,.28) 68%, transparent 92%)",
    maskImage:
        "radial-gradient(circle var(--body-front-radius) at var(--body-front-x) var(--body-front-y), #000 0%, rgba(0,0,0,.8) 34%, rgba(0,0,0,.4) 66%, transparent 92%), radial-gradient(circle var(--body-back-radius) at var(--body-back-x) var(--body-back-y), rgba(0,0,0,.76) 0%, rgba(0,0,0,.56) 38%, rgba(0,0,0,.28) 68%, transparent 92%)",
    opacity: "var(--body-opacity)",
};

const coreRevealStyle: CSSProperties = {
    WebkitMaskImage:
        "radial-gradient(circle var(--core-front-radius) at var(--core-front-x) var(--core-front-y), #000 0%, rgba(0,0,0,.72) 32%, rgba(0,0,0,.32) 64%, transparent 90%), radial-gradient(circle var(--core-back-radius) at var(--core-back-x) var(--core-back-y), rgba(0,0,0,.66) 0%, rgba(0,0,0,.42) 38%, rgba(0,0,0,.2) 68%, transparent 92%)",
    maskImage:
        "radial-gradient(circle var(--core-front-radius) at var(--core-front-x) var(--core-front-y), #000 0%, rgba(0,0,0,.72) 32%, rgba(0,0,0,.32) 64%, transparent 90%), radial-gradient(circle var(--core-back-radius) at var(--core-back-x) var(--core-back-y), rgba(0,0,0,.66) 0%, rgba(0,0,0,.42) 38%, rgba(0,0,0,.2) 68%, transparent 92%)",
    opacity: "var(--core-opacity)",
};

const idleCellStyle: CSSProperties = { opacity: 0 };
const spacer = "\u00a0";

type PatternVariant = "base" | "idle" | "body" | "core";
type IdleCellRefs = { current: Array<HTMLSpanElement | null> };

function Pattern({ variant, idleCellRefs }: { variant: PatternVariant; idleCellRefs?: IdleCellRefs }) {
    const style = variant === "idle" ? idleLayerStyle : variant === "body" ? bodyRevealStyle : variant === "core" ? coreRevealStyle : undefined;
    const color = variant === "base" ? "text-brand/[0.018]" : variant === "body" ? "text-brand/[0.09]" : variant === "core" ? "text-brand-glint/[0.065]" : "text-brand";
    return (
        <div data-brand-layer={variant} className={`absolute inset-0 grid grid-rows-9 ${color}`} style={style}>
            {brandGrid.map((cells, row) => (
                <div key={row} className="flex min-h-0 items-center overflow-visible">
                    <span className={`whitespace-pre font-sans text-[clamp(3rem,min(6.2vw,10vh),6.5rem)] font-normal leading-none tracking-[0.08em] ${row % 2 ? "-ml-[8%]" : "-ml-[1%]"}`}>
                        {cells.map((cell) => (
                            <span
                                key={cell.id}
                                ref={variant === "idle" && cell.isGlyph ? (node) => {
                                    if (idleCellRefs) idleCellRefs.current[cell.index] = node;
                                } : undefined}
                                data-brand-cell-id={cell.id}
                                style={variant === "idle" ? idleCellStyle : undefined}
                            >
                                {cell.char === " " ? spacer : cell.char}
                            </span>
                        ))}
                    </span>
                </div>
            ))}
        </div>
    );
}

type ActiveIdle = { animation: Animation; element: HTMLSpanElement; gold: boolean };

export function BrandCursorField({ containerRef }: { containerRef: RefObject<HTMLElement | null> }) {
    const layerRef = useRef<HTMLDivElement>(null);
    const idleCellRefs = useRef<Array<HTMLSpanElement | null>>([]);

    useEffect(() => {
        const container = containerRef.current;
        const layer = layerRef.current;
        if (!container || !layer) return;

        const motionPreference = window.matchMedia(REDUCED_MOTION_QUERY);
        const seed = window.crypto?.getRandomValues(new Uint32Array(1))[0] || Date.now();
        const random = createSeededRandom(seed);
        const visual = createBrandVisualState();
        const activeIdle = new Map<number, ActiveIdle>();
        const cooldownUntil = new Map<number, number>();
        const recentIdle: number[] = [];
        let idleCandidates: IdleCandidate[] = [];
        let minIdleDistance = 88;
        let bounds = container.getBoundingClientRect();
        let motion: PointerMotionState | null = null;
        let frame: number | null = null;
        let idleTimer: number | null = null;
        let settleTimer: number | null = null;
        let resizeMeasureTimer: number | null = null;
        let idleCellMeasurementPending = false;
        let lastFrameAt = 0;
        let lastPointerAt = 0;
        let renderedPhase = "";
        let pointerInside = false;
        let enabled = false;
        let intersecting = true;
        let pageVisible = !document.hidden;
        let disposed = false;

        const writeFrame = () => {
            const style = layer.style;
            style.setProperty("--idle-layer-opacity", visual.idleOpacity.toFixed(3));
            style.setProperty("--core-opacity", visual.coreOpacity.toFixed(3));
            style.setProperty("--body-opacity", visual.bodyOpacity.toFixed(3));
            if (motion) {
                const geometry = motion.geometry;
                style.setProperty("--core-front-x", `${geometry.coreFront.x.toFixed(2)}px`);
                style.setProperty("--core-front-y", `${geometry.coreFront.y.toFixed(2)}px`);
                style.setProperty("--core-back-x", `${geometry.coreBack.x.toFixed(2)}px`);
                style.setProperty("--core-back-y", `${geometry.coreBack.y.toFixed(2)}px`);
                style.setProperty("--body-front-x", `${geometry.bodyFront.x.toFixed(2)}px`);
                style.setProperty("--body-front-y", `${geometry.bodyFront.y.toFixed(2)}px`);
                style.setProperty("--body-back-x", `${geometry.bodyBack.x.toFixed(2)}px`);
                style.setProperty("--body-back-y", `${geometry.bodyBack.y.toFixed(2)}px`);
                style.setProperty("--core-front-radius", `${geometry.coreFrontRadius.toFixed(2)}px`);
                style.setProperty("--core-back-radius", `${geometry.coreBackRadius.toFixed(2)}px`);
                style.setProperty("--body-front-radius", `${geometry.bodyFrontRadius.toFixed(2)}px`);
                style.setProperty("--body-back-radius", `${geometry.bodyBackRadius.toFixed(2)}px`);
            }
            if (renderedPhase !== visual.phase) {
                renderedPhase = visual.phase;
                layer.dataset.motionState = visual.phase;
            }
        };

        const updateBounds = () => {
            bounds = container.getBoundingClientRect();
        };

        const measureIdleCells = () => {
            updateBounds();
            const nextCandidates: IdleCandidate[] = [];
            for (const cells of brandGrid) {
                for (const cell of cells) {
                    if (!cell.isGlyph) continue;
                    const element = idleCellRefs.current[cell.index];
                    if (!element) continue;
                    const rect = element.getBoundingClientRect();
                    nextCandidates.push({ index: cell.index, row: cell.row, column: cell.column, x: rect.left + rect.width / 2 - bounds.left, y: rect.top + rect.height / 2 - bounds.top });
                }
            }
            idleCandidates = nextCandidates;
            minIdleDistance = Math.max(92, Math.min(132, bounds.height / 7.5));
        };

        const clearIdleTimer = () => {
            if (idleTimer !== null) window.clearTimeout(idleTimer);
            idleTimer = null;
        };

        const clearSettleTimer = () => {
            if (settleTimer !== null) window.clearTimeout(settleTimer);
            settleTimer = null;
        };

        const clearResizeMeasureTimer = () => {
            if (resizeMeasureTimer !== null) window.clearTimeout(resizeMeasureTimer);
            resizeMeasureTimer = null;
        };

        const scheduleIdleCellMeasurement = () => {
            clearResizeMeasureTimer();
            idleCellMeasurementPending = true;
            resizeMeasureTimer = window.setTimeout(() => {
                resizeMeasureTimer = null;
                idleCellMeasurementPending = false;
                if (enabled) measureIdleCells();
            }, IDLE_CELL_RESIZE_SETTLE_MS);
        };

        const cancelIdleAnimations = () => {
            for (const { animation, element } of activeIdle.values()) {
                animation.cancel();
                element.style.opacity = "0";
                element.style.removeProperty("color");
            }
            activeIdle.clear();
        };

        const scheduleIdleTick = (delay: number) => {
            if (!enabled || visual.phase !== "idle" || idleTimer !== null) return;
            idleTimer = window.setTimeout(runIdleTick, delay);
        };

        const activateIdleCell = (staggered = false) => {
            if (idleCellMeasurementPending) return false;
            const now = performance.now();
            const candidate = pickIdleCandidate(idleCandidates, new Set(activeIdle.keys()), cooldownUntil, recentIdle, now, minIdleDistance, random);
            if (!candidate) return false;
            const element = idleCellRefs.current[candidate.index];
            if (!element) return false;
            const { gold, peakOpacity, duration } = createIdlePulse(random, ![...activeIdle.values()].some((item) => item.gold));
            element.style.color = gold ? "var(--brand-glint)" : "var(--brand)";
            element.style.opacity = "0";
            const animation = element.animate(
                [
                    { opacity: 0, offset: 0, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
                    { opacity: peakOpacity, offset: 0.4, easing: "ease-in-out" },
                    { opacity: peakOpacity * 0.92, offset: 0.58, easing: "cubic-bezier(0.4, 0, 1, 1)" },
                    { opacity: 0, offset: 1 },
                ],
                { duration },
            );
            activeIdle.set(candidate.index, { animation, element, gold });
            cooldownUntil.set(candidate.index, now + duration + 5500 + random() * 3500);
            recentIdle.push(candidate.index);
            if (recentIdle.length > 6) recentIdle.shift();
            animation.onfinish = () => {
                activeIdle.delete(candidate.index);
                element.style.opacity = "0";
                element.style.removeProperty("color");
                if (enabled && visual.phase === "idle" && activeIdle.size < 4) {
                    clearIdleTimer();
                    scheduleIdleTick(80);
                }
            };
            if (staggered) animation.currentTime = duration * random() * 0.58;
            return true;
        };

        function runIdleTick() {
            idleTimer = null;
            if (!enabled || visual.phase !== "idle") return;
            while (activeIdle.size < 4 && activateIdleCell()) {
                // Keep the idle field visibly populated without synchronizing cycles.
            }
            if (activeIdle.size < 7 && random() < 0.78) activateIdleCell();
            scheduleIdleTick(450 + random() * 220);
        }

        const startIdle = () => {
            if (!enabled || visual.phase !== "idle") return;
            if (!activeIdle.size) {
                const initialCount = 4 + Math.floor(random() * 2);
                for (let index = 0; index < initialCount; index += 1) activateIdleCell(true);
            }
            scheduleIdleTick(420 + random() * 180);
        };

        const needsAnotherFrame = () => {
            const visualMoving = visual.phase === "handoff" || visual.phase === "settling" || (visual.phase === "idle" && visual.idleOpacity < 0.999) || (visual.phase === "tracking" && (visual.coreOpacity < 0.999 || visual.bodyOpacity < 0.999));
            return visualMoving || Boolean(motion && visual.phase !== "idle" && !isPointerMotionSettled(motion));
        };

        const render = (now: number) => {
            frame = null;
            if (!enabled) return;
            const elapsed = Math.min(Math.max((now - lastFrameAt) / 1000, 1 / 240), 0.05);
            lastFrameAt = now;
            if (motion) advancePointerMotion(motion, elapsed, Math.max(0, (now - lastPointerAt) / 1000));
            const transition = advanceBrandVisual(visual, elapsed, motion ? isPointerMotionSettled(motion) : true);
            if (transition.finishedHandoff) cancelIdleAnimations();
            if (transition.enteredIdle) {
                if (!pointerInside) motion = null;
                startIdle();
            }
            writeFrame();
            if (needsAnotherFrame()) frame = window.requestAnimationFrame(render);
        };

        const requestFrame = () => {
            if (!enabled || frame !== null) return;
            lastFrameAt = performance.now();
            frame = window.requestAnimationFrame(render);
        };

        const beginSettling = () => {
            clearSettleTimer();
            beginSettlingVisual(visual);
            requestFrame();
        };

        const scheduleSettling = () => {
            clearSettleTimer();
            settleTimer = window.setTimeout(beginSettling, 1300);
        };

        const handlePointerMove = (event: PointerEvent) => {
            if (!enabled || event.pointerType === "touch") return;
            const samples = event.getCoalescedEvents?.();
            const sample = samples?.length ? samples[samples.length - 1] : event;
            const now = performance.now();
            const x = Math.min(Math.max(sample.clientX - bounds.left, 0), bounds.width);
            const y = Math.min(Math.max(sample.clientY - bounds.top, 0), bounds.height);
            if (!motion || !pointerInside) motion = createPointerMotionState(x, y);
            else updatePointerTarget(motion, x, y, Math.max((now - lastPointerAt) / 1000, 0.008));
            pointerInside = true;
            lastPointerAt = now;
            clearIdleTimer();
            beginPointerVisual(visual);
            if (visual.phase === "tracking" && activeIdle.size) cancelIdleAnimations();
            scheduleSettling();
            requestFrame();
        };

        const handlePointerLeave = () => {
            if (!enabled) return;
            pointerInside = false;
            beginSettling();
        };

        const disableMotion = () => {
            enabled = false;
            clearIdleTimer();
            clearSettleTimer();
            clearResizeMeasureTimer();
            idleCellMeasurementPending = false;
            cancelIdleAnimations();
            if (frame !== null) window.cancelAnimationFrame(frame);
            frame = null;
            motion = null;
            pointerInside = false;
            pauseBrandVisual(visual);
            writeFrame();
        };

        const enableMotion = () => {
            if (enabled) return;
            enabled = true;
            visual.phase = "idle";
            visual.idleOpacity = 0;
            visual.coreOpacity = 0;
            visual.bodyOpacity = 0;
            visual.settlingElapsed = 0;
            measureIdleCells();
            startIdle();
            requestFrame();
        };

        const syncActivity = () => {
            if (!motionPreference.matches && pageVisible && intersecting) enableMotion();
            else disableMotion();
        };

        const handleVisibility = () => {
            pageVisible = !document.hidden;
            syncActivity();
        };

        const handleMotionPreference = () => syncActivity();
        const scrollContainer = container.parentElement;
        const resizeObserver = new ResizeObserver(() => {
            updateBounds();
            scheduleIdleCellMeasurement();
        });
        const intersectionObserver = new IntersectionObserver(([entry]) => {
            intersecting = entry.isIntersecting;
            syncActivity();
        }, { threshold: 0.02 });

        resizeObserver.observe(container);
        intersectionObserver.observe(container);
        container.addEventListener("pointerenter", updateBounds, { passive: true });
        container.addEventListener("pointermove", handlePointerMove, { passive: true });
        container.addEventListener("pointerleave", handlePointerLeave);
        container.addEventListener("pointercancel", handlePointerLeave);
        scrollContainer?.addEventListener("scroll", updateBounds, { passive: true });
        document.addEventListener("visibilitychange", handleVisibility);
        motionPreference.addEventListener("change", handleMotionPreference);
        syncActivity();
        void document.fonts?.ready.then(() => {
            if (!disposed && enabled) measureIdleCells();
        });

        return () => {
            disposed = true;
            container.removeEventListener("pointerenter", updateBounds);
            container.removeEventListener("pointermove", handlePointerMove);
            container.removeEventListener("pointerleave", handlePointerLeave);
            container.removeEventListener("pointercancel", handlePointerLeave);
            scrollContainer?.removeEventListener("scroll", updateBounds);
            document.removeEventListener("visibilitychange", handleVisibility);
            motionPreference.removeEventListener("change", handleMotionPreference);
            resizeObserver.disconnect();
            intersectionObserver.disconnect();
            disableMotion();
        };
    }, [containerRef]);

    return (
        <div ref={layerRef} aria-hidden="true" data-brand-cursor-field className="pointer-events-none absolute inset-0 overflow-hidden" style={fieldStyle}>
            <Pattern variant="base" />
            <Pattern variant="idle" idleCellRefs={idleCellRefs} />
            <Pattern variant="body" />
            <Pattern variant="core" />
        </div>
    );
}
