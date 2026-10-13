import assert from "node:assert/strict";
import test from "node:test";

import { buildFollowUpItems, buildPendingItems, buildTaskItems } from "./workspace-items.mjs";

const chat = { id: "chat-1", title: "Sakshi", collection: "active", kind: "direct" };

test("pending list includes direct discretion but excludes uncaptioned media, statements and owner messages", () => {
  const nowMs = Date.parse("2026-08-26T12:00:00Z");
  const pending = buildPendingItems([
    { chat, latest: { id: "q", direction: "contact", kind: "text", text: "Can you confirm what time works?", timestampMs: nowMs } },
    { chat: { ...chat, id: "chat-2" }, latest: { id: "m", direction: "contact", kind: "document", text: "", media: { category: "document", fileName: "brief.pdf" }, timestampMs: nowMs } },
    { chat: { ...chat, id: "chat-3" }, latest: { id: "s", direction: "contact", kind: "text", text: "FYI only", timestampMs: nowMs } },
    { chat: { ...chat, id: "chat-4" }, latest: { id: "o", direction: "owner", kind: "text", text: "What time?", timestampMs: nowMs } },
  ], { nowMs });
  assert.deepEqual(pending.map((item) => item.messageId), ["q"]);
  assert.match(pending[0].reason, /current fact|choice|commitment/iu);
});

test("promotional links and rhetorical broadcasts never become personal decisions", () => {
  const nowMs = Date.parse("2026-08-26T12:00:00Z");
  const pending = buildPendingItems([
    { chat, latest: { id: "promo", direction: "contact", kind: "text", text: "What could be more charming? Releasing tomorrow. Follow us https://instagram.example/a https://youtube.example/b", timestampMs: nowMs } },
    { chat: { ...chat, id: "chat-2" }, latest: { id: "request", direction: "contact", kind: "text", text: "Please review this document https://files.example/brief", timestampMs: nowMs } },
    { chat: { ...chat, id: "chat-3" }, latest: { id: "legal", direction: "contact", kind: "text", text: `${"Legal bulletin background and case history. ".repeat(14)}Whether the appeal should be allowed?`, timestampMs: nowMs } },
  ], { nowMs });
  assert.deepEqual(pending.map((item) => item.messageId), ["request"]);
});

test("owner task list only uses current owner commitments and applies confirmations", () => {
  const state = {
    chat_id: "chat-1",
    updated_at: "2026-08-26T10:00:00Z",
    commitments: [
      { id: "c1", actor_is_owner: true, action: "I will prepare the report", status: "current", provenance: { source_message_id: "m1", occurred_at: "2026-08-26T09:00:00Z", confidence: 1 } },
      { id: "c2", actor_is_owner: false, action: "I will wait", status: "current", provenance: { source_message_id: "m2" } },
      { id: "c3", actor_is_owner: true, action: "Old task", status: "superseded", provenance: { source_message_id: "m3" } },
    ],
  };
  const id = "chat-1:c1";
  const tasks = buildTaskItems([{ chat, state }], { tasks: { [id]: { status: "done", confirmedAt: "2026-08-26T11:00:00Z" } } }, { nowMs: Date.parse("2026-08-26T12:00:00Z") });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].status, "done");
  assert.equal(tasks[0].sourceMessageId, "m1");
});

test("an older unanswered direct question remains pending after a newer message", () => {
  const nowMs = Date.parse("2026-08-26T12:00:00Z");
  const pending = buildPendingItems([{ chat, latest: { id: "newer", direction: "contact", kind: "text", text: "FYI", timestampMs: nowMs }, state: { chat_id: "chat-1",
    open_questions: [{ id: "question:q1", question: "Which option should we use?", asked_by_owner: false, status: "current", provenance: { source_message_id: "q1", occurred_at: "2026-08-26T10:00:00Z" } }],
  } }], { nowMs });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].messageId, "q1");
  assert.match(pending[0].reason, /still unanswered/iu);
});

test("decision queue produces one primary card per conversation", () => {
  const nowMs = Date.parse("2026-08-26T12:00:00Z");
  const pending = buildPendingItems([{ chat, latest: { id: "latest", direction: "contact", kind: "text", text: "Can you confirm the time?", timestampMs: nowMs }, state: { chat_id: "chat-1",
    open_questions: [
      { id: "question:q1", question: "Which option?", asked_by_owner: false, status: "current", provenance: { source_message_id: "q1", occurred_at: "2026-08-26T10:00:00Z" } },
      { id: "question:q2", question: "Where should we meet?", asked_by_owner: false, status: "current", provenance: { source_message_id: "q2", occurred_at: "2026-08-26T10:01:00Z" } },
    ],
  } }], { nowMs });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].additionalCount, 2);
  assert.deepEqual(new Set(pending[0].relatedMessageIds), new Set(["latest", "q1", "q2"]));
});

