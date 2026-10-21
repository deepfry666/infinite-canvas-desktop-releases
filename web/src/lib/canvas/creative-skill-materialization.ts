import type { CreativeSkillRunOutput, CreativeSkillRunRecord } from "../creative-skill-run-ledger.ts";
import type { CanvasConnection, CanvasCreativeSkillProvenance, CanvasNodeData } from "../../types/canvas.ts";
import { CanvasNodeType } from "../../types/canvas.ts";
import { fitNodeSize } from "./canvas-node-size.ts";

type CanvasSnapshot = { nodes: CanvasNodeData[]; connections: CanvasConnection[] };

type MaterializationInput = {
    run: CreativeSkillRunRecord;
    output: CreativeSkillRunOutput;
    anchorNodeId: string;
    provenance: CanvasCreativeSkillProvenance;
};

export function materializeCreativeSkillOutput(
    snapshot: CanvasSnapshot,
    input: MaterializationInput,
    createId: () => string,
): CanvasSnapshot & { nodeId: string; created: boolean } {
    const anchor = snapshot.nodes.find((node) => node.id === input.anchorNodeId);
    if (!anchor) throw new Error("创作 Skill 的锚点节点已不存在");

    const existing = snapshot.nodes.find((node) => {
        const provenance = node.metadata?.creativeSkill;
        return provenance?.runId === input.run.runId && provenance.outputId === input.output.outputId;
    });
    if (existing) {
        if (snapshot.connections.some((connection) => connection.fromNodeId === anchor.id && connection.toNodeId === existing.id)) {
            return { ...snapshot, nodeId: existing.id, created: false };
        }
        return {
            nodes: snapshot.nodes,
            connections: [...snapshot.connections, linkedConnection(anchor.id, existing.id, createId())],
            nodeId: existing.id,
            created: false,
        };
    }

    const siblingOutputs = snapshot.nodes.filter((node) => node.metadata?.creativeSkill?.runId === input.run.runId);
    const size = fitNodeSize(input.output.width, input.output.height);
    const suffix = createId();
    const nodeId = `skill-output-${suffix}`;
    const siblingBottom = siblingOutputs.reduce((bottom, node) => Math.max(bottom, node.position.y + node.height), Number.NEGATIVE_INFINITY);
    const node: CanvasNodeData = {
        id: nodeId,
        type: CanvasNodeType.Image,
        title: siblingOutputs.length ? `${input.run.skill.nameSnapshot} ${siblingOutputs.length + 1}` : input.run.skill.nameSnapshot,
        position: {
            x: anchor.position.x + anchor.width + 80,
            y: siblingOutputs.length
                ? siblingBottom + 32
                : anchor.position.y + (anchor.height - size.height) / 2,
        },
        ...size,
        metadata: {
            content: input.output.url,
            storageKey: input.output.storageKey,
            status: "success",
            naturalWidth: input.output.width,
            naturalHeight: input.output.height,
            bytes: input.output.bytes,
            mimeType: input.output.mimeType,
            creativeSkill: structuredClone(input.provenance),
        },
    };
    return {
        nodes: [...snapshot.nodes, node],
        connections: [...snapshot.connections, linkedConnection(anchor.id, nodeId, suffix)],
        nodeId,
        created: true,
    };
}

function linkedConnection(fromNodeId: string, toNodeId: string, suffix: string): CanvasConnection {
    return { id: `skill-connection-${suffix}`, fromNodeId, toNodeId };
}
