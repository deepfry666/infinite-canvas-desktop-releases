import { alpha, colorThemes, type ThemeColors } from "@/lib/design-tokens";

export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

/** 画布主题从 design-tokens 派生，保持导出结构不变，组件无需改动。 */
function buildCanvasTheme(colors: ThemeColors, dark: boolean) {
    return {
        canvas: {
            background: colors.bg.canvas,
            dot: alpha(colors.text.secondary, dark ? 0.28 : 0.3),
            line: alpha(colors.text.secondary, dark ? 0.12 : 0.14),
            selectionStroke: colors.brand.default,
            selectionFill: alpha(colors.brand.default, dark ? 0.14 : 0.06),
        },
        node: {
            label: colors.text.secondary,
            fill: colors.bg.subtle,
            panel: colors.bg.panel,
            stroke: colors.border.default,
            activeStroke: colors.brand.default,
            placeholder: colors.text.faint,
            text: colors.text.primary,
            muted: colors.text.secondary,
            faint: colors.text.faint,
        },
        toolbar: {
            panel: alpha(colors.bg.panel, 0.96),
            border: colors.border.default,
            item: colors.text.secondary,
            itemHover: colors.bg.subtle,
            activeBg: colors.bg.subtle,
            activeText: colors.text.primary,
        },
        status: {
            success: colors.success,
            warning: colors.warning,
            danger: colors.danger,
        },
    };
}

export const canvasThemes = {
    light: buildCanvasTheme(colorThemes.light, false),
    dark: buildCanvasTheme(colorThemes.dark, true),
} as const;

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
