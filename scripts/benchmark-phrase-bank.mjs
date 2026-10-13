import { performance } from "node:perf_hooks";

import {
  buildDynamicPhraseBank,
  clearDynamicPhraseBankCache,
  dynamicPhraseBankCacheDiagnostics,
} from "../packages/core/phrase-bank.ts";

const chatCount = Math.max(1, Math.min(250, Number(process.env.MYCROBO_PHRASE_BENCHMARK_CHATS || 150)));
const pairsPerChat = Math.max(1, Math.min(500, Number(process.env.MYCROBO_PHRASE_BENCHMARK_PAIRS || 100)));
const accountScopeId = "phrase-bank-benchmark-tenant";
const chats = [];
const events = [];

for (let chatIndex = 0; chatIndex < chatCount; chatIndex += 1) {
  const chatId = `chat-${chatIndex}`;
  const personId = `person-${chatIndex}`;
  chats.push({
    id: chatId,
    accountScopeId,
    connector: "fixture",
    connectorIds: [chatId],
    title: `Person ${chatIndex}`,
    collection: "active",
    kind: "direct",
    participantIds: ["owner", personId],
  });
  for (let pairIndex = 0; pairIndex < pairsPerChat; pairIndex += 1) {
    const timestampMs = (chatIndex * pairsPerChat + pairIndex) * 700_000;
    events.push({
      id: `${chatId}-incoming-${pairIndex}`,
      accountScopeId,
      chatId,
      connectorMessageId: `${chatId}-incoming-${pairIndex}`,
      direction: "contact",
      senderId: personId,
      senderName: `Person ${chatIndex}`,
      kind: "text",
      text: `Can you check document ${pairIndex}?`,
      timestampMs: timestampMs + 1_000,
      timestampVerified: true,
      sequence: timestampMs + 1_000,
    });
    events.push({
      id: `${chatId}-reply-${pairIndex}`,
      accountScopeId,
      chatId,
      connectorMessageId: `${chatId}-reply-${pairIndex}`,
      direction: "owner",
      senderId: "owner",
      senderName: "You",
      kind: "text",
      text: `Haan, document ${pairIndex} check karke batata hu`,
      timestampMs: timestampMs + 2_000,
      timestampVerified: true,
      sequence: timestampMs + 2_000,
    });
  }
}

clearDynamicPhraseBankCache(accountScopeId);
const options = { accountScopeId, chats, events, ownerIds: ["owner"], nowMs: Date.now() };
const initialStart = performance.now();
const initial = buildDynamicPhraseBank(options);
const initialMs = performance.now() - initialStart;
const cachedStart = performance.now();
const cached = buildDynamicPhraseBank({ ...options, events: [...events], nowMs: options.nowMs + 1 });
const cachedMs = performance.now() - cachedStart;

process.stdout.write(`${JSON.stringify({
  chatCount,
  messageCount: events.length,
  episodeCount: chatCount * pairsPerChat,
  patternCount: initial.patterns.length,
  cachedPatternCount: cached.patterns.length,
  initialMs: Number(initialMs.toFixed(2)),
  cachedMs: Number(cachedMs.toFixed(2)),
  speedup: Number((initialMs / Math.max(cachedMs, 0.01)).toFixed(2)),
  cache: dynamicPhraseBankCacheDiagnostics(accountScopeId).accounts[0],
}, null, 2)}\n`);
