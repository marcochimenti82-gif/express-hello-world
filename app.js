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
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM || ""; // es: whatsapp:+14155238886 (sandbox) oppure whatsapp:+<sender>

// Client Twilio
let twilioClient = null;
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
  const twilio = require("twilio");
  twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
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

// Se vuoi provare voci diverse (se disponibili sul tuo account):
// - voice="alice" (standard)
// - voice="Polly.Bianca" / "Polly.Bianca-Neural" (se abilitato)
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

/**
 * Gather speech-only.
 * - timeout: secondi di attesa prima di "no input"
 * - speechTimeout: "auto" o numero (sec) di silenzio per chiudere
 * - hints: parole chiave (non obbligatorio)
 */
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

// --------------------
// Sessioni in memoria (MVP). In produzione: Redis/DB.
// --------------------
/**
 * session schema:
 * {
 *  step: number,
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
  const fresh = { step: 1, retries: 0, intent: null, name: null, dateISO: null, time24: null, people: null, waTo: null, fromCaller: null };
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

function nowRome() {
  // Manteniamo semplice: usa timezone server. Per robustezza futura: luxon.
  return new Date();
}

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateIT_MVP(speech) {
  // Supporta: "oggi", "stasera" -> oggi; "domani" -> domani
  // Supporta: "25/12/2025", "25-12-2025", "25/12", "2512", "25 12"
  // Se manca anno -> anno corrente
  const t = normalizeText(speech);
  if (!t) return null;

  const now = nowRome();

  if (/\b(oggi|stasera)\b/.test(t)) return toISODate(now);
  if (/\bdomani\b/.test(t)) {
    const d = new Date(now.getTime());
    d.setDate(d.getDate() + 1);
    return toISODate(d);
  }

  // Estrai numeri
  // formati tipo 25/12/2025 o 25-12-2025
  let m = t.match(/\b(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?\b/);
  if (m) {
    let dd = parseInt(m[1], 10);
    let mm = parseInt(m[2], 10);
    let yy = m[3] ? parseInt(m[3], 10) : now.getFullYear();
    if (yy < 100) yy = 2000 + yy;

    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      const d = new Date(yy, mm - 1, dd);
      // Validazione semplice (evita 31/02)
      if (d.getFullYear() === yy && d.getMonth() === mm - 1 && d.getDate() === dd) return toISODate(d);
    }
    return null;
  }

  // formati "2512" o "25 12" (senza anno)
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
  // Supporta: "20:30", "20 e 30", "20 30", "2030", "alle 20", "ore 20"
  const t = normalizeText(speech);
  if (!t) return null;

  // 20:30
  let m = t.match(/\b(\d{1,2})[:\.](\d{2})\b/);
  if (m) {
    const hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    }
    return null;
  }

  // "20 e 30"
  m = t.match(/\b(\d{1,2})\s*(?:e|e\s+le)?\s*(\d{1,2})\b/);
  if (m) {
    const hh = parseInt(m[1], 10);
    let mm = parseInt(m[2], 10);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    }
  }

  // digits "2030" oppure "830" (rischioso) -> gestiamo solo 3-4 cifre
  const digits = t.replace(/[^\d]/g, "");
  if (digits.length === 4) {
    const hh = parseInt(digits.slice(0, 2), 10);
    const mm = parseInt(digits.slice(2, 4), 10);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    }
  }

  // "alle 20" -> 20:00
  m = t.match(/\b(\d{1,2})\b/);
  if (m) {
    const hh = parseInt(m[1], 10);
    if (hh >= 0 && hh <= 23) return `${String(hh).padStart(2, "0")}:00`;
  }

  return null;
}

function parsePeopleIT_MVP(speech) {
  // Cerca un numero nel testo (es. "siamo in quattro" -> 4 se dice "4")
  // MVP: estrae cifre. (Estendibile con mapping "due, tre, quattro")
  const t = normalizeText(speech);
  if (!t) return null;

  const m = t.match(/\b(\d{1,2})\b/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 20) return n;
  }

  // mapping minimo parole
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
    dieci: 10
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
  // Per voce: spesso arriva "tre nove tre ..." ma Twilio restituisce testo.
  // MVP: estraiamo tutte le cifre dal testo.
  const raw = String(speechOrDigits || "").replace(/[^\d]/g, "");
  if (!raw) return "";
  if (raw.startsWith("39")) return `whatsapp:+${raw}`;
  if (raw.startsWith("3")) return `whatsapp:+39${raw}`;
  if (raw.startsWith("0")) return ""; // numeri fissi/ambigui: richiedi di ripetere con +39
  return `whatsapp:+${raw}`;
}

function isLikelyItalianMobileE164(e164) {
  // +39 + 3xxxxxxxxx (approssimazione)
  return /^\+39\d{9,12}$/.test(e164 || "");
}

function hasValidWaAddress(wa) {
  return /^whatsapp:\+\d{8,15}$/.test(wa || "");
}

// --------------------
// TWILIO VOICE - START
// --------------------
app.post("/voice", (req, res) => {
  const callSid = req.body.CallSid || `local-${Date.now()}`;
  const from = req.body.From || ""; // caller id (può essere il numero del forwarder)
  const session = getSession(callSid);

  session.step = 1;
  session.intent = null;
  session.name = null;
  session.dateISO = null;
  session.time24 = null;
  session.people = null;
  session.waTo = null;
  session.fromCaller = from;
  resetRetries(session);
  sessions.set(callSid, session);

  const action = `${BASE_URL}/voice/step`;

  const body = twiml(`
${say("Ciao! Hai chiamato TuttiBrilli Enoteca.")}
${pause(1)}
${gatherSpeech({
  action,
  prompt: "Vuoi prenotare un tavolo, oppure ti servono informazioni?",
  hints: "prenotare, prenotazione, tavolo, posti, informazioni, orari, indirizzo",
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

  function failOrRetry({ prompt1, prompt2, exitPrompt }) {
    const n = incRetry(session);

    if (n === 1) {
      return respond(`
${gatherSpeech({ action, prompt: prompt1 })}
${redirect(action)}
      `);
    }
    if (n === 2) {
      return respond(`
${gatherSpeech({ action, prompt: prompt2 })}
${redirect(action)}
      `);
    }

    // 3°: uscita soft
    sessions.delete(callSid);
    return respond(`
${say(exitPrompt)}
${hangup()}
    `);
  }

  try {
    // Se Twilio non ha captato niente (no speech)
    if (!speech) {
      // Retry generico basato sullo step
      if (session.step === 1) {
        return failOrRetry({
          prompt1: "Dimmi pure: vuoi prenotare o informazioni?",
          prompt2: "Puoi dire, per esempio: 'voglio prenotare un tavolo'.",
          exitPrompt: "Non riesco a sentirti bene. Se vuoi, scrivici su WhatsApp. A presto!",
        });
      }
      if (session.step === 2) {
        return failOrRetry({
          prompt1: "Come ti chiami?",
          prompt2: "Dimmi il tuo nome, ad esempio: 'Mario Rossi'.",
          exitPrompt: "Perfetto, ci sentiamo più tardi. Se vuoi, scrivici su WhatsApp. A presto!",
        });
      }
      if (session.step === 3) {
        return failOrRetry({
          prompt1: "Per che giorno vuoi prenotare?",
          prompt2: "Puoi dire 'domani' oppure '25 12'.",
          exitPrompt: "Non riesco a prendere la data. Scrivici su WhatsApp e ti aiutiamo subito. A presto!",
        });
      }
      if (session.step === 4) {
        return failOrRetry({
          prompt1: "A che ora preferisci?",
          prompt2: "Puoi dire '20 e 30' oppure '21'.",
          exitPrompt: "Non riesco a prendere l'orario. Scrivici su WhatsApp e ti aiutiamo subito. A presto!",
        });
      }
      if (session.step === 5) {
        return failOrRetry({
          prompt1: "Per quante persone?",
          prompt2: "Dimmi un numero, ad esempio 'quattro'.",
          exitPrompt: "Ok. Scrivici su WhatsApp con numero persone e orario. A presto!",
        });
      }
      if (session.step === 6) {
        return failOrRetry({
          prompt1: "A che numero WhatsApp vuoi ricevere la conferma? Dimmi il numero iniziando con più trentanove.",
          prompt2: "Ripetilo lentamente, ad esempio: più trentanove, tre tre tre...",
          exitPrompt: "Ok. Scrivici tu su WhatsApp e ti confermiamo lì. A presto!",
        });
      }
    }

    // Confidence molto bassa: trattiamo come “non capito”
    if (!Number.isNaN(confidence) && confidence > 0 && confidence < 0.35) {
      // Non blocchiamo sempre, ma preferiamo ripetere
      // (non facciamo overfitting: Twilio confidence non è sempre affidabile)
    }

    // ----------------
    // STEP 1: Intento
    // ----------------
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
${say("Certo. Per informazioni rapide, scrivici su WhatsApp. Se invece vuoi prenotare, dimmelo e ti aiuto subito.")}
${hangup()}
        `);
      }

      return failOrRetry({
        prompt1: "Scusami, vuoi prenotare un tavolo o informazioni?",
        prompt2: "Puoi dire: 'prenotare un tavolo' oppure 'informazioni'.",
        exitPrompt: "Va bene. Scrivici su WhatsApp e ti rispondiamo appena possibile. A presto!",
      });
    }

    // ----------------
    // STEP 2: Nome
    // ----------------
    if (session.step === 2) {
      session.name = speechRaw || speech || "(nome da confermare)";
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

    // ----------------
    // STEP 3: Data
    // ----------------
    if (session.step === 3) {
      const dateISO = parseDateIT_MVP(speech);
      if (!dateISO) {
        return failOrRetry({
          prompt1: "Non sono sicuro di aver capito la data. Per che giorno vuoi prenotare?",
          prompt2: "Puoi dire 'domani' oppure '25 12'.",
          exitPrompt: "Ok. Scrivici su WhatsApp con giorno e ora e ti confermiamo. A presto!",
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

    // ----------------
    // STEP 4: Orario
    // ----------------
    if (session.step === 4) {
      const time24 = parseTimeIT_MVP(speech);
      if (!time24) {
        return failOrRetry({
          prompt1: "Non sono sicuro di aver capito l'orario. A che ora preferisci?",
          prompt2: "Puoi dire '20 e 30' oppure '21'.",
          exitPrompt: "Ok. Scrivici su WhatsApp con giorno e ora e ti confermiamo. A presto!",
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

    // ----------------
    // STEP 5: Persone
    // ----------------
    if (session.step === 5) {
      const people = parsePeopleIT_MVP(speech);
      if (!people) {
        return failOrRetry({
          prompt1: "Quante persone sarete?",
          prompt2: "Dimmi un numero, ad esempio 'quattro'.",
          exitPrompt: "Ok. Scrivici su WhatsApp con numero persone e orario. A presto!",
        });
      }

      session.people = people;

      // STEP 6: WhatsApp (consenso/numero)
      session.step = 6;
      resetRetries(session);

      // Se From è un +39 mobile plausibile, chiediamo consenso e usiamo quello.
      const from = String(session.fromCaller || "");
      const fromE164 = from.startsWith("+") ? from : "";
      const canUseCaller = isLikelyItalianMobileE164(fromE164);

      sessions.set(callSid, session);

      if (canUseCaller) {
        // Step 6a: chiedi conferma sì/no sul numero chiamante
        session.substep = "wa_confirm_caller";
        sessions.set(callSid, session);

        return respond(`
${say(`Perfetto. Ricapitolo: ${humanDateIT(session.dateISO)} alle ${session.time24}, per ${session.people} persone.`)}
${pause(1)}
${gatherSpeech({
  action,
  prompt: "Ti mando la conferma su WhatsApp a questo numero. Va bene?",
  hints: "sì, si, va bene, ok, certo, no, cambia, un altro numero",
})}
${redirect(action)}
        `);
      }

      // Caller non affidabile -> chiedi numero
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

    // ----------------
    // STEP 6: gestione WhatsApp (consenso o numero) + invio
    // ----------------
    if (session.step === 6) {
      const sub = session.substep || "wa_ask_number";

      // 6a: conferma numero chiamante
      if (sub === "wa_confirm_caller") {
        const yes = /\b(si|sì|ok|va bene|certo|confermo)\b/.test(speech);
        const no = /\b(no|non va bene|cambia|altro numero)\b/.test(speech);

        if (yes && !no) {
          session.waTo = `whatsapp:${session.fromCaller}`; // fromCaller già +39...
          session.substep = null;
          session.step = 7;
          resetRetries(session);
          sessions.set(callSid, session);
          // vai a invio
        } else if (no && !yes) {
          session.substep = "wa_ask_number";
          resetRetries(session);
          sessions.set(callSid, session);

          return respond(`
${gatherSpeech({
  action,
  prompt: "Ok. Dimmi il numero WhatsApp, iniziando con più trentanove.",
})}
${redirect(action)}
          `);
        } else {
          return failOrRetry({
            prompt1: "Scusami, ti va bene che invii il WhatsApp a questo numero? Puoi dire sì o no.",
            prompt2: "Dimmi solo: sì, va bene. Oppure: no, un altro numero.",
            exitPrompt: "Ok. Scrivici tu su WhatsApp e ti confermiamo lì. A presto!",
          });
        }
      }

      // 6b: acquisizione numero WhatsApp a voce
      if (sub === "wa_ask_number") {
        const waTo = normalizeWhatsappFromVoice(speechRaw || speech);
        if (!waTo || !hasValidWaAddress(waTo)) {
          return failOrRetry({
            prompt1: "Non sono sicuro di aver capito il numero. Me lo ripeti iniziando con più trentanove?",
            prompt2: "Ripetilo lentamente, ad esempio: più trentanove, tre tre tre...",
            exitPrompt: "Ok. Scrivici tu su WhatsApp e ti confermiamo lì. A presto!",
          });
        }

        session.waTo = waTo;
        session.substep = null;
        session.step = 7;
        resetRetries(session);
        sessions.set(callSid, session);
        // vai a invio
      }
    }

    // ----------------
    // STEP 7: invio WhatsApp + chiusura
    // ----------------
    if (session.step === 7) {
      const waTo = session.waTo;

      const summary =
`✅ Richiesta prenotazione ricevuta
Nome: ${session.name || "-"}
Data: ${humanDateIT(session.dateISO)}
Ora: ${session.time24}
Persone: ${session.people}

Rispondi qui se devi modificare o annullare.`;

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
          body: summary,
        });
      }

      sessions.delete(callSid);
      return respond(`
${say("Perfetto! Ho preso la richiesta. Ti ho inviato un WhatsApp con il riepilogo. A presto da TuttiBrilli!")}
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
});
