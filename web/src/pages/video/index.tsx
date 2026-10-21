import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, CheckSquare, CircleX, ClipboardPaste, Download, FolderPlus, History, LoaderCircle, Music2, PanelLeftClose, PanelLeftOpen, Plus, Search, SlidersHorizontal, Sparkles, Trash2, Upload, VideoIcon } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { App, Button, Checkbox, Drawer, Empty, Input, Modal, Tooltip, Typography, theme as antdTheme } from "antd";
import { nanoid } from "nanoid";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { ModelPicker } from "@/components/model-picker";
import { PromptSelectDialog } from "@/components/prompts/prompt-select-dialog";
import { VideoSettingsPanel, normalizeVideoResolutionValue, normalizeVideoSizeValue, videoResolutionLabel, videoSecondsLabel, videoSizeLabel } from "@/components/video-settings-panel";
import { useContainerBreakpoint } from "@/hooks/use-container-breakpoint";
import { canvasThemes } from "@/lib/canvas-theme";
import { formatBytes, formatDuration } from "@/lib/image-utils";
import { cn } from "@/lib/utils";
import { apimartVideoPolicy, normalizeApimartVideoDuration, normalizeApimartVideoRatio, normalizeApimartVideoResolution, type ApimartVideoPolicy } from "@/lib/apimart-models";
import { boolConfig, isApimartVideoConfig, isSeedanceVideoConfig, normalizeSeedanceRatio, seedanceReferenceLabel, seedanceVideoReferenceError, seedanceVideoReferenceHint, SEEDANCE_REFERENCE_LIMITS, SEEDANCE_VIDEO_MIME_TYPES } from "@/lib/seedance-video";
import { resolveMediaUrl, uploadMediaFile } from "@/services/file-storage";
import { resolveImageUrl, uploadImage } from "@/services/image-storage";
import { createVideoGenerationTask, pollVideoGenerationTask, storeGeneratedVideo, type VideoGenerationTask } from "@/services/api/video";
import { useAssetStore } from "@/stores/use-asset-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import { modelOptionLabel, useConfigStore, useEffectiveConfig, type AiConfig, type ConfigTabKey } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useVideoWorkbenchStore, type GeneratedWorkbenchVideo as GeneratedVideo, type VideoWorkbenchResult as GenerationResult } from "@/stores/use-video-workbench-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import i18n from "@/i18n";
import { createGenerationLogStore, runGenerationLogOperation } from "@/services/generation-log-store";
import { notifyTaskCompletion } from "@/lib/task-completion-notification";
import { usePointerHalo, type PointerHaloController } from "@/hooks/use-pointer-halo";
import { moveGenerationRecordsToTrash } from "@/services/generation-trash";
import { preferredGenerationLog } from "@/lib/generation-log-merge";
import { recordCreativeHistory } from "@/services/creative-activity";

type GenerationLog = {
    id: string;
    createdAt: number;
    title: string;
    prompt: string;
    time: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    videoReferences: ReferenceVideo[];
    audioReferences: ReferenceAudio[];
    durationMs: number;
    size: string;
    resolution: string;
    seconds: string;
    status: "pending" | "success" | "failed";
    task?: VideoGenerationTask;
    video?: GeneratedVideo;
    error?: string;
    updatedAt?: number;
    trashedAt?: number;
    purgedAt?: number;
    formerOutputStorageKeys?: string[];
};

type GenerationLogConfig = Pick<AiConfig, "model" | "videoModel" | "size" | "vquality" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoPromptOptimizer" | "videoFastPretreatment" | "videoSeed" | "videoReturnLastFrame" | "videoOutputFormat">;

type UpdateAiConfig = <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;

const LOG_STORE_KEY = "infinite-canvas:video_generation_logs";
const VIDEO_LOGS_UPDATED_EVENT = "infinite-canvas:video-generation-logs-updated";
const logStore = createGenerationLogStore<GenerationLog>("video_generation_logs");
const activeVideoLogIds = new Set<string>();

