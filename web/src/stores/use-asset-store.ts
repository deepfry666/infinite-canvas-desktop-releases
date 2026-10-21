import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage } from "@/lib/localforage-storage";
import { deleteAssetInLibrary, deleteFolderInLibrary, hasActiveAssetFolderName, moveAssetsInLibrary, normalizeAssetFolderName, normalizeAssetLibrary, type AssetFolder, type AssetLibrary, type Asset as LibraryAsset } from "@/lib/asset-library";
import { cleanupUnusedImages, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { cleanupUnusedMedia, resolveMediaUrl } from "@/services/file-storage";

export type { AssetFolder, AssetLibrary } from "@/lib/asset-library";
export type AssetKind = "text" | "image" | "video";
export type TextAsset = Extract<LibraryAsset, { kind: "text" }>;
export type ImageAsset = Extract<LibraryAsset, { kind: "image" }>;
export type VideoAsset = Extract<LibraryAsset, { kind: "video" }>;
export type Asset = LibraryAsset;

type AssetStore = {
    hydrated: boolean;
    hydrationError: boolean;
    assets: Asset[];
    folders: AssetFolder[];
    assetTombstones: AssetLibrary["assetTombstones"];
    addAsset: (asset: Omit<Asset, "id" | "createdAt" | "updatedAt">) => string;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => void;
    removeAsset: (id: string) => void;
    replaceAssets: (assets: Asset[] | AssetLibrary) => void;
    createFolder: (name: string) => string;
    renameFolder: (id: string, name: string) => void;
    deleteFolder: (id: string) => void;
    moveAssets: (assetIds: string[], folderId?: string) => void;
    replaceLibrary: (library: AssetLibrary) => Promise<void>;
    cleanupImages: (extra?: unknown, candidateStorageKeys?: Iterable<string>) => void;
};

const ASSET_STORE_KEY = "infinite-canvas:asset_store";
let assetStorageWrite = Promise.resolve();

export function detachedAssetStorageKeys(before: readonly Asset[], after: readonly Asset[]) {
    const remaining = collectAssetStorageKeys(after);
    return [...collectAssetStorageKeys(before)].filter((storageKey) => !remaining.has(storageKey));
}

function collectAssetStorageKeys(assets: readonly Asset[]) {
    const keys = new Set<string>();
    assets.forEach((asset) => collectStorageKeys(asset, keys));
    return keys;
}

function collectStorageKeys(value: unknown, keys: Set<string>) {
    if (!value || typeof value !== "object") return;
    if ("storageKey" in value && typeof value.storageKey === "string") keys.add(value.storageKey);
    Object.values(value).forEach((item) => {
        if (Array.isArray(item)) item.forEach((child) => collectStorageKeys(child, keys));
        else collectStorageKeys(item, keys);
    });
}

const assetStorage: PersistStorage<AssetStore, Promise<void>> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<AssetStore>;
        const normalized = normalizeAssetLibrary(parsed.state);
        parsed.state.assets = await Promise.all(
            normalized.assets.map(async (asset) => {
                if (asset.kind === "video" && asset.data.storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } };
                if (asset.kind !== "image") return asset;
                if (asset.data.storageKey)
                    return {
                        ...asset,
                        coverUrl: asset.coverUrl.startsWith("blob:") ? await resolveImageUrl(asset.data.storageKey, asset.coverUrl) : asset.coverUrl,
                        data: { ...asset.data, dataUrl: await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl) },
                    };
                if (!asset.data.dataUrl.startsWith("data:image/")) return asset;
                const image = await uploadImage(asset.data.dataUrl);
                return { ...asset, coverUrl: asset.coverUrl.startsWith("data:image/") ? image.url : asset.coverUrl, data: { ...asset.data, dataUrl: image.url, storageKey: image.storageKey, bytes: image.bytes, mimeType: image.mimeType } };
            }),
        );
        parsed.state.folders = normalized.folders;
        parsed.state.assetTombstones = normalized.assetTombstones;
        return parsed;
    },
    setItem: (name, value) => queueAssetStorageWrite(async () => { await localForageStorage.setItem(name, JSON.stringify(value)); }),
    removeItem: (name) => queueAssetStorageWrite(async () => { await localForageStorage.removeItem(name); }),
};

