import i18n from "@/i18n";

export function localizeApimartError(message: string, fallback = i18n.t("apiErrors.requestFailed")) {
    const raw = unwrapMessage(message).trim();
    if (!raw) return fallback;
    if (/[㐀-鿿]/.test(raw)) return raw;
    if (/first_frame|last_frame/i.test(raw) && /adaptive|ratio|aspect/i.test(raw)) return i18n.t("apiErrors.apimartFrameRatio");
    if (/TaskTypeConstraint/i.test(raw)) return i18n.t("apiErrors.apimartTaskTypeConstraint");
    if (/duration/i.test(raw) && /4\s*[-–~]\s*30|4-30|4 to 30/i.test(raw)) return i18n.t("apiErrors.apimartDurationRange", { range: "4–30", smart: true });
    if (/duration/i.test(raw) && /4\s*[-–~]\s*15|4-15|4 to 15/i.test(raw)) return i18n.t("apiErrors.apimartDurationRange", { range: "4–15", smart: false });
    if (/duration/i.test(raw) && /2\s*[-–~]\s*12|2-12|2 to 12/i.test(raw)) return i18n.t("apiErrors.apimartDurationRange", { range: "2–12", smart: false });
    if (/duration/i.test(raw) && /1080/i.test(raw)) return i18n.t("apiErrors.apimartResolutionDuration");
    if (/resolution/i.test(raw) && /not support|unsupported|invalid|only/i.test(raw)) return i18n.t("apiErrors.apimartResolutionUnsupported");
    if (/image_urls exceeds max|too many images|reference images?.*max/i.test(raw)) return i18n.t("apiErrors.apimartReferenceLimit");
    if (/input_video_probe_failed|probe.*video|video.*unreachable/i.test(raw)) return i18n.t("apiErrors.apimartVideoProbeFailed");
    if (/nsfw|SensitiveContentDetected|content moderation|flagged categories|safety/i.test(raw)) {
        if (/prompt|text|instruction/i.test(raw)) return i18n.t("apiErrors.apimartPromptRejected");
        if (/reference|input.?image|image.?url|upload/i.test(raw)) return i18n.t("apiErrors.apimartReferenceRejected");
        if (/output|result|generated/i.test(raw)) return i18n.t("apiErrors.apimartOutputRejected");
        return i18n.t("apiErrors.apimartContentRejected");
    }
    if (/insufficient|balance|payment_required|quota/i.test(raw)) return i18n.t("apiErrors.apimartBalanceInsufficient");
    if (/rate.?limit|too many requests|frequent/i.test(raw)) return i18n.t("apiErrors.rateLimited");
    if (/unauthorized|authentication|invalid.*(?:key|token)|forbidden/i.test(raw)) return i18n.t("apiErrors.authenticationFailed");
    if (/invalid url|failed to fetch|download.*failed/i.test(raw)) return i18n.t("apiErrors.apimartReferenceUnavailable");
    return i18n.t("apiErrors.apimartUnknown", { detail: raw });
}

function unwrapMessage(message: string): string {
    const value = message.trim();
    if (!value.startsWith("{") && !value.startsWith("[")) return value;
    try {
        const payload = JSON.parse(value) as { message?: unknown; msg?: unknown; detail?: unknown; error?: unknown };
        const error = payload?.error;
        const nested = typeof error === "string" ? error : error && typeof error === "object" ? (error as { message?: unknown }).message : undefined;
        return [payload?.message, payload?.msg, nested, payload?.detail].find((item): item is string => typeof item === "string" && Boolean(item.trim())) || value;
    } catch {
        return value;
    }
}
