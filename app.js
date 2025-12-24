"use strict";

const express = require("express");
const app = express();

// Body parsers per Twilio (x-www-form-urlencoded) + JSON
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ENV
const PORT = process.env.PORT || 3001;
const BASE_URL = process.env.BASE_URL || ""; // es: https://ai-backoffice-tuttibrilli.onrender.com

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM || ""; // es: whatsapp:+14155238886 (sandbox) oppure whatsapp:+<sender approvato>

const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";
const GOOGLE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || ""; // es: ...@group.calendar.google.com
const DEFAULT_EVENT_DURATION_MINUTES = parseInt(process.env.DEFAULT_EVENT_DURATION_MINUTES || "120", 10);

// >>> INOLTRO A OPERATORE (NUOVO)
const HUMAN_FORWARD_TO = process.env.HUMAN_FORWARD_TO || ""; // es: +393331112222
const ENABLE_FORWARDING = (process.env.ENABLE_FORWARDING || "true").toLowerCase() === "true";
const LOW_CONFIDENCE_THRESHOLD = parseFloat(process.env.LOW_CONFIDENCE_THRESHOLD || "0.45"); // regola a piacere

// Twilio client
let twilioClient = null;
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
  const twilio = require("twilio");
  twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

// Google Calendar client (Service Account)
const { google } = require("googleapis");

function getCalendarClient() {
  if (!GOOGLE_SERVICE_ACCOUNT_JSON) return null;
  if (!GOOGLE_CALENDAR_ID) return null;

  const creds = JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON);

  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });

  return google.calendar({ version: "v3", auth });
}

// --------------------
// Pagine base
// --------------------
app.get("/", (req, res) => res.status(200).send("AI TuttiBrilli backend attivo"));
app.get("/healthz", (req, res) => res.status(200).json({ status: "ok" }));
app.get("/voice", (req, res) => res.status(200).send("OK (Twilio usa POST su /voice)"));

