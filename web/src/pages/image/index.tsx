import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, CheckSquare, CircleX, ClipboardPaste, Download, FolderPlus, History, ImagePlus, LoaderCircle, PanelLeftClose, PanelLeftOpen, PenLine, Plus, Search, SlidersHorizontal, Sparkles, Trash2, Upload } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Checkbox, Drawer, Empty, Image, Input, Modal, Tag, Tooltip, Typography, theme as antdTheme } from "antd";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { ModelPicker } from "@/components/model-picker";
import { PromptSelectDialog } from "@/components/prompts/prompt-select-dialog";
import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { useContainerBreakpoint } from "@/hooks/use-container-breakpoint";
import { canvasThemes } from "@/lib/canvas-theme";
import { apimartImagePolicy, isApimartConfig } from "@/lib/apimart-models";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { modelOptionLabel, resolveModelRequestConfig, useConfigStore, useEffectiveConfig, type AiConfig, type ConfigTabKey } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { nanoid } from "nanoid";
import { formatBytes, formatDuration } from "@/lib/image-utils";
import { requestEdit, requestGeneration } from "@/services/api/image";
import { resolveImageUrl, uploadImage } from "@/services/image-storage";
import { useAssetStore } from "@/stores/use-asset-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import { useImageWorkbenchStore, type GeneratedWorkbenchImage as GeneratedImage, type ImageWorkbenchResult as GenerationResult } from "@/stores/use-image-workbench-store";
import type { ReferenceImage } from "@/types/image";
import i18n from "@/i18n";
import { createGenerationLogStore, runGenerationLogOperation } from "@/services/generation-log-store";
import { IMAGE_USAGE_UPDATED_EVENT, notifyImageUsageUpdated } from "@/services/image-usage-stats";
import { CREATIVE_TRACKING_VERSION, recordImageCreativeActivity, type CreativeOperation, type CreativeSource } from "@/services/creative-activity";
import { runPersistedGenerationLifecycle, upsertGenerationRecord } from "@/lib/image-generation-log-lifecycle";
import { cn } from "@/lib/utils";
import { usePointerHalo, type PointerHaloController } from "@/hooks/use-pointer-halo";
import { notifyTaskCompletion } from "@/lib/task-completion-notification";
import { ProviderTaskPendingError } from "@/services/provider/registry";
import { moveGenerationRecordsToTrash } from "@/services/generation-trash";
import { preferredGenerationLog } from "@/lib/generation-log-merge";

type GenerationLog = {
    id: string;
    createdAt: number;
    title: string;
    prompt: string;
    time: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    durationMs: number;
    successCount: number;
    failCount: number;
    imageCount: number;
    size: string;
    quality: string;
    status: "running" | "pending" | "success" | "failed";
    taskIds?: string[];
    error?: string;
    images: GeneratedImage[];
    thumbnails: string[];
    updatedAt?: number;
    trashedAt?: number;
    purgedAt?: number;
    formerOutputStorageKeys?: string[];
    source?: CreativeSource;
    operation?: CreativeOperation;
    trackingVersion?: number;
    trackedAt?: number;
};

type GenerationLogConfig = Pick<AiConfig, "model" | "imageModel" | "quality" | "size" | "count">;

type UpdateAiConfig = <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;

const LOG_STORE_KEY = "infinite-canvas:image_generation_logs";
const RESULT_ACTION_BUTTON_CLASS = "min-w-[9rem] whitespace-nowrap px-2 [&_.ant-btn-icon]:shrink-0";
const logStore = createGenerationLogStore<GenerationLog>("image_generation_logs");

