import localforage from "localforage";

export const thumbnailCacheStore = localforage.createInstance({ name: "infinite-canvas", storeName: "thumbnail_cache" });

const cacheStores = [localforage.createInstance({ name: "infinite-canvas", storeName: "prompt_cache" }), thumbnailCacheStore];

export async function clearCompatibilityCaches() {
    await Promise.all(cacheStores.map((store) => store.clear()));
}
