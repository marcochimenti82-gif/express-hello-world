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
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM || ""; // es: whatsapp:+14155238886 (sandbox) oppure whatsapp:+<tuo_sender_approvato>

// Client Twilio (solo se hai settato le env)
let twilioClient = null;
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
  const twilio = require("twilio");
  twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

// --------------------
// Pagine base
// --------------------
app.get("/", (req, res) => {
  res.status(200).send("AI TuttiBrilli backend attivo");
});

app.get("/healthz", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Utile solo per test browser (Twilio usa POST)
app.get("/voice", (req, res) => {
  res.status(200).send("OK (Twilio usa POST su /voice)");
});

// --------------------
// Helpers TwiML
// --------------------
function twiml(xmlInsideResponseTag) {
  // xmlInsideResponseTag deve contenere solo i tag dentro <Response> ... </Response>
  return <?xml version="1.0" encoding="UTF-8"?>\n<Response>\n${xmlInsideResponseTag}\n</Response>;
}

function say(text) {
  // XML escape minimo
  const safe = String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return <Say language="it-IT" voice="alice">${safe}</Say>;
}

function gather({ action, method = "POST", input = "dtmf", numDigits, timeout = 8, finishOnKey = "#", prompt }) {
  const nd = numDigits ? ` numDigits="${numDigits}"` : "";
  const fok = numDigits ? "" : ` finishOnKey="${finishOnKey}"`; // se numDigits è definito, finishOnKey non serve
  return `
<Gather action="${action}" method="${method}" input="${input}" timeout="${timeout}"${nd}${fok}>
  ${say(prompt)}
</Gather>`;
}

function redirect(url) {
  return <Redirect method="POST">${url}</Redirect>;
}

function hangup() {
  return <Hangup/>;
}

// --------------------
// “Sessioni” in memoria (test). Poi la spostiamo su DB/Google Calendar.
// --------------------
const sessions = new Map(); // key: CallSid -> { step, name, date, time, people, whatsapp }

// Format utility
function ddmmaaToHuman(ddmmaa) {
  if (!ddmmaa || ddmmaa.length < 6) return ddmmaa || "";
  const dd = ddmmaa.slice(0, 2);
  const mm = ddmmaa.slice(2, 4);
  const aa = ddmmaa.slice(4, 6);
  return ${dd}/${mm}/20${aa};
}

function hhmmToHuman(hhmm) {
  if (!hhmm || hhmm.length < 4) return hhmm || "";
  return ${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)};
}

function normalizeWhatsapp(digits) {
  // ci aspettiamo input: 393xxxxxxxxx oppure 3xxxxxxxxx
  const raw = String(digits || "").replace(/[^\d]/g, "");
  if (!raw) return "";
  if (raw.startsWith("39")) return whatsapp:+${raw};
  // se l’utente inserisce senza prefisso, assumiamo IT
  if (raw.startsWith("3")) return whatsapp:+39${raw};
  // fallback: comunque + davanti
  return whatsapp:+${raw};
}

// --------------------
// TWILIO VOICE - START
// --------------------
app.post("/voice", (req, res) => {
  const callSid = req.body.CallSid || local-${Date.now()};

  sessions.set(callSid, { step: 1 });

  const action = ${BASE_URL}/voice/step;
  const body = twiml(`
${say("Ciao! Hai chiamato TuttiBrilli. Ti aiuto con la prenotazione.")}
${gather({
  action,
  numDigits: 1,
  timeout: 8,
  prompt: "Premi 1 per prenotare. Premi 2 per informazioni."
})}
${say("Non ho ricevuto risposta. Riproviamo.")}
${redirect(${BASE_URL}/voice)}
  `);

  res.type("text/xml").status(200).send(body);
});

