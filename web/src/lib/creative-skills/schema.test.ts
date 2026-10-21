import assert from "node:assert/strict";
import test from "node:test";

import { parseCreativeSkillRecipeV1 } from "./index.ts";

function validRecipe() {
    return {
        schemaVersion: 1,
        kind: "linear-image",
        parameters: [
            { key: "user-request", label: "本次补充要求", required: false, type: "text", default: "" },
            { key: "mood", label: "氛围", required: true, type: "enum", options: [{ value: "quiet", label: "安静" }], default: "quiet" },
        ],
        steps: [
            {
                operation: "image.edit",
                prompt: [{ type: "parameter", key: "user-request" }],
                references: [{ type: "asset", sha256: "a".repeat(64) }],
            },
        ],
        finalOutputCount: 1,
    };
}

test("Recipe v1 在所有层级都拒绝未知字段", () => {
    const recipe = validRecipe();
    const cases = [
        { ...recipe, provider: "hidden" },
        { ...recipe, parameters: [{ ...recipe.parameters[0], script: "run" }] },
        { ...recipe, parameters: [{ ...recipe.parameters[1], options: [{ value: "quiet", label: "安静", command: "run" }] }] },
        { ...recipe, steps: [{ ...recipe.steps[0], model: "hidden" }] },
        { ...recipe, steps: [{ ...recipe.steps[0], prompt: [{ type: "literal", text: "ok", expression: "hidden" }] }] },
        { ...recipe, steps: [{ ...recipe.steps[0], references: [{ type: "asset", sha256: "a".repeat(64), url: "https://example.com/a.png" }] }] },
    ];

    cases.forEach((value) => assert.throws(() => parseCreativeSkillRecipeV1(value), /不支持的字段/));
});

test("Recipe v1 只接受 1 到 3 个串行步骤", () => {
    const recipe = validRecipe();
    assert.doesNotThrow(() => parseCreativeSkillRecipeV1(recipe));
    assert.throws(() => parseCreativeSkillRecipeV1({ ...recipe, steps: [] }), /步骤数量/);
    assert.throws(() => parseCreativeSkillRecipeV1({ ...recipe, steps: Array.from({ length: 4 }, () => recipe.steps[0]) }), /步骤数量/);
});

test("Recipe v1 固定协议版本、线性图片类型和 1 到 4 张最终输出", () => {
    const recipe = validRecipe();

    assert.throws(() => parseCreativeSkillRecipeV1({ ...recipe, schemaVersion: 2 }), /schemaVersion/);
    assert.throws(() => parseCreativeSkillRecipeV1({ ...recipe, kind: "script" }), /kind/);
    assert.throws(() => parseCreativeSkillRecipeV1({ ...recipe, finalOutputCount: 0 }), /finalOutputCount/);
    assert.throws(() => parseCreativeSkillRecipeV1({ ...recipe, finalOutputCount: 5 }), /finalOutputCount/);
});

test("Recipe v1 必须且只能声明一个 user-request 文本参数", () => {
    const recipe = validRecipe();
    assert.throws(() => parseCreativeSkillRecipeV1({ ...recipe, parameters: recipe.parameters.slice(1) }), /user-request/);
    assert.throws(() => parseCreativeSkillRecipeV1({ ...recipe, parameters: [...recipe.parameters, recipe.parameters[0]] }), /参数键重复/);
    assert.throws(
        () => parseCreativeSkillRecipeV1({ ...recipe, parameters: [{ key: "user-request", label: "补充", required: false, type: "integer", min: 0, max: 10, step: 1 }] }),
        /user-request.*text/,
    );
});

test("Recipe v1 校验 text、enum、integer 和 aspect-ratio 参数定义", () => {
    const recipe = validRecipe();
    const parameters = [
        { key: "user-request", label: "本次补充要求", required: false, type: "text", default: "", maxLength: 2_000 },
        { key: "mood", label: "氛围", required: true, type: "enum", options: [{ value: "quiet", label: "安静" }, { value: "warm", label: "温暖" }], default: "quiet" },
        { key: "grain", label: "颗粒", required: true, type: "integer", min: 0, max: 10, step: 2, default: 4 },
        { key: "ratio", label: "画幅", required: true, type: "aspect-ratio", options: ["auto", "1:1", "4:5"], default: "4:5" },
    ];
    assert.doesNotThrow(() => parseCreativeSkillRecipeV1({ ...recipe, parameters }));

    const invalidParameters = [
        { ...parameters[0], maxLength: 0 },
        { ...parameters[1], options: [{ value: "quiet", label: "安静" }, { value: "quiet", label: "重复" }] },
        { ...parameters[1], default: "missing" },
        { ...parameters[2], min: 10, max: 0 },
        { ...parameters[2], step: 0 },
        { ...parameters[2], default: 3 },
        { ...parameters[3], options: ["16/9"] },
        { ...parameters[3], default: "9:16" },
    ];
    invalidParameters.forEach((parameter) => assert.throws(() => parseCreativeSkillRecipeV1({ ...recipe, parameters: [parameters[0], parameter] }), /参数/));
});

test("Recipe v1 拒绝除 user-request 外没有默认值的必填参数", () => {
    const recipe = validRecipe();
    const userRequest = { key: "user-request", label: "本次补充要求", required: true, type: "text" };
    const requiredWithoutDefault = [
        { key: "title", label: "标题", required: true, type: "text", maxLength: 80 },
        { key: "mood", label: "氛围", required: true, type: "enum", options: [{ value: "quiet", label: "安静" }] },
        { key: "grain", label: "颗粒", required: true, type: "integer", min: 0, max: 10, step: 1 },
        { key: "ratio", label: "画幅", required: true, type: "aspect-ratio", options: ["1:1", "4:5"] },
    ];

    assert.doesNotThrow(() => parseCreativeSkillRecipeV1({ ...recipe, parameters: [userRequest] }));
    requiredWithoutDefault.forEach((parameter) => {
        assert.throws(() => parseCreativeSkillRecipeV1({ ...recipe, parameters: [userRequest, parameter] }), /必须提供默认值/);
    });
});

test("Recipe v1 的步骤只能组成首步生成或编辑、后续编辑的线性链", () => {
    const recipe = validRecipe();
    const generate = { operation: "image.generate", prompt: [{ type: "literal", text: "生成底图" }] };
    const edit = { operation: "image.edit", prompt: [{ type: "parameter", key: "user-request" }] };

    assert.doesNotThrow(() => parseCreativeSkillRecipeV1({ ...recipe, steps: [generate, edit] }));
    assert.throws(() => parseCreativeSkillRecipeV1({ ...recipe, steps: [{ ...generate, references: [{ type: "input-target" }] }] }), /生成步骤.*参考图/);
    assert.throws(() => parseCreativeSkillRecipeV1({ ...recipe, steps: [edit, generate] }), /后续步骤.*编辑/);
    assert.throws(() => parseCreativeSkillRecipeV1({ ...recipe, steps: [{ operation: "video.generate", prompt: generate.prompt }] }), /operation/);
    assert.throws(() => parseCreativeSkillRecipeV1({ ...recipe, steps: [{ ...edit, prompt: [{ type: "parameter", key: "missing" }] }] }), /未声明参数/);
    assert.throws(() => parseCreativeSkillRecipeV1({ ...recipe, steps: [{ ...edit, references: [{ type: "asset", sha256: "bad" }] }] }), /sha256/);
});
