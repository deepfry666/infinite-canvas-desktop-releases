import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, App, Button, Checkbox, Empty, Input, Modal, Spin, Tag } from "antd";
import { AlertTriangle, ArchiveRestore, ImageIcon, Link2, RefreshCcw, ShieldCheck, Trash2, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import { StandardPageHeader } from "@/components/layout/standard-page-header";
import {
    listGenerationTrash,
    inspectGenerationRecordReferences,
    purgeGenerationRecords,
    restoreGenerationRecords,
    type GenerationReferenceReport,
    type GenerationRecordRef,
    type GenerationTrashEntry,
} from "@/services/generation-trash";
import { cn } from "@/lib/utils";

type TrashFilter = "all" | GenerationRecordRef["kind"];
type BusyAction = "restore" | "purge" | null;
type PurgeSummary = { records: number; deletedFiles: number; protectedFiles: number; failedFiles: number };

const filters: TrashFilter[] = ["all", "image", "video"];

export default function TrashPage() {
    const { message } = App.useApp();
    const { i18n, t } = useTranslation();
    const [entries, setEntries] = useState<GenerationTrashEntry[]>([]);
    const [filter, setFilter] = useState<TrashFilter>("all");
    const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    const [busyAction, setBusyAction] = useState<BusyAction>(null);
    const [purgeTarget, setPurgeTarget] = useState<GenerationRecordRef[] | null>(null);
    const [clearOpen, setClearOpen] = useState(false);
    const [clearPhrase, setClearPhrase] = useState("");
    const [lastPurgeResult, setLastPurgeResult] = useState<PurgeSummary | null>(null);
    const [referenceEntry, setReferenceEntry] = useState<GenerationTrashEntry | null>(null);
    const [referenceReport, setReferenceReport] = useState<GenerationReferenceReport | null>(null);
    const [referenceLoading, setReferenceLoading] = useState(false);
    const referenceRequestRef = useRef(0);

    const loadEntries = useCallback(async () => {
        setLoading(true);
        setLoadFailed(false);
        try {
            const nextEntries = await listGenerationTrash();
            setEntries(nextEntries);
            setSelectedKeys((keys) => {
                const available = new Set(nextEntries.map(entryKey));
                return keys.filter((key) => available.has(key));
            });
        } catch {
            setLoadFailed(true);
            message.error(t("trash.loadFailed"));
        } finally {
            setLoading(false);
        }
    }, [message, t]);

    useEffect(() => {
        void loadEntries();
    }, [loadEntries]);

    const counts = useMemo(
        () => ({ all: entries.length, image: entries.filter((entry) => entry.ref.kind === "image").length, video: entries.filter((entry) => entry.ref.kind === "video").length }),
        [entries],
    );
    const visibleEntries = useMemo(() => (filter === "all" ? entries : entries.filter((entry) => entry.ref.kind === filter)), [entries, filter]);
    const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
    const selectedRefs = useMemo(() => entries.filter((entry) => selectedKeySet.has(entryKey(entry))).map((entry) => entry.ref), [entries, selectedKeySet]);
    const visibleKeys = useMemo(() => visibleEntries.map(entryKey), [visibleEntries]);
    const selectedVisibleCount = visibleKeys.reduce((count, key) => count + Number(selectedKeySet.has(key)), 0);
    const allVisibleSelected = visibleKeys.length > 0 && selectedVisibleCount === visibleKeys.length;
    const requiredClearPhrase = t("trash.confirmClear.phrase");
    const busy = busyAction !== null;

    const selectFilter = (nextFilter: TrashFilter) => {
        setFilter(nextFilter);
        setSelectedKeys([]);
    };
    const toggleEntry = (entry: GenerationTrashEntry, checked: boolean) => {
        const key = entryKey(entry);
        setSelectedKeys((keys) => (checked ? [...new Set([...keys, key])] : keys.filter((item) => item !== key)));
    };
    const toggleVisible = () => {
        setSelectedKeys((keys) => {
            if (allVisibleSelected) return keys.filter((key) => !visibleKeys.includes(key));
            return [...new Set([...keys, ...visibleKeys])];
        });
    };

    const restore = async (refs: GenerationRecordRef[]) => {
        if (!refs.length || busy) return;
        setBusyAction("restore");
        try {
            const result = await restoreGenerationRecords(refs);
            message.success(t("trash.restoreSuccess", { count: result.restored }));
            setSelectedKeys([]);
            await loadEntries();
        } catch {
            message.error(t("trash.restoreFailed"));
        } finally {
            setBusyAction(null);
        }
    };

    const purge = async (refs: GenerationRecordRef[]) => {
        if (!refs.length || busy) return;
        setBusyAction("purge");
        try {
            const result = await purgeGenerationRecords(refs);
            const feedback = { count: result.purged, deletedFiles: result.deletedFiles, protectedFiles: result.protectedFiles, failedFiles: result.failedFiles };
            setLastPurgeResult({ records: result.purged, deletedFiles: result.deletedFiles, protectedFiles: result.protectedFiles, failedFiles: result.failedFiles });
            if (result.failedFiles) message.warning(t("trash.purgePartial", feedback));
            else message.success(t("trash.purgeSuccess", feedback));
            setSelectedKeys([]);
            setPurgeTarget(null);
            setClearOpen(false);
            setClearPhrase("");
            await loadEntries();
        } catch {
            message.error(t("trash.purgeFailed"));
        } finally {
            setBusyAction(null);
        }
    };

    const viewReferences = async (entry: GenerationTrashEntry) => {
        const requestId = ++referenceRequestRef.current;
        setReferenceEntry(entry);
        setReferenceReport(null);
        setReferenceLoading(true);
        try {
            const report = await inspectGenerationRecordReferences(entry.ref);
            if (referenceRequestRef.current === requestId) setReferenceReport(report);
        } catch (reason) {
            if (referenceRequestRef.current === requestId) message.error(reason instanceof Error ? reason.message : t("trash.references.failed"));
        } finally {
            if (referenceRequestRef.current === requestId) setReferenceLoading(false);
        }
    };

    return (
        <main className="h-full overflow-auto bg-background text-foreground">
            <div className="mx-auto flex w-full max-w-7xl flex-col px-4 pb-10 sm:px-6 lg:px-8">
                <StandardPageHeader
                    title={t("trash.title")}
                    description={t("trash.description")}
                    actions={(
                        <>
                        <Button type="text" icon={<RefreshCcw className="size-4" />} loading={loading} disabled={busy} onClick={() => void loadEntries()}>
                            {t("trash.refresh")}
                        </Button>
                        <Button type="text" danger icon={<Trash2 className="size-4" />} disabled={!entries.length || busy} onClick={() => setClearOpen(true)}>
                            {t("trash.emptyAll")}
                        </Button>
                        </>
                    )}
                />

                {lastPurgeResult ? (
                    <Alert
                        className="mt-5"
                        type={lastPurgeResult.failedFiles ? "warning" : "success"}
                        showIcon
                        closable
                        message={t(lastPurgeResult.failedFiles ? "trash.result.partialTitle" : "trash.result.title")}
                        description={
                            <div className="mt-1 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-4">
                                <span>{t("trash.result.records", { count: lastPurgeResult.records })}</span>
                                <span>{t("trash.result.deletedFiles", { count: lastPurgeResult.deletedFiles })}</span>
                                <span>{t("trash.result.protectedFiles", { count: lastPurgeResult.protectedFiles })}</span>
                                {lastPurgeResult.failedFiles ? <span>{t("trash.result.failedFiles", { count: lastPurgeResult.failedFiles })}</span> : null}
                            </div>
                        }
                        onClose={() => setLastPurgeResult(null)}
                    />
                ) : null}

                <section className="border-b border-border py-5" aria-label={t("trash.filter.label")}>
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                            <span id="trash-filter-label" className="type-label shrink-0 text-muted-foreground">{t("trash.filter.label")}</span>
                            <div role="radiogroup" aria-labelledby="trash-filter-label" className="grid min-w-0 grid-cols-3 rounded-lg border border-border bg-muted/35 p-1">
                                {filters.map((option) => (
                                    <label key={option} className="relative min-w-0 cursor-pointer">
                                        <input type="radio" name="trash-filter" value={option} checked={filter === option} className="peer sr-only" onChange={() => selectFilter(option)} />
                                        <span className="flex h-8 min-w-0 items-center justify-center rounded-md px-2 text-sm text-muted-foreground transition-colors peer-checked:bg-background peer-checked:font-medium peer-checked:text-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring/50">
                                            <span className="truncate">{t(`trash.filter.${option}`)}</span>
                                            <span className="type-numeric ml-1.5 shrink-0 opacity-60">{counts[option]}</span>
                                        </span>
                                    </label>
                                ))}
                            </div>
                        </div>
                        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-2">
                            <div className="flex min-h-8 items-center justify-between gap-3 sm:justify-start">
                                <Checkbox checked={allVisibleSelected} indeterminate={selectedVisibleCount > 0 && !allVisibleSelected} disabled={!visibleEntries.length || busy} onChange={toggleVisible}>
                                    {allVisibleSelected ? t("trash.cancelSelection") : t("trash.selectAll")}
                                </Checkbox>
                                {selectedRefs.length ? <span className="type-numeric text-sm text-muted-foreground">{t("trash.selected", { count: selectedRefs.length })}</span> : null}
                            </div>
                            <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:flex">
                                <Button className="w-full sm:w-auto" icon={<ArchiveRestore className="size-4" />} loading={busyAction === "restore"} disabled={!selectedRefs.length || busyAction === "purge"} onClick={() => void restore(selectedRefs)}>
                                    {t("trash.restoreSelected")}
                                </Button>
                                <Button className="w-full sm:w-auto" danger icon={<Trash2 className="size-4" />} disabled={!selectedRefs.length || busy} onClick={() => setPurgeTarget(selectedRefs)}>
                                    {t("trash.deleteSelected")}
                                </Button>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="py-7">
                    {loading && !entries.length ? (
                        <div className="flex min-h-[360px] items-center justify-center"><Spin size="large" /></div>
                    ) : loadFailed ? (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("trash.loadFailed")} className="py-20">
                            <Button icon={<RefreshCcw className="size-4" />} onClick={() => void loadEntries()}>{t("trash.retry")}</Button>
                        </Empty>
                    ) : visibleEntries.length ? (
                        <div className="grid gap-3 lg:grid-cols-2">
                            {visibleEntries.map((entry) => (
                                <TrashRecordCard
                                    key={entryKey(entry)}
                                    entry={entry}
                                    locale={i18n.language}
                                    selected={selectedKeySet.has(entryKey(entry))}
                                    disabled={busy}
                                    restoring={busyAction === "restore"}
                                    onSelectedChange={(checked) => toggleEntry(entry, checked)}
                                    onViewReferences={() => void viewReferences(entry)}
                                    onRestore={() => void restore([entry.ref])}
                                    onPurge={() => setPurgeTarget([entry.ref])}
                                />
                            ))}
                        </div>
                    ) : (
                        <Empty
                            image={<Trash2 className="mx-auto size-10 text-muted-foreground/45" />}
                            description={
                                <div className="space-y-1">
                                    <div className="text-foreground">{t(entries.length ? "trash.empty.filteredTitle" : "trash.empty.title")}</div>
                                    <div className="text-sm text-muted-foreground">{t(entries.length ? "trash.empty.filteredDescription" : "trash.empty.description")}</div>
                                </div>
                            }
                            className="py-20"
                        />
                    )}
                </section>
            </div>

            <Modal
                title={t("trash.confirmPurge.title")}
                open={Boolean(purgeTarget)}
                centered
                okText={t("trash.confirmPurge.confirm")}
                cancelText={t("trash.confirmPurge.cancel")}
                okButtonProps={{ danger: true, loading: busyAction === "purge" }}
                cancelButtonProps={{ disabled: busy }}
                closable={!busy}
                keyboard={!busy}
                mask={{ closable: !busy }}
                onCancel={() => setPurgeTarget(null)}
                onOk={() => void purge(purgeTarget || [])}
            >
                <PurgeNotice count={purgeTarget?.length || 0} />
            </Modal>

            <Modal
                title={t("trash.confirmClear.title")}
                open={clearOpen}
                centered
                okText={t("trash.confirmClear.confirm")}
                cancelText={t("trash.confirmClear.cancel")}
                okButtonProps={{ danger: true, disabled: clearPhrase.trim() !== requiredClearPhrase, loading: busyAction === "purge" }}
                cancelButtonProps={{ disabled: busy }}
                closable={!busy}
                keyboard={!busy}
                mask={{ closable: !busy }}
                onCancel={() => setClearOpen(false)}
                onOk={() => void purge(entries.map((entry) => entry.ref))}
                afterClose={() => setClearPhrase("")}
            >
                <PurgeNotice count={entries.length} clear />
                <label className="mt-5 block text-sm text-foreground" htmlFor="trash-clear-confirmation">{t("trash.confirmClear.inputLabel", { phrase: requiredClearPhrase })}</label>
                <Input
                    id="trash-clear-confirmation"
                    className="mt-2"
                    value={clearPhrase}
                    disabled={busy}
                    status={clearPhrase.trim() !== "" && clearPhrase.trim() !== requiredClearPhrase ? "error" : undefined}
                    placeholder={requiredClearPhrase}
                    autoComplete="off"
                    onChange={(event) => setClearPhrase(event.target.value)}
                    onPressEnter={() => {
                        if (clearPhrase.trim() === requiredClearPhrase) void purge(entries.map((entry) => entry.ref));
                    }}
                />
            </Modal>

            <ReferenceModal
                entry={referenceEntry}
                report={referenceReport}
                loading={referenceLoading}
                onClose={() => {
                    referenceRequestRef.current += 1;
                    setReferenceEntry(null);
                    setReferenceReport(null);
                    setReferenceLoading(false);
                }}
            />
        </main>
    );
}

