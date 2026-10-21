/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __APP_RELEASES__: import("@/lib/release").ReleaseInfo[];

interface Window {
    infiniteCanvasDesktop?: {
        platform: string;
        version: string;
        isDesktop: boolean;
        getDataLocation: () => Promise<string>;
        getWorkspaceInfo: () => Promise<WorkspaceInfo>;
        getStorageOverview: (protectedStorageKeys?: string[]) => Promise<DesktopStorageOverview>;
        cleanupStorage: (categories: Array<"images" | "videos" | "audio">, protectedStorageKeys?: string[]) => Promise<DesktopCleanupResult>;
        repairStorage: () => Promise<DesktopWorkspaceStorage>;
        clearUpdateCache: () => Promise<{ clearedFiles: number; clearedBytes: number }>;
        chooseWorkspace: () => Promise<{ cancelled: boolean; reloaded?: boolean; path?: string; isCustom?: boolean }>;
        chooseCategoryDirectory: (category: WorkspaceCategory) => Promise<{ cancelled: boolean; reloaded?: boolean }>;
        resetCategoryDirectory: (category: WorkspaceCategory) => Promise<{ cancelled?: boolean; reloaded?: boolean }>;
        openWorkspace: (section?: WorkspaceCategory) => Promise<boolean>;
        readWorkspaceState: (name: string) => Promise<string | null>;
        writeWorkspaceState: (name: string, value: string) => Promise<void>;
        removeWorkspaceState: (name: string) => Promise<void>;
        storeAsset: (input: { remoteUrl?: string; bytes?: ArrayBuffer; mimeType?: string; kind: "image" | "video" | "audio" | "file"; idempotencyKey?: string }) => Promise<{ storageKey: string; url: string; path: string; bytes: number; mimeType: string; created: boolean }>;
        findAssetByIdempotencyKey: (input: { kind: "image"; idempotencyKey: string }) => Promise<{ storageKey: string; path: string; bytes: number; mimeType: string; created: false } | null>;
        writeAsset: (storageKey: string, bytes: ArrayBuffer) => Promise<string>;
        deleteAsset: (storageKey: string) => Promise<boolean>;
        deleteUnusedAsset: (storageKey: string) => Promise<boolean>;
        setActiveGenerationCount: (count: number) => void;
        setCloseBehavior: (behavior: "tray" | "quit") => void;
        setTheme: (theme: "light" | "dark") => void;
        getUpdateState: () => Promise<DesktopUpdateState>;
        setUpdatePreferences: (preferences: DesktopUpdatePreferences) => Promise<DesktopUpdateState>;
        checkForUpdates: () => Promise<DesktopUpdateState>;
        downloadUpdate: () => Promise<DesktopUpdateState>;
        installUpdate: () => Promise<boolean>;
        onUpdateState: (listener: (state: DesktopUpdateState) => void) => () => void;
        onUpdateCompleted: (listener: (info: DesktopUpdateCompleted) => void) => () => void;
        notifyTaskComplete: (input: { title: string; body: string; route: string }) => Promise<boolean>;
        onNavigate: (listener: (route: string) => void) => () => void;
        creativeSkills?: import("@/types/creative-skill").CreativeSkillDesktopBridge;
    };
}

interface WindowEventMap {
    "fourj:creative-skill-test-request": CustomEvent<{ draftId: string; expectedRevision: number; definitionHash: string }>;
    "fourj:creative-skill-canvas-selection-request": CustomEvent<import("@/lib/creative-skills/draft-sources").CreativeSkillCanvasSelectionRequest>;
    "fourj:creative-skill-canvas-selection-result": CustomEvent<import("@/lib/creative-skills/draft-sources").CreativeSkillCanvasSelectionResult>;
}

type DesktopUpdatePreferences = {
    autoCheck: boolean;
    channel: "stable" | "preview";
};

type DesktopUpdateStatus = "idle" | "checking" | "available" | "not-available" | "downloading" | "downloaded" | "error" | "unsupported";

type DesktopUpdateState = {
    status: DesktopUpdateStatus;
    currentVersion: string;
    availableVersion: string;
    percent: number;
    transferred: number;
    total: number;
    message: string;
    checkedAt: string;
    manual: boolean;
};

type DesktopUpdateCompleted = {
    version: string;
    previousVersion: string;
};

type WorkspaceCategory = "images" | "videos" | "audio" | "projects" | "records" | "skills";
type WorkspaceLocation = { path: string; defaultPath: string; isCustom: boolean; configuredPath?: string; locationMissing?: boolean };
type WorkspaceInfo = {
    path: string;
    defaultPath: string;
    isCustom: boolean;
    configuredPath?: string | null;
    locationMissing?: boolean;
    allowLegacyImport?: boolean;
    locationFile: string;
    locations: Record<WorkspaceCategory, WorkspaceLocation>;
};

type DesktopStorageCategory = { files: number; bytes: number; unreferencedFiles: number; unreferencedBytes: number };
type DesktopWorkspaceStorage = {
    categories: Record<WorkspaceCategory, DesktopStorageCategory>;
    totalBytes: number;
    health: { ok: boolean; damagedJsonFiles: string[]; staleTempFiles: string[] };
};
type DesktopStorageOverview = { workspace: DesktopWorkspaceStorage; updates: { path: string; files: number; bytes: number; status: string } };
type DesktopCleanupResult = { deletedFiles: number; deletedBytes: number; protectedFiles: number; protectedBytes: number };

interface ImportMetaEnv {
    // Comma-separated local development plugin URLs, refetched on every startup without caching or persistence.
    readonly VITE_DEV_PLUGINS?: string;
    // Optional build-time analytics configuration, with one independent variable per provider.
    // GA4 measurement ID (G-XXXX)
    readonly VITE_ANALYTICS_GA4_ID?: string;
    // Baidu Analytics site ID
    readonly VITE_ANALYTICS_BAIDU_ID?: string;
}
