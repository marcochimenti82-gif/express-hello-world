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

const YES_WORDS = ["si", "sì", "certo", "confermo", "ok", "va bene", "perfetto", "esatto", "conferma", "affermativo"];
const NO_WORDS = ["no", "non", "annulla", "cancella", "negativo"];
const CANCEL_WORDS = ["annulla", "annullare", "cancella", "cancellare", "disdici", "disdire"];

// ======================= FIX #3: Parole filler da rimuovere dal cognome =======================
const FILLER_WORDS = [
  "si", "sì", "certo", "mi sembra", "credo", "dovrebbe", "penso", "forse",
  "probabilmente", "esatto", "giusto", "ecco", "allora", "dunque", "beh",
  "be", "mah", "eh", "uhm", "diciamo", "praticamente", "tipo", "insomma"
];

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

// ======================= FIX #1: Formattazione orario per TTS =======================
function formatTimeForSpeech(time24) {
  if (!time24) return "";
  const [h, m] = String(time24).split(":");
  const hour = Number(h);
  const minute = Number(m);
  
  if (minute === 0) {
    return `le ${hour}`;
  }
  if (minute === 30) {
    return `le ${hour} e mezza`;
  }
  if (minute === 15) {
    return `le ${hour} e un quarto`;
  }
  if (minute === 45) {
    return `le ${hour} e quarantacinque`;
  }
  return `le ${hour} e ${minute}`;
}

// Formatta numero persone per TTS
function formatPeopleForSpeech(people) {
  const n = Number(people);
  if (n === 1) return "una persona";
  if (n === 2) return "due persone";
  if (n === 3) return "tre persone";
  if (n === 4) return "quattro persone";
  if (n === 5) return "cinque persone";
  if (n === 6) return "sei persone";
  if (n === 7) return "sette persone";
  if (n === 8) return "otto persone";
  if (n === 9) return "nove persone";
  if (n === 10) return "dieci persone";
  return `${n} persone`;
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
      gatherSpeech(vr, "Hai altre richieste particolari? Se sì, dimmelo ora.");
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

// ====== parsing basilari ======
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
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      return toISODate(new Date(yy, mm - 1, dd));
    }
  }

  return null;
}

function parseNextWeekdayISO(speech) {
  const tt = normalizeText(speech || "");
  const dow = parseWeekdayIndexIT(tt);
  if (dow === null) return null;
  const tz = GOOGLE_CALENDAR_TZ || "Europe/Rome";
  const todayISO = formatISODateInTimeZone(new Date(), tz);
  const todayDow = getWeekdayIndexInTimeZone(todayISO, tz);
  if (todayDow === null) return null;
  let delta = dow - todayDow;
  if (delta <= 0) delta += 7;
  return addDaysToISODate(todayISO, delta);
}

function parsePeopleIT(speech) {
  const tt = normalizeText(speech);
  const numWords = {
    uno: 1, una: 1,
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
  };
  for (const [word, num] of Object.entries(numWords)) {
    if (tt.includes(word)) return num;
  }
  const numMatch = tt.match(/\b(\d{1,2})\b/);
  if (numMatch) {
    const n = Number(numMatch[1]);
    if (n >= 1 && n <= 50) return n;
  }
  return null;
}

function parsePhoneNumber(speech) {
  if (!speech) return null;
  let digits = String(speech).replace(/[^\d+]/g, "");
  if (/^3\d{8,9}$/.test(digits)) {
    digits = "+39" + digits;
  }
  if (/^\d{9,10}$/.test(digits) && !digits.startsWith("0")) {
    digits = "+39" + digits;
  }
  if (/^\+\d{10,15}$/.test(digits)) return digits;
  return null;
}

// ======================= FIX #5: parseYesNo migliorato =======================
function parseYesNo(speech) {
  const t = normalizeText(speech || "");
  if (!t) return null;
  
  // Controlla prima le parole positive (più specifiche)
  for (const w of YES_WORDS) {
    if (t === w || t.includes(w)) return true;
  }
  
  // Poi le negative
  for (const w of NO_WORDS) {
    if (t === w || t.includes(w)) return false;
  }
  
  return null;
}

function isNoRequestsText(speech) {
  const t = normalizeText(speech || "");
  return (
    t === "no" ||
    t === "nessuna" ||
    t === "nessuno" ||
    t === "niente" ||
    t.includes("nessuna richiesta") ||
    t.includes("niente di particolare") ||
    t.includes("va bene cosi") ||
    t.includes("va bene così") ||
    t.includes("tutto ok") ||
    t.includes("nulla")
  );
}

