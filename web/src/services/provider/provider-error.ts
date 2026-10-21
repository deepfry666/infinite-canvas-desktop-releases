export type ProviderSubmissionState = "rejected" | "unknown";
export type ProviderRemoteTaskState = "terminal-failure";

export class ProviderHttpError extends Error {
    readonly status: number;
    readonly code: string;
    readonly submissionState: ProviderSubmissionState;

    constructor(status: number, message: string) {
        super(message);
        this.name = "ProviderHttpError";
        this.status = status;
        this.code = `HTTP_${status}`;
        this.submissionState = status >= 400 && status < 500 ? "rejected" : "unknown";
    }
}

export function createProviderHttpError(status: number, message: string) {
    return new ProviderHttpError(status, message);
}

export class ProviderTaskTerminalError extends Error {
    readonly code: string;
    readonly remoteTaskState = "terminal-failure" as const;

    constructor(message: string, code = "REMOTE_TASK_FAILED") {
        super(message);
        this.name = "ProviderTaskTerminalError";
        this.code = code;
    }
}

export function createProviderTaskTerminalError(message: string, code?: string) {
    return new ProviderTaskTerminalError(message, code);
}

type ProviderError = Error & { status?: number; code?: string; submissionState?: ProviderSubmissionState; remoteTaskState?: ProviderRemoteTaskState };

export function withProviderErrorMessage(error: unknown, message: string, submissionState: ProviderSubmissionState): ProviderError & { submissionState: ProviderSubmissionState };
export function withProviderErrorMessage(error: unknown, message: string): ProviderError;
export function withProviderErrorMessage(error: unknown, message: string, submissionState?: ProviderSubmissionState): ProviderError {
    const target = error instanceof Error ? error : new Error(String(error));
    try {
        target.message = message;
        if (submissionState) Object.assign(target, { submissionState });
        return target as ProviderError;
    } catch {
        const source = target as ProviderError;
        return Object.assign(new Error(message, { cause: target }), {
            name: target.name,
            ...(typeof source.status === "number" ? { status: source.status } : {}),
            ...(typeof source.code === "string" ? { code: source.code } : {}),
            ...(submissionState || source.submissionState ? { submissionState: submissionState || source.submissionState } : {}),
            ...(source.remoteTaskState ? { remoteTaskState: source.remoteTaskState } : {}),
        });
    }
}
