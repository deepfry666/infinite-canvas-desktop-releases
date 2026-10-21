import type { CanvasNodeData, ViewportTransform } from "@/types/canvas";

export type CanvasViewportSize = {
    width: number;
    height: number;
};

const MIN_SCALE = 0.05;

export function defaultCanvasViewport(size: CanvasViewportSize): ViewportTransform {
    return { x: size.width / 2, y: size.height / 2, k: 1 };
}

export function fitNodesInViewport(nodes: CanvasNodeData[], size: CanvasViewportSize, padding = 80): ViewportTransform {
    if (!nodes.length || size.width <= 0 || size.height <= 0) return defaultCanvasViewport(size);

    const bounds = nodes.reduce(
        (current, node) => ({
            left: Math.min(current.left, node.position.x),
            top: Math.min(current.top, node.position.y),
            right: Math.max(current.right, node.position.x + node.width),
            bottom: Math.max(current.bottom, node.position.y + node.height),
        }),
        { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
    );
    const availableWidth = Math.max(1, size.width - padding * 2);
    const availableHeight = Math.max(1, size.height - padding * 2);
    const boundsWidth = Math.max(1, bounds.right - bounds.left);
    const boundsHeight = Math.max(1, bounds.bottom - bounds.top);
    const scale = clamp(Math.min(availableWidth / boundsWidth, availableHeight / boundsHeight), MIN_SCALE, 1);
    const centerX = (bounds.left + bounds.right) / 2;
    const centerY = (bounds.top + bounds.bottom) / 2;

    return {
        x: size.width / 2 - centerX * scale,
        y: size.height / 2 - centerY * scale,
        k: scale,
    };
}

export function resetViewportZoom(viewport: ViewportTransform, size: CanvasViewportSize): ViewportTransform {
    if (!viewport.k) return defaultCanvasViewport(size);
    const worldCenterX = (size.width / 2 - viewport.x) / viewport.k;
    const worldCenterY = (size.height / 2 - viewport.y) / viewport.k;
    return {
        x: size.width / 2 - worldCenterX,
        y: size.height / 2 - worldCenterY,
        k: 1,
    };
}

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}
