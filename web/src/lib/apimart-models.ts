export type ApimartModelFamily = "gpt-image" | "seedream" | "seedance" | "minimax-image" | "minimax-hailuo" | "minimax-h3" | "unknown";
export type ApimartModelCapability = "image" | "video";
export type ApimartVideoLimits = { images: number; videos: number; audios: number; maxDurationSeconds: number };

export type ApimartImagePolicy = {
    resolutions: string[];
    defaultResolution: string;
    ratios: string[];
    allowCustomSize: boolean;
    maxReferences: number;
    transparentBackground: boolean;
};

export type ApimartVideoPolicyIssue = {
    code: "apimartTooManyImages" | "apimartTooManyVideos" | "apimartTooManyAudios" | "seedanceAudioRequiresVisual" | "apimartHailuoFastRequiresImage";
    limit?: number;
};

export type ApimartVideoPolicy = {
    mode: "text" | "frames" | "references" | "edit" | "extend";
    imageRoleMode: "frames" | "references";
    resolutions: string[];
    ratios: string[];
    forcedRatio?: "adaptive";
    ratioReason?: "frames" | "edit" | "extend";
    duration: { min: number; max: number; values?: number[]; allowAuto?: boolean; forced?: number };
    limits: ApimartVideoLimits & { imageMaxBytes: number; videoMaxBytes: number; audioMaxBytes: number; maxReferenceSeconds: number };
    features: { generateAudio: boolean; watermark: boolean; returnLastFrame: boolean; outputFormats: Array<"mp4" | "mov">; promptOptimizer: boolean; fastPretreatment: boolean };
    issues: ApimartVideoPolicyIssue[];
};

export type ApimartVideoPolicyContext = {
    prompt?: string;
    imageCount?: number;
    videoCount?: number;
    audioCount?: number;
    resolution?: string;
};

