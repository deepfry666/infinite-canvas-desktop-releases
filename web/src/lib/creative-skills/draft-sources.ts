import type { CanvasConnection, CanvasNodeData } from "../../types/canvas.ts";
import type { CreateCreativeSkillDraftInput, CreativeSkillDefinition } from "../../types/creative-skill.ts";

export const CREATIVE_SKILL_CANVAS_SELECTION_REQUEST_EVENT = "fourj:creative-skill-canvas-selection-request" as const;
export const CREATIVE_SKILL_CANVAS_SELECTION_RESULT_EVENT = "fourj:creative-skill-canvas-selection-result" as const;

export type CreativeSkillCanvasSelection = {
    projectId: string;
    projectTitle: string;
    selectedNodeIds: string[];
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
};

export type CreativeSkillCanvasSelectionRequest = {
    requestId: string;
    selection: CreativeSkillCanvasSelection;
    name?: string;
    description?: string;
    userRequestLabel: string;
};

export type CreativeSkillCanvasSelectionResult =
    | { requestId: string; status: "created"; draftId: string }
    | { requestId: string; status: "rejected"; issues: string[] };

export type CreativeSkillCanvasExtractionResult =
    | { ok: true; input: CreateCreativeSkillDraftInput }
    | { ok: false; issues: string[] };

export type CreativeSkillExampleImage = { sha256: string; mimeType: "image/png" | "image/jpeg" | "image/webp"; bytes: number };
export type CreativeSkillExamplePairRequest = {
    name: string;
    description?: string;
    instruction: string;
    input: CreativeSkillExampleImage;
    output: CreativeSkillExampleImage;
    userRequestLabel: string;
};
export type CreativeSkillExamplePairPreparation = {
    input: CreateCreativeSkillDraftInput;
    fixture: { input: CreativeSkillExampleImage; expectedOutput: CreativeSkillExampleImage };
};
export type CreativeSkillExamplePairPreparationResult =
    | { ok: true; prepared: CreativeSkillExamplePairPreparation }
    | { ok: false; issues: string[] };

export class CreativeSkillCanvasSelectionError extends Error {
    readonly issues: string[];

    constructor(issues: string[]) {
        super(issues.join("；"));
        this.name = "CreativeSkillCanvasSelectionError";
        this.issues = issues;
    }
}

export function extractCreativeSkillDraftFromCanvasSelection(request: Omit<CreativeSkillCanvasSelectionRequest, "requestId">): CreativeSkillCanvasExtractionResult {
    const issues: string[] = [];
    const selectedIds = [...new Set(request.selection.selectedNodeIds)];
    const nodeById = new Map(request.selection.nodes.map((node) => [node.id, node]));
    const nodes = selectedIds.flatMap((id) => {
        const node = nodeById.get(id);
        if (!node) issues.push(`选区节点 ${id} 已不存在`);
        return node ? [node] : [];
    });
    if (!nodes.length) issues.push("请先选择一条图片生成或编辑流程");
    if (nodes.some((node) => node.type !== "image")) issues.push("选区只能包含图片节点");
    if (issues.length) return { ok: false, issues };

    const selectedSet = new Set(selectedIds);
    const connections = request.selection.connections.filter((connection) => selectedSet.has(connection.fromNodeId) && selectedSet.has(connection.toNodeId));
    const incoming = new Map(nodes.map((node) => [node.id, [] as string[]]));
    const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
    connections.forEach((connection) => {
        if (connection.fromNodeId === connection.toNodeId) issues.push("图片流程不能包含自连接");
        incoming.get(connection.toNodeId)?.push(connection.fromNodeId);
        outgoing.get(connection.fromNodeId)?.push(connection.toNodeId);
    });
    if (connections.length !== nodes.length - 1) issues.push("选区必须是一条连续、无分叉的有向图片链");
    if ([...incoming.values(), ...outgoing.values()].some((ids) => ids.length > 1)) issues.push("选区包含分叉或汇合，当前只支持线性图片流程");
    const roots = nodes.filter((node) => incoming.get(node.id)?.length === 0);
    const terminals = nodes.filter((node) => outgoing.get(node.id)?.length === 0);
    if (roots.length !== 1 || terminals.length !== 1) issues.push("选区必须有且只有一个起点和终点");
    if (issues.length) return { ok: false, issues: unique(issues) };

    const path: CanvasNodeData[] = [];
    const visited = new Set<string>();
    let current: CanvasNodeData | undefined = roots[0];
    while (current && !visited.has(current.id)) {
        path.push(current);
        visited.add(current.id);
        current = nodeById.get(outgoing.get(current.id)?.[0] || "");
    }
    if (path.length !== nodes.length) return { ok: false, issues: ["选区必须是一条完整连通的图片链"] };

    const firstStepIndex = path.findIndex((node) => Boolean(node.metadata?.generationType));
    if (firstStepIndex < 0) return { ok: false, issues: ["选区不包含带生成记录的图片节点"] };
    if (firstStepIndex > 1) issues.push("流程起点最多只能包含一张输入目标图");
    if (path.slice(firstStepIndex).some((node) => !node.metadata?.generationType)) issues.push("流程步骤缺少图片操作记录");
    const stepNodes = path.slice(firstStepIndex);
    if (stepNodes.length < 1 || stepNodes.length > 3) issues.push("当前只支持 1 到 3 个连续图片步骤");

    const steps: CreativeSkillDefinition["steps"] = [];
    stepNodes.forEach((node, index) => {
        const metadata = node.metadata;
        const operation = metadata?.generationType;
        const prompt = metadata?.prompt?.trim();
        const pathIndex = firstStepIndex + index;
        const predecessor = path[pathIndex - 1];
        const count = metadata?.count;
        if (operation !== "generation" && operation !== "edit") {
            issues.push(`节点“${node.title}”缺少受支持的图片操作`);
            return;
        }
        if (!prompt) issues.push(`节点“${node.title}”缺少生成提示词`);
        if (!Number.isSafeInteger(count) || !count || count < 1 || count > 4) issues.push(`节点“${node.title}”缺少 1 到 4 的输出数量记录`);
        if (index < stepNodes.length - 1 && count !== 1) issues.push(`中间步骤“${node.title}”必须只有一个输出`);
        if (index > 0 && operation !== "edit") issues.push(`后续步骤“${node.title}”必须是图片编辑`);
        if (operation === "generation") {
            if (predecessor) issues.push(`生成步骤“${node.title}”不能有输入图片`);
            if (metadata?.references?.length) issues.push(`生成步骤“${node.title}”不能包含图片引用`);
        } else {
            if (!predecessor) issues.push(`编辑步骤“${node.title}”缺少上游目标图`);
            const references = metadata?.references || [];
            if (references.length !== 1) issues.push(`编辑步骤“${node.title}”必须且只能引用上游目标图`);
            if (predecessor && !references.some((reference) => imageReferenceIdentities(predecessor).has(reference)))
                issues.push(`编辑步骤“${node.title}”的引用记录与上游图片不一致`);
        }
        if (!prompt || (operation === "generation" && predecessor) || (operation === "edit" && !predecessor)) return;
        steps.push({
            operation: operation === "generation" ? "image.generate" : "image.edit",
            prompt: [
                { type: "literal", text: prompt },
                { type: "literal", text: "\n\n" },
                { type: "parameter", key: "user-request" },
            ],
            ...(operation === "edit" && index === 0 ? { references: [{ type: "input-target" as const }] } : {}),
        });
    });
    if (issues.length) return { ok: false, issues: unique(issues) };

    const projectTitle = request.selection.projectTitle.trim();
    const name = request.name?.trim() || projectTitle || "Canvas Skill";
    return {
        ok: true,
        input: {
            name,
            description: request.description?.trim() || "",
            source: "canvas",
            definition: {
                schemaVersion: 1,
                kind: "linear-image",
                parameters: [{ key: "user-request", label: request.userRequestLabel.trim(), type: "text", required: false, maxLength: 1200 }],
                steps,
                finalOutputCount: stepNodes.at(-1)?.metadata?.count || 1,
            },
        },
    };
}

