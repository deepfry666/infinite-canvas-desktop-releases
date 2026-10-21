import type { AgentCanvasReference, AgentChatItem, AgentChatRole, AgentCreativeSkillReference, AgentMessageAttachment, AgentSkillReference } from "@/stores/use-agent-store";

export type BuiltinAgentConversation = {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messages: AgentChatItem[];
};

export type BuiltinAgentConversationState = {
    activeId: string;
    conversations: BuiltinAgentConversation[];
};

export type BuiltinAgentConversationLoadResult = {
    state: BuiltinAgentConversationState;
    canPersist: boolean;
};

export function createConversation(id: string, now = Date.now()): BuiltinAgentConversation {
    return { id, title: "", createdAt: now, updatedAt: now, messages: [] };
}

export function appendConversation(state: BuiltinAgentConversationState, id: string, now = Date.now()): BuiltinAgentConversationState {
    return { activeId: id, conversations: [createConversation(id, now), ...state.conversations] };
}

export function startConversation(state: BuiltinAgentConversationState): BuiltinAgentConversationState {
    return { ...state, activeId: "" };
}

export function ensureConversation(state: BuiltinAgentConversationState, id: string, now = Date.now()): BuiltinAgentConversationState {
    return state.conversations.some((item) => item.id === id) ? { ...state, activeId: id } : appendConversation(state, id, now);
}

export function replaceConversationMessages(state: BuiltinAgentConversationState, id: string, messages: AgentChatItem[], now = Date.now()): BuiltinAgentConversationState {
    return {
        ...state,
        conversations: state.conversations.map((conversation) => {
            if (conversation.id !== id) return conversation;
            const firstUserText = messages.find((item) => item.role === "user")?.text.trim() || "";
            return { ...conversation, title: conversation.title || firstUserText.slice(0, 32), updatedAt: now, messages };
        }),
    };
}

export function renameConversation(state: BuiltinAgentConversationState, id: string, title: string, now = Date.now()): BuiltinAgentConversationState {
    const value = title.trim().slice(0, 80);
    if (!value) return state;
    return { ...state, conversations: state.conversations.map((item) => item.id === id ? { ...item, title: value, updatedAt: now } : item) };
}

export function deleteConversation(state: BuiltinAgentConversationState, id: string): BuiltinAgentConversationState {
    const conversations = state.conversations.filter((item) => item.id !== id);
    if (!conversations.length) return { activeId: "", conversations: [] };
    return { activeId: state.activeId === id ? conversations[0].id : state.activeId, conversations };
}

/** Parse persisted conversations without treating corrupt data as an empty store. */
export function parseBuiltinAgentConversationStorage(serialized: string | null, createId: () => string, now = Date.now()): BuiltinAgentConversationLoadResult {
    if (serialized === null) return { state: normalizeConversationState(null, createId, now), canPersist: true };
    try {
        const value: unknown = JSON.parse(serialized);
        return { state: normalizeConversationState(value, createId, now), canPersist: isConversationEnvelope(value) };
    } catch {
        return { state: normalizeConversationState(null, createId, now), canPersist: false };
    }
}

export function normalizeConversationState(value: unknown, createId: () => string, now = Date.now()): BuiltinAgentConversationState {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        const raw = value as Partial<BuiltinAgentConversationState>;
        const usedIds = new Set<string>();
        const conversations = Array.isArray(raw.conversations)
            ? raw.conversations.flatMap((item) => {
                  if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.id !== "string" || !item.id.trim() || !Array.isArray(item.messages)) return [];
                  const id = uniqueId(item.id.trim(), usedIds, createId);
                  usedIds.add(id);
                  const createdAt = finiteTimestamp(item.createdAt, now);
                  const updatedAt = Math.max(createdAt, finiteTimestamp(item.updatedAt, createdAt));
                  const title = typeof item.title === "string" ? item.title.trim().slice(0, 80) : "";
                  const usedMessageIds = new Set<string>();
                  const messages = item.messages.flatMap((message) => {
                      const normalized = normalizeMessage(message);
                      if (!normalized) return [];
                      const id = uniqueId(normalized.id, usedMessageIds, createId);
                      usedMessageIds.add(id);
                      return [{ ...normalized, id }];
                  });
                  return [{ id, title, createdAt, updatedAt, messages } satisfies BuiltinAgentConversation];
              }).slice(0, 50)
            : [];
        if (conversations.length) {
            const activeId = conversations.some((item) => item.id === raw.activeId) ? raw.activeId! : conversations[0].id;
            return { activeId, conversations };
        }
    }
    return { activeId: "", conversations: [] };
}

const agentChatRoles = new Set<AgentChatRole>(["user", "assistant", "system", "tool", "error"]);