export default function ImagePage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [searchParams, setSearchParams] = useSearchParams();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragDepthRef = useRef(0);
    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const prompt = useImageWorkbenchStore((state) => state.prompt);
    const references = useImageWorkbenchStore((state) => state.references);
    const results = useImageWorkbenchStore((state) => state.results);
    const running = useImageWorkbenchStore((state) => state.running);
    const activeLogId = useImageWorkbenchStore((state) => state.activeLogId);
    const startedAt = useImageWorkbenchStore((state) => state.startedAt);
    const elapsedMs = useImageWorkbenchStore((state) => state.elapsedMs);
    const setPrompt = useImageWorkbenchStore((state) => state.setPrompt);
    const setReferences = useImageWorkbenchStore((state) => state.setReferences);
    const setResults = useImageWorkbenchStore((state) => state.setResults);
    const setRunning = useImageWorkbenchStore((state) => state.setRunning);
    const setActiveLogId = useImageWorkbenchStore((state) => state.setActiveLogId);
    const setStartedAt = useImageWorkbenchStore((state) => state.setStartedAt);
    const setElapsedMs = useImageWorkbenchStore((state) => state.setElapsedMs);
    const resetWorkbench = useImageWorkbenchStore((state) => state.reset);
    const [logs, setLogs] = useState<GenerationLog[]>([]);
    const [logsOpen, setLogsOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [composerCollapsed, setComposerCollapsed] = useState(false);
    const [promptDialogOpen, setPromptDialogOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
    const [previewLog, setPreviewLog] = useState<GenerationLog | null>(null);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [isReferenceDragActive, setIsReferenceDragActive] = useState(false);
    const [autoRunToken, setAutoRunToken] = useState(0);
    const imageCommand = useWorkbenchAgentStore((state) => state.imageCommand);
    const clearImageCommand = useWorkbenchAgentStore((state) => state.clearImageCommand);
    const updateAgentTask = useWorkbenchAgentStore((state) => state.updateTask);
    const processedCommandRef = useRef(0);
    const agentTaskIdRef = useRef<string | undefined>(undefined);
    const wasRunningRef = useRef(running);
    const logsSyncVersionRef = useRef(0);
    const [workspaceRef, compactLayout] = useContainerBreakpoint<HTMLDivElement>(960);

    const model = effectiveConfig.imageModel || effectiveConfig.model;
    const requestConfig = resolveModelRequestConfig(effectiveConfig, model);
    const apimartPolicy = isApimartConfig(requestConfig) ? apimartImagePolicy(requestConfig.model) : undefined;
    const referenceLimit = apimartPolicy?.maxReferences ?? Number.POSITIVE_INFINITY;
    const canGenerate = Boolean(prompt.trim());
    const generationCount = Math.max(1, Math.min(10, Number(config.count) || 1));
    const effectiveComposerCollapsed = !compactLayout && composerCollapsed;
    const activeLog = logs.find((log) => log.id === activeLogId);
    const displayedLog = previewLog || (!running ? activeLog : null);
    const pendingQueryLog = displayedLog?.status === "pending" ? displayedLog : null;
    const visiblePrompt = previewLog && running ? previewLog.prompt : prompt;
    const visibleReferences = previewLog && running ? previewLog.references : references;
    const visibleResults = previewLog ? imageResultsFromLog(previewLog) : results;

    useEffect(() => {
        if (!running || !startedAt) return;
        const timer = window.setInterval(() => setElapsedMs(performance.now() - startedAt), 1000);
        return () => window.clearInterval(timer);
    }, [running, startedAt]);

    useEffect(() => {
        let active = true;
        const syncLogs = async (recoverInterrupted = false) => {
            const syncVersion = ++logsSyncVersionRef.current;
            const nextLogs = recoverInterrupted ? await readAndDiscardInterruptedLogs() : await readStoredLogs();
            if (recoverInterrupted && useImageWorkbenchStore.getState().running) return;
            if (active && syncVersion === logsSyncVersionRef.current) setLogs(nextLogs);
        };
        const handleLogsUpdated = () => void syncLogs(!useImageWorkbenchStore.getState().running);
        void syncLogs(!useImageWorkbenchStore.getState().running);
        window.addEventListener(IMAGE_USAGE_UPDATED_EVENT, handleLogsUpdated);
        return () => {
            active = false;
            window.removeEventListener(IMAGE_USAGE_UPDATED_EVENT, handleLogsUpdated);
        };
    }, []);

    useEffect(() => {
        const wasRunning = wasRunningRef.current;
        wasRunningRef.current = running;
        if (!wasRunning || running) return;
        setPreviewLog(null);
        let active = true;
        const syncVersion = ++logsSyncVersionRef.current;
        void readAndDiscardInterruptedLogs().then((nextLogs) => {
            if (active && syncVersion === logsSyncVersionRef.current) setLogs(nextLogs);
        });
        return () => {
            active = false;
        };
    }, [running]);

    const addReferences = async (files?: FileList | null) => {
        const imageFiles = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
        const nextReferences = await Promise.all(
            imageFiles.map(async (file) => {
                const image = await uploadImage(file);
                return { id: nanoid(), name: file.name, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
            }),
        );
        appendReferences(nextReferences);
    };

    const appendReferences = (items: ReferenceImage[]) => {
        const existing = new Set(references.map(referenceIdentity));
        const unique = items.filter((item) => {
            const identity = referenceIdentity(item);
            if (existing.has(identity)) return false;
            existing.add(identity);
            return true;
        });
        const available = Math.max(0, referenceLimit - references.length);
        const accepted = unique.slice(0, available);
        if (accepted.length < unique.length && apimartPolicy) message.warning(t("apiErrors.apimartTooManyImages", { limit: apimartPolicy.maxReferences }));
        setReferences((value) => [...value, ...accepted].slice(0, referenceLimit));
        return accepted.length;
    };

    const addReferencesFromClipboard = async () => {
        try {
            const items = await navigator.clipboard.read();
            const blobs = await Promise.all(items.flatMap((item) => item.types.filter((type) => type.startsWith("image/")).map((type) => item.getType(type))));
            if (!blobs.length) {
                message.error(t("imageWorkbench.clipboardEmpty"));
                return;
            }
            const nextReferences = await Promise.all(
                blobs.map(async (blob, index) => {
                    const image = await uploadImage(blob);
                    return { id: nanoid(), name: `clipboard-${index + 1}.png`, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
                }),
            );
            const added = appendReferences(nextReferences);
            message.success(t("imageWorkbench.clipboardAdded", { count: added }));
        } catch {
            message.error(t("imageWorkbench.clipboardEmpty"));
        }
    };

    const generate = async () => {
        const agentTaskId = agentTaskIdRef.current;
        agentTaskIdRef.current = undefined;
        const text = prompt.trim();
        if (!text) {
            message.error(t("imageWorkbench.promptRequired"));
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: t("imageWorkbench.promptRequired") });
            return;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning(t("workbench.configFirst"));
            openConfigDialog(true);
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: t("imageWorkbench.configIncomplete") });
            return;
        }

        const snapshot = buildRequestSnapshot();
        if (!snapshot) {
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: t("imageWorkbench.invalidParams") });
            return;
        }

        setElapsedMs(0);
        setRunning(true);
        if (agentTaskId) updateAgentTask(agentTaskId, { status: "running", error: undefined });
        setPreviewLog(null);
        setResults(Array.from({ length: generationCount }, () => ({ id: nanoid(), status: "pending" })));
        const batchStartedAt = performance.now();
        setStartedAt(batchStartedAt);

        const runningLog = buildLog({
            prompt: text,
            model,
            config: { ...snapshot.config, count: String(generationCount) },
            references: snapshot.references,
            durationMs: 0,
            successCount: 0,
            failCount: 0,
            status: "running",
            images: [],
        });
        setActiveLogId(runningLog.id);
        try {
            const { results: result, completedRecord, persistenceError } = await runPersistedGenerationLifecycle({
                runningRecord: runningLog,
                tasks: () => Array.from({ length: generationCount }, (_, index) => runGenerationSlot(index, snapshot)),
                complete: (record, settled) => {
                    const images: GeneratedImage[] = settled.flatMap((item) => (item.status === "fulfilled" ? [item.value] : []));
                    const pendingTasks = settled.flatMap((item) => item.status === "rejected" && item.reason instanceof ProviderTaskPendingError ? [item.reason] : []);
                    return {
                        ...record,
                        durationMs: performance.now() - batchStartedAt,
                        successCount: images.length,
                        failCount: generationCount - images.length - pendingTasks.length,
                        status: pendingTasks.length ? "pending" as const : images.length ? "success" as const : "failed" as const,
                        taskIds: pendingTasks.map((item) => item.taskId),
                        error: pendingTasks[0]?.message,
                        images,
                        thumbnails: images.map((image) => image.dataUrl).filter(Boolean),
                    };
                },
                persist: saveLog,
            });
            const successCount = completedRecord.successCount;
            const failCount = completedRecord.failCount;
            const failed = result.find((item): item is PromiseRejectedResult => item.status === "rejected");
            const error = failed?.reason instanceof Error ? failed.reason.message : failCount ? t("workbench.generationFailed") : undefined;
            if (agentTaskId) updateAgentTask(agentTaskId, { status: successCount ? "succeeded" : "failed", successCount, failCount, error: successCount ? undefined : error });
            if (completedRecord.status === "pending") {
                message.warning(completedRecord.error || t("workbench.pendingConfirmation"));
            } else if (successCount) {
                notifyTaskCompletion({
                    id: `image:${completedRecord.id}`,
                    title: t("taskNotifications.imageTitle"),
                    body: t("taskNotifications.imageDescription", { count: successCount }),
                    route: `/image?result=${encodeURIComponent(completedRecord.id)}`,
                });
            } else {
                message.error(failed?.reason instanceof Error ? failed.reason.message : t("workbench.generationFailed"));
            }
            if (persistenceError) message.warning(t("imageWorkbench.logSaveFailed"));
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : t("workbench.generationFailed");
            setResults((value) => value.map((item) => (item.status === "pending" ? { ...item, status: "failed", error: errorMessage } : item)));
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", successCount: 0, failCount: generationCount, error: errorMessage });
            message.error(errorMessage);
        } finally {
            setElapsedMs(performance.now() - batchStartedAt);
            setRunning(false);
            setStartedAt(0);
        }
    };

    // Handle image-generation commands from the Agent panel by setting the prompt and optionally starting generation.
    useEffect(() => {
        if (!imageCommand || imageCommand.nonce === processedCommandRef.current) return;
        processedCommandRef.current = imageCommand.nonce;
        clearImageCommand();
        if (typeof imageCommand.prompt === "string") setPrompt(imageCommand.prompt);
        if (imageCommand.run && running) {
            if (imageCommand.taskId) updateAgentTask(imageCommand.taskId, { status: "failed", error: t("imageWorkbench.busy") });
            return;
        }
        if (imageCommand.run) {
            agentTaskIdRef.current = imageCommand.taskId;
            setAutoRunToken((value) => value + 1);
        }
    }, [imageCommand, clearImageCommand, running, updateAgentTask]);

    useEffect(() => {
        if (!autoRunToken) return;
        void generate();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoRunToken]);

    const downloadImage = (image: GeneratedImage, index: number) => {
        saveAs(image.dataUrl, `image-${index + 1}.png`);
    };

    const addResultToReferences = async (image: GeneratedImage, index: number) => {
        const stored = image.storageKey ? { url: image.dataUrl, storageKey: image.storageKey, mimeType: image.mimeType || "image/png" } : await uploadImage(image.dataUrl);
        if (appendReferences([{ id: nanoid(), name: `result-${index + 1}.png`, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }])) message.success(t("imageWorkbench.addedReference"));
    };

    const saveResultToAssets = async (image: GeneratedImage, index: number) => {
        const stored = image.storageKey
            ? { url: image.dataUrl, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType || "image/png" }
            : await uploadImage(image.dataUrl);
        addAsset({
            kind: "image",
            title: t("imageWorkbench.resultTitle", { count: index + 1 }),
            coverUrl: stored.url,
            tags: [],
            source: t("imageWorkbench.source"),
            data: { dataUrl: stored.url, storageKey: stored.storageKey, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType },
            metadata: { source: "image-page", prompt },
        });
        message.success(t("common.addedToAssets"));
    };

    const insertPickedAsset = async (payload: InsertAssetPayload) => {
        if (payload.kind === "text") {
            setPrompt(payload.content);
        } else if (payload.kind === "image") {
            const stored = await uploadImage(payload.dataUrl);
            appendReferences([{ id: nanoid(), name: payload.title, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }]);
        } else {
            message.warning(t("imageWorkbench.unsupportedAsset"));
        }
        setAssetPickerOpen(false);
    };

    const createSession = () => {
        if (running) return;
        resetWorkbench();
        setSelectedLogIds([]);
        setPreviewLog(null);
    };

    const deleteSelectedLogs = async () => {
        const refs = selectedLogIds.map((id) => ({ kind: "image" as const, id }));
        try {
            const result = await moveGenerationRecordsToTrash(refs);
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
            notifyImageUsageUpdated();
            await refreshLogs();
            message.success(t("workbench.movedToTrash", { count: result.moved }));
        } catch {
            message.error(t("workbench.moveToTrashFailed"));
        }
    };

    const saveLog = async (log: GenerationLog) => {
        const persistedLog: GenerationLog = {
            ...log,
            source: "workbench",
            operation: log.operation || (log.references.length ? "edit" : "generate"),
            trackingVersion: CREATIVE_TRACKING_VERSION,
            trackedAt: log.trackedAt || log.createdAt || Date.now(),
            updatedAt: Date.now(),
        };
        const serializedLog = serializeLog(persistedLog);
        logsSyncVersionRef.current += 1;
        setLogs((current) => upsertGenerationRecord(current, persistedLog));
        await runGenerationLogOperation(async () => {
            try {
                await logStore.setItem(log.id, serializedLog);
            } catch (error) {
                logStore.retainVolatileItem(log.id, serializedLog);
                throw error;
            }
        });
        if (persistedLog.status === "success" || persistedLog.status === "failed") {
            await recordImageCreativeActivity({
                id: `image:${persistedLog.id}`,
                occurredAt: persistedLog.trackedAt!,
                source: "workbench",
                operation: persistedLog.operation as Extract<CreativeOperation, "generate" | "edit" | "outpaint" | "upscale" | "three-view">,
                status: persistedLog.status,
                model: persistedLog.model,
                size: persistedLog.size,
                quality: persistedLog.quality,
                requestedCount: persistedLog.imageCount,
                successCount: persistedLog.successCount,
                failCount: persistedLog.failCount,
            });
        }
        notifyImageUsageUpdated();
    };

    const refreshLogs = async () => {
        const syncVersion = ++logsSyncVersionRef.current;
        const nextLogs = await readStoredLogs();
        if (syncVersion === logsSyncVersionRef.current) setLogs(nextLogs);
    };

    const previewGenerationLog = async (log: GenerationLog) => {
        if (log.id === activeLogId && running) {
            setPreviewLog(null);
            setLogsOpen(false);
            return;
        }
        setPreviewLog(log);
        setLogsOpen(false);
        if (running) return;
        setPrompt(log.prompt);
        setReferences(log.references || []);
        if (log.config.imageModel || log.model) updateConfig("imageModel", log.config.imageModel || log.model);
        if (log.config.quality) updateConfig("quality", log.config.quality);
        if (log.config.size) updateConfig("size", log.config.size);
        if (log.config.count) updateConfig("count", log.config.count);
        setResults(imageResultsFromLog(log));
    };

    const resumePendingLog = async (log: GenerationLog) => {
        const taskIds = log.taskIds || [];
        if (running || !taskIds.length) return;
        const taskConfig = { ...effectiveConfig, ...log.config, model: log.model, imageModel: log.model, count: "1" };
        setPreviewLog(null);
        setActiveLogId(log.id);
        setElapsedMs(0);
        setStartedAt(performance.now());
        setRunning(true);
        setResults([...log.images.map((image) => ({ id: image.id, status: "success" as const, image })), ...taskIds.map((taskId) => ({ id: taskId, status: "pending" as const }))]);
        try {
            const settled = await Promise.allSettled(taskIds.map((taskId) => log.references.length ? requestEdit(taskConfig, log.prompt, log.references, undefined, { resumeTaskId: taskId }) : requestGeneration(taskConfig, log.prompt, { resumeTaskId: taskId })));
            const pendingTasks = settled.flatMap((item) => item.status === "rejected" && item.reason instanceof ProviderTaskPendingError ? [item.reason] : []);
            const failures = settled.filter((item) => item.status === "rejected" && !(item.reason instanceof ProviderTaskPendingError));
            const firstFailure = failures[0]?.status === "rejected" ? failures[0].reason : undefined;
            const resumedImages = await Promise.all(
                settled.flatMap((item) => item.status === "fulfilled" ? item.value : []).map(async (image) => {
                    const stored = await uploadImage(image.dataUrl);
                    return { id: image.id, dataUrl: stored.url, storageKey: stored.storageKey, durationMs: Date.now() - log.createdAt, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType };
                }),
            );
            const images = [...log.images, ...resumedImages];
            const nextLog: GenerationLog = {
                ...log,
                durationMs: Date.now() - log.createdAt,
                successCount: images.length,
                failCount: log.failCount + failures.length,
                status: pendingTasks.length ? "pending" : images.length ? "success" : "failed",
                taskIds: pendingTasks.map((item) => item.taskId),
                error: pendingTasks[0]?.message || (firstFailure instanceof Error ? firstFailure.message : failures.length ? t("workbench.generationFailed") : undefined),
                images,
                thumbnails: images.map((image) => image.dataUrl).filter(Boolean),
            };
            await saveLog(nextLog);
            setResults(imageResultsFromLog(nextLog));
            if (nextLog.status === "pending") message.warning(nextLog.error || t("workbench.pendingConfirmation"));
            else if (nextLog.status === "success") message.success(t("imageWorkbench.generated"));
            else message.error(nextLog.error || t("workbench.generationFailed"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("workbench.generationFailed"));
        } finally {
            setElapsedMs(Date.now() - log.createdAt);
            setRunning(false);
            setStartedAt(0);
        }
    };

    useEffect(() => {
        const resultId = searchParams.get("result");
        if (!resultId) return;
        const completedLog = logs.find((log) => log.id === resultId && log.status !== "running");
        if (!completedLog) return;
        void previewGenerationLog(completedLog);
        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete("result");
        setSearchParams(nextParams, { replace: true });
    }, [logs, searchParams, setSearchParams]);

    const buildRequestSnapshot = () => {
        const text = prompt.trim();
        if (!text) {
            message.error(t("imageWorkbench.promptRequired"));
            return null;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning(t("workbench.configFirst"));
            openConfigDialog(true);
            return null;
        }
        if (apimartPolicy && references.length > apimartPolicy.maxReferences) {
            message.error(t("apiErrors.apimartTooManyImages", { limit: apimartPolicy.maxReferences }));
            return null;
        }
        return { text, config: { ...effectiveConfig, model, count: "1" }, references: [...references] };
    };

    const runGenerationSlot = async (index: number, snapshot: { text: string; config: AiConfig; references: ReferenceImage[] }) => {
        const itemStartedAt = performance.now();
        try {
            const result = snapshot.references.length ? await requestEdit(snapshot.config, snapshot.text, snapshot.references) : await requestGeneration(snapshot.config, snapshot.text);
            const image = result[0];
            if (!image) throw new Error(t("imageWorkbench.missingResult"));
            const stored = await uploadImage(image.dataUrl);
            const nextImage = { id: image.id, dataUrl: stored.url, storageKey: stored.storageKey, durationMs: performance.now() - itemStartedAt, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType };
            setResults((value) => updateResultAt(value, index, { status: "success", image: nextImage }));
            return nextImage;
        } catch (error) {
            setResults((value) => updateResultAt(value, index, { status: error instanceof ProviderTaskPendingError ? "pending" : "failed", error: error instanceof Error ? error.message : t("workbench.generationFailed") }));
            throw error;
        }
    };

    const retryResult = async (index: number) => {
        if (running) return;
        const snapshot = buildRequestSnapshot();
        if (!snapshot) return;
        setPreviewLog(null);
        setResults((value) => updateResultAt(value, index, { status: "pending", error: undefined, image: undefined }));
        const retryStartedAt = performance.now();
        setElapsedMs(0);
        setStartedAt(retryStartedAt);
        setRunning(true);
        try {
            const image = await runGenerationSlot(index, snapshot);
            setResults((value) => updateResultAt(value, index, { image }));
            await saveLog(
                buildLog({
                    prompt: snapshot.text,
                    model,
                    config: { ...snapshot.config, count: "1" },
                    references: snapshot.references,
                    durationMs: performance.now() - retryStartedAt,
                    successCount: 1,
                    failCount: 0,
                    status: "success",
                    images: [image],
                }),
            ).catch(() => undefined);
            message.success(t("workbench.retrySuccess"));
        } catch (error) {
            const pending = error instanceof ProviderTaskPendingError;
            const detail = error instanceof Error ? error.message : t("workbench.generationFailed");
            await saveLog(buildLog({
                prompt: snapshot.text,
                model,
                config: { ...snapshot.config, count: "1" },
                references: snapshot.references,
                durationMs: performance.now() - retryStartedAt,
                successCount: 0,
                failCount: pending ? 0 : 1,
                status: pending ? "pending" : "failed",
                images: [],
                taskIds: pending ? [error.taskId] : undefined,
                error: detail,
            })).catch(() => undefined);
            if (pending) message.warning(detail);
            else message.error(detail);
        } finally {
            setRunning(false);
            setStartedAt(0);
        }
    };

    return (
        <div ref={workspaceRef} className="flex h-full flex-col overflow-hidden bg-background text-foreground">
            <main className={cn("grid min-h-0 flex-1 gap-3 p-3", compactLayout ? "grid-cols-1 overflow-y-auto" : "grid-cols-[304px_minmax(0,1fr)] overflow-hidden xl:grid-cols-[320px_minmax(0,1fr)]")}>
                {!compactLayout ? <aside className="thin-scrollbar min-h-0 overflow-y-auto rounded-xl border border-border bg-card p-4">
                    <LogPanel
                        logs={logs}
                        running={running}
                        selectedLogIds={selectedLogIds}
                        activeLogId={previewLog?.id || activeLogId}
                        onSelectedLogIdsChange={setSelectedLogIds}
                        onCreateSession={createSession}
                        onDeleteSelected={() => setDeleteConfirmOpen(true)}
                        onPreviewLog={(log) => void previewGenerationLog(log)}
                    />
                </aside> : null}

                <section className={cn("flex min-h-0 flex-col", !compactLayout && "overflow-hidden")}>
                    <header className="flex shrink-0 items-center justify-between gap-4 px-1 py-1">
                        <h1 className="type-page-title">{t("imageWorkbench.title")}</h1>
                        <div className="flex shrink-0 items-center gap-2">
                            {compactLayout ? <div className="flex gap-2">
                                <Button icon={<History className="size-4" />} onClick={() => setLogsOpen(true)}>
                                    {t("workbench.logs")}
                                </Button>
                                <Button icon={<SlidersHorizontal className="size-4" />} onClick={() => setSettingsOpen(true)}>
                                    {t("workbench.settings")}
                                </Button>
                            </div> : null}
                            {!compactLayout ? <Tooltip title={t(composerCollapsed ? "canvas.expandPanel" : "canvas.collapsePanel")}>
                                <Button
                                    type="text"
                                    icon={composerCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
                                    aria-label={t(composerCollapsed ? "canvas.expandPanel" : "canvas.collapsePanel")}
                                    aria-expanded={!composerCollapsed}
                                    onClick={() => setComposerCollapsed((value) => !value)}
                                />
                            </Tooltip> : null}
                        </div>
                    </header>

                    <div className={cn("mt-3 grid gap-3", compactLayout ? "grid-cols-1" : "min-h-0 flex-1 overflow-hidden", effectiveComposerCollapsed ? "grid-cols-1" : !compactLayout && "grid-cols-[380px_minmax(0,1fr)]")}>
                        <div className={cn("thin-scrollbar flex flex-col rounded-xl border border-border bg-card p-4", !compactLayout && "min-h-0 overflow-y-auto", effectiveComposerCollapsed && "hidden")}>
                            <div className="space-y-5">
                                <div>
                                    <div className="mb-2 flex items-center justify-between gap-3">
                                        <span className="text-sm font-medium">{t("workbench.prompt")}</span>
                                        <div className="flex gap-2">
                                            <Button size="small" icon={<BookOpen className="size-3.5" />} onClick={() => setPromptDialogOpen(true)}>
                                                {t("workbench.viewPrompts")}
                                            </Button>
                                            <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => setAssetPickerOpen(true)}>
                                                {t("workbench.viewAssets")}
                                            </Button>
                                        </div>
                                    </div>
                                    <Input.TextArea value={visiblePrompt} disabled={Boolean(previewLog && running)} onChange={(event) => setPrompt(event.target.value)} rows={7} placeholder={t("imageWorkbench.promptPlaceholder")} />
                                </div>

                                <div className="min-w-0">
                                    <div className="mb-2 flex items-center justify-between gap-3">
                                        <span className="text-sm font-medium">{t("imageWorkbench.references")}</span>
                                        <div className="flex gap-2">
                                            <Button size="small" disabled={Boolean(previewLog && running)} icon={<ClipboardPaste className="size-3.5" />} onClick={() => void addReferencesFromClipboard()}>
                                                {t("workbench.clipboard")}
                                            </Button>
                                            <Button size="small" disabled={Boolean(previewLog && running)} icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
                                                {t("workbench.upload")}
                                            </Button>
                                        </div>
                                    </div>
                                    <div
                                        className={cn(
                                            "relative grid min-h-24 w-full min-w-0 grid-cols-2 gap-2 rounded-lg border border-dashed p-2 transition-colors",
                                            isReferenceDragActive ? "border-foreground bg-muted/80" : "border-border",
                                        )}
                                        onDragEnter={(event) => {
                                            event.preventDefault();
                                            dragDepthRef.current += 1;
                                            if (event.dataTransfer.types.includes("Files")) setIsReferenceDragActive(true);
                                        }}
                                        onDragOver={(event) => {
                                            event.preventDefault();
                                            event.dataTransfer.dropEffect = "copy";
                                        }}
                                        onDragLeave={(event) => {
                                            event.preventDefault();
                                            dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
                                            if (!dragDepthRef.current) setIsReferenceDragActive(false);
                                        }}
                                        onDrop={(event) => {
                                            event.preventDefault();
                                            dragDepthRef.current = 0;
                                            setIsReferenceDragActive(false);
                                            if (previewLog && running) return;
                                            void addReferences(event.dataTransfer.files);
                                        }}
                                    >
                                        {visibleReferences.map((item, index) => (
                                            <div key={item.id} className="group relative aspect-square min-w-0 overflow-hidden rounded-md border border-border bg-muted/30">
                                                <img src={item.dataUrl} alt={item.name} className="size-full object-cover" />
                                                <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[12px] font-medium text-white">{imageReferenceLabel(index)}</span>
                                                {previewLog && running ? null : <ReferenceOrderButtons index={index} total={visibleReferences.length} onMove={(offset) => setReferences((value) => moveListItem(value, index, offset))} />}
                                                {previewLog && running ? null : <button
                                                    type="button"
                                                    className="absolute right-1 top-1 flex size-7 items-center justify-center rounded-md border border-destructive/35 bg-destructive/15 text-destructive shadow-sm backdrop-blur-sm transition-[color,background-color,border-color] hover:border-destructive/55 hover:bg-destructive/25 focus-visible:ring-2 focus-visible:ring-destructive/30"
                                                    onClick={() => setReferences((value) => value.filter((ref) => ref.id !== item.id))}
                                                    aria-label={t("imageWorkbench.removeReference")}
                                                    title={t("imageWorkbench.removeReference")}
                                                    style={{ color: "var(--destructive)" }}
                                                >
                                                    <Trash2 className="size-3.5" />
                                                </button>}
                                            </div>
                                        ))}
                                        {!visibleReferences.length ? <div className="col-span-full flex min-h-20 items-center justify-center text-center text-sm text-muted-foreground">{isReferenceDragActive ? t("imageWorkbench.dropReferences") : t("imageWorkbench.noReferences")}</div> : null}
                                    </div>
                                </div>

                                <div className={cn("items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm", compactLayout ? "flex" : "flex sm:hidden")}>
                                    <span className="truncate text-muted-foreground">
                                        {modelOptionLabel(effectiveConfig, model)} · {effectiveConfig.size} · {effectiveConfig.quality}
                                    </span>
                                    <Button size="small" type="text" icon={<SlidersHorizontal className="size-4" />} onClick={() => setSettingsOpen(true)}>
                                        {t("workbench.adjust")}
                                    </Button>
                                </div>

                                <div className={cn("hidden gap-4", !compactLayout && "sm:grid sm:grid-cols-2")}>
                                    <GenerationSettings config={effectiveConfig} model={model} referenceCount={references.length} updateConfig={updateConfig} openConfigDialog={openConfigDialog} />
                                </div>
                            </div>

                            <div className="mt-auto pt-6">
                                <Button type="primary" size="large" block icon={<Sparkles className="size-4" />} loading={running} disabled={!canGenerate || running} onClick={() => void generate()}>
                                    {t("workbench.generate")}
                                </Button>
                            </div>
                        </div>

                        <div className={cn("thin-scrollbar rounded-xl border border-border bg-card p-4 lg:p-5", compactLayout ? "min-h-[420px]" : "min-h-0 overflow-y-auto")}>
                            <div className="mb-4 flex items-center justify-between gap-3">
                                <h2 className="type-section-title">{t("workbench.results")}</h2>
                                {displayedLog ? <Tag className="type-numeric m-0 px-2 py-1">{t("workbench.elapsed", { time: formatDuration(displayedLog.durationMs) })}</Tag> : running ? <Tag className="type-numeric m-0 px-2 py-1">{t("workbench.waiting", { time: formatDuration(elapsedMs) })}</Tag> : null}
                            </div>
                            {visibleResults.length ? (
                                <div className="grid justify-start gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 420px))" }}>
                                    {visibleResults.map((result, index) =>
                                        result.status === "success" && result.image ? (
                                            <ResultImageCard key={result.id} image={result.image} index={index} onEdit={addResultToReferences} onDownload={downloadImage} onSaveAsset={saveResultToAssets} />
                                        ) : result.status === "failed" ? (
                                            <FailedImageCard key={result.id} error={result.error || t("workbench.generationFailed")} running={running} onRetry={() => retryResult(index)} />
                                        ) : (
                                            <PendingImageCard key={result.id} awaitingConfirmation={Boolean(pendingQueryLog)} onResume={pendingQueryLog ? () => void resumePendingLog(pendingQueryLog) : undefined} />
                                        ),
                                    )}
                                </div>
                            ) : (
                                <div className="flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-background/45 text-center lg:min-h-[560px]">
                                    <ImagePlus className="mb-4 size-11 text-muted-foreground/55" />
                                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("imageWorkbench.empty")} />
                                </div>
                            )}
                        </div>
                    </div>
                </section>
            </main>
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                    void addReferences(event.target.files);
                    event.target.value = "";
                }}
            />
            <Drawer title={t("workbench.logs")} placement="bottom" size="large" open={logsOpen} onClose={() => setLogsOpen(false)}>
                <LogPanel
                    logs={logs}
                    running={running}
                    selectedLogIds={selectedLogIds}
                    activeLogId={previewLog?.id || activeLogId}
                    onSelectedLogIdsChange={setSelectedLogIds}
                    onCreateSession={createSession}
                    onDeleteSelected={() => setDeleteConfirmOpen(true)}
                    onPreviewLog={(log) => void previewGenerationLog(log)}
                />
            </Drawer>
            <Drawer title={t("workbench.settings")} placement="bottom" size="82vh" open={settingsOpen} onClose={() => setSettingsOpen(false)}>
                <div className="grid grid-cols-2 gap-3 pb-4">
                    <GenerationSettings config={effectiveConfig} model={model} referenceCount={references.length} updateConfig={updateConfig} openConfigDialog={openConfigDialog} />
                </div>
            </Drawer>
            <PromptSelectDialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen} onSelect={setPrompt} />
            <AssetPickerModal open={assetPickerOpen} defaultTab="my-assets" onInsert={(payload) => void insertPickedAsset(payload)} onClose={() => setAssetPickerOpen(false)} />
            <Modal title={t("workbench.deleteLogs")} open={deleteConfirmOpen} onCancel={() => setDeleteConfirmOpen(false)} onOk={deleteSelectedLogs} okText={t("workbench.moveToTrash")} okButtonProps={{ danger: true }} cancelText={t("common.cancel")}>
                {t("workbench.deleteLogsConfirm", { count: selectedLogIds.length })}
            </Modal>
        </div>
    );
}