// --------------------
// Helpers TwiML
// --------------------
function xmlEscape(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function twiml(xmlInsideResponseTag) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n${xmlInsideResponseTag}\n</Response>`;
}

function say(text) {
  const safe = xmlEscape(text);
  return `<Say language="it-IT" voice="alice">${safe}</Say>`;
}

function pause(len = 1) {
  return `<Pause length="${len}"/>`;
}

function redirect(url) {
  return `<Redirect method="POST">${xmlEscape(url)}</Redirect>`;
}

function hangup() {
  return `<Hangup/>`;
}

function gatherSpeech({
  action,
  method = "POST",
  timeout = 6,
  speechTimeout = "auto",
  language = "it-IT",
  prompt,
  hints = "",
}) {
  const safeAction = xmlEscape(action);
  const safeHints = hints ? ` hints="${xmlEscape(hints)}"` : "";
  return `
<Gather action="${safeAction}" method="${method}"
        input="speech"
        language="${language}"
        timeout="${timeout}"
        speechTimeout="${speechTimeout}"${safeHints}>
  ${say(prompt)}
</Gather>`;
}

// >>> DIAL/INOLTRO (NUOVO)
function dialNumber(numberE164, { callerId = null, timeout = 20 } = {}) {
  // callerId: opzionale, ma spesso conviene lasciare quello di Twilio
  const attrs = [
    timeout ? `timeout="${Number(timeout)}"` : "",
    callerId ? `callerId="${xmlEscape(callerId)}"` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `<Dial ${attrs}>${xmlEscape(numberE164)}</Dial>`;
}

function wantsHuman(text) {
  const t = String(text || "").toLowerCase();
  return /\b(operatore|umano|persona|collega|parlare con qualcuno|assistenza)\b/.test(t);
}

function canForwardToHuman() {
  return ENABLE_FORWARDING && Boolean(HUMAN_FORWARD_TO) && /^\+\d{8,15}$/.test(HUMAN_FORWARD_TO);
}

function forwardToHumanTwiml(reason = "richiesta assistenza") {
  if (!canForwardToHuman()) {
    // se non configurato, chiudiamo in modo elegante
    return `
${say("Va bene. Al momento non riesco a trasferire la chiamata. Ti invito a scriverci su WhatsApp. A presto!")}
${hangup()}
    `;
  }
  return `
${say("Perfetto, ti passo subito un operatore.")}
${pause(1)}
${dialNumber(HUMAN_FORWARD_TO, { timeout: 25 })}
${say("Non sono riuscito a metterti in contatto. Se vuoi, scrivici su WhatsApp. A presto!")}
${hangup()}
  `;
}

// --------------------
// Sessioni in memoria (MVP). In produzione: Redis/DB.
// --------------------
/**
 * session schema:
 * {
 *  step: number,
 *  substep?: string|null,
 *  retries: number,
 *  intent: "booking"|"info"|null,
 *  name: string|null,
 *  dateISO: "YYYY-MM-DD"|null,
 *  time24: "HH:MM"|null,
 *  people: number|null,
 *  waTo: "whatsapp:+39..."|null,
 *  fromCaller: "+39..."|null
 * }
 */
const sessions = new Map(); // key: CallSid

function getSession(callSid) {
  const s = sessions.get(callSid);
  if (s) return s;
  const fresh = {
    step: 1,
    substep: null,
    retries: 0,
    intent: null,
    name: null,
    dateISO: null,
    time24: null,
    people: null,
    waTo: null,
    fromCaller: null,
  };
  sessions.set(callSid, fresh);
  return fresh;
}

function resetRetries(session) {
  session.retries = 0;
}

function incRetry(session) {
  session.retries = (session.retries || 0) + 1;
  return session.retries;
}

// --------------------
// Parsing pragmatico (MVP)
// --------------------
function normalizeText(t) {
  return String(t || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function looksLikeBooking(text) {
  return /prenot|tavol|posti|riserv/.test(text);
}

function looksLikeInfo(text) {
  return /info|orari|indirizz|dove|menu|menù|carta|vini|evento|serata/.test(text);
}

function nowLocal() {
  return new Date();
}

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateIT_MVP(speech) {
  const t = normalizeText(speech);
  if (!t) return null;

  const now = nowLocal();

  if (/\b(oggi|stasera)\b/.test(t)) return toISODate(now);
  if (/\bdomani\b/.test(t)) {
    const d = new Date(now.getTime());
    d.setDate(d.getDate() + 1);
    return toISODate(d);
  }

  let m = t.match(/\b(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?\b/);
  if (m) {
    let dd = parseInt(m[1], 10);
    let mm = parseInt(m[2], 10);
    let yy = m[3] ? parseInt(m[3], 10) : now.getFullYear();
    if (yy < 100) yy = 2000 + yy;

    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      const d = new Date(yy, mm - 1, dd);
      if (d.getFullYear() === yy && d.getMonth() === mm - 1 && d.getDate() === dd) return toISODate(d);
    }
    return null;
  }

  const digits = t.replace(/[^\d]/g, "");
  if (digits.length === 4) {
    const dd = parseInt(digits.slice(0, 2), 10);
    const mm = parseInt(digits.slice(2, 4), 10);
    const yy = now.getFullYear();
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      const d = new Date(yy, mm - 1, dd);
      if (d.getMonth() === mm - 1 && d.getDate() === dd) return toISODate(d);
    }
  }

  return null;
}

function parseTimeIT_MVP(speech) {
  const t = normalizeText(speech);
  if (!t) return null;

  let m = t.match(/\b(\d{1,2})[:\.](\d{2})\b/);
  if (m) {
    const hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    }
    return null;
  }

  m = t.match(/\b(\d{1,2})\s*(?:e)?\s*(\d{1,2})\b/);
  if (m) {
    const hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    }
  }

  const digits = t.replace(/[^\d]/g, "");
  if (digits.length === 4) {
    const hh = parseInt(digits.slice(0, 2), 10);
    const mm = parseInt(digits.slice(2, 4), 10);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    }
  }

  m = t.match(/\b(\d{1,2})\b/);
  if (m) {
    const hh = parseInt(m[1], 10);
    if (hh >= 0 && hh <= 23) return `${String(hh).padStart(2, "0")}:00`;
  }

  return null;
}

function parsePeopleIT_MVP(speech) {
  const t = normalizeText(speech);
  if (!t) return null;

  const m = t.match(/\b(\d{1,2})\b/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 20) return n;
  }

  const map = {
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
  };
  for (const [k, v] of Object.entries(map)) {
    if (new RegExp(`\\b${k}\\b`).test(t)) return v;
  }

  return null;
}

function humanDateIT(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function normalizeWhatsappFromVoice(speechOrDigits) {
  const raw = String(speechOrDigits || "").replace(/[^\d]/g, "");
  if (!raw) return "";
  if (raw.startsWith("39")) return `whatsapp:+${raw}`;
  if (raw.startsWith("3")) return `whatsapp:+39${raw}`;
  return `whatsapp:+${raw}`;
}

function isLikelyItalianMobileE164(e164) {
  return /^\+39\d{9,12}$/.test(e164 || "");
}

function hasValidWaAddress(wa) {
  return /^whatsapp:\+\d{8,15}$/.test(wa || "");
}

// --------------------
// Google Calendar: crea evento prenotazione (con idempotenza su CallSid)
// --------------------
function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function toLocalDateTimeParts(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return { date: `${y}-${m}-${d}`, time: `${hh}:${mm}` };
}

async function createBookingEvent({
  callSid,
  name,
  dateISO,
  time24,
  people,
  phone,
  waTo,
}) {
  const calendar = getCalendarClient();
  if (!calendar) throw new Error("Google Calendar non configurato (manca JSON o CALENDAR_ID).");

  const privateKey = `callsid:${callSid}`;

  const existing = await calendar.events.list({
    calendarId: GOOGLE_CALENDAR_ID,
    q: privateKey,
    timeMin: `${dateISO}T00:00:00Z`,
    timeMax: `${dateISO}T23:59:59Z`,
    singleEvents: true,
    maxResults: 5,
  });

  const found = (existing.data.items || []).find((ev) => (ev.description || "").includes(privateKey));
  if (found) {
    return { eventId: found.id, htmlLink: found.htmlLink, reused: true };
  }

  const startDateTime = `${dateISO}T${time24}:00`;
  const start = new Date(`${dateISO}T${time24}:00`);
  const end = addMinutes(start, DEFAULT_EVENT_DURATION_MINUTES);
  const endParts = toLocalDateTimeParts(end);
  const endDateTime = `${endParts.date}T${endParts.time}:00`;

  const requestBody = {
    summary: `TuttiBrilli – ${name} – ${people} pax`,
    description:
      `Prenotazione\n` +
      `Nome: ${name}\n` +
      `Persone: ${people}\n` +
      `Telefono: ${phone || "-"}\n` +
      `WhatsApp: ${waTo || "-"}\n` +
      `${privateKey}\n`,
    start: { dateTime: startDateTime, timeZone: "Europe/Rome" },
    end: { dateTime: endDateTime, timeZone: "Europe/Rome" },
  };

  const resp = await calendar.events.insert({
    calendarId: GOOGLE_CALENDAR_ID,
    requestBody,
  });

  return { eventId: resp.data.id, htmlLink: resp.data.htmlLink, reused: false };
}

// --------------------
// TWILIO VOICE - START
// --------------------
app.post("/voice", (req, res) => {
  const callSid = req.body.CallSid || `local-${Date.now()}`;
  const from = req.body.From || ""; // caller id (può essere forwarder)
  const session = getSession(callSid);

  session.step = 1;
  session.substep = null;
  session.retries = 0;
  session.intent = null;
  session.name = null;
  session.dateISO = null;
  session.time24 = null;
  session.people = null;
  session.waTo = null;
  session.fromCaller = from;
  sessions.set(callSid, session);

  const action = `${BASE_URL}/voice/step`;

  const body = twiml(`
${say("Ciao! Hai chiamato TuttiBrilli Enoteca.")}
${pause(1)}
${gatherSpeech({
  action,
  prompt: "Vuoi prenotare un tavolo, oppure ti servono informazioni? Se vuoi un operatore, dimmi: operatore.",
  hints: "prenotare, prenotazione, tavolo, posti, informazioni, orari, indirizzo, operatore, umano",
})}
${say("Scusami, non ti ho sentito. Riproviamo.")}
${redirect(`${BASE_URL}/voice`)}
  `);

  res.type("text/xml").status(200).send(body);
});

// STEP HANDLER
app.post("/voice/step", async (req, res) => {
  const callSid = req.body.CallSid || `local-${Date.now()}`;
  const session = getSession(callSid);

  const speechRaw = (req.body.SpeechResult || "").trim();
  const speech = normalizeText(speechRaw);
  const confidence = parseFloat(req.body.Confidence || "0");

  const action = `${BASE_URL}/voice/step`;

  function respond(xml) {
    return res.type("text/xml").status(200).send(twiml(xml));
  }

  // >>> Fallback/Retry aggiornato: se finisco i tentativi => inoltro a operatore (se configurato)
  function failOrRetry({ prompt1, prompt2, exitPrompt, forwardOnFail = true }) {
    const n = incRetry(session);

    if (n === 1) {
      sessions.set(callSid, session);
      return respond(`
${gatherSpeech({ action, prompt: prompt1 })}
${redirect(action)}
      `);
    }
    if (n === 2) {
      sessions.set(callSid, session);
      return respond(`
${gatherSpeech({ action, prompt: prompt2 })}
${redirect(action)}
      `);
    }

    // tentativi finiti: inoltro oppure chiudo
    sessions.set(callSid, session);
    if (forwardOnFail && canForwardToHuman()) {
      sessions.delete(callSid);
      return respond(forwardToHumanTwiml("fallback_troppi_tentativi"));
    }

    sessions.delete(callSid);
    return respond(`
${say(exitPrompt)}
${hangup()}
    `);
  }

  try {
    // >>> Se chiede operatore in qualunque momento => inoltro immediato
    if (speech && wantsHuman(speech)) {
      sessions.delete(callSid);
      return respond(forwardToHumanTwiml("richiesta_utente"));
    }

    // >>> Confidenza bassa: se preferisci, puoi inoltrare SOLO dopo 1 retry.
    // Qui lo gestiamo in modo soft: aumenta la probabilità di fallback.
    const lowConfidence = Number.isFinite(confidence) && confidence > 0 && confidence < LOW_CONFIDENCE_THRESHOLD;

    // No input / no speech
    if (!speech) {
      if (session.step === 1) {
        return failOrRetry({
          prompt1: "Dimmi pure: vuoi prenotare o informazioni? Oppure di' operatore.",
          prompt2: "Puoi dire, per esempio: 'voglio prenotare un tavolo'. Oppure: 'operatore'.",
          exitPrompt: "Non riesco a sentirti bene. Se vuoi, scrivici su WhatsApp. A presto!",
          forwardOnFail: true,
        });
      }
      if (session.step === 2) {
        return failOrRetry({
          prompt1: "Come ti chiami?",
          prompt2: "Dimmi il tuo nome, ad esempio: 'Mario Rossi'.",
          exitPrompt: "Ok. Se vuoi, scrivici su WhatsApp. A presto!",
          forwardOnFail: true,
        });
      }
      if (session.step === 3) {
        return failOrRetry({
          prompt1: "Per che giorno vuoi prenotare?",
          prompt2: "Puoi dire 'domani' oppure '25 12'.",
          exitPrompt: "Non riesco a prendere la data. Scrivici su WhatsApp e ti aiutiamo subito. A presto!",
          forwardOnFail: true,
        });
      }
      if (session.step === 4) {
        return failOrRetry({
          prompt1: "A che ora preferisci?",
          prompt2: "Puoi dire '20 e 30' oppure '21'.",
          exitPrompt: "Non riesco a prendere l'orario. Scrivici su WhatsApp e ti aiutiamo subito. A presto!",
          forwardOnFail: true,
        });
      }
      if (session.step === 5) {
        return failOrRetry({
          prompt1: "Per quante persone?",
          prompt2: "Dimmi un numero, ad esempio 'quattro'.",
          exitPrompt: "Ok. Scrivici su WhatsApp con numero persone e orario. A presto!",
          forwardOnFail: true,
        });
      }
      if (session.step === 6) {
        return failOrRetry({
          prompt1: "A che numero WhatsApp vuoi ricevere la conferma? Dimmi il numero iniziando con più trentanove.",
          prompt2: "Ripetilo lentamente, ad esempio: più trentanove, tre tre tre...",
          exitPrompt: "Ok. Scrivici tu su WhatsApp e ti confermiamo lì. A presto!",
          forwardOnFail: true,
        });
      }
    }

    // >>> Se confidenza è bassa e siamo già in retry, puoi inoltrare più velocemente
    if (lowConfidence && session.retries >= 1 && canForwardToHuman()) {
      sessions.delete(callSid);
      return respond(forwardToHumanTwiml("bassa_confidenza_stt"));
    }

    // STEP 1: Intento
    if (session.step === 1) {
      if (looksLikeBooking(speech)) {
        session.intent = "booking";
        session.step = 2;
        resetRetries(session);
        sessions.set(callSid, session);

        return respond(`
${say("Perfetto. Ti faccio qualche domanda veloce.")}
${pause(1)}
${gatherSpeech({ action, prompt: "Come ti chiami?" })}
${redirect(action)}
        `);
      }

      if (looksLikeInfo(speech)) {
        sessions.delete(callSid);
        return respond(`
${say("Certo. Per informazioni rapide puoi scriverci su WhatsApp. Se invece vuoi prenotare, dimmelo e ti aiuto subito.")}
${hangup()}
        `);
      }

      return failOrRetry({
        prompt1: "Scusami, vuoi prenotare un tavolo o informazioni? Oppure di' operatore.",
        prompt2: "Puoi dire: 'prenotare un tavolo' oppure 'informazioni'. Oppure: 'operatore'.",
        exitPrompt: "Va bene. Scrivici su WhatsApp e ti rispondiamo appena possibile. A presto!",
        forwardOnFail: true,
      });
    }

    // STEP 2: Nome
    if (session.step === 2) {
      session.name = speechRaw || "(nome da confermare)";
      session.step = 3;
      resetRetries(session);
      sessions.set(callSid, session);

      return respond(`
${say(`Piacere, ${session.name}.`)}
${pause(1)}
${gatherSpeech({ action, prompt: "Per che giorno vuoi prenotare?" })}
${redirect(action)}
      `);
    }

    // STEP 3: Data
    if (session.step === 3) {
      const dateISO = parseDateIT_MVP(speech);
      if (!dateISO) {
        return failOrRetry({
          prompt1: "Non sono sicuro di aver capito la data. Per che giorno vuoi prenotare?",
          prompt2: "Puoi dire 'domani' oppure '25 12'.",
          exitPrompt: "Ok. Scrivici su WhatsApp con giorno e ora e ti confermiamo. A presto!",
          forwardOnFail: true,
        });
      }

      session.dateISO = dateISO;
      session.step = 4;
      resetRetries(session);
      sessions.set(callSid, session);

      return respond(`
${say(`Ok, ${humanDateIT(session.dateISO)}.`)}
${pause(1)}
${gatherSpeech({ action, prompt: "A che ora preferisci?" })}
${redirect(action)}
      `);
    }

    // STEP 4: Orario
    if (session.step === 4) {
      const time24 = parseTimeIT_MVP(speech);
      if (!time24) {
        return failOrRetry({
          prompt1: "Non sono sicuro di aver capito l'orario. A che ora preferisci?",
          prompt2: "Puoi dire '20 e 30' oppure '21'.",
          exitPrompt: "Ok. Scrivici su WhatsApp con giorno e ora e ti confermiamo. A presto!",
          forwardOnFail: true,
        });
      }

      session.time24 = time24;
      session.step = 5;
      resetRetries(session);
      sessions.set(callSid, session);

      return respond(`
${say(`Perfetto, alle ${session.time24}.`)}
${pause(1)}
${gatherSpeech({ action, prompt: "Per quante persone?" })}
${redirect(action)}
      `);
    }

    // STEP 5: Persone
    if (session.step === 5) {
      const people = parsePeopleIT_MVP(speech);
      if (!people) {
        return failOrRetry({
          prompt1: "Quante persone sarete?",
          prompt2: "Dimmi un numero, ad esempio 'quattro'.",
          exitPrompt: "Ok. Scrivici su WhatsApp con numero persone e orario. A presto!",
          forwardOnFail: true,
        });
      }

      session.people = people;
      session.step = 6;
      session.substep = null;
      resetRetries(session);
      sessions.set(callSid, session);

      const from = String(session.fromCaller || "");
      const fromE164 = from.startsWith("+") ? from : "";
      const canUseCaller = isLikelyItalianMobileE164(fromE164);

      if (canUseCaller) {
        session.substep = "wa_confirm_caller";
        sessions.set(callSid, session);

        return respond(`
${say(`Perfetto. Ricapitolo: ${humanDateIT(session.dateISO)} alle ${session.time24}, per ${session.people} persone.`)}
${pause(1)}
${gatherSpeech({
  action,
  prompt: "Ti mando la conferma su WhatsApp a questo numero. Va bene? Se vuoi un operatore, dimmi operatore.",
  hints: "sì, si, va bene, ok, certo, no, cambia, un altro numero, operatore, umano",
})}
${redirect(action)}
        `);
      }

      session.substep = "wa_ask_number";
      sessions.set(callSid, session);

      return respond(`
${say(`Perfetto. Ricapitolo: ${humanDateIT(session.dateISO)} alle ${session.time24}, per ${session.people} persone.`)}
${pause(1)}
${gatherSpeech({
  action,
  prompt: "A che numero WhatsApp vuoi ricevere la conferma? Dimmi il numero iniziando con più trentanove.",
})}
${redirect(action)}
      `);
    }

    // STEP 6: WhatsApp (consenso o numero)
    if (session.step === 6) {
      const sub = session.substep || "wa_ask_number";

      if (sub === "wa_confirm_caller") {
        const yes = /\b(si|sì|ok|va bene|certo|confermo)\b/.test(speech);
        const no = /\b(no|non va bene|cambia|altro numero)\b/.test(speech);

        if (yes && !no) {
          session.waTo = `whatsapp:${session.fromCaller}`;
          session.step = 7;
          session.substep = null;
          resetRetries(session);
          sessions.set(callSid, session);
          // continua a STEP 7 sotto
        } else if (no && !yes) {
          session.substep = "wa_ask_number";
          resetRetries(session);
          sessions.set(callSid, session);
          return respond(`
${gatherSpeech({ action, prompt: "Ok. Dimmi il numero WhatsApp, iniziando con più trentanove." })}
${redirect(action)}
          `);
        } else {
          return failOrRetry({
            prompt1: "Scusami, ti va bene che invii il WhatsApp a questo numero? Puoi dire sì o no. Oppure: operatore.",
            prompt2: "Dimmi solo: sì, va bene. Oppure: no, un altro numero. Oppure: operatore.",
            exitPrompt: "Ok. Scrivici tu su WhatsApp e ti confermiamo lì. A presto!",
            forwardOnFail: true,
          });
        }
      }

      if (sub === "wa_ask_number") {
        const waTo = normalizeWhatsappFromVoice(speechRaw || speech);
        if (!waTo || !hasValidWaAddress(waTo)) {
          return failOrRetry({
            prompt1: "Non sono sicuro di aver capito il numero. Me lo ripeti iniziando con più trentanove?",
            prompt2: "Ripetilo lentamente, ad esempio: più trentanove, tre tre tre...",
            exitPrompt: "Ok. Scrivici tu su WhatsApp e ti confermiamo lì. A presto!",
            forwardOnFail: true,
          });
        }

        session.waTo = waTo;
        session.step = 7;
        session.substep = null;
        resetRetries(session);
        sessions.set(callSid, session);
        // continua a STEP 7 sotto
      }
    }

    // STEP 7: crea evento su Calendar + invia WhatsApp
    if (session.step === 7) {
      // 1) Google Calendar
      let calendarResult = null;
      try {
        calendarResult = await createBookingEvent({
          callSid,
          name: session.name,
          dateISO: session.dateISO,
          time24: session.time24,
          people: session.people,
          phone: (session.fromCaller || "").startsWith("+") ? session.fromCaller : "",
          waTo: session.waTo,
        });
      } catch (e) {
        console.error("Google Calendar insert failed:", e);
      }

      // 2) WhatsApp
      const waTo = session.waTo;

      const waBody = calendarResult
        ? `✅ Prenotazione registrata\nNome: ${session.name}\nData: ${humanDateIT(session.dateISO)}\nOra: ${session.time24}\nPersone: ${session.people}\n\nSe devi modificare o annullare, rispondi a questo messaggio.`
        : `✅ Richiesta ricevuta\nNome: ${session.name}\nData: ${humanDateIT(session.dateISO)}\nOra: ${session.time24}\nPersone: ${session.people}\n\nTi confermiamo a breve.`;

      if (!twilioClient) {
        console.error("Twilio client non configurato: mancano TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN");
      } else if (!TWILIO_WHATSAPP_FROM) {
        console.error("Manca TWILIO_WHATSAPP_FROM (es. whatsapp:+14155238886)");
      } else if (!waTo || !hasValidWaAddress(waTo)) {
        console.error("waTo non valido:", waTo);
      } else {
        await twilioClient.messages.create({
          from: TWILIO_WHATSAPP_FROM,
          to: waTo,
          body: waBody,
        });
      }

      sessions.delete(callSid);
      return respond(`
${say("Perfetto! Ho registrato la prenotazione e ti ho inviato un WhatsApp di conferma. A presto da TuttiBrilli!")}
${hangup()}
      `);
    }

    // fallback finale
    sessions.delete(callSid);
    return respond(`
${say("Ripartiamo da capo.")}
${redirect(`${BASE_URL}/voice`)}
    `);
  } catch (err) {
    console.error("VOICE FLOW ERROR:", err);
    sessions.delete(callSid);

    // Se vuoi: anche sull'errore tecnico puoi inoltrare all'operatore
    if (canForwardToHuman()) {
      return res.type("text/xml").status(200).send(twiml(forwardToHumanTwiml("errore_tecnico")));
    }

    return res.type("text/xml").status(200).send(
      twiml(`
${say("C'è stato un problema tecnico. Riprova tra poco.")}
${hangup()}
      `)
    );
  }
});

// --------------------
// START SERVER
// --------------------
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`BASE_URL: ${BASE_URL || "(non impostato)"}`);
  console.log(`Calendar configured: ${Boolean(GOOGLE_SERVICE_ACCOUNT_JSON && GOOGLE_CALENDAR_ID)}`);
  console.log(`Twilio configured: ${Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN)}`);
  console.log(`Forwarding enabled: ${ENABLE_FORWARDING} | HUMAN_FORWARD_TO: ${HUMAN_FORWARD_TO || "(non impostato)"}`);
});
