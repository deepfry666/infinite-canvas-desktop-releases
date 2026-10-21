import assert from "node:assert/strict";
import test from "node:test";

import {
    BUILTIN_CREATIVE_SKILLS,
    createCreativeSkillLibrary,
    createDesktopCreativeSkillLibraryAdapter,
    createMemoryCreativeSkillLibraryAdapter,
} from "./creative-skill-library.ts";
import type { CreativeSkillCommandAdapter, CreativeSkillLibrarySnapshot } from "../types/creative-skill.ts";

function createLibrary() {
    return createCreativeSkillLibrary({
        adapter: createMemoryCreativeSkillLibraryAdapter(),
        createId: (() => {
            let id = 0;
            return () => `test-${++id}`;
        })(),
        now: (() => {
            let now = Date.parse("2026-08-21T08:00:00.000Z");
            return () => new Date(now++).toISOString();
        })(),
    });
}

function definition(prompt: string) {
    return {
        schemaVersion: 1 as const,
        kind: "linear-image" as const,
        parameters: [{ key: "user-request", label: "创作要求", type: "text" as const, required: true }],
        steps: [{
            operation: "image.edit" as const,
            references: [{ type: "input-target" as const }],
            prompt: [{ type: "literal" as const, text: prompt }, { type: "parameter" as const, key: "user-request" }],
        }],
        finalOutputCount: 1,
    };
}

test("fresh library exposes a verified built-in creative Skill", async () => {
    const library = createLibrary();

    const snapshot = await library.readLibrary();

    assert.equal(snapshot.skills.length, 1);
    assert.equal(snapshot.skills[0].ownership, "builtin");
    assert.equal(snapshot.skills[0].trust, "builtin-verified");
    assert.equal(snapshot.skills[0].activeRevision, snapshot.skills[0].versions[0].versionId);
});

test("listLibrary searches and filters built-in, personal, and draft records", async () => {
    const library = createLibrary();
    await library.createDraft({
        name: "留白水墨",
        description: "从画布流程整理的个人 Skill",
        definition: definition("水墨留白"),
    });

    assert.equal((await library.listLibrary({ ownership: "builtin" })).length, 1);
    assert.equal((await library.listLibrary({ ownership: "personal" })).length, 1);
    assert.equal((await library.listLibrary({ lifecycle: "draft" })).length, 1);
    assert.equal((await library.listLibrary({ query: "水墨" }))[0].name, "留白水墨");
});

test("creating drafts returns the command identity even when timestamps match", async () => {
    let id = 0;
    const library = createCreativeSkillLibrary({
        adapter: createMemoryCreativeSkillLibraryAdapter(),
        createId: () => `same-time-${++id}`,
        now: () => "2026-08-21T08:00:00.000Z",
    });

    const first = await library.createDraft({ name: "第一份", definition: definition("第一份") });
    const second = await library.createDraft({ name: "第二份", definition: definition("第二份") });

    assert.equal(first.draftId, "same-time-1");
    assert.equal(second.draftId, "same-time-2");
});

test("stale expected revision cannot overwrite a newer draft", async () => {
    const library = createLibrary();
    const draft = await library.createDraft({
        name: "纸雕光影",
        description: "第一版",
        definition: definition("纸雕"),
    });

    await library.patchDraft(draft.draftId, draft.revision, { description: "第二版" });

    await assert.rejects(
        () => library.patchDraft(draft.draftId, draft.revision, { description: "过期覆盖" }),
        /草稿已被更新/,
    );
});

test("an untested draft cannot be published", async () => {
    const library = createLibrary();
    const draft = await library.createDraft({
        name: "版式测试",
        description: "尚未试跑",
        definition: definition("编辑海报"),
    });

    await assert.rejects(() => library.publishDraft(draft.draftId, draft.revision), /通过试跑/);
});

