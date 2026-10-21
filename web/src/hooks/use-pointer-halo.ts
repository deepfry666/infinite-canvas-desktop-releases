import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent, type PointerEventHandler } from "react";

type HaloPoint = { x: number; y: number };
type HaloBounds = Pick<DOMRectReadOnly, "left" | "right" | "top" | "bottom" | "width" | "height">;
type HaloAxis = { position: number; velocity: number };
type HaloPhysics = { stiffness: number; damping: number };

export const POINTER_HALO_CORE_PHYSICS: HaloPhysics = { stiffness: 0.16, damping: 0.7 };
export const POINTER_HALO_FIELD_PHYSICS: HaloPhysics = { stiffness: 0.07, damping: 0.76 };

const SURFACE_CARRY_WINDOW_MS = 180;
const BLOOM_CINNABAR_MS = 120;
const BLOOM_DURATION_MS = 440;
const HALO_POSITION_PROPERTIES = ["--halo-core-x", "--halo-core-y", "--halo-field-x", "--halo-field-y", "--halo-x", "--halo-y"];
const FINE_POINTER_QUERY = "(any-hover: hover) and (any-pointer: fine)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

type PointerHaloMediaSnapshot = { fine: boolean; reduced: boolean };
type PointerHaloMediaQuery = {
    readonly matches: boolean;
    addEventListener: (type: "change", listener: () => void) => void;
    removeEventListener: (type: "change", listener: () => void) => void;
};
type PointerHaloMatchMedia = (query: string) => PointerHaloMediaQuery;

export function createPointerHaloMediaStore(resolveMatchMedia: () => PointerHaloMatchMedia | null) {
    let fineQuery: PointerHaloMediaQuery | null = null;
    let reducedQuery: PointerHaloMediaQuery | null = null;
    let listening = false;
    let snapshot: PointerHaloMediaSnapshot = { fine: true, reduced: false };
    const subscribers = new Set<(value: PointerHaloMediaSnapshot) => void>();

    const read = () => {
        const matchMedia = resolveMatchMedia();
        if (!matchMedia) return snapshot;
        fineQuery ??= matchMedia(FINE_POINTER_QUERY);
        reducedQuery ??= matchMedia(REDUCED_MOTION_QUERY);
        const next = { fine: fineQuery.matches, reduced: reducedQuery.matches };
        if (next.fine !== snapshot.fine || next.reduced !== snapshot.reduced) snapshot = next;
        return snapshot;
    };
    const notify = () => {
        const next = read();
        [...subscribers].forEach((subscriber) => subscriber(next));
    };
    const start = () => {
        read();
        if (listening || !fineQuery || !reducedQuery) return;
        fineQuery.addEventListener("change", notify);
        reducedQuery.addEventListener("change", notify);
        listening = true;
    };
    const stop = () => {
        if (listening) {
            fineQuery?.removeEventListener("change", notify);
            reducedQuery?.removeEventListener("change", notify);
        }
        listening = false;
        fineQuery = null;
        reducedQuery = null;
    };

    return {
        getSnapshot: read,
        subscribe(subscriber: (value: PointerHaloMediaSnapshot) => void) {
            subscribers.add(subscriber);
            start();
            subscriber(snapshot);
            return () => {
                subscribers.delete(subscriber);
                if (subscribers.size === 0) stop();
            };
        },
    };
}

const pointerHaloMediaStore = createPointerHaloMediaStore(() =>
    typeof window === "undefined" ? null : window.matchMedia.bind(window),
);

export function advanceHaloAxis(axis: HaloAxis, target: number, physics: HaloPhysics): HaloAxis {
    const velocity = (axis.velocity + (target - axis.position) * physics.stiffness) * physics.damping;
    return { position: axis.position + velocity, velocity };
}

