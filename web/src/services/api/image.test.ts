import assert from "node:assert/strict";
import test from "node:test";

test("OpenAI-compatible image responses with URL arrays are accepted", async () => {
    const previousLocalStorage = globalThis.localStorage;
    const previousDocument = globalThis.document;
    globalThis.localStorage = { getItem: () => null, setItem: () => undefined } as unknown as Storage;
    globalThis.document = { documentElement: { lang: "zh-CN" } } as unknown as Document;

    const axios = (await import("axios")).default;
    const previousPost = axios.post;
    axios.post = (async () => ({ data: { data: [{ url: ["https://cdn.example/result.png"] }] } })) as typeof axios.post;

    try {
        const { requestGeneration } = await import("./image.ts");
        const { defaultConfig } = await import("@/stores/use-config-store");
        const config = {
            ...defaultConfig,
            channelMode: "local" as const,
            baseUrl: "https://cpa.example/v1",
            apiKey: "test-key",
            apiFormat: "openai" as const,
            channels: [{ id: "cpa", name: "CPA", baseUrl: "https://cpa.example/v1", apiKey: "test-key", apiFormat: "openai" as const, models: [{ name: "gpt-image", capability: "image" as const }] }],
            model: "cpa::gpt-image",
            imageModel: "cpa::gpt-image",
            count: "1",
            quality: "auto",
            size: "1024x1024",
            background: "",
            systemPrompt: "",
            reasoningEffort: "auto" as const,
        };

        const result = await requestGeneration(config, "a test image");
        assert.equal(result[0]?.dataUrl, "https://cdn.example/result.png");
    } finally {
        axios.post = previousPost;
        globalThis.localStorage = previousLocalStorage;
        globalThis.document = previousDocument;
    }
});
