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

// (OPZIONALE ma consigliato) per evitare problemi di JSON spezzato nelle ENV
// Metti qui il JSON del service account in Base64
const GOOGLE_SERVICE_ACCOUNT_JSON_B64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64 || "";
const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";

const GOOGLE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || ""; // es: ...@group.calendar.google.com
const DEFAULT_EVENT_DURATION_MINUTES = parseInt(process.env.DEFAULT_EVENT_DURATION_MINUTES || "120", 10);

// Inoltro chiamata a operatore (opzionale)
const ENABLE_FORWARDING = (process.env.ENABLE_FORWARDING || "false").toLowerCase() === "true";
const HUMAN_FORWARD_TO = process.env.HUMAN_FORWARD_TO || ""; // es: +39333...

// OpenAI key presente nel tuo progetto ma qui non è usata direttamente
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

// Lib
const twilio = require("twilio");
const { google } = require("googleapis");

// Clients
const twilioClient =
  TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN
    ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    : null;

// --------------------
// Google Calendar helpers
// --------------------
function getServiceAccountJsonRaw() {
  // preferisci B64 se presente
  if (GOOGLE_SERVICE_ACCOUNT_JSON_B64) {
    try {
      return Buffer.from(GOOGLE_SERVICE_ACCOUNT_JSON_B64, "base64").toString("utf8");
    } catch (e) {
      console.error("GOOGLE_SERVICE_ACCOUNT_JSON_B64 decode failed:", e?.message || e);
      return "";
    }
  }
  return GOOGLE_SERVICE_ACCOUNT_JSON;
}

function getCalendarClient() {
  if (!GOOGLE_CALENDAR_ID) {
    console.error("[CALENDAR] Missing GOOGLE_CALENDAR_ID");
    return null;
  }

  const raw = getServiceAccountJsonRaw();
  if (!raw) {
    console.error(
      "[CALENDAR] Missing service account JSON (GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_JSON_B64)"
    );
    return null;
  }

  let creds;
  try {
    creds = JSON.parse(raw);
  } catch (e) {
    console.error("[CALENDAR] Service account JSON parse failed:", e?.message || e);
    console.error("[CALENDAR] raw length:", raw.length);
    return null;
  }

  if (!creds?.client_email || !creds?.private_key) {
    console.error("[CALENDAR] Invalid service account JSON: missing client_email/private_key");
    return null;
  }

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
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${xmlInsideResponseTag}</Response>`;
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
  const safePrompt = xmlEscape(prompt || "");
  const safeHints = xmlEscape(hints || "");

  return `
<Gather input="speech" action="${safeAction}" method="${method}" timeout="${timeout}" speechTimeout="${speechTimeout}" language="${language}" hints="${safeHints}">
  <Say language="it-IT" voice="alice">${safePrompt}</Say>
</Gather>
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
 *  phone: string|null,
 * }
 */
const sessions = new Map();

function getSession(callSid) {
  if (!sessions.has(callSid)) {
    sessions.set(callSid, {
      step: 1,
      substep: null,
      retries: 0,
      intent: null,
      name: null,
      dateISO: null,
      time24: null,
      people: null,
      waTo: null,
      phone: null,
    });
  }
  return sessions.get(callSid);
}

function resetRetries(session) {
  session.retries = 0;
}

function incRetries(session) {
  session.retries = (session.retries || 0) + 1;
  return session.retries;
}

