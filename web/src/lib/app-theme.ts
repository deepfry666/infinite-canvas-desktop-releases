import type { ThemeConfig } from "antd";
import { theme as antdTheme } from "antd";

import { alpha, colorThemes, fontFamily, radius, typography } from "@/lib/design-tokens";

/**
 * antd ConfigProvider token，全部从 design-tokens 派生。
 * 策略「墨为主、朱砂为缀」：主操作/选中态用墨色（保持黑白极简基因），
 * 朱砂只用于品牌元素、画布节点选中描边与图表。弹层/菜单/表格等组件级覆盖统一收在这里，
 * 业务组件不要单独覆盖弹层颜色。
 */
export function getAntThemeConfig(dark: boolean): ThemeConfig {
    const colors = dark ? colorThemes.dark : colorThemes.light;
    const itemHoverBg = alpha(colors.text.primary, dark ? 0.08 : 0.06);
    const itemSelectedBg = alpha(colors.text.primary, dark ? 0.16 : 0.1);

    return {
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        cssVar: { key: dark ? "fourj-canvas-dark" : "fourj-canvas-light" },
        token: {
            colorPrimary: colors.text.primary,
            colorInfo: colors.text.primary,
            colorLink: colors.text.primary,
            colorLinkHover: colors.text.primary,
            colorLinkActive: colors.text.primary,
            colorTextLightSolid: colors.onPrimary,
            colorSuccess: colors.success,
            colorWarning: colors.warning,
            colorError: colors.danger,
            colorBgElevated: colors.bg.elevated,
            fontFamily: fontFamily.sans,
            fontFamilyCode: fontFamily.mono,
            fontSize: typography.body.fontSize,
            fontWeightStrong: typography.strong.fontWeight,
            lineHeight: typography.body.lineHeight,
            fontSizeHeading1: typography.pageTitle.fontSize,
            fontSizeHeading2: typography.sectionTitle.fontSize,
            fontSizeHeading3: typography.body.fontSize + 2,
            fontSizeHeading4: typography.body.fontSize + 2,
            fontSizeHeading5: typography.body.fontSize,
            lineHeightHeading1: typography.pageTitle.lineHeight,
            lineHeightHeading2: typography.sectionTitle.lineHeight,
            lineHeightHeading3: typography.sectionTitle.lineHeight,
            lineHeightHeading4: typography.sectionTitle.lineHeight,
            lineHeightHeading5: typography.label.lineHeight,
            borderRadius: radius.md,
            controlItemBgHover: itemHoverBg,
            controlItemBgActive: itemSelectedBg,
            controlItemBgActiveHover: alpha(colors.text.primary, dark ? 0.22 : 0.14),
        },
        components: {
            Button: {
                fontWeight: typography.label.fontWeight,
                primaryShadow: "none",
            },
            Cascader: {
                optionSelectedFontWeight: typography.emphasis.fontWeight,
            },
            Dropdown: {
                colorBgElevated: colors.bg.elevated,
                colorText: colors.text.primary,
                controlItemBgHover: itemHoverBg,
                controlItemBgActive: itemSelectedBg,
                controlItemBgActiveHover: alpha(colors.text.primary, dark ? 0.22 : 0.14),
            },
            Menu: {
                popupBg: colors.bg.elevated,
                itemActiveBg: itemHoverBg,
                itemHoverBg: itemHoverBg,
                itemSelectedBg: itemSelectedBg,
                itemSelectedColor: colors.text.primary,
                darkPopupBg: colorThemes.dark.bg.elevated,
                darkItemHoverBg: alpha(colorThemes.dark.text.primary, 0.08),
                darkItemSelectedBg: alpha(colorThemes.dark.text.primary, 0.16),
                darkItemSelectedColor: colorThemes.dark.text.primary,
            },
            Select: {
                optionActiveBg: itemHoverBg,
                optionSelectedBg: itemSelectedBg,
                optionSelectedColor: colors.text.primary,
                optionSelectedFontWeight: typography.emphasis.fontWeight,
            },
            Table: {
                rowSelectedBg: itemSelectedBg,
                rowSelectedHoverBg: alpha(colors.text.primary, dark ? 0.12 : 0.08),
            },
        },
    };
}
