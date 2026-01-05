const { google } = require('googleapis');

function getCredentials() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON_B64 missing');
  }
  const rawEnv = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64.trim();
  const decoded = Buffer.from(rawEnv, 'base64').toString('utf8').trim();

  try {
    return JSON.parse(decoded);
  } catch (error) {
    if (rawEnv.startsWith('{')) {
      try {
        return JSON.parse(rawEnv);
      } catch (rawError) {
        throw rawError;
      }
    }

    const firstBrace = decoded.indexOf('{');
    const lastBrace = decoded.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const sliced = decoded.slice(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(sliced);
      } catch (sliceError) {
        throw sliceError;
      }
    }

    throw new Error(
      'Invalid GOOGLE_SERVICE_ACCOUNT_JSON_B64: expected base64-encoded JSON in a single line.'
    );
  }
}

function getCalendarClient() {
  if (!process.env.GOOGLE_CALENDAR_ID) {
    throw new Error('GOOGLE_CALENDAR_ID missing');
  }
  const credentials = getCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/calendar']
  });
  return google.calendar({ version: 'v3', auth });
}

async function findExistingEvent(calendar, bookingKey) {
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  const response = await calendar.events.list({
    calendarId,
    privateExtendedProperty: `bookingKey=${bookingKey}`,
    maxResults: 1
  });
  const [event] = response.data.items || [];
  if (event) return event;

  const fallback = await calendar.events.list({
    calendarId,
    q: bookingKey,
    maxResults: 1
  });
  const [fallbackEvent] = fallback.data.items || [];
  return fallbackEvent || null;
}

async function createBookingEvent({ bookingKey, summary, description, startDateTimeISO, metadata }) {
  const calendar = getCalendarClient();
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  const existing = await findExistingEvent(calendar, bookingKey);
  if (existing) {
    return existing;
  }

  const durationMinutes = Number.parseInt(process.env.DEFAULT_EVENT_DURATION_MINUTES || '120', 10);
  const start = new Date(startDateTimeISO);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);

  const event = {
    summary: summary || 'Prenotazione',
    description: `${description || ''}\nBookingKey: ${bookingKey}`,
    start: {
      dateTime: start.toISOString(),
      timeZone: 'Europe/Rome'
    },
    end: {
      dateTime: end.toISOString(),
      timeZone: 'Europe/Rome'
    },
    extendedProperties: {
      private: {
        bookingKey,
        ...(metadata || {})
      }
    }
  };

  try {
    const response = await calendar.events.insert({
      calendarId,
      requestBody: event
    });
    return response.data;
  } catch (error) {
    console.error('Calendar insert error:', error.response?.data || error.message);
    throw error;
  }
}

module.exports = {
  createBookingEvent
};