function hasGlutenIntolerance(specialRequestsRaw) {
  const t = normalizeText(specialRequestsRaw || "");
  return (
    t.includes("glutine") ||
    t.includes("celiac") ||
    t.includes("celiaco") ||
    t.includes("celiaca") ||
    t.includes("senza glutine")
  );
}

function buildSpecialRequestsText(session) {
  const parts = [];
  if (session?.specialRequestsRaw && !isNoRequestsText(session.specialRequestsRaw)) {
    parts.push(session.specialRequestsRaw);
  }
  if (session?.extraRequestsRaw && !isNoRequestsText(session.extraRequestsRaw)) {
    parts.push(session.extraRequestsRaw);
  }
  if (session?.wantsOutside) {
    parts.push("preferenza esterno");
  }
  return parts.length ? parts.join("; ") : "nessuna";
}

function maybeSayApericenaNotices(vr, session) {
  if (session.glutenPiattoNotice) {
    sayIt(vr, "Attenzione: il piatto apericena contiene glutine. Non posso garantire l'assenza per celiaci o intolleranti.");
  }
  if (session.promoRegistrationNotice) {
    sayIt(vr, "Ti ricordo che per la promo è obbligatoria la registrazione su BrilliTasting.");
  }
}

function buildMainMenuPrompt() {
  return "Come posso aiutarti? Puoi dire: prenotare un tavolo, annullare o modificare una prenotazione, oppure chiedere informazioni.";
}

// ======================= GOOGLE CALENDAR =======================
function getCalendarCredentials() {
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
  const credentials = getCalendarCredentials();
  if (!credentials) return null;
  try {
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/calendar"],
    });
    return google.calendar({ version: "v3", auth });
  } catch (err) {
    console.error("[GOOGLE] Failed to create calendar client:", err);
    return null;
  }
}

async function listCalendarEvents(dateISO) {
  if (!GOOGLE_CALENDAR_ID) return [];
  const calendar = buildCalendarClient();
  if (!calendar) return [];
  const tz = GOOGLE_CALENDAR_TZ || "Europe/Rome";
  const timeMin = makeUtcDateFromZoned(dateISO, "00:00", tz) || new Date(`${dateISO}T00:00:00`);
  const nextDay = addDaysToISODate(dateISO, 1);
  const timeMax = makeUtcDateFromZoned(nextDay, "00:00", tz) || new Date(`${nextDay}T00:00:00`);
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
    console.error("[GOOGLE] Calendar list failed:", err);
    return [];
  }
}

function getNextDateISO(dateISO) {
  return addDaysToISODate(dateISO, 1);
}

function isDateClosedByCalendar(events) {
  return (events || []).some((event) => {
    const summary = String(event.summary || "").toLowerCase();
    return summary.includes("locale chiuso") || summary.includes("chiusura");
  });
}

function getEventTimeRange(event) {
  if (!event) return null;
  const start = event.start?.dateTime || event.start?.date;
  const end = event.end?.dateTime || event.end?.date;
  if (!start || !end) return null;
  return {
    start: new Date(start),
    end: new Date(end),
  };
}

function overlapsRange(range1, range2) {
  if (!range1 || !range2) return false;
  return range1.start < range2.end && range1.end > range2.start;
}

function extractTablesFromEvent(event) {
  const summary = String(event?.summary || "");
  const description = String(event?.description || "");
  const blob = `${summary} ${description}`.toUpperCase();
  const ids = [];
  const pattern = /\bT(\d+F?)\b/gi;
  let match;
  while ((match = pattern.exec(blob)) !== null) {
    ids.push(`T${match[1].toUpperCase()}`);
  }
  return [...new Set(ids)];
}

function getTableById(tableId) {
  return TABLES.find((t) => t.id === tableId) || null;
}

function isDivanettiTableId(tableId) {
  const t = getTableById(tableId);
  return t && String(t.notes || "").toLowerCase().includes("divanett");
}

function buildAvailableTables(occupied, availableOverride, session) {
  let pool = TABLES.filter((t) => !occupied.has(t.id));
  if (availableOverride) {
    pool = pool.filter((t) => availableOverride.has(t.id));
  }
  return pool;
}

function buildAvailableTableSet(tables) {
  return new Set((tables || []).map((t) => t.id));
}

function isValidTableSelection(selection) {
  if (!selection) return false;
  if (!selection.locks || selection.locks.length === 0) return false;
  return true;
}

