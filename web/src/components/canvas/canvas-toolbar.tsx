import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { Button, Dropdown, Segmented, Switch, type MenuProps } from "antd";
import { CircleDot, Ellipsis, Eraser, Grid2x2, Group, Hand, Image as ImageIcon, Info, LayoutGrid, Maximize2, Moon, MousePointer2, Music2, Palette, Plus, Puzzle, Redo2, Settings2, Sparkles, Square, Sun, Trash2, Type, Undo2, Upload, Video } from "lucide-react";

import { canvasThemes, type CanvasBackgroundMode, type CanvasColorTheme, type CanvasTheme } from "@/lib/canvas-theme";
import { getNodePluginId, listNodeDefinitions, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { useThemeStore } from "@/stores/use-theme-store";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { useTranslation } from "react-i18next";

type CanvasToolbarProps = {
    selectedCount: number;
    canvasTool: "select" | "pan";
    canUndo: boolean;
    canRedo: boolean;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    onAddImage: () => void;
    onAddVideo: () => void;
    onAddAudio: () => void;
    onAddText: () => void;
    onAddConfig: () => void;
    onAddGroup: () => void;
    onAddExtensionNode: (type: string) => void;
    onUndo: () => void;
    onRedo: () => void;
    onUpload: () => void;
    onDelete: () => void;
    onClear: () => void;
    onOpenPlugins?: () => void;
    onCreateSkill?: () => void;
    onArrange?: () => void;
    onFitView?: () => void;
    onCanvasToolChange: (tool: "select" | "pan") => void;
    onBackgroundModeChange: (mode: CanvasBackgroundMode) => void;
    onShowImageInfoChange: (show: boolean) => void;
};

export function CanvasToolbar({
    selectedCount,
    canvasTool,
    canUndo,
    canRedo,
    backgroundMode,
    showImageInfo,
    onAddImage,
    onAddVideo,
    onAddAudio,
    onAddText,
    onAddConfig,
    onAddGroup,
    onAddExtensionNode,
    onUndo,
    onRedo,
    onUpload,
    onDelete,
    onClear,
    onOpenPlugins,
    onCreateSkill,
    onArrange,
    onFitView,
    onCanvasToolChange,
    onBackgroundModeChange,
    onShowImageInfoChange,
}: CanvasToolbarProps) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const { t } = useTranslation();
    const rootRef = useRef<HTMLDivElement>(null);
    const colorTheme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const theme = canvasThemes[colorTheme];
    const [hovered, setHovered] = useState<string | null>(null);
    const [tipX, setTipX] = useState(0);
    const [appearanceOpen, setAppearanceOpen] = useState(false);
    const [panelX, setPanelX] = useState(0);
    const [addMenuOpen, setAddMenuOpen] = useState(false);
    const [moreMenuOpen, setMoreMenuOpen] = useState(false);
    // Keep extension plugin nodes synchronized with registry changes.
    useNodeRegistryVersion();
    const extensionDefs = listNodeDefinitions().filter((def) => def.showInCreateMenu !== false && getNodePluginId(def.type) !== "builtin");
    const dockStyle = { background: theme.toolbar.panel, color: theme.toolbar.item };
    const hoverStyle = { background: theme.toolbar.itemHover, color: theme.toolbar.activeText };
    const activeStyle = { background: theme.toolbar.activeBg, color: theme.toolbar.activeText };
    const addLabel = t("canvas.toolbar.add");
    const panLabel = t("canvas.toolbar.hand");
    const arrangeLabel = t(selectedCount > 1 ? "canvas.toolbar.arrangeSelection" : "canvas.toolbar.arrangeCanvas");
    const fitViewLabel = t("canvas.fitView");
    const moreLabel = t("canvas.imageTools.more");
    const toolLabels: Record<string, string> = {
        "tool-select": t("canvas.toolbar.select"),
        "tool-pan": panLabel,
        "tool-add": addLabel,
        "tool-undo": t("canvas.undo"),
        "tool-redo": t("canvas.redo"),
        "tool-arrange": arrangeLabel,
        "tool-fit-view": fitViewLabel,
        "tool-more": moreLabel,
    };
    const tip = hovered ? toolLabels[hovered] || "" : "";

    // Close the canvas-appearance panel when clicking outside the toolbar.
    useEffect(() => {
        if (!appearanceOpen) return;
        const handlePointerDown = (event: PointerEvent) => {
            if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
                setAppearanceOpen(false);
            }
        };
        document.addEventListener("pointerdown", handlePointerDown, true);
        return () => document.removeEventListener("pointerdown", handlePointerDown, true);
    }, [appearanceOpen]);

    const addMenuItems: MenuProps["items"] = [
        { key: "image", label: t("canvas.toolbar.image"), icon: <ImageIcon className="size-4" />, onClick: () => { setAddMenuOpen(false); onAddImage(); } },
        { key: "text", label: t("canvas.toolbar.text"), icon: <Type className="size-4" />, onClick: () => { setAddMenuOpen(false); onAddText(); } },
        { key: "video", label: t("canvas.toolbar.video"), icon: <Video className="size-4" />, onClick: () => { setAddMenuOpen(false); onAddVideo(); } },
        { key: "audio", label: t("canvas.toolbar.audio"), icon: <Music2 className="size-4" />, onClick: () => { setAddMenuOpen(false); onAddAudio(); } },
        { key: "config", label: t("canvas.toolbar.config"), icon: <Settings2 className="size-4" />, onClick: () => { setAddMenuOpen(false); onAddConfig(); } },
        { key: "group", label: t("canvas.toolbar.group"), icon: <Group className="size-4" />, onClick: () => { setAddMenuOpen(false); onAddGroup(); } },
        { type: "divider" },
        { key: "upload", label: t("canvas.toolbar.upload"), icon: <Upload className="size-4" />, onClick: () => { setAddMenuOpen(false); onUpload(); } },
        ...(extensionDefs.length ? [{
            key: "extensions",
            label: t("canvas.toolbar.extensions"),
            icon: <Puzzle className="size-4" />,
            children: extensionDefs.map((definition) => ({
                key: `extension:${definition.type}`,
                label: definition.title,
                icon: definition.icon,
                onClick: () => {
                    setAddMenuOpen(false);
                    onAddExtensionNode(definition.type);
                },
            })),
        }] : []),
    ];
    const moreMenuItems: MenuProps["items"] = [
        ...(onOpenPlugins ? [{ key: "plugins", label: t("topNav.plugins"), icon: <Puzzle className="size-4" />, onClick: () => { setMoreMenuOpen(false); onOpenPlugins(); } }] : []),
        {
            key: "appearance",
            label: t("canvas.toolbar.appearance"),
            icon: <Palette className="size-4" />,
            onClick: () => {
                setMoreMenuOpen(false);
                setAppearanceOpen(true);
            },
        },
        ...(selectedCount ? [
            { type: "divider" as const },
            ...(onCreateSkill ? [{ key: "create-skill", label: t("creativeSkills.creation.canvasSelection"), icon: <Sparkles className="size-4" />, onClick: () => { setMoreMenuOpen(false); onCreateSkill(); } }] : []),
            { key: "delete", label: t("canvas.deleteSelected"), icon: <Trash2 className="size-4" />, danger: true, onClick: () => { setMoreMenuOpen(false); onDelete(); } },
        ] : []),
        { type: "divider" },
        { key: "clear", label: t("canvas.toolbar.clear"), icon: <Eraser className="size-4" />, danger: true, onClick: () => { setMoreMenuOpen(false); onClear(); } },
    ];

    return (
        <div ref={rootRef} className="pointer-events-none absolute bottom-5 z-50 flex justify-center" style={{ left: 16, right: 16 }}>
            {tip ? <DockTip label={tip} x={tipX} theme={theme} /> : null}
            <div ref={wrapRef} className="thin-scrollbar pointer-events-auto flex h-11 max-w-full items-center gap-0.5 overflow-x-auto rounded-lg px-1.5 backdrop-blur [&>*]:shrink-0" style={dockStyle}>
                <ToolbarButton id="tool-select" label={t("canvas.toolbar.select")} active={canvasTool === "select"} ariaPressed={canvasTool === "select"} hovered={hovered} activeStyle={activeStyle} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={() => onCanvasToolChange("select")}>
                    <MousePointer2 className="size-4.5" />
                </ToolbarButton>
                <ToolbarButton id="tool-pan" label={panLabel} active={canvasTool === "pan"} ariaPressed={canvasTool === "pan"} hovered={hovered} activeStyle={activeStyle} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={() => onCanvasToolChange("pan")}>
                    <Hand className="size-4.5" />
                </ToolbarButton>
                <Divider theme={theme} />
                <ToolbarButton
                    id="tool-add"
                    label={addLabel}
                    active={addMenuOpen}
                    hovered={hovered}
                    activeStyle={activeStyle}
                    hoverStyle={hoverStyle}
                    wrapRef={wrapRef}
                    onTipX={setTipX}
                    onHover={setHovered}
                    dropdown={{
                        menu: { items: addMenuItems },
                        open: addMenuOpen,
                        onOpenChange: (open) => {
                            setAddMenuOpen(open);
                            if (open) {
                                setMoreMenuOpen(false);
                                setAppearanceOpen(false);
                            }
                        },
                    }}
                >
                    <Plus className="size-4.5" />
                </ToolbarButton>
                <Divider theme={theme} />
                <ToolbarButton id="tool-undo" label={t("canvas.undo")} disabled={!canUndo} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onUndo}>
                    <Undo2 className="size-4.5" />
                </ToolbarButton>
                <ToolbarButton id="tool-redo" label={t("canvas.redo")} disabled={!canRedo} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onRedo}>
                    <Redo2 className="size-4.5" />
                </ToolbarButton>
                <Divider theme={theme} />
                <ToolbarButton id="tool-arrange" label={arrangeLabel} disabled={!onArrange} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onArrange}>
                    <LayoutGrid className="size-4.5" />
                </ToolbarButton>
                <ToolbarButton id="tool-fit-view" label={fitViewLabel} disabled={!onFitView} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onFitView}>
                    <Maximize2 className="size-4.5" />
                </ToolbarButton>
                <Divider theme={theme} />
                <ToolbarButton
                    id="tool-more"
                    label={moreLabel}
                    active={moreMenuOpen || appearanceOpen}
                    hovered={hovered}
                    activeStyle={activeStyle}
                    hoverStyle={hoverStyle}
                    wrapRef={wrapRef}
                    onTipX={setTipX}
                    onHover={setHovered}
                    onClick={(event) => {
                        setPanelX(getTipX(wrapRef.current, event.currentTarget));
                    }}
                    dropdown={{
                        menu: { items: moreMenuItems },
                        open: moreMenuOpen,
                        onOpenChange: (open) => {
                            setMoreMenuOpen(open);
                            if (open) {
                                setAddMenuOpen(false);
                                setAppearanceOpen(false);
                            }
                        },
                    }}
                >
                    <Ellipsis className="size-4.5" />
                </ToolbarButton>
            </div>

            {appearanceOpen ? (
                <div
                    className="pointer-events-auto absolute bottom-[60px] z-30 w-[248px] -translate-x-1/2 rounded-xl border p-2.5 backdrop-blur"
                    style={{ left: panelX || "50%", background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item }}
                >
                    <div className="px-1 pb-2 text-sm font-medium opacity-65">{t("canvas.toolbar.appearance")}</div>
                    <div className="px-1 pb-1.5 text-[13px] font-medium opacity-50">{t("canvas.toolbar.themeMode")}</div>
                    <div className="grid grid-cols-2 gap-1 rounded-lg border p-1" style={{ background: "transparent", borderColor: theme.toolbar.border }}>
                        <CanvasThemeButton colorTheme={colorTheme} targetTheme="light" onThemeChange={setTheme}>
                            <Sun className="size-4" />
                            {t("canvas.toolbar.light")}
                        </CanvasThemeButton>
                        <CanvasThemeButton colorTheme={colorTheme} targetTheme="dark" onThemeChange={setTheme}>
                            <Moon className="size-4" />
                            {t("canvas.toolbar.dark")}
                        </CanvasThemeButton>
                    </div>
                    <div className="mt-3 px-1 pb-1.5 text-[13px] font-medium opacity-50">{t("canvas.toolbar.gridStyle")}</div>
                    <Segmented
                        className="w-full !p-1 [&_.ant-segmented-group]:!flex [&_.ant-segmented-item]:!min-h-8 [&_.ant-segmented-item]:!flex-1 [&_.ant-segmented-item-label]:!min-h-8 [&_.ant-segmented-item-label]:!leading-8"
                        value={backgroundMode}
                        onChange={(value) => onBackgroundModeChange(value as CanvasBackgroundMode)}
                        options={[
                            {
                                value: "dots",
                                label: (
                                    <span className="inline-flex items-center gap-1.5">
                                        <CircleDot className="size-4" />{t("canvas.toolbar.dots")}
                                    </span>
                                ),
                            },
                            {
                                value: "lines",
                                label: (
                                    <span className="inline-flex items-center gap-1.5">
                                        <Grid2x2 className="size-4" />{t("canvas.toolbar.lines")}
                                    </span>
                                ),
                            },
                            {
                                value: "blank",
                                label: (
                                    <span className="inline-flex items-center gap-1.5">
                                        <Square className="size-4" />
                                        {t("canvas.toolbar.blank")}
                                    </span>
                                ),
                            },
                        ]}
                    />
                    <div className="mt-3 flex items-center justify-between gap-3 rounded-lg px-1.5 py-1">
                        <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px] font-medium opacity-65">
                            <Info className="size-3.5" />
                            {t("canvas.toolbar.imageInfo")}
                        </span>
                        <Switch size="small" checked={showImageInfo} onChange={onShowImageInfoChange} />
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function ToolbarButton({
    id,
    label,
    active,
    hovered,
    activeStyle,
    hoverStyle,
    wrapRef,
    onTipX,
    onHover,
    onClick,
    ariaPressed,
    dropdown,
    disabled = false,
    danger = false,
    children,
}: {
    id: string;
    label: string;
    active?: boolean;
    hovered: string | null;
    activeStyle?: CSSProperties;
    hoverStyle: CSSProperties;
    wrapRef: RefObject<HTMLDivElement | null>;
    onTipX: (x: number) => void;
    onHover: (id: string | null) => void;
    onClick?: (event: ReactMouseEvent<HTMLElement>) => void;
    ariaPressed?: boolean;
    dropdown?: { menu: MenuProps; open: boolean; onOpenChange: (open: boolean) => void };
    disabled?: boolean;
    danger?: boolean;
    children: ReactNode;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    const button = (
        <Button
            type="text"
            aria-label={label}
            aria-pressed={ariaPressed}
            aria-haspopup={dropdown ? "menu" : undefined}
            aria-expanded={dropdown ? dropdown.open : undefined}
            className="!h-8 !w-8 !min-w-8 !p-0"
            disabled={disabled}
            style={active ? activeStyle : hovered === id && !disabled ? hoverStyle : { color: danger ? theme.status.danger : theme.toolbar.item, opacity: disabled ? 0.35 : 1 }}
            icon={children}
            onMouseEnter={(event) => {
                onHover(id);
                onTipX(getTipX(wrapRef.current, event.currentTarget));
            }}
            onMouseLeave={() => onHover(null)}
            onClick={(event) => {
                onHover(null);
                onClick?.(event);
            }}
        />
    );
    return dropdown ? <Dropdown menu={dropdown.menu} trigger={["click"]} placement="top" open={dropdown.open} onOpenChange={dropdown.onOpenChange}>{button}</Dropdown> : button;
}

function Divider({ theme }: { theme: CanvasTheme }) {
    return <div className="mx-1 h-6 w-px" style={{ background: theme.toolbar.border }} />;
}

function CanvasThemeButton({ colorTheme, targetTheme, onThemeChange, children }: { colorTheme: CanvasColorTheme; targetTheme: CanvasColorTheme; onThemeChange: (theme: CanvasColorTheme) => void; children: ReactNode }) {
    const theme = canvasThemes[colorTheme];
    const active = colorTheme === targetTheme;
    const activeStyle = { background: theme.toolbar.activeBg, color: theme.toolbar.activeText };
    const { t } = useTranslation();
    const label = targetTheme === "dark" ? t("topNav.darkTheme") : t("topNav.lightTheme");

    return (
        <AnimatedThemeToggler
            theme={colorTheme}
            targetTheme={targetTheme}
            onThemeChange={onThemeChange}
            className="inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-sm transition"
            style={active ? activeStyle : { color: theme.toolbar.item }}
            aria-label={label}
            title={label}
        >
            {children}
        </AnimatedThemeToggler>
    );
}

function DockTip({ label, x, theme }: { label: string; x: number; theme: CanvasTheme }) {
    return (
        <span className="absolute bottom-[calc(100%+8px)] -translate-x-1/2 rounded-md px-2 py-1 text-xs" style={{ left: x, background: theme.node.text, color: theme.node.panel }}>
            {label}
        </span>
    );
}

function getTipX(wrap: HTMLDivElement | null, target: HTMLElement) {
    if (!wrap) return 0;
    const wrapBox = wrap.parentElement?.getBoundingClientRect() || wrap.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    return box.left - wrapBox.left + box.width / 2;
}
