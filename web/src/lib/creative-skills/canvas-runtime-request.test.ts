import assert from "node:assert/strict";
import test from "node:test";

import { createCreativeSkillRunLedger, type CreativeSkillRunSnapshot } from "../creative-skill-run-ledger.ts";
import { createCreativeSkillRunner, readCreativeSkillRecoverySnapshot, type CreativeSkillRecoverySnapshot } from "../creative-skill-runner.ts";
import type { AgentCreativeSkillExecution } from "../../stores/use-agent-store.ts";
import { buildCanvasCreativeSkillRunRequest } from "./canvas-runtime-request.ts";

function memoryStorage<T>() {
    let value: T | undefined;
    return {
        read: async () => structuredClone(value),
        write: async (next: T) => { value = structuredClone(next); },
    };
}

function strictRecoveryStorage() {
    let value: CreativeSkillRecoverySnapshot | undefined;
    return {
        read: async () => value ? readCreativeSkillRecoverySnapshot(structuredClone(value)) : undefined,
        write: async (next: CreativeSkillRecoverySnapshot, expectedRevision?: number) => {
            assert.equal(expectedRevision, value?.revision || 0);
            value = await readCreativeSkillRecoverySnapshot(structuredClone(next));
        },
        snapshot: () => structuredClone(value),
    };
}

const execution = (): AgentCreativeSkillExecution => ({
    commandId: "command-1",
    mode: "production",
    skill: { skillId: "builtin.poster", versionId: "version-1", definitionHash: "definition-1", name: "编辑海报", source: "builtin" },
    recipe: {
        schemaVersion: 1,
        kind: "linear-image",
        parameters: [{ key: "user-request", label: "创作要求", type: "text", required: true }],
        steps: [{ operation: "image.edit", references: [{ type: "input-target" }], prompt: [{ type: "parameter", key: "user-request" }] }],
        finalOutputCount: 1,
    },
    parameters: { "user-request": "转换为独立杂志编辑感的艺术海报" },
    anchorNodeId: "node-1",
    targetNodeId: "node-1",
});

test("画布运行时只把允许的 Skill 字段写入严格恢复计划", async () => {
    const recoveryStorage = strictRecoveryStorage();
    let ids = 0;
    let providerCalls = 0;
    const runner = createCreativeSkillRunner({
        ledger: createCreativeSkillRunLedger({ storage: memoryStorage<CreativeSkillRunSnapshot>(), createId: () => `ledger-${++ids}`, now: () => 1000 + ids }),
        recoveryStorage,
        createId: () => `runner-${++ids}`,
        now: () => 2000 + ids,
        provider: async (input) => {
            providerCalls += 1;
            await input.onRemoteHandle({ taskId: "remote-1" });
            throw Object.assign(new Error("任务仍在处理中"), { pending: true, taskId: "remote-1" });
        },
        resolveImage: async (image) => ({ ...image, dataUrl: "data:image/png;base64,AAAA" }),
        storeOutput: async () => { throw new Error("不应保存输出"); },
        materializeOutput: async () => { throw new Error("不应物化输出"); },
    });
    const request = buildCanvasCreativeSkillRunRequest({
        execution: execution(),
        projectId: "project-1",
        target: { sha256: "a".repeat(64), nodeId: "node-1" },
        references: [],
        assets: [],
        provider: { model: "image-model", size: "4:5", quality: "high" },
    });

    const run = await runner.run(request);
    const snapshot = recoveryStorage.snapshot();

    assert.equal(run.phase, "waiting-provider");
    assert.equal(providerCalls, 1);
    assert.equal(snapshot?.entries.length, 1);
    assert.deepEqual(snapshot?.entries[0].skill, {
        skillId: "builtin.poster",
        versionId: "version-1",
        definitionHash: "definition-1",
        nameSnapshot: "编辑海报",
        source: "builtin",
    });
    assert.equal(Object.hasOwn(snapshot!.entries[0].skill, "name"), false);
    await readCreativeSkillRecoverySnapshot(snapshot);
});

test("恢复计划接受 Recipe 允许的负整数参数", async () => {
    const recoveryStorage = strictRecoveryStorage();
    const input = execution();
    input.recipe.parameters.push({ key: "offset", label: "偏移", type: "integer", required: true, min: -2, max: 2, step: 1, default: -1 });
    input.recipe.steps[0].prompt.push({ type: "parameter", key: "offset" });
    input.parameters.offset = -1;
    let ids = 0;
    let providerCalls = 0;
    const runner = createCreativeSkillRunner({
        ledger: createCreativeSkillRunLedger({ storage: memoryStorage<CreativeSkillRunSnapshot>(), createId: () => `ledger-${++ids}`, now: () => 1000 + ids }),
        recoveryStorage,
        createId: () => `runner-${++ids}`,
        now: () => 2000 + ids,
        provider: async (providerInput) => {
            providerCalls += 1;
            await providerInput.onRemoteHandle({ taskId: "remote-negative" });
            throw Object.assign(new Error("任务仍在处理中"), { pending: true, taskId: "remote-negative" });
        },
        resolveImage: async (image) => ({ ...image, dataUrl: "data:image/png;base64,AAAA" }),
        storeOutput: async () => { throw new Error("不应保存输出"); },
        materializeOutput: async () => { throw new Error("不应物化输出"); },
    });
    const request = buildCanvasCreativeSkillRunRequest({
        execution: input,
        projectId: "project-1",
        target: { sha256: "a".repeat(64), nodeId: "node-1" },
        references: [],
        assets: [],
        provider: { model: "image-model" },
    });

    const run = await runner.run(request);

    assert.equal(run.phase, "waiting-provider");
    assert.equal(providerCalls, 1);
    assert.equal(recoveryStorage.snapshot()?.entries[0].plan.parameterValues.offset, -1);
});