export function carryHaloPointIntoBounds(point: HaloPoint, bounds: Pick<HaloBounds, "left" | "right" | "top" | "bottom">): HaloPoint {
    return {
        x: Math.min(bounds.right, Math.max(bounds.left, point.x)),
        y: Math.min(bounds.bottom, Math.max(bounds.top, point.y)),
    };
}

type PointerHaloOptions<T extends HTMLElement> = {
    legacyPosition?: "core" | "field" | false;
    suppressBloom?: (event: ReactPointerEvent<T>) => boolean;
};

export type PointerHaloController<T extends HTMLElement> = {
    onPointerEnter: PointerEventHandler<T>;
    onPointerMove: PointerEventHandler<T>;
    onPointerLeave: PointerEventHandler<T>;
    onPointerDown: PointerEventHandler<T>;
    onPointerCancel: PointerEventHandler<T>;
    cancelBloom: () => void;
    clear: () => void;
};

function now() {
    return typeof performance === "undefined" ? Date.now() : performance.now();
}

function removePointerStyles(element: HTMLElement | null) {
    if (!element) return;
    element.removeAttribute("data-halo-pointer");
    HALO_POSITION_PROPERTIES.forEach((property) => element.style.removeProperty(property));
}

function targetSuppressesBloom(target: EventTarget | null) {
    return typeof Element !== "undefined" && target instanceof Element && Boolean(target.closest("[data-halo-ignore], [data-halo-bloom-suppress]"));
}

