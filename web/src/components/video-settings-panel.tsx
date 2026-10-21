import { type ReactNode } from "react";
import { Switch } from "antd";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { apimartVideoPolicy, normalizeApimartVideoDuration, normalizeApimartVideoRatio, normalizeApimartVideoResolution, type ApimartVideoPolicy } from "@/lib/apimart-models";
import { boolConfig, isApimartVideoConfig, isSeedanceVideoConfig, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution, seedanceDurationOptions, seedancePixelLabel, seedanceRatioOptions, seedanceResolutionOptions } from "@/lib/seedance-video";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { type AiConfig } from "@/stores/use-config-store";

const resolutionOptions = [
    { value: "720", label: "720p" },
    { value: "480", label: "480p" },
];

const sizeOptions = [
    { value: "1280x720", labelKey: "landscape", width: 1280, height: 720 },
    { value: "720x1280", labelKey: "portrait", width: 720, height: 1280 },
    { value: "1024x1024", labelKey: "square", width: 1024, height: 1024 },
    { value: "1792x1024", labelKey: "widescreen", width: 1792, height: 1024 },
    { value: "1024x1792", labelKey: "tall", width: 1024, height: 1792 },
    { value: "auto", labelKey: "auto", width: 0, height: 0 },
];

const secondOptions = [6, 10, 12, 16, 20];
const seedanceRatioLabelKeys: Record<string, string> = { "16:9": "landscape", "9:16": "portrait", "1:1": "square", "4:3": "standardLandscape", "3:4": "standardPortrait", "21:9": "cinematic", adaptive: "adaptive" };

export const videoResolutionOptions = resolutionOptions.map((item) => ({ value: item.value, label: item.label }));
export const videoSizeOptions = sizeOptions.map((item) => ({ value: item.value, get label() { return i18n.t(`settingsPanels.video.sizes.${item.labelKey}`); } }));
export const videoSecondOptions = secondOptions.map((value) => String(value));

type VideoSettingsKey = "vquality" | "size" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoPromptOptimizer" | "videoFastPretreatment" | "videoSeed" | "videoReturnLastFrame" | "videoOutputFormat";

type VideoSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: VideoSettingsKey, value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
    prompt?: string;
    imageCount?: number;
    videoCount?: number;
    audioCount?: number;
};