export default function VideoPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [searchParams, setSearchParams] = useSearchParams();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragDepthRef = useRef(0);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const prompt = useVideoWorkbenchStore((state) => state.prompt);
    const references = useVideoWorkbenchStore((state) => state.references);
    const videoReferences = useVideoWorkbenchStore((state) => state.videoReferences);
    const audioReferences = useVideoWorkbenchStore((state) => state.audioReferences);
    const results = useVideoWorkbenchStore((state) => state.results);
    const running = useVideoWorkbenchStore((state) => state.running);
    const activeLogId = useVideoWorkbenchStore((state) => state.activeLogId);
    const startedAt = useVideoWorkbenchStore((state) => state.startedAt);
    const elapsedMs = useVideoWorkbenchStore((state) => state.elapsedMs);
    const setPrompt = useVideoWorkbenchStore((state) => state.setPrompt);
    const setReferences = useVideoWorkbenchStore((state) => state.setReferences);
    const setVideoReferences = useVideoWorkbenchStore((state) => state.setVideoReferences);
    const setAudioReferences = useVideoWorkbenchStore((state) => state.setAudioReferences);
    const setResults = useVideoWorkbenchStore((state) => state.setResults);
    const setRunning = useVideoWorkbenchStore((state) => state.setRunning);
    const setActiveLogId = useVideoWorkbenchStore((state) => state.setActiveLogId);
    const setStartedAt = useVideoWorkbenchStore((state) => state.setStartedAt);
    const setElapsedMs = useVideoWorkbenchStore((state) => state.setElapsedMs);
    const resetWorkbench = useVideoWorkbenchStore((state) => state.reset);
    const [logs, setLogs] = useState<GenerationLog[]>([]);
    const [logsOpen, setLogsOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [settingsCollapsed, setSettingsCollapsed] = useState(false);
    const [workspaceView, setWorkspaceView] = useState<"results" | "logs">("results");
    const [promptDialogOpen, setPromptDialogOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
    const [previewLog, setPreviewLog] = useState<GenerationLog | null>(null);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [referenceDragTarget, setReferenceDragTarget] = useState<"image" | "video" | "audio" | null>(null);
    const [autoRunToken, setAutoRunToken] = useState(0);
    const videoCommand = useWorkbenchAgentStore((state) => state.videoCommand);
    const clearVideoCommand = useWorkbenchAgentStore((state) => state.clearVideoCommand);
    const updateAgentTask = useWorkbenchAgentStore((state) => state.updateTask);
    const processedCommandRef = useRef(0);
    const agentTaskIdRef = useRef<string | undefined>(undefined);
    const instanceIdRef = useRef(nanoid());
    const logsSyncVersionRef = useRef(0);
    const mountedRef = useRef(false);
    const [workspaceRef, compactLayout] = useContainerBreakpoint<HTMLDivElement>(960);

    const model = effectiveConfig.videoModel || effectiveConfig.model;
    const apimartPolicy = isApimartVideoConfig({ ...effectiveConfig, model }) ? apimartVideoPolicy(model, { prompt, imageCount: references.length, videoCount: videoReferences.length, audioCount: audioReferences.length, resolution: effectiveConfig.vquality }) : null;
    const referenceLimits = apimartPolicy?.limits || SEEDANCE_REFERENCE_LIMITS;
    const canGenerate = Boolean(prompt.trim());
    const effectiveSettingsCollapsed = !compactLayout && settingsCollapsed;
    const activeLog = logs.find((log) => log.id === activeLogId);
    const activeGenerating = running && (!activeLog || activeLog.status === "pending");
    const activeElapsedMs = activeLog?.status === "pending" ? Math.max(0, Date.now() - activeLog.createdAt) : activeLog?.durationMs ?? elapsedMs;
    const visibleResults = previewLog ? videoResultsFromLog(previewLog) : results;
    const selectedDeletableLogIds = selectedLogIds.filter((id) => logs.some((log) => log.id === id && log.status !== "pending" && !activeVideoLogIds.has(log.id)));

    useEffect(() => {
        if (!running || !startedAt) return;
        const timer = window.setInterval(() => setElapsedMs(performance.now() - startedAt), 1000);
        return () => window.clearInterval(timer);
    }, [running, startedAt]);

    useEffect(() => {
        mountedRef.current = true;
        const handleLogsUpdated = (event: Event) => {
            if ((event as CustomEvent<string>).detail === instanceIdRef.current) return;
            void refreshLogs(false);
        };
        window.addEventListener(VIDEO_LOGS_UPDATED_EVENT, handleLogsUpdated);
        void refreshLogs(!useVideoWorkbenchStore.getState().running);
        return () => {
            mountedRef.current = false;
            window.removeEventListener(VIDEO_LOGS_UPDATED_EVENT, handleLogsUpdated);
        };
    }, []);

    const addReferences = async (files?: FileList | null) => {
        const selectedFiles = Array.from(files || []);
        const unsupported = selectedFiles.filter((file) => !file.type.startsWith("image/") && !SEEDANCE_VIDEO_MIME_TYPES.includes(file.type) && !isSupportedAudioFile(file));
        if (unsupported.length) message.warning(t("videoWorkbench.unsupportedFiles"));
        const imageFiles = selectedFiles.filter((file) => file.type.startsWith("image/") && file.size <= referenceLimits.imageMaxBytes).slice(0, Math.max(0, referenceLimits.images - references.length));
        const videoFiles = selectedFiles.filter((file) => SEEDANCE_VIDEO_MIME_TYPES.includes(file.type) && file.size <= referenceLimits.videoMaxBytes).slice(0, Math.max(0, referenceLimits.videos - videoReferences.length));
        const audioFiles = selectedFiles.filter((file) => isSupportedAudioFile(file) && file.size <= referenceLimits.audioMaxBytes).slice(0, Math.max(0, referenceLimits.audios - audioReferences.length));
        if (selectedFiles.some((file) => file.type.startsWith("image/") && file.size > referenceLimits.imageMaxBytes)) message.warning(apimartPolicy ? t("apiErrors.apimartImageTooLarge", { limit: bytesToMb(referenceLimits.imageMaxBytes) }) : t("videoWorkbench.imageTooLarge"));
        if (selectedFiles.some((file) => SEEDANCE_VIDEO_MIME_TYPES.includes(file.type) && file.size > referenceLimits.videoMaxBytes)) message.warning(apimartPolicy ? t("apiErrors.apimartVideoTooLarge", { limit: bytesToMb(referenceLimits.videoMaxBytes) }) : t("videoWorkbench.videoTooLarge"));
        if (selectedFiles.some((file) => isSupportedAudioFile(file) && file.size > referenceLimits.audioMaxBytes)) message.warning(apimartPolicy ? t("apiErrors.apimartAudioTooLarge", { limit: bytesToMb(referenceLimits.audioMaxBytes) }) : t("videoWorkbench.audioTooLarge"));
        if (apimartPolicy && !apimartPolicy.limits.videos && selectedFiles.some((file) => SEEDANCE_VIDEO_MIME_TYPES.includes(file.type))) message.warning(t("apiErrors.apimartVideoReferenceUnsupported"));
        if (apimartPolicy && !apimartPolicy.limits.audios && selectedFiles.some((file) => isSupportedAudioFile(file))) message.warning(t("apiErrors.apimartAudioReferenceUnsupported"));
        const nextReferences = await Promise.all(
            imageFiles.map(async (file) => {
                const image = await uploadImage(file);
                return { id: nanoid(), name: file.name, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
            }),
        );
        const nextVideoReferences = await Promise.all(
            videoFiles.map(async (file) => {
                const video = await uploadMediaFile(file, "video-reference");
                return { id: nanoid(), name: file.name, type: video.mimeType, url: video.url, storageKey: video.storageKey, bytes: video.bytes, width: video.width, height: video.height, durationMs: video.durationMs };
            }),
        );
        const nextAudioReferences = filterAudioReferencesByDuration(
            audioReferences,
            await Promise.all(
                audioFiles.map(async (file) => {
                    const audio = await uploadMediaFile(file, "audio-reference");
                    return { id: nanoid(), name: file.name, type: audio.mimeType, url: audio.url, storageKey: audio.storageKey, durationMs: audio.durationMs };
                }),
            ),
            message.warning,
            "maxReferenceSeconds" in referenceLimits && typeof referenceLimits.maxReferenceSeconds === "number" ? referenceLimits.maxReferenceSeconds : 15,
        );
        setReferences((value) => appendUniqueReferences(value, nextReferences, referenceLimits.images));
        setVideoReferences((value) => appendUniqueReferences(value, nextVideoReferences, referenceLimits.videos));
        setAudioReferences((value) => appendUniqueReferences(value, nextAudioReferences, referenceLimits.audios));
    };

    const handleReferenceDragEnter = (event: DragEvent<HTMLDivElement>, target: "image" | "video" | "audio") => {
        event.preventDefault();
        dragDepthRef.current += 1;
        if (event.dataTransfer.types.includes("Files")) setReferenceDragTarget(target);
    };

    const handleReferenceDragLeave = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (!dragDepthRef.current) setReferenceDragTarget(null);
    };

    const handleReferenceDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        dragDepthRef.current = 0;
        setReferenceDragTarget(null);
        void addReferences(event.dataTransfer.files);
    };

    const addReferencesFromClipboard = async () => {
        try {
            const items = await navigator.clipboard.read();
            const blobs = await Promise.all(items.flatMap((item) => item.types.filter((type) => type.startsWith("image/")).map((type) => item.getType(type))));
            if (!blobs.length) {
                message.error(t("videoWorkbench.clipboardEmpty"));
                return;
            }
            const nextReferences = await Promise.all(
                blobs.slice(0, Math.max(0, referenceLimits.images - references.length)).map(async (blob, index) => {
                    const image = await uploadImage(blob);
                    return { id: nanoid(), name: `clipboard-${index + 1}.png`, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
                }),
            );
            setReferences((value) => appendUniqueReferences(value, nextReferences, referenceLimits.images));
            message.success(t("videoWorkbench.clipboardAdded", { count: nextReferences.length }));
        } catch {
            message.error(t("videoWorkbench.clipboardEmpty"));
        }
    };
    const generate = async () => {
        if (useVideoWorkbenchStore.getState().running) return;
        const agentTaskId = agentTaskIdRef.current;
        agentTaskIdRef.current = undefined;
        const snapshot = buildRequestSnapshot();
        if (!snapshot) {
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: t("videoWorkbench.invalidParams") });
            return;
        }
        setElapsedMs(0);
        setRunning(true);
        if (agentTaskId) updateAgentTask(agentTaskId, { status: "running", error: undefined });
        setPreviewLog(null);
        setResults([{ id: nanoid(), status: "pending" }]);
        const batchStartedAt = performance.now();
        setStartedAt(batchStartedAt);
        let claimedLogId: string | undefined;
        try {
            const task = await createVideoGenerationTask(snapshot.config, snapshot.text, snapshot.references, snapshot.videoReferences, snapshot.audioReferences);
            const log = buildLog({ prompt: snapshot.text, model, config: snapshot.config, references: snapshot.references, videoReferences: snapshot.videoReferences, audioReferences: snapshot.audioReferences, durationMs: 0, status: "pending", task });
            claimedLogId = log.id;
            setActiveLogId(log.id);
            activeVideoLogIds.add(log.id);
            await saveLogSafely(log);
            void pollGenerationLog(log, snapshot.config, agentTaskId, true);
        } catch (error) {
            if (claimedLogId) activeVideoLogIds.delete(claimedLogId);
            const errorMessage = error instanceof Error ? error.message : t("workbench.generationFailed");
            setResults([{ id: nanoid(), status: "failed", error: errorMessage }]);
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", successCount: 0, failCount: 1, error: errorMessage });
            await saveLogSafely(buildLog({ prompt: snapshot.text, model, config: snapshot.config, references: snapshot.references, videoReferences: snapshot.videoReferences, audioReferences: snapshot.audioReferences, durationMs: performance.now() - batchStartedAt, status: "failed", error: errorMessage }));
            message.error(errorMessage);
            setRunning(false);
            setStartedAt(0);
        }
    };

    // Handle video-generation commands from the Agent panel by setting the prompt and optionally starting generation.
    useEffect(() => {
        if (!videoCommand || videoCommand.nonce === processedCommandRef.current) return;
        processedCommandRef.current = videoCommand.nonce;
        clearVideoCommand();
        if (typeof videoCommand.prompt === "string") setPrompt(videoCommand.prompt);
        if (videoCommand.run && running) {
            if (videoCommand.taskId) updateAgentTask(videoCommand.taskId, { status: "failed", error: t("videoWorkbench.busy") });
            return;
        }
        if (videoCommand.run) {
            agentTaskIdRef.current = videoCommand.taskId;
            setAutoRunToken((value) => value + 1);
        }
    }, [videoCommand, clearVideoCommand, running, updateAgentTask]);

    useEffect(() => {
        if (!autoRunToken) return;
        void generate();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoRunToken]);

    const buildRequestSnapshot = () => {
        const text = prompt.trim();
        if (!text) {
            message.error(t("videoWorkbench.promptRequired"));
            return null;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning(t("workbench.configFirst"));
            openConfigDialog(true);
            return null;
        }
        if (apimartPolicy && videoReferences.length && !apimartPolicy.limits.videos) {
            message.error(t("apiErrors.apimartVideoReferenceUnsupported"));
            return null;
        }
        if (apimartPolicy && audioReferences.length && !apimartPolicy.limits.audios) {
            message.error(t("apiErrors.apimartAudioReferenceUnsupported"));
            return null;
        }
        const policyIssue = apimartPolicy?.issues[0];
        if (policyIssue) {
            message.error(t(`apiErrors.${policyIssue.code}`, { limit: policyIssue.limit }));
            return null;
        }
        if (apimartPolicy && videoReferences.some((video) => video.bytes && video.bytes > apimartPolicy.limits.videoMaxBytes)) {
            message.error(t("apiErrors.apimartVideoTooLarge", { limit: bytesToMb(apimartPolicy.limits.videoMaxBytes) }));
            return null;
        }
        const videoReferenceError = referenceLimits.videos ? seedanceVideoReferenceError(videoReferences, apimartPolicy?.limits.maxReferenceSeconds || 15) : "";
        if (videoReferenceError) {
            message.error(t("videoWorkbench.referenceError", { error: videoReferenceError, hint: seedanceVideoReferenceHint() }));
            return null;
        }
        return { text, config: buildVideoConfig(effectiveConfig, model, apimartPolicy), references: [...references], videoReferences: [...videoReferences], audioReferences: [...audioReferences] };
    };

    const retryResult = () => {
        void generate();
    };

    const downloadVideo = (video: GeneratedVideo) => {
        saveAs(video.url, "video.mp4");
    };

    const saveResultToAssets = (video: GeneratedVideo) => {
        addAsset({
            kind: "video",
            title: t("videoWorkbench.resultTitle"),
            coverUrl: "",
            tags: [],
            source: t("videoWorkbench.source"),
            data: { url: video.url, storageKey: video.storageKey, width: video.width, height: video.height, bytes: video.bytes, mimeType: video.mimeType },
            metadata: { source: "video-page", prompt },
        });
        message.success(t("common.addedToAssets"));
    };

    const insertPickedAsset = async (payload: InsertAssetPayload) => {
        if (payload.kind === "text") {
            setPrompt(payload.content);
        } else if (payload.kind === "image") {
            const stored = await uploadImage(payload.dataUrl);
            setReferences((value) => [...value, { id: nanoid(), name: payload.title, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }].slice(0, referenceLimits.images));
        } else if (payload.kind === "video") {
            if (payload.bytes && payload.bytes > referenceLimits.videoMaxBytes) message.warning(apimartPolicy ? t("apiErrors.apimartVideoTooLarge", { limit: bytesToMb(referenceLimits.videoMaxBytes) }) : t("videoWorkbench.videoTooLarge"));
            else setVideoReferences((value) => [...value, { id: nanoid(), name: payload.title, type: payload.mimeType || "video/mp4", url: payload.url, storageKey: payload.storageKey, width: payload.width, height: payload.height, bytes: payload.bytes }].slice(0, referenceLimits.videos));
        }
        setAssetPickerOpen(false);
    };

    const createSession = () => {
        if (useVideoWorkbenchStore.getState().running) return;
        resetWorkbench();
        setSelectedLogIds([]);
        setPreviewLog(null);
        setWorkspaceView("results");
        setSettingsCollapsed(false);
        setLogsOpen(false);
    };

    const deleteSelectedLogs = async () => {
        const deletableIds = selectedLogIds.filter((id) => logs.some((log) => log.id === id && log.status !== "pending" && !activeVideoLogIds.has(log.id)));
        if (!deletableIds.length) {
            setSelectedLogIds([]);
            setDeleteConfirmOpen(false);
            return;
        }
        try {
            const result = await moveGenerationRecordsToTrash(deletableIds.map((id) => ({ kind: "video" as const, id })));
            const movedIds = new Set(result.movedRefs.map((ref) => ref.id));
            if (previewLog && movedIds.has(previewLog.id)) {
                setPreviewLog(null);
                if (!running) setResults([]);
            }
            if (!running && movedIds.has(activeLogId)) {
                setActiveLogId("");
                setResults([]);
            }
            setSelectedLogIds([]);
            setDeleteConfirmOpen(false);
            await refreshLogs();
            message.success(t("workbench.movedToTrash", { count: result.moved }));
        } catch {
            message.error(t("workbench.moveToTrashFailed"));
        }
    };

    const saveLog = async (log: GenerationLog) => {
        const persistedLog = serializeLog({ ...log, updatedAt: Date.now() });
        await runGenerationLogOperation(async () => {
            try {
                await logStore.setItem(log.id, persistedLog);
            } catch (error) {
                logStore.retainVolatileItem(log.id, persistedLog);
                throw error;
            }
        });
        if (persistedLog.status === "success" || persistedLog.status === "failed") {
            await recordCreativeHistory({
                eventId: `video:${persistedLog.id}`,
                occurredAt: persistedLog.createdAt,
                category: "video",
                source: "workbench",
                operation: persistedLog.references.length || persistedLog.videoReferences.length || persistedLog.audioReferences.length ? "edit" : "generate",
                status: persistedLog.status === "success" ? "success" : "failed",
                model: persistedLog.model,
                size: persistedLog.size,
                resolution: persistedLog.resolution,
                durationSeconds: Number(persistedLog.seconds) || undefined,
                requestedCount: 1,
                successCount: persistedLog.status === "success" ? 1 : 0,
                failureCount: persistedLog.status === "failed" ? 1 : 0,
                canceledCount: 0,
            });
        }
        await refreshLogs(false);
        window.dispatchEvent(new CustomEvent(VIDEO_LOGS_UPDATED_EVENT, { detail: instanceIdRef.current }));
    };

    const saveLogSafely = async (log: GenerationLog) => {
        try {
            await saveLog(log);
        } catch {
            await refreshLogs(false);
            window.dispatchEvent(new CustomEvent(VIDEO_LOGS_UPDATED_EVENT, { detail: instanceIdRef.current }));
            message.warning(t("videoWorkbench.logSaveFailed"));
        }
    };

    const refreshLogs = async (resumePending = false) => {
        const syncVersion = ++logsSyncVersionRef.current;
        const nextLogs = await readStoredLogs();
        if (!mountedRef.current || syncVersion !== logsSyncVersionRef.current) return nextLogs;
        setLogs(nextLogs);
        if (resumePending) resumePendingLogs(nextLogs);
        return nextLogs;
    };

    const resumePendingLogs = (items: GenerationLog[]) => {
        const firstPending = items.find((log) => log.status === "pending" && log.task);
        if (firstPending && !useVideoWorkbenchStore.getState().activeLogId) setActiveLogId(firstPending.id);
        for (const log of items) {
            if (log.status === "pending" && log.task) void pollGenerationLog(log);
        }
    };

    const pollGenerationLog = async (log: GenerationLog, configOverride?: AiConfig, agentTaskId?: string, claimed = false) => {
        if (!log.task) return;
        setRunning(true);
        setStartedAt((value) => value || performance.now());
        if (!useVideoWorkbenchStore.getState().activeLogId) setActiveLogId(log.id);
        if (useVideoWorkbenchStore.getState().activeLogId === log.id) setResults((value) => (value.length ? value : [{ id: log.id, status: "pending" }]));
        if (!claimed) {
            if (activeVideoLogIds.has(log.id)) return;
            activeVideoLogIds.add(log.id);
        }
        const taskModel = log.task.model || log.model;
        const storedConfig = { ...effectiveConfig, ...log.config };
        const taskPolicy = log.task.provider === "apimart" ? apimartVideoPolicy(taskModel, { prompt: log.prompt, imageCount: log.references.length, videoCount: log.videoReferences.length, audioCount: log.audioReferences.length, resolution: storedConfig.vquality }) : null;
        const taskConfig = buildVideoConfig(storedConfig, taskModel, taskPolicy);
        try {
            const maxAttempts = log.task.provider === "apimart" ? 180 : 120;
            for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
                const state = await pollVideoGenerationTask(configOverride || taskConfig, log.task);
                if (state.status === "completed") {
                    const stored = await storeGeneratedVideo(state.result);
                    const nextVideo: GeneratedVideo = {
                        id: nanoid(),
                        url: stored.url,
                        storageKey: stored.storageKey,
                        durationMs: Date.now() - log.createdAt,
                        width: stored.width || 1280,
                        height: stored.height || 720,
                        bytes: stored.bytes,
                        mimeType: stored.mimeType,
                    };
                    if (useVideoWorkbenchStore.getState().activeLogId === log.id) setResults([{ id: nextVideo.id, status: "success", video: nextVideo }]);
                    if (agentTaskId) updateAgentTask(agentTaskId, { status: "succeeded", successCount: 1, failCount: 0, error: undefined });
                    await saveLogSafely({ ...log, status: "success", durationMs: nextVideo.durationMs, video: nextVideo, error: undefined });
                    notifyTaskCompletion({
                        id: `video:${log.id}`,
                        title: t("taskNotifications.videoTitle"),
                        body: t("taskNotifications.videoDescription"),
                        route: `/video?result=${encodeURIComponent(log.id)}`,
                    });
                    return;
                }
                if (state.status === "failed") throw new Error(state.error);
                if (attempt === maxAttempts - 1) throw new Error(t("videoWorkbench.timeout"));
                await delay(log.task.provider === "seedance" || log.task.provider === "apimart" ? 5000 : 2500);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : t("workbench.generationFailed");
            if (useVideoWorkbenchStore.getState().activeLogId === log.id) setResults([{ id: log.id, status: "failed", error: errorMessage }]);
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", successCount: 0, failCount: 1, error: errorMessage });
            await saveLogSafely({ ...log, status: "failed", durationMs: Date.now() - log.createdAt, error: errorMessage });
            message.error(errorMessage);
        } finally {
            activeVideoLogIds.delete(log.id);
            if (!activeVideoLogIds.size) {
                setRunning(false);
                setStartedAt(0);
            }
        }
    };

    const previewGenerationLog = (log: GenerationLog) => {
        if (log.id === activeLogId && log.status === "pending") {
            setPreviewLog(null);
            setLogsOpen(false);
            setWorkspaceView("results");
            return;
        }
        if (log.status === "pending") {
            setActiveLogId(log.id);
            setPreviewLog(null);
            setLogsOpen(false);
            setWorkspaceView("results");
            setResults(videoResultsFromLog(log));
            return;
        }
        setPreviewLog(log);
        setLogsOpen(false);
        setWorkspaceView("results");
        if (running) return;
        setPrompt(log.prompt);
        setReferences(log.references || []);
        setVideoReferences(log.videoReferences || []);
        setAudioReferences(log.audioReferences || []);
        if (log.config.videoModel || log.model) updateConfig("videoModel", log.config.videoModel || log.model);
        if (log.config.size) updateConfig("size", log.config.size);
        if (log.config.vquality) updateConfig("vquality", log.config.vquality);
        if (log.config.videoSeconds) updateConfig("videoSeconds", log.config.videoSeconds);
        if (log.config.videoGenerateAudio) updateConfig("videoGenerateAudio", log.config.videoGenerateAudio);
        if (log.config.videoWatermark) updateConfig("videoWatermark", log.config.videoWatermark);
        if (log.config.videoPromptOptimizer) updateConfig("videoPromptOptimizer", log.config.videoPromptOptimizer);
        if (log.config.videoFastPretreatment) updateConfig("videoFastPretreatment", log.config.videoFastPretreatment);
        if (log.config.videoSeed !== undefined) updateConfig("videoSeed", log.config.videoSeed);
        if (log.config.videoReturnLastFrame) updateConfig("videoReturnLastFrame", log.config.videoReturnLastFrame);
        if (log.config.videoOutputFormat) updateConfig("videoOutputFormat", log.config.videoOutputFormat);
        setResults(videoResultsFromLog(log));
    };

    useEffect(() => {
        const resultId = searchParams.get("result");
        if (!resultId) return;
        const completedLog = logs.find((log) => log.id === resultId && log.status !== "pending");
        if (!completedLog) return;
        previewGenerationLog(completedLog);
        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete("result");
        setSearchParams(nextParams, { replace: true });
    }, [logs, searchParams, setSearchParams]);

    return (
        <div ref={workspaceRef} className="flex h-full flex-col overflow-hidden bg-background text-foreground">
            <main
                className={cn(
                    "grid min-h-0 flex-1 gap-3 bg-muted/25 p-3 transition-[grid-template-columns] duration-200",
                    compactLayout
                        ? "grid-cols-1 overflow-y-auto"
                        : effectiveSettingsCollapsed
                          ? "grid-cols-[68px_minmax(0,1fr)] overflow-hidden"
                          : "grid-cols-[400px_minmax(0,1fr)] overflow-hidden xl:grid-cols-[420px_minmax(0,1fr)]",
                )}
            >
                <aside className={cn("relative flex rounded-xl border border-border bg-card", !compactLayout && "min-h-0 overflow-hidden")}>
                    <div className={cn("thin-scrollbar flex min-w-0 flex-1 flex-col p-4 lg:p-5", !compactLayout && "min-h-full overflow-y-auto", effectiveSettingsCollapsed && "hidden")}>
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <h1 className="type-page-title text-foreground">{t("videoWorkbench.title")}</h1>
                                <p className="type-label mt-1 truncate text-muted-foreground">{modelOptionLabel(effectiveConfig, model)}</p>
                            </div>
                            <div className="flex shrink-0 gap-1">
                                {!compactLayout ? (
                                    <Tooltip title={t("canvas.collapsePanel")}>
                                        <Button type="text" icon={<PanelLeftClose className="size-4" />} aria-label={t("canvas.collapsePanel")} aria-expanded onClick={() => setSettingsCollapsed(true)} />
                                    </Tooltip>
                                ) : null}
                            </div>
                        </div>

                        <div className="mt-6 space-y-5">
                            <div>
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <span className="type-section-title">{t("workbench.prompt")}</span>
                                    <div className="flex gap-2">
                                        <Button size="small" icon={<BookOpen className="size-3.5" />} onClick={() => setPromptDialogOpen(true)}>
                                            {t("workbench.viewPrompts")}
                                        </Button>
                                        <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => setAssetPickerOpen(true)}>
                                            {t("workbench.viewAssets")}
                                        </Button>
                                    </div>
                                </div>
                                <Input.TextArea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={7} placeholder={t("videoWorkbench.promptPlaceholder")} />
                            </div>

                            <div className="min-w-0">
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <span className="type-label text-foreground">{t("videoWorkbench.references")}</span>
                                    <div className="flex gap-2">
                                        <Button size="small" icon={<ClipboardPaste className="size-3.5" />} onClick={() => void addReferencesFromClipboard()}>
                                            {t("workbench.clipboard")}
                                        </Button>
                                        <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
                                            {t("workbench.upload")}
                                        </Button>
                                    </div>
                                </div>
                                <div
                                    className={cn("grid min-h-24 w-full min-w-0 grid-cols-2 gap-2 rounded-lg border border-dashed border-border bg-muted/20 p-2 transition-colors", referenceDragTarget === "image" && "border-foreground/45 bg-muted/70")}
                                    onDragEnter={(event) => handleReferenceDragEnter(event, "image")}
                                    onDragOver={(event) => {
                                        event.preventDefault();
                                        event.dataTransfer.dropEffect = "copy";
                                    }}
                                    onDragLeave={handleReferenceDragLeave}
                                    onDrop={handleReferenceDrop}
                                >
                                    {references.map((item, index) => (
                                        <div key={item.id} className="group relative aspect-square min-w-0 overflow-hidden rounded-md border border-border bg-muted/30">
                                            <img src={item.dataUrl} alt={item.name} className="size-full object-cover" />
                                            <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[12px] font-medium text-white">{apimartPolicy?.imageRoleMode === "frames" ? t(index === 0 ? "videoWorkbench.firstFrame" : "videoWorkbench.lastFrame") : seedanceReferenceLabel("image", index)}</span>
                                            <ReferenceOrderButtons index={index} total={references.length} onMove={(offset) => setReferences((value) => moveListItem(value, index, offset))} />
                                            <button type="button" className="absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-md border border-destructive/40 bg-background/95 text-destructive shadow-md backdrop-blur-sm transition hover:border-destructive/60 hover:bg-destructive/15 focus-visible:ring-2 focus-visible:ring-destructive/30" style={{ color: "var(--destructive)" }} onClick={() => setReferences((value) => value.filter((ref) => ref.id !== item.id))} aria-label={t("videoWorkbench.removeImage")} title={t("videoWorkbench.removeImage")}>
                                                <Trash2 className="size-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                    {!references.length ? <div className="col-span-full flex min-h-20 items-center justify-center text-center text-sm text-muted-foreground">{referenceDragTarget === "image" ? t("videoWorkbench.dropReferences") : t("videoWorkbench.noImages")}</div> : null}
                                </div>
                            </div>

                            <div className="min-w-0">
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <span className="type-label text-foreground">{t("videoWorkbench.videoReferences")}</span>
                                    <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
                                        {t("workbench.upload")}
                                    </Button>
                                </div>
                                <div
                                    className={cn("grid min-h-24 w-full min-w-0 grid-cols-1 gap-2 rounded-lg border border-dashed border-border bg-muted/20 p-2 transition-colors", referenceDragTarget === "video" && "border-foreground/45 bg-muted/70")}
                                    onDragEnter={(event) => handleReferenceDragEnter(event, "video")}
                                    onDragOver={(event) => {
                                        event.preventDefault();
                                        event.dataTransfer.dropEffect = "copy";
                                    }}
                                    onDragLeave={handleReferenceDragLeave}
                                    onDrop={handleReferenceDrop}
                                >
                                    {videoReferences.map((item, index) => (
                                        <div key={item.id} className="group relative aspect-video min-w-0 overflow-hidden rounded-md border border-border bg-foreground">
                                            <video src={item.url} className="size-full object-cover" muted preload="metadata" />
                                            <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[12px] font-medium text-white">{seedanceReferenceLabel("video", index)}</span>
                                            <ReferenceOrderButtons index={index} total={videoReferences.length} onMove={(offset) => setVideoReferences((value) => moveListItem(value, index, offset))} />
                                            <button type="button" className="absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-md border border-destructive/40 bg-background/95 text-destructive shadow-md backdrop-blur-sm transition hover:border-destructive/60 hover:bg-destructive/15 focus-visible:ring-2 focus-visible:ring-destructive/30" style={{ color: "var(--destructive)" }} onClick={() => setVideoReferences((value) => value.filter((ref) => ref.id !== item.id))} aria-label={t("videoWorkbench.removeVideo")} title={t("videoWorkbench.removeVideo")}>
                                                <Trash2 className="size-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                    {!videoReferences.length ? <div className="flex min-h-20 items-center justify-center text-center text-sm text-muted-foreground">{referenceDragTarget === "video" ? t("videoWorkbench.dropReferences") : t("videoWorkbench.noVideos")}</div> : null}
                                </div>
                            </div>

                            <div className="min-w-0">
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <span className="type-label text-foreground">{t("videoWorkbench.audioReferences")}</span>
                                    <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
                                        {t("workbench.upload")}
                                    </Button>
                                </div>
                                <div
                                    className={cn("grid min-h-24 w-full min-w-0 grid-cols-1 gap-2 rounded-lg border border-dashed border-border bg-muted/20 p-2 transition-colors", referenceDragTarget === "audio" && "border-foreground/45 bg-muted/70")}
                                    onDragEnter={(event) => handleReferenceDragEnter(event, "audio")}
                                    onDragOver={(event) => {
                                        event.preventDefault();
                                        event.dataTransfer.dropEffect = "copy";
                                    }}
                                    onDragLeave={handleReferenceDragLeave}
                                    onDrop={handleReferenceDrop}
                                >
                                    {audioReferences.map((item, index) => (
                                        <div key={item.id} className="group relative flex min-h-24 min-w-0 flex-col justify-center gap-2 rounded-md border border-border bg-muted/60 px-3 py-2">
                                            <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                                                <Music2 className="size-4 shrink-0" />
                                                <span className="shrink-0 rounded bg-background px-1 text-[12px] text-foreground">{seedanceReferenceLabel("audio", index)}</span>
                                                <span className="truncate">{item.name}</span>
                                            </div>
                                            <audio src={item.url} controls className="h-8 w-full" preload="metadata" />
                                            <ReferenceOrderButtons index={index} total={audioReferences.length} onMove={(offset) => setAudioReferences((value) => moveListItem(value, index, offset))} />
                                            <button type="button" className="absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-md border border-destructive/40 bg-background/95 text-destructive shadow-md backdrop-blur-sm transition hover:border-destructive/60 hover:bg-destructive/15 focus-visible:ring-2 focus-visible:ring-destructive/30" style={{ color: "var(--destructive)" }} onClick={() => setAudioReferences((value) => value.filter((ref) => ref.id !== item.id))} aria-label={t("videoWorkbench.removeAudio")} title={t("videoWorkbench.removeAudio")}>
                                                <Trash2 className="size-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                    {!audioReferences.length ? <div className="flex min-h-20 items-center justify-center text-center text-sm text-muted-foreground">{referenceDragTarget === "audio" ? t("videoWorkbench.dropReferences") : t("videoWorkbench.noAudio")}</div> : null}
                                </div>
                            </div>

                            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm sm:hidden">
                                <span className="truncate text-muted-foreground">
                                    {modelOptionLabel(effectiveConfig, model)} · {videoResolutionLabel(effectiveConfig.vquality)} · {videoSizeLabel(effectiveConfig.size)} · {videoSecondsLabel(effectiveConfig.videoSeconds)}
                                </span>
                                <Button size="small" type="text" icon={<SlidersHorizontal className="size-4" />} onClick={() => setSettingsOpen(true)}>
                                    {t("workbench.adjust")}
                                </Button>
                            </div>

                            <div className="hidden gap-4 sm:grid sm:grid-cols-2">
                                <GenerationSettings config={effectiveConfig} model={model} prompt={prompt} imageCount={references.length} videoCount={videoReferences.length} audioCount={audioReferences.length} updateConfig={updateConfig} openConfigDialog={openConfigDialog} />
                            </div>
                        </div>

                        <div className="sticky bottom-0 z-10 -mx-4 mt-auto border-t border-border bg-card/95 px-4 pb-1 pt-4 backdrop-blur lg:-mx-5 lg:px-5">
                            <Button type="primary" size="large" block icon={<Sparkles className="size-4" />} loading={running} disabled={!canGenerate || running} onClick={() => void generate()}>
                                {t("workbench.generate")}
                            </Button>
                        </div>
                    </div>
                    {effectiveSettingsCollapsed ? (
                        <div className="flex h-full w-full flex-col items-center px-2 py-3">
                            <Tooltip title={t("canvas.expandPanel")} placement="right">
                                <Button type="text" shape="circle" icon={<PanelLeftOpen className="size-4" />} aria-label={t("canvas.expandPanel")} aria-expanded={false} onClick={() => setSettingsCollapsed(false)} />
                            </Tooltip>
                            <span className="my-4 h-px w-8 bg-border" />
                            <VideoIcon className="size-5 text-muted-foreground" />
                            <span className="type-label mt-3 [writing-mode:vertical-rl] text-muted-foreground">{t("videoWorkbench.title")}</span>
                            <div className="mt-auto flex flex-col items-center gap-3">
                                {!previewLog && activeGenerating ? (
                                    <Tooltip title={t("workbench.waiting", { time: formatDuration(activeElapsedMs) })} placement="right">
                                        <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
                                    </Tooltip>
                                ) : null}
                                <Tooltip title={t("workbench.generate")} placement="right">
                                    <Button type="primary" shape="circle" icon={<Sparkles className="size-4" />} loading={running} disabled={!canGenerate || running} aria-label={t("workbench.generate")} onClick={() => void generate()} />
                                </Tooltip>
                            </div>
                        </div>
                    ) : null}
                </aside>

                <section className={cn("flex flex-col rounded-xl border border-border bg-card", compactLayout ? "h-fit min-h-[420px]" : "min-h-0 overflow-hidden")}>
                    <div className="flex min-h-14 shrink-0 items-center justify-between gap-4 border-b border-border px-4 lg:px-6">
                        {!compactLayout ? <div className="flex h-full items-stretch gap-6" role="tablist" aria-label={t("videoWorkbench.title")}>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={workspaceView === "results"}
                                className={cn("relative inline-flex items-center gap-2 border-b-2 px-0 text-sm transition-colors", workspaceView === "results" ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
                                onClick={() => setWorkspaceView("results")}
                            >
                                <Sparkles className="size-4" />
                                {t("workbench.results")}
                            </button>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={workspaceView === "logs"}
                                className={cn("relative inline-flex items-center gap-2 border-b-2 px-0 text-sm transition-colors", workspaceView === "logs" ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
                                onClick={() => setWorkspaceView("logs")}
                            >
                                <History className="size-4" />
                                {t("workbench.logs")}
                                <span className="type-numeric text-[13px] text-muted-foreground">{logs.length}</span>
                            </button>
                        </div> : <h2 className="type-section-title">{t("workbench.results")}</h2>}
                        <div className="flex items-center gap-3">
                            {previewLog ? (
                                <span className="type-numeric text-xs text-muted-foreground">{t("workbench.elapsed", { time: formatDuration(previewLog.durationMs) })}</span>
                            ) : activeGenerating ? (
                                <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                                    <LoaderCircle className="size-3.5 animate-spin" />
                                    <span>{t("workbench.generating")}</span>
                                    <span className="type-numeric">{formatDuration(activeElapsedMs)}</span>
                                </span>
                            ) : activeLog ? (
                                <span className="type-numeric text-xs text-muted-foreground">{t("workbench.elapsed", { time: formatDuration(activeElapsedMs) })}</span>
                            ) : null}
                            {compactLayout ? (
                                <Button type="text" icon={<History className="size-4" />} onClick={() => setLogsOpen(true)}>
                                    {t("workbench.logs")}
                                </Button>
                            ) : null}
                        </div>
                    </div>

                    {compactLayout || workspaceView === "results" ? (
                        <div className={cn("thin-scrollbar p-4 lg:p-6", !compactLayout && "min-h-0 flex-1 overflow-y-auto")}>
                            {visibleResults.length ? (
                                <div className="grid max-w-5xl gap-4">
                                    {visibleResults.map((result) => (result.status === "success" && result.video ? <ResultVideoCard key={result.id} video={result.video} onDownload={downloadVideo} onSaveAsset={saveResultToAssets} /> : result.status === "failed" ? <FailedVideoCard key={result.id} error={result.error || t("workbench.generationFailed")} running={running} onRetry={retryResult} /> : <PendingVideoCard key={result.id} />))}
                                </div>
                            ) : (
                                <div className="flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 text-center lg:min-h-[560px]">
                                    <VideoIcon className="mb-4 size-11 text-muted-foreground/55" />
                                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("videoWorkbench.empty")} />
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
                            <LogPanel layout="grid" logs={logs} running={running} selectedLogIds={selectedLogIds} activeLogId={previewLog?.id || activeLogId} onSelectedLogIdsChange={setSelectedLogIds} onCreateSession={createSession} onDeleteSelected={() => setDeleteConfirmOpen(true)} onPreviewLog={previewGenerationLog} />
                        </div>
                    )}
                </section>
            </main>
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/mp4,video/quicktime,audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav"
                multiple
                className="hidden"
                onChange={(event) => {
                    void addReferences(event.target.files);
                    event.target.value = "";
                }}
            />
            <Drawer title={t("workbench.logs")} placement="bottom" size="large" open={logsOpen} onClose={() => setLogsOpen(false)}>
                <LogPanel logs={logs} running={running} selectedLogIds={selectedLogIds} activeLogId={previewLog?.id || activeLogId} onSelectedLogIdsChange={setSelectedLogIds} onCreateSession={createSession} onDeleteSelected={() => setDeleteConfirmOpen(true)} onPreviewLog={previewGenerationLog} />
            </Drawer>
            <Drawer title={t("workbench.settings")} placement="bottom" size="82vh" open={settingsOpen} onClose={() => setSettingsOpen(false)}>
                <div className="grid grid-cols-2 gap-3 pb-4">
                    <GenerationSettings config={effectiveConfig} model={model} prompt={prompt} imageCount={references.length} videoCount={videoReferences.length} audioCount={audioReferences.length} updateConfig={updateConfig} openConfigDialog={openConfigDialog} />
                </div>
            </Drawer>
            <PromptSelectDialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen} onSelect={setPrompt} />
            <AssetPickerModal open={assetPickerOpen} defaultTab="my-assets" onInsert={(payload) => void insertPickedAsset(payload)} onClose={() => setAssetPickerOpen(false)} />
            <Modal title={t("workbench.deleteLogs")} open={deleteConfirmOpen} onCancel={() => setDeleteConfirmOpen(false)} onOk={deleteSelectedLogs} okText={t("workbench.moveToTrash")} okButtonProps={{ danger: true, disabled: !selectedDeletableLogIds.length }} cancelText={t("common.cancel")}>
                {t("workbench.deleteLogsConfirm", { count: selectedDeletableLogIds.length })}
            </Modal>
        </div>
    );
}

function GenerationSettings({ config, model, prompt, imageCount, videoCount, audioCount, updateConfig, openConfigDialog }: { config: AiConfig; model: string; prompt: string; imageCount: number; videoCount: number; audioCount: number; updateConfig: UpdateAiConfig; openConfigDialog: (shouldPromptContinue?: boolean, tab?: ConfigTabKey) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();

    return (
        <>
            <label className="col-span-2 block min-w-0">
                <span className="type-label mb-2 block text-foreground">{t("workbench.model")}</span>
                <ModelPicker config={config} value={model} onChange={(value) => updateConfig("videoModel", value)} capability="video" fullWidth onMissingConfig={() => openConfigDialog(false, "channels")} />
            </label>
            <div className="col-span-2">
                <VideoSettingsPanel config={config} onConfigChange={(key, value) => updateConfig(key, value)} theme={theme} showTitle={false} className="space-y-4" prompt={prompt} imageCount={imageCount} videoCount={videoCount} audioCount={audioCount} />
            </div>
        </>
    );
}

function ResultVideoCard({ video, onDownload, onSaveAsset }: { video: GeneratedVideo; onDownload: (video: GeneratedVideo) => void; onSaveAsset: (video: GeneratedVideo) => void }) {
    const { t } = useTranslation();
    return (
        <div className="overflow-hidden rounded-xl border border-border bg-background">
            <video src={video.url} controls className="aspect-video w-full bg-black object-contain" />
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border px-4 py-3">
                <div className="type-numeric flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{video.width}×{video.height}</span>
                    <span>{formatBytes(video.bytes)}</span>
                    <span>{formatDuration(video.durationMs)}</span>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1">
                    <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => onSaveAsset(video)}>
                        {t("common.addToAssets")}
                    </Button>
                    <Button size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(video)}>
                        {t("common.download")}
                    </Button>
                </div>
            </div>
        </div>
    );
}

function PendingVideoCard() {
    const { t } = useTranslation();
    return (
        <div className="relative aspect-video overflow-hidden rounded-xl border border-dashed border-border bg-muted/30">
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-6 animate-spin" />
                <span>{t("workbench.generating")}</span>
            </div>
        </div>
    );
}

function FailedVideoCard({ error, running, onRetry }: { error: string; running: boolean; onRetry: () => void }) {
    const { t } = useTranslation();
    const { token } = antdTheme.useToken();
    return (
        <div className="overflow-hidden rounded-xl border" style={{ borderColor: token.colorErrorBorder, background: token.colorErrorBg }}>
            <div className="flex aspect-video flex-col items-center justify-center gap-3 p-5 text-center">
                <div className="text-sm font-medium" style={{ color: token.colorError }}>{t("workbench.failed")}</div>
                <Typography.Paragraph data-selectable-text ellipsis={{ rows: 4 }} className="!mb-0 !text-xs" style={{ color: token.colorError }}>
                    {error}
                </Typography.Paragraph>
            </div>
            <div className="flex justify-end border-t p-3" style={{ borderColor: token.colorErrorBorder }}>
                <Button size="small" danger disabled={running} onClick={onRetry}>
                    {t("workbench.retry")}
                </Button>
            </div>
        </div>
    );
}

function videoResultsFromLog(log: GenerationLog): GenerationResult[] {
    if (log.status === "pending") return [{ id: log.id, status: "pending" }];
    if (log.video) return [{ id: log.video.id, status: "success", video: log.video }];
    return [{ id: log.id, status: "failed", error: log.error || i18n.t("workbench.generationFailed") }];
}

function LogPanel({
    layout = "list",
    logs,
    running,
    selectedLogIds,
    activeLogId,
    onSelectedLogIdsChange,
    onCreateSession,
    onDeleteSelected,
    onPreviewLog,
}: {
    layout?: "list" | "grid";
    logs: GenerationLog[];
    running: boolean;
    selectedLogIds: string[];
    activeLogId?: string;
    onSelectedLogIdsChange: (ids: string[]) => void;
    onCreateSession: () => void;
    onDeleteSelected: () => void;
    onPreviewLog: (log: GenerationLog) => void;
}) {
    const { t } = useTranslation();
    const pointerHalo = usePointerHalo<HTMLDivElement>();
    const [search, setSearch] = useState("");
    const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase());
    const filteredLogs = useMemo(
        () =>
            deferredSearch
                ? logs.filter((log) => [log.title, log.prompt, log.model, log.time, log.size, log.resolution, log.seconds, log.config?.model, log.config?.videoModel, log.config?.size, log.config?.vquality, log.config?.videoSeconds].some((value) => String(value || "").toLocaleLowerCase().includes(deferredSearch)))
                : logs,
        [deferredSearch, logs],
    );
    const selectableLogIds = filteredLogs.filter((log) => log.status !== "pending" && !activeVideoLogIds.has(log.id)).map((log) => log.id);
    const selectedSelectableLogIds = selectedLogIds.filter((id) => selectableLogIds.includes(id));
    const allSelected = Boolean(selectableLogIds.length) && selectableLogIds.every((id) => selectedLogIds.includes(id));
    const toggleAll = () => onSelectedLogIdsChange(allSelected ? selectedLogIds.filter((id) => !selectableLogIds.includes(id)) : Array.from(new Set([...selectedLogIds, ...selectableLogIds])));
    const updateSearch = (value: string) => {
        setSearch(value);
        if (selectedLogIds.length) onSelectedLogIdsChange([]);
    };

    return (
        <>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-baseline gap-2">
                    <h2 className="type-section-title">{t("workbench.logs")}</h2>
                    <span className="type-numeric text-xs text-muted-foreground">{deferredSearch ? t("workbench.filteredCount", { count: filteredLogs.length, total: logs.length }) : logs.length}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button size="small" icon={<Plus className="size-3.5" />} disabled={running} onClick={onCreateSession}>
                        {t("workbench.new")}
                    </Button>
                    <Button size="small" icon={<CheckSquare className="size-3.5" />} disabled={!selectableLogIds.length} onClick={toggleAll}>
                        {allSelected ? t("common.cancel") : t("workbench.selectAll")}
                    </Button>
                    <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={!selectedSelectableLogIds.length} onClick={onDeleteSelected}>
                        {t("common.delete")}
                    </Button>
                </div>
            </div>
            <Input allowClear value={search} prefix={<Search className="size-4 text-muted-foreground" />} placeholder={t("workbench.searchLogs")} className="mb-4" onChange={(event) => updateSearch(event.target.value)} />
            <div className={cn(layout === "grid" ? "grid gap-3 md:grid-cols-2 2xl:grid-cols-3" : "space-y-3")}>
                {filteredLogs.map((log) => (
                    <LogCard key={log.id} log={log} selected={selectedLogIds.includes(log.id)} active={activeLogId === log.id} pointerHalo={pointerHalo} onSelectedChange={(checked) => onSelectedLogIdsChange(checked ? [...selectedLogIds, log.id] : selectedLogIds.filter((id) => id !== log.id))} onClick={() => onPreviewLog(log)} />
                ))}
                {!filteredLogs.length ? <div className="flex min-h-48 items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 text-center text-sm text-muted-foreground md:col-span-2 2xl:col-span-3">{logs.length ? t("workbench.noMatchingLogs") : t("workbench.noLogs")}</div> : null}
            </div>
        </>
    );
}

function LogCard({ log, selected, active, pointerHalo, onSelectedChange, onClick }: { log: GenerationLog; selected: boolean; active: boolean; pointerHalo: PointerHaloController<HTMLDivElement>; onSelectedChange: (checked: boolean) => void; onClick: () => void }) {
    const { t } = useTranslation();
    const { token } = antdTheme.useToken();
    const activelyRunning = activeVideoLogIds.has(log.id);
    const selectionDisabled = log.status === "pending" || activelyRunning;
    const status =
        log.status === "pending"
            ? { icon: <LoaderCircle className={cn("size-3.5", activelyRunning && "animate-spin")} />, label: t(activelyRunning ? "workbench.generating" : "workbench.pendingConfirmation"), color: token.colorWarning }
            : log.status === "failed"
              ? { icon: <CircleX className="size-3.5" />, label: t("workbench.failed"), color: token.colorError }
              : { icon: <CheckCircle2 className="size-3.5" />, label: t("workbench.completed"), color: token.colorSuccess };

    return (
        <div
            data-halo-surface
            data-active={active ? "true" : undefined}
            data-selected={selected ? "true" : undefined}
            data-selection-disabled={selectionDisabled ? "true" : undefined}
            data-log-status={activelyRunning ? "running" : log.status}
            className={cn("generation-log-card group relative isolate w-full overflow-hidden rounded-xl border border-border bg-background p-3 text-left", active && "generation-log-card-active", selected && "generation-log-card-selected", selectionDisabled && "generation-log-card-selection-disabled")}
            onPointerEnter={pointerHalo.onPointerEnter}
            onPointerMove={pointerHalo.onPointerMove}
            onPointerLeave={pointerHalo.onPointerLeave}
            onPointerDown={pointerHalo.onPointerDown}
            onPointerCancel={pointerHalo.onPointerCancel}
        >
            <span aria-hidden="true" className="generation-log-halo" />
            <span aria-hidden="true" className="generation-log-selection" />
            <span aria-hidden="true" data-halo-bloom className="interaction-halo-bloom" />
            <div className="relative z-[1] grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2.5">
                <span data-halo-ignore className="mt-0.5" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
                    <Checkbox aria-label={t("workbench.selectLog", { name: log.title })} checked={selected} disabled={selectionDisabled} onChange={(event) => onSelectedChange(event.target.checked)} />
                </span>
                <button type="button" data-log-open aria-current={active ? "true" : undefined} className="min-w-0 text-left" onClick={onClick}>
                    <div className="flex min-w-0 items-start justify-between gap-2">
                        <span className="min-w-0 truncate text-sm font-semibold leading-5 text-foreground" title={log.title}>{log.title}</span>
                        <span className="inline-flex shrink-0 items-center gap-1 text-xs leading-5" style={{ color: status.color }}>
                            {status.icon}
                            {status.label}
                        </span>
                    </div>
                    <div className="type-numeric mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
                        <span>{log.size}</span>
                        <span>{videoResolutionLabel(log.resolution)}</span>
                        <span>{log.seconds}s</span>
                        {log.status !== "pending" ? <span>{formatDuration(log.durationMs)}</span> : null}
                    </div>
                    <div className="type-numeric mt-1 truncate text-[12px] text-muted-foreground/75" title={log.time}>{log.time}</div>
                </button>
            </div>
        </div>
    );
}

async function readStoredLogs() {
    if (typeof window === "undefined") return [];
    const values = new Map<string, GenerationLog>();
    try {
        await logStore.iterate<GenerationLog, void>((value) => {
            values.set(value.id, value);
        });
    } catch {
        // Volatile terminal records remain visible when the persistent store is temporarily unavailable.
    }
    logStore.volatileEntries().forEach(([id, value]) => {
        const current = values.get(id);
        if (!current || preferredGenerationLog(value, current) === value) values.set(id, value);
    });
    const logs = await Promise.all([...values.values()].filter((value) => !value.trashedAt && !value.purgedAt).map(normalizeLog));
    return logs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

async function normalizeLog(log: Partial<GenerationLog>): Promise<GenerationLog> {
    const video = log.video?.storageKey ? { ...log.video, url: await resolveMediaUrl(log.video.storageKey, log.video.url) } : log.video;
    const videoReferences = await Promise.all(
        (log.videoReferences || []).map(async (item) => ({
            ...item,
            url: item.storageKey ? await resolveMediaUrl(item.storageKey, item.url) : item.url,
        })),
    );
    const audioReferences = await Promise.all(
        (log.audioReferences || []).map(async (item) => ({
            ...item,
            url: item.storageKey ? await resolveMediaUrl(item.storageKey, item.url) : item.url,
        })),
    );
    const references = await Promise.all(
        (log.references || []).map(async (item) => ({
            ...item,
            dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl),
        })),
    );
    const config = normalizeLogConfig(log);
    return {
        id: log.id || nanoid(),
        createdAt: log.createdAt || Date.now(),
        title: log.title || log.model || i18n.t("workbench.untitled"),
        prompt: log.prompt || "",
        time: log.time || new Date().toLocaleString(i18n.resolvedLanguage, { hour12: false }),
        model: log.model || config.videoModel || "",
        config,
        references,
        videoReferences,
        audioReferences,
        durationMs: log.durationMs || 0,
        size: log.size || config.size || "",
        resolution: normalizeResolution(log.resolution || config.vquality || ""),
        seconds: log.seconds || config.videoSeconds || "",
        status: log.status || "success",
        task: log.task,
        video,
        error: log.error,
        updatedAt: log.updatedAt,
        trashedAt: log.trashedAt,
        purgedAt: log.purgedAt,
        formerOutputStorageKeys: log.formerOutputStorageKeys,
    };
}

function serializeLog(log: GenerationLog): GenerationLog {
    return {
        ...log,
        references: log.references.map((item) => ({ ...item, dataUrl: item.storageKey ? "" : item.dataUrl })),
        videoReferences: log.videoReferences.map((item) => (item.storageKey ? { ...item, url: "" } : item)),
        audioReferences: log.audioReferences.map((item) => (item.storageKey ? { ...item, url: "" } : item)),
        video: log.video?.storageKey ? { ...log.video, url: "" } : log.video,
    };
}

function isSupportedAudioFile(file: File) {
    return file.type === "audio/mpeg" || file.type === "audio/mp3" || file.type === "audio/wav" || file.type === "audio/x-wav" || /\.(mp3|wav)$/i.test(file.name);
}

function filterAudioReferencesByDuration(existing: ReferenceAudio[], next: ReferenceAudio[], warn: (content: string) => void, maxSeconds: number) {
    let total = existing.reduce((sum, item) => sum + (item.durationMs || 0), 0);
    const accepted: ReferenceAudio[] = [];
    let skipped = false;
    for (const item of next) {
        if (item.durationMs && (item.durationMs < 2000 || item.durationMs > maxSeconds * 1000)) {
            skipped = true;
            continue;
        }
        if (item.durationMs && total + item.durationMs > maxSeconds * 1000) {
            skipped = true;
            continue;
        }
        total += item.durationMs || 0;
        accepted.push(item);
    }
    if (skipped) warn(i18n.t("videoWorkbench.audioDurationInvalid", { max: maxSeconds }));
    return accepted;
}

function moveListItem<T>(items: T[], index: number, offset: number) {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= items.length) return items;
    const next = [...items];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    return next;
}

function appendUniqueReferences<T extends { storageKey?: string; url?: string; dataUrl?: string }>(current: T[], items: T[], limit: number) {
    const identities = new Set(current.map((item) => item.storageKey || item.url || item.dataUrl));
    return [...current, ...items.filter((item) => {
        const identity = item.storageKey || item.url || item.dataUrl;
        if (identities.has(identity)) return false;
        identities.add(identity);
        return true;
    })].slice(0, limit);
}

function ReferenceOrderButtons({ index, total, onMove }: { index: number; total: number; onMove: (offset: number) => void }) {
    if (total <= 1) return null;
    return (
        <div className="absolute inset-x-2 bottom-2 flex justify-between">
            <Button size="small" className="!h-7 !w-7 !min-w-7 !rounded-full !border-border/80 !bg-background/95 !p-0 !text-foreground !shadow-md backdrop-blur-sm" icon={<ArrowLeft className="size-3.5" />} disabled={index <= 0} onClick={() => onMove(-1)} />
            <Button size="small" className="!h-7 !w-7 !min-w-7 !rounded-full !border-border/80 !bg-background/95 !p-0 !text-foreground !shadow-md backdrop-blur-sm" icon={<ArrowRight className="size-3.5" />} disabled={index >= total - 1} onClick={() => onMove(1)} />
        </div>
    );
}

function normalizeLogConfig(log: Partial<GenerationLog>): GenerationLogConfig {
    return {
        model: log.config?.model || log.model || "",
        videoModel: log.config?.videoModel || log.model || "",
        size: log.config?.size || log.size || "",
        vquality: normalizeResolution(log.config?.vquality || log.resolution || ""),
        videoSeconds: log.config?.videoSeconds || log.seconds || "",
        videoGenerateAudio: log.config?.videoGenerateAudio || "true",
        videoWatermark: log.config?.videoWatermark || "false",
        videoPromptOptimizer: log.config?.videoPromptOptimizer || "true",
        videoFastPretreatment: log.config?.videoFastPretreatment || "false",
        videoSeed: log.config?.videoSeed || "",
        videoReturnLastFrame: log.config?.videoReturnLastFrame || "false",
        videoOutputFormat: log.config?.videoOutputFormat || "mp4",
    };
}

function buildLog({ prompt, model, config, references, videoReferences, audioReferences, durationMs, status, task, video, error }: { prompt: string; model: string; config: AiConfig; references: ReferenceImage[]; videoReferences: ReferenceVideo[]; audioReferences: ReferenceAudio[]; durationMs: number; status: GenerationLog["status"]; task?: VideoGenerationTask; video?: GeneratedVideo; error?: string }): GenerationLog {
    const logConfig = {
        model: config.model,
        videoModel: config.videoModel,
        size: config.size,
        vquality: normalizeResolution(config.vquality),
        videoSeconds: config.videoSeconds,
        videoGenerateAudio: config.videoGenerateAudio,
        videoWatermark: config.videoWatermark,
        videoPromptOptimizer: config.videoPromptOptimizer,
        videoFastPretreatment: config.videoFastPretreatment,
        videoSeed: config.videoSeed,
        videoReturnLastFrame: config.videoReturnLastFrame,
        videoOutputFormat: config.videoOutputFormat,
    };
    return {
        id: nanoid(),
        createdAt: Date.now(),
        title: prompt.slice(0, 12) || i18n.t("workbench.untitled"),
        prompt,
        time: new Date().toLocaleString(i18n.resolvedLanguage, { hour12: false }),
        model,
        config: logConfig,
        references,
        videoReferences,
        audioReferences,
        durationMs,
        size: logConfig.size,
        resolution: logConfig.vquality,
        seconds: logConfig.videoSeconds,
        status,
        task,
        video,
        error,
    };
}

function buildVideoConfig(config: AiConfig, model: string, apimartPolicy: ApimartVideoPolicy | null): AiConfig {
    const seedance = isSeedanceVideoConfig({ ...config, model });
    const apimart = Boolean(apimartPolicy);
    return {
        ...config,
        model,
        videoModel: model,
        size: apimart ? normalizeApimartVideoRatio(config.size, apimartPolicy!) || "" : seedance ? normalizeSeedanceRatio(config.size) : normalizeVideoSize(config.size),
        videoSeconds: apimart ? String(normalizeApimartVideoDuration(config.videoSeconds, apimartPolicy!)) : normalizeVideoSeconds(config.videoSeconds, seedance ? 15 : 20),
        vquality: apimart ? normalizeApimartVideoResolution(config.vquality, apimartPolicy!) : normalizeResolution(config.vquality),
        videoGenerateAudio: String(apimartPolicy?.features.generateAudio ? boolConfig(config.videoGenerateAudio, true) : !apimart && boolConfig(config.videoGenerateAudio, true)),
        videoWatermark: String(apimartPolicy?.features.watermark ? boolConfig(config.videoWatermark, false) : !apimart && boolConfig(config.videoWatermark, false)),
        videoPromptOptimizer: String(apimartPolicy?.features.promptOptimizer ? boolConfig(config.videoPromptOptimizer, true) : false),
        videoFastPretreatment: String(apimartPolicy?.features.fastPretreatment ? boolConfig(config.videoFastPretreatment, false) : false),
        videoSeed: config.videoSeed || "",
        videoReturnLastFrame: String(apimartPolicy?.features.returnLastFrame ? boolConfig(config.videoReturnLastFrame, false) : false),
        videoOutputFormat: apimartPolicy?.features.outputFormats.includes("mov") && config.videoOutputFormat === "mov" ? "mov" : "mp4",
    };
}

function normalizeVideoSeconds(value: string, maxSeconds = 20) {
    if (String(value).trim() === "-1") return "-1";
    const seconds = Math.floor(Number(value) || 6);
    return String(Math.max(1, Math.min(maxSeconds, seconds)));
}

function normalizeVideoSize(value: string) {
    return normalizeVideoSizeValue(value);
}

function normalizeResolution(value: string) {
    return normalizeVideoResolutionValue(value);
}

function bytesToMb(value: number) {
    return Math.floor(value / 1024 / 1024);
}

function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