function GenerationSettings({ config, model, referenceCount, updateConfig, openConfigDialog }: { config: AiConfig; model: string; referenceCount: number; updateConfig: UpdateAiConfig; openConfigDialog: (shouldPromptContinue?: boolean, tab?: ConfigTabKey) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();

    return (
        <>
            <label className="col-span-2 block min-w-0">
                <span className="mb-1.5 block text-sm font-semibold sm:mb-2 sm:text-base">{t("workbench.model")}</span>
                <ModelPicker config={config} value={model} onChange={(value) => updateConfig("imageModel", value)} capability="image" fullWidth onMissingConfig={() => openConfigDialog(false, "channels")} />
            </label>
            <div className="col-span-2">
                <ImageSettingsPanel config={config} onConfigChange={(key, value) => updateConfig(key, value)} theme={theme} showTitle={false} className="space-y-4" maxCount={10} referenceCount={referenceCount} />
            </div>
        </>
    );
}

function ResultImageCard({
    image,
    index,
    onEdit,
    onDownload,
    onSaveAsset,
}: {
    image: GeneratedImage;
    index: number;
    onEdit: (image: GeneratedImage, index: number) => void;
    onDownload: (image: GeneratedImage, index: number) => void;
    onSaveAsset: (image: GeneratedImage, index: number) => void;
}) {
    const { t } = useTranslation();
    return (
        <div className="overflow-hidden rounded-xl border border-border bg-background">
            <Image src={image.dataUrl} alt={t("imageWorkbench.resultAlt", { count: index + 1 })} className="aspect-square object-cover" />
            <div className="space-y-2 border-t border-border px-3 py-2.5">
                <div className="type-numeric flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
                    <span>
                        {image.width}x{image.height}
                    </span>
                    <span>{formatBytes(image.bytes)}</span>
                    <span>{formatDuration(image.durationMs)}</span>
                </div>
                <div className="grid min-w-0 gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 9rem), 1fr))" }}>
                    <Tooltip title={t("common.addToAssets")}>
                        <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => void onSaveAsset(image, index)}>
                            {t("common.addToAssets")}
                        </Button>
                    </Tooltip>
                    <Tooltip title={t("imageWorkbench.addReference")}>
                        <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<PenLine className="size-3.5" />} onClick={() => void onEdit(image, index)}>
                            {t("imageWorkbench.addReference")}
                        </Button>
                    </Tooltip>
                    <Tooltip title={t("common.download")}>
                        <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(image, index)}>
                            {t("common.download")}
                        </Button>
                    </Tooltip>
                </div>
            </div>
        </div>
    );
}

