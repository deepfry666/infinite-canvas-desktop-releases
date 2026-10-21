import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import type { CanvasNodeData, ViewportTransform } from "@/types/canvas";

type CanvasNodePromptOverlayProps = {
    node: CanvasNodeData;
    viewport: ViewportTransform;
    canvasSize: { width: number; height: number };
    onModifiedWheel?: (event: WheelEvent) => void;
    onPlacementChange?: (nodeId: string, layout: { placement: "above" | "below"; top: number; bottom: number }) => void;
    children: ReactNode;
};

const EDGE_GAP = 12;
const NODE_GAP = 16;
const TOP_SAFE_AREA = 72;
const BOTTOM_SAFE_AREA = 84;
const MIN_PANEL_HEIGHT = 120;
const TOOLBAR_RESERVE = 62;

export function CanvasNodePromptOverlay({ node, viewport, canvasSize, onModifiedWheel, onPlacementChange, children }: CanvasNodePromptOverlayProps) {
    const panelRef = useRef<HTMLDivElement>(null);
    const [panelHeight, setPanelHeight] = useState(236);

    useLayoutEffect(() => {
        const panel = panelRef.current;
        if (!panel) return;
        const updateHeight = () => setPanelHeight(panel.scrollHeight);
        updateHeight();
        const observer = new ResizeObserver(updateHeight);
        observer.observe(panel);
        if (panel.firstElementChild) observer.observe(panel.firstElementChild);
        return () => observer.disconnect();
    }, [node.id]);
    useEffect(() => {
        const panel = panelRef.current;
        if (!panel) return;
        const handleWheel = (event: WheelEvent) => {
            if (!event.ctrlKey && !event.metaKey) return;
            event.preventDefault();
            event.stopPropagation();
            onModifiedWheel?.(event);
        };
        panel.addEventListener("wheel", handleWheel, { passive: false });
        return () => panel.removeEventListener("wheel", handleWheel);
    }, [node.id, onModifiedWheel]);

    const panelWidth = Math.max(0, Math.min(600, canvasSize.width - EDGE_GAP * 2));
    const verticalEdgeGap = Math.min(EDGE_GAP, Math.max(0, (canvasSize.height - MIN_PANEL_HEIGHT) / 2));
    const preferredSafeExtra = TOP_SAFE_AREA + BOTTOM_SAFE_AREA - EDGE_GAP * 2;
    const safeExtraBudget = Math.max(0, canvasSize.height - verticalEdgeGap * 2 - MIN_PANEL_HEIGHT - TOOLBAR_RESERVE);
    const safeAreaScale = Math.min(1, safeExtraBudget / preferredSafeExtra);
    const topSafeArea = verticalEdgeGap + (TOP_SAFE_AREA - EDGE_GAP) * safeAreaScale;
    const bottomSafeArea = verticalEdgeGap + (BOTTOM_SAFE_AREA - EDGE_GAP) * safeAreaScale;
    const availableHeight = Math.max(0, canvasSize.height - topSafeArea - bottomSafeArea);
    const nodeCenterX = viewport.x + (node.position.x + node.width / 2) * viewport.k;
    const nodeTop = viewport.y + node.position.y * viewport.k;
    const nodeBottom = viewport.y + (node.position.y + node.height) * viewport.k;
    const maxLeft = Math.max(EDGE_GAP, canvasSize.width - panelWidth - EDGE_GAP);
    const left = clamp(nodeCenterX - panelWidth / 2, EDGE_GAP, maxLeft);
    const belowTop = nodeBottom + NODE_GAP;
    const bottomLimit = canvasSize.height - bottomSafeArea;
    const belowSpace = Math.max(0, bottomLimit - belowTop);
    const aboveSpace = Math.max(0, nodeTop - NODE_GAP - topSafeArea);
    const placement = belowSpace >= panelHeight || (aboveSpace < panelHeight && belowSpace >= aboveSpace) ? "below" : "above";
    const reservedForToolbar = Math.min(TOOLBAR_RESERVE, Math.max(0, availableHeight - MIN_PANEL_HEIGHT));
    const visiblePanelHeight = Math.min(panelHeight, availableHeight - reservedForToolbar);
    const preferredTop = placement === "below" ? belowTop : nodeTop - NODE_GAP - visiblePanelHeight;
    const top = clamp(preferredTop, topSafeArea, Math.max(topSafeArea, bottomLimit - visiblePanelHeight));

    useLayoutEffect(() => onPlacementChange?.(node.id, { placement, top, bottom: top + visiblePanelHeight }), [node.id, onPlacementChange, placement, top, visiblePanelHeight]);

    return (
        <div
            ref={panelRef}
            data-canvas-no-zoom
            className="thin-scrollbar absolute z-[70] overflow-y-auto overscroll-contain"
            style={{ left, top, width: panelWidth, maxHeight: visiblePanelHeight }}
        >
            {children}
        </div>
    );
}

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}
