import assert from "node:assert/strict";
import test from "node:test";

import { abstractBehavioralDNA, buildBehavioralDNA } from "./behavioral-dna.ts";

test("cross-relationship BehavioralDNA retains abstract policy and removes every lexical surface", () => {
  const replies = ["ok bro", "haan bhai", "sure sir", "🙏", "no worries ji"];
  const exact = buildBehavioralDNA(replies.map((ownerReply) => ({
    otherText: "Please review this",
    ownerReply,
    responseDelayMs: 1_000,
  })), "Can you review this?", "colleague");
  const projected = abstractBehavioralDNA(exact);

  assert.equal(projected.sampleCount, replies.length);
  assert.ok(projected.global.responseActs.length > 0);
  assert.ok(projected.global.writingModes.length > 0);
  assert.ok(projected.global.lengthBuckets.length > 0);
  for (const bucket of [
    projected.active,
    projected.global,
    ...Object.values(projected.byIncomingIntent),
    ...Object.values(projected.byScenario),
  ]) {
    assert.deepEqual(bucket.addressForms, []);
    assert.deepEqual(bucket.emojiPalette, []);
    assert.deepEqual(bucket.safeAtoms, []);
  }
  const serialized = JSON.stringify(projected);
  for (const reply of replies) assert.equal(serialized.includes(reply), false);
});

test("exact-target BehavioralDNA may retain its own relationship lexical evidence", () => {
  const targetPhrase = "got it yaar";
  const exact = buildBehavioralDNA([{
    otherText: "Thanks",
    ownerReply: targetPhrase,
    responseDelayMs: 500,
  }], "Please review this", "friend");

  assert.ok(exact.global.safeAtoms.includes(targetPhrase));
  assert.ok(exact.global.addressForms.includes("yaar"));
});
