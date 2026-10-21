import { create } from "zustand";

import { createCreativeSkillLibrary } from "@/services/creative-skill-library";
import {
    CREATIVE_SKILL_CANVAS_SELECTION_REQUEST_EVENT,
    CREATIVE_SKILL_CANVAS_SELECTION_RESULT_EVENT,
    CreativeSkillCanvasSelectionError,
    extractCreativeSkillDraftFromCanvasSelection,
    type CreativeSkillCanvasSelectionRequest,
    type CreativeSkillCanvasSelectionResult,
} from "@/lib/creative-skills/draft-sources";
import type {
    CreateCreativeSkillDraftInput,
    CreateCreativeSkillExampleDraftInput,
    CreativeSkillCommandResult,
    CreativeSkillDraft,
    CreativeSkillDesktopPrepareInput,
    CreativeSkillLibrarySnapshot,
    CreativeSkillListItem,
    CreativeSkillTransferInspection,
    PatchCreativeSkillDraft,
} from "@/types/creative-skill";

const library = createCreativeSkillLibrary();

export type CreativeSkillTestRequest = {
    draftId: string;
    expectedRevision: number;
    definitionHash: string;
};

type CreativeSkillStore = {
    hydrated: boolean;
    loading: boolean;
    error?: string;
    snapshot?: CreativeSkillLibrarySnapshot;
    items: CreativeSkillListItem[];
    selectedRecordId?: string;
    transferInspection?: CreativeSkillTransferInspection;
    pendingTestRequest?: CreativeSkillTestRequest;
    load: () => Promise<void>;
    select: (recordId?: string) => void;
    createDraft: (input: CreateCreativeSkillDraftInput) => Promise<CreativeSkillDraft>;
    createExampleDraft: (input: CreateCreativeSkillExampleDraftInput) => Promise<CreativeSkillDraft>;
    createDraftFromCanvasSelection: (request: Omit<CreativeSkillCanvasSelectionRequest, "requestId">) => Promise<CreativeSkillDraft>;
    duplicateAsDraft: (skillId: string) => Promise<CreativeSkillDraft>;
    patchDraft: (draftId: string, expectedRevision: number, patch: PatchCreativeSkillDraft) => Promise<void>;
    discardDraft: (draftId: string, expectedRevision: number) => Promise<void>;
    publishDraft: (draftId: string, expectedRevision: number) => Promise<void>;
    recordTestRun: (draftId: string, expectedRevision: number, definitionHash: string, result: { runId?: string; status: "passed" | "failed"; issues: string[] }) => Promise<void>;
    requestTestRun: (draft: Pick<CreativeSkillDraft, "draftId" | "revision" | "definitionHash">) => void;
    clearTestRequest: () => void;
    deleteSkill: (skillId: string, expectedRevision: number) => Promise<void>;
    setEnabled: (skillId: string, expectedRevision: number, enabled: boolean) => Promise<void>;
    setFavorite: (skillId: string, expectedRevision: number, favorite: boolean) => Promise<void>;
    prepareTransfer: (input: CreativeSkillDesktopPrepareInput) => Promise<CreativeSkillTransferInspection>;
    commitTransfer: (inspectionToken: string) => Promise<CreativeSkillCommandResult>;
    clearTransfer: () => void;
};

let loadPromise: Promise<void> | undefined;
let unsubscribe: (() => void) | undefined;
let reloadGeneration = 0;

