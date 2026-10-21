import { Copy, Download, Folder, FolderInput, FolderOpen, FolderPlus, MoreHorizontal, PencilLine, Plus, Search, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { App, Button, Card, Drawer, Dropdown, Empty, Form, Image, Input, Modal, Pagination, Select, Space, Tag, Tooltip, Typography } from "antd";
import type { MenuProps } from "antd";
import { saveAs } from "file-saver";
import type { TFunction } from "i18next";
import { nanoid } from "nanoid";
import { useTranslation } from "react-i18next";

import { StandardPageHeader } from "@/components/layout/standard-page-header";
import { useCopyText } from "@/hooks/use-copy-text";
import { formatBytes, readFileAsDataUrl } from "@/lib/image-utils";
import { appendImportedAssetLibrary } from "@/lib/asset-library";
import { uploadImage } from "@/services/image-storage";
import { cn } from "@/lib/utils";
import { useAssetStore, type Asset, type AssetFolder, type AssetKind, type ImageAsset } from "@/stores/use-asset-store";
import { exportAssets, readAssetPackage } from "./asset-transfer";

type AssetFormValues = {
    kind: AssetKind;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    content?: string;
    folderId?: string;
};

type ImageDraft = ImageAsset["data"] | null;

const kindOptions = ["all", "text", "image", "video"] as const;
type FolderFilter = "all" | "unfiled" | string;

export default function AssetsPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const copyText = useCopyText();
    const [form] = Form.useForm<AssetFormValues>();
    const coverInputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const assetInputRef = useRef<HTMLInputElement>(null);
    const assets = useAssetStore((state) => state.assets);
    const folders = useAssetStore((state) => state.folders);
    const addAsset = useAssetStore((state) => state.addAsset);
    const updateAsset = useAssetStore((state) => state.updateAsset);
    const removeAsset = useAssetStore((state) => state.removeAsset);
    const createFolder = useAssetStore((state) => state.createFolder);
    const renameFolder = useAssetStore((state) => state.renameFolder);
    const deleteFolder = useAssetStore((state) => state.deleteFolder);
    const moveAssets = useAssetStore((state) => state.moveAssets);
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState<AssetKind | "all">("all");
    const [folderFilter, setFolderFilter] = useState<FolderFilter>("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
    const [isAssetOpen, setIsAssetOpen] = useState(false);
    const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
    const [deletingAsset, setDeletingAsset] = useState<Asset | null>(null);
    const [formKind, setFormKind] = useState<AssetKind>("text");
    const [imageDraft, setImageDraft] = useState<ImageDraft>(null);
    const [folderEditor, setFolderEditor] = useState<{ folder?: AssetFolder; name: string } | null>(null);
    const [deletingFolder, setDeletingFolder] = useState<AssetFolder | null>(null);
    const coverUrl = Form.useWatch("coverUrl", form) || "";
    const title = Form.useWatch("title", form) || "";
    const tags = Form.useWatch("tags", form) || [];
    const content = Form.useWatch("content", form) || "";
    const validAssets = useMemo(() => assets.filter((asset) => asset.kind === "text" || asset.kind === "image" || asset.kind === "video"), [assets]);
    const activeFolders = useMemo(() => folders.filter((folder) => !folder.deletedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [folders]);
    const activeFolderIds = useMemo(() => new Set(activeFolders.map((folder) => folder.id)), [activeFolders]);
    const effectiveFolderFilter = folderFilter === "all" || folderFilter === "unfiled" || activeFolderIds.has(folderFilter) ? folderFilter : "unfiled";
    const selectedFolder = activeFolders.find((folder) => folder.id === effectiveFolderFilter);
    const folderCounts = useMemo(() => {
        const counts = new Map<string, number>();
        validAssets.forEach((asset) => {
            const folderId = asset.folderId && activeFolderIds.has(asset.folderId) ? asset.folderId : "unfiled";
            counts.set(folderId, (counts.get(folderId) || 0) + 1);
        });
        return counts;
    }, [activeFolderIds, validAssets]);
    const folderOptions = useMemo(() => [
        { label: t("assets.folders.unfiled"), value: "" },
        ...activeFolders.map((folder) => ({ label: folder.name, value: folder.id })),
    ], [activeFolders, t]);

    const filteredAssets = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return validAssets.filter((asset) => {
            const assetFolderId = asset.folderId && activeFolderIds.has(asset.folderId) ? asset.folderId : undefined;
            if (effectiveFolderFilter === "unfiled" && assetFolderId) return false;
            if (effectiveFolderFilter !== "all" && effectiveFolderFilter !== "unfiled" && assetFolderId !== effectiveFolderFilter) return false;
            if (kindFilter !== "all" && asset.kind !== kindFilter) return false;
            if (!query) return true;
            return assetSearchText(asset).includes(query);
        });
    }, [activeFolderIds, effectiveFolderFilter, validAssets, keyword, kindFilter]);

    const visibleAssets = useMemo(() => {
        const start = (page - 1) * pageSize;
        return filteredAssets.slice(start, start + pageSize);
    }, [filteredAssets, page, pageSize]);

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(filteredAssets.length / pageSize));
        setPage((value) => Math.min(value, maxPage));
    }, [filteredAssets.length, pageSize]);

    const openCreate = () => {
        setEditingAsset(null);
        setImageDraft(null);
        setFormKind("text");
        const folderId = effectiveFolderFilter !== "all" && effectiveFolderFilter !== "unfiled" ? effectiveFolderFilter : undefined;
        form.setFieldsValue({ kind: "text", title: "", coverUrl: "", tags: [], source: t("assets.manual"), note: "", content: "", folderId });
        setIsAssetOpen(true);
    };

    const openEdit = (asset: Asset) => {
        setEditingAsset(asset);
        setFormKind(asset.kind);
        setImageDraft(asset.kind === "image" ? asset.data : null);
        form.setFieldsValue({
            kind: asset.kind,
            title: asset.title,
            coverUrl: asset.coverUrl,
            tags: asset.tags || [],
            source: asset.source,
            note: asset.note,
            content: asset.kind === "text" ? asset.data.content : "",
            folderId: asset.folderId && activeFolderIds.has(asset.folderId) ? asset.folderId : undefined,
        });
        setIsAssetOpen(true);
    };

    const saveAsset = async () => {
        const values = await form.validateFields();
        const base = {
            title: values.title.trim(),
            coverUrl: values.coverUrl?.trim() || (values.kind === "image" && imageDraft ? imageDraft.dataUrl : ""),
            tags: values.tags || [],
            source: values.source?.trim(),
            note: values.note?.trim(),
            folderId: values.folderId || undefined,
            metadata: editingAsset?.metadata || { source: "manual" },
        };

        if (values.kind === "text") {
            const asset = { ...base, kind: "text" as const, data: { content: (values.content || "").trim() } };
            editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset);
        } else {
            if (!imageDraft) {
                message.error(t("assets.selectImage"));
                return;
            }
            const asset = { ...base, kind: "image" as const, data: imageDraft };
            editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset);
        }

        message.success(editingAsset ? t("assets.updated") : t("assets.saved"));
        setIsAssetOpen(false);
    };

    const readCoverFile = async (file?: File) => {
        if (!file) return;
        const dataUrl = await readFileAsDataUrl(file);
        form.setFieldValue("coverUrl", dataUrl);
    };

    const readImageFile = async (file?: File) => {
        if (!file || !file.type.startsWith("image/")) return;
        const image = await uploadImage(file);
        const draft = { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType };
        setImageDraft(draft);
        if (!form.getFieldValue("coverUrl")) form.setFieldValue("coverUrl", draft.dataUrl);
        if (!form.getFieldValue("title")) form.setFieldValue("title", file.name);
    };

    const copyAssetText = async (asset: Asset) => {
        if (asset.kind !== "text") return;
        copyText(asset.data.content, t("assets.textCopied"));
    };

    const downloadImage = (asset: Asset) => {
        if (asset.kind !== "image" && asset.kind !== "video") return;
        saveAs(asset.kind === "video" ? asset.data.url : asset.data.dataUrl, `${asset.title || "asset"}.${asset.data.mimeType.split("/")[1] || "png"}`);
    };

    const exportAllAssets = async () => {
        if (!validAssets.length && !activeFolders.length) {
            message.warning(t("assets.noneToExport"));
            return;
        }
        try {
            await exportAssets({ assets: validAssets, folders: activeFolders }, t("assets.packageName"));
        } catch {
            message.error(t("assets.exportFailed"));
        }
    };

    const importAssetZip = async (file?: File) => {
        if (!file) return;
        let imported: Awaited<ReturnType<typeof readAssetPackage>> | undefined;
        try {
            imported = await readAssetPackage(file);
            const current = useAssetStore.getState();
            await current.replaceLibrary(appendImportedAssetLibrary(current, imported.library, nanoid, new Date().toISOString()));
            message.success(t("assets.imported", { count: imported.library.assets.length }));
        } catch {
            await imported?.rollback();
            message.error(t("assets.importFailed"));
        } finally {
            if (assetInputRef.current) assetInputRef.current.value = "";
        }
    };

    const confirmDelete = () => {
        if (!deletingAsset) return;
        removeAsset(deletingAsset.id);
        message.success(t("assets.deleted"));
        setDeletingAsset(null);
    };

    const saveFolder = () => {
        if (!folderEditor) return;
        const name = folderEditor.name.trim();
        if (!name) {
            message.warning(t("assets.folders.nameRequired"));
            return;
        }
        const duplicate = activeFolders.some((folder) => folder.id !== folderEditor.folder?.id && normalizeFolderName(folder.name) === normalizeFolderName(name));
        if (duplicate) {
            message.warning(t("assets.folders.nameExists"));
            return;
        }
        if (folderEditor.folder) renameFolder(folderEditor.folder.id, name);
        else setFolderFilter(createFolder(name));
        setPage(1);
        setFolderEditor(null);
        message.success(t(folderEditor.folder ? "assets.folders.renamed" : "assets.folders.created"));
    };

    const confirmDeleteFolder = () => {
        if (!deletingFolder) return;
        deleteFolder(deletingFolder.id);
        if (folderFilter === deletingFolder.id) setFolderFilter("unfiled");
        setPage(1);
        setDeletingFolder(null);
        message.success(t("assets.folders.deleted"));
    };

    const folderMenu = (folder: AssetFolder): MenuProps => ({
        items: [
            { key: "rename", label: t("assets.folders.rename"), icon: <PencilLine className="size-3.5" /> },
            { type: "divider" },
            { key: "delete", label: t("assets.folders.delete"), icon: <Trash2 className="size-3.5" />, danger: true },
        ],
        onClick: ({ key }) => {
            if (key === "rename") setFolderEditor({ folder, name: folder.name });
            else setDeletingFolder(folder);
        },
    });

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
            <main className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8">
                <div className="mx-auto max-w-7xl">
                    <StandardPageHeader
                        title={t("assets.title")}
                        description={t("assets.description")}
                        actions={(
                            <Input.Search
                                className="w-full sm:w-[22rem]"
                                size="large"
                                allowClear
                                prefix={<Search className="size-4 text-muted-foreground" />}
                                value={keyword}
                                placeholder={t("assets.search")}
                                onChange={(event) => { setPage(1); setKeyword(event.target.value); }}
                                onSearch={(value) => { setPage(1); setKeyword(value); }}
                            />
                        )}
                    />
                    <section className="border-b border-border py-6">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="grid gap-2 sm:grid-cols-[56px_minmax(0,1fr)] sm:items-center">
                                <div className="type-label text-muted-foreground">{t("assets.type")}</div>
                                <div className="flex flex-wrap gap-2">
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
                            <div className="flex flex-wrap items-center gap-1">
                                <Button type="text" size="small" icon={<Download className="size-3.5" />} onClick={() => void exportAllAssets()}>
                                    {t("assets.export")}
                                </Button>
                                <Button type="text" size="small" icon={<Upload className="size-3.5" />} onClick={() => assetInputRef.current?.click()}>
                                    {t("assets.import")}
                                </Button>
                                <Button type="text" size="small" icon={<Plus className="size-3.5" />} onClick={openCreate}>
                                    {t("assets.add")}
                                </Button>
                            </div>
                        </div>
                    </section>

                    <div className="flex items-center gap-2 pt-5 md:hidden">
                        <Select
                            className="min-w-0 flex-1"
                            value={effectiveFolderFilter}
                            options={folderFilterOptions(activeFolders, folderCounts, validAssets.length, t)}
                            onChange={(value) => { setFolderFilter(value); setPage(1); }}
                        />
                        <Tooltip title={t("assets.folders.create")}>
                            <Button aria-label={t("assets.folders.create")} icon={<FolderPlus className="size-4" />} onClick={() => setFolderEditor({ name: "" })} />
                        </Tooltip>
                        {selectedFolder ? (
                            <Dropdown menu={folderMenu(selectedFolder)} trigger={["click"]}>
                                <Button aria-label={t("assets.folders.actions")} icon={<MoreHorizontal className="size-4" />} />
                            </Dropdown>
                        ) : null}
                    </div>

                    <div className="grid min-h-0 gap-7 pt-6 md:grid-cols-[200px_minmax(0,1fr)]">
                        <aside className="hidden border-r border-border pr-4 md:block">
                            <div className="mb-2 flex h-8 items-center justify-between px-2">
                                <span className="type-label text-muted-foreground">{t("assets.folders.title")}</span>
                                <Tooltip title={t("assets.folders.create")}>
                                    <button
                                        type="button"
                                        aria-label={t("assets.folders.create")}
                                        className="grid size-7 place-items-center rounded-md text-muted-foreground transition hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
                                        onClick={() => setFolderEditor({ name: "" })}
                                    >
                                        <FolderPlus className="size-4" />
                                    </button>
                                </Tooltip>
                            </div>
                            <nav className="space-y-1" aria-label={t("assets.folders.title")}>
                                <FolderRow label={t("assets.folders.all")} count={validAssets.length} active={effectiveFolderFilter === "all"} icon={<FolderOpen className="size-4" />} onClick={() => { setFolderFilter("all"); setPage(1); }} />
                                <FolderRow label={t("assets.folders.unfiled")} count={folderCounts.get("unfiled") || 0} active={effectiveFolderFilter === "unfiled"} icon={<Folder className="size-4" />} onClick={() => { setFolderFilter("unfiled"); setPage(1); }} />
                                {activeFolders.length ? <div className="my-2 border-t border-border" /> : null}
                                {activeFolders.map((folder) => (
                                    <FolderRow
                                        key={folder.id}
                                        label={folder.name}
                                        count={folderCounts.get(folder.id) || 0}
                                        active={effectiveFolderFilter === folder.id}
                                        icon={<Folder className="size-4" />}
                                        onClick={() => { setFolderFilter(folder.id); setPage(1); }}
                                        menu={folderMenu(folder)}
                                    />
                                ))}
                            </nav>
                        </aside>

                        <div className="flex min-w-0 flex-col gap-5">
                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                {visibleAssets.map((asset) => (
                                    <AssetCard
                                        key={asset.id}
                                        asset={asset}
                                        folders={activeFolders}
                                        onOpen={() => setPreviewAsset(asset)}
                                        onEdit={() => openEdit(asset)}
                                        onCopy={copyAssetText}
                                        onDownload={downloadImage}
                                        onMove={(folderId) => { moveAssets([asset.id], folderId); message.success(t("assets.folders.moved")); }}
                                        onDelete={() => setDeletingAsset(asset)}
                                    />
                                ))}
                            </div>

                            {!visibleAssets.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("assets.empty")} className="py-20" /> : null}

                            {filteredAssets.length ? (
                                <div className="flex justify-center pb-8">
                                    <Pagination
                                        current={page}
                                        pageSize={pageSize}
                                        total={filteredAssets.length}
                                        showSizeChanger
                                        pageSizeOptions={[10, 20, 50, 100]}
                                        onChange={(nextPage, nextPageSize) => {
                                            setPage(nextPage);
                                            setPageSize(nextPageSize);
                                        }}
                                    />
                                </div>
                            ) : null}
                        </div>
                    </div>
                </div>
            </main>

            <Modal title={editingAsset ? t("assets.edit") : t("assets.add")} open={isAssetOpen} width={980} onCancel={() => setIsAssetOpen(false)} onOk={() => void saveAsset()} okText={t("common.save")} cancelText={t("common.cancel")} destroyOnHidden>
                <div className="grid gap-6 pt-1 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <Form form={form} layout="vertical" requiredMark={false} initialValues={{ kind: "text", tags: [] }}>
                        <Form.Item name="kind" label={t("assets.type")}>
                            <Select
                                options={[
                                    { label: t("assets.kinds.text"), value: "text" },
                                    { label: t("assets.kinds.image"), value: "image" },
                                ]}
                                onChange={(value) => setFormKind(value)}
                            />
                        </Form.Item>
                        <Form.Item name="title" label={t("assets.fields.title")} rules={[{ required: true, message: t("assets.fields.titleRequired") }]}>
                            <Input size="large" placeholder={t("assets.fields.titlePlaceholder")} />
                        </Form.Item>
                        <Form.Item name="coverUrl" label={t("assets.fields.coverUrl")}>
                            <Space.Compact className="w-full">
                                <Input placeholder={t("assets.fields.coverPlaceholder")} />
                                <Button icon={<Upload className="size-3.5" />} onClick={() => coverInputRef.current?.click()}>
                                    {t("common.upload")}
                                </Button>
                            </Space.Compact>
                        </Form.Item>
                        <Form.Item name="tags" label={t("assets.fields.tags")}>
                            <Select mode="tags" tokenSeparators={[",", "，"]} placeholder={t("assets.fields.tagsPlaceholder")} />
                        </Form.Item>
                        <Form.Item name="folderId" label={t("assets.folders.folder")}>
                            <Select allowClear options={folderOptions} placeholder={t("assets.folders.unfiled")} />
                        </Form.Item>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Form.Item name="source" label={t("assets.fields.source")}>
                                <Input placeholder={t("assets.fields.sourcePlaceholder")} />
                            </Form.Item>
                            <Form.Item name="note" label={t("assets.fields.note")}>
                                <Input placeholder={t("assets.fields.optional")} />
                            </Form.Item>
                        </div>
                        {formKind === "text" ? (
                            <Form.Item name="content" label={t("assets.fields.textContent")} rules={[{ required: true, message: t("assets.fields.textRequired") }]}>
                                <Input.TextArea rows={8} placeholder={t("assets.fields.textPlaceholder")} />
                            </Form.Item>
                        ) : (
                            <Form.Item label={t("assets.fields.imageContent")} required>
                                <div className="rounded-lg border border-dashed border-border bg-background/45 p-4">
                                    <Button icon={<Upload className="size-4" />} onClick={() => imageInputRef.current?.click()}>
                                        {t("assets.selectImageFile")}
                                    </Button>
                                    {imageDraft ? (
                                        <Typography.Text type="secondary" className="ml-3 text-xs">
                                            {imageDraft.width}x{imageDraft.height} · {formatBytes(imageDraft.bytes)}
                                        </Typography.Text>
                                    ) : (
                                        <Typography.Text type="secondary" className="ml-3 text-xs">
                                            {t("assets.noImageSelected")}
                                        </Typography.Text>
                                    )}
                                </div>
                            </Form.Item>
                        )}
                    </Form>
                    <div className="rounded-xl border border-border bg-muted/35 p-4">
                        <Typography.Text strong>{t("assets.preview")}</Typography.Text>
                        <div className="mt-3 overflow-hidden rounded-lg border border-border bg-background">
                            {coverUrl || imageDraft?.dataUrl ? (
                                <img src={coverUrl || imageDraft?.dataUrl} alt="" className="aspect-[4/3] w-full object-cover" />
                            ) : (
                                <div className="flex aspect-[4/3] items-center justify-center bg-muted/55 p-5 text-center text-sm text-muted-foreground">{content || t("assets.noCover")}</div>
                            )}
                            <div className="p-4">
                                <Typography.Text strong ellipsis className="block">
                                    {title || t("assets.untitled")}
                                </Typography.Text>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {tags.length ? (
                                        tags.map((tag) => (
                                            <Tag key={tag} className="m-0">
                                                {tag}
                                            </Tag>
                                        ))
                                    ) : (
                                        <Tag className="m-0">{t("assets.untagged")}</Tag>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                        void readCoverFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
                <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                        void readImageFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
            </Modal>

            <AssetDrawer asset={previewAsset} onClose={() => setPreviewAsset(null)} onCopy={copyAssetText} onDownload={downloadImage} />

            <input ref={assetInputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importAssetZip(event.target.files?.[0])} />

            <Modal title={t("assets.deleteTitle")} open={Boolean(deletingAsset)} onCancel={() => setDeletingAsset(null)} onOk={confirmDelete} okText={t("common.delete")} okButtonProps={{ danger: true }} cancelText={t("common.cancel")}>
                {t("assets.deleteConfirm", { name: deletingAsset?.title })}
            </Modal>

            <Modal
                title={t(folderEditor?.folder ? "assets.folders.rename" : "assets.folders.create")}
                open={Boolean(folderEditor)}
                onCancel={() => setFolderEditor(null)}
                onOk={saveFolder}
                okText={t("common.save")}
                cancelText={t("common.cancel")}
                destroyOnHidden
            >
                <Input
                    autoFocus
                    maxLength={40}
                    value={folderEditor?.name || ""}
                    placeholder={t("assets.folders.namePlaceholder")}
                    onChange={(event) => setFolderEditor((current) => current ? { ...current, name: event.target.value } : current)}
                    onPressEnter={saveFolder}
                />
            </Modal>

            <Modal
                title={t("assets.folders.deleteTitle")}
                open={Boolean(deletingFolder)}
                onCancel={() => setDeletingFolder(null)}
                onOk={confirmDeleteFolder}
                okText={t("common.delete")}
                okButtonProps={{ danger: true }}
                cancelText={t("common.cancel")}
            >
                {t("assets.folders.deleteConfirm", { name: deletingFolder?.name, count: deletingFolder ? folderCounts.get(deletingFolder.id) || 0 : 0 })}
            </Modal>
        </div>
    );
}

