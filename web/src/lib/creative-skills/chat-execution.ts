import type { CanvasAgentSnapshot } from "../canvas/canvas-agent-ops.ts";
import type { CreativeSkillRunSource } from "../creative-skill-run-ledger.ts";
import type { AgentCreativeSkillExecution } from "../../stores/use-agent-store.ts";
import type { CanvasNodeData } from "../../types/canvas.ts";
import type { CreativeSkillDraft, CreativeSkillSource, CreativeSkillVersion } from "../../types/creative-skill.ts";

import { compileCreativeSkillRecipeV1 } from "./compiler.ts";

export type CreativeSkillChatDetail = {
    kind: "creative-skill";
    status: "pending" | "completed" | "rejected" | "error";
    rows: Array<{ key: string; label: string; value: string }>;
    references: Array<{ nodeId: string; title: string; url: string }>;
    output?: string;
};

export function prepareCreativeSkillChatExecution(input: {
    commandId: string;
    clientMessageId?: string;
    threadId?: string;
    skill: { skillId: string; name: string; source?: CreativeSkillSource; version: CreativeSkillVersion };
    prompt: string;
    snapshot: CanvasAgentSnapshot;
    size?: string;
    labels?: Partial<CreativeSkillChatLabels>;
}): { execution: AgentCreativeSkillExecution; detail: CreativeSkillChatDetail } {
    const labels = { ...defaultLabels, ...input.labels };
    assertRunnableVersion(input.skill.version);
    const selected = input.snapshot.selectedNodeIds
        .map((id) => input.snapshot.nodes.find((node) => node.id === id))
        .filter((node): node is CanvasNodeData => node?.type === "image" && Boolean(node.metadata?.content));
    const requiresTarget = input.skill.version.definition.steps[0]?.operation === "image.edit";
    const target = selected[0];
    if (requiresTarget && !target) throw new Error("请先在画布中选择一张目标图片");
    const anchor = target || input.snapshot.nodes.find((node) => input.snapshot.selectedNodeIds.includes(node.id));
    if (!anchor) throw new Error("请先在画布中选择一个输出位置");
    const references = selected.slice(1);
    const parameters = { "user-request": input.prompt };
    const plan = compileCreativeSkillRecipeV1(input.skill.version.definition, {
        parameters,
        target: target && { sha256: target.id },
        references: references.map((node) => ({ sha256: node.id })),
    });
    const ratio = String(plan.parameterValues["aspect-ratio"] || input.size || "1:1");
    const prompts = [...new Set(plan.calls.map((call) => call.prompt))];
    const separator = labels.separator;
    const referencePreviews = references.flatMap((node) => node.metadata?.content
        ? [{ nodeId: node.id, title: node.title || labels.untitledNode, url: node.metadata.content }]
        : []);
    const rows: CreativeSkillChatDetail["rows"] = [
        { key: "understanding", label: labels.understanding, value: input.skill.name },
        { key: "target", label: labels.target, value: target?.title || anchor.title || labels.currentCanvas },
        { key: "references", label: labels.references, value: referencePreviews.length ? referencePreviews.map((item) => item.title).join(separator) : labels.noReferences },
        ...prompts.map((prompt, index) => ({ key: index ? `prompt-${index + 1}` : "prompt", label: prompts.length > 1 ? labels.promptIndex.replace("{{index}}", String(index + 1)) : labels.prompt, value: prompt })),
        { key: "ratio", label: labels.ratio, value: ratio },
        { key: "outputs", label: labels.outputs, value: String(plan.finalOutputCount) },
        { key: "model-calls", label: labels.modelCalls, value: String(plan.providerCallCount) },
    ];
    return {
        execution: {
            commandId: input.commandId,
            mode: "production",
            skill: {
                skillId: input.skill.skillId,
                versionId: input.skill.version.versionId,
                definitionHash: input.skill.version.definitionHash,
                name: input.skill.name,
                source: executableSource(input.skill.source),
            },
            recipe: structuredClone(input.skill.version.definition),
            parameters: plan.parameterValues,
            anchorNodeId: anchor.id,
            targetNodeId: target?.id,
            referenceNodeIds: references.map((node) => node.id),
            assetSource: { kind: "published", skillId: input.skill.skillId, versionId: input.skill.version.versionId },
            provider: { size: ratio },
            clientMessageId: input.clientMessageId,
            threadId: input.threadId,
        },
        detail: { kind: "creative-skill", status: "pending", rows, references: referencePreviews },
    };
}

