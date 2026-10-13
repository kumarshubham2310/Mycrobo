import assert from "node:assert/strict";
import test from "node:test";

import { createDraftProviderFromEnv, createLocalDraftProvider, createOpenAIProviderFromEnv, detectSensitiveCurrentData, modelContextEnvelope } from "./draft-provider.mjs";

function context(overrides = {}) {
  return {
    story: [
      { id: "m1", speaker: "OWNER", text: "Where are you?" },
      { id: "m2", speaker: "OTHER", text: "Office se niklungi" },
    ],
    tone: {
      personSpecificExamples: ["Koi na", "Okay", "Ab kya"],
      generalExamples: ["Sure."],
    },
    relationship: {
      interactionCount: 0,
      medianOwnerReplyCharacters: 0,
      ownerEmojiReplyRate: 0,
      otherPartyExamples: [],
      interactions: [],
    },
    userIntent: null,
    ...overrides,
  };
}

test("local drafting answers a departure update with a context-specific acknowledgement", async () => {
  const provider = createLocalDraftProvider();
  const result = await provider.generate(context());

  assert.equal(result.draft, "Okay, dhyan se");
  assert.equal(result.language, "Roman Hindi");
  assert.deepEqual(result.evidenceIds, ["m1", "m2"]);
  assert.equal(result.generationRoute, "local");
  assert.equal(result.providerName, "mycrobo-local");
  assert.equal(result.providerModel, "local-safe-starter-v1");
  assert.equal(result.providerTransport, "in-process");
});

