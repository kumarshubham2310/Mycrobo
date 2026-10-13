import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createGatewayServer } from "../../services/gateway/server.mjs";

const root = new URL("./", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.webmanifest", root), "utf8"));
const html = await readFile(new URL("index.html", root), "utf8");
const worker = await readFile(new URL("service-worker.js", root), "utf8");
const registration = await readFile(new URL("pwa-register.mjs", root), "utf8");

async function pngDimensions(name) {
  const bytes = await readFile(new URL(`assets/${name}`, root));
  assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test("manifest is linked and supplies Chromium install icons from the MyCrobo identity", async () => {
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest"/u);
  assert.equal(manifest.id, "/");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  const icon192 = manifest.icons.find((icon) => icon.sizes === "192x192" && icon.type === "image/png");
  const icon512 = manifest.icons.find((icon) => icon.sizes === "512x512" && icon.type === "image/png");
  assert.ok(icon192);
  assert.ok(icon512);
  assert.equal(icon192.src, "/assets/mycrobo-app-v2-192.png");
  assert.equal(icon512.src, "/assets/mycrobo-app-v2-512.png");
  assert.deepEqual(await pngDimensions("mycrobo-app-v2-192.png"), { width: 192, height: 192 });
  assert.deepEqual(await pngDimensions("mycrobo-app-v2-512.png"), { width: 512, height: 512 });
});

test("service worker persists only an explicit static shell and bypasses private payloads", () => {
  assert.match(worker, /const SHELL_PATHS = Object\.freeze/u);
  assert.match(worker, /PRIVATE_PREFIXES = Object\.freeze\(\["\/api\/", "\/oauth\/", "\/media\/"\]\)/u);
  assert.match(worker, /isPrivateRequest\(url\)[\s\S]*?cache: "no-store"/u);
  assert.match(worker, /if \(!SHELL_PATH_SET\.has\(url\.pathname\)\) return;/u);
  assert.match(worker, /CACHE_PREFIX = "mycrobo-shell-"/u);
  assert.match(worker, /\/assets\/mycrobo-lockup-v1\.png/u);
  assert.match(worker, /\/relay-protocol\.mjs/u);
  assert.match(worker, /event\.respondWith\(latestShell\(url\.pathname\)\)/u);
});

test("client registers the service worker as an optional enhancement", () => {
  assert.match(html, /<script type="module" src="\/pwa-register\.mjs"><\/script>/u);
  assert.match(worker, /cache\?\.match\(shellKey\(path\)\)/u);
  assert.match(registration, /controllerchange/u);
  assert.match(registration, /sessionStorage\.getItem\(SHELL_RELOAD_MARKER\)/u);
  assert.match(registration, /registration\.update\(\)/u);
});

test("private gateway serves the install manifest, worker and PNG icons with installable MIME types", async () => {
  const server = createGatewayServer({
    bridgeSource: null,
    draftProvider: null,
    googleConnector: { available: false },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const [manifestResponse, workerResponse, iconResponse] = await Promise.all([
      fetch(`${origin}/manifest.webmanifest`),
      fetch(`${origin}/service-worker.js`),
      fetch(`${origin}/assets/mycrobo-app-v2-192.png`),
    ]);
    assert.equal(manifestResponse.status, 200);
    assert.match(manifestResponse.headers.get("content-type"), /^application\/manifest\+json/u);
    assert.equal((await manifestResponse.json()).display, "standalone");
    assert.equal(workerResponse.status, 200);
    assert.match(workerResponse.headers.get("content-type"), /^text\/javascript/u);
    assert.equal(iconResponse.status, 200);
    assert.equal(iconResponse.headers.get("content-type"), "image/png");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
