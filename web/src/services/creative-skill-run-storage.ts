import { localForageStorage } from "../lib/localforage-storage.ts";
import { CreativeSkillRunRevisionConflictError, readCreativeSkillRunSnapshot, type CreativeSkillRunSnapshot, type CreativeSkillRunStorage } from "../lib/creative-skill-run-ledger.ts";
import { CreativeSkillRecoveryRevisionConflictError, readCreativeSkillRecoverySnapshot, type CreativeSkillRecoverySnapshot, type CreativeSkillRecoveryStorage } from "../lib/creative-skill-runner.ts";

export { CreativeSkillRunRevisionConflictError };

export const CREATIVE_SKILL_RUN_STORAGE_KEY = "infinite-canvas:records:creative-skill-runs";
export const CREATIVE_SKILL_RECOVERY_STORAGE_KEY = "infinite-canvas:records:creative-skill-recovery";
let writeQueue = Promise.resolve();

export function createCreativeSkillRunStorage(storage = localForageStorage): CreativeSkillRunStorage {
    return {
        async read() {
            const value = await storage.getItem(CREATIVE_SKILL_RUN_STORAGE_KEY);
            if (!value) return undefined;
            return parseSnapshot(value);
        },
        write(snapshot, expectedRevision) {
            const operation = writeQueue.then(async () => {
                const currentValue = await storage.getItem(CREATIVE_SKILL_RUN_STORAGE_KEY);
                const current = currentValue ? parseSnapshot(currentValue) : undefined;
                if (expectedRevision !== undefined && (current?.revision || 0) !== expectedRevision) throw new CreativeSkillRunRevisionConflictError();
                const validated = readCreativeSkillRunSnapshot(snapshot);
                await storage.setItem(CREATIVE_SKILL_RUN_STORAGE_KEY, JSON.stringify(validated));
            });
            writeQueue = operation.then(() => undefined, () => undefined);
            return operation;
        },
    };
}

export function createCreativeSkillRecoveryStorage(storage = localForageStorage): CreativeSkillRecoveryStorage {
    return {
        async read() {
            const value = await storage.getItem(CREATIVE_SKILL_RECOVERY_STORAGE_KEY);
            if (!value) return undefined;
            return parseRecoverySnapshot(value);
        },
        write(snapshot, expectedRevision) {
            const operation = writeQueue.then(async () => {
                const currentValue = await storage.getItem(CREATIVE_SKILL_RECOVERY_STORAGE_KEY);
                const current = currentValue ? await parseRecoverySnapshot(currentValue) : undefined;
                if (expectedRevision !== undefined && (current?.revision || 0) !== expectedRevision) throw new CreativeSkillRecoveryRevisionConflictError();
                const validated = await readCreativeSkillRecoverySnapshot(snapshot);
                await storage.setItem(CREATIVE_SKILL_RECOVERY_STORAGE_KEY, JSON.stringify(validated));
            });
            writeQueue = operation.then(() => undefined, () => undefined);
            return operation;
        },
    };
}

function parseSnapshot(value: string): CreativeSkillRunSnapshot {
    try {
        return readCreativeSkillRunSnapshot(JSON.parse(value));
    } catch (error) {
        if (error instanceof SyntaxError) throw new Error("创作 Skill 运行记录已损坏，已拒绝覆盖原文件");
        throw error;
    }
}

async function parseRecoverySnapshot(value: string): Promise<CreativeSkillRecoverySnapshot> {
    try {
        return await readCreativeSkillRecoverySnapshot(JSON.parse(value));
    } catch {
        throw new Error("创作 Skill 恢复计划已损坏，已拒绝覆盖原记录");
    }
}
