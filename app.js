const express = require("express");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Home
app.get("/", (req, res) => {
  res.status(200).send("OK - TuttiBrilli server");
});

// Health check
app.get("/healthz", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// (Facoltativo) per test dal browser: ti fa vedere un messaggio se apri /voice
app.get("/voice", (req, res) => {
  res
    .status(200)
    .send("Questo endpoint /voice è per Twilio e va chiamato in POST.");
});

// Endpoint Twilio VOICE (POST)
app.post("/voice", (req, res) => {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="it-IT" voice="alice">
    Ciao! Il sistema TuttiBrilli è attivo e funzionante.
  </Say>
</Response>`;

  res.type("text/xml").send(twiml);
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(Server running on port ${port});
});