function PendingImageCard({ awaitingConfirmation = false, onResume }: { awaitingConfirmation?: boolean; onResume?: () => void }) {
    const { t } = useTranslation();
    return (
        <div className="relative aspect-square overflow-hidden rounded-xl border border-dashed border-border bg-muted/35">
            <div
                className="absolute inset-0 opacity-60"
                style={{
                    backgroundImage: "radial-gradient(circle, color-mix(in srgb, var(--foreground) 18%, transparent) 1.4px, transparent 1.6px)",
                    backgroundSize: "16px 16px",
                }}
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className={cn("size-6", !awaitingConfirmation && "animate-spin")} />
                <span>{t(awaitingConfirmation ? "workbench.pendingConfirmation" : "workbench.generating")}</span>
                {onResume ? <Button size="small" className="mt-2" onClick={onResume}>{t("workbench.continueQuery")}</Button> : null}
            </div>
        </div>
    );
}

function FailedImageCard({ error, running, onRetry }: { error: string; running: boolean; onRetry: () => void }) {
    const { t } = useTranslation();
    return (
        <div className="overflow-hidden rounded-lg border border-red-200 bg-red-50 dark:border-red-950 dark:bg-red-950/20">
            <div className="flex aspect-square flex-col items-center justify-center gap-3 p-5 text-center">
                <div className="text-sm font-medium text-red-600 dark:text-red-300">{t("workbench.failed")}</div>
                <Typography.Paragraph data-selectable-text ellipsis={{ rows: 4 }} className="!mb-0 !text-xs !text-red-500 dark:!text-red-300">
                    {error}
                </Typography.Paragraph>
            </div>
            <div className="flex justify-end border-t border-red-200 p-3 dark:border-red-950">
                <Button size="small" danger disabled={running} onClick={onRetry}>
                    {t("workbench.retry")}
                </Button>
            </div>
        </div>
    );
}

