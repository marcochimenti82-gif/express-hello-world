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
const MODIFIED_EVENT_COLOR_ID = process.env.MODIFIED_EVENT_COLOR_ID || "2"; // verde salvia (Google Calendar default)
const GOOGLE_CALENDAR_TZ = process.env.GOOGLE_CALENDAR_TZ || "Europe/Rome";
const CANCELED_EVENT_COLOR_ID = process.env.CANCELED_EVENT_COLOR_ID || "11"; // rosso
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
const CANCEL_WORDS = ["annulla", "annullare", "cancella", "cancellare", "disdici", "disdire"];

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
  { id: "T6", area: "inside", min: 2, max: 2 },
  { id: "T7", area: "inside", min: 2, max: 4 },
  { id: "T8", area: "inside", min: 2, max: 4 },
  { id: "T9", area: "inside", min: 2, max: 4 },
  { id: "T10", area: "inside", min: 2, max: 4, notes: "vicino ingresso" },
  { id: "T11", area: "inside", min: 2, max: 4 },
  { id: "T12", area: "inside", min: 2, max: 4 },
  { id: "T13", area: "inside", min: 2, max: 2 },
  { id: "T14", area: "inside", min: 4, max: 8, notes: "divanetto con tavolino" },
  { id: "T15", area: "inside", min: 4, max: 8, notes: "divanetto con tavolino" },
  { id: "T16", area: "inside", min: 4, max: 6, notes: "tavolo alto con sgabelli" },
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
  { displayId: "T14", area: "inside", replaces: ["T14", "T15"], min: 12, max: 18, notes: "unione T14+T15" },
  { displayId: "T10", area: "inside", replaces: ["T10", "T11"], min: 6, max: 6, notes: "unione T10+T11" },
  { displayId: "T11", area: "inside", replaces: ["T11", "T12"], min: 6, max: 6, notes: "unione T11+T12" },
  { displayId: "T10", area: "inside", replaces: ["T10", "T11", "T12"], min: 10, max: 12, notes: "unione T10+T11+T12" },
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



function sanitizeForTTS(input) {
  let t = String(input || "");
  // --- Fix apostrofi/accents per TTS ---
  // Normalizza Unicode (accenti coerenti) e spazi non standard
  try { t = t.normalize("NFC"); } catch (e) {}
  t = t.replace(/\u00A0/g, " "); // NBSP -> space

  // Apostrofi/virgolette tipografici -> ASCII
  t = t.replace(/[’‘]/g, "'").replace(/[“”]/g, '"');

  // Evita lettura "apostrofo" nelle elisioni (l'acqua -> l acqua)
  t = t.replace(/([A-Za-zÀ-ÖØ-öø-ÿ])'([A-Za-zÀ-ÖØ-öø-ÿ])/g, "$1 $2");
// normalizza spazi e caratteri
  t = t.replace(/ /g, " ").replace(/\s+/g, " ").trim();

  // espandi abbreviazioni frequenti (lettura voce)
  t = t.replace(/\btav\b/gi, "tavolo");
  t = t.replace(/\bpax\b/gi, "persone");
  t = t.replace(/\bnr\.?\b/gi, "numero");
  t = t.replace(/\bn[\.°º]?\s*(\d+)\b/gi, "numero $1");

  // orari: 20:30 / 20.30 -> 20 e 30
  t = t.replace(/(\d{1,2})[:.](\d{2})/g, "$1 e $2");

  // simboli
  t = t.replace(/\+/g, " piu ");
  t = t.replace(/€/g, " euro ");

  // ripulisci spazi
  t = t.replace(/\s+/g, " ").trim();
  return t;
}
function sayIt(response, text) {
  response.say({ language: "it-IT" }, xmlEscape(sanitizeForTTS(text)));
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
  gather.say({ language: "it-IT" }, xmlEscape(sanitizeForTTS(promptText)));
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
  if (!operatorPhone) {
    console.error("[DIAL] Operator phone missing/invalid:", { ENABLE_FORWARDING, OPERATOR_PHONE, HUMAN_FORWARD_TO });
    return vr.toString();
  }

  const inferredBaseUrl = (() => {
    if (BASE_URL) return BASE_URL.replace(/\/+$/, "");
    const proto = (req?.headers?.["x-forwarded-proto"] || req?.protocol || "https").toString();
    const host = (req?.headers?.["x-forwarded-host"] || req?.headers?.host || "").toString();
    if (!host) return "";
    return `${proto}://${host}`.replace(/\/+$/, "");
  })();

  const actionUrl = inferredBaseUrl ? `${inferredBaseUrl}/twilio/voice/after-dial` : "/twilio/voice/after-dial";

  const dialAttrs = { timeout: 25, action: actionUrl, method: "POST", answerOnBridge: true };

  // CallerId: preferisci sempre TWILIO_VOICE_FROM (numero Twilio). Fallback: numero chiamato in ingresso se E.164.
  let callerId = null;
  if (isValidPhoneE164(TWILIO_VOICE_FROM)) {
    callerId = TWILIO_VOICE_FROM.trim();
  } else {
    const inboundTo = req?.body?.To || req?.body?.Called || "";
    const inboundToE164 = parsePhoneNumber(inboundTo);
    if (isValidPhoneE164(inboundToE164)) callerId = inboundToE164;
  }

  if (callerId) {
    dialAttrs.callerId = callerId;
  } else {
    console.error("[DIAL] Missing callerId (TWILIO_VOICE_FROM invalid and no inbound To). Dial may fail.");
  }

  console.log("[DIAL] Dialing operator:", {
    operatorPhone,
    callerId: dialAttrs.callerId || "(default)",
    actionUrl,
    ENABLE_FORWARDING,
  });

  vr.dial(dialAttrs, operatorPhone);
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

async function sendEmailWithResend({ to, subject, text }) {
  try {
    if (!RESEND_API_KEY) {
      console.error("[EMAIL] RESEND_API_KEY is not set");
      return;
    }
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [to],
        subject: subject,
        text: text,
      }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error("[EMAIL] Resend failed:", response.status, errorText);
    }
  } catch (err) {
    console.error("[EMAIL] Resend failed:", err);
  }
}

async function sendFallbackEmail(session, req, reason) {
  const payload = buildFallbackEmailPayload(session, req, reason);
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
    console.error("[EMAIL] Fallback email failed:", err);
  }
}

async function sendFallbackEmailSmtpOnly(session, req, reason) {
  if (!SMTP_HOST) return;
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

  // destinatario operatore (fallback: EMAIL_TO)
  const toOperator = String(EMAIL_OPERATOR || EMAIL_TO || "").trim();
  if (!toOperator) {
    console.error("[EMAIL] EMAIL_OPERATOR/EMAIL_TO not set");
    return;
  }

  // Se hai configurato Resend, usa Resend; altrimenti SMTP.
  // (mantiene compatibilità: non cambia dipendenze)
  if ((EMAIL_PROVIDER || "").toLowerCase() === "resend") {
    await sendEmailWithResend({
      to: toOperator,
      subject: payload.subject,
      text: payload.text,
    });
    return;
  }

  try {
    if (!SMTP_HOST) {
      console.error("[EMAIL] SMTP_HOST is not set (operator email not sent)");
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
      to: toOperator, // operatore
      cc: EMAIL_TO || undefined, // opzionale: copia a indirizzo principale
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
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,!?]/g, "")
    .replace(/\s+/g, " ");
}

