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

const EMAIL_PROVIDER = process.env.EMAIL_PROVIDER || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const EMAIL_OPERATOR = process.env.EMAIL_OPERATOR || "";
const EMAIL_FROM = process.env.EMAIL_FROM || "no-reply@tuttibrilli.local";

const ENABLE_FORWARDING = (process.env.ENABLE_FORWARDING || "false").toLowerCase() === "true";
const HUMAN_FORWARD_TO = process.env.HUMAN_FORWARD_TO || "";
const OPERATOR_PHONE = process.env.OPERATOR_PHONE || HUMAN_FORWARD_TO || "";
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
  { id: "T13", area: "inside", min: 2, max: 2 },
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
  { displayId: "T11", area: "inside", replaces: ["T7", "T11", "T12", "T13"], min: 12, max: 12, notes: "unione T7+T11+T12+T13" },
  { displayId: "T16", area: "inside", replaces: ["T16", "T17"], min: 8, max: 11, notes: "unione T16+T17" },
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

// ======================= INFO SHEETS (OPTIONAL) =======================
const SHEETS_CACHE_TTL_MS = 5 * 60 * 1000;
const SHEETS_NAMES = ["INFO", "EVENTI", "MENU", "CONFIG"];
let sheetsCache = {
  expiresAt: 0,
  data: null,
};

function sheetsNormalizeLocale(locale) {
  const raw = String(locale || "").trim().toLowerCase();
  if (!raw) return "it-it";
  return raw;
}

function sheetsToBoolean(value) {
  const raw = String(value || "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "si" || raw === "sì" || raw === "yes";
}

function sheetsParseKeywords(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function sheetsParsePriority(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 9999;
  return parsed;
}

function getSheetsCredentials() {
  const jsonRaw = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON || "";
  const jsonB64 = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON_B64 || "";
  if (jsonB64) {
    try {
      const decoded = Buffer.from(jsonB64, "base64").toString("utf8");
      return JSON.parse(decoded);
    } catch (err) {
      console.error("[SHEETS] Invalid base64 credentials:", err);
    }
  }
  if (jsonRaw) {
    try {
      return JSON.parse(jsonRaw);
    } catch (err) {
      console.error("[SHEETS] Invalid JSON credentials:", err);
    }
  }
  return null;
}

function getSheetsClient() {
  const credentials = getSheetsCredentials();
  if (!credentials) return null;
  try {
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    return google.sheets({ version: "v4", auth });
  } catch (err) {
    console.error("[SHEETS] Failed to create client:", err);
    return null;
  }
}

function resetSheetsCache() {
  sheetsCache = {
    expiresAt: 0,
    data: null,
  };
}

async function fetchSheetValues(sheetsClient, spreadsheetId, sheetName) {
  const range = `${sheetName}!A:Z`;
  const response = await sheetsClient.spreadsheets.values.get({
    spreadsheetId,
    range,
    majorDimension: "ROWS",
  });
  return response?.data?.values || [];
}

function rowsToObjects(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const [headerRow, ...dataRows] = rows;
  const headers = headerRow.map((cell) => String(cell || "").trim());
  return dataRows
    .map((row) => {
      const item = {};
      headers.forEach((header, idx) => {
        if (!header) return;
        item[header] = row[idx];
      });
      return item;
    })
    .filter((item) => Object.keys(item).length > 0);
}

async function loadSheetsData() {
  const now = Date.now();
  if (sheetsCache.data && sheetsCache.expiresAt > now) {
    return sheetsCache.data;
  }

  const spreadsheetId = process.env.GOOGLE_SHEET_ID || "";
  if (!spreadsheetId) return null;

  const sheetsClient = getSheetsClient();
  if (!sheetsClient) return null;

  try {
    const data = {};
    for (const sheetName of SHEETS_NAMES) {
      const rows = await fetchSheetValues(sheetsClient, spreadsheetId, sheetName);
      data[sheetName] = rowsToObjects(rows);
    }
    sheetsCache = {
      expiresAt: now + SHEETS_CACHE_TTL_MS,
      data,
    };
    return data;
  } catch (err) {
    console.error("[SHEETS] Failed to load sheets:", err);
    resetSheetsCache();
    return null;
  }
}

function normalizeInfoRow(row = {}) {
  return {
    locale: sheetsNormalizeLocale(row.locale),
    keywords: sheetsParseKeywords(row.keywords),
    text: String(row.text || "").trim(),
    priority: sheetsParsePriority(row.priority),
    active: sheetsToBoolean(row.attivo),
    fallback: sheetsToBoolean(row.fallback),
  };
}

function findMatchingInfo(rows, speech, locale) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const normalizedLocale = sheetsNormalizeLocale(locale);
  const normalizedSpeech = String(speech || "").trim().toLowerCase();
  if (!normalizedSpeech) return null;

  const candidates = rows.map((row) => normalizeInfoRow(row)).filter((row) => row.active && row.text);
  const localeMatches = candidates.filter((row) => row.locale === normalizedLocale);
  const pool = localeMatches.length > 0 ? localeMatches : candidates;
  const matches = pool.filter((row) =>
    row.keywords.some((keyword) => keyword && normalizedSpeech.includes(keyword))
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => a.priority - b.priority);
  return matches[0];
}

function normalizeFallbackRow(row = {}) {
  return {
    locale: sheetsNormalizeLocale(row.locale),
    fallback: sheetsToBoolean(row.fallback),
    text: String(row.text || "").trim(),
  };
}

function getFallbackEntry(rows, locale) {
  if (!Array.isArray(rows)) return null;
  const normalizedLocale = sheetsNormalizeLocale(locale);
  const normalizedRows = rows.map((row) => normalizeFallbackRow(row));
  const localeMatch = normalizedRows.find((row) => row.locale === normalizedLocale);
  const anyMatch = normalizedRows.find((row) => row.locale);
  const fallback = localeMatch || anyMatch;
  if (!fallback || !fallback.text) return null;
  return fallback;
}

async function getInfoResponse({ speech, locale }) {
  const sheets = await loadSheetsData();
  if (!sheets) return null;
  const infoRows = sheets.INFO || [];
  const matched = findMatchingInfo(infoRows, speech, locale);
  if (matched) {
    return {
      text: matched.text,
      fallback: matched.fallback,
    };
  }
  const configRows = sheets.CONFIG || [];
  const fallback = getFallbackEntry(configRows, locale);
  if (!fallback) return null;
  return {
    text: fallback.text,
    fallback: fallback.fallback,
  };
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
  return ENABLE_FORWARDING && Boolean(OPERATOR_PHONE) && isValidPhoneE164(OPERATOR_PHONE);
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
  vr.dial({}, OPERATOR_PHONE);
  vr.hangup();
  return vr.toString();
}

function buildEmailSessionData(session) {
  return {
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
    intent: session?.intent || "",
    step: session?.step || "unknown",
  };
}

function canSendEmail() {
  return (
    EMAIL_PROVIDER.toLowerCase() === "resend" &&
    Boolean(RESEND_API_KEY) &&
    Boolean(EMAIL_FROM) &&
    Boolean(EMAIL_OPERATOR)
  );
}

async function sendResendEmail({ subject, text }) {
  if (!canSendEmail()) {
    console.error("[EMAIL] Resend configuration missing");
    return;
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [EMAIL_OPERATOR],
        subject,
        text,
      }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error("[EMAIL] Resend send failed:", response.status, errorText);
    }
  } catch (err) {
    console.error("[EMAIL] Resend send failed:", err);
  }
}

function buildFallbackEmailPayload(session, req, reason) {
  const caller = req?.body?.From || "";
  const timestamp = new Date().toISOString();
  const data = buildEmailSessionData(session);
  const phone = data.phone || caller;
  return {
    subject: "Fallback richiesta prenotazione",
    text: [
      `Motivo email: ${reason || "non specificato"}`,
      `Numero cliente: ${phone}`,
      `Timestamp: ${timestamp}`,
      `Dati raccolti: ${JSON.stringify(data)}`,
    ].join("\n"),
  };
}

