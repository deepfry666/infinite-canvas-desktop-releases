import assert from "node:assert/strict";
import test from "node:test";

import type { CreativeSkillRunOutput, CreativeSkillRunRecord } from "../creative-skill-run-ledger.ts";
import { materializeCreativeSkillOutput } from "./creative-skill-materialization.ts";
import { CanvasNodeType, type CanvasCreativeSkillProvenance, type CanvasNodeData } from "../../types/canvas.ts";

const anchor: CanvasNodeData = {
    id: "source",
    type: CanvasNodeType.Image,
    title: "原图",
    position: { x: 100, y: 120 },
    width: 320,
    height: 240,
    metadata: { content: "source-url", status: "success" },
};

const run = {
    runId: "run-1",
    skill: { nameSnapshot: "编辑海报" },
} as CreativeSkillRunRecord;

const output: CreativeSkillRunOutput = {
    outputId: "run-1:step-0:output-0",
    stepIndex: 0,
    storageKey: "workspace:assets/images/result.png",
    url: "workspace://local/assets/images/result.png",
    mimeType: "image/png",
    bytes: 2048,
    width: 1200,
    height: 1600,
};

const provenance: CanvasCreativeSkillProvenance = {
    skillId: "fourj.editorial-poster-v1",
    skillRevision: "sha256:version",
    runId: run.runId,
    stepIndex: 0,
    outputId: output.outputId,
    sourceNodeIds: [anchor.id],
    createdAt: "2026-08-21T00:00:00.000Z",
};

test("stored Skill output becomes a linked image child with provenance", () => {
    const result = materializeCreativeSkillOutput(
        { nodes: [anchor], connections: [] },
        { run, output, anchorNodeId: anchor.id, provenance },
        () => "generated-id",
    );

    assert.equal(result.created, true);
    assert.equal(result.nodeId, "skill-output-generated-id");
    assert.equal(result.nodes.length, 2);
    assert.deepEqual(result.nodes[1].metadata?.creativeSkill, provenance);
    assert.equal(result.nodes[1].metadata?.storageKey, output.storageKey);
    assert.equal(result.nodes[1].position.x, anchor.position.x + anchor.width + 80);
    assert.deepEqual(result.connections, [{ id: "skill-connection-generated-id", fromNodeId: anchor.id, toNodeId: result.nodeId }]);
});

test("recovery reuses an existing output node and only repairs its missing link", () => {
    const first = materializeCreativeSkillOutput(
        { nodes: [anchor], connections: [] },
        { run, output, anchorNodeId: anchor.id, provenance },
        () => "generated-id",
    );
    const recovered = materializeCreativeSkillOutput(
        { nodes: first.nodes, connections: [] },
        { run, output, anchorNodeId: anchor.id, provenance },
        () => "second-id",
    );

    assert.equal(recovered.created, false);
    assert.equal(recovered.nodeId, first.nodeId);
    assert.equal(recovered.nodes, first.nodes);
    assert.deepEqual(recovered.connections, [{ id: "skill-connection-second-id", fromNodeId: anchor.id, toNodeId: first.nodeId }]);
});

test("materialization rejects a deleted anchor instead of creating an orphan", () => {
    assert.throws(
        () => materializeCreativeSkillOutput(
            { nodes: [], connections: [] },
            { run, output, anchorNodeId: anchor.id, provenance },
            () => "generated-id",
        ),
        /锚点节点已不存在/,
    );
});
