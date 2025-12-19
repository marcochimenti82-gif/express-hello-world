const express = require("express");
const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Render port
const port = process.env.PORT || 3001;

// Memoria “sessione chiamata” (per demo). In produzione meglio Redis/DB.
const sessions = new Map();
function getSession(req) {
  const callSid = req.body.CallSid || "no-callsid";
  if (!sessions.has(callSid)) sessions.set(callSid, {});
  return sessions.get(callSid);
}

function twiml(res, xml) {
  res.type("text/xml").send(xml);
}

app.get("/", (req, res) => res.status(200).send("OK - TuttiBrilli server"));
app.get("/healthz", (req, res) => res.status(200).json({ status: "ok" }));

// 1) START
app.post("/voice", (req, res) => {
  const s = getSession(req);
  s.step = "date";

  twiml(res, `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="it-IT" voice="alice">
    Ciao! Sei in TuttiBrilli. Per fare una prenotazione, dimmi per che giorno.
    Per esempio: domani, venerdì, oppure 21 dicembre.
  </Say>
  <Gather input="speech dtmf" speechTimeout="auto" action="/voice/date" method="POST" language="it-IT" timeout="6">
    <Say language="it-IT" voice="alice">Parla ora, oppure premi un tasto per riprovare.</Say>
  </Gather>
  <Say language="it-IT" voice="alice">Non ho sentito. Riproviamo.</Say>
  <Redirect method="POST">/voice</Redirect>
</Response>`);
});

// 2) DATE
app.post("/voice/date", (req, res) => {
  const s = getSession(req);
  const spoken = (req.body.SpeechResult || "").trim();
  s.date_raw = spoken;

  twiml(res, `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="it-IT" voice="alice">
    Perfetto. Per che ora?
    Per esempio: 20 e 30, oppure 21.
  </Say>
  <Gather input="speech dtmf" speechTimeout="auto" action="/voice/time" method="POST" language="it-IT" timeout="6">
    <Say language="it-IT" voice="alice">Dimmi l'orario.</Say>
  </Gather>
  <Say language="it-IT" voice="alice">Non ho sentito. Riproviamo.</Say>
  <Redirect method="POST">/voice</Redirect>
</Response>`);
});

// 3) TIME
app.post("/voice/time", (req, res) => {
  const s = getSession(req);
  const spoken = (req.body.SpeechResult || "").trim();
  s.time_raw = spoken;

  twiml(res, `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="it-IT" voice="alice">
    Quante persone siete?
  </Say>
  <Gather input="speech dtmf" speechTimeout="auto" action="/voice/people" method="POST" language="it-IT" timeout="6">
    <Say language="it-IT" voice="alice">Dimmi il numero di persone.</Say>
  </Gather>
  <Say language="it-IT" voice="alice">Non ho sentito. Riproviamo.</Say>
  <Redirect method="POST">/voice</Redirect>
</Response>`);
});

// 4) PEOPLE
app.post("/voice/people", (req, res) => {
  const s = getSession(req);
  const spoken = (req.body.SpeechResult || "").trim();
  s.people_raw = spoken;

  twiml(res, `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="it-IT" voice="alice">
    Perfetto. Mi dici nome e cognome per la prenotazione?
  </Say>
  <Gather input="speech" speechTimeout="auto" action="/voice/name" method="POST" language="it-IT" timeout="7">
    <Say language="it-IT" voice="alice">Dimmi nome e cognome.</Say>
  </Gather>
  <Say language="it-IT" voice="alice">Non ho sentito. Riproviamo.</Say>
  <Redirect method="POST">/voice</Redirect>
</Response>`);
});

// 5) NAME + CONFIRM
app.post("/voice/name", (req, res) => {
  const s = getSession(req);
  const spoken = (req.body.SpeechResult || "").trim();
  s.name_raw = spoken;

  twiml(res, `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="it-IT" voice="alice">
    Riepilogo: prenotazione per ${escapeXml(s.name_raw || "cliente")}.
    Giorno: ${escapeXml(s.date_raw || "non indicato")}.
    Ora: ${escapeXml(s.time_raw || "non indicato")}.
    Persone: ${escapeXml(s.people_raw || "non indicato")}.
    Se va bene, premi 1 per confermare. Premi 2 per annullare.
  </Say>
  <Gather input="dtmf" numDigits="1" action="/voice/confirm" method="POST" timeout="8">
    <Say language="it-IT" voice="alice">Premi 1 per confermare, 2 per annullare.</Say>
  </Gather>
  <Say language="it-IT" voice="alice">Non ho ricevuto scelta. Ti saluto.</Say>
  <Hangup/>
</Response>`);
});

// 6) CONFIRM
app.post("/voice/confirm", (req, res) => {
  const s = getSession(req);
  const digit = (req.body.Digits || "").trim();

  if (digit === "1") {
    // QUI: in mezzo metteremo controllo disponibilità + creazione evento Google Calendar
    twiml(res, `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="it-IT" voice="alice">
    Perfetto, prenotazione confermata. A presto!
  </Say>
  <Hangup/>
</Response>`);
  } else {
    twiml(res, `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="it-IT" voice="alice">
    Va bene, prenotazione annullata. A presto!
  </Say>
  <Hangup/>
</Response>`);
  }
});

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

app.listen(port, () => console.log(Server listening on ${port}));
