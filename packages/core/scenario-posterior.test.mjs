import assert from "node:assert/strict";
import test from "node:test";

import { buildBehavioralDNA } from "./behavioral-dna.ts";
import { createScenarioRegistry, inferOwnerResponseMode, inferScenarioFamilies, scenarioCode } from "./scenarios.ts";

test("the registry remains exactly 15 by 10 by 10 with stable codes", () => {
  const registry = createScenarioRegistry();
  assert.equal(registry.length, 1500);
  assert.equal(new Set(registry.map((cell) => cell.id)).size, 1500);
  assert.equal(scenarioCode("conflict", "vendor", "urgent"), "C05.S07.T04");
});

test("multi-part turns preserve a substantive request ahead of thanks", () => {
  const families = inferScenarioFamilies("thanks", "Thanks, please also send the file");
  assert.equal(families[0].family, "request");
  assert.ok(families.some((candidate) => candidate.family === "acknowledgement"));
});

test("Roman Gujarati coordination survives a wellbeing fragment", () => {
  const families = inferScenarioFamilies("wellbeing-question", "Kem cho? Kal ketla vagye malishu?");
  assert.equal(families[0].family, "coordination");
  assert.ok(families.some((candidate) => candidate.family === "clarification"));
});

test("direct questions route to answer while genuine ambiguity routes to clarification", () => {
  assert.equal(inferScenarioFamilies("why-question", "Why did this fail?")[0].family, "answer");
  assert.equal(inferScenarioFamilies("open-question", "What do you mean?")[0].family, "clarification");
});

test("every response mode is reachable independently of the interaction family", () => {
  const examples = new Map([
    ["calm", "No rush, take your time"],
    ["warm", "Sure yaar 😊"],
    ["direct", "What exactly is required?"],
    ["urgent", "This is urgent, do it right now"],
    ["formal", "Kindly review this. Regards"],
    ["playful", "Haha 😂"],
    ["apologetic", "Sorry, maaf karna"],
    ["decisive", "Confirmed. I will do it"],
    ["supportive", "Don't worry, take care"],
    ["neutral", "Information received"],
  ]);
  for (const [expected, reply] of examples) {
    assert.equal(inferOwnerResponseMode(reply, "information", "friend"), expected, `${expected} was unreachable`);
  }
});

test("historical scenario mode is learned from the owner's reply, not the incoming mood", () => {
  const dna = buildBehavioralDNA([
    { otherText: "URGENT: send this immediately", ownerReply: "Sure, I will check and confirm.", responseDelayMs: 1000 },
    { otherText: "Please send the file ASAP", ownerReply: "I will share it after checking.", responseDelayMs: 2000 },
  ], "Please send the updated file", "vendor");
  assert.equal(dna.version, 2);
  assert.notEqual(dna.activeScenario.mode, "urgent");
  assert.match(dna.activeScenario.code, /^C\d{2}\.S\d{2}\.T\d{2}$/u);
  assert.ok(dna.activeScenario.candidates.length > 1);
});
