"use strict";

/**
 * TuttiBrilli Enoteca - Voice Booking Assistant (Single file, copy/paste)
 * - Twilio Voice (Speech Gather) -> Node/Express
 * - Google Calendar (service account) for booking events
 * - Twilio WhatsApp confirmation ONLY after calendar success
 *
 * NEW FEATURES:
 * - Block bookings if Calendar has an event containing "locale chiuso" (summary/description) on that date
 * - Preorder structured menu options:
 *   - cena
 *   - apericena
 *   - dopocena (only after 22:30)
 *   - Piatto Apericena (25€)
 *   - Piatto Apericena Promo (eligible only if: Tue-Sun, NOT Fri, NOT holidays, and no "no promo" marker on calendar date)
 * - Always record allergies/intolerances/special requests in Calendar + WhatsApp
 *
 * ENV REQUIRED:
 *  PORT
 *  BASE_URL  (e.g. https://your-service.onrender.com)  <-- IMPORTANT for Twilio action URL
 *
 *  TWILIO_ACCOUNT_SID
 *  TWILIO_AUTH_TOKEN
 *  TWILIO_WHATSAPP_FROM   (e.g. whatsapp:+14155238886 or approved sender)
 *
 *  GOOGLE_CALENDAR_ID
 *  GOOGLE_CALENDAR_TZ (default Europe/Rome)
 *  GOOGLE_SERVICE_ACCOUNT_JSON_B64  (recommended) OR GOOGLE_SERVICE_ACCOUNT_JSON (raw JSON string)
 *
 * OPTIONAL:
 *  ENABLE_FORWARDING=true/false
 *  HUMAN_FORWARD_TO=+39...
 *
 *  HOLIDAYS_YYYY_MM_DD="2025-01-01,2025-04-20,2025-12-25"  // for promo exclusion on holidays
 */

const express = require("express");
const twilio = require("twilio");
const { google } = require("googleapis");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ======================= ENV =======================
const PORT = process.env.PORT || 3001;
const BASE_URL = process.env.BASE_URL || "";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM || "";

const GOOGLE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || "";
const GOOGLE_CALENDAR_TZ = process.env.GOOGLE_CALENDAR_TZ || "Europe/Rome";
const GOOGLE_SERVICE_ACCOUNT_JSON_B64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64 || "";
const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";

const ENABLE_FORWARDING = (process.env.ENABLE_FORWARDING || "false").toLowerCase() === "true";
const HUMAN_FORWARD_TO = process.env.HUMAN_FORWARD_TO || "";

const HOLIDAYS_YYYY_MM_DD = process.env.HOLIDAYS_YYYY_MM_DD || "";

const HOLIDAYS_SET = new Set(
  HOLIDAYS_YYYY_MM_DD
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

const twilioClient =
  TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN) : null;

// ======================= CONFIG: OPENING HOURS =======================
// 0=Sunday ... 6=Saturday
const OPENING = {
  closedDay: 1, // Monday
  restaurant: {
    default: { start: "18:30", end: "22:30" }, // Tue-Thu, Sun
    friSat: { start: "18:30", end: "23:00" }, // Fri-Sat
  },
  drinksOnly: { start: "18:30", end: "24:00" }, // everyday
  musicNights: { days: [3, 5], from: "20:00" }, // Wed(3) & Fri(5)
};

// ======================= CONFIG: PREORDER MENU =======================
const PREORDER_OPTIONS = [
  { key: "cena", label: "Cena", priceEUR: null, constraints: {} },
  { key: "apericena", label: "Apericena", priceEUR: null, constraints: {} },
  { key: "dopocena", label: "Dopocena", priceEUR: null, constraints: { minTime: "22:30" } }, // After 22:30
  { key: "piatto_apericena", label: "Piatto Apericena", priceEUR: 25, constraints: {} },
  {
    key: "piatto_apericena_promo",
    label: "Piatto Apericena in promo (previa registrazione)",
    priceEUR: null, // promo price not specified
    constraints: { promoOnly: true },
  },
];

// ======================= CONFIG: TABLES =======================
const TABLES = [
  // INSIDE
  { id: "T1", area: "inside", min: 2, max: 4, notes: "più riservato" },
  { id: "T2", area: "inside", min: 2, max: 4, notes: "più riservato" },
  { id: "T3", area: "inside", min: 2, max: 4, notes: "più riservato" },
  { id: "T4", area: "inside", min: 2, max: 4, notes: "più riservato" },
  { id: "T5", area: "inside", min: 2, max: 2 },
  { id: "T6", area: "inside", min: 2, max: 4 },
  { id: "T7", area: "inside", min: 2, max: 4 },
  { id: "T8", area: "inside", min: 2, max: 4 },
  { id: "T9", area: "inside", min: 2, max: 2 },
  { id: "T10", area: "inside", min: 2, max: 2 },
  { id: "T11", area: "inside", min: 2, max: 4, notes: "vicino ingresso" },
  { id: "T12", area: "inside", min: 2, max: 4 },
  { id: "T13", area: "inside", min: 2, max: 4 },
  { id: "T14", area: "inside", min: 4, max: 8, notes: "divanetto con tavolino" },
  { id: "T15", area: "inside", min: 4, max: 8, notes: "divanetto con tavolino" },
  { id: "T16", area: "inside", min: 4, max: 5, notes: "tavolo alto con sgabelli" },
  { id: "T17", area: "inside", min: 4, max: 5, notes: "tavolo alto con sgabelli" },

  // OUTSIDE
  { id: "T1F", area: "outside", min: 2, max: 2, notes: "botte con sgabelli" },
  { id: "T2F", area: "outside", min: 2, max: 2, notes: "tavolo alto con sgabelli" },
  { id: "T3F", area: "outside", min: 2, max: 2, notes: "tavolo alto con sgabelli" },
  { id: "T4F", area: "outside", min: 4, max: 5, notes: "divanetti" },
  { id: "T6F", area: "outside", min: 4, max: 4, notes: "divanetti" },
  { id: "T7F", area: "outside", min: 4, max: 4, notes: "divanetti" },
  { id: "T8F", area: "outside", min: 4, max: 4, notes: "divanetti" },
];

