import { BUILTIN_CREATIVE_SKILLS } from "../lib/creative-skills/builtins.ts";
import { parseCreativeSkillRecipeV1 } from "../lib/creative-skills/index.ts";
import type {
    CreateCreativeSkillDraftInput,
    CreateCreativeSkillExampleDraftInput,
    CreativeSkill,
    CreativeSkillCommandAdapter,
    CreativeSkillCommandResult,
    CreativeSkillDesktopBridge,
    CreativeSkillDesktopPrepareInput,
    CreativeSkillDraft,
    CreativeSkillLibraryAdapter,
    CreativeSkillLibraryFilter,
    CreativeSkillLibrarySnapshot,
    CreativeSkillListItem,
    CreativeSkillMutationCommand,
    CreativeSkillSnapshotAdapter,
    CreativeSkillTransferInspection,
    CreativeSkillVersion,
    PatchCreativeSkillDraft,
} from "../types/creative-skill.ts";

export { BUILTIN_CREATIVE_SKILLS } from "../lib/creative-skills/builtins.ts";

const STORAGE_KEY = "fourj:creative-skill-library:v1";
const EMPTY_LIBRARY: CreativeSkillLibrarySnapshot = { schemaVersion: 1, revision: 0, skills: [], drafts: [] };

type CreativeSkillLibraryOptions = {
    adapter?: CreativeSkillLibraryAdapter;
    createId?: () => string;
    now?: () => string;
};

