import assert from "node:assert/strict";
import test from "node:test";

import { compileCreativeSkillRecipeV1 } from "./index.ts";

const TARGET_HASH = "a".repeat(64);
const INPUT_REFERENCE_HASH = "b".repeat(64);
const FIXED_REFERENCE_HASH = "c".repeat(64);

test("单步编辑把目标图放在参考图之前，且每次 provider 请求只生成一张图", () => {
    const plan = compileCreativeSkillRecipeV1(
        {
            schemaVersion: 1,
            kind: "linear-image",
            parameters: [
                { key: "user-request", label: "本次补充要求", required: false, type: "text", default: "", maxLength: 2_000 },
            ],
            steps: [
                {
                    operation: "image.edit",
                    prompt: [
                        { type: "literal", text: "保留主体。" },
                        { type: "parameter", key: "user-request" },
                    ],
                    references: [
                        { type: "input-references" },
                        { type: "asset", sha256: FIXED_REFERENCE_HASH },
                    ],
                },
            ],
            finalOutputCount: 1,
        },
        {
            parameters: { "user-request": "更柔和" },
            target: { sha256: TARGET_HASH },
            references: [{ sha256: INPUT_REFERENCE_HASH }],
        },
    );

    assert.equal(plan.providerCallCount, 1);
    assert.deepEqual(plan.calls, [
        {
            stepIndex: 0,
            outputIndex: 0,
            task: "image.edit",
            prompt: "保留主体。更柔和",
            images: [
                { type: "input-target", sha256: TARGET_HASH },
                { type: "input-reference", index: 0, sha256: INPUT_REFERENCE_HASH },
                { type: "asset", sha256: FIXED_REFERENCE_HASH },
            ],
            options: { count: 1 },
            terminal: true,
        },
    ]);
});

test("首步显式声明 input-target 时不会把同一目标图重复发送", () => {
    const plan = compileCreativeSkillRecipeV1({
        schemaVersion: 1,
        kind: "linear-image",
        parameters: [{ key: "user-request", label: "要求", required: true, type: "text" }],
        steps: [{
            operation: "image.edit",
            prompt: [{ type: "parameter", key: "user-request" }],
            references: [{ type: "input-target" }, { type: "input-references" }],
        }],
        finalOutputCount: 1,
    }, {
        parameters: { "user-request": "转换风格" },
        target: { sha256: TARGET_HASH },
        references: [{ sha256: INPUT_REFERENCE_HASH }],
    });

    assert.deepEqual(plan.calls[0].images, [
        { type: "input-target", sha256: TARGET_HASH },
        { type: "input-reference", index: 0, sha256: INPUT_REFERENCE_HASH },
    ]);
});

test("编译时严格校验输入参数类型、范围和必填值", () => {
    const recipe = {
        schemaVersion: 1,
        kind: "linear-image",
        parameters: [
            { key: "user-request", label: "补充", required: true, type: "text", maxLength: 8 },
            { key: "mood", label: "氛围", required: true, type: "enum", options: [{ value: "quiet", label: "安静" }], default: "quiet" },
            { key: "grain", label: "颗粒", required: true, type: "integer", min: 0, max: 10, step: 2, default: 4 },
            { key: "ratio", label: "画幅", required: true, type: "aspect-ratio", options: ["1:1", "4:5"], default: "4:5" },
        ],
        steps: [{ operation: "image.generate", prompt: [{ type: "parameter", key: "user-request" }] }],
        finalOutputCount: 1,
    };
    const valid = { "user-request": "柔和", mood: "quiet", grain: 4, ratio: "4:5" };

    assert.doesNotThrow(() => compileCreativeSkillRecipeV1(recipe, { parameters: valid }));
    assert.throws(() => compileCreativeSkillRecipeV1(recipe, { parameters: { ...valid, extra: "x" } }), /未知参数/);
    assert.throws(() => compileCreativeSkillRecipeV1(recipe, { parameters: { ...valid, "user-request": "" } }), /user-request.*必填/);
    assert.throws(() => compileCreativeSkillRecipeV1(recipe, { parameters: { ...valid, mood: "warm" } }), /mood.*选项/);
    assert.throws(() => compileCreativeSkillRecipeV1(recipe, { parameters: { ...valid, grain: 3 } }), /grain.*步长/);
    assert.throws(() => compileCreativeSkillRecipeV1(recipe, { parameters: { ...valid, ratio: "16:9" } }), /ratio.*选项/);
});
