const { generateKeyPairSync, randomUUID } = require("node:crypto");
const { chmodSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const BINDING_FILE = "cloud-relay-binding.bin";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const LOCAL_ID = /^tenant-[a-f0-9]{16}$/u;

function cleanEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw new Error("Enter the same valid email used by this MyCrobo account.");
  return email;
}

function deploymentConfig(path) {
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (value?.schema !== "mycrobo-cloud-deployment.1" || typeof value.origin !== "string" || !/^[a-z0-9]{20}$/u.test(String(value.supabaseProjectRef || ""))) {
    throw new Error("The closed-pilot cloud deployment configuration is invalid.");
  }
  const origin = new URL(value.origin);
  if (origin.protocol !== "https:" || value.origin !== origin.origin) throw new Error("The closed-pilot origin must be an exact HTTPS origin.");
  return Object.freeze({ origin: origin.origin, supabaseProjectRef: value.supabaseProjectRef });
}

function publicKey(value) {
  if (typeof value !== "string" || value.length < 24 || value.length > 4096) return false;
  if (value.startsWith("sb_publishable_")) return true;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return payload?.role === "anon";
  } catch { return false; }
}

function validateWebConfig(value, expectedProjectRef) {
  if (!value || Object.keys(value).some((field) => !["authMode", "supabaseUrl", "supabaseAnonKey"].includes(field))) throw new Error("The web deployment returned unexpected configuration.");
  if (value.authMode !== "supabase" || !publicKey(value.supabaseAnonKey)) throw new Error("The web deployment did not return a bounded public authentication configuration.");
  const url = new URL(String(value.supabaseUrl || ""));
  if (url.protocol !== "https:" || url.origin !== value.supabaseUrl || url.hostname !== `${expectedProjectRef}.supabase.co`) throw new Error("The web deployment does not match the expected closed-pilot project.");
  return Object.freeze({ supabaseUrl: url.origin, supabaseAnonKey: value.supabaseAnonKey });
}

async function jsonRequest(fetchImpl, url, options, message) {
  let response;
  try { response = await fetchImpl(url, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000), ...options }); }
  catch { throw new Error(`${message} Check the internet connection and try again.`); }
  let body;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok) throw new Error(body?.msg || body?.error_description || body?.message || message);
  return body;
}

function validateIdentity(identity) {
  if (!identity?.user?.id || !identity?.tenant?.id || !LOCAL_ID.test(identity.tenant.id)) throw new Error("Sign in to a local MyCrobo workspace first.");
  return { localUserId: String(identity.user.id), localTenantId: identity.tenant.id, email: cleanEmail(identity.user.email) };
}

function bindingPath(tenantData) { return join(tenantData, BINDING_FILE); }

function readBinding({ tenantData, safeStorage }) {
  const path = bindingPath(tenantData);
  if (!existsSync(path)) return null;
  if (!safeStorage?.isEncryptionAvailable?.()) throw new Error("Windows secure storage is unavailable; the cloud identity remains locked.");
  try { return JSON.parse(safeStorage.decryptString(readFileSync(path))); }
  catch { throw new Error("The protected cloud identity cannot be opened by this Windows profile."); }
}

