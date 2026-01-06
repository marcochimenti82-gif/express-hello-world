"use strict";

const fs = require("fs");
const path = require("path");

// dotenv opzionale (su Render non serve)
const dotenvModuleDir = path.join(__dirname, "node_modules", "dotenv");
const dotenvPackageJson = path.join(dotenvModuleDir, "package.json");
const dotenvEntryPoint = path.join(dotenvModuleDir, "index.js");
const hasDotenv =
  fs.existsSync(dotenvPackageJson) ||
  fs.existsSync(dotenvEntryPoint) ||
  fs.existsSync(dotenvModuleDir);
if (hasDotenv) {
  require("dotenv").config();
}

const express = require("express");
const twilio = require("twilio");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer");
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
const TWILIO_VOICE_FROM = process.env.TWILIO_VOICE_FROM || "";
const GOOGLE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || "";
const GOOGLE_CALENDAR_TZ = process.env.GOOGLE_CALENDAR_TZ || "Europe/Rome";
const GOOGLE_SERVICE_ACCOUNT_JSON_B64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64 || "";
const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";

const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_SECURE = (process.env.SMTP_SECURE || "false").toLowerCase() === "true";
const FALLBACK_EMAIL_TO = process.env.FALLBACK_EMAIL_TO || "tuttibrillienoteca@gmail.com";
const FALLBACK_EMAIL_FROM = process.env.FALLBACK_EMAIL_FROM || "no-reply@tuttibrilli.local";

const ENABLE_FORWARDING = (process.env.ENABLE_FORWARDING || "false").toLowerCase() === "true";
const HUMAN_FORWARD_TO = process.env.HUMAN_FORWARD_TO || "";
const CRITICAL_COLOR_ID = process.env.CRITICAL_COLOR_ID || "11";

const HOLIDAYS_YYYY_MM_DD = process.env.HOLIDAYS_YYYY_MM_DD || "";
const HOLIDAYS_SET = new Set(HOLIDAYS_YYYY_MM_DD.split(",").map((s) => s.trim()).filter(Boolean));

const twilioClient =
  TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN) : null;

const YES_WORDS = ["si", "sì", "certo", "confermo", "ok", "va bene", "perfetto", "esatto"];
const NO_WORDS = ["no", "non", "annulla", "cancella", "negativo"];
const CANCEL_WORDS = ["annulla", "annullare", "cancella", "modifica"];

// ======================= OPENING HOURS =======================
const OPENING = {
  closedDay: 1, // Monday
  restaurant: {
    default: { start: "18:30", end: "22:30" },
    friSat: { start: "18:30", end: "23:00" },
  },
  drinksOnly: { start: "18:30", end: "24:00" },
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

  { id: "T1F", area: "outside", min: 2, max: 2, notes: "botte con sgabelli" },
  { id: "T2F", area: "outside", min: 2, max: 2, notes: "tavolo alto con sgabelli" },
  { id: "T3F", area: "outside", min: 2, max: 2, notes: "tavolo alto con sgabelli" },
  { id: "T4F", area: "outside", min: 4, max: 5, notes: "divanetti" },
  { id: "T6F", area: "outside", min: 4, max: 4, notes: "divanetti" },
  { id: "T7F", area: "outside", min: 4, max: 4, notes: "divanetti" },
  { id: "T8F", area: "outside", min: 4, max: 4, notes: "divanetti" },
];

const TABLE_COMBINATIONS = [
  { displayId: "T1", area: "inside", replaces: ["T1", "T2"], min: 6, max: 6, notes: "unione T1+T2" },
  { displayId: "T3", area: "inside", replaces: ["T3", "T4"], min: 6, max: 6, notes: "unione T3+T4" },
  { displayId: "T14", area: "inside", replaces: ["T14", "T15"], min: 8, max: 18, notes: "unione T14+T15" },
  { displayId: "T11", area: "inside", replaces: ["T11", "T12"], min: 6, max: 6, notes: "unione T11+T12" },
  { displayId: "T12", area: "inside", replaces: ["T12", "T13"], min: 6, max: 6, notes: "unione T12+T13" },
  { displayId: "T11", area: "inside", replaces: ["T11", "T12", "T13"], min: 8, max: 10, notes: "unione T11+T12+T13" },
  { displayId: "T16", area: "inside", replaces: ["T16", "T17"], min: 8, max: 10, notes: "unione T16+T17" },
  { displayId: "T7F", area: "outside", replaces: ["T7F", "T8F"], min: 6, max: 8, notes: "unione T7F+T8F" },
];

