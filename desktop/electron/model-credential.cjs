const { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const CREDENTIAL_FILE = "model-provider-key.bin";
const CREDENTIAL_VERSION = 1;
const PROVIDER_DEFAULT_MODEL = Object.freeze({
  openai: "gpt-5.6-luna",
  gemini: "gemini-3.7-flash",
});

function credentialPath(userData) {
  return join(userData, CREDENTIAL_FILE);
}

function normalizeCredential(secret) {
  const value = String(secret || "").trim();
  if (value.length < 20 || value.length > 512 || /[\r\n\0]/u.test(value)) {
    throw new Error("The model credential is not a valid single-line secret.");
  }
  return value;
}

function storeModelCredential({ userData, safeStorage, secret, provider = "openai", model }) {
  if (!safeStorage?.isEncryptionAvailable?.()) {
    throw new Error("Windows secure storage is unavailable; the model credential was not saved.");
  }
  const key = normalizeCredential(secret);
  const normalizedProvider = String(provider || "openai").trim().toLocaleLowerCase();
  const defaultModel = PROVIDER_DEFAULT_MODEL[normalizedProvider];
  if (!defaultModel) throw new Error("The model credential provider is not supported.");
  const normalizedModel = String(model || defaultModel).trim() || defaultModel;
  const payload = JSON.stringify({
    version: CREDENTIAL_VERSION,
    provider: normalizedProvider,
    model: normalizedModel,
    key,
    storedAt: new Date().toISOString(),
  });
  const target = credentialPath(userData);
  const temporary = `${target}.new`;
  try {
    writeFileSync(temporary, safeStorage.encryptString(payload), { mode: 0o600, flag: "w" });
    renameSync(temporary, target);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  return { configured: true, provider: normalizedProvider, model: normalizedModel };
}

function loadModelCredential({ userData, safeStorage }) {
  const target = credentialPath(userData);
  if (!existsSync(target)) return null;
  if (!safeStorage?.isEncryptionAvailable?.()) {
    throw new Error("Windows secure storage is unavailable; the saved model credential cannot be opened.");
  }
  let payload;
  try {
    payload = JSON.parse(safeStorage.decryptString(readFileSync(target)));
  } catch {
    throw new Error("The protected model credential is unreadable. Remove it and configure the provider again.");
  }
  const provider = String(payload?.provider || "").trim().toLocaleLowerCase();
  const defaultModel = PROVIDER_DEFAULT_MODEL[provider];
  if (payload?.version !== CREDENTIAL_VERSION || !defaultModel) {
    throw new Error("The protected model credential has an unsupported format.");
  }
  return {
    provider,
    model: String(payload.model || defaultModel).trim() || defaultModel,
    key: normalizeCredential(payload.key),
  };
}

function removeModelCredential(userData) {
  const target = credentialPath(userData);
  if (!existsSync(target)) return false;
  unlinkSync(target);
  return true;
}

module.exports = {
  CREDENTIAL_FILE,
  credentialPath,
  loadModelCredential,
  normalizeCredential,
  removeModelCredential,
  storeModelCredential,
};
