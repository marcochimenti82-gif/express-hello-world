const express = require('express');
const dotenv = require('dotenv');
const { getPrismaClient, ensureDefaultLocale, upsertBusinessDay } = require('./lib/db');
const { createBookingEvent } = require('./lib/calendar');
const { sendWhatsAppMessage, createOutboundCall } = require('./lib/twilio');
const { twiml: TwilioTwiml } = require('twilio');

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const REQUIRED_ENV = [
  'DATABASE_URL',
  'GOOGLE_SERVICE_ACCOUNT_JSON_B64',
  'GOOGLE_CALENDAR_ID',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_WHATSAPP_FROM',
  'BASE_URL',
  'FORWARDING_ENABLED',
  'HUMAN_FORWARD_TO'
];

const sessions = new Map();
const MAX_RETRIES = 3;
const VOICE_STEPS = [
  { key: 'name', prompt: 'Ciao! Come ti chiami?' },
  { key: 'date', prompt: 'Per quale data vuoi prenotare?' },
  { key: 'time', prompt: 'A che ora?' },
  { key: 'people', prompt: 'Per quante persone?' },
  { key: 'whatsapp', prompt: 'Qual è il tuo numero WhatsApp con prefisso internazionale?' }
];

function getSession(callSid) {
  if (!sessions.has(callSid)) {
    sessions.set(callSid, {
      stepIndex: 0,
      attempts: 0,
      data: {}
    });
  }
  return sessions.get(callSid);
}

function buildGatherResponse(prompt) {
  const response = new TwilioTwiml.VoiceResponse();
  const gather = response.gather({
    input: 'speech',
    language: 'it-IT',
    speechTimeout: 'auto',
    action: '/voice/step',
    method: 'POST'
  });
  gather.say({ language: 'it-IT' }, prompt);
  response.say({ language: 'it-IT' }, 'Non ho ricevuto risposta. Riproviamo.');
  response.redirect({ method: 'POST' }, '/voice');
  return response;
}

function buildTransferResponse() {
  const response = new TwilioTwiml.VoiceResponse();
  if (process.env.FORWARDING_ENABLED === 'true' && process.env.HUMAN_FORWARD_TO) {
    response.say({ language: 'it-IT' }, 'Ti trasferisco a un operatore.');
    response.dial({}, process.env.HUMAN_FORWARD_TO);
  } else {
    response.say({ language: 'it-IT' }, 'Spiacente, non riesco a comprendere la richiesta. Riprova più tardi.');
  }
  return response;
}

function normalizeDateInput(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return parsed.toISOString().slice(0, 10);
}

function buildStartDateTime(dateInput, timeInput) {
  const dateISO = normalizeDateInput(dateInput);
  const time = (timeInput || '19:00').replace(/[^0-9:]/g, '') || '19:00';
  const dateTime = new Date(`${dateISO}T${time}`);
  if (Number.isNaN(dateTime.getTime())) {
    return new Date().toISOString();
  }
  return dateTime.toISOString();
}

async function saveBookingIfConfigured(session, callSid) {
  const prisma = getPrismaClient();
  if (!prisma) {
    return null;
  }

  const locale = await ensureDefaultLocale(prisma);
  const dateISO = normalizeDateInput(session.data.date);
  const businessDay = await upsertBusinessDay(prisma, locale.id, dateISO);

  return prisma.booking.create({
    data: {
      localeId: locale.id,
      businessDayId: businessDay.id,
      name: session.data.name || 'Cliente',
      time24: session.data.time || '00:00',
      people: Number.parseInt(session.data.people, 10) || 2,
      status: 'REQUESTED',
      whatsapp: session.data.whatsapp || null,
      createdBy: callSid
    }
  });
}

app.get('/', (req, res) => {
  res.send('AI TuttiBrilli backend attivo');
});

app.get('/healthz', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/debug/env', (req, res) => {
  const status = REQUIRED_ENV.reduce((acc, key) => {
    acc[key] = Boolean(process.env[key]);
    return acc;
  }, {});
  res.json({ status });
});

