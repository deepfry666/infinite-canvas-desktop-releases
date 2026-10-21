import { useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { App, Button, Drawer, Dropdown, Empty, Input, Modal } from "antd";
import { Check, ChevronUp, CircleAlert, Cpu, FileText, Group, History, Image as ImageIcon, MoreHorizontal, Music2, PanelRightClose, Pencil, Play, Plus, RotateCcw, Settings2, Sparkles, Trash2, Video, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { nanoid } from "nanoid";
import { useShallow } from "zustand/react/shallow";

import i18n from "@/i18n";
import { canvasThemes } from "@/lib/canvas-theme";
import { deleteConversation, ensureConversation, normalizeConversationState, parseBuiltinAgentConversationStorage, renameConversation, replaceConversationMessages, startConversation, type BuiltinAgentConversationState } from "@/lib/agent/builtin-agent-conversations";
import { summarizeCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { getGenerationCount } from "@/lib/canvas/canvas-generation-helpers";
import { getGenerationResourceNodes } from "@/lib/canvas/canvas-resource-references";
import { isCreativeSkillChatSnapshotCurrent, prepareCreativeSkillChatExecution, type CreativeSkillChatDetail } from "@/lib/creative-skills";
import type { CreativeSkillRunRecord } from "@/lib/creative-skill-run-ledger";
import { getDataUrlByteSize } from "@/lib/image-utils";
import { localForageStorage } from "@/lib/localforage-storage";
import { startCreativeHistoryEvent } from "@/services/creative-activity";
import { requestImageQuestion, type AiTextMessage } from "@/services/api/image";
import { imageToDataUrl } from "@/services/image-storage";
import { modelOptionLabel, resolveModelForCapability, selectableModelsByCapability, useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { AGENT_CONFIRMATION_MODE_STORAGE_KEY, useAgentStore, type AgentChatItem, type AgentCreativeSkillExecution } from "@/stores/use-agent-store";
import { useCreativeSkillStore } from "@/stores/use-creative-skill-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata, type CanvasNodeTypeId } from "@/types/canvas";
import { AgentChatComposer } from "./agent-chat-composer";
import { AgentChatMessage, AgentPendingToolCard } from "./agent-chat-message";

const MAX_HISTORY_MESSAGES = 40;
const MAX_OPERATIONS = 16;
const MAX_CONTEXT_IMAGE_EDGE = 1600;
const MAX_CONTEXT_IMAGE_BYTES = 3 * 1024 * 1024;
const BUILTIN_AGENT_STORAGE_KEY = "infinite-canvas:builtin_agent_conversations";
const LEGACY_BUILTIN_AGENT_STORAGE_KEY = "canvas-builtin-agent-messages";

const BUILTIN_AGENT_PROMPT = `你是“四季画布”内置的画布对话助手，直接使用用户在应用设置中配置的文字模型，不需要 Codex、MCP、终端、文件系统或任何外部 Agent。

你的职责：
1. 用简洁中文回答画布创作、提示词、模型配置和工作流问题。
2. 当用户明确要求修改当前画布时，只能通过下面约定的 JSON 输出申请画布操作；不要执行任何文件、终端、网络或系统操作。
3. 不要声称已经修改画布；是否已执行，以界面随后显示的操作结果为准。
4. 如果当前画布信息不足，先说明缺少什么；不要猜测节点 ID。

意图编排规则：
1. 当前选区优先于全画布。普通问答、分析和建议不得输出画布操作。
2. 用户对选中图片给出“秋天、电影感”等短指令时，必须先理解已附带的真实图片，再把短指令补全为专业、明确、可直接用于图片编辑模型的完整提示词；回复中简要说明理解，并申请 run_generation。nodeId 必须是选中的图片节点 ID，mode 使用 image。该操作以原图为参考生成新子节点，不得覆盖原图。
3. 用户明确说“只润色提示词”“只优化提示词”或同义表达时，只返回润色后的提示词正文，不得输出 canvas_ops，不得触发 run_generation。
4. 用户要求“整理这些节点”或整理画布时使用 arrange_nodes。用户明确指定对象时传 ids；否则省略 ids，由画布按当前多选内容、没有多选时按全画布处理。
5. 用户说“清晰一点、放大、超分、4K”时使用 upscale_image，不得用 run_generation 重绘。
6. 用户说“扩图、做成横图/竖图、补全画面”时使用 outpaint_image；从语义推断 ratio，例如横图默认 16:9、竖图默认 9:16，并把用户要求补全为 prompt。
7. 用户说“三视图、正侧背”时使用 three_view_image；这是三张图片的批量生成操作。
8. 用户目标不清楚或当前选区不能唯一确定操作对象时，只问一个最关键的问题，不要猜测。
9. 每个 canvas_ops 代码块最多包含一个 run_generation、outpaint_image、upscale_image 或 three_view_image；不要把生成类动作与其他画布操作混在同一次申请中。

画布操作格式（必须放在单独的 \`canvas_ops\` 代码块中）：
{ "ops": [
  { "type": "add_node", "nodeType": "text|image|config|video|audio|group", "title": "标题", "x": 0, "y": 0, "metadata": { "content": "仅 text 类型可用的正文" } },
  { "type": "update_node", "id": "已有节点ID", "patch": { "title": "新标题", "metadata": { "content": "文本" } } },
  { "type": "delete_node", "ids": ["已有节点ID"] },
  { "type": "connect_nodes", "fromNodeId": "节点ID", "toNodeId": "节点ID" },
  { "type": "arrange_nodes", "ids": ["可选节点ID"] },
  { "type": "select_nodes", "ids": ["节点ID"] },
  { "type": "set_viewport", "viewport": { "x": 0, "y": 0, "k": 1 } },
  { "type": "outpaint_image", "nodeId": "选中图片节点ID", "ratio": "16:9", "prompt": "补全后的扩图要求" },
  { "type": "upscale_image", "nodeId": "选中图片节点ID", "targetLongEdge": 4096 },
  { "type": "three_view_image", "nodeId": "选中图片节点ID" },
  { "type": "run_generation", "nodeId": "已有图片/文本/配置节点ID", "mode": "image|text|video|audio", "prompt": "补全后的完整提示词" }
] }
不要输出不在上述范围内的操作。删除、批量修改和触发生成也必须先申请；界面会按用户选择的手动确认或自动确认模式处理申请。`;

type BuiltinOpsReference = { nodeId: string; title: string; url: string };
type BuiltinOpsDetail = { kind: "builtin-canvas"; status: "pending" | "completed" | "rejected" | "error"; ops: CanvasAgentOp[]; rows: Array<{ label: string; value: string }>; references?: BuiltinOpsReference[]; output?: string };
type PendingBuiltinOps = { id: string; projectId?: string; intent: "canvas_change"; sourcePrompt: string; sourceCanvas: CanvasAgentSnapshot; ops: CanvasAgentOp[]; detail: BuiltinOpsDetail };
type PendingCreativeSkill = { id: string; projectId: string; name: string; sourceCanvas: CanvasAgentSnapshot; execution: AgentCreativeSkillExecution; detail: CreativeSkillChatDetail };
type BlockedCreativeSkill = { name: string; projectId: string; run: CreativeSkillRunRecord };

function readStoredMessages(): AgentChatItem[] {
    if (typeof window === "undefined") return [];
    try {
        const value = JSON.parse(localStorage.getItem(LEGACY_BUILTIN_AGENT_STORAGE_KEY) || "[]");
        if (!Array.isArray(value)) return [];
        return value.filter((item): item is AgentChatItem => Boolean(item && typeof item === "object" && typeof item.id === "string" && ["user", "assistant", "tool", "error"].includes(item.role) && typeof item.text === "string")).slice(-MAX_HISTORY_MESSAGES).map((item) => ({ ...item, streamId: undefined }));
    } catch {
        return [];
    }
}

function runtimeText(key: string, options?: Record<string, unknown>) {
    return i18n.t(`agent.builtin.${key}`, options);
}

function detailText(key: string, options?: Record<string, unknown>) {
    return i18n.t(`agent.builtinDetail.${key}`, options);
}

function snapshotForPrompt(snapshot: CanvasAgentSnapshot | null) {
    if (!snapshot) return "当前没有打开的画布。只能进行普通对话，不能申请画布操作。";
    return JSON.stringify({
        projectId: snapshot.projectId,
        title: snapshot.title,
        selectedNodeIds: snapshot.selectedNodeIds,
        nodes: snapshot.nodes.map((node) => ({
            id: node.id,
            type: node.type,
            title: node.title,
            position: node.position,
            width: node.width,
            height: node.height,
            metadata: node.metadata ? {
                content: node.type === CanvasNodeType.Text ? node.metadata.content?.slice(0, 2000) : node.metadata.content ? "[媒体节点；仅当前消息实际附带的图片块可见]" : undefined,
                composerContent: node.metadata.composerContent?.slice(0, 2000),
                prompt: node.metadata.prompt?.slice(0, 2000),
                generationMode: node.metadata.generationMode,
                status: node.metadata.status,
                model: node.metadata.model,
            } : undefined,
        })),
        connections: snapshot.connections,
    }, null, 2);
}

type SelectedContextImage = { nodeId: string; title: string; url: string };

function toProviderMessages(messages: AgentChatItem[], selectedImages: SelectedContextImage[] = []): AiTextMessage[] {
    const providerMessages: AiTextMessage[] = messages
        .filter((item) => item.role === "user" || item.role === "assistant")
        .map((item) => ({ role: item.role as "user" | "assistant", content: item.text }));
    if (!selectedImages.length) return providerMessages;
    const lastUserIndex = providerMessages.findLastIndex((item) => item.role === "user");
    if (lastUserIndex < 0) return providerMessages;
    const userMessage = providerMessages[lastUserIndex];
    providerMessages[lastUserIndex] = {
        role: "user",
        content: [
            { type: "text", text: typeof userMessage.content === "string" ? userMessage.content : "" },
            ...selectedImages.flatMap((image, index) => [
                { type: "text" as const, text: `选中图片 ${index + 1}：${image.title}（节点 ID：${image.nodeId}）` },
                { type: "image_url" as const, image_url: { url: image.url } },
            ]),
        ],
    };
    return providerMessages;
}

function selectedSnapshotNodes(snapshot: CanvasAgentSnapshot | null) {
    if (!snapshot?.selectedNodeIds.length) return [];
    const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
    return snapshot.selectedNodeIds.map((id) => nodeById.get(id)).filter((node): node is CanvasNodeData => Boolean(node));
}

function selectedImageSources(snapshot: CanvasAgentSnapshot | null) {
    return selectedSnapshotNodes(snapshot)
        .filter((node) => node.type === CanvasNodeType.Image && typeof node.metadata?.content === "string" && Boolean(node.metadata.content.trim()))
        .slice(0, 4)
        .map((node) => ({ nodeId: node.id, title: node.title || runtimeText("untitledNode"), url: node.metadata!.content!, storageKey: node.metadata?.storageKey }));
}

function sameCanvasVersion(current: CanvasAgentSnapshot | null, expected: CanvasAgentSnapshot, compareViewport = false) {
    return Boolean(current
        && current.projectId === expected.projectId
        && current.nodes === expected.nodes
        && current.connections === expected.connections
        && (!compareViewport
            || (current.viewport.x === expected.viewport.x
                && current.viewport.y === expected.viewport.y
                && current.viewport.k === expected.viewport.k))
        && current.selectedNodeIds.length === expected.selectedNodeIds.length
        && current.selectedNodeIds.every((id, index) => id === expected.selectedNodeIds[index]));
}

function changesViewport(ops: CanvasAgentOp[]) {
    return ops.some((op) => op.type === "set_viewport");
}

async function prepareContextImage(dataUrl: string) {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const next = new Image();
        next.onload = () => resolve(next);
        next.onerror = () => reject(new Error(runtimeText("imageReadFailed")));
        next.src = dataUrl;
    });
    const longestEdge = Math.max(image.naturalWidth, image.naturalHeight);
    if (longestEdge <= MAX_CONTEXT_IMAGE_EDGE && getDataUrlByteSize(dataUrl) <= MAX_CONTEXT_IMAGE_BYTES) return dataUrl;
    const scale = Math.min(1, MAX_CONTEXT_IMAGE_EDGE / Math.max(1, longestEdge));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return dataUrl;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.86);
}

function pendingOpsDetail(ops: CanvasAgentOp[], snapshot: CanvasAgentSnapshot, config: Pick<AiConfig, "canvasImageCount" | "count" | "size">, understanding: string): BuiltinOpsDetail {
    const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
    const targetIds = new Set<string>();
    const prompts: string[] = [];
    const ratios = new Set<string>();
    let outputCount = 0;
    let modelCalls = 0;

    ops.forEach((op) => {
        if ("nodeId" in op) targetIds.add(op.nodeId);
        if ("id" in op && typeof op.id === "string") targetIds.add(op.id);
        if ("ids" in op && Array.isArray(op.ids)) op.ids.forEach((id) => targetIds.add(id));
        if (op.type === "connect_nodes") {
            targetIds.add(op.fromNodeId);
            targetIds.add(op.toNodeId);
        }
        if (op.type === "run_generation") {
            const target = nodeById.get(op.nodeId);
            const mode = target?.type === CanvasNodeType.Image
                ? "image"
                : target?.type === CanvasNodeType.Video
                  ? "video"
                  : target?.type === CanvasNodeType.Audio
                    ? "audio"
                    : op.mode || target?.metadata?.generationMode || "image";
            const prompt = op.prompt?.trim() || target?.metadata?.composerContent?.trim() || target?.metadata?.prompt?.trim();
            if (prompt) prompts.push(prompt);
            const count = mode === "image" ? getGenerationCount(String(target?.metadata?.count || config.canvasImageCount || config.count)) : 1;
            if (mode === "image") ratios.add(target?.metadata?.size || config.size || "1:1");
            outputCount += count;
            modelCalls += count;
        }
        if (op.type === "outpaint_image") {
            const ratio = op.ratio || "16:9";
            const instruction = op.prompt?.trim() || i18n.t("canvas.projectPage.outpaintDefaultInstruction");
            ratios.add(ratio);
            prompts.push(i18n.t("canvas.projectPage.outpaintPrompt", { ratio, instruction }));
            outputCount += 1;
            modelCalls += 1;
        }
        if (op.type === "upscale_image") {
            ratios.add(nodeById.get(op.nodeId)?.metadata?.size || detailText("unchangedValue"));
            outputCount += 1;
        }
        if (op.type === "three_view_image") {
            ratios.add(nodeById.get(op.nodeId)?.metadata?.size || "1:1");
            prompts.push(i18n.t("canvas.projectPage.threeView.frontPrompt"), i18n.t("canvas.projectPage.threeView.sidePrompt"), i18n.t("canvas.projectPage.threeView.backPrompt"));
            outputCount += 3;
            modelCalls += 3;
        }
    });

    const targetNames = Array.from(targetIds).map((id) => nodeById.get(id)?.title || id);
    const referenceIds = new Set([...snapshot.selectedNodeIds, ...targetIds]);
    targetIds.forEach((id) => getGenerationResourceNodes(id, snapshot.nodes, snapshot.connections).forEach((node) => referenceIds.add(node.id)));
    const references = snapshot.nodes.flatMap((node) => referenceIds.has(node.id) && node.type === CanvasNodeType.Image && node.metadata?.content
        ? [{ nodeId: node.id, title: node.title || runtimeText("untitledNode"), url: node.metadata.content }]
        : []).slice(0, 4);
    const separator = i18n.language.startsWith("zh") ? "、" : ", ";
    const rows = [
        { label: detailText("understandingLabel"), value: understanding.trim() || runtimeText("operationProposed") },
        { label: detailText("referenceLabel"), value: references.length ? references.map((item) => item.title).join(separator) : detailText("noReferenceImages") },
        { label: runtimeText("targetLabel"), value: targetNames.length ? targetNames.join(separator) : detailText("currentCanvas") },
        { label: runtimeText("operationLabel"), value: summarizeCanvasAgentOps(ops) || runtimeText("canvasChange") },
    ];
    if (prompts.length) prompts.forEach((value, index) => rows.push({ label: prompts.length > 1 ? runtimeText("promptIndexLabel", { index: index + 1 }) : runtimeText("promptLabel"), value }));
    else rows.push({ label: runtimeText("promptLabel"), value: detailText("notApplicable") });
    rows.push({ label: runtimeText("ratioLabel"), value: ratios.size ? Array.from(ratios).join(separator) : detailText("unchangedValue") });
    rows.push({ label: runtimeText("outputCountLabel"), value: runtimeText("outputCountValue", { count: outputCount }) });
    rows.push({ label: runtimeText("modelCallsLabel"), value: runtimeText("modelCallsValue", { count: modelCalls }) });
    return { kind: "builtin-canvas", status: "pending", ops, rows, references };
}

function finiteNumber(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringId(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim().slice(0, 300) : null;
}

function normalizeNodePatch(value: unknown): Partial<CanvasNodeData> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const raw = value as Record<string, unknown>;
    const patch: Partial<CanvasNodeData> = {};
    if (typeof raw.title === "string") patch.title = raw.title.trim().slice(0, 300);
    const position = raw.position;
    if (position && typeof position === "object" && !Array.isArray(position)) {
        const item = position as Record<string, unknown>;
        const x = finiteNumber(item.x);
        const y = finiteNumber(item.y);
        if (x !== null && y !== null) patch.position = { x, y };
    }
    const width = finiteNumber(raw.width);
    const height = finiteNumber(raw.height);
    if (width !== null && width > 20 && width < 5000) patch.width = width;
    if (height !== null && height > 20 && height < 5000) patch.height = height;
    if (raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata)) {
        const input = raw.metadata as Record<string, unknown>;
        const metadata: CanvasNodeMetadata = {};
        const stringFields = ["content", "composerContent", "prompt", "model", "size", "quality", "background", "seconds", "vquality", "generateAudio", "watermark", "audioVoice", "audioFormat", "audioSpeed", "audioInstructions"] as const;
        stringFields.forEach((key) => {
            const item = input[key];
            if (typeof item === "string") metadata[key] = item.slice(0, 8000);
        });
        if (input.generationMode === "text" || input.generationMode === "image" || input.generationMode === "video" || input.generationMode === "audio") metadata.generationMode = input.generationMode;
        if (input.reasoningEffort === "auto" || input.reasoningEffort === "low" || input.reasoningEffort === "medium" || input.reasoningEffort === "high" || input.reasoningEffort === "xhigh") metadata.reasoningEffort = input.reasoningEffort;
        const count = finiteNumber(input.count);
        if (count !== null) metadata.count = Math.min(16, Math.max(1, Math.round(count)));
        if (Object.keys(metadata).length) patch.metadata = metadata;
    }
    return Object.keys(patch).length ? patch : null;
}