test("group conversations never appear in the personal decision queue", () => {
  const group = { id: "jid:123@g.us", title: "BIZLURU", collection: "archived", kind: "group", connectorIds: ["123@g.us"] };
  const pending = buildPendingItems([{ group, chat: group, latest: { id: "g1", direction: "contact", kind: "text", text: "Can anyone help?", timestampMs: 5, mentionsOwner: true }, state: { chat_id: "jid:123@g.us",
    open_questions: [{ id: "question:g1", question: "Can anyone help?", asked_by_owner: false, status: "current", provenance: { source_message_id: "g1", occurred_at: "2026-08-26T10:00:00Z" } }],
  } }]);
  assert.deepEqual(pending, []);
});

test("groups stay excluded while all deliverable owner commitments become tasks", () => {
  const group = { id: "jid:123@g.us", title: "Group", kind: "group", connectorIds: ["123@g.us"] };
  const state = { chat_id: "jid:123@g.us", commitments: [{ id: "g", actor_is_owner: true, action: "I will prepare the report", status: "current", provenance: {} }] };
  assert.deepEqual(buildTaskItems([{ chat: group, state }]), []);
  const directState = { chat_id: "chat-1", commitments: [
    { id: "follow", actor_is_owner: true, action: "Let me check and confirm", status: "current", provenance: { source_message_id: "m1" } },
    { id: "task", actor_is_owner: true, action: "I will prepare the report", status: "current", provenance: { source_message_id: "m2" } },
  ] };
  assert.deepEqual(buildTaskItems([{ chat, state: directState }]).map((item) => item.commitmentId).sort(), ["follow", "task"]);
});

test("owner promises become tasks and only other-person promises become follow-ups", () => {
  const state = { chat_id: "chat-1", commitments: [
    { id: "mine", actor_is_owner: true, action: "I'll find and share", status: "current", provenance: { source_message_id: "m1" } },
    { id: "theirs", actor_is_owner: false, action: "I will send it tomorrow", status: "current", provenance: { source_message_id: "m2" } },
  ] };
  assert.deepEqual(buildTaskItems([{ chat, state }]).map((item) => item.commitmentId), ["mine"]);
  const followUps = buildFollowUpItems([{ chat, state }]);
  assert.deepEqual(followUps.map((item) => [item.commitmentId, item.role]), [["theirs", "waiting-on-them"]]);
});

test("non-deliverable language is neither a task nor a follow-up", () => {
  const state = { chat_id: "chat-1", commitments: [
    { id: "pray", actor_is_owner: false, action: "I'll pray", status: "current", provenance: { source_message_id: "m1", occurred_at: "2026-08-26T10:00:00Z", confidence: 1 } },
    { id: "wait", actor_is_owner: true, action: "I will wait", status: "current", provenance: { source_message_id: "m2", occurred_at: "2026-08-26T10:00:00Z", confidence: 1 } },
  ] };
  assert.deepEqual(buildTaskItems([{ chat, state }], undefined, { nowMs: Date.parse("2026-08-26T12:00:00Z") }), []);
  assert.deepEqual(buildFollowUpItems([{ chat, state }], undefined, { nowMs: Date.parse("2026-08-26T12:00:00Z") }), []);
});

test("old unconfirmed work is collapsed as stale until the user restores it", () => {
  const nowMs = Date.parse("2026-08-26T12:00:00Z");
  const state = { chat_id: "chat-1", commitments: [{ id: "old", actor_is_owner: true, action: "Prepare the old report", status: "current", provenance: { source_message_id: "m1", occurred_at: "2026-01-01T10:00:00Z", confidence: 1 } }] };
  assert.equal(buildTaskItems([{ chat, state }], undefined, { nowMs })[0].status, "stale");
  assert.equal(buildTaskItems([{ chat, state }], { tasks: { "chat-1:old": { status: "pending" } } }, { nowMs })[0].status, "pending");
});

test("future snoozes stay separate and expired snoozes wake as pending", () => {
  const state = { chat_id: "chat-1", commitments: [
    { id: "future", actor_is_owner: true, action: "Prepare future report", status: "current", provenance: { source_message_id: "m1" } },
    { id: "expired", actor_is_owner: true, action: "Prepare expired report", status: "current", provenance: { source_message_id: "m2" } },
  ] };
  const tasks = buildTaskItems([{ chat, state }], { tasks: {
    "chat-1:future": { status: "snoozed", snoozedUntil: "2099-01-01T00:00:00Z" },
    "chat-1:expired": { status: "snoozed", snoozedUntil: "2000-01-01T00:00:00Z" },
  } });
  assert.equal(tasks.find((item) => item.commitmentId === "future").status, "snoozed");
  assert.equal(tasks.find((item) => item.commitmentId === "expired").status, "pending");
});

test("decision routing rejects status updates and promises but accepts direct unpunctuated asks", () => {
  const nowMs = Date.parse("2026-08-26T12:00:00Z");
  const messages = [
    ["office", "Office se niklungi", false],
    ["closed", "Aaj office band hai", false],
    ["home", "Reached home", false],
    ["promise", "I will send it tomorrow", false],
    ["advise", "Please advise", true],
    ["approval", "Need your approval for this", true],
    ["monday", "Can we do Monday", true],
    ["kare", "Kya kare", true],
  ];
  const items = messages.map(([id, text]) => ({
    chat: { ...chat, id: `chat-${id}` },
    latest: { id, direction: "contact", kind: "text", text, timestampMs: nowMs },
    state: { chat_id: `chat-${id}`, open_questions: [] },
  }));
  const pending = buildPendingItems(items, { nowMs });
  assert.deepEqual(new Set(pending.map((item) => item.messageId)), new Set(messages.filter(([, , expected]) => expected).map(([id]) => id)));
});