function TrashRecordCard({ entry, locale, selected, disabled, restoring, onSelectedChange, onViewReferences, onRestore, onPurge }: { entry: GenerationTrashEntry; locale: string; selected: boolean; disabled: boolean; restoring: boolean; onSelectedChange: (checked: boolean) => void; onViewReferences: () => void; onRestore: () => void; onPurge: () => void }) {
    const { t } = useTranslation();
    const view = recordView(entry, entry.ref.kind === "image" ? t("trash.untitledImage") : t("trash.untitledVideo"));
    const KindIcon = entry.ref.kind === "image" ? ImageIcon : Video;

    return (
        <article className={cn("group grid min-h-36 grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-lg border bg-card/80 p-3 transition-colors duration-200 sm:grid-cols-[auto_5.5rem_minmax(0,1fr)]", selected ? "border-foreground/35 bg-muted/45" : "border-border hover:border-foreground/20")} style={{ contentVisibility: "auto", containIntrinsicSize: "144px" }}>
            <div className="col-start-1 row-start-1 pt-1">
                <Checkbox aria-label={t("trash.selectRecord", { name: view.title })} checked={selected} disabled={disabled} onChange={(event) => onSelectedChange(event.target.checked)} />
            </div>
            <div className="relative col-start-2 row-start-1 flex h-[5.5rem] w-[5.5rem] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/45">
                {view.previewUrl ? <img src={view.previewUrl} alt="" className="size-full object-cover" /> : <KindIcon className="size-6 text-muted-foreground/55" />}
                <span className="absolute bottom-1.5 left-1.5 rounded-md bg-background/90 px-1.5 py-0.5 text-[11px] text-foreground backdrop-blur-sm">{t(`trash.kind.${entry.ref.kind}`)}</span>
            </div>
            <div className="col-span-2 row-start-2 flex min-w-0 flex-col sm:col-span-1 sm:col-start-3 sm:row-start-1">
                <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h2 className="truncate text-sm font-semibold leading-5" title={view.title}>{view.title}</h2>
                        <div className="type-numeric mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-muted-foreground">
                            <span>{t("trash.deletedAt", { time: formatTime(entry.deletedAt, locale) })}</span>
                            {view.createdAt ? <span>{t("trash.createdAt", { time: formatTime(view.createdAt, locale) })}</span> : null}
                        </div>
                    </div>
                    <Tag className="m-0 shrink-0">{t(`trash.kind.${entry.ref.kind}`)}</Tag>
                </div>
                {view.prompt ? <p data-selectable-text className="mt-2 line-clamp-2 text-[13px] leading-5 text-muted-foreground" title={view.prompt}>{view.prompt}</p> : null}
                <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-3">
                    <div className="type-numeric flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                        {view.model ? <span className="max-w-48 truncate" title={view.model}>{view.model}</span> : null}
                        {view.spec ? <span>{view.spec}</span> : null}
                        <span>{t("trash.outputs", { count: view.outputCount })}</span>
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-1">
                        <Button type="text" size="small" icon={<Link2 className="size-3.5" />} disabled={disabled} onClick={onViewReferences}>{t("trash.viewReferences")}</Button>
                        <Button type="text" size="small" icon={<ArchiveRestore className="size-3.5" />} loading={restoring} disabled={disabled} onClick={onRestore}>{t("trash.restore")}</Button>
                        <Button type="text" size="small" danger icon={<Trash2 className="size-3.5" />} disabled={disabled} onClick={onPurge}>{t("trash.deletePermanently")}</Button>
                    </div>
                </div>
            </div>
        </article>
    );
}