function extractSurnameFromSpeech(raw) {
  const t0 = String(raw || "").trim();
  if (!t0) return "";

  let t = t0
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  t = t
    .replace(/[.,!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const stop = new Set([
    "si",
    "ok",
    "eh",
    "allora",
    "diciamo",
    "credo",
    "penso",
    "forse",
    "magari",
    "dovrebbe",
    "dovrei",
    "mi",
    "sembra",
    "pare",
    "tipo",
    "praticamente",
    "cioe",
    "cioe'",
    "cioe’",
    "il",
    "la",
    "lo",
    "un",
    "una",
    "a",
    "nome",
    "cognome",
    "prenotazione",
    "intestata",
    "intestato",
    "per",
  ]);

  const connectors = new Set(["de", "di", "del", "della", "dello", "dei", "degli", "da", "d"]);

  const tokens = t.split(" ").filter(Boolean);
  // rimuovi stopword anche se ripetute
  const cleaned = tokens.filter((w) => !stop.has(w));
  if (cleaned.length === 0) return "";

  // prendi gli ultimi 1-3 token, mantenendo eventuale connettore (es. De Luca)
  const out = [];
  for (let i = cleaned.length - 1; i >= 0 && out.length < 3; i--) {
    out.unshift(cleaned[i]);
    if (out.length === 1 && i - 1 >= 0 && connectors.has(cleaned[i - 1])) {
      out.unshift(cleaned[i - 1]);
      i -= 1;
    }
  }

  return out.join(" ").trim().slice(0, 60);
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

/**
 * Extracts event duration in minutes from a Google Calendar event.
 * Returns null if it cannot be computed safely.
 */
function extractDurationMinutesFromEvent(ev) {
  try {
    if (!ev || !ev.start || !ev.end) return null;

    // Google Calendar may use dateTime (timed) or date (all-day).
    const startRaw = ev.start.dateTime || (ev.start.date ? `${ev.start.date}T00:00:00` : null);
    const endRaw = ev.end.dateTime || (ev.end.date ? `${ev.end.date}T00:00:00` : null);
    if (!startRaw || !endRaw) return null;

    const start = new Date(startRaw);
    const end = new Date(endRaw);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

    const diffMs = end.getTime() - start.getTime();
    const diffMin = Math.round(diffMs / 60000);

    // Guardrails: avoid crazy values (negative / too long).
    if (!Number.isFinite(diffMin)) return null;
    if (diffMin <= 0) return null;
    if (diffMin > 12 * 60) return null; // > 12h, likely wrong for a booking

    return diffMin;
  } catch {
    return null;
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
      gatherSpeech(vr, "Hai altre ? Se sì, dimmelo ora.");
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

// ====== intent / info helpers (VOICE) ======
function buildMainMenuPrompt() {
  return "Vuoi prenotare un tavolo, chiedere informazioni, prenotare un evento, oppure modificare o annullare una prenotazione?";
}

function isNoRequestsText(speech) {
  const tt = normalizeText(speech);
  if (!tt) return false;
  return (
    tt === "no" ||
    tt === "non" ||
    tt.includes("nessun") ||
    tt.includes("nessuna") ||
    tt.includes("nessuno") ||
    tt.includes("niente") ||
    tt.includes("nulla") ||
    tt.includes("non ho")
  );
}

function parseModificationChoices(speech) {
  const t = normalizeText(speech || "");
  if (!t) return [];

  const found = [];
  const push = (key, pos) => found.push({ key, pos });

  // Data / giorno
  if (/(\bdata\b|\bgiorno\b|\bdomani\b|\bdopodomani\b|\boggi\b|\bspost\b|\bposticip\b|\banticip\b|\bcambia\b.*\bdata\b)/i.test(t)) {
    push("date", t.search(/\bdata\b|\bgiorno\b|\bspost\b|\bposticip\b|\bdomani\b|\bdopodomani\b|\boggi\b/i));
  }

  // Orario
  if (/(\borario\b|\bora\b|\balle\b|\bspost\b.*\bora\b|\bcambia\b.*\borario\b)/i.test(t)) {
    push("time", t.search(/\borario\b|\bora\b|\balle\b/i));
  }

  // Persone
  if (/(\bpersone\b|\bpax\b|\bposti\b|\bsiamo\b|\bin\s*\d+\b|\bnumero\b.*\bpersone\b)/i.test(t)) {
    push("people", t.search(/\bpersone\b|\bpax\b|\bposti\b|\bsiamo\b/i));
  }

  if (!found.length) return [];

  found.sort((a, b) => a.pos - b.pos);
  const out = [];
  for (const f of found) {
    if (!out.includes(f.key)) out.push(f.key);
  }
  return out;
}

function gotoModifyField(session, vr, field, isFirst) {
  const intro = (msgFirst, msgNext) => (isFirst ? msgFirst : msgNext);

  if (field === "date") {
    session.operatorState = "manage_modify_set_date";
    gatherSpeech(
      vr,
      intro(
        "Ok perfetto, cominciamo con la data. Per quale giorno vuoi spostare la prenotazione?",
        "Perfetto. Adesso modifichiamo la data. Per quale giorno vuoi spostare la prenotazione?"
      )
    );
    return true;
  }

  if (field === "time") {
    session.operatorState = "manage_modify_set_time";
    gatherSpeech(
      vr,
      intro(
        "Ok perfetto, cominciamo con l'orario. Per che ora prenoto il vostro tavolo?",
        "Perfetto. Adesso modifichiamo l'orario. Per che ora prenoto il vostro tavolo?"
      )
    );
    return true;
  }

  if (field === "people") {
    session.operatorState = "manage_modify_set_people";
    gatherSpeech(
      vr,
      intro(
        "Ok perfetto, cominciamo con il numero di persone. In quanti sarete?",
        "Perfetto. Adesso modifichiamo il numero di persone. In quanti sarete?"
      )
    );
    return true;
  }

  if (field === "notes") {
    session.operatorState = "manage_modify_set_notes";
    gatherSpeech(
      vr,
      intro(
        "Ok. Dimmi le  da aggiungere o modificare. Se non ce ne sono, dì: nessuna.",
        "Perfetto. Adesso le . Dimmi cosa vuoi aggiungere o modificare. Se non ce ne sono, dì: nessuna."
      )
    );
    return true;
  }

  return false;
}

// ====== gestione MODIFICA BLOCCO TAVOLO (LOCK / SLOT) ======

function parseLockModificationChoices(speech) {
  const t = normalizeText(speech || "");
  if (!t) return [];

  const found = [];
  const push = (key, pos) => found.push({ key, pos });

  // Data
  const mDate = t.search(/\b(data|giorno|domani|dopodomani|oggi)\b/);
  if (mDate >= 0) push("date", mDate);

  // Orario
  const mTime = t.search(/\b(orario|ora)\b/);
  if (mTime >= 0) push("time", mTime);

  // Durata
  const mDur = t.search(/\b(durata|minuti|ore|ora)\b/);
  if (mDur >= 0 && !found.some((x) => x.key === "duration")) push("duration", mDur);

  // Tavolo
  const mTab = t.search(/\b(tavolo|tav\.?|tav)\b/);
  if (mTab >= 0) push("table", mTab);

  // Dedup preserving order
  found.sort((a, b) => a.pos - b.pos);
  const out = [];
  for (const f of found) {
    if (!out.includes(f.key)) out.push(f.key);
  }
  return out;
}

function parseTableIdIT(speech) {
  const tt = normalizeText(speech);
  if (!tt) return null;

  // digits
  const m = tt.match(/\b(\d{1,2})\b/);
  let n = null;
  if (m) {
    const v = Number(m[1]);
    if (Number.isFinite(v) && v > 0) n = v;
  }

  if (n == null) {
    // common italian number words (same as parsePeopleIT)
    const map = {
      uno: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6,
      sette: 7, otto: 8, nove: 9, dieci: 10, undici: 11, dodici: 12,
      tredici: 13, quattordici: 14, quindici: 15, sedici: 16, diciassette: 17,
    };
    const words = tt.split(/\s+/).filter(Boolean);
    for (const w of words) {
      if (Object.prototype.hasOwnProperty.call(map, w)) { n = map[w]; break; }
    }
  }

  if (n == null) return null;

  const wantsOutside =
    tt.includes("fuori") || tt.includes("esterno") || tt.includes("all'aperto") || tt.includes("outside") ||
    tt.includes("terrazza");

  const suffix = wantsOutside || tt.includes(" f") || tt.includes("effe") ? "F" : "";
  return normalizeTableId(`T${n}${suffix}`);
}

function parseDurationMinutesIT(speech) {
  const tt = normalizeText(speech);
  if (!tt) return null;

  // direct minutes number
  const m = tt.match(/\b(\d{1,3})\b/);
  if (m) {
    const v = Number(m[1]);
    if (Number.isFinite(v) && v >= 15 && v <= 600) return v;
  }

  // patterns: "due ore", "un'ora", "ora e mezza", "mezz'ora"
  const hasMezza = tt.includes("mezza") || tt.includes("mezzo") || tt.includes("mezzora") || tt.includes("mezz'ora");
  const map = {
    un: 1, una: 1, uno: 1,
    due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10,
  };

  // "X ore"
  const mOre = tt.match(/\b(un|una|uno|due|tre|quattro|cinque|sei|sette|otto|nove|dieci)\b.*\bore?\b/);
  if (mOre) {
    const h = map[mOre[1]];
    if (h) return h * 60 + (hasMezza ? 30 : 0);
  }

  // "mezz'ora"
  if (hasMezza && (tt.includes("ora") || tt.includes("ore"))) return 90; // default "un'ora e mezza" interpreted as 90
  if (hasMezza && !tt.includes("ora") && !tt.includes("ore")) return 30;

  return null;
}

function isAvailabilityEvent(ev) {
  const kind = ev?.extendedProperties?.private?.ai_kind;
  const s = String(ev?.summary || "").toLowerCase();
  const d = String(ev?.description || "").toLowerCase();
  return (
    kind === "availability" ||
    s.includes("lock") ||
    (s.includes("tav") && s.includes("occup")) ||
    d.includes("lock") ||
    (d.includes("tav") && d.includes("occup"))
  );
}

function getLockTableIdFromEvent(ev) {
  const priv = ev?.extendedProperties?.private || {};
  if (priv.tableId) return normalizeTableId(priv.tableId);

  const tables = extractTablesFromEvent(ev);
  if (tables && tables.length > 0) return normalizeTableId(tables[0]);

  return null;
}

function findAvailabilityLockMatchFromEvents({ eventsForDate, dateISO, time24, tableId, tz }) {
  const targetStart = makeUtcDateFromZoned(dateISO, time24, tz);
  if (!targetStart) return null;
  const targetMs = targetStart.getTime();

  const candidates = (eventsForDate || []).filter((ev) => isAvailabilityEvent(ev));

  let filtered = candidates;
  if (tableId) {
    filtered = candidates.filter((ev) => getLockTableIdFromEvent(ev) === tableId);
    if (filtered.length === 0) filtered = candidates; // fallback
  }

  let best = null;
  let bestDistMin = Infinity;

  for (const ev of filtered) {
    const r = getEventTimeRange(ev);
    if (!r) continue;
    const distMin = Math.abs(r.start.getTime() - targetMs) / 60000;
    if (distMin < bestDistMin) {
      bestDistMin = distMin;
      best = ev;
    }
  }

  if (!best) return null;
  if (bestDistMin > 30) return null; // tolleranza 30 min
  return best;
}

function gotoLockModifyField(session, vr, field, isFirst) {
  const intro = (msgFirst, msgNext) => (isFirst ? msgFirst : msgNext);

  if (field === "date") {
    session.operatorState = "manage_lock_set_date";
    gatherSpeech(
      vr,
      intro(
        "Ok perfetto, cominciamo con la data. Per quale giorno vuoi spostare il blocco tavolo?",
        "Perfetto. Adesso modifichiamo la data. Per quale giorno vuoi spostare il blocco tavolo?"
      )
    );
    return true;
  }

  if (field === "time") {
    session.operatorState = "manage_lock_set_time";
    gatherSpeech(
      vr,
      intro(
        "Ok perfetto, cominciamo con l'orario. A che ora deve iniziare il blocco?",
        "Perfetto. Adesso modifichiamo l'orario. A che ora deve iniziare il blocco?"
      )
    );
    return true;
  }

  if (field === "duration") {
    session.operatorState = "manage_lock_set_duration";
    gatherSpeech(
      vr,
      intro(
        "Ok perfetto, cominciamo con la durata. Quanti minuti deve durare il blocco? Puoi dire anche: due ore.",
        "Perfetto. Adesso modifichiamo la durata. Quanti minuti deve durare il blocco?"
      )
    );
    return true;
  }

  if (field === "table") {
    session.operatorState = "manage_lock_set_table";
    gatherSpeech(
      vr,
      intro(
        "Ok perfetto, cominciamo con il tavolo. Quale tavolo vuoi bloccare?",
        "Perfetto. Adesso modifichiamo il tavolo. Quale tavolo vuoi bloccare?"
      )
    );
    return true;
  }

  return false;
}

async function patchAvailabilityLockEvent({
  eventId,
  newDateISO,
  newTime24,
  newDurationMinutes,
  newTableId,
}) {
  if (!GOOGLE_CALENDAR_ID) return false;
  const calendar = buildCalendarClient();
  if (!calendar) return false;
  const tz = GOOGLE_CALENDAR_TZ || "Europe/Rome";

  const startDate = makeUtcDateFromZoned(newDateISO, newTime24, tz) || new Date(`${newDateISO}T${newTime24}:00`);
  const duration = Number.isFinite(newDurationMinutes) && newDurationMinutes > 0 ? newDurationMinutes : 120;
  const endDate = new Date(startDate.getTime() + duration * 60000);

  const colorId = safeColorId("11"); // rosso per blocchi

  const requestBodyBase = {
    summary: newTableId ? `LOCK ${newTableId}` : "LOCK",
    description: [
      "BLOCCO TAVOLO",
      newTableId ? `Tavolo: ${newTableId}` : "",
      `Durata: ${duration} minuti`,
    ]
      .filter(Boolean)
      .join("\n"),
    start: { dateTime: startDate.toISOString(), timeZone: tz },
    end: { dateTime: endDate.toISOString(), timeZone: tz },
    extendedProperties: {
      private: {
        ai_kind: "availability",
        ...(newTableId ? { tableId: String(newTableId) } : {}),
      },
    },
    ...(colorId ? { colorId } : {}),
  };

  try {
    await calendar.events.patch({
      calendarId: GOOGLE_CALENDAR_ID,
      eventId,
      requestBody: requestBodyBase,
    });
    return true;
  } catch (err) {
    console.error("[GOOGLE] Patch lock failed:", err?.message);
    console.error("[GOOGLE] Patch lock details:", err?.response?.data || err);

    // retry without colorId if it might be the cause
    if (requestBodyBase.colorId) {
      try {
        const retryBody = { ...requestBodyBase };
        delete retryBody.colorId;
        await calendar.events.patch({
          calendarId: GOOGLE_CALENDAR_ID,
          eventId,
          requestBody: retryBody,
        });
        return true;
      } catch (err2) {
        console.error("[GOOGLE] Patch lock retry (no color) failed:", err2?.message);
        console.error("[GOOGLE] Patch lock retry details:", err2?.response?.data || err2);
      }
    }
    return false;
  }
}



function handleModifyFinalize(session, vr) {
  const original = session.manageCandidateEvent || {};
  const originalNotes = extractNotesFromDescription(original?.description) || "";
  const originalDateISO =
    (session.manageOriginal && session.manageOriginal.originalDateISO) ||
    String(original?.start?.dateTime || original?.start?.date || session.manageDateISO || "").slice(0, 10);

  const proposed = session.manageProposed || {};
  const newDateISO = proposed.dateISO || originalDateISO;
  const newTime24 =
    proposed.time24 ||
    (session.manageOriginal && session.manageOriginal.originalTime24) ||
    session.manageTime24;

  const newPeople =
    proposed.people ||
    (session.manageOriginal && session.manageOriginal.originalPeople) ||
    extractPeopleFromDescription(original?.description) ||
    extractPeopleFromSummary(original?.summary) ||
    2;

  const newNotes = (proposed.notes != null ? proposed.notes : originalNotes) || originalNotes || "";

  // Se mancano dati minimi
  if (!newDateISO || !newTime24) {
    session.operatorState = "forward_operator";
    gatherSpeech(vr, "Non riesco a completare la modifica perché mancano data o orario. Ti metto in contatto con un operatore.");
    return { kind: "vr", twiml: vr.toString() };
  }

  // verifica disponibilità tavolo per la nuova combinazione
  // (esclude l'evento da modificare)
  return (async () => {
    const selection = await computeTableSelectionForChange({
      dateISO: newDateISO,
      time24: newTime24,
      people: newPeople,
      ignoreEventId: session.manageCandidateEventId,
    });

    if (!selection || selection.status === "closed") {
      return forwardBecause(
        `Richiesta modifica prenotazione: giorno chiuso (${newDateISO}) (evento ${session.manageCandidateEventId || ""})`
      );
    }
    if (selection.status === "unavailable") {
      return forwardBecause(
        `Richiesta modifica prenotazione: non disponibile (${newDateISO} ${newTime24} ${newPeople}) (evento ${session.manageCandidateEventId || ""})`
      );
    }

    session.managePendingUpdate = {
      eventId: session.manageCandidateEventId,
      originalEvent: original,
      newDateISO,
      newTime24,
      newPeople,
      newNotes,
      newSelection: selection,
      durationMinutes: extractDurationMinutesFromEvent(original) || 120,
      modificationRaw: session.manageModificationRaw || "",
    };

    session.operatorState = "manage_modify_confirm_apply";

    const notesLabel = newNotes && String(newNotes).trim().length > 0 ? String(newNotes).trim() : "nessuna";
    gatherSpeech(
      vr,
      `Perfetto. Riepilogo: ${formatDateLabel(newDateISO)} alle ${newTime24}, per ${newPeople} persone. Richieste: ${notesLabel}. Vuoi confermare la modifica?`
    );
    return { kind: "vr", twiml: vr.toString() };
  })();
}


function parseNextWeekdayISO(speech) {
  const tt = normalizeText(speech);
  if (!tt) return null;
  const map = {
    lunedi: 1,
    "lunedì": 1,
    martedi: 2,
    "martedì": 2,
    mercoledi: 3,
    "mercoledì": 3,
    giovedi: 4,
    "giovedì": 4,
    venerdi: 5,
    "venerdì": 5,
    sabato: 6,
    domenica: 0,
  };
  const found = Object.keys(map).find((k) => tt.includes(k));
  if (!found) return null;
  const targetDow = map[found];
  const tz = GOOGLE_CALENDAR_TZ || "Europe/Rome";
  const todayISO = formatISODateInTimeZone(new Date(), tz);
  const todayNoon = makeUtcDateFromZoned(todayISO, "12:00", tz) || new Date(`${todayISO}T12:00:00`);
  const todayDow = todayNoon.getUTCDay();
  const delta = (targetDow - todayDow + 7) % 7;
  return addDaysToISODate(todayISO, delta);
}

function resolveNataleISO() {
  const tz = GOOGLE_CALENDAR_TZ || "Europe/Rome";
  const todayISO = formatISODateInTimeZone(new Date(), tz);
  const year = Number(String(todayISO).slice(0, 4)) || new Date().getFullYear();
  const nataleThisYear = `${year}-12-25`;
  if (todayISO <= nataleThisYear) return nataleThisYear;
  return `${year + 1}-12-25`;
}

function extractMusicItemsFromEvents(events) {
  if (!Array.isArray(events)) return [];
  const items = [];
  for (const ev of events) {
    const summary = String(ev?.summary || "").trim();
    const sumL = summary.toLowerCase();
    const descL = String(ev?.description || "").toLowerCase();
    if (!summary) continue;
    if (sumL.includes("tavoli disponibili")) continue;
    if (sumL.includes("locale chiuso") || descL.includes("locale chiuso")) continue;
    // Evita prenotazioni tavoli
    if (ev?.extendedProperties?.private?.ai_kind === "booking") continue;
    const isMusic =
      sumL.includes("dj") ||
      sumL.includes("live") ||
      sumL.includes("jazz") ||
      sumL.includes("music") ||
      descL.includes("dj") ||
      descL.includes("live") ||
      descL.includes("jazz") ||
      descL.includes("music");
    if (isMusic) items.push(summary);
  }
  return items;
}

function stripOreETavolo(summary) {
  let s = String(summary || "").trim();
  // rimuove "Ore 20:30," all'inizio
  s = s.replace(/^ore\s*\d{1,2}:\d{2}\s*,\s*/i, "");
  // rimuove "tav ...," all'inizio
  s = s.replace(/^tav\s*[^,]+,\s*/i, "");
  // rimuove eventuali " , tav ..." rimaste
  s = s.replace(/,\s*tav\s*[^,]+/gi, "");
  // normalizza virgole/spazi
  s = s.replace(/\s*,\s*/g, ", ").replace(/^,\s*/, "").trim();
  return s;
}

async function findBookingCandidatesByDate(dateISO) {
  if (!dateISO) return [];
  const events = await listCalendarEvents(dateISO);
  return (events || []).filter((ev) => ev?.extendedProperties?.private?.ai_kind === "booking");
}

function filterCandidatesBySurname(candidates, surnameRaw) {
  const s = normalizeText(surnameRaw);
  if (!s) return candidates;
  return (candidates || []).filter((ev) => {
    const sum = normalizeText(ev?.summary || "");
    const desc = normalizeText(ev?.description || "");
    return sum.includes(s) || desc.includes(s);
  });
}

function filterCandidatesByTime(candidates, time24) {
  if (!time24) return candidates;
  const t = String(time24);
  return (candidates || []).filter((ev) => {
    const sum = String(ev?.summary || "");
    return sum.toLowerCase().includes(`ore ${t}`.toLowerCase());
  });
}

function extractDateISOFromEvent(ev) {
  const dt = ev?.start?.dateTime || ev?.start?.date || "";
  return String(dt).slice(0, 10);
}

async function findBookingEventMatch({ dateISO, time24, surname }) {
  const tz = GOOGLE_CALENDAR_TZ || "Europe/Rome";
    const base = await findBookingCandidatesByDate(dateISO);
    const normalizedSurname = normalizeText(surname);

    // 1) Se il cognome filtra a zero risultati, NON fallire: fallback ai candidati del giorno
    let candidates = base || [];
    if (normalizedSurname) {
      const bySurname = filterCandidatesBySurname(candidates, surname);
      if (bySurname && bySurname.length) candidates = bySurname;
    }

    // Helper per estrarre HH:MM dall'evento usando start.dateTime (più affidabile del summary)
    const parseHHMM = (hhmm) => {
      const m = String(hhmm || "").match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return null;
      const hh = Number(m[1]);
      const mm = Number(m[2]);
      if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
      if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
      return hh * 60 + mm;
    };

    const getEventMinutes = (ev) => {
      try {
        const dt = ev?.start?.dateTime || ev?.start?.date;
        if (!dt) return null;
        const d = new Date(dt);
        if (Number.isNaN(d.getTime())) return null;
        const parts = getPartsInTimeZone(d, tz);
        const hh = Number(parts.hour);
        const mm = Number(parts.minute);
        if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
        return hh * 60 + mm;
      } catch {
        return null;
      }
    };

    const targetMinutes = parseHHMM(time24);

    // 2) Se abbiamo orario, scegli il candidato con differenza minima (tolleranza)
    let match = null;
    if (targetMinutes != null && candidates.length) {
      const scored = candidates
        .map((ev) => {
          const evMin = getEventMinutes(ev);
          const diff = evMin == null ? null : Math.abs(evMin - targetMinutes);
          const sum = normalizeText(ev?.summary || "");
          const desc = normalizeText(ev?.description || "");
          const surnameHit = normalizedSurname ? (sum.includes(normalizedSurname) || desc.includes(normalizedSurname)) : false;
          const summaryHit = sum.includes(normalizeText(`ore ${time24}`));
          // score: diff in minuti (basso è meglio), bonus se matcha cognome/summary
          const score =
            (diff == null ? 9999 : diff) -
            (surnameHit ? 5 : 0) -
            (summaryHit ? 2 : 0);
          return { ev, diff, score };
        })
        .sort((a, b) => a.score - b.score);

      // accetta se diff entro 30 minuti, altrimenti fallback
      if (scored[0] && (scored[0].diff == null || scored[0].diff <= 30)) {
        match = scored[0].ev;
      }
    }

    // 3) Fallback: vecchio matching su summary "Ore HH:MM"
    if (!match) {
      const byTime = filterCandidatesByTime(candidates, time24);
      match = (byTime && byTime.length ? byTime[0] : candidates[0]) || null;
    }

    return { match, candidates };
}

async function patchBookingAsCanceled(eventId, dateISO, originalEvent) {
  // Versione "anti-bug": tenta più strategie e logga l'errore reale.
  // Obiettivo: marcare l'evento come annullato senza rompere lo start/end.
  if (!GOOGLE_CALENDAR_ID || !eventId || !dateISO) return null;
  const calendar = buildCalendarClient();
  if (!calendar) return null;

  const originalSummary = String(originalEvent?.summary || "");
  const stripped = stripOreETavolo(originalSummary);
  const newSummary = stripped ? `Annullato - ${stripped}` : "Annullato - Prenotazione";

  const oldDesc = String(originalEvent?.description || "").trim();
  const newDesc = [
    "ANNULLAMENTO PRENOTAZIONE",
    `Data annullamento: ${formatISODateInTimeZone(new Date(), GOOGLE_CALENDAR_TZ || "Europe/Rome")}`,
    "",
    "DESCRIZIONE PRECEDENTE:",
    oldDesc || "-",
  ].join("\n");

  const patchBody = { summary: newSummary, description: newDesc, ...(CANCELED_EVENT_COLOR_ID ? { colorId: CANCELED_EVENT_COLOR_ID } : {}) };

  const logGoogleErr = (label, err) => {
    const status = err?.response?.status ?? err?.code ?? null;
    const data = err?.response?.data ?? null;
    const message = err?.message ?? null;
    console.error(`[GOOGLE] Cancel ${label} failed:`, { status, message, data });
  };

  // Tentativo 1: PATCH minimale (summary/description)
  try {
    const result = await calendar.events.patch({
      calendarId: GOOGLE_CALENDAR_ID,
      eventId,
      sendUpdates: "none",
      requestBody: patchBody,
    });
    await upsertAvailabilityEvent(dateISO);
    console.log("[GOOGLE] Cancel PATCH ok", { eventId });
    return result?.data || null;
  } catch (err1) {
    logGoogleErr("PATCH", err1);
  }

  // Tentativo 2: GET + UPDATE completo (alcuni calendari/oggetti falliscono con PATCH)
  try {
    const current = await calendar.events.get({
      calendarId: GOOGLE_CALENDAR_ID,
      eventId,
    });

    // UPDATE richiede un body completo: partiamo dall'evento attuale e sovrascriviamo i campi.
    // (Non tocchiamo start/end, organizer, attendees, ecc.)
    const body = { ...(current?.data || {}), ...patchBody };

    const result2 = await calendar.events.update({
      calendarId: GOOGLE_CALENDAR_ID,
      eventId,
      sendUpdates: "none",
      requestBody: body,
    });

    await upsertAvailabilityEvent(dateISO);
    console.log("[GOOGLE] Cancel GET+UPDATE ok", { eventId });
    return result2?.data || null;
  } catch (err2) {
    logGoogleErr("GET+UPDATE", err2);
  }

  // Tentativo 3: PATCH con status cancelled (fallback estremo)
  // Nota: può far sparire l'evento dalla vista standard del calendario (equivale a cancellazione).
  try {
    const result3 = await calendar.events.patch({
      calendarId: GOOGLE_CALENDAR_ID,
      eventId,
      sendUpdates: "none",
      requestBody: { ...patchBody, status: "cancelled" },
    });
    await upsertAvailabilityEvent(dateISO);
    console.log("[GOOGLE] Cancel PATCH(status=cancelled) ok", { eventId });
    return result3?.data || null;
  } catch (err3) {
    logGoogleErr("PATCH(status=cancelled)", err3);
  }

  return null;
}

async function computeTableSelectionForChange({ dateISO, time24, people, ignoreEventId }) {
  const events = await listCalendarEvents(dateISO);
  if (isDateClosedByCalendar(events)) return { status: "closed" };
  const tz = GOOGLE_CALENDAR_TZ || "Europe/Rome";
  const durationMinutes = computeDurationMinutes({ people, time24 }, events);
  const bookingStart = makeUtcDateFromZoned(dateISO, time24, tz);
  const bookingEnd = new Date(bookingStart.getTime() + (durationMinutes || 120) * 60 * 1000);
  const bookingRange = { start: bookingStart, end: bookingEnd };
  const occupied = new Set();
  const eventoEvents = [];

  for (const ev of events) {
    if (ignoreEventId && ev?.id === ignoreEventId) continue;
    const summary = String(ev.summary || "").toLowerCase();
    const eventType = ev.extendedProperties?.private?.type || "";
    if (summary.startsWith("annullata") || summary.startsWith("annullato")) continue;
    if (summary.includes("tavoli disponibili")) continue;
    if (summary.includes("locale chiuso")) continue;
    if (summary.includes("evento") || eventType === "evento") {
      eventoEvents.push(ev);
      continue;
    }
    const eventRange = getEventTimeRange(ev);
    if (!eventRange || !overlapsRange(bookingRange, eventRange)) continue;
    const tableIds = extractTablesFromEvent(ev);
    tableIds.forEach((id) => occupied.add(id));
  }

  let availableOverride = null;
  if (eventoEvents.length > 0) {
    const eventTables = eventoEvents.flatMap((ev) => extractTablesFromEvent(ev));
    availableOverride = new Set(eventTables);
  }

  const selection = pickTableForParty(people, occupied, availableOverride, { people });
  if (!selection || !isValidTableSelection(selection)) return { status: "unavailable" };
  return { status: "ok", selection, durationMinutes };
}

async function patchBookingAsModified({
  eventId,
  originalEvent,
  newDateISO,
  newTime24,
  newPeople,
  newNotes,
  newSelection,
  durationMinutes,
  modificationRaw,
}) {
  if (!GOOGLE_CALENDAR_ID || !eventId || !newDateISO || !newTime24) return null;
  const calendar = buildCalendarClient();
  if (!calendar) return null;

  const tableLabel = newSelection?.locks?.length ? newSelection.locks.join(" e ") : "da assegnare";
  const oldDesc = String(originalEvent?.description || "").trim();
  const nameMatch = oldDesc.match(/^Nome:\s*(.+)$/im);
  const name = (nameMatch?.[1] || "").trim() || "Cliente";
  const people = Number.isFinite(newPeople) ? newPeople : Number((oldDesc.match(/^Persone:\s*(\d+)/im) || [])[1]) || null;
  const tz = GOOGLE_CALENDAR_TZ || "Europe/Rome";
  const safeColorId = (typeof MODIFIED_EVENT_COLOR_ID === "string" && /^[0-9]+$/.test(MODIFIED_EVENT_COLOR_ID)
    && Number(MODIFIED_EVENT_COLOR_ID) >= 1 && Number(MODIFIED_EVENT_COLOR_ID) <= 11)
    ? MODIFIED_EVENT_COLOR_ID
    : null;
  const endDateTime = computeEndDateTime(newDateISO, newTime24, durationMinutes || 120, tz);

  const baseDescLines = [
    `Nome: ${name}`,
    `Persone: ${people || ""}`,
    `Note: ${String(newNotes || "").trim() ? String(newNotes).trim().slice(0, 200) : buildSpecialRequestsText({ extraRequestsRaw: "nessuna", specialRequestsRaw: "nessuna" })}`,
    `Preordine: ${(String(originalEvent?.description || "").match(/^Preordine:\s*(.+)$/im)?.[1] || "nessuno").trim()}`,
    `Tavolo: ${tableLabel}`,
    `Telefono: ${(String(originalEvent?.description || "").match(/^Telefono:\s*(.+)$/im)?.[1] || "non fornito").trim()}`,
  ].join("\n");

  const updatedDescription = [
    "MODIFICA PRENOTAZIONE",
    `Data modifica: ${formatISODateInTimeZone(new Date(), tz)}`,
    modificationRaw ? `Richiesta: ${String(modificationRaw).trim().slice(0, 200)}` : "",
    "",
    "DESCRIZIONE PRECEDENTE:",
    oldDesc || "-",
    "",
    "DESCRIZIONE AGGIORNATA:",
    baseDescLines,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const requestBody = {
      summary: `Ore ${newTime24}, tav ${tableLabel}, ${name}, ${people || ""} pax`.trim(),
      description: updatedDescription,
      ...(safeColorId ? { colorId: safeColorId } : {}),
      start: { dateTime: `${newDateISO}T${newTime24}:00`, timeZone: tz },
      end: { dateTime: endDateTime, timeZone: tz },
    };

    let result;
    try {
      result = await calendar.events.patch({
        calendarId: GOOGLE_CALENDAR_ID,
        eventId,
        requestBody,
      });
    } catch (err) {
      // If Google rejects the colorId, retry once without it.
      if (safeColorId) {
        console.warn("[GOOGLE] Patch failed with colorId, retrying without colorId:", err?.message);
        const rb2 = { ...requestBody };
        delete rb2.colorId;
        result = await calendar.events.patch({
          calendarId: GOOGLE_CALENDAR_ID,
          eventId,
          requestBody: rb2,
        });
      } else {
        throw err;
      }
    }
    const oldDateISO = extractDateISOFromEvent(originalEvent);
    if (oldDateISO) await upsertAvailabilityEvent(oldDateISO);
    await upsertAvailabilityEvent(newDateISO);
    return result?.data || null;
  } catch (err) {
    console.error("[GOOGLE] Modify booking patch failed:", err);
    return null;
  }
}

/* ===========================
CRITICITA 1 — INFO “SMART”
- musica: gestisce anche “prossima settimana / settimana prossima / questa settimana”
- disponibilita: controlla PRIMA se il locale e' chiuso (es. lunedi) e lo dice subito
- migliora matching “mercoledi c'e musica” (cerca eventi musicali del giorno)
- usa calendario per risposte (musica / apertura / disponibilita)
=========================== */

function parseWeekdayIndexIT(text) {
  const t = normalizeText(text || "");
  if (!t) return null;
  // 0=Sun ... 6=Sat
  const map = [
    { keys: ["domenica"], dow: 0 },
    { keys: ["lunedi", "lunedì"], dow: 1 },
    { keys: ["martedi", "martedì"], dow: 2 },
    { keys: ["mercoledi", "mercoledì"], dow: 3 },
    { keys: ["giovedi", "giovedì"], dow: 4 },
    { keys: ["venerdi", "venerdì"], dow: 5 },
    { keys: ["sabato"], dow: 6 },
  ];
  for (const item of map) {
    if (item.keys.some((k) => t.includes(k))) return item.dow;
  }
  return null;
}

function getWeekdayIndexInTimeZone(dateISO, tz) {
  const d = makeUtcDateFromZoned(dateISO, "12:00", tz) || new Date(`${dateISO}T12:00:00`);
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d);
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[wd] ?? null;
}

function getCurrentWeekRangeISO(todayISO, tz) {
  const dow = getWeekdayIndexInTimeZone(todayISO, tz);
  if (dow === null) return { startISO: todayISO, endISO: todayISO };
  const deltaToMonday = dow === 0 ? 6 : dow - 1; // Monday=1
  const startISO = addDaysToISODate(todayISO, -deltaToMonday);
  const endISO = addDaysToISODate(startISO, 6);
  return { startISO, endISO };
}

function getNextWeekRangeISO(todayISO, tz) {
  const curr = getCurrentWeekRangeISO(todayISO, tz);
  const startISO = addDaysToISODate(curr.startISO, 7);
  const endISO = addDaysToISODate(startISO, 6);
  return { startISO, endISO };
}

function resolveChristmasISO() {
  const tz = GOOGLE_CALENDAR_TZ || "Europe/Rome";
  const todayISO = formatISODateInTimeZone(new Date(), tz);
  const year = Number(String(todayISO).slice(0, 4)) || new Date().getFullYear();
  const thisYear = `${year}-12-25`;
  return todayISO <= thisYear ? thisYear : `${year + 1}-12-25`;
}

function isMusicEventItem(event) {
  const summary = String(event?.summary || "");
  const description = String(event?.description || "");
  const s = summary.toLowerCase();
  const d = description.toLowerCase();

  const sNorm = normalizeText(summary);
  if (!sNorm) return false;

  // escludi eventi di sistema / disponibilita / richiami / prenotazioni
  if (
    sNorm.includes("tavoli disponibili") ||
    sNorm.includes("richiamare") ||
    sNorm.startsWith("annullat") ||
    sNorm.includes("chiuso") ||
    sNorm.includes("chiusura") ||
    sNorm.startsWith("ore ")
  ) {
    return false;
  }

  const blob = `${s} ${d}`;
  const hasMusicKeyword =
    blob.includes("dj") ||
    blob.includes("dj set") ||
    blob.includes("live") ||
    blob.includes("live music") ||
    blob.includes("musica") ||
    blob.includes("jazz") ||
    blob.includes("concerto") ||
    blob.includes("band") ||
    blob.includes("quartet") ||
    blob.includes("quartetto") ||
    blob.includes("quartetto");

  if (!hasMusicKeyword) return false;

  // include ALL-DAY solo se keyword in titolo o descrizione (gia' incluso nel blob)
  return true;
}

function getEventStartDateISO(event) {
  const tz = GOOGLE_CALENDAR_TZ || "Europe/Rome";
  const start = event?.start?.dateTime || event?.start?.date;
  if (!start) return null;
  const d = new Date(start);
  return formatISODateInTimeZone(d, tz);
}

async function listCalendarEventsBetweenISO(startISO, endISOInclusive) {
  if (!GOOGLE_CALENDAR_ID) return [];
  const calendar = buildCalendarClient();
  if (!calendar) return [];
  const tz = GOOGLE_CALENDAR_TZ || "Europe/Rome";
  const timeMin = makeUtcDateFromZoned(startISO, "00:00", tz) || new Date(`${startISO}T00:00:00`);
  const endExclusiveISO = addDaysToISODate(endISOInclusive, 1);
  const timeMax = makeUtcDateFromZoned(endExclusiveISO, "00:00", tz) || new Date(`${endExclusiveISO}T00:00:00`);
  try {
    const result = await calendar.events.list({
      calendarId: GOOGLE_CALENDAR_ID,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });
    return result?.data?.items || [];
  } catch (err) {
    console.error("[GOOGLE] Calendar list (range) failed:", err);
    return [];
  }
}

function isBusinessClosedOnDateISO(dateISO, eventsForDate) {
  const tz = GOOGLE_CALENDAR_TZ || "Europe/Rome";
  const dow = getWeekdayIndexInTimeZone(dateISO, tz);
  const isClosedDay = dow === OPENING.closedDay;
  const isHoliday = HOLIDAYS_SET.has(dateISO);
  const isClosedByCalendar = isDateClosedByCalendar(eventsForDate || []);
  return Boolean(isClosedDay || isHoliday || isClosedByCalendar);
}

function formatOpeningHoursForDateISO(dateISO) {
  const tz = GOOGLE_CALENDAR_TZ || "Europe/Rome";
  const dow = getWeekdayIndexInTimeZone(dateISO, tz);
  const isFriSat = dow === 5 || dow === 6;
  const kitchen = isFriSat ? OPENING.restaurant.friSat : OPENING.restaurant.default;
  return `Siamo aperti dalle ${OPENING.drinksOnly.start}. Cucina dalle ${kitchen.start} alle ${kitchen.end}.`;
}

function formatMusicAnswerForRange(musicEvents, startISO, endISO) {
  if (!musicEvents || musicEvents.length === 0) {
    if (startISO === endISO) {
      return `Non risulta musica in calendario per ${formatDateLabel(startISO)}.`;
    }
    return `Non risultano eventi musicali in calendario nel periodo ${formatDateLabel(startISO)} - ${formatDateLabel(endISO)}.`;
  }

  // raggruppa per giorno
  const byDay = new Map();
  for (const ev of musicEvents) {
    const dISO = getEventStartDateISO(ev) || startISO;
    if (!byDay.has(dISO)) byDay.set(dISO, []);
    byDay.get(dISO).push(ev);
  }

  const days = Array.from(byDay.keys()).sort();
  const lines = [];
  for (const dayISO of days.slice(0, 7)) {
    const items = (byDay.get(dayISO) || [])
      .slice(0, 3)
      .map((e) => String(e.summary || "").trim())
      .filter(Boolean);

    const label = new Intl.DateTimeFormat("it-IT", {
      timeZone: GOOGLE_CALENDAR_TZ || "Europe/Rome",
      weekday: "long",
    }).format(makeUtcDateFromZoned(dayISO, "12:00", GOOGLE_CALENDAR_TZ || "Europe/Rome") || new Date(`${dayISO}T12:00:00`));

    if (items.length === 0) continue;
    lines.push(`${label}: ${items.join(", ")}`);
  }

  if (startISO === endISO) return `Per ${formatDateLabel(startISO)} risulta: ${lines.join(" ")}`;
  return `Nel periodo ${formatDateLabel(startISO)} - ${formatDateLabel(endISO)} risultano: ${lines.join(" ")}`;
}

function buildPromoAnswer(textRaw) {
  const t = normalizeText(textRaw || "");
  const isPromo = t.includes("promo") || t.includes("brilli") || t.includes("tasting") || t.includes("piatto apericena");
  if (!isPromo) return null;

  const wantsContents =
    t.includes("cosa comprende") ||
    t.includes("comprende") ||
    t.includes("include") ||
    t.includes("quali") ||
    t.includes("portate") ||
    t.includes("assaggi");

  if (!wantsContents) {
    return "La promo BrilliTasting prevede il piatto apericena a 18 euro invece di 25: 13 portate, coperto e drink incluso (vino o drink base). E' obbligatoria la registrazione e la prenotazione.";
  }

  return "Il piatto apericena BrilliTasting comprende 13 assaggi: polpetta di cervo al ginepro, polpetta agnello con menta fresca e scorza di limone, falafel croccante all'aglio, mini tartare di fassona al coltello con vinaigrette agli agrumi e crema di capperi, olive e menta, paninetti con porchetta cunzata e panelle, bruschetta classica, bruschetta con stracciatella di bufala, crudo, tartare di gambero con cipolla e olive, cazzilli, verdura pastellata, caprino agli agrumi, stinco Brillo con patata al forno, millefoglie di patate e carciofi con fonduta di pecorino romano DOP. Cocktail o vino o birra e coperto inclusi.";
}

function buildDietAnswer(textRaw) {
  const t = normalizeText(textRaw || "");
  if (t.includes("senza glutine") || t.includes("glutine") || t.includes("celiac")) {
    return "Si', abbiamo opzioni senza glutine, ma e' sempre meglio comunicarlo durante la prenotazione e ricordarlo al personale di sala.";
  }
  if (t.includes("vegano") || t.includes("vegana") || t.includes("vegetar")) {
    return "Si', abbiamo opzioni vegetariane e anche vegane, ma e' sempre meglio comunicarlo durante la prenotazione e ricordarlo al personale di sala.";
  }
  if (t.includes("cane") || t.includes("gatto") || t.includes("animale")) {
    return "Si', e' possibile portare un animale domestico, purché venga comunicato in fase di prenotazione specificando taglia e razza.";
  }
  if (t.includes("compleanno") || t.includes("cena aziendale") || t.includes("evento") || t.includes("festa")) {
    return "Si', e' possibile. Spiegami in sintesi la tua esigenza e ti faremo ricontattare al piu' presto.";
  }
  return null;
}

async function checkAvailabilityQuickVoice(session, dateISO, people, time24) {
  const events = await listCalendarEvents(dateISO);
  if (isBusinessClosedOnDateISO(dateISO, events)) {
    return { handled: true, answer: `Mi dispiace, ${formatDateLabel(dateISO)} risulta chiuso.` };
  }
  if (!Number.isFinite(people) || !time24) {
    return {
      handled: true,
      needsDetails: true,
      pending: { type: "availability", dateISO, people: Number.isFinite(people) ? people : null, time24: time24 || null },
    };
  }

  // preview su session clone per non sporcare la session reale
  let tmp;
  try {
    tmp = JSON.parse(JSON.stringify(session || {}));
  } catch {
    tmp = { ...(session || {}) };
  }
  tmp.dateISO = dateISO;
  tmp.people = people;
  tmp.time24 = time24;

  const res = await reserveTableForSession(tmp, { commit: false });
  if (res?.status === "closed") {
    return { handled: true, answer: `Mi dispiace, ${formatDateLabel(dateISO)} risulta chiuso.` };
  }
  if (res?.status === "ok") {
    return {
      handled: true,
      answer: `Sì, in linea di massima c'e' disponibilita' per ${people} persone ${formatDateLabel(dateISO)} alle ${time24}. Se vuoi, possiamo procedere con la prenotazione.`,
    };
  }
  if (res?.status === "needs_split" || res?.status === "needs_outside") {
    return {
      handled: true,
      answer: `Potrebbe esserci disponibilita' per ${people} persone ${formatDateLabel(dateISO)} alle ${time24}, ma potremmo dovervi sistemare su tavoli separati o anche in esterno. Se vuoi, posso metterti in contatto con un operatore.`,
    };
  }
  return {
    handled: true,
    answer: `Al momento non risulta disponibilita' per ${people} persone ${formatDateLabel(dateISO)} alle ${time24}. Vuoi provare un altro orario?`,
  };
}

async function tryAnswerInfoQuestionVoiceSmart(session, questionRaw) {
  const raw = String(questionRaw || "").trim();
  const q = normalizeText(raw);
  if (!q) return { handled: false };

  // 1) PROMO / MENU / FAQ
  const promo = buildPromoAnswer(raw);
  if (promo) return { handled: true, answer: promo };

  const diet = buildDietAnswer(raw);
  if (diet) return { handled: true, answer: diet };

  // 2) MUSICA / EVENTI MUSICALI
  const asksMusic = q.includes("musica") || q.includes("dj") || q.includes("live") || q.includes("jazz");
  if (asksMusic) {
    const tz = GOOGLE_CALENDAR_TZ || "Europe/Rome";
    const todayISO = formatISODateInTimeZone(new Date(), tz);

    // range default: giorno specifico se presente, altrimenti prossimi 7 giorni
    let startISO = null;
    let endISO = null;

    const explicitDate = parseDateIT(raw);
    if (explicitDate) {
      startISO = explicitDate;
      endISO = explicitDate;
    } else if (q.includes("prossima settimana") || q.includes("settimana prossima")) {
      const r = getNextWeekRangeISO(todayISO, tz);
      startISO = r.startISO;
      endISO = r.endISO;
    } else if (q.includes("questa settimana")) {
      const r = getCurrentWeekRangeISO(todayISO, tz);
      startISO = r.startISO;
      endISO = r.endISO;
    } else {
      const wd = parseWeekdayIndexIT(raw);
      if (wd !== null) {
        const todayDow = getWeekdayIndexInTimeZone(todayISO, tz);
        const delta = (wd - todayDow + 7) % 7;
        const targetISO = addDaysToISODate(todayISO, delta);
        startISO = targetISO;
        endISO = targetISO;
      } else {
        startISO = todayISO;
        endISO = addDaysToISODate(todayISO, 6);
      }
    }

    const all = await listCalendarEventsBetweenISO(startISO, endISO);
    const music = all.filter(isMusicEventItem);
    const answer = formatMusicAnswerForRange(music, startISO, endISO);
    return { handled: true, answer };
  }

  // 3) APERTURE / CHIUSURE
  const asksOpen = q.includes("apert") || q.includes("chius") || q.includes("orari") || q.includes("natale") || q.includes("capodanno");
  if (asksOpen) {
    let dateISO = parseDateIT(raw);
    if (!dateISO && q.includes("natale")) dateISO = resolveChristmasISO();
    if (!dateISO) {
      const wd = parseWeekdayIndexIT(raw);
      if (wd !== null) {
        const tz = GOOGLE_CALENDAR_TZ || "Europe/Rome";
        const todayISO = formatISODateInTimeZone(new Date(), tz);
        const todayDow = getWeekdayIndexInTimeZone(todayISO, tz);
        const delta = (wd - todayDow + 7) % 7;
        dateISO = addDaysToISODate(todayISO, delta);
      }
    }
    if (!dateISO) {
      return { handled: true, answer: "Dimmi per quale giorno vuoi sapere se siamo aperti." };
    }

    const events = await listCalendarEvents(dateISO);
    if (isBusinessClosedOnDateISO(dateISO, events)) {
      const tz = GOOGLE_CALENDAR_TZ || "Europe/Rome";
      const dow = getWeekdayIndexInTimeZone(dateISO, tz);
      if (dow === OPENING.closedDay) {
        return { handled: true, answer: `Mi dispiace, ${formatDateLabel(dateISO)} e' il nostro giorno di chiusura.` };
      }
      return { handled: true, answer: `Mi dispiace, ${formatDateLabel(dateISO)} risulta chiuso.` };
    }
    return { handled: true, answer: `${formatDateLabel(dateISO)} ${formatOpeningHoursForDateISO(dateISO)}` };
  }

  // 4) DISPONIBILITA' TAVOLO (anche con giorno della settimana)
  const asksAvailability = q.includes("disponibil") || q.includes("posto") || q.includes("posti") || q.includes("tavolo") || q.includes("prenot");
  if (asksAvailability) {
    let dateISO = parseDateIT(raw);
    const tz = GOOGLE_CALENDAR_TZ || "Europe/Rome";
    const todayISO = formatISODateInTimeZone(new Date(), tz);

    if (!dateISO) {
      const wd = parseWeekdayIndexIT(raw);
      if (wd !== null) {
        const todayDow = getWeekdayIndexInTimeZone(todayISO, tz);
        const delta = (wd - todayDow + 7) % 7;
        dateISO = addDaysToISODate(todayISO, delta);
      }
    }
    if (!dateISO) {
      return { handled: true, answer: "Certo. Per quale giorno vuoi verificare la disponibilita'?" };
    }

    // PRIMA controlla se chiuso
    const events = await listCalendarEvents(dateISO);
    if (isBusinessClosedOnDateISO(dateISO, events)) {
      return { handled: true, answer: `Mi dispiace, ${formatDateLabel(dateISO)} risulta chiuso.` };
    }

    const people = parsePeopleIT(raw);
    const time24 = parseTimeIT(raw);

    return await checkAvailabilityQuickVoice(session, dateISO, people, time24);
  }

  return { handled: false };
}


async function tryAnswerInfoQuestionVoice(questionRaw) {
  const q = String(questionRaw || "").trim();
  const tt = normalizeText(q);
  if (!tt) return { handled: false };

  // Promo / BrilliTasting
  if (tt.includes("brillitasting") || (tt.includes("promo") && tt.includes("apericena")) || tt.includes("piatto apericena")) {
    const reply =
      "La promo BrilliTasting prevede un piatto apericena a 18 euro invece di 25: 13 portate, coperto e un drink incluso (vino o drink di base). È obbligatoria la registrazione e la prenotazione.";
    return { handled: true, reply };
  }

  if (tt.includes("cosa comprende") || tt.includes("comprende") || (tt.includes("piatto") && tt.includes("apericena"))) {
    const reply =
      "Il piatto BrilliTasting comprende 13 assaggi: Polpetta di cervo al ginepro, polpetta di agnello con menta e scorza di limone, falafel croccante all'aglio, mini tartare di fassona con vinaigrette agli agrumi, crema di capperi, olive e menta, paninetti con porchetta cunzata e panelle, bruschetta classica, bruschetta con stracciatella di bufala, crudo, tartare di gambero, cipolla di tropea e olive taggiasche, cazzilli di patata croccante, verdura pastellata, caprino aromatizzato agli agrumi, stinco Brillo con patata al forno, e millefoglie di patate e carciofi con fonduta di pecorino romano DOP. Coperto e cocktail o vino o birra inclusi.";
    return { handled: true, reply };
  }

  if (tt.includes("senza glutine") || tt.includes("celia")) {
    return {
      handled: true,
      reply: "Sì, possiamo gestire richieste senza glutine, ma è meglio comunicarlo in fase di prenotazione e ricordarlo al personale di sala.",
    };
  }

  if (tt.includes("vegano") || tt.includes("vegetar")) {
    return {
      handled: true,
      reply: "Sì, possiamo proporre opzioni vegane o vegetariane. Ti consiglio di comunicarlo in fase di prenotazione e ricordarlo al personale di sala.",
    };
  }

  if (tt.includes("cane") || tt.includes("gatto") || tt.includes("animale")) {
    return {
      handled: true,
      reply: "Sì, è possibile portare un animale domestico, purché venga comunicato in fase di prenotazione specificando taglia e razza.",
    };
  }

  if (tt.includes("comple") || tt.includes("festa") || tt.includes("azienda") || tt.includes("evento")) {
    return {
      handled: true,
      reply: "Sì, è possibile organizzare compleanni, eventi o cene aziendali. Spiegami in sintesi l'esigenza e ti faremo ricontattare al più presto.",
    };
  }

  // Orari / apertura
  if (tt.includes("orari") || tt.includes("aperti") || tt.includes("apertura") || tt.includes("chiusura")) {
    const closedDay = OPENING?.closedDay;
    const reply =
      closedDay === 1
        ? "Siamo chiusi il lunedì. Negli altri giorni siamo aperti in orario serale; per date speciali controlliamo anche il calendario."
        : "Siamo aperti in orario serale; per eventuali giorni di chiusura straordinaria controlliamo anche il calendario.";
    return { handled: true, reply };
  }

  // Musica
  if (tt.includes("musica") || tt.includes("dj") || tt.includes("live") || tt.includes("jazz")) {
    const dateISO = parseDateIT(q) || parseNextWeekdayISO(q);
    if (!dateISO) return { handled: false };
    const events = await listCalendarEvents(dateISO);
    const items = extractMusicItemsFromEvents(events);
    if (items.length === 0) {
      return { handled: true, reply: `Per ${formatDateLabel(dateISO)} non vedo musica live o dj set segnati in calendario.` };
    }
    const top = items.slice(0, 3).join(", ");
    return { handled: true, reply: `Sì, per ${formatDateLabel(dateISO)} risulta: ${top}.` };
  }

  // Disponibilità tavolo
  if (tt.includes("disponibil") || (tt.includes("c'e") && tt.includes("posto"))) {
    const dateISO = parseDateIT(q) || parseNextWeekdayISO(q);
    const people = parsePeopleIT(q);
    const time24 = parseTimeIT(q);
    if (!dateISO) return { handled: false };
    if (!people) {
      return { handled: true, needsFollowUp: true, followUpKind: "avail_people", payload: { dateISO, time24 }, prompt: "Certo. In quante persone siete?" };
    }
    if (!time24) {
      return { handled: true, needsFollowUp: true, followUpKind: "avail_time", payload: { dateISO, people }, prompt: "A che ora?" };
    }

    const tmp = { dateISO, time24, people, specialRequestsRaw: "nessuna", preorderLabel: "nessuno" };
    const availability = await reserveTableForSession(tmp, { commit: false });
    if (availability.status === "closed") {
      return { handled: true, reply: `Mi dispiace, per ${formatDateLabel(dateISO)} risulta chiuso.` };
    }
    if (availability.status === "unavailable") {
      return { handled: true, reply: `Mi dispiace, per ${formatDateLabel(dateISO)} alle ${time24} non vedo disponibilità.` };
    }
    if (availability.status === "needs_split") {
      return { handled: true, reply: `Per ${formatDateLabel(dateISO)} alle ${time24} c'è disponibilità, ma probabilmente in tavoli separati.` };
    }
    if (availability.status === "needs_outside") {
      return { handled: true, reply: `Per ${formatDateLabel(dateISO)} alle ${time24} c'è disponibilità, ma potrebbe essere necessario un tavolo esterno o tavoli separati.` };
    }
    return { handled: true, reply: `Sì, per ${formatDateLabel(dateISO)} alle ${time24} vedo disponibilità.` };
  }

  // Natale
  if (tt.includes("natale")) {
    const dateISO = resolveNataleISO();
    const events = await listCalendarEvents(dateISO);
    const date = new Date(`${dateISO}T00:00:00`);
    const isHoliday = HOLIDAYS_SET.has(dateISO);
    const isClosedDay = date.getDay() === OPENING.closedDay;
    const closed = isHoliday || isClosedDay || isDateClosedByCalendar(events);
    return {
      handled: true,
      reply: closed
        ? `Per ${formatDateLabel(dateISO)} risulta chiuso in calendario.`
        : `Per ${formatDateLabel(dateISO)} non risulta chiusura in calendario. Ti consiglio comunque di prenotare.`,
    };
  }

  return { handled: false };
}

async function forwardToOperatorWithReason(session, req, vr, reason, kind) {
  session.operatorReasonRaw = String(reason || "").trim() || "non specificato";
  session.operatorKind = kind || session.operatorKind || "generic";

  await sendFallbackEmail(session, req, "operator_request");
  void sendOperatorEmail(session, req, "operator_request");

  // Evita la creazione automatica dell'evento "chiamata interrotta" su ogni risposta HTTP
  session.fallbackEventCreated = true;
  void safeCreateOperatorCallbackCalendarEvent(session, req, "requested");

  const operatorPhone = getOperatorPhoneE164();
  const callerCandidates = [];
  if (isValidPhoneE164(TWILIO_VOICE_FROM)) callerCandidates.push(TWILIO_VOICE_FROM.trim());
  const inboundTo = req?.body?.To || req?.body?.Called || "";
  const inboundToE164 = parsePhoneNumber(inboundTo);
  if (isValidPhoneE164(inboundToE164)) callerCandidates.push(inboundToE164);
  const callerId = callerCandidates[0] || "";
  const canDialLive = Boolean(ENABLE_FORWARDING && operatorPhone);

  // reset stato operatore
  session.operatorState = null;
  session.operatorPrompt = null;
  session.operatorRetryPrompt = null;

  if (canDialLive) {
    return { kind: "forward", twiml: forwardToHumanTwiml(req) };
  }

  // Congedo morbido
  const goodbye =
    session.operatorKind === "info"
      ? "Va benissimo. Ho preso nota della tua richiesta e ti faremo richiamare al più presto. Grazie e a presto."
      : session.operatorKind === "event"
      ? "Va benissimo. Ho preso nota dei dettagli e ti faremo ricontattare al più presto. Grazie e a presto."
      : "Va benissimo. Ti faremo richiamare al più presto. Grazie e a presto.";
  sayIt(vr, goodbye);
  vr.hangup();
  return { kind: "vr", twiml: vr.toString() };
}

async function handleInfoFlow(session, req, vr, speech, emptySpeech) {
  const state = String(session.operatorState || "");

  const forwardBecause = async (reason) => {
    return forwardToOperatorWithReason(session, req, vr, reason, "info");
  };

  const clearInfo = () => {
    session.operatorState = null;
    session.infoPayload = null;
    session.operatorKind = "info";
  };

  if (state === "info_question") {
    if (emptySpeech) {
      const silenceResult = handleSilence(session, vr, () => gatherSpeech(vr, "Dimmi pure cosa vuoi sapere."));
      if (silenceResult.action === "forward") {
        return forwardBecause("Richiesta informazioni: nessuna domanda fornita");
      }
      return { kind: "vr", twiml: vr.toString() };
    }

    const answer = await tryAnswerInfoQuestionVoice(speech);
    if (answer && answer.needsFollowUp) {
      session.infoPayload = answer.payload || null;
      session.operatorState = `info_${answer.followUpKind}`;
      gatherSpeech(vr, answer.prompt || "Mi dici meglio?");
      return { kind: "vr", twiml: vr.toString() };
    }

    if (answer && answer.handled && answer.reply) {
      sayIt(vr, answer.reply);
      vr.hangup();
      clearInfo();
      return { kind: "vr", twiml: vr.toString() };
    }

    return forwardBecause(String(speech || "").trim().slice(0, 400) || "Richiesta informazioni");
  }

  if (state === "info_avail_people") {
    const payload = session.infoPayload || {};
    if (emptySpeech) {
      const silenceResult = handleSilence(session, vr, () => gatherSpeech(vr, "In quante persone siete?"));
      if (silenceResult.action === "forward") {
        return forwardBecause(`Richiesta informazioni disponibilità: persone non fornite (data ${payload.dateISO || ""})`);
      }
      return { kind: "vr", twiml: vr.toString() };
    }
    const people = parsePeopleIT(speech);
    if (!people) {
      gatherSpeech(vr, "Non ho capito. In quante persone siete?");
      return { kind: "vr", twiml: vr.toString() };
    }

    // se abbiamo già l'orario, rispondi subito
    if (payload.dateISO && payload.time24) {
      const tmp = { dateISO: payload.dateISO, time24: payload.time24, people, specialRequestsRaw: "nessuna", preorderLabel: "nessuno" };
      const availability = await reserveTableForSession(tmp, { commit: false });
      const reply =
        availability.status === "closed"
          ? `Mi dispiace, per ${formatDateLabel(payload.dateISO)} risulta chiuso.`
          : availability.status === "unavailable"
          ? `Mi dispiace, per ${formatDateLabel(payload.dateISO)} alle ${payload.time24} non vedo disponibilità.`
          : availability.status === "needs_split"
          ? `Per ${formatDateLabel(payload.dateISO)} alle ${payload.time24} c'è disponibilità, ma probabilmente in tavoli separati.`
          : availability.status === "needs_outside"
          ? `Per ${formatDateLabel(payload.dateISO)} alle ${payload.time24} c'è disponibilità, ma potrebbe essere necessario un tavolo esterno o tavoli separati.`
          : `Sì, per ${formatDateLabel(payload.dateISO)} alle ${payload.time24} vedo disponibilità.`;
      sayIt(vr, reply);
      vr.hangup();
      clearInfo();
      return { kind: "vr", twiml: vr.toString() };
    }

    session.infoPayload = { dateISO: payload.dateISO, people };
    session.operatorState = "info_avail_time";
    gatherSpeech(vr, "A che ora?");
    return { kind: "vr", twiml: vr.toString() };
  }

  if (state === "info_avail_time") {
    const payload = session.infoPayload || {};
    if (emptySpeech) {
      const silenceResult = handleSilence(session, vr, () => gatherSpeech(vr, "A che ora?"));
      if (silenceResult.action === "forward") {
        return forwardBecause(`Richiesta informazioni disponibilità: orario non fornito (data ${payload.dateISO || ""})`);
      }
      return { kind: "vr", twiml: vr.toString() };
    }
    const time24 = parseTimeIT(speech);
    if (!time24) {
      gatherSpeech(vr, "Non ho capito l'orario. Puoi ripeterlo?");
      return { kind: "vr", twiml: vr.toString() };
    }

    if (!payload.dateISO || !payload.people) {
      return forwardBecause("Richiesta informazioni disponibilità: dati insufficienti");
    }

    const tmp = { dateISO: payload.dateISO, time24, people: payload.people, specialRequestsRaw: "nessuna", preorderLabel: "nessuno" };
    const availability = await reserveTableForSession(tmp, { commit: false });
    const reply =
      availability.status === "closed"
        ? `Mi dispiace, per ${formatDateLabel(payload.dateISO)} risulta chiuso.`
        : availability.status === "unavailable"
        ? `Mi dispiace, per ${formatDateLabel(payload.dateISO)} alle ${time24} non vedo disponibilità.`
        : availability.status === "needs_split"
        ? `Per ${formatDateLabel(payload.dateISO)} alle ${time24} c'è disponibilità, ma probabilmente in tavoli separati.`
        : availability.status === "needs_outside"
        ? `Per ${formatDateLabel(payload.dateISO)} alle ${time24} c'è disponibilità, ma potrebbe essere necessario un tavolo esterno o tavoli separati.`
        : `Sì, per ${formatDateLabel(payload.dateISO)} alle ${time24} vedo disponibilità.`;

    sayIt(vr, reply);
    vr.hangup();
    clearInfo();
    return { kind: "vr", twiml: vr.toString() };
  }

  // fallback: torna al menu
  session.operatorState = null;
  gatherSpeech(vr, buildMainMenuPrompt());
  return { kind: "vr", twiml: vr.toString() };
}

async function handleManageBookingFlow(session, req, vr, speech, emptySpeech) {
  const state = String(session.operatorState || "");
  const tt = normalizeText(speech);

  const softReturnToMenu = (message) => {
    if (message) sayIt(vr, message);
    session.operatorState = null;
    session.manageAction = null;
    session.step = "intent";
    gatherSpeech(vr, buildMainMenuPrompt());
  };

  // helper: forward con riepilogo
  const forwardBecause = async (reason) => {
    const r = await forwardToOperatorWithReason(session, req, vr, reason, "manage");
    return r;
  };

  // utility parse date: anche giorni settimana
  const parseDateWithWeekday = (text) => parseDateIT(text) || parseNextWeekdayISO(text);

  if (state === "manage_cancel_date") {
    if (emptySpeech) {
      const silenceResult = handleSilence(session, vr, () => gatherSpeech(vr, "Dimmi la data della prenotazione da annullare."));
      if (silenceResult.action === "forward") {
        return forwardBecause("Richiesta annullamento prenotazione: data non fornita");
      }
      return { kind: "vr", twiml: vr.toString() };
    }
    const dateISO = parseDateWithWeekday(speech);
    if (!dateISO) {
      session.retries = (session.retries || 0) + 1;
      if (session.retries >= 2) {
        return forwardBecause("Richiesta annullamento prenotazione: data non riconosciuta");
      }
      gatherSpeech(vr, "Non ho capito la data. Puoi ripeterla?");
      return { kind: "vr", twiml: vr.toString() };
    }
    resetRetries(session);
    session.manageDateISO = dateISO;
    session.operatorState = "manage_cancel_surname";
    gatherSpeech(vr, "Perfetto. Dimmi il cognome della prenotazione.");
    return { kind: "vr", twiml: vr.toString() };
  }

  if (state === "manage_cancel_surname") {
    if (emptySpeech) {
      const silenceResult = handleSilence(session, vr, () => gatherSpeech(vr, "Dimmi il cognome della prenotazione."));
      if (silenceResult.action === "forward") {
        return forwardBecause(`Richiesta annullamento prenotazione: cognome non fornito (data ${session.manageDateISO || ""})`);
      }
      return { kind: "vr", twiml: vr.toString() };
    }
    resetRetries(session);
    const cleanedSurname = extractSurnameFromSpeech(speech);
    if (!cleanedSurname) {
      session.retries = (session.retries || 0) + 1;
      if (session.retries >= 2) {
        return forwardBecause(`Richiesta annullamento prenotazione: cognome non riconosciuto (data ${session.manageDateISO || ""})`);
      }
      gatherSpeech(vr, "Non ho capito il cognome. Puoi ripeterlo?");
      return { kind: "vr", twiml: vr.toString() };
    }
    resetRetries(session);
    session.manageSurname = cleanedSurname;
    session.operatorState = "manage_cancel_time";
    gatherSpeech(vr, "Se ricordi anche l'orario dimmelo, altrimenti dì: non lo ricordo.");
    return { kind: "vr", twiml: vr.toString() };
  }

  if (state === "manage_cancel_time") {
    if (emptySpeech) {
      const silenceResult = handleSilence(session, vr, () => gatherSpeech(vr, "Se ricordi anche l'orario dimmelo, altrimenti dì: non lo ricordo."));
      if (silenceResult.action === "forward") {
        return forwardBecause(`Richiesta annullamento prenotazione: orario non fornito (data ${session.manageDateISO || ""}, cognome ${session.manageSurname || ""})`);
      }
      return { kind: "vr", twiml: vr.toString() };
    }
    resetRetries(session);
    if (tt.includes("non lo ricordo") || tt.includes("non ricordo") || isNoRequestsText(speech)) {
      session.manageTime24 = null;
    } else {
      session.manageTime24 = parseTimeIT(speech);
    }
    session.operatorState = "manage_cancel_search";
    return handleManageBookingFlow(session, req, vr, speech, false);
  }

  if (state === "manage_cancel_search") {
    const { match, candidates } = await findBookingEventMatch({
      dateISO: session.manageDateISO,
      time24: session.manageTime24,
      surname: session.manageSurname,
    });

    if (!match) {
      return forwardBecause(`Richiesta annullamento prenotazione: non trovata (data ${session.manageDateISO || ""}, cognome ${session.manageSurname || ""}, orario ${session.manageTime24 || "non indicato"})`);
    }

    // Se più prenotazioni con stesso cognome e nessun orario, chiedi orario
    if (candidates && candidates.length > 1 && !session.manageTime24) {
      session.operatorState = "manage_cancel_time_disambiguate";
      gatherSpeech(vr, "Ho trovato più prenotazioni con quel cognome. Mi dici anche l'orario?");
      return { kind: "vr", twiml: vr.toString() };
    }

    session.manageCandidateEventId = match.id;
    session.manageCandidateEvent = match;
    session.operatorState = "manage_cancel_confirm";
    gatherSpeech(vr, `Ho trovato questa prenotazione: ${match.summary || ""}. Vuoi annullarla?`);
    return { kind: "vr", twiml: vr.toString() };
  }

  if (state === "manage_cancel_time_disambiguate") {
    if (emptySpeech) {
      const silenceResult = handleSilence(session, vr, () => gatherSpeech(vr, "Mi dici anche l'orario della prenotazione?"));
      if (silenceResult.action === "forward") {
        return forwardBecause(`Richiesta annullamento prenotazione: disambiguazione orario non fornita (data ${session.manageDateISO || ""}, cognome ${session.manageSurname || ""})`);
      }
      return { kind: "vr", twiml: vr.toString() };
    }
    const time24 = parseTimeIT(speech);
    if (!time24) {
      gatherSpeech(vr, "Non ho capito l'orario. Puoi ripeterlo?");
      return { kind: "vr", twiml: vr.toString() };
    }
    session.manageTime24 = time24;
    session.operatorState = "manage_cancel_search";
    return handleManageBookingFlow(session, req, vr, speech, false);
  }

  if (state === "manage_cancel_confirm") {
    if (emptySpeech) {
      const silenceResult = handleSilence(session, vr, () => gatherSpeech(vr, "Vuoi confermare l'annullamento?"));
      if (silenceResult.action === "forward") {
        return forwardBecause(`Richiesta annullamento prenotazione: conferma non fornita (evento ${session.manageCandidateEventId || ""})`);
      }
      return { kind: "vr", twiml: vr.toString() };
    }
    const yn = parseYesNo(speech);
    if (yn === false) {
      softReturnToMenu("Va bene, non annullo nulla.");
      return { kind: "vr", twiml: vr.toString() };
    }
    if (yn !== true) {
      gatherSpeech(vr, "Non ho capito. Vuoi annullare la prenotazione? Rispondi sì o no.");
      return { kind: "vr", twiml: vr.toString() };
    }

    const ok = await patchBookingAsCanceled(session.manageCandidateEventId, session.manageDateISO, session.manageCandidateEvent);
    if (!ok) {
      return forwardBecause(`Richiesta annullamento prenotazione: errore aggiornamento (evento ${session.manageCandidateEventId || ""})`);
    }
    sayIt(vr, "Perfetto. Ho annullato la prenotazione. Grazie e a presto.");
    vr.hangup();
    session.operatorState = null;
    return { kind: "vr", twiml: vr.toString() };
  }

  // ===== MODIFICA =====
  if (state === "manage_modify_date") {
    if (emptySpeech) {
      const silenceResult = handleSilence(session, vr, () => gatherSpeech(vr, "Dimmi la data della prenotazione da modificare."));
      if (silenceResult.action === "forward") {
        return forwardBecause("Richiesta modifica prenotazione: data non fornita");
      }
      return { kind: "vr", twiml: vr.toString() };
    }
    const dateISO = parseDateWithWeekday(speech);
    if (!dateISO) {
      session.retries = (session.retries || 0) + 1;
      if (session.retries >= 2) {
        return forwardBecause("Richiesta modifica prenotazione: data non riconosciuta");
      }
      gatherSpeech(vr, "Non ho capito la data. Puoi ripeterla?");
      return { kind: "vr", twiml: vr.toString() };
    }
    resetRetries(session);
    session.manageDateISO = dateISO;
    session.operatorState = "manage_modify_time";
    gatherSpeech(vr, "Perfetto. A che ora è la prenotazione?");
    return { kind: "vr", twiml: vr.toString() };
  }

  if (state === "manage_modify_time") {
    if (emptySpeech) {
      const silenceResult = handleSilence(session, vr, () => gatherSpeech(vr, "A che ora è la prenotazione?"));
      if (silenceResult.action === "forward") {
        return forwardBecause(`Richiesta modifica prenotazione: orario non fornito (data ${session.manageDateISO || ""})`);
      }
      return { kind: "vr", twiml: vr.toString() };
    }
    const time24 = parseTimeIT(speech);
    if (!time24) {
      session.retries = (session.retries || 0) + 1;
      if (session.retries >= 2) {
        return forwardBecause(`Richiesta modifica prenotazione: orario non riconosciuto (data ${session.manageDateISO || ""})`);
      }
      gatherSpeech(vr, "Non ho capito l'orario. Puoi ripeterlo?");
      return { kind: "vr", twiml: vr.toString() };
    }
    resetRetries(session);
    session.manageTime24 = time24;
    session.operatorState = "manage_modify_surname";
    gatherSpeech(vr, "Mi dici anche il cognome della prenotazione? Se non lo ricordi, dì: non lo ricordo.");
    return { kind: "vr", twiml: vr.toString() };
  }

  if (state === "manage_modify_surname") {
    if (emptySpeech) {
      const silenceResult = handleSilence(session, vr, () => gatherSpeech(vr, "Mi dici il cognome della prenotazione?"));
      if (silenceResult.action === "forward") {
        return forwardBecause(`Richiesta modifica prenotazione: cognome non fornito (data ${session.manageDateISO || ""}, orario ${session.manageTime24 || ""})`);
      }
      return { kind: "vr", twiml: vr.toString() };
    }
    resetRetries(session);
    if (tt.includes("non lo ricordo") || tt.includes("non ricordo") || isNoRequestsText(speech)) {
      session.manageSurname = null;
    } else {
      const cleanedSurname = extractSurnameFromSpeech(speech);
      if (!cleanedSurname) {
        session.retries = (session.retries || 0) + 1;
        if (session.retries >= 2) {
          return forwardBecause(`Richiesta modifica prenotazione: cognome non riconosciuto (data ${session.manageDateISO || ""}, orario ${session.manageTime24 || ""})`);
        }
        gatherSpeech(vr, "Non ho capito il cognome. Puoi ripeterlo?");
        return { kind: "vr", twiml: vr.toString() };
      }
      resetRetries(session);
      session.manageSurname = cleanedSurname;
    }
    session.operatorState = "manage_modify_search";
    return handleManageBookingFlow(session, req, vr, speech, false);
  }

  if (state === "manage_modify_search") {
    const { match } = await findBookingEventMatch({
      dateISO: session.manageDateISO,
      time24: session.manageTime24,
      surname: session.manageSurname,
    });
    if (!match) {
      return forwardBecause(`Richiesta modifica prenotazione: non trovata (data ${session.manageDateISO || ""}, orario ${session.manageTime24 || ""}, cognome ${session.manageSurname || "non indicato"})`);
    }
    session.manageCandidateEventId = match.id;
    session.manageCandidateEvent = match;
    session.operatorState = "manage_modify_choose_fields";
    // reset piano modifica
    session.manageChangeQueue = null;
    session.manageProposed = null;
    session.manageOriginal = null;
    gatherSpeech(
      vr,
      `Ho trovato questa prenotazione: ${match.summary || ""}. Cosa vuoi modificare? Puoi scegliere: la data, l'orario, il numero di persone, oppure aggiungere  Puoi dire anche più cose, ad esempio: orario e numero di persone.`
    );
    return { kind: "vr", twiml: vr.toString() };
  }

    if (state === "manage_modify_choose_fields") {
    if (emptySpeech) {
      const silenceResult = handleSilence(session, vr, () =>
        gatherSpeech(
          vr,
          "Dimmi cosa vuoi modificare: la data, l'orario, il numero di persone, . Puoi scegliere anche più cose."
        )
      );
      if (silenceResult.action === "forward") {
        return forwardBecause(
          `Richiesta modifica prenotazione: scelta modifiche non fornita (evento ${session.manageCandidateEventId || ""})`
        );
      }
      return { kind: "vr", twiml: vr.toString() };
    }

    const choices = parseModificationChoices(speech);
    if (!choices || choices.length === 0) {
      session.retries = (session.retries || 0) + 1;
      if (session.retries >= 2) {
        return forwardBecause(
          `Richiesta modifica prenotazione: scelta modifiche non riconosciuta (evento ${session.manageCandidateEventId || ""})`
        );
      }
      gatherSpeech(
        vr,
        "Non ho capito. Puoi scegliere: la data, l'orario, oppure il numero di persone. Puoi dire anche: orario e numero di persone."
      );
      return { kind: "vr", twiml: vr.toString() };
    }

    // baseline dall'evento trovato
    const original = session.manageCandidateEvent || {};
    const originalDateISO = String(
      original?.start?.dateTime || original?.start?.date || session.manageDateISO || ""
    ).slice(0, 10);
    const originalTime24 = parseTimeIT(original?.start?.dateTime || "") || session.manageTime24;
    const originalPeople =
      extractPeopleFromDescription(original?.description) || extractPeopleFromSummary(original?.summary) || 2;
    const originalNotes = extractNotesFromDescription(original?.description) || "";

    session.manageOriginal = { originalDateISO, originalTime24, originalPeople, originalNotes };
    session.manageProposed = {
      dateISO: originalDateISO,
      time24: originalTime24,
      people: originalPeople,
      notes: originalNotes,
    };

    session.manageModificationRaw = String(speech || "").trim().slice(0, 200);
    session.manageChangeQueue = choices.slice();

    resetRetries(session);

    const first = session.manageChangeQueue.shift();
    gotoModifyField(session, vr, first, true);
    return { kind: "vr", twiml: vr.toString() };
  }

  if (state === "manage_modify_set_date") {
    if (emptySpeech) {
      const silenceResult = handleSilence(session, vr, () =>
        gatherSpeech(vr, "Non ho capito la data. Per quale giorno vuoi spostare la prenotazione?")
      );
      if (silenceResult.action === "forward") {
        return forwardBecause(
          `Richiesta modifica prenotazione: data non fornita (evento ${session.manageCandidateEventId || ""})`
        );
      }
      return { kind: "vr", twiml: vr.toString() };
    }

    const d = parseDateWithWeekday(speech);
    if (!d) {
      session.retries = (session.retries || 0) + 1;
      if (session.retries >= 2) {
        return forwardBecause(
          `Richiesta modifica prenotazione: data non riconosciuta (evento ${session.manageCandidateEventId || ""})`
        );
      }
      gatherSpeech(vr, "Non ho capito la data. Puoi ripeterla?");
      return { kind: "vr", twiml: vr.toString() };
    }

    resetRetries(session);
    session.manageProposed = session.manageProposed || {};
    session.manageProposed.dateISO = d;

    const next = (session.manageChangeQueue || []).shift();
    if (next) {
      gotoModifyField(session, vr, next, false);
      return { kind: "vr", twiml: vr.toString() };
    }

    session.operatorState = "manage_modify_finalize";
    return await handleModifyFinalize(session, vr);
  }

  if (state === "manage_modify_set_time") {
    if (emptySpeech) {
      const silenceResult = handleSilence(session, vr, () =>
        gatherSpeech(vr, "Non ho capito l'orario. Per che ora prenoto il vostro tavolo?")
      );
      if (silenceResult.action === "forward") {
        return forwardBecause(
          `Richiesta modifica prenotazione: orario non fornito (evento ${session.manageCandidateEventId || ""})`
        );
      }
      return { kind: "vr", twiml: vr.toString() };
    }

    const t = parseTimeIT(speech);
    if (!t) {
      session.retries = (session.retries || 0) + 1;
      if (session.retries >= 2) {
        return forwardBecause(
          `Richiesta modifica prenotazione: orario non riconosciuto (evento ${session.manageCandidateEventId || ""})`
        );
      }
      gatherSpeech(vr, "Non ho capito l'orario. Puoi ripeterlo?");
      return { kind: "vr", twiml: vr.toString() };
    }

    resetRetries(session);
    session.manageProposed = session.manageProposed || {};
    session.manageProposed.time24 = t;

    const next = (session.manageChangeQueue || []).shift();
    if (next) {
      gotoModifyField(session, vr, next, false);
      return { kind: "vr", twiml: vr.toString() };
    }

    session.operatorState = "manage_modify_finalize";
    return await handleModifyFinalize(session, vr);
  }

  if (state === "manage_modify_set_people") {
    if (emptySpeech) {
      const silenceResult = handleSilence(session, vr, () =>
        gatherSpeech(vr, "Non ho capito il numero di persone. In quanti sarete?")
      );
      if (silenceResult.action === "forward") {
        return forwardBecause(
          `Richiesta modifica prenotazione: numero persone non fornito (evento ${session.manageCandidateEventId || ""})`
        );
      }
      return { kind: "vr", twiml: vr.toString() };
    }

    const p = parsePeopleIT(speech);
    if (!p) {
      session.retries = (session.retries || 0) + 1;
      if (session.retries >= 2) {
        return forwardBecause(
          `Richiesta modifica prenotazione: numero persone non riconosciuto (evento ${session.manageCandidateEventId || ""})`
        );
      }
      gatherSpeech(vr, "Non ho capito. In quanti sarete?");
      return { kind: "vr", twiml: vr.toString() };
    }

    resetRetries(session);
    session.manageProposed = session.manageProposed || {};
    session.manageProposed.people = p;

    const next = (session.manageChangeQueue || []).shift();
    if (next) {
      gotoModifyField(session, vr, next, false);
      return { kind: "vr", twiml: vr.toString() };
    }

    session.operatorState = "manage_modify_finalize";
    return await handleModifyFinalize(session, vr);
  }

  if (state === "manage_modify_set_notes") {
    if (emptySpeech) {
      const silenceResult = handleSilence(session, vr, () =>
        gatherSpeech(vr, "Dimmi le richieste particolari. Se non ce ne sono, dì: nessuna.")
      );
      if (silenceResult.action === "forward") {
        return forwardBecause(
          `Richiesta modifica prenotazione: richieste particolari non fornite (evento ${session.manageCandidateEventId || ""})`
        );
      }
      return { kind: "vr", twiml: vr.toString() };
    }

    const cleaned = String(speech || "").trim().slice(0, 300);
    resetRetries(session);
    session.manageProposed = session.manageProposed || {};
    session.manageProposed.notes = isNoRequestsText(speech) ? "" : cleaned;

    const next = (session.manageChangeQueue || []).shift();
    if (next) {
      gotoModifyField(session, vr, next, false);
      return { kind: "vr", twiml: vr.toString() };
    }

    session.operatorState = "manage_modify_finalize";
    return await handleModifyFinalize(session, vr);
  }


  if (state === "manage_modify_finalize") {
    return await handleModifyFinalize(session, vr);
  }

  if (state === "manage_modify_confirm_apply") {
    if (emptySpeech) {
      const silenceResult = handleSilence(session, vr, () => gatherSpeech(vr, "Vuoi confermare la modifica?"));
      if (silenceResult.action === "forward") {
        return forwardBecause(`Richiesta modifica prenotazione: conferma non fornita (evento ${session.manageCandidateEventId || ""})`);
      }
      return { kind: "vr", twiml: vr.toString() };
    }

    const yn = parseYesNo(speech);
    if (yn === false) {
      softReturnToMenu("Va bene, non modifico nulla.");
      return { kind: "vr", twiml: vr.toString() };
    }
    if (yn !== true) {
      gatherSpeech(vr, "Non ho capito. Vuoi confermare la modifica? Rispondi sì o no.");
      return { kind: "vr", twiml: vr.toString() };
    }
    const pending = session.managePendingUpdate || {};
    const ok = await patchBookingAsModified({
      eventId: session.manageCandidateEventId,
      originalEvent: session.manageCandidateEvent,
      newDateISO: pending.newDateISO,
      newTime24: pending.newTime24,
      newPeople: pending.newPeople,
      newNotes: pending.newNotes,
      newSelection: { locks: pending.newTableLocks || [] },
      durationMinutes: pending.durationMinutes,
      modificationRaw: pending.modificationRaw,
    });
    if (!ok) {
      return forwardBecause(`Richiesta modifica prenotazione: errore aggiornamento (evento ${session.manageCandidateEventId || ""})`);
    }
    sayIt(vr, "Perfetto. Ho modificato la prenotazione. Grazie e a presto.");
    vr.hangup();
    session.operatorState = null;
    return { kind: "vr", twiml: vr.toString() };
  }


  // ===== MODIFICA BLOCCO TAVOLO (LOCK / SLOT) =====
  if (state === "manage_lock_date") {
    if (emptySpeech) {
      const silenceResult = handleSilence(session, vr, () => gatherSpeech(vr, "Dimmi la data del blocco tavolo da modificare."));
      if (silenceResult.action === "forward") {
        return forwardBecause("Richiesta modifica blocco tavolo: data non fornita");
      }
      return { kind: "vr", twiml: vr.toString() };
    }
    const dateISO = parseDateWithWeekday(speech);
    if (!dateISO) {
      session.retries = (session.retries || 0) + 1;
      if (session.retries >= 2) {
        return forwardBecause("Richiesta modifica blocco tavolo: data non riconosciuta");
      }
      gatherSpeech(vr, "Non ho capito la data. Puoi ripeterla?");
      return { kind: "vr", twiml: vr.toString() };
    }
    resetRetries(session);
    session.manageLockDateISO = dateISO;
    session.operatorState = "manage_lock_time";
    gatherSpeech(vr, "Perfetto. A che ora inizia il blocco?");
    return { kind: "vr", twiml: vr.toString() };
  }

  if (state === "manage_lock_time") {
    if (emptySpeech) {
      const silenceResult = handleSilence(session, vr, () => gatherSpeech(vr, "A che ora inizia il blocco?"));
      if (silenceResult.action === "forward") {
        return forwardBecause(`Richiesta modifica blocco tavolo: orario non fornito (data ${session.manageLockDateISO || ""})`);
      }
      return { kind: "vr", twiml: vr.toString() };
    }
    const time24 = parseTimeIT(speech);
    if (!time24) {
      session.retries = (session.retries || 0) + 1;
      if (session.retries >= 2) {
        return forwardBecause(`Richiesta modifica blocco tavolo: orario non riconosciuto (data ${session.manageLockDateISO || ""})`);
      }
      gatherSpeech(vr, "Non ho capito l'orario. Puoi ripeterlo?");
      return { kind: "vr", twiml: vr.toString() };
    }
    resetRetries(session);
    session.manageLockTime24 = time24;
    session.operatorState = "manage_lock_table";
    gatherSpeech(vr, "Perfetto. Quale tavolo è bloccato? Dimmi il numero del tavolo.");
    return { kind: "vr", twiml: vr.toString() };
  }

  if (state === "manage_lock_table") {
    if (emptySpeech) {
      const silenceResult = handleSilence(session, vr, () => gatherSpeech(vr, "Quale tavolo è bloccato?"));
      if (silenceResult.action === "forward") {
        return forwardBecause(
          `Richiesta modifica blocco tavolo: tavolo non fornito (data ${session.manageLockDateISO || ""}, ora ${session.manageLockTime24 || ""})`
        );
      }
      return { kind: "vr", twiml: vr.toString() };
    }

    const tableId = parseTableIdIT(speech);
    if (!tableId) {
      session.retries = (session.retries || 0) + 1;
      if (session.retries >= 2) {
        return forwardBecause(
          `Richiesta modifica blocco tavolo: tavolo non riconosciuto (data ${session.manageLockDateISO || ""}, ora ${session.manageLockTime24 || ""})`
        );
      }
      gatherSpeech(vr, "Non ho capito il tavolo. Puoi ripeterlo? Per esempio: tavolo 7.");
      return { kind: "vr", twiml: vr.toString() };
    }

    resetRetries(session);
    session.manageLockTableId = tableId;

    const dateISO = session.manageLockDateISO;
    const time24 = session.manageLockTime24;
    const tz = GOOGLE_CALENDAR_TZ || "Europe/Rome";

    const eventsForDate = await listCalendarEventsBetweenISO(dateISO, dateISO);
    const match = findAvailabilityLockMatchFromEvents({
      eventsForDate,
      dateISO,
      time24,
      tableId,
      tz,
    });

    if (!match) {
      return forwardBecause(
        `Richiesta modifica blocco tavolo: blocco non trovato (data ${dateISO || ""}, ora ${time24 || ""}, tavolo ${tableId || ""})`
      );
    }

    session.manageLockCandidateEvent = match;
    session.manageLockCandidateEventId = match.id;

    session.operatorState = "manage_lock_choose_fields";
    gatherSpeech(
      vr,
      `Ho trovato il blocco del ${dateISO} alle ${time24} sul ${tableId}. Cosa vuoi modificare? Puoi scegliere: la data, l'orario, la durata o il tavolo. Puoi dire anche più cose, per esempio: orario e durata.`
    );
    return { kind: "vr", twiml: vr.toString() };
  }

  if (state === "manage_lock_choose_fields") {
    if (emptySpeech) {
      const silenceResult = handleSilence(session, vr, () =>
        gatherSpeech(
          vr,
          "Cosa vuoi modificare del blocco? Puoi scegliere: la data, l'orario, la durata o il tavolo."
        )
      );
      if (silenceResult.action === "forward") {
        return forwardBecause(
          `Richiesta modifica blocco tavolo: scelta campi non fornita (evento ${session.manageLockCandidateEventId || ""})`
        );
      }
      return { kind: "vr", twiml: vr.toString() };
    }

    const choices = parseLockModificationChoices(speech);
    if (!choices || choices.length === 0) {
      session.retries = (session.retries || 0) + 1;
      if (session.retries >= 2) {
        return forwardBecause(
          `Richiesta modifica blocco tavolo: scelta campi non riconosciuta (evento ${session.manageLockCandidateEventId || ""})`
        );
      }
      gatherSpeech(
        vr,
        "Non ho capito. Puoi scegliere: la data, l'orario, la durata o il tavolo. Puoi dire anche: orario e durata."
      );
      return { kind: "vr", twiml: vr.toString() };
    }

    const original = session.manageLockCandidateEvent || {};
    const originalDateISO = String(original?.start?.dateTime || original?.start?.date || session.manageLockDateISO || "").slice(0, 10);
    const originalTime24 = parseTimeIT(original?.start?.dateTime || "") || session.manageLockTime24;
    const originalDurationMinutes = extractDurationMinutesFromEvent(original) || 120;
    const originalTableId = getLockTableIdFromEvent(original) || session.manageLockTableId;

    session.manageLockOriginal = {
      originalDateISO,
      originalTime24,
      originalDurationMinutes,
      originalTableId,
    };

    session.manageLockProposed = {
      dateISO: originalDateISO,
      time24: originalTime24,
      durationMinutes: originalDurationMinutes,
      tableId: originalTableId,
    };

    session.manageLockModificationRaw = String(speech || "").trim().slice(0, 200);

    // Normalizza chiavi
    session.manageLockChangeQueue = choices.map((c) => (c === "date" ? "date" : c));
    resetRetries(session);

    const first = session.manageLockChangeQueue.shift();
    gotoLockModifyField(session, vr, first, true);
    return { kind: "vr", twiml: vr.toString() };
  }

  if (state === "manage_lock_set_date") {
    if (emptySpeech) {
      const silenceResult = handleSilence(session, vr, () =>
        gatherSpeech(vr, "Non ho capito la data. Per quale giorno vuoi spostare il blocco tavolo?")
      );
      if (silenceResult.action === "forward") {
        return forwardBecause(`Richiesta modifica blocco tavolo: data non fornita (evento ${session.manageLockCandidateEventId || ""})`);
      }
      return { kind: "vr", twiml: vr.toString() };
    }
    const d = parseDateWithWeekday(speech);
    if (!d) {
      session.retries = (session.retries || 0) + 1;
      if (session.retries >= 2) {
        return forwardBecause(`Richiesta modifica blocco tavolo: data non riconosciuta (evento ${session.manageLockCandidateEventId || ""})`);
      }
      gatherSpeech(vr, "Non ho capito la data. Puoi ripeterla?");
      return { kind: "vr", twiml: vr.toString() };
    }
    resetRetries(session);
    session.manageLockProposed = session.manageLockProposed || {};
    session.manageLockProposed.dateISO = d;

    const next = (session.manageLockChangeQueue || []).shift();
    session.manageLockChangeQueue = session.manageLockChangeQueue || [];
    if (next) {
      gotoLockModifyField(session, vr, next, false);
      return { kind: "vr", twiml: vr.toString() };
    }

    session.operatorState = "manage_lock_confirm_apply";
    const p = session.manageLockProposed || {};
    gatherSpeech(
      vr,
      `Riepilogo blocco: ${p.tableId || ""} il ${p.dateISO || ""} alle ${p.time24 || ""} per ${p.durationMinutes || 120} minuti. Vuoi confermare?`
    );
    return { kind: "vr", twiml: vr.toString() };
  }

  if (state === "manage_lock_set_time") {
    if (emptySpeech) {
      const silenceResult = handleSilence(session, vr, () =>
        gatherSpeech(vr, "Non ho capito l'orario. A che ora deve iniziare il blocco?")
      );
      if (silenceResult.action === "forward") {
        return forwardBecause(`Richiesta modifica blocco tavolo: orario non fornito (evento ${session.manageLockCandidateEventId || ""})`);
      }
      return { kind: "vr", twiml: vr.toString() };
    }
    const t = parseTimeIT(speech);
    if (!t) {
      session.retries = (session.retries || 0) + 1;
      if (session.retries >= 2) {
        return forwardBecause(`Richiesta modifica blocco tavolo: orario non riconosciuto (evento ${session.manageLockCandidateEventId || ""})`);
      }
      gatherSpeech(vr, "Non ho capito l'orario. Puoi ripeterlo?");
      return { kind: "vr", twiml: vr.toString() };
    }
    resetRetries(session);
    session.manageLockProposed = session.manageLockProposed || {};
    session.manageLockProposed.time24 = t;

    const next = (session.manageLockChangeQueue || []).shift();
    session.manageLockChangeQueue = session.manageLockChangeQueue || [];
    if (next) {
      gotoLockModifyField(session, vr, next, false);
      return { kind: "vr", twiml: vr.toString() };
    }

    session.operatorState = "manage_lock_confirm_apply";
    const p = session.manageLockProposed || {};
    gatherSpeech(
      vr,
      `Riepilogo blocco: ${p.tableId || ""} il ${p.dateISO || ""} alle ${p.time24 || ""} per ${p.durationMinutes || 120} minuti. Vuoi confermare?`
    );
    return { kind: "vr", twiml: vr.toString() };
  }

  if (state === "manage_lock_set_duration") {
    if (emptySpeech) {
      const silenceResult = handleSilence(session, vr, () =>
        gatherSpeech(vr, "Non ho capito la durata. Quanti minuti deve durare il blocco?")
      );
      if (silenceResult.action === "forward") {
        return forwardBecause(`Richiesta modifica blocco tavolo: durata non fornita (evento ${session.manageLockCandidateEventId || ""})`);
      }
      return { kind: "vr", twiml: vr.toString() };
    }
    const dur = parseDurationMinutesIT(speech);
    if (!dur) {
      session.retries = (session.retries || 0) + 1;
      if (session.retries >= 2) {
        return forwardBecause(`Richiesta modifica blocco tavolo: durata non riconosciuta (evento ${session.manageLockCandidateEventId || ""})`);
      }
      gatherSpeech(vr, "Non ho capito la durata. Puoi dire per esempio: 120 minuti, oppure due ore.");
      return { kind: "vr", twiml: vr.toString() };
    }
    resetRetries(session);
    session.manageLockProposed = session.manageLockProposed || {};
    session.manageLockProposed.durationMinutes = dur;

    const next = (session.manageLockChangeQueue || []).shift();
    session.manageLockChangeQueue = session.manageLockChangeQueue || [];
    if (next) {
      gotoLockModifyField(session, vr, next, false);
      return { kind: "vr", twiml: vr.toString() };
    }

    session.operatorState = "manage_lock_confirm_apply";
    const p = session.manageLockProposed || {};
    gatherSpeech(
      vr,
      `Riepilogo blocco: ${p.tableId || ""} il ${p.dateISO || ""} alle ${p.time24 || ""} per ${p.durationMinutes || 120} minuti. Vuoi confermare?`
    );
    return { kind: "vr", twiml: vr.toString() };
  }

  if (state === "manage_lock_set_table") {
    if (emptySpeech) {
      const silenceResult = handleSilence(session, vr, () =>
        gatherSpeech(vr, "Non ho capito il tavolo. Quale tavolo vuoi bloccare?")
      );
      if (silenceResult.action === "forward") {
        return forwardBecause(`Richiesta modifica blocco tavolo: tavolo non fornito (evento ${session.manageLockCandidateEventId || ""})`);
      }
      return { kind: "vr", twiml: vr.toString() };
    }
    const tableId = parseTableIdIT(speech);
    if (!tableId) {
      session.retries = (session.retries || 0) + 1;
      if (session.retries >= 2) {
        return forwardBecause(`Richiesta modifica blocco tavolo: tavolo non riconosciuto (evento ${session.manageLockCandidateEventId || ""})`);
      }
      gatherSpeech(vr, "Non ho capito il tavolo. Puoi ripeterlo? Per esempio: tavolo 7.");
      return { kind: "vr", twiml: vr.toString() };
    }
    resetRetries(session);
    session.manageLockProposed = session.manageLockProposed || {};
    session.manageLockProposed.tableId = tableId;

    const next = (session.manageLockChangeQueue || []).shift();
    session.manageLockChangeQueue = session.manageLockChangeQueue || [];
    if (next) {
      gotoLockModifyField(session, vr, next, false);
      return { kind: "vr", twiml: vr.toString() };
    }

    session.operatorState = "manage_lock_confirm_apply";
    const p = session.manageLockProposed || {};
    gatherSpeech(
      vr,
      `Riepilogo blocco: ${p.tableId || ""} il ${p.dateISO || ""} alle ${p.time24 || ""} per ${p.durationMinutes || 120} minuti. Vuoi confermare?`
    );
    return { kind: "vr", twiml: vr.toString() };
  }

  if (state === "manage_lock_confirm_apply") {
    if (emptySpeech) {
      const silenceResult = handleSilence(session, vr, () => gatherSpeech(vr, "Vuoi confermare la modifica del blocco?"));
      if (silenceResult.action === "forward") {
        return forwardBecause(`Richiesta modifica blocco tavolo: conferma non fornita (evento ${session.manageLockCandidateEventId || ""})`);
      }
      return { kind: "vr", twiml: vr.toString() };
    }

    const yn = parseYesNo(speech);
    if (yn === false) {
      softReturnToMenu("Va bene, non modifico nulla.");
      return { kind: "vr", twiml: vr.toString() };
    }
    if (yn !== true) {
      gatherSpeech(vr, "Non ho capito. Vuoi confermare la modifica del blocco? Rispondi sì o no.");
      return { kind: "vr", twiml: vr.toString() };
    }

    const p = session.manageLockProposed || {};
    const ok = await patchAvailabilityLockEvent({
      eventId: session.manageLockCandidateEventId,
      newDateISO: p.dateISO,
      newTime24: p.time24,
      newDurationMinutes: p.durationMinutes,
      newTableId: p.tableId,
    });

    if (!ok) {
      return forwardBecause(`Richiesta modifica blocco tavolo: errore aggiornamento (evento ${session.manageLockCandidateEventId || ""})`);
    }

    sayIt(vr, "Perfetto. Ho modificato il blocco tavolo. Grazie e a presto.");
    vr.hangup();
    session.operatorState = null;
    return { kind: "vr", twiml: vr.toString() };
  }

  // fallback: se non riconosciamo lo stato, torniamo al menu
  softReturnToMenu("Va bene.");
  return { kind: "vr", twiml: vr.toString() };
}

function extractPeopleFromSummary(summary) {
  const s = String(summary || "");
  const m = s.match(/\b(\d{1,2})\s*pax\b/i);
  return m ? Number(m[1]) : null;
}

function extractPeopleFromDescription(description) {
  const d = String(description || "");
  const m = d.match(/^Persone:\s*(\d{1,2})\b/im);
  return m ? Number(m[1]) : null;
}

function extractNotesFromDescription(description) {
  const d = String(description || "");
  const m = d.match(/^Note:\s*(.*)$/im);
  return m ? String(m[1] || "").trim() : "";
}

function extractNotesHint(speech) {
  const tt = String(speech || "").trim();
  // Se l'utente dice "note ..." o "richiesta ..." usiamo la parte dopo la keyword
  const m = tt.match(/\b(note|richiesta|richieste)\b\s*:?\s*(.+)$/i);
  if (m && m[2]) return String(m[2]).trim().slice(0, 200);
  return "";
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
  sayIt(vr, "Ti abbiamo riservato l'area divanetti, ideale per aperitivo e dopocena.");
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
    if (summary.startsWith("annullata") || summary.startsWith("annullato")) continue;
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
    if (summary.startsWith("annullata") || summary.startsWith("annullato")) continue;
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
      const comboT10T11T12 = TABLE_COMBINATIONS.find(
        (combo) =>
          combo.displayId === "T10" &&
          combo.replaces.length === 3 &&
          combo.replaces.includes("T10") &&
          combo.replaces.includes("T11") &&
          combo.replaces.includes("T12")
      );
      const hasComboT14 = comboT14 && comboT14.replaces.every((id) => availableSet.has(id));
      const hasComboT10T11T12 = comboT10T11T12 && comboT10T11T12.replaces.every((id) => availableSet.has(id));
      if (!hasComboT14 && !hasComboT10T11T12) {
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
    `- Se l'utente vuole prenotare un tavolo, raccogli: nome, data (YYYY-MM-DD), numero persone, ora (HH:MM), eventuali note e preordine (se vuole).`,
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
      return "Hai intolleranze o ? (se no scrivi: nessuna)";
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
    return "Hai intolleranze o ? (se no scrivi: nessuna)";
  }

  if (step === "ask_notes") {
    if (!text) return "Hai ? Se no scrivi: nessuna";
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
      if (isFriday) return "L'apericena promo non è disponibile il venerdì. Scegli un'altra opzione oppure scrivi: nessuno";
      session.preorderChoiceKey = promoOption?.key || "piatto_apericena_promo";
      session.preorderLabel = promoOption?.label || "Piatto Apericena in promo (previa registrazione)";
      if (glutenIntolerance) {
        // non blocchiamo, ma avvisiamo
      }
    } else if (normalized.includes("apericena") && !normalized.includes("piatto")) {
      if (glutenIntolerance) return "L'apericena non è disponibile per celiaci o intolleranti al glutine. Vuoi scegliere un'alternativa o scrivere: nessuno?";
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
      return "A quell'orario siamo al completo 😅 Vuoi provare un altro orario? (es. 20:00 oppure 21:30)";
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
    // Gestione flussi speciali (annulla/modifica prenotazione, informazioni)
    if (session.operatorState && String(session.operatorState).startsWith("manage_")) {
      const r = await handleManageBookingFlow(session, req, vr, speech, emptySpeech);
      res.set("Content-Type", "text/xml; charset=utf-8");
      return res.send(r.twiml);
    }

    if (session.operatorState && ["info_question", "info_avail_people", "info_avail_time"].includes(String(session.operatorState))) {
      const r = await handleInfoFlow(session, req, vr, speech, emptySpeech);
      res.set("Content-Type", "text/xml; charset=utf-8");
      return res.send(r.twiml);
    }

    // Richiesta operatore / Info: stato macchina che evita chiusure secche
    if (
      session.operatorState === "await_reason" ||
      session.operatorState === "info_need_details" ||
      session.operatorState === "info_more" ||
      session.operatorState === "info_offer_booking"
    ) {
      const kind =
        session.operatorKind || (session.intent === "event" ? "event" : session.intent === "info" ? "info" : "generic");
      const n = normalizeText(speech);
      const emptySpeech = !n;

      const isNoLike = (tt) => {
        const t = normalizeText(tt || "");
        if (!t) return false;
        return (
          t === "no" ||
          t.includes("nessun") ||
          t.includes("nessuna") ||
          t.includes("nessuno") ||
          t.includes("niente") ||
          t.includes("nulla") ||
          t.includes("basta") ||
          t.includes("stop") ||
          t.includes("non serve") ||
          t.includes("a posto") ||
          t.includes("va bene cosi") ||
          t.includes("va bene così")
        );
      };

      const isYesLike = (tt) => {
        const t = normalizeText(tt || "");
        if (!t) return false;
        return YES_WORDS.some((w) => t.includes(normalizeText(w)));
      };

      const askMorePrompt = "Ti serve qualche altra informazione?";
      const offerBookingPrompt = "Vuoi prenotare un tavolo?";
      const softGoodbye = "Perfetto. Grazie e a presto.";

      // --- STATO: OFFERTA PRENOTAZIONE ---
      if (session.operatorState === "info_offer_booking") {
        session.infoOfferTries = Number(session.infoOfferTries || 0);

        if (emptySpeech) {
          session.infoOfferTries += 1;
          if (session.infoOfferTries >= 2) {
            sayIt(vr, softGoodbye);
            vr.hangup();
            res.set("Content-Type", "text/xml; charset=utf-8");
            return res.send(vr.toString());
          }
          gatherSpeech(vr, offerBookingPrompt);
          res.set("Content-Type", "text/xml; charset=utf-8");
          return res.send(vr.toString());
        }

        if (isYesLike(speech)) {
          // entra nel flusso tavolo senza rompere routing/step esistenti
          session.operatorState = null;
          session.operatorPrompt = null;
          session.operatorRetryPrompt = null;
          session.operatorKind = null;
          session.infoPending = null;
          session.intent = "table";
          session.step = 1;
          resetRetries(session);
          gatherSpeech(vr, "Perfetto, prenotiamo il tuo tavolo. Come ti chiami?");
          res.set("Content-Type", "text/xml; charset=utf-8");
          return res.send(vr.toString());
        }

        // NO -> chiudi con cortesia
        sayIt(vr, softGoodbye);
        vr.hangup();
        res.set("Content-Type", "text/xml; charset=utf-8");
        return res.send(vr.toString());
      }

      // --- STATO: INFO_MORE (ciclo “altre info?”) ---
      if (session.operatorState === "info_more") {
        session.infoMoreSilence = Number(session.infoMoreSilence || 0);

        if (emptySpeech) {
          session.infoMoreSilence += 1;
          if (session.infoMoreSilence >= 2) {
            session.operatorState = "info_offer_booking";
            session.infoOfferTries = 0;
            gatherSpeech(vr, offerBookingPrompt);
            res.set("Content-Type", "text/xml; charset=utf-8");
            return res.send(vr.toString());
          }
          gatherSpeech(vr, askMorePrompt);
          res.set("Content-Type", "text/xml; charset=utf-8");
          return res.send(vr.toString());
        }

        session.infoMoreSilence = 0;

        if (isNoLike(speech)) {
          session.operatorState = "info_offer_booking";
          session.infoOfferTries = 0;
          gatherSpeech(vr, offerBookingPrompt);
          res.set("Content-Type", "text/xml; charset=utf-8");
          return res.send(vr.toString());
        }

        // nuova domanda info: prova a rispondere
        const attempt = await tryAnswerInfoQuestionVoiceSmart(session, speech);

        if (attempt?.handled && attempt?.needsDetails && attempt?.pending) {
          session.infoPending = attempt.pending;
          // domanda di dettaglio (manca time/persone)
          if (attempt.pending.type === "availability") {
            const needPeople = !Number.isFinite(attempt.pending.people);
            const needTime = !attempt.pending.time24;
            const p =
              needPeople && needTime
                ? "Per quante persone e a che ora?"
                : needPeople
                ? "Per quante persone?"
                : "A che ora?";
            session.operatorState = "info_need_details";
            session.infoNeedSilence = 0;
            gatherSpeech(vr, p);
            res.set("Content-Type", "text/xml; charset=utf-8");
            return res.send(vr.toString());
          }
          session.operatorState = "info_need_details";
          session.infoNeedSilence = 0;
          gatherSpeech(vr, "Puoi darmi un dettaglio in piu'?" );
          res.set("Content-Type", "text/xml; charset=utf-8");
          return res.send(vr.toString());
        }

        if (attempt?.handled && attempt?.answer) {
          sayIt(vr, attempt.answer);
          session.operatorState = "info_more";
          gatherSpeech(vr, askMorePrompt);
          res.set("Content-Type", "text/xml; charset=utf-8");
          return res.send(vr.toString());
        }

        // non so rispondere: registro richiesta operatore (una sola volta) ma NON chiudo secco
        session.operatorReasonRaw = (session.operatorReasonRaw ? `${session.operatorReasonRaw}\n` : "") +
          String(speech || "").trim();

        if (!session.operatorCallbackEventCreated) {
          await sendFallbackEmail(session, req, "operator_request");
          void sendOperatorEmail(session, req, "operator_request");
          void safeCreateOperatorCallbackCalendarEvent(session, req, "requested");
          sayIt(vr, "Va bene. Ho preso nota della richiesta e ti faremo ricontattare al piu' presto.");
        } else {
          sayIt(vr, "Ok. Ho aggiunto anche questa richiesta e ti faremo ricontattare al piu' presto.");
        }

        session.operatorState = "info_more";
        gatherSpeech(vr, askMorePrompt);
        res.set("Content-Type", "text/xml; charset=utf-8");
        return res.send(vr.toString());
      }

      // --- STATO: INFO_NEED_DETAILS (completa dati mancanti, poi risponde) ---
      if (session.operatorState === "info_need_details") {
        session.infoNeedSilence = Number(session.infoNeedSilence || 0);

        if (emptySpeech) {
          session.infoNeedSilence += 1;
          if (session.infoNeedSilence >= 2) {
            session.operatorState = "info_more";
            gatherSpeech(vr, askMorePrompt);
            res.set("Content-Type", "text/xml; charset=utf-8");
            return res.send(vr.toString());
          }
          const pending = session.infoPending || {};
          if (pending.type === "availability") {
            const needPeople = !Number.isFinite(pending.people);
            const needTime = !pending.time24;
            const p =
              needPeople && needTime
                ? "Per quante persone e a che ora?"
                : needPeople
                ? "Per quante persone?"
                : "A che ora?";
            gatherSpeech(vr, p);
            res.set("Content-Type", "text/xml; charset=utf-8");
            return res.send(vr.toString());
          }
          gatherSpeech(vr, "Puoi darmi un dettaglio in piu'?" );
          res.set("Content-Type", "text/xml; charset=utf-8");
          return res.send(vr.toString());
        }

        const pending = session.infoPending || {};
        if (pending.type === "availability") {
          const maybePeople = parsePeopleIT(speech);
          const maybeTime = parseTimeIT(speech);
          if (!Number.isFinite(pending.people) && Number.isFinite(maybePeople)) pending.people = maybePeople;
          if (!pending.time24 && maybeTime) pending.time24 = maybeTime;

          if (!Number.isFinite(pending.people) || !pending.time24) {
            const needPeople = !Number.isFinite(pending.people);
            const needTime = !pending.time24;
            const p =
              needPeople && needTime
                ? "Per quante persone e a che ora?"
                : needPeople
                ? "Per quante persone?"
                : "A che ora?";
            session.infoPending = pending;
            gatherSpeech(vr, p);
            res.set("Content-Type", "text/xml; charset=utf-8");
            return res.send(vr.toString());
          }

          const resp = await checkAvailabilityQuickVoice(session, pending.dateISO, pending.people, pending.time24);
          if (resp?.answer) sayIt(vr, resp.answer);

          session.infoPending = null;
          session.operatorState = "info_more";
          gatherSpeech(vr, askMorePrompt);
          res.set("Content-Type", "text/xml; charset=utf-8");
          return res.send(vr.toString());
        }

        // generic pending: prova a rieseguire smart
        const attempt = await tryAnswerInfoQuestionVoiceSmart(session, String(speech || "").trim());
        if (attempt?.handled && attempt?.answer) sayIt(vr, attempt.answer);
        session.infoPending = null;
        session.operatorState = "info_more";
        gatherSpeech(vr, askMorePrompt);
        res.set("Content-Type", "text/xml; charset=utf-8");
        return res.send(vr.toString());
      }

      // --- STATO: await_reason (prima domanda) ---
      if (session.operatorState === "await_reason") {
        // raccolta domanda (come prima, ma se info -> prova a rispondere e NON chiude secco)
        if (emptySpeech || isPureConsent(speech)) {
          session.operatorReasonTries = Number(session.operatorReasonTries || 0) + 1;
          if (session.operatorReasonTries < 2) {
            gatherSpeech(vr, session.operatorRetryPrompt || "Qual e' la richiesta?");
            res.set("Content-Type", "text/xml; charset=utf-8");
            return res.send(vr.toString());
          }
          session.operatorReasonRaw = "non specificato";
        } else {
          session.operatorReasonRaw = String(speech || "").trim();
        }

        // INFO: prova risposta smart
        if (kind === "info") {
          const attempt = await tryAnswerInfoQuestionVoiceSmart(session, session.operatorReasonRaw);

          if (attempt?.handled && attempt?.needsDetails && attempt?.pending) {
            session.infoPending = attempt.pending;
            session.operatorState = "info_need_details";
            session.infoNeedSilence = 0;
            const needPeople = !Number.isFinite(attempt.pending.people);
            const needTime = !attempt.pending.time24;
            const p =
              needPeople && needTime
                ? "Per quante persone e a che ora?"
                : needPeople
                ? "Per quante persone?"
                : "A che ora?";
            gatherSpeech(vr, p);
            res.set("Content-Type", "text/xml; charset=utf-8");
            return res.send(vr.toString());
          }

          if (attempt?.handled && attempt?.answer) {
            sayIt(vr, attempt.answer);
            session.operatorState = "info_more";
            session.infoMoreSilence = 0;
            gatherSpeech(vr, askMorePrompt);
            res.set("Content-Type", "text/xml; charset=utf-8");
            return res.send(vr.toString());
          }

          // non so rispondere -> registro callback, ma continuo con “altre info?”
          await sendFallbackEmail(session, req, "operator_request");
          void sendOperatorEmail(session, req, "operator_request");
          void safeCreateOperatorCallbackCalendarEvent(session, req, "requested");
          sayIt(vr, "Va bene. Ho preso nota della richiesta e ti faremo ricontattare al piu' presto.");
          session.operatorState = "info_more";
          session.infoMoreSilence = 0;
          gatherSpeech(vr, askMorePrompt);
          res.set("Content-Type", "text/xml; charset=utf-8");
          return res.send(vr.toString());
        }

        // EVENTO (o altro): comportamento invariato, ma con dial più robusto
        await sendFallbackEmail(session, req, "operator_request");
        void sendOperatorEmail(session, req, "operator_request");

        const operatorPhone = getOperatorPhoneE164();
        const canDialLive = Boolean(ENABLE_FORWARDING && operatorPhone);

        void safeCreateOperatorCallbackCalendarEvent(session, req, "requested");

        session.operatorState = null;
        session.operatorPrompt = null;
        session.operatorRetryPrompt = null;

        if (canDialLive) {
          res.set("Content-Type", "text/xml; charset=utf-8");
          return res.send(forwardToHumanTwiml(req));
        }

        sayIt(vr, "Va benissimo. Ho preso nota e ti faremo ricontattare al piu' presto. Grazie e a presto.");
        vr.hangup();
        res.set("Content-Type", "text/xml; charset=utf-8");
        return res.send(vr.toString());
      }
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
        // Silenzio: massimo 3 tentativi, poi chiude e registra il tentativo non completato
        if (emptySpeech) {
          session.intentSilenceRetries = (session.intentSilenceRetries || 0) + 1;
          if (session.intentSilenceRetries >= 3) {
            sayIt(vr, "Va bene, nessun problema. Ti saluto e se vuoi puoi richiamarci quando preferisci. A presto.");
            await safeCreateFailedCallCalendarEvent(session, req, "menu_silence");
            vr.hangup();
            res.set("Content-Type", "text/xml; charset=utf-8");
            return res.send(vr.toString());
          }
          gatherSpeech(vr, buildMainMenuPrompt());
          break;
        }
        session.intentSilenceRetries = 0;

        const normalized = normalizeText(speech);
        let intent = null;
        // Nuovo: annulla/modifica prenotazione
        if (
          (normalized.includes("annull") || normalized.includes("cancell") || normalized.includes("disdir")) &&
          (normalized.includes("prenot") || normalized.includes("prenotazione"))
        ) {
          intent = "manage_cancel";
        } else if (
          (normalized.includes("modific") || normalized.includes("cambi") || normalized.includes("spost") || normalized.includes("varia")) &&
          (normalized.includes("blocco") || normalized.includes("slot") || normalized.includes("lock") || normalized.includes("occupat")) &&
          (normalized.includes("tavolo") || normalized.includes("tav"))
        ) {
          intent = "manage_modify_lock";
        } else if (
          (normalized.includes("modific") || normalized.includes("cambi") || normalized.includes("spost") || normalized.includes("varia")) &&
          (normalized.includes("prenot") || normalized.includes("prenotazione"))
        ) {
          intent = "manage_modify";
        } else if (normalized.includes("tavolo") || normalized.includes("prenot")) {
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
          gatherSpeech(vr, buildMainMenuPrompt());
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

        if (intent === "manage_cancel") {
          session.manageAction = "cancel";
          session.manageDateISO = null;
          session.manageTime24 = null;
          session.manageSurname = null;
          session.manageCandidateEventId = null;
          session.manageCandidateEvent = null;
          session.operatorState = "manage_cancel_date";
          gatherSpeech(vr, "Va bene. Dimmi la data della prenotazione da annullare.");
          break;
        }


        if (intent === "manage_modify_lock") {
          session.manageAction = "modify_lock";
          session.manageLockDateISO = null;
          session.manageLockTime24 = null;
          session.manageLockTableId = null;
          session.manageLockCandidateEventId = null;
          session.manageLockCandidateEvent = null;
          session.manageLockModificationRaw = null;
          session.manageLockPendingUpdate = null;
          session.operatorState = "manage_lock_date";
          gatherSpeech(vr, "Va bene. Dimmi la data del blocco tavolo da modificare.");
          break;
        }

        if (intent === "manage_modify") {
          session.manageAction = "modify";
          session.manageDateISO = null;
          session.manageTime24 = null;
          session.manageSurname = null;
          session.manageCandidateEventId = null;
          session.manageCandidateEvent = null;
          session.manageModificationRaw = null;
          session.managePendingUpdate = null;
          session.operatorState = "manage_modify_date";
          gatherSpeech(vr, "Va bene. Dimmi la data della prenotazione da modificare.");
          break;
        }

        if (intent === "info") {
          session.operatorState = "await_reason";
          session.operatorKind = "info";
          session.operatorReasonRaw = null;
          session.operatorReasonTries = 0;
          session.operatorPrompt = "Va bene. Dimmi pure cosa vuoi sapere.";
          session.operatorRetryPrompt = "Qual e' la richiesta?";
          gatherSpeech(vr, session.operatorPrompt);
          break;
        }

        if (intent === "event") {
          // Procedura ibrida: raccogli motivo, registra su Calendar e tenta inoltro operatore
          session.operatorState = "await_reason";
          session.operatorReasonTries = 0;
          session.operatorReasonRaw = null;
          session.operatorKind = "event";
          session.operatorPrompt = "Va bene. Dimmi in poche parole i dettagli dell\'evento e cosa ti serve.";
          session.operatorRetryPrompt = "Quali dettagli dell\'evento e cosa ti serve?";
          gatherSpeech(vr, session.operatorPrompt);
          break;
        }

        // Sicurezza: se per qualche motivo non siamo entrati in nessun intent
        gatherSpeech(vr, buildMainMenuPrompt());
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
                "L'apericena promo non è disponibile il venerdì. Puoi scegliere l'apericena standard oppure un altro piatto."
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
                "L'apericena non è disponibile per celiaci o intolleranti al glutine. Puoi scegliere un'alternativa."
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
        session.step9SilenceConsecutive = 0;
        session.step9NeedsDetail = false;
        maybeSayApericenaNotices(vr, session);
        maybeSayLiveMusicNotice(vr, session);
        gatherSpeech(vr, "Hai altre ? Se sì, dimmelo ora.");
        break;
      }
      case 9: {
        const basePrompt = "Hai altre ? Se sì, dimmelo ora.";
        const clarifyPrompt = "Va bene. Dimmi qual è la richiesta.";

        // gestione silenzio dedicata: 1° silenzio ripete, 2° silenzio consecutivo = NO
        if (emptySpeech) {
          session.step9SilenceConsecutive = Number(session.step9SilenceConsecutive || 0) + 1;
          if (session.step9SilenceConsecutive >= 2) {
            session.extraRequestsRaw = "nessuna";
            session.step9NeedsDetail = false;
            session.step9SilenceConsecutive = 0;
            resetRetries(session);
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
          gatherSpeech(vr, session.step9NeedsDetail ? clarifyPrompt : basePrompt);
          break;
        }

        // risposta presente: reset contatore silenzio
        session.step9SilenceConsecutive = 0;

        const raw = String(speech || "").trim();

        // Se avevamo chiesto chiarimento dopo un "sì" generico
        if (session.step9NeedsDetail) {
          session.step9NeedsDetail = false;
          // salva qualunque testo (anche "sì")
          const cleaned = raw.slice(0, 200).trim();
          if (!cleaned || isNoRequestsText(cleaned) || parseYesNo(cleaned) === false) {
            session.extraRequestsRaw = "nessuna";
          } else {
            session.extraRequestsRaw = cleaned;
          }

          if (isOutsideRequest(session.extraRequestsRaw)) {
            session.wantsOutside = true;
            maybeSayOutsideWarning(vr);
          }

          resetRetries(session);
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

        // Caso NO esplicito / nessuna richiesta
        if (isNoRequestsText(raw) || parseYesNo(raw) === false) {
          session.extraRequestsRaw = "nessuna";
          resetRetries(session);
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

        // Caso "sì" senza contenuto: 1 sola domanda di chiarimento
        if (isPureConsent(raw)) {
          session.step9NeedsDetail = true;
          gatherSpeech(vr, clarifyPrompt);
          break;
        }

        // Qualsiasi testo -> salva esatto (ripulito) e passa allo step 10
        session.extraRequestsRaw = raw.slice(0, 200).trim() || "nessuna";
        if (isOutsideRequest(session.extraRequestsRaw)) {
          session.wantsOutside = true;
          maybeSayOutsideWarning(vr);
        }

        resetRetries(session);
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

  const goodbye =
    session?.operatorKind === "info"
      ? "Al momento non riesco a metterti in contatto con un operatore, ma ho preso nota della tua richiesta e ti faremo richiamare al più presto. Grazie e a presto."
      : session?.operatorKind === "event"
      ? "Al momento non riesco a metterti in contatto con un operatore, ma ho preso nota dei dettagli e ti faremo ricontattare al più presto. Grazie e a presto."
      : "Al momento non riesco a metterti in contatto con un operatore, ma ti faremo richiamare al più presto. Grazie e a presto.";
  sayIt(vr, goodbye);
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
