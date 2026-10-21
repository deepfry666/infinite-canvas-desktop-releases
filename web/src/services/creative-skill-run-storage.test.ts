import assert from "node:assert/strict";
import test from "node:test";

import {
    CREATIVE_SKILL_RECOVERY_STORAGE_KEY,
    CREATIVE_SKILL_RUN_STORAGE_KEY,
    createCreativeSkillRecoveryStorage,
    createCreativeSkillRunStorage,
} from "./creative-skill-run-storage.ts";

test("运行账本在 CAS 写入前拒绝覆盖损坏的 run 条目", async () => {
    const damaged = JSON.stringify({ schemaVersion: 1, revision: 1, runs: [{ runId: "broken-run" }] });
    let stored = damaged;
    const stateStorage = {
        getItem: async (name: string) => name === CREATIVE_SKILL_RUN_STORAGE_KEY ? stored : null,
        setItem: async (name: string, value: string) => {
            if (name === CREATIVE_SKILL_RUN_STORAGE_KEY) stored = value;
        },
        removeItem: async () => undefined,
    };
    const storage = createCreativeSkillRunStorage(stateStorage);

    await assert.rejects(
        () => storage.write({ schemaVersion: 1, revision: 2, runs: [] }, 1),
        /数据损坏|已拒绝覆盖/,
    );
    assert.equal(stored, damaged);
});

test("恢复存储在 CAS 写入前拒绝覆盖结构损坏的原记录", async () => {
    const damaged = JSON.stringify({
        schemaVersion: 1,
        revision: 1,
        entries: [{ runId: "broken-run", planHash: `sha256:${"a".repeat(64)}`, calls: [] }],
    });
    let stored = damaged;
    const stateStorage = {
        getItem: async (name: string) => name === CREATIVE_SKILL_RECOVERY_STORAGE_KEY ? stored : null,
        setItem: async (name: string, value: string) => {
            if (name === CREATIVE_SKILL_RECOVERY_STORAGE_KEY) stored = value;
        },
        removeItem: async () => undefined,
    };
    const storage = createCreativeSkillRecoveryStorage(stateStorage);

    await assert.rejects(
        () => storage.write({ schemaVersion: 1, revision: 2, entries: [] }, 1),
        /数据损坏|已拒绝覆盖/,
    );
    assert.equal(stored, damaged);
});