function normalizeText(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
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
  // MVP: accetta "oggi", "domani" o "YYYY-MM-DD" o "27 dicembre" etc.
  const t = normalizeText(speech);

  const today = nowLocal();
  if (t.includes("oggi")) return toISODate(today);
  if (t.includes("domani")) {
    const d = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    return toISODate(d);
  }

  // match YYYY-MM-DD
  const iso = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // match dd/mm/yyyy
  const dmY = t.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmY) {
    const dd = String(dmY[1]).padStart(2, "0");
    const mm = String(dmY[2]).padStart(2, "0");
    const yyyy = dmY[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  return null;
}

function parseTimeIT_MVP(speech) {
  // MVP: accetta "20 30", "20:30", "alle 8 e mezza"
  const t = normalizeText(speech);

  const hm = t.match(/(\d{1,2})[:\s](\d{2})/);
  if (hm) {
    const hh = String(hm[1]).padStart(2, "0");
    const mm = String(hm[2]).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  const onlyH = t.match(/\b(\d{1,2})\b/);
  if (onlyH) {
    const hh = String(onlyH[1]).padStart(2, "0");
    return `${hh}:00`;
  }

  return null;
}

function parsePeopleIT_MVP(speech) {
  const t = normalizeText(speech);
  const m = t.match(/\b(\d{1,2})\b/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function hasValidWaAddress(s) {
  return /^whatsapp:\+\d{8,15}$/.test(String(s || "").trim());
}

function isValidPhoneE164(s) {
  return /^\+\d{8,15}$/.test(String(s || "").trim());
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function canForwardToHuman() {
  return ENABLE_FORWARDING && Boolean(HUMAN_FORWARD_TO) && isValidPhoneE164(HUMAN_FORWARD_TO);
}

function forwardToHumanTwiml() {
  return `
  ${say("Ti metto in contatto con un operatore.")}
  <Dial>${xmlEscape(HUMAN_FORWARD_TO)}</Dial>
  `;
}

// --------------------
// Google Calendar booking
// --------------------
async function createBookingEvent({
  callSid,
  name,
  dateISO,
  time24,
  people,
  phone,
  waTo,

  // accettiamo anche i nomi del debug endpoint
  timeHHMM,
  partySize,
  notes, // opzionale
}) {
  // ============================
  // NORMALIZZAZIONE INPUT + GUARDRAILS
  // ============================
  if (people == null && partySize != null) people = partySize;
  if (!time24 && timeHHMM) time24 = timeHHMM;

  if (!name) throw new Error("createBookingEvent: name mancante");
  if (!dateISO || !/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) {
    throw new Error(`createBookingEvent: dateISO non valido: ${dateISO}`);
  }
  if (!time24 || !/^\d{2}:\d{2}$/.test(time24)) {
    throw new Error(`createBookingEvent: time24 non valido: ${time24}`);
  }

  const peopleNum = Number(people);
  if (!Number.isFinite(peopleNum) || peopleNum <= 0) {
    throw new Error(`createBookingEvent: people non valido: ${people}`);
  }

  const calendar = getCalendarClient();
  if (!calendar) {
    throw new Error("Google Calendar non configurato (manca JSON/JSON_B64 o CALENDAR_ID).");
  }

  const privateKey = `callsid:${callSid || "no-callsid"}`;

  // ============================
  // IDEMPOTENZA: evita doppioni su retry Twilio
  // ============================
  const existing = await calendar.events.list({
    calendarId: GOOGLE_CALENDAR_ID,
    q: privateKey,
    timeMin: `${dateISO}T00:00:00Z`,
    timeMax: `${dateISO}T23:59:59Z`,
    singleEvents: true,
    maxResults: 10,
  });

  const found = (existing.data.items || []).find((ev) =>
    String(ev.description || "").includes(privateKey)
  );

  if (found) {
    return { eventId: found.id, htmlLink: found.htmlLink, reused: true };
  }

  // ============================
  // START/END RFC3339 ROBUSTI (anti 400)
  // ============================
  const tz = process.env.GOOGLE_CALENDAR_TZ || "Europe/Rome";

  // NOTA: aggiungiamo "Z" per evitare ambiguità timezone sul server (Render)
  const start = new Date(`${dateISO}T${time24}:00Z`);
  if (Number.isNaN(start.getTime())) {
    throw new Error(`createBookingEvent: start invalido: ${dateISO} ${time24}`);
  }

  const end = addMinutes(start, DEFAULT_EVENT_DURATION_MINUTES);
  if (Number.isNaN(end.getTime())) {
    throw new Error(`createBookingEvent: end invalido da start: ${start.toISOString()}`);
  }

  const requestBody = {
    summary: `TuttiBrilli - ${name} - ${peopleNum} pax`,
    description: [
      "Prenotazione",
      `Nome: ${name}`,
      `Persone: ${peopleNum}`,
      `Telefono: ${phone || "-"}`,
      `WhatsApp: ${waTo || "-"}`,
      notes ? `Note: ${notes}` : null,
      privateKey,
    ]
      .filter(Boolean)
      .join("\n"),
    start: { dateTime: start.toISOString(), timeZone: tz },
    end: { dateTime: end.toISOString(), timeZone: tz },
  };

  console.log("[CALENDAR] requestBody:", JSON.stringify(requestBody, null, 2));

  try {
    const resp = await calendar.events.insert({
      calendarId: GOOGLE_CALENDAR_ID,
      requestBody,
    });

    return { eventId: resp.data.id, htmlLink: resp.data.htmlLink, reused: false };
  } catch (err) {
    console.error("[CALENDAR] insert failed", {
      status: err?.code || err?.response?.status,
      message: err?.message,
      data: err?.response?.data,
    });
    throw err;
  }
}

// --------------------
// Twilio Voice - START
// --------------------
app.post("/voice", async (req, res) => {
  const respond = (xml) => res.type("text/xml").status(200).send(twiml(xml));

  try {
    const callSid = req.body.CallSid || `local-${Date.now()}`;
    const from = req.body.From || ""; // caller id (può essere forwarder)

    const session = getSession(callSid);

    // Twilio speech input
    const speech = req.body.SpeechResult || "";
    const step = session.step || 1;

    // STEP 1: greeting + ask name
    if (step === 1) {
      session.step = 2;
      sessions.set(callSid, session);

      return respond(`
${say("Ciao! Sono l'assistente di TuttiBrilli Enoteca. Per prenotare, dimmi il tuo nome e cognome.")}
${gatherSpeech({ action: `${BASE_URL}/voice`, prompt: "Dimmi nome e cognome." })}
${say("Non ho sentito nulla. Riprova.")}
${redirect(`${BASE_URL}/voice`)}
`);
    }

    // STEP 2: collect name
    if (step === 2) {
      if (!speech) {
        incRetries(session);
        if (session.retries >= 2) {
          sessions.delete(callSid);
          return respond(`${say("Non riesco a sentirti bene. Riprova più tardi.")}${hangup()}`);
        }
        sessions.set(callSid, session);
        return respond(`
${say("Non ho capito. Dimmi nome e cognome.")}
${gatherSpeech({ action: `${BASE_URL}/voice`, prompt: "Dimmi nome e cognome." })}
`);
      }

      session.name = speech.trim();
      session.step = 3;
      resetRetries(session);
      sessions.set(callSid, session);

      return respond(`
${say(`Perfetto ${session.name}. Per quale giorno vuoi prenotare? Puoi dire oggi, domani, oppure una data.`)}
${gatherSpeech({ action: `${BASE_URL}/voice`, prompt: "Dimmi la data della prenotazione." })}
`);
    }

    // STEP 3: date
    if (step === 3) {
      const dateISO = parseDateIT_MVP(speech);
      if (!dateISO) {
        incRetries(session);
        if (session.retries >= 2) {
          sessions.delete(callSid);
          return respond(`${say("Non sono riuscito a capire la data. Riprova più tardi.")}${hangup()}`);
        }
        sessions.set(callSid, session);
        return respond(`
${say("Non ho capito la data. Puoi dire per esempio: domani, oppure 27 12 2025.")}
${gatherSpeech({ action: `${BASE_URL}/voice`, prompt: "Dimmi la data." })}
`);
      }

      session.dateISO = dateISO;
      session.step = 4;
      resetRetries(session);
      sessions.set(callSid, session);

      return respond(`
${say("A che ora? Dimmi un orario, per esempio venti e trenta.")}
${gatherSpeech({ action: `${BASE_URL}/voice`, prompt: "Dimmi l'orario." })}
`);
    }

    // STEP 4: time
    if (step === 4) {
      const time24 = parseTimeIT_MVP(speech);
      if (!time24) {
        incRetries(session);
        if (session.retries >= 2) {
          sessions.delete(callSid);
          return respond(`${say("Non sono riuscito a capire l'orario. Riprova più tardi.")}${hangup()}`);
        }
        sessions.set(callSid, session);
        return respond(`
${say("Non ho capito l'orario. Puoi dire per esempio: venti e trenta.")}
${gatherSpeech({ action: `${BASE_URL}/voice`, prompt: "Dimmi l'orario." })}
`);
      }

      session.time24 = time24;
      session.step = 5;
      resetRetries(session);
      sessions.set(callSid, session);

      return respond(`
${say("Per quante persone?")}
${gatherSpeech({ action: `${BASE_URL}/voice`, prompt: "Dimmi il numero di persone." })}
`);
    }

    // STEP 5: people
    if (step === 5) {
      const ppl = parsePeopleIT_MVP(speech);
      if (!ppl) {
        incRetries(session);
        if (session.retries >= 2) {
          sessions.delete(callSid);
          return respond(`${say("Non sono riuscito a capire il numero di persone. Riprova più tardi.")}${hangup()}`);
        }
        sessions.set(callSid, session);
        return respond(`
${say("Non ho capito. Dimmi il numero di persone, per esempio due o quattro.")}
${gatherSpeech({ action: `${BASE_URL}/voice`, prompt: "Dimmi il numero di persone." })}
`);
      }

      session.people = ppl;
      session.step = 6;
      resetRetries(session);
      sessions.set(callSid, session);

      return respond(`
${say("Perfetto. Dimmi il tuo numero di telefono, così possiamo confermare su WhatsApp.")}
${gatherSpeech({ action: `${BASE_URL}/voice`, prompt: "Dimmi il numero di telefono." })}
`);
    }

    // STEP 6: phone / whatsapp
    if (step === 6) {
      // MVP: estrai un numero tipo +39...
      let phone = String(speech || "").replace(/[^\d+]/g, "");
      if (phone && !phone.startsWith("+")) {
        // se l'utente dice 331..., aggiungi +39 (italia)
        if (phone.length >= 9 && phone.length <= 11) phone = `+39${phone}`;
      }

      if (!isValidPhoneE164(phone)) {
        incRetries(session);
        if (session.retries >= 2) {
          sessions.delete(callSid);
          return respond(`${say("Non sono riuscito a capire il numero. Riprova più tardi.")}${hangup()}`);
        }
        sessions.set(callSid, session);
        return respond(`
${say("Non ho capito il numero. Puoi dirlo lentamente, oppure includere il prefisso, per esempio più trentanove...")}
${gatherSpeech({ action: `${BASE_URL}/voice`, prompt: "Dimmi il numero di telefono." })}
`);
      }

      session.phone = phone;
      session.waTo = `whatsapp:${phone}`;
      session.step = 7;
      resetRetries(session);
      sessions.set(callSid, session);

      return respond(`
${say("Perfetto. Sto registrando la prenotazione.")}
${pause(1)}
${redirect(`${BASE_URL}/voice`)}
`);
    }

    // STEP 7: crea evento su Calendar + invia WhatsApp (SOLO SE CALENDAR OK)
    if (session.step === 7) {
      // 1) Google Calendar (DEVE andare a buon fine)
      let calendarResult = null;

      try {
        calendarResult = await createBookingEvent({
          callSid,
          name: session.name,
          dateISO: session.dateISO,
          time24: session.time24,
          people: session.people,
          phone: session.phone,
          waTo: session.waTo,
        });
      } catch (e) {
        console.error("[VOICE] createBookingEvent failed:", {
          message: e?.message,
          status: e?.code || e?.response?.status,
          data: e?.response?.data,
        });

        sessions.delete(callSid);
        return respond(`
${say("Ho avuto un problema tecnico nel registrare la prenotazione in calendario. Riprova tra poco oppure scrivici su WhatsApp.")}
${hangup()}
        `);
      }

      if (!calendarResult) {
        console.error("Google Calendar insert failed: calendarResult is null/undefined");

        sessions.delete(callSid);
        return respond(`
${say("Non sono riuscito a registrare la prenotazione in calendario. Riprova tra poco oppure scrivici su WhatsApp.")}
${hangup()}
        `);
      }

      // 2) WhatsApp (SOLO DOPO Calendar OK)
      try {
        const waTo = session.waTo;
        const waBody = `Ciao ${session.name}! Prenotazione registrata ✅\nData: ${session.dateISO}\nOra: ${session.time24}\nPersone: ${session.people}\nA presto da TuttiBrilli!`;

        if (!twilioClient) {
          console.error("Twilio client non configurato: manca TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN");
        } else if (!TWILIO_WHATSAPP_FROM) {
          console.error("TWILIO_WHATSAPP_FROM non valido/mancante:", TWILIO_WHATSAPP_FROM);
        } else if (!waTo || !hasValidWaAddress(waTo)) {
          console.error("waTo non valido:", waTo);
        } else {
          await twilioClient.messages.create({
            from: TWILIO_WHATSAPP_FROM,
            to: waTo,
            body: waBody,
          });
        }
      } catch (e) {
        console.error("WhatsApp send failed:", e);
        // Non blocchiamo: evento già creato
      }

      sessions.delete(callSid);
      return respond(`
${say("Perfetto! Ho registrato la prenotazione e ti ho inviato un WhatsApp di conferma. A presto da TuttiBrilli!")}
${hangup()}
      `);
    }

    // fallback
    sessions.delete(callSid);
    return respond(`
${say("Ripartiamo da capo.")}
${redirect(`${BASE_URL}/voice`)}
`);

  } catch (err) {
    console.error("VOICE FLOW ERROR:", err);

    if (canForwardToHuman()) {
      return res.type("text/xml").status(200).send(twiml(forwardToHumanTwiml()));
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
// DEBUG CALENDAR TEST
// --------------------
app.get("/debug/calendar-test", async (req, res) => {
  try {
    console.log("[DEBUG] calendar-test called");

    const dateISO = String(req.query.dateISO || new Date().toISOString().slice(0, 10));
    const timeHHMM = String(req.query.timeHHMM || "20:30");

    const result = await createBookingEvent({
      callSid: "DEBUG-CALLSID",
      name: "TEST TuttiBrilli",
      phone: "+391234567890",
      dateISO,
      timeHHMM,     // verrà mappato su time24
      partySize: 2, // verrà mappato su people
      waTo: "whatsapp:+391234567890",
      notes: "Evento di test creato da /debug/calendar-test",
    });

    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error("[DEBUG] calendar-test error:", {
      message: err?.message,
      status: err?.code || err?.response?.status,
      data: err?.response?.data,
    });

    return res.status(500).json({
      ok: false,
      message: err?.message,
      status: err?.code || err?.response?.status,
      data: err?.response?.data,
    });
  }
});

// --------------------
// START SERVER
// --------------------
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`BASE_URL: ${BASE_URL || "(non impostato)"}`);

  const raw = getServiceAccountJsonRaw();
  console.log(`Calendar configured: ${Boolean(raw && GOOGLE_CALENDAR_ID)}`);
  console.log(`Twilio configured: ${Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN)}`);

  console.log(
    `Forwarding enabled: ${ENABLE_FORWARDING} | HUMAN_FORWARD_TO: ${HUMAN_FORWARD_TO || "(non impostato)"}`
  );

  if (raw && !GOOGLE_SERVICE_ACCOUNT_JSON_B64) {
    console.log(`GOOGLE_SERVICE_ACCOUNT_JSON length: ${(GOOGLE_SERVICE_ACCOUNT_JSON || "").length}`);
  }
  if (GOOGLE_SERVICE_ACCOUNT_JSON_B64) {
    console.log(`GOOGLE_SERVICE_ACCOUNT_JSON_B64 length: ${GOOGLE_SERVICE_ACCOUNT_JSON_B64.length}`);
  }
});
