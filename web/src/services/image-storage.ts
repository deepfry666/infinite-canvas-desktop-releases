import localforage from "localforage";

import { nanoid } from "nanoid";
import i18n from "@/i18n";
import { readImageMeta } from "@/lib/image-utils";
import { createGenerationLogStore, hasVolatileGenerationLogs, runGenerationLogOperation } from "@/services/generation-log-store";

export type UploadedImage = {
    url: string;
    storageKey: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
    created: boolean;
};

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "image_files" });
const imageLogStore = createGenerationLogStore<Record<string, unknown>>("image_generation_logs");
const videoLogStore = createGenerationLogStore<Record<string, unknown>>("video_generation_logs");
const objectUrls = new Map<string, string>();

export async function uploadImage(input: string | Blob, options: { idempotencyKey?: string } = {}): Promise<UploadedImage> {
    const desktop = window.infiniteCanvasDesktop;
    if (desktop) {
        const remoteUrl = typeof input === "string" && /^https?:\/\//i.test(input) ? input : "";
        if (remoteUrl) {
            try {
                const stored = await desktop.storeAsset({ remoteUrl, kind: "image", idempotencyKey: options.idempotencyKey });
                const meta = await readImageMeta(stored.url);
                return { url: stored.url, storageKey: stored.storageKey, width: meta.width, height: meta.height, bytes: stored.bytes, mimeType: stored.mimeType || meta.mimeType, created: stored.created };
            } catch {
                return remoteImageFallback(remoteUrl);
            }
        }
        const stored = await storeDesktopBlob(desktop, typeof input === "string" ? await fetchBlob(input) : input, "image", options.idempotencyKey);
        const meta = await readImageMeta(stored.url);
        return { url: stored.url, storageKey: stored.storageKey, width: meta.width, height: meta.height, bytes: stored.bytes, mimeType: stored.mimeType || meta.mimeType, created: stored.created };
    }
    if (typeof input === "string" && /^https?:\/\//i.test(input)) {
        try {
            const blob = await fetchBlob(input);
            return await storeImageBlob(blob, options.idempotencyKey);
        } catch {
            return remoteImageFallback(input);
        }
    }
    const blob = typeof input === "string" ? await fetchBlob(input) : input;
    return storeImageBlob(blob, options.idempotencyKey);
}

async function storeImageBlob(blob: Blob, idempotencyKey?: string): Promise<UploadedImage> {
    const storageKey = idempotencyKey ? await idempotentImageStorageKey(idempotencyKey) : `image:${nanoid()}`;
    const existing = idempotencyKey ? await store.getItem<Blob>(storageKey) : null;
    if (existing && await blobFingerprint(existing) !== await blobFingerprint(blob)) throw new Error("相同创作输出键的内容不一致，已拒绝覆盖");
    if (!existing) await store.setItem(storageKey, blob);
    const storedBlob = existing || blob;
    const url = URL.createObjectURL(storedBlob);
    objectUrls.set(storageKey, url);
    const meta = await readImageMeta(url);
    return { url, storageKey, width: meta.width, height: meta.height, bytes: storedBlob.size, mimeType: storedBlob.type || meta.mimeType, created: !existing };
}

function remoteImageFallback(url: string): UploadedImage {
    return { url, storageKey: `remote-image:${nanoid()}`, width: 1024, height: 1024, bytes: 0, mimeType: "image/png", created: false };
}

