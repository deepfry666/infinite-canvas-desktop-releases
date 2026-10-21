import type { Position } from "@/types/canvas";

export type CanvasMenuLayout = {
    left?: number;
    right?: number;
    top?: number;
    bottom?: number;
    width: number;
    maxHeight: number;
};

export function canvasPointToScreen(position: Position, viewport: { x: number; y: number; k: number }): Position {
    return { x: viewport.x + position.x * viewport.k, y: viewport.y + position.y * viewport.k };
}

export function resolveCanvasMenuLayout(anchor: Position, canvasSize: { width: number; height: number }, preferredWidth = 300, gap = 12): CanvasMenuLayout {
    const canvasWidth = Math.max(0, canvasSize.width);
    const canvasHeight = Math.max(0, canvasSize.height);
    const horizontalGap = Math.min(Math.max(0, gap), canvasWidth / 2);
    const verticalGap = Math.min(Math.max(0, gap), canvasHeight / 2);
    const width = Math.max(0, Math.min(preferredWidth, canvasWidth - horizontalGap * 2));
    const x = clamp(anchor.x, horizontalGap, canvasWidth - horizontalGap);
    const y = clamp(anchor.y, verticalGap, canvasHeight - verticalGap);
    const spaceRight = canvasWidth - horizontalGap - x;
    const spaceLeft = x - horizontalGap;
    const horizontal = spaceRight >= width
        ? { left: x }
        : spaceLeft >= width
          ? { right: canvasWidth - x }
          : { left: clamp(x, horizontalGap, canvasWidth - horizontalGap - width) };
    const spaceBelow = canvasHeight - verticalGap - y;
    const spaceAbove = y - verticalGap;
    const openDown = spaceBelow >= spaceAbove;
    const vertical = openDown
        ? { top: y, maxHeight: spaceBelow }
        : { bottom: canvasHeight - y, maxHeight: spaceAbove };
    return { ...horizontal, ...vertical, width, maxHeight: vertical.maxHeight };
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}