async function sendFallbackEmail(session, req, reason) {
  const payload = buildFallbackEmailPayload(session, req, reason);
  await sendResendEmail(payload);
}

async function sendFallbackEmailSmtpOnly(session, req, reason) {
  const payload = buildFallbackEmailPayload(session, req, reason);
  await sendResendEmail(payload);
}

function buildOperatorEmailPayload(session, req, reason) {
  const data = buildEmailSessionData(session);
  const caller = data.phone || req?.body?.From || "";
  return {
    subject: "Inoltro operatore - contesto prenotazione",
    text: [
      `Motivo email: ${reason || "non specificato"}`,
      `Numero cliente: ${caller}`,
      `Dati raccolti: ${JSON.stringify(data)}`,
    ].join("\n"),
  };
}

async function sendOperatorEmail(session, req, reason) {
  const payload = buildOperatorEmailPayload(session, req, reason);
  await sendResendEmail(payload);
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
      glutenPiattoNoticeSpoken: false,
      promoRegistrationNoticeSpoken: false,
      outsideWarningSpoken: false,
      forceOperatorFallback: false,
    });
  }
  return sessions.get(callSid);
}

function resetRetries(session) {
  session.retries = 0;
  session.silenceRetries = 0;
}

function trackSilence(session, step) {
  if (session.silenceStep !== step) {
    session.silenceStep = step;
    session.silenceRetries = 0;
  }
  session.silenceRetries += 1;
  return session.silenceRetries;
}

function handleSilence(session, vr, onRetry) {
  const tries = trackSilence(session, session.step);
  if (tries <= 1) {
    onRetry();
    return { action: "retry" };
  }
  if (canForwardToHuman()) {
    return { action: "forward" };
  }
  sayIt(vr, t("step9_fallback_transfer_operator.main"));
  vr.hangup();
  return { action: "hangup" };
}

function goBack(session) {
  if (session.step <= 2) {
    session.step = 1;
    return;
  }
  session.step -= 1;
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[.,!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripAccents(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function isPureConsent(speech) {
  const norm = normalizeText(stripAccents(speech || ""));
  return norm === "si" || norm === "sì" || norm === "ok" || norm === "va bene" || norm === "certo";
}

function parseYesNo(speech) {
  const normalized = normalizeText(stripAccents(speech || ""));
  if (!normalized) return null;
  if (YES_WORDS.some((w) => normalized.includes(w))) return true;
  if (NO_WORDS.some((w) => normalized.includes(w))) return false;
  return null;
}

function parsePartySize(speech) {
  const normalized = normalizeText(stripAccents(speech || ""));
  const numbers = normalized.match(/\d+/g);
  if (numbers && numbers.length > 0) {
    const value = parseInt(numbers[0], 10);
    if (Number.isFinite(value)) return value;
  }
  if (normalized.includes("uno")) return 1;
  if (normalized.includes("una")) return 1;
  if (normalized.includes("due")) return 2;
  if (normalized.includes("tre")) return 3;
  if (normalized.includes("quattro")) return 4;
  if (normalized.includes("cinque")) return 5;
  if (normalized.includes("sei")) return 6;
  if (normalized.includes("sette")) return 7;
  if (normalized.includes("otto")) return 8;
  if (normalized.includes("nove")) return 9;
  if (normalized.includes("dieci")) return 10;
  if (normalized.includes("undici")) return 11;
  if (normalized.includes("dodici")) return 12;
  return null;
}

function parseTimeIT(speech) {
  const normalized = normalizeText(stripAccents(speech || ""));
  const numbers = normalized.match(/\d+/g);
  if (!numbers || numbers.length === 0) return null;
  let hour = parseInt(numbers[0], 10);
  let minute = 0;
  if (numbers.length > 1) {
    minute = parseInt(numbers[1], 10);
  }
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour > 24 || minute > 59) return null;
  if (normalized.includes("mezza")) minute = 30;
  if (normalized.includes("e un quarto")) minute = 15;
  if (normalized.includes("e tre quarti")) minute = 45;
  if (normalized.includes("di mattina") && hour >= 12) hour -= 12;
  if (normalized.includes("del pomeriggio") && hour < 12) hour += 12;
  if (normalized.includes("di sera") && hour < 12) hour += 12;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseDateISO(speech) {
  const normalized = normalizeText(stripAccents(speech || ""));
  const today = new Date();
  const currentYear = today.getFullYear();
  const months = [
    "gennaio",
    "febbraio",
    "marzo",
    "aprile",
    "maggio",
    "giugno",
    "luglio",
    "agosto",
    "settembre",
    "ottobre",
    "novembre",
    "dicembre",
  ];
  let day = null;
  let monthIndex = null;
  const parts = normalized.split(" ");
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    const numeric = parseInt(part, 10);
    if (Number.isFinite(numeric) && numeric > 0 && numeric <= 31 && day === null) {
      day = numeric;
      continue;
    }
    const monthIdx = months.findIndex((m) => part.startsWith(m));
    if (monthIdx !== -1) {
      monthIndex = monthIdx;
    }
  }
  if (normalized.includes("oggi")) {
    day = today.getDate();
    monthIndex = today.getMonth();
  }
  if (normalized.includes("domani")) {
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    day = tomorrow.getDate();
    monthIndex = tomorrow.getMonth();
  }
  if (normalized.includes("dopodomani")) {
    const after = new Date(today);
    after.setDate(today.getDate() + 2);
    day = after.getDate();
    monthIndex = after.getMonth();
  }
  if (day === null || monthIndex === null) return null;
  const resultDate = new Date(currentYear, monthIndex, day);
  if (resultDate < today.setHours(0, 0, 0, 0)) {
    resultDate.setFullYear(currentYear + 1);
  }
  const iso = resultDate.toISOString().slice(0, 10);
  const dateLabel = resultDate.toLocaleDateString("it-IT", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  return { iso, label: dateLabel };
}

function normalizeName(name) {
  if (!name) return "";
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1).toLowerCase())
    .join(" ");
}

function parsePhoneNumber(raw) {
  if (!raw) return null;
  const normalized = String(raw).replace(/[^\d+]/g, "");
  if (!normalized) return null;
  if (normalized.startsWith("+")) {
    if (isValidPhoneE164(normalized)) return normalized;
    return null;
  }
  if (normalized.startsWith("00")) {
    const e164 = `+${normalized.slice(2)}`;
    if (isValidPhoneE164(e164)) return e164;
    return null;
  }
  if (normalized.startsWith("0")) {
    const e164 = `+39${normalized}`;
    if (isValidPhoneE164(e164)) return e164;
  }
  if (normalized.length >= 7) {
    const e164 = `+39${normalized}`;
    if (isValidPhoneE164(e164)) return e164;
  }
  return null;
}

function getTimeMinutes(time24) {
  const [hour, minute] = time24.split(":").map((value) => parseInt(value, 10));
  return hour * 60 + minute;
}

function isTimeBetween(time24, start, end) {
  const value = getTimeMinutes(time24);
  return value >= getTimeMinutes(start) && value <= getTimeMinutes(end);
}

function isOutsideRequest(speech) {
  const normalized = normalizeText(stripAccents(speech || ""));
  return normalized.includes("esterno") || normalized.includes("fuori") || normalized.includes("terrazz");
}

function hasGlutenIntolerance(text) {
  const normalized = normalizeText(stripAccents(text || ""));
  return normalized.includes("celiach") || normalized.includes("glutine");
}

function buildSpecialRequestsText(session) {
  if (!session?.specialRequestsRaw || session.specialRequestsRaw === "nessuna") {
    return "nessuna";
  }
  return session.specialRequestsRaw || "nessuna";
}

function buildExtraRequestsText(session) {
  if (!session?.extraRequestsRaw || session.extraRequestsRaw === "nessuna") {
    return "nessuna";
  }
  return session.extraRequestsRaw || "nessuna";
}

function maybeSayOutsideWarning(vr) {
  if (vr && vr.say && !vr.outsideWarningSpoken) {
    vr.outsideWarningSpoken = true;
    sayIt(
      vr,
      "Ricordo che la sala esterna non è coperta e in caso di maltempo non posso garantire il cambio all'interno."
    );
  }
}

function maybeSayDivanettiNotice(vr, session) {
  if (!session.divanettiNoticeSpoken && session.divanettiNotice) {
    session.divanettiNoticeSpoken = true;
    sayIt(vr, "Ti informo che per i divanetti serve una consumazione minima.");
  }
}

function maybeSayApericenaNotices(vr, session) {
  if (session.glutenPiattoNotice && !session.glutenPiattoNoticeSpoken) {
    session.glutenPiattoNoticeSpoken = true;
    sayIt(vr, "Ti informo che il piatto apericena non è disponibile per celiaci o intolleranti al glutine.");
  }
  if (session.promoRegistrationNotice && !session.promoRegistrationNoticeSpoken) {
    session.promoRegistrationNoticeSpoken = true;
    sayIt(vr, "Per il piatto apericena in promo serve registrazione sul sito.");
  }
}

function maybeSayLiveMusicNotice(vr, session) {
  if (session.liveMusicNoticePending && !session.liveMusicNoticeSpoken) {
    session.liveMusicNoticeSpoken = true;
    sayIt(vr, "Ti informo che è prevista musica dal vivo quella sera.");
  }
}

function isDateClosedByCalendar(events) {
  return events.some((event) => event.summary === "CHIUSO");
}

function hasLiveMusicEvent(events) {
  return events.some((event) => event.summary?.toLowerCase().includes("musica dal vivo"));
}

async function listCalendarEvents(dateISO) {
  if (!GOOGLE_CALENDAR_ID) return [];
  const client = getGoogleCalendarClient();
  if (!client) return [];
  const start = new Date(`${dateISO}T00:00:00`);
  const end = new Date(`${dateISO}T23:59:59`);
  try {
    const result = await client.events.list({
      calendarId: GOOGLE_CALENDAR_ID,
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
    });
    return result?.data?.items || [];
  } catch (err) {
    console.error("[CALENDAR] Failed to list events:", err);
    return [];
  }
}

function getGoogleCalendarClient() {
  const jsonRaw = GOOGLE_SERVICE_ACCOUNT_JSON || "";
  const jsonB64 = GOOGLE_SERVICE_ACCOUNT_JSON_B64 || "";
  let credentials = null;
  if (jsonB64) {
    try {
      const decoded = Buffer.from(jsonB64, "base64").toString("utf8");
      credentials = JSON.parse(decoded);
    } catch (err) {
      console.error("[CALENDAR] Invalid base64 credentials:", err);
    }
  }
  if (!credentials && jsonRaw) {
    try {
      credentials = JSON.parse(jsonRaw);
    } catch (err) {
      console.error("[CALENDAR] Invalid JSON credentials:", err);
    }
  }
  if (!credentials) return null;
  try {
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/calendar"],
    });
    return google.calendar({ version: "v3", auth });
  } catch (err) {
    console.error("[CALENDAR] Failed to create client:", err);
    return null;
  }
}

