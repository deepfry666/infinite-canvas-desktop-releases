import type { DeclarativeProviderMapping, ProviderAdapter, ProviderInput, ProviderPollResult, ProviderProfile, ProviderRemoteHandle, ProviderResult, ProviderSubmission, ProviderTask, ProviderTransport } from "./types";
import { APIMART_GPT_IMAGE_PRESET, DECLARATIVE_PRESET, GEMINI_PRESET, OPENAI_COMPATIBLE_PRESET } from "./presets";
import { apimartImagePolicy, apimartModelFamily, normalizeApimartImageResolution, normalizeApimartImageSize } from "@/lib/apimart-models";
import { localizeApimartError } from "@/lib/apimart-error";
import { dataUrlToFile } from "@/lib/image-utils";
import { createProviderHttpError, createProviderTaskTerminalError, withProviderErrorMessage } from "./provider-error";

const defaultTransport: ProviderTransport = {
    async request({ method, url, headers, body, signal }) {
        const multipart = typeof FormData !== "undefined" && body instanceof FormData;
        const requestHeaders = multipart ? Object.fromEntries(Object.entries(headers || {}).filter(([key]) => key.toLowerCase() !== "content-type")) : headers;
        const requestBody = method === "GET" || body === undefined ? undefined : multipart ? body : JSON.stringify(body);
        const response = await fetch(url, { method, headers: requestHeaders, body: requestBody, signal });
        const contentType = response.headers.get("content-type") || "";
        const data = contentType.includes("application/json") ? await response.json() : await response.text();
        return { status: response.status, data, headers: response.headers };
    },
};

export class ProviderTaskPendingError extends Error {
    readonly taskId: string;

    constructor(taskId: string) {
        super(`中转站仍在处理这项任务，四季画布没有将它判定为失败。可稍后继续查询（任务 ID：${taskId}）。`);
        this.name = "ProviderTaskPendingError";
        this.taskId = taskId;
    }
}

function joinUrl(baseUrl: string, path: string, appendDefaultVersion = true) {
    if (/^https?:\/\//i.test(path)) return path;
    const base = baseUrl.trim().replace(/\/+$/, "");
    const suffix = path.startsWith("/") ? path : `/${path}`;
    if (!appendDefaultVersion) return `${base}${suffix}`;
    if (base.toLowerCase().endsWith("/v1") || base.toLowerCase().endsWith("/v1beta") || base.toLowerCase().endsWith("/api/v3")) return `${base}${suffix}`;
    return `${base}/v1${suffix}`;
}

function headers(profile: ProviderProfile) {
    return { Authorization: `Bearer ${profile.apiKey}`, "Content-Type": "application/json" };
}

function idempotencyHeaders(profile: ProviderProfile, idempotencyKey: string) {
    return { ...headers(profile), ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) };
}

function throwHttp(status: number, data: unknown): never {
    const message = readProviderError(data) || `请求失败（HTTP ${status}）`;
    throw createProviderHttpError(status, message);
}

function readProviderError(value: unknown): string {
    if (typeof value === "string") return value;
    if (!value || typeof value !== "object") return "";
    const payload = value as { message?: unknown; msg?: unknown; detail?: unknown; error?: unknown; data?: unknown };
    return [payload.message, payload.msg, payload.error, payload.detail, payload.data].map(readProviderError).find(Boolean) || "";
}

