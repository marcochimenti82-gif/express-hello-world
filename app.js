const express = require("express");
const dotenv = require("dotenv");
const {
  createGatherResponse,
  createSayResponse,
  createMessageResponse,
  normalizeSpeechText,
  guessDateFromSpeech,
  guessTimeFromSpeech,
  extractNumberFromSpeech,
  createDialResponse,
  sendWhatsAppMessage,
  createOutboundCall,
} = require("./lib/twilio");
const { getPrismaClient, dbAvailable } = require("./lib/db");
const { createBookingEvent, createTestEvent } = require("./lib/calendar");

dotenv.config();

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const bookingSessions = new Map();
const MAX_ATTEMPTS = 3;

function getSession(callSid) {
  if (!bookingSessions.has(callSid)) {
    bookingSessions.set(callSid, {
      step: "intent",
      attempts: 0,
      data: {},
    });
  }
  return bookingSessions.get(callSid);
}

function resetAttempts(session) {
  session.attempts = 0;
}

function incrementAttempts(session) {
  session.attempts += 1;
}

function needsHumanForwarding() {
  return (
    String(process.env.FORWARDING_ENABLED || "").toLowerCase() === "true" &&
    Boolean(process.env.HUMAN_FORWARD_TO)
  );
}

function createForwardingTwiml() {
  if (!needsHumanForwarding()) {
    return createSayResponse("Non riesco a capire. Ti richiameremo a breve.");
  }
  return createDialResponse(process.env.HUMAN_FORWARD_TO);
}

app.get("/", (req, res) => {
  res
    .status(200)
    .send("TuttiBrilli backend attivo ✅ (usa /healthz, /voice, /whatsapp)");
});

