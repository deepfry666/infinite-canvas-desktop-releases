import assert from "node:assert/strict";
import test from "node:test";

import { detectProviderPreset } from "./model-onboarding.ts";

test("填写常见中转地址时自动选择适配模板", () => {
    assert.deepEqual(detectProviderPreset("https://api.apimart.ai"), { apiFormat: "openai", adapterMode: "preset", adapterPreset: "apimart-gpt-image" });
    assert.deepEqual(detectProviderPreset("https://generativelanguage.googleapis.com"), { apiFormat: "gemini", adapterMode: "preset", adapterPreset: "gemini" });
    assert.deepEqual(detectProviderPreset("https://relay.example.com/v1"), { apiFormat: "openai", adapterMode: "preset", adapterPreset: "openai-compatible" });
});
