import { Alert, Button, Spin, Tooltip } from "antd";
import { Activity, CalendarDays, CheckCircle2, CircleOff, Clock3, FileText, Flame, FlaskConical, ImageIcon, Layers3, Music2, RefreshCw, Sparkles, Video, Workflow } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { StandardPageHeader } from "@/components/layout/standard-page-header";
import { useImageUsage } from "@/hooks/use-image-usage";
import { cn } from "@/lib/utils";
import { readCreativeSkillRunSnapshot, summarizeCreativeSkillRunSnapshot } from "@/lib/creative-skill-run-ledger";
import { createCreativeSkillRunStorage } from "@/services/creative-skill-run-storage";
import type { ImageUsageBucket, ImageUsageBreakdown, ImageUsagePeriod, ImageUsageRange } from "@/services/image-usage-stats";

const periods: ImageUsagePeriod[] = ["day", "week", "month", "quarter", "year"];
const rangesByPeriod: Record<ImageUsagePeriod, ImageUsageRange[]> = {
    day: ["30d", "90d", "1y", "all"],
    week: ["90d", "1y", "all"],
    month: ["1y", "all"],
    quarter: ["1y", "all"],
    year: ["all"],
};
type StatsCopy = {
    heatmap: {
        less: string;
        more: string;
        tooltip: {
            activities: string;
            requests: string;
            requestedImages: string;
            successImages: string;
            failedImages: string;
            canceledImages: string;
            successRate: string;
        };
    };
    detail: {
        title: string;
        description: string;
        selectedPeriod: string;
        activities: string;
        requests: string;
        requestedImages: string;
        successImages: string;
        failedImages: string;
        canceledImages: string;
        successRate: string;
    };
};

type HeatmapCell = {
    key: string;
    date: Date;
    bucket?: ImageUsageBucket;
    active: boolean;
    label?: string;
};

type HeatmapRow = {
    key: string;
    label: string;
    cells: HeatmapCell[];
};

type DayWeek = {
    key: string;
    cells: HeatmapCell[];
};

type CreativeSkillStats = ReturnType<typeof summarizeCreativeSkillRunSnapshot>;

