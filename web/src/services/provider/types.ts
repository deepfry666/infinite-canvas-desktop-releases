import type { ApiCallFormat, ModelCapability } from "@/stores/use-config-store";

/** A stable request understood by the canvas. Provider-specific fields stay behind the adapter seam. */
export type ProviderTask = "text.generate" | "image.generate" | "image.edit" | "video.generate" | "audio.generate";

export type ProviderInput = {
    task: ProviderTask;
    model: string;
    prompt?: string;
    messages?: unknown[];
    references?: Array<{ dataUrl?: string; url?: string; mimeType?: string }>;
    options?: Record<string, unknown>;
    resumeTaskId?: string;
    idempotencyKey?: string;
    onRemoteHandle?: (handle: ProviderRemoteHandle) => void | Promise<void>;
    signal?: AbortSignal;
    onDelta?: (text: string) => void;
};

export type ProviderImage = { dataUrl?: string; url?: string; mimeType?: string };
export type ProviderResult = string | ProviderImage | ProviderImage[] | Blob | { taskId: string; status?: string };
export type ProviderRemoteHandle = { taskId: string };
export type ProviderSubmission =
    | { status: "completed"; result: ProviderResult }
    | { status: "accepted"; handle: ProviderRemoteHandle };
export type ProviderPollResult =
    | { status: "pending" }
    | { status: "completed"; result: ProviderResult };

export type ProviderCapabilities = Partial<Record<ModelCapability | "vision" | "toolCalling" | "json" | "streaming" | "async", boolean>> & {
    checkedAt?: string;
    source: "preset" | "probe" | "manual";
    maxReferences?: number;
    maxOutputsPerRequest?: number;
    aspectRatios?: string[];
    remoteResume?: boolean;
    idempotency?: boolean;
    remoteCancel?: boolean;
};

export type ProviderProfile = {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    protocol: ApiCallFormat | "openai-compatible" | "declarative";
    presetId: string;
    models: Array<{ name: string; capabilities: ProviderCapabilities }>;
    mapping?: DeclarativeProviderMapping;
};

export type DeclarativeField = string | number | boolean | null | { $ref: string } | DeclarativeField[] | { [key: string]: DeclarativeField };

export type DeclarativeProviderMapping = {
    endpoints: Partial<Record<ProviderTask, { method?: "POST" | "GET"; path: string; body?: Record<string, DeclarativeField>; headers?: Record<string, DeclarativeField>; response?: { images?: string; text?: string; taskId?: string; status?: string; result?: string } }>>;
    auth?: { type: "bearer" | "header" | "query"; name?: string };
    /** Whether relative endpoint paths should receive the conventional /v1 suffix. */
    appendDefaultVersion?: boolean;
    polling?: {
        method?: "GET" | "POST";
        path: string;
        statusPath: string;
        successValues: string[];
        failureValues?: string[];
        resultPath: string;
        intervalMs?: number;
        timeoutMs?: number;
    };
};

export type ProviderAdapter = {
    readonly id: string;
    readonly label: string;
    supports(profile: ProviderProfile, task: ProviderTask): boolean;
    probe(profile: ProviderProfile, signal?: AbortSignal): Promise<ProviderCapabilities>;
    submit(profile: ProviderProfile, input: ProviderInput, idempotencyKey: string): Promise<ProviderSubmission>;
    poll(profile: ProviderProfile, input: ProviderInput, handle: ProviderRemoteHandle): Promise<ProviderPollResult>;
    cancel?(profile: ProviderProfile, handle: ProviderRemoteHandle, signal?: AbortSignal): Promise<"canceled" | "unknown">;
    execute(profile: ProviderProfile, input: ProviderInput): Promise<ProviderResult>;
};

export type ProviderTransport = {
    request: (input: { method: "GET" | "POST"; url: string; headers?: Record<string, string>; body?: unknown; signal?: AbortSignal }) => Promise<{ status: number; data: unknown; headers: Headers }>;
};
