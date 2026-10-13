import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = new URL("../apps/client/", import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/u, (value) => value.slice(1));
let pairing = { state: "unpaired" };
let connectionState = "offline";

const json = (response, status, value) => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  if (url.pathname === "/api/v1/status") return json(response, 200, { connector: "personal-pilot", connected: false, sendAvailable: false, connectionState, pairing });
  if (url.pathname === "/api/v1/connect" && request.method === "POST") {
    connectionState = "connecting";
    pairing = { state: "scan-required", qrImage: "/fixture-qr.svg" };
    return json(response, 202, { accepted: true });
  }
  if (url.pathname === "/api/v1/pairing-phone" && request.method === "POST") {
    pairing = { state: "phone-code", phoneCode: "A1B2C3D4", phoneMasked: "+91 ••••••3210", expiresAt: new Date(Date.now() + 120_000).toISOString() };
    return json(response, 200, pairing);
  }
  if (url.pathname === "/api/v1/pairing-use-qr" && request.method === "POST") {
    pairing = { state: "scan-required", qrImage: "/fixture-qr.svg" };
    return json(response, 200, pairing);
  }
  if (url.pathname.startsWith("/api/v1/chats")) return json(response, 200, { chats: [] });
  if (url.pathname === "/api/v1/preferences") return json(response, 200, { draftLanguage: "match", replyLength: "match", liveUpdates: true, density: "comfortable" });
  if (url.pathname === "/api/v1/workspace") return json(response, 200, { pending: [], tasks: [], followUps: [] });
  if (url.pathname === "/api/v1/integrations") return json(response, 200, { whatsapp: { connected: false }, drafting: { connected: false }, mobile: { connected: false }, google: { connected: false, available: false }, contacts: { connected: false }, calendar: { connected: false } });
  if (url.pathname === "/fixture-qr.svg") {
    response.writeHead(200, { "content-type": "image/svg+xml" });
    return response.end('<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220" viewBox="0 0 11 11"><rect width="11" height="11" fill="white"/><path fill="#063d2f" d="M1 1h3v3H1zm6 0h3v3H7zM1 7h3v3H1zm5-2h1v1H6zm2 0h2v1H8zM5 7h2v3H5zm3 1h2v2H8z"/></svg>');
  }
  const requested = url.pathname === "/" ? "index.html" : normalize(url.pathname).replace(/^[/\\]+/u, "");
  if (requested.includes("..")) return response.end();
  try {
    const data = await readFile(join(root, requested));
    const type = ({ ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" })[extname(requested)] || "application/octet-stream";
    response.writeHead(200, { "content-type": `${type}; charset=utf-8` });
    response.end(data);
  } catch {
    response.writeHead(404);
    response.end();
  }
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  process.stdout.write(`PAIRING_FIXTURE_URL=http://127.0.0.1:${address.port}/\n`);
});
