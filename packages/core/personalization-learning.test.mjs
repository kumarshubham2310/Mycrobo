import assert from "node:assert/strict";
import test from "node:test";

import { classifyDraftEditOutcome, personalizationOutcomeAdjustment } from "./personalization-learning.ts";

test("edit classification returns content-free acceptance bands", () => {
  assert.deepEqual(classifyDraftEditOutcome("Will check and update you", "Will check and update you"), { outcome: "accepted", editRatio: 0 });
  assert.equal(classifyDraftEditOutcome("Will check and update you", "Will check this and update you").outcome, "lightly-edited");
  assert.equal(classifyDraftEditOutcome("Will check and update you", "No, this is unrelated").outcome, "full-rewrite");
  assert.deepEqual(classifyDraftEditOutcome("Will check and update you", ""), { outcome: "dismissed", editRatio: 1 });
});

test("edit classification never returns either source message", () => {
  const secret = "PRIVATE-TEXT-928174";
  const result = classifyDraftEditOutcome(`I will check ${secret}`, `Let me verify ${secret}`);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE-TEXT|928174/iu);
  assert.deepEqual(Object.keys(result).sort(), ["editRatio", "outcome"]);
});

test("feedback adjustments reward acceptance and penalize rewrites or no-reply outcomes", () => {
  assert.ok(personalizationOutcomeAdjustment("accepted") > personalizationOutcomeAdjustment("lightly-edited"));
  assert.ok(personalizationOutcomeAdjustment("full-rewrite") < 0);
  assert.ok(personalizationOutcomeAdjustment("no-reply") < personalizationOutcomeAdjustment("dismissed"));
  assert.equal(personalizationOutcomeAdjustment("shown"), 0);
});
