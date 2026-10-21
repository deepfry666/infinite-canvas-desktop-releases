import assert from "node:assert/strict";
import test from "node:test";

import { appendConversation, createConversation, deleteConversation, normalizeConversationState, parseBuiltinAgentConversationStorage, renameConversation, replaceConversationMessages, startConversation } from "./builtin-agent-conversations.ts";

test("新建对话会保留旧对话并切换到新对话", () => {
    const first = createConversation("first", 1);
    const next = appendConversation({ activeId: first.id, conversations: [first] }, "second", 2);
    assert.equal(next.activeId, "second");
    assert.deepEqual(next.conversations.map((item) => item.id), ["second", "first"]);
});

test("首条用户消息会成为对话标题且对话记录互不混合", () => {
    const first = createConversation("first", 1);
    const next = replaceConversationMessages({ activeId: first.id, conversations: [first] }, first.id, [{ id: "m1", role: "user", text: "帮我整理这个很长很长的画布创意方案" }], 2);
    assert.equal(next.conversations[0].title, "帮我整理这个很长很长的画布创意方案");
    assert.equal(next.conversations[0].messages.length, 1);
});

test("删除当前对话会选中剩余对话，删除最后一个则回到未保存的新任务", () => {
    const first = createConversation("first", 1);
    const second = createConversation("second", 2);
    const remaining = deleteConversation({ activeId: "second", conversations: [second, first] }, "second");
    assert.equal(remaining.activeId, "first");
    const empty = deleteConversation(remaining, "first");
    assert.equal(empty.activeId, "");
    assert.equal(empty.conversations.length, 0);
});

test("新任务在发送消息前不会写入历史列表", () => {
    const first = createConversation("first", 1);
    const draft = startConversation({ activeId: first.id, conversations: [first] });
    assert.equal(draft.activeId, "");
    assert.deepEqual(draft.conversations.map((item) => item.id), ["first"]);
});

test("任务可以重命名且更新时间随之更新", () => {
    const first = createConversation("first", 1);
    const next = renameConversation({ activeId: first.id, conversations: [first] }, "first", "商品图方案", 3);
    assert.equal(next.conversations[0].title, "商品图方案");
    assert.equal(next.conversations[0].updatedAt, 3);
});

test("损坏的本地对话只丢弃坏消息，不会把画布渲染带崩", () => {
    const normalized = normalizeConversationState({
        activeId: "same",
        conversations: [
            {
                id: "same",
                title: "  任务  ",
                createdAt: 3,
                updatedAt: 2,
                messages: [
                    { id: "ok", role: "user", text: "保留", attachments: [{ id: "a", name: "图", url: "data:image/png;base64,ok" }] },
                    null,
                    { id: "bad-role", role: "unknown", text: "丢弃" },
                    { id: "bad-text", role: "assistant", text: 42 },
                    { id: "bad-attachment", role: "assistant", text: "仍保留", attachments: [null, { id: "missing-url", name: "坏" }] },
                    { id: "ok", role: "assistant", text: "重复消息 ID" },
                ],
            },
            { id: "same", messages: [{ id: "second", role: "assistant", text: "重复 ID 也保留" }] },
        ],
    }, () => "generated-id", 10);

    assert.equal(normalized.activeId, "same");
    assert.equal(normalized.conversations.length, 2);
    assert.deepEqual(normalized.conversations[0].messages.map((item) => item.id), ["ok", "bad-attachment", "generated-id"]);
    assert.equal(normalized.conversations[0].messages[0].attachments?.[0].url, "data:image/png;base64,ok");
    assert.equal(normalized.conversations[1].id, "generated-id");
    assert.equal(normalized.conversations[0].updatedAt, 3);
});

test("损坏的会话存储禁止回写，空存储仍可初始化", () => {
    const broken = parseBuiltinAgentConversationStorage("{broken", () => "generated-id", 10);
    assert.equal(broken.canPersist, false);
    assert.deepEqual(broken.state, { activeId: "", conversations: [] });

    const malformedEnvelope = parseBuiltinAgentConversationStorage(JSON.stringify({ conversations: [] }), () => "generated-id", 10);
    assert.equal(malformedEnvelope.canPersist, false);

    const empty = parseBuiltinAgentConversationStorage(null, () => "generated-id", 10);
    assert.equal(empty.canPersist, true);
});

test("创作 Skill 作为独立消息元数据持久化，不会改写用户正文", () => {
    const normalized = normalizeConversationState({
        activeId: "conversation",
        conversations: [{
            id: "conversation",
            messages: [{
                id: "message",
                role: "user",
                text: "做成秋日电影海报",
                creativeSkill: { skillId: "personal.poster", versionId: "sha256:version", definitionHash: "sha256:version", name: "海报风格" },
            }],
        }],
    }, () => "generated", 10);

    const message = normalized.conversations[0].messages[0];
    assert.equal(message.text, "做成秋日电影海报");
    assert.deepEqual(message.creativeSkill, { skillId: "personal.poster", versionId: "sha256:version", definitionHash: "sha256:version", name: "海报风格" });
});
