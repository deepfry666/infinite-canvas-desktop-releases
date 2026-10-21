import assert from "node:assert/strict";
import test from "node:test";

import type { CanvasNodeData } from "../../types/canvas.ts";
import type { CreativeSkillVersion } from "../../types/creative-skill.ts";
import { isCreativeSkillChatSnapshotCurrent, prepareCreativeSkillChatExecution, prepareCreativeSkillDraftTestExecution } from "./chat-execution.ts";

const version: CreativeSkillVersion = {
    versionId: "sha256:version",
    definitionHash: "sha256:version",
    definition: {
        schemaVersion: 1,
        kind: "linear-image",
        parameters: [
            { key: "user-request", label: "创作要求", type: "text", required: true },
            { key: "aspect-ratio", label: "比例", type: "aspect-ratio", required: false, default: "4:5" },
        ],
        steps: [{
            operation: "image.edit",
            references: [{ type: "input-target" }, { type: "input-references" }],
            prompt: [{ type: "literal", text: "转换风格：" }, { type: "parameter", key: "user-request" }],
        }],
        finalOutputCount: 1,
    },
    validation: { status: "passed", definitionHash: "sha256:version", issues: [] },
    testRun: { status: "passed", definitionHash: "sha256:version", issues: [] },
    compatibility: { status: "compatible", issues: [] },
    health: { status: "healthy", issues: [] },
    publishedAt: "2026-08-21T00:00:00.000Z",
};

const image = (id: string, title: string): CanvasNodeData => ({
    id,
    type: "image" as CanvasNodeData["type"],
    title,
    position: { x: 0, y: 0 },
    width: 320,
    height: 240,
    metadata: { content: `${id}.png`, status: "success" },
});

test("attached Skill binds the send-time target, references, prompt, and confirmation totals", () => {
    const target = image("target", "原图");
    const reference = image("reference", "配色参考");
    const prepared = prepareCreativeSkillChatExecution({
        commandId: "command-1",
        clientMessageId: "message-1",
        skill: { skillId: "personal.poster", name: "海报风格", version },
        prompt: "做成秋日电影海报",
        snapshot: {
            projectId: "project-1",
            title: "画布",
            nodes: [target, reference],
            connections: [],
            selectedNodeIds: [target.id, reference.id],
            viewport: { x: 0, y: 0, k: 1 },
        },
        size: "1:1",
    });

    assert.equal(prepared.execution.anchorNodeId, target.id);
    assert.equal(prepared.execution.targetNodeId, target.id);
    assert.deepEqual(prepared.execution.referenceNodeIds, [reference.id]);
    assert.equal(prepared.execution.parameters["user-request"], "做成秋日电影海报");
    assert.equal(prepared.execution.parameters["aspect-ratio"], "4:5");
    assert.equal(prepared.execution.provider?.size, "4:5");
    assert.equal(prepared.detail.rows.find((row) => row.key === "prompt")?.value, "转换风格：做成秋日电影海报");
    assert.equal(prepared.detail.rows.find((row) => row.key === "model-calls")?.value, "1");
    assert.equal(prepared.detail.rows.find((row) => row.key === "outputs")?.value, "1");
});

test("an image-edit Skill refuses to guess when no image is selected", () => {
    assert.throws(() => prepareCreativeSkillChatExecution({
        commandId: "command-1",
        skill: { skillId: "personal.poster", name: "海报风格", version },
        prompt: "秋日电影感",
        snapshot: { projectId: "project-1", title: "画布", nodes: [], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } },
        size: "1:1",
    }), /先在画布中选择一张目标图片/);
});

test("a published version with stale test evidence is rejected", () => {
    const staleVersion = structuredClone(version);
    staleVersion.testRun.definitionHash = "sha256:old";
    assert.throws(() => prepareCreativeSkillChatExecution({
        commandId: "command-1",
        skill: { skillId: "personal.poster", name: "海报风格", version: staleVersion },
        prompt: "秋日电影感",
        snapshot: { projectId: "project-1", title: "画布", nodes: [image("target", "原图")], connections: [], selectedNodeIds: ["target"], viewport: { x: 0, y: 0, k: 1 } },
        size: "1:1",
    }), /当前版本未通过试跑/);
});

