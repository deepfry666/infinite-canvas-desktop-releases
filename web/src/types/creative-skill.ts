import type { CreativeSkillRecipeV1 } from "@/lib/creative-skills";

export const CREATIVE_SKILL_LIBRARY_SCHEMA_VERSION = 1 as const;

export type CreativeSkillOwnership = "builtin" | "personal";
export type CreativeSkillSource = "builtin" | "manual" | "canvas" | "package" | "skill-markdown";
export type CreativeSkillTrust = "builtin-verified" | "local-reviewed" | "external-unverified" | "markdown-quarantined";
export type CreativeSkillLifecycle = "draft" | "published";
export type CreativeSkillGateStatus = "pending" | "passed" | "failed";

export type CreativeSkillDefinition = CreativeSkillRecipeV1;

export type CreativeSkillAssetDescriptor = {
    sha256: string;
    mimeType: "image/png" | "image/jpeg" | "image/webp";
    bytes: number;
    width: number;
    height: number;
};

export type CreativeSkillExampleFixture = {
    input: CreativeSkillAssetDescriptor;
    expectedOutput: CreativeSkillAssetDescriptor;
};

export type CreativeSkillExampleImageInput = {
    sha256: string;
    mimeType: CreativeSkillAssetDescriptor["mimeType"];
    data: ArrayBuffer;
};

export type CreativeSkillQuarantineDescriptor = {
    sha256: string;
    byteLength: number;
    originalName: "SKILL.md";
};

export type CreativeSkillValidation = {
    status: CreativeSkillGateStatus;
    definitionHash: string;
    issues: string[];
};

export type CreativeSkillTestRun = {
    status: CreativeSkillGateStatus;
    definitionHash: string;
    runId?: string;
    testedAt?: string;
    issues: string[];
};

export type CreativeSkillVersion = {
    versionId: string;
    definitionHash: string;
    definition: CreativeSkillDefinition;
    validation: CreativeSkillValidation;
    testRun: CreativeSkillTestRun;
    compatibility: { status: "compatible" | "incompatible"; issues: string[] };
    health: { status: "healthy" | "broken"; issues: string[] };
    assets?: CreativeSkillAssetDescriptor[];
    publishedAt: string;
};

export type CreativeSkillDraft = {
    draftId: string;
    skillId: string;
    revision: number;
    lifecycle: "draft";
    ownership: "personal";
    trust: CreativeSkillTrust;
    source: Exclude<CreativeSkillSource, "builtin">;
    enabled: false;
    name: string;
    description: string;
    definition: CreativeSkillDefinition;
    definitionHash: string;
    validation: CreativeSkillValidation;
    testRun: CreativeSkillTestRun;
    assets?: CreativeSkillAssetDescriptor[];
    fixture?: CreativeSkillExampleFixture;
    quarantine?: CreativeSkillQuarantineDescriptor;
    createdAt: string;
    updatedAt: string;
};

export type CreativeSkill = {
    skillId: string;
    revision: number;
    lifecycle: "published";
    ownership: CreativeSkillOwnership;
    trust: CreativeSkillTrust;
    source: CreativeSkillSource;
    name: string;
    description: string;
    enabled: boolean;
    favorite: boolean;
    activeRevision: string;
    versions: CreativeSkillVersion[];
    createdAt: string;
    updatedAt: string;
};

export type CreativeSkillLibrarySnapshot = {
    schemaVersion: typeof CREATIVE_SKILL_LIBRARY_SCHEMA_VERSION;
    revision: number;
    skills: CreativeSkill[];
    drafts: CreativeSkillDraft[];
};

export type CreativeSkillListItem = {
    recordId: string;
    skillId: string;
    revision: number;
    lifecycle: CreativeSkillLifecycle;
    ownership: CreativeSkillOwnership;
    trust: CreativeSkillTrust;
    source: CreativeSkillSource;
    name: string;
    description: string;
    enabled: boolean;
    favorite: boolean;
    activeRevision?: string;
    version?: CreativeSkillVersion;
    draft?: CreativeSkillDraft;
    createdAt: string;
    updatedAt: string;
};

export type CreativeSkillLibraryFilter = {
    query?: string;
    ownership?: CreativeSkillOwnership;
    lifecycle?: CreativeSkillLifecycle;
    enabled?: boolean;
    favorite?: boolean;
};

export type CreateCreativeSkillDraftInput = {
    name: string;
    description?: string;
    definition: CreativeSkillDefinition;
    source?: "manual" | "canvas";
};

export type CreateCreativeSkillExampleDraftInput = Omit<CreateCreativeSkillDraftInput, "source"> & {
    fixture: { input: CreativeSkillExampleImageInput; expectedOutput: CreativeSkillExampleImageInput };
};

export type PatchCreativeSkillDraft = Partial<Pick<CreativeSkillDraft, "name" | "description" | "definition">>;

export type CreativeSkillTransferOperation = "import" | "export";

export type CreativeSkillTransferInspection = {
    inspectionToken: string;
    operation: CreativeSkillTransferOperation;
    status: "unavailable" | "pending" | "verified" | "rejected";
    canCommit: boolean;
    expiresAt?: string;
    packageName?: string;
    summary?: { id: string; name: string; description: string; assetCount: number };
    target?: "library";
    resolution?: "replace-local";
    issues: string[];
};