export function createCreativeSkillLibrary({
    adapter = createDefaultCreativeSkillLibraryAdapter(),
    createId = () => globalThis.crypto.randomUUID(),
    now = () => new Date().toISOString(),
}: CreativeSkillLibraryOptions = {}) {
    let queue = Promise.resolve();
    const inspections = new Map<string, CreativeSkillTransferInspection>();
    const enqueue = <T>(operation: () => Promise<T>) => {
        const result = queue.catch(() => undefined).then(operation);
        queue = result.then(() => undefined, () => undefined);
        return result;
    };
    const readRaw = async () => normalizeSnapshot(await adapter.read());
    const run = (command: CreativeSkillMutationCommand) => enqueue(async (): Promise<CreativeSkillCommandResult> => {
        if (adapter.mode === "command") {
            const result = await adapter.execute(command);
            return { ...result, snapshot: normalizeSnapshot(result.snapshot) };
        }
        const current = await readRaw();
        const next = await applySnapshotCommand(current, command, { createId, now });
        await adapter.write(stripUnchangedBuiltins(next), current.revision);
        const createdDraft = next.drafts.find((draft) => !current.drafts.some((currentDraft) => currentDraft.draftId === draft.draftId));
        return {
            snapshot: normalizeSnapshot(next),
            ...(createdDraft ? { changed: { draftId: createdDraft.draftId } } : {}),
        };
    });
    const prepareTransfer = async (input: CreativeSkillDesktopPrepareInput) => {
        if (input.kind === "export") {
            const skill = (await readRaw()).skills.find((item) => item.skillId === input.skillId);
            if (!skill) throw new Error("创作 Skill 不存在");
            if (input.versionId && !skill.versions.some((version) => version.versionId === input.versionId))
                throw new Error("创作 Skill 版本不存在");
        }
        const inspection = adapter.mode === "command"
            ? await adapter.prepare(input)
            : unavailableInspection(createId(), input.kind === "export" ? "export" : "import");
        inspections.set(inspection.inspectionToken, inspection);
        return structuredClone(inspection);
    };
    const commitTransfer = async (inspectionToken: string) => {
        const inspection = inspections.get(inspectionToken);
        if (!inspection || inspection.status !== "verified" || !inspection.canCommit)
            throw new Error(`${inspection?.operation === "export" ? "导出" : "导入"}尚未通过安全检查，不能继续`);
        if (inspection.expiresAt && Date.parse(inspection.expiresAt) <= Date.now()) {
            inspections.delete(inspectionToken);
            throw new Error("安全检查已过期，请重新准备");
        }
        inspections.delete(inspectionToken);
        if (adapter.mode !== "command") throw new Error("当前环境不支持创作 Skill 文件传输");
        const result = await adapter.commit(inspectionToken);
        return { ...result, snapshot: normalizeSnapshot(result.snapshot) };
    };

    return {
        async readLibrary() {
            return readRaw();
        },
        async listLibrary(filter: CreativeSkillLibraryFilter = {}) {
            return filterItems(toListItems(await readRaw()), filter);
        },
        listSnapshot(snapshot: CreativeSkillLibrarySnapshot, filter: CreativeSkillLibraryFilter = {}) {
            return filterItems(toListItems(normalizeSnapshot(snapshot)), filter);
        },
        async createDraft(input: CreateCreativeSkillDraftInput) {
            const result = await run({ type: "create-draft", input });
            return changedDraft(result);
        },
        async createExampleDraft(input: CreateCreativeSkillExampleDraftInput) {
            if (adapter.mode !== "command") throw new Error("当前环境不支持持久化样例图片");
            const result = await run({ type: "create-example-draft", input });
            return changedDraft(result);
        },
        async duplicateAsDraft(skillId: string) {
            const result = await run({ type: "duplicate-as-draft", skillId });
            return changedDraft(result);
        },
        async patchDraft(draftId: string, expectedRevision: number, patch: PatchCreativeSkillDraft) {
            const { snapshot } = await run({ type: "patch-draft", draftId, expectedRevision, patch });
            const draft = snapshot.drafts.find((item) => item.draftId === draftId);
            if (!draft) throw new Error("创作 Skill 草稿不存在");
            return draft;
        },
        async discardDraft(draftId: string, expectedRevision: number) {
            return (await run({ type: "discard-draft", draftId, expectedRevision })).snapshot;
        },
        async publishDraft(draftId: string, expectedRevision: number) {
            const current = await readRaw();
            assertPublishable(findDraft(current, draftId, expectedRevision));
            return (await run({ type: "publish-draft", draftId, expectedRevision })).snapshot;
        },
        async recordTestRun(draftId: string, expectedRevision: number, definitionHash: string, result: { runId?: string; status: "passed" | "failed"; issues: string[] }) {
            return (await run({ type: "record-test-run", draftId, expectedRevision, definitionHash, ...result })).snapshot;
        },
        async deleteSkill(skillId: string, expectedRevision: number) {
            return (await run({ type: "delete-skill", skillId, expectedRevision })).snapshot;
        },
        async setEnabled(skillId: string, expectedRevision: number, enabled: boolean) {
            const current = await readRaw();
            const skill = findSkill(current, skillId, expectedRevision);
            if (enabled) assertEnableable(skill);
            return (await run({ type: "set-enabled", skillId, expectedRevision, enabled })).snapshot;
        },
        async setFavorite(skillId: string, expectedRevision: number, favorite: boolean) {
            findSkill(await readRaw(), skillId, expectedRevision);
            return (await run({ type: "set-favorite", skillId, expectedRevision, favorite })).snapshot;
        },
        prepareTransfer,
        commitTransfer,
        async prepareImport() {
            return prepareTransfer({ kind: "import", source: "file-picker" });
        },
        async commitImport(inspectionToken: string) {
            return (await commitTransfer(inspectionToken)).snapshot;
        },
        subscribe(listener: () => void) {
            return adapter.mode === "command" && adapter.subscribe ? adapter.subscribe(listener) : () => undefined;
        },
    };
}

export function createMemoryCreativeSkillLibraryAdapter(initial?: CreativeSkillLibrarySnapshot): CreativeSkillSnapshotAdapter {
    let snapshot = initial ? structuredClone(initial) : structuredClone(EMPTY_LIBRARY);
    return {
        mode: "snapshot",
        async read() {
            return structuredClone(snapshot);
        },
        async write(next, expectedRevision) {
            if (snapshot.revision !== expectedRevision) throw new Error("创作 Skill 资料库已被更新，请重新载入");
            snapshot = structuredClone(next);
        },
    };
}

export function createDesktopCreativeSkillLibraryAdapter(bridge?: CreativeSkillDesktopBridge): CreativeSkillCommandAdapter {
    const requireBridge = () => {
        if (!bridge) throw new Error("桌面端创作 Skill 桥接不可用，已拒绝回退到浏览器存储");
        return bridge;
    };
    return {
        mode: "command",
        async read() {
            return (await requireBridge().query()).snapshot;
        },
        execute(command) {
            return requireBridge().execute(command);
        },
        prepare(input) {
            return requireBridge().prepare(input);
        },
        commit(inspectionToken) {
            return requireBridge().commit({ inspectionToken });
        },
        subscribe(listener) {
            return requireBridge().subscribe(() => listener());
        },
    };
}

