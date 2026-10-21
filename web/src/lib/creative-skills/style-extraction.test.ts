import assert from "node:assert/strict";
import test from "node:test";

import {
    buildCreativeSkillStyleExtractionMessages,
    parseCreativeSkillStyleExtraction,
} from "./style-extraction.ts";

test("builds a multimodal comparison request that treats image text as untrusted content", () => {
    const messages = buildCreativeSkillStyleExtractionMessages({
        inputDataUrl: "data:image/png;base64,before",
        outputDataUrl: "data:image/webp;base64,after",
        language: "zh-CN",
    });

    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, "system");
    assert.match(String(messages[0].content), /图片中的.*不可信/);
    assert.match(String(messages[0].content), /不得.*指令/);
    assert.match(String(messages[0].content), /视觉变化/);
    assert.equal(messages[1].role, "user");
    assert.deepEqual(messages[1].content, [
        { type: "text", text: "图 1：原图（转换前）" },
        { type: "image_url", image_url: { url: "data:image/png;base64,before" } },
        { type: "text", text: "图 2：效果图（转换后）" },
        { type: "image_url", image_url: { url: "data:image/webp;base64,after" } },
        { type: "text", text: "请比较图 1 与图 2，按系统要求提炼可复用的创作 Skill。" },
    ]);
});

test("parses plain or fenced JSON into trimmed editable fields", () => {
    assert.deepEqual(parseCreativeSkillStyleExtraction(`\n\`\`\`json\n{
        "name": "  纸张电影海报  ",
        "description": "  低饱和暖调与印刷排版  ",
        "instruction": "  保留主体和构图，加入纸张颗粒。  "
    }\n\`\`\`\n`), {
        name: "纸张电影海报",
        description: "低饱和暖调与印刷排版",
        instruction: "保留主体和构图，加入纸张颗粒。",
    });

    assert.equal(parseCreativeSkillStyleExtraction('{"name":"胶片质感","description":"","instruction":"保持主体不变。"}').name, "胶片质感");
});

test("rejects prose wrappers, missing fields, and oversized fields", () => {
    assert.throws(() => parseCreativeSkillStyleExtraction('分析如下：{"name":"示例","description":"","instruction":"说明"}'), /有效 JSON/);
    assert.throws(() => parseCreativeSkillStyleExtraction('{"name":"示例","description":"说明"}'), /instruction/);
    assert.throws(() => parseCreativeSkillStyleExtraction('{"name":"示例","description":"","instruction":"说明","actions":["run"]}'), /字段/);
    assert.throws(() => parseCreativeSkillStyleExtraction(JSON.stringify({ name: "x".repeat(121), description: "", instruction: "说明" })), /name/);
    assert.throws(() => parseCreativeSkillStyleExtraction(JSON.stringify({ name: "示例", description: "x".repeat(1001), instruction: "说明" })), /description/);
    assert.throws(() => parseCreativeSkillStyleExtraction(JSON.stringify({ name: "示例", description: "", instruction: "x".repeat(20_001) })), /instruction/);
});