test("all current commitments route strictly by actor without downstream verb allowlists", () => {
  const state = { chat_id: "chat-1", commitments: [
    { id: "owner-arrive", actor_is_owner: true, action: "I will be there at 4", status: "current", provenance: { source_message_id: "m1" } },
    { id: "owner-meet", actor_is_owner: true, action: "I will meet you tomorrow", status: "current", provenance: { source_message_id: "m2" } },
    { id: "other-arrive", actor_is_owner: false, action: "I'll be there at 4", status: "current", provenance: { source_message_id: "m3" } },
  ] };
  assert.deepEqual(buildTaskItems([{ chat, state }]).map((item) => item.commitmentId).sort(), ["owner-arrive", "owner-meet"]);
  assert.deepEqual(buildFollowUpItems([{ chat, state }]).map((item) => item.commitmentId), ["other-arrive"]);
});

test("queue builders reject a conversation state belonging to another chat", () => {
  const foreignState = { chat_id: "chat-2", open_questions: [{ id: "q", asked_by_owner: false, status: "current", question: "Which plan?", provenance: { source_message_id: "m1", occurred_at: "2026-08-26T10:00:00Z" } }], commitments: [
    { id: "foreign", actor_is_owner: true, action: "I will prepare it", status: "current", provenance: { source_message_id: "m2" } },
  ] };
  const input = [{ chat, state: foreignState, latest: { id: "m1", direction: "contact", kind: "text", text: "Which plan?", timestampMs: Date.parse("2026-08-26T10:00:00Z") } }];
  assert.deepEqual(buildPendingItems(input, { nowMs: Date.parse("2026-08-26T12:00:00Z") }), []);
  assert.deepEqual(buildTaskItems(input), []);
  assert.deepEqual(buildFollowUpItems(input), []);
});

test("multi-part promises retain direct asks and composite deliverables remain open work", () => {
  const nowMs = Date.parse("2026-08-26T12:00:00Z");
  const prompts = [
    "I will send mine. Can you send yours?",
    "I'll check and then can we decide Monday?",
    "We will share our report; please advise on the plan",
  ];
  const decisions = buildPendingItems(prompts.map((text, index) => ({
    chat: { ...chat, id: `chat-ask-${index}` },
    latest: { id: `ask-${index}`, direction: "contact", kind: "text", text, timestampMs: nowMs },
    state: { chat_id: `chat-ask-${index}`, open_questions: [] },
  })), { nowMs });
  assert.equal(decisions.length, 3);

  const state = { chat_id: "chat-1", commitments: [
    { id: "mine", actor_is_owner: true, action: "I will think and send you a proposal", status: "current", provenance: {} },
    { id: "theirs", actor_is_owner: false, action: "I'll wait and then send it", status: "current", provenance: {} },
    { id: "mine-arrival", actor_is_owner: true, action: "I will rest and be there at 4", status: "current", provenance: {} },
    { id: "their-meeting", actor_is_owner: false, action: "I'll wait and meet you tomorrow", status: "current", provenance: {} },
  ] };
  assert.deepEqual(buildTaskItems([{ chat, state }]).map((item) => item.commitmentId).sort(), ["mine", "mine-arrival"]);
  assert.deepEqual(buildFollowUpItems([{ chat, state }]).map((item) => item.commitmentId).sort(), ["their-meeting", "theirs"]);
});

test("queue builders match chat by connectorIds and alias formats", () => {
  const aliasedChat = { id: "phone:919909922845", title: "Aliased", collection: "active", kind: "direct", connectorIds: ["919909922845@s.whatsapp.net"] };
  const aliasedState = {
    chat_id: "919909922845@s.whatsapp.net",
    open_questions: [{ id: "q1", asked_by_owner: false, status: "current", question: "When are you available?", provenance: { source_message_id: "m1", occurred_at: "2026-08-26T10:00:00Z" } }],
    commitments: [
      { id: "c1", actor_is_owner: true, action: "I will call you", status: "current", provenance: { source_message_id: "m2" } },
      { id: "c2", actor_is_owner: false, action: "I will share the details", status: "current", provenance: { source_message_id: "m3" } },
    ],
  };
  const input = [{ chat: aliasedChat, state: aliasedState, latest: { id: "m1", direction: "contact", kind: "text", text: "When are you available?", timestampMs: Date.parse("2026-08-26T10:00:00Z") } }];
  const pending = buildPendingItems(input, { nowMs: Date.parse("2026-08-26T12:00:00Z") });
  const tasks = buildTaskItems(input);
  const followUps = buildFollowUpItems(input);
  assert.equal(pending.length, 1);
  assert.equal(tasks.length, 1);
  assert.equal(followUps.length, 1);
});
