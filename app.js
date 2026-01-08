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
app.use((req, res, next) => {
  res.on("finish", () => {
    void safeCreateFailedCallCalendarEvent(getSession(req.body?.CallSid), req, "chiamata interrotta");
  });
  next();
});

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
const SMTP_USER = process.env.EMAIL_USER || "";
const SMTP_PASS = process.env.EMAIL_PASS || "";
const SMTP_SECURE = (process.env.SMTP_SECURE || "false").toLowerCase() === "true";
const EMAIL_TO = process.env.EMAIL_TO || "tuttibrillienoteca@gmail.com";
const EMAIL_FROM = process.env.EMAIL_FROM || "no-reply@tuttibrilli.local";
const EMAIL_PROVIDER = process.env.EMAIL_PROVIDER || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const EMAIL_OPERATOR = process.env.EMAIL_OPERATOR || EMAIL_TO;

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

  let fallbackRow = null;
  let best = null;

  for (const row of rows) {
    const normalizedRow = normalizeInfoRow(row);
    if (!normalizedRow.active) continue;
    if (normalizedRow.locale && normalizedRow.locale !== normalizedLocale) continue;

    if (normalizedRow.fallback) {
      if (!fallbackRow || normalizedRow.priority < fallbackRow.priority) {
        fallbackRow = normalizedRow;
      }
      continue;
    }

    const keywords = normalizedRow.keywords || [];
    if (keywords.length === 0) continue;

    const matched = keywords.some((keyword) => normalizedSpeech.includes(keyword));
    if (!matched) continue;

    if (!best || normalizedRow.priority < best.priority) {
      best = normalizedRow;
    }
  }

  return best || fallbackRow;
}

async function getInfoResponse({ speech, locale }) {
  const sheetsData = await loadSheetsData();
  const infoRows = sheetsData?.INFO || [];
  if (!infoRows.length) return null;

  const matched = findMatchingInfo(infoRows, speech, locale);
  if (!matched) return null;

  return matched.text || null;
}

// ======================= HELPERS =======================
function buildTwiml() {
  return new twilio.twiml.VoiceResponse();
}

function gatherSpeech(vr, prompt, options = {}) {
  const gather = vr.gather({
    input: "speech",
    speechTimeout: "auto",
    action: "/twilio/voice",
    method: "POST",
    language: "it-IT",
    ...options,
  });
  gather.say({ language: "it-IT", voice: "alice" }, xmlEscape(prompt));
}

function sayIt(vr, text) {
  vr.say({ language: "it-IT", voice: "alice" }, xmlEscape(text));
}

function toBool(v) {
  return String(v || "")
    .toLowerCase()
    .trim() === "true";
}

function requiresForwarding() {
  return ENABLE_FORWARDING && HUMAN_FORWARD_TO;
}

function canForwardToHuman() {
  return Boolean(requiresForwarding() && OPERATOR_PHONE);
}

function forwardToHumanTwiml() {
  const vr = buildTwiml();
  vr.say({ language: "it-IT", voice: "alice" }, xmlEscape("Ti metto in contatto con un operatore umano."));
  vr.dial({}, OPERATOR_PHONE);
  return vr.toString();
}

function resetEnvWarningSent() {
  envWarningSent = false;
}

let envWarningSent = false;
function maybeWarnMissingEnv() {
  if (envWarningSent) return;
  const missing = [];
  if (!TWILIO_ACCOUNT_SID) missing.push("TWILIO_ACCOUNT_SID");
  if (!TWILIO_AUTH_TOKEN) missing.push("TWILIO_AUTH_TOKEN");
  if (!TWILIO_VOICE_FROM) missing.push("TWILIO_VOICE_FROM");
  if (!GOOGLE_CALENDAR_ID) missing.push("GOOGLE_CALENDAR_ID");
  if (!GOOGLE_SERVICE_ACCOUNT_JSON_B64 && !GOOGLE_SERVICE_ACCOUNT_JSON) missing.push("GOOGLE_SERVICE_ACCOUNT_JSON(_B64)");
  if (!SMTP_HOST && EMAIL_PROVIDER !== "resend") missing.push("SMTP_HOST");
  if (!EMAIL_TO) missing.push("EMAIL_TO");
  if (!BASE_URL) missing.push("BASE_URL");

  if (missing.length > 0) {
    envWarningSent = true;
    console.warn(`[ENV] Missing: ${missing.join(", ")}`);
  }
}

function requireTwilioVoiceFrom() {
  if (!TWILIO_VOICE_FROM) {
    throw new Error("TWILIO_VOICE_FROM missing");
  }
  return TWILIO_VOICE_FROM;
}

// ======================= FALLBACK EMAIL =======================
function buildFallbackEmailPayload(session, req, reason) {
  const caller = session?.phone || req?.body?.From || "";
  const payload = {
    subject: "Chiamata interrotta - richiesta cliente",
    text: [
      `Numero cliente: ${caller}`,
      `Tipo richiesta: ${session?.intent || ""}`,
      `Nome cliente: ${session?.name || ""}`,
      `Data: ${session?.dateISO || ""}`,
      `Ora: ${session?.time24 || ""}`,
      `Persone: ${session?.people || ""}`,
      `Richieste: ${buildSpecialRequestsText(session)}`,
      `Motivo interruzione: ${reason || "non specificato"}`,
    ].join("\n"),
  };
  return payload;
}

async function sendEmailWithResend({ to, subject, text }) {
  if (!RESEND_API_KEY) {
    console.error("[EMAIL] RESEND_API_KEY is not set");
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
        to,
        subject,
        text,
      }),
    });
    if (!response.ok) {
      const errText = await response.text();
      console.error("[EMAIL] Resend failed:", errText);
    }
  } catch (err) {
    console.error("[EMAIL] Resend failed:", err);
  }
}

async function sendFallbackEmail(session, req, reason) {
  const payload = buildFallbackEmailPayload(session, req, reason);
  if (EMAIL_PROVIDER === "resend") {
    await sendEmailWithResend({
      to: EMAIL_TO,
      subject: payload.subject,
      text: payload.text,
    });
    return;
  }
  try {
    if (!SMTP_HOST) {
      console.error("[EMAIL] SMTP_HOST is not set");
      return;
    }
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    });
    await transporter.sendMail({
      from: EMAIL_FROM,
      to: EMAIL_TO,
      subject: payload.subject,
      text: payload.text,
    });
  } catch (err) {
    console.error("[EMAIL] Fallback email failed:", err);
  }
}

async function sendFallbackEmailSmtpOnly(session, req, reason) {
  const payload = buildFallbackEmailPayload(session, req, reason);
  try {
    if (!SMTP_HOST) {
      console.error("[EMAIL] SMTP_HOST is not set");
      return;
    }
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    });
    await transporter.sendMail({
      from: EMAIL_FROM,
      to: EMAIL_TO,
      subject: payload.subject,
      text: payload.text,
    });
  } catch (err) {
    console.error("[EMAIL] Fallback email failed:", err);
  }
}

function buildOperatorEmailPayload(session, req, reason) {
  const caller = session?.phone || req?.body?.From || "";
  const state = session?.step || "unknown";
  const requestType = session?.intent || "";
  const subject = session?.requiresFollowUp
    ? "Prenotazione con richiesta di ricontatto"
    : "Inoltro operatore - contesto prenotazione";
  const lines = [
    `Numero cliente: ${caller}`,
    `Tipo richiesta: ${requestType || "non specificato"}`,
    `Nome cliente: ${session?.name || ""}`,
    `Data: ${session?.dateISO || ""}`,
    `Ora: ${session?.time24 || ""}`,
    `Persone: ${session?.people || ""}`,
    `Richieste: ${buildSpecialRequestsText(session)}`,
    `Stato flusso: ${state}`,
    `Motivo inoltro: ${reason || "non specificato"}`,
  ];
  if (session?.requiresFollowUp) {
    lines.push(`Richieste particolari (testo integrale): ${session?.extraRequestsRaw || ""}`);
  }
  const payload = {
    subject,
    text: lines.join("\n"),
  };
  return payload;
}

