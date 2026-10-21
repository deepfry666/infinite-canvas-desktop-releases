import { useEffect, useMemo, useState } from "react";
import { Empty, Input, Modal, Pagination, Select, Tag } from "antd";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { cn } from "@/lib/utils";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { useThemeStore } from "@/stores/use-theme-store";

export type InsertAssetPayload = { kind: "text"; content: string; title: string } | { kind: "image"; dataUrl: string; title: string; storageKey?: string } | { kind: "video"; url: string; title: string; storageKey?: string; width?: number; height?: number; bytes?: number; mimeType?: string };

type Props = {
    open: boolean;
    defaultTab?: string;
    onInsert: (payload: InsertAssetPayload) => void;
    onClose: () => void;
};

export function AssetPickerModal({ open, onInsert, onClose }: Props) {
    const { t } = useTranslation();
    return (
        <Modal title={t("canvas.assetPicker.title")} open={open} onCancel={onClose} footer={null} width={860} destroyOnHidden styles={{ body: { padding: "0 24px 24px", minHeight: 480 } }}>
            <MyAssetsTab onInsert={onInsert} />
        </Modal>
    );
}

const PAGE_SIZE = 8;

const kindOptions = ["all", "text", "image", "video"];

function PickerCard({ title, kind, cover, theme, onClick }: { title: string; kind: string; cover: string; theme: CanvasTheme; onClick: () => void }) {
    const { t } = useTranslation();
    return (
        <button
            type="button"
            className="group relative cursor-pointer overflow-hidden rounded-lg border text-left transition hover:opacity-90"
            style={{ background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            onClick={onClick}
        >
            {cover ? (
                <img src={cover} alt={title} className="aspect-[4/3] w-full object-cover" />
            ) : (
                <div className="flex aspect-[4/3] items-center justify-center p-3 text-center text-xs leading-5" style={{ color: theme.node.muted }}>{title}</div>
            )}
            <div className="p-2.5">
                <div className="flex items-center justify-between gap-2">
                    <span className="line-clamp-1 text-xs font-medium">{title}</span>
                    <Tag className="m-0 shrink-0 text-[12px]">{t(`assets.kinds.${kind}`)}</Tag>
                </div>
            </div>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-medium opacity-0 backdrop-blur-sm transition group-hover:opacity-100" style={{ background: theme.toolbar.panel, color: theme.node.text }}>{t("canvas.assetPicker.insert")}</div>
        </button>
    );
}

function MyAssetsTab({ onInsert }: { onInsert: (payload: InsertAssetPayload) => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const assets = useAssetStore((state) => state.assets);
    const folders = useAssetStore((state) => state.folders);
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState("all");
    const [folderFilter, setFolderFilter] = useState("all");
    const [page, setPage] = useState(1);
    const activeFolders = useMemo(() => folders.filter((folder) => !folder.deletedAt), [folders]);
    const activeFolderIds = useMemo(() => new Set(activeFolders.map((folder) => folder.id)), [activeFolders]);
    const effectiveFolderFilter = folderFilter === "all" || folderFilter === "unfiled" || activeFolderIds.has(folderFilter) ? folderFilter : "unfiled";

    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return assets
            .filter((a) => a.kind === "text" || a.kind === "image" || a.kind === "video")
            .filter((a) => {
                if (effectiveFolderFilter === "all") return true;
                const folderId = a.folderId && activeFolderIds.has(a.folderId) ? a.folderId : undefined;
                return effectiveFolderFilter === "unfiled" ? !folderId : folderId === effectiveFolderFilter;
            })
            .filter((a) => kindFilter === "all" || a.kind === kindFilter)
            .filter((a) => !query || [a.title, ...(a.tags || [])].join(" ").toLowerCase().includes(query));
    }, [activeFolderIds, assets, effectiveFolderFilter, keyword, kindFilter]);

    const visible = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page]);

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
        setPage((v) => Math.min(v, maxPage));
    }, [filtered.length]);

    const handleInsert = (asset: Asset) => {
        if (asset.kind === "text") {
            onInsert({ kind: "text", content: asset.data.content, title: asset.title });
        } else {
            onInsert(asset.kind === "video" ? { kind: "video", url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, width: asset.data.width, height: asset.data.height, bytes: asset.data.bytes, mimeType: asset.data.mimeType } : { kind: "image", dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey, title: asset.title });
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
                <Input
                    className="w-56"
                    size="small"
                    prefix={<Search className="size-3.5" style={{ color: theme.node.faint }} />}
                    placeholder={t("canvas.assetPicker.search")}
                    value={keyword}
                    allowClear
                    onChange={(e) => {
                        setPage(1);
                        setKeyword(e.target.value);
                    }}
                />
                <Select
                    size="small"
                    className="w-40"
                    value={effectiveFolderFilter}
                    options={[
                        { value: "all", label: t("assets.folders.all") },
                        { value: "unfiled", label: t("assets.folders.unfiled") },
                        ...activeFolders.map((folder) => ({ value: folder.id, label: folder.name })),
                    ]}
                    onChange={(value) => { setPage(1); setFolderFilter(value); }}
                />
                <div className="flex gap-1.5">
                    {kindOptions.map((option) => (
                        <Tag.CheckableTag
                            key={option}
                            checked={kindFilter === option}
                            className={cn("prompt-filter-tag", kindFilter === option && "is-active")}
                            onChange={() => {
                                setPage(1);
                                setKindFilter(option);
                            }}
                        >
                            {option === "all" ? t("common.all") : t(`assets.kinds.${option}`)}
                        </Tag.CheckableTag>
                    ))}
                </div>
            </div>

            {visible.length ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {visible.map((asset) => (
                        <PickerCard key={asset.id} title={asset.title} kind={asset.kind} cover={asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "")} theme={theme} onClick={() => handleInsert(asset)} />
                    ))}
                </div>
            ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("canvas.assetPicker.empty")} className="py-12" />
            )}

            {filtered.length > PAGE_SIZE && (
                <div className="flex justify-center">
                    <Pagination size="small" current={page} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} showSizeChanger={false} />
                </div>
            )}
        </div>
    );
}