export const useCreativeSkillStore = create<CreativeSkillStore>((set, get) => {
    const applySnapshot = (snapshot: CreativeSkillLibrarySnapshot, selectedRecordId = get().selectedRecordId) => {
        const items = library.listSnapshot(snapshot);
        const effectiveSelection = items.some((item) => item.recordId === selectedRecordId)
            ? selectedRecordId
            : items[0]?.recordId;
        set({ snapshot, items, selectedRecordId: effectiveSelection, hydrated: true, loading: false, error: undefined });
    };
    const reload = async () => {
        const generation = ++reloadGeneration;
        const snapshot = await library.readLibrary();
        if (generation === reloadGeneration) applySnapshot(snapshot);
    };
    const mutate = async (operation: () => Promise<unknown>) => {
        set({ loading: true, error: undefined });
        try {
            await operation();
            await reload();
        } catch (error) {
            const message = error instanceof Error ? error.message : "创作 Skill 操作失败";
            set({ loading: false, error: message });
            throw error;
        }
    };

    return {
        hydrated: false,
        loading: false,
        items: [],
        async load() {
            if (loadPromise) return loadPromise;
            set({ loading: true, error: undefined });
            loadPromise = reload()
                .then(() => {
                    if (!unsubscribe) unsubscribe = library.subscribe(() => void reload());
                })
                .catch((error) => {
                    set({ hydrated: true, loading: false, error: error instanceof Error ? error.message : "创作 Skill 载入失败" });
                    throw error;
                })
                .finally(() => { loadPromise = undefined; });
            return loadPromise;
        },
        select(selectedRecordId) {
            set({ selectedRecordId });
        },
        async createDraft(input) {
            let created: CreativeSkillDraft | undefined;
            await mutate(async () => { created = await library.createDraft(input); });
            set({ selectedRecordId: created?.draftId });
            return created!;
        },
        async createExampleDraft(input) {
            let created: CreativeSkillDraft | undefined;
            await mutate(async () => { created = await library.createExampleDraft(input); });
            set({ selectedRecordId: created?.draftId });
            return created!;
        },
        async createDraftFromCanvasSelection(request) {
            const extracted = extractCreativeSkillDraftFromCanvasSelection(request);
            if (!extracted.ok) throw new CreativeSkillCanvasSelectionError(extracted.issues);
            return get().createDraft(extracted.input);
        },
        async duplicateAsDraft(skillId) {
            let created: CreativeSkillDraft | undefined;
            await mutate(async () => { created = await library.duplicateAsDraft(skillId); });
            set({ selectedRecordId: created?.draftId });
            return created!;
        },
        patchDraft(draftId, expectedRevision, patch) {
            return mutate(() => library.patchDraft(draftId, expectedRevision, patch));
        },
        async discardDraft(draftId, expectedRevision) {
            await mutate(() => library.discardDraft(draftId, expectedRevision));
        },
        publishDraft(draftId, expectedRevision) {
            return mutate(() => library.publishDraft(draftId, expectedRevision));
        },
        recordTestRun(draftId, expectedRevision, definitionHash, result) {
            return mutate(() => library.recordTestRun(draftId, expectedRevision, definitionHash, result));
        },
        requestTestRun(draft) {
            const detail: CreativeSkillTestRequest = {
                draftId: draft.draftId,
                expectedRevision: draft.revision,
                definitionHash: draft.definitionHash,
            };
            set({ pendingTestRequest: detail });
            window.dispatchEvent(new CustomEvent("fourj:creative-skill-test-request", {
                detail,
            }));
        },
        clearTestRequest() {
            set({ pendingTestRequest: undefined });
        },
        deleteSkill(skillId, expectedRevision) {
            return mutate(() => library.deleteSkill(skillId, expectedRevision));
        },
        setEnabled(skillId, expectedRevision, enabled) {
            return mutate(() => library.setEnabled(skillId, expectedRevision, enabled));
        },
        setFavorite(skillId, expectedRevision, favorite) {
            return mutate(() => library.setFavorite(skillId, expectedRevision, favorite));
        },
        async prepareTransfer(input) {
            set({ loading: true, error: undefined });
            try {
                const transferInspection = await library.prepareTransfer(input);
                set({ transferInspection, loading: false });
                return transferInspection;
            } catch (error) {
                set({ loading: false, error: error instanceof Error ? error.message : "创作 Skill 文件检查失败" });
                throw error;
            }
        },
        async commitTransfer(inspectionToken) {
            let result: CreativeSkillCommandResult | undefined;
            await mutate(async () => { result = await library.commitTransfer(inspectionToken); });
            set({ transferInspection: undefined });
            return result!;
        },
        clearTransfer() {
            set({ transferInspection: undefined });
        },
    };
});

installCanvasSelectionRequestListener();

function installCanvasSelectionRequestListener() {
    if (typeof window === "undefined") return;
    const listenerKey = "__fourjCreativeSkillCanvasSelectionListener";
    const eventWindow = window as Window & { [listenerKey]?: true };
    if (eventWindow[listenerKey]) return;
    eventWindow[listenerKey] = true;
    window.addEventListener(CREATIVE_SKILL_CANVAS_SELECTION_REQUEST_EVENT, (event) => {
        const request = event.detail;
        void useCreativeSkillStore.getState().createDraftFromCanvasSelection(request)
            .then((draft) => dispatchCanvasSelectionResult({ requestId: request.requestId, status: "created", draftId: draft.draftId }))
            .catch((error) => dispatchCanvasSelectionResult({
                requestId: request.requestId,
                status: "rejected",
                issues: error instanceof CreativeSkillCanvasSelectionError ? error.issues : [error instanceof Error ? error.message : "创作 Skill 草稿创建失败"],
            }));
    });
}

function dispatchCanvasSelectionResult(detail: CreativeSkillCanvasSelectionResult) {
    window.dispatchEvent(new CustomEvent(CREATIVE_SKILL_CANVAS_SELECTION_RESULT_EVENT, { detail }));
}