async function sendOperatorEmail(session, req, reason) {
  const payload = buildOperatorEmailPayload(session, req, reason);
  if (EMAIL_PROVIDER === "resend") {
    await sendEmailWithResend({
      to: EMAIL_OPERATOR,
      subject: payload.subject,
      text: payload.text,
    });
    return;
  }
  try {
    if (!SMTP_HOST) {
      console.error("[EMAIL] SMTP_HOST is not set");
      return;
    }
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    });
    await transporter.sendMail({
      from: EMAIL_FROM,
      to: EMAIL_TO,
      subject: payload.subject,
      text: payload.text,
    });
  } catch (err) {
    console.error("[EMAIL] Operator email failed:", err);
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
      extraRequestsPrompted: false,
      requiresFollowUp: false,
      liveMusicNoticePending: false,
      liveMusicNoticeSpoken: false,
      forceOperatorFallback: false,
      bookingCompleted: false,
      fallbackEventCreated: false,
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

function handleSilence(session, vr, promptFn) {
  if (session.silenceStep !== session.step) {
    session.silenceStep = session.step;
    session.silenceRetries = 0;
  }
  session.silenceRetries += 1;
  if (session.silenceRetries >= 2) {
    session.silenceRetries = 0;
    return { action: "forward" };
  }
  promptFn();
  return { action: "prompt" };
}

function normalizeText(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[.,!?]/g, "")
    .replace(/\s+/g, " ");
}

function isPureConsent(speech) {
  const tt = normalizeText(speech);
  if (!tt) return false;
  if (YES_WORDS.includes(tt)) return true;
  const words = tt.split(" ").filter(Boolean);
  return words.length > 0 && words.every((word) => YES_WORDS.includes(word));
}

