import { Alert, App, Button, Form, Input, Modal, Progress, Select, Tabs } from "antd";
import type { TFunction } from "i18next";
import { BookOpen, Check, Cloud, Database, Download, Info, LibraryBig, Pencil, Plus, RefreshCw, ServerCog, SlidersHorizontal, Trash2, Upload, Wifi } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { ModelPicker } from "@/components/model-picker";
import { ChannelEditorDrawer } from "@/components/layout/channel-editor-drawer";
import { ConfigSectionLayout } from "@/components/layout/config-section-layout";
import { ConfigPromptSources } from "@/components/layout/config-prompt-sources";
import { ConfigLocalStorage } from "@/components/layout/config-local-storage";
import { DOCS_URL, formatAppVersion } from "@/constant/env";
import type { AppLocale } from "@/i18n";
import { exportAppConfig, importAppConfig } from "@/services/config-file";
import { downloadCreativeSkillSyncPackage, syncAppDataToWebdav, type AppSyncDomainKey, type AppSyncProgressEvent } from "@/services/app-sync";
import { testWebdavConnection, WEBDAV_MANIFEST_FILE_NAME } from "@/services/webdav-sync";
import { audioFormatOptions, audioVoiceOptions, normalizeAudioSpeedValue } from "@/lib/audio-generation";
import {
    createModelChannel,
    LAST_CONFIG_SECTION_KEY,
    modelOptionsFromChannels,
    normalizeModelOptionValue,
    readLastConfigSection,
    selectableModelsByCapability,
    useConfigStore,
    type AiConfig,
    type ApiCallFormat,
    type ConfigTabKey,
    type ModelCapability,
    type ModelChannel,
} from "@/stores/use-config-store";
import { useCreativeSkillStore } from "@/stores/use-creative-skill-store";

type ModelGroup = {
    capability: ModelCapability;
    modelKey: "imageModel" | "videoModel" | "textModel" | "audioModel";
    labelKey: string;
};

type WebdavDomainProgress = {
    stage: string;
    current?: number;
    total?: number;
    status?: "active" | "success" | "exception";
};

type WebdavSkillIssue = { kind: "conflict" | "recovery" | "error"; detail?: string };
let retainedWebdavSkillIssue: WebdavSkillIssue | undefined;

const modelGroups: ModelGroup[] = [
    { capability: "image", modelKey: "imageModel", labelKey: "config.preferences.defaultImageModel" },
    { capability: "video", modelKey: "videoModel", labelKey: "config.preferences.defaultVideoModel" },
    { capability: "text", modelKey: "textModel", labelKey: "config.preferences.defaultTextModel" },
    { capability: "audio", modelKey: "audioModel", labelKey: "config.preferences.defaultAudioModel" },
];

const webdavDomainKeys: AppSyncDomainKey[] = ["canvas", "assets", "image-workbench", "video-workbench", "creative-history", "creative-skills", "creative-skill-runs"];
function createWebdavDomainProgress(): Record<AppSyncDomainKey, WebdavDomainProgress> {
    return webdavDomainKeys.reduce(
        (progress, key) => ({
            ...progress,
            [key]: { stage: "等待同步" },
        }),
        {} as Record<AppSyncDomainKey, WebdavDomainProgress>,
    );
}