export default function StatsPage() {
    const { t, i18n } = useTranslation();
    const [period, setPeriod] = useState<ImageUsagePeriod>("day");
    const [range, setRange] = useState<ImageUsageRange>("1y");
    const [selectedKey, setSelectedKey] = useState("");
    const [skillStats, setSkillStats] = useState(() => summarizeCreativeSkillRunSnapshot(readCreativeSkillRunSnapshot()));
    const [skillStatsError, setSkillStatsError] = useState("");
    const { stats, loading, error, refresh } = useImageUsage(period, range);
    const locale = i18n.resolvedLanguage || "zh-CN";
    const rangeOptions = rangesByPeriod[period];
    const copy: StatsCopy = {
        heatmap: {
            less: t("stats.heatmap.less"),
            more: t("stats.heatmap.more"),
            tooltip: {
                activities: t("stats.heatmap.tooltip.activities"),
                requests: t("stats.heatmap.tooltip.requests"),
                requestedImages: t("stats.heatmap.tooltip.requestedImages"),
                successImages: t("stats.heatmap.tooltip.successImages"),
                failedImages: t("stats.heatmap.tooltip.failedImages"),
                canceledImages: t("stats.heatmap.tooltip.canceledImages"),
                successRate: t("stats.heatmap.tooltip.successRate"),
            },
        },
        detail: {
            title: t("stats.detail.title"),
            description: t("stats.detail.description"),
            selectedPeriod: t("stats.detail.selectedPeriod"),
            activities: t("stats.detail.activities"),
            requests: t("stats.detail.requests"),
            requestedImages: t("stats.detail.requestedImages"),
            successImages: t("stats.detail.successImages"),
            failedImages: t("stats.detail.failedImages"),
            canceledImages: t("stats.detail.canceledImages"),
            successRate: t("stats.detail.successRate"),
        },
    };

    useEffect(() => {
        setSelectedKey((current) => (stats?.buckets.some((bucket) => bucket.key === current) ? current : stats?.buckets.at(-1)?.key || ""));
    }, [stats]);

    const hasAnyActivity = stats?.buckets.some((bucket) => bucket.activities > 0);
    const selectedBucket = hasAnyActivity ? stats?.buckets.find((bucket) => bucket.key === selectedKey) || stats?.buckets.at(-1) : undefined;

    const refreshSkillStats = async () => {
        try {
            setSkillStats(summarizeCreativeSkillRunSnapshot(readCreativeSkillRunSnapshot(await createCreativeSkillRunStorage().read())));
            setSkillStatsError("");
        } catch (reason) {
            setSkillStatsError(reason instanceof Error ? reason.message : t("stats.skillRuns.loadFailed"));
        }
    };

    useEffect(() => { void refreshSkillStats(); }, []);

    const handlePeriodChange = (nextPeriod: ImageUsagePeriod) => {
        const nextRanges = rangesByPeriod[nextPeriod];
        setPeriod(nextPeriod);
        if (!nextRanges.includes(range)) setRange(nextRanges[0]);
    };

    const refreshAll = () => Promise.all([refresh(), refreshSkillStats()]);

    return (
        <main className="h-full overflow-y-auto bg-background">
            <div className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
                <StandardPageHeader
                    title={t("stats.title")}
                    description={t("stats.description")}
                    actions={(
                        <Button type="text" icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void refreshAll()}>
                            {t("stats.refresh")}
                        </Button>
                    )}
                />

                <section className="mb-10 border-b border-border pb-8" aria-labelledby="stats-skill-title">
                    <h2 id="stats-skill-title" className="type-section-title">{t("stats.skillRuns.title")}</h2>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{t("stats.skillRuns.description")}</p>
                    {skillStatsError ? <Alert className="mt-5" type="error" showIcon message={t("stats.skillRuns.loadFailed")} description={<span data-selectable-text>{skillStatsError}</span>} /> : null}
                    <div className="mt-6 grid gap-px overflow-hidden border-y border-border bg-border sm:grid-cols-2 lg:grid-cols-5">
                        <MetricCard icon={<Workflow className="size-4" />} label={t("stats.skillRuns.productionUses")} value={formatNumber(skillStats.productionUses, locale)} hint={t("stats.skillRuns.productionUsesHint")} />
                        <MetricCard icon={<FlaskConical className="size-4" />} label={t("stats.skillRuns.testRuns")} value={formatNumber(skillStats.testRuns, locale)} hint={t("stats.skillRuns.testRunsHint")} />
                        <MetricCard icon={<Sparkles className="size-4" />} label={t("stats.skillRuns.modelCalls")} value={formatNumber(skillStats.modelCalls, locale)} hint={t("stats.skillRuns.modelCallsHint")} />
                        <MetricCard icon={<Layers3 className="size-4" />} label={t("stats.skillRuns.outputs")} value={formatNumber(skillStats.outputCount, locale)} hint={t("stats.skillRuns.outputsHint")} />
                        <MetricCard icon={<Clock3 className="size-4" />} label={t("stats.skillRuns.averageDuration")} value={formatDuration(skillStats.averageDurationMs, locale)} hint={t("stats.skillRuns.averageDurationHint")} />
                    </div>
                    <div className="mt-5 grid gap-px overflow-hidden border-y border-border bg-border sm:grid-cols-2 lg:grid-cols-5">
                        <OutcomeMetric icon={<CheckCircle2 className="size-4 text-success" />} label={t("stats.skillRuns.outcomes.success")} value={skillStats.outcomes.success} locale={locale} />
                        <OutcomeMetric icon={<Activity className="size-4 text-warning" />} label={t("stats.skillRuns.outcomes.partial")} value={skillStats.outcomes.partial} locale={locale} />
                        <OutcomeMetric icon={<CircleOff className="size-4 text-destructive" />} label={t("stats.skillRuns.outcomes.failed")} value={skillStats.outcomes.failed} locale={locale} />
                        <OutcomeMetric icon={<CircleOff className="size-4 text-muted-foreground" />} label={t("stats.skillRuns.outcomes.canceled")} value={skillStats.outcomes.canceled} locale={locale} />
                        <OutcomeMetric icon={<CircleOff className="size-4 text-warning" />} label={t("stats.skillRuns.outcomes.interrupted")} value={skillStats.outcomes.interrupted} locale={locale} />
                    </div>
                    <SkillRunBreakdown groups={skillStats.groups} locale={locale} />
                    <p className="mt-4 text-xs leading-5 text-muted-foreground">{t("stats.skillRuns.privacyNote")}</p>
                </section>

                <section aria-labelledby="stats-history-title">
                    <div className="border-b border-border py-6">
                        <h2 id="stats-history-title" className="type-section-title">{t("stats.historyTitle")}</h2>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">{t("stats.historyDescription")}</p>
                        <div className="mt-5 flex flex-wrap items-center gap-x-8 gap-y-3">
                            <Selector label={t("stats.period")} options={periods.map((value) => ({ value, label: t(`stats.periods.${value}`) }))} value={period} onChange={handlePeriodChange} />
                            <Selector label={t("stats.range")} options={rangeOptions.map((value) => ({ value, label: t(`stats.ranges.${value}`) }))} value={range} onChange={setRange} />
                        </div>
                        {stats ? <p className="mt-4 text-xs text-muted-foreground">{t("stats.trackingNote", { date: formatTrackingDate(stats.trackedSince, locale) })}</p> : null}
                    </div>

                {error ? <Alert className="mt-5" type="error" showIcon message={t("stats.loadFailed")} description={<span data-selectable-text>{error}</span>} /> : null}
                {loading && !stats ? (
                    <div className="flex min-h-80 items-center justify-center">
                        <Spin />
                    </div>
                ) : stats ? (
                    <>
                        <div className="mt-8 grid gap-px overflow-hidden border-y border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
                            <MetricCard icon={<Activity className="size-4" />} label={t("stats.metrics.activities")} value={formatNumber(stats.history.activities, locale)} hint={t("stats.metrics.activitiesHint")} />
                            <MetricCard icon={<ImageIcon className="size-4" />} label={t("stats.metrics.images")} value={formatNumber(stats.history.successImages, locale)} hint={t("stats.metrics.imagesHint")} />
                            <MetricCard icon={<Video className="size-4" />} label={t("stats.metrics.videos")} value={formatNumber(stats.history.successVideos, locale)} hint={t("stats.metrics.videosHint")} />
                            <MetricCard icon={<Music2 className="size-4" />} label={t("stats.metrics.audios")} value={formatNumber(stats.history.successAudios, locale)} hint={t("stats.metrics.audiosHint")} />
                            <MetricCard icon={<Sparkles className="size-4" />} label={t("stats.metrics.promptPolishes")} value={formatNumber(stats.history.successfulPromptPolishes, locale)} hint={t("stats.metrics.promptPolishesHint")} />
                            <MetricCard icon={<FileText className="size-4" />} label={t("stats.metrics.historyText")} value={formatNumber(stats.history.textEntries, locale)} hint={t("stats.metrics.historyTextHint", { count: formatNumber(stats.history.textCharacters, locale) })} />
                            <MetricCard icon={<CalendarDays className="size-4" />} label={t("stats.metrics.activeDays")} value={formatNumber(stats.summary.activeDays, locale)} hint={t("stats.metrics.activeDaysHint")} />
                            <MetricCard icon={<Flame className="size-4" />} label={t("stats.metrics.streakDays")} value={formatNumber(stats.summary.streakDays, locale)} hint={t("stats.metrics.streakDaysHint")} />
                            <MetricCard
                                icon={<CheckCircle2 className="size-4" />}
                                label={t("stats.metrics.successRate")}
                                value={formatPercent(stats.history.successImages / Math.max(1, stats.history.successImages + stats.history.failedImages), locale)}
                                hint={t("stats.metrics.successRateHint", { failed: formatNumber(stats.history.failedImages, locale), canceled: formatNumber(stats.history.canceledImages, locale) })}
                            />
                        </div>

                        <div className="mt-9 grid gap-9 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
                            <section className="min-w-0 border-t border-border pt-5">
                                <div>
                                    <h3 className="type-section-title">{t("stats.trendTitle")}</h3>
                                    <p className="mt-1 text-xs text-muted-foreground">{t(`stats.trendDescription.${period}`)}</p>
                                </div>
                                <div className="mt-4">
                                    <ResponsiveHeatmap buckets={stats.buckets} period={period} locale={locale} copy={copy} selectedKey={selectedKey} onSelect={setSelectedKey} />
                                </div>
                            </section>

                            <BreakdownCard title={t("stats.timeTitle")} description={t("stats.timeDescription")} items={stats.timeSlots} emptyLabel={t("stats.emptyActivity")} unknownLabel={t("stats.unknown")} locale={locale} labelForValue={(value) => t(`stats.values.timeSlots.${value}`)} />
                        </div>

                        {selectedBucket ? <UsageDetail bucket={selectedBucket} period={period} locale={locale} copy={copy} /> : null}

                        <div className="mt-9 grid gap-9 md:grid-cols-2 xl:grid-cols-3">
                            <BreakdownCard title={t("stats.sourceTitle")} description={t("stats.sourceDescription")} items={stats.sources} emptyLabel={t("stats.emptyImages")} unknownLabel={t("stats.unknown")} locale={locale} labelForValue={(value) => t(`stats.values.sources.${value}`)} />
                            <BreakdownCard title={t("stats.operationTitle")} description={t("stats.operationDescription")} items={stats.operations} emptyLabel={t("stats.emptyImages")} unknownLabel={t("stats.unknown")} locale={locale} labelForValue={(value) => t(`stats.values.operations.${value}`)} />
                            <BreakdownCard title={t("stats.modelTitle")} description={t("stats.modelDescription")} items={stats.models} emptyLabel={t("stats.emptyModel")} unknownLabel={t("stats.unknown")} locale={locale} />
                        </div>

                        <div className="mt-9 grid gap-9 xl:grid-cols-2">
                            <BreakdownCard title={t("stats.canvasRankingTitle")} description={t("stats.canvasRankingDescription")} items={stats.canvasOutputs} emptyLabel={t("stats.emptyCanvasOutputs")} unknownLabel={t("stats.unknown")} locale={locale} />
                            <BreakdownCard title={t("stats.sizeTitle")} description={t("stats.sizeDescription")} items={stats.sizes} emptyLabel={t("stats.emptySize")} unknownLabel={t("stats.unknown")} locale={locale} />
                        </div>
                    </>
                ) : null}
                </section>

                {stats ? (
                    <section className="mt-12 border-t border-border pt-8" aria-labelledby="stats-current-title">
                        <h2 id="stats-current-title" className="type-section-title">{t("stats.currentTitle")}</h2>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">{t("stats.currentDescription")}</p>
                        <div className="mt-6 grid gap-px overflow-hidden border-y border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
                            <MetricCard icon={<FileText className="size-4" />} label={t("stats.metrics.textNodes")} value={formatNumber(stats.current.textNodes, locale)} hint={t("stats.metrics.textCharactersHint", { count: formatNumber(stats.current.textCharacters, locale) })} />
                            <MetricCard icon={<ImageIcon className="size-4" />} label={t("stats.metrics.currentImageNodes")} value={formatNumber(stats.current.imageNodes, locale)} hint={t("stats.metrics.currentNodeHint")} />
                            <MetricCard icon={<Video className="size-4" />} label={t("stats.metrics.currentVideoNodes")} value={formatNumber(stats.current.videoNodes, locale)} hint={t("stats.metrics.currentNodeHint")} />
                            <MetricCard icon={<Music2 className="size-4" />} label={t("stats.metrics.currentAudioNodes")} value={formatNumber(stats.current.audioNodes, locale)} hint={t("stats.metrics.currentNodeHint")} />
                        </div>
                        <div className="mt-9 grid gap-9 xl:grid-cols-2">
                            <TextRatioCard stats={stats.textRatio} locale={locale} />
                            <BreakdownCard title={t("stats.textSourceTitle")} description={t("stats.textSourceDescription")} items={stats.textSources} emptyLabel={t("stats.emptyText")} unknownLabel={t("stats.unknown")} locale={locale} labelForValue={(value) => t(`stats.values.textSources.${value}`)} />
                        </div>
                    </section>
                ) : null}
            </div>
        </main>
    );
}

