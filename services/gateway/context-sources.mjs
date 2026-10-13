const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_CONTACTS = 5_000;
const MAX_CALENDAR_BLOCKS = 10_000;

function cleanText(value, maximum = 240) {
  return String(value || "").replace(/\\n/giu, " ").replace(/\\([,;\\])/gu, "$1").replace(/\s+/gu, " ").trim().slice(0, maximum);
}

function unfoldedLines(content) {
  const normalized = String(content || "").replace(/\r\n?/gu, "\n");
  const lines = [];
  for (const line of normalized.split("\n")) {
    if (/^[ \t]/u.test(line) && lines.length) lines[lines.length - 1] += line.slice(1);
    else lines.push(line);
  }
  return lines;
}

function propertyOf(line) {
  const colon = line.indexOf(":");
  if (colon < 1) return null;
  return {
    name: line.slice(0, colon).split(";", 1)[0].toUpperCase(),
    parameters: line.slice(0, colon),
    value: line.slice(colon + 1),
  };
}

export function normalizePhone(value) {
  const original = String(value || "").trim();
  const digits = original.replace(/\D/gu, "");
  if (digits.length < 7 || digits.length > 20) return "";
  return `${original.startsWith("+") ? "+" : ""}${digits}`;
}

export function parseVCardContacts(content) {
  if (Buffer.byteLength(String(content || ""), "utf8") > MAX_IMPORT_BYTES) throw new Error("The contacts file is larger than 2 MB.");
  const contacts = [];
  let current = null;
  for (const line of unfoldedLines(content)) {
    const upper = line.toUpperCase();
    if (upper === "BEGIN:VCARD") { current = { displayName: "", phones: [], emails: [] }; continue; }
    if (upper === "END:VCARD") {
      if (current) {
        current.phones = [...new Set(current.phones)].slice(0, 8);
        current.emails = [...new Set(current.emails)].slice(0, 8);
        if (current.displayName && (current.phones.length || current.emails.length)) contacts.push(Object.freeze(current));
      }
      current = null;
      if (contacts.length >= MAX_CONTACTS) break;
      continue;
    }
    if (!current) continue;
    const property = propertyOf(line);
    if (!property) continue;
    if (property.name === "FN") current.displayName = cleanText(property.value, 120);
    else if (property.name === "N" && !current.displayName) current.displayName = cleanText(property.value.replaceAll(";", " "), 120);
    else if (property.name === "TEL") {
      const phone = normalizePhone(property.value.replace(/^tel:/iu, ""));
      if (phone) current.phones.push(phone);
    } else if (property.name === "EMAIL") {
      const email = cleanText(property.value, 160).toLocaleLowerCase();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) current.emails.push(email);
    }
  }
  return contacts;
}

function parseIcsDate(value) {
  const source = String(value || "").trim();
  let match = /^(\d{4})(\d{2})(\d{2})$/u.exec(source);
  if (match) return { iso: new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toISOString(), allDay: true, timezoneMode: "local-date" };
  match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/u.exec(source);
  if (!match) return null;
  const parts = match.slice(1, 7).map((part) => Number(part || 0));
  const date = match[7]
    ? new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]))
    : new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
  if (!Number.isFinite(date.getTime())) return null;
  return { iso: date.toISOString(), allDay: false, timezoneMode: match[7] ? "utc" : "local-floating" };
}