function isOperatorRequest(speech) {
  const tt = normalizeText(speech);
  return (
    tt.includes("operatore") ||
    tt.includes("parlare con qualcuno") ||
    tt.includes("persona") ||
    tt.includes("assistenza") ||
    tt.includes("aiuto")
  );
}
function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateLabel(dateISO) {
  const date = new Date(`${dateISO}T00:00:00`);
  const weekdays = [
    "domenica",
    "lunedì",
    "martedì",
    "mercoledì",
    "giovedì",
    "venerdì",
    "sabato",
  ];
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
  return `${weekdays[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

// ---- Back/edit commands
function isBackCommand(speech) {
  const tt = normalizeText(speech);
  return (
    tt.includes("indietro") ||
    tt.includes("torna indietro") ||
    tt.includes("tornare indietro") ||
    tt.includes("errore") ||
    tt.includes("ho sbagliato") ||
    tt.includes("sbagliato")
  );
}

function isCancelCommand(speech) {
  const tt = normalizeText(speech);
  return CANCEL_WORDS.some((word) => tt.includes(word));
}

function goBack(session) {
  if (!session || typeof session.step !== "number") return;
  if (session.step <= 1) return;

  if (session.step === 2) session.step = 1;
  else if (session.step === 3) session.step = 2;
  else if (session.step === 4) session.step = 3;
  else if (session.step === 5) session.step = 4;
  else if (session.step === 6) session.step = 5;
  else if (session.step === 7) session.step = 6;
  else if (session.step === 8) session.step = 7;
  else if (session.step === 9) session.step = 8;
  else if (session.step === 10) session.step = 9;
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
      gatherSpeech(vr, "Perfetto. In quante persone siete?");
      return;
    case 4:
      gatherSpeech(vr, t("step3_confirm_date_ask_time.main", { dateLabel: session.dateLabel || "" }));
      return;
    case 5:
      gatherSpeech(vr, t("step5_party_size_ask_notes.main", { partySize: session.people || "" }));
      return;
    case 6:
      gatherSpeech(
        vr,
        "Vuoi preordinare qualcosa dal menù? Puoi dire: cena, apericena, dopocena, piatto apericena, oppure piatto apericena promo. Se non vuoi, dì nessuno."
      );
      return;
    case 7:
      gatherSpeech(
        vr,
        "Non abbiamo più disponibilità per un unico tavolo. Posco sistemarvi in tavoli separati?"
      );
      return;
    case 8:
      gatherSpeech(vr, "Perfetto. Mi lasci un numero di telefono? Se è italiano, aggiungo io il +39.");
      return;
    case 9:
      gatherSpeech(vr, "Hai altre richieste particolari?");
      return;
    case 10:
      gatherSpeech(
        vr,
        t("step8_summary_confirm.main", {
          name: session.name || "",
          dateLabel: session.dateLabel || "",
          time: session.time24 || "",
          partySize: session.people || "",
        })
      );
      return;
    default:
      gatherSpeech(vr, t("step1_welcome_name.short"));
      return;
  }
}

// ====== parsing basilari (per arrivare al punto: FIX crash step 5) ======
function parseTimeIT(speech) {
  const tt = normalizeText(speech);
  const hm = tt.match(/(\d{1,2})[:\s](\d{2})/);
  if (hm) {
    const hh = Number(hm[1]);
    const mm = Number(hm[2]);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    }
  }
  const onlyH = tt.match(/\b(\d{1,2})\b/);
  if (onlyH) {
    const hh = Number(onlyH[1]);
    if (hh >= 0 && hh <= 23) return `${String(hh).padStart(2, "0")}:00`;
  }
  return null;
}

function parseDateIT(speech) {
  const tt = normalizeText(speech).replace(/[,\.]/g, " ").replace(/\s+/g, " ").trim();
  const today = new Date();

  if (tt.includes("oggi")) return toISODate(today);
  if (tt.includes("domani")) {
    const next = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    return toISODate(next);
  }

  const dmY = tt.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (dmY) {
    const dd = Number(dmY[1]);
    const mm = Number(dmY[2]);
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

function parsePeopleIT(speech) {
  const tt = normalizeText(speech);
  const m = tt.match(/\b(\d{1,2})\b/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function parseYesNo(speech) {
  const tt = normalizeText(speech);
  if (!tt) return null;
  if (YES_WORDS.some((w) => tt.includes(w))) return true;
  if (NO_WORDS.some((w) => tt.includes(w))) return false;
  return null;
}

function hasGlutenIntolerance(text) {
  const tt = normalizeText(text);
  if (!tt) return false;
  return (
    tt.includes("celiachia") ||
    tt.includes("glutine") ||
    tt.includes("senza glutine") ||
    tt.includes("intolleranza al glutine")
  );
}

function isDivanettiTableId(id) {
  return id === "T14" || id === "T15" || id === "T4F" || id === "T6F" || id === "T7F" || id === "T8F";
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
    tt.includes("outdoor") ||
    tt.includes("dehors")
  );
}

function maybeSayOutsideWarning(vr) {
  sayIt(
    vr,
    "La sala esterna non è coperta: in caso di pioggia o brutto tempo il posto interno non è garantito. Se vuoi, ti consiglio la sala interna."
  );
}

// ======================= TABLES HELPERS =======================
function getTableById(id) {
  return TABLES.find((t) => t.id === id) || null;
}

function findMatchingTables({ area, people, allowTables = true, allowCombos = true }) {
  const matches = [];
  if (allowTables) {
    for (const t of TABLES) {
      if (area && t.area !== area) continue;
      if (people < t.min || people > t.max) continue;
      matches.push({
        id: t.id,
        displayId: t.id,
        area: t.area,
        notes: t.notes || "",
        min: t.min,
        max: t.max,
        type: "table",
      });
    }
  }
  if (allowCombos) {
    for (const combo of TABLE_COMBINATIONS) {
      if (area && combo.area !== area) continue;
      if (people < combo.min || people > combo.max) continue;
      matches.push({
        id: combo.displayId,
        displayId: combo.displayId,
        area: combo.area,
        notes: combo.notes || "",
        min: combo.min,
        max: combo.max,
        type: "combo",
        replaces: combo.replaces,
      });
    }
  }
  return matches;
}

function isTablesSubset(locks, tableIds) {
  if (!Array.isArray(locks) || locks.length === 0) return false;
  const set = new Set(tableIds);
  return locks.every((lock) => set.has(lock));
}

function chooseTableToLock(matches) {
  if (!matches.length) return null;
  const sorted = matches.slice().sort((a, b) => a.max - b.max);
  return sorted[0];
}

function lockTablesForSession(session, selection) {
  if (!selection) return;
  session.tableDisplayId = selection.displayId || selection.id;
  if (selection.type === "combo" && selection.replaces) {
    session.tableLocks = selection.replaces.slice();
  } else {
    session.tableLocks = [selection.id];
  }
  session.tableNotes = selection.notes || "";
  session.outsideRequired = selection.area === "outside";
  session.divanettiNotice = Boolean(session.tableLocks?.some((id) => isDivanettiTableId(id)));
}

function splitTableLock(session) {
  if (!session.tableLocks || session.tableLocks.length === 0) return;
  session.tableLocks = session.tableLocks.slice();
  session.splitRequired = true;
}

function buildBookingSummary(session) {
  const timeText = session.time24 || "";
  return `Ore ${timeText}, ${session.name || ""}, ${session.people || ""} pax`;
}

function parseTimeDateToDate(dateISO, time24) {
  if (!dateISO || !time24) return null;
  const [y, m, d] = dateISO.split("-").map(Number);
  const [hh, mm] = time24.split(":").map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d, hh, mm, 0, 0);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function formatTime(date) {
  if (!date) return "";
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function parseTimeToMinutes(time24) {
  if (!time24) return null;
  const parts = time24.split(":").map(Number);
  if (parts.length !== 2) return null;
  const [hh, mm] = parts;
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  return hh * 60 + mm;
}

function minutesToTime(minutes) {
  if (minutes === null || minutes === undefined) return null;
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function isWithinTimeRange(time24, range) {
  if (!time24 || !range) return false;
  const time = parseTimeToMinutes(time24);
  const start = parseTimeToMinutes(range.start);
  const end = parseTimeToMinutes(range.end);
  if (time === null || start === null || end === null) return false;
  if (end < start) return time >= start || time <= end;
  return time >= start && time <= end;
}

function isSameDay(dateISO1, dateISO2) {
  return dateISO1 === dateISO2;
}

function isDateInHoliday(dateISO) {
  if (!dateISO) return false;
  return HOLIDAYS_SET.has(dateISO);
}

function isDayOpenForMusic(dateISO) {
  if (!dateISO) return false;
  const date = new Date(`${dateISO}T00:00:00`);
  const day = date.getDay();
  return OPENING.musicNights.days.includes(day);
}

function getOpeningWindow(dateISO, bookingType) {
  if (!dateISO) return null;
  const date = new Date(`${dateISO}T00:00:00`);
  const day = date.getDay();
  if (day === OPENING.closedDay) return null;
  if (isDateInHoliday(dateISO)) return null;

  if (bookingType === "drinks") {
    return OPENING.drinksOnly;
  }

  const isFriOrSat = day === 5 || day === 6;
  if (isFriOrSat) return OPENING.restaurant.friSat;
  return OPENING.restaurant.default;
}

function computeBookingDuration(session) {
  const people = Number(session?.people || 0);
  const base = people >= 6 ? 150 : 120;
  return base;
}

// ======================= RESERVATION CHECK =======================
async function listCalendarEvents(dateISO) {
  const calendar = buildCalendarClient();
  if (!calendar) return null;
  if (!GOOGLE_CALENDAR_ID) return null;

  const timeMin = `${dateISO}T00:00:00+01:00`;
  const timeMax = `${dateISO}T23:59:59+01:00`;

  try {
    const result = await calendar.events.list({
      calendarId: GOOGLE_CALENDAR_ID,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
    });
    return result?.data?.items || [];
  } catch (err) {
    console.error("[GOOGLE] Calendar list failed:", err);
    return null;
  }
}

function extractEventTableLock(summary = "") {
  const match = summary.match(/tav\s+([^,]+)/i);
  if (!match) return null;
  const raw = match[1].trim().toUpperCase();
  if (!raw) return null;
  return raw;
}

function splitTableLocks(tableLock) {
  if (!tableLock) return [];
  if (tableLock.includes("+")) {
    return tableLock.split("+").map((s) => s.trim().toUpperCase());
  }
  if (tableLock.includes(" e ")) {
    return tableLock
      .split(" e ")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  }
  return [tableLock.trim().toUpperCase()];
}

function parseEventLocks(summary) {
  const table = extractEventTableLock(summary || "");
  return splitTableLocks(table);
}

function getEventType(event) {
  if (!event) return "reservation";
  const type = event.extendedProperties?.private?.type;
  if (type === "evento") return "evento";
  if (type === "availability") return "availability";
  return "reservation";
}

function isReservationEvent(event) {
  return getEventType(event) === "reservation";
}

function parseEventTime(event) {
  const start = event?.start?.dateTime || event?.start?.date;
  if (!start) return null;
  return new Date(start);
}

function getEventsLocks(events) {
  return events
    .filter((event) => isReservationEvent(event))
    .map((event) => parseEventLocks(event.summary || ""))
    .flat()
    .filter(Boolean);
}

function isTableAvailable(events, tableId) {
  const locks = getEventsLocks(events);
  return !locks.includes(tableId);
}

function pickAvailableTable(matches, events) {
  for (const match of matches) {
    const locks = getEventsLocks(events);
    const requiredLocks = match.type === "combo" ? match.replaces || [] : [match.id];
    const allAvailable = requiredLocks.every((lock) => !locks.includes(lock));
    if (allAvailable) return match;
  }
  return null;
}

function isValidPhoneE164(phone) {
  if (!phone) return false;
  return /^\+\d{8,15}$/.test(phone);
}

function getApericenaNoticeTexts(session) {
  const notices = [];
  const preorderOption = getPreorderOptionByKey(session?.preorderChoiceKey);
  if (preorderOption?.constraints?.minTime && session.time24) {
    if (!isWithinTimeRange(session.time24, { start: preorderOption.constraints.minTime, end: "23:59" })) {
      notices.push(`Nota: per ${preorderOption.label} la prenotazione deve essere dopo le ${preorderOption.constraints.minTime}.`);
    }
  }
  if (preorderOption?.constraints?.promoOnly && session.promoEligible === false) {
    notices.push("Nota: la promo è valida solo con registrazione online.");
  }
  if (session?.glutenPiattoNotice) {
    notices.push("Nota: per il Piatto Apericena gluten free serve prenotazione anticipata.");
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

function maybeSayLiveMusicNotice(vr, session) {
  if (!session?.liveMusicNoticePending) return;
  if (session?.liveMusicNoticeSpoken) return;
  if (!session?.dateISO || !session?.time24) return;
  const isMusicDay = isDayOpenForMusic(session.dateISO);
  if (!isMusicDay) {
    session.liveMusicNoticePending = false;
    session.liveMusicNoticeSpoken = false;
    return;
  }
  const timeMinutes = parseTimeToMinutes(session.time24);
  if (timeMinutes === null || timeMinutes < 1200) {
    session.liveMusicNoticePending = false;
    session.liveMusicNoticeSpoken = false;
    return;
  }
  session.liveMusicNoticeSpoken = true;
  sayIt(vr, "Ti informo che quella sera è prevista musica dal vivo.");
}

// ======================= GOOGLE CALENDAR =======================
function getGoogleCredentials() {
  if (GOOGLE_SERVICE_ACCOUNT_JSON_B64) {
    try {
      return JSON.parse(Buffer.from(GOOGLE_SERVICE_ACCOUNT_JSON_B64, "base64").toString("utf8"));
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
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
  return google.calendar({ version: "v3", auth });
}

async function upsertAvailabilityEvent(dateISO) {
  if (!dateISO) return null;
  if (!GOOGLE_CALENDAR_ID) return null;
  const calendar = buildCalendarClient();
  if (!calendar) return null;

  const timeMin = `${dateISO}T00:00:00+01:00`;
  const timeMax = `${dateISO}T23:59:59+01:00`;

  try {
    const result = await calendar.events.list({
      calendarId: GOOGLE_CALENDAR_ID,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
    });
    const items = result?.data?.items || [];
    const availabilityEvent = items.find((item) => item.extendedProperties?.private?.type === "availability");

    if (availabilityEvent) {
      return availabilityEvent;
    }

    const event = {
      summary: `Disponibilità ${dateISO}`,
      description: `Disponibilità del giorno ${dateISO}`,
      start: { dateTime: `${dateISO}T00:00:00`, timeZone: GOOGLE_CALENDAR_TZ },
      end: { dateTime: `${dateISO}T23:59:59`, timeZone: GOOGLE_CALENDAR_TZ },
      extendedProperties: { private: { type: "availability" } },
    };
    const insertResult = await calendar.events.insert({
      calendarId: GOOGLE_CALENDAR_ID,
      requestBody: event,
    });
    return insertResult?.data || null;
  } catch (err) {
    console.error("[GOOGLE] Availability event upsert failed:", err);
    return null;
  }
}

// ======================= TABLE RESERVATION =======================
async function reserveTableForSession(session, { commit = false } = {}) {
  if (!session?.dateISO || !session?.time24 || !session?.people) return { status: "invalid" };
  const openingWindow = getOpeningWindow(session.dateISO, session.bookingType);
  if (!openingWindow) return { status: "closed" };

  if (!isWithinTimeRange(session.time24, openingWindow)) {
    return { status: "invalid_time" };
  }

  const events = await listCalendarEvents(session.dateISO);
  if (!events) return { status: "calendar_error" };

  const preferOutside = session.wantsOutside;
  const matchesInside = findMatchingTables({ area: "inside", people: session.people });
  const matchesOutside = findMatchingTables({ area: "outside", people: session.people });

  const pickInside = pickAvailableTable(matchesInside, events);
  const pickOutside = pickAvailableTable(matchesOutside, events);

  let selection = null;
  if (preferOutside && pickOutside) {
    selection = pickOutside;
  } else if (pickInside) {
    selection = pickInside;
  } else if (pickOutside) {
    selection = pickOutside;
  } else {
    return { status: "unavailable" };
  }

  if (commit) {
    lockTablesForSession(session, selection);
  }
  return { status: "ok", selection };
}

async function reserveTableForSessionWithSplit(session, { commit = false } = {}) {
  if (!session?.dateISO || !session?.time24 || !session?.people) return { status: "invalid" };
  const openingWindow = getOpeningWindow(session.dateISO, session.bookingType);
  if (!openingWindow) return { status: "closed" };

  if (!isWithinTimeRange(session.time24, openingWindow)) {
    return { status: "invalid_time" };
  }

  const events = await listCalendarEvents(session.dateISO);
  if (!events) return { status: "calendar_error" };

  const preferOutside = session.wantsOutside;
  const matchesInside = findMatchingTables({ area: "inside", people: session.people, allowCombos: false });
  const matchesOutside = findMatchingTables({ area: "outside", people: session.people, allowCombos: false });

  const pickInside = pickAvailableTable(matchesInside, events);
  const pickOutside = pickAvailableTable(matchesOutside, events);

  let selection = null;
  if (preferOutside && pickOutside) {
    selection = pickOutside;
  } else if (pickInside) {
    selection = pickInside;
  } else if (pickOutside) {
    selection = pickOutside;
  } else {
    return { status: "unavailable" };
  }

  if (commit) {
    lockTablesForSession(session, selection);
  }

  return { status: "ok", selection };
}

async function reserveCombinedTablesForSession(session, { commit = false } = {}) {
  if (!session?.dateISO || !session?.time24 || !session?.people) return { status: "invalid" };
  const openingWindow = getOpeningWindow(session.dateISO, session.bookingType);
  if (!openingWindow) return { status: "closed" };

  if (!isWithinTimeRange(session.time24, openingWindow)) {
    return { status: "invalid_time" };
  }

  const events = await listCalendarEvents(session.dateISO);
  if (!events) return { status: "calendar_error" };

  const preferOutside = session.wantsOutside;
  const matchesInside = findMatchingTables({ area: "inside", people: session.people, allowTables: false });
  const matchesOutside = findMatchingTables({ area: "outside", people: session.people, allowTables: false });

  const pickInside = pickAvailableTable(matchesInside, events);
  const pickOutside = pickAvailableTable(matchesOutside, events);

  let selection = null;
  if (preferOutside && pickOutside) {
    selection = pickOutside;
  } else if (pickInside) {
    selection = pickInside;
  } else if (pickOutside) {
    selection = pickOutside;
  } else {
    return { status: "unavailable" };
  }

  if (commit) {
    lockTablesForSession(session, selection);
  }
  return { status: "ok", selection };
}

async function releaseTableReservation(session) {
  if (!session?.calendarEventId) return;
  try {
    const calendar = buildCalendarClient();
    if (!calendar) return;
    await calendar.events.delete({
      calendarId: GOOGLE_CALENDAR_ID,
      eventId: session.calendarEventId,
    });
    if (session.dateISO) {
      await upsertAvailabilityEvent(session.dateISO);
    }
  } catch (err) {
    console.error("[GOOGLE] Calendar event delete failed:", err);
  }
}

async function reserveOrUpdateTable(session, updateType = "auto") {
  if (!session?.dateISO || !session?.time24 || !session?.people) return { status: "invalid" };
  const openingWindow = getOpeningWindow(session.dateISO, session.bookingType);
  if (!openingWindow) return { status: "closed" };

  if (!isWithinTimeRange(session.time24, openingWindow)) {
    return { status: "invalid_time" };
  }

  const events = await listCalendarEvents(session.dateISO);
  if (!events) return { status: "calendar_error" };

  const preferOutside = session.wantsOutside;
  const matchesInside = findMatchingTables({ area: "inside", people: session.people });
  const matchesOutside = findMatchingTables({ area: "outside", people: session.people });

  let selection = null;
  if (updateType === "inside" && matchesInside.length > 0) {
    selection = pickAvailableTable(matchesInside, events);
  } else if (updateType === "outside" && matchesOutside.length > 0) {
    selection = pickAvailableTable(matchesOutside, events);
  } else {
    const pickInside = pickAvailableTable(matchesInside, events);
    const pickOutside = pickAvailableTable(matchesOutside, events);
    if (preferOutside && pickOutside) {
      selection = pickOutside;
    } else if (pickInside) {
      selection = pickInside;
    } else if (pickOutside) {
      selection = pickOutside;
    } else {
      return { status: "unavailable" };
    }
  }

  if (selection) {
    lockTablesForSession(session, selection);
  }

  if (session.calendarEventId) {
    const calendar = buildCalendarClient();
    if (calendar) {
      const summary = buildBookingSummary(session);
      const summaryWithTable = `${summary}, tav ${session.tableDisplayId || "da assegnare"}`;
      const updatedSummary = summaryWithTable;
      const notes = buildSpecialRequestsText(session);
      const description = [
        `Nome: ${session.name || ""}`,
        `Persone: ${session.people || ""}`,
        `Note: ${notes}`,
        `Preordine: ${session.preorderLabel || "nessuno"}`,
        `Tavolo: ${session.tableDisplayId || "da assegnare"}`,
        `Telefono: ${session.phone || "non fornito"}`,
      ].join("\n");
      const updatedDescription = description;

      try {
        await calendar.events.patch({
          calendarId: GOOGLE_CALENDAR_ID,
          eventId: session.calendarEventId,
          requestBody: {
            summary: updatedSummary,
            description: updatedDescription,
          },
        });
      } catch (err) {
        console.error("[GOOGLE] Calendar event update failed:", err);
      }
    }
  }

  return { status: "ok", selection };
}

async function cancelCalendarEvent(session) {
  if (!session?.calendarEventId) return null;
  const calendar = buildCalendarClient();
  if (!calendar) return null;
  const summary = session.calendarEventSummary || "";
  const summaryWithoutTable = summary.replace(/,\s*tav[^,]+/i, "").trim();
  const updatedSummary = summaryWithoutTable.startsWith("Annullata")
    ? summaryWithoutTable
    : `Annullata - ${summaryWithoutTable}`;

  try {
    const result = await calendar.events.patch({
      calendarId: GOOGLE_CALENDAR_ID,
      eventId: session.calendarEventId,
      requestBody: {
        summary: updatedSummary,
        description: [
          `Nome: ${session.name || ""}`,
          `Persone: ${session.people || ""}`,
          `Note: ${buildSpecialRequestsText(session)}`,
          `Preordine: ${session.preorderLabel || "nessuno"}`,
          "Tavolo: ",
          `Telefono: ${session.phone || "non fornito"}`,
        ].join("\n"),
      },
    });
    if (session.dateISO) {
      await upsertAvailabilityEvent(session.dateISO);
    }
    return result?.data || null;
  } catch (err) {
    console.error("[GOOGLE] Calendar cancel update failed:", err);
    return null;
  }
}

async function createCalendarEvent(session) {
  if (!GOOGLE_CALENDAR_ID) return null;
  const calendar = buildCalendarClient();
  if (!calendar) return null;
  if (!session?.dateISO || !session?.time24 || !session?.name || !session?.people) return null;

  const reservation = await reserveTableForSession(session, { commit: true });
  if (reservation.status === "closed") return { status: "closed" };
  if (reservation.status === "unavailable") return { status: "unavailable" };

  const startDateTime = `${session.dateISO}T${session.time24}:00`;
  const endDate = new Date(`${session.dateISO}T${session.time24}:00`);
  endDate.setMinutes(endDate.getMinutes() + (session.durationMinutes || 120));
  const endDateTime = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-${String(
    endDate.getDate()
  ).padStart(2, "0")}T${String(endDate.getHours()).padStart(2, "0")}:${String(
    endDate.getMinutes()
  ).padStart(2, "0")}:00`;

  const tableLabel = session.tableLocks?.length
    ? session.tableLocks.join(" e ")
    : session.tableDisplayId || "da assegnare";
  const descriptionLines = [
    `Nome: ${session.name}`,
    `Persone: ${session.people}`,
    `Note: ${buildSpecialRequestsText(session)}`,
    `Preordine: ${session.preorderLabel || "nessuno"}`,
    `Tavolo: ${tableLabel}`,
    `Telefono: ${session.phone || "non fornito"}`,
  ];
  if (session.requiresFollowUp === true) {
    descriptionLines.push("⚠️ Richiesta cliente: RICONTATTO NECESSARIO");
    descriptionLines.push("Richieste particolari:");
    descriptionLines.push(`${session.extraRequestsRaw || ""}`);
  }
  const event = {
    summary: `Ore ${session.time24}, tav ${tableLabel}, ${session.name}, ${session.people} pax`,
    description: descriptionLines.join("\n"),
    start: { dateTime: startDateTime, timeZone: GOOGLE_CALENDAR_TZ },
    end: { dateTime: endDateTime, timeZone: GOOGLE_CALENDAR_TZ },
  };
  if (session.requiresFollowUp === true) {
    event.colorId = "5";
  } else if (session.criticalReservation) {
    event.colorId = CRITICAL_COLOR_ID;
  }

  try {
    const result = await calendar.events.insert({
      calendarId: GOOGLE_CALENDAR_ID,
      requestBody: event,
    });
    const data = result?.data || null;
    if (data?.id) {
      session.calendarEventId = data.id;
      session.calendarEventSummary = data.summary || event.summary;
    }
    session.bookingCompleted = true;
    await upsertAvailabilityEvent(session.dateISO);
    return data;
  } catch (err) {
    console.error("[GOOGLE] Calendar insert failed:", err);
    return null;
  }
}

