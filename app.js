const express = require("express");
const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Root
app.get("/", (req, res) => {
  res.send("AI TuttiBrilli backend attivo");
});

// Health check
app.get("/healthz", (req, res) => {
  res.json({ status: "ok" });
});

// ✅ VOICE ENDPOINT PER TWILIO
app.post("/voice", (req, res) => {
  res.status(200).type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="it-IT" voice="alice">
    Ciao! Hai chiamato TuttiBrilli.
  </Say>
  <Pause length="1"/>
  <Say language="it-IT" voice="alice">
    Il sistema è attivo e funzionante.
  </Say>
</Response>`);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("Server running on port", port);
});
