import type { CSSProperties } from "react";
import { Popover, Tooltip } from "antd";
import { ArrowRight, BarChart3, ImageIcon, Keyboard, Puzzle, Settings2, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { APP_DISPLAY_VERSION } from "@/constant/env";
import { useImageUsage } from "@/hooks/use-image-usage";
import { isPlainRouteClick, prepareRouteTransitionFromClick } from "@/hooks/use-route-navigate";
import { changeAppLocale, type AppLocale } from "@/i18n";
import { canvasThemes } from "@/lib/canvas-theme";
import type { SidebarHoldOwner } from "@/lib/app-shell-state";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";

type UserStatusActionsProps = {
    showConfig?: boolean;
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
    onOpenPlugins?: () => void;
    popoversEnabled?: boolean;
    onSidebarHoldChange?: (owner: SidebarHoldOwner, active: boolean) => void;
};

export function UserStatusActions({ showConfig = true, variant = "default", onOpenShortcuts, onOpenPlugins, popoversEnabled = true, onSidebarHoldChange }: UserStatusActionsProps) {
    const { i18n, t } = useTranslation();
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const canvasTheme = canvasThemes[theme];
    const naturalIconClass =
        "inline-flex h-8 min-w-8 shrink-0 cursor-pointer items-center justify-center rounded-md px-[7px] text-[13px] font-normal text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&_svg]:size-[18px]";
    const iconStyle: CSSProperties = { fontSize: 13, fontWeight: 400, ...(variant === "canvas" ? { color: canvasTheme.node.text } : {}) };
    const locale = i18n.resolvedLanguage as AppLocale;
    const nextLocale = locale === "zh-CN" ? "en-US" : "zh-CN";
    const languageLabel = t("topNav.switchLanguage", { language: t(nextLocale === "zh-CN" ? "locale.zhCN" : "locale.enUS") });
    const [personalOpen, setPersonalOpen] = useState(false);
    const { stats, loading } = useImageUsage("day", "30d");

    useEffect(() => {
        if (!popoversEnabled) setPersonalOpen(false);
    }, [popoversEnabled]);

    return (
        <div className="inline-flex shrink-0 items-center gap-1">
            <Popover
                open={popoversEnabled && personalOpen}
                onOpenChange={(open) => setPersonalOpen(popoversEnabled && open)}
                getPopupContainer={(trigger) => trigger.closest<HTMLElement>("[data-home-edge-nav]") || document.body}
                trigger="click"
                placement="bottomRight"
                arrow={false}
                content={<PersonalCenterPanel stats={stats} loading={loading} onClose={() => setPersonalOpen(false)} />}
            >
                <button type="button" className={naturalIconClass} style={iconStyle} aria-label={t("topNav.personalCenter")} title={t("topNav.personalCenter")}>
                    <UserRound className="size-4" />
                </button>
            </Popover>
            {onOpenPlugins ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenPlugins} aria-label={t("topNav.plugins")} title={t("topNav.plugins")}>
                    <Puzzle className="size-4" />
                </button>
            ) : null}
            {window.infiniteCanvasDesktop ? (
                <button
                    type="button"
                    className={`${naturalIconClass} tabular-nums`}
                    style={iconStyle}
                    onClick={() => {
                        onSidebarHoldChange?.("config", true);
                        openConfigDialog(false, "about");
                    }}
                    aria-label={t("desktopUpdate.open")}
                    title={t("desktopUpdate.open")}
                >
                    {APP_DISPLAY_VERSION}
                </button>
            ) : null}
            {showConfig ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={() => openConfigDialog(false)} aria-label={t("navigation.config")} title={t("navigation.config")}>
                    <Settings2 className="size-4" />
                </button>
            ) : null}
            <Tooltip title={languageLabel} mouseEnterDelay={0.2}>
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={() => void changeAppLocale(nextLocale)} aria-label={languageLabel}>
                    {locale === "zh-CN" ? "中" : "EN"}
                </button>
            </Tooltip>
            <AnimatedThemeToggler
                theme={theme}
                onThemeChange={setTheme}
                onTransitionStateChange={(active) => onSidebarHoldChange?.("theme", active)}
                className={naturalIconClass}
                style={iconStyle}
                aria-label={t(theme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme")}
                title={t(theme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme")}
            />
            {onOpenShortcuts ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenShortcuts} aria-label={t("topNav.shortcuts")} title={t("topNav.shortcuts")}>
                    <Keyboard className="size-4" />
                </button>
            ) : null}
        </div>
    );
}

function PersonalCenterPanel({ stats, loading, onClose }: { stats: ReturnType<typeof useImageUsage>["stats"]; loading: boolean; onClose: () => void }) {
    const { t, i18n } = useTranslation();
    const { pathname } = useLocation();
    const locale = i18n.resolvedLanguage || "zh-CN";
    const summary = stats?.summary;
    const number = (value: number) => new Intl.NumberFormat(locale).format(value);
    const percent = (value: number) => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(value);
    const linkClass = "flex items-center justify-between rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground";

    return (
        <div className="w-[min(19rem,calc(100vw-2rem))]">
            <div className="border-b border-border pb-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                    <UserRound className="size-4" />
                    {t("topNav.personalCenter")}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{t("topNav.localWorkspace")}</div>
            </div>
            <div className="grid grid-cols-3 gap-2 border-b border-border py-3">
                <PersonalMetric label={t("topNav.todayImages")} value={loading ? "—" : number(stats?.buckets.at(-1)?.successImages || 0)} />
                <PersonalMetric label={t("topNav.recentRequests")} value={loading ? "—" : number(summary?.requests || 0)} />
                <PersonalMetric label={t("topNav.successRate")} value={loading ? "—" : percent(summary?.successRate || 0)} />
            </div>
            <div className="space-y-0.5 pt-2">
                <Link
                    to="/stats"
                    viewTransition={false}
                    className={linkClass}
                    onClick={(event) => {
                        if (!isPlainRouteClick(event)) return;
                        onClose();
                        if (pathname === "/stats") event.preventDefault();
                        else prepareRouteTransitionFromClick(event, "/stats", pathname, false);
                    }}
                >
                    <span className="flex items-center gap-2">
                        <BarChart3 className="size-4" />
                        {t("topNav.imageStats")}
                    </span>
                    <ArrowRight className="size-3.5 text-muted-foreground" />
                </Link>
                <Link
                    to="/assets"
                    viewTransition={false}
                    className={linkClass}
                    onClick={(event) => {
                        if (!isPlainRouteClick(event)) return;
                        onClose();
                        if (pathname === "/assets") event.preventDefault();
                        else prepareRouteTransitionFromClick(event, "/assets", pathname, false);
                    }}
                >
                    <span className="flex items-center gap-2">
                        <ImageIcon className="size-4" />
                        {t("topNav.myAssets")}
                    </span>
                    <ArrowRight className="size-3.5 text-muted-foreground" />
                </Link>
            </div>
        </div>
    );
}

function PersonalMetric({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0">
            <div className="truncate text-[13px] text-muted-foreground">{label}</div>
            <div className="type-numeric mt-1 truncate text-base text-foreground">{value}</div>
        </div>
    );
}