async function createEventCalendarEvent(session) {
  if (!GOOGLE_CALENDAR_ID) return null;
  const calendar = buildCalendarClient();
  if (!calendar) return null;
  if (!session?.eventDateISO || !session?.eventTime24 || !session?.eventName) return null;

  const startDateTime = `${session.eventDateISO}T${session.eventTime24}:00`;
  const endDate = new Date(`${session.eventDateISO}T${session.eventTime24}:00`);
  endDate.setMinutes(endDate.getMinutes() + 120);
  const endDateTime = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-${String(
    endDate.getDate()
  ).padStart(2, "0")}T${String(endDate.getHours()).padStart(2, "0")}:${String(
    endDate.getMinutes()
  ).padStart(2, "0")}:00`;

  const event = {
    summary: `Evento - ${session.eventName}`,
    description: [
      `Nome evento: ${session.eventName}`,
      `Data: ${session.eventDateISO}`,
      `Ora: ${session.eventTime24}`,
    ].join("\n"),
    start: { dateTime: startDateTime, timeZone: GOOGLE_CALENDAR_TZ },
    end: { dateTime: endDateTime, timeZone: GOOGLE_CALENDAR_TZ },
    extendedProperties: {
      private: {
        type: "evento",
      },
    },
  };

  try {
    const result = await calendar.events.insert({
      calendarId: GOOGLE_CALENDAR_ID,
      requestBody: event,
    });
    return result?.data || null;
  } catch (err) {
    console.error("[GOOGLE] Event insert failed:", err);
    return null;
  }
}

async function createFailedCallCalendarEvent(session, req, reason) {
  if (!session) return null;
  if (session.bookingCompleted === true || session.fallbackEventCreated === true) return null;
  if (!GOOGLE_CALENDAR_ID) {
    session.fallbackEventCreated = true;
    return null;
  }
  const calendar = buildCalendarClient();
  if (!calendar) {
    session.fallbackEventCreated = true;
    return null;
  }
  try {
    const todayISO = toISODate(new Date());
    const lines = [];
    const phone = req?.body?.From;
    if (phone !== undefined && phone !== null) lines.push(`Telefono: ${phone}`);
    const name = session?.name;
    if (name !== undefined && name !== null) lines.push(`Nome: ${name}`);
    const dateISO = session?.dateISO;
    if (dateISO !== undefined && dateISO !== null) lines.push(`Data richiesta: ${dateISO}`);
    const time24 = session?.time24;
    if (time24 !== undefined && time24 !== null) lines.push(`Orario richiesto: ${time24}`);
    const people = session?.people;
    if (people !== undefined && people !== null) lines.push(`Persone: ${people}`);
    const intent = session?.intent;
    if (intent !== undefined && intent !== null) lines.push(`Tipo richiesta: ${intent}`);
    const preordine = session?.preorderLabel;
    if (preordine !== undefined && preordine !== null) lines.push(`Preordine: ${preordine}`);
    const notes = buildSpecialRequestsText(session);
    if (notes) lines.push(`Note: ${notes}`);
    if (reason) lines.push(`Motivo: ${reason}`);
    const event = {
      summary: `Chiamata interrotta ${todayISO}`,
      description: lines.join("\n"),
      start: { dateTime: `${todayISO}T00:00:00`, timeZone: GOOGLE_CALENDAR_TZ },
      end: { dateTime: `${todayISO}T00:30:00`, timeZone: GOOGLE_CALENDAR_TZ },
    };
    const insertResult = await calendar.events.insert({
      calendarId: GOOGLE_CALENDAR_ID,
      requestBody: event,
    });
    session.fallbackEventCreated = true;
    return insertResult?.data || null;
  } catch (err) {
    console.error("[GOOGLE] Failed call calendar insert failed:", err);
    session.fallbackEventCreated = true;
    return null;
  }
}

async function safeCreateFailedCallCalendarEvent(session, req, reason) {
  try {
    return await createFailedCallCalendarEvent(session, req, reason);
  } catch (err) {
    console.error("[GOOGLE] Failed call calendar creation error:", err);
    return null;
  }
}

// ======================= PROMPTS (STATIC) =======================
function buildDayLabel(dateISO) {
  return formatDateLabel(dateISO);
}

function tYesNo(fallback) {
  return fallback;
}

function tWantsOutside(defaultValue) {
  return defaultValue;
}

function tSplitConfirm(defaultValue) {
  return defaultValue;
}

// ======================= PROMPTS (AUTO) =======================
function promptWithOffer(vr, session, prompt) {
  if (!session?.name) return gatherSpeech(vr, prompt);
  const offer = `Ti va di fare una prenotazione con ${session.name}?`;
  gatherSpeech(vr, `${offer} ${prompt}`);
}

function maybeAskOutside(session, vr) {
  if (!session?.pendingOutsideConfirm) return false;
  if (session?.outsideRequired) {
    gatherSpeech(
      vr,
      "Ti ricordo che la sala esterna è senza copertura e con maltempo non posso garantire un tavolo all'interno. Confermi?"
    );
    return true;
  }
  return false;
}

// ======================= STATIC PROMPTS =======================
const FALLBACK_PROMPTS = {
  intent: {
    main: "Dimmi se vuoi prenotare un tavolo o avere informazioni.",
    short: "Vuoi prenotare o chiedere informazioni?",
  },
};

function tFallbackPrompt(path, fallback = "") {
  const parts = String(path || "").split(".");
  let node = FALLBACK_PROMPTS;
  for (const p of parts) {
    if (!node || typeof node !== "object" || !(p in node)) return fallback;
    node = node[p];
  }
  return typeof node === "string" ? node : fallback;
}

function tFallback(path, vars = {}, fallback = "") {
  return renderTemplate(tFallbackPrompt(path, fallback), vars);
}

// ======================= PROMPTS (SIMPLE) =======================
const PROMPTS_SIMPLE = {
  intent: {
    main: "Buongiorno! Sono l'assistente virtuale di Tutti Brilli. Vuoi prenotare o chiedere informazioni?",
  },
};

function tSimple(path, vars = {}, fallback = "") {
  return renderTemplate(pickPrompt(path, fallback), vars);
}

// ======================= PROMPTS (DEFAULT) =======================
const PROMPTS_DEFAULT = {
  intent: {
    main: "Buongiorno! Sono l'assistente virtuale di Tutti Brilli. Vuoi prenotare o chiedere informazioni?",
  },
  step1_welcome_name: {
    main: "Perfetto. Come ti chiami?",
    short: "Come ti chiami?",
  },
  step2_confirm_name_ask_date: {
    main: "Piacere {{name}}. Per quale giorno vuoi prenotare?",
  },
  step3_confirm_date_ask_time: {
    main: "Perfetto. A che ora vuoi prenotare?",
  },
  step4_ask_party_size: {
    main: "In quante persone siete?",
  },
  step5_party_size_ask_notes: {
    main: "Perfetto. Hai intolleranze o esigenze particolari?",
  },
  step6_preorder: {
    main: "Vuoi preordinare qualcosa dal menù? Puoi dire: cena, apericena, dopocena, piatto apericena, oppure piatto apericena promo. Se non vuoi, dì nessuno.",
  },
  step7_tables_split: {
    main: "Non abbiamo più disponibilità per un unico tavolo. Posco sistemarvi in tavoli separati?",
  },
  step8_phone: {
    main: "Perfetto. Mi lasci un numero di telefono? Se è italiano, aggiungo io il +39.",
  },
  step8_summary_confirm: {
    main: "Perfetto {{name}}, confermi la prenotazione per {{dateLabel}} alle {{time}} per {{partySize}} persone?",
    short: "Confermi la prenotazione per {{dateLabel}} alle {{time}} per {{partySize}} persone?",
  },
  step9_success: {
    main: "Grazie! La prenotazione è stata confermata. A presto!",
  },
  step9_fallback_transfer_operator: {
    main: "Mi dispiace, non riesco a completare la richiesta. Ti passerò un operatore.",
  },
};

function getPrompt(path) {
  const parts = String(path || "").split(".");
  let node = PROMPTS_DEFAULT;
  for (const p of parts) {
    if (!node || typeof node !== "object" || !(p in node)) return null;
    node = node[p];
  }
  return typeof node === "string" ? node : null;
}

function tDefault(path, vars = {}, fallback = "") {
  const prompt = getPrompt(path);
  return renderTemplate(prompt || fallback, vars);
}

// ======================= MAIN PROMPTS =======================
function getVoicePrompt(path) {
  const overrides = PROMPTS;
  const parts = String(path || "").split(".");
  let node = overrides;
  for (const p of parts) {
    if (!node || typeof node !== "object" || !(p in node)) {
      node = null;
      break;
    }
    node = node[p];
  }
  if (typeof node === "string") return node;

  const fallback = getPrompt(path);
  if (fallback) return fallback;

  return tFallback(path, {}, "");
}

function tMain(path, vars = {}, fallback = "") {
  return renderTemplate(getVoicePrompt(path) || fallback, vars);
}

// ======================= PROMPTS DISPATCH =======================
function t(path, vars = {}, fallback = "") {
  return tMain(path, vars, fallback);
}

// ======================= VOICE HANDLER =======================
async function handleVoiceRequest(req, res) {
  const session = getSession(req.body?.CallSid);
  const vr = buildTwiml();
  try {
    maybeWarnMissingEnv();
    const speech = req.body.SpeechResult || "";
    const language = req.body.SpeechResultConfidence ? "it-IT" : "it-IT";
    const emptySpeech = !normalizeText(speech);

    if (!session) {
      if (canForwardToHuman()) {
        await sendFallbackEmail(session, req, "session_error");
        void sendOperatorEmail(session, req, "session_error");
        res.set("Content-Type", "text/xml; charset=utf-8");
        await safeCreateFailedCallCalendarEvent(session, req, "errore di sistema");
        return res.send(forwardToHumanTwiml());
      }
      sayIt(vr, t("step9_fallback_transfer_operator.main"));
      await safeCreateFailedCallCalendarEvent(session, req, "fallback");
      vr.hangup();
      res.set("Content-Type", "text/xml; charset=utf-8");
      return res.send(vr.toString());
    }

    if (!emptySpeech && isOperatorRequest(speech)) {
      if (canForwardToHuman()) {
        await sendFallbackEmail(session, req, "operator_request");
        void sendOperatorEmail(session, req, "operator_request");
        res.set("Content-Type", "text/xml; charset=utf-8");
        await safeCreateFailedCallCalendarEvent(session, req, "richiesta operatore");
        return res.send(forwardToHumanTwiml());
      }
    }

    if (session.step !== "intent" && !emptySpeech && isCancelCommand(speech)) {
      if (canForwardToHuman()) {
        await sendFallbackEmail(session, req, "cancel_request_forward");
        void sendOperatorEmail(session, req, "cancel_request_forward");
        res.set("Content-Type", "text/xml; charset=utf-8");
        await safeCreateFailedCallCalendarEvent(session, req, "richiesta operatore");
        return res.send(forwardToHumanTwiml());
      }
      sayIt(vr, "Va bene, annullo la prenotazione. Se hai bisogno di altro, chiamami pure.");
      vr.hangup();
      res.set("Content-Type", "text/xml; charset=utf-8");
      return res.send(vr.toString());
    }

    if (session.step !== "intent" && !emptySpeech && isBackCommand(speech)) {
      resetRetries(session);
      goBack(session);
      promptForStep(vr, session);
      res.set("Content-Type", "text/xml; charset=utf-8");
      return res.send(vr.toString());
    }

    if (session.step === "intent") {
      if (emptySpeech) {
        const silenceResult = handleSilence(session, vr, () => gatherSpeech(vr, tFallback("intent.main")));
        if (silenceResult.action === "forward") {
          await sendFallbackEmail(session, req, "intent_retry_exhausted");
          void sendOperatorEmail(session, req, "intent_retry_exhausted");
          res.set("Content-Type", "text/xml; charset=utf-8");
          await safeCreateFailedCallCalendarEvent(session, req, "fallback");
          return res.send(forwardToHumanTwiml());
        }
        break;
      }

      const normalized = normalizeText(speech);

      if (normalized.includes("prenot")) {
        session.intent = "prenotazione";
        session.step = 1;
        gatherSpeech(vr, t("step1_welcome_name.main"));
        break;
      }

      if (normalized.includes("info") || normalized.includes("informaz") || normalized.includes("evento")) {
        session.intent = "informazioni";
        session.step = "info";
        session.intentWelcomed = true;
        gatherSpeech(vr, "Cosa vuoi sapere?");
        break;
      }

      const infoResponse = await getInfoResponse({ speech, locale: language });
      if (infoResponse) {
        sayIt(vr, infoResponse);
        gatherSpeech(vr, tFallback("intent.short"));
        break;
      }

      const confirmation = parseYesNo(speech);
      if (confirmation === null) {
        session.intentRetries += 1;
        if (session.intentRetries >= 2 && canForwardToHuman()) {
          await sendFallbackEmail(session, req, "intent_retry_exhausted");
          void sendOperatorEmail(session, req, "intent_retry_exhausted");
          res.set("Content-Type", "text/xml; charset=utf-8");
          await safeCreateFailedCallCalendarEvent(session, req, "fallback");
          return res.send(forwardToHumanTwiml());
        }
        gatherSpeech(vr, tFallback("intent.main"));
        break;
      }

      if (confirmation) {
        session.intent = "prenotazione";
        session.step = 1;
        gatherSpeech(vr, t("step1_welcome_name.main"));
        break;
      }

      session.intent = "informazioni";
      session.step = "info";
      session.intentWelcomed = true;
      gatherSpeech(vr, "Cosa vuoi sapere?");
      break;
    }

    if (session.step === "info") {
      if (emptySpeech) {
        const silenceResult = handleSilence(session, vr, () => gatherSpeech(vr, "Che informazioni ti servono?"));
        if (silenceResult.action === "forward") {
          await sendFallbackEmail(session, req, "info_request");
          void sendOperatorEmail(session, req, "info_request");
          res.set("Content-Type", "text/xml; charset=utf-8");
          await safeCreateFailedCallCalendarEvent(session, req, "fallback");
          return res.send(forwardToHumanTwiml());
        }
        break;
      }

      const infoResponse = await getInfoResponse({ speech, locale: language });
      if (infoResponse) {
        sayIt(vr, infoResponse);
        gatherSpeech(vr, "Posso aiutarti con altro?");
        break;
      }

      const normalized = normalizeText(speech);
      if (normalized.includes("prenot")) {
        session.intent = "prenotazione";
        session.step = 1;
        gatherSpeech(vr, t("step1_welcome_name.main"));
        break;
      }

      if (normalized.includes("no") || normalized.includes("grazie")) {
        sayIt(vr, "Va bene, buona giornata!");
        vr.hangup();
        res.set("Content-Type", "text/xml; charset=utf-8");
        return res.send(vr.toString());
      }

      gatherSpeech(vr, "Non ho trovato l'informazione, puoi ripetere?");
      break;
    }

    switch (session.step) {
      case 1: {
        if (emptySpeech) {
          const silenceResult = handleSilence(session, vr, () =>
            gatherSpeech(vr, t("step1_welcome_name.short"))
          );
          if (silenceResult.action === "forward") {
            await sendFallbackEmail(session, req, "silence_step1");
            void sendOperatorEmail(session, req, "silence_step1");
            res.set("Content-Type", "text/xml; charset=utf-8");
            await safeCreateFailedCallCalendarEvent(session, req, "fallback");
            return res.send(forwardToHumanTwiml());
          }
          break;
        }
        session.name = speech.trim().slice(0, 60);
        resetRetries(session);
        session.step = 2;
        gatherSpeech(vr, t("step2_confirm_name_ask_date.main", { name: session.name || "" }));
        break;
      }

      case 2: {
        if (emptySpeech) {
          const silenceResult = handleSilence(session, vr, () =>
            gatherSpeech(vr, t("step2_confirm_name_ask_date.main", { name: session.name || "" }))
          );
          if (silenceResult.action === "forward") {
            await sendFallbackEmail(session, req, "silence_step2");
            void sendOperatorEmail(session, req, "silence_step2");
            res.set("Content-Type", "text/xml; charset=utf-8");
            await safeCreateFailedCallCalendarEvent(session, req, "fallback");
            return res.send(forwardToHumanTwiml());
          }
          break;
        }
        const dateISO = parseDateIT(speech);
        if (!dateISO) {
          gatherSpeech(vr, "Scusami, non ho capito la data. Puoi ripeterla?");
          break;
        }
        session.dateISO = dateISO;
        session.dateLabel = formatDateLabel(dateISO);
        session.durationMinutes = computeBookingDuration(session);
        resetRetries(session);
        session.step = 3;
        gatherSpeech(vr, "Perfetto. In quante persone siete?");
        break;
      }

      case 3: {
        if (emptySpeech) {
          const silenceResult = handleSilence(session, vr, () =>
            gatherSpeech(vr, "Scusami, non ho capito quante persone. Puoi ripeterlo?")
          );
          if (silenceResult.action === "forward") {
            await sendFallbackEmail(session, req, "silence_step3");
            void sendOperatorEmail(session, req, "silence_step3");
            res.set("Content-Type", "text/xml; charset=utf-8");
            await safeCreateFailedCallCalendarEvent(session, req, "fallback");
            return res.send(forwardToHumanTwiml());
          }
          break;
        }
        const people = parsePeopleIT(speech);
        if (!people) {
          gatherSpeech(vr, "Scusami, non ho capito in quante persone. Puoi ripeterlo?");
          break;
        }
        session.people = people;
        resetRetries(session);
        session.step = 4;
        gatherSpeech(vr, t("step3_confirm_date_ask_time.main", { dateLabel: session.dateLabel || "" }));
        break;
      }

      case 4: {
        if (emptySpeech) {
          const silenceResult = handleSilence(session, vr, () =>
            gatherSpeech(vr, t("step3_confirm_date_ask_time.main", { dateLabel: session.dateLabel || "" }))
          );
          if (silenceResult.action === "forward") {
            await sendFallbackEmail(session, req, "silence_step4");
            void sendOperatorEmail(session, req, "silence_step4");
            res.set("Content-Type", "text/xml; charset=utf-8");
            await safeCreateFailedCallCalendarEvent(session, req, "fallback");
            return res.send(forwardToHumanTwiml());
          }
          break;
        }
        const time24 = parseTimeIT(speech);
        if (!time24) {
          gatherSpeech(vr, "Scusami, non ho capito l'orario. Puoi ripeterlo?");
          break;
        }
        session.time24 = time24;
        session.liveMusicNoticePending = true;
        resetRetries(session);
        session.step = 5;
        gatherSpeech(vr, t("step5_party_size_ask_notes.main", { partySize: session.people || "" }));
        break;
      }

      case 5: {
        if (emptySpeech) {
          const silenceResult = handleSilence(session, vr, () =>
            gatherSpeech(vr, t("step5_party_size_ask_notes.main", { partySize: session.people || "" }))
          );
          if (silenceResult.action === "forward") {
            await sendFallbackEmail(session, req, "silence_step5");
            void sendOperatorEmail(session, req, "silence_step5");
            res.set("Content-Type", "text/xml; charset=utf-8");
            await safeCreateFailedCallCalendarEvent(session, req, "fallback");
            return res.send(forwardToHumanTwiml());
          }
          break;
        }
        if (isPureConsent(speech)) {
          gatherSpeech(vr, "Dimmi pure le intolleranze o la richiesta.");
          break;
        }
        session.specialRequestsRaw = emptySpeech ? "nessuna" : speech.trim().slice(0, 200);
        if (hasGlutenIntolerance(session.specialRequestsRaw)) {
          session.glutenPiattoNotice = true;
        }
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
          const silenceResult = handleSilence(session, vr, () =>
            gatherSpeech(
              vr,
              "Vuoi preordinare qualcosa dal menù? Puoi dire: cena, apericena, dopocena, piatto apericena, oppure piatto apericena promo. Se non vuoi, dì nessuno."
            )
          );
          if (silenceResult.action === "forward") {
            await sendFallbackEmail(session, req, "silence_step6");
            void sendOperatorEmail(session, req, "silence_step6");
            res.set("Content-Type", "text/xml; charset=utf-8");
            await safeCreateFailedCallCalendarEvent(session, req, "fallback");
            return res.send(forwardToHumanTwiml());
          }
          break;
        }
        const normalized = normalizeText(speech);
        if (normalized.includes("nessun") || normalized.includes("no")) {
          session.preorderChoiceKey = null;
          session.preorderLabel = "nessuno";
          resetRetries(session);
          session.step = 7;
          const result = await reserveTableForSession(session, { commit: false });
          if (result.status === "invalid_time") {
            session.step = 4;
            gatherSpeech(vr, "Mi dispiace, quell'orario non è disponibile. Vuoi provare un altro orario?");
            break;
          }
          if (result.status === "closed") {
            session.step = 2;
            gatherSpeech(vr, "Mi dispiace, risulta che quel giorno il locale è chiuso. Vuoi scegliere un'altra data?");
            break;
          }
          if (result.status === "unavailable") {
            session.step = 7;
            session.forceOperatorFallback = false;
            session.splitRequired = true;
            gatherSpeech(vr, "Non abbiamo più disponibilità per un unico tavolo. Posco sistemarvi in tavoli separati?");
            break;
          }
          session.step = 8;
          gatherSpeech(vr, "Perfetto. Mi lasci un numero di telefono? Se è italiano, aggiungo io il +39.");
          break;
        }
        const preorderOption = PREORDER_OPTIONS.find((opt) => normalizeText(opt.label) === normalized);
        if (!preorderOption) {
          gatherSpeech(
            vr,
            "Scusami, non ho capito. Puoi dire: cena, apericena, dopocena, piatto apericena, oppure piatto apericena promo. Se non vuoi, dì nessuno."
          );
          break;
        }
        session.preorderChoiceKey = preorderOption.key;
        session.preorderLabel = preorderOption.label;
        if (preorderOption.constraints.promoOnly) {
          session.promoEligible = false;
          session.promoRegistrationNotice = true;
        }
        if (preorderOption.key === "piatto_apericena") {
          session.glutenPiattoNotice = true;
        }
        resetRetries(session);
        session.step = 7;

        const reservationCheck = await reserveTableForSession(session, { commit: false });
        if (reservationCheck.status === "invalid_time") {
          session.step = 4;
          gatherSpeech(vr, "Mi dispiace, quell'orario non è disponibile. Vuoi provare un altro orario?");
          break;
        }
        if (reservationCheck.status === "closed") {
          session.step = 2;
          gatherSpeech(vr, "Mi dispiace, risulta che quel giorno il locale è chiuso. Vuoi scegliere un'altra data?");
          break;
        }
        if (reservationCheck.status === "unavailable") {
          session.step = 7;
          session.forceOperatorFallback = false;
          session.splitRequired = true;
          gatherSpeech(vr, "Non abbiamo più disponibilità per un unico tavolo. Posco sistemarvi in tavoli separati?");
          break;
        }
        session.step = 8;
        gatherSpeech(vr, "Perfetto. Mi lasci un numero di telefono? Se è italiano, aggiungo io il +39.");
        break;
      }

      case 7: {
        if (emptySpeech) {
          const silenceResult = handleSilence(session, vr, () => {
            if (session.outsideRequired) {
              gatherSpeech(
                vr,
                "Ti ricordo che la sala esterna è senza copertura e con maltempo non posso garantire un tavolo all'interno. Confermi?"
              );
            } else {
              gatherSpeech(vr, "Posco sistemarvi in tavoli separati? Se preferisci, ti passo un operatore.");
            }
          });
          if (silenceResult.action === "forward") {
            await sendFallbackEmail(session, req, "silence_step7");
            void sendOperatorEmail(session, req, "silence_step7");
            res.set("Content-Type", "text/xml; charset=utf-8");
            await safeCreateFailedCallCalendarEvent(session, req, "fallback");
            return res.send(forwardToHumanTwiml());
          }
          break;
        }
        if (session.outsideRequired) {
          const confirmation = parseYesNo(speech);
          if (confirmation === null) {
            gatherSpeech(
              vr,
              "Ti ricordo che la sala esterna è senza copertura e con maltempo non posso garantire un tavolo all'interno. Confermi?"
            );
            break;
          }
          if (!confirmation) {
            session.forceOperatorFallback = true;
            session.step = 7;
            gatherSpeech(vr, "Posco sistemarvi in tavoli separati? Se preferisci, ti passo un operatore.");
            break;
          }
          resetRetries(session);
          session.step = 8;
          gatherSpeech(vr, "Perfetto. Mi lasci un numero di telefono? Se è italiano, aggiungo io il +39.");
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
            await safeCreateFailedCallCalendarEvent(session, req, "richiesta operatore");
            return res.send(forwardToHumanTwiml());
          }
          sayIt(vr, t("step9_fallback_transfer_operator.main"));
          await safeCreateFailedCallCalendarEvent(session, req, "fallback");
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
            await safeCreateFailedCallCalendarEvent(session, req, "fallback");
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
        gatherSpeech(vr, "Hai altre richieste particolari?");
        break;
      }

      case 9: {
        const normalized = normalizeText(speech);
        if (emptySpeech || normalized === "nessuna") {
          session.extraRequestsRaw = "nessuna";
          session.requiresFollowUp = false;
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
        const confirmation = parseYesNo(speech);
        if (confirmation === false) {
          session.extraRequestsRaw = "nessuna";
          session.requiresFollowUp = false;
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
        if (isPureConsent(speech) && !session.extraRequestsPrompted) {
          session.extraRequestsPrompted = true;
          gatherSpeech(vr, "Quali sono queste richieste?");
          break;
        }
        session.extraRequestsRaw = speech;
        if (session.extraRequestsRaw && session.extraRequestsRaw !== "nessuna") {
          session.requiresFollowUp = true;
        } else {
          session.requiresFollowUp = false;
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
            await safeCreateFailedCallCalendarEvent(session, req, "fallback");
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
            await safeCreateFailedCallCalendarEvent(session, req, "fallback");
            return res.send(forwardToHumanTwiml());
          }
          if (session.forceOperatorFallback) {
            sayIt(vr, t("step9_fallback_transfer_operator.main"));
            await safeCreateFailedCallCalendarEvent(session, req, "fallback");
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
          await safeCreateFailedCallCalendarEvent(session, req, "errore di sistema");
          return res.send(forwardToHumanTwiml());
        }
        if (calendarEvent && session.requiresFollowUp === true) {
          void sendOperatorEmail(session, req, "requires_follow_up");
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
          await safeCreateFailedCallCalendarEvent(session, req, "errore di sistema");
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
    await safeCreateFailedCallCalendarEvent(session, req, "errore di sistema");
    void sendFallbackEmailSmtpOnly(session, req, "exception");
    if (canForwardToHuman()) {
      void sendOperatorEmail(session, req, "exception");
      res.set("Content-Type", "text/xml; charset=utf-8");
      await safeCreateFailedCallCalendarEvent(session, req, "errore di sistema");
      return res.send(forwardToHumanTwiml());
    }
    sayIt(vr, t("step9_fallback_transfer_operator.main"));
    await safeCreateFailedCallCalendarEvent(session, req, "fallback");
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

app.use((err, req, res, next) => {
  safeCreateFailedCallCalendarEvent(getSession(req.body?.CallSid), req, "errore di sistema");
  next();
});

app.listen(PORT, () => {
  console.log(`Voice assistant running on port ${PORT}`);
});