function calendarGetEventStartDateTime(event) {
  if (!event?.start) return null;
  if (event.start.dateTime) return event.start.dateTime;
  if (event.start.date) return `${event.start.date}T00:00:00`;
  return null;
}

function calendarGetEventEndDateTime(event) {
  if (!event?.end) return null;
  if (event.end.dateTime) return event.end.dateTime;
  if (event.end.date) return `${event.end.date}T23:59:59`;
  return null;
}

function normalizeCalendarEvent(event) {
  const start = calendarGetEventStartDateTime(event);
  const end = calendarGetEventEndDateTime(event);
  if (!start || !end) return null;
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
  const endTime = endDate.toISOString();
  const summary = event.summary || "";
  return {
    summary,
    start: startDate,
    end: endDate,
    endTime,
    id: event.id,
    description: event.description || "",
    location: event.location || "",
    status: event.status || "",
  };
}

function normalizeCalendarEvents(events) {
  return (events || [])
    .map((event) => normalizeCalendarEvent(event))
    .filter((event) => Boolean(event));
}

function isWithinTimeRange(start, end, time24) {
  const minutes = getTimeMinutes(time24);
  const startMinutes = getTimeMinutes(start);
  const endMinutes = getTimeMinutes(end);
  return minutes >= startMinutes && minutes <= endMinutes;
}

function isRestaurantOpenAt(dateISO, time24) {
  const date = new Date(`${dateISO}T00:00:00`);
  const day = date.getDay();
  if (day === OPENING.closedDay) return false;
  const isFriSat = day === 5 || day === 6;
  const hours = isFriSat ? OPENING.restaurant.friSat : OPENING.restaurant.default;
  return isWithinTimeRange(hours.start, hours.end, time24);
}

function isDrinksOnlyTime(time24) {
  return isWithinTimeRange(OPENING.drinksOnly.start, OPENING.drinksOnly.end, time24);
}

function isMusicNight(dateISO) {
  const date = new Date(`${dateISO}T00:00:00`);
  const day = date.getDay();
  return OPENING.musicNights.days.includes(day);
}

function matchTablesForParty(partySize, prefersOutside) {
  return TABLES.filter((table) => {
    if (prefersOutside && table.area !== "outside") return false;
    if (!prefersOutside && table.area !== "inside") return false;
    return partySize >= table.min && partySize <= table.max;
  });
}

function matchCombinedTablesForParty(partySize, prefersOutside) {
  return TABLE_COMBINATIONS.filter((combo) => {
    if (prefersOutside && combo.area !== "outside") return false;
    if (!prefersOutside && combo.area !== "inside") return false;
    return partySize >= combo.min && partySize <= combo.max;
  });
}

function isTableAvailable(occupiedTables, tableId) {
  return !occupiedTables.has(tableId);
}

function buildTableNotes(table) {
  if (table?.notes) return table.notes;
  return "";
}

function getTableLocksForCombination(combo) {
  return combo.replaces ? combo.replaces : [];
}

function findAvailableTable(tables, occupiedTables) {
  return tables.find((table) => isTableAvailable(occupiedTables, table.id)) || null;
}

function findAvailableCombination(combos, occupiedTables) {
  return combos.find((combo) => combo.replaces.every((id) => isTableAvailable(occupiedTables, id))) || null;
}

function getOccupiedTables(events, dateISO, time24) {
  const normalizedEvents = normalizeCalendarEvents(events);
  const occupied = new Set();
  const targetDateTime = new Date(`${dateISO}T${time24}:00`);
  normalizedEvents.forEach((event) => {
    const starts = event.start;
    const ends = event.end;
    if (targetDateTime >= starts && targetDateTime <= ends) {
      const summary = event.summary || "";
      const matches = summary.match(/\bT\d+F?\b/g);
      if (matches) {
        matches.forEach((match) => occupied.add(match));
      }
    }
  });
  return occupied;
}

function shouldUseSplitTables(partySize) {
  return partySize >= 8;
}

function reserveTableFromAvailability(availability) {
  if (availability.selectedTable) {
    return {
      displayId: availability.selectedTable.id,
      tableLocks: [],
      notes: buildTableNotes(availability.selectedTable),
      splitRequired: false,
      outsideRequired: availability.prefersOutside,
      critical: false,
    };
  }
  if (availability.selectedCombo) {
    return {
      displayId: availability.selectedCombo.displayId,
      tableLocks: getTableLocksForCombination(availability.selectedCombo),
      notes: availability.selectedCombo.notes || "",
      splitRequired: false,
      outsideRequired: availability.prefersOutside,
      critical: false,
    };
  }
  return null;
}