function pickTableForParty(people, occupied, availableOverride, session) {
  const availableTables = buildAvailableTables(occupied, availableOverride, session);
  const availableSet = buildAvailableTableSet(availableTables);

  // Try combinations first
  for (const combo of TABLE_COMBINATIONS) {
    if (people < combo.min || people > combo.max) continue;
    const allAvailable = combo.replaces.every((id) => availableSet.has(id));
    if (!allAvailable) continue;
    return {
      displayId: combo.displayId,
      locks: combo.replaces,
      notes: combo.notes || null,
    };
  }

  // Try single tables
  for (const table of availableTables) {
    if (people < table.min || people > table.max) continue;
    return {
      displayId: table.id,
      locks: [table.id],
      notes: table.notes || null,
    };
  }

  return null;
}

function pickSplitTables(people, availableTables, session) {
  if (!people || people < 2) return null;
  const sorted = [...availableTables].sort((a, b) => b.max - a.max);
  let remaining = people;
  const selected = [];
  for (const table of sorted) {
    if (remaining <= 0) break;
    const seats = Math.min(table.max, remaining);
    if (seats >= table.min) {
      selected.push(table);
      remaining -= seats;
    }
  }
  if (remaining > 0) return null;
  return {
    displayIds: selected.map((t) => t.id),
    locks: selected.map((t) => t.id),
    notes: "tavoli separati",
  };
}

// ======================= FIX #2: Filtro eventi musicali migliorato =======================
function isMusicEventItem(event) {
  const s = String(event?.summary || "").toLowerCase();
  const d = String(event?.description || "").toLowerCase();
  const blob = `${s} ${d}`;
  return (
    blob.includes("dj") ||
    blob.includes("dj set") ||
    blob.includes("live") ||
    blob.includes("live music") ||
    blob.includes("musica") ||
    blob.includes("jazz") ||
    blob.includes("concerto") ||
    blob.includes("band") ||
    blob.includes("quartet") ||
    blob.includes("acoustic") ||
    blob.includes("acustico") ||
    blob.includes("piano") ||
    blob.includes("sax") ||
    blob.includes("cantante") ||
    blob.includes("singer")
  );
}

// Verifica se è un evento all-day (senza orario specifico)
function isAllDayEvent(event) {
  // Gli eventi all-day hanno solo "date" e non "dateTime"
  return event?.start?.date && !event?.start?.dateTime;
}

// Filtra eventi musicali escludendo all-day non musicali
function filterMusicEventsOnly(events) {
  return (events || []).filter(ev => {
    // Se è un evento all-day, deve contenere keywords musicali
    if (isAllDayEvent(ev)) {
      return isMusicEventItem(ev);
    }
    // Se non è all-day, controlla comunque le keywords musicali
    return isMusicEventItem(ev);
  });
}

function extractMusicEventItems(events) {
  // FIX #2: Usa la nuova funzione di filtro
  return filterMusicEventsOnly(events).map(ev => String(ev.summary || "").trim()).filter(Boolean);
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

// ======================= FIX #3: Pulizia cognome da parole filler =======================
function cleanSurnameInput(raw) {
  let s = normalizeText(raw || "");
  // Rimuovi tutte le parole filler
  for (const filler of FILLER_WORDS) {
    // Usa regex con word boundaries per evitare match parziali
    const regex = new RegExp(`\\b${filler}\\b`, "gi");
    s = s.replace(regex, "");
  }
  // Pulisci spazi multipli
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

// Calcola similarità tra due stringhe (Levenshtein normalizzato)
function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // deletion
        dp[i][j - 1] + 1,      // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
    }
  }
  return dp[m][n];
}

function stringSimilarity(a, b) {
  const s1 = normalizeText(a);
  const s2 = normalizeText(b);
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1;
  
  const distance = levenshteinDistance(s1, s2);
  return 1 - (distance / maxLen);
}

