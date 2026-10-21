import { apimartModelFamily } from "./apimart-models.ts";

export type ApimartImageRole = { url: string; role: "first_frame" | "last_frame" | "reference_image" };

export type ApimartVideoPayloadInput = {
    model: string;
    prompt: string;
    duration?: number;
    resolution?: string;
    ratio?: string;
    generateAudio?: boolean;
    watermark?: boolean;
    promptOptimizer?: boolean;
    fastPretreatment?: boolean;
    seed?: number;
    returnLastFrame?: boolean;
    outputFormat?: "mp4" | "mov";
    imageUrls?: string[];
    imageWithRoles?: ApimartImageRole[];
    videoUrls?: string[];
    audioUrls?: string[];
};

export type ApimartTaskState = { status: "pending" | "completed" | "failed"; url?: string; error?: string };

export function buildApimartVideoPayload(input: ApimartVideoPayloadInput): Record<string, unknown> {
    const family = apimartModelFamily(input.model);
    const payload: Record<string, unknown> = { model: input.model, prompt: input.prompt };

    if (family === "seedance") {
        const is25 = /2(?:\.|-)5/.test(input.model);
        const is20 = /2(?:\.|-)0/.test(input.model);
        if (input.duration !== undefined && (is25 || input.duration !== -1)) payload.duration = input.duration;
        if (input.resolution) payload.resolution = input.resolution;
        if (input.ratio) payload[is20 || is25 ? "size" : "aspect_ratio"] = input.ratio;
        if (is20 || is25) payload.generate_audio = input.generateAudio ?? true;
        else if (/1(?:\.|-)5/.test(input.model)) payload.audio = input.generateAudio ?? true;
        if (input.watermark !== undefined && is25) payload.watermark = input.watermark;
        if (input.seed !== undefined) payload.seed = input.seed;
        if (input.returnLastFrame && (is20 || is25)) payload.return_last_frame = true;
        if (input.outputFormat && is25) payload.output_format = input.outputFormat;
        addSeedanceReferences(payload, input);
        return payload;
    }

    if (family === "minimax-hailuo") {
        if (input.duration !== undefined) payload.duration = input.duration;
        if (input.resolution) payload.resolution = input.resolution;
        payload.prompt_optimizer = input.promptOptimizer ?? true;
        payload.fast_pretreatment = input.fastPretreatment ?? false;
        payload.watermark = input.watermark ?? false;
        const images = input.imageUrls || [];
        if (images[0]) payload.first_frame_image = images[0];
        if (/hailuo-02/i.test(input.model) && images[1]) payload.last_frame_image = images[1];
        return payload;
    }

    if (family === "minimax-h3") {
        if (input.duration !== undefined) payload.duration = input.duration;
        if (input.resolution) payload.resolution = input.resolution;
        if (input.ratio) payload.aspect_ratio = input.ratio;
        payload.watermark = input.watermark ?? false;
        if (input.imageWithRoles?.length) payload.image_with_roles = input.imageWithRoles;
        else if (input.imageUrls?.length) payload.image_urls = input.imageUrls;
        if (input.videoUrls?.length) payload.video_urls = input.videoUrls;
        if (input.audioUrls?.length) payload.audio_urls = input.audioUrls;
    }

    return payload;
}

function addSeedanceReferences(payload: Record<string, unknown>, input: ApimartVideoPayloadInput) {
    if (input.imageWithRoles?.length) payload.image_with_roles = input.imageWithRoles;
    else if (input.imageUrls?.length) payload.image_urls = input.imageUrls;
    if (input.videoUrls?.length) payload.video_urls = input.videoUrls;
    if (input.audioUrls?.length) payload.audio_urls = input.audioUrls;
}

export function parseApimartCreateResponse(payload: unknown) {
    const record = asRecord(payload);
    const code = record?.code;
    if (code !== undefined && code !== 200 && code !== "200") throw new Error(readApimartError(payload) || "APIMart 任务创建失败");
    const data = Array.isArray(record?.data) ? record.data[0] : undefined;
    const taskId = asRecord(data)?.task_id;
    if (typeof taskId !== "string" || !taskId) throw new Error(readApimartError(payload) || "APIMart 接口没有返回任务 ID");
    return taskId;
}

export function parseApimartTaskResponse(payload: unknown): ApimartTaskState {
    const record = asRecord(payload);
    const data = asRecord(record?.data) || record;
    const status = String(data?.status || "").toLowerCase();
    if (["failed", "error", "cancelled", "canceled"].includes(status)) return { status: "failed", error: readApimartError(data) || "APIMart 视频生成失败" };
    if (status !== "completed" && status !== "succeeded" && status !== "success") return { status: "pending" };
    const result = asRecord(data?.result);
    const videos = Array.isArray(result?.videos) ? result.videos : [];
    const first = videos[0];
    const url = firstUrl(typeof first === "string" ? first : asRecord(first)?.url);
    if (typeof url === "string" && url) return { status: "completed", url };
    const directUrl = firstUrl(result?.video_url || result?.url);
    if (directUrl) return { status: "completed", url: directUrl };
    return { status: "failed", error: "APIMart 任务完成但没有返回视频 URL" };
}

function firstUrl(value: unknown) {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.find((item): item is string => typeof item === "string") || "";
    return "";
}

function asRecord(value: unknown): Record<string, any> | undefined {
    return value && typeof value === "object" ? (value as Record<string, any>) : undefined;
}

function readApimartError(value: unknown): string {
    const record = asRecord(value);
    if (!record) return typeof value === "string" ? value : "";
    const error = record.error;
    if (typeof error === "string") return error;
    if (asRecord(error)?.message) return String(asRecord(error)?.message);
    return String(record.message || record.msg || "");
}