export function parseIcsAvailability(content, now = new Date()) {
  if (Buffer.byteLength(String(content || ""), "utf8") > MAX_IMPORT_BYTES) throw new Error("The calendar file is larger than 2 MB.");
  const blocks = [];
  let current = null;
  for (const line of unfoldedLines(content)) {
    const upper = line.toUpperCase();
    if (upper === "BEGIN:VEVENT") { current = { start: null, end: null, transparent: false, cancelled: false }; continue; }
    if (upper === "END:VEVENT") {
      if (current?.start && current?.end && !current.transparent && !current.cancelled) {
        const startMs = Date.parse(current.start.iso);
        const endMs = Date.parse(current.end.iso);
        if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
          && endMs >= now.getTime() - 366 * 86_400_000 && startMs <= now.getTime() + 732 * 86_400_000) {
          blocks.push(Object.freeze({ start: current.start.iso, end: current.end.iso, allDay: current.start.allDay, timezoneMode: current.start.timezoneMode }));
        }
      }
      current = null;
      if (blocks.length >= MAX_CALENDAR_BLOCKS) break;
      continue;
    }
    if (!current) continue;
    const property = propertyOf(line);
    if (!property) continue;
    if (property.name === "DTSTART") current.start = parseIcsDate(property.value);
    else if (property.name === "DTEND") current.end = parseIcsDate(property.value);
    else if (property.name === "TRANSP" && property.value.toUpperCase() === "TRANSPARENT") current.transparent = true;
    else if (property.name === "STATUS" && property.value.toUpperCase() === "CANCELLED") current.cancelled = true;
  }
  return blocks.sort((left, right) => Date.parse(left.start) - Date.parse(right.start));
}

export function importContextSource({ kind, content, sourceName = "", now = new Date() }) {
  const importedAt = now.toISOString();
  const safeSourceName = cleanText(sourceName, 100) || (kind === "contacts" ? "Contacts file" : "Calendar file");
  if (kind === "contacts") {
    const contacts = parseVCardContacts(content);
    if (!contacts.length) throw new Error("No usable contacts were found in this VCF file.");
    return Object.freeze({ kind, sourceName: safeSourceName, importedAt, count: contacts.length, contacts });
  }
  if (kind === "calendar") {
    const busyBlocks = parseIcsAvailability(content, now);
    if (!busyBlocks.length) throw new Error("No usable busy periods were found in this ICS file.");
    return Object.freeze({ kind, sourceName: safeSourceName, importedAt, count: busyBlocks.length, busyBlocks, privacyMode: "availability-only" });
  }
  throw new Error("Choose contacts or calendar context.");
}

function phonesFromChat(chat = {}) {
  const values = [chat.phone, chat.phoneNumber, chat.canonicalPhone, chat.id, chat.title, ...(chat.connectorIds || [])];
  return [...new Set(values.map(normalizePhone).filter(Boolean))];
}

function phoneMatches(left, right) {
  const a = String(left || "").replace(/\D/gu, "");
  const b = String(right || "").replace(/\D/gu, "");
  return Boolean(a && b && (a === b || (a.length >= 10 && b.length >= 10 && a.slice(-10) === b.slice(-10))));
}

export function contactForChat(chat, importedContacts = null) {
  const contacts = importedContacts?.contacts || [];
  const phones = phonesFromChat(chat);
  if (!phones.length) return null;
  return contacts.find((contact) => contact.phones.some((candidate) => phones.some((phone) => phoneMatches(candidate, phone)))) || null;
}

export function enrichChatIdentity(chat, importedContacts = null) {
  const contact = contactForChat(chat, importedContacts);
  if (!contact) return chat;
  const current = cleanText(chat.title, 120);
  const generic = !current || /^unsaved contact$/iu.test(current) || /^\+?[\d\s()-]{7,}$/u.test(current) || /^\d{7,20}(?:@.+)?$/u.test(current);
  return generic ? { ...chat, title: contact.displayName, contactResolved: true } : { ...chat, contactResolved: true };
}