export const useAssetStore = create<AssetStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            hydrationError: false,
            assets: [],
            folders: [],
            assetTombstones: [],
            addAsset: (asset) => {
                const now = new Date().toISOString();
                const id = nanoid();
                set((state) => {
                    const folderId = asset.folderId && state.folders.some((folder) => folder.id === asset.folderId && !folder.deletedAt) ? asset.folderId : undefined;
                    return { assets: [{ ...asset, folderId, id, createdAt: now, updatedAt: now } as Asset, ...state.assets] };
                });
                return id;
            },
            updateAsset: (id, patch) => {
                const current = get().assets;
                const assets = current.map((asset) => (asset.id === id ? ({ ...asset, ...patch, updatedAt: new Date().toISOString() } as Asset) : asset));
                const candidates = detachedAssetStorageKeys(current, assets);
                set({ assets });
                if (candidates.length) afterAssetPersist(() => get().cleanupImages(undefined, candidates));
            },
            removeAsset: (id) => {
                const current = get();
                const library = deleteAssetInLibrary(current, id, new Date().toISOString());
                const candidates = detachedAssetStorageKeys(current.assets, library.assets);
                set(library);
                if (candidates.length) afterAssetPersist(() => get().cleanupImages(undefined, candidates));
            },
            replaceAssets: (assets) => {
                const current = get();
                const library = normalizeAssetLibrary(Array.isArray(assets) ? { assets, folders: current.folders, assetTombstones: current.assetTombstones } : assets);
                const candidates = detachedAssetStorageKeys(current.assets, library.assets);
                set(library);
                if (candidates.length) afterAssetPersist(() => get().cleanupImages(undefined, candidates));
            },
            createFolder: (name) => {
                const normalizedName = normalizeAssetFolderName(name);
                const now = new Date().toISOString();
                const id = nanoid();
                set((state) => {
                    if (hasActiveAssetFolderName(state.folders, normalizedName)) throw new Error("folder name already exists");
                    return { folders: [...state.folders, { id, name: normalizedName, createdAt: now, updatedAt: now }] };
                });
                return id;
            },
            renameFolder: (id, name) => {
                const normalizedName = normalizeAssetFolderName(name);
                set((state) => {
                    const folder = state.folders.find((item) => item.id === id);
                    if (!folder || folder.deletedAt) throw new Error("folder not found");
                    if (hasActiveAssetFolderName(state.folders, normalizedName, id)) throw new Error("folder name already exists");
                    const updatedAt = new Date().toISOString();
                    return { folders: state.folders.map((item) => (item.id === id ? { ...item, name: normalizedName, updatedAt } : item)) };
                });
            },
            deleteFolder: (id) =>
                set((state) => deleteFolderInLibrary(state, id, new Date().toISOString())),
            moveAssets: (assetIds, folderId) =>
                set((state) => moveAssetsInLibrary(state, assetIds, folderId, new Date().toISOString())),
            replaceLibrary: async (library) => {
                const current = get();
                const normalized = normalizeAssetLibrary(library);
                const candidates = detachedAssetStorageKeys(current.assets, normalized.assets);
                try {
                    set(normalized);
                    await assetStorageWrite;
                } catch (error) {
                    set({ assets: current.assets, folders: current.folders, assetTombstones: current.assetTombstones });
                    await assetStorageWrite.catch(() => undefined);
                    throw error;
                }
                if (candidates.length) get().cleanupImages(undefined, candidates);
            },
            cleanupImages: (extra, candidateStorageKeys) => {
                window.setTimeout(async () => {
                    const { useCanvasStore } = await import("@/stores/canvas/use-canvas-store");
                    const [{ useImageWorkbenchStore }, { useVideoWorkbenchStore }] = await Promise.all([
                        import("@/stores/use-image-workbench-store"),
                        import("@/stores/use-video-workbench-store"),
                    ]);
                    const usedData = {
                        assets: get().assets,
                        projects: useCanvasStore.getState().projects,
                        imageWorkbench: useImageWorkbenchStore.getState(),
                        videoWorkbench: useVideoWorkbenchStore.getState(),
                        extra,
                    };
                    await cleanupUnusedImages(usedData, candidateStorageKeys);
                    await cleanupUnusedMedia(usedData, candidateStorageKeys);
                }, 0);
            },
        }),
        {
            name: ASSET_STORE_KEY,
            storage: assetStorage,
            partialize: (state) => ({ assets: state.assets, folders: state.folders, assetTombstones: state.assetTombstones }) as StorageValue<AssetStore>["state"],
            onRehydrateStorage: () => (_state, error) => {
                useAssetStore.setState({ hydrated: true, hydrationError: Boolean(error) });
            },
        },
    ),
);

function afterAssetPersist(action: () => void) {
    void assetStorageWrite.then(action).catch(() => undefined);
}

function queueAssetStorageWrite(operation: () => Promise<void>) {
    const next = assetStorageWrite.catch(() => undefined).then(operation);
    assetStorageWrite = next;
    return next;
}