const TABLE_COMBINATIONS = [
  // INSIDE unions
  { displayId: "T1", area: "inside", replaces: ["T1", "T2"], min: 6, max: 6, notes: "unione T1+T2" },
  { displayId: "T3", area: "inside", replaces: ["T3", "T4"], min: 6, max: 6, notes: "unione T3+T4" },
  { displayId: "T14", area: "inside", replaces: ["T14", "T15"], min: 8, max: 18, notes: "unione T14+T15" },
  { displayId: "T11", area: "inside", replaces: ["T11", "T12"], min: 6, max: 6, notes: "unione T11+T12" },
  { displayId: "T12", area: "inside", replaces: ["T12", "T13"], min: 6, max: 6, notes: "unione T12+T13" },
  { displayId: "T11", area: "inside", replaces: ["T11", "T12", "T13"], min: 8, max: 10, notes: "unione T11+T12+T13" },
  { displayId: "T16", area: "inside", replaces: ["T16", "T17"], min: 8, max: 10, notes: "unione T16+T17" },

  // OUTSIDE union
  { displayId: "T7F", area: "outside", replaces: ["T7F", "T8F"], min: 6, max: 8, notes: "unione T7F+T8F" },
];

// ======================= SESSIONS (in-memory) =======================
const sessions = new Map();

function getSession(callSid) {
  if (!callSid) return null;
  if (!sessions.has(callSid)) {
    sessions.set(callSid, {
      step: 1,
      retries: 0,

      name: null,
      dateISO: null,
      time24: null,
      people: null,

      specialRequestsRaw: null,

      preorderOptIn: null,
      preorderChoiceKey: null,
      preorderLabel: null,

      promoEligible: null, // computed from calendar/day rules

      // area
      area: null, // inside/outside
      pendingOutsideConfirm: false,

      phone: null,
      waTo: null,

      // table allocation result
      tableDisplayId: null,
      tableLocks: [],
      tableNotes: null,

      // derived
      durationMinutes: null,
      bookingType: "restaurant", // or drinks/operator
      autoConfirm: true,
    });
  }
  return sessions.get(callSid);
}

function bumpRetries(session) {
  session.retries = (session.retries || 0) + 1;
  return session.retries;
}
function resetRetries(session) {
  session.retries = 0;
}

// ======================= TEXT / PARSERS =======================
function normalizeText(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function nowLocal() {
  return new Date();
}

function parseDateIT(speech) {
  const t = normalizeText(speech);
  const today = nowLocal();

  if (t.includes("oggi")) return toISODate(today);
  if (t.includes("domani")) {
    const d = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    return toISODate(d);
  }

  const iso = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dmY = t.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (dmY) {
    let dd = Number(dmY[1]);
    let mm = Number(dmY[2]);
    let yy = dmY[3] ? Number(dmY[3]) : today.getFullYear();
    if (yy < 100) yy += 2000;
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      const d = new Date(yy, mm - 1, dd);
      return toISODate(d);
    }
  }

  return null;
}

function parseTimeIT(speech) {
  const t = normalizeText(speech);

  const hm = t.match(/(\d{1,2})[:\s](\d{2})/);
  if (hm) {
    const hh = Number(hm[1]);
    const mm = Number(hm[2]);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    }
  }

  const onlyH = t.match(/\b(\d{1,2})\b/);
  if (onlyH) {
    const hh = Number(onlyH[1]);
    if (hh >= 0 && hh <= 23) {
      return `${String(hh).padStart(2, "0")}:00`;
    }
  }

  return null;
}

