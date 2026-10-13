import assert from "node:assert/strict";
import test from "node:test";

import { selectBehavioralStylePolicy, stylePolicyCompatibility } from "./style-policy.ts";

function bucket({ samples = 20, effectiveSamples = samples, language = "English", languageRate = 0.9, characters = 28, formal = 0, casual = 0, emoji = 0, palette = [] } = {}) {
  const otherLanguage = language === "English" ? "Roman Hindi" : "English";
  const length = characters <= 12 ? "micro" : characters <= 35 ? "short" : characters <= 100 ? "medium" : "long";
  return {
    sampleCount: samples,
    effectiveSampleSize: effectiveSamples,
    confidence: samples / (samples + 5),
    medianCharacters: characters,
    writingModes: [{ mode: language, count: Math.round(samples * languageRate), rate: languageRate }, { mode: otherLanguage, count: Math.round(samples * (1 - languageRate)), rate: 1 - languageRate }],
    lengthBuckets: [{ bucket: length, count: samples, rate: 1 }],
    formalRate: formal,
    casualRate: casual,
    emojiRate: emoji,
    emojiPalette: palette,
  };
}

test("supported exact-person active evidence independently controls all four style dimensions", () => {
  const policy = selectBehavioralStylePolicy({
    incomingText: "Please share the update",
    personDNA: { active: bucket({ samples: 24, language: "Roman Hindi", characters: 10, casual: 0.8, emoji: 0.75, palette: ["🙂"] }) },
    ownerGlobalDNA: { global: bucket({ samples: 100, language: "English", characters: 70, formal: 0.8, emoji: 0 }) },
  });
  assert.deepEqual({ language: policy.language.value, length: policy.length.value, formality: policy.formality.value, emoji: policy.emoji.value }, {
    language: "Roman Hindi", length: "micro", formality: "casual", emoji: "use",
  });
  assert.equal(policy.language.source, "exact-person-active");
  assert.equal(policy.emoji.palette[0], "🙂");
});

test("changing only exact-person evidence changes style for the same story", () => {
  const common = { incomingText: "Can you review this?", ownerGlobalDNA: { global: bucket({ samples: 40 }) } };
  const conciseCasual = selectBehavioralStylePolicy({ ...common, personDNA: { active: bucket({ samples: 30, language: "Roman Hindi", characters: 9, casual: 0.9, emoji: 0 }) } });
  const detailedFormal = selectBehavioralStylePolicy({ ...common, personDNA: { active: bucket({ samples: 30, language: "English", characters: 74, formal: 0.9, emoji: 0.8, palette: ["🙏"] }) } });
  assert.notDeepEqual(
    [conciseCasual.language.value, conciseCasual.length.value, conciseCasual.formality.value, conciseCasual.emoji.value],
    [detailedFormal.language.value, detailedFormal.length.value, detailedFormal.formality.value, detailedFormal.emoji.value],
  );
});

test("supported incoming-to-reply language transitions override a permanent person label", () => {
  const active = bucket({ samples: 30, language: "English", languageRate: 0.8 });
  active.replyModesByIncomingMode = [{
    incomingMode: "Roman Hindi",
    replyModes: [
      { mode: "Roman Hindi", count: 9, rate: 0.9 },
      { mode: "English", count: 1, rate: 0.1 },
    ],
  }];
  const policy = selectBehavioralStylePolicy({
    incomingText: "kya update hai",
    personDNA: { active },
  });
  assert.equal(policy.language.value, "Roman Hindi");
  assert.equal(policy.language.source, "exact-person-active");
  assert.match(policy.language.rationale, /incoming-language context/iu);
});

test("correlated language evidence keeps raw transition counts while gating on effective support", () => {
  const active = bucket({ samples: 8, effectiveSamples: 6, language: "English", languageRate: 0.75 });
  active.replyModesByIncomingMode = [{
    incomingMode: "Roman Hindi",
    effectiveSampleSize: 6,
    replyModes: [
      { mode: "Roman Hindi", count: 7, rate: 0.875 },
      { mode: "English", count: 1, rate: 0.125 },
    ],
  }];
  const policy = selectBehavioralStylePolicy({ incomingText: "kya update hai", personDNA: { active } });
  assert.equal(policy.language.value, "Roman Hindi");
  assert.equal(policy.language.source, "exact-person-active");
  assert.equal(policy.language.sampleCount, 8);
  assert.equal(policy.language.effectiveSampleSize, 6);
});

