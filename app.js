const express = require('express');
const dotenv = require('dotenv');
const { createCalendarClient, createBookingEvent } = require('./lib/calendar');
const { createVoiceRouter } = require('./lib/voiceFlow');
const twilio = require('twilio');

dotenv.config();

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const REQUIRED_ENV = [
  'BASE_URL',
  'PORT',
  'GOOGLE_SERVICE_ACCOUNT_JSON_B64',
  'GOOGLE_CALENDAR_ID',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_WHATSAPP_FROM',
  'FORWARDING_ENABLED',
  'HUMAN_FORWARD_TO'
];

function getTwilioClient() {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    return null;
  }
  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

async function sendWhatsAppConfirmation(to, body) {
  const client = getTwilioClient();
  if (!client) {
    throw new Error('Twilio credentials missing');
  }
  if (!process.env.TWILIO_WHATSAPP_FROM) {
    throw new Error('TWILIO_WHATSAPP_FROM missing');
  }
  if (!to) {
    throw new Error('Missing WhatsApp destination');
  }

  return client.messages.create({
    from: process.env.TWILIO_WHATSAPP_FROM,
    to: to.startsWith('whatsapp:') ? to : `whatsapp:${to}`,
    body
  });
}

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

app.get('/debug/calendar-test', async (req, res) => {
  try {
    const calendar = createCalendarClient();
    const result = await createBookingEvent(calendar, {
      bookingKey: 'DEBUG-CALENDAR-TEST',
      summary: 'Test Calendar',
      startDateTimeISO: new Date('2026-01-10T20:00:00+01:00').toISOString(),
      durationMinutes: 120
    });
    res.json({ ok: true, message: 'Evento creato con successo', result });
  } catch (error) {
    console.error('DEBUG CALENDAR ERROR:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.use(
  createVoiceRouter({
    createCalendarClient,
    createBookingEvent,
    sendWhatsAppConfirmation
  })
);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
