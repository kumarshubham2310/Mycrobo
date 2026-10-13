import { closedPilotBoundary } from "./web-auth-contract.mjs";
import { ensureBrowserRelayIdentity, relayDeviceRegistration } from "./relay-device.mjs";

export async function startHostedWorkspace(descriptor, {
  document = globalThis.document,
  fetchImpl = globalThis.fetch,
  signOut = () => globalThis.mycroboWebSession?.signOut(),
  switchWorkspace = () => globalThis.mycroboWebSession?.switchWorkspace(),
  prepareBrowserRelay = ensureBrowserRelayIdentity,
} = {}) {
  // The hosted pilot is a separate capability mode of the existing client.
  // Do not bootstrap desktop polling, pairing, import, drafting or send controls.
  document.querySelector(".appShell")?.setAttribute("hidden", "");
  document.querySelector(".skipLink")?.setAttribute("href", "#hostedTitle");
  const panel = document.createElement("section");
  panel.className = "hostedWorkspace";
  panel.innerHTML = `<div class="hostedCard"><header><img src="/assets/mycrobo-lockup-v1.png" alt="MyCrobo" /><span class="hostedHeaderActions"><button class="${descriptor.workspaceSwitchAvailable ? "" : "hidden"}" type="button" id="hostedSwitchWorkspace">Switch workspace</button><button type="button" id="hostedSignOut">Sign out</button></span></header><p class="webAuthEyebrow">Closed pilot</p><h1 id="hostedTitle" tabindex="-1">Your MyCrobo workspace</h1><p id="hostedIdentity"></p><section class="hostedStatus" aria-live="polite"><h2 id="hostedStatusTitle">Checking your workspace…</h2><p id="hostedStatusDetail"></p></section><button type="button" id="hostedPrepareBrowser" hidden>Prepare encrypted web connection</button><button type="button" id="hostedRefresh">Check connection</button><p class="hostedHint">You can install this app from your browser. Continue using MyCrobo Desktop for your conversations while web access is being prepared.</p></div>`;
  document.body.append(panel);
  panel.querySelector("#hostedIdentity").textContent = descriptor.user?.email || "Signed in with Cloudflare Access";
  const refresh = panel.querySelector("#hostedRefresh");
  const signOutButton = panel.querySelector("#hostedSignOut");
  const switchButton = panel.querySelector("#hostedSwitchWorkspace");
  const prepareButton = panel.querySelector("#hostedPrepareBrowser");
  let pending = false;
  async function updateBoundary() {
    if (pending) return;
    pending = true;
    refresh.disabled = true;
    try {
      const response = await fetchImpl("/api/v1/runtime-boundary", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      const boundary = await response.json();
      if (!response.ok || !closedPilotBoundary(boundary)) throw new Error("Unverified web boundary");
      panel.querySelector("#hostedStatusTitle").textContent = "Signed in · encrypted desktop connection not paired";
      panel.querySelector("#hostedStatusDetail").textContent = boundary.trustedRelay.stage === "foundation_installed"
        ? "The tenant-isolated, ciphertext-only relay foundation is installed. Device pairing and all private capabilities remain off until device attestation and independent relay certification pass."
        : "Your pilot access is ready. Chats, attachments and message actions remain unavailable until the tenant-isolated encrypted relay foundation is provisioned and certified.";
      prepareButton.hidden = boundary.trustedRelay.stage !== "foundation_installed"
        || !descriptor.user?.id || !descriptor.membership?.tenantId;
    } catch {
      panel.querySelector("#hostedStatusTitle").textContent = "Workspace connection could not be verified";
      panel.querySelector("#hostedStatusDetail").textContent = "Check your connection and try again. Your conversations remain unavailable in this browser.";
    } finally { pending = false; refresh.disabled = false; }
  }
  refresh.addEventListener("click", () => void updateBoundary());
  signOutButton.addEventListener("click", async () => {
    signOutButton.disabled = true;
    try { await signOut(); } finally { signOutButton.disabled = false; }
  });
  switchButton.addEventListener("click", async () => {
    switchButton.disabled = true;
    try { await switchWorkspace(); } finally { switchButton.disabled = false; }
  });
  prepareButton.addEventListener("click", async () => {
    if (!descriptor.user?.id || !descriptor.membership?.tenantId) return;
    prepareButton.disabled = true;
    panel.querySelector("#hostedStatusTitle").textContent = "Preparing encrypted browser identity…";
    panel.querySelector("#hostedStatusDetail").textContent = "The private key stays non-exportable in this browser. Only its public key is registered.";
    try {
      const identity = await prepareBrowserRelay({
        tenantId: descriptor.membership.tenantId,
        userId: descriptor.user.id,
      });
      const response = await fetchImpl("/api/v1/relay/browser-device", {
        method: "POST",
        headers: { "content-type": "application/json", "x-mycrobo-tenant-id": descriptor.membership.tenantId },
        body: JSON.stringify(relayDeviceRegistration(identity)),
        cache: "no-store",
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.registered !== true || result.deviceId !== identity.deviceId
          || result.pairingAvailable !== false || result.capabilities?.length !== 0) {
        throw new Error("Browser registration was not verified.");
      }
      panel.querySelector("#hostedStatusTitle").textContent = "Browser encryption prepared · desktop not yet paired";
      panel.querySelector("#hostedStatusDetail").textContent = "This browser registered only its public key. Chats, drafting and sending remain unavailable until the desktop is explicitly paired and certified.";
      prepareButton.textContent = "Prepared on this browser";
    } catch {
      panel.querySelector("#hostedStatusTitle").textContent = "Browser encryption could not be prepared";
      panel.querySelector("#hostedStatusDetail").textContent = "No private chat data was opened and no message was sent. Check secure browser storage and try again.";
      prepareButton.disabled = false;
    }
  });
  await updateBoundary();
  return panel;
}
