const RELAY_DEVICE_DB = "mycrobo-relay-device-v1";
const RELAY_DEVICE_STORE = "device-keys";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function base64Url(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function relayScope(tenantId, userId) {
  if (!UUID.test(String(tenantId || "")) || !UUID.test(String(userId || ""))) {
    throw new Error("A verified workspace and user are required before preparing this browser.");
  }
  return `${String(tenantId).toLowerCase()}:${String(userId).toLowerCase()}`;
}

function openRelayDeviceStore(indexedDBImpl = globalThis.indexedDB) {
  if (!indexedDBImpl?.open) throw new Error("Secure browser key storage is unavailable.");
  let databasePromise;
  const database = () => {
    if (!databasePromise) {
      databasePromise = new Promise((resolve, reject) => {
        const request = indexedDBImpl.open(RELAY_DEVICE_DB, 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(RELAY_DEVICE_STORE)) {
            request.result.createObjectStore(RELAY_DEVICE_STORE, { keyPath: "scope" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error("Secure browser key storage could not be opened."));
      });
    }
    return databasePromise;
  };
  const transaction = async (mode, action) => new Promise(async (resolve, reject) => {
    const tx = (await database()).transaction(RELAY_DEVICE_STORE, mode);
    const request = action(tx.objectStore(RELAY_DEVICE_STORE));
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(new Error("Secure browser key storage failed."));
    tx.onabort = () => reject(new Error("Secure browser key storage was interrupted."));
  });
  return Object.freeze({
    get: (scope) => transaction("readonly", (store) => store.get(scope)),
    put: (record) => transaction("readwrite", (store) => store.put(record)),
  });
}

export function relayDeviceRegistration(identity) {
  if (!identity || !UUID.test(String(identity.deviceId || ""))
      || typeof identity.publicKey !== "string" || !/^[A-Za-z0-9_-]{80,120}$/u.test(identity.publicKey)) {
    throw new Error("The browser encryption identity is invalid.");
  }
  return Object.freeze({ deviceId: identity.deviceId.toLowerCase(), publicKey: identity.publicKey });
}

export async function ensureBrowserRelayIdentity({
  tenantId,
  userId,
  cryptoImpl = globalThis.crypto,
  store = openRelayDeviceStore(),
} = {}) {
  const scope = relayScope(tenantId, userId);
  const existing = await store.get(scope);
  if (existing?.scope === scope && existing.privateKey?.type === "private" && existing.privateKey.extractable === false) {
    return Object.freeze({ deviceId: existing.deviceId, publicKey: existing.publicKey, existing: true });
  }
  if (!cryptoImpl?.subtle || typeof cryptoImpl.randomUUID !== "function") {
    throw new Error("This browser cannot create the required encryption key.");
  }

  // WebCrypto cannot export the public half when an ECDH pair is generated as
  // non-extractable. Generate once in memory, immediately re-import only the
  // private half as non-exportable, then persist that CryptoKey in IndexedDB.
  const generated = await cryptoImpl.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"],
  );
  const [publicRaw, privateJwk] = await Promise.all([
    cryptoImpl.subtle.exportKey("raw", generated.publicKey),
    cryptoImpl.subtle.exportKey("jwk", generated.privateKey),
  ]);
  const privateKey = await cryptoImpl.subtle.importKey(
    "jwk", privateJwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey", "deriveBits"],
  );
  const record = Object.freeze({
    scope,
    deviceId: cryptoImpl.randomUUID().toLowerCase(),
    publicKey: base64Url(publicRaw),
    privateKey,
    createdAt: new Date().toISOString(),
  });
  relayDeviceRegistration(record);
  await store.put(record);
  return Object.freeze({ deviceId: record.deviceId, publicKey: record.publicKey, existing: false });
}
