import { useEffect, useRef } from "react";
import { ImageIcon, List, Music2, Settings2, Video, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import type { CanvasMenuLayout } from "@/lib/canvas/create-menu-layout";
import { useThemeStore } from "@/stores/use-theme-store";
import { listNodeDefinitions, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { CanvasNodeType, type ConnectionHandle, type Position } from "@/types/canvas";

export type PendingConnectionCreate = {
    connection: ConnectionHandle;
    position: Position;
};

export function ConnectionCreateMenu({
    layout,
    onCreate,
    onClose,
}: {
    layout: CanvasMenuLayout;
    onCreate: (type: CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Config | CanvasNodeType.Video | CanvasNodeType.Audio) => void;
    onClose: () => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    return (
        <div
            className="thin-scrollbar absolute z-[120] overflow-y-auto rounded-[18px] border p-3 backdrop-blur"
            data-connection-create-menu
            data-canvas-no-zoom
            style={{ ...layout, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-sm font-medium" style={{ color: theme.node.muted }}>
                    {t("canvas.createMenu.fromNode")}
                </span>
                <button type="button" className="grid size-7 place-items-center rounded-lg text-base opacity-55 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10" onClick={onClose} aria-label={t("canvas.createMenu.close")}>
                    ×
                </button>
            </div>
            <div className="grid gap-1">
                <ConnectionCreateOption theme={theme} icon={<List className="size-5" />} title={t("canvas.createMenu.text")} description={t("canvas.createMenu.textDescription")} onClick={() => onCreate(CanvasNodeType.Text)} />
                <ConnectionCreateOption theme={theme} icon={<ImageIcon className="size-5" />} title={t("canvas.createMenu.image")} onClick={() => onCreate(CanvasNodeType.Image)} />
                <ConnectionCreateOption theme={theme} icon={<Video className="size-5" />} title={t("canvas.createMenu.video")} onClick={() => onCreate(CanvasNodeType.Video)} />
                <ConnectionCreateOption theme={theme} icon={<Music2 className="size-5" />} title={t("canvas.createMenu.audio")} onClick={() => onCreate(CanvasNodeType.Audio)} />
                <ConnectionCreateOption theme={theme} icon={<Settings2 className="size-5" />} title={t("canvas.createMenu.config")} description={t("canvas.createMenu.configDescription")} onClick={() => onCreate(CanvasNodeType.Config)} />
            </div>
        </div>
    );
}

export function ConnectionCreateOption({ theme, icon, title, description, onClick }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes]; icon: React.ReactNode; title: string; description?: string; onClick?: () => void }) {
    return (
        <button
            type="button"
            className="flex h-16 w-full cursor-pointer items-center gap-3 rounded-2xl px-3 text-left transition"
            style={{ color: theme.node.text }}
            onClick={onClick}
            onMouseEnter={(event) => (event.currentTarget.style.background = theme.toolbar.itemHover)}
            onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}
        >
            <span className="grid size-11 shrink-0 place-items-center" style={{ color: theme.node.muted }}>
                {icon}
            </span>
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-base font-semibold leading-5">{title}</span>
                {description ? (
                    <span className="mt-1 block truncate text-sm" style={{ color: theme.node.muted }}>
                        {description}
                    </span>
                ) : null}
            </span>
        </button>
    );
}

export function NodeCreateMenu({ layout, onCreate, onClose }: { layout: CanvasMenuLayout; onCreate: (type: string) => void; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    useNodeRegistryVersion();
    const menuRef = useRef<HTMLDivElement>(null);
    const definitions = listNodeDefinitions().filter((def) => def.showInCreateMenu !== false);
    // Close automatically when clicking outside the menu.
    useEffect(() => {
        const handlePointerDown = (event: PointerEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
        };
        document.addEventListener("pointerdown", handlePointerDown, true);
        return () => document.removeEventListener("pointerdown", handlePointerDown, true);
    }, [onClose]);
    return (
        <div
            ref={menuRef}
            className="thin-scrollbar absolute z-[120] overflow-y-auto rounded-[18px] border p-3 backdrop-blur"
            data-canvas-no-zoom
            style={{ ...layout, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-sm font-medium" style={{ color: theme.node.muted }}>
                    {t("canvas.createMenu.select")}
                </span>
                <button type="button" className="grid size-7 place-items-center rounded-lg opacity-55 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10" onClick={onClose} aria-label={t("canvas.createMenu.close")}>
                    <X className="size-4" />
                </button>
            </div>
            <div className="grid gap-1">
                {definitions.map((def) => (
                    <ConnectionCreateOption key={def.type} theme={theme} icon={def.icon} title={def.title} description={def.description} onClick={() => onCreate(def.type)} />
                ))}
            </div>
        </div>
    );
}
