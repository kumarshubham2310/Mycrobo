import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { composerSendState, unresolvedComposerPlaceholders } from "./composer-safety.mjs";

test("an unresolved current-fact placeholder blocks the send action", () => {
  const value = "I should reach by [Add the actual time before sending]";
  assert.deepEqual(unresolvedComposerPlaceholders(value), ["[Add the actual time before sending]"]);
  assert.equal(composerSendState(value).canSend, false);
});

test("editing the current fact enables the single send action", () => {
  assert.equal(composerSendState("I should reach by 7:30 PM").canSend, true);
  assert.equal(composerSendState("   ").canSend, false);
});

test("ordinary sending has no per-message checkbox or review dialog", async () => {
  const source = await readFile(new URL("./app.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /sendConfirmed|I checked both the recipient|Review & send/u);
  assert.match(source, /Send to \$\{escapeHtml\(shownTitle\(chat\)\)\}/u);
  assert.match(source, /addEventListener\("click"[^]*sendEditedReply/u);
});
