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
// ======================= OPENAI (per risposte intelligenti su WhatsApp) =======================
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const AI_ENABLED = (process.env.AI_ENABLED || "true").toLowerCase() === "true";
const AI_MAX_OUTPUT_TOKENS = Number(process.env.AI_MAX_OUTPUT_TOKENS || 250);
const BUSINESS_NAME = process.env.BUSINESS_NAME || "TuttiBrilli";
const BUSINESS_CONTEXT = process.env.BUSINESS_CONTEXT || "";
const GOOGLE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || "";
const GOOGLE_CALENDAR_TZ = process.env.GOOGLE_CALENDAR_TZ || "Europe/Rome";
const GOOGLE_SERVICE_ACCOUNT_JSON_B64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64 || "";
const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";

const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.EMAIL_USER || process.env.SMTP_USER || "";
const SMTP_PASS = process.env.EMAIL_PASS || process.env.SMTP_PASS || "";
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

function gatherSpeech(response, promptText, opts = {}) {
  const actionUrl = BASE_URL ? `${BASE_URL}/twilio/voice` : "/twilio/voice";
  const gather = response.gather({
    input: opts.input || "speech",
    language: "it-IT",
    speechTimeout: opts.speechTimeout || "auto",
    timeout: Number.isFinite(Number(opts.timeout)) ? Number(opts.timeout) : 5,
    enhanced: true,
    speechModel: "phone_call",
    action: actionUrl,
    method: "POST",
  });
  gather.say({ language: "it-IT" }, xmlEscape(promptText));
  response.redirect({ method: "POST" }, actionUrl);
}

function isValidPhoneE164(s) {
  return /^\+\d{8,15}$/.test(String(s || "").trim());
}
function getOperatorPhoneE164() {
  if (!OPERATOR_PHONE) return null;
  return parsePhoneNumber(OPERATOR_PHONE);
}
function canForwardToHuman() {
  return ENABLE_FORWARDING && Boolean(getOperatorPhoneE164());
}

function requireTwilioVoiceFrom() {
  if (!TWILIO_VOICE_FROM) {
    throw new Error("TWILIO_VOICE_FROM is not set");
  }
  return TWILIO_VOICE_FROM;
}
function forwardToHumanTwiml(req) {
  const vr = buildTwiml();
  sayIt(vr, t("step9_fallback_transfer_operator.main"));

  const operatorPhone = getOperatorPhoneE164();
  if (operatorPhone) {
    const actionUrl = BASE_URL ? `${BASE_URL}/twilio/voice/after-dial` : "/twilio/voice/after-dial";

    const dialAttrs = { timeout: 25, action: actionUrl, method: "POST", answerOnBridge: true };

    // callerId stabile (preferisci numero Twilio; fallback: numero chiamato in ingresso)
    const candidates = [];
    if (isValidPhoneE164(TWILIO_VOICE_FROM)) candidates.push(TWILIO_VOICE_FROM.trim());
    const inboundTo = req?.body?.To || req?.body?.Called || "";
    const inboundToE164 = parsePhoneNumber(inboundTo);
    if (isValidPhoneE164(inboundToE164)) candidates.push(inboundToE164);
    if (candidates.length > 0) dialAttrs.callerId = candidates[0];

    vr.dial(dialAttrs, operatorPhone);
  }

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

async function sendEmailWithResend({ to, subject, text, fromOverride }) {
  try {
    if (!RESEND_API_KEY) {
      console.error("[EMAIL] RESEND_API_KEY is not set");
      return { ok: false, status: 0, error: "missing_api_key" };
    }

    const fromValue = (fromOverride || EMAIL_FROM || "").trim();
    const body = {
      from: fromValue || "onboarding@resend.dev",
      to: [String(to || "").trim()],
      subject: String(subject || ""),
      text: String(text || ""),
    };

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.error("[EMAIL] Resend failed:", response.status, errorText);
      return { ok: false, status: response.status, error: errorText };
    }

    return { ok: true, status: response.status };
  } catch (err) {
    console.error("[EMAIL] Resend failed:", err);
    return { ok: false, status: 0, error: String(err && err.message ? err.message : err) };
  }
}

async function sendFallbackEmail(session, req, reason) {
  const payload = buildFallbackEmailPayload(session, req, reason);

  // 1) Prova Resend (se configurato)
  if ((EMAIL_PROVIDER || "").toLowerCase() === "resend") {
    const r = await sendEmailWithResend({
      to: EMAIL_TO,
      subject: payload.subject,
      text: payload.text,
      fromOverride: EMAIL_FROM,
    });
    if (r && r.ok) return;

    // Se Resend è in modalità testing (403) o fallisce, fallback SMTP
    await sendFallbackEmailSmtpOnly(session, req, reason);
    return;
  }

  // 2) SMTP
  await sendFallbackEmailSmtpOnly(session, req, reason);
}