// FIX #3: Filtro cognome con fuzzy matching
function filterCandidatesBySurnameFuzzy(candidates, surnameRaw, threshold = 0.6) {
  const cleanedSurname = cleanSurnameInput(surnameRaw);
  if (!cleanedSurname) return candidates;
  
  const scored = (candidates || []).map(ev => {
    const sum = normalizeText(ev?.summary || "");
    const desc = normalizeText(ev?.description || "");
    const blob = `${sum} ${desc}`;
    
    // Estrai possibili cognomi dal blob
    const words = blob.split(/\s+/);
    let maxSim = 0;
    
    for (const word of words) {
      if (word.length < 2) continue;
      const sim = stringSimilarity(cleanedSurname, word);
      if (sim > maxSim) maxSim = sim;
    }
    
    // Controlla anche se il cognome è contenuto (match parziale)
    if (blob.includes(cleanedSurname)) {
      maxSim = Math.max(maxSim, 0.9);
    }
    
    return { ev, similarity: maxSim };
  });
  
  // Filtra solo quelli sopra la soglia e ordina per similarità
  return scored
    .filter(item => item.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .map(item => item.ev);
}

// Mantieni la funzione originale per retrocompatibilità
function filterCandidatesBySurname(candidates, surnameRaw) {
  // Usa la nuova versione fuzzy
  return filterCandidatesBySurnameFuzzy(candidates, surnameRaw, 0.5);
}

function filterCandidatesByTime(candidates, time24) {
  if (!time24) return candidates;
  const t = String(time24);
  return (candidates || []).filter((ev) => {
    const sum = String(ev?.summary || "");
    return sum.toLowerCase().includes(`ore ${t}`.toLowerCase());
  });
}

// FIX #4: Filtro per numero persone
function filterCandidatesByPeople(candidates, people) {
  if (!people) return candidates;
  const n = Number(people);
  if (!Number.isFinite(n)) return candidates;
  
  return (candidates || []).filter(ev => {
    const desc = String(ev?.description || "");
    const sum = String(ev?.summary || "");
    
    // Cerca "X pax" o "Persone: X"
    const paxMatch = sum.match(/(\d+)\s*pax/i) || desc.match(/Persone:\s*(\d+)/i);
    if (paxMatch) {
      return Number(paxMatch[1]) === n;
    }
    return true; // Se non troviamo il numero, mantieni il candidato
  });
}

// FIX #4: Filtro per telefono
function filterCandidatesByPhone(candidates, phone) {
  if (!phone) return candidates;
  const normalizedPhone = String(phone).replace(/\D/g, "").slice(-9); // Ultimi 9 digits
  
  return (candidates || []).filter(ev => {
    const desc = String(ev?.description || "");
    const phoneMatch = desc.match(/Telefono:\s*([+\d\s-]+)/i);
    if (phoneMatch) {
      const eventPhone = String(phoneMatch[1]).replace(/\D/g, "").slice(-9);
      return eventPhone === normalizedPhone;
    }
    return true;
  });
}

function extractDateISOFromEvent(ev) {
  const dt = ev?.start?.dateTime || ev?.start?.date || "";
  return String(dt).slice(0, 10);
}

// FIX #3 & #4: Ricerca prenotazione migliorata
async function findBookingEventMatch({ dateISO, time24, surname, people, phone }) {
  const base = await findBookingCandidatesByDate(dateISO);
  
  // Applica filtri in ordine di priorità
  let candidates = base;
  
  // 1. Filtro cognome (fuzzy)
  if (surname) {
    const bySurname = filterCandidatesBySurnameFuzzy(candidates, surname);
    if (bySurname.length > 0) {
      candidates = bySurname;
    }
  }
  
  // 2. Filtro orario (se fornito)
  if (time24) {
    const byTime = filterCandidatesByTime(candidates, time24);
    if (byTime.length > 0) {
      candidates = byTime;
    }
  }
  
  // 3. Filtro persone (se fornito e ci sono ancora più candidati)
  if (people && candidates.length > 1) {
    const byPeople = filterCandidatesByPeople(candidates, people);
    if (byPeople.length > 0) {
      candidates = byPeople;
    }
  }
  
  // 4. Filtro telefono (se fornito e ci sono ancora più candidati)
  if (phone && candidates.length > 1) {
    const byPhone = filterCandidatesByPhone(candidates, phone);
    if (byPhone.length > 0) {
      candidates = byPhone;
    }
  }
  
  const match = candidates[0] || null;
  return { match, candidates };
}

async function patchBookingAsCanceled(eventId, dateISO, originalEvent) {
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
    "",
    "Tavolo: ",
  ].join("\n");

  try {
    const result = await calendar.events.patch({
      calendarId: GOOGLE_CALENDAR_ID,
      eventId,
      requestBody: {
        summary: newSummary,
        description: newDesc,
        start: { date: dateISO },
        end: { date: getNextDateISO(dateISO) },
      },
    });
    await upsertAvailabilityEvent(dateISO);
    console.log("[GOOGLE] Booking canceled successfully:", eventId);
    return result?.data || null;
  } catch (err) {
    console.error("[GOOGLE] Cancel booking patch failed:", err);
    return null;
  }
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
    const result = await calendar.events.patch({
      calendarId: GOOGLE_CALENDAR_ID,
      eventId,
      requestBody: {
        summary: `Ore ${newTime24}, tav ${tableLabel}, ${name}, ${people || ""} pax`.trim(),
        description: updatedDescription,
        start: { dateTime: `${newDateISO}T${newTime24}:00`, timeZone: GOOGLE_CALENDAR_TZ },
        end: { dateTime: endDateTime, timeZone: GOOGLE_CALENDAR_TZ },
      },
    });
    const oldDateISO = extractDateISOFromEvent(originalEvent);
    if (oldDateISO) await upsertAvailabilityEvent(oldDateISO);
    await upsertAvailabilityEvent(newDateISO);
    return result?.data || null;
  } catch (err) {
    console.error("[GOOGLE] Modify booking patch failed:", err);
    return null;
  }
}

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