function ReferenceModal({ entry, report, loading, onClose }: { entry: GenerationTrashEntry | null; report: GenerationReferenceReport | null; loading: boolean; onClose: () => void }) {
    const { t } = useTranslation();
    return (
        <Modal title={t("trash.references.title")} open={Boolean(entry)} footer={null} onCancel={onClose}>
            {loading ? (
                <div className="flex min-h-48 items-center justify-center"><Spin /></div>
            ) : report ? (
                <div className="space-y-4">
                    <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm leading-6 text-muted-foreground">
                        {t("trash.references.summary", { files: report.outputStorageKeys.length, sources: report.sources.length })}
                    </div>
                    {report.sources.length ? (
                        <div className="divide-y divide-border border-y border-border">
                            {report.sources.map((source, index) => (
                                <div key={`${source.kind}-${source.title}-${index}`} className="py-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Tag className="m-0">{t(`trash.references.kinds.${source.kind}`)}</Tag>
                                        <span className="min-w-0 truncate text-sm font-medium">{source.title || t(`trash.references.kinds.${source.kind}`)}</span>
                                        <span className="type-numeric text-xs text-muted-foreground">{t("trash.references.fileCount", { count: source.storageKeys.length })}</span>
                                    </div>
                                    <details className="mt-2 text-xs text-muted-foreground">
                                        <summary className="cursor-pointer select-none">{t("trash.references.showFiles")}</summary>
                                        <div data-selectable-text className="mt-2 space-y-1 break-all rounded-md bg-muted/45 p-2 font-mono">
                                            {source.storageKeys.map((key) => <div key={key}>{key}</div>)}
                                        </div>
                                    </details>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("trash.references.empty")} />
                    )}
                    <div className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
                        <span>{t("trash.references.safety")}</span>
                    </div>
                </div>
            ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("trash.references.failed")} />
            )}
        </Modal>
    );
}

function PurgeNotice({ count, clear = false }: { count: number; clear?: boolean }) {
    const { t } = useTranslation();
    return (
        <div className="pt-1">
            <div className="flex gap-3 rounded-lg border border-destructive/25 bg-destructive/5 p-4">
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
                <div>
                    <p className="text-sm leading-6 text-foreground">{t(clear ? "trash.confirmClear.description" : "trash.confirmPurge.description", { count })}</p>
                    <ul className="mt-3 space-y-2 text-sm leading-5 text-muted-foreground">
                        <li className="flex gap-2"><Trash2 className="mt-0.5 size-4 shrink-0 text-destructive" /><span>{t("trash.confirmPurge.irreversible")}</span></li>
                        <li className="flex gap-2"><Trash2 className="mt-0.5 size-4 shrink-0 text-destructive" /><span>{t("trash.confirmPurge.localFiles")}</span></li>
                        <li className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" /><span>{t("trash.confirmPurge.sharedFiles")}</span></li>
                    </ul>
                </div>
            </div>
        </div>
    );
}

function entryKey(entry: GenerationTrashEntry) {
    return `${entry.ref.kind}:${entry.ref.id}`;
}

function recordView(entry: GenerationTrashEntry, fallbackTitle: string) {
    const record = asObject(entry.record);
    const config = asObject(record.config);
    const images = asArray(record.images);
    const thumbnails = asArray(record.thumbnails);
    const video = asObject(record.video);
    const prompt = firstString(record.prompt);
    const title = firstString(record.title) || prompt.slice(0, 48) || fallbackTitle;
    const model = firstString(record.model, config.imageModel, config.videoModel, config.model);
    const spec = firstString(record.size, record.resolution, config.size);
    const firstImage = asObject(images[0]);
    const previewCandidate = firstString(thumbnails[0], firstImage.dataUrl);
    const previewUrl = entry.ref.kind === "image" && isRenderableUrl(previewCandidate) ? previewCandidate : "";
    const outputCount = entry.ref.kind === "image" ? firstNumber(record.imageCount) || images.length || thumbnails.length : video.url ? 1 : 0;
    return { title, prompt, model, spec, previewUrl, outputCount, createdAt: firstTimestamp(record.createdAt) };
}

function asObject(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function firstString(...values: unknown[]) {
    return values.find((value): value is string => typeof value === "string" && Boolean(value.trim()))?.trim() || "";
}

function firstNumber(...values: unknown[]) {
    return values.find((value): value is number => typeof value === "number" && Number.isFinite(value)) || 0;
}

function firstTimestamp(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        const timestamp = Date.parse(value);
        if (Number.isFinite(timestamp)) return timestamp;
    }
    return 0;
}

function isRenderableUrl(value: string) {
    return /^(?:data:|blob:|https?:|file:|\/)/i.test(value);
}

function formatTime(value: unknown, locale: string) {
    const timestamp = firstTimestamp(value);
    if (!timestamp) return "—";
    try {
        return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(timestamp);
    } catch {
        return new Date(timestamp).toLocaleString();
    }
}