async function sendFallbackEmailSmtpOnly(session, req, reason) {
  if (!SMTP_HOST) {
    console.error("[EMAIL] SMTP_HOST is not set (fallback email not sent)");
    return;
  }
  const payload = buildFallbackEmailPayload(session, req, reason);
  try {
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
  const payload = {
    subject: "Inoltro operatore - contesto prenotazione",
    text: [
      `Numero cliente: ${caller}`,
      `Tipo richiesta: ${requestType || "non specificato"}`,
      `Nome cliente: ${session?.name || ""}`,
      `Data: ${session?.dateISO || ""}`,
      `Ora: ${session?.time24 || ""}`,
      `Persone: ${session?.people || ""}`,
      `Richieste: ${buildSpecialRequestsText(session)}`,
      `Stato flusso: ${state}`,
      `Motivo inoltro: ${reason || "non specificato"}`,
    ].join("\n"),
  };
  return payload;
}

async function sendOperatorEmail(session, req, reason) {
  const payload = buildOperatorEmailPayload(session, req, reason);
  const toOperator = String(EMAIL_OPERATOR || EMAIL_TO || "").trim();
  if (!toOperator) {
    console.error("[EMAIL] EMAIL_OPERATOR/EMAIL_TO not set");
    return;
  }

  // 1) Prova Resend (se configurato)
  if ((EMAIL_PROVIDER || "").toLowerCase() === "resend") {
    const r = await sendEmailWithResend({
      to: toOperator,
      subject: payload.subject,
      text: payload.text,
      fromOverride: EMAIL_FROM,
    });
    if (r && r.ok) return;

    // fallback SMTP
    await sendOperatorEmailSmtpOnly(session, req, reason);
    return;
  }

  // 2) SMTP
  await sendOperatorEmailSmtpOnly(session, req, reason);
}

async function sendOperatorEmailSmtpOnly(session, req, reason) {
  if (!SMTP_HOST) {
    console.error("[EMAIL] SMTP_HOST is not set (operator email not sent)");
    return;
  }
  const payload = buildOperatorEmailPayload(session, req, reason);
  const toOperator = String(EMAIL_OPERATOR || EMAIL_TO || "").trim();
  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    });
    await transporter.sendMail({
      from: EMAIL_FROM,
      to: toOperator,
      cc: EMAIL_TO && EMAIL_TO !== toOperator ? EMAIL_TO : undefined,
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

function pad2(n) {
  return String(n).padStart(2, "0");
}

function getPartsInTimeZone(date, timeZone) {
  const d = date instanceof Date ? date : new Date(date);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const map = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function formatISODateInTimeZone(date, timeZone) {
  try {
    const p = getPartsInTimeZone(date, timeZone);
    if (!p.year) throw new Error("bad parts");
    return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
  } catch {
    const d = date instanceof Date ? date : new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
}

function formatTimeInTimeZone(date, timeZone) {
  const p = getPartsInTimeZone(date, timeZone);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

function makeUtcDateFromZoned(dateISO, time24, timeZone) {
  const [y, m, d] = String(dateISO || "").split("-").map((n) => Number(n));
  const [hh, mm] = String(time24 || "").split(":").map((n) => Number(n));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const H = Number.isFinite(hh) ? hh : 0;
  const M = Number.isFinite(mm) ? mm : 0;

  const naiveUtcMs = Date.UTC(y, m - 1, d, H, M, 0);
  const approx = new Date(naiveUtcMs);
  const local = getPartsInTimeZone(approx, timeZone);
  const asUtcMs = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  const offsetMs = asUtcMs - approx.getTime();
  return new Date(naiveUtcMs - offsetMs);
}

function addDaysToISODate(dateISO, days) {
  const [y, m, d] = String(dateISO || "").split("-").map((n) => Number(n));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const ms = Date.UTC(y, m - 1, d, 12, 0, 0);
  const next = new Date(ms + Number(days || 0) * 86400000);
  const yy = next.getUTCFullYear();
  const mm = pad2(next.getUTCMonth() + 1);
  const dd = pad2(next.getUTCDate());
  return `${yy}-${mm}-${dd}`;
}

function computeEndDateTime(dateISO, time24, durationMinutes, timeZone) {
  const startUtc = makeUtcDateFromZoned(dateISO, time24, timeZone);
  if (!startUtc) return null;
  const endUtc = new Date(startUtc.getTime() + (Number(durationMinutes) || 120) * 60000);
  const endDateISO = formatISODateInTimeZone(endUtc, timeZone);
  const endTime24 = formatTimeInTimeZone(endUtc, timeZone);
  return `${endDateISO}T${endTime24}:00`;
}

function toISODate(d) {
  return formatISODateInTimeZone(d, GOOGLE_CALENDAR_TZ || "Europe/Rome");
}



function formatDateLabel(dateISO) {
  try {
    const tz = GOOGLE_CALENDAR_TZ || "Europe/Rome";
    const d = makeUtcDateFromZoned(dateISO, "12:00", tz) || new Date(`${dateISO}T00:00:00`);
    return new Intl.DateTimeFormat("it-IT", {
      timeZone: tz,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(d);
  } catch {
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
      gatherSpeech(vr, "Perfetto. Mi lasci un numero di telefono? Se è italiano, aggiungo io il +39.", { input: "speech dtmf" });
      return;
    case 9:
      gatherSpeech(vr, "Hai altre richieste particolari? Ad esempio sala esterna.");
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

  // relative keywords
  if (tt.includes("oggi")) return toISODate(today);
  if (tt.includes("domani")) {
    const next = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    return toISODate(next);
  }

  // "stasera" / "questa sera" -> oggi
  if (tt.includes("stasera") || tt.includes("questa sera") || tt.includes("in serata")) {
    return toISODate(today);
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
  if (!tt) return null;

  // digits anywhere: "8", "siamo in 8", "8 persone"
  const m = tt.match(/\b(\d{1,2})\b/);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }

  // italian number words (common for speech): "otto", "siamo otto", "in otto"
  const map = {
    uno: 1,
    una: 1,
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
    tredici: 13,
    quattordici: 14,
    quindici: 15,
    sedici: 16,
    diciassette: 17,
    diciotto: 18,
    diciannove: 19,
    venti: 20,
  };

  const words = tt
    .replace(/[^a-zàèéìòù\s]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);

  for (const w of words) {
    if (Object.prototype.hasOwnProperty.call(map, w)) {
      const n = map[w];
      if (Number.isFinite(n) && n > 0) return n;
    }
  }

  return null;
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
  const raw = String(speech || "").trim();

  // Already E.164
  if (isValidPhoneE164(raw)) return raw;

  // Extract digits from raw (handles "388 166 9661", "20.30" etc.)
  let digits = raw.replace(/[^\d]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);

  // If no digits, try to convert spoken Italian digits: "tre otto otto ..."
  if (!digits) {
    const tt = normalizeText(raw)
      .replace(/[^a-zàèéìòù\d\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const wordToDigit = {
      zero: "0",
      uno: "1",
      una: "1",
      due: "2",
      tre: "3",
      quattro: "4",
      cinque: "5",
      sei: "6",
      sette: "7",
      otto: "8",
      nove: "9",
    };
    const parts = tt.split(" ").filter(Boolean);
    const out = [];
    for (const part of parts) {
      if (/^\d+$/.test(part)) {
        out.push(part);
        continue;
      }
      const d = wordToDigit[part];
      if (d) out.push(d);
    }
    digits = out.join("");
    if (digits.startsWith("00")) digits = digits.slice(2);
  }

  if (!digits) return null;

  // Normalize lengths
  if (digits.length >= 8 && digits.length <= 15) {
    // If likely Italian local number (<=10 digits), prefix +39
    if (digits.length <= 10) return `+39${digits}`;
    // If starts with country code without '+'
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

function maybeSayLiveMusicNotice(vr, session) {
  if (!session?.liveMusicNoticePending || session.liveMusicNoticeSpoken) return;
  sayIt(vr, "Ti informo che quella sera è prevista musica live o dj set.");
  session.liveMusicNoticeSpoken = true;
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
  if (!credentials) return null;
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
  return google.calendar({ version: "v3", auth });
}


function getTimeRangeForDate(dateISO) {
  const tz = GOOGLE_CALENDAR_TZ || "Europe/Rome";
  const start = makeUtcDateFromZoned(dateISO, "00:00", tz) || new Date(`${dateISO}T00:00:00`);
  const endBase = makeUtcDateFromZoned(dateISO, "23:59", tz) || new Date(`${dateISO}T23:59:00`);
  const end = new Date(endBase.getTime() + 59 * 1000);
  return { start, end };
}


function isDateClosedByCalendar(events) {
  return events.some((event) => {
    const summary = String(event.summary || "").toLowerCase();
    const description = String(event.description || "").toLowerCase();
    return summary.includes("locale chiuso") || description.includes("locale chiuso");
  });
}

function extractTablesFromEvent(event) {
  const description = String(event.description || "");
  const match = description.match(/Tavolo:\s*([^\n]+)/i);
  const summary = String(event.summary || "");
  const summaryMatch = summary.match(/tav(?:olo)?\s*([^\-,]+)/i);
  const tableText = match?.[1] || summaryMatch?.[1];
  if (!tableText) return [];
  return tableText
    .split(/,| e /i)
    .map((entry) => normalizeTableId(entry))
    .filter(Boolean);
}

function getEventTimeRange(event) {
  const start = event.start?.dateTime || event.start?.date;
  const end = event.end?.dateTime || event.end?.date;
  if (!start || !end) return null;
  return {
    start: new Date(start),
    end: new Date(end),
  };
}

function overlapsRange(a, b) {
  return a.start < b.end && b.start < a.end;
}

function normalizeTableId(raw) {
  const cleaned = String(raw || "")
    .replace(/tav(?:olo)?/i, "")
    .replace(/[^\dA-Z]/gi, "")
    .toUpperCase();
  if (!cleaned) return null;
  return cleaned.startsWith("T") ? cleaned : `T${cleaned}`;
}

function expandTableLocks(tableId) {
  const combo = TABLE_COMBINATIONS.find((c) => c.displayId === tableId);
  if (combo) return combo.replaces;
  return [tableId];
}

function isValidTableSelection(selection) {
  if (!selection || !Array.isArray(selection.locks) || selection.locks.length === 0) return false;
  const locks = [...selection.locks].sort();
  if (locks.length === 1) {
    return selection.displayId === locks[0] && Boolean(getTableById(locks[0]));
  }
  const combo = TABLE_COMBINATIONS.find((c) => c.displayId === selection.displayId);
  if (!combo) return false;
  const comboLocks = [...combo.replaces].sort();
  if (comboLocks.length !== locks.length) return false;
  return comboLocks.every((id, idx) => id === locks[idx]);
}

function buildAvailableTables(occupied, availableOverride, session) {
  return TABLES.filter((table) => {
    if (occupied.has(table.id)) return false;
    if (availableOverride && !availableOverride.has(table.id)) return false;
    if (!session?.wantsOutside && table.area === "outside") return false;
    return true;
  });
}

function getTableById(id) {
  return TABLES.find((table) => table.id === id) || null;
}

function buildAvailableTableSet(availableTables) {
  return new Set(availableTables.map((table) => table.id));
}

function getTablePenalty(tableId, session) {
  let penalty = 0;
  if (isHighTableId(tableId)) penalty += 20;
  if (isDivanettiTableId(tableId) && !isDivanettiPreferred(session)) penalty += 10;
  if (tableId === "T7") penalty += 5;
  return penalty;
}

function pickTableForParty(people, occupied, availableOverride, session) {
  const availableTables = buildAvailableTables(occupied, availableOverride, session);
  const availableSet = buildAvailableTableSet(availableTables);
  const directCandidates = availableTables.filter((table) => people >= table.min && people <= table.max);
  if (directCandidates.length > 0) {
    const preferredTwoTopIds = new Set(["T5", "T10", "T13"]);
    const twoTopCandidates =
      people === 2 ? directCandidates.filter((table) => preferredTwoTopIds.has(table.id)) : [];
    const directPool = twoTopCandidates.length > 0 ? twoTopCandidates : directCandidates;
    const exactCandidates = directPool.filter((table) => table.max === people);
    const directOptions = exactCandidates.length > 0 ? exactCandidates : directPool;
    directOptions.sort((a, b) => {
      const sizeA = a.max;
      const sizeB = b.max;
      if (sizeA !== sizeB) return sizeA - sizeB;
      const penaltyA = getTablePenalty(a.id, session);
      const penaltyB = getTablePenalty(b.id, session);
      if (penaltyA !== penaltyB) return penaltyA - penaltyB;
      return a.id.localeCompare(b.id);
    });
    const direct = directOptions[0];
    return { displayId: direct.id, locks: [direct.id], notes: direct.notes || null };
  }

  const comboCandidates = [];
  for (const combo of TABLE_COMBINATIONS) {
    if (people < combo.min || people > combo.max) continue;
    const unavailable = combo.replaces.some((id) => occupied.has(id) || !availableSet.has(id));
    if (!unavailable) comboCandidates.push(combo);
  }
  if (comboCandidates.length > 0) {
    const exactCombos = comboCandidates.filter((combo) => combo.max === people);
    const comboOptions = exactCombos.length > 0 ? exactCombos : comboCandidates;
    comboOptions.sort((a, b) => {
      const sizeA = a.max;
      const sizeB = b.max;
      if (sizeA !== sizeB) return sizeA - sizeB;
      const penaltyA = a.replaces.reduce((sum, id) => sum + getTablePenalty(id, session), 0);
      const penaltyB = b.replaces.reduce((sum, id) => sum + getTablePenalty(id, session), 0);
      if (penaltyA !== penaltyB) return penaltyA - penaltyB;
      return a.displayId.localeCompare(b.displayId);
    });
    const combo = comboOptions[0];
    return { displayId: combo.displayId, locks: combo.replaces, notes: combo.notes || null };
  }
  return null;
}

function pickSplitTables(people, availableTables, session) {
  const sorted = [...availableTables].sort((a, b) => {
    const penaltyA = getTablePenalty(a.id, session);
    const penaltyB = getTablePenalty(b.id, session);
    if (penaltyA !== penaltyB) return penaltyA - penaltyB;
    return b.max - a.max;
  });
  const selected = [];
  let remaining = people;
  let capacity = 0;

  for (const table of sorted) {
    if (remaining <= 0) break;
    selected.push(table);
    capacity += table.max;
    remaining -= table.max;
  }

  if (capacity < people || selected.length === 0) return null;
  return {
    displayIds: selected.map((table) => table.id),
    locks: selected.map((table) => table.id),
    notes: "tavoli separati",
  };
}

function getNextDateISO(dateISO) {
  return addDaysToISODate(dateISO, 1);
}


async function listCalendarEvents(dateISO) {
  if (!GOOGLE_CALENDAR_ID) return [];
  const calendar = buildCalendarClient();
  if (!calendar) return [];
  const { start, end } = getTimeRangeForDate(dateISO);
  try {
    const result = await calendar.events.list({
      calendarId: GOOGLE_CALENDAR_ID,
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });
    return result?.data?.items || [];
  } catch (err) {
    console.error("[GOOGLE] Calendar list failed:", err);
    return [];
  }
}


async function findExistingEventByPrivateProps({ calendar, dateISO, props }) {
  try {
    if (!calendar || !GOOGLE_CALENDAR_ID || !dateISO || !props) return null;
    const { start, end } = getTimeRangeForDate(dateISO);
    const privateExtendedProperty = [];
    for (const [k, v] of Object.entries(props)) {
      if (!k) continue;
      privateExtendedProperty.push(`${k}=${String(v ?? "")}`);
    }
    const result = await calendar.events.list({
      calendarId: GOOGLE_CALENDAR_ID,
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      privateExtendedProperty,
    });
    const items = result?.data?.items || [];
    return items.length ? items[0] : null;
  } catch (err) {
    console.error("[GOOGLE] Calendar list (privateExtendedProperty) failed:", err);
    return null;
  }
}



function formatTimeSlot(date, startDate) {
  if (!date) return "";
  const tz = GOOGLE_CALENDAR_TZ || "Europe/Rome";
  const p = getPartsInTimeZone(date, tz);
  if (startDate) {
    const sp = getPartsInTimeZone(startDate, tz);
    const dateIso = `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
    const startIso = `${sp.year}-${pad2(sp.month)}-${pad2(sp.day)}`;
    if (p.hour == 0 && p.minute == 0 && dateIso != startIso) {
      return "24:00";
    }
  }
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}


function timeToMinutes(time) {
  if (!time || !time.includes(":")) return null;
  const [h, m] = time.split(":").map((n) => Number(n));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function getBaseDurationMinutes(people) {
  if (!Number.isFinite(people)) return 120;
  if (people <= 4) return 120;
  if (people <= 8) return 150;
  if (people <= 15) return 180;
  return 180;
}

function hasLiveMusicEvent(events) {
  return events.some((event) => {
    const summary = String(event.summary || "").toLowerCase();
    const description = String(event.description || "").toLowerCase();
    return (
      summary.includes("live music") ||
      description.includes("live music") ||
      summary.includes("dj set") ||
      description.includes("dj set")
    );
  });
}

function computeDurationMinutes(session, events) {
  const baseMinutes = getBaseDurationMinutes(session?.people);
  const startMinutes = timeToMinutes(session?.time24);
  if (!events || events.length === 0) return baseMinutes;
  if (!Number.isFinite(startMinutes)) return baseMinutes;
  if (startMinutes < 20 * 60) return baseMinutes;
  if ((session?.people || 0) > 8) return baseMinutes;
  if (!hasLiveMusicEvent(events)) return baseMinutes;
  return baseMinutes + 30;
}

function maybeSayDivanettiNotice(vr, session) {
  if (!session?.divanettiNotice || session.divanettiNoticeSpoken) return;
  sayIt(vr, "Ti abbiamo riservato l’area divanetti, ideale per aperitivo e dopocena.");
  session.divanettiNoticeSpoken = true;
}

function buildAvailabilityDescription(dateISO, events) {
  const tableIds = TABLES.map((table) => table.id);
  const occupancy = new Map(tableIds.map((id) => [id, []]));
  const tz = GOOGLE_CALENDAR_TZ || "Europe/Rome";
  const bookingRange = {
    start: makeUtcDateFromZoned(dateISO, "00:00", tz) || new Date(`${dateISO}T00:00:00`),
    end: (function(){
      const endBase = makeUtcDateFromZoned(dateISO, "23:59", tz) || new Date(`${dateISO}T23:59:00`);
      return new Date(endBase.getTime() + 59 * 1000);
    })(),
  };

  for (const event of events) {
    const summary = String(event.summary || "").toLowerCase();
    const eventType = event.extendedProperties?.private?.type || "";
    if (summary.startsWith("annullat")) continue;
    if (summary.includes("tavoli disponibili")) continue;
    if (summary.includes("locale chiuso")) continue;
    if (summary.includes("evento") || eventType === "evento") continue;
    const eventRange = getEventTimeRange(event);
    if (!eventRange || !overlapsRange(bookingRange, eventRange)) continue;
    const tableIdsForEvent = extractTablesFromEvent(event)
      .filter((id) => occupancy.has(id));
    for (const tableId of tableIdsForEvent) {
      occupancy.get(tableId).push({
        start: eventRange.start,
        end: eventRange.end,
      });
    }
  }

  const lines = tableIds.map((tableId) => {
    const slots = occupancy.get(tableId) || [];
    slots.sort((a, b) => a.start - b.start);
    if (slots.length === 0) {
      return `${tableId}:`;
    }
    const slotText = slots
      .map((slot) => {
        const start = formatTimeSlot(slot.start);
        const end = formatTimeSlot(slot.end, slot.start);
        return `occupato dalle ${start} alle ${end};`;
      })
      .join(" ");
    return `${tableId}: ${slotText}`;
  });

  return lines.join("\n");
}

async function upsertAvailabilityEvent(dateISO) {
  if (!GOOGLE_CALENDAR_ID) return null;
  const calendar = buildCalendarClient();
  if (!calendar) return null;
  const events = await listCalendarEvents(dateISO);
  const availabilityEvent = events.find((event) =>
    String(event.summary || "").toLowerCase().includes("tavoli disponibili")
  );
  const description = buildAvailabilityDescription(dateISO, events);
  const requestBody = {
    summary: "Tavoli disponibili",
    description,
    start: { date: dateISO },
    end: { date: getNextDateISO(dateISO) },
  };

  try {
    if (availabilityEvent?.id) {
      const result = await calendar.events.patch({
        calendarId: GOOGLE_CALENDAR_ID,
        eventId: availabilityEvent.id,
        requestBody,
      });
      return result?.data || null;
    }
    const result = await calendar.events.insert({
      calendarId: GOOGLE_CALENDAR_ID,
      requestBody,
    });
    return result?.data || null;
  } catch (err) {
    console.error("[GOOGLE] Availability event update failed:", err);
    return null;
  }
}

async function reserveTableForSession(session, { commit } = { commit: false }) {
  const events = await listCalendarEvents(session.dateISO);
  if (isDateClosedByCalendar(events)) {
    return { status: "closed" };
  }

  session.forceOperatorFallback = false;
  session.divanettiNotice = false;
  session.divanettiNoticeSpoken = false;
  session.durationMinutes = computeDurationMinutes(session, events);
  const tz = GOOGLE_CALENDAR_TZ || "Europe/Rome";
  const bookingStart = makeUtcDateFromZoned(session.dateISO, session.time24, tz);
  const bookingEnd = new Date(bookingStart.getTime() + (session.durationMinutes || 120) * 60 * 1000);
  const bookingRange = { start: bookingStart, end: bookingEnd };
  const occupied = new Set();
  const eventoEvents = [];

  for (const event of events) {
    const summary = String(event.summary || "").toLowerCase();
    if (summary.startsWith("annullat")) continue;
    if (summary.includes("evento")) {
      eventoEvents.push(event);
      continue;
    }
    const eventRange = getEventTimeRange(event);
    if (!eventRange || !overlapsRange(bookingRange, eventRange)) continue;
    const tableIds = extractTablesFromEvent(event);
    tableIds.forEach((id) => occupied.add(id));
  }

  let availableOverride = null;
  if (eventoEvents.length > 0) {
    const eventTables = eventoEvents
      .flatMap((event) => extractTablesFromEvent(event))
      ;
    availableOverride = new Set(eventTables);
  }

  const selection = pickTableForParty(session.people, occupied, availableOverride, session);
  if (!selection) {
    const availableTables = buildAvailableTables(occupied, availableOverride, session);
    const availableSet = buildAvailableTableSet(availableTables);
    if (session.people === 12) {
      const comboT14 = TABLE_COMBINATIONS.find(
        (combo) => combo.displayId === "T14" && combo.replaces.length === 2 && combo.replaces.includes("T15")
      );
      const comboT7T11 = TABLE_COMBINATIONS.find(
        (combo) =>
          combo.displayId === "T11" &&
          combo.replaces.length === 4 &&
          combo.replaces.includes("T7") &&
          combo.replaces.includes("T11") &&
          combo.replaces.includes("T12") &&
          combo.replaces.includes("T13")
      );
      const hasComboT14 = comboT14 && comboT14.replaces.every((id) => availableSet.has(id));
      const hasComboT7T11 = comboT7T11 && comboT7T11.replaces.every((id) => availableSet.has(id));
      if (!hasComboT14 && !hasComboT7T11) {
        session.criticalReservation = true;
        session.tableDisplayId = "T10";
        session.tableLocks = ["T10"];
        session.tableNotes = null;
        session.divanettiNotice = false;
        session.divanettiNoticeSpoken = false;
        session.splitRequired = false;
        session.outsideRequired = false;
        return { status: "ok", selection: { displayId: "T10", locks: ["T10"], notes: null } };
      }
    }
    const insideTables = availableTables.filter((table) => table.area === "inside");
    const insideSplit = pickSplitTables(session.people, insideTables, session);
    if (insideSplit) {
      session.tableDisplayId = insideSplit.displayIds.join(" e ");
      session.tableLocks = insideSplit.locks;
      session.tableNotes = insideSplit.notes;
      session.divanettiNotice = insideSplit.locks.some((id) => isDivanettiTableId(id));
      session.divanettiNoticeSpoken = false;
      session.splitRequired = true;
      session.outsideRequired = false;
      return { status: "needs_split" };
    }

    const anySplit = pickSplitTables(session.people, availableTables, session);
    if (anySplit) {
      session.tableDisplayId = anySplit.displayIds.join(" e ");
      session.tableLocks = anySplit.locks;
      session.tableNotes = anySplit.notes;
      session.divanettiNotice = anySplit.locks.some((id) => isDivanettiTableId(id));
      session.divanettiNoticeSpoken = false;
      session.splitRequired = true;
      session.outsideRequired = anySplit.locks.some((id) => getTableById(id)?.area === "outside");
      return { status: "needs_outside" };
    }

    return { status: "unavailable" };
  }
  if (!isValidTableSelection(selection)) {
    session.forceOperatorFallback = true;
    session.tableDisplayId = null;
    session.tableLocks = [];
    session.tableNotes = null;
    return { status: "unavailable" };
  }
  session.tableDisplayId = selection.displayId;
  session.tableLocks = selection.locks;
  session.tableNotes = selection.notes;
  session.divanettiNotice = selection.locks.some((id) => isDivanettiTableId(id));
  session.divanettiNoticeSpoken = false;
  session.splitRequired = false;
  session.outsideRequired = selection.locks.some((id) => getTableById(id)?.area === "outside");

  if (commit && eventoEvents.length > 0) {
    const calendar = buildCalendarClient();
    if (calendar) {
      for (const event of eventoEvents) {
        const eventTables = extractTablesFromEvent(event);
        const remaining = eventTables.filter((id) => !selection.locks.includes(id));
        const availableCount = remaining.length;
        const updatedSummary = `Evento - tavoli disponibili: ${availableCount}`;
        const baseDescription = String(event.description || "");
        const updatedDescription = baseDescription.match(/Tavolo:\s*/i)
          ? baseDescription.replace(/Tavolo:\s*[^\n]*/i, `Tavolo: ${remaining.join(", ")}`)
          : `${baseDescription}\nTavolo: ${remaining.join(", ")}`.trim();
        try {
          await calendar.events.patch({
            calendarId: GOOGLE_CALENDAR_ID,
            eventId: event.id,
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

  // Idempotenza: evita doppie prenotazioni su retry
  const callSid = session.callSid || session.sid || "";
  if (callSid) {
    const existing = await findExistingEventByPrivateProps({
      calendar,
      dateISO: session.dateISO,
      props: { ai_call_sid: callSid, ai_kind: "booking" },
    });
    if (existing?.id) {
      session.calendarEventId = existing.id;
      session.calendarEventSummary = existing.summary || session.calendarEventSummary;
      session.bookingCompleted = true;
      await upsertAvailabilityEvent(session.dateISO);
      return existing;
    }
  }

  const startDateTime = `${session.dateISO}T${session.time24}:00`;

  const tz = GOOGLE_CALENDAR_TZ || "Europe/Rome";
  const endDateTime = computeEndDateTime(session.dateISO, session.time24, session.durationMinutes || 120, tz);

  const tableLabel = session.tableLocks?.length
    ? session.tableLocks.join(" e ")
    : session.tableDisplayId || "da assegnare";
  const event = {
    summary: `Ore ${session.time24}, tav ${tableLabel}, ${session.name}, ${session.people} pax`,
    description: [
      `Nome: ${session.name}`,
      `Persone: ${session.people}`,
      `Note: ${buildSpecialRequestsText(session)}`,
      `Preordine: ${session.preorderLabel || "nessuno"}`,
      `Tavolo: ${tableLabel}`,
      `Telefono: ${session.phone || "non fornito"}`,
    ].join("\n"),
    start: { dateTime: startDateTime, timeZone: GOOGLE_CALENDAR_TZ },
    end: { dateTime: endDateTime, timeZone: GOOGLE_CALENDAR_TZ },
    extendedProperties: {
      private: {
        ai_call_sid: session.callSid || session.sid || "",
        ai_kind: "booking",
      },
    },
  };
  if (session.criticalReservation) {
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

  const tz = GOOGLE_CALENDAR_TZ || "Europe/Rome";
  const endDateTime = computeEndDateTime(session.eventDateISO, session.eventTime24, 120, tz);

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



function buildFailedCallEventPayload(session, req, reason) {
  const callSid = (session && (session.callSid || session.sid)) || req?.body?.CallSid || "";
  const from = (session && session.phone) || req?.body?.From || "";
  const state = (session && session.step) || "unknown";
  const intent = (session && session.intent) || "";

  const lines = [];
  lines.push(`Numero di telefono: ${from || "-"}`);
  if (session?.name) lines.push(`Nome: ${session.name}`);
  if (session?.dateISO) lines.push(`Data richiesta: ${session.dateISO}`);
  if (session?.time24) lines.push(`Orario richiesto: ${session.time24}`);
  if (session?.people) lines.push(`Numero persone: ${session.people}`);
  if (intent) lines.push(`Tipo richiesta: ${intent}`);
  const note = buildSpecialRequestsText(session || {});
  if (note) lines.push(`Richieste / note: ${note}`);
  if (session?.preorderLabel) lines.push(`Preordine: ${session.preorderLabel}`);
  if (session?.operatorReasonRaw) lines.push(`Motivo operatore: ${session.operatorReasonRaw}`);
  lines.push(`Stato finale: ${reason || "chiamata interrotta"}`);
  lines.push(`Step: ${state}`);
  if (callSid) lines.push(`CallSid: ${callSid}`);

  return {
    summary: "⚠️ TENTATIVO NON COMPLETATO – Chiamata interrotta",
    description: lines.join("\n"),
  };
}

async function createFailedCallCalendarEvent(session, req, reason) {
  if (!GOOGLE_CALENDAR_ID) return null;
  const calendar = buildCalendarClient();
  if (!calendar) return null;

  const tz = GOOGLE_CALENDAR_TZ || "Europe/Rome";
  const callSid = (session && (session.callSid || session.sid)) || req?.body?.CallSid || "";

  // Dedup: se esiste gia' un evento per questo CallSid, non crearne altri
  if (callSid) {
    const existing = await findExistingEventByPrivateProps({
      calendar,
      dateISO: formatISODateInTimeZone(new Date((session && session.createdAt) || Date.now()), tz),
      props: { ai_call_sid: callSid, ai_kind: "failed_call" },
    });
    if (existing?.id) return existing;
  }

  const createdAt = (session && session.createdAt) || Date.now();
  const dayISO = formatISODateInTimeZone(new Date(createdAt), tz);
  const nextDayISO = addDaysToISODate(dayISO, 1) || getNextDateISO(dayISO);

  const fromNumber = (session && session.phone) || req?.body?.From || "";
  const payload = buildFailedCallEventPayload(session || {}, req, reason);

  const event = {
    summary: payload.summary || "⚠️ TENTATIVO NON COMPLETATO – Chiamata interrotta",
    description: payload.description || "",
    start: { date: dayISO },
    end: { date: nextDayISO },
    extendedProperties: {
      private: {
        ai_call_sid: callSid,
        ai_kind: "failed_call",
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
    console.error("[GOOGLE] Failed-call event insert failed:", err);
    return null;
  }
}



async function createOperatorCallbackCalendarEvent(session, req, dialStatus) {
  if (!session) return null;
  if (session.operatorCallbackEventCreated === true) return null;
  if (!GOOGLE_CALENDAR_ID) {
    session.operatorCallbackEventCreated = true;
    return null;
  }
  const calendar = buildCalendarClient();
  if (!calendar) {
    session.operatorCallbackEventCreated = true;
    return null;
  }

  try {
    const todayISO = toISODate(new Date());
    const phone = req?.body?.From || session.phone || "";
    const callSid = req?.body?.CallSid || "";
    const status = String(dialStatus || "").trim() || "callback";

    if (callSid) {
      const existing = await findExistingEventByPrivateProps({
        calendar,
        dateISO: todayISO,
        props: { ai_call_sid: callSid, ai_kind: "operator_callback" },
      });
      if (existing?.id) {
        session.operatorCallbackEventCreated = true;
        return existing;
      }
    }

    const lines = [];
    lines.push(`Numero: ${phone || "-"}`);
    if (session.name) lines.push(`Nome: ${session.name}`);
    if (session.dateISO) lines.push(`Data richiesta: ${session.dateISO}`);
    if (session.time24) lines.push(`Orario richiesto: ${session.time24}`);
    if (session.people) lines.push(`Persone: ${session.people}`);
    if (session.intent) lines.push(`Tipo richiesta: ${session.intent}`);
    if (session.extraRequestsRaw) lines.push(`Richieste: ${session.extraRequestsRaw}`);
    if (session.operatorReasonRaw) lines.push(`Motivo operatore: ${session.operatorReasonRaw}`);
    lines.push(`DialCallStatus: ${status}`);
    lines.push(`Step: ${session.step || "-"}`);
    lines.push(`CallSid: ${callSid || "-"}`);

    const requestBody = {
      summary: "🟡 RICHIAMARE – richiesta operatore",
      description: lines.join("\n"),
      start: { date: todayISO },
      end: { date: getNextDateISO(todayISO) },
      colorId: CRITICAL_COLOR_ID,
      extendedProperties: {
        private: {
          ai_call_sid: callSid,
          ai_kind: "operator_callback",
        },
      },
    };

    const result = await calendar.events.insert({
      calendarId: GOOGLE_CALENDAR_ID,
      requestBody,
    });
    return result?.data || null;
  } catch (err) {
    console.error("[GOOGLE] Operator callback event insert failed:", err);
    return null;
  } finally {
    session.operatorCallbackEventCreated = true;
  }
}

async function safeCreateOperatorCallbackCalendarEvent(session, req, dialStatus) {
  try {
    await createOperatorCallbackCalendarEvent(session, req, dialStatus);
  } catch (err) {
    console.error("[GOOGLE] Operator callback safe insert failed:", err);
  }
}

async function safeCreateFailedCallCalendarEvent(session, req, reason) {
  try {
    if (session) {
      if (session.bookingCompleted) return;
      if (session.calendarEventId) return;
      if (session.operatorCallbackEventCreated) return;
      if (session.fallbackEventCreated) return;
    }
    await createFailedCallCalendarEvent(session || null, req, reason);
  } catch (err) {
    console.error("[GOOGLE] Failed call safe insert failed:", err);
  } finally {
    if (session) session.fallbackEventCreated = true;
  }
}


// ======================= ROUTES =======================
app.get("/health", (req, res) => res.json({ ok: true }));


// ======================= TWILIO STATUS CALLBACK =======================
// Configura questo endpoint come "Status Callback URL" del numero Twilio (Voice) per tracciare le chiamate concluse.
app.post("/twilio/status", async (req, res) => {
  try {
    const callSid = String(req.body?.CallSid || "").trim();
    const callStatus = String(req.body?.CallStatus || "").trim().toLowerCase();

    // Stati terminali Twilio
    const isTerminal = ["completed", "busy", "failed", "no-answer", "canceled"].includes(callStatus);
    if (!isTerminal) {
      return res.sendStatus(204);
    }

    const session = callSid ? getSession(callSid) : null;

    // Se prenotazione completata o callback operatore gia' creata, non creare fallback
    if (session && (session.bookingCompleted || session.calendarEventId || session.operatorCallbackEventCreated)) {
      return res.sendStatus(204);
    }

    await safeCreateFailedCallCalendarEvent(session, req, `call_status_${callStatus}`);
    return res.sendStatus(204);
  } catch (err) {
    console.error("[TWILIO] Status callback error:", err);
    return res.sendStatus(204);
  }
});

// ======================= WHATSAPP / SMS INBOUND (TWILIO) =======================
// Twilio invia i messaggi in arrivo come HTTP POST (application/x-www-form-urlencoded).
// Per test rapido da browser abbiamo anche un GET che risponde "OK".
app.get("/twilio/inbound", (req, res) => res.status(200).send("OK - Twilio inbound endpoint"));
app.get("/twilio", (req, res) => res.status(200).send("OK - Twilio inbound endpoint"));

function buildMessagingTwimlReply(text) {
  const mr = new twilio.twiml.MessagingResponse();
  if (text) mr.message(text);
  return mr.toString();
}

// ======================= WHATSAPP AI / CHAT FLOW =======================
// Nota: questa sezione riguarda SOLO i messaggi WhatsApp/SMS (webhook /twilio/inbound).
// Il flusso vocale (chiamate) resta invariato.

function stripWhatsAppPrefix(value) {
  const s = String(value || "").trim();
  return s.toLowerCase().startsWith("whatsapp:") ? s.slice("whatsapp:".length) : s;
}

function getWaSession(from) {
  const key = `wa:${from || "unknown"}`;
  const session = getSession(key);
  if (!session) return null;

  // Informazioni utili per log e prenotazioni
  const phone = stripWhatsAppPrefix(from);
  if (phone) session.phone = phone;

  if (!session.wa) {
    session.wa = {
      step: "idle",
      history: [],
      lastActivityTs: Date.now(),
    };
  }
  session.wa.lastActivityTs = Date.now();
  return session;
}

function pruneWaHistory(session, max = 12) {
  if (!session?.wa?.history) return;
  if (session.wa.history.length > max) {
    session.wa.history = session.wa.history.slice(session.wa.history.length - max);
  }
}

function waAddToHistory(session, role, content) {
  if (!session?.wa) return;
  session.wa.history.push({ role, content: String(content || "").slice(0, 2000) });
  pruneWaHistory(session);
}

function buildBusinessFactsForAI() {
  const parts = [];
  parts.push(`Nome attività: ${BUSINESS_NAME}`);
  if (BUSINESS_CONTEXT) parts.push(`Contesto: ${BUSINESS_CONTEXT}`);

  // Orari dal file
  parts.push(`Giorno di chiusura: Lunedì.`);
  parts.push(`Orari ristorante: ${OPENING.restaurant.default.start}-${OPENING.restaurant.default.end} (Ven/Sab fino alle ${OPENING.restaurant.friSat.end}).`);
  parts.push(`Orari drink: ${OPENING.drinksOnly.start}-${OPENING.drinksOnly.end}.`);
  parts.push(`Serate musica: Mercoledì e Venerdì.`);

  // Preordine
  parts.push(
    `Preordine: opzionale. Opzioni: ${PREORDER_OPTIONS.map((o) => o.label).join(", ")}.`
  );

  return parts.join("\n");
}

function buildWaSystemPrompt() {
  return [
    `Sei un assistente WhatsApp di ${BUSINESS_NAME}.`,
    `Obiettivo: rispondere in modo utile e rapido, e guidare l'utente alla prenotazione quando serve.`,
    `Regole:`,
    `- Non inventare informazioni non presenti nei "Fatti". Se manca un dato, fai UNA domanda breve per chiarire.`,
    `- Se l’utente vuole prenotare un tavolo, raccogli: nome, data (YYYY-MM-DD), numero persone, ora (HH:MM), eventuali note e preordine (se vuole).`,
    `- Tono: cordiale, italiano, frasi brevi.`,
    ``,
    `Fatti:\n${buildBusinessFactsForAI()}`,
  ].join("\n");
}

async function callOpenAIResponses({ input, jsonMode } = {}) {
  if (!AI_ENABLED || !OPENAI_API_KEY) return null;

  const controller = new AbortController();
  const timeoutMs = 12000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const body = {
      model: OPENAI_MODEL,
      max_output_tokens: AI_MAX_OUTPUT_TOKENS,
      input,
    };

    if (jsonMode) {
      body.text = { format: { type: "json_object" } };
    }

    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      console.error("[OPENAI] error:", resp.status, data);
      return null;
    }

    // L'SDK espone output_text; qui facciamo un parsing robusto
    const outputText =
      data?.output_text ||
      data?.output?.[0]?.content?.find((c) => c?.type === "output_text")?.text ||
      data?.output?.[0]?.content?.[0]?.text ||
      null;

    return { data, outputText };
  } catch (err) {
    console.error("[OPENAI] call failed:", err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function aiGeneralReply(session, userText) {
  const system = buildWaSystemPrompt();
  const history = session?.wa?.history || [];

  const input = [
    { role: "system", content: system },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: String(userText || "") },
  ];

  const result = await callOpenAIResponses({ input });
  const text = result?.outputText;
  if (!text) return null;

  return String(text).trim();
}

async function aiExtractBookingFields(userText) {
  if (!AI_ENABLED || !OPENAI_API_KEY) return null;

  const instructions = [
    `Estrai informazioni per una prenotazione tavolo.`,
    `Rispondi SOLO con JSON valido (nessun testo fuori dal JSON).`,
    `Chiavi: intent (\"table\" oppure \"other\"), name (string|null), dateISO (YYYY-MM-DD|null), time24 (HH:MM|null), people (number|null), notes (string|null), preorder (string|null).`,
    `Se non sei sicuro, usa null.`,
    `Testo utente: """${String(userText || "").slice(0, 1000)}"""`,
  ].join("\n");

  const input = [{ role: "user", content: instructions }];
  const result = await callOpenAIResponses({ input, jsonMode: true });
  if (!result?.outputText) return null;

  try {
    const obj = JSON.parse(result.outputText);
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    return null;
  }
}

function isBookingIntentText(text) {
  const t = normalizeText(text || "");
  return (
    t.includes("prenot") ||
    t.includes("riserv") ||
    t.includes("tavolo") ||
    t.includes("cena") ||
    t.includes("apericena") ||
    t.includes("dopocena")
  );
}

function resetWaBooking(session) {
  if (!session) return;
  session.intent = null;
  session.name = null;
  session.dateISO = null;
  session.time24 = null;
  session.people = null;
  session.specialRequestsRaw = null;
  session.preorderChoiceKey = null;
  session.preorderLabel = null;
  if (session.wa) session.wa.step = "idle";
}

function buildBookingSummary(session) {
  const dateLabel = session.dateISO ? formatDateLabel(session.dateISO) : "";
  const preorder = session.preorderLabel ? session.preorderLabel : "nessuno";
  const note = session.specialRequestsRaw ? buildSpecialRequestsText(session) : "nessuna";
  return [
    `Riepilogo prenotazione:`,
    `- Nome: ${session.name || "-"}`,
    `- Data: ${dateLabel || "-"}`,
    `- Ora: ${session.time24 || "-"}`,
    `- Persone: ${session.people || "-"}`,
    `- Note: ${note}`,
    `- Preordine: ${preorder}`,
    ``,
    `Confermi? (sì/no)`,
  ].join("\n");
}

async function computeWhatsAppReply(session, userText) {
  const text = String(userText || "").trim();
  const normalized = normalizeText(text);
  const step = session?.wa?.step || "idle";

  // Comandi globali
  if (normalized && isCancelCommand(normalized)) {
    resetWaBooking(session);
    return "Ok, ho annullato la procedura. Se vuoi, dimmi cosa ti serve 🙂";
  }
  if (normalized && isBackCommand(normalized)) {
    // piccolo "indietro" per la prenotazione
    if (step === "ask_time") session.wa.step = "ask_people";
    else if (step === "ask_people") session.wa.step = "ask_date";
    else if (step === "ask_date") session.wa.step = "ask_name";
    else session.wa.step = "idle";

    return "Ok, torniamo indietro. Dimmi pure.";
  }

  // IDLE: capisco intento (prenotazione vs info)
  if (step === "idle") {
    if (isBookingIntentText(text)) {
      session.intent = "table";

      // Tentativo “intelligente”: estrazione campi in una sola frase
      const extracted = await aiExtractBookingFields(text);
      if (extracted?.name) session.name = String(extracted.name).slice(0, 60);
      if (extracted?.dateISO) session.dateISO = String(extracted.dateISO);
      if (extracted?.time24) session.time24 = String(extracted.time24);
      if (typeof extracted?.people === "number") session.people = extracted.people;
      if (extracted?.notes) session.specialRequestsRaw = String(extracted.notes).slice(0, 200);
      if (extracted?.preorder) session.preorderLabel = String(extracted.preorder).slice(0, 60);

      // Determina prossimo passo mancante
      if (!session.name) {
        session.wa.step = "ask_name";
        return "Perfetto 🙂 Come ti chiami?";
      }
      if (!session.dateISO) {
        session.wa.step = "ask_date";
        return `Piacere ${session.name}! Per quale giorno vuoi prenotare? (es. 12/01 o domani)`;
      }
      if (!session.people) {
        session.wa.step = "ask_people";
        return "In quante persone siete?";
      }
      if (!session.time24) {
        session.wa.step = "ask_time";
        return "A che ora? (es. 20:30)";
      }
      session.wa.step = "ask_notes";
      return "Hai intolleranze o richieste particolari? (se no scrivi: nessuna)";
    }

    // Non è una prenotazione → risposta AI (se configurata) oppure risposta base
    const ai = await aiGeneralReply(session, text);
    if (ai) return ai;

    return "Ciao! Posso aiutarti con una prenotazione tavolo o con informazioni. Scrivimi cosa ti serve 🙂";
  }

  // Prenotazione: step-by-step
  if (step === "ask_name") {
    if (!text) return "Come ti chiami?";
    session.name = text.slice(0, 60);
    session.wa.step = "ask_date";
    return `Piacere ${session.name}! Per quale giorno vuoi prenotare? (es. 12/01 o domani)`;
  }

  if (step === "ask_date") {
    const dateISO = parseDateIT(text);
    if (!dateISO) return "Non ho capito la data 😅 Puoi scriverla tipo 12/01 o domani?";
    session.dateISO = dateISO;

    // Controllo chiusura (giorno di riposo / festivi / calendario)
    const events = await listCalendarEvents(session.dateISO);
    const date = new Date(`${session.dateISO}T00:00:00`);
    const isHoliday = HOLIDAYS_SET.has(session.dateISO);
    const isClosedDay = date.getDay() === OPENING.closedDay;
    if (isHoliday || isClosedDay || isDateClosedByCalendar(events)) {
      return "Mi dispiace, quel giorno risulta chiuso. Vuoi scegliere un'altra data?";
    }

    session.liveMusicNoticePending = hasLiveMusicEvent(events);
    session.wa.step = "ask_people";
    return "Perfetto. In quante persone siete?";
  }

  if (step === "ask_people") {
    const people = parsePeopleIT(text);
    if (!people) return "Non ho capito il numero di persone. Puoi scrivere ad es. 2, 4, 6?";
    session.people = people;
    session.wa.step = "ask_time";
    return "A che ora? (es. 20:30)";
  }

  if (step === "ask_time") {
    const time24 = parseTimeIT(text);
    if (!time24) return "Non ho capito l'orario. Puoi scriverlo tipo 20:30?";
    session.time24 = time24;
    session.wa.step = "ask_notes";
    return "Hai intolleranze o richieste particolari? (se no scrivi: nessuna)";
  }

  if (step === "ask_notes") {
    if (!text) return "Hai richieste particolari? Se no scrivi: nessuna";
    session.specialRequestsRaw = normalizeText(text).includes("nessun") ? "nessuna" : text.slice(0, 200);
    session.wa.step = "ask_preorder";
    return "Vuoi preordinare qualcosa? (cena, apericena, dopocena, piatto apericena, piatto apericena promo) — oppure scrivi: nessuno";
  }

  if (step === "ask_preorder") {
    const normalized = normalizeText(text);
    const glutenIntolerance = hasGlutenIntolerance(session.specialRequestsRaw);
    const isFriday = session.dateISO ? new Date(`${session.dateISO}T00:00:00`).getDay() === 5 : false;

    if (normalized.includes("nessuno") || normalized.includes("niente") || normalized === "no") {
      session.preorderChoiceKey = null;
      session.preorderLabel = "nessuno";
    } else if (normalized.includes("apericena promo")) {
      const promoOption = getPreorderOptionByKey("piatto_apericena_promo");
      if (isFriday) return "L’apericena promo non è disponibile il venerdì. Scegli un’altra opzione oppure scrivi: nessuno";
      session.preorderChoiceKey = promoOption?.key || "piatto_apericena_promo";
      session.preorderLabel = promoOption?.label || "Piatto Apericena in promo (previa registrazione)";
      if (glutenIntolerance) {
        // non blocchiamo, ma avvisiamo
      }
    } else if (normalized.includes("apericena") && !normalized.includes("piatto")) {
      if (glutenIntolerance) return "L’apericena non è disponibile per celiaci o intolleranti al glutine. Vuoi scegliere un’alternativa o scrivere: nessuno?";
      const option = getPreorderOptionByKey("apericena");
      session.preorderChoiceKey = option?.key || "apericena";
      session.preorderLabel = option?.label || "Apericena";
    } else {
      const option =
        PREORDER_OPTIONS.find(
          (o) => normalized.includes(o.label.toLowerCase()) || normalized.includes(o.key.replace(/_/g, " "))
        ) || null;
      if (!option) return "Non ho capito la scelta. Puoi scrivere: cena, apericena, dopocena, piatto apericena, piatto apericena promo — oppure: nessuno";
      session.preorderChoiceKey = option.key;
      session.preorderLabel = option.label;
    }

    session.wa.step = "confirm";
    return buildBookingSummary(session);
  }

  if (step === "confirm") {
    const n = normalizeText(text);
    const yes = YES_WORDS.some((w) => n.includes(normalizeText(w)));
    const no = NO_WORDS.some((w) => n.includes(normalizeText(w)));

    if (!yes && !no) return "Confermi la prenotazione? Rispondi con sì oppure no.";

    if (no) {
      resetWaBooking(session);
      return "Ok, nessun problema. Se vuoi riprovare, dimmi data/ora e numero persone 🙂";
    }

    // YES: tentiamo creazione evento e inviamo email operatore
    let calendarResult = null;
    try {
      calendarResult = await createCalendarEvent(session);
    } catch (err) {
      console.error("[WHATSAPP] createCalendarEvent failed:", err);
      calendarResult = null;
    }

    // Avviso operatore (best-effort)
    try {
      void sendOperatorEmail(session, { body: { From: session.phone } }, "whatsapp_booking_confirmed");
    } catch (err) {
      console.error("[WHATSAPP] sendOperatorEmail failed:", err);
    }

    if (calendarResult?.status === "closed") {
      session.wa.step = "ask_date";
      return "Quel giorno risulta chiuso. Vuoi scegliere un'altra data?";
    }
    if (calendarResult?.status === "unavailable") {
      session.wa.step = "ask_time";
      return "A quell’orario siamo al completo 😅 Vuoi provare un altro orario? (es. 20:00 oppure 21:30)";
    }

    const dateLabel = session.dateISO ? formatDateLabel(session.dateISO) : "";
    const musicNote = session.liveMusicNoticePending ? " Nota: quella sera è prevista musica dal vivo." : "";
    resetWaBooking(session);
    return `Perfetto! Prenotazione registrata per ${dateLabel} alle ${session.time24} per ${session.people} persone.${musicNote} A presto 🙂`;
  }

  // Fallback: se per qualche motivo step sconosciuto
  session.wa.step = "idle";
  const ai = await aiGeneralReply(session, text);
  if (ai) return ai;
  return "Ok! Dimmi pure cosa ti serve 🙂";
}

async function handleTwilioInboundMessage(req, res) {
  try {
    const from = req.body?.From || "";
    const to = req.body?.To || "";
    const body = req.body?.Body || "";
    const messageSid = req.body?.MessageSid || "";

    console.log("[WHATSAPP] inbound", { from, to, messageSid, body });

    const session = getWaSession(from);

    // Storico per risposte AI (solo se il session esiste)
    if (session) waAddToHistory(session, "user", body);

    const reply = session ? await computeWhatsAppReply(session, body) : "OK";

    if (session && reply) waAddToHistory(session, "assistant", reply);

    const xml = buildMessagingTwimlReply(reply || "");

    res.set("Content-Type", "text/xml; charset=utf-8");
    return res.status(200).send(xml);
  } catch (err) {
    console.error("[WHATSAPP] inbound error:", err);
    // Risposta vuota ma valida (evita retry aggressivi)
    res.set("Content-Type", "text/xml; charset=utf-8");
    return res.status(200).send(buildMessagingTwimlReply(""));
  }
}

// Endpoint consigliato da usare come webhook (Request URL) in Twilio Console
app.post("/twilio/inbound", handleTwilioInboundMessage);

// Compatibilità: se in console hai configurato /twilio (o /twilio/) invece di /twilio/inbound
app.post("/twilio", handleTwilioInboundMessage);

app.post("/call/outbound", async (req, res) => {
  try {
    const to = String(req.body?.to || "").trim();
    if (!to || !isValidPhoneE164(to)) {
      return res.status(400).json({ ok: false, error: "Invalid 'to' number" });
    }
    if (!twilioClient) {
      return res.status(500).json({ ok: false, error: "Twilio not configured" });
    }
    const fromNumber = requireTwilioVoiceFrom();
    const twimlUrl = BASE_URL ? `${BASE_URL}/twilio/voice/outbound` : "/twilio/voice/outbound";
    const call = await twilioClient.calls.create({
      to,
      from: fromNumber,
      url: twimlUrl,
      method: "POST",
    });
    return res.json({ ok: true, callSid: call.sid });
  } catch (err) {
    console.error("[OUTBOUND] Error:", err);
    if (err && err.message === "TWILIO_VOICE_FROM is not set") {
      return res.status(500).json({ ok: false, error: "TWILIO_VOICE_FROM not set" });
    }
    return res.status(500).json({ ok: false });
  }
});

app.post("/twilio/voice/outbound", (req, res) => {
  try {
    const vr = buildTwiml();
    vr.say(
      { language: "it-IT", voice: "alice" },
      xmlEscape("Ciao! Ti chiamiamo da TuttiBrilli per un aggiornamento sulla tua prenotazione. Grazie.")
    );
    vr.hangup();
    res.set("Content-Type", "text/xml; charset=utf-8");
    return res.send(vr.toString());
  } catch (err) {
    console.error("[OUTBOUND_TWIML] Error:", err);
    return res.status(500).send("Error");
  }
});

async function handleVoiceRequest(req, res) {
  const callSid = req.body.CallSid || "";
  const speech = String(req.body.SpeechResult || req.body.Digits || "");
  const session = getSession(callSid);
  if (session && !session.callSid) session.callSid = callSid;
  const vr = buildTwiml();

  try {
    if (!session) {
      await sendFallbackEmail(session, req, "session_error");
      if (canForwardToHuman()) {
        void sendOperatorEmail(session, req, "session_error");
        res.set("Content-Type", "text/xml; charset=utf-8");
        await safeCreateFailedCallCalendarEvent(session, req, "errore di sistema");
        return res.send(forwardToHumanTwiml());
      }
      sayIt(vr, "Ti passo un operatore per completare la richiesta.");
      await safeCreateFailedCallCalendarEvent(session, req, "fallback");
      vr.hangup();
      res.set("Content-Type", "text/xml; charset=utf-8");
      return res.send(vr.toString());
    }

    const emptySpeech = !normalizeText(speech);
    // Richiesta operatore (modalità ibrida): chiedi il motivo, poi trasferisci se possibile, altrimenti richiamo.
    if (session.operatorState === "await_reason") {
      if (emptySpeech || isPureConsent(speech)) {
        session.operatorReasonTries = Number(session.operatorReasonTries || 0) + 1;
        if (session.operatorReasonTries < 2) {
          gatherSpeech(vr, session.operatorRetryPrompt || "Qual è il motivo della richiesta?");
          res.set("Content-Type", "text/xml; charset=utf-8");
          return res.send(vr.toString());
        }
        session.operatorReasonRaw = "non specificato";
      } else {
        session.operatorReasonRaw = String(speech || "").trim();
      }

      // Decidi dial live o richiamo
      await sendFallbackEmail(session, req, "operator_request");
      void sendOperatorEmail(session, req, "operator_request");

      const operatorPhone = getOperatorPhoneE164();
      const callerCandidates = [];
      if (isValidPhoneE164(TWILIO_VOICE_FROM)) callerCandidates.push(TWILIO_VOICE_FROM.trim());
      const inboundTo = req?.body?.To || req?.body?.Called || "";
      const inboundToE164 = parsePhoneNumber(inboundTo);
      if (isValidPhoneE164(inboundToE164)) callerCandidates.push(inboundToE164);
      const callerId = callerCandidates[0] || "";

      const canDialLive = canForwardToHuman();

      // Evita la creazione automatica dell'evento "chiamata interrotta" su ogni risposta HTTP
      session.fallbackEventCreated = true;

      

      // Registra sempre la richiesta di ricontatto prima di tentare il trasferimento live
      void safeCreateOperatorCallbackCalendarEvent(session, req, "requested");

      session.operatorState = null;
      session.operatorPrompt = null;
      session.operatorRetryPrompt = null;

      if (canDialLive) {
        res.set("Content-Type", "text/xml; charset=utf-8");
        return res.send(forwardToHumanTwiml(req));
      }

      sayIt(vr, "Perfetto. Ti faremo richiamare al più presto.");
      vr.hangup();
      res.set("Content-Type", "text/xml; charset=utf-8");
      return res.send(vr.toString());
    }

    if (!emptySpeech && isOperatorRequest(speech)) {
      session.operatorState = "await_reason";
      session.operatorReasonTries = 0;
      session.operatorReasonRaw = null;
      session.operatorPrompt = "Va bene. Dimmi in poche parole il motivo della richiesta.";
      session.operatorRetryPrompt = "Qual è il motivo della richiesta?";
      gatherSpeech(vr, session.operatorPrompt);
      res.set("Content-Type", "text/xml; charset=utf-8");
      return res.send(vr.toString());
    }
    if (session.step !== "intent" && !emptySpeech && isCancelCommand(speech)) {
      const canceled = await cancelCalendarEvent(session);
      if (canceled) {
        session.step = 1;
        gatherSpeech(vr, "Ho annullato la prenotazione. Vuoi prenotare di nuovo?");
      } else if (canForwardToHuman()) {
        await sendFallbackEmail(session, req, "cancel_request_forward");
        void sendOperatorEmail(session, req, "cancel_request_forward");
        res.set("Content-Type", "text/xml; charset=utf-8");
        await safeCreateFailedCallCalendarEvent(session, req, "richiesta operatore");
        return res.send(forwardToHumanTwiml());
      } else {
        session.step = 1;
        gatherSpeech(vr, "Ok, mi occupo di annullare la prenotazione. Vuoi fare una nuova richiesta?");
      }
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

    switch (session.step) {
      case "intent": {
        if (!session.intentWelcomed) {
          sayIt(vr, "Benvenuto da Tuttibrilli.");
          session.intentWelcomed = true;
        }
        if (emptySpeech) {
          gatherSpeech(vr, "Vuoi prenotare un tavolo, chiedere informazioni, oppure prenotare un evento?");
          res.set("Content-Type", "text/xml; charset=utf-8");
          return res.send(vr.toString());
        }

        const normalized = normalizeText(speech);
        let intent = null;
        if (normalized.includes("tavolo") || normalized.includes("prenot")) {
          intent = "table";
        } else if (
          normalized.includes("info") ||
          normalized.includes("informazioni") ||
          normalized.includes("orari") ||
          normalized.includes("menu")
        ) {
          intent = "info";
        } else if (
          normalized.includes("evento") ||
          normalized.includes("festa") ||
          normalized.includes("compleanno")
        ) {
          intent = "event";
        }

        if (!intent) {
          session.intentRetries += 1;
          if (session.intentRetries >= 2) {
            await sendFallbackEmail(session, req, "intent_retry_exhausted");
            void sendOperatorEmail(session, req, "intent_retry_exhausted");
            res.set("Content-Type", "text/xml; charset=utf-8");
            await safeCreateFailedCallCalendarEvent(session, req, "fallback");
            return res.send(forwardToHumanTwiml());
          }
          gatherSpeech(vr, "Vuoi prenotare un tavolo, chiedere informazioni, oppure prenotare un evento?");
          break;
        }

        session.intent = intent;
        session.intentRetries = 0;
        resetRetries(session);

        if (intent === "table") {
          session.step = 1;
          gatherSpeech(vr, "Perfetto, prenotiamo il tuo tavolo. Come ti chiami?");
          break;
        }

        if (intent === "info") {
          // Procedura ibrida: raccogli motivo, registra su Calendar e tenta inoltro operatore
          session.operatorState = "await_reason";
          session.operatorReasonTries = 0;
          session.operatorReasonRaw = null;
          session.operatorPrompt = "Va bene. Dimmi in poche parole di quali informazioni hai bisogno.";
          session.operatorRetryPrompt = "Di quali informazioni hai bisogno?";
          gatherSpeech(vr, session.operatorPrompt);
          break;
        }

        if (intent === "event") {
          // Procedura ibrida: raccogli motivo, registra su Calendar e tenta inoltro operatore
          session.operatorState = "await_reason";
          session.operatorReasonTries = 0;
          session.operatorReasonRaw = null;
          session.operatorPrompt = "Va bene. Dimmi in poche parole i dettagli dell\'evento e cosa ti serve.";
          session.operatorRetryPrompt = "Quali dettagli dell\'evento e cosa ti serve?";
          gatherSpeech(vr, session.operatorPrompt);
          break;
        }

        // Sicurezza: se per qualche motivo non siamo entrati in nessun intent
        gatherSpeech(vr, "Vuoi prenotare un tavolo, chiedere informazioni, oppure prenotare un evento?");
        break;
      }

      case "event_name": {
        if (emptySpeech) {
          const silenceResult = handleSilence(session, vr, () =>
            gatherSpeech(vr, "Perfetto. Come si chiama l'evento?")
          );
          if (silenceResult.action === "forward") {
            await sendFallbackEmail(session, req, "silence_event_name");
            void sendOperatorEmail(session, req, "silence_event_name");
            res.set("Content-Type", "text/xml; charset=utf-8");
            await safeCreateFailedCallCalendarEvent(session, req, "fallback");
            return res.send(forwardToHumanTwiml());
          }
          break;
        }
        session.eventName = speech.trim().slice(0, 80);
        resetRetries(session);
        session.step = "event_date";
        gatherSpeech(vr, "Per quale data vuoi prenotare l'evento?");
        break;
      }

      case "event_date": {
        if (emptySpeech) {
          const silenceResult = handleSilence(session, vr, () =>
            gatherSpeech(vr, "Per quale data vuoi prenotare l'evento?")
          );
          if (silenceResult.action === "forward") {
            await sendFallbackEmail(session, req, "silence_event_date");
            void sendOperatorEmail(session, req, "silence_event_date");
            res.set("Content-Type", "text/xml; charset=utf-8");
            await safeCreateFailedCallCalendarEvent(session, req, "fallback");
            return res.send(forwardToHumanTwiml());
          }
          break;
        }
        const eventDateISO = parseDateIT(speech);
        if (!eventDateISO) {
          gatherSpeech(vr, "Non ho capito la data. Puoi ripeterla?");
          break;
        }
        session.eventDateISO = eventDateISO;
        resetRetries(session);
        session.step = "event_time";
        gatherSpeech(vr, "A che ora vuoi prenotare l'evento?");
        break;
      }

      case "event_time": {
        if (emptySpeech) {
          const silenceResult = handleSilence(session, vr, () =>
            gatherSpeech(vr, "A che ora vuoi prenotare l'evento?")
          );
          if (silenceResult.action === "forward") {
            await sendFallbackEmail(session, req, "silence_event_time");
            void sendOperatorEmail(session, req, "silence_event_time");
            res.set("Content-Type", "text/xml; charset=utf-8");
            await safeCreateFailedCallCalendarEvent(session, req, "fallback");
            return res.send(forwardToHumanTwiml());
          }
          break;
        }
        const eventTime24 = parseTimeIT(speech);
        if (!eventTime24) {
          gatherSpeech(vr, "Non ho capito l'orario. Puoi ripeterlo?");
          break;
        }
        session.eventTime24 = eventTime24;
        resetRetries(session);
        const createdEvent = await createEventCalendarEvent(session);
        if (!createdEvent && canForwardToHuman()) {
          await sendFallbackEmail(session, req, "event_calendar_failed");
          void sendOperatorEmail(session, req, "event_calendar_failed");
          res.set("Content-Type", "text/xml; charset=utf-8");
          await safeCreateFailedCallCalendarEvent(session, req, "errore di sistema");
          return res.send(forwardToHumanTwiml());
        }
        sayIt(vr, "Grazie. Ho registrato la tua richiesta per l'evento. Ti contatteremo presto.");
        await sendFallbackEmail(session, req, "event_request_completed");
        if (canForwardToHuman()) {
          void sendOperatorEmail(session, req, "event_request_completed");
          res.set("Content-Type", "text/xml; charset=utf-8");
          await safeCreateFailedCallCalendarEvent(session, req, "richiesta operatore");
          return res.send(forwardToHumanTwiml());
        }
        vr.hangup();
        res.set("Content-Type", "text/xml; charset=utf-8");
        return res.send(vr.toString());
      }

      case 1: {
        if (emptySpeech) {
          const silenceResult = handleSilence(session, vr, () =>
            gatherSpeech(vr, t("step1_welcome_name.main"))
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
        gatherSpeech(vr, t("step2_confirm_name_ask_date.main", { name: session.name }));
        break;
      }

      case 2: {
        if (emptySpeech) {
          const silenceResult = handleSilence(session, vr, () =>
            gatherSpeech(vr, t("step3_confirm_date_ask_time.error"))
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
          gatherSpeech(vr, t("step3_confirm_date_ask_time.error"));
          break;
        }
        session.dateISO = dateISO;
        resetRetries(session);
        session.step = 3;
        session.dateLabel = formatDateLabel(dateISO);
        gatherSpeech(vr, "Perfetto. In quante persone siete?");
        break;
      }

      case 3: {
        if (emptySpeech) {
          const silenceResult = handleSilence(session, vr, () =>
            gatherSpeech(vr, t("step5_party_size_ask_notes.error"))
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
            await safeCreateFailedCallCalendarEvent(session, req, "fallback");
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
            await safeCreateFailedCallCalendarEvent(session, req, "fallback");
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
            await safeCreateFailedCallCalendarEvent(session, req, "fallback");
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
        gatherSpeech(vr, "Perfetto. Mi lasci un numero di telefono? Se è italiano, aggiungo io il +39.", { input: "speech dtmf" });
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
            await safeCreateFailedCallCalendarEvent(session, req, "fallback");
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
        gatherSpeech(vr, "Perfetto. Mi lasci un numero di telefono? Se è italiano, aggiungo io il +39.", { input: "speech dtmf" });
        break;
      }

      case 8: {
        if (emptySpeech) {
          const silenceResult = handleSilence(session, vr, () =>
            gatherSpeech(vr, "Scusami, non ho sentito il numero. Me lo ripeti?", { input: "speech dtmf" })
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
          gatherSpeech(vr, "Scusami, non ho capito il numero. Puoi ripeterlo?", { input: "speech dtmf" });
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
            await safeCreateFailedCallCalendarEvent(session, req, "fallback");
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
function handleOperatorAfterDial(req, res) {
  const vr = buildTwiml();
  const statusRaw = req?.body?.DialCallStatus || "";
  const status = String(statusRaw || "").trim().toLowerCase();
  const callSid = req?.body?.CallSid || "";
  const session = getSession(callSid);

  console.log("[DIAL] after-dial", {
    status: status || "(missing)",
    duration: req?.body?.DialCallDuration || "",
    to: req?.body?.To || "",
    from: req?.body?.From || "",
    callSid: callSid || "",
  });

  if (session) {
    // Evita evento generico "chiamata interrotta" su richieste HTTP successive
    session.fallbackEventCreated = true;
  }

  if (status === "completed") {
    vr.hangup();
    res.set("Content-Type", "text/xml; charset=utf-8");
    return res.send(vr.toString());
  }

  void sendOperatorEmail(session, req, `operator_dial_${status || "unknown"}`);
  void safeCreateOperatorCallbackCalendarEvent(session, req, status || "failed");

  sayIt(vr, "L'operatore non è disponibile. Ti faremo richiamare a breve.");
  vr.hangup();
  res.set("Content-Type", "text/xml; charset=utf-8");
  return res.send(vr.toString());
}

app.post("/twilio/voice/after-dial", (req, res) => handleOperatorAfterDial(req, res));
app.post("/twilio/voice/operator-fallback", (req, res) => handleOperatorAfterDial(req, res));


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
