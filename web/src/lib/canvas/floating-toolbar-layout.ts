type FloatingToolbarInput = {
    anchorX: number;
    nodeTop: number;
    nodeBottom: number;
    toolbarWidth: number;
    toolbarHeight: number;
    viewportWidth: number;
    viewportHeight: number;
    placement?: "auto" | "above" | "below";
    blockedRect?: { top: number; bottom: number };
};

type PromptPanelLayout = {
    nodeId: string;
    placement: "above" | "below";
    top: number;
    bottom: number;
};

export function resolvePromptPanelLayout(layout: PromptPanelLayout | null, toolbarNodeId: string | null | undefined, dialogNodeId: string | null) {
    if (!layout || !toolbarNodeId || layout.nodeId !== toolbarNodeId || dialogNodeId !== toolbarNodeId) return undefined;
    return layout;
}

export function placeFloatingToolbar({ anchorX, nodeTop, nodeBottom, toolbarWidth, toolbarHeight, viewportWidth, viewportHeight, placement = "auto", blockedRect }: FloatingToolbarInput) {
    const margin = 12;
    const gap = 14;
    const topSafeArea = Math.min(72, Math.max(0, viewportHeight / 2));
    const bottomSafeArea = Math.min(84, Math.max(0, viewportHeight - topSafeArea));
    const bottomLimit = viewportHeight - bottomSafeArea;
    const availableWidth = Math.max(0, viewportWidth - margin * 2);
    const compact = toolbarWidth > availableWidth;
    const visibleWidth = Math.min(toolbarWidth, availableWidth);
    const left = clamp(anchorX - visibleWidth / 2, margin, Math.max(margin, viewportWidth - visibleWidth - margin));
    const aboveTop = nodeTop - gap - toolbarHeight;
    const belowTop = nodeBottom + gap;
    const aboveFits = aboveTop >= topSafeArea;
    const belowFits = belowTop + toolbarHeight <= bottomLimit;
    const resolvedSide = placement === "auto" ? (aboveFits || !belowFits ? "above" : "below") : placement;
    const preferredTop = resolvedSide === "above" ? aboveTop : belowTop;
    const maxTop = Math.max(topSafeArea, bottomLimit - toolbarHeight);
    let top = clamp(preferredTop, topSafeArea, maxTop);
    if (blockedRect && overlaps(top, top + toolbarHeight, blockedRect.top, blockedRect.bottom)) {
        const candidates = [clamp(blockedRect.top - gap - toolbarHeight, topSafeArea, maxTop), clamp(blockedRect.bottom + gap, topSafeArea, maxTop)];
        top = candidates.sort((left, right) => {
            const overlapDelta = overlapSize(left, left + toolbarHeight, blockedRect.top, blockedRect.bottom) - overlapSize(right, right + toolbarHeight, blockedRect.top, blockedRect.bottom);
            return overlapDelta || Math.abs(left - preferredTop) - Math.abs(right - preferredTop);
        })[0];
    }
    return { left, top, compact };
}

function overlaps(start: number, end: number, blockedStart: number, blockedEnd: number) {
    return start < blockedEnd && end > blockedStart;
}

function overlapSize(start: number, end: number, blockedStart: number, blockedEnd: number) {
    return Math.max(0, Math.min(end, blockedEnd) - Math.max(start, blockedStart));
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}