function readPath(value: unknown, path: string): unknown {
    if (path === "$" || path === "") return value;
    const tokens = path.replace(/^\$\.?/, "").split(".").filter(Boolean);
    const visit = (current: unknown, index: number): unknown => {
        if (index >= tokens.length) return current;
        if (current === null || current === undefined) return undefined;
        const token = tokens[index];
        if (token === "[*]" || token === "*") {
            return Array.isArray(current) ? current.flatMap((item) => [visit(item, index + 1)]) : [];
        }
        const propertyWithWildcard = token.match(/^([^[]+)\[\*\]$/);
        if (propertyWithWildcard) {
            const list = (current as Record<string, unknown>)[propertyWithWildcard[1]];
            return Array.isArray(list) ? list.map((item) => visit(item, index + 1)) : [];
        }
        const propertyWithIndex = token.match(/^([^[]+)\[(\d+)\]$/);
        if (propertyWithIndex) {
            const list = (current as Record<string, unknown>)[propertyWithIndex[1]];
            return Array.isArray(list) ? visit(list[Number(propertyWithIndex[2])], index + 1) : undefined;
        }
        return visit((current as Record<string, unknown>)[token], index + 1);
    };
    return visit(value, 0);
}

function resolveRefs(value: unknown, input: Record<string, unknown>): unknown {
    if (typeof value === "string") {
        const exactReference = value.match(/^\$[A-Za-z0-9_.[\]*]+$/);
        if (exactReference) return readPath(input, value);
        return value.replace(/\$[A-Za-z0-9_.[\]*]+/g, (reference) => {
            const resolved = readPath(input, reference);
            return resolved === undefined || resolved === null ? "" : String(resolved);
        });
    }
    if (Array.isArray(value)) return value.map((item) => resolveRefs(item, input));
    if (value && typeof value === "object") {
        if ("$ref" in value && typeof (value as { $ref?: unknown }).$ref === "string") return readPath(input, (value as { $ref: string }).$ref);
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveRefs(item, input)]));
    }
    return value;
}

function normalizeImages(value: unknown): Array<{ url?: string; dataUrl?: string }> {
    const list = (Array.isArray(value) ? value.flat(Infinity) : [value]) as unknown[];
    const result: Array<{ url?: string; dataUrl?: string }> = [];
    for (const item of list) {
        if (typeof item === "string") result.push({ url: item });
        if (item && typeof item === "object") {
            const record = item as Record<string, unknown>;
            if (typeof record.b64_json === "string") result.push({ dataUrl: `data:image/png;base64,${record.b64_json}` });
            else if (typeof record.url === "string") result.push({ url: record.url });
            else if (Array.isArray(record.url)) record.url.filter((value): value is string => typeof value === "string").forEach((url) => result.push({ url }));
            else if (typeof record.dataUrl === "string") result.push({ dataUrl: record.dataUrl });
            else if (typeof record.image_url === "string") result.push({ url: record.image_url });
            else if (record.image_url && typeof record.image_url === "object") result.push(...normalizeImages(record.image_url));
            else if (typeof record.imageUrl === "string") result.push({ url: record.imageUrl });
        }
    }
    return result;
}

export const APIMART_GPT_IMAGE_MAPPING: DeclarativeProviderMapping = {
    appendDefaultVersion: true,
    endpoints: {
        "image.generate": {
            method: "POST",
            path: "/images/generations",
            body: {
                model: { $ref: "$model" },
                prompt: { $ref: "$prompt" },
                n: { $ref: "$options.count" },
                size: { $ref: "$options.aspectRatio" },
                resolution: { $ref: "$options.resolution" },
            },
            response: { taskId: "$.data[0].task_id", status: "$.data[0].status" },
        },
        "image.edit": {
            method: "POST",
            path: "/images/generations",
            body: {
                model: { $ref: "$model" },
                prompt: { $ref: "$prompt" },
                n: { $ref: "$options.count" },
                size: { $ref: "$options.aspectRatio" },
                resolution: { $ref: "$options.resolution" },
                image_urls: { $ref: "$referenceDataUrls" },
            },
            response: { taskId: "$.data[0].task_id", status: "$.data[0].status" },
        },
    },
    polling: {
        method: "GET",
        path: "/tasks/$taskId?language=zh",
        statusPath: "$.data.status",
        successValues: ["completed"],
        failureValues: ["failed", "error", "cancelled", "canceled"],
        resultPath: "$.data.result.images[*]",
        intervalMs: 1500,
        timeoutMs: 30 * 60 * 1000,
    },
};