app.get("/healthz", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/debug/db", async (req, res) => {
  if (!dbAvailable()) {
    return res.status(200).json({ ok: false, reason: "DATABASE_URL missing" });
  }
  const prisma = getPrismaClient();
  try {
    const [locali, bookings] = await Promise.all([
      prisma.locale.count(),
      prisma.booking.count(),
    ]);
    return res.status(200).json({ ok: true, locali, bookings });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/debug/seed", async (req, res) => {
  if (!dbAvailable()) {
    return res.status(200).json({ ok: false, reason: "DATABASE_URL missing" });
  }
  const prisma = getPrismaClient();
  try {
    const locale = await prisma.locale.upsert({
      where: { name: "TuttiBrilli" },
      update: {},
      create: { name: "TuttiBrilli" },
    });
    return res.status(200).json({ ok: true, locale });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/debug/calendar-test", async (req, res) => {
  try {
    const event = await createTestEvent({
      summary: "Test TuttiBrilli",
      description: "Evento test creato da /debug/calendar-test",
    });
    return res.status(200).json({ ok: true, htmlLink: event.htmlLink });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/debug/whatsapp-test", async (req, res) => {
  const { to, body } = req.body || {};
  try {
    const message = await sendWhatsAppMessage({
      to,
      body: body || "Test WhatsApp da TuttiBrilli",
    });
    return res.status(200).json({ ok: true, sid: message.sid });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/debug/call-outbound", async (req, res) => {
  const { to, from } = req.body || {};
  try {
    const call = await createOutboundCall({ to, from });
    return res.status(200).json({ ok: true, sid: call.sid });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/whatsapp/inbound", (req, res) => {
  const from = req.body.From || "sconosciuto";
  const incomingMsg = req.body.Body || "";
  const reply = `Ciao! ✅ Messaggio ricevuto da ${from}. Hai scritto: "${incomingMsg}"`;
  res.type("text/xml").status(200).send(createMessageResponse(reply));
});

app.post("/voice", (req, res) => {
  const callSid = req.body.CallSid;
  const session = getSession(callSid);
  session.step = "intent";
  session.attempts = 0;
  session.data = { from: req.body.From, callSid };

  const prompt =
    "Benvenuto da TuttiBrilli. Vuoi fare una prenotazione o chiedere informazioni?";
  const twiml = createGatherResponse({
    action: "/voice/step",
    prompt,
  });
  res.type("text/xml").status(200).send(twiml);
});

app.post("/voice/step", async (req, res) => {
  const callSid = req.body.CallSid;
  const speechResult = normalizeSpeechText(req.body.SpeechResult || "");
  const session = getSession(callSid);
  const { data } = session;

  if (!speechResult) {
    incrementAttempts(session);
    if (session.attempts >= MAX_ATTEMPTS) {
      const twiml = createForwardingTwiml();
      return res.type("text/xml").status(200).send(twiml);
    }
    const twiml = createGatherResponse({
      action: "/voice/step",
      prompt: "Non ho capito, puoi ripetere?",
    });
    return res.type("text/xml").status(200).send(twiml);
  }

  switch (session.step) {
    case "intent": {
      if (speechResult.includes("informaz")) {
        const twiml = createSayResponse(
          "Per informazioni puoi visitare il nostro sito. Arrivederci."
        );
        return res.type("text/xml").status(200).send(twiml);
      }
      session.step = "name";
      resetAttempts(session);
      return res
        .type("text/xml")
        .status(200)
        .send(
          createGatherResponse({
            action: "/voice/step",
            prompt: "Perfetto. Qual è il tuo nome?",
          })
        );
    }
    case "name": {
      data.name = speechResult;
      session.step = "date";
      resetAttempts(session);
      return res
        .type("text/xml")
        .status(200)
        .send(
          createGatherResponse({
            action: "/voice/step",
            prompt: "Per quale data? puoi dire oggi, domani o una data come 12-10.",
          })
        );
    }
    case "date": {
      const dateISO = guessDateFromSpeech(speechResult);
      if (!dateISO) {
        incrementAttempts(session);
        if (session.attempts >= MAX_ATTEMPTS) {
          const twiml = createForwardingTwiml();
          return res.type("text/xml").status(200).send(twiml);
        }
        return res
          .type("text/xml")
          .status(200)
          .send(
            createGatherResponse({
              action: "/voice/step",
              prompt: "Data non valida, ripeti con giorno e mese.",
            })
          );
      }
      data.dateISO = dateISO;
      session.step = "time";
      resetAttempts(session);
      return res
        .type("text/xml")
        .status(200)
        .send(
          createGatherResponse({
            action: "/voice/step",
            prompt: "A che ora?",
          })
        );
    }
    case "time": {
      const time24 = guessTimeFromSpeech(speechResult);
      if (!time24) {
        incrementAttempts(session);
        if (session.attempts >= MAX_ATTEMPTS) {
          const twiml = createForwardingTwiml();
          return res.type("text/xml").status(200).send(twiml);
        }
        return res
          .type("text/xml")
          .status(200)
          .send(
            createGatherResponse({
              action: "/voice/step",
              prompt: "Ora non valida, ad esempio diciannove e trenta.",
            })
          );
      }
      data.time24 = time24;
      session.step = "people";
      resetAttempts(session);
      return res
        .type("text/xml")
        .status(200)
        .send(
          createGatherResponse({
            action: "/voice/step",
            prompt: "Per quante persone?",
          })
        );
    }
    case "people": {
      const people = extractNumberFromSpeech(speechResult);
      if (!people) {
        incrementAttempts(session);
        if (session.attempts >= MAX_ATTEMPTS) {
          const twiml = createForwardingTwiml();
          return res.type("text/xml").status(200).send(twiml);
        }
        return res
          .type("text/xml")
          .status(200)
          .send(
            createGatherResponse({
              action: "/voice/step",
              prompt: "Numero non valido, ripeti quante persone.",
            })
          );
      }
      data.people = people;
      session.step = "whatsapp";
      resetAttempts(session);
      if ((data.from || "").startsWith("+39")) {
        data.whatsapp = data.from;
        return res
          .type("text/xml")
          .status(200)
          .send(
            createGatherResponse({
              action: "/voice/step",
              prompt:
                "Vuoi ricevere la conferma su WhatsApp a questo numero? Rispondi sì o no.",
            })
          );
      }
      return res
        .type("text/xml")
        .status(200)
        .send(
          createGatherResponse({
            action: "/voice/step",
            prompt: "Qual è il tuo numero WhatsApp?",
          })
        );
    }
    case "whatsapp": {
      if ((data.from || "").startsWith("+39") && !data.confirmedWhatsApp) {
        if (speechResult.includes("si") || speechResult.includes("sì")) {
          data.confirmedWhatsApp = true;
        } else {
          data.whatsapp = null;
        }
      }
      if (!data.confirmedWhatsApp && !data.whatsapp) {
        const phone = speechResult.replace(/\s/g, "");
        if (!phone.startsWith("+")) {
          incrementAttempts(session);
          if (session.attempts >= MAX_ATTEMPTS) {
            const twiml = createForwardingTwiml();
            return res.type("text/xml").status(200).send(twiml);
          }
          return res
            .type("text/xml")
            .status(200)
            .send(
              createGatherResponse({
                action: "/voice/step",
                prompt: "Inserisci il numero con prefisso, ad esempio +39...",
              })
            );
        }
        data.whatsapp = phone;
      }
      if ((data.from || "").startsWith("+39") && !data.confirmedWhatsApp && !data.whatsapp) {
        return res
          .type("text/xml")
          .status(200)
          .send(
            createGatherResponse({
              action: "/voice/step",
              prompt: "Qual è il tuo numero WhatsApp?",
            })
          );
      }

      try {
        const booking = await createBookingRecord(data);
        const event = await createBookingEvent({
          booking,
          bookingKey: booking.bookingKey,
        });
        await markBookingCalendar(booking.id, event.id);
        if (data.whatsapp) {
          await sendWhatsAppMessage({
            to: `whatsapp:${data.whatsapp}`,
            body: `Prenotazione confermata per ${booking.name} il ${booking.dateISO} alle ${booking.time24} per ${booking.people} persone.`,
          });
        }
        bookingSessions.delete(callSid);
        const twiml = createSayResponse(
          "Perfetto, prenotazione registrata. Ti invieremo conferma su WhatsApp."
        );
        return res.type("text/xml").status(200).send(twiml);
      } catch (error) {
        console.error("Booking flow error", error);
        const twiml = createSayResponse(
          "C'è un problema con il calendario, ti ricontatteremo."
        );
        return res.type("text/xml").status(200).send(twiml);
      }
    }
    default: {
      const twiml = createSayResponse("Sessione terminata.");
      return res.type("text/xml").status(200).send(twiml);
    }
  }
});

async function createBookingRecord(data) {
  if (!dbAvailable()) {
    return {
      id: "no-db",
      bookingKey: data.callSid || `call-${Date.now()}`,
      name: data.name,
      dateISO: data.dateISO,
      time24: data.time24,
      people: data.people,
    };
  }
  const prisma = getPrismaClient();
  const locale = await prisma.locale.upsert({
    where: { name: "TuttiBrilli" },
    update: {},
    create: { name: "TuttiBrilli" },
  });
  const businessDay = await prisma.businessDay.upsert({
    where: {
      localeId_dateISO: {
        localeId: locale.id,
        dateISO: data.dateISO,
      },
    },
    update: {},
    create: {
      localeId: locale.id,
      dateISO: data.dateISO,
    },
  });
  const bookingKey = data.callSid || `call-${Date.now()}`;
  const booking = await prisma.booking.create({
    data: {
      bookingKey,
      name: data.name,
      dateISO: data.dateISO,
      time24: data.time24,
      people: data.people,
      status: "PENDING",
      phone: data.from,
      whatsapp: data.whatsapp,
      localeId: locale.id,
      businessDayId: businessDay.id,
    },
  });
  return booking;
}

async function markBookingCalendar(bookingId, calendarEventId) {
  if (!dbAvailable() || bookingId === "no-db") {
    return;
  }
  const prisma = getPrismaClient();
  await prisma.booking.update({
    where: { id: bookingId },
    data: { calendarEventId, status: "CONFIRMED" },
  });
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