export function AppConfigPanel({ showDoneButton = false, initialTab, fillHeight = false }: { showDoneButton?: boolean; initialTab?: ConfigTabKey; fillHeight?: boolean }) {
    const { message, modal } = App.useApp();
    const { i18n, t } = useTranslation();
    const navigate = useNavigate();
    const configInputRef = useRef<HTMLInputElement>(null);
    const settingsPanelRef = useRef<HTMLDivElement>(null);
    const saveFeedbackTimerRef = useRef<number | undefined>(undefined);
    const [activeTab, setActiveTab] = useState<ConfigTabKey>(() => {
        const currentConfig = useConfigStore.getState().config;
        const ready = currentConfig.channels.some((channel) => channel.baseUrl.trim() && channel.apiKey.trim() && channel.models.length);
        return ready ? initialTab || readLastConfigSection() : "channels";
    });
    const [showSavedFeedback, setShowSavedFeedback] = useState(false);
    const [editingChannelId, setEditingChannelId] = useState("");
    const [testingWebdav, setTestingWebdav] = useState(false);
    const [syncingWebdav, setSyncingWebdav] = useState(false);
    const [exportingConfig, setExportingConfig] = useState(false);
    const [webdavSyncStatus, setWebdavSyncStatus] = useState("");
    const [webdavDomainProgress, setWebdavDomainProgress] = useState(createWebdavDomainProgress);
    const [webdavSkillIssue, setWebdavSkillIssueState] = useState<WebdavSkillIssue | undefined>(retainedWebdavSkillIssue);
    const [recoveringSkills, setRecoveringSkills] = useState(false);
    const [desktopUpdate, setDesktopUpdate] = useState<DesktopUpdateState | null>(null);
    const config = useConfigStore((state) => state.config);
    const webdav = useConfigStore((state) => state.webdav);
    const storeUpdateConfig = useConfigStore((state) => state.updateConfig);
    const storeUpdateWebdavConfig = useConfigStore((state) => state.updateWebdavConfig);
    const shouldPromptContinue = useConfigStore((state) => state.shouldPromptContinue);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const clearPromptContinue = useConfigStore((state) => state.clearPromptContinue);
    const webdavReady = Boolean(webdav.url.trim());
    const editingChannel = config.channels.find((channel) => channel.id === editingChannelId) || null;
    const readyChannels = config.channels.filter((channel) => channel.baseUrl.trim() && channel.apiKey.trim() && channel.models.length);
    const needsFirstSetup = !readyChannels.length && config.channels.length === 1;
    const availableModelGroups = modelGroups.filter((group) => selectableModelsByCapability(config, group.capability).length);
    const locale = i18n.resolvedLanguage as AppLocale;
    const updateWebdavSkillIssue = (issue?: WebdavSkillIssue) => {
        retainedWebdavSkillIssue = issue;
        setWebdavSkillIssueState(issue);
    };
    useEffect(() => {
        if (initialTab) setActiveTab(initialTab);
    }, [initialTab]);
    useLayoutEffect(() => {
        const contentHolder = settingsPanelRef.current?.querySelector<HTMLElement>(".ant-tabs-content-holder");
        if (contentHolder) contentHolder.scrollTop = 0;
    }, [activeTab]);
    useEffect(() => () => window.clearTimeout(saveFeedbackTimerRef.current), []);
    useEffect(() => {
        const desktop = window.infiniteCanvasDesktop;
        if (!desktop) return;
        void desktop.getUpdateState().then(setDesktopUpdate);
        return desktop.onUpdateState(setDesktopUpdate);
    }, []);

    const markAutoSaved = () => {
        setShowSavedFeedback(true);
        window.clearTimeout(saveFeedbackTimerRef.current);
        saveFeedbackTimerRef.current = window.setTimeout(() => setShowSavedFeedback(false), 1800);
    };

    function updateConfig<K extends keyof AiConfig>(key: K, value: AiConfig[K]) {
        storeUpdateConfig(key, value);
        markAutoSaved();
    }

    function updateWebdavConfig<K extends keyof typeof webdav>(key: K, value: (typeof webdav)[K]) {
        storeUpdateWebdavConfig(key, value);
        markAutoSaved();
    }

    const saveConfig = (nextConfig: AiConfig) => {
        (Object.keys(nextConfig) as Array<keyof AiConfig>).forEach((key) => storeUpdateConfig(key, nextConfig[key]));
        markAutoSaved();
    };

    const changeSection = (section: ConfigTabKey) => {
        setActiveTab(section);
        window.localStorage.setItem(LAST_CONFIG_SECTION_KEY, section);
    };

    const finishConfig = () => {
        const ready = config.channels.some((channel) => channel.baseUrl.trim() && channel.apiKey.trim() && channel.models.length);
        setConfigDialogOpen(false);
        if (!ready) return;
        message.success(t(shouldPromptContinue ? "config.savedContinue" : "config.saved"));
        clearPromptContinue();
    };

    const loadConfigFile = async (file: File) => {
        try {
            await importAppConfig(file);
            message.success(t("config.imported"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.importFailed"));
        } finally {
            if (configInputRef.current) configInputRef.current.value = "";
        }
    };

    const downloadConfigFile = async () => {
        setExportingConfig(true);
        try {
            await exportAppConfig();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.exportFailed"));
        } finally {
            setExportingConfig(false);
        }
    };

    const updateChannels = (channels: ModelChannel[]) => saveConfig(withChannels(config, channels));

    const addChannel = () => {
        const channel = createModelChannel({ name: t("config.channels.numberedName", { count: config.channels.length + 1 }) });
        updateChannels([...config.channels, channel]);
        setEditingChannelId(channel.id);
    };

    const deleteChannel = (id: string) => {
        if (config.channels.length <= 1) {
            message.warning(t("config.channels.keepOne"));
            return;
        }
        const channel = config.channels.find((item) => item.id === id);
        modal.confirm({
            title: t("config.channels.deleteTitle", { name: channel?.name || t("config.channels.unnamed") }),
            content: t("config.channels.deleteDescription"),
            okText: t("common.delete"),
            okButtonProps: { danger: true },
            cancelText: t("common.cancel"),
            onOk: () => updateChannels(config.channels.filter((item) => item.id !== id)),
        });
    };

    const saveChannel = (channel: ModelChannel) => {
        updateChannels(config.channels.map((item) => (item.id === channel.id ? channel : item)));
    };

    const testWebdav = async () => {
        if (!webdavReady) {
            message.error(t("config.webdav.missingUrl"));
            return;
        }
        setTestingWebdav(true);
        try {
            await testWebdavConnection(webdav);
            message.success(t("config.webdav.available"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.webdav.testFailed"));
        } finally {
            setTestingWebdav(false);
        }
    };

    const updateWebdavProgress = (event: AppSyncProgressEvent) => {
        setWebdavSyncStatus(event.stage);
        if (!event.domain) return;
        setWebdavDomainProgress((current) => ({
            ...current,
            [event.domain as AppSyncDomainKey]: {
                stage: event.stage,
                current: event.current,
                total: event.total,
                status: event.status,
            },
        }));
    };

    const syncWebdav = async () => {
        if (!webdavReady) {
            message.error(t("config.webdav.missingUrl"));
            return;
        }
        setSyncingWebdav(true);
        setWebdavDomainProgress(createWebdavDomainProgress());
        updateWebdavSkillIssue(undefined);
        setWebdavSyncStatus(t("config.webdav.preparing"));
        try {
            const result = await syncAppDataToWebdav(webdav, updateWebdavProgress);
            updateWebdavConfig("lastSyncedAt", result.syncedAt);
            const issue = result.skillsConflict
                ? { kind: "conflict" as const }
                : result.skillsRecoveryAvailable
                    ? { kind: "recovery" as const }
                    : result.skillSyncError
                        ? { kind: "error" as const, detail: result.skillSyncError }
                        : undefined;
            updateWebdavSkillIssue(issue);
            const summary = t("config.webdav.completed", { projects: result.projects, assets: result.assets, records: result.imageLogs + result.videoLogs, history: result.creativeHistory, skills: result.creativeSkills, skillRuns: result.creativeSkillRuns, files: result.uploadedFiles, bytes: formatBytes(result.uploadedBytes) });
            if (issue) message.warning(t("config.webdav.completedWithSkillIssue"));
            else message.success(summary);
        } catch (error) {
            setWebdavSyncStatus(error instanceof Error ? error.message : t("config.webdav.failed"));
            message.error(error instanceof Error ? error.message : t("config.webdav.failed"));
        } finally {
            setSyncingWebdav(false);
        }
    };

    const reviewRemoteSkills = async () => {
        if (!webdavReady) return;
        setRecoveringSkills(true);
        try {
            const input = await downloadCreativeSkillSyncPackage(
                webdav,
                webdavSkillIssue?.kind === "conflict" ? "replace-local" : undefined,
            );
            await useCreativeSkillStore.getState().prepareTransfer(input);
            setConfigDialogOpen(false);
            navigate("/skills");
        } catch (error) {
            const detail = error instanceof Error ? error.message : t("config.webdav.skillIssue.prepareFailed");
            updateWebdavSkillIssue({ kind: webdavSkillIssue?.kind === "conflict" ? "conflict" : "recovery", detail });
            message.error(detail);
        } finally {
            setRecoveringSkills(false);
        }
    };

    const runDesktopUpdateAction = async (action: "check" | "download" | "install") => {
        const desktop = window.infiniteCanvasDesktop;
        if (!desktop) return;
        try {
            if (action === "install") {
                await desktop.installUpdate();
                return;
            }
            const state = action === "download" ? await desktop.downloadUpdate() : await desktop.checkForUpdates();
            setDesktopUpdate(state);
            if (state.status === "not-available") message.success(t("desktopUpdate.upToDate"));
            if (state.status === "error") message.error(state.message || t("desktopUpdate.failed"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("desktopUpdate.failed"));
        }
    };

    return (
        <div ref={settingsPanelRef} className={fillHeight ? "flex h-full min-h-0 flex-col" : undefined}>
            <div className="mb-5 shrink-0 lg:hidden">
                <div id="settings-section-selector-label" className="type-label text-muted-foreground">{t("config.sectionSelector")}</div>
                <Select<ConfigTabKey>
                    className="mt-2 w-full"
                    size="large"
                    virtual={false}
                    value={activeTab}
                    aria-labelledby="settings-section-selector-label"
                    onChange={changeSection}
                    options={[
                        { value: "channels", label: t("config.tabs.channels") },
                        { value: "preferences", label: t("config.tabs.preferences") },
                        { value: "sync", label: t("config.tabs.sync") },
                        { value: "storage", label: t("config.tabs.storage") },
                        { value: "prompt-sources", label: t("config.tabs.promptSources") },
                        { value: "about", label: t("config.tabs.about") },
                    ]}
                />
            </div>
            <Tabs
                className={`settings-tabs settings-tabs-responsive${fillHeight ? " settings-tabs-contained min-h-0 flex-1" : ""}`}
                activeKey={activeTab}
                tabPlacement="start"
                tabBarStyle={{ width: 200 }}
                onChange={(key) => changeSection(key as ConfigTabKey)}
                items={[
                    {
                        key: "channels",
                        label: <span className="inline-flex items-center gap-2"><ServerCog className="size-4" />{t("config.tabs.channels")}</span>,
                        children: (
                            <ConfigSectionLayout
                                title={t("config.tabs.channels")}
                                description={t("config.sectionDescriptions.channels")}
                                chapters={[
                                    {
                                        key: "providers",
                                        title: t("config.channels.sectionTitle"),
                                        description: t("config.channels.description"),
                                        action: (
                                            <Button type="primary" icon={<Plus className="size-4" />} onClick={() => (needsFirstSetup ? setEditingChannelId(config.channels[0].id) : addChannel())}>
                                                {t(needsFirstSetup ? "config.channels.start" : "config.channels.add")}
                                            </Button>
                                        ),
                                        content: (
                                            <>
                                                {!readyChannels.length ? (
                                                    <div className="mb-5 rounded-lg border border-border bg-muted/45 px-4 py-3">
                                                        <div className="text-sm font-medium">{t("config.channels.welcomeTitle")}</div>
                                                        <div className="mt-1 text-xs leading-5 text-muted-foreground">{t("config.channels.welcomeDescription")}</div>
                                                    </div>
                                                ) : null}
                                                <div className="space-y-2">
                                                    {config.channels.map((channel) => (
                                                        <div key={channel.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/30 px-4 py-3 transition-colors hover:bg-muted/35">
                                                            <div className="min-w-0">
                                                                <div className="truncate text-sm font-medium">{channel.name || t("config.channels.unnamed")}</div>
                                                                <div className="mt-1 truncate text-xs text-muted-foreground">
                                                                    {apiFormatLabel(channel.apiFormat, t)} · {t("config.channels.modelCount", { count: channel.models.length })} · {channel.baseUrl || t("config.channels.missingUrl")}
                                                                </div>
                                                            </div>
                                                            <div className="flex shrink-0 gap-2">
                                                                <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => setEditingChannelId(channel.id)}>{t("common.edit")}</Button>
                                                                <Button size="small" danger icon={<Trash2 className="size-3.5" />} aria-label={t("config.channels.deleteAction", { name: channel.name || t("config.channels.unnamed") })} title={t("config.channels.deleteAction", { name: channel.name || t("config.channels.unnamed") })} onClick={() => deleteChannel(channel.id)} />
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </>
                                        ),
                                    },
                                ]}
                            />
                        ),
                    },
                    {
                        key: "preferences",
                        label: <span className="inline-flex items-center gap-2"><SlidersHorizontal className="size-4" />{t("config.tabs.preferences")}</span>,
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <ConfigSectionLayout
                                    title={t("config.tabs.preferences")}
                                    description={t("config.sectionDescriptions.preferences")}
                                    aside={(
                                        <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
                                            {showSavedFeedback ? <Check className="size-3.5 text-success" /> : null}
                                            {t(showSavedFeedback ? "config.preferences.autoSaved" : "config.preferences.autoSave")}
                                        </div>
                                    )}
                                    chapters={[
                                        {
                                            key: "default-models",
                                            title: t("config.preferences.defaultModels"),
                                            description: t("config.preferences.defaultModelsDescription"),
                                            content: (
                                                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                                    {availableModelGroups.map((group) => (
                                                        <Form.Item key={group.modelKey} label={t(group.labelKey)} className="mb-0">
                                                            <ModelPicker config={config} value={config[group.modelKey]} onChange={(model) => updateConfig(group.modelKey, model)} capability={group.capability} fullWidth />
                                                        </Form.Item>
                                                    ))}
                                                    {!availableModelGroups.length ? <div className="text-xs leading-5 text-muted-foreground md:col-span-2 xl:col-span-4">{t("config.preferences.noModels")}</div> : null}
                                                </div>
                                            ),
                                        },
                                        {
                                            key: "generation",
                                            title: t("config.preferences.generation"),
                                            description: t("config.preferences.generationDescription"),
                                            content: (
                                                <>
                                                    <div className="grid gap-4 md:grid-cols-4">
                                                        <Form.Item label={t("config.preferences.canvasImageCount")} extra={t("config.preferences.canvasImageCountDescription")} className="mb-4">
                                                            <Input
                                                                type="number"
                                                                min={1}
                                                                max={15}
                                                                value={config.canvasImageCount}
                                                                onChange={(event) => updateConfig("canvasImageCount", event.target.value)}
                                                                onBlur={(event) => updateConfig("canvasImageCount", normalizeImageCount(event.target.value))}
                                                            />
                                                        </Form.Item>
                                                        <Form.Item label={t("config.preferences.audioVoice")} className="mb-4">
                                                            <Select value={config.audioVoice} options={audioVoiceOptions} onChange={(value) => updateConfig("audioVoice", value)} />
                                                        </Form.Item>
                                                        <Form.Item label={t("config.preferences.audioFormat")} className="mb-4">
                                                            <Select value={config.audioFormat} options={audioFormatOptions} onChange={(value) => updateConfig("audioFormat", value)} />
                                                        </Form.Item>
                                                        <Form.Item label={t("config.preferences.audioSpeed")} className="mb-4">
                                                            <Input
                                                                type="number"
                                                                min={0.25}
                                                                max={4}
                                                                step={0.05}
                                                                value={config.audioSpeed}
                                                                onChange={(event) => updateConfig("audioSpeed", event.target.value)}
                                                                onBlur={(event) => updateConfig("audioSpeed", normalizeAudioSpeedValue(event.target.value))}
                                                            />
                                                        </Form.Item>
                                                    </div>
                                                    <Form.Item label={t("config.preferences.audioInstructions")} className="mb-0">
                                                        <Input.TextArea rows={2} value={config.audioInstructions} placeholder={t("config.preferences.audioInstructionsPlaceholder")} onChange={(event) => updateConfig("audioInstructions", event.target.value)} />
                                                    </Form.Item>
                                                </>
                                            ),
                                        },
                                        {
                                            key: "system-prompt",
                                            title: t("config.preferences.systemPrompt"),
                                            description: t("config.preferences.systemPromptDescription"),
                                            content: (
                                                <Form.Item className="mb-0">
                                                    <Input.TextArea aria-label={t("config.preferences.systemPrompt")} rows={4} value={config.systemPrompt} placeholder={t("config.preferences.systemPromptPlaceholder")} onChange={(event) => updateConfig("systemPrompt", event.target.value)} />
                                                </Form.Item>
                                            ),
                                        },
                                    ]}
                                />
                            </Form>
                        ),
                    },
                    {
                        key: "sync",
                        label: <span className="inline-flex items-center gap-2"><Cloud className="size-4" />{t("config.tabs.sync")}</span>,
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <ConfigSectionLayout
                                    title={t("config.tabs.sync")}
                                    description={t("config.sectionDescriptions.sync")}
                                    chapters={[
                                        {
                                            key: "settings-file",
                                            title: t("config.backup.title"),
                                            description: t("config.fileSecurity"),
                                            action: (
                                                <div className="flex flex-wrap gap-2">
                                                    <Button icon={<Upload className="size-4" />} onClick={() => configInputRef.current?.click()}>{t("config.import")}</Button>
                                                    <Button icon={<Download className="size-4" />} loading={exportingConfig} onClick={() => void downloadConfigFile()}>{t("config.export")}</Button>
                                                    <input ref={configInputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => event.target.files?.[0] && void loadConfigFile(event.target.files[0])} />
                                                </div>
                                            ),
                                        },
                                        {
                                            key: "webdav",
                                            title: t("config.webdav.title"),
                                            description: t("config.webdav.description"),
                                            action: <div className="text-xs text-muted-foreground">{webdav.lastSyncedAt ? t("config.webdav.lastSynced", { time: formatWebdavTime(webdav.lastSyncedAt, locale) }) : t("config.webdav.neverSynced")}</div>,
                                            content: (
                                                <div className="rounded-xl bg-muted/30 p-5">
                                                    <div className="grid gap-4 md:grid-cols-2">
                                                        <Form.Item label={t("config.webdav.url")} className="mb-4">
                                                            <Input value={webdav.url} placeholder="https://nas.example.com/webdav" onChange={(event) => updateWebdavConfig("url", event.target.value)} />
                                                        </Form.Item>
                                                        <Form.Item label={t("config.webdav.directory")} extra={t("config.webdav.directoryDescription", { manifest: WEBDAV_MANIFEST_FILE_NAME })} className="mb-4">
                                                            <Input value={webdav.directory} placeholder="infinite-canvas" onChange={(event) => updateWebdavConfig("directory", event.target.value)} />
                                                        </Form.Item>
                                                        <Form.Item label={t("config.webdav.username")} className="mb-0">
                                                            <Input value={webdav.username} autoComplete="username" onChange={(event) => updateWebdavConfig("username", event.target.value)} />
                                                        </Form.Item>
                                                        <Form.Item label={t("config.webdav.password")} className="mb-0">
                                                            <Input.Password value={webdav.password} autoComplete="current-password" onChange={(event) => updateWebdavConfig("password", event.target.value)} />
                                                        </Form.Item>
                                                    </div>
                                                    <div className="mt-4 flex flex-wrap items-center gap-2">
                                                        <Button icon={<Wifi className="size-4" />} disabled={!webdavReady || syncingWebdav} loading={testingWebdav} onClick={() => void testWebdav()}>{t("config.webdav.test")}</Button>
                                                        <Button type="primary" icon={<RefreshCw className="size-4" />} disabled={!webdavReady || testingWebdav} loading={syncingWebdav} onClick={() => void syncWebdav()}>{t(syncingWebdav ? "config.webdav.syncing" : "config.webdav.syncNow")}</Button>
                                                        {webdavSyncStatus ? <span className="text-xs text-muted-foreground">{syncStageLabel(webdavSyncStatus, t)}</span> : null}
                                                    </div>
                                                    {syncingWebdav || webdavSyncStatus ? <WebdavProgressGrid progress={webdavDomainProgress} t={t} /> : null}
                                                    {webdavSkillIssue ? (
                                                        <Alert
                                                            className="mt-3"
                                                            type={webdavSkillIssue.kind === "error" ? "error" : webdavSkillIssue.kind === "conflict" ? "warning" : "info"}
                                                            showIcon
                                                            message={t(`config.webdav.skillIssue.${webdavSkillIssue.kind}Title`)}
                                                            description={<span data-selectable-text>{webdavSkillIssue.detail || t(`config.webdav.skillIssue.${webdavSkillIssue.kind}Description`)}</span>}
                                                            action={webdavSkillIssue.kind !== "error" ? <Button size="small" type="link" loading={recoveringSkills} onClick={() => void reviewRemoteSkills()}>{t("config.webdav.skillIssue.importAction")}</Button> : undefined}
                                                        />
                                                    ) : null}
                                                </div>
                                            ),
                                        },
                                    ]}
                                />
                            </Form>
                        ),
                    },
                    {
                        key: "storage",
                        label: <span className="inline-flex items-center gap-2"><Database className="size-4" />{t("config.tabs.storage")}</span>,
                        children: <ConfigLocalStorage active={activeTab === "storage"} />,
                    },
                    {
                        key: "prompt-sources",
                        label: <span className="inline-flex items-center gap-2"><LibraryBig className="size-4" />{t("config.tabs.promptSources")}</span>,
                        children: <ConfigPromptSources />,
                    },
                    {
                        key: "about",
                        label: <span className="inline-flex items-center gap-2"><Info className="size-4" />{t("config.tabs.about")}</span>,
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <ConfigSectionLayout
                                    title={t("config.tabs.about")}
                                    description={t("config.sectionDescriptions.about")}
                                    chapters={[
                                        {
                                            key: "app-info",
                                            title: t("config.about.appInfo"),
                                            description: t("config.about.appInfoDescription"),
                                            content: (
                                                <div className="rounded-lg border border-border bg-card/30 px-4 py-3">
                                                    <div className="text-sm font-medium">{t("meta.fullTitle")}</div>
                                                    <div className="mt-1 text-xs text-muted-foreground">{t("desktopUpdate.currentVersion", { version: formatAppVersion(desktopUpdate?.currentVersion || __APP_VERSION__) })}</div>
                                                </div>
                                            ),
                                        },
                                        {
                                            key: "desktop-behavior",
                                            title: t("config.about.desktopBehavior"),
                                            description: t("config.preferences.desktopCloseBehaviorDescription"),
                                            hidden: !window.infiniteCanvasDesktop,
                                            content: (
                                                <Form.Item label={t("config.preferences.desktopCloseBehavior")} className="mb-0 max-w-md">
                                                    <Select
                                                        value={config.desktopCloseBehavior}
                                                        options={[
                                                            { value: "tray", label: t("config.preferences.closeToTray") },
                                                            { value: "quit", label: t("config.preferences.closeToQuit") },
                                                        ]}
                                                        onChange={(value) => updateConfig("desktopCloseBehavior", value)}
                                                    />
                                                </Form.Item>
                                            ),
                                        },
                                        {
                                            key: "updates",
                                            title: t("desktopUpdate.settingsTitle"),
                                            description: desktopUpdateStatusLabel(desktopUpdate, t),
                                            hidden: !window.infiniteCanvasDesktop,
                                            action: (
                                                <Button
                                                    icon={desktopUpdate?.status === "available" ? <Download className="size-4" /> : <RefreshCw className="size-4" />}
                                                    loading={desktopUpdate?.status === "checking" || desktopUpdate?.status === "downloading"}
                                                    disabled={desktopUpdate?.status === "unsupported"}
                                                    onClick={() => void runDesktopUpdateAction(desktopUpdate?.status === "available" ? "download" : desktopUpdate?.status === "downloaded" ? "install" : "check")}
                                                >
                                                    {t(desktopUpdate?.status === "available" ? "desktopUpdate.download" : desktopUpdate?.status === "downloaded" ? "desktopUpdate.restartInstall" : "desktopUpdate.check")}
                                                </Button>
                                            ),
                                            content: (
                                                <>
                                                    <div className="grid gap-3 md:grid-cols-2">
                                                        <Form.Item label={t("desktopUpdate.autoCheck")} className="mb-0">
                                                            <Select
                                                                value={config.desktopAutoUpdate ? "on" : "off"}
                                                                options={[
                                                                    { value: "on", label: t("desktopUpdate.autoCheckOn") },
                                                                    { value: "off", label: t("desktopUpdate.autoCheckOff") },
                                                                ]}
                                                                onChange={(value) => updateConfig("desktopAutoUpdate", value === "on")}
                                                            />
                                                        </Form.Item>
                                                        <Form.Item label={t("desktopUpdate.channel")} className="mb-0">
                                                            <Select
                                                                value={config.desktopUpdateChannel}
                                                                options={[
                                                                    { value: "preview", label: t("desktopUpdate.previewChannel") },
                                                                    { value: "stable", label: t("desktopUpdate.stableChannel") },
                                                                ]}
                                                                onChange={(value) => updateConfig("desktopUpdateChannel", value)}
                                                            />
                                                        </Form.Item>
                                                    </div>
                                                    {desktopUpdate?.status === "downloading" ? <Progress className="mt-3" percent={Math.round(desktopUpdate.percent)} size="small" /> : null}
                                                    {desktopUpdate?.status === "error" && desktopUpdate.message ? <div data-selectable-text className="mt-3 break-words text-xs text-destructive">{desktopUpdate.message}</div> : null}
                                                </>
                                            ),
                                        },
                                        {
                                            key: "documentation",
                                            title: t("config.about.documentation"),
                                            description: t("config.about.documentationDescription"),
                                            action: (
                                                <a className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm text-foreground transition-colors hover:bg-muted" href={DOCS_URL} target="_blank" rel="noreferrer">
                                                    <BookOpen className="size-4" />
                                                    {t("topNav.docs")}
                                                </a>
                                            ),
                                            content: (
                                                <div className="rounded-lg border border-border bg-card/30 p-4 text-xs leading-5 text-muted-foreground">
                                                    <div className="font-medium text-foreground/80">{t("config.preferences.aboutSource")}</div>
                                                    <div className="mt-1">
                                                        {t("config.preferences.aboutSourceDescription")} {" "}
                                                        <a className="underline decoration-border underline-offset-2 transition-colors hover:text-foreground" href="https://github.com/basketikun/infinite-canvas" target="_blank" rel="noreferrer">basketikun/infinite-canvas</a>
                                                    </div>
                                                </div>
                                            ),
                                        },
                                    ]}
                                />
                            </Form>
                        ),
                    },
                ]}
            />
            {showDoneButton ? (
                <div className="mt-4 flex shrink-0 justify-end">
                    <Button type="primary" onClick={finishConfig}>
                        {t("common.done")}
                    </Button>
                </div>
            ) : null}
            <ChannelEditorDrawer open={Boolean(editingChannel)} channel={editingChannel} onSave={saveChannel} onClose={() => setEditingChannelId("")} />
        </div>
    );
}

export function AppConfigModal({ onAfterClose }: { onAfterClose?: () => void } = {}) {
    const { t } = useTranslation();
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const configTab = useConfigStore((state) => state.configTab);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    return (
        <Modal
            title={
                <div>
                    <div className="type-section-title">{t("config.title")}</div>
                    <div className="mt-1 text-xs font-normal text-muted-foreground">{t("config.modalDescription")}</div>
                </div>
            }
            open={isConfigOpen}
            width={1060}
            centered
            onCancel={() => setConfigDialogOpen(false)}
            afterOpenChange={(open) => {
                if (!open) onAfterClose?.();
            }}
            styles={{ body: { height: "min(72vh, 760px)", overflow: "hidden" } }}
            footer={null}
        >
            <AppConfigPanel key={`${isConfigOpen ? "open" : "closed"}-${configTab}`} showDoneButton initialTab={configTab} fillHeight />
        </Modal>
    );
}

function withChannels(config: AiConfig, channels: ModelChannel[]): AiConfig {
    const next: AiConfig = {
        ...config,
        channels,
        models: modelOptionsFromChannels(channels),
        baseUrl: channels[0]?.baseUrl || config.baseUrl,
        apiKey: channels[0]?.apiKey || config.apiKey,
        apiFormat: channels[0]?.apiFormat || config.apiFormat,
    };
    return {
        ...next,
        imageModel: pickDefaultModel(next, "image", config.imageModel),
        videoModel: pickDefaultModel(next, "video", config.videoModel),
        textModel: pickDefaultModel(next, "text", config.textModel),
        audioModel: pickDefaultModel(next, "audio", config.audioModel),
    };
}

function pickDefaultModel(config: AiConfig, capability: ModelCapability, current: string) {
    const options = selectableModelsByCapability(config, capability);
    const normalized = normalizeModelOptionValue(current, config.channels);
    return options.includes(normalized) ? normalized : options[0] || "";
}

function normalizeImageCount(value: string) {
    return String(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || 3))));
}

function apiFormatLabel(apiFormat: ApiCallFormat, t: TFunction) {
    if (apiFormat === "gemini") return "Gemini";
    if (apiFormat === "ark") return t("config.protocols.ark");
    return "OpenAI";
}

function formatWebdavTime(value: string, locale: AppLocale) {
    return new Date(value).toLocaleString(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function desktopUpdateStatusLabel(state: DesktopUpdateState | null, t: TFunction) {
    if (!state) return t("desktopUpdate.status.idle");
    if (state.status === "available") return t("desktopUpdate.status.available", { version: formatAppVersion(state.availableVersion) });
    if (state.status === "downloaded") return t("desktopUpdate.status.downloaded", { version: formatAppVersion(state.availableVersion) });
    if (state.status === "downloading") return t("desktopUpdate.status.downloading", { percent: Math.round(state.percent) });
    if (state.status === "error" || state.status === "unsupported") return state.message || t(`desktopUpdate.status.${state.status}`);
    return t(`desktopUpdate.status.${state.status}`);
}

function WebdavProgressGrid({ progress, t }: { progress: Record<AppSyncDomainKey, WebdavDomainProgress>; t: TFunction }) {
    return (
        <div className="mt-3 grid gap-2">
            {webdavDomainKeys.map((key) => {
                const item = progress[key];
                const count = item.total ? `${item.current || 0}/${item.total}` : "";
                return (
                    <div key={key} className="rounded-md border border-border bg-background/45 px-3 py-2">
                        <div className="mb-1 flex min-w-0 items-center justify-between gap-3 text-xs">
                            <span className="shrink-0 font-medium text-foreground/80">{t(`config.webdav.domains.${domainTranslationKey(key)}`)}</span>
                            <span className="min-w-0 truncate text-right text-muted-foreground">
                                {syncStageLabel(item.stage, t)}
                                {count ? <span className="type-numeric text-xs"> · {count}</span> : null}
                            </span>
                        </div>
                        <Progress percent={getWebdavProgressPercent(item)} size="small" status={getWebdavProgressStatus(item)} showInfo={false} />
                    </div>
                );
            })}
        </div>
    );
}

function domainTranslationKey(domain: AppSyncDomainKey) {
    if (domain === "image-workbench") return "imageWorkbench";
    if (domain === "video-workbench") return "videoWorkbench";
    if (domain === "creative-history") return "creativeHistory";
    if (domain === "creative-skills") return "creativeSkills";
    if (domain === "creative-skill-runs") return "creativeSkillRuns";
    return domain;
}

function syncStageLabel(stage: string, t: TFunction) {
    if (stage === "等待本地数据加载") return t("config.webdav.stages.localWaiting");
    if (stage === "同步完成") return t("config.webdav.stages.syncComplete");
    if (stage === "等待同步") return t("config.webdav.stages.waiting");
    if (stage === "读取远端清单") return t("config.webdav.stages.remoteManifest");
    if (stage === "读取本地数据") return t("config.webdav.stages.localData");
    if (stage === "下载缺失媒体") return t("config.webdav.stages.downloadMedia");
    if (stage === "写入本地合并结果") return t("config.webdav.stages.writeMerge");
    if (stage === "上传新增媒体") return t("config.webdav.stages.uploadMedia");
    if (stage === "媒体已齐全") return t("config.webdav.stages.mediaReady");
    if (stage === "媒体无需上传") return t("config.webdav.stages.mediaSkipped");
    if (stage === "检测到资料库冲突") return t("config.webdav.stages.skillsConflict");
    if (stage === "内容已一致") return t("config.webdav.stages.contentCurrent");
    if (stage === "保留远端备份") return t("config.webdav.stages.remoteBackupKept");
    if (stage === "检查缺失媒体") return t("config.webdav.stages.checkMissingMedia");
    if (stage === "下载媒体") return t("config.webdav.stages.downloadMediaFile");
    if (stage === "检查本地媒体") return t("config.webdav.stages.checkLocalMedia");
    if (stage.startsWith("上传媒体 ")) return t("config.webdav.stages.uploadMediaFile", { size: stage.slice(5) });
    if (stage === "完成") return t("config.webdav.stages.complete");
    if (stage.startsWith("上传清单 ")) return t("config.webdav.stages.uploadManifest", { size: stage.slice(5) });
    return stage;
}

function getWebdavProgressPercent(item: WebdavDomainProgress) {
    if (item.status === "success") return 100;
    if (item.total) return Math.min(100, Math.round(((item.current || 0) / item.total) * 100));
    if (item.status === "exception") return 100;
    if (item.stage === "等待同步") return 0;
    if (item.stage === "读取远端清单") return 12;
    if (item.stage === "读取本地数据") return 24;
    if (item.stage === "下载缺失媒体") return 36;
    if (item.stage === "写入本地合并结果") return 58;
    if (item.stage === "上传新增媒体") return 66;
    if (item.stage === "媒体已齐全" || item.stage === "媒体无需上传") return 74;
    if (item.stage.startsWith("上传清单")) return 90;
    return item.status === "active" ? 30 : 0;
}

function getWebdavProgressStatus(item: WebdavDomainProgress): "normal" | "active" | "success" | "exception" {
    if (item.status === "success" || item.status === "exception") return item.status;
    return item.status === "active" ? "active" : "normal";
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
