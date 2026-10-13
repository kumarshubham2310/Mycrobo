const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const SHELL_RELOAD_MARKER = "mycrobo.shell-controller.v2";

export function canRegisterServiceWorker(location = globalThis.location) {
  return Boolean(
    "serviceWorker" in globalThis.navigator
      && (globalThis.isSecureContext || LOCAL_HOSTS.has(location?.hostname)),
  );
}

export async function registerMyCroboServiceWorker() {
  if (!canRegisterServiceWorker()) return null;
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  if (hadController) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading || sessionStorage.getItem(SHELL_RELOAD_MARKER) === "done") return;
      reloading = true;
      sessionStorage.setItem(SHELL_RELOAD_MARKER, "done");
      window.location.reload();
    }, { once: true });
  }
  const registration = await navigator.serviceWorker.register("/service-worker.js", { scope: "/", updateViaCache: "none" });
  await registration.update();
  return registration;
}

if (typeof window !== "undefined") {
  window.addEventListener("load", () => {
    void registerMyCroboServiceWorker().catch(() => {
      // Installation is optional. The live private gateway remains authoritative.
    });
  }, { once: true });
}
