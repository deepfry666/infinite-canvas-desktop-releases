import { createGenerationRuntime } from "@/lib/canvas/generation-runtime";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";
import { setGenerationActivity } from "@/services/generation-activity";

export const canvasGenerationRuntime = createGenerationRuntime<CanvasNodeData, CanvasConnection>({
    readProject: (projectId) => useCanvasStore.getState().openProject(projectId),
    writeProject: (projectId, patch) => useCanvasStore.getState().updateProject(projectId, patch),
    onActivityChange: (projectId, count) => setGenerationActivity(`canvas:${projectId}`, count),
});
