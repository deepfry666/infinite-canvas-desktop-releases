import { saveAs } from "file-saver";

import { createZip, readZip } from "@/lib/zip";
import { readAssetPackageMediaManifest, type AssetPackageMedia } from "@/lib/asset-package-manifest";
import { prepareAssetLibraryExport, readAssetLibraryPackageData, type AssetLibrary } from "@/lib/asset-library";
import { deleteStoredMedia, getMediaBlob, uploadMediaFile } from "@/services/file-storage";
import { deleteStoredImages, getImageBlob, uploadImage } from "@/services/image-storage";
import type { Asset } from "@/stores/use-asset-store";

type AssetExportFile = {
    app: "infinite-canvas";
    version: 1 | 2;
    exportedAt?: string;
    assets: Asset[];
    folders?: AssetLibrary["folders"];
    files: AssetExportItem[];
};

type AssetExportItem = AssetPackageMedia;

type StoredAsset = Extract<Asset, { kind: "image" | "video" }>;

export async function exportAssets(input: Asset[] | Partial<AssetLibrary>, filename: string) {
    const library = prepareAssetLibraryExport(Array.isArray(input) ? { assets: input } : input);
    const storedAssets = collectStoredAssets(library.assets);
    const files: AssetExportItem[] = [];
    const zipFiles: { name: string; data: BlobPart }[] = [];

    for (const [index, [storageKey, asset]] of [...storedAssets.entries()].sort(([left], [right]) => left.localeCompare(right)).entries()) {
        const blob = asset.kind === "image" ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
        if (!blob) throw new Error(`missing media for ${storageKey}`);
        const mimeType = blob.type || asset.data.mimeType || "application/octet-stream";
        const path = `files/${String(index + 1).padStart(4, "0")}-${safeFileName(storageKey)}.${fileExtension(mimeType, asset.kind)}`;
        files.push({ storageKey, path, mimeType, bytes: blob.size });
        zipFiles.push({ name: path, data: blob });
    }

    assertUnique(files.map((item) => item.path), "asset package path");
    const data: AssetExportFile = {
        app: "infinite-canvas",
        version: 2,
        exportedAt: new Date().toISOString(),
        assets: library.assets,
        folders: library.folders,
        files,
    };
    const zip = await createZip([{ name: "assets.json", data: JSON.stringify(data, null, 2) }, ...zipFiles]);
    saveAs(zip, filename);
}

export async function readAssetPackage(file: File) {
    const zip = await readZip(file);
    const assetFile = zip.get("assets.json");
    if (!assetFile) throw new Error("missing assets.json");
    const raw = JSON.parse(await assetFile.text()) as unknown;
    const library = readAssetLibraryPackageData(raw);
    if (!isRecord(raw) || !Array.isArray(raw.files)) throw new Error("invalid asset media manifest");

    const packageFiles = readAssetPackageMediaManifest(raw.files, raw.version === 1 ? 1 : 2);
    const storedAssets = collectStoredAssets(library.assets);
    const manifestByStorageKey = new Map(packageFiles.map((item) => [item.storageKey, item]));
    const validatedBlobs = new Map<string, Blob>();

    storedAssets.forEach((asset, storageKey) => {
        const item = manifestByStorageKey.get(storageKey);
        if (!item) throw new Error("asset package is missing a media manifest entry");
        if (asset.kind === "image" && !item.mimeType.startsWith("image/")) throw new Error("asset package contains an invalid image type");
        if (asset.kind === "video" && !item.mimeType.startsWith("video/")) throw new Error("asset package contains an invalid video type");
    });
    packageFiles.forEach((item) => {
        if (!storedAssets.has(item.storageKey)) throw new Error("asset package contains an unreferenced media entry");
        const blob = zip.get(item.path);
        if (!blob || blob.size !== item.bytes) throw new Error("asset package contains a missing or damaged media file");
        validatedBlobs.set(item.storageKey, blob.slice(0, blob.size, item.mimeType));
    });

    const uploadedImages = new Set<string>();
    const uploadedMedia = new Set<string>();
    let rolledBack = false;
    const rollback = async () => {
        if (rolledBack) return;
        rolledBack = true;
        await Promise.all([deleteStoredImages(uploadedImages), deleteStoredMedia(uploadedMedia)]);
    };

    try {
        const replacements = new Map<string, Awaited<ReturnType<typeof uploadImage>> | Awaited<ReturnType<typeof uploadMediaFile>>>();
        for (const [storageKey, asset] of storedAssets) {
            const blob = validatedBlobs.get(storageKey);
            if (!blob) throw new Error("asset package is missing a validated media file");
            if (asset.kind === "image") {
                const stored = await uploadImage(blob);
                if (stored.created) uploadedImages.add(stored.storageKey);
                replacements.set(storageKey, stored);
            } else {
                const stored = await uploadMediaFile(blob, "video");
                if (stored.created) uploadedMedia.add(stored.storageKey);
                replacements.set(storageKey, stored);
            }
        }

        const assets = library.assets.map((asset): Asset => {
            if (asset.kind !== "image" && asset.kind !== "video") return asset;
            const oldStorageKey = asset.data.storageKey;
            if (!oldStorageKey) return asset;
            const stored = replacements.get(oldStorageKey);
            if (!stored) throw new Error("asset package media was not imported");
            if (asset.kind === "image") {
                const image = stored as Awaited<ReturnType<typeof uploadImage>>;
                return {
                    ...asset,
                    coverUrl: replaceImportedUrl(asset.coverUrl, asset.data.dataUrl, image.url),
                    data: { ...asset.data, dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType },
                };
            }
            const media = stored as Awaited<ReturnType<typeof uploadMediaFile>>;
            return {
                ...asset,
                coverUrl: replaceImportedUrl(asset.coverUrl, asset.data.url, media.url),
                data: { ...asset.data, url: media.url, storageKey: media.storageKey, width: media.width || asset.data.width, height: media.height || asset.data.height, bytes: media.bytes, mimeType: media.mimeType },
            };
        });
        return { library: { ...library, assets }, rollback };
    } catch (error) {
        await rollback().catch(() => undefined);
        throw error;
    }
}

function collectStoredAssets(assets: Asset[]) {
    const storedAssets = new Map<string, StoredAsset>();
    assets.forEach((asset) => {
        if (asset.kind !== "image" && asset.kind !== "video") return;
        const storageKey = asset.data.storageKey;
        if (!storageKey) return;
        const current = storedAssets.get(storageKey);
        if (current && current.kind !== asset.kind) throw new Error("asset storageKey is used by incompatible media types");
        if (!current) storedAssets.set(storageKey, asset);
    });
    return storedAssets;
}

function assertUnique(values: string[], label: string) {
    if (new Set(values).size !== values.length) throw new Error(`duplicate ${label}`);
}

function replaceImportedUrl(coverUrl: string, contentUrl: string, storedUrl: string) {
    return !coverUrl || coverUrl === contentUrl || /^(blob:|data:|workspace:|workspace:\/\/)/i.test(coverUrl) ? storedUrl : coverUrl;
}

function safeFileName(value: string) {
    return value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 100) || "asset";
}

function fileExtension(mimeType: string, kind: Asset["kind"]) {
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("webm")) return "webm";
    return kind === "image" ? "png" : "bin";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
