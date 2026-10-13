import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizePairingPhone,
  pairingCodeCells,
  shouldCheckSavedChatsBeforeSetup,
} from "./pairing-presentation.mjs";

test("phone pairing accepts an international number without storing display punctuation", () => {
  assert.equal(normalizePairingPhone("+91", "9876543210"), "+919876543210");
  assert.throws(() => normalizePairingPhone("+91", "09876543210"), /leading zero/iu);
  assert.throws(() => normalizePairingPhone("91", "9876543210"), /country code/iu);
});

test("WhatsApp phone pairing is rendered only as an eight-character alphanumeric code", () => {
  assert.deepEqual(pairingCodeCells("A1B2-C3D4"), ["A", "1", "B", "2", "C", "3", "D", "4"]);
  assert.deepEqual(pairingCodeCells("abcdefgh"), ["A", "B", "C", "D", "E", "F", "G", "H"]);
  assert.deepEqual(pairingCodeCells("1234567"), []);
  assert.deepEqual(pairingCodeCells("123456789"), []);
});

test("starting or reconnecting never waits for a saved-chat catalogue probe", () => {
  assert.equal(shouldCheckSavedChatsBeforeSetup({ forceSetup: true }), false);
  assert.equal(shouldCheckSavedChatsBeforeSetup({ skipSavedChatProbe: true }), false);
  assert.equal(shouldCheckSavedChatsBeforeSetup(), true);
});
