import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
    value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, String(value)),
    },
});
Object.defineProperty(globalThis, "document", { value: { documentElement: { lang: "" } } });

const sourceRoot = new URL("../", import.meta.url).href;
const aliasLoader = `
const sourceRoot = ${JSON.stringify(sourceRoot)};
export async function resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const relativePath = specifier === "@/i18n" ? "i18n/index.ts" : specifier.slice(2) + ".ts";
    return nextResolve(new URL(relativePath, sourceRoot).href, context);
}`;
register(`data:text/javascript,${encodeURIComponent(aliasLoader)}`, { parentURL: import.meta.url });

const { detachedAssetStorageKeys } = await import("../stores/use-asset-store.ts");
const { unusedWorkspaceImageCandidates } = await import("./image-storage.ts");
const { unusedWorkspaceMediaCandidates } = await import("./file-storage.ts");

test("仅将素材更新后不再由任一素材持有的 storageKey 作为清理候选", () => {
    const shared = "workspace:assets/images/shared.png";
    const replaced = "workspace:assets/images/replaced.png";
    const before = [
        { id: "old", data: { storageKey: replaced } },
        { id: "shared-a", data: { storageKey: shared } },
        { id: "shared-b", data: { storageKey: shared } },
    ] as never[];
    const after = [
        { id: "old", data: { storageKey: "workspace:assets/images/new.png" } },
        { id: "shared-b", data: { storageKey: shared } },
    ] as never[];

    assert.deepEqual(detachedAssetStorageKeys(before, after), [replaced]);
});

test("桌面候选仍受画布、生成记录与类型引用保护", () => {
    const image = "workspace:assets/images/candidate.png";
    const video = "workspace:assets/videos/candidate.mp4";
    const audio = "workspace:assets/audio/candidate.mp3";
    const referenced = new Set([image, audio]);

    assert.deepEqual(unusedWorkspaceImageCandidates([image, video, image], referenced), []);
    assert.deepEqual(unusedWorkspaceMediaCandidates([image, video, audio, video], referenced), [video]);
});
