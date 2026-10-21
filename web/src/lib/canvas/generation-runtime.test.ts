import assert from "node:assert/strict";
import test from "node:test";

import { createGenerationRuntime, mergeHydratedSnapshot } from "./generation-runtime.ts";

test("离开页面后生成任务仍会更新项目并保持运行状态", () => {
    let project = { nodes: [{ id: "result", status: "loading" }], connections: [] as unknown[] };
    const runtime = createGenerationRuntime({
        readProject: () => project,
        writeProject: (_projectId, patch) => {
            project = { ...project, ...patch };
        },
    });
    const controller = runtime.start("project-1", { targetNodeId: "result", originNodeId: "prompt", runningNodeId: "prompt" });

    runtime.updateNodes("project-1", (nodes) => nodes.map((node) => (node.id === "result" ? { ...node, status: "success" } : node)));

    assert.equal(project.nodes[0].status, "success");
    assert.deepEqual(runtime.activeTargetIds("project-1"), new Set(["result"]));
    assert.deepEqual(runtime.activeRunningIds("project-1"), new Set(["prompt"]));
    runtime.finish("project-1", "result", controller);
    assert.equal(runtime.activeTargetIds("project-1").size, 0);
    assert.equal(runtime.activeRunningIds("project-1").size, 0);
});

test("生成结束后会通知重新打开的画布清除运行状态", () => {
    const runtime = createGenerationRuntime({
        readProject: () => ({ nodes: [], connections: [] }),
        writeProject: () => undefined,
    });
    const runningSnapshots: string[][] = [];
    runtime.subscribe("project-1", (update) => {
        if (update.runningNodeIds) runningSnapshots.push([...update.runningNodeIds]);
    });

    const controller = runtime.start("project-1", { targetNodeId: "result", originNodeId: "prompt", runningNodeId: "prompt" });
    runtime.finish("project-1", "result", controller);

    assert.deepEqual(runningSnapshots, [["prompt"], []]);
});

test("恢复画布时保留并发生成写回，只复用未变化节点的已恢复地址", () => {
    const unchanged = { id: "old-image", content: "blob:stale" };
    const generating = { id: "result", status: "loading" };
    const source = [unchanged, generating];
    const hydrated = [{ ...unchanged, content: "workspace://local/old.png" }, generating];
    const completed = { ...generating, status: "success", content: "workspace://local/new.png" };

    assert.deepEqual(mergeHydratedSnapshot(source, hydrated, [unchanged, completed]), [hydrated[0], completed]);
});