function selectTableForSession(session, events) {
  const partySize = session.people;
  const prefersOutside = session.wantsOutside;
  const occupiedTables = getOccupiedTables(events, session.dateISO, session.time24);
  const candidates = matchTablesForParty(partySize, prefersOutside);
  const combos = matchCombinedTablesForParty(partySize, prefersOutside);

  const selectedTable = findAvailableTable(candidates, occupiedTables);
  if (selectedTable) {
    return {
      status: "available",
      selectedTable,
      selectedCombo: null,
      prefersOutside,
      needsSplit: false,
    };
  }

  const selectedCombo = findAvailableCombination(combos, occupiedTables);
  if (selectedCombo) {
    return {
      status: "available",
      selectedTable: null,
      selectedCombo,
      prefersOutside,
      needsSplit: false,
    };
  }

  if (!prefersOutside) {
    const outsideCandidates = matchTablesForParty(partySize, true);
    const outsideCombos = matchCombinedTablesForParty(partySize, true);
    const outsideTable = findAvailableTable(outsideCandidates, occupiedTables);
    if (outsideTable) {
      return {
        status: "needs_outside",
        selectedTable: outsideTable,
        selectedCombo: null,
        prefersOutside: true,
        needsSplit: false,
      };
    }
    const outsideCombo = findAvailableCombination(outsideCombos, occupiedTables);
    if (outsideCombo) {
      return {
        status: "needs_outside",
        selectedTable: null,
        selectedCombo: outsideCombo,
        prefersOutside: true,
        needsSplit: false,
      };
    }
  }

  if (shouldUseSplitTables(partySize)) {
    return {
      status: "needs_split",
      selectedTable: null,
      selectedCombo: null,
      prefersOutside,
      needsSplit: true,
    };
  }

  return {
    status: "unavailable",
    selectedTable: null,
    selectedCombo: null,
    prefersOutside,
    needsSplit: false,
  };
}

async function reserveTableForSession(session, { commit }) {
  if (!session.dateISO || !session.time24 || !session.people) {
    return { status: "missing" };
  }
  if (!isRestaurantOpenAt(session.dateISO, session.time24)) {
    if (isDrinksOnlyTime(session.time24)) {
      session.bookingType = "drinksOnly";
    } else {
      return { status: "closed" };
    }
  }
  const events = await listCalendarEvents(session.dateISO);
  if (isDateClosedByCalendar(events)) {
    return { status: "closed" };
  }
  const availability = selectTableForSession(session, events);
  if (availability.status === "available") {
    if (commit) {
      const reservation = reserveTableFromAvailability(availability);
      session.tableDisplayId = reservation.displayId;
      session.tableLocks = reservation.tableLocks;
      session.tableNotes = reservation.notes;
      session.splitRequired = reservation.splitRequired;
      session.outsideRequired = reservation.outsideRequired;
    }
    return { status: "available" };
  }
  if (availability.status === "needs_split") {
    session.splitRequired = true;
    return { status: "needs_split" };
  }
  if (availability.status === "needs_outside") {
    session.outsideRequired = true;
    if (commit) {
      const reservation = reserveTableFromAvailability(availability);
      session.tableDisplayId = reservation.displayId;
      session.tableLocks = reservation.tableLocks;
      session.tableNotes = reservation.notes;
      session.splitRequired = reservation.splitRequired;
      session.outsideRequired = reservation.outsideRequired;
    }
    return { status: "needs_outside" };
  }
  return { status: "unavailable" };
}

function buildCalendarEventDescription(session) {
  const lines = [];
  if (session.name) lines.push(`Nome: ${session.name}`);
  if (session.people) lines.push(`Persone: ${session.people}`);
  if (session.time24) lines.push(`Ora: ${session.time24}`);
  if (session.specialRequestsRaw) lines.push(`Richieste: ${buildSpecialRequestsText(session)}`);
  if (session.preorderLabel) lines.push(`Preordine: ${session.preorderLabel}`);
  if (session.phone) lines.push(`Telefono: ${session.phone}`);
  if (session.extraRequestsRaw) lines.push(`Richieste extra: ${buildExtraRequestsText(session)}`);
  if (session.tableLocks && session.tableLocks.length > 0) {
    lines.push(`Tavoli bloccati: ${session.tableLocks.join(", ")}`);
  }
  if (session.tableNotes) lines.push(`Note tavolo: ${session.tableNotes}`);
  if (session.bookingType === "drinksOnly") lines.push("Tipo: Dopocena");
  if (session.bookingType === "event") lines.push(`Evento: ${session.eventName || ""}`);
  if (session.criticalReservation) lines.push("Criticità: sì");
  return lines.join("\n");
}

function buildCalendarEventSummary(session) {
  const name = session.name || "Cliente";
  const people = session.people || "?";
  const table = session.tableDisplayId ? `Tavolo ${session.tableDisplayId}` : "Tavolo";
  const bookingType = session.bookingType === "drinksOnly" ? "Dopocena" : "Cena";
  if (session.bookingType === "event") {
    return `${session.eventName || "Evento"} - ${name} (${people})`;
  }
  return `${bookingType} - ${table} - ${name} (${people})`;
}

function buildCalendarEventStart(session) {
  const dateIso = session.dateISO;
  const time = session.time24 || "00:00";
  return `${dateIso}T${time}:00`;
}

function buildCalendarEventEnd(session) {
  const start = new Date(buildCalendarEventStart(session));
  const durationMinutes = session.durationMinutes || 150;
  const end = new Date(start);
  end.setMinutes(start.getMinutes() + durationMinutes);
  return end.toISOString();
}

async function createCalendarEvent(session) {
  if (!GOOGLE_CALENDAR_ID) return null;
  const client = getGoogleCalendarClient();
  if (!client) return null;
  const start = buildCalendarEventStart(session);
  const end = buildCalendarEventEnd(session);
  if (!session.tableDisplayId) {
    await reserveTableForSession(session, { commit: true });
  }
  const description = buildCalendarEventDescription(session);
  const summary = buildCalendarEventSummary(session);
  try {
    const response = await client.events.insert({
      calendarId: GOOGLE_CALENDAR_ID,
      requestBody: {
        summary,
        description,
        start: { dateTime: start, timeZone: GOOGLE_CALENDAR_TZ },
        end: { dateTime: end, timeZone: GOOGLE_CALENDAR_TZ },
        location: session.tableDisplayId ? `Tavolo ${session.tableDisplayId}` : undefined,
      },
    });
    session.calendarEventId = response?.data?.id || null;
    return response?.data || null;
  } catch (err) {
    console.error("[CALENDAR] Failed to create event:", err);
    return null;
  }
}

async function getEventsForDay(dateISO) {
  return await listCalendarEvents(dateISO);
}

function findEventByName(events, name) {
  const normalized = normalizeText(stripAccents(name || ""));
  if (!normalized) return null;
  return events.find((event) =>
    normalizeText(stripAccents(event.summary || "")).includes(normalized)
  );
}

function getEventConfigForName(events, name) {
  const event = findEventByName(events, name);
  if (!event) return null;
  const description = event.description || "";
  const durationMatch = description.match(/durata=(\d+)/i);
  const bookingTypeMatch = description.match(/tipo=(\w+)/i);
  const priceMatch = description.match(/prezzo=([\d.]+)/i);
  const durationMinutes = durationMatch ? parseInt(durationMatch[1], 10) : null;
  const bookingType = bookingTypeMatch ? bookingTypeMatch[1] : null;
  const priceEUR = priceMatch ? parseFloat(priceMatch[1]) : null;
  return {
    event,
    durationMinutes,
    bookingType,
    priceEUR,
  };
}

async function buildEventOptions(dateISO) {
  const events = await getEventsForDay(dateISO);
  const normalized = normalizeCalendarEvents(events);
  const options = normalized
    .filter((event) => event.summary && event.summary.toLowerCase() !== "chiuso")
    .map((event) => event.summary);
  return options;
}

function buildEventOptionsText(options) {
  if (!options || options.length === 0) return "Nessun evento disponibile.";
  return `Eventi disponibili: ${options.join(", ")}.`;
}

function parseEventNameFromSpeech(speech, options) {
  const normalized = normalizeText(stripAccents(speech || ""));
  const match = options.find((option) => normalized.includes(normalizeText(stripAccents(option))));
  if (match) return match;
  return null;
}

