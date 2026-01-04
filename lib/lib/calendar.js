const { google } = require("googleapis");

function getServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64;
  if (!raw) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON_B64 missing");
  }
  const json = Buffer.from(raw, "base64").toString("utf-8");
  return JSON.parse(json);
}

function getCalendarClient() {
  const credentials = getServiceAccount();
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
  return google.calendar({ version: "v3", auth });
}

async function findExistingEvent(calendar, calendarId, bookingKey) {
  const response = await calendar.events.list({
    calendarId,
    privateExtendedProperty: `bookingKey=${bookingKey}`,
    maxResults: 1,
    singleEvents: true,
  });
  const items = response.data.items || [];
  return items.length ? items[0] : null;
}

async function createBookingEvent({ booking, bookingKey }) {
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  if (!calendarId) {
    throw new Error("GOOGLE_CALENDAR_ID missing");
  }
  const calendar = getCalendarClient();
  const existing = await findExistingEvent(calendar, calendarId, bookingKey);
  if (existing) {
    return existing;
  }

  const duration = Number(process.env.DEFAULT_EVENT_DURATION_MINUTES || 90);
  const start = new Date(`${booking.dateISO}T${booking.time24}:00+02:00`);
  const end = new Date(start.getTime() + duration * 60000);

  const event = {
    summary: `Prenotazione ${booking.name}`,
    description: `Prenotazione ${booking.name} (${booking.people} persone). BookingKey: ${bookingKey}`,
    start: { dateTime: start.toISOString(), timeZone: "Europe/Rome" },
    end: { dateTime: end.toISOString(), timeZone: "Europe/Rome" },
    extendedProperties: {
      private: {
        bookingKey,
      },
    },
  };

  const response = await calendar.events.insert({
    calendarId,
    requestBody: event,
  });
  return response.data;
}

async function createTestEvent({ summary, description }) {
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  if (!calendarId) {
    throw new Error("GOOGLE_CALENDAR_ID missing");
  }
  const calendar = getCalendarClient();
  const start = new Date();
  const end = new Date(start.getTime() + 30 * 60000);
  const response = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary,
      description,
      start: { dateTime: start.toISOString(), timeZone: "Europe/Rome" },
      end: { dateTime: end.toISOString(), timeZone: "Europe/Rome" },
    },
  });
  return response.data;
}

module.exports = {
  createBookingEvent,
  createTestEvent,
};