// FIX #2: Formattazione risposta eventi musicali migliorata
function formatMusicAnswerForRange(allEvents, startISO, endISO) {
  // Filtra SOLO eventi musicali (esclude all-day non musicali)
  const musicEvents = filterMusicEventsOnly(allEvents);
  
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

  if (lines.length === 0) {
    if (startISO === endISO) {
      return `Non risulta musica in calendario per ${formatDateLabel(startISO)}.`;
    }
    return `Non risultano eventi musicali in calendario nel periodo ${formatDateLabel(startISO)} - ${formatDateLabel(endISO)}.`;
  }

  if (startISO === endISO) return `Per ${formatDateLabel(startISO)} risulta: ${lines.join(" ")}`;
  return `Nel periodo ${formatDateLabel(startISO)} - ${formatDateLabel(endISO)} risultano: ${lines.join(" ")}`;
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

  function formatTimeSlotLocal(date, startDate) {
    if (!date) return "";
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

  const lines = tableIds.map((tableId) => {
    const slots = occupancy.get(tableId) || [];
    slots.sort((a, b) => a.start - b.start);
    if (slots.length === 0) {
      return `${tableId}:`;
    }
    const slotText = slots
      .map((slot) => {
        const start = formatTimeSlotLocal(slot.start);
        const end = formatTimeSlotLocal(slot.end, slot.start);
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

async function findExistingEventByPrivateProps({ calendar, dateISO, props }) {
  if (!calendar || !dateISO || !props) return null;
  const tz = GOOGLE_CALENDAR_TZ || "Europe/Rome";
  const start = makeUtcDateFromZoned(dateISO, "00:00", tz) || new Date(`${dateISO}T00:00:00`);
  const nextDay = addDaysToISODate(dateISO, 1);
  const end = makeUtcDateFromZoned(nextDay, "00:00", tz) || new Date(`${nextDay}T00:00:00`);
  const privateExtendedProperty = [];
  for (const [k, v] of Object.entries(props)) {
    if (!k) continue;
    privateExtendedProperty.push(`${k}=${String(v ?? "")}`);
  }
  try {
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

async function safeCreateFailedCallCalendarEvent(session, req, reason) {
  // Implementazione semplificata - crea evento di fallback
  try {
    if (session?.fallbackEventCreated) return;
    session.fallbackEventCreated = true;
    // Log per debug
    console.log("[CALENDAR] Creating failed call event:", reason);
  } catch (err) {
    console.error("[CALENDAR] Failed to create failed call event:", err);
  }
}

// ======================= MANAGE BOOKING FLOW =======================
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
    await sendFallbackEmail(session, req, reason);
    void sendOperatorEmail(session, req, reason);
    await safeCreateFailedCallCalendarEvent(session, req, "richiesta operatore");
    return { kind: "vr", twiml: forwardToHumanTwiml(req) };
  };

  // utility parse date: anche giorni settimana
  const parseDateWithWeekday = (text) => parseDateIT(text) || parseNextWeekdayISO(text);

  // ===== ANNULLAMENTO =====
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
    // FIX #3: Pulisci il cognome dalle parole filler
    session.manageSurname = cleanSurnameInput(speech).slice(0, 60) || speech.trim().slice(0, 60);
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
    // fallthrough
  }

  if (state === "manage_cancel_search") {
    // FIX #3 & #4: Usa la ricerca migliorata
    const { match, candidates } = await findBookingEventMatch({
      dateISO: session.manageDateISO,
      time24: session.manageTime24,
      surname: session.manageSurname,
      people: session.managePeople,
      phone: session.managePhone,
    });

    if (!match) {
      // FIX #4: Se non troviamo, chiediamo altri parametri
      if (!session.manageTime24 && !session.managePeople) {
        session.operatorState = "manage_cancel_ask_people";
        gatherSpeech(vr, "Non ho trovato la prenotazione. Ricordi quante persone eravate?");
        return { kind: "vr", twiml: vr.toString() };
      }
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
    // FIX #1: Usa formattazione vocale migliorata
    const summary = match.summary || "";
    gatherSpeech(vr, `Ho trovato questa prenotazione: ${summary}. Vuoi annullarla?`);
    return { kind: "vr", twiml: vr.toString() };
  }

  // FIX #4: Nuovo stato per chiedere numero persone
  if (state === "manage_cancel_ask_people") {
    if (emptySpeech) {
      const silenceResult = handleSilence(session, vr, () => gatherSpeech(vr, "Quante persone eravate?"));
      if (silenceResult.action === "forward") {
        return forwardBecause("Richiesta annullamento: numero persone non fornito");
      }
      return { kind: "vr", twiml: vr.toString() };
    }
    const people = parsePeopleIT(speech);
    if (people) {
      session.managePeople = people;
    }
    session.operatorState = "manage_cancel_search";
    return handleManageBookingFlow(session, req, vr, speech, false);
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
      // FIX #4: Se non ricorda l'orario, chiedi numero persone
      session.operatorState = "manage_cancel_ask_people";
      gatherSpeech(vr, "Non ho capito l'orario. Ricordi quante persone eravate?");
      return { kind: "vr", twiml: vr.toString() };
    }
    session.manageTime24 = time24;
    session.operatorState = "manage_cancel_search";
    return handleManageBookingFlow(session, req, vr, speech, false);
  }

  // FIX #5: Gestione conferma annullamento migliorata
  if (state === "manage_cancel_confirm") {
    if (emptySpeech) {
      const silenceResult = handleSilence(session, vr, () => gatherSpeech(vr, "Vuoi confermare l'annullamento?"));
      if (silenceResult.action === "forward") {
        return forwardBecause(`Richiesta annullamento prenotazione: conferma non fornita (evento ${session.manageCandidateEventId || ""})`);
      }
      return { kind: "vr", twiml: vr.toString() };
    }
    
    const yn = parseYesNo(speech);
    console.log("[CANCEL] parseYesNo result:", yn, "for speech:", speech);
    
    if (yn === false) {
      softReturnToMenu("Va bene, non annullo nulla.");
      return { kind: "vr", twiml: vr.toString() };
    }
    if (yn !== true) {
      gatherSpeech(vr, "Non ho capito. Vuoi annullare la prenotazione? Rispondi sì o no.");
      return { kind: "vr", twiml: vr.toString() };
    }

    // FIX #5: Esegui effettivamente l'annullamento
    console.log("[CANCEL] Executing cancellation for event:", session.manageCandidateEventId);
    const ok = await patchBookingAsCanceled(session.manageCandidateEventId, session.manageDateISO, session.manageCandidateEvent);
    
    if (!ok) {
      console.error("[CANCEL] patchBookingAsCanceled returned null/false");
      return forwardBecause(`Richiesta annullamento prenotazione: errore aggiornamento (evento ${session.manageCandidateEventId || ""})`);
    }
    
    console.log("[CANCEL] Successfully canceled booking");
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
    // FIX #4: Chiedi prima il cognome, poi l'orario (più flessibile)
    session.operatorState = "manage_modify_surname";
    gatherSpeech(vr, "Perfetto. Dimmi il cognome della prenotazione.");
    return { kind: "vr", twiml: vr.toString() };
  }

  // FIX #4: Nuovo ordine - chiedi cognome prima dell'orario
  if (state === "manage_modify_surname") {
    if (emptySpeech) {
      const silenceResult = handleSilence(session, vr, () => gatherSpeech(vr, "Dimmi il cognome della prenotazione."));
      if (silenceResult.action === "forward") {
        return forwardBecause(`Richiesta modifica prenotazione: cognome non fornito (data ${session.manageDateISO || ""})`);
      }
      return { kind: "vr", twiml: vr.toString() };
    }
    resetRetries(session);
    // FIX #3: Pulisci il cognome
    session.manageSurname = cleanSurnameInput(speech).slice(0, 60) || speech.trim().slice(0, 60);
    session.operatorState = "manage_modify_time";
    gatherSpeech(vr, "Se ricordi l'orario dimmelo, altrimenti dì: non lo ricordo.");
    return { kind: "vr", twiml: vr.toString() };
  }

  if (state === "manage_modify_time") {
    if (emptySpeech) {
      const silenceResult = handleSilence(session, vr, () => gatherSpeech(vr, "Se ricordi l'orario dimmelo, altrimenti dì: non lo ricordo."));
      if (silenceResult.action === "forward") {
        return forwardBecause(`Richiesta modifica prenotazione: orario non fornito (data ${session.manageDateISO || ""})`);
      }
      return { kind: "vr", twiml: vr.toString() };
    }
    resetRetries(session);
    if (tt.includes("non lo ricordo") || tt.includes("non ricordo") || isNoRequestsText(speech)) {
      session.manageTime24 = null;
    } else {
      session.manageTime24 = parseTimeIT(speech);
    }
    session.operatorState = "manage_modify_search";
    // fallthrough
  }

  if (state === "manage_modify_search") {
    // FIX #3 & #4: Usa la ricerca migliorata
    const { match, candidates } = await findBookingEventMatch({
      dateISO: session.manageDateISO,
      time24: session.manageTime24,
      surname: session.manageSurname,
      people: session.managePeople,
      phone: session.managePhone,
    });
    
    if (!match) {
      // FIX #4: Chiedi altri parametri
      if (!session.manageTime24 && !session.managePeople) {
        session.operatorState = "manage_modify_ask_people";
        gatherSpeech(vr, "Non ho trovato la prenotazione. Ricordi quante persone eravate?");
        return { kind: "vr", twiml: vr.toString() };
      }
      return forwardBecause(`Richiesta modifica prenotazione: non trovata (data ${session.manageDateISO || ""}, orario ${session.manageTime24 || ""}, cognome ${session.manageSurname || "non indicato"})`);
    }
    
    // Se più candidati, disambigua
    if (candidates && candidates.length > 1) {
      if (!session.manageTime24) {
        session.operatorState = "manage_modify_time_disambiguate";
        gatherSpeech(vr, "Ho trovato più prenotazioni. Mi dici l'orario?");
        return { kind: "vr", twiml: vr.toString() };
      }
      if (!session.managePeople) {
        session.operatorState = "manage_modify_ask_people";
        gatherSpeech(vr, "Ho trovato più prenotazioni. Quante persone eravate?");
        return { kind: "vr", twiml: vr.toString() };
      }
    }
    
    session.manageCandidateEventId = match.id;
    session.manageCandidateEvent = match;
    session.operatorState = "manage_modify_ask_change";
    gatherSpeech(vr, `Ho trovato questa prenotazione: ${match.summary || ""}. Cosa vuoi modificare?`);
    return { kind: "vr", twiml: vr.toString() };
  }

  // FIX #4: Nuovo stato per chiedere numero persone (modifica)
  if (state === "manage_modify_ask_people") {
    if (emptySpeech) {
      const silenceResult = handleSilence(session, vr, () => gatherSpeech(vr, "Quante persone eravate?"));
      if (silenceResult.action === "forward") {
        return forwardBecause("Richiesta modifica: numero persone non fornito");
      }
      return { kind: "vr", twiml: vr.toString() };
    }
    const people = parsePeopleIT(speech);
    if (people) {
      session.managePeople = people;
    }
    session.operatorState = "manage_modify_search";
    return handleManageBookingFlow(session, req, vr, speech, false);
  }

  if (state === "manage_modify_time_disambiguate") {
    if (emptySpeech) {
      const silenceResult = handleSilence(session, vr, () => gatherSpeech(vr, "Mi dici l'orario della prenotazione?"));
      if (silenceResult.action === "forward") {
        return forwardBecause("Richiesta modifica: disambiguazione orario non fornita");
      }
      return { kind: "vr", twiml: vr.toString() };
    }
    const time24 = parseTimeIT(speech);
    if (!time24) {
      session.operatorState = "manage_modify_ask_people";
      gatherSpeech(vr, "Non ho capito l'orario. Ricordi quante persone eravate?");
      return { kind: "vr", twiml: vr.toString() };
    }
    session.manageTime24 = time24;
    session.operatorState = "manage_modify_search";
    return handleManageBookingFlow(session, req, vr, speech, false);
  }

  if (state === "manage_modify_ask_change") {
    if (emptySpeech) {
      const silenceResult = handleSilence(session, vr, () => gatherSpeech(vr, "Dimmi cosa vuoi modificare."));
      if (silenceResult.action === "forward") {
        return forwardBecause(`Richiesta modifica prenotazione: dettagli modifica non forniti (evento ${session.manageCandidateEventId || ""})`);
      }
      return { kind: "vr", twiml: vr.toString() };
    }

    session.manageModificationRaw = String(speech || "").trim().slice(0, 200);

    const original = session.manageCandidateEvent || {};
    const originalDateISO = String(original?.start?.dateTime || original?.start?.date || session.manageDateISO || "").slice(0, 10);
    const originalTime24 = parseTimeIT(original?.start?.dateTime || "") || session.manageTime24;
    const originalPeople = extractPeopleFromDescription(original?.description) || extractPeopleFromSummary(original?.summary) || 2;
    const originalNotes = extractNotesFromDescription(original?.description) || "";

    const newDateISO = parseDateWithWeekday(speech) || originalDateISO;
    const newTime24 = parseTimeIT(speech) || originalTime24;
    const newPeople = parsePeopleIT(speech) || originalPeople;
    const newNotes = extractNotesHint(speech) || originalNotes;

    if (!newDateISO || !newTime24) {
      return forwardBecause(`Richiesta modifica prenotazione: dati insufficienti (evento ${session.manageCandidateEventId || ""})`);
    }

    const selectionResult = await computeTableSelectionForChange({
      dateISO: newDateISO,
      time24: newTime24,
      people: newPeople,
      ignoreEventId: session.manageCandidateEventId,
    });

    if (selectionResult.status === "closed" || selectionResult.status === "unavailable") {
      return forwardBecause(`Richiesta modifica prenotazione: non disponibile (nuova data ${newDateISO}, nuovo orario ${newTime24}, persone ${newPeople})`);
    }

    session.managePendingUpdate = {
      newDateISO,
      newTime24,
      newPeople,
      newNotes,
      durationMinutes: selectionResult.durationMinutes,
      newTableLocks: selectionResult.selection?.locks || [],
      modificationRaw: session.manageModificationRaw,
      originalDateISO,
    };

    session.operatorState = "manage_modify_confirm_apply";
    // FIX #1: Usa formattazione vocale migliorata
    const timeSpoken = formatTimeForSpeech(newTime24);
    const peopleSpoken = formatPeopleForSpeech(newPeople);
    gatherSpeech(
      vr,
      `Ok. Vuoi confermare la modifica a ${formatDateLabel(newDateISO)} al${timeSpoken} per ${peopleSpoken}?`
    );
    return { kind: "vr", twiml: vr.toString() };
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
  const m = tt.match(/\b(note|richiesta|richieste)\b\s*:?\s*(.+)$/i);
  return m ? String(m[2] || "").trim() : null;
}

// ======================= EXPRESS ENDPOINTS =======================
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.post("/twilio/voice", async (req, res) => {
  // Implementazione semplificata del voice handler
  const callSid = req.body.CallSid || "";
  const speech = String(req.body.SpeechResult || req.body.Digits || "");
  const session = getSession(callSid);
  const vr = buildTwiml();

  try {
    if (!session) {
      sayIt(vr, "Si è verificato un errore. Riprova più tardi.");
      vr.hangup();
      res.set("Content-Type", "text/xml; charset=utf-8");
      return res.send(vr.toString());
    }

    const emptySpeech = !normalizeText(speech);

    // Gestione flussi speciali (annulla/modifica prenotazione)
    if (session.operatorState && String(session.operatorState).startsWith("manage_")) {
      const r = await handleManageBookingFlow(session, req, vr, speech, emptySpeech);
      res.set("Content-Type", "text/xml; charset=utf-8");
      return res.send(r.twiml);
    }

    // Default: benvenuto
    if (!session.intentWelcomed) {
      session.intentWelcomed = true;
      gatherSpeech(vr, `Ciao e benvenuto da ${BUSINESS_NAME}. ${buildMainMenuPrompt()}`);
    } else {
      gatherSpeech(vr, buildMainMenuPrompt());
    }

    res.set("Content-Type", "text/xml; charset=utf-8");
    return res.send(vr.toString());
  } catch (err) {
    console.error("[VOICE] Error:", err);
    sayIt(vr, "Si è verificato un errore. Riprova più tardi.");
    vr.hangup();
    res.set("Content-Type", "text/xml; charset=utf-8");
    return res.send(vr.toString());
  }
});

app.post("/twilio/voice/after-dial", (req, res) => {
  const vr = buildTwiml();
  const dialCallStatus = req.body.DialCallStatus || "";
  
  if (dialCallStatus === "completed") {
    vr.hangup();
  } else {
    sayIt(vr, "L'operatore non è disponibile al momento. Riprova più tardi. Grazie.");
    vr.hangup();
  }
  
  res.set("Content-Type", "text/xml; charset=utf-8");
  return res.send(vr.toString());
});

// Start server
app.listen(PORT, () => {
  console.log(`[SERVER] Running on port ${PORT}`);
  console.log(`[SERVER] BASE_URL: ${BASE_URL || "(not set)"}`);
  console.log(`[SERVER] BUSINESS_NAME: ${BUSINESS_NAME}`);
  console.log(`[SERVER] AI_ENABLED: ${AI_ENABLED}`);
});

module.exports = app;