export function prepareCreativeSkillDraftFromExamplePair(request: CreativeSkillExamplePairRequest): CreativeSkillExamplePairPreparationResult {
    const issues: string[] = [];
    const name = request.name.trim();
    const instruction = request.instruction.trim();
    if (!name || Array.from(name).length > 120) issues.push("创作 Skill 名称必须是 1 到 120 个字符");
    if (!instruction || Array.from(instruction).length > 20_000) issues.push("转换说明必须是 1 到 20000 个字符");
    if (!request.userRequestLabel.trim()) issues.push("创作要求参数名称不能为空");
    inspectExampleImage(request.input, "原图", issues);
    inspectExampleImage(request.output, "结果图", issues);
    if (request.input.sha256 === request.output.sha256) issues.push("原图与结果图不能是同一内容");
    if (issues.length) return { ok: false, issues: unique(issues) };
    return {
        ok: true,
        prepared: {
            input: {
                name,
                description: request.description?.trim() || "",
                source: "manual",
                definition: {
                    schemaVersion: 1,
                    kind: "linear-image",
                    parameters: [{ key: "user-request", label: request.userRequestLabel.trim(), type: "text", required: false, maxLength: 1200 }],
                    steps: [{
                        operation: "image.edit",
                        references: [{ type: "input-target" }],
                        prompt: [
                            { type: "literal", text: instruction },
                            { type: "literal", text: "\n\n" },
                            { type: "parameter", key: "user-request" },
                        ],
                    }],
                    finalOutputCount: 1,
                },
            },
            fixture: { input: structuredClone(request.input), expectedOutput: structuredClone(request.output) },
        },
    };
}

function imageReferenceIdentities(node: CanvasNodeData) {
    return new Set([
        node.metadata?.storageKey,
        node.metadata?.content,
        ...(node.metadata?.images?.flatMap((image) => [image.storageKey, image.content]) || []),
    ].filter((value): value is string => Boolean(value)));
}

function inspectExampleImage(image: CreativeSkillExampleImage, label: string, issues: string[]) {
    if (!/^[a-f0-9]{64}$/.test(image.sha256)) issues.push(`${label}缺少有效的 SHA-256`);
    if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(image.mimeType)) issues.push(`${label}格式不受支持`);
    if (!Number.isSafeInteger(image.bytes) || image.bytes < 1) issues.push(`${label}大小无效`);
}

function unique(values: string[]) {
    return [...new Set(values)];
}