export function waitFor(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("请求已取消", "AbortError"));
            return;
        }
        let timer: ReturnType<typeof setTimeout>;
        const onAbort = () => {
            clearTimeout(timer);
            reject(new DOMException("请求已取消", "AbortError"));
        };
        timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

export function createProviderRegistry(transport: ProviderTransport = defaultTransport) {
    const adapters: Record<string, ProviderAdapter> = {};

    const openAi: ProviderAdapter = {
        id: OPENAI_COMPATIBLE_PRESET,
        label: "OpenAI 兼容接口",
        supports: (profile, task) => Boolean(profile.models.some((model) => model.capabilities[task.split(".")[0] as "text" | "image" | "video" | "audio"])),
        async probe(profile) {
            const response = await transport.request({ method: "GET", url: joinUrl(profile.baseUrl, "/models"), headers: { Authorization: `Bearer ${profile.apiKey}` } });
            if (response.status >= 400) throwHttp(response.status, response.data);
            return { source: "probe", checkedAt: new Date().toISOString(), text: true, image: true, streaming: true };
        },
        async submit(profile, input, idempotencyKey) {
            const task = input.task;
            if (task === "image.generate") {
                const options = input.options || {};
                const response = await transport.request({ method: "POST", url: joinUrl(profile.baseUrl, "/images/generations"), headers: idempotencyHeaders(profile, idempotencyKey), body: { model: input.model, prompt: input.prompt || "", n: options.count || 1, size: options.size || options.pixelSize || "1024x1024", ...(options.quality ? { quality: options.quality } : {}), response_format: "b64_json" }, signal: input.signal });
                if (response.status >= 400) throwHttp(response.status, response.data);
                return { status: "completed", result: normalizeImages((response.data as { data?: unknown })?.data || response.data) };
            }
            if (task === "text.generate") {
                const response = await transport.request({ method: "POST", url: joinUrl(profile.baseUrl, "/chat/completions"), headers: idempotencyHeaders(profile, idempotencyKey), body: { model: input.model, messages: input.messages || [{ role: "user", content: input.prompt || "" }], stream: false }, signal: input.signal });
                if (response.status >= 400) throwHttp(response.status, response.data);
                const data = response.data as { choices?: Array<{ message?: { content?: string } }> };
                return { status: "completed", result: data.choices?.[0]?.message?.content || "" };
            }
            throw new Error(`当前预设暂不支持 ${task}，请为此中转站选择声明式适配器或开发者脚本。`);
        },
        async poll() {
            return { status: "pending" };
        },
        async execute(profile, input): Promise<import("./types").ProviderResult> {
            return executeAdapter(this, profile, input);
        },
    };

    const declarative: ProviderAdapter = {
        id: DECLARATIVE_PRESET,
        label: "声明式接口",
        supports: (profile, task) => Boolean(profile.mapping?.endpoints[task]),
        async probe(profile) {
            return { source: "manual", checkedAt: new Date().toISOString() };
        },
        async submit(profile, input, idempotencyKey): Promise<ProviderSubmission> {
            const endpoint = profile.mapping?.endpoints[input.task];
            if (!endpoint) throw new Error(`声明式配置缺少 ${input.task} 接口`);
            const refs = input.references || [];
            const context = providerContext(input, refs);
            const customHeaders = Object.fromEntries(Object.entries(resolveRefs(endpoint.headers || {}, context) as Record<string, unknown>).map(([key, value]) => [key, String(value)]));
            const auth = profile.mapping?.auth;
            const requestHeaders: Record<string, string> = { "Content-Type": "application/json", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}), ...customHeaders };
            let requestUrl = joinUrl(profile.baseUrl, String(resolveRefs(endpoint.path, context)), profile.mapping?.appendDefaultVersion ?? false);
            if (!auth || auth.type === "bearer") requestHeaders.Authorization = `Bearer ${profile.apiKey}`;
            if (auth?.type === "header" && auth.name) requestHeaders[auth.name] = profile.apiKey;
            if (auth?.type === "query" && auth.name) requestUrl = `${requestUrl}${requestUrl.includes("?") ? "&" : "?"}${encodeURIComponent(auth.name)}=${encodeURIComponent(profile.apiKey)}`;
            const response = await transport.request({ method: endpoint.method || "POST", url: requestUrl, headers: requestHeaders, body: resolveRefs(endpoint.body || {}, context), signal: input.signal });
            if (response.status >= 400) throwHttp(response.status, response.data);
            const taskId = endpoint.response?.taskId ? readPath(response.data, endpoint.response.taskId) : undefined;
            if (typeof taskId === "string" && profile.mapping?.polling) return { status: "accepted", handle: { taskId } };
            return { status: "completed", result: readDeclarativeResult(input.task, endpoint.response, response.data) };
        },
        async poll(profile, input, handle) {
            const polling = profile.mapping?.polling;
            if (!polling) throw new Error("声明式配置缺少轮询接口");
            return pollDeclarativeOnce(profile, input, polling, handle.taskId, providerContext(input, input.references || []), transport);
        },
        async execute(profile, input): Promise<ProviderResult> {
            return executeAdapter(this, profile, input);
        },
    };

    const apimart: ProviderAdapter = {
        id: APIMART_GPT_IMAGE_PRESET,
        label: "APIMart 全媒体",
        supports: (_profile, task) => task === "image.generate" || task === "image.edit",
        async probe() {
            return { source: "manual", checkedAt: new Date().toISOString(), image: true, video: true, async: true, remoteResume: true, idempotency: true };
        },
        async submit(profile, input, idempotencyKey) {
            const imagePolicy = apimartImagePolicy(input.model, { outputCount: Number(input.options?.count) || 1 });
            if (imagePolicy && (input.references?.length || 0) > imagePolicy.maxReferences) {
                const message = `当前模型最多支持 ${imagePolicy.maxReferences} 张参考图，请删除多余图片后再生成。`;
                throw withProviderErrorMessage(new Error(message), message, "rejected");
            }
            let references: string[];
            try {
                references = input.resumeTaskId ? [] : await Promise.all((input.references || []).map((reference) => prepareApimartImageReference(profile, reference, transport)));
            } catch (error) {
                throw withProviderErrorMessage(error, localizeApimartError(error instanceof Error ? error.message : String(error)), "rejected");
            }
            const options = {
                ...(input.options || {}),
                count: normalizeApimartImageCount(input.model, input.options?.count, references.length),
                resolution: normalizeApimartImageResolution(input.model, String(input.options?.resolution || "1k")),
                aspectRatio: normalizeApimartImageSize(input.model, String(input.options?.aspectRatio || "auto")),
            };
            const imageBody = {
                model: { $ref: "$model" },
                prompt: { $ref: "$prompt" },
                n: { $ref: "$options.count" },
                size: { $ref: "$options.aspectRatio" },
                resolution: { $ref: "$options.resolution" },
                ...(apimartModelFamily(input.model) === "gpt-image" && /official/i.test(input.model) ? { quality: { $ref: "$options.quality" } } : {}),
                ...(input.task === "image.edit" ? { image_urls: { $ref: "$referenceUrls" } } : {}),
            };
            const mapping: DeclarativeProviderMapping = {
                ...APIMART_GPT_IMAGE_MAPPING,
                endpoints: {
                    [input.task]: {
                        method: "POST",
                        path: "/images/generations",
                        body: imageBody,
                        response: { taskId: "$.data[0].task_id", status: "$.data[0].status" },
                    },
                },
            };
            try {
                return await declarative.submit({ ...profile, mapping }, { ...input, references: references.map((url) => ({ url })), options }, idempotencyKey);
            } catch (error) {
                if (error instanceof ProviderTaskPendingError) throw error;
                throw withProviderErrorMessage(error, localizeApimartError(error instanceof Error ? error.message : String(error)));
            }
        },
        async poll(profile, input, handle) {
            try {
                return await declarative.poll({ ...profile, mapping: APIMART_GPT_IMAGE_MAPPING }, input, handle);
            } catch (error) {
                throw withProviderErrorMessage(error, localizeApimartError(error instanceof Error ? error.message : String(error)));
            }
        },
        async execute(profile, input) {
            return executeAdapter(this, profile, input);
        },
    };

    adapters[openAi.id] = openAi;
    adapters[declarative.id] = declarative;
    adapters[apimart.id] = apimart;

    return {
        get(profile: ProviderProfile): ProviderAdapter {
            if (profile.presetId === GEMINI_PRESET) {
                throw new Error("Gemini 原生请求仍使用现有协议适配器；如需自定义字段，请切换到声明式接口。");
            }
            return adapters[profile.presetId] || declarative;
        },
        register(adapter: ProviderAdapter) {
            adapters[adapter.id] = adapter;
        },
        async execute(profile: ProviderProfile, input: Parameters<ProviderAdapter["execute"]>[1]) {
            return this.get(profile).execute(profile, input);
        },
        async submit(profile: ProviderProfile, input: ProviderInput, idempotencyKey = input.idempotencyKey || "") {
            return this.get(profile).submit(profile, input, idempotencyKey);
        },
        async poll(profile: ProviderProfile, input: ProviderInput, handle: ProviderRemoteHandle) {
            return this.get(profile).poll(profile, input, handle);
        },
        async cancel(profile: ProviderProfile, handle: ProviderRemoteHandle, signal?: AbortSignal) {
            return this.get(profile).cancel?.(profile, handle, signal) || "unknown" as const;
        },
    };
}