export type CreativeSkillMutationCommand =
    | { type: "create-draft"; input: CreateCreativeSkillDraftInput }
    | { type: "create-example-draft"; input: CreateCreativeSkillExampleDraftInput }
    | { type: "duplicate-as-draft"; skillId: string }
    | { type: "patch-draft"; draftId: string; expectedRevision: number; patch: PatchCreativeSkillDraft }
    | { type: "discard-draft"; draftId: string; expectedRevision: number }
    | { type: "publish-draft"; draftId: string; expectedRevision: number }
    | { type: "record-test-run"; draftId: string; expectedRevision: number; definitionHash: string; runId?: string; status: "passed" | "failed"; issues: string[] }
    | { type: "delete-skill"; skillId: string; expectedRevision: number }
    | { type: "set-enabled"; skillId: string; expectedRevision: number; enabled: boolean }
    | { type: "set-favorite"; skillId: string; expectedRevision: number; favorite: boolean };

export type CreativeSkillLibraryQueryInput = { kind: "library"; filter?: CreativeSkillLibraryFilter };
export type CreativeSkillAssetQueryInput =
    | { kind: "resolve-asset"; skillId: string; versionId: string; sha256: string }
    | { kind: "resolve-asset"; draftId: string; draftRevision: number; sha256: string };
export type CreativeSkillFixtureQueryInput = { kind: "resolve-fixture"; draftId: string; draftRevision: number; role: "input" | "expected-output" };
export type CreativeSkillNormalizeExampleImageInput = {
    kind: "normalize-example-image";
    sha256: string;
    mimeType: CreativeSkillAssetDescriptor["mimeType"] | "image/heic" | "image/heif";
    data: ArrayBuffer;
};
export type CreativeSkillQueryInput = CreativeSkillLibraryQueryInput | CreativeSkillAssetQueryInput | CreativeSkillFixtureQueryInput | CreativeSkillNormalizeExampleImageInput;
export type CreativeSkillQueryResult = { head: string; snapshot: CreativeSkillLibrarySnapshot };
export type CreativeSkillAssetQueryResult = {
    asset: { sha256: string; mimeType: CreativeSkillAssetDescriptor["mimeType"]; bytes: ArrayBuffer };
};
export type CreativeSkillFixtureQueryResult = {
    fixture: CreativeSkillAssetDescriptor & { bytes: ArrayBuffer };
};
export type CreativeSkillNormalizeExampleImageResult = {
    image: CreativeSkillAssetDescriptor & { data: ArrayBuffer };
};
export type CreativeSkillCommandResult = {
    head?: string;
    snapshot: CreativeSkillLibrarySnapshot;
    changed?: { skillId?: string; draftId?: string };
    exported?: { fileName: string };
};
export type CreativeSkillPrepareInput =
    | { kind: "import"; source: "file-picker" }
    | { kind: "export"; skillId: string; versionId?: string };
export type CreativeSkillSyncImportInput = {
    kind: "sync-import";
    payload: ArrayBuffer;
    expectedHead: string;
    sourceHead: string;
    checkpointHead?: string;
    resolution?: "replace-local";
};
export type CreativeSkillDesktopPrepareInput = CreativeSkillPrepareInput | CreativeSkillSyncImportInput;
export type CreativeSkillPrepareResult = CreativeSkillTransferInspection;
export type CreativeSkillCommitInput = { inspectionToken: string };
export type CreativeSkillCommitResult = CreativeSkillCommandResult;
export type CreativeSkillLibraryChangedEvent = { revision: number; head: string };

export type CreativeSkillSyncPackageResult = {
    schemaVersion: 1;
    head: string;
    publishedSkillCount: number;
    tombstoneCount: number;
    payload: ArrayBuffer;
    mediaType: "application/vnd.fourj.skill-library+zip";
};

export type CreativeSkillDesktopBridge = {
    query: {
        (input: CreativeSkillAssetQueryInput): Promise<CreativeSkillAssetQueryResult>;
        (input: CreativeSkillFixtureQueryInput): Promise<CreativeSkillFixtureQueryResult>;
        (input: CreativeSkillNormalizeExampleImageInput): Promise<CreativeSkillNormalizeExampleImageResult>;
        (input?: CreativeSkillLibraryQueryInput): Promise<CreativeSkillQueryResult>;
    };
    execute: (command: CreativeSkillMutationCommand) => Promise<CreativeSkillCommandResult>;
    prepare: (input: CreativeSkillDesktopPrepareInput) => Promise<CreativeSkillPrepareResult>;
    commit: (input: CreativeSkillCommitInput) => Promise<CreativeSkillCommitResult>;
    createSyncPackage: () => Promise<CreativeSkillSyncPackageResult>;
    subscribe: (listener: (event: CreativeSkillLibraryChangedEvent) => void) => () => void;
};

export type CreativeSkillCommandAdapter = {
    mode: "command";
    read: () => Promise<CreativeSkillLibrarySnapshot | undefined>;
    execute: (command: CreativeSkillMutationCommand) => Promise<CreativeSkillCommandResult>;
    prepare: (input: CreativeSkillDesktopPrepareInput) => Promise<CreativeSkillTransferInspection>;
    commit: (inspectionToken: string) => Promise<CreativeSkillCommandResult>;
    subscribe?: (listener: () => void) => () => void;
};

export type CreativeSkillSnapshotAdapter = {
    mode: "snapshot";
    read: () => Promise<CreativeSkillLibrarySnapshot | undefined>;
    write: (snapshot: CreativeSkillLibrarySnapshot, expectedRevision: number) => Promise<void>;
};

export type CreativeSkillLibraryAdapter = CreativeSkillCommandAdapter | CreativeSkillSnapshotAdapter;
