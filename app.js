// app.js — TuttiBrilli backend (Render + Twilio)
// Copia e incolla TUTTO questo file in app.js

const express = require("express");
const app = express();

// Twilio invia i webhook come application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

/* =========================
   Helpers: TwiML safe
========================= */

// Escape minimo per testo dentro XML (evita rotture se ci sono caratteri speciali)
function xmlEscape(input) {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Wrapper TwiML: IMPORTANTISSIMO usare backtick
function twiml(inner) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
${inner}
</Response>`;
}

function say(text) {
  return <Say language="it-IT" voice="alice">${xmlEscape(text)}</Say>;
}

function pause(seconds = 1) {
  const s = Number(seconds);
  const safe = Number.isFinite(s) && s >= 0 ? s : 1;
  return <Pause length="${safe}"/>;
}

function message(text) {
  return <Message>${xmlEscape(text)}</Message>;
}

/* =========================
   Endpoints base (browser)
========================= */

app.get("/", (req, res) => {
  // Pagina semplice per vedere che il server è su
  res
    .status(200)
    .send("AI TuttiBrilli backend attivo ✅ (usa /healthz, /voice, /whatsapp)");
});

app.get("/healthz", (req, res) => {
  res.status(200).json({ status: "ok" });
});

/* =========================
   Twilio VOICE (Webhook)
   Configura Twilio: METHOD = POST
   URL: https://ai-backoffice-tuttibrilli.onrender.com/voice
========================= */

app.post("/voice", (req, res) => {
  // Twilio manda parametri tipo: From, To, CallSid ecc.
  const from = req.body.From || "sconosciuto";

  // Risposta TwiML
  const xml = twiml(`
${say("Ciao! Hai chiamato TuttiBrilli.")}
${pause(1)}
${say("Il sistema è attivo e funzionante.")}
${pause(1)}
${say("Questo è un test. Tra poco attiveremo la presa prenotazioni.")}
${pause(1)}
${say("Numero chiamante: " + from)}
  `);

  res.type("text/xml").status(200).send(xml);
});

/* =========================
   Twilio WhatsApp (Webhook)
   Configura Twilio (Sandbox o numero WA):
   METHOD = POST
   URL: https://ai-backoffice-tuttibrilli.onrender.com/whatsapp
========================= */

app.post("/whatsapp", (req, res) => {
  const incomingMsg = req.body.Body || "";
  const from = req.body.From || "sconosciuto";

  const reply = `Ciao! ✅ Messaggio ricevuto da ${from}.
Hai scritto: "${incomingMsg}"
Questo è un test WhatsApp.`;

  const xml = twiml(`
${message(reply)}
  `);

  res.type("text/xml").status(200).send(xml);
});

/* =========================
   Avvio server (Render)
========================= */

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(Server running on port ${port});
});