test("hybrid fallback reports the exact attempted and used providers", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const error = new Error("provider timed out");
    error.name = "TimeoutError";
    throw error;
  };
  try {
    const provider = createDraftProviderFromEnv({
      OPENAI_API_KEY: "configured-test-key",
      MYCROBO_MODEL_PROVIDER: "openai",
      MYCROBO_MODEL_PROCESSING_CONSENT: "true",
      MYCROBO_OPENAI_MODEL: "gpt-5.6-luna",
    });
    const result = await provider.generate(context());
    assert.equal(result.generationRoute, "local-fallback");
    assert.equal(result.providerName, "mycrobo-local");
    assert.equal(result.providerModel, "local-safe-starter-v1");
    assert.equal(result.providerTransport, "in-process");
    assert.equal(result.providerAttempted, "openai:gpt-5.6-luna");
    assert.equal(result.fallbackProvider, "mycrobo-local:local-safe-starter-v1");
    assert.equal(result.providerFailureClass, "provider-timeout");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("hybrid drafting has one total provider deadline, aborts the late request and returns the prepared private draft", async () => {
  const originalFetch = globalThis.fetch;
  let providerAborted = false;
  globalThis.fetch = async (_url, init = {}) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => {
      providerAborted = true;
      reject(init.signal.reason || new DOMException("aborted", "AbortError"));
    }, { once: true });
  });
  try {
    const provider = createDraftProviderFromEnv({
      OPENAI_API_KEY: "configured-test-key",
      MYCROBO_MODEL_PROVIDER: "openai",
      MYCROBO_MODEL_PROCESSING_CONSENT: "true",
      MYCROBO_OPENAI_MODEL: "gpt-5.6-luna",
    }, { draftDeadlineMs: 35 });
    const startedAt = performance.now();
    const result = await provider.generate(context());
    const elapsed = performance.now() - startedAt;
    assert.equal(providerAborted, true);
    assert.equal(result.generationRoute, "local-fallback");
    assert.equal(result.providerFailureClass, "provider-timeout");
    assert.equal(result.draftTimings.deadlineTriggered, true);
    assert.equal(result.draftTimings.deadlineMs, 35);
    assert.ok(elapsed < 250, `bounded fallback took ${elapsed.toFixed(1)}ms`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a provider that ignores cancellation cannot return a late cloud draft after the deadline", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Promise((resolve) => {
    const timer = setTimeout(() => resolve({
      ok: true,
      async json() {
        return { output_text: JSON.stringify({ candidates: [] }) };
      },
    }), 300);
    timer.unref?.();
  });
  try {
    const provider = createDraftProviderFromEnv({
      OPENAI_API_KEY: "configured-test-key",
      MYCROBO_MODEL_PROVIDER: "openai",
      MYCROBO_MODEL_PROCESSING_CONSENT: "true",
      MYCROBO_OPENAI_MODEL: "gpt-5.6-luna",
    }, { draftDeadlineMs: 30 });
    const startedAt = performance.now();
    const result = await provider.generate(context());
    const elapsed = performance.now() - startedAt;
    assert.equal(result.generationRoute, "local-fallback");
    assert.equal(result.draftTimings.deadlineTriggered, true);
    assert.ok(elapsed < 250, `ignored cancellation held the response for ${elapsed.toFixed(1)}ms`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("caller cancellation is never converted into a fallback draft", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init = {}) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(init.signal.reason || new DOMException("aborted", "AbortError")), { once: true });
  });
  try {
    const provider = createDraftProviderFromEnv({
      OPENAI_API_KEY: "configured-test-key",
      MYCROBO_MODEL_PROVIDER: "openai",
      MYCROBO_MODEL_PROCESSING_CONSENT: "true",
      MYCROBO_OPENAI_MODEL: "gpt-5.6-luna",
    }, { draftDeadlineMs: 1_000 });
    const controller = new AbortController();
    const pending = provider.generate(context(), { signal: controller.signal });
    controller.abort(new DOMException("view changed", "AbortError"));
    await assert.rejects(pending, /view changed|aborted/iu);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("local acknowledgement refuses ambiguous cold or commitment-like samples", async () => {
  const provider = createLocalDraftProvider();
  const result = await provider.generate(context({
    tone: { personSpecificExamples: ["Fine", "Sure", "Done", "Okay"], generalExamples: [] },
  }));

  assert.equal(result.draft, "Okay, dhyan se");
});

test("local drafting produces different replies for different conversational intents", async () => {
  const provider = createLocalDraftProvider();
  const examples = { personSpecificExamples: ["Koi na", "Hii", "Dekhta hu"], generalExamples: [] };
  const cases = [
    ["Hi", "Hii"],
    ["Thanks yaar", "Koi na"],
    ["Nhi kuch", "Okay, koi na"],
    ["Where are you?", "[Add: your current location]"],
    ["Subah bata dena pls", "[Confirm: kya commit kar sakte ho]"],
    ["Can you share the file?", "[Say: whether you can send or share it]"],
    ["Office se niklungi", "Okay, dhyan se"],
    ["❤️", "❤️"],
  ];
  const replies = [];
  for (const [message, expected] of cases) {
    const result = await provider.generate(context({
      story: [{ id: message, speaker: "OTHER", text: message }],
      tone: examples,
    }));
    assert.equal(result.draft, expected);
    replies.push(result.draft);
  }
  assert.equal(new Set(replies).size, cases.length);
});

test("local drafting understands Roman Gujarati requests", async () => {
  const provider = createLocalDraftProvider();
  const result = await provider.generate(context({
    story: [{ id: "gujarati", speaker: "OTHER", text: "File mokli do ne" }],
    tone: { personSpecificExamples: ["Kai nai"], generalExamples: [] },
  }));

  assert.equal(result.language, "Roman Gujarati");
  assert.equal(result.draft, "[Say: mokli shako cho ke nahi]");
});

test("local drafting gives specific safe answers to common questions", async () => {
  const provider = createLocalDraftProvider();
  const cases = [
    ["Any update?", "[Add: current status]"],
    ["Would love to know more about what you do?", "Sure, what would you like to know?"],
    ["How are you?", "[Say: how you are]"],
    ["Are you free?", "[Say: whether you are available]"],
  ];
  for (const [message, expected] of cases) {
    const result = await provider.generate(context({
      story: [{ id: message, speaker: "OTHER", text: message }],
      tone: { personSpecificExamples: [], generalExamples: ["Okay", "Sure"] },
    }));
    assert.equal(result.draft, expected);
  }
});

test("local drafting does not pad sparse evidence with a static reply catalogue", async () => {
  const provider = createLocalDraftProvider();
  const result = await provider.generate(context({ story: [{ id: "hello", speaker: "OTHER", text: "Hi", isTarget: true }] }));
  assert.equal(result.candidateCount, 1);
  assert.equal(result.evaluator, "fact-style-separated-v4");
  assert.equal(Object.hasOwn(result, "toneMatch"), false);
});

test("local drafting prefers an explicit user intent and remains bounded", async () => {
  const provider = createLocalDraftProvider();
  const result = await provider.generate(context({ userIntent: "Haan, 10 minute mein." }));

  assert.equal(result.draft, "Haan, 10 minute mein.");
});

test("local drafting honours an implemented language preference without changing comprehension", async () => {
  const provider = createLocalDraftProvider();
  const result = await provider.generate(context({
    story: [{ id: "thanks", speaker: "OTHER", text: "Thanks yaar" }],
    preferences: { draftLanguage: "English", replyLength: "short" },
  }));
  assert.equal(result.language, "English");
  assert.equal(result.draft, "Anytime");
});

test("local drafting correlates the same situation with the owner's response to each person", async () => {
  const provider = createLocalDraftProvider();
  const target = [{ id: "current-thanks", speaker: "OTHER", text: "Thanks yaar" }];
  const first = await provider.generate(context({
    story: target,
    relationship: {
      interactionCount: 1,
      medianOwnerReplyCharacters: 10,
      ownerEmojiReplyRate: 0,
      otherPartyExamples: ["Thank you yaar"],
      interactions: [{ otherMessageId: "a-in", ownerReplyId: "a-out", otherText: "Thank you yaar", ownerReply: "Koi na bro", responseDelayMs: 1000 }],
    },
  }));
  const second = await provider.generate(context({
    story: target,
    relationship: {
      interactionCount: 1,
      medianOwnerReplyCharacters: 10,
      ownerEmojiReplyRate: 1,
      otherPartyExamples: ["Thanks yaar"],
      interactions: [{ otherMessageId: "b-in", ownerReplyId: "b-out", otherText: "Thanks yaar", ownerReply: "Anytime 😊", responseDelayMs: 1000 }],
    },
  }));

  assert.equal(first.draft, "Koi na bro");
  // Historical messages influence style only. They are deliberately not
  // exposed as current factual evidence for this candidate.
  assert.deepEqual(first.evidenceIds, ["current-thanks"]);
  assert.equal(second.draft, "Anytime 😊");
  assert.notEqual(first.draft, second.draft);
});

test("counterfactual style policies change realization without changing the verified story", async () => {
  const provider = createLocalDraftProvider();
  const story = [{ id: "same-story", speaker: "OTHER", text: "Hi", isTarget: true }];
  const sparseRelationship = { interactionCount: 0, medianOwnerReplyCharacters: 0, ownerEmojiReplyRate: 0, otherPartyExamples: [], interactions: [] };
  const romanWarm = await provider.generate(context({
    story,
    tone: { personSpecificExamples: [], generalExamples: [] },
    relationship: {
      ...sparseRelationship,
      stylePolicy: {
        language: { value: "Roman Hindi" },
        length: { value: "medium", targetCharacters: 48 },
        formality: { value: "casual" },
        emoji: { value: "use", palette: ["🙂"] },
      },
    },
  }));
  const englishFormal = await provider.generate(context({
    story,
    tone: { personSpecificExamples: [], generalExamples: [] },
    relationship: {
      ...sparseRelationship,
      stylePolicy: {
        language: { value: "English" },
        length: { value: "medium", targetCharacters: 48 },
        formality: { value: "formal" },
        emoji: { value: "avoid", palette: [] },
      },
    },
  }));
  assert.equal(romanWarm.language, "Roman Hindi");
  assert.match(romanWarm.draft, /\p{Extended_Pictographic}/u);
  assert.equal(englishFormal.language, "English");
  assert.doesNotMatch(englishFormal.draft, /\p{Extended_Pictographic}/u);
  assert.deepEqual(romanWarm.evidenceIds, ["same-story"]);
  assert.deepEqual(englishFormal.evidenceIds, ["same-story"]);
  assert.notEqual(romanWarm.draft, englishFormal.draft);
});

test("supported active language transitions override an unrelated dominant global language", async () => {
  const provider = createLocalDraftProvider();
  const result = await provider.generate(context({
    story: [{ id: "transition", speaker: "OTHER", text: "The presentation is ready", isTarget: true }],
    currentIncomingTurn: { messageIds: ["transition"], text: "The presentation is ready" },
    tone: { personSpecificExamples: [], generalExamples: [] },
    relationship: {
      interactionCount: 0, medianOwnerReplyCharacters: 0, ownerEmojiReplyRate: 0, otherPartyExamples: [], interactions: [],
      behavioralDNA: {
        active: {
          sampleCount: 6, confidence: 0.8, medianCharacters: 25,
          writingModes: [{ mode: "English", count: 4, rate: 0.67 }, { mode: "Roman Hindi", count: 2, rate: 0.33 }],
          replyModesByIncomingMode: [{ incomingMode: "English", replyModes: [{ mode: "Roman Hindi", count: 4, rate: 0.8 }, { mode: "English", count: 1, rate: 0.2 }] }],
          responseActs: [{ act: "question", count: 5, rate: 0.83 }], emojiRate: 0, terminalPunctuationRate: 0,
        },
        global: { sampleCount: 30, confidence: 0.9, medianCharacters: 25, writingModes: [{ mode: "English", count: 28, rate: 0.93 }], responseActs: [{ act: "question", count: 20, rate: 0.67 }], emojiRate: 0, terminalPunctuationRate: 0 },
      },
      stylePolicy: {
        language: { value: "English", source: "target-mirror" }, length: { value: "short", targetCharacters: 25, source: "target-mirror" },
        formality: { value: "neutral", source: "target-mirror" }, emoji: { value: "avoid", source: "target-mirror", palette: [] },
      },
    },
  }));
  assert.equal(result.language, "Roman Hindi");
  assert.match(result.draft, /kya|hai|isme|meri/iu);
});

test("safe current-fact slots honor a supported conditional language instead of reverting to English", async () => {
  const provider = createLocalDraftProvider();
  const result = await provider.generate(context({
    story: [{ id: "where-transition", speaker: "OTHER", text: "Where are you?", isTarget: true }],
    currentIncomingTurn: { messageIds: ["where-transition"], text: "Where are you?" },
    tone: { personSpecificExamples: [], generalExamples: [] },
    safety: { requiresCurrentFact: true, requiredFacts: ["location"] },
    relationship: {
      interactionCount: 0, medianOwnerReplyCharacters: 0, ownerEmojiReplyRate: 0, otherPartyExamples: [], interactions: [],
      behavioralDNA: {
        active: {
          sampleCount: 4, confidence: 0.8, medianCharacters: 27,
          writingModes: [{ mode: "English", count: 3, rate: 0.75 }, { mode: "Roman Hindi", count: 1, rate: 0.25 }],
          replyModesByIncomingMode: [{ incomingMode: "English", replyModes: [{ mode: "Roman Hindi", count: 3, rate: 0.75 }, { mode: "English", count: 1, rate: 0.25 }] }],
          responseActs: [{ act: "information", count: 4, rate: 1 }], emojiRate: 0, terminalPunctuationRate: 0,
        },
        global: { sampleCount: 20, confidence: 0.9, medianCharacters: 45, writingModes: [{ mode: "English", count: 20, rate: 1 }], responseActs: [], emojiRate: 0, terminalPunctuationRate: 0 },
      },
      stylePolicy: {
        language: { value: "English", source: "target-mirror" }, length: { value: "short", targetCharacters: 27, source: "target-mirror" },
        formality: { value: "neutral", source: "target-mirror" }, emoji: { value: "avoid", source: "target-mirror", palette: [] },
      },
    },
  }));
  assert.equal(result.language, "Roman Hindi");
  assert.equal(result.draft, "[Add: abhi kahan ho woh likho]");
  assert.doesNotMatch(result.draft, /Delhi|Mumbai|office/iu);
});

test("supported global formality is used when the active situation is sparse", async () => {
  const provider = createLocalDraftProvider();
  const result = await provider.generate(context({
    story: [{ id: "formal-link", speaker: "OTHER", text: "https://youtu.be/abc", isTarget: true }],
    currentIncomingTurn: { messageIds: ["formal-link"], text: "https://youtu.be/abc" },
    tone: { personSpecificExamples: [], generalExamples: [] },
    relationship: {
      interactionCount: 0, medianOwnerReplyCharacters: 0, ownerEmojiReplyRate: 0, otherPartyExamples: [], interactions: [],
      behavioralDNA: {
        active: { sampleCount: 2, confidence: 0.4, medianCharacters: 25, writingModes: [{ mode: "English", count: 2, rate: 1 }], formalRate: 0, casualRate: 0 },
        global: { sampleCount: 30, confidence: 0.8, medianCharacters: 35, writingModes: [{ mode: "English", count: 30, rate: 1 }], formalRate: 0.8, casualRate: 0.05, emojiRate: 0 },
      },
      stylePolicy: {
        language: { value: "English", source: "target-mirror" }, length: { value: "short", targetCharacters: 25, source: "target-mirror" },
        formality: { value: "neutral", source: "target-mirror" }, emoji: { value: "avoid", source: "target-mirror", palette: [] },
      },
    },
  }));
  assert.match(result.draft, /please/iu);
  assert.match(result.draft, /YouTube/iu);
});

test("local drafting never replays stale facts or secrets from a relationship", async () => {
  const provider = createLocalDraftProvider();
  const unsafe = [
    ["Any update?", "OTP is 123456"],
    ["Any update?", "₹5000 received today"],
  ];
  for (const [message, oldReply] of unsafe) {
    const result = await provider.generate(context({
      story: [{ id: "current", speaker: "OTHER", text: message }],
      tone: { personSpecificExamples: [], generalExamples: [] },
      relationship: {
        interactionCount: 1,
        medianOwnerReplyCharacters: oldReply.length,
        ownerEmojiReplyRate: 0,
        otherPartyExamples: [message],
        interactions: [{ otherMessageId: "old-in", ownerReplyId: "old-out", otherText: message, ownerReply: oldReply, responseDelayMs: 500 }],
      },
    }));
    assert.equal(result.draft, "[Add: current status]");
    assert.doesNotMatch(result.draft, /123456|5000/u);
  }
});

test("historical commitments and current facts never become a new reply", async () => {
  const provider = createLocalDraftProvider();
  const unsafeReplies = [
    "I'll call you soon",
    "I will finish it later",
    "Main office mein hu",
    "Haan, 7 pm tak pahunch jaunga",
    "Das minute mein bhej dunga",
    "Savare mokli dais",
    "I am free now",
  ];
  for (const ownerReply of unsafeReplies) {
    const result = await provider.generate(context({
      story: [{ id: "current", speaker: "OTHER", text: "Any update?" }],
      tone: { personSpecificExamples: [ownerReply], generalExamples: [] },
      relationship: {
        interactionCount: 1,
        medianOwnerReplyCharacters: ownerReply.length,
        ownerEmojiReplyRate: 0,
        otherPartyExamples: ["Any update?"],
        interactions: [{ otherMessageId: "old-in", ownerReplyId: "old-out", otherText: "Any update?", ownerReply, responseDelayMs: 500 }],
      },
    }));
    assert.equal(result.draft, "[Add: current status]", ownerReply);
  }
});

test("requests for time, availability, location and action never manufacture an answer", async () => {
  const provider = createLocalDraftProvider();
  const cases = [
    ["What time will you reach?", "[Add: actual time]"],
    ["Are you free now?", "[Say: whether you are available]"],
    ["Where are you?", "[Add: your current location]"],
    ["Can you call me?", "[Say: whether you can call]"],
    ["Please check the document", "[Say: whether you can check it]"],
    ["Subah update dena", "[Confirm: kya commit kar sakte ho]"],
  ];
  for (const [message, expected] of cases) {
    const result = await provider.generate(context({ story: [{ id: message, speaker: "OTHER", text: message }] }));
    assert.equal(result.draft, expected, message);
  }
});

test("relationship emoji behavior shapes short acknowledgements", async () => {
  const provider = createLocalDraftProvider();
  const result = await provider.generate(context({
    story: [{ id: "ack", speaker: "OTHER", text: "Done" }],
    tone: { personSpecificExamples: [], generalExamples: [] },
    relationship: {
      interactionCount: 10,
      medianOwnerReplyCharacters: 2,
      ownerEmojiReplyRate: 0.7,
      otherPartyExamples: ["Okay"],
      interactions: [],
    },
  }));

  assert.equal(result.draft, "👍");
});

test("desktop drafting always has a private local fallback", () => {
  const provider = createDraftProviderFromEnv({});
  assert.equal(provider.name, "local-safe-starter");
});

test("cloud drafting requires explicit model-processing consent", () => {
  assert.equal(createOpenAIProviderFromEnv({ OPENAI_API_KEY: "test", MYCROBO_OPENAI_MODEL: "configured-model" }), null);
  assert.equal(createOpenAIProviderFromEnv({ OPENAI_API_KEY: "test", MYCROBO_OPENAI_MODEL: "configured-model", MYCROBO_MODEL_PROCESSING_CONSENT: "true" }).name, "openai:configured-model");
});

test("the cloud envelope is bounded and redacts credential-like chat content", () => {
  const envelope = modelContextEnvelope(context({
    story: [{ id: "secret", speaker: "OTHER", text: "OTP is 123456", isTarget: true }],
    tone: { personSpecificExamples: ["password: hunter2"], generalExamples: [] },
    chat: { id: "private-id", title: "Private Person", kind: "direct" },
    freshness: { targetMessageId: "secret" },
  }));
  assert.match(envelope.chat.messages[0].text, /\[REDACTED\]/u);
  assert.doesNotMatch(JSON.stringify(envelope.characteristics.ownerWriting.personSpecific), /hunter2/iu);
  assert.equal(envelope.chat.kind, "direct");
  assert.equal(Object.hasOwn(envelope.chat, "title"), false);
});

test("unlabelled payment cards and common PII are redacted before a provider envelope exists", () => {
  const envelope = modelContextEnvelope(context({
    story: [{ id: "private", speaker: "OTHER", text: "Use 4111 1111 1111 1111, PAN ABCDE1234F and email owner@example.test; https://private.test/a?token=secret-value", isTarget: true }],
    freshness: { targetMessageId: "private" },
  }));
  const serialized = JSON.stringify(envelope);
  assert.doesNotMatch(serialized, /4111 1111 1111 1111|ABCDE1234F|owner@example\.test|secret-value/iu);
  assert.match(serialized, /REDACTED:PAYMENT-CARD/iu);
  assert.match(serialized, /REDACTED:EMAIL/iu);
  assert.match(serialized, /REDACTED:GOVERNMENT-ID/iu);
  assert.match(serialized, /REDACTED:PRIVATE-URL/iu);
  assert.deepEqual(detectSensitiveCurrentData("4111111111111111").map((item) => item.kind), ["payment-card"]);
});

test("lowercase PAN and AWS or Azure signed URLs are typed and redacted", () => {
  const privateText = [
    "pan abcde1234f",
    "https://bucket.s3.example.test/report.pdf?X-Amz-Credential=tenant%2Fscope&X-Amz-Signature=abc123",
    "https://storage.example.test/blob?sp=r&sig=azure-secret",
    "https://proxy.example.test/?X-Amz-Signature%3Dencoded-secret%26X-Amz-Date%3D20260912",
  ].join("\n");
  const envelope = modelContextEnvelope(context({
    story: [{ id: "signed", speaker: "OTHER", text: privateText, isTarget: true }],
    freshness: { targetMessageId: "signed" },
  }));
  const serialized = JSON.stringify(envelope);
  assert.doesNotMatch(serialized, /abcde1234f|tenant%2Fscope|abc123|azure-secret|encoded-secret/iu);
  assert.match(serialized, /REDACTED:GOVERNMENT-ID/iu);
  assert.equal((serialized.match(/REDACTED:PRIVATE-URL/gu) || []).length, 3);
  assert.deepEqual([...new Set(detectSensitiveCurrentData(privateText).map((item) => item.kind))].sort(), ["government-id", "private-url"]);
});

test("sensitive current data forces the private local route without calling a provider", async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => { providerCalls += 1; throw new Error("provider must not be called"); };
  try {
    const provider = createDraftProviderFromEnv({
      OPENAI_API_KEY: "configured-test-key",
      MYCROBO_MODEL_PROVIDER: "openai",
      MYCROBO_MODEL_PROCESSING_CONSENT: "true",
    });
    const result = await provider.generate(context({
      story: [{ id: "card", speaker: "OTHER", text: "Please use card 4111111111111111", isTarget: true }],
      freshness: { targetMessageId: "card" },
    }));
    assert.equal(result.generationRoute, "local-sensitive-data");
    assert.equal(providerCalls, 0);
    assert.doesNotMatch(result.draft, /4111111111111111/u);
    const signed = await provider.generate(context({
      story: [{ id: "signed", speaker: "OTHER", text: "Open https://bucket.test/a?X-Amz-Signature=sensitive-value for abcde1234f", isTarget: true }],
      freshness: { targetMessageId: "signed" },
    }));
    assert.equal(signed.generationRoute, "local-sensitive-data");
    assert.equal(providerCalls, 0);
    assert.doesNotMatch(signed.draft, /sensitive-value|abcde1234f/iu);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