export function isCreativeSkillChatSnapshotCurrent(current: CanvasAgentSnapshot | null, expected: CanvasAgentSnapshot) {
    return Boolean(current
        && current.projectId === expected.projectId
        && current.nodes === expected.nodes
        && current.connections === expected.connections
        && current.selectedNodeIds.length === expected.selectedNodeIds.length
        && current.selectedNodeIds.every((id, index) => id === expected.selectedNodeIds[index]));
}

export function prepareCreativeSkillDraftTestExecution(input: {
    commandId: string;
    request: { draftId: string; expectedRevision: number; definitionHash: string };
    draft: CreativeSkillDraft;
    prompt: string;
    snapshot: CanvasAgentSnapshot;
    size?: string;
}): { execution: AgentCreativeSkillExecution; detail: CreativeSkillChatDetail } {
    if (input.draft.draftId !== input.request.draftId
        || input.draft.revision !== input.request.expectedRevision
        || input.draft.definitionHash !== input.request.definitionHash) {
        throw new Error("创作 Skill 草稿已变化，请重新发起试跑");
    }
    if (input.draft.validation.status !== "passed" || input.draft.validation.definitionHash !== input.draft.definitionHash) {
        throw new Error("当前草稿未通过校验");
    }
    const draftVersionId = `draft:${input.draft.draftId}:${input.draft.revision}`;
    const prepared = prepareCreativeSkillChatExecution({
        commandId: input.commandId,
        skill: {
            skillId: input.draft.skillId,
            name: input.draft.name,
            source: input.draft.source,
            version: {
                versionId: draftVersionId,
                definitionHash: input.draft.definitionHash,
                definition: input.draft.definition,
                validation: input.draft.validation,
                testRun: { status: "passed", definitionHash: input.draft.definitionHash, issues: [] },
                compatibility: { status: "compatible", issues: [] },
                health: { status: "healthy", issues: [] },
                publishedAt: input.draft.updatedAt,
            },
        },
        prompt: input.prompt,
        snapshot: input.snapshot,
        size: input.size,
    });
    prepared.execution.mode = "test";
    prepared.execution.assetSource = { kind: "draft", draftId: input.draft.draftId, draftRevision: input.draft.revision };
    if (input.draft.fixture) {
        prepared.execution.targetNodeId = undefined;
        prepared.execution.targetFixture = {
            draftId: input.draft.draftId,
            draftRevision: input.draft.revision,
            sha256: input.draft.fixture.input.sha256,
        };
    }
    return prepared;
}

type CreativeSkillChatLabels = {
    understanding: string;
    target: string;
    references: string;
    noReferences: string;
    currentCanvas: string;
    untitledNode: string;
    prompt: string;
    promptIndex: string;
    ratio: string;
    outputs: string;
    modelCalls: string;
    separator: string;
};

const defaultLabels: CreativeSkillChatLabels = {
    understanding: "理解",
    target: "目标",
    references: "参考图",
    noReferences: "未使用参考图",
    currentCanvas: "当前画布",
    untitledNode: "未命名节点",
    prompt: "完整提示词",
    promptIndex: "提示词 {{index}}",
    ratio: "画幅",
    outputs: "预计输出",
    modelCalls: "模型调用",
    separator: "、",
};

function assertRunnableVersion(version: CreativeSkillVersion) {
    if (version.validation.status !== "passed" || version.validation.definitionHash !== version.definitionHash) throw new Error("当前版本未通过校验");
    if (version.testRun.status !== "passed" || version.testRun.definitionHash !== version.definitionHash) throw new Error("当前版本未通过试跑");
    if (version.compatibility.status !== "compatible") throw new Error("当前版本与本应用不兼容");
    if (version.health.status !== "healthy") throw new Error("当前版本的素材不完整");
}

function executableSource(source: CreativeSkillSource | undefined): CreativeSkillRunSource | undefined {
    if (source === "skill-markdown") throw new Error("外部 SKILL.md 仅供隔离查看，不能运行");
    return source;
}