app.get('/debug/db', async (req, res) => {
  if (!process.env.DATABASE_URL) {
    return res.status(400).json({ ok: false, error: 'DATABASE_URL missing' });
  }
  try {
    const prisma = getPrismaClient();
    const bookingCount = await prisma.booking.count();
    const businessDayCount = await prisma.businessDay.count();
    return res.json({ ok: true, bookingCount, businessDayCount });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// =======================
// DEBUG CALENDAR TEST
// =======================
app.get('/debug/calendar-test', async (req, res) => {
  try {
    const { createBookingEvent: createDebugBookingEvent } = require('./lib/calendar');
    const bookingKey = 'DEBUG-CALENDAR-TEST';
    const dateISO = '2026-01-10';
    const time24 = '20:00';

    const startDateTimeISO = buildStartDateTime(dateISO, time24);
    const result = await createDebugBookingEvent({
      bookingKey,
      summary: 'Test Calendar',
      description: `Evento di test per ${bookingKey}`,
      startDateTimeISO
    });

    res.json({
      ok: true,
      message: 'Evento creato con successo',
      result
    });
  } catch (err) {
    console.error('DEBUG CALENDAR ERROR:', err);
    res.status(500).json({
      ok: false,
      error: err.message,
      details: err
    });
  }
});

app.post('/debug/whatsapp-test', async (req, res) => {
  const { to } = req.body;
  if (!to) {
    return res.status(400).json({ ok: false, error: 'Missing to' });
  }
  try {
    const message = await sendWhatsAppMessage(to, 'Messaggio WhatsApp di test da TuttiBrilli.');
    res.json({ ok: true, sid: message.sid });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/debug/call-outbound', async (req, res) => {
  const { to } = req.body;
  if (!to) {
    return res.status(400).json({ ok: false, error: 'Missing to' });
  }
  try {
    const call = await createOutboundCall(to);
    res.json({ ok: true, sid: call.sid });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/whatsapp/inbound', (req, res) => {
  console.log('WhatsApp inbound payload:', req.body);
  res.status(200).send('OK');
});

app.post('/voice', (req, res) => {
  const callSid = req.body.CallSid || 'unknown';
  const session = getSession(callSid);
  const step = VOICE_STEPS[session.stepIndex];
  const response = buildGatherResponse(step.prompt);
  res.type('text/xml').send(response.toString());
});

app.post('/voice/step', async (req, res) => {
  const callSid = req.body.CallSid || 'unknown';
  const speechResult = (req.body.SpeechResult || '').trim();
  const session = getSession(callSid);

  if (!speechResult) {
    session.attempts += 1;
    if (session.attempts >= MAX_RETRIES) {
      const transferResponse = buildTransferResponse();
      sessions.delete(callSid);
      return res.type('text/xml').send(transferResponse.toString());
    }
    const retryResponse = buildGatherResponse('Non ho capito, puoi ripetere?');
    return res.type('text/xml').send(retryResponse.toString());
  }

  const step = VOICE_STEPS[session.stepIndex];
  session.data[step.key] = speechResult;
  session.attempts = 0;
  session.stepIndex += 1;

  if (session.stepIndex < VOICE_STEPS.length) {
    const nextStep = VOICE_STEPS[session.stepIndex];
    const nextResponse = buildGatherResponse(nextStep.prompt);
    return res.type('text/xml').send(nextResponse.toString());
  }

  const response = new TwilioTwiml.VoiceResponse();
  response.say({ language: 'it-IT' }, 'Perfetto, sto registrando la tua richiesta.');

  let bookingRecord = null;
  try {
    bookingRecord = await saveBookingIfConfigured(session, callSid);
  } catch (error) {
    console.error('Booking save error:', error);
  }

  try {
    const event = await createBookingEvent({
      bookingKey: callSid,
      summary: `Prenotazione ${session.data.name || 'Cliente'}`,
      description: `Prenotazione per ${session.data.people || 'N/A'} persone alle ${session.data.time || 'N/A'}.`,
      startDateTimeISO: buildStartDateTime(session.data.date, session.data.time),
      metadata: {
        bookingId: bookingRecord ? bookingRecord.id : null
      }
    });

    let whatsappSent = false;
    if (session.data.whatsapp) {
      try {
        await sendWhatsAppMessage(
          session.data.whatsapp,
          `Ciao ${session.data.name}, prenotazione ricevuta per ${session.data.people} persone alle ${session.data.time}. Evento creato: ${event.htmlLink}`
        );
        whatsappSent = true;
      } catch (whatsappError) {
        console.error('WhatsApp send error:', whatsappError);
      }
    } else {
      console.warn('Missing WhatsApp number for call:', callSid);
    }

    if (whatsappSent) {
      response.say({ language: 'it-IT' }, 'Prenotazione confermata. Ti ho inviato un messaggio WhatsApp. A presto!');
    } else {
      response.say({ language: 'it-IT' }, 'Prenotazione confermata. A presto!');
    }
  } catch (error) {
    console.error('Calendar error:', error);
    response.say({ language: 'it-IT' }, 'Ho registrato la prenotazione, ma c’è un problema tecnico sul calendario. Ti ricontatteremo presto.');
  }

  sessions.delete(callSid);
  res.type('text/xml').send(response.toString());
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
