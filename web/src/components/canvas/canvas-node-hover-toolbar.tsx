import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { App, Dropdown, Modal, Segmented, Tooltip, type MenuProps } from "antd";
import { Download, Ellipsis, FolderPlus, Image as ImageIcon, Info, MessageSquare, Minus, Music2, Pencil, Plus, RefreshCw, Settings2, Trash2, Upload, Video, WandSparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { formatBytes, getDataUrlByteSize } from "@/lib/image-utils";
import { useCopyText } from "@/hooks/use-copy-text";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData, type ViewportTransform } from "@/types/canvas";
import type { CanvasNodeToolbarItem } from "@/types/canvas-plugin";
import { ImageToolSettingsModal, type ImageToolbarSettingsTool } from "./canvas-image-toolbar-settings-modal";
import { IMAGE_QUICK_TOOLS_STORAGE_KEY, buildImageToolbarTools, defaultImageQuickToolIds, readImageQuickToolsConfig, type ImageQuickToolId } from "./canvas-image-toolbar-tools";
import { placeFloatingToolbar } from "@/lib/canvas/floating-toolbar-layout";

type CanvasNodeHoverToolbarProps = {
    node: CanvasNodeData | null;
    viewport: ViewportTransform;
    canvasSize: { width: number; height: number };
    promptPanelLayout?: { placement: "above" | "below"; top: number; bottom: number };
    onKeep: (nodeId: string) => void;
    onLeave: () => void;
    onInfo: (node: CanvasNodeData) => void;
    onEditText: (node: CanvasNodeData) => void;
    onDecreaseFont: (node: CanvasNodeData) => void;
    onIncreaseFont: (node: CanvasNodeData) => void;
    onToggleDialog: (node: CanvasNodeData) => void;
    onGenerateImage: (node: CanvasNodeData) => void;
    onUpload: (node: CanvasNodeData) => void;
    onDownload: (node: CanvasNodeData) => void;
    onSaveAsset: (node: CanvasNodeData) => void;
    onOutpaint?: (node: CanvasNodeData) => void;
    onMaskEdit: (node: CanvasNodeData) => void;
    onCrop: (node: CanvasNodeData) => void;
    onSplit: (node: CanvasNodeData) => void;
    onUpscale: (node: CanvasNodeData) => void;
    onSuperResolve: (node: CanvasNodeData) => void;
    onThreeView: (node: CanvasNodeData) => void;
    onAngle: (node: CanvasNodeData) => void;
    onViewImage: (node: CanvasNodeData) => void;
    onReversePrompt: (node: CanvasNodeData) => void;
    onRetry: (node: CanvasNodeData) => void;
    onToggleFreeResize: (node: CanvasNodeData) => void;
    onDelete: (node: CanvasNodeData) => void;
    extraTools?: CanvasNodeToolbarItem[];
};

type ToolbarTool = {
    id: string;
    title: string;
    label: string;
    icon: ReactNode;
    onClick: () => void;
    active?: boolean;
    danger?: boolean;
    disabled?: boolean;
};

export function CanvasNodeHoverToolbar(props: CanvasNodeHoverToolbarProps) {
    return props.node ? <CanvasNodeHoverToolbarContent {...props} node={props.node} /> : null;
}