function FolderRow({ label, count, active, icon, onClick, menu }: { label: string; count: number; active: boolean; icon: ReactNode; onClick: () => void; menu?: MenuProps }) {
    return (
        <div className={cn("group flex h-9 w-full items-center rounded-md transition hover:bg-black/5 dark:hover:bg-white/10", active && "bg-muted font-medium")}>
            <button type="button" className="flex min-w-0 flex-1 items-center gap-2 px-2 text-left text-sm" onClick={onClick}>
                <span className="shrink-0 text-muted-foreground">{icon}</span>
                <span className="min-w-0 flex-1 truncate">{label}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{count}</span>
            </button>
            {menu ? (
                <Dropdown menu={menu} trigger={["click"]}>
                    <button
                        type="button"
                        aria-label={label}
                        className="mr-1 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition hover:bg-black/5 hover:text-foreground group-hover:opacity-100 focus:opacity-100 dark:hover:bg-white/10"
                    >
                        <MoreHorizontal className="size-4" />
                    </button>
                </Dropdown>
            ) : null}
        </div>
    );
}

function AssetCard({ asset, folders, onOpen, onEdit, onCopy, onDownload, onMove, onDelete }: { asset: Asset; folders: AssetFolder[]; onOpen: () => void; onEdit: () => void; onCopy: (asset: Asset) => void; onDownload: (asset: Asset) => void; onMove: (folderId?: string) => void; onDelete: () => void }) {
    const { t } = useTranslation();
    const cover = asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "");
    const summary = assetSummary(asset);
    const moveMenu: MenuProps = {
        items: [
            { key: "unfiled", label: t("assets.folders.unfiled"), icon: <Folder className="size-3.5" />, disabled: !asset.folderId },
            ...(folders.length ? [{ type: "divider" as const }] : []),
            ...folders.map((folder) => ({ key: folder.id, label: folder.name, icon: <Folder className="size-3.5" />, disabled: asset.folderId === folder.id })),
        ],
        onClick: ({ key }) => onMove(key === "unfiled" ? undefined : key),
    };
    return (
        <Card
            hoverable
            className="overflow-hidden !border-border !bg-card !shadow-none transition-colors duration-200 hover:!border-foreground/30"
            styles={{ body: { padding: 0 } }}
            cover={
                <button type="button" className="block w-full text-left" onClick={onOpen}>
                    {cover ? (
                        <img src={cover} alt={asset.title} className="aspect-[4/3] w-full object-cover" />
                    ) : (
                        <div className="flex aspect-[4/3] items-center justify-center bg-muted/55 p-5 text-center text-sm leading-6 text-muted-foreground">{asset.kind === "text" ? asset.data.content : t("assets.noCover")}</div>
                    )}
                </button>
            }
        >
            <button type="button" className="block w-full text-left" onClick={onOpen}>
                <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h2 className="line-clamp-1 text-sm font-medium text-foreground">{asset.title}</h2>
                            <Typography.Text type="secondary" className="mt-1 block text-xs">
                                {asset.source || t("assets.unknownSource")}
                            </Typography.Text>
                        </div>
                        <Tag className="m-0 shrink-0 text-[13px]">{t(`assets.kinds.${asset.kind}`)}</Tag>
                    </div>
                    <Typography.Paragraph type="secondary" ellipsis={{ rows: 3 }} className="!mb-0 !mt-2 !text-xs !leading-5">
                        {summary}
                    </Typography.Paragraph>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                        {(asset.tags || []).slice(0, 3).map((tag) => (
                            <Tag key={tag} className="m-0 text-[13px]">
                                {tag}
                            </Tag>
                        ))}
                        {!asset.tags?.length ? <Tag className="m-0 text-[13px]">{t("assets.noTags")}</Tag> : null}
                    </div>
                </div>
            </button>
            <div className="flex flex-wrap items-center gap-1 border-t border-border px-3 py-2.5">
                <Button type="text" size="small" onClick={onOpen}>
                    {t("common.view")}
                </Button>
                {asset.kind !== "video" ? (
                    <Button type="text" size="small" icon={<PencilLine className="size-3.5" />} onClick={onEdit}>
                        {t("common.edit")}
                    </Button>
                ) : null}
                {asset.kind === "text" ? (
                    <Button type="text" size="small" icon={<Copy className="size-3.5" />} onClick={() => void onCopy(asset)}>
                        {t("common.copy")}
                    </Button>
                ) : null}
                {asset.kind === "image" || asset.kind === "video" ? (
                    <Button type="text" size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(asset)}>
                        {t("common.download")}
                    </Button>
                ) : null}
                <Dropdown menu={moveMenu} trigger={["click"]}>
                    <Button type="text" size="small" icon={<FolderInput className="size-3.5" />}>
                        {t("assets.folders.moveTo")}
                    </Button>
                </Dropdown>
                <Button type="text" size="small" danger icon={<Trash2 className="size-3.5" />} onClick={onDelete}>
                    {t("common.delete")}
                </Button>
            </div>
        </Card>
    );
}