function normalizeMessage(value: unknown): AgentChatItem | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const raw = value as Partial<AgentChatItem>;
    if (typeof raw.id !== "string" || !raw.id.trim() || typeof raw.text !== "string" || typeof raw.role !== "string" || !agentChatRoles.has(raw.role as AgentChatRole)) return null;
    const message: AgentChatItem = {
        id: raw.id.trim(),
        role: raw.role as AgentChatRole,
        text: raw.text,
        ...(stringValue(raw.itemId) ? { itemId: raw.itemId!.trim() } : {}),
        ...(stringValue(raw.clientMessageId) ? { clientMessageId: raw.clientMessageId!.trim() } : {}),
        ...(stringValue(raw.threadId) ? { threadId: raw.threadId!.trim() } : {}),
        ...(stringValue(raw.turnId) ? { turnId: raw.turnId!.trim() } : {}),
        ...(stringValue(raw.title) ? { title: raw.title!.trim() } : {}),
        ...(stringValue(raw.meta) ? { meta: raw.meta!.trim() } : {}),
        ...(stringValue(raw.streamId) ? { streamId: raw.streamId!.trim() } : {}),
    };
    if (Array.isArray(raw.attachments)) {
        const attachments = raw.attachments.flatMap((attachment) => normalizeAttachment(attachment));
        if (attachments.length) message.attachments = attachments;
    }
    if (Array.isArray(raw.canvasReferences)) {
        const references = raw.canvasReferences.flatMap((reference) => normalizeCanvasReference(reference));
        if (references.length) message.canvasReferences = references;
    }
    if (raw.skill && typeof raw.skill === "object" && typeof raw.skill.name === "string" && typeof raw.skill.path === "string") {
        message.skill = { name: raw.skill.name.trim(), path: raw.skill.path.trim(), ...(stringValue(raw.skill.displayName) ? { displayName: raw.skill.displayName!.trim() } : {}) } satisfies AgentSkillReference;
    }
    if (raw.creativeSkill && typeof raw.creativeSkill === "object") {
        const skill = raw.creativeSkill as Partial<AgentCreativeSkillReference>;
        if (stringValue(skill.skillId) && stringValue(skill.versionId) && stringValue(skill.definitionHash) && stringValue(skill.name)) {
            message.creativeSkill = { skillId: skill.skillId.trim(), versionId: skill.versionId.trim(), definitionHash: skill.definitionHash.trim(), name: skill.name.trim() };
        }
    }
    if (raw.activityItems && typeof raw.activityItems === "object" && !Array.isArray(raw.activityItems)) {
        const activityItems = Object.fromEntries(Object.entries(raw.activityItems).flatMap(([key, item]) => typeof item === "string" ? [[key, item]] : []));
        if (Object.keys(activityItems).length) message.activityItems = activityItems;
    }
    if ("detail" in raw) message.detail = raw.detail;
    return message;
}

function normalizeAttachment(value: unknown): AgentMessageAttachment[] {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const raw = value as Partial<AgentMessageAttachment>;
    if (typeof raw.id !== "string" || !raw.id.trim() || typeof raw.name !== "string" || typeof raw.url !== "string" || !raw.url.trim()) return [];
    return [{ id: raw.id.trim(), name: raw.name.trim(), url: raw.url, ...(stringValue(raw.type) ? { type: raw.type } : {}), ...(numberValue(raw.size) ? { size: raw.size } : {}), ...(numberValue(raw.width) ? { width: raw.width } : {}), ...(numberValue(raw.height) ? { height: raw.height } : {}), ...(stringValue(raw.dataUrl) ? { dataUrl: raw.dataUrl } : {}) }];
}

function normalizeCanvasReference(value: unknown): AgentCanvasReference[] {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const raw = value as Partial<AgentCanvasReference>;
    const kinds = new Set(["image", "video", "audio", "text"]);
    if (typeof raw.nodeId !== "string" || !raw.nodeId.trim() || typeof raw.title !== "string" || !raw.title.trim() || typeof raw.label !== "string" || !raw.label.trim() || typeof raw.kind !== "string" || !kinds.has(raw.kind)) return [];
    return [{ nodeId: raw.nodeId.trim(), title: raw.title.trim(), label: raw.label.trim(), kind: raw.kind as AgentCanvasReference["kind"], ...(stringValue(raw.previewUrl) ? { previewUrl: raw.previewUrl } : {}), ...(stringValue(raw.text) ? { text: raw.text } : {}) }];
}

function stringValue(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function numberValue(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function finiteTimestamp(value: unknown, fallback: number) {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function isConversationEnvelope(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const raw = value as Partial<BuiltinAgentConversationState>;
    return typeof raw.activeId === "string"
        && Array.isArray(raw.conversations)
        && raw.conversations.every((item) => Boolean(item && typeof item === "object" && !Array.isArray(item) && typeof item.id === "string" && item.id.trim() && Array.isArray(item.messages)));
}

function uniqueId(preferred: string, used: Set<string>, createId: () => string) {
    if (!used.has(preferred)) return preferred;
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const generated = createId();
        if (typeof generated === "string" && generated.trim() && !used.has(generated)) return generated;
    }
    let suffix = 2;
    let candidate = `${preferred}-${suffix}`;
    while (used.has(candidate)) candidate = `${preferred}-${suffix += 1}`;
    return candidate;
}
