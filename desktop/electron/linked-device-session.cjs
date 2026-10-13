const { randomBytes } = require("node:crypto");
const { closeSync, existsSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } = require("node:fs");
const { dirname, join, resolve } = require("node:path");

const SELECTED_SESSION = /^linked-device\.db\.relink-[A-Z2-7]{16,64}\.db$/u;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function encryptedSibling(databasePath) {
  return databasePath.endsWith(".db") ? `${databasePath.slice(0, -3)}.vault.db` : `${databasePath}.vault.db`;
}

// A workspace may retain several reversible linked-device attempts. The
// selection record is the only authority for choosing among them; never infer
// identity from recency, file size, a display name or chat content.
function resolveLinkedDeviceDatabase(tenantData) {
  const root = resolve(tenantData);
  const fallback = join(root, "linked-device.db");
  try {
    const selection = JSON.parse(readFileSync(join(root, "linked-device.db.selection.json"), "utf8"));
    const name = String(selection?.session || "");
    if (selection?.version !== 1 || !SELECTED_SESSION.test(name)) return fallback;
    const selected = resolve(root, name);
    if (dirname(selected) !== root) return fallback;
    if (!existsSync(selected) && !existsSync(encryptedSibling(selected))) return fallback;
    return selected;
  } catch {
    return fallback;
  }
}

function newSessionToken(bytes = randomBytes(20)) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

// A failed or revoked provider session is never overwritten. Reconnection
// selects a new empty linked-device store and leaves every previous attempt in
// place so the operation is reversible and normalized chat history is kept.
function prepareFreshLinkedDeviceSession(tenantData, options = {}) {
  const root = resolve(tenantData);
  const token = String(options.token || newSessionToken());
  if (!/^[A-Z2-7]{16,64}$/u.test(token)) throw new Error("A secure linked-device session identifier could not be created.");
  const name = `linked-device.db.relink-${token}.db`;
  const database = join(root, name);
  const selection = join(root, "linked-device.db.selection.json");
  const temporary = join(root, `linked-device.db.selection.${token}.tmp`);
  let handle;
  try {
    handle = openSync(database, "wx", 0o600);
    closeSync(handle);
    handle = undefined;
    writeFileSync(temporary, `${JSON.stringify({ version: 1, session: name, selectedAt: new Date().toISOString(), reason: "user-requested-relink" })}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    renameSync(temporary, selection);
    return { database, name };
  } catch (error) {
    if (handle !== undefined) closeSync(handle);
    try { unlinkSync(temporary); } catch {}
    try { unlinkSync(database); } catch {}
    throw error;
  }
}

module.exports = { SELECTED_SESSION, encryptedSibling, prepareFreshLinkedDeviceSession, resolveLinkedDeviceDatabase };
