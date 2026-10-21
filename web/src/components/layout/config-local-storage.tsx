import { Alert, App, Button, Input, Modal, Progress, Spin } from "antd";
import type { TFunction } from "i18next";
import { Database, FileClock, FolderKanban, FolderOpen, HardDrive, Images, Layers3, Music2, RefreshCw, RotateCcw, ScanSearch, ShieldCheck, Sparkles, Trash2, Video, Wrench } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { ConfigSectionLayout, type ConfigChapter } from "./config-section-layout";
import { readLocalStorageUsage, type LocalStorageUsage } from "@/services/local-storage-usage";
import { clearCreativeHistory } from "@/services/creative-activity";
import { clearCompatibilityCaches } from "@/services/cache-storage";
import { clearThumbnailRuntimeCache } from "@/services/thumbnail-cache";
import { hasVolatileGenerationLogs, runGenerationLogOperation } from "@/services/generation-log-store";
import { listProtectedGenerationStorageKeys } from "@/services/generation-trash";
import { useConfigStore } from "@/stores/use-config-store";

const storeLabelKeys: Record<string, string> = {
    app_state: "appState",
    image_files: "images",
    media_files: "media",
    image_generation_logs: "imageLogs",
    video_generation_logs: "videoLogs",
    agent_chat_messages: "agentMessages",
    prompt_cache: "promptCache",
    thumbnail_cache: "thumbnailCache",
};