function normalizeOps(value: unknown): CanvasAgentOp[] {
    if (!Array.isArray(value)) return [];
    const result: CanvasAgentOp[] = [];
    for (const raw of value.slice(0, MAX_OPERATIONS)) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
        const item = raw as Record<string, unknown>;
        const type = item.type;
        if (type === "add_node") {
            const nodeType = stringId(item.nodeType);
            const title = stringId(item.title);
            const x = finiteNumber(item.x);
            const y = finiteNumber(item.y);
            const safeNodeType = nodeType && Object.values(CanvasNodeType).includes(nodeType as CanvasNodeType) ? nodeType : null;
            const rawMetadata = item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata) ? item.metadata as Record<string, unknown> : null;
            const content = typeof rawMetadata?.content === "string" ? rawMetadata.content.slice(0, 8000) : null;
            const metadata = content !== null && (!safeNodeType || safeNodeType === CanvasNodeType.Text) ? { content } : null;
            result.push({ type, ...(safeNodeType ? { nodeType: safeNodeType as CanvasNodeTypeId } : {}), ...(title ? { title } : {}), ...(x !== null && y !== null ? { position: { x, y } } : {}), ...(metadata ? { metadata } : {}) });
            continue;
        }
        if (type === "update_node") {
            const id = stringId(item.id);
            const patch = normalizeNodePatch(item.patch);
            if (!id || !patch) continue;
            result.push({ type, id, patch });
            continue;
        }
        if (type === "delete_node") {
            const ids = Array.isArray(item.ids) ? item.ids.map(stringId).filter((id): id is string => Boolean(id)).slice(0, 24) : [];
            const id = stringId(item.id);
            if (!ids.length && !id) continue;
            result.push({ type, ...(ids.length ? { ids } : { id: id! }) });
            continue;
        }
        if (type === "delete_connections") {
            const ids = Array.isArray(item.ids) ? item.ids.map(stringId).filter((id): id is string => Boolean(id)).slice(0, 24) : [];
            const id = stringId(item.id);
            const all = item.all === true;
            if (!ids.length && !id && !all) continue;
            result.push({ type, ...(ids.length ? { ids } : id ? { id } : { all: true }) });
            continue;
        }
        if (type === "connect_nodes") {
            const fromNodeId = stringId(item.fromNodeId);
            const toNodeId = stringId(item.toNodeId);
            if (fromNodeId && toNodeId) result.push({ type, fromNodeId, toNodeId });
            continue;
        }
        if (type === "arrange_nodes") {
            const ids = Array.isArray(item.ids) ? item.ids.map(stringId).filter((id): id is string => Boolean(id)).slice(0, 100) : [];
            result.push(ids.length ? { type, ids } : { type });
            continue;
        }
        if (type === "select_nodes") {
            const ids = Array.isArray(item.ids) ? item.ids.map(stringId).filter((id): id is string => Boolean(id)).slice(0, 50) : [];
            result.push({ type, ids });
            continue;
        }
        if (type === "set_viewport") {
            const viewport = item.viewport;
            if (!viewport || typeof viewport !== "object" || Array.isArray(viewport)) continue;
            const value = viewport as Record<string, unknown>;
            const x = finiteNumber(value.x);
            const y = finiteNumber(value.y);
            const k = finiteNumber(value.k);
            if (x !== null && y !== null && k !== null && k > 0.05 && k < 20) result.push({ type, viewport: { x, y, k } });
            continue;
        }
        if (type === "outpaint_image") {
            const nodeId = stringId(item.nodeId);
            const ratio = typeof item.ratio === "string" && /^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(item.ratio.trim()) ? item.ratio.trim().slice(0, 24) : undefined;
            const prompt = typeof item.prompt === "string" ? item.prompt.trim().slice(0, 8000) : undefined;
            if (nodeId) result.push({ type, nodeId, ...(ratio ? { ratio } : {}), ...(prompt ? { prompt } : {}) });
            continue;
        }
        if (type === "upscale_image") {
            const nodeId = stringId(item.nodeId);
            const targetLongEdge = finiteNumber(item.targetLongEdge);
            if (nodeId) result.push({ type, nodeId, ...(targetLongEdge !== null ? { targetLongEdge: Math.min(4096, Math.max(1024, Math.round(targetLongEdge))) } : {}) });
            continue;
        }
        if (type === "three_view_image") {
            const nodeId = stringId(item.nodeId);
            if (nodeId) result.push({ type, nodeId });
            continue;
        }
        if (type === "run_generation") {
            const nodeId = stringId(item.nodeId);
            const mode = item.mode === "text" || item.mode === "image" || item.mode === "video" || item.mode === "audio" ? item.mode : undefined;
            if (nodeId) result.push({ type, nodeId, ...(mode ? { mode } : {}), ...(typeof item.prompt === "string" ? { prompt: item.prompt.slice(0, 8000) } : {}) });
        }
    }
    return result;
}

