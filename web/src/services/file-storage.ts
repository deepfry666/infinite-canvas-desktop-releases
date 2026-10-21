import localforage from "localforage";
import { nanoid } from "nanoid";
import { createGenerationLogStore, hasVolatileGenerationLogs, runGenerationLogOperation } from "@/services/generation-log-store";

export type UploadedFile = { url: string; storageKey: string; bytes: number; mimeType: string; width?: number; height?: number; durationMs?: number; created: boolean };

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "media_files" });
const imageLogStore = createGenerationLogStore<Record<string, unknown>>("image_generation_logs");
const videoLogStore = createGenerationLogStore<Record<string, unknown>>("video_generation_logs");
const objectUrls = new Map<string, string>();

export async function uploadMediaFile(input: string | Blob, prefix = "file"): Promise<UploadedFile> {
    const desktop = window.infiniteCanvasDesktop;
    if (desktop) {
        const kind = prefix.startsWith("video") ? "video" : prefix.startsWith("audio") ? "audio" : "file";
        const stored = /^https?:\/\//i.test(typeof input === "string" ? input : "") ? await desktop.storeAsset({ remoteUrl: input as string, kind }) : await storeDesktopBlob(desktop, typeof input === "string" ? await fetchBlob(input) : input, kind);
        const meta = stored.mimeType.startsWith("video/") ? await readVideoMeta(stored.url) : stored.mimeType.startsWith("audio/") ? await readAudioMeta(stored.url) : {};
        return { url: stored.url, storageKey: stored.storageKey, bytes: stored.bytes, mimeType: stored.mimeType, ...meta, created: stored.created };
    }
    const blob = typeof input === "string" ? await fetchBlob(input) : input;
    const storageKey = `${prefix}:${nanoid()}`;
    await store.setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    const meta = blob.type.startsWith("video/") ? await readVideoMeta(url) : blob.type.startsWith("audio/") ? await readAudioMeta(url) : {};
    return { url, storageKey, bytes: blob.size, mimeType: blob.type || "application/octet-stream", ...meta, created: true };
}

export async function resolveMediaUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    if (storageKey.startsWith("workspace:")) return workspaceUrl(storageKey);
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const blob = await store.getItem<Blob>(storageKey);
    if (!blob) return fallback;
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function getMediaBlob(storageKey: string) {
    if (storageKey.startsWith("workspace:")) return fetchBlob(workspaceUrl(storageKey));
    return store.getItem<Blob>(storageKey);
}

export async function setMediaBlob(storageKey: string, blob: Blob) {
    if (storageKey.startsWith("workspace:") && window.infiniteCanvasDesktop) {
        await window.infiniteCanvasDesktop.writeAsset(storageKey, await blob.arrayBuffer());
        return workspaceUrl(storageKey);
    }
    await store.setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function deleteStoredMedia(keys: Iterable<string>) {
    await Promise.all(
        Array.from(new Set(keys)).map(async (key) => {
            if (key.startsWith("workspace:")) {
                await window.infiniteCanvasDesktop?.deleteAsset(key);
                return;
            }
            const url = objectUrls.get(key);
            if (url) URL.revokeObjectURL(url);
            objectUrls.delete(key);
            await store.removeItem(key);
        }),
    );
}

export async function cleanupUnusedMedia(usedData: unknown, candidateStorageKeys: Iterable<string> = []) {
    await runGenerationLogOperation(async () => {
        const usedKeys = collectMediaStorageKeys(usedData);
        await Promise.all([
            imageLogStore.iterate((value) => {
                collectMediaStorageKeys(value, usedKeys);
            }),
            videoLogStore.iterate((value) => {
                collectMediaStorageKeys(value, usedKeys);
            }),
        ]);
        imageLogStore.volatileEntries().forEach(([, value]) => collectMediaStorageKeys(value, usedKeys));
        videoLogStore.volatileEntries().forEach(([, value]) => collectMediaStorageKeys(value, usedKeys));
        const unused: string[] = [];
        await store.iterate((_value, key) => {
            if (!usedKeys.has(key)) unused.push(key);
        });
        await Promise.all(unused.map((key) => store.removeItem(key)));
        await deleteUnusedWorkspaceMedia(candidateStorageKeys, usedKeys);
    });
}

export function unusedWorkspaceMediaCandidates(candidates: Iterable<string>, referencedKeys: ReadonlySet<string>) {
    return [...new Set(candidates)].filter((storageKey) => /^workspace:assets\/(?:videos|audio)\//.test(storageKey) && !referencedKeys.has(storageKey));
}

export function collectMediaStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.includes(":")) keys.add(value.storageKey);
    Object.entries(value).forEach(([key, item]) => {
        if (key === "formerOutputStorageKeys" && "purgedAt" in value && value.purgedAt) return;
        if (Array.isArray(item)) item.forEach((child) => collectMediaStorageKeys(child, keys));
        else collectMediaStorageKeys(item, keys);
    });
    return keys;
}

async function fetchBlob(url: string) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`媒体文件读取失败（HTTP ${response.status}）`);
    return response.blob();
}

async function storeDesktopBlob(desktop: NonNullable<Window["infiniteCanvasDesktop"]>, blob: Blob, kind: "video" | "audio" | "file") {
    return desktop.storeAsset({ bytes: await blob.arrayBuffer(), mimeType: blob.type, kind });
}

async function deleteUnusedWorkspaceMedia(candidates: Iterable<string>, referencedKeys: ReadonlySet<string>) {
    const desktop = window.infiniteCanvasDesktop;
    if (!desktop || hasVolatileGenerationLogs()) return;
    await Promise.all(unusedWorkspaceMediaCandidates(candidates, referencedKeys).map(async (storageKey) => {
        try {
            await desktop.deleteUnusedAsset(storageKey);
        } catch {
            // The desktop process rejects active generations and damaged references; retain the file.
        }
    }));
}

function workspaceUrl(storageKey: string) {
    return `workspace://local/${storageKey.slice("workspace:".length).split("/").map(encodeURIComponent).join("/")}`;
}

function readVideoMeta(url: string) {
    return new Promise<{ width: number; height: number; durationMs?: number }>((resolve) => {
        const video = document.createElement("video");
        const done = () => resolve({ width: video.videoWidth || 1280, height: video.videoHeight || 720, durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined });
        video.onloadedmetadata = done;
        video.onerror = done;
        video.src = url;
    });
}

function readAudioMeta(url: string) {
    return new Promise<{ durationMs?: number }>((resolve) => {
        const audio = document.createElement("audio");
        const done = () => resolve({ durationMs: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined });
        audio.onloadedmetadata = done;
        audio.onerror = done;
        audio.src = url;
    });
}
