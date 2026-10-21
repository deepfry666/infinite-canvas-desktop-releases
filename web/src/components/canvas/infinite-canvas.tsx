import React, { useCallback, useEffect, useRef, useState } from "react";

import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { shouldCanvasHandleWheel } from "@/lib/canvas/wheel-routing";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ViewportTransform } from "@/types/canvas";

export type CanvasInteractionTool = "select" | "pan";

type InfiniteCanvasProps = {
    containerRef: React.RefObject<HTMLDivElement | null>;
    viewport: ViewportTransform;
    tool: CanvasInteractionTool;
    backgroundMode?: CanvasBackgroundMode;
    onViewportChange: (viewport: ViewportTransform) => void;
    onCanvasMouseDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
    onCanvasDeselect?: () => void;
    onCanvasDoubleClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
    onContextMenu?: (event: React.MouseEvent) => void;
    onDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
    children: React.ReactNode;
};

const MIN_SCALE = 0.05;
const MAX_SCALE = 5;

function normalizeWheelDelta(delta: number, deltaMode: number, pageSize: number) {
    if (deltaMode === 1) return delta * 16;
    if (deltaMode === 2) return delta * pageSize;
    return delta;
}

export function InfiniteCanvas({ containerRef, viewport, tool, backgroundMode = "lines", onViewportChange, onCanvasMouseDown, onCanvasDeselect, onCanvasDoubleClick, onContextMenu, onDrop, children }: InfiniteCanvasProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const panState = useRef({
        isPanning: false,
        startX: 0,
        startY: 0,
        initialX: 0,
        initialY: 0,
        initialScale: 1,
        hasMoved: false,
        startedOnBackground: false,
    });
    const viewportRef = useRef(viewport);
    const onViewportChangeRef = useRef(onViewportChange);
    const frameRef = useRef<number | null>(null);
    const nextViewportRef = useRef<ViewportTransform | null>(null);
    const [isSpacePressed, setIsSpacePressed] = useState(false);
    const [isPanning, setIsPanning] = useState(false);

    onViewportChangeRef.current = onViewportChange;

    useEffect(() => {
        if (frameRef.current !== null && nextViewportRef.current) {
            cancelAnimationFrame(frameRef.current);
            frameRef.current = null;
            nextViewportRef.current = null;
        }
        viewportRef.current = viewport;
    }, [viewport]);

    const scheduleViewportChange = useCallback((next: ViewportTransform) => {
        viewportRef.current = next;
        nextViewportRef.current = next;
        if (frameRef.current !== null) return;
        frameRef.current = requestAnimationFrame(() => {
            frameRef.current = null;
            const pendingViewport = nextViewportRef.current;
            nextViewportRef.current = null;
            if (pendingViewport) onViewportChangeRef.current(pendingViewport);
        });
    }, []);

    useEffect(
        () => () => {
            if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
            nextViewportRef.current = null;
        },
        [],
    );

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.code !== "Space") return;
            const target = event.target instanceof Element ? event.target : null;
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || target?.closest("button,a,[role='button'],[contenteditable='true'],[data-canvas-no-zoom],[data-canvas-shortcuts-ignore]")) return;
            event.preventDefault();
            setIsSpacePressed(true);
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.code === "Space") {
                const target = event.target instanceof Element ? event.target : null;
                if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || target?.closest("button,a,[role='button'],[contenteditable='true'],[data-canvas-no-zoom],[data-canvas-shortcuts-ignore]"))) event.preventDefault();
                setIsSpacePressed(false);
            }
        };

        const handleBlur = () => {
            setIsSpacePressed(false);
            panState.current.isPanning = false;
            setIsPanning(false);
            document.body.style.cursor = "";
        };

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        window.addEventListener("blur", handleBlur);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
            window.removeEventListener("blur", handleBlur);
        };
    }, []);

    const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
        const target = event.target instanceof Element ? event.target : null;
        const modified = event.ctrlKey || event.metaKey;
        if (!shouldCanvasHandleWheel(target, modified)) return;
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const currentViewport = viewportRef.current;
        const deltaX = normalizeWheelDelta(event.deltaX, event.deltaMode, rect.width);
        const deltaY = normalizeWheelDelta(event.deltaY, event.deltaMode, rect.height);

        if (!modified) {
            if (!deltaX && !deltaY) return;
            scheduleViewportChange({
                x: currentViewport.x - deltaX,
                y: currentViewport.y - deltaY,
                k: currentViewport.k,
            });
            return;
        }

        if (!deltaY) return;
        const factor = Math.pow(1.1, -deltaY / 100);
        const newScale = Math.min(Math.max(currentViewport.k * factor, MIN_SCALE), MAX_SCALE);
        if (newScale === currentViewport.k) return;

        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        const worldX = (mouseX - currentViewport.x) / currentViewport.k;
        const worldY = (mouseY - currentViewport.y) / currentViewport.k;

        scheduleViewportChange({
            x: mouseX - worldX * newScale,
            y: mouseY - worldY * newScale,
            k: newScale,
        });
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-connection-create-menu]")) return;
        const isBackgroundClick = !target?.closest("[data-node-id],[data-connection-id]");
        const activeTool: CanvasInteractionTool = isSpacePressed ? "pan" : tool;
        const shouldPan = event.button === 1 || (event.button === 0 && activeTool === "pan");
        if (target?.closest("[data-canvas-no-zoom]") && !shouldPan) return;

        if (shouldPan) {
            const currentViewport = viewportRef.current;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            panState.current = {
                isPanning: true,
                startX: event.clientX,
                startY: event.clientY,
                initialX: currentViewport.x,
                initialY: currentViewport.y,
                initialScale: currentViewport.k,
                hasMoved: false,
                startedOnBackground: isBackgroundClick,
            };
            setIsPanning(true);
            document.body.style.cursor = "grabbing";
            return;
        }

        if (event.button === 0 && isBackgroundClick) {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            onCanvasMouseDown?.(event);
        }
    };

    const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-canvas-no-zoom],[data-node-id],[data-connection-id]")) return;
        onCanvasDoubleClick?.(event);
    };

    useEffect(() => {
        const handlePointerMove = (event: PointerEvent) => {
            if (!panState.current.isPanning) return;

            const dx = event.clientX - panState.current.startX;
            const dy = event.clientY - panState.current.startY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                panState.current.hasMoved = true;
            }

            scheduleViewportChange({
                x: panState.current.initialX + dx,
                y: panState.current.initialY + dy,
                k: panState.current.initialScale,
            });
        };

        const handlePointerUp = () => {
            if (!panState.current.isPanning) return;

            if (!panState.current.hasMoved && panState.current.startedOnBackground) {
                onCanvasDeselect?.();
            }
            panState.current.isPanning = false;
            setIsPanning(false);
            document.body.style.cursor = "";
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", handlePointerUp);
        return () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", handlePointerUp);
            document.body.style.cursor = "";
        };
    }, [onCanvasDeselect, scheduleViewportChange]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        // Prevent canvas scrolling from moving the page while preserving native scrolling inside overlays and dialogs.
        const preventWheelScroll = (event: WheelEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (!shouldCanvasHandleWheel(target, event.ctrlKey || event.metaKey)) return;
            event.preventDefault();
        };
        container.addEventListener("wheel", preventWheelScroll, { passive: false });
        return () => container.removeEventListener("wheel", preventWheelScroll);
    }, [containerRef]);

    const activeTool: CanvasInteractionTool = isSpacePressed ? "pan" : tool;
    const cursor = isPanning ? "grabbing" : activeTool === "pan" ? "grab" : "default";

    return (
        <div
            ref={containerRef}
            className="relative h-full w-full select-none overflow-hidden"
            style={{ background: theme.canvas.background, cursor, touchAction: "none" }}
            data-canvas-tool={activeTool}
            data-canvas-panning={isPanning || undefined}
            onPointerDown={handlePointerDown}
            onDoubleClick={handleDoubleClick}
            onWheel={handleWheel}
            onContextMenu={onContextMenu}
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDrop}
        >
            <CanvasGrid viewport={viewport} mode={backgroundMode} />
            <div
                className="absolute origin-top-left"
                style={{
                    transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.k})`,
                }}
            >
                {children}
            </div>
        </div>
    );
}

function CanvasGrid({ viewport, mode }: { viewport: ViewportTransform; mode: CanvasBackgroundMode }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (mode === "blank") return null;

    const gridSize = 48 * viewport.k;
    const x = viewport.x % gridSize;
    const y = viewport.y % gridSize;
    const dotSize = viewport.k < 0.12 ? 0.8 : 1.15;
    const backgroundImage =
        mode === "dots" ? `radial-gradient(circle, ${theme.canvas.dot} ${dotSize}px, transparent ${dotSize + 0.2}px)` : `linear-gradient(${theme.canvas.line} 1px, transparent 1px), linear-gradient(90deg, ${theme.canvas.line} 1px, transparent 1px)`;

    return (
        <div
            className="pointer-events-none absolute inset-0 opacity-40"
            style={{
                backgroundImage,
                backgroundSize: `${gridSize}px ${gridSize}px`,
                backgroundPosition: `${x}px ${y}px`,
            }}
        />
    );
}