function parsePeopleIT(speech) {
  const t = normalizeText(speech);
  const m = t.match(/\b(\d{1,2})\b/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function parseYesNoIT(speech) {
  const t = normalizeText(speech);
  if (!t) return null;
  if (t.includes("si") || t.includes("sì") || t.includes("certo") || t.includes("ok") || t.includes("va bene")) return true;
  if (t.includes("no") || t.includes("non") || t.includes("niente") || t.includes("nessun")) return false;
  return null;
}

function parseAreaIT(speech) {
  const t = normalizeText(speech);
  if (t.includes("intern") || t.includes("dentro") || t.includes("sala")) return "inside";
  if (t.includes("estern") || t.includes("fuori") || t.includes("terraz") || t.includes("giardino")) return "outside";
  return null;
}

function isValidPhoneE164(s) {
  return /^\+\d{8,15}$/.test(String(s || "").trim());
}

function hasValidWaAddress(s) {
  return /^whatsapp:\+\d{8,15}$/.test(String(s || "").trim());
}

function extractPhoneFromSpeech(speech) {
  const t = normalizeText(speech).replace(/[^\d+]/g, "");
  if (isValidPhoneE164(t)) return t;
  const digits = normalizeText(speech).replace(/[^\d]/g, "");
  if (digits.length >= 9 && digits.length <= 11) return `+39${digits}`;
  return null;
}

// Preorder parsing: understand fixed options by keywords
function parsePreorderChoiceKey(speech) {
  const t = normalizeText(speech);

  // Strong matches first
  if (t.includes("promo")) return "piatto_apericena_promo";
  if (t.includes("piatto") && t.includes("apericena")) return "piatto_apericena";
  if (t.includes("dopo") || t.includes("dopocena")) return "dopocena";
  if (t.includes("apericena")) return "apericena";
  if (t.includes("cena")) return "cena";
  if (t.includes("nessuno") || t.includes("nessuna") || t.includes("no")) return null;

  return "unknown";
}

function getPreorderOptionByKey(key) {
  return PREORDER_OPTIONS.find((o) => o.key === key) || null;
}

function hmToMinutes(hm) {
  const [h, m] = String(hm).split(":").map(Number);
  return h * 60 + m;
}

function isTimeAtOrAfter(time24, minTime24) {
  return hmToMinutes(time24) >= hmToMinutes(minTime24);
}

// ======================= TIME / OPENING VALIDATION =======================
function getRestaurantWindowForDay(day) {
  if (day === 5 || day === 6) return OPENING.restaurant.friSat; // Fri, Sat
  return OPENING.restaurant.default;
}

function isWithinWindow(time24, startHM, endHM) {
  const t = hmToMinutes(time24);
  const start = hmToMinutes(startHM);
  const end = hmToMinutes(endHM);
  return t >= start && t <= end;
}

function getDurationMinutes(people, dateObj) {
  let minutes;
  if (people <= 4) minutes = 120;
  else if (people <= 8) minutes = 150;
  else minutes = 180;

  const day = dateObj.getDay();
  const isMusicNight = OPENING.musicNights.days.includes(day);
  if (isMusicNight && people <= 8) minutes += 30;

  return minutes;
}

function computeStartEndLocal(dateISO, time24, durationMinutes) {
  const [sh, sm] = time24.split(":").map(Number);
  const startTotal = sh * 60 + sm;
  const endTotal = startTotal + durationMinutes;

  const endDayOffset = Math.floor(endTotal / (24 * 60));
  const endMinutesOfDay = endTotal % (24 * 60);
  const endH = Math.floor(endMinutesOfDay / 60);
  const endM = endMinutesOfDay % 60;

  let endDateISO = dateISO;
  if (endDayOffset > 0) {
    const d = new Date(`${dateISO}T00:00:00`);
    d.setDate(d.getDate() + endDayOffset);
    endDateISO = toISODate(d);
  }

  const startLocal = `${dateISO}T${String(sh).padStart(2, "0")}:${String(sm).padStart(2, "0")}:00`;
  const endLocal = `${endDateISO}T${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}:00`;

  return { startLocal, endLocal };
}

function deriveBookingTypeAndConfirm(dateISO, time24) {
  const d = new Date(`${dateISO}T00:00:00`);
  const day = d.getDay();

  if (day === OPENING.closedDay) {
    return { bookingType: "operator", autoConfirm: false, reason: "Lunedì chiuso" };
  }

  const restWin = getRestaurantWindowForDay(day);
  const inRestaurant = isWithinWindow(time24, restWin.start, restWin.end);
  const inDrinks = isWithinWindow(time24, OPENING.drinksOnly.start, OPENING.drinksOnly.end);

  if (inRestaurant) return { bookingType: "restaurant", autoConfirm: true, reason: null };
  if (inDrinks) return { bookingType: "drinks", autoConfirm: true, reason: "Fuori orario cucina" };

  return { bookingType: "closed", autoConfirm: false, reason: "Fuori orario" };
}

// ======================= TWILIO TWIML HELPERS =======================
function buildTwiml() {
  return new twilio.twiml.VoiceResponse();
}

function sayIt(response, text) {
  response.say({ voice: "alice", language: "it-IT" }, text);
}

function gatherSpeech(response, promptText) {
  const actionUrl = `${BASE_URL}/voice`;
  const gather = response.gather({
    input: "speech",
    language: "it-IT",
    speechTimeout: "auto",
    action: actionUrl,
    method: "POST",
  });
  sayIt(gather, promptText);
}

function canForwardToHuman() {
  return ENABLE_FORWARDING && Boolean(HUMAN_FORWARD_TO) && isValidPhoneE164(HUMAN_FORWARD_TO);
}

function forwardToHumanTwiml() {
  const vr = buildTwiml();
  sayIt(vr, "Ti passo subito un operatore. Resta in linea.");
  vr.dial({}, HUMAN_FORWARD_TO);
  return vr.toString();
}

// ======================= GOOGLE CALENDAR CLIENT =======================
function getServiceAccountJsonRaw() {
  if (GOOGLE_SERVICE_ACCOUNT_JSON_B64) {
    try {
      const decoded = Buffer.from(GOOGLE_SERVICE_ACCOUNT_JSON_B64, "base64").toString("utf-8");
      JSON.parse(decoded);
      return decoded;
    } catch (e) {
      console.error("[CALENDAR] Invalid GOOGLE_SERVICE_ACCOUNT_JSON_B64:", e);
      return "";
    }
  }
  if (GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON);
      return GOOGLE_SERVICE_ACCOUNT_JSON;
    } catch (e) {
      console.error("[CALENDAR] Invalid GOOGLE_SERVICE_ACCOUNT_JSON:", e);
      return "";
    }
  }
  return "";
}

function getCalendarClient() {
  if (!GOOGLE_CALENDAR_ID) {
    console.error("[CALENDAR] Missing GOOGLE_CALENDAR_ID");
    return null;
  }
  const raw = getServiceAccountJsonRaw();
  if (!raw) {
    console.error("[CALENDAR] Missing service account JSON");
    return null;
  }

  const creds = JSON.parse(raw);
  const scopes = ["https://www.googleapis.com/auth/calendar"];
  const auth = new google.auth.JWT(creds.client_email, null, creds.private_key, scopes);
  return google.calendar({ version: "v3", auth });
}

// ======================= CALENDAR MARKERS (locale chiuso / no promo) =======================
function containsMarker(ev, markerLower) {
  const s = `${String(ev.summary || "")}\n${String(ev.description || "")}`.toLowerCase();
  return s.includes(markerLower);
}