// ======================= XML SAFE TEXT =======================
function xmlEscape(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

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

function sayIt(response, text) {
  response.say({ language: "it-IT" }, xmlEscape(text));
}

function gatherSpeech(response, promptText) {
  const actionUrl = BASE_URL ? `${BASE_URL}/twilio/voice` : "/twilio/voice";
  const gather = response.gather({
    input: "speech",
    language: "it-IT",
    speechTimeout: "auto",
    timeout: 3,
    action: actionUrl,
    method: "POST",
  });
  gather.say({ language: "it-IT" }, xmlEscape(promptText));
  response.redirect({ method: "POST" }, actionUrl);
}

function isValidPhoneE164(s) {
  return /^\+\d{8,15}$/.test(String(s || "").trim());
}
function canForwardToHuman() {
  return ENABLE_FORWARDING && Boolean(HUMAN_FORWARD_TO) && isValidPhoneE164(HUMAN_FORWARD_TO);
}

function requireTwilioVoiceFrom() {
  if (!TWILIO_VOICE_FROM) {
    throw new Error("TWILIO_VOICE_FROM is not set");
  }
  return TWILIO_VOICE_FROM;
}

function forwardToHumanTwiml() {
  const vr = buildTwiml();
  sayIt(vr, t("step9_fallback_transfer_operator.main"));
  vr.dial({}, HUMAN_FORWARD_TO);
  return vr.toString();
}

function buildFallbackEmailPayload(session, req, reason) {
  const caller = req?.body?.From || "";
  const timestamp = new Date().toISOString();
  const state = session?.step || "unknown";
  const data = {
    name: session?.name || "",
    dateISO: session?.dateISO || "",
    time24: session?.time24 || "",
    people: session?.people || "",
    specialRequestsRaw: session?.specialRequestsRaw || "",
    preorderChoiceKey: session?.preorderChoiceKey || "",
    preorderLabel: session?.preorderLabel || "",
    phone: session?.phone || "",
    tableDisplayId: session?.tableDisplayId || "",
    tableLocks: session?.tableLocks || [],
    criticalReservation: session?.criticalReservation || false,
    eventName: session?.eventName || "",
    eventDateISO: session?.eventDateISO || "",
    eventTime24: session?.eventTime24 || "",
  };
  return {
    subject: "Fallback richiesta prenotazione",
    text: [
      `Numero chiamante: ${caller}`,
      `Timestamp: ${timestamp}`,
      `Stato flusso: ${state}`,
      `Motivo fallback: ${reason || "non specificato"}`,
      `Dati raccolti: ${JSON.stringify(data)}`,
    ].join("\n"),
  };
}

async function sendFallbackEmail(session, req, reason) {
  const payload = buildFallbackEmailPayload(session, req, reason);
  try {
    let transporter = null;
    if (SMTP_HOST) {
      transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_SECURE,
        auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
      });
    } else {
      transporter = nodemailer.createTransport({
        sendmail: true,
        newline: "unix",
        path: "/usr/sbin/sendmail",
      });
    }
    await transporter.sendMail({
      from: FALLBACK_EMAIL_FROM,
      to: FALLBACK_EMAIL_TO,
      subject: payload.subject,
      text: payload.text,
    });
  } catch (err) {
    console.error("[EMAIL] Fallback email failed:", err);
  }
}

async function notifyCriticalReservation(phone, summary) {
  if (!twilioClient) return null;
  try {
    const fromNumber = requireTwilioVoiceFrom();
    return await twilioClient.calls.create({
      to: "+393881669661",
      from: fromNumber,
      twiml: new twilio.twiml.VoiceResponse()
        .say({ language: "it-IT" }, xmlEscape(`Prenotazione con criticità. ${summary || ""}`))
        .toString(),
    });
  } catch (err) {
    console.error("[TWILIO] Critical notify failed:", err);
    return null;
  }
}

async function sendCriticalReservationSms(summary) {
  if (!twilioClient) return null;
  try {
    const fromNumber = requireTwilioVoiceFrom();
    return await twilioClient.messages.create({
      to: "+393881669661",
      from: fromNumber,
      body: `Prenotazione con criticità. ${summary || ""}`.trim(),
    });
  } catch (err) {
    console.error("[TWILIO] Critical SMS failed:", err);
    return null;
  }
}