function CanvasNodeHoverToolbarContent({
    node,
    viewport,
    canvasSize,
    promptPanelLayout,
    onKeep,
    onLeave,
    onInfo,
    onEditText,
    onDecreaseFont,
    onIncreaseFont,
    onToggleDialog,
    onGenerateImage,
    onUpload,
    onDownload,
    onSaveAsset,
    onOutpaint,
    onMaskEdit,
    onCrop,
    onSplit,
    onUpscale,
    onSuperResolve,
    onThreeView,
    onAngle,
    onViewImage,
    onReversePrompt,
    onRetry,
    onToggleFreeResize,
    onDelete,
    extraTools = [],
}: CanvasNodeHoverToolbarProps & { node: CanvasNodeData }) {
    const [quickImageToolIds, setQuickImageToolIds] = useState<ImageQuickToolId[]>(defaultImageQuickToolIds);
    const [showImageToolLabels, setShowImageToolLabels] = useState(false);
    const [draftImageToolIds, setDraftImageToolIds] = useState<ImageQuickToolId[]>(defaultImageQuickToolIds);
    const [draftShowImageToolLabels, setDraftShowImageToolLabels] = useState(false);
    const [imageToolSettingsOpen, setImageToolSettingsOpen] = useState(false);
    const [imageToolsMenuOpen, setImageToolsMenuOpen] = useState(false);
    const [naturalToolbarWidth, setNaturalToolbarWidth] = useState(320);
    const [renderedToolbarWidth, setRenderedToolbarWidth] = useState(320);
    const [compactToolbar, setCompactToolbar] = useState(false);
    const toolbarContentRef = useRef<HTMLDivElement>(null);
    const imageToolSettingsOpenRef = useRef(false);
    const { message } = App.useApp();
    const { t, i18n } = useTranslation();
    const copyText = useCopyText();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    useEffect(() => {
        try {
            const stored = window.localStorage.getItem(IMAGE_QUICK_TOOLS_STORAGE_KEY);
            if (!stored) return;
            const parsed = JSON.parse(stored) as unknown;
            const config = readImageQuickToolsConfig(parsed);
            setQuickImageToolIds(config.ids);
            setShowImageToolLabels(config.showLabels);
        } catch {
            window.localStorage.removeItem(IMAGE_QUICK_TOOLS_STORAGE_KEY);
        }
    }, []);

    useEffect(() => {
        imageToolSettingsOpenRef.current = false;
        setImageToolSettingsOpen(false);
        setImageToolsMenuOpen(false);
    }, [node?.id]);

    useLayoutEffect(() => {
        setNaturalToolbarWidth(320);
        setRenderedToolbarWidth(320);
        setCompactToolbar(false);
    }, [node.id]);

    const activeNode = node;
    const anchorX = viewport.x + (node.position.x + node.width / 2) * viewport.k;
    const nodeTop = viewport.y + node.position.y * viewport.k;
    const nodeBottom = viewport.y + (node.position.y + node.height) * viewport.k;
    const isImage = node.type === CanvasNodeType.Image;
    const isVideo = node.type === CanvasNodeType.Video;
    const isAudio = node.type === CanvasNodeType.Audio;
    const hasImage = isImage && Boolean(node.metadata?.content);
    const hasVideo = isVideo && Boolean(node.metadata?.content);
    const hasAudio = isAudio && Boolean(node.metadata?.content);
    const isText = node.type === CanvasNodeType.Text;
    const isConfig = node.type === CanvasNodeType.Config;
    const canOpenDialog = isText || hasImage || isVideo;
    const canRetry = node.metadata?.status === "error";
    const quickImageToolIdSet = new Set(quickImageToolIds);
    const copyImagePrompt = (target: CanvasNodeData) => {
        const prompt = target.metadata?.prompt?.trim();
        if (!prompt) {
            message.warning(t("canvas.nodeToolbar.noPrompt"));
            return;
        }
        copyText(prompt, t("common.promptCopied"));
    };
    const imageTools = buildImageToolbarTools(node, { onUpload, onToggleFreeResize, onOutpaint, onMaskEdit, onCrop, onSplit, onUpscale, onSuperResolve, onThreeView, onAngle, onViewImage, onCopyPrompt: copyImagePrompt, onReversePrompt });

    function openImageToolSettings() {
        onKeep(activeNode.id);
        imageToolSettingsOpenRef.current = true;
        setImageToolsMenuOpen(false);
        setDraftImageToolIds(quickImageToolIds);
        setDraftShowImageToolLabels(showImageToolLabels);
        setImageToolSettingsOpen(true);
    }

    const baseToolbarTools: ToolbarTool[] = [
        { id: "info", title: t("canvas.nodeToolbar.infoTitle"), label: t("canvas.nodeToolbar.info"), icon: <Info className="size-4" />, onClick: () => onInfo(node) },
        { id: "delete", title: t("canvas.nodeToolbar.removeTitle"), label: t("common.delete"), icon: <Trash2 className="size-4" />, onClick: () => onDelete(node), danger: true },
    ];
    const nodeToolbarTools: ToolbarTool[] = [
        ...(canRetry ? [{ id: "retry", title: t("canvas.nodeToolbar.retryTitle"), label: t("canvas.node.retry"), icon: <RefreshCw className="size-4" />, onClick: () => onRetry(node) }] : []),
        ...(hasImage || hasVideo || isText ? [{ id: "saveAsset", title: t("common.addToAssets"), label: t("canvas.nodeToolbar.saveAsset"), icon: <FolderPlus className="size-4" />, onClick: () => onSaveAsset(node) }] : []),
        ...(hasImage || hasVideo || hasAudio ? [{ id: "download", title: t(hasAudio ? "canvas.nodeToolbar.downloadAudio" : hasVideo ? "canvas.nodeToolbar.downloadVideo" : "canvas.nodeToolbar.downloadImage"), label: t("common.download"), icon: <Download className="size-4" />, onClick: () => onDownload(node) }] : []),
        ...(canOpenDialog ? [{ id: "edit", title: t("common.edit"), label: t("common.edit"), icon: isImage ? <WandSparkles className="size-4" /> : <MessageSquare className="size-4" />, onClick: () => onToggleDialog(node) }] : []),
        ...(isText ? [{ id: "editText", title: t("canvas.nodeToolbar.editTextTitle"), label: t("canvas.nodeToolbar.editText"), icon: <Pencil className="size-4" />, onClick: () => onEditText(node) }] : []),
        ...(isText ? [{ id: "generateImage", title: t("canvas.node.generateImage"), label: t("canvas.node.generate"), icon: <ImageIcon className="size-4" />, onClick: () => onGenerateImage(node) }] : []),
        ...(isConfig ? [{ id: "config", title: t("canvas.configNode.title"), label: t("canvas.configNode.title"), icon: <Settings2 className="size-4" />, onClick: () => onToggleDialog(node) }] : []),
        ...(isText ? [{ id: "decreaseFont", title: t("canvas.nodeToolbar.decreaseFont"), label: t("canvas.nodeToolbar.zoomOut"), icon: <Minus className="size-4" />, onClick: () => onDecreaseFont(node) }] : []),
        ...(isText ? [{ id: "increaseFont", title: t("canvas.nodeToolbar.increaseFont"), label: t("canvas.nodeToolbar.zoomIn"), icon: <Plus className="size-4" />, onClick: () => onIncreaseFont(node) }] : []),
        ...(isImage && !hasImage ? [{ id: "uploadImage", title: t("canvas.nodeToolbar.uploadImage"), label: t("canvas.nodeToolbar.uploadImage"), icon: <Upload className="size-4" />, onClick: () => onUpload(node) }] : []),
        ...(isVideo ? [{ id: "uploadVideo", title: t(hasVideo ? "canvas.nodeToolbar.replaceVideo" : "canvas.nodeToolbar.uploadVideo"), label: t(hasVideo ? "canvas.nodeToolbar.replaceVideo" : "canvas.nodeToolbar.uploadVideo"), icon: <Video className="size-4" />, onClick: () => onUpload(node) }] : []),
        ...(isAudio ? [{ id: "uploadAudio", title: t(hasAudio ? "canvas.nodeToolbar.replaceAudio" : "canvas.nodeToolbar.uploadAudio"), label: t(hasAudio ? "canvas.nodeToolbar.replaceAudio" : "canvas.nodeToolbar.uploadAudio"), icon: <Music2 className="size-4" />, onClick: () => onUpload(node) }] : []),
        ...(hasImage ? imageTools.map((tool) => ({ id: tool.id, title: tool.title, label: tool.label, icon: tool.icon, active: tool.active, disabled: tool.disabled, onClick: tool.onClick })) : []),
    ];
    const allImageToolbarTools = [...baseToolbarTools, ...nodeToolbarTools];
    const retryTools = allImageToolbarTools.filter((tool) => tool.id === "retry");
    const customizableImageToolbarTools = allImageToolbarTools.filter((tool) => tool.id !== "retry");
    const selectableImageToolbarTools = customizableImageToolbarTools as ImageToolbarSettingsTool[];
    const imageToolbarToolById = new Map(customizableImageToolbarTools.map((tool) => [tool.id, tool]));
    const toolbarTools = hasImage
        ? [...retryTools, ...quickImageToolIds.flatMap((id) => {
            const tool = imageToolbarToolById.get(id);
            return tool ? [tool] : [];
        })]
        : [...baseToolbarTools, ...nodeToolbarTools, ...extraTools];
    const moreImageToolbarTools = customizableImageToolbarTools.filter((tool) => !quickImageToolIdSet.has(tool.id as ImageQuickToolId));
    const moreImageMenuItems = buildImageMoreMenu(moreImageToolbarTools, openImageToolSettings, t("canvas.imageTools.customize"), (i18n.resolvedLanguage || i18n.language).startsWith("zh"));

    const closeImageToolSettings = () => {
        imageToolSettingsOpenRef.current = false;
        setImageToolSettingsOpen(false);
        onLeave();
    };

    const setDraftImageToolVisible = (id: ImageQuickToolId, visible: boolean) => {
        setDraftImageToolIds((current) => {
            if (visible) return current.includes(id) ? current : [...current, id];
            return current.filter((toolId) => toolId !== id);
        });
    };

    const saveImageToolSettings = () => {
        const config = { ids: draftImageToolIds, showLabels: draftShowImageToolLabels };
        setQuickImageToolIds(config.ids);
        setShowImageToolLabels(config.showLabels);
        window.localStorage.setItem(IMAGE_QUICK_TOOLS_STORAGE_KEY, JSON.stringify(config));
        closeImageToolSettings();
    };

    const toolbarSignature = toolbarTools.map((tool) => `${tool.id}:${tool.label}:${tool.disabled ? "disabled" : "enabled"}`).join("|");
    useLayoutEffect(() => {
        const width = toolbarContentRef.current?.scrollWidth || renderedToolbarWidth;
        if (width !== renderedToolbarWidth) setRenderedToolbarWidth(width);
        if (!compactToolbar && width !== naturalToolbarWidth) setNaturalToolbarWidth(width);
        const shouldCompact = (compactToolbar ? naturalToolbarWidth : width) > Math.max(0, canvasSize.width - 26);
        if (shouldCompact !== compactToolbar) setCompactToolbar(shouldCompact);
    }, [canvasSize.width, compactToolbar, naturalToolbarWidth, renderedToolbarWidth, showImageToolLabels, toolbarSignature]);
    useEffect(() => setCompactToolbar(false), [showImageToolLabels, toolbarSignature]);

    const toolbarFrameWidth = renderedToolbarWidth + 2;
    const toolbarLayout = placeFloatingToolbar({
        anchorX,
        nodeTop,
        nodeBottom,
        toolbarWidth: toolbarFrameWidth,
        toolbarHeight: 48,
        viewportWidth: canvasSize.width,
        viewportHeight: canvasSize.height,
        placement: promptPanelLayout?.placement === "below" ? "above" : promptPanelLayout?.placement === "above" ? "below" : "auto",
        blockedRect: promptPanelLayout,
    });
    const compact = compactToolbar || toolbarLayout.compact;

    return (
        <>
            <div
                className="thin-scrollbar absolute z-[70] h-12 overflow-x-auto overflow-y-hidden rounded-[18px] border text-[15px] backdrop-blur"
                style={{ left: toolbarLayout.left, top: toolbarLayout.top, width: Math.max(0, Math.min(toolbarFrameWidth, canvasSize.width - 24)), background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                onMouseEnter={() => onKeep(node.id)}
                onMouseLeave={() => {
                    if (!imageToolSettingsOpen && !imageToolsMenuOpen) onLeave();
                }}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
            >
                <div ref={toolbarContentRef} className="flex h-12 w-max items-center">
                    {toolbarTools.map((tool) => (
                        <ToolbarAction key={tool.id} {...tool} showLabel={showImageToolLabels && !compact} />
                    ))}
                    {hasImage ? (
                        <ToolbarAction
                            id="more"
                            title={t("canvas.imageTools.more")}
                            label={t("canvas.imageTools.more")}
                            icon={<Ellipsis className="size-4" />}
                            active={imageToolSettingsOpen || imageToolsMenuOpen}
                            onClick={() => undefined}
                            showLabel={showImageToolLabels && !compact}
                            menu={{
                                items: moreImageMenuItems,
                                onClick: ({ key }) => {
                                    setImageToolsMenuOpen(false);
                                    if (key !== "customize") onLeave();
                                },
                            }}
                            menuOpen={imageToolsMenuOpen}
                            onMenuOpenChange={(open) => {
                                setImageToolsMenuOpen(open);
                                if (open) onKeep(node.id);
                                else if (!imageToolSettingsOpenRef.current) onLeave();
                            }}
                        />
                    ) : null}
                </div>
            </div>
            {hasImage ? (
                <ImageToolSettingsModal
                    open={imageToolSettingsOpen}
                    tools={selectableImageToolbarTools}
                    selectedIds={draftImageToolIds}
                    showLabels={draftShowImageToolLabels}
                    onToggle={setDraftImageToolVisible}
                    onShowLabelsChange={setDraftShowImageToolLabels}
                    onCancel={closeImageToolSettings}
                    onSave={saveImageToolSettings}
                />
            ) : null}
        </>
    );
}

export function CanvasNodeInfoModal({ node, open, onClose }: { node: CanvasNodeData | null; open: boolean; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    const [view, setView] = useState<"info" | "json">("info");
    const imageBytes = node?.type === CanvasNodeType.Image && node.metadata?.content ? getDataUrlByteSize(node.metadata.content) : 0;
    const batchCount = node?.type === CanvasNodeType.Image ? node.metadata?.images?.length || 0 : 0;
    const json = useMemo(() => {
        if (!node) return "";
        return JSON.stringify(
            node,
            (key, value) => {
                if (key === "content" && typeof value === "string" && value.startsWith("data:image/")) {
                    return "[base64 image]";
                }
                return value;
            },
            2,
        );
    }, [node]);

    useEffect(() => {
        if (open) setView("info");
    }, [node?.id, open]);

    const title = (
        <div className="flex items-center justify-between gap-4 pr-12">
            <span>{t("canvas.nodeToolbar.nodeInfo")}</span>
            <Segmented
                size="small"
                value={view}
                onChange={(value) => setView(value as "info" | "json")}
                options={[
                    { label: t("canvas.nodeToolbar.info"), value: "info" },
                    { label: "JSON", value: "json" },
                ]}
            />
        </div>
    );

    return (
        <Modal className="canvas-node-info-modal" title={title} open={open && Boolean(node)} centered footer={null} onCancel={onClose}>
            {node ? (
                <div className="h-[56vh] min-h-[360px] select-text text-sm" data-canvas-shortcuts-ignore>
                    {view === "info" ? (
                        <div className="thin-scrollbar h-full space-y-3 overflow-auto pr-1">
                            <InfoRow label="ID" value={node.id} />
                            <InfoRow label={t("canvas.nodeToolbar.name")} value={node.title || t("canvas.node.untitled")} />
                            <InfoRow label={t("canvas.nodeToolbar.type")} value={node.type === CanvasNodeType.Group ? t("canvas.node.group") : node.type === CanvasNodeType.Config ? t("canvas.configNode.title") : [CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio, CanvasNodeType.Text].includes(node.type as CanvasNodeType) ? t(`assets.kinds.${node.type}`) : getNodeDefinition(node.type)?.title || node.type} />
                            <InfoRow label={t("canvas.nodeToolbar.size")} value={`${Math.round(node.width)} x ${Math.round(node.height)}`} />
                            <InfoRow label={t("canvas.nodeToolbar.position")} value={`${Math.round(node.position.x)}, ${Math.round(node.position.y)}`} />
                            <InfoRow label={t("canvas.nodeToolbar.status")} value={node.metadata?.status || "idle"} />
                            {batchCount > 1 ? <InfoRow label={t("canvas.nodeToolbar.imageGroup")} value={t("canvas.configNode.images", { count: batchCount })} /> : null}
                            {node.metadata?.prompt ? <InfoRow label={t("canvas.configNode.prompt")} value={node.metadata.prompt} /> : null}
                            {imageBytes ? <InfoRow label={t("canvas.nodeToolbar.imageSize")} value={formatBytes(imageBytes)} /> : null}
                            {node.metadata?.errorDetails ? (
                                <div className="rounded-lg border p-3" style={{ borderColor: theme.node.stroke, color: theme.status.danger }}>
                                    {node.metadata.errorDetails}
                                </div>
                            ) : null}
                        </div>
                    ) : (
                        <pre className="thin-scrollbar h-full overflow-auto rounded-lg border p-3 text-xs leading-5" style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }}>
                            {json}
                        </pre>
                    )}
                </div>
            ) : null}
        </Modal>
    );
}

function buildImageMoreMenu(tools: ToolbarTool[], onCustomize: () => void, customizeLabel: string, isChinese: boolean): MenuProps["items"] {
    const groups = [
        { key: "create", label: isChinese ? "AI 创作" : "AI creation", ids: new Set(["edit", "outpaint", "maskEdit", "crop", "threeView", "angle", "superResolve"]) },
        { key: "process", label: isChinese ? "图片处理" : "Image tools", ids: new Set(["split", "upscale", "view"]) },
        { key: "prompt", label: isChinese ? "提示词" : "Prompt", ids: new Set(["copyPrompt", "reversePrompt"]) },
        { key: "manage", label: isChinese ? "文件与节点" : "File and node", ids: new Set(["replace", "resize", "saveAsset", "download", "info", "delete"]) },
    ];
    const items: NonNullable<MenuProps["items"]> = [];
    const groupedIds = new Set<string>();

    groups.forEach((group) => {
        const children = tools.filter((tool) => group.ids.has(tool.id)).map(toImageMenuItem);
        if (!children.length) return;
        children.forEach((item) => groupedIds.add(String(item?.key)));
        items.push({ type: "group", key: group.key, label: group.label, children });
    });

    const remaining = tools.filter((tool) => !groupedIds.has(tool.id)).map(toImageMenuItem);
    if (remaining.length) items.push({ type: "group", key: "other", label: isChinese ? "其他" : "Other", children: remaining });
    if (items.length) items.push({ type: "divider" });
    items.push({ key: "customize", label: customizeLabel, icon: <Settings2 className="size-4" />, onClick: onCustomize });
    return items;
}

function toImageMenuItem(tool: ToolbarTool) {
    return {
        key: tool.id,
        label: tool.label,
        icon: tool.icon,
        danger: tool.danger,
        disabled: tool.disabled,
        onClick: tool.onClick,
    };
}

function ToolbarAction({ title, label, icon, onClick, showLabel, active = false, danger = false, disabled = false, menu, menuOpen, onMenuOpenChange }: ToolbarTool & { showLabel: boolean; menu?: MenuProps; menuOpen?: boolean; onMenuOpenChange?: (open: boolean) => void }) {
    const hasText = showLabel && Boolean(label);
    const [hovered, setHovered] = useState(false);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const button = (
        <button
            type="button"
            className="group relative flex h-12 items-center whitespace-nowrap px-1.5 disabled:cursor-not-allowed"
            style={{ color: danger ? theme.status.danger : theme.toolbar.item, opacity: disabled ? 0.38 : 1 }}
            onClick={onClick}
            aria-label={title}
            aria-pressed={active || undefined}
            aria-haspopup={menu ? "menu" : undefined}
            aria-expanded={menu ? Boolean(menuOpen) : undefined}
            disabled={disabled}
        >
            <span
                className={`flex h-9 items-center ${hasText ? "gap-2 px-2.5" : "justify-center px-2"} rounded-lg transition`}
                style={{ background: active ? theme.toolbar.activeBg : hovered && !disabled ? theme.toolbar.itemHover : "transparent", color: active ? theme.toolbar.activeText : undefined }}
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
            >
                {icon}
                {hasText ? <span>{label}</span> : null}
            </span>
        </button>
    );
    return (
        <Tooltip title={title} placement="top" mouseEnterDelay={0.2} color={theme.toolbar.panel} styles={{ root: { color: theme.node.text, fontSize: 13, fontWeight: 500 } }}>
            {menu ? <Dropdown menu={menu} trigger={["click"]} placement="topRight" open={menuOpen} onOpenChange={onMenuOpenChange}>{button}</Dropdown> : <span className="inline-flex">{button}</span>}
        </Tooltip>
    );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3">
            <span className="opacity-50">{label}</span>
            <span className="min-w-0 whitespace-pre-wrap break-words">{value}</span>
        </div>
    );
}