function providerContext(input: ProviderInput, refs: NonNullable<ProviderInput["references"]>) {
    return {
        ...input,
        references: refs,
        referenceDataUrls: refs.map((item) => item.dataUrl || item.url).filter((value): value is string => Boolean(value)),
        referenceUrls: refs.map((item) => item.url).filter((value): value is string => Boolean(value)),
        options: input.options || {},
        model: input.model,
        prompt: input.prompt || "",
    };
}

function readDeclarativeResult(task: ProviderTask, response: { images?: string; text?: string } | undefined, data: unknown): ProviderResult {
    const raw = response?.images ? readPath(data, response.images) : response?.text ? readPath(data, response.text) : data;
    if (response?.images) {
        const images = normalizeImages(raw);
        if (!images.length) throw new Error("声明式接口响应中没有可识别的图片，请检查 response.images 路径。");
        return images;
    }
    if (task === "image.generate" || task === "image.edit") {
        const images = normalizeImages(raw);
        if (images.length) return images;
    }
    return typeof raw === "string" ? raw : JSON.stringify(raw ?? "");
}

async function executeAdapter(adapter: ProviderAdapter, profile: ProviderProfile, input: ProviderInput): Promise<ProviderResult> {
    const handle = input.resumeTaskId ? { taskId: input.resumeTaskId } : null;
    const submission = handle ? { status: "accepted" as const, handle } : await adapter.submit(profile, input, input.idempotencyKey || "");
    if (submission.status === "completed") return submission.result;
    await input.onRemoteHandle?.(submission.handle);
    return pollProviderResult(adapter, profile, input, submission.handle);
}

