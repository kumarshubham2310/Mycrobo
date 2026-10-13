export const chats = [
  {
    id: "chat:example-contact",
    title: "Example contact",
    collection: "active",
    kind: "direct",
    latestVerifiedAt: "2026-08-22T09:30:00.000Z",
    history: { state: "complete", reachedBeginning: true, messageCount: 5 },
  },
  {
    id: "chat:project-group",
    title: "Project group",
    collection: "active",
    kind: "group",
    latestVerifiedAt: "2026-08-22T09:31:00.000Z",
    history: { state: "complete", reachedBeginning: true, messageCount: 3 },
  },
  {
    id: "chat:archived-client",
    title: "Archived client",
    collection: "archived",
    kind: "direct",
    latestVerifiedAt: "2026-08-20T12:00:00.000Z",
    history: { state: "complete", reachedBeginning: true, messageCount: 2 },
  },
];

export const messagesByChat = {
  "chat:example-contact": [
    { id: "s1", direction: "contact", senderName: "Example contact", kind: "text", text: "Will it rain tomorrow?", timestampMs: 1787389500000, timestampVerified: true, sequence: 1 },
    { id: "s2", direction: "owner", senderName: "You", kind: "text", text: "Let me check.", timestampMs: 1787389560000, timestampVerified: true, sequence: 2 },
    { id: "s3", direction: "contact", senderName: "Example contact", kind: "text", text: "Please confirm tomorrow.", timestampMs: 1787389620000, timestampVerified: true, sequence: 3 },
    { id: "s4", direction: "system", senderName: null, kind: "call", text: "Missed voice call Click to call back", timestampMs: 1787389680000, timestampVerified: true, sequence: 4 },
    { id: "s5", direction: "system", senderName: null, kind: "reaction", text: "Example contact: reaction 👍 · View reactions 👍", timestampMs: 1787389740000, timestampVerified: true, sequence: 5 },
  ],
  "chat:project-group": [
    { id: "g1", direction: "contact", senderName: "Member A", kind: "text", text: "The review moved to Monday.", timestampMs: 1787389500000, timestampVerified: true, sequence: 1 },
    { id: "g2", direction: "contact", senderName: "Member B", kind: "text", text: "Okay", timestampMs: 1787389560000, timestampVerified: true, sequence: 2 },
    { id: "g3", direction: "contact", senderName: "Member A", kind: "text", text: "Anyone can take it.", timestampMs: 1787389620000, timestampVerified: true, sequence: 3 },
  ],
  "chat:archived-client": [
    { id: "a1", direction: "contact", senderName: "Client", kind: "text", text: "Invoice received", timestampMs: 1787227200000, timestampVerified: true, sequence: 1 },
    { id: "a2", direction: "owner", senderName: "You", kind: "text", text: "done", timestampMs: 1787227260000, timestampVerified: true, sequence: 2 },
  ],
};