async function calendarHasMarkerOnDate(calendar, dateISO, markerLower) {
  const timeMin = `${dateISO}T00:00:00Z`;
  const timeMax = `${dateISO}T23:59:59Z`;
  const resp = await calendar.events.list({
    calendarId: GOOGLE_CALENDAR_ID,
    timeMin,
    timeMax,
    singleEvents: true,
    maxResults: 250,
    orderBy: "startTime",
  });

  return (resp.data.items || []).some((ev) => containsMarker(ev, markerLower));
}

function isPromoEligibleByDay(dateISO) {
  const d = new Date(`${dateISO}T00:00:00`);
  const day = d.getDay(); // 0..6

  // Tue-Sun, excluding Fri
  // Tue=2, Wed=3, Thu=4, Fri=5, Sat=6, Sun=0
  const allowedDay = day === 0 || day === 2 || day === 3 || day === 4 || day === 6;
  if (!allowedDay) return false;

  // Exclude holidays from ENV list
  if (HOLIDAYS_SET.has(dateISO)) return false;

  return true;
}

// ======================= TABLE ALLOCATION + LOCKS =======================
function buildCandidates(area) {
  const singles = TABLES
    .filter((t) => t.area === area)
    .map((t) => ({
      displayId: t.id,
      locks: [t.id],
      min: t.min,
      max: t.max,
      area: t.area,
      notes: t.notes || "",
      kind: "single",
    }));

  const combos = TABLE_COMBINATIONS
    .filter((c) => c.area === area)
    .map((c) => ({
      displayId: c.displayId,
      locks: c.replaces.slice(),
      min: c.min,
      max: c.max,
      area: c.area,
      notes: c.notes || "",
      kind: "combo",
    }));

  return singles.concat(combos);
}

function parseLocksFromEvent(ev) {
  const d = String(ev.description || "");
  const m = d.match(/LOCKS:\s*([A-Z0-9,]+)/i);
  if (!m) return [];
  return m[1].split(",").map((s) => s.trim()).filter(Boolean);
}

async function getLockedTables(calendar, dateISO) {
  const timeMin = `${dateISO}T00:00:00Z`;
  const timeMax = `${dateISO}T23:59:59Z`;

  const resp = await calendar.events.list({
    calendarId: GOOGLE_CALENDAR_ID,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 250,
  });

  const items = resp.data.items || [];
  const locked = new Set();
  for (const ev of items) {
    for (const t of parseLocksFromEvent(ev)) locked.add(t);
  }
  return locked;
}

function allocateTable({ area, people, lockedSet }) {
  const candidates = buildCandidates(area);

  let ok = candidates.filter((c) => people >= c.min && people <= c.max);
  ok = ok.filter((c) => c.locks.every((t) => !lockedSet.has(t)));

  // Best fit: minimize wasted seats. Tie -> singles first.
  ok.sort((a, b) => {
    const wasteA = a.max - people;
    const wasteB = b.max - people;
    if (wasteA !== wasteB) return wasteA - wasteB;
    if (a.kind !== b.kind) return a.kind === "single" ? -1 : 1;
    return String(a.displayId).localeCompare(String(b.displayId));
  });

  if (ok.length === 0) return null;
  return ok[0];
}

// ======================= GOOGLE CALENDAR EVENT CREATION (IDEMPOTENT) =======================
async function createBookingEvent({
  callSid,
  name,
  dateISO,
  time24,
  people,
  phone,
  waTo,
  area,
  bookingType,
  autoConfirm,
  durationMinutes,
  tableDisplayId,
  tableLocks,
  tableNotes,
  specialRequestsRaw,
  preorderLabel,
  preorderPriceText,
  outsideDisclaimer,
  promoEligible,
}) {
  const calendar = getCalendarClient();
  if (!calendar) throw new Error("Calendar client not configured");

  const tz = GOOGLE_CALENDAR_TZ;
  const { startLocal, endLocal } = computeStartEndLocal(dateISO, time24, durationMinutes);

  const privateKey = `callsid:${callSid || "no-callsid"}`;

  // Idempotency: search existing event by privateKey in that date window
  const existing = await calendar.events.list({
    calendarId: GOOGLE_CALENDAR_ID,
    q: privateKey,
    timeMin: `${dateISO}T00:00:00Z`,
    timeMax: `${dateISO}T23:59:59Z`,
    singleEvents: true,
    maxResults: 10,
  });

  const found = (existing.data.items || []).find((ev) => String(ev.description || "").includes(privateKey));
  if (found) {
    return { created: false, eventId: found.id, htmlLink: found.htmlLink };
  }

  const prefix = autoConfirm ? "" : "DA CONFERMARE • ";
  const summary = `${prefix}TB • ${tableDisplayId} • ${name} • ${people} pax`;

  const promoLine =
    preorderLabel && preorderLabel.toLowerCase().includes("promo")
      ? `Promo: ${promoEligible ? "Eleggibile (previa registrazione)" : "NON eleggibile (verificare con cliente)"}`
      : null;

  const description = [
    `TABLE:${tableDisplayId}`,
    `LOCKS:${(tableLocks || []).join(",")}`,
    `AREA:${area}`,
    `TYPE:${bookingType}`,
    "",
    `Nome: ${name}`,
    `Persone: ${people}`,
    phone ? `Telefono: ${phone}` : `Telefono: -`,
    waTo ? `WhatsApp: ${waTo}` : `WhatsApp: -`,
    tableNotes ? `Note tavolo: ${tableNotes}` : null,
    specialRequestsRaw ? `Richieste: ${specialRequestsRaw}` : `Richieste: nessuna`,
    preorderLabel ? `Preordine: ${preorderLabel}${preorderPriceText ? ` (${preorderPriceText})` : ""}` : null,
    promoLine,
    outsideDisclaimer ? `Nota esterno: ${outsideDisclaimer}` : null,
    privateKey,
  ]
    .filter(Boolean)
    .join("\n");

  const requestBody = {
    summary,
    description,
    start: { dateTime: startLocal, timeZone: tz },
    end: { dateTime: endLocal, timeZone: tz },
  };

  const resp = await calendar.events.insert({
    calendarId: GOOGLE_CALENDAR_ID,
    requestBody,
  });

  return { created: true, eventId: resp.data.id, htmlLink: resp.data.htmlLink };
}