async function askEventName(vr, session) {
  session.step = "event_name";
  const options = await buildEventOptions(session.dateISO);
  if (!options || options.length === 0) {
    session.step = 1;
    gatherSpeech(vr, "Mi dispiace, non ci sono eventi disponibili per quella data.");
    return;
  }
  const optionsText = buildEventOptionsText(options);
  gatherSpeech(vr, `Quale evento vuoi prenotare? ${optionsText}`);
}

async function askEventDate(vr, session) {
  session.step = "event_date";
  gatherSpeech(vr, "Per quale data vuoi prenotare l'evento?");
}

async function askEventTime(vr, session) {
  session.step = "event_time";
  gatherSpeech(vr, "A che ora vuoi prenotare?");
}

async function handleEventRequest(req, res, session, vr, speech, emptySpeech) {
  switch (session.step) {
    case "event_name": {
      if (emptySpeech) {
        const silenceResult = handleSilence(session, vr, () =>
          gatherSpeech(vr, "Non ho sentito il nome dell'evento. Puoi ripetere?")
        );
        if (silenceResult.action === "forward") {
          await sendFallbackEmail(session, req, "silence_event_name");
          void sendOperatorEmail(session, req, "silence_event_name");
          res.set("Content-Type", "text/xml; charset=utf-8");
          return res.send(forwardToHumanTwiml());
        }
        break;
      }
      const events = await getEventsForDay(session.dateISO);
      const options = events.map((event) => event.summary || "");
      const match = parseEventNameFromSpeech(speech, options);
      if (!match) {
        gatherSpeech(vr, "Non ho trovato l'evento. Puoi ripetere il nome?");
        break;
      }
      const config = getEventConfigForName(events, match);
      session.eventName = match;
      session.durationMinutes = config?.durationMinutes || null;
      session.bookingType = config?.bookingType || "event";
      resetRetries(session);
      await askEventTime(vr, session);
      break;
    }
    case "event_date": {
      if (emptySpeech) {
        const silenceResult = handleSilence(session, vr, () =>
          gatherSpeech(vr, "Non ho sentito la data. Puoi ripetere?")
        );
        if (silenceResult.action === "forward") {
          await sendFallbackEmail(session, req, "silence_event_date");
          void sendOperatorEmail(session, req, "silence_event_date");
          res.set("Content-Type", "text/xml; charset=utf-8");
          return res.send(forwardToHumanTwiml());
        }
        break;
      }
      const parsed = parseDateISO(speech);
      if (!parsed) {
        gatherSpeech(vr, "Non ho capito la data. Puoi ripetere?");
        break;
      }
      session.dateISO = parsed.iso;
      session.dateLabel = parsed.label;
      resetRetries(session);
      await askEventName(vr, session);
      break;
    }
    case "event_time": {
      if (emptySpeech) {
        const silenceResult = handleSilence(session, vr, () =>
          gatherSpeech(vr, "Non ho sentito l'orario. Puoi ripetere?")
        );
        if (silenceResult.action === "forward") {
          await sendFallbackEmail(session, req, "silence_event_time");
          void sendOperatorEmail(session, req, "silence_event_time");
          res.set("Content-Type", "text/xml; charset=utf-8");
          return res.send(forwardToHumanTwiml());
        }
        break;
      }
      const time24 = parseTimeIT(speech);
      if (!time24) {
        gatherSpeech(vr, "Non ho capito l'orario. Puoi ripetere?");
        break;
      }
      session.time24 = time24;
      const availability = await reserveTableForSession(session, { commit: false });
      if (availability.status === "closed") {
        session.step = 1;
        gatherSpeech(vr, "Mi dispiace, il locale risulta chiuso quel giorno. Vuoi scegliere un'altra data?");
        break;
      }
      if (availability.status === "unavailable") {
        session.step = 1;
        gatherSpeech(vr, "Mi dispiace, non ci sono tavoli disponibili a quell'orario.");
        break;
      }
      const calendarEvent = await createCalendarEvent(session);
      if (!calendarEvent) {
        await sendFallbackEmail(session, req, "event_calendar_failed");
      }
      session.step = 1;
      sayIt(vr, "Prenotazione evento confermata. Ti aspettiamo.");
      vr.hangup();
      res.set("Content-Type", "text/xml; charset=utf-8");
      await sendFallbackEmail(session, req, "event_request_completed");
      return res.send(vr.toString());
    }
    default:
      break;
  }
  res.set("Content-Type", "text/xml; charset=utf-8");
  return res.send(vr.toString());
}

function promptForStep(vr, session) {
  switch (session.step) {
    case 1:
      gatherSpeech(vr, t("step1_welcome_name.short"));
      break;
    case 2:
      gatherSpeech(vr, t("step2_ask_date.main"));
      break;
    case 3:
      gatherSpeech(vr, t("step3_confirm_date_ask_time.main", { dateLabel: session.dateLabel }));
      break;
    case 4:
      gatherSpeech(vr, t("step4_confirm_time_ask_party_size.main"));
      break;
    case 5:
      gatherSpeech(vr, t("step5_party_size_ask_notes.main", { partySize: session.people }));
      break;
    case 6:
      gatherSpeech(
        vr,
        "Vuoi preordinare qualcosa dal menù? Puoi dire: cena, apericena, dopocena, piatto apericena, oppure piatto apericena promo. Se non vuoi, dì nessuno."
      );
      break;
    case 7:
      gatherSpeech(vr, "Posso sistemarvi in tavoli separati? Se preferisci, ti passo un operatore.");
      break;
    case 8:
      gatherSpeech(vr, "Perfetto. Mi lasci un numero di telefono? Se è italiano, aggiungo io il +39.");
      break;
    case 9:
      gatherSpeech(vr, "Hai altre richieste particolari? Ad esempio sala esterna.");
      break;
    case 10:
      gatherSpeech(
        vr,
        t("step8_summary_confirm.short", {
          dateLabel: session.dateLabel || "",
          time: session.time24 || "",
          partySize: session.people || "",
        })
      );
      break;
    case "event_date":
      gatherSpeech(vr, "Per quale data vuoi prenotare l'evento?");
      break;
    case "event_name":
      gatherSpeech(vr, "Quale evento vuoi prenotare?");
      break;
    case "event_time":
      gatherSpeech(vr, "A che ora vuoi prenotare?");
      break;
    default:
      gatherSpeech(vr, t("step1_welcome_name.short"));
      break;
  }
}

