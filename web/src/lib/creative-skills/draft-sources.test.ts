import assert from "node:assert/strict";
import test from "node:test";

import type { CanvasConnection, CanvasNodeData } from "../../types/canvas.ts";
import { extractCreativeSkillDraftFromCanvasSelection, prepareCreativeSkillDraftFromExamplePair } from "./draft-sources.ts";

const image = (id: string, input?: { operation?: "generation" | "edit"; prompt?: string; reference?: string; count?: number }): CanvasNodeData => ({
    id,
    type: "image",
    title: id,
    position: { x: 0, y: 0 },
    width: 320,
    height: 240,
    metadata: {
        content: `${id}.png`,
        storageKey: `image:${id}`,
        status: "success",
        ...(input?.operation ? { generationType: input.operation } : {}),
        ...(input?.prompt ? { prompt: input.prompt } : {}),
        ...(input?.reference ? { references: [input.reference] } : {}),
        ...(input?.count ? { count: input.count } : {}),
    },
});

const connection = (fromNodeId: string, toNodeId: string): CanvasConnection => ({ id: `${fromNodeId}:${toNodeId}`, fromNodeId, toNodeId });

function extract(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    return extractCreativeSkillDraftFromCanvasSelection({
        selection: { projectId: "project-1", projectTitle: "海报流程", selectedNodeIds: nodes.map((node) => node.id), nodes, connections },
        userRequestLabel: "创作要求",
    });
}

test("extracts a supported target-to-two-step edit chain", () => {
    const target = image("target");
    const first = image("first", { operation: "edit", prompt: "转成编辑海报", reference: "image:target", count: 1 });
    const second = image("second", { operation: "edit", prompt: "增加纸张肌理", reference: "image:first", count: 2 });

    const result = extract([target, first, second], [connection(target.id, first.id), connection(first.id, second.id)]);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.input.source, "canvas");
    assert.equal(result.input.definition.steps.length, 2);
    assert.equal(result.input.definition.steps[0].operation, "image.edit");
    assert.deepEqual(result.input.definition.steps[0].references, [{ type: "input-target" }]);
    assert.equal(result.input.definition.finalOutputCount, 2);
    assert.deepEqual(result.input.definition.steps[1].prompt, [
        { type: "literal", text: "增加纸张肌理" },
        { type: "literal", text: "\n\n" },
        { type: "parameter", key: "user-request" },
    ]);
});

test("extracts a generation root followed by one edit", () => {
    const generated = image("generated", { operation: "generation", prompt: "生成产品图", count: 1 });
    const edited = image("edited", { operation: "edit", prompt: "调整为冷色", reference: "image:generated", count: 1 });

    const result = extract([generated, edited], [connection(generated.id, edited.id)]);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.input.definition.steps.map((step) => step.operation), ["image.generate", "image.edit"]);
});

test("rejects branching, missing prompts, and stale reference evidence with explicit issues", () => {
    const target = image("target");
    const left = image("left", { operation: "edit", reference: "image:other", count: 1 });
    const right = image("right", { operation: "edit", prompt: "另一路", reference: "image:target", count: 1 });

    const result = extract([target, left, right], [connection(target.id, left.id), connection(target.id, right.id)]);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.issues.some((issue) => issue.includes("分叉")), true);
});

test("rejects an edit selection that omits its target image", () => {
    const edited = image("edited", { operation: "edit", prompt: "编辑", reference: "image:target", count: 1 });

    const result = extract([edited], []);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.issues.some((issue) => issue.includes("缺少上游目标图")), true);
});

test("prepares an example pair as a test fixture, never as a production reference", () => {
    const result = prepareCreativeSkillDraftFromExamplePair({
        name: "纸张质感",
        instruction: "保留构图，将画面转为细腻纸张印刷质感。",
        input: { sha256: "a".repeat(64), mimeType: "image/png", bytes: 1024 },
        output: { sha256: "b".repeat(64), mimeType: "image/webp", bytes: 2048 },
        userRequestLabel: "创作要求",
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.prepared.input.definition.steps[0].references, [{ type: "input-target" }]);
    assert.equal(result.prepared.input.definition.steps[0].prompt.some((segment) => segment.type === "literal" && segment.text.includes("纸张印刷")), true);
    assert.equal(JSON.stringify(result.prepared.input.definition).includes("a".repeat(64)), false);
    assert.equal(result.prepared.fixture.input.sha256, "a".repeat(64));
    assert.equal(result.prepared.fixture.expectedOutput.sha256, "b".repeat(64));
});

test("rejects an example pair without distinct, hashed fixtures and an explicit instruction", () => {
    const result = prepareCreativeSkillDraftFromExamplePair({
        name: "示例",
        instruction: " ",
        input: { sha256: "bad", mimeType: "image/png", bytes: 0 },
        output: { sha256: "bad", mimeType: "image/png", bytes: 0 },
        userRequestLabel: "创作要求",
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.issues.length >= 3, true);
});