// ======================= WHATSAPP CONFIRMATION =======================
async function sendWhatsAppConfirmation({
  waTo,
  name,
  dateISO,
  time24,
  people,
  tableDisplayId,
  area,
  specialRequestsRaw,
  preorderLabel,
  preorderPriceText,
  outsideDisclaimer,
  bookingType,
  promoEligible,
}) {
  if (!twilioClient) throw new Error("Twilio client not configured");
  if (!TWILIO_WHATSAPP_FROM) throw new Error("Missing TWILIO_WHATSAPP_FROM");
  if (!waTo || !hasValidWaAddress(waTo)) throw new Error("Invalid WhatsApp address");

  const lines = [
    `Ciao ${name}! Prenotazione registrata ✅`,
    `Data: ${dateISO}`,
    `Ora: ${time24}`,
    `Persone: ${people}`,
    `Tavolo: ${tableDisplayId} (${area === "inside" ? "interno" : "esterno"})`,
  ];

  if (bookingType === "drinks") {
    lines.push(`Nota: a quest'orario la cucina potrebbe essere chiusa (solo drink e vino).`);
  }

  if (specialRequestsRaw && normalizeText(specialRequestsRaw) !== "nessuna") {
    lines.push(`Richieste: ${specialRequestsRaw}`);
  } else {
    lines.push(`Richieste: nessuna`);
  }

  if (preorderLabel) {
    let preorderLine = `Preordine: ${preorderLabel}`;
    if (preorderPriceText) preorderLine += ` (${preorderPriceText})`;
    lines.push(preorderLine);

    if (preorderLabel.toLowerCase().includes("promo")) {
      lines.push(`Promo: ${promoEligible ? "eleggibile previa registrazione" : "da verificare (giorno non promo o festivo)"}`);
    }
  }

  if (outsideDisclaimer) {
    lines.push(`Nota: ${outsideDisclaimer}`);
  }

  lines.push(`A presto da TuttiBrilli!`);

  const body = lines.join("\n");

  const msg = await twilioClient.messages.create({
    from: TWILIO_WHATSAPP_FROM,
    to: waTo,
    body,
  });

  return msg.sid;
}

// ======================= ROUTES =======================
app.get("/health", (req, res) => res.json({ ok: true }));

