/**
 * app.js — TuttiBrilli Enoteca Voice Assistant
 * - dotenv opzionale (non rompe su Render se dotenv non installato)
 * - sayIt() NON forza "alice" (usa voce configurata su Twilio Console)
 * - Fix: chiamata non si interrompe al telefono
 * - Fix: prenotazione parziale su Calendar se telefono non valido
 * - Parsing date/telefono robusti + default +39
 */

"use strict";

// dotenv opzionale: in produzione (Render) le env vars sono già presenti
try {
  require("dotenv").config();
} catch (_) {}

const express = require("express");
const twilio = require("twilio");
const bodyParser = require("body-parser");
const { google } = require("googleapis");

const { PROMPTS } = require("./prompts");

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.json());

// ======================= ENV =======================
const PORT = process.env.PORT || 3000;
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
const HOLIDAYS_SET = new Set(HOLIDAYS_YYYY_MM_DD.split(",").map((s) => s.trim()).filter(Boolean));

const twilioClient =
  TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN) : null;

// ======================= OPENING HOURS =======================
const OPENING = {
  closedDay: 1, // Monday
  restaurant: {
    default: { start: "18:30", end: "22:30" }, // Tue-Thu, Sun
    friSat: { start: "18:30", end: "23:00" }, // Fri-Sat
  },
  drinksOnly: { start: "18:30", end: "24:00" }, // everyday
  musicNights: { days: [3, 5] }, // Wed & Fri
};

// ======================= PREORDER MENU =======================
const PREORDER_OPTIONS = [
  { key: "cena", label: "Cena", priceEUR: null, constraints: {} },
  { key: "apericena", label: "Apericena", priceEUR: null, constraints: {} },
  { key: "dopocena", label: "Dopocena (dopo le 22:30)", priceEUR: null, constraints: { minTime: "22:30" } },
  { key: "piatto_apericena", label: "Piatto Apericena", priceEUR: 25, constraints: {} },
  { key: "piatto_apericena_promo", label: "Piatto Apericena in promo (previa registrazione)", priceEUR: null, constraints: { promoOnly: true } },
];

function getPreorderOptionByKey(key) {
  return PREORDER_OPTIONS.find((o) => o.key === key) || null;
}

// ======================= TABLES =======================
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

