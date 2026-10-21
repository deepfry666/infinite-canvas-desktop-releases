import { useEffect, useRef } from "react";
import { Home, LayoutGrid, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button, Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useCanvasSidePanelStore } from "@/stores/use-canvas-side-panel-store";
import { useThemeStore } from "@/stores/use-theme-store";

export function CanvasTopBar({
    title,
    titleDraft,
    isTitleEditing,
    onTitleDraftChange,
    onStartTitleEditing,
    onFinishTitleEditing,
    onCancelTitleEditing,
    onHome,
    onAllCanvases,
    agentOpen,
    onToggleAgent,
}: {
    title: string;
    titleDraft: string;
    isTitleEditing: boolean;
    onTitleDraftChange: (value: string) => void;
    onStartTitleEditing: () => void;
    onFinishTitleEditing: () => void;
    onCancelTitleEditing: () => void;
    onHome: () => void;
    onAllCanvases: () => void;
    agentOpen: boolean;
    onToggleAgent: () => void;
}) {
    const colorTheme = useThemeStore((state) => state.theme);
    const { t } = useTranslation();
    const theme = canvasThemes[colorTheme];
    const titleRef = useRef<HTMLDivElement>(null);
    const sidePanelOpen = useCanvasSidePanelStore((state) => state.panelOpen);
    const toggleSidePanel = useCanvasSidePanelStore((state) => state.togglePanel);

    useEffect(() => {
        if (!isTitleEditing) return;
        const close = (event: PointerEvent) => {
            if (!titleRef.current?.contains(event.target as Node)) onFinishTitleEditing();
        };
        document.addEventListener("pointerdown", close, true);
        return () => document.removeEventListener("pointerdown", close, true);
    }, [isTitleEditing, onFinishTitleEditing]);

    return (
        <div className="pointer-events-none absolute left-0 right-0 top-0 z-50 flex h-16 items-center justify-between gap-2 overflow-hidden pl-1 pr-4 @container">
                <div className="pointer-events-auto flex min-w-0 flex-1 items-center gap-2">
                    <Tooltip title={t("canvas.home")}>
                        <button
                            type="button"
                            onClick={onHome}
                            aria-label={t("canvas.home")}
                            className="flex h-8 shrink-0 items-center gap-1.5 px-2 text-sm font-medium transition hover:opacity-65"
                            style={{ color: theme.node.text }}
                        >
                            <Home className="size-4" />
                            <span className="hidden @min-[640px]:inline">{t("canvas.home")}</span>
                        </button>
                    </Tooltip>
                    <span className="hidden h-5 w-px shrink-0 @min-[360px]:block" style={{ background: theme.toolbar.border }} />
                    <Tooltip title={t("canvas.allCanvases")}>
                        <button
                            type="button"
                            onClick={onAllCanvases}
                            aria-label={t("canvas.allCanvases")}
                            className="flex h-8 shrink-0 items-center gap-1.5 px-2 text-sm font-medium transition hover:opacity-65"
                            style={{ color: theme.node.text }}
                        >
                            <LayoutGrid className="size-4" />
                            <span className="hidden @min-[480px]:inline">{t("canvas.allCanvases")}</span>
                        </button>
                    </Tooltip>
                    <span className="hidden h-5 w-px shrink-0 @min-[360px]:block" style={{ background: theme.toolbar.border }} />
                    <Tooltip title={sidePanelOpen ? t("canvas.collapsePanel") : t("canvas.expandPanel")}>
                        <button
                            type="button"
                            onClick={toggleSidePanel}
                            aria-label={sidePanelOpen ? t("canvas.collapsePanel") : t("canvas.expandPanel")}
                            className="grid size-7 place-items-center rounded-md transition hover:bg-black/5 dark:hover:bg-white/10"
                            style={{ color: theme.node.text }}
                        >
                            {sidePanelOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
                        </button>
                    </Tooltip>
                    <div ref={titleRef} className="hidden min-w-0 flex-1 items-center gap-2 @min-[320px]:flex">
                        {isTitleEditing ? (
                            <input
                                autoFocus
                                value={titleDraft}
                                onChange={(event) => onTitleDraftChange(event.target.value)}
                                onBlur={onFinishTitleEditing}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") onFinishTitleEditing();
                                    if (event.key === "Escape") onCancelTitleEditing();
                                }}
                                className="w-full max-w-[280px] min-w-0 bg-transparent p-0 text-left text-lg font-semibold tracking-normal outline-none"
                                style={{ color: theme.node.text }}
                            />
                        ) : (
                            <button
                                type="button"
                                className="block w-full max-w-[280px] truncate border-b border-dashed border-transparent text-left text-lg font-semibold tracking-normal transition hover:border-current"
                                onDoubleClick={onStartTitleEditing}
                                title={t("canvas.renameHint")}
                            >
                                {title}
                            </button>
                        )}
                    </div>
                </div>

                <div className="pointer-events-auto flex shrink-0 items-center gap-1.5">
                    <Tooltip title={t("agent.builtin.title")}>
                        <Button
                            type="text"
                            aria-label={t("agent.builtin.title")}
                            className="!h-9 !rounded-md !px-2.5 !font-medium hover:!bg-black/5 dark:hover:!bg-white/10"
                            style={{ background: agentOpen ? theme.toolbar.activeBg : "transparent", color: theme.node.text }}
                            icon={<span className="size-5 shrink-0 bg-brand" style={{ mask: "url(/logo.svg) center / contain no-repeat", WebkitMask: "url(/logo.svg) center / contain no-repeat" }} />}
                            onClick={onToggleAgent}
                        >
                            <span className="hidden @min-[400px]:inline">{t("agent.builtin.title")}</span>
                        </Button>
                    </Tooltip>
                </div>
        </div>
    );
}