export function createBrowserCreativeSkillLibraryAdapter(): CreativeSkillSnapshotAdapter {
    return {
        mode: "snapshot",
        async read() {
            const { localForageStorage } = await import("../lib/localforage-storage.ts");
            const value = await localForageStorage.getItem(STORAGE_KEY);
            return value ? JSON.parse(value) as CreativeSkillLibrarySnapshot : undefined;
        },
        async write(snapshot, expectedRevision) {
            const { localForageStorage } = await import("../lib/localforage-storage.ts");
            const current = await localForageStorage.getItem(STORAGE_KEY);
            const revision = current ? (JSON.parse(current) as CreativeSkillLibrarySnapshot).revision : 0;
            if (revision !== expectedRevision) throw new Error("创作 Skill 资料库已被更新，请重新载入");
            await localForageStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
        },
    };
}

function createDefaultCreativeSkillLibraryAdapter() {
    if (typeof window === "undefined") return createMemoryCreativeSkillLibraryAdapter();
    const desktop = window.infiniteCanvasDesktop;
    if (!desktop) return createBrowserCreativeSkillLibraryAdapter();
    const bridge = (desktop as typeof desktop & { creativeSkills?: CreativeSkillDesktopBridge }).creativeSkills;
    return createDesktopCreativeSkillLibraryAdapter(bridge);
}

async function applySnapshotCommand(
    current: CreativeSkillLibrarySnapshot,
    command: CreativeSkillMutationCommand,
    context: { createId: () => string; now: () => string },
): Promise<CreativeSkillLibrarySnapshot> {
    const snapshot = structuredClone(current);
    const timestamp = context.now();
    if (command.type === "create-example-draft") {
        throw new Error("当前环境不支持持久化样例图片");
    } else if (command.type === "create-draft") {
        snapshot.drafts.push(await makeDraft(command.input, context.createId(), timestamp));
    } else if (command.type === "duplicate-as-draft") {
        const source = snapshot.skills.find((item) => item.skillId === command.skillId);
        if (!source) throw new Error("创作 Skill 不存在");
        const version = activeVersion(source);
        snapshot.drafts.push(await makeDraft({ name: `${source.name}副本`, description: source.description, definition: version.definition, source: "manual" }, context.createId(), timestamp));
    } else if (command.type === "patch-draft") {
        const draft = findDraft(snapshot, command.draftId, command.expectedRevision);
        const definition = command.patch.definition ? parseCreativeSkillRecipeV1(command.patch.definition) : draft.definition;
        const definitionHash = await hashDefinition(definition);
        const definitionChanged = definitionHash !== draft.definitionHash;
        Object.assign(draft, command.patch, {
            definition,
            definitionHash,
            revision: draft.revision + 1,
            updatedAt: timestamp,
            validation: { status: "passed", definitionHash, issues: [] },
            testRun: definitionChanged ? { status: "pending", definitionHash, issues: [] } : draft.testRun,
        });
    } else if (command.type === "discard-draft") {
        findDraft(snapshot, command.draftId, command.expectedRevision);
        snapshot.drafts = snapshot.drafts.filter((item) => item.draftId !== command.draftId);
    } else if (command.type === "publish-draft") {
        const draft = findDraft(snapshot, command.draftId, command.expectedRevision);
        assertPublishable(draft);
        const existing = snapshot.skills.find((item) => item.skillId === draft.skillId);
        if (existing?.ownership === "builtin") throw new Error("内置创作 Skill 不能被覆盖");
        const version: CreativeSkillVersion = {
            versionId: draft.definitionHash,
            definitionHash: draft.definitionHash,
            definition: draft.definition,
            validation: draft.validation,
            testRun: draft.testRun,
            compatibility: { status: "compatible", issues: [] },
            health: { status: "healthy", issues: [] },
            publishedAt: timestamp,
        };
        if (existing) {
            existing.revision += 1;
            existing.name = draft.name;
            existing.description = draft.description;
            existing.activeRevision = version.versionId;
            existing.versions = [...existing.versions, version];
            existing.updatedAt = timestamp;
        } else {
            snapshot.skills.push({
                skillId: draft.skillId,
                revision: 1,
                lifecycle: "published",
                ownership: "personal",
                trust: draft.trust,
                source: draft.source,
                name: draft.name,
                description: draft.description,
                enabled: false,
                favorite: false,
                activeRevision: version.versionId,
                versions: [version],
                createdAt: timestamp,
                updatedAt: timestamp,
            });
        }
        snapshot.drafts = snapshot.drafts.filter((item) => item.draftId !== draft.draftId);
    } else if (command.type === "record-test-run") {
        const draft = findDraft(snapshot, command.draftId, command.expectedRevision);
        if (draft.definitionHash !== command.definitionHash)
            throw new Error("创作 Skill 定义已变更，本次试跑结果不能写入");
        draft.testRun = {
            status: command.status,
            definitionHash: command.definitionHash,
            runId: command.runId,
            testedAt: timestamp,
            issues: [...command.issues],
        };
        draft.revision += 1;
        draft.updatedAt = timestamp;
    } else if (command.type === "delete-skill") {
        const skill = findSkill(snapshot, command.skillId, command.expectedRevision);
        if (skill.ownership !== "personal") throw new Error("内置创作 Skill 不能删除");
        snapshot.skills = snapshot.skills.filter((item) => item.skillId !== skill.skillId);
    } else {
        const skill = findSkill(snapshot, command.skillId, command.expectedRevision);
        if (command.type === "set-enabled") {
            if (command.enabled) assertEnableable(skill);
            skill.enabled = command.enabled;
        } else {
            skill.favorite = command.favorite;
        }
        skill.revision += 1;
        skill.updatedAt = timestamp;
    }
    snapshot.revision += 1;
    return snapshot;
}

