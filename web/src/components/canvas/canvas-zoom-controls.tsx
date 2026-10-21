import type { ReactNode } from "react";
import { Compass, Focus, HelpCircle, Maximize2, Scan } from "lucide-react";
import { useState } from "react";
import { Button, Dropdown, Modal, Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

export type CanvasZoomControlsProps = {
    scale: number;
    canvasWidth: number;
    onScaleChange: (scale: number) => void;
    onFitAll: () => void;
    onFitSelection: () => void;
    onResetZoom: () => void;
    canFitSelection: boolean;
    isMiniMapOpen: boolean;
    onToggleMiniMap: () => void;
};

export function CanvasZoomControls({ scale, canvasWidth, onScaleChange, onFitAll, onFitSelection, onResetZoom, canFitSelection, isMiniMapOpen, onToggleMiniMap }: CanvasZoomControlsProps) {
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const { t } = useTranslation();
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const dockStyle = { background: theme.toolbar.panel, color: theme.toolbar.item };
    const activeStyle = { background: theme.toolbar.activeBg, color: theme.toolbar.activeText };

    return (
        <div className="absolute z-50" style={{ left: isMiniMapOpen ? "auto" : 20, right: isMiniMapOpen ? 20 : "auto", bottom: canvasWidth < 920 ? 76 : 20, maxWidth: Math.max(0, canvasWidth - 40) }} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <div className="thin-scrollbar flex h-11 max-w-full items-center gap-1 overflow-x-auto rounded-lg px-1.5 backdrop-blur" style={dockStyle}>
                <Tooltip title={isMiniMapOpen ? t("canvas.miniMapClose") : t("canvas.miniMapOpen")}>
                    <Button
                        type="text"
                        className="!h-8 !w-8 !min-w-8 !p-0"
                        style={isMiniMapOpen ? activeStyle : { color: theme.toolbar.item }}
                        icon={<Compass className="size-4" />}
                        onClick={onToggleMiniMap}
                        aria-label={isMiniMapOpen ? t("canvas.miniMapClose") : t("canvas.miniMapOpen")}
                        aria-pressed={isMiniMapOpen}
                    />
                </Tooltip>
                <Tooltip title={t("canvas.fitView")}>
                    <Dropdown
                        trigger={["click"]}
                        placement="topLeft"
                        menu={{
                            items: [
                                { key: "fit-all", icon: <Maximize2 className="size-4" />, label: t("canvas.fitAll") },
                                { key: "fit-selection", icon: <Scan className="size-4" />, label: t("canvas.fitSelection"), disabled: !canFitSelection },
                            ],
                            onClick: ({ key }) => {
                                if (key === "fit-all") onFitAll();
                                if (key === "fit-selection") onFitSelection();
                            },
                        }}
                    >
                        <Button type="text" className="!h-8 !w-8 !min-w-8 !p-0" style={{ color: theme.toolbar.item }} icon={<Focus className="size-4" />} aria-label={t("canvas.fitView")} aria-haspopup="menu" />
                    </Dropdown>
                </Tooltip>
                <Tooltip title={t("canvas.zoom")}>
                    <input
                        type="range"
                        min="5"
                        max="500"
                        step="1"
                        value={Math.round(scale * 100)}
                        className="w-24"
                        style={{ accentColor: theme.toolbar.activeText }}
                        onChange={(event) => onScaleChange(Number(event.target.value) / 100)}
                        aria-label={t("canvas.zoom")}
                        aria-valuetext={`${Math.round(scale * 100)}%`}
                    />
                </Tooltip>
                <Tooltip title={t("canvas.resetZoom")}>
                    <Button type="text" className="type-numeric !h-8 !w-12 !min-w-12 !p-0 !text-xs" style={{ color: theme.node.muted }} onClick={onResetZoom} aria-label={t("canvas.resetZoom")}>
                        {Math.round(scale * 100)}%
                    </Button>
                </Tooltip>
                <Tooltip title={t("canvas.shortcuts")}>
                    <Button type="text" className="!h-8 !w-8 !min-w-8 !p-0" style={shortcutsOpen ? activeStyle : { color: theme.toolbar.item }} icon={<HelpCircle className="size-4" />} onClick={() => setShortcutsOpen(true)} aria-label={t("canvas.shortcuts")} />
                </Tooltip>
            </div>
            <Modal title={t("canvas.shortcuts")} open={shortcutsOpen} onCancel={() => setShortcutsOpen(false)} footer={null} centered>
                <div className="space-y-3 border-t pt-4 text-sm" style={{ borderColor: theme.node.stroke }}>
                    <Shortcut label={`Space + ${t("canvas.shortcut.drag")}`} value={t("canvas.shortcut.pan")} />
                    <Shortcut label={t("canvas.shortcut.wheel")} value={t("canvas.shortcut.pan")} />
                    <Shortcut label={`Ctrl / Cmd + ${t("canvas.shortcut.wheel")}`} value={t("canvas.shortcut.zoom")} />
                    <Shortcut label={t("canvas.shortcut.drag")} value={t("canvas.shortcut.boxSelect")} />
                    <Shortcut label={`Shift / Cmd + ${t("canvas.shortcut.click")}`} value={t("canvas.shortcut.addSelection")} />
                    <Shortcut label="Ctrl / Cmd + C / V" value={t("canvas.shortcut.copyPasteNodes")} />
                    <Shortcut label="Delete / Backspace" value={t("canvas.shortcut.delete")} />
                </div>
            </Modal>
        </div>
    );
}

function Shortcut({ label, value }: { label: ReactNode; value: string }) {
    return (
        <div className="flex items-center justify-between gap-4">
            <span className="text-base font-medium">{label}</span>
            <span className="opacity-60">{value}</span>
        </div>
    );
}