const APIMART_IMAGE_RATIOS = ["1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "3:1", "1:3", "21:9", "9:21", "auto"];
const SEEDREAM_RATIOS = ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9", "9:21", "auto"];
const APIMART_VIDEO_RATIOS = ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"];
const MB = 1024 * 1024;

export function isApimartConfig(config: { baseUrl?: string; adapterPreset?: string }) {
    return config.adapterPreset === "apimart-gpt-image" || /(?:^|[/.])api\.apimart\.ai(?:\/|$)/i.test(config.baseUrl?.trim() || "");
}

export function apimartModelFamily(model: string): ApimartModelFamily {
    const value = model.trim().toLowerCase();
    if (value.includes("seedream")) return "seedream";
    if (value.includes("gpt-image")) return "gpt-image";
    if (value.includes("seedance")) return "seedance";
    if (value.includes("minimax") && value.includes("image")) return "minimax-image";
    if (value.includes("minimax") && value.includes("h3")) return "minimax-h3";
    if (value.includes("minimax") && value.includes("hailuo")) return "minimax-hailuo";
    return "unknown";
}

export function apimartModelCapability(model: string): ApimartModelCapability | undefined {
    const family = apimartModelFamily(model);
    if (family === "gpt-image" || family === "seedream" || family === "minimax-image") return "image";
    if (family === "seedance" || family === "minimax-hailuo" || family === "minimax-h3") return "video";
    return undefined;
}

export function isApimartWorkflowModel(model: string) {
    const value = model.toLowerCase();
    return value.includes("context-ir") || value.includes("regeneration");
}

export function isApimartSeedance20Standard(model: string) {
    return /seedance[-.]?2(?:[-.]?0)(?:[-.]|$)/i.test(model) && !/(?:fast|mini|face)/i.test(model);
}

export function apimartImagePolicy(model: string, context: { outputCount?: number } = {}): ApimartImagePolicy | undefined {
    const family = apimartModelFamily(model);
    const outputCount = Math.max(1, Math.floor(context.outputCount || 1));
    if (family === "gpt-image") {
        return { resolutions: ["1K", "2K", "4K"], defaultResolution: "1K", ratios: APIMART_IMAGE_RATIOS, allowCustomSize: true, maxReferences: 16, transparentBackground: false };
    }
    if (family !== "seedream") return undefined;
    if (/seedream[-.]?5(?:[-.]?0)?[-.]?pro/i.test(model)) {
        return { resolutions: ["1K", "1.5K", "2K"], defaultResolution: "1K", ratios: SEEDREAM_RATIOS.filter((ratio) => ratio !== "9:21"), allowCustomSize: true, maxReferences: 10, transparentBackground: false };
    }
    if (/seedream[-.]?5(?:[-.]?0)?[-.]?lite/i.test(model)) {
        return { resolutions: ["2K", "3K", "4K"], defaultResolution: "2K", ratios: SEEDREAM_RATIOS.filter((ratio) => ratio !== "9:21"), allowCustomSize: false, maxReferences: Math.max(0, 15 - outputCount), transparentBackground: false };
    }
    if (/seedream[-.]?4(?:[-.]?5)/i.test(model)) {
        return { resolutions: ["2K", "4K"], defaultResolution: "2K", ratios: SEEDREAM_RATIOS, allowCustomSize: false, maxReferences: Math.max(0, 15 - outputCount), transparentBackground: false };
    }
    return { resolutions: ["1K", "2K", "4K"], defaultResolution: "2K", ratios: SEEDREAM_RATIOS, allowCustomSize: false, maxReferences: Math.max(0, 15 - outputCount), transparentBackground: false };
}

export function normalizeApimartImageResolution(model: string, value: string) {
    const policy = apimartImagePolicy(model);
    if (!policy) return value.trim().toLowerCase();
    const normalized = value.trim().toUpperCase();
    const direct = policy.resolutions.find((resolution) => resolution.toUpperCase() === normalized);
    if (direct) return direct;
    if (normalized === "LOW") return policy.resolutions[0];
    if (normalized === "HIGH") return policy.resolutions.at(-1) || policy.defaultResolution;
    if (normalized === "MEDIUM") return policy.resolutions.find((resolution) => resolution === "2K") || policy.resolutions[Math.floor(policy.resolutions.length / 2)];
    return policy.defaultResolution;
}

export function normalizeApimartImageSize(model: string, value: string) {
    const policy = apimartImagePolicy(model);
    if (!policy) return value;
    const size = value.trim().toLowerCase() || "auto";
    if (policy.ratios.includes(size)) return size;
    if (policy.allowCustomSize && /^\d+[x×]\d+$/i.test(size)) return size.replace("×", "x");
    return policy.ratios.includes("auto") ? "auto" : policy.ratios[0];
}

export function apimartVideoLimits(model: string): ApimartVideoLimits {
    const value = model.toLowerCase();
    const family = apimartModelFamily(model);
    if (family === "seedance") {
        if (value.includes("2.5") || value.includes("2-5")) return { images: 30, videos: 10, audios: 10, maxDurationSeconds: 30 };
        if (value.includes("1.0") || value.includes("1-0")) return { images: value.includes("quality") ? 2 : 1, videos: 0, audios: 0, maxDurationSeconds: 12 };
        if (value.includes("1.5") || value.includes("1-5")) return { images: 2, videos: 0, audios: 0, maxDurationSeconds: 12 };
        return { images: 9, videos: 3, audios: 3, maxDurationSeconds: 15 };
    }
    if (family === "minimax-hailuo") {
        return value.includes("2.3") || value.includes("2-3") ? { images: 1, videos: 0, audios: 0, maxDurationSeconds: 10 } : { images: 2, videos: 0, audios: 0, maxDurationSeconds: 10 };
    }
    if (family === "minimax-h3") return { images: 9, videos: 3, audios: 3, maxDurationSeconds: 15 };
    return { images: 0, videos: 0, audios: 0, maxDurationSeconds: 15 };
}

export function apimartVideoPolicy(model: string, context: ApimartVideoPolicyContext = {}): ApimartVideoPolicy {
    const family = apimartModelFamily(model);
    const imageCount = Math.max(0, context.imageCount || 0);
    const videoCount = Math.max(0, context.videoCount || 0);
    const audioCount = Math.max(0, context.audioCount || 0);
    const hasReferences = imageCount + videoCount + audioCount > 0;
    const frameCapable = family === "seedance" || family === "minimax-hailuo" || family === "minimax-h3";
    const frames = frameCapable && imageCount > 0 && imageCount <= 2 && videoCount === 0 && audioCount === 0;
    const prompt = context.prompt?.trim() || "";
    const edit = hasReferences && /(?:编辑(?:视频)?|删除|修改|替换|增加|edit|remove|replace|modify)/i.test(prompt);
    const extend = hasReferences && /(?:向前延长|向后延长|延长|延续|续写|extend|continue)/i.test(prompt);
    const mode = edit ? "edit" : extend ? "extend" : frames ? "frames" : hasReferences ? "references" : "text";
    const limits = apimartVideoLimits(model);
    const baseLimits = { ...limits, imageMaxBytes: 30 * MB, videoMaxBytes: 200 * MB, audioMaxBytes: 15 * MB, maxReferenceSeconds: limits.maxDurationSeconds };
    const issues: ApimartVideoPolicyIssue[] = [];
    if (imageCount > limits.images) issues.push({ code: "apimartTooManyImages", limit: limits.images });
    if (videoCount > limits.videos) issues.push({ code: "apimartTooManyVideos", limit: limits.videos });
    if (audioCount > limits.audios) issues.push({ code: "apimartTooManyAudios", limit: limits.audios });

    if (family === "seedance") {
        const is25 = /2(?:\.|-)5/.test(model);
        const is20 = /2(?:\.|-)0|2-0/.test(model);
        const is15 = /1(?:\.|-)5|1-5/.test(model);
        const is10 = /1(?:\.|-)0|1-0/.test(model);
        if (audioCount && !is25 && !imageCount && !videoCount) issues.push({ code: "seedanceAudioRequiresVisual" });
        if (is25) {
            return {
                mode,
                imageRoleMode: frames ? "frames" : "references",
                resolutions: ["480p", "720p", "1080p"],
                ratios: [...APIMART_VIDEO_RATIOS, "adaptive"],
                ...(mode === "frames" || mode === "edit" || mode === "extend" ? { forcedRatio: "adaptive" as const, ratioReason: mode as "frames" | "edit" | "extend" } : {}),
                duration: { min: 4, max: 30, allowAuto: true, ...(mode === "edit" ? { forced: -1 } : {}) },
                limits: baseLimits,
                features: { generateAudio: true, watermark: true, returnLastFrame: true, outputFormats: ["mp4", "mov"], promptOptimizer: false, fastPretreatment: false },
                issues,
            };
        }
        if (is20) {
            return {
                mode,
                imageRoleMode: frames ? "frames" : "references",
                resolutions: isApimartSeedance20Standard(model) ? ["480p", "720p", "1080p", "4k"] : ["480p", "720p"],
                ratios: [...APIMART_VIDEO_RATIOS, "adaptive"],
                duration: { min: 4, max: 15 },
                limits: baseLimits,
                features: { generateAudio: true, watermark: false, returnLastFrame: true, outputFormats: ["mp4"], promptOptimizer: false, fastPretreatment: false },
                issues,
            };
        }
        return {
            mode,
            imageRoleMode: "frames",
            resolutions: ["480p", "720p", "1080p"],
            ratios: APIMART_VIDEO_RATIOS,
            duration: is10 ? { min: 2, max: 12, values: [2, 3, 4, 5, 6, 8, 10, 12] } : { min: 4, max: 12, values: [4, 5, 6, 8, 10, 12] },
            limits: baseLimits,
            features: { generateAudio: is15, watermark: false, returnLastFrame: false, outputFormats: ["mp4"], promptOptimizer: false, fastPretreatment: false },
            issues,
        };
    }

    if (family === "minimax-hailuo") {
        const is23 = /2(?:\.|-)3/.test(model);
        const resolutions = is23 ? ["768p", "1080p"] : ["512p", "768p", "1080p"];
        const values = is23 ? [6, 10] : [5, 10];
        const is1080 = /1080/i.test(context.resolution || "");
        if (/fast/i.test(model) && !imageCount) issues.push({ code: "apimartHailuoFastRequiresImage" });
        return {
            mode,
            imageRoleMode: "frames",
            resolutions,
            ratios: [],
            duration: { min: values[0], max: values.at(-1) || values[0], values, ...(is1080 ? { forced: values[0] } : {}) },
            limits: baseLimits,
            features: { generateAudio: false, watermark: true, returnLastFrame: false, outputFormats: ["mp4"], promptOptimizer: true, fastPretreatment: true },
            issues,
        };
    }

    if (family === "minimax-h3") {
        if (audioCount && !imageCount && !videoCount) issues.push({ code: "seedanceAudioRequiresVisual" });
        return {
            mode,
            imageRoleMode: frames ? "frames" : "references",
            resolutions: ["2K", "768P"],
            ratios: mode === "text" ? APIMART_VIDEO_RATIOS : [...APIMART_VIDEO_RATIOS, "adaptive"],
            ...(frames ? { forcedRatio: "adaptive" as const, ratioReason: "frames" as const } : {}),
            duration: { min: 4, max: 15 },
            limits: { ...baseLimits, videoMaxBytes: 50 * MB, maxReferenceSeconds: 15 },
            features: { generateAudio: false, watermark: true, returnLastFrame: false, outputFormats: ["mp4"], promptOptimizer: false, fastPretreatment: false },
            issues,
        };
    }

    return {
        mode,
        imageRoleMode: "references",
        resolutions: ["720p"],
        ratios: APIMART_VIDEO_RATIOS,
        duration: { min: 1, max: 15 },
        limits: baseLimits,
        features: { generateAudio: false, watermark: false, returnLastFrame: false, outputFormats: ["mp4"], promptOptimizer: false, fastPretreatment: false },
        issues,
    };
}

export function normalizeApimartVideoResolution(value: string, policy: ApimartVideoPolicy) {
    const requested = String(value || "").trim().toLowerCase().replace(/p$/, "");
    const direct = policy.resolutions.find((item) => item.toLowerCase().replace(/p$/, "") === requested);
    if (direct) return direct;
    if (requested === "720") return policy.resolutions.find((item) => /^768p$/i.test(item)) || policy.resolutions.find((item) => /^720p$/i.test(item)) || policy.resolutions[0];
    if (["auto", "medium", "high", ""].includes(requested)) return policy.resolutions.find((item) => /720|768/i.test(item)) || policy.resolutions[0];
    if (requested === "low") return policy.resolutions.find((item) => /480|512|720|768/i.test(item)) || policy.resolutions[0];
    return policy.resolutions.find((item) => /720|768/i.test(item)) || policy.resolutions[0];
}

export function normalizeApimartVideoRatio(value: string, policy: ApimartVideoPolicy) {
    if (policy.forcedRatio) return policy.forcedRatio;
    if (!policy.ratios.length) return undefined;
    const requested = String(value || "").trim().toLowerCase();
    const direct = policy.ratios.find((item) => item.toLowerCase() === requested);
    if (direct) return direct;
    if (!requested || requested === "auto") return policy.ratios.includes("adaptive") ? "adaptive" : policy.ratios[0];
    const dimensions = requested.match(/^(\d+)x(\d+)$/);
    if (!dimensions) return policy.ratios[0];
    const target = Number(dimensions[1]) / Number(dimensions[2]);
    const ratios = policy.ratios.filter((item) => item !== "adaptive");
    return ratios.reduce((closest, item) => Math.abs(readRatio(item) - target) < Math.abs(readRatio(closest) - target) ? item : closest, ratios[0]);
}

export function normalizeApimartVideoDuration(value: string, policy: ApimartVideoPolicy) {
    if (policy.duration.forced !== undefined) return policy.duration.forced;
    const requested = Math.floor(Number(value) || policy.duration.min);
    if (requested === -1 && policy.duration.allowAuto) return -1;
    if (policy.duration.values?.length) return policy.duration.values.reduce((closest, current) => Math.abs(current - requested) < Math.abs(closest - requested) ? current : closest);
    return Math.max(policy.duration.min, Math.min(policy.duration.max, requested));
}

function readRatio(value: string) {
    const [width, height] = value.split(":").map(Number);
    return width / height;
}
