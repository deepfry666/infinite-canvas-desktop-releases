import { create } from "zustand";
import i18n from "@/i18n";

import type { CanvasAgentOp, CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { CreativeSkillParameterValue, CreativeSkillRecipeV1 } from "@/lib/creative-skills";
import type { CreativeSkillRunMode, CreativeSkillRunRecord, CreativeSkillRunSource } from "@/lib/creative-skill-run-ledger";

export type AgentChatRole = "user" | "assistant" | "system" | "tool" | "error";
export type AgentAttachment = { id: string; name: string; type: string; size: number; width: number; height: number; url: string; dataUrl: string };
export type AgentMessageAttachment = Pick<AgentAttachment, "id" | "name" | "url"> & Partial<Pick<AgentAttachment, "type" | "size" | "width" | "height" | "dataUrl">>;
export type AgentCanvasReference = Pick<CanvasResourceReference, "nodeId" | "label" | "title" | "kind" | "previewUrl" | "text">;
export type AgentSkillReference = { name: string; path: string; displayName?: string };
export type AgentCreativeSkillReference = { skillId: string; versionId: string; definitionHash: string; name: string; source?: CreativeSkillRunSource };
export type AgentCreativeSkillExecution = {
    commandId: string;
    mode: CreativeSkillRunMode;
    skill: AgentCreativeSkillReference;
    recipe: CreativeSkillRecipeV1;
    parameters: Record<string, CreativeSkillParameterValue>;
    anchorNodeId: string;
    targetNodeId?: string;
    targetFixture?: { draftId: string; draftRevision: number; sha256: string };
    referenceNodeIds?: string[];
    assetSource?: { kind: "published"; skillId: string; versionId: string } | { kind: "draft"; draftId: string; draftRevision: number };
    provider?: { model?: string; size?: string; quality?: string };
    threadId?: string;
    clientMessageId?: string;
};
export type AgentChatItem = { id: string; itemId?: string; clientMessageId?: string; threadId?: string; turnId?: string; role: AgentChatRole; title?: string; text: string; meta?: string; detail?: unknown; attachments?: AgentMessageAttachment[]; canvasReferences?: AgentCanvasReference[]; skill?: AgentSkillReference; creativeSkill?: AgentCreativeSkillReference; streamId?: string; activityItems?: Record<string, string> };
export type AgentEventLog = { id: string; time: string; title: string; text: string; raw?: unknown };
export type AgentPendingToolCall = { requestId: string; name: string; input?: { ops?: CanvasAgentOp[]; path?: string } & Record<string, unknown> };
export type AgentPermissionMode = "request" | "automatic" | "full";
export type AgentReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
export type AgentModel = {
    id: string;
    model: string;
    displayName: string;
    defaultReasoningEffort: AgentReasoningEffort;
    supportedReasoningEfforts: Array<{ reasoningEffort: AgentReasoningEffort; description?: string }>;
    isDefault?: boolean;
};
export type AgentApprovalDecision = "accept" | "acceptForSession" | "decline";
export type AgentPendingApproval = { requestId: string; method: string; threadId?: string; turnId?: string; itemId?: string; reason?: string; command?: unknown; cwd?: string; grantRoot?: string; networkApprovalContext?: unknown; permissions?: unknown; deciding?: AgentApprovalDecision };
export type AgentCanvasContext = {
    snapshot: CanvasAgentSnapshot;
    readSnapshot: () => CanvasAgentSnapshot;
    applyOps: (ops?: CanvasAgentOp[]) => CanvasAgentSnapshot;
    applyOpsAsync?: (ops?: CanvasAgentOp[]) => Promise<CanvasAgentSnapshot>;
    runCreativeSkill?: (input: AgentCreativeSkillExecution) => Promise<CreativeSkillRunRecord>;
    recoverCreativeSkills?: () => Promise<CreativeSkillRunRecord[]>;
    resumeCreativeSkill?: (runId: string) => Promise<CreativeSkillRunRecord>;
    cancelCreativeSkill?: (commandId: string) => Promise<CreativeSkillRunRecord | undefined>;
    dismissCreativeSkill?: (runId: string) => Promise<CreativeSkillRunRecord>;
    undoOps: () => CanvasAgentSnapshot | null;
    canUndo: boolean;
};
export type AgentThreadSummary = { id: string; preview: string; name?: string | null; cwd?: string; status?: string; source?: unknown; createdAt?: number; updatedAt?: number };
export type AgentTokenUsage = { input: number; cached: number; output: number };
export type AgentBootstrapStatus = { key: string; text: string; detail: string; status: "running" | "ready" | "error" };
export type AgentConversationState = {
    revision: number;
    conversationId: string;
    threadId: string;
    status: "idle" | "preparing" | "ready" | "warning" | "running" | "failed";
    mcpStatuses: Record<string, { status: "starting" | "ready" | "failed" | "cancelled"; error?: string | null; failureReason?: string | null }>;
    sourceClientId?: string;
    error?: string;
};
export type AgentPanelTab = "chat" | "setup" | "history" | "skills" | "log";
export type AgentBackend = "builtin" | "canvas-agent";

const CONNECT_TIMEOUT_MS = 6000;
const AGENT_BACKEND_STORAGE_KEY = "canvas-agent-backend-v2";
const AGENT_PANEL_WIDTH_STORAGE_KEY = "canvas-agent-panel-width";
export const AGENT_CONFIRMATION_MODE_STORAGE_KEY = "fourj-canvas:chat-confirmation-mode";
export const CANVAS_AGENT_PANEL_MIN_WIDTH = 360;
export const CANVAS_AGENT_PANEL_MAX_WIDTH = 760;
export const CANVAS_AGENT_PANEL_DEFAULT_WIDTH = 440;
const CANVAS_AGENT_PANEL_COMPACT_MIN_WIDTH = 240;
const CANVAS_AGENT_PANEL_MIN_WORKSPACE_WIDTH = 360;
const CANVAS_AGENT_PANEL_FRAME_WIDTH = 1;
const CANVAS_AGENT_PANEL_DESKTOP_SIDEBAR_BREAKPOINT = 768;
let agentSource: EventSource | null = null;
let connectTimer: ReturnType<typeof setTimeout> | null = null;
let panelCloseTimer: ReturnType<typeof setTimeout> | null = null;

function viewportWidth() {
    if (typeof window === "undefined") return Number.POSITIVE_INFINITY;
    return window.visualViewport?.width ?? window.innerWidth;
}

export function clampAgentPanelWidth(width: number, availableWidth = viewportWidth(), reservedSidebarWidth = 0) {
    const sidebarWidth = Number.isFinite(availableWidth) && availableWidth >= CANVAS_AGENT_PANEL_DESKTOP_SIDEBAR_BREAKPOINT
        ? Math.max(0, Number.isFinite(reservedSidebarWidth) ? reservedSidebarWidth : 0)
        : 0;
    const viewportLimit = Number.isFinite(availableWidth)
        ? Math.min(availableWidth, Math.max(CANVAS_AGENT_PANEL_COMPACT_MIN_WIDTH, availableWidth - sidebarWidth - CANVAS_AGENT_PANEL_MIN_WORKSPACE_WIDTH - CANVAS_AGENT_PANEL_FRAME_WIDTH))
        : CANVAS_AGENT_PANEL_MAX_WIDTH;
    const maxWidth = Math.max(0, Math.min(CANVAS_AGENT_PANEL_MAX_WIDTH, viewportLimit));
    const minWidth = Math.min(CANVAS_AGENT_PANEL_MIN_WIDTH, maxWidth);
    const candidate = Number.isFinite(width) ? width : CANVAS_AGENT_PANEL_DEFAULT_WIDTH;
    return Math.round(Math.min(maxWidth, Math.max(minWidth, candidate)));
}

export function persistAgentPanelWidth(width: number, availableWidth = viewportWidth(), reservedSidebarWidth = 0) {
    const clamped = clampAgentPanelWidth(width, availableWidth, reservedSidebarWidth);
    if (typeof window !== "undefined") {
        try {
            localStorage.setItem(AGENT_PANEL_WIDTH_STORAGE_KEY, String(clamped));
        } catch {
            // Storage can be unavailable; the in-memory width remains valid.
        }
    }
    return clamped;
}

function initialAgentPanelWidth() {
    if (typeof window === "undefined") return CANVAS_AGENT_PANEL_DEFAULT_WIDTH;
    try {
        const stored = localStorage.getItem(AGENT_PANEL_WIDTH_STORAGE_KEY);
        const clamped = clampAgentPanelWidth(stored === null ? CANVAS_AGENT_PANEL_DEFAULT_WIDTH : Number(stored));
        if (stored !== null && stored !== String(clamped)) localStorage.setItem(AGENT_PANEL_WIDTH_STORAGE_KEY, String(clamped));
        return clamped;
    } catch {
        return clampAgentPanelWidth(CANVAS_AGENT_PANEL_DEFAULT_WIDTH);
    }
}

function prefersReducedMotion() {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type AgentStore = {
    backend: AgentBackend;
    width: number;
    panelOpen: boolean;
    panelMounted: boolean;
    panelClosing: boolean;
    canvasContext: AgentCanvasContext | null;
    url: string;
    token: string;
    connected: boolean;
    enabled: boolean;
    silentConnect: boolean;
    prompt: string;
    attachments: AgentAttachment[];
    canvasReferences: CanvasResourceReference[];
    sending: boolean;
    waiting: boolean;
    messages: AgentChatItem[];
    tokenUsage: AgentTokenUsage | null;
    eventLogs: AgentEventLog[];
    threads: AgentThreadSummary[];
    activeThreadId: string;
    activeTurnId: string;
    workspacePath: string;
    loadingThreads: boolean;
    activeTab: AgentPanelTab;
    confirmTools: boolean;
    permissionMode: AgentPermissionMode;
    models: AgentModel[];
    model: string;
    reasoningEffort: AgentReasoningEffort | "";
    activity: string;
    conversation: AgentConversationState;
    bootstrapStatus: AgentBootstrapStatus | null;
    mcpStartupStatuses: Record<string, AgentBootstrapStatus>;
    connectError: string;
    pendingTool: AgentPendingToolCall | null;
    pendingApprovals: AgentPendingApproval[];
    creativeSkillAttention: CreativeSkillRunRecord[];
    setAgentState: (patch: Partial<Omit<AgentStore, "setAgentState" | "setBackend" | "connectAgent" | "disconnectAgent" | "addMessage" | "addEventLog" | "clearEventLogs" | "openPanel" | "closePanel" | "togglePanel" | "setCanvasContext">>) => void;
    setBackend: (backend: AgentBackend) => void;
    openPanel: () => void;
    closePanel: () => void;
    togglePanel: () => void;
    setCanvasContext: (context: AgentCanvasContext | null) => void;
    connectAgent: (options?: { silent?: boolean }) => void;
    disconnectAgent: (patch?: Partial<Omit<AgentStore, "setAgentState" | "setBackend" | "connectAgent" | "disconnectAgent" | "addMessage" | "addEventLog" | "clearEventLogs" | "openPanel" | "closePanel" | "togglePanel" | "setCanvasContext">>) => void;
    addMessage: (item: AgentChatItem) => void;
    addEventLog: (item: AgentEventLog) => void;
    clearEventLogs: () => void;
};

export const CANVAS_AGENT_PANEL_MOTION_MS = 380;

export const useAgentStore = create<AgentStore>((set, get) => ({
    backend: "builtin",
    width: initialAgentPanelWidth(),
    panelOpen: false,
    panelMounted: true,
    panelClosing: false,
    canvasContext: null,
    url: typeof window === "undefined" ? "http://127.0.0.1:17371" : localStorage.getItem("canvas-agent-url") || "http://127.0.0.1:17371",
    token: typeof window === "undefined" ? "" : localStorage.getItem("canvas-agent-token") || "",
    connected: false,
    enabled: false,
    silentConnect: false,
    prompt: "",
    attachments: [],
    canvasReferences: [],
    sending: false,
    waiting: false,
    messages: [],
    tokenUsage: null,
    eventLogs: [],
    threads: [],
    activeThreadId: "",
    activeTurnId: "",
    workspacePath: "",
    loadingThreads: false,
    activeTab: "setup",
    confirmTools: typeof window === "undefined" ? true : localStorage.getItem(AGENT_CONFIRMATION_MODE_STORAGE_KEY) !== "automatic",
    permissionMode: typeof window === "undefined" ? "request" : (localStorage.getItem("canvas-agent-permission-mode") as AgentPermissionMode) || "request",
    models: [],
    model: typeof window === "undefined" ? "" : localStorage.getItem("canvas-agent-model") || "",
    reasoningEffort: typeof window === "undefined" ? "" : (localStorage.getItem("canvas-agent-reasoning-effort") as AgentReasoningEffort) || "",
    activity: i18n.t("agent.state.ready"),
    conversation: { revision: 0, conversationId: "", threadId: "", status: "idle", mcpStatuses: {} },
    bootstrapStatus: null,
    mcpStartupStatuses: {},
    connectError: "",
    pendingTool: null,
    pendingApprovals: [],
    creativeSkillAttention: [],
    setAgentState: (patch) => set(patch),
    setBackend: (backend) => {
        localStorage.setItem(AGENT_BACKEND_STORAGE_KEY, backend);
        set({ backend });
    },
    openPanel: () => {
        if (panelCloseTimer) clearTimeout(panelCloseTimer);
        panelCloseTimer = null;
        set({ panelOpen: true, panelMounted: true, panelClosing: false });
    },
    closePanel: () => {
        if (!get().panelMounted || get().panelClosing) return;
        if (panelCloseTimer) clearTimeout(panelCloseTimer);
        panelCloseTimer = null;
        if (prefersReducedMotion()) {
            set({ panelOpen: false, panelClosing: false });
            return;
        }
        set({ panelOpen: false, panelClosing: true });
        panelCloseTimer = setTimeout(() => {
            panelCloseTimer = null;
            if (get().panelClosing) set({ panelClosing: false });
        }, CANVAS_AGENT_PANEL_MOTION_MS);
    },
    togglePanel: () => (get().panelOpen ? get().closePanel() : get().openPanel()),
    setCanvasContext: (canvasContext) => set({ canvasContext }),
    connectAgent: (options) => {
        const silent = options?.silent ?? false;
        const endpoint = get().url.trim().replace(/\/$/, "");
        const token = get().token.trim();
        if (!endpoint || !token) return set({ connectError: silent ? "" : i18n.t("agent.state.connectionRequired") });
        try {
            const parsed = new URL(endpoint);
            if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
        } catch {
            return set({ connectError: silent ? "" : i18n.t("agent.state.invalidUrl") });
        }
        localStorage.setItem("canvas-agent-url", endpoint);
        localStorage.setItem("canvas-agent-token", token);
        // Only set enabled here; LocalAgentPanel's effect owns SSE initialization.
        set({ url: endpoint, token, enabled: true, silentConnect: silent, activity: i18n.t("agent.status.connecting"), connectError: "" });
    },
    disconnectAgent: (patch = {}) => {
        agentSource?.close();
        agentSource = null;
        if (connectTimer) clearTimeout(connectTimer);
        connectTimer = null;
        set({ enabled: false, connected: false, silentConnect: false, activity: i18n.t("agent.state.offline"), conversation: { revision: 0, conversationId: "", threadId: "", status: "idle", mcpStatuses: {} }, bootstrapStatus: null, mcpStartupStatuses: {}, ...patch });
    },
    addMessage: (item) => set((state) => ({ messages: [...state.messages, item] })),
    addEventLog: (item) => set((state) => ({ eventLogs: [...state.eventLogs.slice(-160), item] })),
    clearEventLogs: () => set({ eventLogs: [] }),
}));