export function usePointerHalo<T extends HTMLElement>(options: PointerHaloOptions<T> = {}): PointerHaloController<T> {
    const optionsRef = useRef(options);
    optionsRef.current = options;
    const frameRef = useRef<number | null>(null);
    const bloomTimerRef = useRef<number | null>(null);
    const bloomAnimationRef = useRef<Animation | null>(null);
    const bloomElementRef = useRef<HTMLElement | null>(null);
    const confirmingSurfaceRef = useRef<T | null>(null);
    const motionRef = useRef({
        element: null as T | null,
        bounds: null as HaloBounds | null,
        target: { x: 0, y: 0 },
        core: { x: 0, y: 0 },
        coreVelocity: { x: 0, y: 0 },
        field: { x: 0, y: 0 },
        fieldVelocity: { x: 0, y: 0 },
        hasPosition: false,
        lastInputAt: 0,
    });

    const readMedia = useCallback(() => {
        return pointerHaloMediaStore.getSnapshot();
    }, []);

    const cancelFrame = useCallback(() => {
        if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
    }, []);

    const clearPointer = useCallback(() => {
        cancelFrame();
        removePointerStyles(motionRef.current.element);
        motionRef.current.element = null;
        motionRef.current.bounds = null;
    }, [cancelFrame]);

    const cancelBloom = useCallback(() => {
        if (bloomTimerRef.current !== null) window.clearTimeout(bloomTimerRef.current);
        bloomTimerRef.current = null;
        bloomAnimationRef.current?.cancel();
        bloomAnimationRef.current = null;
        const bloom = bloomElementRef.current;
        bloom?.removeAttribute("data-halo-bloom-active");
        bloom?.removeAttribute("data-halo-bloom-phase");
        bloom?.style.removeProperty("--bloom-x");
        bloom?.style.removeProperty("--bloom-y");
        bloomElementRef.current = null;
        confirmingSurfaceRef.current?.removeAttribute("data-halo-confirming");
        confirmingSurfaceRef.current = null;
    }, []);

    const clear = useCallback(() => {
        clearPointer();
        cancelBloom();
        const motion = motionRef.current;
        motion.hasPosition = false;
        motion.coreVelocity = { x: 0, y: 0 };
        motion.fieldVelocity = { x: 0, y: 0 };
    }, [cancelBloom, clearPointer]);

    const writePosition = useCallback((element: T, bounds: HaloBounds) => {
        const motion = motionRef.current;
        const core = carryHaloPointIntoBounds(motion.core, bounds);
        const field = carryHaloPointIntoBounds(motion.field, bounds);
        const coreX = core.x - bounds.left;
        const coreY = core.y - bounds.top;
        const fieldX = field.x - bounds.left;
        const fieldY = field.y - bounds.top;
        element.style.setProperty("--halo-core-x", `${coreX.toFixed(2)}px`);
        element.style.setProperty("--halo-core-y", `${coreY.toFixed(2)}px`);
        element.style.setProperty("--halo-field-x", `${fieldX.toFixed(2)}px`);
        element.style.setProperty("--halo-field-y", `${fieldY.toFixed(2)}px`);
        const legacyPosition = optionsRef.current.legacyPosition ?? "field";
        if (legacyPosition) {
            const point = legacyPosition === "core" ? { x: coreX, y: coreY } : { x: fieldX, y: fieldY };
            element.style.setProperty("--halo-x", `${point.x.toFixed(2)}px`);
            element.style.setProperty("--halo-y", `${point.y.toFixed(2)}px`);
        }
    }, []);

    const render = useCallback(() => {
        const motion = motionRef.current;
        const element = motion.element;
        const bounds = motion.bounds;
        if (!element?.isConnected || !bounds) {
            frameRef.current = null;
            motion.element = null;
            motion.bounds = null;
            return;
        }

        const coreX = advanceHaloAxis({ position: motion.core.x, velocity: motion.coreVelocity.x }, motion.target.x, POINTER_HALO_CORE_PHYSICS);
        const coreY = advanceHaloAxis({ position: motion.core.y, velocity: motion.coreVelocity.y }, motion.target.y, POINTER_HALO_CORE_PHYSICS);
        const fieldX = advanceHaloAxis({ position: motion.field.x, velocity: motion.fieldVelocity.x }, motion.target.x, POINTER_HALO_FIELD_PHYSICS);
        const fieldY = advanceHaloAxis({ position: motion.field.y, velocity: motion.fieldVelocity.y }, motion.target.y, POINTER_HALO_FIELD_PHYSICS);
        motion.core = { x: coreX.position, y: coreY.position };
        motion.coreVelocity = { x: coreX.velocity, y: coreY.velocity };
        motion.field = { x: fieldX.position, y: fieldY.position };
        motion.fieldVelocity = { x: fieldX.velocity, y: fieldY.velocity };
        writePosition(element, bounds);

        const remaining =
            Math.abs(motion.target.x - motion.core.x) + Math.abs(motion.target.y - motion.core.y) + Math.abs(motion.coreVelocity.x) + Math.abs(motion.coreVelocity.y) +
            Math.abs(motion.target.x - motion.field.x) + Math.abs(motion.target.y - motion.field.y) + Math.abs(motion.fieldVelocity.x) + Math.abs(motion.fieldVelocity.y);
        if (remaining > 0.24) frameRef.current = requestAnimationFrame(render);
        else {
            motion.core = motion.field = { ...motion.target };
            motion.coreVelocity = motion.fieldVelocity = { x: 0, y: 0 };
            writePosition(element, bounds);
            frameRef.current = null;
        }
    }, [writePosition]);

    const onPointerMove = useCallback<PointerEventHandler<T>>((event) => {
        const media = readMedia();
        if (event.pointerType === "touch" || media.reduced || !media.fine) {
            clear();
            return;
        }

        const element = event.currentTarget;
        const bounds = element.getBoundingClientRect();
        const target = carryHaloPointIntoBounds({ x: event.clientX, y: event.clientY }, bounds);
        const motion = motionRef.current;
        const timestamp = now();
        if (motion.element !== element) {
            removePointerStyles(motion.element);
            const canCarry = motion.hasPosition && timestamp - motion.lastInputAt <= SURFACE_CARRY_WINDOW_MS;
            motion.element = element;
            motion.bounds = bounds;
            motion.target = target;
            if (canCarry) {
                motion.core = carryHaloPointIntoBounds(motion.core, bounds);
                motion.field = carryHaloPointIntoBounds(motion.field, bounds);
            } else {
                motion.core = motion.field = { ...target };
                motion.coreVelocity = motion.fieldVelocity = { x: 0, y: 0 };
            }
            motion.hasPosition = true;
            element.setAttribute("data-halo-pointer", "fine");
            writePosition(element, bounds);
        } else {
            motion.bounds = bounds;
            motion.target = target;
        }
        motion.lastInputAt = timestamp;
        if (frameRef.current === null) frameRef.current = requestAnimationFrame(render);
    }, [clear, readMedia, render, writePosition]);

    const onPointerLeave = useCallback<PointerEventHandler<T>>((event) => {
        const motion = motionRef.current;
        if (motion.element !== event.currentTarget) return;
        cancelFrame();
        removePointerStyles(event.currentTarget);
        motion.element = null;
        motion.bounds = null;
        motion.lastInputAt = now();
    }, [cancelFrame]);

    const onPointerDown = useCallback<PointerEventHandler<T>>((event) => {
        const media = readMedia();
        if (event.pointerType === "touch" || media.reduced || !media.fine || !event.isPrimary || event.button !== 0 || optionsRef.current.suppressBloom?.(event) || targetSuppressesBloom(event.target)) return;
        const surface = event.currentTarget;
        const bloom = surface.querySelector<HTMLElement>("[data-halo-bloom]");
        if (!bloom) return;

        cancelBloom();
        const bounds = surface.getBoundingClientRect();
        const motion = motionRef.current;
        const origin = motion.element === surface && motion.hasPosition ? carryHaloPointIntoBounds(motion.field, bounds) : carryHaloPointIntoBounds({ x: event.clientX, y: event.clientY }, bounds);
        const x = origin.x - bounds.left;
        const y = origin.y - bounds.top;
        const radius = Math.hypot(Math.max(x, bounds.width - x), Math.max(y, bounds.height - y)) * 1.08;
        bloom.style.setProperty("--bloom-x", `${x.toFixed(2)}px`);
        bloom.style.setProperty("--bloom-y", `${y.toFixed(2)}px`);
        bloom.setAttribute("data-halo-bloom-active", "true");
        bloom.setAttribute("data-halo-bloom-phase", "cinnabar");
        surface.setAttribute("data-halo-confirming", "true");
        bloomElementRef.current = bloom;
        confirmingSurfaceRef.current = surface;
        bloomTimerRef.current = window.setTimeout(() => {
            if (bloomElementRef.current === bloom) bloom.setAttribute("data-halo-bloom-phase", "gold");
            bloomTimerRef.current = null;
        }, BLOOM_CINNABAR_MS);
        const animation = bloom.animate(
            [
                { clipPath: `circle(0px at ${x}px ${y}px)`, opacity: 0 },
                { clipPath: `circle(${radius * 0.4}px at ${x}px ${y}px)`, opacity: 0.42, offset: 0.32 },
                { clipPath: `circle(${radius}px at ${x}px ${y}px)`, opacity: 0 },
            ],
            { duration: BLOOM_DURATION_MS, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
        );
        bloomAnimationRef.current = animation;
        void animation.finished.then(() => {
            if (bloomAnimationRef.current === animation) cancelBloom();
        }).catch(() => {
            if (bloomAnimationRef.current === animation) cancelBloom();
        });
    }, [cancelBloom, readMedia]);

    const onPointerCancel = useCallback<PointerEventHandler<T>>(() => clear(), [clear]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const unsubscribe = pointerHaloMediaStore.subscribe((media) => {
            if (!media.fine || media.reduced) clear();
        });
        return () => {
            unsubscribe();
            clear();
        };
    }, [clear]);

    return { onPointerEnter: onPointerMove, onPointerMove, onPointerLeave, onPointerDown, onPointerCancel, cancelBloom, clear };
}