async function pollProviderResult(adapter: ProviderAdapter, profile: ProviderProfile, input: ProviderInput, handle: ProviderRemoteHandle) {
    const polling = profile.mapping?.polling;
    const startedAt = Date.now();
    const timeoutMs = Math.max(1000, polling?.timeoutMs || 30 * 60 * 1000);
    const intervalMs = Math.max(250, polling?.intervalMs || 1500);
    while (Date.now() - startedAt < timeoutMs) {
        await waitFor(intervalMs, input.signal);
        const result = await adapter.poll(profile, input, handle);
        if (result.status === "completed") return result.result;
    }
    throw new ProviderTaskPendingError(handle.taskId);
}

async function prepareApimartImageReference(profile: ProviderProfile, reference: { dataUrl?: string; url?: string; mimeType?: string }, transport: ProviderTransport) {
    const source = reference.url || reference.dataUrl || "";
    if (/^https?:\/\//i.test(source)) return source;
    const dataUrl = reference.dataUrl || source;
    if (!dataUrl.startsWith("data:")) return dataUrl;
    const file = dataUrlToFile({ id: "apimart-reference", name: "reference.png", type: reference.mimeType || "image/png", dataUrl });
    const form = new FormData();
    form.append("file", file);
    const response = await transport.request({ method: "POST", url: joinUrl(profile.baseUrl, "/uploads/images"), headers: { Authorization: `Bearer ${profile.apiKey}` }, body: form });
    if (response.status >= 400) throwHttp(response.status, response.data);
    const url = (response.data as { url?: unknown })?.url;
    if (typeof url !== "string" || !url) throw new Error("APIMart 图片上传没有返回 URL");
    return url;
}

function normalizeApimartImageCount(model: string, value: unknown, referenceCount: number) {
    const requested = Math.max(1, Math.floor(Number(value) || 1));
    const normalized = model.toLowerCase();
    if (apimartModelFamily(model) === "gpt-image") return normalized.includes("official") ? Math.min(4, requested) : 1;
    if (apimartModelFamily(model) === "seedream") {
        if (/seedream[-.]?5(?:[-.]?0)?[-.]?pro/i.test(model)) return 1;
        if (/seedream[-.]?5(?:[-.]?0)?[-.]?lite/i.test(model)) return Math.min(15 - referenceCount, requested);
        return Math.min(Math.max(1, 15 - referenceCount), requested);
    }
    return requested;
}

async function pollDeclarativeOnce(
    profile: ProviderProfile,
    input: Parameters<ProviderAdapter["execute"]>[1],
    polling: NonNullable<DeclarativeProviderMapping["polling"]>,
    taskId: string,
    initialContext: Record<string, unknown>,
    transport: ProviderTransport,
): Promise<ProviderPollResult> {
    const context = { ...initialContext, taskId };
    const auth = profile.mapping?.auth;
    const requestHeaders: Record<string, string> = { "Content-Type": "application/json" };
    let requestUrl = joinUrl(profile.baseUrl, String(resolveRefs(polling.path, context)), profile.mapping?.appendDefaultVersion ?? false);
    if (!auth || auth.type === "bearer") requestHeaders.Authorization = `Bearer ${profile.apiKey}`;
    if (auth?.type === "header" && auth.name) requestHeaders[auth.name] = profile.apiKey;
    if (auth?.type === "query" && auth.name) requestUrl = `${requestUrl}${requestUrl.includes("?") ? "&" : "?"}${encodeURIComponent(auth.name)}=${encodeURIComponent(profile.apiKey)}`;
    let response;
    try {
        response = await transport.request({ method: polling.method || "GET", url: requestUrl, headers: requestHeaders, signal: input.signal });
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        return { status: "pending" };
    }
    if (response.status >= 400) {
        if ([408, 409, 425, 429, 500, 502, 503, 504].includes(response.status)) return { status: "pending" };
        throwHttp(response.status, response.data);
    }
    const status = readPath(response.data, polling.statusPath);
    if (typeof status === "string" && polling.failureValues?.includes(status)) {
        throw createProviderTaskTerminalError(readProviderError(response.data) || `任务失败（${status}）`);
    }
    if (!polling.successValues.includes(String(status))) return { status: "pending" };
    const raw = readPath(response.data, polling.resultPath);
    if (input.task === "image.generate" || input.task === "image.edit") {
        const images = normalizeImages(raw);
        if (!images.length) throw createProviderTaskTerminalError("异步任务已完成，但响应中没有可识别的图片。", "REMOTE_TASK_INVALID_RESULT");
        return { status: "completed", result: images };
    }
    return { status: "completed", result: typeof raw === "string" ? raw : JSON.stringify(raw ?? "") };
}