test("only a successful test run for the current definition opens the publishing gate", async () => {
    const library = createLibrary();
    const draft = await library.createDraft({
        name: "试跑门禁",
        definition: definition("当前定义"),
    });

    await assert.rejects(
        () => library.recordTestRun(draft.draftId, draft.revision, "sha256:stale", { status: "passed", issues: [] }),
        /定义已变更/,
    );

    const tested = await library.recordTestRun(draft.draftId, draft.revision, draft.definitionHash, {
        runId: "run-1",
        status: "passed",
        issues: [],
    });
    const testedDraft = tested.drafts.find((item) => item.draftId === draft.draftId)!;
    assert.equal(testedDraft.testRun.runId, "run-1");
    assert.equal(testedDraft.testRun.definitionHash, testedDraft.definitionHash);

    const published = await library.publishDraft(testedDraft.draftId, testedDraft.revision);
    assert.equal(published.drafts.length, 0);
    assert.equal(published.skills.some((item) => item.skillId === testedDraft.skillId), true);
});

test("deleting a built-in creative Skill is rejected", async () => {
    const library = createLibrary();
    const builtin = (await library.readLibrary()).skills[0];

    await assert.rejects(() => library.deleteSkill(builtin.skillId, builtin.revision), /内置.*不能删除/);
});

test("renderer import cannot commit without a verified inspection token", async () => {
    const library = createLibrary();

    const inspection = await library.prepareImport();

    assert.equal(inspection.canCommit, false);
    await assert.rejects(() => library.commitImport(inspection.inspectionToken), /尚未通过安全检查/);
});

test("export uses a verified prepare and commit transaction", async () => {
    const empty: CreativeSkillLibrarySnapshot = { schemaVersion: 1, revision: 0, skills: [], drafts: [] };
    let prepared = false;
    let committed = false;
    const adapter: CreativeSkillCommandAdapter = {
        mode: "command",
        async read() { return empty; },
        async execute() { return { snapshot: empty }; },
        async prepare(input) {
            assert.equal(input.kind, "export");
            prepared = true;
            return {
                inspectionToken: "export-token",
                operation: "export",
                status: "verified",
                canCommit: true,
                packageName: "editorial-poster.fourj-skill",
                summary: { id: BUILTIN_CREATIVE_SKILLS[0].skillId, name: BUILTIN_CREATIVE_SKILLS[0].name, description: BUILTIN_CREATIVE_SKILLS[0].description, assetCount: 0 },
                issues: [],
            };
        },
        async commit(token) {
            assert.equal(token, "export-token");
            committed = true;
            return { snapshot: empty, exported: { fileName: "editorial-poster.fourj-skill" } };
        },
    };
    const library = createCreativeSkillLibrary({ adapter });

    const inspection = await library.prepareTransfer({ kind: "export", skillId: BUILTIN_CREATIVE_SKILLS[0].skillId });
    const result = await library.commitTransfer(inspection.inspectionToken);

    assert.equal(prepared, true);
    assert.equal(committed, true);
    assert.equal(result.exported?.fileName, "editorial-poster.fourj-skill");
});

test("desktop adapter fails closed when the creative Skill bridge is missing", async () => {
    const adapter = createDesktopCreativeSkillLibraryAdapter();
    await assert.rejects(() => adapter.read(), /拒绝回退到浏览器存储/);
});

test("an unhealthy published version cannot be enabled", async () => {
    const unhealthy = structuredClone(BUILTIN_CREATIVE_SKILLS[0]);
    unhealthy.skillId = "personal.unhealthy";
    unhealthy.ownership = "personal";
    unhealthy.source = "manual";
    unhealthy.enabled = false;
    unhealthy.versions[0].health = { status: "broken", issues: ["缺少模型能力"] };
    const library = createCreativeSkillLibrary({
        adapter: createMemoryCreativeSkillLibraryAdapter({
            schemaVersion: 1,
            revision: 1,
            skills: [unhealthy],
            drafts: [],
        }),
    });

    await assert.rejects(() => library.setEnabled(unhealthy.skillId, unhealthy.revision, true), /健康检查/);
});