// ======================= SESSION =======================
const sessions = new Map();

function getSession(callSid) {
  if (!callSid) return null;
  if (!sessions.has(callSid)) {
    sessions.set(callSid, {
      step: "intent",
      intent: null,
      intentRetries: 0,
      intentWelcomed: false,
      silenceStep: null,
      silenceRetries: 0,
      retries: 0,
      name: null,
      dateISO: null,
      dateLabel: null,
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
      splitRequired: false,
      outsideRequired: false,
      criticalReservation: false,
      calendarEventId: null,
      tableNotes: null,
      durationMinutes: null,
      divanettiNotice: false,
      divanettiNoticeSpoken: false,
      glutenPiattoNotice: false,
      promoRegistrationNotice: false,
      bookingType: "restaurant",
      autoConfirm: true,
      promoEligible: null,
      eventName: null,
      eventDateISO: null,
      eventTime24: null,
      wantsOutside: false,
      extraRequestsRaw: null,
      liveMusicNoticePending: false,
      liveMusicNoticeSpoken: false,
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
  resetSilence(session);
}

function resetSilence(session) {
  session.silenceStep = null;
  session.silenceRetries = 0;
}

// ======================= TEXT HELPERS =======================
function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseYesNo(speech) {
  const tt = normalizeText(speech);
  if (!tt) return null;
  if (YES_WORDS.some((w) => tt.includes(w))) return true;
  if (NO_WORDS.some((w) => tt.includes(w))) return false;
  return null;
}

function parseCancel(speech) {
  const tt = normalizeText(speech);
  if (!tt) return false;
  return CANCEL_WORDS.some((w) => tt.includes(w));
}

function parsePeopleIT(speech) {
  const tt = normalizeText(speech);
  const digits = tt.match(/\d+/);
  if (digits) {
    const n = Number(digits[0]);
    if (n > 0 && n <= 30) return n;
  }
  const mapping = {
    uno: 1,
    due: 2,
    tre: 3,
    quattro: 4,
    cinque: 5,
    sei: 6,
    sette: 7,
    otto: 8,
    nove: 9,
    dieci: 10,
    undici: 11,
    dodici: 12,
  };
  for (const [word, value] of Object.entries(mapping)) {
    if (tt.includes(word)) return value;
  }
  return null;
}

function parseTimeIT(speech) {
  if (!speech) return null;
  let tt = normalizeText(speech)
    .replace(/\bmezzogiorno\b/g, "12")
    .replace(/\bmezzanotte\b/g, "24");

  const match = tt.match(/\b(\d{1,2})(?:[:\.](\d{2}))?\b/);
  if (!match) return null;

  let hours = Number(match[1]);
  let minutes = match[2] ? Number(match[2]) : 0;

  if (hours >= 0 && hours <= 5 && tt.includes("sera")) hours += 12;
  if (hours >= 0 && hours <= 5 && tt.includes("pomeriggio")) hours += 12;
  if (hours === 12 && tt.includes("notte")) hours = 0;

  if (minutes < 0 || minutes > 59 || hours < 0 || hours > 24) return null;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatDateLabel(dateISO) {
  if (!dateISO) return "";
  const date = new Date(`${dateISO}T00:00:00`);
  return date.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
}

function hasGlutenIntolerance(text) {
  const tt = normalizeText(text);
  return tt.includes("celiaca") || tt.includes("celiaco") || tt.includes("glutine");
}

function isDivanettiTableId(id) {
  return id === "T14" || id === "T15";
}

function isHighTableId(id) {
  return id === "T16" || id === "T17";
}

function isDivanettiPreferred(session) {
  const choice = session?.preorderChoiceKey || "";
  return choice === "apericena" || choice === "dopocena";
}

function getApericenaNoticeTexts(session) {
  const notices = [];
  if (session?.glutenPiattoNotice) {
    notices.push(
      "Ti informo che il piatto apericena e il piatto apericena promo non sono disponibili senza glutine. Il personale di sala potrà consigliarti alternative adatte."
    );
  }
  if (session?.promoRegistrationNotice) {
    notices.push(
      "Se non hai ancora fatto la registrazione online, dovrai completarla in struttura per accedere alla promo."
    );
  }
  return notices;
}

function maybeSayApericenaNotices(vr, session) {
  const notices = getApericenaNoticeTexts(session);
  if (notices.length === 0) return;
  for (const notice of notices) {
    sayIt(vr, notice);
  }
}

function buildSpecialRequestsText(session) {
  const base = session?.specialRequestsRaw || "nessuna";
  const notices = getApericenaNoticeTexts(session);
  const extra = buildExtraRequestsText(session);
  const parts = [base, `Richiesta finale: ${extra}`];
  if (notices.length > 0) {
    parts.push(notices.join(" "));
  }
  return parts.join(" | ");
}

function buildExtraRequestsText(session) {
  const extra = session?.extraRequestsRaw;
  if (!extra) return "nessuna";
  return extra;
}

function parsePhoneNumber(speech) {
  if (!speech) return null;
  if (isValidPhoneE164(speech)) return speech.trim();
  const digits = String(speech).replace(/[^\d]/g, "");
  if (digits.length >= 8 && digits.length <= 15) {
    if (digits.length <= 10) return `+39${digits}`;
    return `+${digits}`;
  }
  return null;
}

function isOutsideRequest(text) {
  const tt = normalizeText(text);
  if (!tt) return false;
  return (
    tt.includes("sala esterna") ||
    tt.includes("esterno") ||
    tt.includes("all'aperto") ||
    tt.includes("fuori") ||
    tt.includes("outdoor")
  );
}

function maybeSayOutsideWarning(vr) {
  sayIt(
    vr,
    "La sala esterna non è coperta: in caso di pioggia o brutto tempo il posto interno non è garantito. Se vuoi, ti consiglio la sala interna."
  );
}

function maybeSayLiveMusicNotice(vr, session) {
  if (!session?.liveMusicNoticePending || session.liveMusicNoticeSpoken) return;
  sayIt(vr, "Ti informo che quella sera è prevista musica live o dj set.");
  session.liveMusicNoticeSpoken = true;
}

// ---- Date: user-friendly (stesso parser robusto, qui versione breve per stabilità)
function parseDateIT(speech) {
  const tt = normalizeText(speech).replace(/[,\.]/g, " ").replace(/\s+/g, " ").trim();
  const today = new Date();

  if (tt.includes("oggi")) return toISODate(today);
  if (tt.includes("domani")) {
    const d = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    return toISODate(d);
  }

  const dmY = tt.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (dmY) {
    let dd = Number(dmY[1]);
    let mm = Number(dmY[2]);
    let yy = dmY[3] ? Number(dmY[3]) : today.getFullYear();
    if (yy < 100) yy += 2000;
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      return toISODate(new Date(yy, mm - 1, dd));
    }
  }

  const m = tt.match(
    /\b(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?:\s+(\d{2,4}))?\b/
  );
  if (m) {
    const months = {
      gennaio: 1,
      febbraio: 2,
      marzo: 3,
      aprile: 4,
      maggio: 5,
      giugno: 6,
      luglio: 7,
      agosto: 8,
      settembre: 9,
      ottobre: 10,
      novembre: 11,
      dicembre: 12,
    };
    const dd = Number(m[1]);
    const mm = months[m[2]];
    let yy = m[3] ? Number(m[3]) : today.getFullYear();
    if (yy < 100) yy += 2000;
    if (dd >= 1 && dd <= 31 && mm) return toISODate(new Date(yy, mm - 1, dd));
  }

  return null;
}

function getGoogleCredentials() {
  if (GOOGLE_SERVICE_ACCOUNT_JSON_B64) {
    try {
      const decoded = Buffer.from(GOOGLE_SERVICE_ACCOUNT_JSON_B64, "base64").toString("utf8");
      return JSON.parse(decoded);
    } catch (err) {
      console.error("[GOOGLE] Invalid base64 credentials:", err);
    }
  }
  if (GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      return JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON);
    } catch (err) {
      console.error("[GOOGLE] Invalid JSON credentials:", err);
    }
  }
  return null;
}

function buildCalendarClient() {
  const credentials = getGoogleCredentials();
  if (!credentials) {
    console.error("[GOOGLE] Missing credentials");
    return null;
  }
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
  return google.calendar({ version: "v3", auth }