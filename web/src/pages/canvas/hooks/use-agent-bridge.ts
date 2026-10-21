import { useCallback, useEffect, useMemo, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import i18n from "@/i18n";
import { useAgentStore } from "@/stores/use-agent-store";
import { applyCanvasAgentOps, type CanvasAgentImageActionOp, type CanvasAgentOp, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { recordCanvasTextActivity } from "@/services/creative-activity";
import { createCanvasCreativeSkillRuntime, type MaterializeCreativeSkillOutput } from "@/services/creative-skill-canvas-runtime";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type ContextMenuState, type ViewportTransform } from "@/types/canvas";

type GenerateNodeRef = MutableRefObject<((nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => Promise<void>) | null>;
type ImageActionRef = MutableRefObject<((op: CanvasAgentImageActionOp) => Promise<void>) | null>;
type CanvasAgentAsyncActionOp = CanvasAgentImageActionOp | Extract<CanvasAgentOp, { type: "run_generation" }>;
type AgentUndoCheckpoint = { before: CanvasAgentSnapshot; after: CanvasAgentSnapshot; changedViewport: boolean };
type CanvasAgentProjectState = Pick<CanvasAgentSnapshot, "nodes" | "connections">;

type AgentBridgeParams = {
    enabled?: boolean;
    projectId: string;
    title: string | undefined;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectedNodeIds: Set<string>;
    viewport: ViewportTransform;
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    connectionsRef: MutableRefObject<CanvasConnection[]>;
    selectedNodeIdsRef: MutableRefObject<Set<string>>;
    viewportRef: MutableRefObject<ViewportTransform>;
    generateNodeRef: GenerateNodeRef;
    imageActionRef: ImageActionRef;
    isNodeBusy?: (nodeId: string) => boolean;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setViewport: Dispatch<SetStateAction<ViewportTransform>>;
    setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
    readProjectState?: () => CanvasAgentProjectState | null;
    persistSnapshot?: (snapshot: CanvasAgentSnapshot) => void;
    onNodesRemoved?: (nodeIds: string[]) => void;
    materializeCreativeSkillOutput: MaterializeCreativeSkillOutput;
};

/**
 * Publishes the current canvas snapshot and controlled apply/undo capabilities to the built-in chat.
 */
export function useAgentBridge(params: AgentBridgeParams) {
    const { enabled = true, projectId, title, nodes, connections, selectedNodeIds, viewport, nodesRef, connectionsRef, selectedNodeIdsRef, viewportRef, generateNodeRef, imageActionRef, isNodeBusy, setNodes, setConnections, setSelectedNodeIds, setSelectedConnectionId, setViewport, setContextMenu, readProjectState, persistSnapshot, onNodesRemoved, materializeCreativeSkillOutput } =
        params;
    const setAgentCanvasContext = useAgentStore((state) => state.setCanvasContext);
    const [agentUndoCheckpoint, setAgentUndoCheckpoint] = useState<AgentUndoCheckpoint | null>(null);
    const projectTitle = title || i18n.t("canvas.project.untitled");
    const creativeSkillRuntime = useMemo(() => createCanvasCreativeSkillRuntime({
        projectId,
        readNodes: () => nodesRef.current,
        materializeOutput: materializeCreativeSkillOutput,
    }), [materializeCreativeSkillOutput, projectId]);

    const agentSnapshot = useMemo<CanvasAgentSnapshot>(() => ({ projectId, title: projectTitle, nodes, connections, selectedNodeIds: Array.from(selectedNodeIds), viewport }), [connections, projectTitle, nodes, projectId, selectedNodeIds, viewport]);
    const readSnapshot = useCallback(
        (): CanvasAgentSnapshot => ({ projectId, title: projectTitle, nodes: nodesRef.current, connections: connectionsRef.current, selectedNodeIds: Array.from(selectedNodeIdsRef.current), viewport: viewportRef.current }),
        [projectId, projectTitle],
    );
    const writeSnapshot = useCallback((snapshot: CanvasAgentSnapshot) => {
        const nextNodeIds = new Set(snapshot.nodes.map((node) => node.id));
        const removedNodeIds = nodesRef.current.filter((node) => !nextNodeIds.has(node.id)).map((node) => node.id);
        nodesRef.current = snapshot.nodes;
        connectionsRef.current = snapshot.connections;
        selectedNodeIdsRef.current = new Set(snapshot.selectedNodeIds);
        viewportRef.current = snapshot.viewport;
        setNodes(snapshot.nodes);
        setConnections(snapshot.connections);
        setSelectedNodeIds(new Set(snapshot.selectedNodeIds));
        setSelectedConnectionId(null);
        setViewport(snapshot.viewport);
        setContextMenu(null);
        persistSnapshot?.(snapshot);
        if (removedNodeIds.length) onNodesRemoved?.(removedNodeIds);
    }, [onNodesRemoved, persistSnapshot]);
    const applyAgentOps = useCallback(
        (ops?: CanvasAgentOp[]) => {
            const safeOps = Array.isArray(ops) ? ops.filter((op) => op?.type) : [];
            const before = readSnapshot();
            setAgentUndoCheckpoint(null);
            if (!safeOps.length) return before;
            const changedViewport = safeOps.some((op) => op.type === "set_viewport");
            if (safeOps.some(isAsyncAction)) throw new Error(i18n.t("agent.builtin.singleAsyncOperation"));
            const next = applyCanvasAgentOps(before, safeOps);
            writeSnapshot(next);
            recordAgentTextActivities(before, next);
            setAgentUndoCheckpoint({ before, after: readSnapshot(), changedViewport });
            return { ...next, projectId, title: projectTitle };
        },
        [projectId, projectTitle, readSnapshot, writeSnapshot],
    );
    const applyAgentOpsAsync = useCallback(
        async (ops?: CanvasAgentOp[]) => {
            const safeOps = Array.isArray(ops) ? ops.filter((op) => op?.type) : [];
            if (!safeOps.length) return readSnapshot();
            const before = readSnapshot();
            setAgentUndoCheckpoint(null);
            setContextMenu(null);
            const asyncOps = safeOps.filter(isAsyncAction);
            if (asyncOps.length > 1 || (asyncOps.length === 1 && safeOps[safeOps.length - 1] !== asyncOps[0])) throw new Error(i18n.t("agent.builtin.singleAsyncOperation"));

            let validationSnapshot = before;
            for (const op of safeOps) {
                assertAgentOpTargets(op, validationSnapshot.nodes, validationSnapshot.connections);
                if (!isAsyncAction(op)) validationSnapshot = applyCanvasAgentOps(validationSnapshot, [op]);
            }
            if (!asyncOps.length) {
                writeSnapshot(validationSnapshot);
                recordAgentTextActivities(before, validationSnapshot);
            } else {
                const op = asyncOps[0];
                if (isNodeBusy?.(op.nodeId)) throw new Error(i18n.t("agent.canvasBusy"));
                if (safeOps.length > 1) {
                    writeSnapshot(validationSnapshot);
                    recordAgentTextActivities(before, validationSnapshot);
                }
                assertAgentOpTargets(op, nodesRef.current, connectionsRef.current);
                if (op.type === "run_generation") {
                    const target = nodesRef.current.find((node) => node.id === op.nodeId);
                    const run = generateNodeRef.current;
                    if (!target || !run) throw new Error(i18n.t("agent.builtin.targetUnavailable"));
                    const prompt = op.prompt?.trim() ? op.prompt : (target.metadata?.composerContent ?? target.metadata?.prompt ?? "");
                    const mode = resolveAgentGenerationMode(target, op.mode);
                    await runTrackedAction(nodesRef, connectionsRef, target.id, () => run(op.nodeId, mode, prompt), mode === "image" && target.type === CanvasNodeType.Image && Boolean(target.metadata?.content), readProjectState);
                } else {
                    const target = nodesRef.current.find((node) => node.id === op.nodeId);
                    const run = imageActionRef.current;
                    if (!target?.metadata?.content || target.type !== CanvasNodeType.Image || !run) throw new Error(i18n.t("agent.builtin.targetUnavailable"));
                    await runTrackedAction(nodesRef, connectionsRef, target.id, () => run(op), true, readProjectState);
                }
            }
            const persistedState = asyncOps.length ? readProjectState?.() : null;
            if (asyncOps.length && readProjectState && !persistedState) throw new Error(i18n.t("agent.builtin.targetUnavailable"));
            const after = persistedState ? { ...before, ...persistedState } : readSnapshot();
            if (!asyncOps.length) setAgentUndoCheckpoint({ before, after, changedViewport: safeOps.some((op) => op.type === "set_viewport") });
            return after;
        },
        [isNodeBusy, readProjectState, readSnapshot, writeSnapshot],
    );
    const undoAgentOps = useCallback(() => {
        const current = readSnapshot();
        if (!agentUndoCheckpoint || !snapshotsMatch(current, agentUndoCheckpoint.after, agentUndoCheckpoint.changedViewport)) {
            setAgentUndoCheckpoint(null);
            return null;
        }
        const before = agentUndoCheckpoint.changedViewport ? agentUndoCheckpoint.before : { ...agentUndoCheckpoint.before, viewport: current.viewport };
        writeSnapshot(before);
        setAgentUndoCheckpoint(null);
        return { ...before, projectId, title: projectTitle };
    }, [agentUndoCheckpoint, projectTitle, projectId, readSnapshot, writeSnapshot]);

    const canUndoAgentOps = Boolean(agentUndoCheckpoint && snapshotsMatch(agentSnapshot, agentUndoCheckpoint.after, agentUndoCheckpoint.changedViewport));

    useEffect(() => {
        if (!enabled) {
            setAgentCanvasContext(null);
            return;
        }
        setAgentCanvasContext({
            snapshot: agentSnapshot,
            readSnapshot,
            applyOps: applyAgentOps,
            applyOpsAsync: applyAgentOpsAsync,
            runCreativeSkill: creativeSkillRuntime.run,
            recoverCreativeSkills: creativeSkillRuntime.recover,
            resumeCreativeSkill: creativeSkillRuntime.resume,
            cancelCreativeSkill: creativeSkillRuntime.cancelCommand,
            dismissCreativeSkill: creativeSkillRuntime.dismiss,
            undoOps: undoAgentOps,
            canUndo: canUndoAgentOps,
        });
        return () => setAgentCanvasContext(null);
    }, [agentSnapshot, applyAgentOps, applyAgentOpsAsync, canUndoAgentOps, creativeSkillRuntime, enabled, readSnapshot, setAgentCanvasContext, undoAgentOps]);

    return {
        applyAgentOps,
        recoverCreativeSkills: creativeSkillRuntime.recover,
        resumeCreativeSkill: creativeSkillRuntime.resume,
        dismissCreativeSkill: creativeSkillRuntime.dismiss,
    };
}

function recordAgentTextActivities(before: CanvasAgentSnapshot, after: CanvasAgentSnapshot) {
    const beforeById = new Map(before.nodes.map((node) => [node.id, node]));
    after.nodes.forEach((node) => {
        if (node.type !== CanvasNodeType.Text) return;
        const previous = beforeById.get(node.id);
        if (previous && previous.metadata?.content === node.metadata?.content) return;
        recordCanvasTextActivity({
            projectId: after.projectId,
            projectTitle: after.title,
            nodeId: node.id,
            nodeTitle: node.title,
            operation: previous ? "text-edit" : "text-create",
            source: "agent",
            textSource: node.metadata?.textSource || "unknown",
            characterCount: Array.from(node.metadata?.content || "").length,
        });
    });
}

function snapshotsMatch(current: CanvasAgentSnapshot, expected: CanvasAgentSnapshot, compareViewport = false) {
    return current.projectId === expected.projectId
        && current.nodes === expected.nodes
        && current.connections === expected.connections
        && (!compareViewport
            || (current.viewport.x === expected.viewport.x
                && current.viewport.y === expected.viewport.y
                && current.viewport.k === expected.viewport.k))
        && current.selectedNodeIds.length === expected.selectedNodeIds.length
        && current.selectedNodeIds.every((id, index) => id === expected.selectedNodeIds[index]);
}

function isImageAction(op: CanvasAgentOp): op is CanvasAgentImageActionOp {
    return op.type === "outpaint_image" || op.type === "upscale_image" || op.type === "three_view_image";
}

function isAsyncAction(op: CanvasAgentOp): op is CanvasAgentAsyncActionOp {
    return op.type === "run_generation" || isImageAction(op);
}

function resolveAgentGenerationMode(target: CanvasNodeData, requested?: CanvasNodeGenerationMode): CanvasNodeGenerationMode {
    if (target.type === CanvasNodeType.Image) return "image";
    if (target.type === CanvasNodeType.Video) return "video";
    if (target.type === CanvasNodeType.Audio) return "audio";
    return requested || target.metadata?.generationMode || "image";
}

function assertAgentOpTargets(op: CanvasAgentOp, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const nodeIds = new Set(nodes.map((node) => node.id));
    const connectionIds = new Set(connections.map((connection) => connection.id));
    let requiredNodeIds: string[] = [];
    let requiredConnectionIds: string[] = [];
    if (op.type === "update_node") {
        requiredNodeIds = [op.id];
        const target = nodes.find((node) => node.id === op.id);
        if ((op.patch?.metadata?.content !== undefined || op.metadata?.content !== undefined) && target?.type !== CanvasNodeType.Text) {
            throw new Error(i18n.t("agent.builtin.targetUnavailable"));
        }
    }
    if (op.type === "delete_node") requiredNodeIds = op.ids || (op.id ? [op.id] : []);
    if (op.type === "connect_nodes") requiredNodeIds = [op.fromNodeId, op.toNodeId];
    if (op.type === "arrange_nodes" || op.type === "select_nodes") requiredNodeIds = op.ids || [];
    if (op.type === "run_generation" || isImageAction(op)) requiredNodeIds = [op.nodeId];
    if (op.type === "run_generation") {
        const target = nodes.find((node) => node.id === op.nodeId);
        if (!target || target.type === CanvasNodeType.Group || !Object.values(CanvasNodeType).includes(target.type as CanvasNodeType)) {
            throw new Error(i18n.t("agent.builtin.targetUnavailable"));
        }
    }
    if (op.type === "delete_connections") requiredConnectionIds = op.ids || (op.id ? [op.id] : []);
    if (requiredNodeIds.some((id) => !nodeIds.has(id)) || requiredConnectionIds.some((id) => !connectionIds.has(id))) {
        throw new Error(i18n.t("agent.builtin.targetUnavailable"));
    }
}

async function runTrackedAction(
    nodesRef: MutableRefObject<CanvasNodeData[]>,
    connectionsRef: MutableRefObject<CanvasConnection[]>,
    targetNodeId: string,
    run: () => Promise<void>,
    requireLinkedChild = false,
    readProjectState?: () => CanvasAgentProjectState | null,
) {
    const beforeNodes = nodesRef.current;
    const beforeConnections = connectionsRef.current;
    const beforeById = new Map(beforeNodes.map((node) => [node.id, node]));
    const beforeConnectionIds = new Set(beforeConnections.map((connection) => connection.id));
    await run();
    const afterState = readProjectState ? readProjectState() : { nodes: nodesRef.current, connections: connectionsRef.current };
    if (!afterState) throw new Error(i18n.t("agent.builtin.targetUnavailable"));
    const afterNodes = afterState.nodes;
    const afterConnections = afterState.connections;
    if (afterNodes === beforeNodes && afterConnections === beforeConnections) throw new Error(i18n.t("agent.builtin.operationNotStarted"));
    const createdNodes = afterNodes.filter((node) => !beforeById.has(node.id));
    const linkedNodeIds = new Set(afterConnections.filter((connection) => !beforeConnectionIds.has(connection.id) && connection.fromNodeId === targetNodeId).map((connection) => connection.toNodeId));
    const linkedCreatedNodes = createdNodes.filter((node) => linkedNodeIds.has(node.id));
    const target = afterNodes.find((node) => node.id === targetNodeId);
    const relevantNodes = linkedCreatedNodes.length ? linkedCreatedNodes : !requireLinkedChild && target && target !== beforeById.get(targetNodeId) ? [target] : [];
    if (!relevantNodes.length) throw new Error(i18n.t("common.requestCanceled"));
    const nestedImages = relevantNodes.flatMap((node) => node.metadata?.images || []);
    if (relevantNodes.some((node) => node.metadata?.status === "idle" || node.metadata?.status === "loading") || nestedImages.some((image) => image.status === "idle" || image.status === "loading")) throw new Error(i18n.t("common.requestCanceled"));
    const hasFailure = relevantNodes.some((node) => node.metadata?.status === "error") || nestedImages.some((image) => image.status === "error");
    const hasSuccess = relevantNodes.some((node) => node.metadata?.status === "success") || nestedImages.some((image) => image.status === "success");
    if (hasFailure && hasSuccess) throw new Error(i18n.t("canvas.projectPage.partialFailed"));
    if (relevantNodes.length && relevantNodes.every((node) => node.metadata?.status === "error")) {
        throw new Error(relevantNodes.find((node) => node.metadata?.errorDetails)?.metadata?.errorDetails || i18n.t("agent.builtin.operationFailed"));
    }
}