function imageResultsFromLog(log: GenerationLog): GenerationResult[] {
    const images = log.images.map((image) => ({ id: image.id, status: "success" as const, image }));
    if (log.status === "pending") return [...images, ...(log.taskIds?.length ? log.taskIds : [log.id]).map((id) => ({ id, status: "pending" as const }))];
    if (log.status === "failed" && !images.length) return [{ id: log.id, status: "failed", error: log.error || i18n.t("workbench.generationFailed") }];
    return images;
}

function updateResultAt(results: GenerationResult[], index: number, next: Partial<GenerationResult>) {
    return results.map((item, itemIndex) => (itemIndex === index ? { ...item, ...next } : item));
}

function LogPanel({
    logs,
    running,
    selectedLogIds,
    activeLogId,
    onSelectedLogIdsChange,
    onCreateSession,
    onDeleteSelected,
    onPreviewLog,
}: {
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
                ? logs.filter((log) => [log.title, log.prompt, log.model, log.time, log.size, log.quality, log.config?.model, log.config?.imageModel, log.config?.size, log.config?.quality].some((value) => String(value || "").toLocaleLowerCase().includes(deferredSearch)))
                : logs,
        [deferredSearch, logs],
    );
    const selectableLogIds = filteredLogs.filter((log) => log.status !== "running" && log.status !== "pending").map((log) => log.id);
    const selectedSelectableLogIds = selectedLogIds.filter((id) => selectableLogIds.includes(id));
    const allSelected = Boolean(selectableLogIds.length) && selectableLogIds.every((id) => selectedLogIds.includes(id));
    const toggleAll = () => onSelectedLogIdsChange(allSelected ? selectedLogIds.filter((id) => !selectableLogIds.includes(id)) : Array.from(new Set([...selectedLogIds, ...selectableLogIds])));
    const updateSearch = (value: string) => {
        setSearch(value);
        if (selectedLogIds.length) onSelectedLogIdsChange([]);
    };

    return (
        <>
            <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                    <h2 className="type-section-title">{t("workbench.logs")}</h2>
                </div>
                <Tag className="type-numeric m-0">{deferredSearch ? t("workbench.filteredCount", { count: filteredLogs.length, total: logs.length }) : logs.length}</Tag>
            </div>
            <Input allowClear value={search} prefix={<Search className="size-4 text-muted-foreground" />} placeholder={t("workbench.searchLogs")} className="mb-3" onChange={(event) => updateSearch(event.target.value)} />
            <div className="mb-4 flex flex-wrap gap-2">
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
            <div className="space-y-3">
                {filteredLogs.map((log) => (
                    <LogCard
                        key={log.id}
                        log={log}
                        selected={selectedLogIds.includes(log.id)}
                        active={activeLogId === log.id}
                        pointerHalo={pointerHalo}
                        onSelectedChange={(checked) => onSelectedLogIdsChange(checked ? [...selectedLogIds, log.id] : selectedLogIds.filter((id) => id !== log.id))}
                        onClick={() => onPreviewLog(log)}
                    />
                ))}
                {!filteredLogs.length ? <div className="flex min-h-48 items-center justify-center rounded-xl border border-dashed border-border bg-background/45 text-center text-sm text-muted-foreground">{logs.length ? t("workbench.noMatchingLogs") : t("workbench.noLogs")}</div> : null}
            </div>
        </>
    );
}