test("a quarantined SKILL.md source cannot prepare execution", () => {
    assert.throws(() => prepareCreativeSkillChatExecution({
        commandId: "command-quarantined",
        skill: { skillId: "skill-quarantined", name: "隔离 Skill", source: "skill-markdown", version },
        prompt: "生成海报",
        snapshot: { projectId: "project-1", title: "画布", nodes: [image("target", "原图")], connections: [], selectedNodeIds: ["target"], viewport: { x: 0, y: 0, k: 1 } },
    }), /仅供隔离查看/);
});

test("confirmation rejects a changed selection or node snapshot", () => {
    const nodes = [image("target", "原图")];
    const expected = { projectId: "project-1", title: "画布", nodes, connections: [], selectedNodeIds: ["target"], viewport: { x: 0, y: 0, k: 1 } };
    assert.equal(isCreativeSkillChatSnapshotCurrent({ ...expected }, expected), true);
    assert.equal(isCreativeSkillChatSnapshotCurrent({ ...expected, selectedNodeIds: [] }, expected), false);
    assert.equal(isCreativeSkillChatSnapshotCurrent({ ...expected, nodes: [...nodes] }, expected), false);
});

test("draft test execution is bound to the exact draft revision and uses quarantined draft assets", () => {
    const draft = {
        draftId: "draft-1",
        skillId: "personal.poster",
        revision: 3,
        lifecycle: "draft" as const,
        ownership: "personal" as const,
        trust: "local-reviewed" as const,
        source: "manual" as const,
        enabled: false as const,
        name: "海报风格",
        description: "",
        definition: version.definition,
        definitionHash: version.definitionHash,
        validation: version.validation,
        testRun: { status: "pending" as const, definitionHash: version.definitionHash, issues: [] },
        createdAt: "2026-08-21T00:00:00.000Z",
        updatedAt: "2026-08-21T00:00:00.000Z",
    };
    const snapshot = { projectId: "project-1", title: "画布", nodes: [image("target", "原图")], connections: [], selectedNodeIds: ["target"], viewport: { x: 0, y: 0, k: 1 } };
    const prepared = prepareCreativeSkillDraftTestExecution({
        commandId: "test-command",
        request: { draftId: draft.draftId, expectedRevision: draft.revision, definitionHash: draft.definitionHash },
        draft,
        prompt: "验证效果",
        snapshot,
    });
    assert.equal(prepared.execution.mode, "test");
    assert.deepEqual(prepared.execution.assetSource, { kind: "draft", draftId: "draft-1", draftRevision: 3 });
    assert.throws(() => prepareCreativeSkillDraftTestExecution({
        commandId: "stale-command",
        request: { draftId: draft.draftId, expectedRevision: 2, definitionHash: draft.definitionHash },
        draft,
        prompt: "验证效果",
        snapshot,
    }), /草稿已变化/);
});

test("an example-pair draft test uses its immutable input fixture instead of the selected canvas image", () => {
    const draft = {
        draftId: "draft-example",
        skillId: "personal.example",
        revision: 2,
        lifecycle: "draft" as const,
        ownership: "personal" as const,
        trust: "local-reviewed" as const,
        source: "manual" as const,
        enabled: false as const,
        name: "纸张质感",
        description: "",
        definition: version.definition,
        definitionHash: version.definitionHash,
        validation: version.validation,
        testRun: { status: "pending" as const, definitionHash: version.definitionHash, issues: [] },
        fixture: {
            input: { sha256: "a".repeat(64), mimeType: "image/png" as const, bytes: 10, width: 100, height: 80 },
            expectedOutput: { sha256: "b".repeat(64), mimeType: "image/png" as const, bytes: 11, width: 100, height: 80 },
        },
        createdAt: "2026-08-21T00:00:00.000Z",
        updatedAt: "2026-08-21T00:00:00.000Z",
    };
    const prepared = prepareCreativeSkillDraftTestExecution({
        commandId: "test-example",
        request: { draftId: draft.draftId, expectedRevision: draft.revision, definitionHash: draft.definitionHash },
        draft,
        prompt: "验证效果",
        snapshot: { projectId: "project-1", title: "画布", nodes: [image("anchor", "输出落点")], connections: [], selectedNodeIds: ["anchor"], viewport: { x: 0, y: 0, k: 1 } },
    });

    assert.equal(prepared.execution.anchorNodeId, "anchor");
    assert.equal(prepared.execution.targetNodeId, undefined);
    assert.deepEqual(prepared.execution.targetFixture, { draftId: "draft-example", draftRevision: 2, sha256: "a".repeat(64) });
});
