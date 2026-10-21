/**
 * 四季画布「墨与朱砂」设计令牌 —— TS 侧唯一色值源。
 *
 * 消费方：
 * - lib/app-theme.ts（antd ConfigProvider token）
 * - lib/canvas-theme.ts（画布主题）
 * - styles/globals.css 的 shadcn CSS 变量与本文件手动保持同步（改色两边一起改）
 *
 * 详细规范见 docs/content/docs/development/design-system.zh-CN.mdx
 */

export type ColorMode = "light" | "dark";

const lightColors = {
    bg: {
        page: "#faf8f4",
        canvas: "#f6f4ee",
        panel: "#fdfcfa",
        elevated: "#ffffff",
        subtle: "#efede6",
    },
    border: { default: "#e3e0d6", strong: "#d4d0c2" },
    text: { primary: "#211d19", secondary: "#6b6560", faint: "#a39c90" },
    brand: { default: "#c54232", hover: "#aa3026", bg: "#f7e7e2", glint: "#d5ae62", text: "#ffffff" },
    onPrimary: "#ffffff",
    success: "#4a7c59",
    warning: "#b07718",
    danger: "#b33a3a",
} as const;

const darkColors = {
    bg: {
        page: "#1c1916",
        canvas: "#171512",
        panel: "#242019",
        elevated: "#2b2620",
        subtle: "#332c25",
    },
    border: { default: "#3a342b", strong: "#4d463a" },
    text: { primary: "#f0ece4", secondary: "#b0a898", faint: "#7d7466" },
    brand: { default: "#e06a59", hover: "#ed7c68", bg: "#3b2420", glint: "#e8c985", text: "#ffffff" },
    onPrimary: "#171717",
    success: "#6fa87f",
    warning: "#d09c3f",
    danger: "#d06a6a",
} as const;

export type ThemeColors = {
    bg: Record<keyof typeof lightColors.bg, string>;
    border: Record<keyof typeof lightColors.border, string>;
    text: Record<keyof typeof lightColors.text, string>;
    brand: Record<keyof typeof lightColors.brand, string>;
    onPrimary: string;
    success: string;
    warning: string;
    danger: string;
};

export const colorThemes: Record<ColorMode, ThemeColors> = {
    light: lightColors,
    dark: darkColors,
};

/** hex 转 rgba，用于派生 hover/选中态等透明度色 */
export function alpha(hex: string, opacity: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export const radius = { sm: 6, md: 8, lg: 12, xl: 16, pill: 999 } as const;

export const motion = {
    duration: { instant: 120, fast: 200, hover: 240, exit: 280, settle: 320, panel: 380, route: 440 },
    easing: {
        out: "cubic-bezier(0.2, 0, 0, 1)",
        settle: "cubic-bezier(0.22, 1, 0.36, 1)",
        exit: "cubic-bezier(0.4, 0, 1, 1)",
        spring: "cubic-bezier(0.34, 1.4, 0.64, 1)",
    },
} as const;

export const fontFamily = {
    sans: '"MiSans", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif',
    serifZh: '"Noto Serif SC", "Songti SC", SimSun, serif',
    serifEn: '"PT Serif", Georgia, "Times New Roman", serif',
    mono: '"MiSans", "PingFang SC", "Microsoft YaHei", sans-serif',
} as const;

/**
 * 与 MiMo 官网保持一致：MiSans 使用真实 400 / 500 / 600 / 700 字重，
 * 中文与英文展示标题分别使用 Noto Serif SC 与 PT Serif。
 */
export const typography = {
    body: { fontFamily: fontFamily.sans, fontSize: 16, fontWeight: 400, lineHeight: 1.65, letterSpacing: "0em" },
    label: { fontFamily: fontFamily.sans, fontSize: 13, fontWeight: 400, lineHeight: 1.5, letterSpacing: "0em" },
    emphasis: { fontFamily: fontFamily.sans, fontWeight: 500, lineHeight: 1.5, letterSpacing: "0em" },
    sectionTitle: { fontFamily: fontFamily.serifZh, fontSize: 20, fontWeight: 500, lineHeight: 1.4, letterSpacing: "0em" },
    pageTitle: { fontFamily: fontFamily.serifZh, fontSize: 32, fontWeight: 500, lineHeight: 1.25, letterSpacing: "0em" },
    numeric: { fontFamily: fontFamily.sans, fontWeight: 400, lineHeight: 1.25, letterSpacing: "0em" },
    display: { fontFamily: fontFamily.serifZh, fontWeight: 400, lineHeight: 1.2, letterSpacing: "0em" },
    strong: { fontFamily: fontFamily.sans, fontWeight: 600, lineHeight: 1.5, letterSpacing: "0em" },
} as const;