export function VideoSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5", prompt = "", imageCount = 0, videoCount = 0, audioCount = 0 }: VideoSettingsPanelProps) {
    const { t } = useTranslation();
    const model = config.videoModel || config.model;
    const panelProps = { config, onConfigChange, theme, showTitle, className, prompt, imageCount, videoCount, audioCount };
    if (isApimartVideoConfig({ ...config, model })) {
        return <ApimartVideoSettingsPanel {...panelProps} />;
    }
    if (isSeedanceVideoConfig({ ...config, model })) {
        return <SeedanceVideoSettingsPanel {...panelProps} />;
    }

    const seconds = config.videoSeconds || "6";
    const size = normalizeVideoSizeValue(config.size);
    const dimensions = readSizeDimensions(size);
    const resolution = normalizeVideoResolutionValue(config.vquality);
    const updateDimension = (key: "width" | "height", value: number | null) => {
        const next = Math.max(1, Math.floor(value || dimensions[key] || 720));
        onConfigChange("size", `${key === "width" ? next : dimensions.width}x${key === "height" ? next : dimensions.height}`);
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">{t("settingsPanels.video.title")}</div> : null}
                <SettingGroup title={t("settingsPanels.video.quality")} color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {resolutionOptions.map((item) => (
                            <OptionPill key={item.value} selected={resolution === item.value} theme={theme} onClick={() => onConfigChange("vquality", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                        <ResolutionInput value={resolution} theme={theme} onChange={(value) => onConfigChange("vquality", value)} />
                    </div>
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.video.size")} color={theme.node.muted}>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                        <DimensionInput prefix="W" value={dimensions.width} disabled={size === "auto"} theme={theme} onChange={(value) => updateDimension("width", value)} />
                        <span className="text-lg opacity-45">↔</span>
                        <DimensionInput prefix="H" value={dimensions.height} disabled={size === "auto"} theme={theme} onChange={(value) => updateDimension("height", value)} />
                    </div>
                    <div className="grid grid-cols-3 gap-2.5">
                        {sizeOptions.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                className="flex h-[78px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent text-sm transition hover:opacity-80"
                                style={{ borderColor: size === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => onConfigChange("size", item.value)}
                            >
                                <SizePreview width={item.width} height={item.height} color={theme.node.text} />
                                <span>{t(`settingsPanels.video.sizes.${item.labelKey}`)}</span>
                                {item.value === "auto" ? null : (
                                    <span className="text-[13px] leading-none opacity-55">
                                        {item.value}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.video.seconds")} color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {secondOptions.map((value) => (
                            <OptionPill key={value} selected={seconds === String(value)} theme={theme} onClick={() => onConfigChange("videoSeconds", String(value))}>
                                {value}s
                            </OptionPill>
                        ))}
                        <NumberInput value={seconds} min={1} max={20} theme={theme} onChange={(value) => onConfigChange("videoSeconds", value)} />
                    </div>
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

function ApimartVideoSettingsPanel({ config, onConfigChange, theme, showTitle, className, prompt, imageCount, videoCount, audioCount }: VideoSettingsPanelProps) {
    const { t } = useTranslation();
    const model = config.videoModel || config.model;
    const policy = apimartVideoPolicy(model, { prompt, imageCount, videoCount, audioCount, resolution: config.vquality });
    const resolution = normalizeApimartVideoResolution(config.vquality, policy);
    const ratio = normalizeApimartVideoRatio(config.size, policy);
    const duration = normalizeApimartVideoDuration(config.videoSeconds, policy);
    const durationItems = policyDurationOptions(policy);
    const ratioReason = policy.ratioReason ? t(`settingsPanels.video.ratioLocked${capitalize(policy.ratioReason)}`) : "";
    const durationReason = policy.duration.forced !== undefined && policy.ratioReason !== "edit" ? t("apiErrors.apimartResolutionDuration") : "";
    const policyIssue = policy.issues[0];
    const hasOutputSettings = policy.features.generateAudio || policy.features.watermark || policy.features.returnLastFrame || policy.features.promptOptimizer || policy.features.fastPretreatment || policy.features.outputFormats.length > 1;

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">{t("settingsPanels.video.title")}</div> : null}
                {policyIssue ? <div className="rounded-lg border px-3 py-2 text-xs leading-5" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                    {t(`apiErrors.${policyIssue.code}`, { limit: policyIssue.limit })}
                </div> : null}
                <SettingGroup title={t("settingsPanels.video.resolution")} color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {policy.resolutions.map((item) => (
                            <OptionPill key={item} selected={resolution === item} theme={theme} onClick={() => onConfigChange("vquality", item)}>
                                {videoResolutionLabel(item)}
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup>
                {policy.ratios.length ? <SettingGroup title={t("settingsPanels.video.ratio")} color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {(policy.forcedRatio ? [policy.forcedRatio] : policy.ratios).map((item) => (
                            <button
                                key={item}
                                type="button"
                                disabled={Boolean(policy.forcedRatio)}
                                className="flex h-[68px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent px-1 text-sm transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-70"
                                style={{ borderColor: ratio === item ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => onConfigChange("size", item)}
                            >
                                <SizePreview width={ratioPreview(item).width} height={ratioPreview(item).height} color={theme.node.text} />
                                <span>{i18n.t(`settingsPanels.video.ratios.${seedanceRatioLabelKeys[item]}`)}</span>
                                <span className="text-[12px] leading-none opacity-55">{item}</span>
                            </button>
                        ))}
                    </div>
                    {ratioReason ? <div className="rounded-lg border px-3 py-2 text-xs leading-5" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>{ratioReason}</div> : null}
                </SettingGroup> : null}
                <SettingGroup title={t("settingsPanels.video.duration")} color={theme.node.muted}>
                    <div className="grid grid-cols-4 gap-2.5">
                        {durationItems.map((value) => (
                            <OptionPill key={value} selected={duration === value} disabled={policy.duration.forced !== undefined} theme={theme} onClick={() => onConfigChange("videoSeconds", String(value))}>
                                {value === -1 ? t("settingsPanels.video.smart") : `${value}s`}
                            </OptionPill>
                        ))}
                    </div>
                    {!policy.duration.values && policy.duration.forced === undefined ? <NumberInput value={String(duration)} min={policy.duration.min} max={policy.duration.max} theme={theme} onChange={(value) => onConfigChange("videoSeconds", value)} /> : null}
                    {durationReason ? <div className="rounded-lg border px-3 py-2 text-xs leading-5" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>{durationReason}</div> : null}
                </SettingGroup>
                {hasOutputSettings ? <SettingGroup title={t("settingsPanels.video.output")} color={theme.node.muted}>
                    <div className="grid gap-2 rounded-xl border p-2.5" style={{ borderColor: theme.node.stroke }}>
                        {policy.features.generateAudio ? <SwitchRow label={t("settingsPanels.video.generateAudio")} checked={boolConfig(config.videoGenerateAudio, true)} theme={theme} onChange={(checked) => onConfigChange("videoGenerateAudio", String(checked))} /> : null}
                        {policy.features.promptOptimizer ? <SwitchRow label={t("settingsPanels.video.promptOptimizer")} checked={boolConfig(config.videoPromptOptimizer, true)} theme={theme} onChange={(checked) => onConfigChange("videoPromptOptimizer", String(checked))} /> : null}
                        {policy.features.fastPretreatment ? <SwitchRow label={t("settingsPanels.video.fastPretreatment")} checked={boolConfig(config.videoFastPretreatment, false)} theme={theme} onChange={(checked) => onConfigChange("videoFastPretreatment", String(checked))} /> : null}
                        {policy.features.watermark ? <SwitchRow label={t("settingsPanels.video.watermark")} checked={boolConfig(config.videoWatermark, false)} theme={theme} onChange={(checked) => onConfigChange("videoWatermark", String(checked))} /> : null}
                        {policy.features.returnLastFrame ? <SwitchRow label={t("settingsPanels.video.returnLastFrame")} checked={boolConfig(config.videoReturnLastFrame, false)} theme={theme} onChange={(checked) => onConfigChange("videoReturnLastFrame", String(checked))} /> : null}
                    </div>
                    {policy.features.outputFormats.length > 1 ? <div className="grid grid-cols-2 gap-2.5">
                        {policy.features.outputFormats.map((value) => <OptionPill key={value} selected={(config.videoOutputFormat || "mp4") === value} theme={theme} onClick={() => onConfigChange("videoOutputFormat", value)}>{value.toUpperCase()}</OptionPill>)}
                    </div> : null}
                </SettingGroup> : null}
            </div>
        </ImageSettingsTheme>
    );
}

function SeedanceVideoSettingsPanel({ config, onConfigChange, theme, showTitle, className }: VideoSettingsPanelProps) {
    const { t } = useTranslation();
    const resolution = normalizeSeedanceResolution(config.vquality);
    const ratio = normalizeSeedanceRatio(config.size);
    const duration = normalizeSeedanceDuration(config.videoSeconds, 15);
    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">{t("settingsPanels.video.title")}</div> : null}
                <SettingGroup title={t("settingsPanels.video.resolution")} color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {seedanceResolutionOptions.map((item) => <OptionPill key={item.value} selected={resolution === item.value} theme={theme} onClick={() => onConfigChange("vquality", item.value)}>{item.label}</OptionPill>)}
                    </div>
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.video.ratio")} color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {seedanceRatioOptions.map((item) => <button key={item.value} type="button" className="flex h-[68px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent px-1 text-sm transition hover:opacity-80" style={{ borderColor: ratio === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onClick={() => onConfigChange("size", item.value)}><SizePreview width={ratioPreview(item.value).width} height={ratioPreview(item.value).height} color={theme.node.text} /><span>{i18n.t(`settingsPanels.video.ratios.${seedanceRatioLabelKeys[item.value]}`)}</span><span className="text-[12px] leading-none opacity-55">{item.value === "adaptive" ? "adaptive" : seedancePixelLabel(resolution, item.value)}</span></button>)}
                    </div>
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.video.duration")} color={theme.node.muted}>
                    <div className="grid grid-cols-4 gap-2.5">
                        {seedanceDurationOptions.map((value) => <OptionPill key={value} selected={duration === value} theme={theme} onClick={() => onConfigChange("videoSeconds", String(value))}>{value === -1 ? t("settingsPanels.video.smart") : `${value}s`}</OptionPill>)}
                    </div>
                    <NumberInput value={String(duration)} min={-1} max={15} theme={theme} onChange={(value) => onConfigChange("videoSeconds", value)} />
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.video.output")} color={theme.node.muted}>
                    <div className="grid gap-2 rounded-xl border p-2.5" style={{ borderColor: theme.node.stroke }}>
                        <SwitchRow label={t("settingsPanels.video.generateAudio")} checked={boolConfig(config.videoGenerateAudio, true)} theme={theme} onChange={(checked) => onConfigChange("videoGenerateAudio", String(checked))} />
                        <SwitchRow label={t("settingsPanels.video.watermark")} checked={boolConfig(config.videoWatermark, false)} theme={theme} onChange={(checked) => onConfigChange("videoWatermark", String(checked))} />
                    </div>
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

function policyDurationOptions(policy: ApimartVideoPolicy) {
    if (policy.duration.forced !== undefined) return [policy.duration.forced];
    if (policy.duration.values) return policy.duration.values;
    const values = [policy.duration.min, 5, 6, 8, 10, 12, 15, 20, 30, policy.duration.max].filter((value) => value >= policy.duration.min && value <= policy.duration.max);
    return [...(policy.duration.allowAuto ? [-1] : []), ...Array.from(new Set(values))];
}

function capitalize(value: "frames" | "edit" | "extend") {
    return value[0].toUpperCase() + value.slice(1);
}

export function videoResolutionLabel(value: string) {
    const resolution = normalizeVideoResolutionValue(value);
    return /k$/i.test(resolution) ? resolution.toUpperCase() : `${resolution}p`;
}

export function videoSizeLabel(value: string) {
    const ratio = normalizeSeedanceRatio(value);
    if (value === "adaptive" || value === "auto") return i18n.t("settingsPanels.video.adaptive");
    if (ratio === value) return i18n.t(`settingsPanels.video.ratios.${seedanceRatioLabelKeys[ratio]}`);
    const size = normalizeVideoSizeValue(value);
    const option = sizeOptions.find((item) => item.value === size);
    return option ? i18n.t(`settingsPanels.video.sizes.${option.labelKey}`) : size;
}

export function videoSecondsLabel(value: string) {
    if (String(value).trim() === "-1") return i18n.t("settingsPanels.video.smart");
    return `${value || "6"}s`;
}

export function normalizeVideoSizeValue(value: string) {
    if (value === "auto") return "auto";
    if (/^\d+x\d+$/.test(value || "")) return value;
    return ["9:16", "2:3", "3:4"].includes(value) ? "720x1280" : "1280x720";
}

export function normalizeVideoResolutionValue(value: string) {
    if (value === "480p" || value === "low") return "480";
    if (value === "720p" || value === "auto" || value === "high" || value === "medium") return "720";
    return value.replace(/p$/i, "") || "720";
}

function OptionPill({ selected, disabled = false, theme, onClick, children }: { selected: boolean; disabled?: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" disabled={disabled} className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-35" style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onClick={onClick}>
            {children}
        </button>
    );
}

function SettingGroup({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return (
        <div className="space-y-2.5">
            <div className="text-xs font-medium" style={{ color }}>
                {title}
            </div>
            {children}
        </div>
    );
}

function ResolutionInput({ value, theme, onChange }: { value: string; theme: CanvasTheme; onChange: (value: string) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-full border text-sm" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
            <input type="number" min={1} className="min-w-0 flex-1 bg-transparent px-3 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={value} onChange={(event) => onChange(event.target.value)} onMouseDown={(event) => event.stopPropagation()} />
            <span className="grid w-7 place-items-center pr-1" style={{ color: theme.node.muted }}>
                p
            </span>
        </label>
    );
}

function DimensionInput({ prefix, value, disabled, theme, onChange }: { prefix: string; value: number; disabled: boolean; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text, opacity: disabled ? 0.55 : 1 }}>
            <span className="grid w-9 place-items-center" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <input type="number" min={1} disabled={disabled} className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={value || ""} onChange={(event) => onChange(Number(event.target.value) || null)} onMouseDown={(event) => event.stopPropagation()} />
        </label>
    );
}

function NumberInput({ value, min, max, theme, onChange }: { value: string; min: number; max: number; theme: CanvasTheme; onChange: (value: string) => void }) {
    return <input type="number" min={min} max={max} className="h-9 rounded-full border bg-transparent px-3 text-center text-sm outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" style={{ borderColor: theme.node.stroke, color: theme.node.text, WebkitTextFillColor: theme.node.text }} value={value} onChange={(event) => onChange(event.target.value)} onMouseDown={(event) => event.stopPropagation()} />;
}

function SizePreview({ width, height, color }: { width: number; height: number; color: string }) {
    if (!width || !height) return null;
    const longSide = Math.max(width, height);
    const previewWidth = Math.max(10, Math.round((width / longSide) * 26));
    const previewHeight = Math.max(10, Math.round((height / longSide) * 26));
    return <span className="rounded-[3px] border-2" style={{ width: previewWidth, height: previewHeight, borderColor: color }} />;
}

function ratioPreview(ratio: string) {
    if (ratio === "9:16") return { width: 9, height: 16 };
    if (ratio === "1:1") return { width: 1, height: 1 };
    if (ratio === "4:3") return { width: 4, height: 3 };
    if (ratio === "3:4") return { width: 3, height: 4 };
    if (ratio === "21:9") return { width: 21, height: 9 };
    if (ratio === "adaptive") return { width: 0, height: 0 };
    return { width: 16, height: 9 };
}

function SwitchRow({ label, checked, theme, onChange }: { label: string; checked: boolean; theme: CanvasTheme; onChange: (checked: boolean) => void }) {
    return (
        <div className="flex h-8 items-center justify-between gap-3">
            <span className="text-sm" style={{ color: theme.node.text }}>
                {label}
            </span>
            <span onMouseDown={(event) => event.stopPropagation()}>
                <Switch size="small" checked={checked} onChange={onChange} />
            </span>
        </div>
    );
}

function readSizeDimensions(size: string) {
    if (size === "auto") return { width: 0, height: 0 };
    const match = size.match(/^(\d+)x(\d+)$/);
    return { width: Number(match?.[1]) || 1280, height: Number(match?.[2]) || 720 };
}
