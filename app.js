const express = require("express");
const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const port = process.env.PORT || 3000;

/**
 * ROOT
 */
app.get("/", (req, res) => {
  res.send("AI Backoffice TuttiBrilli attivo");
});

/**
 * HEALTH CHECK
 */
app.get("/healthz", (req, res) => {
  res.status(200).json({ status: "ok" });
});

/**
 * TWILIO VOICE
 */
app.post("/twilio/voice", (req, res) => {
  res.type("text/xml");
  res.send(`
    <Response>
      <Say voice="alice" language="it-IT">
        Benvenuto da Tutti Brilli. A breve parlerai con il nostro assistente.
      </Say>
    </Response>
  `);
});

/**
 * TWILIO SMS / WHATSAPP
 */
app.post("/twilio/sms", (req, res) => {
  const message = req.body.Body || "";

  res.type("text/xml");
  res.send(`
    <Response>
      <Message>
        Ciao! Hai scritto: "${message}"
        Dimmi giorno e numero di persone 🙂
      </Message>
    </Response>
  `);
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