function AssetDrawer({ asset, onClose, onCopy, onDownload }: { asset: Asset | null; onClose: () => void; onCopy: (asset: Asset) => void; onDownload: (asset: Asset) => void }) {
    const { t } = useTranslation();
    const cover = asset ? asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "") : "";
    return (
        <Drawer title={t("assets.details")} open={Boolean(asset)} size="large" onClose={onClose}>
            {asset ? (
                <div className="space-y-5">
                    {cover ? (
                        <Image src={cover} alt={asset.title} className="rounded-lg" />
                    ) : (
                        <div data-selectable-text={asset.kind === "text" ? "" : undefined} className="rounded-lg border border-border bg-muted/35 p-5 text-sm leading-6 text-muted-foreground">{asset.kind === "text" ? asset.data.content : t("assets.noCover")}</div>
                    )}
                    <div>
                        <Typography.Title level={4} className="!mb-2">
                            {asset.title}
                        </Typography.Title>
                        <Space size={[4, 4]} wrap>
                            <Tag>{t(`assets.kinds.${asset.kind}`)}</Tag>
                            {(asset.tags || []).map((tag) => (
                                <Tag key={tag}>{tag}</Tag>
                            ))}
                        </Space>
                    </div>
                    <div className="rounded-lg border border-border bg-background/45 p-4">
                        <Typography.Text type="secondary" className="block text-xs">
                            {t("assets.fields.textContent")}
                        </Typography.Text>
                        {asset.kind === "text" ? (
                            <Typography.Paragraph data-selectable-text className="mt-2 whitespace-pre-wrap">{asset.data.content}</Typography.Paragraph>
                        ) : asset.kind === "video" ? (
                            <video src={asset.data.url} controls className="mt-2 aspect-video w-full rounded-lg bg-black" />
                        ) : (
                            <Typography.Text className="mt-2 block">
                                {asset.data.width}x{asset.data.height} · {formatBytes(asset.data.bytes)} · {asset.data.mimeType}
                            </Typography.Text>
                        )}
                    </div>
                    {asset.note ? (
                        <div>
                            <Typography.Text type="secondary">{t("assets.fields.note")}</Typography.Text>
                            <Typography.Paragraph data-selectable-text className="mt-1">{asset.note}</Typography.Paragraph>
                        </div>
                    ) : null}
                    <Space>
                        {asset.kind === "text" ? (
                            <Button type="primary" icon={<Copy className="size-4" />} onClick={() => onCopy(asset)}>
                                {t("assets.copyText")}
                            </Button>
                        ) : null}
                        {asset.kind === "image" || asset.kind === "video" ? (
                            <Button type="primary" icon={<Download className="size-4" />} onClick={() => onDownload(asset)}>
                                {asset.kind === "video" ? t("assets.downloadVideo") : t("assets.downloadImage")}
                            </Button>
                        ) : null}
                    </Space>
                </div>
            ) : null}
        </Drawer>
    );
}

function assetSummary(asset: Asset) {
    if (asset.kind === "text") return asset.data.content;
    return `${asset.data.width}x${asset.data.height} · ${formatBytes(asset.data.bytes)} · ${asset.data.mimeType}`;
}

function assetSearchText(asset: Asset) {
    return [asset.title, asset.source || "", asset.note || "", (asset.tags || []).join(" "), asset.kind === "text" ? asset.data.content : asset.data.mimeType].join(" ").toLowerCase();
}

function folderFilterOptions(folders: AssetFolder[], counts: Map<string, number>, total: number, t: TFunction) {
    return [
        { value: "all", label: `${t("assets.folders.all")} (${total})` },
        { value: "unfiled", label: `${t("assets.folders.unfiled")} (${counts.get("unfiled") || 0})` },
        ...folders.map((folder) => ({ value: folder.id, label: `${folder.name} (${counts.get(folder.id) || 0})` })),
    ];
}

function normalizeFolderName(name: string) {
    return name.trim().toLocaleLowerCase();
}