async function makeDraft(input: CreateCreativeSkillDraftInput, id: string, timestamp: string): Promise<CreativeSkillDraft> {
    const name = input.name.trim();
    if (!name || name.length > 120) throw new Error("创作 Skill 名称无效");
    const description = (input.description || "").trim();
    if (description.length > 1000) throw new Error("创作 Skill 描述无效");
    const definition = parseCreativeSkillRecipeV1(input.definition);
    const definitionHash = await hashDefinition(definition);
    return {
        draftId: id,
        skillId: id,
        revision: 1,
        lifecycle: "draft",
        ownership: "personal",
        trust: "local-reviewed",
        source: input.source || "manual",
        enabled: false,
        name,
        description,
        definition,
        definitionHash,
        validation: { status: "passed", definitionHash, issues: [] },
        testRun: { status: "pending", definitionHash, issues: [] },
        createdAt: timestamp,
        updatedAt: timestamp,
    };
}

function normalizeSnapshot(value?: CreativeSkillLibrarySnapshot): CreativeSkillLibrarySnapshot {
    const stored = value ? structuredClone(value) : structuredClone(EMPTY_LIBRARY);
    if (stored.schemaVersion !== 1 || !Number.isSafeInteger(stored.revision) || !Array.isArray(stored.skills))
        throw new Error("不支持的创作 Skill 资料库版本");
    if (!Array.isArray(stored.drafts)) stored.drafts = [];
    const storedById = new Map(stored.skills.map((skill) => [skill.skillId, skill]));
    const builtins = BUILTIN_CREATIVE_SKILLS.map((canonical) => {
        const preference = storedById.get(canonical.skillId);
        return preference
            ? { ...structuredClone(canonical), revision: preference.revision, enabled: preference.enabled, favorite: preference.favorite, updatedAt: preference.updatedAt }
            : structuredClone(canonical);
    });
    return {
        ...stored,
        skills: [...builtins, ...stored.skills.filter((skill) => skill.ownership !== "builtin" && !storedById.has(skill.skillId) ? true : !BUILTIN_CREATIVE_SKILLS.some((builtin) => builtin.skillId === skill.skillId))],
    };
}

function stripUnchangedBuiltins(snapshot: CreativeSkillLibrarySnapshot) {
    return structuredClone(snapshot);
}

