export type GenerationRequest = {
    targetNodeId: string;
    originNodeId: string;
    runningNodeId: string;
};

type ProjectShape<Node, Connection> = { nodes: Node[]; connections: Connection[] };
type ProjectPatch<Node, Connection> = Partial<ProjectShape<Node, Connection>> & { runningNodeIds?: Set<string> };
type RuntimeAdapter<Node, Connection> = {
    readProject: (projectId: string) => ProjectShape<Node, Connection> | null;
    writeProject: (projectId: string, patch: ProjectPatch<Node, Connection>) => void;
    onActivityChange?: (projectId: string, count: number) => void;
};

export function mergeHydratedSnapshot<Item extends { id: string }>(source: Item[], hydrated: Item[], latest: Item[]) {
    const sourceById = new Map(source.map((item) => [item.id, item]));
    const hydratedById = new Map(hydrated.map((item) => [item.id, item]));
    return latest.map((item) => (sourceById.get(item.id) === item ? hydratedById.get(item.id) || item : item));
}

export function createGenerationRuntime<Node, Connection>(adapter: RuntimeAdapter<Node, Connection>) {
    const requests = new Map<string, GenerationRequest & { controller: AbortController }>();
    const listeners = new Map<string, Set<(patch: ProjectPatch<Node, Connection>) => void>>();
    const requestKey = (projectId: string, targetNodeId: string) => `${projectId}:${targetNodeId}`;
    const notify = (projectId: string, patch: ProjectPatch<Node, Connection>) => listeners.get(projectId)?.forEach((listener) => listener(patch));
    const runningNodeIds = (projectId: string) =>
        new Set(
            Array.from(requests.entries())
                .filter(([key]) => key.startsWith(`${projectId}:`))
                .map(([, request]) => request.runningNodeId),
        );
    const stopRequests = (projectId: string, matches: (request: GenerationRequest) => boolean) => {
        const controllers = new Set<AbortController>();
        requests.forEach((request, key) => {
            if (key.startsWith(`${projectId}:`) && matches(request)) controllers.add(request.controller);
        });
        const affectedNodeIds = new Set<string>();
        if (!controllers.size) return affectedNodeIds;
        requests.forEach((request, key) => {
            if (!key.startsWith(`${projectId}:`) || !controllers.has(request.controller)) return;
            request.controller.abort();
            requests.delete(key);
            affectedNodeIds.add(request.targetNodeId);
            affectedNodeIds.add(request.originNodeId);
            affectedNodeIds.add(request.runningNodeId);
        });
        adapter.onActivityChange?.(projectId, runningNodeIds(projectId).size);
        notify(projectId, { runningNodeIds: runningNodeIds(projectId) });
        return affectedNodeIds;
    };

    return {
        start(projectId: string, request: GenerationRequest, controller = new AbortController()) {
            const key = requestKey(projectId, request.targetNodeId);
            const previous = requests.get(key);
            if (previous?.controller !== controller) previous?.controller.abort();
            requests.set(key, { ...request, controller });
            adapter.onActivityChange?.(projectId, runningNodeIds(projectId).size);
            notify(projectId, { runningNodeIds: runningNodeIds(projectId) });
            return controller;
        },
        finish(projectId: string, targetNodeId: string, controller: AbortController) {
            const key = requestKey(projectId, targetNodeId);
            if (requests.get(key)?.controller === controller) {
                requests.delete(key);
                adapter.onActivityChange?.(projectId, runningNodeIds(projectId).size);
                notify(projectId, { runningNodeIds: runningNodeIds(projectId) });
            }
        },
        stopByRunningId(projectId: string, runningNodeId: string) {
            return stopRequests(projectId, (request) => request.runningNodeId === runningNodeId);
        },
        stopByNodeId(projectId: string, nodeId: string) {
            return stopRequests(projectId, (request) => request.targetNodeId === nodeId || request.originNodeId === nodeId || request.runningNodeId === nodeId);
        },
        activeTargetIds(projectId: string) {
            return new Set(
                Array.from(requests.entries())
                    .filter(([key]) => key.startsWith(`${projectId}:`))
                    .map(([, request]) => request.targetNodeId),
            );
        },
        activeRunningIds(projectId: string) {
            return runningNodeIds(projectId);
        },
        isNodeActive(projectId: string, nodeId: string) {
            return Array.from(requests.entries()).some(([key, request]) => key.startsWith(`${projectId}:`) && (request.targetNodeId === nodeId || request.originNodeId === nodeId || request.runningNodeId === nodeId));
        },
        updateNodes(projectId: string, update: (nodes: Node[]) => Node[]) {
            const project = adapter.readProject(projectId);
            if (!project) return;
            const nodes = update(project.nodes);
            adapter.writeProject(projectId, { nodes });
            notify(projectId, { nodes });
        },
        updateConnections(projectId: string, update: (connections: Connection[]) => Connection[]) {
            const project = adapter.readProject(projectId);
            if (!project) return;
            const connections = update(project.connections);
            adapter.writeProject(projectId, { connections });
            notify(projectId, { connections });
        },
        subscribe(projectId: string, listener: (patch: ProjectPatch<Node, Connection>) => void) {
            const projectListeners = listeners.get(projectId) || new Set();
            projectListeners.add(listener);
            listeners.set(projectId, projectListeners);
            return () => {
                projectListeners.delete(listener);
                if (!projectListeners.size) listeners.delete(projectId);
            };
        },
    };
}