function LogCard({ log, selected, active, pointerHalo, onSelectedChange, onClick }: { log: GenerationLog; selected: boolean; active: boolean; pointerHalo: PointerHaloController<HTMLDivElement>; onSelectedChange: (checked: boolean) => void; onClick: () => void }) {
    const { t } = useTranslation();
    const { token } = antdTheme.useToken();
    const thumbnails = (log.thumbnails || []).filter(Boolean).slice(0, 4);
    const selectionDisabled = log.status === "running" || log.status === "pending";
    const status =
        log.status === "running"
            ? { icon: <LoaderCircle className="size-3.5 animate-spin" />, label: t("workbench.generating"), color: token.colorWarning }
            : log.status === "pending"
              ? { icon: <LoaderCircle className="size-3.5" />, label: t("workbench.pendingConfirmation"), color: token.colorWarning }
            : log.status === "failed"
              ? { icon: <CircleX className="size-3.5" />, label: t("workbench.failed"), color: token.colorError }
              : { icon: <CheckCircle2 className="size-3.5" />, label: t("workbench.completed"), color: token.colorSuccess };

    return (
        <div
            data-halo-surface
            data-active={active ? "true" : undefined}
            data-selected={selected ? "true" : undefined}
            data-selection-disabled={selectionDisabled ? "true" : undefined}
            data-log-status={log.status}
            className={cn("generation-log-card group relative isolate block w-full overflow-hidden rounded-lg border border-border bg-background p-3 text-left", active && "generation-log-card-active", selected && "generation-log-card-selected", selectionDisabled && "generation-log-card-selection-disabled")}
            onPointerEnter={pointerHalo.onPointerEnter}
            onPointerMove={pointerHalo.onPointerMove}
            onPointerLeave={pointerHalo.onPointerLeave}
            onPointerDown={pointerHalo.onPointerDown}
            onPointerCancel={pointerHalo.onPointerCancel}
        >
            <span aria-hidden="true" className="generation-log-halo" />
            <span aria-hidden="true" className="generation-log-selection" />
            <span aria-hidden="true" data-halo-bloom className="interaction-halo-bloom" />
            <div className="relative z-[1] grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
                <span data-halo-ignore className="mt-1" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
                    <Checkbox aria-label={t("workbench.selectLog", { name: log.title })} checked={selected} disabled={selectionDisabled} onChange={(event) => onSelectedChange(event.target.checked)} />
                </span>
                <button type="button" data-log-open aria-current={active ? "true" : undefined} className="min-w-0 text-left" onClick={onClick}>
                    <div className="min-w-0 truncate text-base font-semibold leading-6 text-foreground" title={log.title}>
                            {log.title}
                    </div>
                    <span className="mt-1.5 inline-flex items-center gap-1.5 text-sm font-medium leading-5" style={{ color: status.color }}>
                        {status.icon}
                        {status.label}
                    </span>
                    {thumbnails.length ? (
                        <div className="mt-2.5 flex gap-1.5 overflow-hidden">
                            {thumbnails.map((image, index) => (
                                <img key={`${log.id}-${index}`} src={image} alt="" className="size-10 shrink-0 rounded-md object-cover" />
                            ))}
                        </div>
                    ) : null}
                    <div className="mt-3 grid min-w-0 grid-cols-2 gap-x-3 gap-y-1 text-xs leading-5 text-muted-foreground">
                        <span>{t("workbench.itemCount", { count: log.imageCount })}</span>
                        {log.status !== "running" ? <span>{t("workbench.successCount", { count: log.successCount ?? log.imageCount })}</span> : null}
                        {log.failCount ? <span style={{ color: token.colorError }}>{t("workbench.failCount", { count: log.failCount })}</span> : null}
                        {log.status !== "running" ? <span className="type-numeric">{formatDuration(log.durationMs)}</span> : null}
                    </div>
                    <div className="type-numeric mt-2 truncate border-t border-border/70 pt-2 text-xs text-muted-foreground/75" title={log.time}>
                        {log.time}
                    </div>
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
    const logs = await Promise.all([...values.values()].filter((value) => value.source !== "canvas" && !value.trashedAt && !value.purgedAt).map(normalizeLog));
    return logs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

async function readAndDiscardInterruptedLogs() {
    const logs = await readStoredLogs();
    if (useImageWorkbenchStore.getState().running) return logs;
    const interrupted = logs.filter((log) => log.status === "running");
    if (!interrupted.length) return logs;
    const interruptedIds = new Set(interrupted.map((log) => log.id));
    const removals = await runGenerationLogOperation(() => Promise.allSettled(interrupted.map((log) => logStore.removeItem(log.id))));
    if (removals.some((result) => result.status === "fulfilled")) notifyImageUsageUpdated();
    return logs.filter((log) => !interruptedIds.has(log.id));
}

async function normalizeLog(log: Partial<GenerationLog>): Promise<GenerationLog> {
    const references = await Promise.all(
        (log.references || []).map(async (item) => ({
            ...item,
            dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl),
        })),
    );
    const images = await Promise.all(
        (log.images || []).map(async (item) => ({
            ...item,
            dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl),
        })),
    );
    const config = normalizeLogConfig(log);
    return {
        id: log.id || nanoid(),
        createdAt: log.createdAt || Date.now(),
        title: log.title || log.model || i18n.t("workbench.untitled"),
        prompt: log.prompt || log.title || "",
        time: log.time || new Date().toLocaleString(i18n.resolvedLanguage, { hour12: false }),
        model: log.model || config.imageModel || "",
        config,
        references,
        durationMs: log.durationMs || 0,
        successCount: log.successCount ?? log.imageCount ?? 0,
        failCount: log.failCount || 0,
        imageCount: log.imageCount || log.successCount || 0,
        size: log.size || config.size || "",
        quality: log.quality || config.quality || "",
        status: log.status || "success",
        taskIds: log.taskIds || [],
        error: log.error,
        images,
        thumbnails: images.map((image) => image.dataUrl).filter(Boolean),
        updatedAt: log.updatedAt,
        trashedAt: log.trashedAt,
        purgedAt: log.purgedAt,
        formerOutputStorageKeys: log.formerOutputStorageKeys,
        source: "workbench",
        operation: log.operation || (references.length ? "edit" : "generate"),
        trackingVersion: log.trackingVersion,
        trackedAt: log.trackedAt,
    };
}