// STEP HANDLER
app.post("/voice/step", async (req, res) => {
  const callSid = req.body.CallSid;
  const digits = (req.body.Digits || "").trim();

  const session = sessions.get(callSid) || { step: 1 };

  try {
    const action = ${BASE_URL}/voice/step;

    // STEP 1: scelta
    if (session.step === 1) {
      if (digits === "1") {
        session.step = 2;
        sessions.set(callSid, session);

        const body = twiml(`
${say("Perfetto. Iniziamo.")}
${gather({
  action,
  timeout: 10,
  finishOnKey: "#",
  prompt:
    "Inserisci il tuo nome e cognome usando i tasti del telefono, poi premi cancelletto. " +
    "Se non vuoi, premi subito cancelletto e andiamo avanti."
})}
${redirect(action)}
        `);

        return res.type("text/xml").status(200).send(body);
      }

      if (digits === "2") {
        const body = twiml(`
${say("Per informazioni puoi scriverci su WhatsApp. Grazie!")}
${hangup()}
        `);
        sessions.delete(callSid);
        return res.type("text/xml").status(200).send(body);
      }

      const body = twiml(`
${say("Scelta non valida.")}
${redirect(${BASE_URL}/voice)}
      `);
      return res.type("text/xml").status(200).send(body);
    }

    // STEP 2: nome (DTMF grezzo, ok per test)
    if (session.step === 2) {
      session.name = digits ? digits : "(nome da confermare)";
      session.step = 3;
      sessions.set(callSid, session);

      const body = twiml(`
${gather({
  action,
  numDigits: 6,
  timeout: 12,
  prompt:
    "Inserisci la data in formato G G M M A A. " +
    "Esempio: 2 5 1 2 2 5 per 25 dicembre 2025."
})}
${say("Non ho ricevuto la data.")}
${redirect(action)}
      `);

      return res.type("text/xml").status(200).send(body);
    }

    // STEP 3: data DDMMAA
    if (session.step === 3) {
      if (!digits || digits.length !== 6) {
        const body = twiml(`
${say("Formato data non valido.")}
${redirect(action)}
        `);
        return res.type("text/xml").status(200).send(body);
      }

      session.date = digits;
      session.step = 4;
      sessions.set(callSid, session);

      const body = twiml(`
${gather({
  action,
  numDigits: 4,
  timeout: 12,
  prompt:
    "Inserisci l'orario in formato O O M M. " +
    "Esempio: 2 0 3 0 per 20 e 30."
})}
${say("Non ho ricevuto l'orario.")}
${redirect(action)}
      `);

      return res.type("text/xml").status(200).send(body);
    }

    // STEP 4: ora HHMM
    if (session.step === 4) {
      if (!digits || digits.length !== 4) {
        const body = twiml(`
${say("Formato orario non valido.")}
${redirect(action)}
        `);
        return res.type("text/xml").status(200).send(body);
      }

      session.time = digits;
      session.step = 5;
      sessions.set(callSid, session);

      const body = twiml(`
${gather({
  action,
  numDigits: 2,
  timeout: 10,
  prompt: "Quante persone? Inserisci 1 o 2 cifre."
})}
${say("Non ho ricevuto il numero di persone.")}
${redirect(action)}
      `);

      return res.type("text/xml").status(200).send(body);
    }

    // STEP 5: persone
    if (session.step === 5) {
      if (!digits) {
        const body = twiml(`
${say("Numero di persone non valido.")}
${redirect(action)}
        `);
        return res.type("text/xml").status(200).send(body);
      }

      session.people = digits;
      session.step = 6;
      sessions.set(callSid, session);

      const body = twiml(`
${gather({
  action,
  timeout: 15,
  finishOnKey: "#",
  prompt:
    "Ora inserisci il tuo numero WhatsApp con prefisso. " +
    "Esempio: 3 9 3 ... Poi premi cancelletto."
})}
${say("Non ho ricevuto il numero WhatsApp.")}
${redirect(action)}
      `);

      return res.type("text/xml").status(200).send(body);
    }

    // STEP 6: whatsapp + invio WA
    if (session.step === 6) {
      const waTo = normalizeWhatsapp(digits);

      // Controlli minimi
      if (!waTo || waTo.length < 14) {
        const body = twiml(`
${say("Numero WhatsApp non valido. Riproviamo.")}
${redirect(action)}
        `);
        return res.type("text/xml").status(200).send(body);
      }

      session.whatsapp = waTo;
      session.step = 7;
      sessions.set(callSid, session);

      // Costruisci riepilogo
      const humanDate = ddmmaaToHuman(session.date);
      const humanTime = hhmmToHuman(session.time);

      const message =
`✅ Richiesta prenotazione ricevuta
Nome: ${session.name}
Data: ${humanDate}
Ora: ${humanTime}
Persone: ${session.people}

Rispondi a questo WhatsApp per confermare o modificare.`;

      // Invia WhatsApp (se configurato)
      if (!twilioClient) {
        console.error("Twilio client non configurato: mancano TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN");
      } else if (!TWILIO_WHATSAPP_FROM) {
        console.error("Manca TWILIO_WHATSAPP_FROM (es. whatsapp:+14155238886)");
      } else {
        await twilioClient.messages.create({
          from: TWILIO_WHATSAPP_FROM,
          to: waTo,
          body: message,
        });
      }

      const body = twiml(`
${say("Perfetto. Ti ho inviato un messaggio WhatsApp con il riepilogo. Grazie!")}
${hangup()}
      `);

      sessions.delete(callSid);
      return res.type("text/xml").status(200).send(body);
    }

    // fallback
    sessions.delete(callSid);
    const body = twiml(`
${say("Ripartiamo da capo.")}
${redirect(${BASE_URL}/voice)}
    `);
    return res.type("text/xml").status(200).send(body);
  } catch (err) {
    console.error("VOICE FLOW ERROR:", err);

    const body = twiml(`
${say("C'è stato un problema tecnico. Riprova tra poco.")}
${hangup()}
    `);

    sessions.delete(callSid);
    return res.type("text/xml").status(200).send(body);
  }
});

// --------------------
// START SERVER
// --------------------
app.listen(PORT, () => {
  console.log(Server running on port ${PORT});
  console.log(BASE_URL: ${BASE_URL || "(non impostato)"});
});