async function handleVoiceRequest(req, res) {
  const vr = buildTwiml();
  let session = null;
  try {
    const callSid = req.body.CallSid || req.body.callSid;
    session = getSession(callSid);
    if (!session) {
      console.error("[VOICE] Missing session");
      await sendFallbackEmail(session, req, "session_error");
      res.set("Content-Type", "text/xml; charset=utf-8");
      return res.send(vr.toString());
    }

    const speech = req.body.SpeechResult || "";
    const emptySpeech = !speech || !speech.trim();

    if (session.intent === "operator") {
      if (canForwardToHuman()) {
        await sendFallbackEmail(session, req, "operator_request");
        res.set("Content-Type", "text/xml; charset=utf-8");
        return res.send(forwardToHumanTwiml());
      }
      sayIt(vr, t("step9_fallback_transfer_operator.main"));
      vr.hangup();
      res.set("Content-Type", "text/xml; charset=utf-8");
      return res.send(vr.toString());
    }

    if (session.intent === "cancel") {
      if (canForwardToHuman()) {
        await sendFallbackEmail(session, req, "cancel_request_forward");
        res.set("Content-Type", "text/xml; charset=utf-8");
        return res.send(forwardToHumanTwiml());
      }
      sayIt(vr, t("step9_fallback_transfer_operator.main"));
      vr.hangup();
      res.set("Content-Type", "text/xml; charset=utf-8");
      return res.send(vr.toString());
    }

    if (session.intent === "info") {
      const infoResponse = await getInfoResponse({
        speech,
        locale: req.body?.FromCountry || "it-it",
      });
      if (infoResponse?.text) {
        sayIt(vr, infoResponse.text);
      } else {
        sayIt(vr, t("step9_fallback_transfer_operator.main"));
      }
      vr.hangup();
      res.set("Content-Type", "text/xml; charset=utf-8");
      await sendFallbackEmail(session, req, "info_request");
      return res.send(vr.toString());
    }

    if (session.intent === "event") {
      return await handleEventRequest(req, res, session, vr, speech, emptySpeech);
    }

    switch (session.step) {
      case "intent": {
        if (!session.intentWelcomed) {
          session.intentWelcomed = true;
          gatherSpeech(vr, t("step1_welcome_name.short"));
          break;
        }
        if (emptySpeech) {
          const silenceResult = handleSilence(session, vr, () =>
            gatherSpeech(vr, t("step1_welcome_name.short"))
          );
          if (silenceResult.action === "forward") {
            await sendFallbackEmail(session, req, "silence_step1");
            void sendOperatorEmail(session, req, "silence_step1");
            res.set("Content-Type", "text/xml; charset=utf-8");
            return res.send(forwardToHumanTwiml());
          }
          break;
        }
        const normalized = normalizeText(stripAccents(speech));
        if (normalized.includes("operatore")) {
          session.intent = "operator";
          if (canForwardToHuman()) {
            await sendFallbackEmail(session, req, "operator_request");
            res.set("Content-Type", "text/xml; charset=utf-8");
            return res.send(forwardToHumanTwiml());
          }
          sayIt(vr, t("step9_fallback_transfer_operator.main"));
          vr.hangup();
          res.set("Content-Type", "text/xml; charset=utf-8");
          return res.send(vr.toString());
        }
        if (normalized.includes("annulla") || normalized.includes("cancella")) {
          session.intent = "cancel";
          if (canForwardToHuman()) {
            await sendFallbackEmail(session, req, "cancel_request_forward");
            res.set("Content-Type", "text/xml; charset=utf-8");
            return res.send(forwardToHumanTwiml());
          }
          sayIt(vr, t("step9_fallback_transfer_operator.main"));
          vr.hangup();
          res.set("Content-Type", "text/xml; charset=utf-8");
          return res.send(vr.toString());
        }
        if (normalized.includes("informazioni") || normalized.includes("info")) {
          session.intent = "info";
          const infoResponse = await getInfoResponse({
            speech,
            locale: req.body?.FromCountry || "it-it",
          });
          if (infoResponse?.text) {
            sayIt(vr, infoResponse.text);
          } else {
            sayIt(vr, t("step9_fallback_transfer_operator.main"));
          }
          vr.hangup();
          res.set("Content-Type", "text/xml; charset=utf-8");
          await sendFallbackEmail(session, req, "info_request");
          return res.send(vr.toString());
        }
        if (normalized.includes("evento")) {
          session.intent = "event";
          session.step = "event_date";
          await askEventDate(vr, session);
          break;
        }
        session.intent = "booking";
        session.step = 1;
        gatherSpeech(vr, t("step1_welcome_name.short"));
        break;
      }

      case 1: {
        if (emptySpeech) {
          const silenceResult = handleSilence(session, vr, () =>
            gatherSpeech(vr, t("step1_welcome_name.short"))
          );
          if (silenceResult.action === "forward") {
            await sendFallbackEmail(session, req, "silence_step1");
            void sendOperatorEmail(session, req, "silence_step1");
            res.set("Content-Type", "text/xml; charset=utf-8");
            return res.send(forwardToHumanTwiml());
          }
          break;
        }
        const name = normalizeName(speech);
        session.name = name;
        resetRetries(session);
        session.step = 2;
        gatherSpeech(vr, t("step2_ask_date.main"));
        break;
      }

      case 2: {
        if (emptySpeech) {
          const silenceResult = handleSilence(session, vr, () =>
            gatherSpeech(vr, t("step2_ask_date.main"))
          );
          if (silenceResult.action === "forward") {
            await sendFallbackEmail(session, req, "silence_step2");
            void sendOperatorEmail(session, req, "silence_step2");
            res.set("Content-Type", "text/xml; charset=utf-8");
            return res.send(forwardToHumanTwiml());
          }
          break;
        }
        const parsed = parseDateISO(speech);
        if (!parsed) {
          gatherSpeech(vr, t("step2_ask_date.error"));
          break;
        }
        session.dateISO = parsed.iso;
        session.dateLabel = parsed.label;
        resetRetries(session);
        session.step = 3;
        gatherSpeech(vr, t("step3_confirm_date_ask_time.main", { dateLabel: session.dateLabel }));
        break;
      }

      case 3: {
        if (emptySpeech) {
          const silenceResult = handleSilence(session, vr, () =>
            gatherSpeech(vr, t("step3_confirm_date_ask_time.main", { dateLabel: session.dateLabel }))
          );
          if (silenceResult.action === "forward") {
            await sendFallbackEmail(session, req, "silence_step3");
            void sendOperatorEmail(session, req, "silence_step3");
            res.set("Content-Type", "text/xml; charset=utf-8");
            return res.send(forwardToHumanTwiml());
          }
          break;
        }
        const time24 = parseTimeIT(speech);
        if (!time24) {
          gatherSpeech(vr, t("step3_confirm_date_ask_time.error"));
          break;
        }
        session.time24 = time24;
        resetRetries(session);
        session.step = 4;
        gatherSpeech(vr, t("step4_confirm_time_ask_party_size.main"));
        break;
      }

      case 4: {
        if (emptySpeech) {
          const silenceResult = handleSilence(session, vr, () =>
            gatherSpeech(vr, t("step4_confirm_time_ask_party_size.error"))
          );
          if (silenceResult.action === "forward") {
            await sendFallbackEmail(session, req, "silence_step4");
            void sendOperatorEmail(session, req, "silence_step4");
            res.set("Content-Type", "text/xml; charset=utf-8");
            return res.send(forwardToHumanTwiml());
          }
          break;
        }
        const people = parsePartySize(speech);
        if (!people || people < 1 || people > 18) {
          gatherSpeech(vr, t("step5_party_size_ask_notes.error"));
          break;
        }
        session.people = people;
        const events = await listCalendarEvents(session.dateISO);
        const date = new Date(`${session.dateISO}T00:00:00`);
        const isHoliday = HOLIDAYS_SET.has(session.dateISO);
        const isClosedDay = date.getDay() === OPENING.closedDay;
        if (isHoliday || isClosedDay || isDateClosedByCalendar(events)) {
          session.step = 2;
          gatherSpeech(vr, "Mi dispiace, il locale risulta chiuso quel giorno. Vuoi scegliere un'altra data?");
          break;
        }
        session.liveMusicNoticePending = hasLiveMusicEvent(events);
        session.liveMusicNoticeSpoken = false;
        resetRetries(session);
        session.step = 4;
        gatherSpeech(vr, t("step3_confirm_date_ask_time.main", { dateLabel: session.dateLabel }));
        break;
      }

      case 4: {
        if (emptySpeech) {
          const silenceResult = handleSilence(session, vr, () =>
            gatherSpeech(vr, t("step4_confirm_time_ask_party_size.error"))
          );
          if (silenceResult.action === "forward") {
            await sendFallbackEmail(session, req, "silence_step4");
            void sendOperatorEmail(session, req, "silence_step4");
            res.set("Content-Type", "text/xml; charset=utf-8");
            return res.send(forwardToHumanTwiml());
          }
          break;
        }
        const time24 = parseTimeIT(speech);
        if (!time24) {
          gatherSpeech(vr, t("step4_confirm_time_ask_party_size.error"));
          break;
        }
        session.time24 = time24;
        resetRetries(session);
        session.step = 5;
        gatherSpeech(vr, t("step5_party_size_ask_notes.main", { partySize: session.people }));
        break;
      }

      case 5: {
        if (emptySpeech) {
          const silenceResult = handleSilence(session, vr, () =>
            gatherSpeech(vr, t("step5_party_size_ask_notes.main", { partySize: session.people }))
          );
          if (silenceResult.action === "forward") {
            await sendFallbackEmail(session, req, "silence_step5");
            void sendOperatorEmail(session, req, "silence_step5");
            res.set("Content-Type", "text/xml; charset=utf-8");
            return res.send(forwardToHumanTwiml());
          }
          break;
        }
        if (isPureConsent(speech)) {
          gatherSpeech(vr, "Quali? Dimmi pure le intolleranze o la richiesta.");
          break;
        }
        session.specialRequestsRaw = emptySpeech ? "nessuna" : speech.trim().slice(0, 200);
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
          const silenceResult = handleSilence(session, vr, () => promptForStep(vr, session));
          if (silenceResult.action === "forward") {
            await sendFallbackEmail(session, req, "silence_step6");
            void sendOperatorEmail(session, req, "silence_step6");
            res.set("Content-Type", "text/xml; charset=utf-8");
            return res.send(forwardToHumanTwiml());
          }
          break;
        }
        const normalized = normalizeText(speech);
        const glutenIntolerance = hasGlutenIntolerance(session.specialRequestsRaw);
        const isFriday = session.dateISO ? new Date(`${session.dateISO}T00:00:00`).getDay() === 5 : false;
        session.glutenPiattoNotice = false;
        session.promoRegistrationNotice = false;
        if (normalized.includes("nessuno") || normalized.includes("niente") || normalized.includes("no")) {
          session.preorderChoiceKey = null;
          session.preorderLabel = "nessuno";
        } else {
          if (normalized.includes("apericena promo")) {
            const promoOption = getPreorderOptionByKey("piatto_apericena_promo");
            if (isFriday) {
              gatherSpeech(
                vr,
                "L’apericena promo non è disponibile il venerdì. Puoi scegliere l’apericena standard oppure un altro piatto."
              );
              break;
            }
            session.preorderChoiceKey = promoOption?.key || "piatto_apericena_promo";
            session.preorderLabel = promoOption?.label || "Piatto Apericena in promo (previa registrazione)";
            session.promoRegistrationNotice = true;
            if (glutenIntolerance) {
              session.glutenPiattoNotice = true;
            }
            maybeSayApericenaNotices(vr, session);
          } else if (normalized.includes("apericena")) {
            if (glutenIntolerance) {
              gatherSpeech(
                vr,
                "L’apericena non è disponibile per celiaci o intolleranti al glutine. Puoi scegliere un’alternativa."
              );
              break;
            }
            const option = getPreorderOptionByKey("apericena");
            session.preorderChoiceKey = option?.key || "apericena";
            session.preorderLabel = option?.label || "Apericena";
          } else {
            const option = PREORDER_OPTIONS.find(
              (o) => normalized.includes(o.label.toLowerCase()) || normalized.includes(o.key.replace(/_/g, " "))
            );
            if (option) {
              session.preorderChoiceKey = option.key;
              session.preorderLabel = option.label;
              let shouldSayNotice = false;
              if ((option.key === "piatto_apericena" || option.key === "piatto_apericena_promo") && glutenIntolerance) {
                session.glutenPiattoNotice = true;
                shouldSayNotice = true;
              }
              if (option.key === "piatto_apericena_promo") {
                session.promoRegistrationNotice = true;
                shouldSayNotice = true;
              }
              if (shouldSayNotice) {
                maybeSayApericenaNotices(vr, session);
              }
            } else {
              gatherSpeech(
                vr,
                "Non ho capito il preordine. Puoi dire: cena, apericena, dopocena, piatto apericena, oppure piatto apericena promo. Se non vuoi, dì nessuno."
              );
              break;
            }
          }
        }
        const availability = await reserveTableForSession(session, { commit: false });
        if (availability.status === "closed") {
          session.step = 2;
          gatherSpeech(vr, "Mi dispiace, risulta che quel giorno il locale è chiuso. Vuoi scegliere un'altra data?");
          break;
        }
        if (availability.status === "unavailable") {
          if (session.forceOperatorFallback && canForwardToHuman()) {
            await sendFallbackEmail(session, req, "invalid_table_combo");
            void sendOperatorEmail(session, req, "invalid_table_combo");
            res.set("Content-Type", "text/xml; charset=utf-8");
            return res.send(forwardToHumanTwiml());
          }
          if (session.forceOperatorFallback) {
            sayIt(vr, t("step9_fallback_transfer_operator.main"));
            vr.hangup();
            res.set("Content-Type", "text/xml; charset=utf-8");
            return res.send(vr.toString());
          }
          session.step = 4;
          gatherSpeech(vr, "Mi dispiace, a quell'orario non ci sono tavoli disponibili. Vuoi provare un altro orario?");
          break;
        }
        if (availability.status === "needs_split" || availability.status === "needs_outside" || session.outsideRequired) {
          session.criticalReservation = true;
          session.step = 8;
          maybeSayDivanettiNotice(vr, session);
          gatherSpeech(
            vr,
            "La prenotazione è stata effettuata con criticità. Ti richiamerà un operatore. Intanto mi lasci un numero di telefono? Se è italiano, aggiungo io il +39."
          );
          break;
        }
        resetRetries(session);
        session.step = 8;
        maybeSayDivanettiNotice(vr, session);
        gatherSpeech(vr, "Perfetto. Mi lasci un numero di telefono? Se è italiano, aggiungo io il +39.");
        break;
      }

      case 7: {
        if (emptySpeech) {
          const promptText = session.outsideRequired
            ? "Ti ricordo che la sala esterna è senza copertura e con maltempo non posso garantire un tavolo all'interno. Confermi?"
            : "Posco sistemarvi in tavoli separati? Se preferisci, ti passo un operatore.";
          const silenceResult = handleSilence(session, vr, () => gatherSpeech(vr, promptText));
          if (silenceResult.action === "forward") {
            await sendFallbackEmail(session, req, "silence_step7");
            void sendOperatorEmail(session, req, "silence_step7");
            res.set("Content-Type", "text/xml; charset=utf-8");
            return res.send(forwardToHumanTwiml());
          }
          break;
        }
        const confirmation = parseYesNo(speech);
        if (confirmation === null) {
          if (session.outsideRequired) {
            gatherSpeech(
              vr,
              "Ti ricordo che la sala esterna è senza copertura e con maltempo non posso garantire un tavolo all'interno. Confermi?"
            );
          } else {
            gatherSpeech(vr, "Posco sistemarvi in tavoli separati? Se preferisci, ti passo un operatore.");
          }
          break;
        }
        if (!confirmation) {
          if (canForwardToHuman()) {
            await sendFallbackEmail(session, req, "split_declined");
            void sendOperatorEmail(session, req, "split_declined");
            res.set("Content-Type", "text/xml; charset=utf-8");
            return res.send(forwardToHumanTwiml());
          }
          sayIt(vr, t("step9_fallback_transfer_operator.main"));
          vr.hangup();
          res.set("Content-Type", "text/xml; charset=utf-8");
          return res.send(vr.toString());
        }
        resetRetries(session);
        session.step = 8;
        gatherSpeech(vr, "Perfetto. Mi lasci un numero di telefono? Se è italiano, aggiungo io il +39.");
        break;
      }

      case 8: {
        if (emptySpeech) {
          const silenceResult = handleSilence(session, vr, () =>
            gatherSpeech(vr, "Scusami, non ho sentito il numero. Me lo ripeti?")
          );
          if (silenceResult.action === "forward") {
            await sendFallbackEmail(session, req, "silence_step8");
            void sendOperatorEmail(session, req, "silence_step8");
            res.set("Content-Type", "text/xml; charset=utf-8");
            return res.send(forwardToHumanTwiml());
          }
          break;
        }
        const phone = parsePhoneNumber(speech);
        if (!phone) {
          gatherSpeech(vr, "Scusami, non ho capito il numero. Puoi ripeterlo?");
          break;
        }
        session.phone = phone;
        resetRetries(session);
        if (session.criticalReservation) {
          const calendarEvent = await createCalendarEvent(session);
          const summary = `Data ${session.dateLabel || session.dateISO || ""}, ore ${session.time24 || ""}, ${session.people || ""} persone.`;
          await notifyCriticalReservation(session.phone, summary);
          await sendCriticalReservationSms(summary);
          if (calendarEvent?.status === "closed") {
            session.step = 2;
            session.criticalReservation = false;
            gatherSpeech(vr, "Mi dispiace, risulta che quel giorno il locale è chiuso. Vuoi scegliere un'altra data?");
            break;
          }
          if (calendarEvent?.status === "unavailable") {
            session.step = 4;
            session.criticalReservation = false;
            gatherSpeech(vr, "Mi dispiace, a quell'orario non ci sono tavoli disponibili. Vuoi provare un altro orario?");
            break;
          }
          resetRetries(session);
          session.step = 1;
          session.criticalReservation = false;
          sayIt(vr, "La prenotazione è stata effettuata. Verrai richiamato da un operatore per confermare i dettagli.");
          vr.hangup();
          res.set("Content-Type", "text/xml; charset=utf-8");
          return res.send(vr.toString());
        }
        session.step = 9;
        maybeSayApericenaNotices(vr, session);
        maybeSayLiveMusicNotice(vr, session);
        gatherSpeech(vr, "Hai altre richieste particolari? Ad esempio sala esterna.");
        break;
      }

      case 9: {
        if (emptySpeech) {
          const silenceResult = handleSilence(session, vr, () =>
            gatherSpeech(vr, "Hai altre richieste particolari? Ad esempio sala esterna.")
          );
          if (silenceResult.action === "forward") {
            await sendFallbackEmail(session, req, "silence_step9");
            void sendOperatorEmail(session, req, "silence_step9");
            res.set("Content-Type", "text/xml; charset=utf-8");
            return res.send(forwardToHumanTwiml());
          }
          break;
        }
        if (isPureConsent(speech)) {
          gatherSpeech(vr, "Quali? Dimmi pure le intolleranze o la richiesta.");
          break;
        }
        const confirmation = parseYesNo(speech);
        if (confirmation === null) {
          session.extraRequestsRaw = speech.trim().slice(0, 200);
          if (isOutsideRequest(session.extraRequestsRaw)) {
            maybeSayOutsideWarning(vr);
          }
          session.step = 10;
          sayIt(vr, `Richieste particolari: ${buildExtraRequestsText(session)}.`);
          gatherSpeech(
            vr,
            t("step8_summary_confirm.main", {
              name: session.name || "",
              dateLabel: session.dateLabel || "",
              time: session.time24 || "",
              partySize: session.people || "",
            })
          );
          break;
        }
        if (!confirmation) {
          session.extraRequestsRaw = "nessuna";
          session.step = 10;
          sayIt(vr, `Richieste particolari: ${buildExtraRequestsText(session)}.`);
          gatherSpeech(
            vr,
            t("step8_summary_confirm.main", {
              name: session.name || "",
              dateLabel: session.dateLabel || "",
              time: session.time24 || "",
              partySize: session.people || "",
            })
          );
          break;
        }
        gatherSpeech(vr, "Dimmi pure la richiesta.");
        break;
      }

      case 10: {
        if (emptySpeech) {
          const silenceResult = handleSilence(session, vr, () =>
            gatherSpeech(
              vr,
              t("step8_summary_confirm.short", {
                dateLabel: session.dateLabel || "",
                time: session.time24 || "",
                partySize: session.people || "",
              })
            )
          );
          if (silenceResult.action === "forward") {
            await sendFallbackEmail(session, req, "silence_step10");
            void sendOperatorEmail(session, req, "silence_step10");
            res.set("Content-Type", "text/xml; charset=utf-8");
            return res.send(forwardToHumanTwiml());
          }
          break;
        }
        const confirmation = parseYesNo(speech);
        if (confirmation === null) {
          gatherSpeech(
            vr,
            t("step8_summary_confirm.short", {
              dateLabel: session.dateLabel || "",
              time: session.time24 || "",
              partySize: session.people || "",
            })
          );
          break;
        }
        if (!confirmation) {
          resetRetries(session);
          goBack(session);
          promptForStep(vr, session);
          break;
        }
        const calendarEvent = await createCalendarEvent(session);
        if (calendarEvent?.status === "closed") {
          session.step = 2;
          gatherSpeech(vr, "Mi dispiace, risulta che quel giorno il locale è chiuso. Vuoi scegliere un'altra data?");
          break;
        }
        if (calendarEvent?.status === "unavailable") {
          if (session.forceOperatorFallback && canForwardToHuman()) {
            await sendFallbackEmail(session, req, "invalid_table_combo");
            void sendOperatorEmail(session, req, "invalid_table_combo");
            res.set("Content-Type", "text/xml; charset=utf-8");
            return res.send(forwardToHumanTwiml());
          }
          if (session.forceOperatorFallback) {
            sayIt(vr, t("step9_fallback_transfer_operator.main"));
            vr.hangup();
            res.set("Content-Type", "text/xml; charset=utf-8");
            return res.send(vr.toString());
          }
          session.step = 4;
          gatherSpeech(vr, "Mi dispiace, a quell'orario non ci sono tavoli disponibili. Vuoi provare un altro orario?");
          break;
        }
        if (!calendarEvent && canForwardToHuman()) {
          await sendFallbackEmail(session, req, "calendar_insert_failed");
          void sendOperatorEmail(session, req, "calendar_insert_failed");
          res.set("Content-Type", "text/xml; charset=utf-8");
          return res.send(forwardToHumanTwiml());
        }
        resetRetries(session);
        session.step = 1;
        sayIt(vr, t("step9_success.main"));
        vr.hangup();
        res.set("Content-Type", "text/xml; charset=utf-8");
        return res.send(vr.toString());
      }

      default: {
        if (canForwardToHuman()) {
          await sendFallbackEmail(session, req, "unknown_step");
          void sendOperatorEmail(session, req, "unknown_step");
          res.set("Content-Type", "text/xml; charset=utf-8");
          return res.send(forwardToHumanTwiml());
        }
        resetRetries(session);
        session.step = 1;
        gatherSpeech(vr, t("step1_welcome_name.short"));
        break;
      }
    }

    res.set("Content-Type", "text/xml; charset=utf-8");
    return res.send(vr.toString());
  } catch (err) {
    console.error("[VOICE] Error:", err);
    void sendFallbackEmailSmtpOnly(session, req, "exception");
    if (canForwardToHuman()) {
      void sendOperatorEmail(session, req, "exception");
      res.set("Content-Type", "text/xml; charset=utf-8");
      return res.send(forwardToHumanTwiml());
    }
    sayIt(vr, t("step9_fallback_transfer_operator.main"));
    vr.hangup();
    res.set("Content-Type", "text/xml; charset=utf-8");
    return res.send(vr.toString());
  }
}

app.all("/twilio/voice", async (req, res) => {
  console.log(`[VOICE] ${req.method} /twilio/voice`);
  const payload = req.method === "POST" ? req.body : req.query;
  if (payload && Object.keys(payload).length > 0) {
    req.body = payload;
    return handleVoiceRequest(req, res);
  }
  const vr = buildTwiml();
  vr.say(
    { language: "it-IT", voice: "alice" },
    xmlEscape("Test Twilio Voice: endpoint attivo.")
  );
  res.set("Content-Type", "text/xml; charset=utf-8");
  return res.send(vr.toString());
});

app.all("/voice", (req, res) => {
  const targetUrl = BASE_URL ? `${BASE_URL}/twilio/voice` : "/twilio/voice";
  return res.redirect(307, targetUrl);
});

// NOTA: /finalize lo rimettiamo dopo, quando confermi che non cade più allo step 5.
// (non serve per risolvere il crash delle intolleranze)

app.get("/", (req, res) => {
  res.send("OK - backend running");
});

app.listen(PORT, () => {
  console.log(`Voice assistant running on port ${PORT}`);
});