function serializeLog(log: GenerationLog): GenerationLog {
    return {
        ...log,
        references: log.references.map((item) => ({ ...item, dataUrl: item.storageKey ? "" : item.dataUrl })),
        images: log.images.map((image) => ({ ...image, dataUrl: image.storageKey ? "" : image.dataUrl })),
        thumbnails: [],
    };
}

function normalizeLogConfig(log: Partial<GenerationLog>): GenerationLogConfig {
    return {
        model: log.config?.model || log.model || "",
        imageModel: log.config?.imageModel || log.model || "",
        quality: log.config?.quality || log.quality || "",
        size: log.config?.size || log.size || "",
        count: log.config?.count || String(log.imageCount || log.successCount || 1),
    };
}

function moveListItem<T>(items: T[], index: number, offset: number) {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= items.length) return items;
    const next = [...items];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    return next;
}

function referenceIdentity(item: Pick<ReferenceImage, "storageKey" | "dataUrl">) {
    return item.storageKey || item.dataUrl;
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

function buildLog({
    prompt,
    model,
    config,
    references,
    durationMs,
    successCount,
    failCount,
    status,
    images,
    taskIds,
    error,
}: {
    prompt: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    durationMs: number;
    successCount: number;
    failCount: number;
    status: GenerationLog["status"];
    images: GeneratedImage[];
    taskIds?: string[];
    error?: string;
}): GenerationLog {
    const logConfig = {
        model: config.model,
        imageModel: config.imageModel,
        quality: config.quality,
        size: config.size,
        count: config.count,
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
        durationMs,
        successCount,
        failCount,
        imageCount: Number(logConfig.count) || successCount,
        size: logConfig.size,
        quality: logConfig.quality,
        status,
        taskIds,
        error,
        images,
        thumbnails: images.map((image) => image.dataUrl).filter(Boolean),
        source: "workbench",
        operation: references.length ? "edit" : "generate",
        trackingVersion: CREATIVE_TRACKING_VERSION,
        trackedAt: Date.now(),
    };
}
