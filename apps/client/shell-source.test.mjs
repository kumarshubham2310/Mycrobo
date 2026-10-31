import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(new URL("./app.js", import.meta.url), "utf8");
const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
const styles = await readFile(new URL("./styles.css", import.meta.url), "utf8");

test("connection polling cannot replace a selected non-chat tab", () => {
  assert.match(app, /if \(state\.view !== "chats"\)/u);
  assert.match(app, /shouldPresentConnectionSetup\(\{[\s\S]*?view: state\.view/u);
  assert.match(app, /setupPanel\.classList\.add\("hidden"\);\s+applyViewVisibility\(\)/u);
});

test("pairing QR is fetched with the private session and reports image loading failures", () => {
  assert.match(app, /fetch\(`\$\{pairing\.qrImage\}[\s\S]*?headers: authHeaders\(\)/u);
  assert.match(app, /URL\.createObjectURL\(blob\)/u);
  assert.match(app, /id="qrLoadStatus" role="status"/u);
  assert.match(app, /QR image could not be displayed/u);
  assert.doesNotMatch(app.match(/function renderQRPairing[\s\S]*?\n\}/u)?.[0] || "", /<img class="pairingQR" src=/u);
});

test("background chat refresh retains the selected chat and viewport", () => {
  assert.match(app, /refreshedSelection[\s\S]*?state\.selected = \{ \.\.\.state\.selected, \.\.\.refreshedSelection \}/u);
  assert.doesNotMatch(app, /if \(state\.selected && !state\.chats\.some[\s\S]*?clearConversation\(\)/u);
  assert.match(app, /openChat\(state\.selected, \{ preserveViewport: true/u);
  assert.match(app, /restoreAnchor\(messageList, "\[data-message-id\]"/u);
});

test("media presentation exposes a larger video view and visible failure state", () => {
  assert.match(app, /data-media-kind="video"/u);
  assert.match(app, /mediaPlaybackStatus/u);
  assert.match(app, /This saved attachment could not be displayed/u);
  assert.match(styles, /\.mediaViewerHeader/u);
  assert.match(app, /aria-modal", "true"/u);
  assert.match(app, /aria-labelledby", "mediaViewerTitle"/u);
  assert.match(app, /returnFocus\.focus\(\{ preventScroll: true \}\)/u);
  assert.doesNotMatch(app, /<video controls autoplay|<audio controls autoplay/u);
});

test("sending preferences expose all policies and independently report protected execution readiness", () => {
  assert.match(html, /name="defaultSendingMode"/u);
  assert.match(html, /Never send automatically/u);
  assert.match(html, /Safe countdown/u);
  assert.match(html, /Safe automatic delivery/u);
  assert.match(html, /Delivery stays off until consent and every protected execution gate are ready/u);
  assert.match(app, /sendingMode: document\.querySelector\("#chatSendingMode"\)\.value/u);
  assert.match(app, /autonomyReadiness\(autonomy\)/u);
  assert.match(html, /id="autonomyReadiness"/u);
  assert.match(html, /id="grantAutoSendConsent"/u);
  assert.match(html, /id="revokeAutoSendConsent"/u);
  assert.match(html, /id="emergencyStopAutoSend"/u);
  assert.match(app, /\/api\/v1\/preferences\?autonomy=policy/u);
  assert.match(app, /\/api\/v1\/preferences\?autonomy=\$\{encodeURIComponent\(action\)\}/u);
  assert.match(app, /automaticSendAvailable === true/u);
  assert.match(app, /chatSendingScope/u);
  const consentStart = app.indexOf("async function updateAutonomyConsent");
  const nextClosing = app.indexOf("\n  }\n", consentStart);
  const fallbackClosing = app.indexOf("\n}\n", consentStart);
  const consentEnd = nextClosing !== -1 ? nextClosing : fallbackClosing;
  const consentFunction = app.slice(consentStart, consentEnd + 4);
  assert.doesNotMatch(consentFunction, /\/send(?:[/?"'`]|$)/u);
});

test("large changing regions are not announced as one screen-reader update", () => {
  assert.doesNotMatch(html, /class="conversation" aria-live/u);
  assert.doesNotMatch(html, /id="chatList" class="chatList" aria-live/u);
  assert.doesNotMatch(html, /class="overviewPanel hidden" id="overviewPanel" aria-live/u);
  assert.match(html, /id="replyPanel" class="replyPanel hidden" aria-live="polite"/u);
  assert.match(html, /id="newMessageNotice"[^>]*role="status"/u);
});

test("keyboard users receive route focus, a skip link and restored media focus", () => {
  assert.match(html, /class="skipLink" href="#appContent"/u);
  assert.match(html, /id="appContent" tabindex="-1"/u);
  assert.match(app, /function focusViewHeading\(view\)/u);
  assert.match(app, /focusConversation: true/u);
  assert.match(app, /dialog\.querySelector\("\.mediaClose"\)\?\.focus/u);
});

test("chat filters expose selected state to assistive technology", () => {
  assert.match(html, /data-collection="active" aria-pressed="true"/u);
  assert.match(html, /data-collection="archived" aria-pressed="false"/u);
  assert.match(app, /item\.setAttribute\("aria-pressed", String\(active\)\)/u);
});

test("dismissed snoozed and older items stay collapsed with accessible disclosure names", () => {
  assert.match(app, /<details class="dismissedSection"/u);
  assert.match(app, /aria-label="Dismissed \$\{followUpView/u);
  assert.match(app, /aria-label="Snoozed \$\{followUpView/u);
  assert.match(app, /aria-label="Older \$\{followUpView/u);
  assert.match(app, /aria-hidden="true">\$\{dismissedItems\.length\}/u);
});

test("responsive and high-contrast modes keep connection and controls available", () => {
  assert.match(html, /id="connectionNotice"/u);
  assert.match(styles, /@media \(max-width:760px\)[\s\S]*?\.connectionNotice/u);
  assert.match(styles, /grid-template-columns:repeat\(auto-fit,minmax\(38px,1fr\)\)/u);
  assert.match(styles, /@media \(forced-colors:active\)/u);
  assert.match(styles, /@media \(prefers-reduced-motion:reduce\)/u);
  assert.match(styles, /@media \(pointer:coarse\)[\s\S]*?min-height:44px/u);
  assert.match(styles, /primaryRail nav button>span:not\(\.navIcon\):not\(\.navCount\)[\s\S]*?display:block/u);
});

test("background connection polling does not rebuild a focused workspace selector", () => {
  assert.match(app, /if \(!silent \|\| !state\.tenants\) void loadTenants\(\)/u);
});

test("desktop cloud preparation is explicit password-safe and does not claim pairing", () => {
  assert.match(html, /id="webRelayConnection"/u);
  assert.match(html, /id="relayPassword"[^>]*type="password"[^>]*autocomplete="current-password"/u);
  assert.match(html, /id="toggleRelayPassword"[^>]*aria-controls="relayPassword"[^>]*aria-pressed="false"/u);
  assert.match(html, /Preparation does not upload chats, pair a browser, enable drafting, or send a message/u);
  assert.match(app, /form\.elements\.password\.value = ""/u);
  assert.match(app, /Browser pairing and cloud capabilities remain closed/u);
  assert.match(app, /window\.mycroboDesktop\.bindRelay/u);
  assert.doesNotMatch(app.match(/async function prepareDesktopRelay[\s\S]+?\n\}/u)?.[0] || "", /\/send(?:[/?"'`]|$)/u);
});

test("customer copy does not overclaim language history or tenant completeness", () => {
  assert.match(html, /English, Roman Hindi and Roman Gujarati when conversation evidence is available/u);
  assert.doesNotMatch(html, /understands mixed-language chats automatically/u);
  assert.doesNotMatch(html, /All workspaces are equal and completely separated/u);
  assert.match(app, /Available history checked/u);
  assert.doesNotMatch(app, /Conversation learned/u);
});

test("drafting exposes a fast private route and has bounded enhanced and local deadlines", () => {
  assert.match(app, /const DRAFT_PROGRESS_MS = 1_800;/u);
  assert.match(app, /const DRAFT_TIMEOUT_MS = 9_000;/u);
  assert.match(app, /const LOCAL_DRAFT_TIMEOUT_MS = 3_500;/u);
  assert.match(app, /Use instant private draft/u);
  assert.match(app, /controller\.abort\(\)/u);
  assert.match(app, /button\.removeAttribute\("aria-busy"\)/u);
});

test("history import events are back-pressured without rebuilding task queues", () => {
  assert.match(app, /const HISTORY_EVENT_REFRESH_MS = 12_000;/u);
  assert.match(app, /const RECENT_LIVE_EVENT_WINDOW_MS = 10 \* 60_000;/u);
  assert.match(app, /if \(recentLiveMessage\)[\s\S]*?loadWorkspace\(\{ silent: true \}\)/u);
  assert.match(app, /historyEventRefreshTimer = setTimeout\(\(\) => \{\s*if \(chatsStarted\) void loadChats\(\{ silent: true \}\);\s*\}, HISTORY_EVENT_REFRESH_MS\)/u);
  assert.doesNotMatch(app, /historyEventRefreshTimer = setTimeout\([\s\S]{0,180}loadWorkspace/u);
});

test("status polling is single-flight and one transient miss cannot report the service unavailable", () => {
  assert.match(app, /if \(state\.statusRequest\.promise\) return state\.statusRequest\.promise;/u);
  assert.match(app, /const STATUS_TIMEOUT_MS = 2_500;/u);
  assert.match(app, /const STATUS_FAILURE_THRESHOLD = 2;/u);
  assert.match(app, /consecutiveFailures < STATUS_FAILURE_THRESHOLD/u);
});

test("new registration re-checks saved chats and clears forceSetup on catch-up", () => {
  assert.match(app, /if \(state\.hasSavedChats === true\) return true;/u);
  assert.match(app, /if \(status\.connectionState === "catching-up"\) state\.forceSetup = false;/u);
  assert.match(app, /if \(\(status\.connected \|\| status\.connectionState === "catching-up"\) && status\.connector === "personal-pilot"\) startLiveEvents\(\);/u);
});

test("reload icon clicks force-refresh chats and pairing without throwing", () => {
  assert.match(app, /loadChats\(\{\s*force:\s*true/u);
  assert.match(app, /isRefreshingEverything/u);
  assert.match(app, /id="refreshQR"/u);
});