function writeBinding({ tenantData, safeStorage, payload }) {
  if (!safeStorage?.isEncryptionAvailable?.()) throw new Error("Windows secure storage is unavailable; MyCrobo will not save a cloud credential unprotected.");
  const target = bindingPath(tenantData);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  const previous = `${target}.previous`;
  writeFileSync(temporary, safeStorage.encryptString(JSON.stringify(payload)), { mode: 0o600, flag: "wx" });
  try { chmodSync(temporary, 0o600); } catch { /* Windows ACLs are secured by the parent tenant directory. */ }
  if (existsSync(previous)) unlinkSync(previous);
  if (existsSync(target)) renameSync(target, previous);
  try { renameSync(temporary, target); }
  catch (error) {
    if (existsSync(previous) && !existsSync(target)) renameSync(previous, target);
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
  if (existsSync(previous)) unlinkSync(previous);
  try { chmodSync(target, 0o600); } catch { /* Windows ACLs are secured by the parent tenant directory. */ }
}

function publicStatus(binding, identity) {
  if (!binding) return Object.freeze({ state: "not_prepared", prepared: false, pairingAvailable: false, cloudRegistrationAvailable: false, capabilities: [] });
  if (binding.schema !== "mycrobo-cloud-relay-binding.1"
      || binding.localTenantId !== identity.localTenantId
      || binding.localUserId !== identity.localUserId
      || binding.email !== identity.email
      || !UUID.test(String(binding.cloudTenantId || ""))
      || !UUID.test(String(binding.cloudUserId || ""))
      || !UUID.test(String(binding.deviceId || ""))
      || typeof binding.privateKeyPkcs8 !== "string" || binding.privateKeyPkcs8.length < 80
      || typeof binding.publicKeySpki !== "string" || binding.publicKeySpki.length < 80) {
    throw new Error("The protected cloud identity does not belong to this local account and workspace.");
  }
  return Object.freeze({
    state: "identity_bound_key_protected",
    prepared: true,
    tenantId: binding.cloudTenantId,
    role: binding.membershipRole,
    lastVerifiedAt: binding.lastVerifiedAt,
    pairingAvailable: false,
    cloudRegistrationAvailable: false,
    capabilities: [],
  });
}

function createCloudRelayIdentity({ configPath, fetchImpl = globalThis.fetch, safeStorage, now = () => new Date().toISOString(), createDeviceId = randomUUID }) {
  const configured = deploymentConfig(configPath);
  return Object.freeze({
    status({ tenantData, identity }) {
      return publicStatus(readBinding({ tenantData, safeStorage }), validateIdentity(identity));
    },
    async bind({ tenantData, identity, email, password, cloudTenantId = "" }) {
      const local = validateIdentity(identity);
      const requestedEmail = cleanEmail(email);
      if (requestedEmail !== local.email) throw new Error("Use the same email as the MyCrobo account signed in on this desktop.");
      if (typeof password !== "string" || password.length < 8 || password.length > 256) throw new Error("Enter the cloud account password.");

      const webConfig = validateWebConfig(await jsonRequest(fetchImpl, `${configured.origin}/api/v1/web-config`, {}, "The closed-pilot configuration could not be verified."), configured.supabaseProjectRef);
      const auth = await jsonRequest(fetchImpl, `${webConfig.supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: webConfig.supabaseAnonKey, "content-type": "application/json" },
        body: JSON.stringify({ email: requestedEmail, password }),
      }, "Cloud sign-in failed.");
      const cloudUserId = String(auth?.user?.id || "");
      const authenticatedEmail = cleanEmail(auth?.user?.email);
      if (!UUID.test(cloudUserId) || authenticatedEmail !== local.email || typeof auth.access_token !== "string" || typeof auth.refresh_token !== "string") {
        throw new Error("The cloud account does not match the signed-in MyCrobo user.");
      }
      const membershipUrl = `${webConfig.supabaseUrl}/rest/v1/tenant_memberships?select=tenant_id,membership_role,membership_state&user_id=eq.${encodeURIComponent(cloudUserId)}&membership_state=eq.active&order=tenant_id.asc&limit=101`;
      const memberships = await jsonRequest(fetchImpl, membershipUrl, { headers: { apikey: webConfig.supabaseAnonKey, authorization: `Bearer ${auth.access_token}`, accept: "application/json" } }, "Cloud workspace membership could not be verified.");
      if (!Array.isArray(memberships) || !memberships.length) throw new Error("This cloud account has no active closed-pilot workspace.");
      if (memberships.length > 100) throw new Error("This account has more cloud workspaces than the closed pilot can safely display.");
      const eligible = memberships.filter((row) => UUID.test(String(row?.tenant_id || "")) && ["admin", "member", "viewer"].includes(row?.membership_role) && row?.membership_state === "active");
      if (!eligible.length || eligible.length !== memberships.length) throw new Error("The cloud workspace membership response was invalid.");
      if (!cloudTenantId && eligible.length > 1) return Object.freeze({ choiceRequired: true, memberships: eligible.map((row) => ({ tenantId: row.tenant_id, role: row.membership_role })) });
      const selected = eligible.find((row) => row.tenant_id === (cloudTenantId || eligible[0].tenant_id));
      if (!selected) throw new Error("Select one of the active cloud workspaces assigned to this account.");

      const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      const timestamp = now();
      const binding = {
        schema: "mycrobo-cloud-relay-binding.1",
        cloudOrigin: configured.origin,
        supabaseUrl: webConfig.supabaseUrl,
        supabaseAnonKey: webConfig.supabaseAnonKey,
        localTenantId: local.localTenantId,
        localUserId: local.localUserId,
        cloudTenantId: selected.tenant_id,
        cloudUserId,
        membershipRole: selected.membership_role,
        email: local.email,
        deviceId: createDeviceId(),
        publicKeySpki: keys.publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
        privateKeyPkcs8: keys.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64url"),
        accessToken: auth.access_token,
        refreshToken: auth.refresh_token,
        createdAt: timestamp,
        lastVerifiedAt: timestamp,
      };
      writeBinding({ tenantData, safeStorage, payload: binding });
      return publicStatus(binding, local);
    },
  });
}

module.exports = { BINDING_FILE, createCloudRelayIdentity, deploymentConfig, validateWebConfig };