export async function findUploadedImageByIdempotencyKey(idempotencyKey: string): Promise<UploadedImage | undefined> {
    const desktop = window.infiniteCanvasDesktop;
    if (desktop) {
        const stored = await desktop.findAssetByIdempotencyKey({ kind: "image", idempotencyKey });
        if (!stored) return undefined;
        const url = await resolveImageUrl(stored.storageKey);
        const meta = await readImageMeta(url);
        return { ...stored, url, width: meta.width, height: meta.height };
    }
    const storageKey = await idempotentImageStorageKey(idempotencyKey);
    const blob = await store.getItem<Blob>(storageKey);
    if (!blob) return undefined;
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    const meta = await readImageMeta(url);
    return { url, storageKey, width: meta.width, height: meta.height, bytes: blob.size, mimeType: blob.type || meta.mimeType, created: false };
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
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

export async function getImageBlob(storageKey: string) {
    if (storageKey.startsWith("workspace:")) return fetchBlob(workspaceUrl(storageKey));
    return store.getItem<Blob>(storageKey);
}

export async function setImageBlob(storageKey: string, blob: Blob) {
    if (storageKey.startsWith("workspace:") && window.infiniteCanvasDesktop) {
        await window.infiniteCanvasDesktop.writeAsset(storageKey, await blob.arrayBuffer());
        return workspaceUrl(storageKey);
    }
    await store.setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }) {
    const url = image.dataUrl || (await resolveImageUrl(image.storageKey, image.url || ""));
    if (!url || url.startsWith("data:")) return url;
    return blobToDataUrl(await (await fetch(url)).blob());
}

export async function deleteStoredImages(keys: Iterable<string>) {
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

export async function cleanupUnusedImages(usedData: unknown, candidateStorageKeys: Iterable<string> = []) {
    await runGenerationLogOperation(async () => {
        const usedKeys = collectImageStorageKeys(usedData);
        await Promise.all([
            imageLogStore.iterate((value) => {
                collectImageStorageKeys(value, usedKeys);
            }),
            videoLogStore.iterate((value) => {
                collectImageStorageKeys(value, usedKeys);
            }),
        ]);
        imageLogStore.volatileEntries().forEach(([, value]) => collectImageStorageKeys(value, usedKeys));
        videoLogStore.volatileEntries().forEach(([, value]) => collectImageStorageKeys(value, usedKeys));
        const unused: string[] = [];
        await store.iterate((_value, key) => {
            if (!usedKeys.has(key)) unused.push(key);
        });
        await deleteStoredImages(unused);
        await deleteUnusedWorkspaceImages(candidateStorageKeys, usedKeys);
    });
}

export function unusedWorkspaceImageCandidates(candidates: Iterable<string>, referencedKeys: ReadonlySet<string>) {
    return [...new Set(candidates)].filter((storageKey) => storageKey.startsWith("workspace:assets/images/") && !referencedKeys.has(storageKey));
}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && (value.storageKey.startsWith("image:") || value.storageKey.startsWith("workspace:assets/images/"))) keys.add(value.storageKey);
    Object.entries(value).forEach(([key, item]) => {
        if (key === "formerOutputStorageKeys" && "purgedAt" in value && value.purgedAt) return;
        if (Array.isArray(item)) item.forEach((child) => collectImageStorageKeys(child, keys));
        else collectImageStorageKeys(item, keys);
    });
    return keys;
}

async function fetchBlob(url: string) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(i18n.t("common.imageDownloadFailed", { status: response.status }));
    return response.blob();
}

async function storeDesktopBlob(desktop: NonNullable<Window["infiniteCanvasDesktop"]>, blob: Blob, kind: "image", idempotencyKey?: string) {
    return desktop.storeAsset({ bytes: await blob.arrayBuffer(), mimeType: blob.type, kind, idempotencyKey });
}

async function idempotentImageStorageKey(idempotencyKey: string) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(idempotencyKey));
    return `image:creative-skill:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function blobFingerprint(blob: Blob) {
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function deleteUnusedWorkspaceImages(candidates: Iterable<string>, referencedKeys: ReadonlySet<string>) {
    const desktop = window.infiniteCanvasDesktop;
    if (!desktop || hasVolatileGenerationLogs()) return;
    await Promise.all(unusedWorkspaceImageCandidates(candidates, referencedKeys).map(async (storageKey) => {
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

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error(i18n.t("common.imageReadFailed")));
        reader.readAsDataURL(blob);
    });
}
