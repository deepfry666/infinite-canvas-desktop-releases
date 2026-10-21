import assert from "node:assert/strict";
import test from "node:test";

import { collectPopularPromptTags, sanitizePromptTags } from "./prompt-tags.ts";

test("提示词标签不再把作者或具体用户当作分类", () => {
    assert.deepEqual(sanitizePromptTags(["人像", "@DavidWu", "作者：DavidWu", "DavidWu", "人像"], { author: "DavidWu", sourceName: "DavidWu GPT Image 2", sourceId: "davidwu-gpt-image2-prompts" }), ["人像"]);
});

test("标签筛选只展示使用频率最高的有限数量", () => {
    const tags = collectPopularPromptTags([{ tags: ["A", "B"] }, { tags: ["A", "C"] }, { tags: ["D"] }], 2);
    assert.deepEqual(tags, ["A", "B"]);
});