function parseOperations(text: string) {
    const match = text.match(/```(?:canvas_ops|canvas-ops|json)\s*([\s\S]*?)```/i);
    if (!match) return { text: text.trim(), ops: [] as CanvasAgentOp[] };
    try {
        const parsed = JSON.parse(match[1]) as { ops?: unknown } | unknown[];
        const ops = normalizeOps(Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? parsed.ops : undefined);
        const hasOpsField = Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.prototype.hasOwnProperty.call(parsed, "ops"));
        return { text: ops.length || hasOpsField ? text.replace(match[0], "").trim() : text.trim(), ops };
    } catch {
        return { text: text.trim(), ops: [] as CanvasAgentOp[] };
    }
}

function requestsPromptOnly(text: string) {
    const compact = text.toLowerCase().replace(/\s+/g, "");
    const promptAction = /润色|优化|完善|扩写|改写|重写|polish|refine|improve|rewrite/.test(compact);
    const textRewriteAction = /润色|扩写|改写|重写|polish|rewrite/.test(compact);
    const promptMention = /提示词|prompt/.test(compact);
    const imageMention = /这?张图|图片|图像|照片|画布|image|photo/.test(compact);
    const limitingIntent = /只|仅|不要|不用|无需|别|不执行|only|just|donot|don't/.test(compact);
    const negativeActionPattern = /(?:不(?:要|用|需(?:要)?)?|别)(?:生成(?:图片|图像|内容)?|改(?:图|图片|画布)|修改(?:图片|画布)|执行(?:修改|操作)?|应用(?:到|在)?(?:这?张图|图片|画布)|(?:加入|放到|写入|添加到)(?:当前)?画布|(?:创建|添加|新建|生成).{0,16}(?:节点|node))|do(?:not|n't)(?:generate|edit(?:the)?image|apply(?:it|this|that)?to(?:the)?image|add(?:it|this|that)?to(?:the)?canvas|put(?:it|this|that)?(?:on|into)(?:the)?canvas|create(?:a)?node)|without(?:generating|editing|adding(?:it|this|that)?to(?:the)?canvas|creating(?:a)?node)/g;
    const promptOutputPattern = /(?:只|仅)(?:(?:给|要|需要|想要|输出|返回|提供)我?)?(?:生成|写|产出)?(?:一个|一条|一份|多(?:张|幅)?|几(?:张|幅)?|若干(?:张|幅)?|[一二三四五六七八九十\d]+(?:张|幅))?(?:完整)?(?:的)?(?:图片|图像|照片|图)?(?:的)?(?:提示词|prompt)|only(?:(?:give|return|output|provide)(?:me)?)?(?:generate|write)?(?:an?|the|one|multiple|several)?(?:complete|full)?(?:image)?prompt/g;
    const directPromptRequestPattern = /(?:(?:给我|(?:给|替|为)(?:这|那)?(?:一)?张?(?:图|图片|照片))(?:写|生成|产出|输出|返回|提供|做)?|(?:请|帮我|麻烦)?(?:给|替|为)?我?(?:写|生成|产出|输出|返回|提供|做))(?:一个|一条|一段|一份|多(?:张|幅)?|几(?:张|幅)?|若干(?:张|幅)?|[一二三四五六七八九十\d]+(?:张|幅))?[^,。，！？.!?]{0,24}(?:提示词|prompt)|(?:please)?(?:write|give|return|output|provide|create|generate)(?:me)?[^,.!?]{0,48}(?:image)?prompt/g;
    const promptSubjectPattern = /(?:用于|用来|拿来|为了)?生成(?:[一二三四五六七八九十\d]+(?:张|幅))?(?:图片|图像|照片|图|内容)(?:的)?(?:完整)?(?:提示词|prompt)|(?:图片|图像|照片|生图)(?:生成)?(?:的)?(?:完整)?(?:提示词|prompt)/g;
    const noCanvasAction = compact.search(negativeActionPattern) >= 0;
    const directPromptOutput = compact.search(promptOutputPattern) >= 0;
    const directPromptRequest = compact.search(directPromptRequestPattern) >= 0;
    const promptSubjectMention = compact.search(promptSubjectPattern) >= 0;
    const remaining = compact.replace(negativeActionPattern, "").replace(promptOutputPattern, "").replace(directPromptRequestPattern, "").replace(promptSubjectPattern, "");
    const requestsCanvasAction = /生成(?:图片|图像|内容)?|改(?:图|图片|画布)|修改(?:图片|画布)|执行(?:修改|操作)?|应用(?:到|在)?(?:这?张图|图片|画布)|(?:加入|放到|写入|添加到)(?:当前)?画布|generate|edit(?:the)?image|apply(?:it|this|that)?to(?:the)?image|applychanges|(?:add(?:it|this|that)?to|put(?:it|this|that)?(?:on|into)|write(?:it|this|that)?to)(?:the)?canvas/.test(remaining)
        || /(?:创建|添加|新建|生成).{0,16}(?:节点|node)|(?:create|add).{0,32}node/.test(compact);
    if (requestsCanvasAction) return false;
    return (noCanvasAction && (promptAction || promptMention)) || directPromptOutput || directPromptRequest || (promptSubjectMention && limitingIntent) || /(?:提示词|prompt)(?:就好|就行|即可|就够了)/.test(compact) || (promptAction && promptMention) || (textRewriteAction && (limitingIntent || /其他不变|其余不变|就好|就行|即可/.test(compact)) && !imageMention);
}

function isGenerationAction(op: CanvasAgentOp) {
    return op.type === "run_generation" || op.type === "outpaint_image" || op.type === "upscale_image" || op.type === "three_view_image";
}

function CreativeSkillBlockedCard({ blocked, busy, theme, onResume, onDismiss }: {
    blocked: BlockedCreativeSkill;
    busy: boolean;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onResume: () => void;
    onDismiss: () => void;
}) {
    const { t } = useTranslation();
    const unknown = [...blocked.run.attempts].reverse().find((attempt) => attempt.state === "submission-unknown");
    return (
        <section className="rounded-lg border px-3 py-3" style={{ borderColor: theme.node.stroke, background: theme.toolbar.panel }} aria-label={t("creativeSkills.chat.needsAttention")}>
            <div className="flex items-start gap-2.5">
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{t("creativeSkills.chat.needsAttention")}</div>
                    <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                        {t(blocked.run.block?.possibleCharge ? "creativeSkills.chat.possibleCharge" : "creativeSkills.chat.blocked")}
                    </div>
                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                        <Button size="small" type="text" danger icon={<XCircle className="size-3.5" />} disabled={busy} onClick={onDismiss}>{t("creativeSkills.chat.dismiss")}</Button>
                        {unknown?.taskId ? <Button size="small" type="text" icon={<Play className="size-3.5" />} loading={busy} onClick={onResume}>{t("creativeSkills.chat.resume")}</Button> : null}
                    </div>
                </div>
            </div>
        </section>
    );
}

export function BuiltinAgentPanel({ embedded }: { embedded?: boolean }) {
    const { t } = useTranslation();
    const { message, modal } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const closePanel = useAgentStore((state) => state.closePanel);
    const confirmTools = useAgentStore((state) => state.confirmTools);
    const setAgentState = useAgentStore((state) => state.setAgentState);
    const recoveredSkillRuns = useAgentStore((state) => state.creativeSkillAttention);
    const canUndoCanvasOps = useAgentStore((state) => Boolean(state.canvasContext?.canUndo));
    const canvasVersion = useAgentStore(useShallow((state) => {
        const snapshot = state.canvasContext?.snapshot;
        return {
            projectId: snapshot?.projectId || "",
            nodes: snapshot?.nodes || null,
            connections: snapshot?.connections || null,
            selection: snapshot?.selectedNodeIds.join("\0") || "",
            viewport: snapshot?.viewport || null,
        };
    }));
    const selectedNodes = useAgentStore(useShallow((state) => selectedSnapshotNodes(state.canvasContext?.snapshot || null)));
    const creativeSkillItems = useCreativeSkillStore((state) => state.items);
    const loadCreativeSkills = useCreativeSkillStore((state) => state.load);
    const [conversationState, setConversationState] = useState<BuiltinAgentConversationState>(() => normalizeConversationState(null, nanoid));
    const [conversationsLoaded, setConversationsLoaded] = useState(false);
    const [conversationStorageWritable, setConversationStorageWritable] = useState(false);
    const [prompt, setPrompt] = useState("");
    const [runningIds, setRunningIds] = useState<Set<string>>(() => new Set());
    const [applyingIds, setApplyingIds] = useState<Set<string>>(() => new Set());
    const [pendingOpsByConversation, setPendingOpsByConversation] = useState<Record<string, PendingBuiltinOps>>({});
    const [pendingSkillsByConversation, setPendingSkillsByConversation] = useState<Record<string, PendingCreativeSkill>>({});
    const [blockedSkillsByConversation, setBlockedSkillsByConversation] = useState<Record<string, BlockedCreativeSkill>>({});
    const [activeSkillCommands, setActiveSkillCommands] = useState<Record<string, string>>({});
    const [selectedCreativeSkillId, setSelectedCreativeSkillId] = useState("");
    const [lastUndoByConversation, setLastUndoByConversation] = useState<Record<string, string>>({});
    const [historyOpen, setHistoryOpen] = useState(false);
    const [renameTarget, setRenameTarget] = useState("");
    const [renameDraft, setRenameDraft] = useState("");
    const listRef = useRef<HTMLDivElement>(null);
    const controllersRef = useRef(new Map<string, AbortController>());
    const legacyMigrationPendingRef = useRef(false);
    const applyingRef = useRef(false);
    const textModel = resolveModelForCapability(config, config.textModel || config.model, "text");
    const textModels = useMemo(() => selectableModelsByCapability(config, "text"), [config]);
    const ready = isAiConfigReady(config, textModel);
    const modelLabel = modelOptionLabel(config, textModel);
    const activeConversation = useMemo(() => conversationState.conversations.find((item) => item.id === conversationState.activeId), [conversationState]);
    const historyTasks = useMemo(() => [...conversationState.conversations].sort((left, right) => right.updatedAt - left.updatedAt), [conversationState.conversations]);
    const messages = activeConversation?.messages || [];
    const activeId = conversationState.activeId;
    const sending = Boolean(activeId && runningIds.has(activeId));
    const applying = applyingIds.size > 0;
    const pendingOps = activeId ? pendingOpsByConversation[activeId] || null : null;
    const pendingSkill = activeId ? pendingSkillsByConversation[activeId] || null : null;
    const conversationBlockedSkill = activeId ? blockedSkillsByConversation[activeId] || null : null;
    const recoveredRun = recoveredSkillRuns[0];
    const blockedSkill = conversationBlockedSkill || (recoveredRun ? { name: recoveredRun.skill.nameSnapshot, projectId: recoveredRun.origin.projectId, run: recoveredRun } : null);
    const skillRunning = Boolean(activeId && activeSkillCommands[activeId]);
    const runnableSkills = useMemo(() => creativeSkillItems.filter((item) => item.lifecycle === "published"
        && item.enabled
        && item.version
        && item.source !== "skill-markdown"
        && item.trust !== "markdown-quarantined"), [creativeSkillItems]);
    const lastUndoId = activeId ? lastUndoByConversation[activeId] || "" : "";

    const setConversationMessages = (conversationId: string, update: SetStateAction<AgentChatItem[]>) => {
        setConversationState((current) => {
            const active = current.conversations.find((item) => item.id === conversationId);
            const currentMessages = active?.messages || [];
            const nextMessages = typeof update === "function" ? update(currentMessages) : update;
            const state = active ? current : ensureConversation(current, conversationId);
            return replaceConversationMessages(state, conversationId, nextMessages.slice(-MAX_HISTORY_MESSAGES));
        });
    };

    useEffect(() => {
        const list = listRef.current;
        if (list) list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
    }, [activeId, messages, pendingOps, pendingSkill, sending]);
    useEffect(() => {
        void loadCreativeSkills().catch(() => undefined);
    }, [loadCreativeSkills]);
    useEffect(() => {
        if (selectedCreativeSkillId && !runnableSkills.some((item) => item.skillId === selectedCreativeSkillId)) setSelectedCreativeSkillId("");
    }, [runnableSkills, selectedCreativeSkillId]);
    useEffect(() => {
        let active = true;
        void Promise.resolve(localForageStorage.getItem(BUILTIN_AGENT_STORAGE_KEY)).then((stored) => {
            if (!active) return;
            const loaded = parseBuiltinAgentConversationStorage(stored, nanoid);
            let next = loaded.state;
            const legacyMessages = stored === null ? readStoredMessages() : [];
            if (legacyMessages.length) {
                const conversationId = nanoid();
                next = replaceConversationMessages(ensureConversation(next, conversationId), conversationId, legacyMessages);
                legacyMigrationPendingRef.current = true;
            }
            setConversationState(next);
            setConversationStorageWritable(loaded.canPersist);
            setConversationsLoaded(true);
            if (!loaded.canPersist) message.warning(runtimeText("historyStorageUnavailable"));
        }).catch(() => {
            if (!active) return;
            setConversationStorageWritable(false);
            setConversationsLoaded(true);
            message.warning(runtimeText("historyStorageUnavailable"));
        });
        return () => { active = false; };
    }, [message]);
    useEffect(() => {
        if (!conversationsLoaded || !conversationStorageWritable) return;
        const serializable = {
            ...conversationState,
            conversations: conversationState.conversations.filter((conversation) => conversation.messages.length).map((conversation) => ({
                ...conversation,
                messages: conversation.messages.map(({ streamId, ...item }) => item),
            })),
        };
        void Promise.resolve(localForageStorage.setItem(BUILTIN_AGENT_STORAGE_KEY, JSON.stringify(serializable))).then(() => {
            if (!legacyMigrationPendingRef.current) return;
            localStorage.removeItem(LEGACY_BUILTIN_AGENT_STORAGE_KEY);
            legacyMigrationPendingRef.current = false;
        }).catch(() => {
            setConversationStorageWritable(false);
            message.warning(runtimeText("historyStorageUnavailable"));
        });
    }, [conversationState, conversationStorageWritable, conversationsLoaded, message]);
    useEffect(() => {
        const currentCanvas = useAgentStore.getState().canvasContext?.snapshot || null;
        if (!activeId || !pendingOps || applying || applyingRef.current || sameCanvasVersion(currentCanvas, pendingOps.sourceCanvas, changesViewport(pendingOps.ops))) return;
        setPendingOpsByConversation((current) => {
            if (current[activeId]?.id !== pendingOps.id) return current;
            const { [activeId]: _removed, ...remaining } = current;
            return remaining;
        });
        message.info(i18n.t("agent.proposalStale"));
    }, [activeId, applying, canvasVersion, message, pendingOps]);
    useEffect(() => {
        const currentCanvas = useAgentStore.getState().canvasContext?.snapshot || null;
        if (!activeId || !pendingSkill || applying || applyingRef.current || isCreativeSkillChatSnapshotCurrent(currentCanvas, pendingSkill.sourceCanvas)) return;
        setPendingSkillsByConversation((current) => {
            if (current[activeId]?.id !== pendingSkill.id) return current;
            const { [activeId]: _removed, ...remaining } = current;
            return remaining;
        });
        message.info(i18n.t("agent.proposalStale"));
    }, [activeId, applying, canvasVersion, message, pendingSkill]);

    const createNewConversation = () => {
        setConversationState(startConversation);
        setPrompt("");
        setSelectedCreativeSkillId("");
        setHistoryOpen(false);
    };
    const switchConversation = (id: string) => {
        if (id === conversationState.activeId) return setHistoryOpen(false);
        setConversationState((current) => ({ ...current, activeId: id }));
        setPrompt("");
        setSelectedCreativeSkillId("");
        setHistoryOpen(false);
    };
    const removeConversation = (id: string) => {
        if (runningIds.has(id) || applyingIds.has(id)) return message.warning(runtimeText("stopBeforeDelete"));
        modal.confirm({
            title: runtimeText("deleteConversation"),
            content: runtimeText("deleteConversationConfirm"),
            okText: t("common.delete"),
            cancelText: t("common.cancel"),
            okButtonProps: { danger: true },
            onOk: () => {
                setConversationState((current) => deleteConversation(current, id));
                setPendingOpsByConversation((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)));
                setPendingSkillsByConversation((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)));
                setBlockedSkillsByConversation((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)));
                setLastUndoByConversation((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)));
                if (id === activeId) setPrompt("");
            },
        });
    };
    const openRename = (id: string) => {
        const task = conversationState.conversations.find((item) => item.id === id);
        if (!task) return;
        setRenameTarget(id);
        setRenameDraft(task.title || runtimeText("untitledTask"));
    };
    const confirmRename = () => {
        setConversationState((current) => renameConversation(current, renameTarget, renameDraft));
        setRenameTarget("");
    };

    const updateMessage = (conversationId: string, id: string, patch: Partial<AgentChatItem>) => {
        setConversationMessages(conversationId, (current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
    };

    const changeConfirmationMode = (nextConfirmTools: boolean) => {
        localStorage.setItem(AGENT_CONFIRMATION_MODE_STORAGE_KEY, nextConfirmTools ? "manual" : "automatic");
        setAgentState({ confirmTools: nextConfirmTools });
    };

    const executeOperation = async (operation: PendingBuiltinOps, conversationId: string) => {
        if (operation.intent !== "canvas_change") return;
        if (applyingRef.current) {
            const detail = runtimeText("operationDeferred");
            const toolMessage: AgentChatItem = { id: nanoid(), role: "tool", title: runtimeText("title"), text: detail, detail: { ...operation.detail, references: undefined, status: "error", output: detail } };
            setConversationMessages(conversationId, (current) => [...current, toolMessage].slice(-MAX_HISTORY_MESSAGES));
            message.warning(detail);
            return "deferred" as const;
        }
        const discardOperation = () => setPendingOpsByConversation((current) => {
            if (current[conversationId]?.id !== operation.id) return current;
            const { [conversationId]: _removed, ...remaining } = current;
            return remaining;
        });
        if (requestsPromptOnly(operation.sourcePrompt)) {
            discardOperation();
            message.info(runtimeText("rejected"));
            return;
        }
        const context = useAgentStore.getState().canvasContext;
        if (!context) {
            message.error(runtimeText("canvasRequired"));
            return;
        }
        if (operation.projectId && context.snapshot.projectId !== operation.projectId) {
            discardOperation();
            message.error(runtimeText("canvasChanged"));
            return;
        }
        if (!sameCanvasVersion(context.snapshot, operation.sourceCanvas, changesViewport(operation.ops))) {
            discardOperation();
            message.error(i18n.t("agent.proposalStale"));
            return;
        }
        applyingRef.current = true;
        setApplyingIds((current) => new Set(current).add(conversationId));
        setLastUndoByConversation({});
        try {
            if (context.applyOpsAsync) await context.applyOpsAsync(operation.ops);
            else context.applyOps(operation.ops);
            const toolMessage: AgentChatItem = { id: nanoid(), role: "tool", title: runtimeText("title"), text: runtimeText("applied", { summary: summarizeCanvasAgentOps(operation.ops) }), detail: { ...operation.detail, references: undefined, status: "completed" } };
            setConversationMessages(conversationId, (current) => [...current, toolMessage].slice(-MAX_HISTORY_MESSAGES));
            setLastUndoByConversation(operation.ops.some(isGenerationAction) ? {} : { [conversationId]: operation.id });
        } catch (error) {
            const detail = error instanceof Error ? error.message : runtimeText("operationFailed");
            const toolMessage: AgentChatItem = { id: nanoid(), role: "tool", title: runtimeText("title"), text: runtimeText("operationFailed"), detail: { ...operation.detail, references: undefined, status: "error", output: detail } };
            setConversationMessages(conversationId, (current) => [...current, toolMessage].slice(-MAX_HISTORY_MESSAGES));
            message.error(detail);
        } finally {
            applyingRef.current = false;
            discardOperation();
            setApplyingIds((current) => {
                const next = new Set(current);
                next.delete(conversationId);
                return next;
            });
        }
    };

    const executeCreativeSkill = async (operation: PendingCreativeSkill, conversationId: string) => {
        const discardOperation = () => setPendingSkillsByConversation((current) => {
            if (current[conversationId]?.id !== operation.id) return current;
            const { [conversationId]: _removed, ...remaining } = current;
            return remaining;
        });
        const appendResult = (status: "completed" | "error", text: string, output?: string) => {
            const toolMessage: AgentChatItem = {
                id: nanoid(),
                role: "tool",
                title: operation.name,
                text,
                detail: { ...operation.detail, references: undefined, status, ...(output ? { output } : {}) },
            };
            setConversationMessages(conversationId, (current) => [...current, toolMessage].slice(-MAX_HISTORY_MESSAGES));
        };
        if (applyingRef.current) {
            appendResult("error", runtimeText("operationDeferred"), runtimeText("operationDeferred"));
            discardOperation();
            return;
        }
        const context = useAgentStore.getState().canvasContext;
        if (!context || context.snapshot.projectId !== operation.projectId) {
            const detail = t("creativeSkills.chat.canvasRequired");
            appendResult("error", t("creativeSkills.chat.failed"), detail);
            discardOperation();
            message.error(detail);
            return;
        }
        if (!isCreativeSkillChatSnapshotCurrent(context.snapshot, operation.sourceCanvas)) {
            const detail = i18n.t("agent.proposalStale");
            appendResult("error", t("creativeSkills.chat.failed"), detail);
            discardOperation();
            message.error(detail);
            return;
        }
        if (!context.runCreativeSkill) {
            const detail = t("creativeSkills.chat.runnerUnavailable");
            appendResult("error", t("creativeSkills.chat.failed"), detail);
            discardOperation();
            message.error(detail);
            return;
        }
        applyingRef.current = true;
        setApplyingIds((current) => new Set(current).add(conversationId));
        setActiveSkillCommands((current) => ({ ...current, [conversationId]: operation.execution.commandId }));
        setLastUndoByConversation({});
        try {
            const run = await context.runCreativeSkill(operation.execution);
            if (run.phase === "blocked") {
                setBlockedSkillsByConversation((current) => ({ ...current, [conversationId]: { name: operation.name, projectId: operation.projectId, run } }));
                appendResult("error", t("creativeSkills.chat.needsAttention"), t(run.block?.possibleCharge ? "creativeSkills.chat.possibleCharge" : "creativeSkills.chat.blocked"));
                message.warning(t("creativeSkills.chat.needsAttention"));
                return;
            }
            if (run.phase !== "settled" || !run.settlement || ["failed", "canceled", "interrupted"].includes(run.settlement)) {
                const errorCode = [...run.attempts].reverse().find((attempt) => attempt.errorCode)?.errorCode;
                throw new Error(errorCode || t("creativeSkills.chat.failed"));
            }
            appendResult("completed", t("creativeSkills.chat.completed"));
            void window.infiniteCanvasDesktop?.notifyTaskComplete({ title: operation.name, body: t("creativeSkills.chat.completed"), route: `/canvas/${operation.projectId}` });
        } catch (error) {
            const detail = error instanceof Error ? error.message : t("creativeSkills.chat.failed");
            appendResult("error", t("creativeSkills.chat.failed"), detail);
            message.error(detail);
        } finally {
            applyingRef.current = false;
            discardOperation();
            setActiveSkillCommands((current) => {
                const { [conversationId]: _removed, ...remaining } = current;
                return remaining;
            });
            setApplyingIds((current) => {
                const next = new Set(current);
                next.delete(conversationId);
                return next;
            });
        }
    };

    const send = async () => {
        const value = prompt.trim();
        if (!value || sending || applying || pendingOps || pendingSkill) return;
        const attachedSkill = runnableSkills.find((item) => item.skillId === selectedCreativeSkillId && item.version);
        if (!ready && !attachedSkill) {
            openConfigDialog(false, "channels");
            return;
        }
        const conversationId = activeId || nanoid();
        const currentMessages = conversationState.conversations.find((item) => item.id === conversationId)?.messages || [];
        const currentCanvas = useAgentStore.getState().canvasContext?.snapshot || null;
        const userMessage: AgentChatItem = {
            id: nanoid(),
            role: "user",
            text: value,
            title: runtimeText("you"),
            ...(attachedSkill?.version ? { creativeSkill: { skillId: attachedSkill.skillId, versionId: attachedSkill.version.versionId, definitionHash: attachedSkill.version.definitionHash, name: attachedSkill.name, source: attachedSkill.source === "skill-markdown" ? undefined : attachedSkill.source } } : {}),
        };
        if (attachedSkill?.version) {
            setSelectedCreativeSkillId("");
            setPrompt("");
            setConversationMessages(conversationId, (current) => [...current, userMessage].slice(-MAX_HISTORY_MESSAGES));
            try {
                if (!currentCanvas) throw new Error(t("creativeSkills.chat.canvasRequired"));
                const prepared = prepareCreativeSkillChatExecution({
                    commandId: nanoid(),
                    clientMessageId: userMessage.id,
                    threadId: conversationId,
                    skill: { skillId: attachedSkill.skillId, name: attachedSkill.name, source: attachedSkill.source, version: attachedSkill.version },
                    prompt: value,
                    snapshot: currentCanvas,
                    size: config.size,
                    labels: {
                        understanding: detailText("understandingLabel"),
                        target: runtimeText("targetLabel"),
                        references: detailText("referenceLabel"),
                        noReferences: detailText("noReferenceImages"),
                        currentCanvas: detailText("currentCanvas"),
                        untitledNode: runtimeText("untitledNode"),
                        prompt: runtimeText("promptLabel"),
                        promptIndex: i18n.language.startsWith("zh") ? "提示词 {{index}}" : "Prompt {{index}}",
                        ratio: runtimeText("ratioLabel"),
                        outputs: runtimeText("outputCountLabel"),
                        modelCalls: runtimeText("modelCallsLabel"),
                        separator: i18n.language.startsWith("zh") ? "、" : ", ",
                    },
                });
                const operation: PendingCreativeSkill = { id: nanoid(), projectId: currentCanvas.projectId, name: attachedSkill.name, sourceCanvas: currentCanvas, execution: prepared.execution, detail: prepared.detail };
                if (confirmTools) setPendingSkillsByConversation((current) => ({ ...current, [conversationId]: operation }));
                else await executeCreativeSkill(operation, conversationId);
            } catch (error) {
                const detail = error instanceof Error ? error.message : t("creativeSkills.chat.failed");
                const errorMessage: AgentChatItem = { id: nanoid(), role: "error", title: attachedSkill.name, text: detail };
                setConversationMessages(conversationId, (current) => [...current, errorMessage].slice(-MAX_HISTORY_MESSAGES));
                message.error(detail);
            }
            return;
        }
        const assistantId = nanoid();
        const assistantMessage: AgentChatItem = { id: assistantId, role: "assistant", text: "", title: runtimeText("title"), streamId: assistantId };
        const history = [...currentMessages, userMessage].slice(-MAX_HISTORY_MESSAGES);
        setConversationMessages(conversationId, (current) => [...current, userMessage, assistantMessage].slice(-MAX_HISTORY_MESSAGES));
        setPrompt("");
        setRunningIds((current) => new Set(current).add(conversationId));
        setPendingOpsByConversation((current) => {
            const { [conversationId]: _removed, ...remaining } = current;
            return remaining;
        });
        const controller = new AbortController();
        controllersRef.current.set(conversationId, controller);
        const promptOnly = requestsPromptOnly(value);
        const promptHistory = promptOnly ? startCreativeHistoryEvent({
            eventId: `prompt-polish:${assistantId}`,
            occurredAt: Date.now(),
            category: "prompt",
            source: "agent",
            operation: "prompt-polish",
            projectId: currentCanvas?.projectId,
            projectTitle: currentCanvas?.title,
            requestedCount: 1,
            signal: controller.signal,
        }) : null;
        let notificationBody = runtimeText("taskCompleted");
        try {
            const agentConfig = {
                ...config,
                model: textModel,
                textModel,
                systemPrompt: [config.systemPrompt, BUILTIN_AGENT_PROMPT, `当前画布状态：\n${snapshotForPrompt(currentCanvas)}`].filter(Boolean).join("\n\n"),
            };
            const selectedImageItems = selectedImageSources(currentCanvas);
            const selectedImages = await Promise.all(selectedImageItems.map(async (image) => {
                try {
                    const dataUrl = await imageToDataUrl(image);
                    return dataUrl ? { nodeId: image.nodeId, title: image.title, url: await prepareContextImage(dataUrl) } : null;
                } catch {
                    return null;
                }
            }));
            if (selectedImages.some((image) => !image)) throw new Error(runtimeText("imageReadFailed"));
            const contextImages = selectedImages.filter((image): image is SelectedContextImage => Boolean(image));
            const result = await requestImageQuestion(agentConfig, toProviderMessages(history, contextImages), (text) => updateMessage(conversationId, assistantId, { text, streamId: assistantId }), { signal: controller.signal });
            const parsed = parseOperations(result);
            if (promptHistory) await promptHistory.finish({ successCount: 1 }).catch(() => null);
            const invalidGenerationBatch = !promptOnly && parsed.ops.some(isGenerationAction) && parsed.ops.length !== 1;
            if (promptOnly || invalidGenerationBatch) parsed.ops = [];
            const reply = [parsed.text || runtimeText("emptyReply"), invalidGenerationBatch ? runtimeText("singleAsyncOperation") : ""].filter(Boolean).join("\n\n");
            updateMessage(conversationId, assistantId, { text: reply, streamId: undefined });
            if (parsed.ops.length) {
                if (!currentCanvas) {
                    updateMessage(conversationId, assistantId, { text: `${parsed.text || runtimeText("operationProposed")}\n\n${runtimeText("canvasRequired")}` });
                } else {
                    const latestCanvas = useAgentStore.getState().canvasContext?.snapshot || null;
                    if (!sameCanvasVersion(latestCanvas, currentCanvas, changesViewport(parsed.ops))) {
                        updateMessage(conversationId, assistantId, { text: `${reply}\n\n${i18n.t("agent.proposalStale")}` });
                    } else {
                        const operation: PendingBuiltinOps = { id: nanoid(), projectId: currentCanvas.projectId, intent: "canvas_change", sourcePrompt: value, sourceCanvas: currentCanvas, ops: parsed.ops, detail: pendingOpsDetail(parsed.ops, currentCanvas, config, parsed.text || reply) };
                        if (confirmTools) setPendingOpsByConversation((current) => ({ ...current, [conversationId]: operation }));
                        else if (await executeOperation(operation, conversationId) === "deferred") notificationBody = runtimeText("operationDeferred");
                    }
                }
            }
            void window.infiniteCanvasDesktop?.notifyTaskComplete({ title: runtimeText("title"), body: notificationBody, route: currentCanvas ? `/canvas/${currentCanvas.projectId}` : "/" });
        } catch (error) {
            if (promptHistory) await promptHistory.finish(controller.signal.aborted ? { status: "canceled", canceledCount: 1 } : { status: "failed", failureCount: 1 }).catch(() => null);
            if (controller.signal.aborted) {
                updateMessage(conversationId, assistantId, { text: runtimeText("stopped"), streamId: undefined });
            } else {
                const detail = error instanceof Error ? error.message : runtimeText("requestFailed");
                updateMessage(conversationId, assistantId, { role: "error", text: detail, streamId: undefined });
                message.error(detail);
            }
        } finally {
            if (controllersRef.current.get(conversationId) === controller) controllersRef.current.delete(conversationId);
            setRunningIds((current) => {
                const next = new Set(current);
                next.delete(conversationId);
                return next;
            });
        }
    };

    const stop = () => {
        if (!activeId) return;
        controllersRef.current.get(activeId)?.abort();
        const commandId = activeSkillCommands[activeId];
        const context = useAgentStore.getState().canvasContext;
        if (commandId && context?.cancelCreativeSkill) void context.cancelCreativeSkill(commandId).catch((error) => {
            message.error(error instanceof Error ? error.message : t("creativeSkills.chat.cancelFailed"));
        });
    };
    const approveOps = async () => {
        if (!pendingOps || !activeId) return;
        await executeOperation(pendingOps, activeId);
    };
    const rejectOps = () => {
        if (!pendingOps) return;
        const toolMessage: AgentChatItem = { id: nanoid(), role: "tool", title: runtimeText("title"), text: runtimeText("rejected"), detail: { ...pendingOps.detail, references: undefined, status: "rejected" } };
        setConversationMessages(activeId, (current) => [...current, toolMessage].slice(-MAX_HISTORY_MESSAGES));
        setPendingOpsByConversation((current) => {
            const { [activeId]: _removed, ...remaining } = current;
            return remaining;
        });
    };
    const approveCreativeSkill = async () => {
        if (!pendingSkill || !activeId) return;
        await executeCreativeSkill(pendingSkill, activeId);
    };
    const rejectCreativeSkill = () => {
        if (!pendingSkill || !activeId) return;
        const toolMessage: AgentChatItem = { id: nanoid(), role: "tool", title: pendingSkill.name, text: t("creativeSkills.chat.rejected"), detail: { ...pendingSkill.detail, references: undefined, status: "rejected" } };
        setConversationMessages(activeId, (current) => [...current, toolMessage].slice(-MAX_HISTORY_MESSAGES));
        setPendingSkillsByConversation((current) => {
            const { [activeId]: _removed, ...remaining } = current;
            return remaining;
        });
    };
    const clearBlockedCreativeSkill = (runId: string) => {
        setBlockedSkillsByConversation((current) => Object.fromEntries(Object.entries(current).filter(([, item]) => item.run.runId !== runId)));
        setAgentState({ creativeSkillAttention: useAgentStore.getState().creativeSkillAttention.filter((run) => run.runId !== runId) });
    };
    const resumeBlockedCreativeSkill = async () => {
        if (!blockedSkill) return;
        const context = useAgentStore.getState().canvasContext;
        if (!context?.resumeCreativeSkill || context.snapshot.projectId !== blockedSkill.projectId) return message.error(t("creativeSkills.chat.canvasRequired"));
        applyingRef.current = true;
        if (activeId) setApplyingIds((current) => new Set(current).add(activeId));
        try {
            const run = await context.resumeCreativeSkill(blockedSkill.run.runId);
            if (run.phase === "blocked") {
                if (conversationBlockedSkill && activeId) setBlockedSkillsByConversation((current) => ({ ...current, [activeId]: { ...blockedSkill, run } }));
                else setAgentState({ creativeSkillAttention: useAgentStore.getState().creativeSkillAttention.map((item) => item.runId === run.runId ? run : item) });
                message.warning(t("creativeSkills.chat.needsAttention"));
                return;
            }
            clearBlockedCreativeSkill(run.runId);
            const completed = run.phase === "settled" && (run.settlement === "success" || run.settlement === "partial");
            const toolMessage: AgentChatItem = { id: nanoid(), role: "tool", title: blockedSkill.name, text: completed ? t("creativeSkills.chat.completed") : t("creativeSkills.chat.failed"), detail: { kind: "creative-skill", status: completed ? "completed" : "error" } };
            if (activeId) setConversationMessages(activeId, (current) => [...current, toolMessage].slice(-MAX_HISTORY_MESSAGES));
            if (completed) message.success(t("creativeSkills.chat.completed"));
            else message.error(t("creativeSkills.chat.failed"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("creativeSkills.chat.failed"));
        } finally {
            applyingRef.current = false;
            if (activeId) setApplyingIds((current) => {
                    const next = new Set(current);
                    next.delete(activeId);
                    return next;
                });
        }
    };
    const dismissBlockedCreativeSkill = () => {
        if (!blockedSkill) return;
        const context = useAgentStore.getState().canvasContext;
        if (!context?.dismissCreativeSkill) return;
        modal.confirm({
            title: t("creativeSkills.chat.dismissTitle"),
            content: t(blockedSkill.run.block?.possibleCharge ? "creativeSkills.chat.dismissChargeDescription" : "creativeSkills.chat.dismissDescription"),
            okText: t("creativeSkills.chat.dismiss"),
            cancelText: t("common.cancel"),
            okButtonProps: { danger: true },
            onOk: async () => {
                await context.dismissCreativeSkill!(blockedSkill.run.runId);
                clearBlockedCreativeSkill(blockedSkill.run.runId);
                const toolMessage: AgentChatItem = { id: nanoid(), role: "tool", title: blockedSkill.name, text: t("creativeSkills.chat.dismissed"), detail: { kind: "creative-skill", status: "error" } };
                if (activeId) setConversationMessages(activeId, (current) => [...current, toolMessage].slice(-MAX_HISTORY_MESSAGES));
            },
        });
    };
    const undo = () => {
        if (!lastUndoId) return;
        const context = useAgentStore.getState().canvasContext;
        if (!context?.canUndo) return;
        if (!context.undoOps()) {
            setLastUndoByConversation((current) => ({ ...current, [activeId]: "" }));
            return;
        }
        const toolMessage: AgentChatItem = { id: nanoid(), role: "tool", title: runtimeText("title"), text: runtimeText("undone"), detail: { kind: "builtin-canvas", status: "completed" } };
        setConversationMessages(activeId, (current) => [...current, toolMessage].slice(-MAX_HISTORY_MESSAGES));
        setLastUndoByConversation((current) => ({ ...current, [activeId]: "" }));
    };

    if (!embedded) return null;
    return (
        <div className="flex h-full min-h-0 flex-col" style={{ background: theme.node.panel, color: theme.node.text }}>
            <div className="flex shrink-0 items-center justify-between border-b px-3 py-2" style={{ borderColor: theme.node.stroke }}>
                <div className="flex min-w-0 items-center gap-2">
                    <span className="grid size-9 shrink-0 place-items-center">
                        <span className="size-6 bg-brand" style={{ mask: "url(/logo.svg) center / contain no-repeat", WebkitMask: "url(/logo.svg) center / contain no-repeat" }} />
                    </span>
                    <div className="min-w-0">
                        <div className="truncate text-base font-medium leading-6">{runtimeText("title")}</div>
                        <div className="truncate text-[13px] leading-5" style={{ color: theme.node.muted }}>{runtimeText("subtitle")}</div>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <Button size="small" type="text" className="!h-8 !w-8 !min-w-8 !px-0" title={runtimeText("conversationHistory")} aria-label={runtimeText("conversationHistory")} icon={<History className="size-3.5" />} onClick={() => setHistoryOpen(true)} />
                    <Button size="small" type="text" className="!h-8 !w-8 !min-w-8 !px-0" title={runtimeText("newConversation")} aria-label={runtimeText("newConversation")} icon={<Plus className="size-3.5" />} onClick={createNewConversation} />
                    <Button size="small" type="text" className="!h-8 !w-8 !min-w-8 !px-0" title={t("agent.panel.collapse")} aria-label={t("agent.panel.collapseLabel")} icon={<PanelRightClose className="size-4" />} onClick={closePanel} />
                </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
                <div ref={listRef} className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4 select-text">
                    {!messages.length ? (
                        <div className="grid min-h-full place-items-center">
                            <Empty image={<Sparkles className="mx-auto size-8" style={{ color: theme.node.muted }} />} description={<span style={{ color: theme.node.muted }}>{runtimeText("empty")}</span>} />
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {messages.map((item) => <AgentChatMessage key={item.id} item={item} theme={theme} />)}
                            {pendingOps ? <AgentPendingToolCard summary={summarizeCanvasAgentOps(pendingOps.ops) || runtimeText("canvasChange")} detail={pendingOps.detail} theme={theme} busy={applying} onReject={rejectOps} onApprove={() => void approveOps()} /> : null}
                            {pendingSkill ? <AgentPendingToolCard summary={t("creativeSkills.chat.runSummary", { name: pendingSkill.name })} detail={pendingSkill.detail} theme={theme} busy={applying} onReject={rejectCreativeSkill} onApprove={() => void approveCreativeSkill()} /> : null}
                            {lastUndoId && canUndoCanvasOps ? <div className="flex justify-end"><Button size="small" type="text" icon={<RotateCcw className="size-3.5" />} onClick={undo}>{runtimeText("undo")}</Button></div> : null}
                            {sending ? <div className="text-[13px]" style={{ color: theme.node.muted }}>{runtimeText("thinking")}</div> : null}
                        </div>
                    )}
                    {blockedSkill ? <div className="mt-4"><CreativeSkillBlockedCard blocked={blockedSkill} busy={applying} theme={theme} onResume={() => void resumeBlockedCreativeSkill()} onDismiss={dismissBlockedCreativeSkill} /></div> : null}
                </div>
                {!ready ? (
                    <div className="mx-3 mb-2 rounded-lg border px-3 py-2.5 text-[13px] leading-5" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                        <div className="font-medium" style={{ color: theme.node.text }}>{runtimeText("configureTitle")}</div>
                        <div className="mt-1">{runtimeText("configureDescription")}</div>
                        <Button size="small" type="link" className="!px-0" icon={<Settings2 className="size-3.5" />} onClick={() => openConfigDialog(false, "channels")}>{runtimeText("configureAction")}</Button>
                    </div>
                ) : null}
                <CanvasSelectionStrip nodes={selectedNodes} theme={theme} />
                <AgentChatComposer
                    prompt={prompt}
                    disabled={!conversationsLoaded || (!ready && !selectedCreativeSkillId) || applying || Boolean(pendingOps || pendingSkill)}
                    sending={sending || skillRunning}
                    placeholder={ready ? runtimeText("placeholder", { model: modelLabel }) : runtimeText("configurePlaceholder")}
                    theme={theme}
                    confirmTools={confirmTools}
                    onConfirmToolsChange={changeConfirmationMode}
                    left={<BuiltinTextModelControl config={config} models={textModels} value={textModel} theme={theme} disabled={sending || applying} onChange={(value) => updateConfig("textModel", value)} />}
                    allowSkills={false}
                    allowCanvasReferences={false}
                    creativeSkills={runnableSkills.map((item) => ({ value: item.skillId, label: item.name, description: item.description }))}
                    creativeSkillId={selectedCreativeSkillId}
                    onCreativeSkillChange={(value) => setSelectedCreativeSkillId(value || "")}
                    onPromptChange={setPrompt}
                    onSubmit={send}
                    onStop={stop}
                />
            </div>
            <Drawer title={runtimeText("taskList")} placement="right" size={360} open={historyOpen} onClose={() => setHistoryOpen(false)} extra={<Button size="small" type="text" icon={<Plus className="size-3.5" />} onClick={createNewConversation}>{runtimeText("newTask")}</Button>}>
                {historyTasks.length ? (
                    <div className="space-y-1">
                        {historyTasks.map((task) => {
                            const active = task.id === activeId;
                            const running = runningIds.has(task.id) || applyingIds.has(task.id);
                            const preview = [...task.messages].reverse().find((item) => item.text.trim())?.text || runtimeText("emptyTask");
                            return (
                                <div key={task.id} className={`group flex items-start gap-2 rounded-lg px-2 py-2 transition ${active ? "" : "hover:bg-black/5 dark:hover:bg-white/10"}`} style={{ background: active ? theme.toolbar.activeBg : undefined }}>
                                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => switchConversation(task.id)}>
                                        <div className="flex items-center gap-2">
                                            {running ? <span className="size-2 shrink-0 animate-pulse rounded-full bg-amber-500" /> : null}
                                            <span className="truncate text-sm font-medium">{task.title || runtimeText("untitledTask")}</span>
                                        </div>
                                        <div className="mt-1 line-clamp-2 text-xs leading-5" style={{ color: theme.node.muted }}>{preview}</div>
                                        <div className="mt-1 text-[12px] opacity-70" style={{ color: theme.node.muted }}>{new Date(task.updatedAt).toLocaleString()}</div>
                                    </button>
                                    <Dropdown
                                        trigger={["click"]}
                                        menu={{
                                            items: [
                                                { key: "rename", icon: <Pencil className="size-3.5" />, label: runtimeText("renameTask"), onClick: () => openRename(task.id) },
                                                { key: "delete", danger: true, disabled: running, icon: <Trash2 className="size-3.5" />, label: runtimeText("deleteConversation"), onClick: () => removeConversation(task.id) },
                                            ],
                                        }}
                                    >
                                        <Button size="small" type="text" className="!h-7 !w-7 !min-w-7 !px-0 opacity-60 group-hover:opacity-100" icon={<MoreHorizontal className="size-3.5" />} aria-label={runtimeText("taskActions")} />
                                    </Dropdown>
                                </div>
                            );
                        })}
                    </div>
                ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={runtimeText("noTasks")} />}
            </Drawer>
            <Modal title={runtimeText("renameTask")} open={Boolean(renameTarget)} onCancel={() => setRenameTarget("")} onOk={confirmRename} okText={t("common.save")} cancelText={t("common.cancel")}>
                <Input value={renameDraft} maxLength={80} autoFocus onChange={(event) => setRenameDraft(event.target.value)} onPressEnter={confirmRename} />
            </Modal>
        </div>
    );
}

function CanvasSelectionStrip({ nodes, theme }: { nodes: CanvasNodeData[]; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    if (!nodes.length) return null;
    return (
        <section className="mx-3 border-y py-2" style={{ borderColor: theme.node.stroke }} aria-label={runtimeText("currentSelection")}>
            <div className="mb-1.5 flex items-center justify-between gap-3 px-0.5 text-[12px]" style={{ color: theme.node.muted }}>
                <span>{runtimeText("currentSelection")}</span>
                <span className="tabular-nums">{runtimeText("selectedCount", { count: nodes.length })}</span>
            </div>
            <div className="thin-scrollbar flex gap-1.5 overflow-x-auto pb-0.5" role="list">
                {nodes.map((node) => (
                    <div key={node.id} role="listitem" className="flex h-11 min-w-32 max-w-44 shrink-0 items-center gap-2 rounded-md border px-1.5" style={{ borderColor: theme.node.stroke }} title={node.title || runtimeText("untitledNode")}>
                        <SelectionNodePreview node={node} theme={theme} />
                        <span className="min-w-0 flex-1 truncate text-[13px]">{node.title || runtimeText("untitledNode")}</span>
                    </div>
                ))}
            </div>
        </section>
    );
}

function SelectionNodePreview({ node, theme }: { node: CanvasNodeData; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    if (node.type === CanvasNodeType.Image && node.metadata?.content) return <img src={node.metadata.content} alt="" className="size-8 shrink-0 rounded object-cover" />;
    const Icon = node.type === CanvasNodeType.Video ? Video : node.type === CanvasNodeType.Audio ? Music2 : node.type === CanvasNodeType.Text ? FileText : node.type === CanvasNodeType.Group ? Group : node.type === CanvasNodeType.Image ? ImageIcon : Settings2;
    return <span className="grid size-8 shrink-0 place-items-center rounded" style={{ color: theme.node.muted }}><Icon className="size-4" /></span>;
}

function BuiltinTextModelControl({ config, models, value, theme, disabled, onChange }: { config: AiConfig; models: string[]; value: string; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; disabled: boolean; onChange: (value: string) => void }) {
    if (!models.length) return null;
    const label = modelOptionLabel(config, value);
    return (
        <Dropdown
            trigger={["click"]}
            placement="topLeft"
            disabled={disabled}
            menu={{
                items: models.map((model) => ({
                    key: model,
                    icon: model === value ? <Check className="size-3.5" /> : <span className="block size-3.5" />,
                    label: <span className="block max-w-72 truncate" title={modelOptionLabel(config, model)}>{modelOptionLabel(config, model)}</span>,
                    onClick: () => onChange(model),
                })),
            }}
        >
            <button type="button" disabled={disabled} className="flex h-9 w-9 min-w-9 shrink-0 items-center justify-center gap-0 rounded-full px-0 text-xs font-medium transition hover:bg-black/5 disabled:cursor-default disabled:opacity-45 @min-[560px]:w-auto @min-[560px]:min-w-0 @min-[560px]:max-w-40 @min-[560px]:justify-start @min-[560px]:gap-1.5 @min-[560px]:px-2.5 dark:hover:bg-white/10" style={{ color: theme.node.text }} title={detailText("modelLabel", { model: label })} aria-label={detailText("selectModel", { model: label })}>
                <Cpu className="size-3.5 shrink-0 opacity-70" />
                <span className="hidden min-w-0 flex-1 truncate text-left @min-[560px]:inline">{label}</span>
                <ChevronUp className="hidden size-3 shrink-0 opacity-50 @min-[560px]:block" />
            </button>
        </Dropdown>
    );
}