function requestedMoment(text, now) {
  const value = String(text || "").toLocaleLowerCase();
  if (!/\b(?:free|available|availability|meet|meeting|time|calendar|today|tomorrow|aaj|baje|vagye|vage)\b/u.test(value)) return null;
  const time = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/u.exec(value)
    || /\b(\d{1,2})(?::(\d{2}))\b/u.exec(value)
    || /\b(\d{1,2})\s*(?:baje|vagye|vage)\b/u.exec(value);
  if (!time) return { status: "time-unclear" };
  let hour = Number(time[1]);
  const minute = Number(time[2] || 0);
  const meridiem = time[3] || "";
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (!meridiem && hour <= 12) return { status: "meridiem-unclear" };
  if (hour > 23 || minute > 59) return { status: "time-unclear" };
  const target = new Date(now);
  target.setSeconds(0, 0);
  if (/\btomorrow\b/u.test(value)) target.setDate(target.getDate() + 1);
  else if (!/\b(?:today|aaj)\b/u.test(value)) return { status: "date-unclear" };
  target.setHours(hour, minute, 0, 0);
  return { status: "resolved", at: target };
}

export function calendarContextForText(text, importedCalendar = null, now = new Date()) {
  if (!importedCalendar?.busyBlocks?.length) return { connected: false, status: "not-imported" };
  const expiresAtMs = Date.parse(importedCalendar.expiresAt || "");
  if (importedCalendar.origin === "google-workspace" && (!Number.isFinite(expiresAtMs) || expiresAtMs <= now.getTime())) {
    return { connected: false, status: "expired" };
  }
  const requested = requestedMoment(text, now);
  if (!requested) return { connected: true, status: "not-relevant", importedAt: importedCalendar.importedAt };
  if (requested.status !== "resolved") return { connected: true, status: requested.status, importedAt: importedCalendar.importedAt };
  const at = requested.at.getTime();
  const busy = importedCalendar.busyBlocks.some((block) => Date.parse(block.start) <= at && Date.parse(block.end) > at);
  return {
    connected: true,
    status: busy ? "busy" : "free-in-imported-calendar",
    requestedAt: requested.at.toISOString(),
    importedAt: importedCalendar.importedAt,
    advisory: true,
  };
}

export function integrationStatus(state = {}, runtime = {}) {
  const contacts = state.contacts;
  const calendar = state.calendar;
  const google = state.google;
  return {
    schema: "mycrobo-integrations.1",
    whatsapp: { connected: runtime.whatsappConnected === true, mode: runtime.whatsappMode || "not-connected", historyBoundary: runtime.historyBoundary || "connector-defined" },
    drafting: {
      connected: runtime.draftProvider !== "disabled",
      mode: runtime.draftProvider || "disabled",
      minimumContextOnly: /^(?:hybrid:|openai:|gemini:)/u.test(String(runtime.draftProvider || "")),
    },
    contacts: contacts ? { connected: true, mode: "encrypted-local-import", count: contacts.count, sourceName: contacts.sourceName, importedAt: contacts.importedAt } : { connected: false, mode: "read-only-vcf-import" },
    calendar: calendar ? { connected: true, mode: "availability-only-encrypted-local-import", count: calendar.count, sourceName: calendar.sourceName, importedAt: calendar.importedAt } : { connected: false, mode: "read-only-ics-import" },
    google: google ? {
      provider: "google-workspace",
      state: ["disconnected", "connecting", "connected", "error"].includes(google.state) ? google.state : (google.connected ? "connected" : "disconnected"),
      connected: google.state === "connected" || google.connected === true,
      available: google.available === true || runtime.googleAvailable === true,
      mode: "oauth-pkce-gmail-calendar-read-only",
      scopes: Array.isArray(google.scopes) ? google.scopes : [],
      connectedAt: google.connectedAt || null,
      lastSyncedAt: google.lastSyncedAt || null,
      gmailContextCount: google.gmailContextCount || 0,
      busyBlockCount: google.busyBlockCount || 0,
      error: google.state === "error" ? google.error || "Google Workspace requires attention." : null,
    } : { provider: "google-workspace", state: "disconnected", connected: false, available: runtime.googleAvailable === true, mode: runtime.googleAvailable ? "oauth-pkce-gmail-calendar-read-only" : "oauth-registration-required", scopes: [], error: null },
    mobile: { connected: false, mode: "contract-ready-not-enrolled" },
    automaticSending: false,
  };
}
