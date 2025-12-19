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

// Memoria temporanea per chiamata (demo)
const sessions = new Map();
function getSession(req) {
  const callSid = req.body.CallSid || "no-callsid";
  if (!sessions.has(callSid)) sessions.set(callSid, {});
  return sessions.get(callSid);
}
function twiml(res, xml) {
  res.status(200).type("text/xml").send(xml);
}
function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// 1) START
app.post("/voice", (req, res) => {
  const s = getSession(req);
  s.step = "date";

  twiml(res, `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="it-IT" voice="alice">
    Ciao! Sei in TuttiBrilli. Per prenotare, dimmi per che giorno.
    Per esempio: domani, venerdì, oppure 21 dicembre.
  </Say>
  <Gather input="speech" speechTimeout="auto" action="/voice/date" method="POST" language="it-IT" timeout="7"/>
  <Say language="it-IT" voice="alice">Non ho sentito. Riproviamo.</Say>
  <Redirect method="POST">/voice</Redirect>
</Response>`);
});

// 2) DATE
app.post("/voice/date", (req, res) => {
  const s = getSession(req);
  s.date_raw = (req.body.SpeechResult || "").trim();

  twiml(res, `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="it-IT" voice="alice">
    Perfetto. A che ora?
    Per esempio: 20 e 30, oppure 21.
  </Say>
  <Gather input="speech" speechTimeout="auto" action="/voice/time" method="POST" language="it-IT" timeout="7"/>
  <Redirect method="POST">/voice</Redirect>
</Response>`);
});

// 3) TIME
app.post("/voice/time", (req, res) => {
  const s = getSession(req);
  s.time_raw = (req.body.SpeechResult || "").trim();

  twiml(res, `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="it-IT" voice="alice">Quante persone siete?</Say>
  <Gather input="speech" speechTimeout="auto" action="/voice/people" method="POST" language="it-IT" timeout="7"/>
  <Redirect method="POST">/voice</Redirect>
</Response>`);
});

// 4) PEOPLE
app.post("/voice/people", (req, res) => {
  const s = getSession(req);
  s.people_raw = (req.body.SpeechResult || "").trim();

  twiml(res, `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="it-IT" voice="alice">Perfetto. Mi dici nome e cognome?</Say>
  <Gather input="speech" speechTimeout="auto" action="/voice/name" method="POST" language="it-IT" timeout="8"/>
  <Redirect method="POST">/voice</Redirect>
</Response>`);
});

// 5) NAME + CONFIRM
app.post("/voice/name", (req, res) => {
  const s = getSession(req);
  s.name_raw = (req.body.SpeechResult || "").trim();

  twiml(res, `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="it-IT" voice="alice">
    Riepilogo prenotazione.
    Nome: ${esc(s.name_raw)}.
    Giorno: ${esc(s.date_raw)}.
    Ora: ${esc(s.time_raw)}.
    Persone: ${esc(s.people_raw)}.
    Se va bene, premi 1 per confermare. Premi 2 per annullare.
  </Say>
  <Gather input="dtmf" numDigits="1" action="/voice/confirm" method="POST" timeout="8"/>
  <Hangup/>
</Response>`);
});

// 6) CONFIRM
app.post("/voice/confirm", (req, res) => {
  const s = getSession(req);
  const d = (req.body.Digits || "").trim();

  if (d === "1") {
    // QUI aggiungeremo Google Calendar
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
  <Say language="it-IT" voice="alice">Va bene, annullato. A presto!</Say>
  <Hangup/>
</Response>`);
  }
});
app.listen(port, () => console.log(Server listening on ${port}));