function toListItems(snapshot: CreativeSkillLibrarySnapshot): CreativeSkillListItem[] {
    return [
        ...snapshot.drafts.map((draft): CreativeSkillListItem => ({
            recordId: draft.draftId,
            skillId: draft.skillId,
            revision: draft.revision,
            lifecycle: "draft",
            ownership: "personal",
            trust: draft.trust,
            source: draft.source,
            name: draft.name,
            description: draft.description,
            enabled: false,
            favorite: false,
            draft,
            createdAt: draft.createdAt,
            updatedAt: draft.updatedAt,
        })),
        ...snapshot.skills.map((skill): CreativeSkillListItem => ({
            recordId: skill.skillId,
            skillId: skill.skillId,
            revision: skill.revision,
            lifecycle: "published",
            ownership: skill.ownership,
            trust: skill.trust,
            source: skill.source,
            name: skill.name,
            description: skill.description,
            enabled: skill.enabled,
            favorite: skill.favorite,
            activeRevision: skill.activeRevision,
            version: activeVersion(skill),
            createdAt: skill.createdAt,
            updatedAt: skill.updatedAt,
        })),
    ].sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt.localeCompare(a.updatedAt));
}

function filterItems(items: CreativeSkillListItem[], filter: CreativeSkillLibraryFilter) {
    const query = filter.query?.trim().toLocaleLowerCase();
    return items.filter((item) => {
        if (filter.ownership && item.ownership !== filter.ownership) return false;
        if (filter.lifecycle && item.lifecycle !== filter.lifecycle) return false;
        if (filter.enabled !== undefined && item.enabled !== filter.enabled) return false;
        if (filter.favorite !== undefined && item.favorite !== filter.favorite) return false;
        return !query || `${item.name}\n${item.description}`.toLocaleLowerCase().includes(query);
    });
}

function activeVersion(skill: CreativeSkill) {
    const version = skill.versions.find((item) => item.versionId === skill.activeRevision);
    if (!version) throw new Error("创作 Skill 当前版本不存在");
    return version;
}

function findDraft(snapshot: CreativeSkillLibrarySnapshot, draftId: string, expectedRevision: number) {
    const draft = snapshot.drafts.find((item) => item.draftId === draftId);
    if (!draft) throw new Error("创作 Skill 草稿不存在");
    if (draft.revision !== expectedRevision) throw new Error("创作 Skill 草稿已被更新，请重新载入");
    return draft;
}

function findSkill(snapshot: CreativeSkillLibrarySnapshot, skillId: string, expectedRevision: number) {
    const skill = snapshot.skills.find((item) => item.skillId === skillId);
    if (!skill) throw new Error("创作 Skill 不存在");
    if (skill.revision !== expectedRevision) throw new Error("创作 Skill 已被更新，请重新载入");
    return skill;
}

function assertPublishable(draft: CreativeSkillDraft) {
    if (draft.validation.status !== "passed" || draft.validation.definitionHash !== draft.definitionHash)
        throw new Error("创作 Skill 必须先通过校验才能发布");
    if (draft.testRun.status !== "passed" || draft.testRun.definitionHash !== draft.definitionHash)
        throw new Error("创作 Skill 必须用当前版本通过试跑才能发布");
}

function assertEnableable(skill: CreativeSkill) {
    const version = activeVersion(skill);
    if (version.validation.status !== "passed" || version.testRun.status !== "passed" || version.testRun.definitionHash !== version.definitionHash)
        throw new Error("创作 Skill 当前版本尚未通过试跑");
    if (version.compatibility.status !== "compatible") throw new Error("创作 Skill 当前版本与应用不兼容");
    if (version.health.status !== "healthy") throw new Error("创作 Skill 当前版本未通过健康检查");
}

function changedDraft(result: CreativeSkillCommandResult) {
    const draft = result.snapshot.drafts.find((item) => item.draftId === result.changed?.draftId);
    if (!draft) throw new Error("创作 Skill 草稿创建失败");
    return draft;
}

function unavailableInspection(id: string, operation: CreativeSkillTransferInspection["operation"]): CreativeSkillTransferInspection {
    return {
        inspectionToken: `unavailable:${id}`,
        operation,
        status: "unavailable",
        canCommit: false,
        issues: ["当前环境尚未连接桌面端安全检查器"],
    };
}

async function hashDefinition(definition: unknown) {
    const bytes = new TextEncoder().encode(canonicalJson(definition));
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function canonicalJson(value: unknown): string {
    if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
    if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    if (!value || typeof value !== "object") throw new Error("创作 Skill 定义必须是 JSON 数据");
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
