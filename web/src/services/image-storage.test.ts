import assert from "node:assert/strict";
import test from "node:test";

test("remote generated images remain usable when desktop download fails", async () => {
    const previousLocalStorage = globalThis.localStorage;
    const previousDocument = globalThis.document;
    const previousWindow = globalThis.window;
    globalThis.localStorage = { getItem: () => null, setItem: () => undefined } as unknown as Storage;
    globalThis.document = { documentElement: { lang: "zh-CN" } } as unknown as Document;
    globalThis.window = {
        infiniteCanvasDesktop: {
            storeAsset: async () => {
                throw new Error("下载生成结果失败（HTTP 403）");
            },
        },
    } as unknown as Window & typeof globalThis;

    try {
        const { uploadImage } = await import("./image-storage.ts");
        const result = await uploadImage("https://cdn.example/generated.png");
        assert.equal(result.url, "https://cdn.example/generated.png");
        assert.match(result.storageKey, /^remote-image:/);
        assert.equal(result.created, false);
    } finally {
        globalThis.localStorage = previousLocalStorage;
        globalThis.document = previousDocument;
        globalThis.window = previousWindow;
    }
});
