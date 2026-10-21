import { thumbnailCacheStore } from "@/services/cache-storage";

const objectUrls = new Map<string, string>();

export async function resolveThumbnail(cacheKey: string, sourceUrl: string, maxSize = 480) {
    if (!cacheKey || !sourceUrl) return sourceUrl;
    const key = `${cacheKey}:${maxSize}`;
    const existing = await thumbnailCacheStore.getItem<Blob>(key);
    if (existing) return objectUrl(key, existing);
    try {
        const response = await fetch(sourceUrl);
        if (!response.ok) return sourceUrl;
        const source = await response.blob();
        const bitmap = await createImageBitmap(source);
        const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
        bitmap.close();
        const thumbnail = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
        if (!thumbnail) return sourceUrl;
        await thumbnailCacheStore.setItem(key, thumbnail);
        return objectUrl(key, thumbnail);
    } catch {
        return sourceUrl;
    }
}

export function clearThumbnailRuntimeCache() {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.clear();
}

function objectUrl(key: string, blob: Blob) {
    const existing = objectUrls.get(key);
    if (existing) return existing;
    const url = URL.createObjectURL(blob);
    objectUrls.set(key, url);
    return url;
}
