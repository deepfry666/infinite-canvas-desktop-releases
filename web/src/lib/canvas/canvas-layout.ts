import { layout } from "dagre-d3-es/src/dagre/index.js";
import { Graph } from "dagre-d3-es/src/graphlib/index.js";

import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

type LayoutNode = {
    width: number;
    height: number;
    x?: number;
    y?: number;
};

export function arrangeCanvasNodes(nodes: CanvasNodeData[], connections: CanvasConnection[], requestedNodeIds?: Iterable<string>) {
    if (nodes.length < 2) return nodes;

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const requestedIds = requestedNodeIds ? new Set(requestedNodeIds) : new Set(nodes.map((node) => node.id));
    const unitIds = new Set<string>();

    requestedIds.forEach((id) => {
        const node = nodeById.get(id);
        if (!node) return;
        const group = node.metadata?.groupId ? nodeById.get(node.metadata.groupId) : undefined;
        unitIds.add(group?.type === CanvasNodeType.Group ? group.id : node.id);
    });

    const units = nodes.filter((node) => unitIds.has(node.id));
    if (units.length < 2) return nodes;

    const graph = new Graph<Record<string, unknown>, LayoutNode, Record<string, unknown>>({ directed: true });
    graph.setGraph({ rankdir: "LR", align: "UL", nodesep: 64, ranksep: 128, marginx: 0, marginy: 0 });
    graph.setDefaultEdgeLabel(() => ({}));

    [...units]
        .sort((first, second) => first.position.x - second.position.x || first.position.y - second.position.y)
        .forEach((node) => graph.setNode(node.id, { width: node.width, height: node.height }));

    const edgeKeys = new Set<string>();
    connections.forEach((connection) => {
        const fromId = resolveLayoutUnitId(connection.fromNodeId, nodeById);
        const toId = resolveLayoutUnitId(connection.toNodeId, nodeById);
        const edgeKey = `${fromId}:${toId}`;
        if (fromId === toId || !unitIds.has(fromId) || !unitIds.has(toId) || edgeKeys.has(edgeKey)) return;
        edgeKeys.add(edgeKey);
        graph.setEdge(fromId, toId);
    });

    layout(graph, {});

    const currentCenter = boundsCenter(units.map((node) => ({ x: node.position.x, y: node.position.y, width: node.width, height: node.height })));
    const laidOut = units.map((node) => {
        const result = graph.node(node.id) as { x?: number; y?: number } | undefined;
        return {
            id: node.id,
            x: (result?.x ?? node.position.x + node.width / 2) - node.width / 2,
            y: (result?.y ?? node.position.y + node.height / 2) - node.height / 2,
            width: node.width,
            height: node.height,
        };
    });
    const nextCenter = boundsCenter(laidOut);
    const offsetX = currentCenter.x - nextCenter.x;
    const offsetY = currentCenter.y - nextCenter.y;
    const deltas = new Map(
        laidOut.map((result) => {
            const current = nodeById.get(result.id)!;
            return [result.id, { x: result.x + offsetX - current.position.x, y: result.y + offsetY - current.position.y }] as const;
        }),
    );

    return nodes.map((node) => {
        const delta = deltas.get(node.id) || (node.metadata?.groupId ? deltas.get(node.metadata.groupId) : undefined);
        if (!delta) return node;
        return { ...node, position: { x: node.position.x + delta.x, y: node.position.y + delta.y } };
    });
}

function resolveLayoutUnitId(nodeId: string, nodeById: Map<string, CanvasNodeData>) {
    const node = nodeById.get(nodeId);
    if (!node?.metadata?.groupId) return nodeId;
    return nodeById.get(node.metadata.groupId)?.type === CanvasNodeType.Group ? node.metadata.groupId : nodeId;
}

function boundsCenter(items: Array<{ x: number; y: number; width: number; height: number }>) {
    const bounds = items.reduce(
        (current, item) => ({
            left: Math.min(current.left, item.x),
            top: Math.min(current.top, item.y),
            right: Math.max(current.right, item.x + item.width),
            bottom: Math.max(current.bottom, item.y + item.height),
        }),
        { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
    );
    return { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 };
}