app.post("/voice", async (req, res) => {
  const callSid = req.body.CallSid || "";
  const speech = req.body.SpeechResult || "";
  const session = getSession(callSid);

  const vr = buildTwiml();

  try {
    if (!session) {
      sayIt(vr, "Errore di sessione. Riprova tra poco.");
      return res.type("text/xml").send(vr.toString());
    }

    const speechNorm = normalizeText(speech);
    const emptySpeech = !speechNorm;

    switch (session.step) {
      case 1: {
        if (emptySpeech) {
          resetRetries(session);
          gatherSpeech(vr, "Ciao! Benvenuto da TuttiBrilli. Dimmi il tuo nome per la prenotazione.");
          break;
        }

        session.name = speech.trim().slice(0, 60);
        resetRetries(session);
        session.step = 2;
        gatherSpeech(vr, `Perfetto ${session.name}. Per quale data vuoi prenotare? Puoi dire per esempio domani o 30 dicembre.`);
        break;
      }

      case 2: {
        if (emptySpeech) {
          if (bumpRetries(session) > 2) {
            sayIt(vr, "Non ho capito la data. Ti passo un operatore.");
            if (canForwardToHuman()) return res.type("text/xml").send(forwardToHumanTwiml());
            sayIt(vr, "Puoi richiamare più tardi. Grazie.");
            break;
          }
          gatherSpeech(vr, "Non ho sentito la data. Dimmi la data della prenotazione.");
          break;
        }

        const dateISO = parseDateIT(speech);
        if (!dateISO) {
          if (bumpRetries(session) > 2) {
            sayIt(vr, "Non riesco a capire la data. Ti passo un operatore.");
            if (canForwardToHuman()) return res.type("text/xml").send(forwardToHumanTwiml());
            sayIt(vr, "Puoi richiamare più tardi. Grazie.");
            break;
          }
          gatherSpeech(vr, "Scusa, non ho capito. Dimmi la data, ad esempio: 30 12 2025, oppure domani.");
          break;
        }

        session.dateISO = dateISO;
        resetRetries(session);
        session.step = 3;
        gatherSpeech(vr, "A che ora? Ad esempio: 20 e 30.");
        break;
      }

      case 3: {
        if (emptySpeech) {
          if (bumpRetries(session) > 2) {
            sayIt(vr, "Non ho capito l'orario. Ti passo un operatore.");
            if (canForwardToHuman()) return res.type("text/xml").send(forwardToHumanTwiml());
            sayIt(vr, "Puoi richiamare più tardi. Grazie.");
            break;
          }
          gatherSpeech(vr, "Non ho sentito l'orario. Dimmi a che ora vuoi prenotare.");
          break;
        }

        const time24 = parseTimeIT(speech);
        if (!time24) {
          if (bumpRetries(session) > 2) {
            sayIt(vr, "Non riesco a capire l'orario. Ti passo un operatore.");
            if (canForwardToHuman()) return res.type("text/xml").send(forwardToHumanTwiml());
            sayIt(vr, "Puoi richiamare più tardi. Grazie.");
            break;
          }
          gatherSpeech(vr, "Scusa, non ho capito. Dimmi l'orario, ad esempio 20 e 30.");
          break;
        }

        session.time24 = time24;

        const calendar = getCalendarClient();
        if (!calendar) throw new Error("Calendar client not configured");

        // HARD BLOCK: "locale chiuso" on that date -> no bookings
        const isClosed = await calendarHasMarkerOnDate(calendar, session.dateISO, "locale chiuso");
        if (isClosed) {
          sayIt(vr, "Mi dispiace, per quella data il locale risulta chiuso e non posso fissare prenotazioni. Ti passo un operatore.");
          if (canForwardToHuman()) return res.type("text/xml").send(forwardToHumanTwiml());
          sayIt(vr, "Grazie.");
          vr.hangup();
          sessions.delete(callSid);
          break;
        }

        // Promo eligibility: by day + not "no promo" marker on calendar
        const dayOk = isPromoEligibleByDay(session.dateISO);
        const hasNoPromo = await calendarHasMarkerOnDate(calendar, session.dateISO, "no promo");
        session.promoEligible = dayOk && !hasNoPromo;

        // Validate opening hours / booking type
        const { bookingType, autoConfirm, reason } = deriveBookingTypeAndConfirm(session.dateISO, session.time24);
        session.bookingType = bookingType;
        session.autoConfirm = autoConfirm;

        if (bookingType === "closed") {
          sayIt(vr, `A quell'orario siamo chiusi. ${reason ? reason : ""} Ti passo un operatore.`);
          if (canForwardToHuman()) return res.type("text/xml").send(forwardToHumanTwiml());
          sayIt(vr, "Puoi richiamare durante l'orario di apertura. Grazie.");
          break;
        }

        if (bookingType === "operator") {
          sayIt(vr, "Ti avviso che il lunedì siamo chiusi, ma possiamo aprire per eventi su conferma dell'operatore. Raccolgo i dati e ti ricontatteremo.");
        } else if (bookingType === "drinks") {
          sayIt(vr, "Nota: a quest'orario la cucina potrebbe essere chiusa. Possiamo fare solo drink e vino.");
        }

        resetRetries(session);
        session.step = 4;
        gatherSpeech(vr, "Per quante persone?");
        break;
      }

      case 4: {
        if (emptySpeech) {
          if (bumpRetries(session) > 2) {
            sayIt(vr, "Non ho capito il numero di persone. Ti passo un operatore.");
            if (canForwardToHuman()) return res.type("text/xml").send(forwardToHumanTwiml());
            sayIt(vr, "Puoi richiamare più tardi. Grazie.");
            break;
          }
          gatherSpeech(vr, "Non ho sentito. Per quante persone?");
          break;
        }

        const people = parsePeopleIT(speech);
        if (!people || people < 1 || people > 18) {
          if (bumpRetries(session) > 2) {
            sayIt(vr, "Non riesco a gestire questa prenotazione automaticamente. Ti passo un operatore.");
            if (canForwardToHuman()) return res.type("text/xml").send(forwardToHumanTwiml());
            sayIt(vr, "Grazie.");
            break;
          }
          gatherSpeech(vr, "Scusa, quante persone? Dimmi un numero tra 1 e 18.");
          break;
        }

        session.people = people;
        resetRetries(session);
        session.step = 5;
        gatherSpeech(
          vr,
          "Ci sono allergie, intolleranze o richieste particolari? Puoi dire per esempio: nessuna, celiaco, senza lattosio, vegetariano, tavolo tranquillo."
        );
        break;
      }

      case 5: {
        if (emptySpeech) {
          if (bumpRetries(session) > 2) {
            session.specialRequestsRaw = "nessuna";
            resetRetries(session);
            session.step = 6;
            gatherSpeech(vr, "Vuoi preordinare qualcosa? Puoi dire: cena, apericena, dopocena, piatto apericena, oppure piatto apericena promo. Se non vuoi, dì nessuno.");
            break;
          }
          gatherSpeech(vr, "Non ho sentito. Ci sono allergie o richieste particolari? Se non ce ne sono, di' nessuna.");
          break;
        }

        session.specialRequestsRaw = speech.trim().slice(0, 200);
        resetRetries(session);
        session.step = 6;
        gatherSpeech(vr, "Vuoi preordinare qualcosa? Puoi dire: cena, apericena, dopocena, piatto apericena, oppure piatto apericena promo. Se non vuoi, dì nessuno.");
        break;
      }

      case 6: {
        // Preorder choice (single selection from fixed menu)
        if (emptySpeech) {
          if (bumpRetries(session) > 2) {
            session.preorderChoiceKey = null;
            session.preorderLabel = null;
            resetRetries(session);
            session.step = 8;
            gatherSpeech(vr, "Preferisci sala interna o sala esterna? Ti consiglio l'interno.");
            break;
          }
          gatherSpeech(vr, "Non ho sentito. Vuoi preordinare? Di' cena, apericena, dopocena, piatto apericena, piatto apericena promo, oppure nessuno.");
          break;
        }

        const key = parsePreorderChoiceKey(speech);

        if (key === "unknown") {
          if (bumpRetries(session) > 2) {
            session.preorderChoiceKey = null;
            session.preorderLabel = null;
            resetRetries(session);
            session.step = 8;
            gatherSpeech(vr, "Ok, nessun preordine. Preferisci sala interna o sala esterna? Ti consiglio l'interno.");
            break;
          }
          gatherSpeech(vr, "Scusa, non ho capito. Puoi dire: cena, apericena, dopocena, piatto apericena, piatto apericena promo, oppure nessuno.");
          break;
        }

        // "nessuno"
        if (!key) {
          session.preorderChoiceKey = null;
          session.preorderLabel = null;
          resetRetries(session);
          session.step = 8;
          gatherSpeech(vr, "Perfetto. Preferisci sala interna o sala esterna? Ti consiglio l'interno.");
          break;
        }

        // validate constraints
        const opt = getPreorderOptionByKey(key);
        if (!opt) {
          session.preorderChoiceKey = null;
          session.preorderLabel = null;
          resetRetries(session);
          session.step = 8;
          gatherSpeech(vr, "Ok. Preferisci sala interna o sala esterna? Ti consiglio l'interno.");
          break;
        }

        // dopocena only after 22:30
        if (opt.constraints && opt.constraints.minTime) {
          if (!isTimeAtOrAfter(session.time24, opt.constraints.minTime)) {
            sayIt(vr, "Il dopocena è disponibile solo dopo le 22 e 30.");
            resetRetries(session);
            gatherSpeech(vr, "Vuoi scegliere tra cena, apericena o piatto apericena? Oppure dì nessuno.");
            break;
          }
        }

        // promo rule check: we allow selection, but if not eligible we warn & still record
        if (opt.constraints && opt.constraints.promoOnly) {
          if (!session.promoEligible) {
            sayIt(vr, "Nota: oggi la promo potrebbe non essere valida, per giorno non promo, festivo o indicazione no promo. La segnalo comunque e verrà verificata.");
          }
        }

        session.preorderChoiceKey = opt.key;
        session.preorderLabel = opt.label;

        resetRetries(session);
        session.step = 8;
        gatherSpeech(vr, "Perfetto. Preferisci sala interna o sala esterna? Ti consiglio l'interno.");
        break;
      }

      case 8: {
        // Area selection with outside disclaimer + recommendation
        if (emptySpeech) {
          if (bumpRetries(session) > 2) {
            session.area = "inside";
            resetRetries(session);
            session.step = 10;
            gatherSpeech(vr, "Perfetto. Dimmi il tuo numero di telefono, anche per WhatsApp.");
            break;
          }
          gatherSpeech(vr, "Non ho capito. Preferisci sala interna o sala esterna? Ti consiglio l'interno.");
          break;
        }

        if (session.pendingOutsideConfirm) {
          const area = parseAreaIT(speech);
          const t = normalizeText(speech);

          if (area === "inside") {
            session.area = "inside";
            session.pendingOutsideConfirm = false;
            resetRetries(session);
            session.step = 10;
            gatherSpeech(vr, "Perfetto, interno. Dimmi il tuo numero di telefono, anche per WhatsApp.");
            break;
          }
          if (area === "outside" || t.includes("confermo") || t.includes("va bene esterno")) {
            session.area = "outside";
            session.pendingOutsideConfirm = false;
            resetRetries(session);
            session.step = 10;
            gatherSpeech(vr, "Perfetto, esterno. Dimmi il tuo numero di telefono, anche per WhatsApp.");
            break;
          }

          if (bumpRetries(session) > 2) {
            session.area = "inside";
            session.pendingOutsideConfirm = false;
            resetRetries(session);
            session.step = 10;
            gatherSpeech(vr, "Ok, ti assegno un tavolo interno. Dimmi il tuo numero di telefono.");
            break;
          }

          gatherSpeech(vr, "Preferisci interno, oppure confermi esterno?");
          break;
        }

        const area = parseAreaIT(speech);
        if (!area) {
          if (bumpRetries(session) > 2) {
            session.area = "inside";
            resetRetries(session);
            session.step = 10;
            gatherSpeech(vr, "Ok, ti assegno un tavolo interno. Dimmi il tuo numero di telefono.");
            break;
          }
          gatherSpeech(vr, "Scusa, non ho capito. Preferisci sala interna o sala esterna? Ti consiglio l'interno.");
          break;
        }

        if (area === "outside") {
          session.pendingOutsideConfirm = true;
          resetRetries(session);
          gatherSpeech(
            vr,
            "Ti avviso che all'esterno non ci sono riscaldamenti né copertura, e in caso di maltempo non è garantito il posto all'interno. Ti consiglio l'interno. Preferisci interno, oppure confermi esterno?"
          );
          break;
        }

        session.area = "inside";
        resetRetries(session);
        session.step = 10;
        gatherSpeech(vr, "Perfetto, interno. Dimmi il tuo numero di telefono, anche per WhatsApp.");
        break;
      }

      case 10: {
        // Phone / WhatsApp
        if (emptySpeech) {
          if (bumpRetries(session) > 2) {
            sayIt(vr, "Non ho capito il numero. Ti passo un operatore.");
            if (canForwardToHuman()) return res.type("text/xml").send(forwardToHumanTwiml());
            sayIt(vr, "Puoi richiamare più tardi. Grazie.");
            break;
          }
          gatherSpeech(vr, "Non ho sentito il numero. Dimmi il tuo numero di telefono, per WhatsApp.");
          break;
        }

        const phone = extractPhoneFromSpeech(speech);
        if (!phone || !isValidPhoneE164(phone)) {
          if (bumpRetries(session) > 2) {
            sayIt(vr, "Non riesco a capire il numero. Ti passo un operatore.");
            if (canForwardToHuman()) return res.type("text/xml").send(forwardToHumanTwiml());
            sayIt(vr, "Grazie.");
            break;
          }
          gatherSpeech(vr, "Scusa, non ho capito. Dimmi il numero in questo formato: più trentanove, e poi il numero.");
          break;
        }

        session.phone = phone;
        session.waTo = `whatsapp:${phone}`;
        resetRetries(session);

        // ===== ALLOCATE TABLE + CALENDAR LOCK =====
        const calendar = getCalendarClient();
        if (!calendar) throw new Error("Calendar client not configured");

        // Safety: re-check "locale chiuso" before committing
        const isClosed = await calendarHasMarkerOnDate(calendar, session.dateISO, "locale chiuso");
        if (isClosed) {
          sayIt(vr, "Mi dispiace, per quella data il locale risulta chiuso e non posso fissare prenotazioni. Ti passo un operatore.");
          if (canForwardToHuman()) return res.type("text/xml").send(forwardToHumanTwiml());
          sayIt(vr, "Grazie.");
          vr.hangup();
          sessions.delete(callSid);
          break;
        }

        const d = new Date(`${session.dateISO}T00:00:00`);
        session.durationMinutes = getDurationMinutes(session.people, d);

        const lockedSet = await getLockedTables(calendar, session.dateISO);
        const chosen = allocateTable({
          area: session.area,
          people: session.people,
          lockedSet,
        });

        if (!chosen) {
          sayIt(vr, "Mi dispiace, per quell'orario non ho tavoli disponibili nella sala scelta. Ti passo un operatore per trovare una soluzione.");
          if (canForwardToHuman()) return res.type("text/xml").send(forwardToHumanTwiml());
          sayIt(vr, "Puoi provare un altro orario. Grazie.");
          break;
        }

        session.tableDisplayId = chosen.displayId;
        session.tableLocks = chosen.locks;
        session.tableNotes = chosen.notes || null;

        const outsideDisclaimer =
          session.area === "outside"
            ? "Tavolo esterno: in caso di maltempo non è garantito il posto all'interno."
            : null;

        // Preorder price text (if any)
        let preorderPriceText = null;
        if (session.preorderChoiceKey) {
          const opt = getPreorderOptionByKey(session.preorderChoiceKey);
          if (opt && typeof opt.priceEUR === "number") preorderPriceText = `${opt.priceEUR} €`;
        }

        // Create Calendar Event (idempotent)
        let calResult;
        try {
          calResult = await createBookingEvent({
            callSid,
            name: session.name,
            dateISO: session.dateISO,
            time24: session.time24,
            people: session.people,
            phone: session.phone,
            waTo: session.waTo,
            area: session.area,
            bookingType: session.bookingType,
            autoConfirm: session.autoConfirm,
            durationMinutes: session.durationMinutes,
            tableDisplayId: session.tableDisplayId,
            tableLocks: session.tableLocks,
            tableNotes: session.tableNotes,
            specialRequestsRaw: session.specialRequestsRaw,
            preorderLabel: session.preorderLabel,
            preorderPriceText,
            outsideDisclaimer,
            promoEligible: Boolean(session.promoEligible),
          });
        } catch (e) {
          console.error("[CALENDAR] create error:", e);
          sayIt(vr, "Mi dispiace, c'è stato un problema nel registrare la prenotazione. Ti passo un operatore.");
          if (canForwardToHuman()) return res.type("text/xml").send(forwardToHumanTwiml());
          sayIt(vr, "Puoi richiamare più tardi. Grazie.");
          break;
        }

        // WhatsApp ONLY if autoConfirm is true AND calendar ok
        if (session.autoConfirm) {
          try {
            await sendWhatsAppConfirmation({
              waTo: session.waTo,
              name: session.name,
              dateISO: session.dateISO,
              time24: session.time24,
              people: session.people,
              tableDisplayId: session.tableDisplayId,
              area: session.area,
              specialRequestsRaw: session.specialRequestsRaw,
              preorderLabel: session.preorderLabel,
              preorderPriceText,
              outsideDisclaimer,
              bookingType: session.bookingType,
              promoEligible: Boolean(session.promoEligible),
            });
          } catch (e) {
            console.error("[WHATSAPP] send error:", e);
            // Don't fail the call: calendar is created already.
          }
        }

        // Final voice confirmation
        if (session.autoConfirm) {
          let extra = "";
          if (session.area === "outside") {
            extra = " Ti ricordo che all'esterno in caso di maltempo non è garantito il posto dentro.";
          }

          let preorderVoice = "";
          if (session.preorderLabel) {
            preorderVoice = ` Ho segnato il preordine: ${session.preorderLabel}.`;
          }

          sayIt(
            vr,
            `Perfetto ${session.name}. Ho registrato la prenotazione per ${session.people} persone il ${session.dateISO} alle ${session.time24}, tavolo ${session.tableDisplayId}.${preorderVoice}${extra} Ti ho inviato conferma su WhatsApp. A presto!`
          );
        } else {
          sayIt(
            vr,
            `Perfetto ${session.name}. Ho registrato la richiesta. Un operatore la confermerà appena possibile. Grazie e a presto!`
          );
        }

        vr.hangup();
        sessions.delete(callSid);
        break;
      }

      default: {
        sayIt(vr, "Grazie. A presto!");
        vr.hangup();
        sessions.delete(callSid);
        break;
      }
    }

    return res.type("text/xml").send(vr.toString());
  } catch (err) {
    console.error("[VOICE] Error:", err);
    sayIt(vr, "Mi dispiace, c'è stato un errore tecnico. Riprova tra poco.");
    if (canForwardToHuman()) {
      sayIt(vr, "Ti passo un operatore.");
      vr.dial({}, HUMAN_FORWARD_TO);
    } else {
      vr.hangup();
    }
    return res.type("text/xml").send(vr.toString());
  }
});

app.get("/", (req, res) => {
  res.send("TuttiBrilli Voice Booking is running. Use POST /voice from Twilio.");
});

app.listen(PORT, () => {
  console.log(`[BOOT] Listening on port ${PORT}`);
  console.log(`[BOOT] BASE_URL=${BASE_URL}`);
});