test("an effective four-sample median controls brevity while a sparse median fails closed", () => {
  const common = { incomingText: "Please share the complete project update with all of the background details" };
  const supported = selectBehavioralStylePolicy({
    ...common,
    personDNA: { active: bucket({ samples: 4, effectiveSamples: 4, characters: 18 }) },
  });
  const sparse = selectBehavioralStylePolicy({
    ...common,
    personDNA: { active: bucket({ samples: 2, effectiveSamples: 2, characters: 18 }) },
  });
  assert.equal(supported.length.value, "short");
  assert.equal(supported.length.source, "exact-person-active");
  assert.equal(sparse.length.source, "target-mirror");
});

test("stronger account-wide formality backs off over weaker person evidence for a neutral cue", () => {
  const policy = selectBehavioralStylePolicy({
    incomingText: "Project update",
    personDNA: { active: bucket({ samples: 24, effectiveSamples: 20, casual: 0.9 }) },
    ownerGlobalDNA: { global: bucket({ samples: 100, effectiveSamples: 100, formal: 0.98 }) },
  });
  assert.equal(policy.formality.value, "formal");
  assert.equal(policy.formality.source, "owner-global");
});

test("sparse person evidence cannot seize the style policy", () => {
  const policy = selectBehavioralStylePolicy({
    incomingText: "kya update hai",
    personDNA: { active: bucket({ samples: 2, language: "Roman Gujarati", languageRate: 1, characters: 120, formal: 1, emoji: 1, palette: ["😂"] }) },
    ownerGlobalDNA: { global: bucket({ samples: 3, language: "English", languageRate: 1, characters: 80, formal: 1, emoji: 1 }) },
  });
  assert.equal(policy.language.value, "Roman Hindi");
  assert.equal(policy.language.source, "target-mirror");
  assert.equal(policy.formality.value, "casual");
  assert.equal(policy.formality.source, "target-mirror");
});

test("well-supported global evidence wins only dimensions where it beats mirroring", () => {
  const policy = selectBehavioralStylePolicy({
    incomingText: "hey bro can you review it",
    personDNA: { active: bucket({ samples: 1 }) },
    ownerGlobalDNA: { global: bucket({ samples: 120, language: "English", languageRate: 0.98, characters: 72, formal: 0.98, emoji: 0 }) },
  });
  assert.equal(policy.language.source, "owner-global");
  assert.equal(policy.length.source, "owner-global");
  // Clear current casual cues remain stronger than the lower-performing
  // account-global formality strategy.
  assert.equal(policy.formality.value, "casual");
  assert.equal(policy.formality.source, "target-mirror");
});

test("explicit conversation preferences are final and policy contains no evidence text", () => {
  const policy = selectBehavioralStylePolicy({
    incomingText: "kya scene hai",
    personDNA: { active: bucket({ samples: 40, language: "Roman Hindi", characters: 8, casual: 1, emoji: 1, palette: ["😂"] }) },
    preferences: { draftLanguage: "English", replyLength: "medium", formality: "formal", emoji: "avoid" },
  });
  assert.deepEqual([policy.language.source, policy.length.source, policy.formality.source, policy.emoji.source], Array(4).fill("explicit-preference"));
  assert.deepEqual([policy.language.value, policy.length.value, policy.formality.value, policy.emoji.value], ["English", "medium", "formal", "avoid"]);
  assert.doesNotMatch(JSON.stringify(policy), /kya scene hai/iu);
});

test("compatibility scoring changes when the evidence-backed policy changes", () => {
  const casual = selectBehavioralStylePolicy({ incomingText: "hey bro", personDNA: { active: bucket({ samples: 30, characters: 20, casual: 1, emoji: 0 }) } });
  const formal = selectBehavioralStylePolicy({ incomingText: "hey bro", personDNA: { active: bucket({ samples: 30, characters: 70, formal: 1, emoji: 1, palette: ["🙏"] }) } });
  const candidate = "Could you please review this. 🙏";
  assert.ok(stylePolicyCompatibility(candidate, formal).score > stylePolicyCompatibility(candidate, casual).score);
});