function Selector<T extends string>({ label, options, value, onChange }: { label: string; options: Array<{ value: T; label: string }>; value: T; onChange: (value: T) => void }) {
    return (
        <div className="flex flex-wrap items-center gap-3">
            <span className="type-label w-12 shrink-0 text-muted-foreground">{label}</span>
            <div className="flex flex-wrap gap-1 rounded-lg bg-muted/70 p-1">
                {options.map((option) => (
                    <button
                        key={option.value}
                        type="button"
                        className={cn("rounded-md px-3 py-1.5 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50", value === option.value ? "bg-primary font-medium !text-primary-foreground" : "text-muted-foreground hover:bg-background/70 hover:text-foreground")}
                        onClick={() => onChange(option.value)}
                        aria-pressed={value === option.value}
                    >
                        {option.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

function MetricCard({ icon, label, value, hint }: { icon: ReactNode; label: string; value: string; hint: string }) {
    return (
        <section className="bg-background px-5 py-5">
            <div className="type-label flex items-center gap-2 text-muted-foreground">
                <span className="text-muted-foreground/70">{icon}</span>
                {label}
            </div>
            <div className="type-numeric mt-4 truncate text-2xl text-foreground">{value}</div>
            <div className="mt-1.5 text-xs leading-5 text-muted-foreground">{hint}</div>
        </section>
    );
}

function OutcomeMetric({ icon, label, value, locale }: { icon: ReactNode; label: string; value: number; locale: string }) {
    return (
        <div className="flex min-h-20 items-center justify-between gap-3 bg-background px-5 py-4">
            <div className="type-label flex min-w-0 items-center gap-2 text-muted-foreground">{icon}<span className="truncate">{label}</span></div>
            <span className="type-numeric shrink-0 text-xl text-foreground">{formatNumber(value, locale)}</span>
        </div>
    );
}

function SkillRunBreakdown({ groups, locale }: { groups: CreativeSkillStats["groups"]; locale: string }) {
    const { t } = useTranslation();
    return (
        <section className="mt-7 border-t border-border pt-5" aria-labelledby="stats-skill-breakdown-title">
            <h3 id="stats-skill-breakdown-title" className="text-sm font-medium">{t("stats.skillRuns.breakdownTitle")}</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("stats.skillRuns.breakdownDescription")}</p>
            {groups.length ? (
                <div className="mt-4 overflow-x-auto border-y border-border">
                    <table className="w-full min-w-[1180px] table-fixed text-left text-xs">
                        <colgroup>
                            <col className="w-44" />
                            <col className="w-52" />
                            <col className="w-24" />
                            <col className="w-20" />
                            <col className="w-20" />
                            <col className="w-80" />
                            <col className="w-28" />
                            <col className="w-20" />
                            <col className="w-20" />
                        </colgroup>
                        <thead className="bg-muted/45 text-muted-foreground">
                            <tr>
                                <th className="px-3 py-2.5 font-normal">{t("stats.skillRuns.columns.skill")}</th>
                                <th className="px-3 py-2.5 font-normal">{t("stats.skillRuns.columns.version")}</th>
                                <th className="px-3 py-2.5 font-normal">{t("stats.skillRuns.columns.source")}</th>
                                <th className="px-3 py-2.5 text-right font-normal">{t("stats.skillRuns.columns.production")}</th>
                                <th className="px-3 py-2.5 text-right font-normal">{t("stats.skillRuns.columns.test")}</th>
                                <th className="px-3 py-2.5 font-normal">{t("stats.skillRuns.columns.outcomes")}</th>
                                <th className="px-3 py-2.5 text-right font-normal">{t("stats.skillRuns.columns.duration")}</th>
                                <th className="px-3 py-2.5 text-right font-normal">{t("stats.skillRuns.columns.calls")}</th>
                                <th className="px-3 py-2.5 text-right font-normal">{t("stats.skillRuns.columns.outputs")}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {groups.map((group) => (
                                <tr key={JSON.stringify([group.skillId, group.versionId, group.source])} className="bg-background align-top">
                                    <td className="px-3 py-3 font-medium"><span className="block truncate" title={group.skillId} data-selectable-text>{group.skillId}</span></td>
                                    <td className="px-3 py-3 text-muted-foreground"><span className="type-numeric block truncate text-xs" title={group.versionId} data-selectable-text>{group.versionId}</span></td>
                                    <td className="px-3 py-3 text-muted-foreground">{t(`stats.skillRuns.sources.${group.source}`)}</td>
                                    <td className="type-numeric px-3 py-3 text-right">{formatNumber(group.productionUses, locale)}</td>
                                    <td className="type-numeric px-3 py-3 text-right">{formatNumber(group.testRuns, locale)}</td>
                                    <td className="px-3 py-3 text-muted-foreground">
                                        <span className="whitespace-nowrap">{t("stats.skillRuns.outcomes.success")} {formatNumber(group.outcomes.success, locale)}</span>
                                        <span className="mx-1.5 text-border">/</span>
                                        <span className="whitespace-nowrap">{t("stats.skillRuns.outcomes.partial")} {formatNumber(group.outcomes.partial, locale)}</span>
                                        <span className="mx-1.5 text-border">/</span>
                                        <span className="whitespace-nowrap">{t("stats.skillRuns.outcomes.failed")} {formatNumber(group.outcomes.failed, locale)}</span>
                                        <span className="mx-1.5 text-border">/</span>
                                        <span className="whitespace-nowrap">{t("stats.skillRuns.outcomes.canceled")} {formatNumber(group.outcomes.canceled, locale)}</span>
                                        <span className="mx-1.5 text-border">/</span>
                                        <span className="whitespace-nowrap">{t("stats.skillRuns.outcomes.interrupted")} {formatNumber(group.outcomes.interrupted, locale)}</span>
                                    </td>
                                    <td className="type-numeric px-3 py-3 text-right">{formatDuration(group.averageDurationMs, locale)}</td>
                                    <td className="type-numeric px-3 py-3 text-right">{formatNumber(group.modelCalls, locale)}</td>
                                    <td className="type-numeric px-3 py-3 text-right">{formatNumber(group.outputCount, locale)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : <div className="mt-4 border-y border-border py-8 text-center text-sm text-muted-foreground">{t("stats.skillRuns.emptyBreakdown")}</div>}
        </section>
    );
}

function ResponsiveHeatmap({ buckets, period, locale, copy, selectedKey, onSelect }: { buckets: ImageUsageBucket[]; period: ImageUsagePeriod; locale: string; copy: StatsCopy; selectedKey: string; onSelect: (key: string) => void }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);
    const thresholds = useMemo(() => heatThresholds(buckets.map((bucket) => bucket.activities)), [buckets]);
    const hasData = buckets.some((bucket) => bucket.activities > 0);
    const measuredWidth = Math.max(width, 320);
    const compactCellSize = measuredWidth < 900 ? 16 : measuredWidth < 1100 ? 18 : 20;
    const compactGap = 5;
    const compactColumns = Math.max(10, Math.floor((measuredWidth - 80 + compactGap) / (compactCellSize + compactGap)));
    const labeledCellSize = period === "month" ? 52 : period === "quarter" ? 68 : 76;
    const labeledGap = 8;
    const labeledColumns = Math.max(2, Math.floor((measuredWidth - 80 + labeledGap) / (labeledCellSize + labeledGap)));

    useEffect(() => {
        const element = containerRef.current;
        if (!element) return;
        const update = () => setWidth(element.clientWidth);
        update();
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(update);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    return (
        <div ref={containerRef} className="min-w-0">
            {hasData ? (
                period === "day" ? (
                    <DayHeatmap buckets={buckets} locale={locale} copy={copy} thresholds={thresholds} maxColumns={compactColumns} cellSize={compactCellSize} gap={compactGap} selectedKey={selectedKey} onSelect={onSelect} />
                ) : (
                    <HeatmapRows
                        rows={buildHeatmapRows(buckets, period, locale)}
                        period={period}
                        locale={locale}
                        copy={copy}
                        thresholds={thresholds}
                        maxColumns={period === "week" ? compactColumns : labeledColumns}
                        cellSize={period === "week" ? compactCellSize : labeledCellSize}
                        gap={period === "week" ? compactGap : labeledGap}
                        selectedKey={selectedKey}
                        onSelect={onSelect}
                    />
                )
            ) : (
                <div className="flex min-h-16 items-center justify-center py-2 text-sm text-muted-foreground">{tHeatmapEmpty(locale)}</div>
            )}
        </div>
    );
}

function DayHeatmap({ buckets, locale, copy, thresholds, maxColumns, cellSize, gap, selectedKey, onSelect }: { buckets: ImageUsageBucket[]; locale: string; copy: StatsCopy; thresholds: number[]; maxColumns: number; cellSize: number; gap: number; selectedKey: string; onSelect: (key: string) => void }) {
    const weekdayLabels = locale === "zh-CN" ? ["一", "二", "三", "四", "五", "六", "日"] : ["M", "T", "W", "T", "F", "S", "S"];
    return (
        <div className="space-y-3">
            {groupBucketsByYear(buckets).map(({ year, buckets: yearBuckets }) => {
                const weeks = buildDayWeeks(yearBuckets);
                const segments = chunk(weeks, maxColumns);
                return (
                    <div key={year}>
                        <div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                            <span className="type-numeric text-foreground">{year}</span>
                            <span className="type-numeric text-xs">{formatDateRange(weeks[0]?.cells[0]?.date, weeks.at(-1)?.cells.at(-1)?.date, locale)}</span>
                        </div>
                        <div className="space-y-3">
                            {segments.map((segment, index) => (
                                <div key={`${year}-${index}`} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3">
                                    <div className="grid grid-rows-7 text-[11px] leading-none text-muted-foreground/70" style={{ gridTemplateRows: `repeat(7, ${cellSize}px)`, gap }}>
                                        {weekdayLabels.map((label, labelIndex) => (
                                            <span key={`${label}-${labelIndex}`} className="flex items-center">{labelIndex % 2 === 0 ? label : ""}</span>
                                        ))}
                                    </div>
                                    <div className="grid w-fit max-w-full" style={{ gridTemplateColumns: `repeat(${segment.length}, ${cellSize}px)`, gridTemplateRows: `repeat(7, ${cellSize}px)`, gridAutoFlow: "column", gap }}>
                                        {segment
                                            .flatMap((week) => week.cells)
                                            .map((cell) => (
                                                <HeatCell key={cell.key} cell={cell} period="day" locale={locale} copy={copy} thresholds={thresholds} size={cellSize} selectedKey={selectedKey} onSelect={onSelect} />
                                            ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })}
            <HeatmapLegend copy={copy} />
        </div>
    );
}

function HeatmapRows({
    rows,
    period,
    locale,
    copy,
    thresholds,
    maxColumns,
    cellSize,
    gap,
    selectedKey,
    onSelect,
}: {
    rows: HeatmapRow[];
    period: ImageUsagePeriod;
    locale: string;
    copy: StatsCopy;
    thresholds: number[];
    maxColumns: number;
    cellSize: number;
    gap: number;
    selectedKey: string;
    onSelect: (key: string) => void;
}) {
    const large = period === "month" || period === "quarter" || period === "year";
    const displayRows = splitHeatmapRows(rows, maxColumns);
    return (
        <div className="space-y-3 overflow-hidden">
            {displayRows.map((row) => (
                <div key={row.key} className="grid grid-cols-[4rem_minmax(0,1fr)] items-stretch gap-3">
                    <span className="type-numeric flex items-center text-xs text-muted-foreground">{row.label}</span>
                    <div className="grid w-fit max-w-full" style={{ gridTemplateColumns: `repeat(${row.cells.length}, ${cellSize}px)`, gap }}>
                        {row.cells.map((cell) => (
                            <HeatCell key={cell.key} cell={cell} period={period} locale={locale} copy={copy} thresholds={thresholds} large={large} size={cellSize} selectedKey={selectedKey} onSelect={onSelect} />
                        ))}
                    </div>
                </div>
            ))}
            <HeatmapLegend copy={copy} />
        </div>
    );
}

function HeatCell({
    cell,
    period,
    locale,
    copy,
    thresholds,
    large = false,
    size = 12,
    selectedKey,
    onSelect,
}: {
    cell: HeatmapCell;
    period: ImageUsagePeriod;
    locale: string;
    copy: StatsCopy;
    thresholds: number[];
    large?: boolean;
    size?: number;
    selectedKey: string;
    onSelect: (key: string) => void;
}) {
    if (!cell.active) return <span aria-hidden className="shrink-0" style={{ width: size, height: size }} />;
    const value = cell.bucket?.activities || 0;
    const selected = selectedKey === cell.bucket?.key || selectedKey === cell.key;
    const label = formatTooltipLabel(cell.bucket?.startAt || cell.date.getTime(), period, locale);
    return (
        <Tooltip title={<HeatmapTooltip label={label} bucket={cell.bucket} copy={copy} locale={locale} />} placement="top" mouseEnterDelay={0.08}>
            <button
                type="button"
                className={cn(
                    "shrink-0 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/60",
                    large ? "flex flex-col justify-between rounded-md px-1.5 py-1 text-left" : "rounded-[3px]",
                    heatColor(value, thresholds),
                    selected && "ring-2 ring-foreground/60",
                )}
                style={{ width: size, height: size }}
                aria-label={label}
                onClick={() => onSelect(cell.bucket?.key || cell.key)}
            >
                {large ? (
                    <>
                        <span className="truncate text-[12px] font-medium text-foreground/80">{cell.label}</span>
                        <span className="type-numeric mt-0.5 text-sm text-foreground">{value}</span>
                    </>
                ) : null}
            </button>
        </Tooltip>
    );
}

function HeatmapTooltip({ label, bucket, copy, locale }: { label: string; bucket?: ImageUsageBucket; copy: StatsCopy; locale: string }) {
    const activities = bucket?.activities || 0;
    const requests = bucket?.requests || 0;
    const requestedImages = bucket?.requestedImages || 0;
    const successImages = bucket?.successImages || 0;
    const failedImages = bucket?.failedImages || 0;
    const canceledImages = bucket?.canceledImages || 0;
    return (
        <div className="min-w-40 space-y-1.5 text-xs">
            <div className="type-numeric mb-2 text-xs">{label}</div>
            <TooltipMetric label={copy.heatmap.tooltip.activities} value={formatNumber(activities, locale)} />
            <TooltipMetric label={copy.heatmap.tooltip.requests} value={formatNumber(requests, locale)} />
            <TooltipMetric label={copy.heatmap.tooltip.requestedImages} value={formatNumber(requestedImages, locale)} />
            <TooltipMetric label={copy.heatmap.tooltip.successImages} value={formatNumber(successImages, locale)} />
            <TooltipMetric label={copy.heatmap.tooltip.failedImages} value={formatNumber(failedImages, locale)} />
            <TooltipMetric label={copy.heatmap.tooltip.canceledImages} value={formatNumber(canceledImages, locale)} />
            <TooltipMetric label={copy.heatmap.tooltip.successRate} value={formatPercent(successImages / Math.max(1, successImages + failedImages), locale)} />
        </div>
    );
}

function TooltipMetric({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-4">
            <span className="opacity-65">{label}</span>
            <span className="type-numeric">{value}</span>
        </div>
    );
}

function HeatmapLegend({ copy }: { copy: StatsCopy }) {
    return (
        <div className="flex items-center justify-start gap-1 pt-1 text-[12px] text-muted-foreground/70">
            <span>{copy.heatmap.less}</span>
            {[0, 1, 2, 3, 4].map((level) => (
                <span key={level} className={cn("size-3 rounded-[3px]", heatColor(level, [1, 2, 3, 4]))} />
            ))}
            <span>{copy.heatmap.more}</span>
        </div>
    );
}

function UsageDetail({ bucket, period, locale, copy }: { bucket?: ImageUsageBucket; period: ImageUsagePeriod; locale: string; copy: StatsCopy }) {
    return (
        <section className="mt-9 border-t border-border pt-5">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 className="type-section-title">{copy.detail.title}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{copy.detail.description}</p>
                </div>
            </div>
            {bucket ? (
                <>
                    <div className="mt-4 text-sm font-medium text-foreground/80">
                        {copy.detail.selectedPeriod}：<span className="type-numeric text-sm">{formatTooltipLabel(bucket.startAt, period, locale)}</span>
                    </div>
                    <div className="mt-4 max-w-xl divide-y divide-border">
                        <DetailMetric label={copy.detail.activities} value={formatNumber(bucket.activities, locale)} />
                        <DetailMetric label={copy.detail.requests} value={formatNumber(bucket.requests, locale)} />
                        <DetailMetric label={copy.detail.requestedImages} value={formatNumber(bucket.requestedImages, locale)} />
                        <DetailMetric label={copy.detail.successImages} value={formatNumber(bucket.successImages, locale)} />
                        <DetailMetric label={copy.detail.failedImages} value={formatNumber(bucket.failedImages, locale)} />
                        <DetailMetric label={copy.detail.canceledImages} value={formatNumber(bucket.canceledImages, locale)} />
                        <DetailMetric label={copy.detail.successRate} value={formatPercent(bucket.successImages / Math.max(1, bucket.successImages + bucket.failedImages), locale)} />
                    </div>
                </>
            ) : null}
        </section>
    );
}

function DetailMetric({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-6 py-2.5 text-sm">
            <span className="text-muted-foreground">{label}</span>
            <span className="type-numeric text-foreground">{value}</span>
        </div>
    );
}

function TextRatioCard({ stats, locale }: { stats: { manual: number; ai: number; knownNodes: number; excludedNodes: number }; locale: string }) {
    const { t } = useTranslation();
    return (
        <section className="border-t border-border pt-5">
            <h3 className="type-section-title">{t("stats.textRatioTitle")}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{t("stats.textRatioDescription")}</p>
            {stats.knownNodes ? (
                <div className="mt-5">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <div className="text-xs text-muted-foreground">{t("stats.values.textRatio.manual")}</div>
                            <div className="type-numeric mt-1 text-2xl">{formatPercent(stats.manual, locale)}</div>
                        </div>
                        <div>
                            <div className="text-xs text-muted-foreground">{t("stats.values.textRatio.ai")}</div>
                            <div className="type-numeric mt-1 text-2xl">{formatPercent(stats.ai, locale)}</div>
                        </div>
                    </div>
                    <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                        <span className="h-full bg-chart-2" style={{ width: `${stats.manual * 100}%` }} />
                        <span className="h-full bg-chart-4" style={{ width: `${stats.ai * 100}%` }} />
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">{t("stats.textRatioSample", { count: formatNumber(stats.knownNodes, locale), excluded: formatNumber(stats.excludedNodes, locale) })}</p>
                </div>
            ) : (
                <div className="flex min-h-16 items-center justify-center py-2 text-sm text-muted-foreground">{t("stats.emptyTextRatio")}</div>
            )}
        </section>
    );
}

function BreakdownCard({ title, description, items, emptyLabel, unknownLabel, locale, labelForValue }: { title: string; description: string; items: ImageUsageBreakdown[]; emptyLabel: string; unknownLabel: string; locale: string; labelForValue?: (value: string) => string }) {
    return (
        <section className="border-t border-border pt-5">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 className="type-section-title">{title}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{description}</p>
                </div>
            </div>
            {items.length ? (
                <div className="mt-5 space-y-4">
                    {items.slice(0, 6).map((item) => (
                        <div key={item.value || unknownLabel}>
                            <div className="flex items-center justify-between gap-3 text-xs">
                                <span className="min-w-0 truncate font-medium">{item.value ? labelForValue?.(item.value) || item.value : unknownLabel}</span>
                                <span className="type-numeric shrink-0 text-xs text-muted-foreground">
                                    {formatPercent(item.percentage, locale)} · {item.count}
                                </span>
                            </div>
                            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                                <div className="h-full rounded-full bg-chart-2" style={{ width: `${item.percentage * 100}%` }} />
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="flex min-h-16 items-center justify-center py-2 text-sm text-muted-foreground">{emptyLabel}</div>
            )}
        </section>
    );
}

function buildHeatmapRows(buckets: ImageUsageBucket[], period: ImageUsagePeriod, locale: string): HeatmapRow[] {
    if (period === "year") {
        return [
            {
                key: "years",
                label: locale === "zh-CN" ? "年份" : "Years",
                cells: buckets.map((bucket) => ({ key: bucket.key, date: new Date(bucket.startAt), bucket, active: true, label: String(new Date(bucket.startAt).getFullYear()) })),
            },
        ];
    }

    return groupBucketsByYear(buckets).map(({ year, buckets: yearBuckets }) => {
        const first = new Date(yearBuckets[0].startAt);
        const last = new Date(yearBuckets.at(-1)!.startAt);
        const bucketMap = new Map(yearBuckets.map((bucket) => [periodDateKey(new Date(bucket.startAt), period), bucket]));
        const cells: HeatmapCell[] = [];
        for (let cursor = first; cursor.getTime() <= last.getTime(); cursor = addPeriodDate(cursor, period)) {
            const bucket = bucketMap.get(periodDateKey(cursor, period));
            cells.push({ key: bucket?.key || periodDateKey(cursor, period), date: new Date(cursor), bucket, active: true, label: periodCellLabel(cursor, period, locale) });
        }
        return { key: `${period}-${year}`, label: String(year), cells };
    });
}

function buildDayWeeks(buckets: ImageUsageBucket[]): DayWeek[] {
    const first = startOfWeek(new Date(buckets[0].startAt));
    const last = endOfWeek(new Date(buckets.at(-1)!.startAt));
    const bucketMap = new Map(buckets.map((bucket) => [dayKey(new Date(bucket.startAt)), bucket]));
    const firstInRange = new Date(buckets[0].startAt).getTime();
    const lastInRange = new Date(buckets.at(-1)!.startAt).getTime();
    const weeks: DayWeek[] = [];
    for (let cursor = first; cursor.getTime() <= last.getTime(); cursor = addDays(cursor, 7)) {
        const cells = Array.from({ length: 7 }, (_, index) => {
            const date = addDays(cursor, index);
            return { key: dayKey(date), date, bucket: bucketMap.get(dayKey(date)), active: date.getTime() >= firstInRange && date.getTime() <= lastInRange };
        });
        weeks.push({ key: dayKey(cursor), cells });
    }
    return weeks;
}

function groupBucketsByYear(buckets: ImageUsageBucket[]) {
    const groups = new Map<number, ImageUsageBucket[]>();
    buckets.forEach((bucket) => {
        const year = new Date(bucket.startAt).getFullYear();
        groups.set(year, [...(groups.get(year) || []), bucket]);
    });
    return Array.from(groups.entries())
        .sort(([left], [right]) => left - right)
        .map(([year, yearBuckets]) => ({ year, buckets: yearBuckets.sort((left, right) => left.startAt - right.startAt) }));
}

function splitHeatmapRows(rows: HeatmapRow[], maxColumns: number) {
    return rows.flatMap((row) =>
        chunk(row.cells, maxColumns).map((cells, index, chunks) => ({
            ...row,
            key: `${row.key}-${index}`,
            label: chunks.length > 1 ? `${row.label} · ${index + 1}` : row.label,
            cells,
        })),
    );
}

function chunk<T>(items: T[], size: number): T[][] {
    if (!items.length) return [];
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
    return chunks;
}

function heatThresholds(values: number[]) {
    const positive = values.filter((value) => value > 0).sort((left, right) => left - right);
    if (!positive.length) return [];
    const quantile = (ratio: number) => positive[Math.floor((positive.length - 1) * ratio)];
    return [quantile(0.2), quantile(0.4), quantile(0.6), quantile(0.8)];
}

function heatColor(value: number, thresholds: number[]) {
    if (!value || !thresholds.length) return "bg-muted";
    if (thresholds.every((threshold) => threshold === thresholds[0])) return "bg-chart-2";
    const level = thresholds.findIndex((threshold) => value <= threshold);
    return ["bg-chart-2/15", "bg-chart-2/30", "bg-chart-2/50", "bg-chart-2/70", "bg-chart-2"][level < 0 ? 4 : level];
}

function periodDateKey(date: Date, period: ImageUsagePeriod) {
    const start = period === "week" ? startOfWeek(date) : date;
    const year = start.getFullYear();
    if (period === "quarter") return `${year}-Q${Math.floor(start.getMonth() / 3) + 1}`;
    if (period === "month") return `${year}-${String(start.getMonth() + 1).padStart(2, "0")}`;
    if (period === "week") return dayKey(start);
    return String(year);
}

function periodCellLabel(date: Date, period: ImageUsagePeriod, locale: string) {
    if (period === "quarter") return `Q${Math.floor(date.getMonth() / 3) + 1}`;
    if (period === "month") return new Intl.DateTimeFormat(locale, { month: "short" }).format(date);
    return "";
}

function addPeriodDate(date: Date, period: ImageUsagePeriod) {
    const next = new Date(date);
    if (period === "quarter") next.setMonth(next.getMonth() + 3);
    else if (period === "month") next.setMonth(next.getMonth() + 1);
    else next.setDate(next.getDate() + 7);
    return next;
}

function formatNumber(value: number, locale: string) {
    return new Intl.NumberFormat(locale).format(value);
}

function formatDuration(milliseconds: number, locale: string) {
    if (milliseconds < 1000) return new Intl.NumberFormat(locale, { style: "unit", unit: "millisecond", unitDisplay: "short" }).format(milliseconds);
    if (milliseconds < 60_000) return new Intl.NumberFormat(locale, { style: "unit", unit: "second", unitDisplay: "short", maximumFractionDigits: 1 }).format(milliseconds / 1000);
    return new Intl.NumberFormat(locale, { style: "unit", unit: "minute", unitDisplay: "short", maximumFractionDigits: 1 }).format(milliseconds / 60_000);
}

function formatPercent(value: number, locale: string) {
    return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(value);
}

function formatDate(date: Date, locale: string) {
    return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(date);
}

function formatTrackingDate(time: number, locale: string) {
    return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }).format(new Date(time));
}

function formatDateRange(first: Date | undefined, last: Date | undefined, locale: string) {
    if (!first || !last) return "";
    return `${formatDate(first, locale)} – ${formatDate(last, locale)}`;
}

function formatTooltipLabel(startAt: number, period: ImageUsagePeriod, locale: string) {
    const date = new Date(startAt);
    if (period === "day") return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }).format(date);
    if (period === "week") return `${formatDate(date, locale)} – ${formatDate(addDays(date, 6), locale)}`;
    return formatBucketLabel(startAt, period, locale);
}

function formatBucketLabel(startAt: number, period: ImageUsagePeriod, locale: string) {
    const date = new Date(startAt);
    if (period === "year") return new Intl.DateTimeFormat(locale, { year: "numeric" }).format(date);
    if (period === "quarter") return `${date.getFullYear()} Q${Math.floor(date.getMonth() / 3) + 1}`;
    if (period === "month") return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short" }).format(date);
    return formatDate(date, locale);
}

function tHeatmapEmpty(locale: string) {
    return locale === "zh-CN" ? "这段时间还没有创作活动" : "No creative activity in this range";
}

function dayKey(date: Date) {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function startOfWeek(date: Date) {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
    return start;
}

function endOfWeek(date: Date) {
    const end = startOfWeek(date);
    end.setDate(end.getDate() + 6);
    return end;
}

function addDays(date: Date, days: number) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}
