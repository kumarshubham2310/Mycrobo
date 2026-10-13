export const PAIRING_COUNTRIES = Object.freeze([
  ["IN", "India", "+91"], ["US", "United States / Canada", "+1"], ["GB", "United Kingdom", "+44"],
  ["AE", "United Arab Emirates", "+971"], ["AU", "Australia", "+61"], ["SG", "Singapore", "+65"],
  ["NZ", "New Zealand", "+64"], ["DE", "Germany", "+49"], ["FR", "France", "+33"],
  ["IT", "Italy", "+39"], ["ES", "Spain", "+34"], ["NL", "Netherlands", "+31"],
  ["BE", "Belgium", "+32"], ["CH", "Switzerland", "+41"], ["AT", "Austria", "+43"],
  ["IE", "Ireland", "+353"], ["PT", "Portugal", "+351"], ["SE", "Sweden", "+46"],
  ["NO", "Norway", "+47"], ["DK", "Denmark", "+45"], ["FI", "Finland", "+358"],
  ["SA", "Saudi Arabia", "+966"], ["QA", "Qatar", "+974"], ["OM", "Oman", "+968"],
  ["KW", "Kuwait", "+965"], ["BH", "Bahrain", "+973"], ["ZA", "South Africa", "+27"],
  ["NG", "Nigeria", "+234"], ["KE", "Kenya", "+254"], ["EG", "Egypt", "+20"],
  ["MY", "Malaysia", "+60"], ["ID", "Indonesia", "+62"], ["PH", "Philippines", "+63"],
  ["TH", "Thailand", "+66"], ["JP", "Japan", "+81"], ["KR", "South Korea", "+82"],
  ["BR", "Brazil", "+55"], ["MX", "Mexico", "+52"], ["AR", "Argentina", "+54"],
]);

const TIME_ZONE_COUNTRY = new Map([
  ["Asia/Calcutta", "IN"], ["Asia/Kolkata", "IN"], ["Asia/Dubai", "AE"], ["Asia/Singapore", "SG"],
  ["Asia/Kuala_Lumpur", "MY"], ["Asia/Jakarta", "ID"], ["Asia/Bangkok", "TH"], ["Asia/Manila", "PH"],
  ["Asia/Tokyo", "JP"], ["Asia/Seoul", "KR"], ["Asia/Riyadh", "SA"], ["Asia/Doha", "QA"],
  ["Australia/Sydney", "AU"], ["Pacific/Auckland", "NZ"], ["Europe/London", "GB"], ["Europe/Dublin", "IE"],
  ["Europe/Paris", "FR"], ["Europe/Berlin", "DE"], ["Europe/Madrid", "ES"], ["Europe/Rome", "IT"],
  ["Europe/Amsterdam", "NL"], ["Europe/Brussels", "BE"], ["Europe/Zurich", "CH"], ["Europe/Stockholm", "SE"],
  ["Europe/Oslo", "NO"], ["Europe/Copenhagen", "DK"], ["Europe/Lisbon", "PT"], ["Europe/Helsinki", "FI"],
  ["America/New_York", "US"], ["America/Los_Angeles", "US"], ["America/Toronto", "US"], ["America/Vancouver", "US"],
  ["America/Mexico_City", "MX"], ["America/Sao_Paulo", "BR"], ["America/Argentina/Buenos_Aires", "AR"],
  ["Africa/Johannesburg", "ZA"], ["Africa/Nairobi", "KE"], ["Africa/Lagos", "NG"], ["Africa/Cairo", "EG"],
]);

export function defaultPairingCountry(locale = "", timeZone = "") {
  const timeZoneCountry = TIME_ZONE_COUNTRY.get(String(timeZone || ""));
  if (timeZoneCountry && PAIRING_COUNTRIES.some(([code]) => code === timeZoneCountry)) return timeZoneCountry;
  const region = String(locale).split(/[-_]/u)[1]?.toUpperCase() || "";
  return PAIRING_COUNTRIES.some(([code]) => code === region) ? region : "custom";
}

export function normalizePairingPhone(countryCode, subscriberNumber) {
  const dial = String(countryCode || "").trim();
  const local = String(subscriberNumber || "").trim();
  if (!/^\+[1-9]\d{0,3}$/u.test(dial)) throw new Error("Enter a valid international country code.");
  if (!/^\d{5,14}$/u.test(local)) throw new Error("Enter the phone number using digits only.");
  if (local.startsWith("0")) throw new Error("Remove the leading zero used for local calls.");
  const complete = `${dial}${local}`;
  if (!/^\+[1-9]\d{6,14}$/u.test(complete)) throw new Error("Enter a complete international phone number.");
  return complete;
}

export function pairingCodeCells(code) {
  const normalized = String(code || "").toUpperCase().replace(/[^0-9A-Z]/gu, "");
  return normalized.length === 8 ? [...normalized] : [];
}

export function shouldCheckSavedChatsBeforeSetup({ forceSetup = false, skipSavedChatProbe = false } = {}) {
  return !forceSetup && !skipSavedChatProbe;
}

export function pairingSecondsRemaining(expiresAt, now = Date.now()) {
  const expiry = Date.parse(String(expiresAt || ""));
  if (!Number.isFinite(expiry)) return null;
  return Math.max(0, Math.ceil((expiry - now) / 1000));
}
