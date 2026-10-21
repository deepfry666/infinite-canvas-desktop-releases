export const CANVAS_WHEEL_EXCLUDE_SELECTOR = "[data-canvas-no-zoom],.ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown";
const CANVAS_WHEEL_OVERLAY_SELECTOR = ".ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown";
const CANVAS_MODIFIED_WHEEL_PASSTHROUGH_SELECTOR = "[data-canvas-modified-wheel]";

export function shouldCanvasHandleWheel(target: { closest: (selector: string) => unknown } | null, modified = false) {
    if (target?.closest(CANVAS_WHEEL_OVERLAY_SELECTOR)) return false;
    if (modified && target?.closest(CANVAS_MODIFIED_WHEEL_PASSTHROUGH_SELECTOR)) return true;
    return !target?.closest(CANVAS_WHEEL_EXCLUDE_SELECTOR);
}