export function ConfigLocalStorage({ active }: { active: boolean }) {
    const { message, modal } = App.useApp();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const [usage, setUsage] = useState<LocalStorageUsage | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
    const [workspaceLoading, setWorkspaceLoading] = useState(false);
    const [categoryLoading, setCategoryLoading] = useState<WorkspaceCategory | null>(null);
    const [overview, setOverview] = useState<DesktopStorageOverview | null>(null);
    const [storageLoading, setStorageLoading] = useState(false);
    const [referenceScanError, setReferenceScanError] = useState("");
    const [cleanupTarget, setCleanupTarget] = useState<"images" | "videos" | "audio" | null>(null);
    const [historyClearOpen, setHistoryClearOpen] = useState(false);
    const [historyClearPhrase, setHistoryClearPhrase] = useState("");
    const [historyClearLoading, setHistoryClearLoading] = useState(false);

    const loadWorkspace = useCallback(async () => {
        if (!window.infiniteCanvasDesktop?.getWorkspaceInfo) return;
        try {
            const info = await window.infiniteCanvasDesktop.getWorkspaceInfo();
            setWorkspace(info);
        } catch {
            // The usage panel remains useful in a regular browser build.
        }
    }, []);

    const loadOverview = useCallback(async () => {
        if (!window.infiniteCanvasDesktop?.getStorageOverview) return;
        setStorageLoading(true);
        try {
            let protectedStorageKeys: string[] = [];
            try {
                protectedStorageKeys = await listProtectedGenerationStorageKeys();
                setReferenceScanError("");
            } catch (reason) {
                setReferenceScanError(reason instanceof Error ? reason.message : t("config.localStorage.referenceScanFailed"));
            }
            setOverview(await window.infiniteCanvasDesktop.getStorageOverview(protectedStorageKeys));
        } catch (reason) {
            message.error(reason instanceof Error ? reason.message : t("config.localStorage.readFailed"));
        } finally {
            setStorageLoading(false);
        }
    }, [message, t]);

    const refresh = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            setUsage(await readLocalStorageUsage());
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("config.localStorage.readFailed"));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        if (active && !usage) void refresh();
    }, [active, refresh, usage]);

    useEffect(() => {
        if (active) void Promise.all([loadWorkspace(), loadOverview()]);
    }, [active, loadOverview, loadWorkspace]);

    const cleanStorage = async () => {
        if (!cleanupTarget) return;
        setStorageLoading(true);
        try {
            const cleanup = await runGenerationLogOperation(async () => {
                if (hasVolatileGenerationLogs()) return { blocked: true as const };
                const protectedStorageKeys = await listProtectedGenerationStorageKeys();
                return { blocked: false as const, result: await window.infiniteCanvasDesktop?.cleanupStorage([cleanupTarget], protectedStorageKeys) };
            });
            if (cleanup.blocked) {
                message.warning(t("config.localStorage.cleanupPendingLogs"));
                return;
            }
            if (cleanup.result) message.success(t("config.localStorage.cleanupCompleted", { files: cleanup.result.deletedFiles, size: formatStorageBytes(cleanup.result.deletedBytes), protected: cleanup.result.protectedFiles }));
            setCleanupTarget(null);
            await loadOverview();
        } catch (reason) {
            message.error(reason instanceof Error ? reason.message : t("config.localStorage.cleanupFailed"));
        } finally {
            setStorageLoading(false);
        }
    };

    const clearUpdateCache = () => {
        modal.confirm({
            title: t("config.localStorage.clearUpdateTitle"),
            content: t("config.localStorage.clearUpdateDescription"),
            okText: t("config.localStorage.clear"),
            cancelText: t("common.cancel"),
            okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    const result = await window.infiniteCanvasDesktop?.clearUpdateCache();
                    if (result) message.success(t("config.localStorage.cacheCleared", { size: formatStorageBytes(result.clearedBytes) }));
                    await loadOverview();
                } catch (reason) {
                    message.error(reason instanceof Error ? reason.message : t("config.localStorage.cleanupFailed"));
                }
            },
        });
    };

    const clearPreviewCaches = () => {
        modal.confirm({
            title: t("config.localStorage.clearPreviewTitle"),
            content: t("config.localStorage.clearPreviewDescription"),
            okText: t("config.localStorage.clear"),
            cancelText: t("common.cancel"),
            onOk: async () => {
                await clearCompatibilityCaches();
                clearThumbnailRuntimeCache();
                message.success(t("config.localStorage.previewCleared"));
                await refresh();
            },
        });
    };

    const repairStorage = async () => {
        setStorageLoading(true);
        try {
            await window.infiniteCanvasDesktop?.repairStorage();
            await loadOverview();
            message.success(t("config.localStorage.repairCompleted"));
        } catch (reason) {
            message.error(reason instanceof Error ? reason.message : t("config.localStorage.repairFailed"));
        } finally {
            setStorageLoading(false);
        }
    };

    const chooseWorkspace = async () => {
        if (!window.infiniteCanvasDesktop?.chooseWorkspace) return;
        setWorkspaceLoading(true);
        try {
            const result = await window.infiniteCanvasDesktop.chooseWorkspace();
            if (result.cancelled) return;
            if (result.reloaded) message.info(t("config.localStorage.workspaceMigrating"));
        } catch (reason) {
            message.error(reason instanceof Error ? reason.message : t("config.localStorage.workspaceMigrationFailed"));
        } finally {
            setWorkspaceLoading(false);
        }
    };

    const changeCategory = async (category: WorkspaceCategory) => {
        setCategoryLoading(category);
        try {
            const result = await window.infiniteCanvasDesktop?.chooseCategoryDirectory(category);
            if (result?.reloaded) message.info(t("config.localStorage.workspaceMigrating"));
            else await loadWorkspace();
        } catch (reason) {
            message.error(reason instanceof Error ? reason.message : t("config.localStorage.workspaceMigrationFailed"));
        } finally {
            setCategoryLoading(null);
        }
    };

    const resetCategory = async (category: WorkspaceCategory) => {
        setCategoryLoading(category);
        try {
            const result = await window.infiniteCanvasDesktop?.resetCategoryDirectory(category);
            if (result?.reloaded) message.info(t("config.localStorage.workspaceMigrating"));
            else await loadWorkspace();
        } catch (reason) {
            message.error(reason instanceof Error ? reason.message : t("config.localStorage.workspaceMigrationFailed"));
        } finally {
            setCategoryLoading(null);
        }
    };

    const openWorkspace = async (section?: WorkspaceCategory) => {
        try {
            await window.infiniteCanvasDesktop?.openWorkspace(section);
        } catch (reason) {
            message.error(reason instanceof Error ? reason.message : t("config.localStorage.workspaceOpenFailed"));
        }
    };

    const indexedDbBytes = usage?.contentBytes ?? 0;
    const percent = usage ? Math.min(100, (usage.usage / usage.quota) * 100) : 0;
    const openTrash = () => {
        setConfigDialogOpen(false);
        navigate("/trash");
    };
    const requiredHistoryClearPhrase = t("config.localStorage.clearHistoryPhrase");
    const confirmClearHistory = async () => {
        if (historyClearPhrase.trim() !== requiredHistoryClearPhrase) return;
        setHistoryClearLoading(true);
        try {
            await clearCreativeHistory();
            message.success(t("config.localStorage.historyCleared"));
            setHistoryClearOpen(false);
            setHistoryClearPhrase("");
        } catch (reason) {
            message.error(reason instanceof Error ? reason.message : t("config.localStorage.clearHistoryFailed"));
        } finally {
            setHistoryClearLoading(false);
        }
    };

    const storageChapters: ConfigChapter[] = [
        ...(window.infiniteCanvasDesktop
            ? [
                  {
                      key: "workspace",
                      title: t("config.localStorage.workspaceTitle"),
                      description: t("config.localStorage.workspaceDescription"),
                      action: (
                          <div className="flex flex-wrap gap-2">
                              <Button icon={<FolderOpen className="size-4" />} onClick={() => void openWorkspace()}>{t("config.localStorage.openWorkspace")}</Button>
                              <Button type="primary" loading={workspaceLoading} onClick={() => void chooseWorkspace()}>{t("config.localStorage.changeWorkspace")}</Button>
                          </div>
                      ),
                      content: (
                          <>
                              <div data-selectable-text className="rounded-md bg-muted/70 px-3 py-2 font-mono text-xs break-all">{workspace?.path || t("config.localStorage.workspaceLoading")}</div>
                              {workspace?.locationMissing ? (
                                  <Alert className="mt-3" type="warning" showIcon message={t("config.localStorage.workspaceMissing")} description={<span data-selectable-text>{t("config.localStorage.workspaceMissingDescription", { path: workspace.configuredPath })}</span>} />
                              ) : workspace?.isCustom ? (
                                  <div className="mt-2 text-xs text-chart-2">{t("config.localStorage.customWorkspace")}</div>
                              ) : (
                                  <div className="mt-2 text-xs text-muted-foreground">{t("config.localStorage.defaultWorkspace")}</div>
                              )}
                              <div className="mt-4 divide-y divide-border border-t border-border">
                                  {workspace
                                      ? (Object.entries(workspace.locations) as [WorkspaceCategory, WorkspaceLocation][]).map(([category, location]) => (
                                            <StorageLocationRow
                                                key={category}
                                                category={category}
                                                location={location}
                                                loading={categoryLoading === category}
                                                onOpen={() => void openWorkspace(category)}
                                                onChange={() => void changeCategory(category)}
                                                onReset={() => void resetCategory(category)}
                                            />
                                        ))
                                      : null}
                              </div>
                          </>
                      ),
                  },
              ]
            : []),
        ...(window.infiniteCanvasDesktop
            ? [
                  {
                      key: "overview",
                      title: t("config.localStorage.storageOverviewTitle"),
                      description: t("config.localStorage.storageOverviewDescription"),
                      action: (
                          <div className="flex flex-wrap gap-2">
                              <Button type="text" icon={<Wrench className="size-4" />} loading={storageLoading} onClick={() => void repairStorage()}>{t("config.localStorage.checkAndRepair")}</Button>
                              <Button type="text" icon={<ScanSearch className="size-4" />} loading={storageLoading} onClick={() => void loadOverview()}>{t("config.localStorage.scan")}</Button>
                          </div>
                      ),
                      content: overview ? (
                          <>
                              {overview.workspace.health.ok ? (
                                  <div className="flex gap-3 rounded-lg border border-border bg-muted/25 px-4 py-3">
                                      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
                                      <div>
                                          <div className="text-sm font-medium text-foreground">{t("config.localStorage.workspaceHealthy")}</div>
                                          <div className="mt-1 text-xs leading-5 text-muted-foreground">{t("config.localStorage.workspaceHealthyDescription")}</div>
                                      </div>
                                  </div>
                              ) : (
                                  <Alert
                                      type="warning"
                                      showIcon
                                      message={t("config.localStorage.workspaceNeedsRepair")}
                                      description={t("config.localStorage.workspaceNeedsRepairDescription", {
                                          damaged: overview.workspace.health.damagedJsonFiles.length,
                                          temporary: overview.workspace.health.staleTempFiles.length,
                                      })}
                                  />
                              )}
                              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                  {(["images", "videos", "audio", "projects", "records", "skills"] as WorkspaceCategory[]).map((category) => (
                                      <StorageMetric
                                          key={category}
                                          icon={storageCategoryMeta[category].icon}
                                          label={t(`config.localStorage.${storageCategoryMeta[category].labelKey}`)}
                                          value={formatStorageBytes(overview.workspace.categories[category].bytes)}
                                          hint={t("config.localStorage.fileStorageSummary", { files: overview.workspace.categories[category].files })}
                                      />
                                  ))}
                              </div>
                              <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                                  <span>{t("config.localStorage.totalWorkspaceSize")}</span>
                                  <span className="type-numeric text-xs text-foreground">{formatStorageBytes(overview.workspace.totalBytes)}</span>
                              </div>
                          </>
                      ) : <div className="flex min-h-32 items-center justify-center"><Spin /></div>,
                  },
                  {
                      key: "unreferenced",
                      title: t("config.localStorage.unreferencedTitle"),
                      description: t("config.localStorage.unreferencedDescription"),
                      action: <Button type="text" icon={<ScanSearch className="size-4" />} loading={storageLoading} onClick={() => void loadOverview()}>{t("config.localStorage.scanUnused")}</Button>,
                      content: overview ? (
                          <>
                              <div className="divide-y divide-border border-y border-border">
                                  {referenceScanError ? <Alert className="my-3" type="warning" showIcon message={t("config.localStorage.referenceScanFailed")} description={<span data-selectable-text>{referenceScanError}</span>} /> : null}
                                  {(["images", "videos", "audio"] as const).map((category) => (
                                      <StorageCleanupRow
                                          key={category}
                                          category={category}
                                          value={overview.workspace.categories[category]}
                                          disabled={storageLoading || Boolean(referenceScanError) || !overview.workspace.health.ok || !overview.workspace.categories[category].unreferencedFiles}
                                          onClean={() => setCleanupTarget(category)}
                                      />
                                  ))}
                              </div>
                              <div className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
                                  <span>{t("config.localStorage.unreferencedSafety")}</span>
                              </div>
                          </>
                      ) : <div className="flex min-h-24 items-center justify-center"><Spin /></div>,
                  },
                  {
                      key: "cache",
                      title: t("config.localStorage.cacheTitle"),
                      description: t("config.localStorage.cacheDescription"),
                      content: overview ? (
                          <div className="divide-y divide-border border-y border-border">
                              <div className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                                  <div className="min-w-0">
                                      <div className="flex items-center gap-2 text-sm font-medium"><RotateCcw className="size-4" />{t("config.localStorage.updateCache")}</div>
                                      <div className="mt-1 text-xs text-muted-foreground">{t("config.localStorage.updateCacheSummary", { files: overview.updates.files, size: formatStorageBytes(overview.updates.bytes) })}</div>
                                  </div>
                                  <Button type="text" danger icon={<Trash2 className="size-4" />} disabled={storageLoading || !overview.updates.files || ["downloading", "downloaded"].includes(overview.updates.status)} onClick={clearUpdateCache}>{t("config.localStorage.clear")}</Button>
                              </div>
                              <div className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                                  <div className="min-w-0">
                                      <div className="flex items-center gap-2 text-sm font-medium"><Layers3 className="size-4" />{t("config.localStorage.previewCache")}</div>
                                      <div className="mt-1 text-xs text-muted-foreground">{t("config.localStorage.previewCacheDescription")}</div>
                                  </div>
                                  <Button type="text" icon={<Trash2 className="size-4" />} onClick={clearPreviewCaches}>{t("config.localStorage.clear")}</Button>
                              </div>
                          </div>
                      ) : <div className="flex min-h-24 items-center justify-center"><Spin /></div>,
                  },
              ]
            : []),
        {
            key: "trash",
            title: t("config.localStorage.trashTitle"),
            description: t("config.localStorage.trashDescription"),
            action: <Button icon={<Trash2 className="size-4" />} onClick={openTrash}>{t("config.localStorage.openTrash")}</Button>,
            content: overview ? <div className="text-xs text-muted-foreground">{t("config.localStorage.trashSummary", { files: overview.workspace.categories.records.files, size: formatStorageBytes(overview.workspace.categories.records.bytes) })}</div> : undefined,
        },
        {
            key: "creative-history",
            title: t("config.localStorage.creativeHistoryTitle"),
            description: t("config.localStorage.creativeHistoryDescription"),
            action: <Button danger icon={<Trash2 className="size-4" />} onClick={() => setHistoryClearOpen(true)}>{t("config.localStorage.clearCreativeHistory")}</Button>,
        },
        {
            key: "browser-storage",
            title: t(window.infiniteCanvasDesktop ? "config.localStorage.compatibilityTitle" : "config.localStorage.title"),
            description: t(window.infiniteCanvasDesktop ? "config.localStorage.compatibilityDescription" : "config.localStorage.description"),
            action: <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void refresh()}>{t("config.localStorage.refresh")}</Button>,
            content: (
                <>
                    {error ? <Alert type="error" showIcon message={t("config.localStorage.readFailed")} description={<span data-selectable-text>{error}</span>} /> : null}
                    {!usage && loading ? (
                        <div className="flex min-h-48 items-center justify-center"><Spin /></div>
                    ) : usage ? (
                        <>
                            <div className="grid gap-3 sm:grid-cols-3">
                                <StorageMetric icon={<Database className="size-4" />} label={t("config.localStorage.indexedDbUsage")} value={formatStorageBytes(indexedDbBytes)} hint={t("config.localStorage.contentEstimate")} />
                                <StorageMetric icon={<HardDrive className="size-4" />} label={t("config.localStorage.siteUsage")} value={formatStorageBytes(usage.usage)} hint={t("config.localStorage.siteUsageHint")} />
                                <StorageMetric icon={<Layers3 className="size-4" />} label={t("config.localStorage.quota")} value={formatStorageBytes(usage.quota)} hint={t("config.localStorage.quotaHint")} />
                            </div>
                            <div className="mt-4">
                                <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                                    <span>{t("config.localStorage.quotaProgress")}</span>
                                    <span className="type-numeric text-xs">{percent.toFixed(2)}%</span>
                                </div>
                                <Progress percent={percent} showInfo={false} />
                            </div>
                        </>
                    ) : null}
                    {usage?.databases.map((database) => (
                        <div key={database.name} className="mt-5 overflow-hidden rounded-lg border border-border bg-card/25">
                            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                                <div className="min-w-0">
                                    <div className="truncate text-sm font-medium">{t("config.localStorage.mainDatabase")}</div>
                                    <div className="mt-0.5 truncate font-mono text-[13px] text-muted-foreground">{database.name} · v{database.version}</div>
                                </div>
                                <div className="type-numeric shrink-0 text-sm">{formatStorageBytes(database.bytes)}</div>
                            </div>
                            <div className="divide-y divide-border">
                                {database.stores.map((store) => (
                                    <div key={store.name} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 px-4 py-3 text-sm">
                                        <div className="min-w-0">
                                            <div className="truncate font-medium">{storeLabel(store.name, t)}</div>
                                            <div className="mt-0.5 truncate font-mono text-[13px] text-muted-foreground">{store.name}</div>
                                        </div>
                                        <div className="type-numeric text-right text-xs text-muted-foreground">{t("config.localStorage.records", { count: store.records })}</div>
                                        <div className="type-numeric w-20 text-right text-sm">{formatStorageBytes(store.bytes)}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </>
            ),
        },
    ];

    return (
        <>
            <ConfigSectionLayout title={t("config.tabs.storage")} description={t("config.sectionDescriptions.storage")} chapters={storageChapters} />
            <Modal
                open={Boolean(cleanupTarget)}
                title={cleanupTarget ? t("config.localStorage.cleanupTitle", { category: t(`config.localStorage.${storageCategoryMeta[cleanupTarget].labelKey}`) }) : ""}
                okText={t("config.localStorage.confirmCleanup")}
                cancelText={t("common.cancel")}
                okButtonProps={{ danger: true, loading: storageLoading }}
                onOk={() => void cleanStorage()}
                onCancel={() => {
                    setCleanupTarget(null);
                }}
            >
                {cleanupTarget ? (
                    <div className="space-y-3">
                        <Alert
                            type="warning"
                            showIcon
                            message={t("config.localStorage.cleanupMediaWarning")}
                            description={t("config.localStorage.cleanupMediaDescription", {
                                files: overview?.workspace.categories[cleanupTarget].unreferencedFiles || 0,
                                size: formatStorageBytes(overview?.workspace.categories[cleanupTarget].unreferencedBytes || 0),
                            })}
                        />
                        <div className="text-xs text-muted-foreground">{t("config.localStorage.recoveryPointNotice")}</div>
                    </div>
                ) : null}
            </Modal>
            <Modal
                open={historyClearOpen}
                title={t("config.localStorage.clearHistoryTitle")}
                okText={t("config.localStorage.clearCreativeHistory")}
                cancelText={t("common.cancel")}
                okButtonProps={{ danger: true, loading: historyClearLoading, disabled: historyClearPhrase.trim() !== requiredHistoryClearPhrase }}
                cancelButtonProps={{ disabled: historyClearLoading }}
                closable={!historyClearLoading}
                keyboard={!historyClearLoading}
                mask={{ closable: !historyClearLoading }}
                onOk={() => void confirmClearHistory()}
                onCancel={() => setHistoryClearOpen(false)}
                afterClose={() => setHistoryClearPhrase("")}
            >
                <p className="text-sm leading-6 text-foreground">{t("config.localStorage.clearHistoryDescription")}</p>
                <label className="mt-5 block text-sm text-foreground" htmlFor="settings-clear-creative-history">
                    {t("config.localStorage.typeHistoryClearPhrase", { phrase: requiredHistoryClearPhrase })}
                </label>
                <Input
                    id="settings-clear-creative-history"
                    className="mt-2"
                    value={historyClearPhrase}
                    disabled={historyClearLoading}
                    status={historyClearPhrase.trim() !== "" && historyClearPhrase.trim() !== requiredHistoryClearPhrase ? "error" : undefined}
                    autoComplete="off"
                    onChange={(event) => setHistoryClearPhrase(event.target.value)}
                    onPressEnter={() => {
                        if (historyClearPhrase.trim() === requiredHistoryClearPhrase) void confirmClearHistory();
                    }}
                />
            </Modal>
        </>
    );
}

const locationMeta: Record<WorkspaceCategory, { icon: ReactNode; labelKey: string }> = {
    images: { icon: <Images className="size-4" />, labelKey: "imagesDirectory" },
    videos: { icon: <Video className="size-4" />, labelKey: "videosDirectory" },
    audio: { icon: <Music2 className="size-4" />, labelKey: "audioDirectory" },
    projects: { icon: <FolderKanban className="size-4" />, labelKey: "projectsDirectory" },
    records: { icon: <FileClock className="size-4" />, labelKey: "recordsDirectory" },
    skills: { icon: <Sparkles className="size-4" />, labelKey: "skillsDirectory" },
};

const storageCategoryMeta: Record<WorkspaceCategory, { icon: ReactNode; labelKey: string }> = {
    images: { icon: <Images className="size-4" />, labelKey: "imagesDirectory" },
    videos: { icon: <Video className="size-4" />, labelKey: "videosDirectory" },
    audio: { icon: <Music2 className="size-4" />, labelKey: "audioDirectory" },
    records: { icon: <FileClock className="size-4" />, labelKey: "recordsDirectory" },
    projects: { icon: <FolderKanban className="size-4" />, labelKey: "projectsDirectory" },
    skills: { icon: <Sparkles className="size-4" />, labelKey: "skillsDirectory" },
};

function StorageCleanupRow({ category, value, disabled, onClean }: { category: WorkspaceCategory; value: DesktopStorageCategory; disabled: boolean; onClean?: () => void }) {
    const { t } = useTranslation();
    const meta = storageCategoryMeta[category];
    const media = category === "images" || category === "videos" || category === "audio";
    return (
        <div className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium">
                    {meta.icon}
                    {t(`config.localStorage.${meta.labelKey}`)}
                    <span className="type-numeric text-xs text-muted-foreground">{formatStorageBytes(value.bytes)}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                    {media
                        ? t("config.localStorage.mediaStorageSummary", { files: value.files, removableFiles: value.unreferencedFiles, removableSize: formatStorageBytes(value.unreferencedBytes) })
                        : t("config.localStorage.fileStorageSummary", { files: value.files })}
                </div>
            </div>
            {onClean ? (
                <Button type="text" icon={<Trash2 className="size-4" />} disabled={disabled} onClick={onClean}>
                    {t(category === "records" ? "config.localStorage.manageTrash" : "config.localStorage.cleanUnused")}
                </Button>
            ) : (
                <span className="text-xs text-muted-foreground/70">{t("config.localStorage.protectedData")}</span>
            )}
        </div>
    );
}

function StorageLocationRow({ category, location, loading, onOpen, onChange, onReset }: { category: WorkspaceCategory; location: WorkspaceLocation; loading: boolean; onOpen: () => void; onChange: () => void; onReset: () => void }) {
    const { t } = useTranslation();
    const meta = locationMeta[category];
    return (
        <div className="grid gap-2 py-3 sm:grid-cols-[130px_minmax(0,1fr)_auto] sm:items-center">
            <div className="flex items-center gap-2 text-sm font-medium">
                {meta.icon}
                {t(`config.localStorage.${meta.labelKey}`)}
            </div>
            <div className="min-w-0">
                <div data-selectable-text className="truncate font-mono text-xs" title={location.path}>{location.path}</div>
                <div data-selectable-text={location.locationMissing ? "" : undefined} className={`mt-0.5 text-[13px] ${location.locationMissing ? "text-chart-3" : location.isCustom ? "text-chart-2" : "text-muted-foreground"}`} title={location.configuredPath}>
                    {location.locationMissing ? t("config.localStorage.categoryLocationMissing", { path: location.configuredPath }) : t(location.isCustom ? "config.localStorage.customLocation" : "config.localStorage.defaultLocation")}
                </div>
            </div>
            <div className="flex flex-wrap gap-1 sm:justify-end">
                <Button type="text" size="small" icon={<FolderOpen className="size-3.5" />} onClick={onOpen}>{t("config.localStorage.open")}</Button>
                <Button type="text" size="small" loading={loading} onClick={onChange}>{t("config.localStorage.change")}</Button>
                {location.isCustom || location.locationMissing ? <Button type="text" size="small" icon={<RotateCcw className="size-3.5" />} disabled={loading} onClick={onReset}>{t("config.localStorage.restoreDefault")}</Button> : null}
            </div>
        </div>
    );
}

function StorageMetric({ icon, label, value, hint }: { icon: ReactNode; label: string; value: string; hint: string }) {
    return (
        <div className="rounded-lg bg-muted/55 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {icon}
                {label}
            </div>
            <div className="type-numeric mt-2 text-xl">{value}</div>
            <div className="mt-1 text-[13px] text-muted-foreground">{hint}</div>
        </div>
    );
}

function storeLabel(name: string, t: TFunction) {
    const key = storeLabelKeys[name];
    return key ? t(`config.localStorage.stores.${key}`) : name;
}

function formatStorageBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
