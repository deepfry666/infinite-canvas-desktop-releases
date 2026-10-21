import { App, Button, Select, Switch, Tag } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { PromptSourceEditorDrawer } from "./prompt-source-editor-drawer";
import { PromptSourceContentModal } from "./prompt-source-content-modal";
import { fetchPromptSourceStatuses, refreshAllSources, refreshSource } from "@/services/api/prompts";
import { PROMPT_SOURCE_INTERVALS, usePromptSourceStore } from "@/stores/use-prompt-source-store";
import type { PromptSource } from "@/services/api/prompt-source-presets";
import { ConfigSectionLayout } from "./config-section-layout";

const STATUS_QUERY_KEY = ["prompt-source-statuses"];

export function ConfigPromptSources() {
    const { message, modal } = App.useApp();
    const { i18n, t } = useTranslation();
    const queryClient = useQueryClient();
    const sources = usePromptSourceStore((state) => state.sources);
    const schedule = usePromptSourceStore((state) => state.schedule);
    const addSource = usePromptSourceStore((state) => state.addSource);
    const saveSource = usePromptSourceStore((state) => state.saveSource);
    const removeSource = usePromptSourceStore((state) => state.removeSource);
    const toggleSource = usePromptSourceStore((state) => state.toggleSource);
    const updateSchedule = usePromptSourceStore((state) => state.updateSchedule);
    const statusQuery = useQuery({ queryKey: STATUS_QUERY_KEY, queryFn: fetchPromptSourceStatuses });

    const [editingSource, setEditingSource] = useState<PromptSource | null>(null);
    const [viewingId, setViewingId] = useState("");
    const [refreshingId, setRefreshingId] = useState("");
    const [refreshingAll, setRefreshingAll] = useState(false);
    const viewingSource = sources.find((item) => item.id === viewingId) || null;
    const intervalOptions = PROMPT_SOURCE_INTERVALS.map((value) => ({ value, label: t(`config.promptSources.intervals.${intervalKey(value)}`) }));

    const invalidatePrompts = async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["prompts"] }),
            queryClient.invalidateQueries({ queryKey: ["side-panel-prompts"] }),
            queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY }),
        ]);
    };

    const handleSave = (source: PromptSource) => {
        saveSource(source);
        void invalidatePrompts();
    };

    const handleDelete = (source: PromptSource) => {
        modal.confirm({
            title: t("config.promptSources.deleteTitle", { name: source.name }),
            content: t("config.promptSources.deleteDescription"),
            okText: t("common.delete"),
            okButtonProps: { danger: true },
            cancelText: t("common.cancel"),
            onOk: async () => {
                removeSource(source.id);
                await invalidatePrompts();
            },
        });
    };

    const handleRefreshOne = async (source: PromptSource) => {
        setRefreshingId(source.id);
        try {
            const result = await refreshSource(source.id);
            await invalidatePrompts();
            message.success(t("config.promptSources.refreshed", { name: source.name, count: result.count }));
        } catch (error) {
            await queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
            message.error(error instanceof Error ? error.message : t("config.promptSources.refreshFailedCached"));
        } finally {
            setRefreshingId("");
        }
    };

    const handleRefreshAll = async () => {
        setRefreshingAll(true);
        try {
            const result = await refreshAllSources();
            updateSchedule("lastFetchedAt", new Date().toISOString());
            await invalidatePrompts();
            if (result.failureCount) message.warning(t("config.promptSources.refreshPartial", { success: result.successCount, failed: result.failureCount }));
            else message.success(t("config.promptSources.refreshAllSuccess", { sources: result.successCount, total: result.total }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.promptSources.refreshFailed"));
        } finally {
            setRefreshingAll(false);
        }
    };

    return (
        <>
            <ConfigSectionLayout
                title={t("config.tabs.promptSources")}
                description={t("config.sectionDescriptions.promptSources")}
                chapters={[
                    {
                        key: "sources",
                        title: t("config.promptSources.sourcesTitle"),
                        description: t("config.promptSources.sourcesDescription"),
                        action: (
                            <Button type="primary" icon={<Plus className="size-4" />} onClick={() => setEditingSource(addSource())}>
                                {t("config.promptSources.add")}
                            </Button>
                        ),
                        content: (
                            <div className="space-y-2">
                                {sources.map((source) => {
                                    const status = statusQuery.data?.[source.id];
                                    return (
                                        <div key={source.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card/30 px-4 py-3 transition-colors hover:bg-muted/35">
                                            <Switch aria-label={t("config.promptSources.toggle", { name: source.name })} size="small" checked={source.enabled} onChange={(checked) => { toggleSource(source.id, checked); void invalidatePrompts(); }} />
                                            <div className="min-w-[220px] flex-1">
                                                <div className="flex min-w-0 items-center gap-2">
                                                    <span className="truncate text-sm font-medium">{source.name}</span>
                                                    {source.builtIn ? <Tag className="m-0 shrink-0 text-[12px]">{t("config.promptSources.builtIn")}</Tag> : null}
                                                </div>
                                                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                                    <a className="max-w-full truncate transition-colors hover:text-foreground hover:underline" href={source.homepage || source.url} target="_blank" rel="noreferrer">
                                                        {source.homepage || source.url}
                                                    </a>
                                                    <span className="type-numeric text-xs">{t("config.promptSources.itemCount", { count: status?.count ?? 0 })}</span>
                                                    {status?.lastError ? <Tag color="error" className="m-0 text-[12px]" title={status.lastError}>{t("config.promptSources.failed")}</Tag> : status?.lastSuccessAt ? <Tag className="m-0 border-success/20 !bg-success/10 text-[12px] !text-success">{t("config.promptSources.healthy")}</Tag> : <Tag className="m-0 text-[12px]">{t("config.promptSources.unsynced")}</Tag>}
                                                    <span>{status?.lastSuccessAt ? t("config.promptSources.lastSuccess", { time: formatTime(status.lastSuccessAt, i18n.resolvedLanguage) }) : t("config.promptSources.neverFetched")}</span>
                                                </div>
                                            </div>
                                            <div className="ml-auto flex flex-wrap justify-end gap-2">
                                                <Button size="small" icon={<Eye className="size-3.5" />} onClick={() => setViewingId(source.id)}>{t("config.promptSources.view")}</Button>
                                                <Button size="small" icon={<RefreshCw className="size-3.5" />} loading={refreshingId === source.id} onClick={() => void handleRefreshOne(source)}>{t("config.promptSources.refresh")}</Button>
                                                {!source.builtIn ? <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => setEditingSource(source)}>{t("config.promptSources.edit")}</Button> : null}
                                                {!source.builtIn ? <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => handleDelete(source)}>{t("common.delete")}</Button> : null}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ),
                    },
                    {
                        key: "schedule",
                        title: t("config.promptSources.schedule"),
                        description: t("config.promptSources.scheduleDescription"),
                        action: (
                            <Button size="small" type="primary" icon={<RefreshCw className="size-3.5" />} loading={refreshingAll} onClick={() => void handleRefreshAll()}>
                                {t("config.promptSources.refreshAll")}
                            </Button>
                        ),
                        content: (
                            <div className="flex flex-wrap items-center gap-3">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-muted-foreground">{t("config.promptSources.interval")}</span>
                                    <Select size="small" className="w-36" value={schedule.intervalMinutes} options={intervalOptions} onChange={(value) => updateSchedule("intervalMinutes", value)} />
                                </div>
                                <span className="text-xs text-muted-foreground">{schedule.lastFetchedAt ? t("config.promptSources.lastFetched", { time: formatTime(schedule.lastFetchedAt, i18n.resolvedLanguage) }) : t("config.promptSources.neverScheduled")}</span>
                            </div>
                        ),
                    },
                ]}
            />

            <PromptSourceEditorDrawer open={Boolean(editingSource)} source={editingSource} onSave={handleSave} onClose={() => setEditingSource(null)} />
            <PromptSourceContentModal source={viewingSource} onClose={() => setViewingId("")} />
        </>
    );
}

function formatTime(value: string, locale?: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function intervalKey(value: number) {
    if (value === 30) return "minutes30";
    if (value === 60) return "hour1";
    if (value === 360) return "hours6";
    if (value === 1440) return "hours24";
    return "disabled";
}