// ======================= PROMPTS HELPERS =======================
function renderTemplate(str, vars = {}) {
  const s = String(str || "");
  return s.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const v = vars[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

function pickPrompt(path, fallback = "") {
  const parts = String(path || "").split(".");
  let node = PROMPTS;
  for (const p of parts) {
    if (!node || typeof node !== "object" || !(p in node)) return fallback;
    node = node[p];
  }
  return typeof node === "string" ? node : fallback;
}

function t(path, vars = {}, fallback = "") {
  return renderTemplate(pickPrompt(path, fallback), vars);
}

// ======================= TWILIO HELPERS =======================
function buildTwiml() {
  return new twilio.twiml.VoiceResponse();
}

/**
 * VOICE FIX: NON forziamo "alice"
 * Twilio userà la voce configurata in Console (es. Chirp3-HD-Aoede)
 */
function sayIt(response, text) {
  response.say({ language: "it-IT" }, text);
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

function isValidPhoneE164(s) {
  return /^\+\d{8,15}$/.test(String(s || "").trim());
}
function hasValidWaAddress(s) {
  return /^whatsapp:\+\d{8,15}$/.test(String(s || "").trim());
}

function canForwardToHuman() {
  return ENABLE_FORWARDING && Boolean(HUMAN_FORWARD_TO) && isValidPhoneE164(HUMAN_FORWARD_TO);
}

function forwardToHumanTwiml() {
  const vr = buildTwiml();
  sayIt(vr, t("step9_fallback_transfer_operator.main"));
  vr.dial({}, HUMAN_FORWARD_TO);
  return vr.toString();
}

// ======================= SESSION =======================
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

      preorderChoiceKey: null,
      preorderLabel: null,

      area: null,
      pendingOutsideConfirm: false,

      phone: null,
      waTo: null,

      tableDisplayId: null,
      tableLocks: [],
      tableNotes: null,

      durationMinutes: null,
      bookingType: "restaurant",
      autoConfirm: true,

      promoEligible: null,
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

// ======================= PARSING & UTIL =======================
function normalizeText(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
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

// ---- Back/edit commands
function isBackCommand(speech) {
  const t = normalizeText(speech);
  return (
    t.includes("indietro") ||
    t.includes("torna indietro") ||
    t.includes("tornare indietro") ||
    t.includes("modifica") ||
    t.includes("errore") ||
    t.includes("ho sbagliato") ||
    t.includes("sbagliato")
  );
}

function goBack(session) {
  if (!session || typeof session.step !== "number") return;
  if (session.step <= 1) return;

  // 1 nome -> 2 data -> 3 ora -> 4 pax -> 5 note -> 6 preordine -> 8 area -> 10 telefono
  if (session.step === 2) session.step = 1;
  else if (session.step === 3) session.step = 2;
  else if (session.step === 4) session.step = 3;
  else if (session.step === 5) session.step = 4;
  else if (session.step === 6) session.step = 5;
  else if (session.step === 8) session.step = 6;
  else if (session.step === 10) session.step = 8;
  else session.step = Math.max(1, session.step - 1);
}

function promptForStep(vr, session) {
  switch (session.step) {
    case 1:
      gatherSpeech(vr, t("step1_welcome_name.main"));
      return;
    case 2:
      gatherSpeech(vr, t("step2_confirm_name_ask_date.main", { name: session.name || "" }));
      return;
    case 3:
      gatherSpeech(vr, t("step3_confirm_date_ask_time.main", { dateLabel: session.dateISO || "" }));
      return;
    case 4:
      gatherSpeech(vr, t("step4_confirm_time_ask_party_size.main", { time: session.time24 || "" }));
      return;
    case 5:
      gatherSpeech(vr, t("step5_party_size_ask_notes.main", { partySize: session.people || "" }));
      return;
    case 6:
      gatherSpeech(
        vr,
        "Vuoi preordinare qualcosa? Puoi dire: cena, apericena, dopocena, piatto apericena, oppure piatto apericena promo. Se non vuoi, dì nessuno."
      );
      return;
    case 8:
      gatherSpeech(vr, "Preferisci sala interna o sala esterna? Ti consiglio l'interno.");
      return;
    case 10:
      gatherSpeech(vr, t("step7_whatsapp_number.main"));
      return;
    default:
      gatherSpeech(vr, t("step1_welcome_name.short"));
      return;
  }
}

// ---- Date parsing robusto
function parseItalianNumberToInt(text) {
  const t = normalizeText(text).replace(/[-,\.]/g, " ").replace(/\s+/g, " ").trim();

  const direct = {
    uno: 1, una: 1, primo: 1,
    due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9,
    dieci: 10, undici: 11, dodici: 12, tredici: 13, quattordici: 14, quindici: 15, sedici: 16, diciassette: 17,
    diciotto: 18, diciannove: 19, venti: 20, trenta: 30
  };
  if (direct[t] != null) return direct[t];

  const cleaned = t.replace(/’/g, "'").replace(/'/g, "");
  const units = { uno: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9 };

  if (cleaned.startsWith("venti")) {
    const tail = cleaned.slice("venti".length).trim();
    if (!tail) return 20;
    if (units[tail] != null) return 20 + units[tail];
  }

  if (cleaned.startsWith("trenta")) {
    const tail = cleaned.slice("trenta".length).trim();
    if (!tail) return 30;
    if (tail === "uno" || tail === "una") return 31;
  }

  const m = cleaned.match(/\b(\d{1,2})\b/);
  if (m) return Number(m[1]);

  return null;
}

function parseDateIT(speech) {
  const t0 = normalizeText(speech);
  const t = t0.replace(/[,\.]/g, " ").replace(/\s+/g, " ").trim();
  const today = nowLocal();

  if (t.includes("oggi")) return toISODate(today);
  if (t.includes("domani")) {
    const d = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    return toISODate(d);
  }

  const rel = t.match(/\b(tra|fra)\s+(.+?)\s+giorn[io]\b/);
  if (rel) {
    const n = parseItalianNumberToInt(rel[2]);
    if (n && n > 0) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      d.setDate(d.getDate() + n);
      return toISODate(d);
    }
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

  const dmSpace = t.match(/\b(\d{1,2})\s+(\d{1,2})(?:\s+(\d{2,4}))?\b/);
  if (dmSpace) {
    let dd = Number(dmSpace[1]);
    let mm = Number(dmSpace[2]);
    let yy = dmSpace[3] ? Number(dmSpace[3]) : today.getFullYear();
    if (yy < 100) yy += 2000;
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      const d = new Date(yy, mm - 1, dd);
      return toISODate(d);
    }
  }

  const weekdayMap = {
    domenica: 0,
    lunedi: 1, "lunedì": 1,
    martedi: 2, "martedì": 2,
    mercoledi: 3, "mercoledì": 3,
    giovedi: 4, "giovedì": 4,
    venerdi: 5, "venerdì": 5,
    sabato: 6,
  };

  const hasQuesto = /\b(questo|questa|sto|sta)\b/.test(t);
  const hasProssimo = /\b(prossimo|prossima)\b/.test(t);

  const weekdayMatch = t.match(/\b(domenica|lunedi|lunedì|martedi|martedì|mercoledi|mercoledì|giovedi|giovedì|venerdi|venerdì|sabato)\b/);
  if (weekdayMatch) {
    const target = weekdayMap[weekdayMatch[1]];
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const current = d.getDay();
    let diff = (target - current + 7) % 7;

    if (hasProssimo) diff = diff === 0 ? 7 : diff + 7;
    else if (hasQuesto) {
      // ok
    }

    d.setDate(d.getDate() + diff);
    return toISODate(d);
  }

  const months = {
    gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6,
    luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
  };

  const cleaned = t
    .replace(/\b(lunedi|lunedì|martedi|martedì|mercoledi|mercoledì|giovedi|giovedì|venerdi|venerdì|sabato|domenica)\b/g, " ")
    .replace(/\b(questo|questa|prossimo|prossima|il|lo|la|per|di|del|dello|della)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const m = cleaned.match(/\b(.+?)\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?:\s+(\d{2,4}))?\b/);
  if (m) {
    const dd = parseItalianNumberToInt(m[1]);
    const mm = months[m[2]];
    let yy = m[3] ? Number(m[3]) : today.getFullYear();
    if (yy < 100) yy += 2000;

    if (dd && dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
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
    if (hh >= 0 && hh <= 23) return `${String(hh).padStart(2, "0")}:00`;
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

function parseAreaIT(speech) {
  const t = normalizeText(speech);
  if (t.includes("intern") || t.includes("dentro") || t.includes("sala")) return "inside";
  if (t.includes("estern") || t.includes("fuori") || t.includes("terraz") || t.includes("giardino")) return "outside";
  return null;
}

function parsePreorderChoiceKey(speech) {
  const t = normalizeText(speech);
  if (t.includes("promo")) return "piatto_apericena_promo";
  if (t.includes("piatto") && t.includes("apericena")) return "piatto_apericena";
  if (t.includes("dopocena") || t.includes("dopo cena") || t.includes("dopo")) return "dopocena";
  if (t.includes("apericena")) return "apericena";
  if (t.includes("cena")) return "cena";
  if (t.includes("nessuno") || t.includes("nessuna") || t.includes("no")) return null;
  return "unknown";
}

// ---- Phone parsing robusto + default +39
function speechToDigitsIT(raw) {
  const t = normalizeText(raw);
  const map = { zero: "0", uno: "1", una: "1", due: "2", tre: "3", quattro: "4", cinque: "5", sei: "6", sette: "7", otto: "8", nove: "9" };

  const tokens = t.replace(/[^a-z0-9+\s]/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  let out = "";

  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i];

    if (/^\d+$/.test(w)) { out += w; continue; }
    if (w === "+" || w === "piu" || w === "più") { out += "+"; continue; }

    if (w === "doppio" || w === "triplo") {
      const next = tokens[i + 1];
      const digit = map[next] || (next && /^\d$/.test(next) ? next : null);
      if (digit) {
        out += w === "doppio" ? digit + digit : digit + digit + digit;
        i++;
        continue;
      }
    }

    if (map[w]) { out += map[w]; continue; }
  }

  return out;
}

function extractPhoneFromSpeech(speech) {
  if (!speech) return null;

  // 1) cifre già presenti
  let raw = String(speech).replace(/[^\d+]/g, "");
  if (raw) {
    if (raw.startsWith("00")) raw = "+" + raw.slice(2);

    if (raw.startsWith("+")) {
      const digits = raw.slice(1).replace(/\D/g, "");
      const e164 = "+" + digits;
      if (isValidPhoneE164(e164)) return e164;
    } else {
      const digits = raw.replace(/\D/g, "");
      if (digits.length >= 8 && digits.length <= 15) {
        if (digits.startsWith("39")) {
          const e164 = "+" + digits;
          if (isValidPhoneE164(e164)) return e164;
        } else {
          const e164 = "+39" + digits;
          if (isValidPhoneE164(e164)) return e164;
        }
      }
    }
  }

  // 2) parole -> cifre
  const fromWords = speechToDigitsIT(speech);
  if (!fromWords) return null;

  let s = String(fromWords).replace(/[^\d+]/g, "");
  if (!s) return null;

  if (s.startsWith("00")) s = "+" + s.slice(2);

  if (s.startsWith("+")) {
    const digits = s.slice(1).replace(/\D/g, "");
    const e164 = "+" + digits;
    return isValidPhoneE164(e164) ? e164 : null;
  }

  const digits = s.replace(/\D/g, "");
  if (!digits) return null;

  if (digits.startsWith("39")) {
    const e164 = "+" + digits;
    return isValidPhoneE164(e164) ? e164 : null;
  }

  const e164 = "+39" + digits;
  return isValidPhoneE164(e164) ? e164 : null;
}

// ======================= TIME HELPERS =======================
function hmToMinutes(hm) {
  const [h, m] = String(hm).split(":").map(Number);
  return h * 60 + m;
}

function isTimeAtOrAfter(time24, minTime24) {
  return hmToMinutes(time24) >= hmToMinutes(minTime24);
}

function getRestaurantWindowForDay(day) {
  if (day === 5 || day === 6) return OPENING.restaurant.friSat;
  return OPENING.restaurant.default;
}

function isWithinWindow(time24, startHM, endHM) {
  const tmin = hmToMinutes(time24);
  const start = hmToMinutes(startHM);
  const end = hmToMinutes(endHM);
  return tmin >= start && tmin <= end;
}

function deriveBookingTypeAndConfirm(dateISO, time24) {
  const d = new Date(`${dateISO}T00:00:00`);
  const day = d.getDay();

  if (day === OPENING.closedDay) return { bookingType: "operator", autoConfirm: false };

  const restWin = getRestaurantWindowForDay(day);
  const inRestaurant = isWithinWindow(time24, restWin.start, restWin.end);
  const inDrinks = isWithinWindow(time24, OPENING.drinksOnly.start, OPENING.drinksOnly.end);

  if (inRestaurant) return { bookingType: "restaurant", autoConfirm: true };
  if (inDrinks) return { bookingType: "drinks", autoConfirm: true };

  return { bookingType: "closed", autoConfirm: false };
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

function toISODateWithOffset(dateISO, daysOffset) {
  const d = new Date(`${dateISO}T00:00:00`);
  d.setDate(d.getDate() + daysOffset);
  return toISODate(d);
}

function computeStartEndLocal(dateISO, time24, durationMinutes) {
  const [sh, sm] = time24.split(":").map(Number);
  const startTotal = sh * 60 + sm;
  const endTotal = startTotal + durationMinutes;

  const endDayOffset = Math.floor(endTotal / (24 * 60));
  const endMinutesOfDay = endTotal % (24 * 60);
  const endH = Math.floor(endMinutesOfDay / 60);
  const endM = endMinutesOfDay % 60;

  const endDateISO = endDayOffset > 0 ? toISODateWithOffset(dateISO, endDayOffset) : dateISO;

  const startLocal = `${dateISO}T${String(sh).padStart(2, "0")}:${String(sm).padStart(2, "0")}:00`;
  const endLocal = `${endDateISO}T${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}:00`;

  return { startLocal, endLocal };
}

// ======================= GOOGLE CALENDAR =======================
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
  if (!GOOGLE_CALENDAR_ID) return null;

  const raw = getServiceAccountJsonRaw();
  if (!raw) return null;

  const creds = JSON.parse(raw);
  const scopes = ["https://www.googleapis.com/auth/calendar"];
  const auth = new google.auth.JWT(creds.client_email, null, creds.private_key, scopes);
  return google.calendar({ version: "v3", auth });
}

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
  const day = d.getDay();
  const allowedDay = day === 0 || day === 2 || day === 3 || day === 4 || day === 6; // Tue-Sun excl Fri
  if (!allowedDay) return false;
  if (HOLIDAYS_SET.has(dateISO)) return false;
  return true;
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

  const locked = new Set();
  for (const ev of resp.data.items || []) {
    for (const tId of parseLocksFromEvent(ev)) locked.add(tId);
  }
  return locked;
}

// ======================= TABLE ALLOCATION =======================
function buildCandidates(area) {
  const singles = TABLES.filter((tt) => tt.area === area).map((tt) => ({
    displayId: tt.id,
    locks: [tt.id],
    min: tt.min,
    max: tt.max,
    area: tt.area,
    notes: tt.notes || "",
    kind: "single",
  }));

  const combos = TABLE_COMBINATIONS.filter((c) => c.area === area).map((c) => ({
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

function allocateTable({ area, people, lockedSet }) {
  const candidates = buildCandidates(area);

  let ok = candidates.filter((c) => people >= c.min && people <= c.max);
  ok = ok.filter((c) => c.locks.every((tId) => !lockedSet.has(tId)));

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

// ======================= EVENT CREATION (IDEMPOTENT) =======================
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

  // Idempotenza su CallSid (salvata nel description)
  const existing = await calendar.events.list({
    calendarId: GOOGLE_CALENDAR_ID,
    q: privateKey,
    timeMin: `${dateISO}T00:00:00Z`,
    timeMax: `${dateISO}T23:59:59Z`,
    singleEvents: true,
    maxResults: 10,
  });

  const found = (existing.data.items || []).find((ev) => String(ev.description || "").includes(privateKey));
  if (found) return { created: false, eventId: found.id };

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

  return { created: true, eventId: resp.data.id };
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

  if (bookingType === "drinks") lines.push(`Nota: a quest'orario la cucina potrebbe essere chiusa (solo drink e vino).`);

  if (specialRequestsRaw && normalizeText(specialRequestsRaw) !== "nessuna") lines.push(`Richieste: ${specialRequestsRaw}`);
  else lines.push(`Richieste: nessuna`);

  if (preorderLabel) {
    let preorderLine = `Preordine: ${preorderLabel}`;
    if (preorderPriceText) preorderLine += ` (${preorderPriceText})`;
    lines.push(preorderLine);

    if (preorderLabel.toLowerCase().includes("promo")) {
      lines.push(`Promo: ${promoEligible ? "eleggibile previa registrazione" : "da verificare (giorno non promo o festivo)"}`);
    }
  }

  if (outsideDisclaimer) lines.push(`Nota: ${outsideDisclaimer}`);

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

    const emptySpeech = !normalizeText(speech);

    // Back / modifica
    if (!emptySpeech && isBackCommand(speech)) {
      resetRetries(session);
      goBack(session);
      promptForStep(vr, session);
      return res.type("text/xml").send(vr.toString());
    }

    switch (session.step) {
      case 1: {
        if (emptySpeech) {
          resetRetries(session);
          gatherSpeech(vr, t("step1_welcome_name.main"));
          break;
        }

        session.name = speech.trim().slice(0, 60);
        resetRetries(session);
        session.step = 2;
        gatherSpeech(vr, t("step2_confirm_name_ask_date.main", { name: session.name }));
        break;
      }

      case 2: {
        if (emptySpeech) {
          if (bumpRetries(session) > 2) {
            sayIt(vr, t("step3_confirm_date_ask_time.error"));
            if (canForwardToHuman()) return res.type("text/xml").send(forwardToHumanTwiml());
            sayIt(vr, "Puoi richiamare più tardi. Grazie.");
            break;
          }
          gatherSpeech(vr, t("step3_confirm_date_ask_time.error"));
          break;
        }

        const dateISO = parseDateIT(speech);
        if (!dateISO) {
          if (bumpRetries(session) > 2) {
            sayIt(vr, t("step3_confirm_date_ask_time.error"));
            if (canForwardToHuman()) return res.type("text/xml").send(forwardToHumanTwiml());
            sayIt(vr, "Puoi richiamare più tardi. Grazie.");
            break;
          }
          gatherSpeech(vr, t("step3_confirm_date_ask_time.error"));
          break;
        }

        session.dateISO = dateISO;
        resetRetries(session);
        session.step = 3;
        gatherSpeech(vr, t("step3_confirm_date_ask_time.main", { dateLabel: session.dateISO }));
        break;
      }

      case 3: {
        if (emptySpeech) {
          if (bumpRetries(session) > 2) {
            sayIt(vr, t("step4_confirm_time_ask_party_size.error"));
            if (canForwardToHuman()) return res.type("text/xml").send(forwardToHumanTwiml());
            sayIt(vr, "Puoi richiamare più tardi. Grazie.");
            break;
          }
          gatherSpeech(vr, t("step4_confirm_time_ask_party_size.error"));
          break;
        }

        const time24 = parseTimeIT(speech);
        if (!time24) {
          if (bumpRetries(session) > 2) {
            sayIt(vr, t("step4_confirm_time_ask_party_size.error"));
            if (canForwardToHuman()) return res.type("text/xml").send(forwardToHumanTwiml());
            sayIt(vr, "Puoi richiamare più tardi. Grazie.");
            break;
          }
          gatherSpeech(vr, t("step4_confirm_time_ask_party_size.error"));
          break;
        }

        session.time24 = time24;

        const { bookingType, autoConfirm } = deriveBookingTypeAndConfirm(session.dateISO, session.time24);
        session.bookingType = bookingType;
        session.autoConfirm = autoConfirm;

        if (bookingType === "closed") {
          sayIt(vr, t("step4_confirm_time_ask_party_size.outsideHours.main"));
          if (canForwardToHuman()) return res.type("text/xml").send(forwardToHumanTwiml());
          sayIt(vr, "Puoi richiamare durante l'orario di apertura. Grazie.");
          break;
        }

        if (bookingType === "operator") {
          // lunedì gestito da operatore
          sayIt(vr, t("step9_fallback_transfer_operator.gentle"));
          if (canForwardToHuman()) return res.type("text/xml").send(forwardToHumanTwiml());
          sayIt(vr, t("step9_fallback_transfer_operator.main"));
          break;
        }

        if (bookingType === "drinks") {
          sayIt(vr, t("step4_confirm_time_ask_party_size.kitchenClosed.main"));
        }

        resetRetries(session);
        session.step = 4;
        gatherSpeech(vr, t("step4_confirm_time_ask_party_size.main", { time: session.time24 }));
        break;
      }

      case 4: {
        if (emptySpeech) {
          if (bumpRetries(session) > 2) {
            sayIt(vr, t("step5_party_size_ask_notes.error"));
            if (canForwardToHuman()) return res.type("text/xml").send(forwardToHumanTwiml());
            sayIt(vr, t("step9_fallback_transfer_operator.main"));
            break;
          }
          gatherSpeech(vr, t("step5_party_size_ask_notes.error"));
          break;
        }

        const people = parsePeopleIT(speech);
        if (!people || people < 1 || people > 18) {
          if (bumpRetries(session) > 2) {
            sayIt(vr, t("step5_party_size_ask_notes.error"));
            if (canForwardToHuman()) return res.type("text/xml").send(forwardToHumanTwiml());
            sayIt(vr, t("step9_fallback_transfer_operator.main"));
            break;
          }
          gatherSpeech(vr, t("step5_party_size_ask_notes.error"));
          break;
        }

        session.people = people;
        resetRetries(session);
        session.step = 5;
        gatherSpeech(vr, t("step5_party_size_ask_notes.main", { partySize: session.people }));
        break;
      }

      case 5: {
        if (emptySpeech) {
          if (bumpRetries(session) > 2) {
            session.specialRequestsRaw = "nessuna";
            resetRetries(session);
            session.step = 6;
            gatherSpeech(
              vr,
              "Vuoi preordinare qualcosa dal menù? Puoi dire: cena, apericena, dopocena, piatto apericena, oppure piatto apericena promo. Se non vuoi, dì nessuno."
            );
            break;
          }
          gatherSpeech(vr, t("step6_collect_notes.error"));
          break;
        }

        session.specialRequestsRaw = speech.trim().slice(0, 200);
        resetRetries(session);
        session.step = 6;
        gatherSpeech(
          vr,
          "Vuoi preordinare qualcosa dal menù? Puoi dire: cena, apericena, dopocena, piatto apericena, oppure piatto apericena promo. Se non vuoi, dì nessuno."
        );
        break;
      }

      case 6: {
        if (emptySpeech) {
          if (bumpRetries(session) > 2) {
            session.preorderChoiceKey = null;
            session.preorderLabel = null;
            resetRetries(session);
            session.step = 8;
            gatherSpeech(vr, "Preferisci sala interna o sala esterna? Ti consiglio l'interno.");
            break;
          }
          gatherSpeech(vr, "Non ho sentito. Di' cena, apericena, dopocena, piatto apericena, piatto apericena promo, oppure nessuno.");
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

        if (!key) {
          session.preorderChoiceKey = null;
          session.preorderLabel = null;
          resetRetries(session);
          session.step = 8;
          gatherSpeech(vr, "Perfetto. Preferisci sala interna o sala esterna? Ti consiglio l'interno.");
          break;
        }

        const opt = getPreorderOptionByKey(key);
        if (!opt) {
          session.preorderChoiceKey = null;
          session.preorderLabel = null;
          resetRetries(session);
          session.step = 8;
          gatherSpeech(vr, "Perfetto. Preferisci sala interna o sala esterna? Ti consiglio l'interno.");
          break;
        }

        if (opt.constraints && opt.constraints.minTime) {
          if (!isTimeAtOrAfter(session.time24, opt.constraints.minTime)) {
            sayIt(vr, t("step4_confirm_time_ask_party_size.afterDinner"));
            resetRetries(session);
            gatherSpeech(vr, "Puoi scegliere: cena, apericena o piatto apericena. Oppure dì nessuno.");
            break;
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
        if (emptySpeech) {
          if (bumpRetries(session) > 2) {
            session.area = "inside";
            resetRetries(session);
            session.step = 10;
            gatherSpeech(vr, t("step7_whatsapp_number.main"));
            break;
          }
          gatherSpeech(vr, "Non ho capito. Preferisci sala interna o sala esterna? Ti consiglio l'interno.");
          break;
        }

        if (session.pendingOutsideConfirm) {
          const area = parseAreaIT(speech);
          const tt = normalizeText(speech);

          if (area === "inside") {
            session.area = "inside";
            session.pendingOutsideConfirm = false;
            resetRetries(session);
            session.step = 10;
            gatherSpeech(vr, t("step7_whatsapp_number.main"));
            break;
          }

          if (area === "outside" || tt.includes("confermo") || tt.includes("va bene esterno")) {
            session.area = "outside";
            session.pendingOutsideConfirm = false;
            resetRetries(session);
            session.step = 10;
            gatherSpeech(vr, t("step7_whatsapp_number.main"));
            break;
          }

          if (bumpRetries(session) > 2) {
            session.area = "inside";
            session.pendingOutsideConfirm = false;
            resetRetries(session);
            session.step = 10;
            gatherSpeech(vr, t("step7_whatsapp_number.main"));
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
            gatherSpeech(vr, t("step7_whatsapp_number.main"));
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
        gatherSpeech(vr, t("step7_whatsapp_number.main"));
        break;
      }

      case 10: {
        // ✅ FIX CRITICO:
        // lo step telefono NON deve mai interrompere il flusso.
        // Dopo 2 tentativi falliti, proseguiamo senza telefono/WA e salviamo comunque su Calendar.

        if (emptySpeech) {
          if (bumpRetries(session) <= 2) {
            gatherSpeech(vr, t("step7_whatsapp_number.error"));
            break;
          }
          session.phone = null;
          session.waTo = null;
          resetRetries(session);
        } else {
          const phone = extractPhoneFromSpeech(speech);

          if (!phone || !isValidPhoneE164(phone)) {
            if (bumpRetries(session) <= 2) {
              gatherSpeech(vr, t("step7_whatsapp_number.spokeTooFast"));
              break;
            }
            session.phone = null;
            session.waTo = null;
            resetRetries(session);
          } else {
            session.phone = phone;
            session.waTo = `whatsapp:${phone}`;
            resetRetries(session);
          }
        }

        // durata
        const d = new Date(`${session.dateISO}T00:00:00`);
        session.durationMinutes = getDurationMinutes(session.people, d);

        const outsideDisclaimer =
          session.area === "outside" ? "Tavolo esterno: in caso di maltempo non è garantito il posto all'interno." : null;

        let preorderPriceText = null;
        if (session.preorderChoiceKey) {
          const opt = getPreorderOptionByKey(session.preorderChoiceKey);
          if (opt && typeof opt.priceEUR === "number") preorderPriceText = `${opt.priceEUR} €`;
        }

        const calendar = getCalendarClient();
        if (!calendar) {
          sayIt(vr, t("step9_fallback_transfer_operator.main"));
          if (canForwardToHuman()) return res.type("text/xml").send(forwardToHumanTwiml());
          sayIt(vr, t("step9_fallback_transfer_operator.short"));
          break;
        }

        // blocco “locale chiuso” + controllo “no promo”
        let isClosed = false;
        let hasNoPromo = false;

        try {
          isClosed = await calendarHasMarkerOnDate(calendar, session.dateISO, "locale chiuso");
          hasNoPromo = await calendarHasMarkerOnDate(calendar, session.dateISO, "no promo");
        } catch (err) {
          console.error("[CALENDAR] marker checks error:", err);
          // se non riesco a controllare, tratto come "no promo" per sicurezza
          isClosed = false;
          hasNoPromo = true;
        }

        if (isClosed) {
          sayIt(vr, t("step9_fallback_transfer_operator.main"));
          if (canForwardToHuman()) return res.type("text/xml").send(forwardToHumanTwiml());
          sayIt(vr, t("step9_fallback_transfer_operator.short"));
          vr.hangup();
          sessions.delete(callSid);
          break;
        }

        const dayOk = isPromoEligibleByDay(session.dateISO);
        session.promoEligible = dayOk && !hasNoPromo;

        // tavoli occupati
        let lockedSet;
        try {
          lockedSet = await getLockedTables(calendar, session.dateISO);
        } catch (err) {
          console.error("[CALENDAR] getLockedTables error:", err);
          sayIt(vr, t("step9_fallback_transfer_operator.main"));
          if (canForwardToHuman()) return res.type("text/xml").send(forwardToHumanTwiml());
          sayIt(vr, t("step9_fallback_transfer_operator.short"));
          break;
        }

        // assegna tavolo (priorità: combaciare pax)
        const chosen = allocateTable({ area: session.area, people: session.people, lockedSet });
        if (!chosen) {
          sayIt(vr, t("step9_fallback_transfer_operator.main"));
          if (canForwardToHuman()) return res.type("text/xml").send(forwardToHumanTwiml());
          sayIt(vr, t("step9_fallback_transfer_operator.short"));
          break;
        }

        session.tableDisplayId = chosen.displayId;
        session.tableLocks = chosen.locks;
        session.tableNotes = chosen.notes || null;

        // crea evento (sempre, anche senza telefono)
        try {
          await createBookingEvent({
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
          sayIt(vr, t("step9_fallback_transfer_operator.main"));
          if (canForwardToHuman()) return res.type("text/xml").send(forwardToHumanTwiml());
          sayIt(vr, t("step9_fallback_transfer_operator.short"));
          break;
        }

        // WhatsApp solo se valido
        if (session.autoConfirm && session.waTo && hasValidWaAddress(session.waTo)) {
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
          }
        }

        // finale voce
        if (session.waTo && hasValidWaAddress(session.waTo)) {
          sayIt(vr, t("step9_success.main"));
        } else {
          // niente testo “whatsapp” dei prompts perché qui non abbiamo WhatsApp
          sayIt(vr, "Perfetto, ho registrato la prenotazione. Se vuoi ricevere la conferma su WhatsApp, puoi richiamare e lasciarmi con calma il numero.");
        }
        sayIt(vr, t("step9_success.goodbye"));

        vr.hangup();
        sessions.delete(callSid);
        break;
      }

      default: {
        sayIt(vr, t("step9_success.goodbye"));
        vr.hangup();
        sessions.delete(callSid);
        break;
      }
    }

    return res.type("text/xml").send(vr.toString());
  } catch (err) {
    console.error("[VOICE] Error:", err);

    if (canForwardToHuman()) {
      return res.type("text/xml").send(forwardToHumanTwiml());
    }

    sayIt(vr, t("step9_fallback_transfer_operator.main"));
    return res.type("text/xml").send(vr.toString());
  }
});

app.get("/", (req, res) => {
  res.send("TuttiBrilli Voice Booking is running. Use POST /voice from Twilio.");
});

app.listen(PORT, () => {
  console.log(`Voice assistant running on port ${PORT}`);
});
