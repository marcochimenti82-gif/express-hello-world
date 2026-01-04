const twilio = require("twilio");

function xmlEscape(input) {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function twiml(inner) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n${inner}\n</Response>`;
}

function createSayResponse(text) {
  return twiml(`<Say language="it-IT" voice="alice">${xmlEscape(text)}</Say>`);
}

function createMessageResponse(text) {
  return twiml(`<Message>${xmlEscape(text)}</Message>`);
}

function createGatherResponse({ action, prompt }) {
  return twiml(
    `<Gather input="speech" speechTimeout="auto" action="${action}" method="POST">\n` +
      `<Say language="it-IT" voice="alice">${xmlEscape(prompt)}</Say>\n` +
      `</Gather>`
  );
}

function createDialResponse(number) {
  return twiml(
    `<Say language="it-IT" voice="alice">Ti metto in contatto con un operatore.</Say>\n<Dial>${xmlEscape(
      number
    )}</Dial>`
  );
}

function normalizeSpeechText(text) {
  return String(text || "").trim().toLowerCase();
}

function guessDateFromSpeech(text) {
  const now = new Date();
  if (text.includes("oggi")) {
    return now.toISOString().slice(0, 10);
  }
  if (text.includes("domani")) {
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    return tomorrow.toISOString().slice(0, 10);
  }
  const match = text.match(/(\d{1,2})[\/-](\d{1,2})/);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = now.getFullYear();
    const date = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString().slice(0, 10);
    }
  }
  return null;
}

function guessTimeFromSpeech(text) {
  const match = text.match(/(\d{1,2})(?:[:\s](\d{1,2}))?/);
  if (!match) {
    return null;
  }
  let hour = Number(match[1]);
  let minute = match[2] ? Number(match[2]) : 0;
  if (text.includes("mezza")) {
    minute = 30;
  }
  if (hour > 23 || minute > 59) {
    return null;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function extractNumberFromSpeech(text) {
  const match = text.match(/\d+/);
  if (!match) {
    return null;
  }
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

function getTwilioClient() {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    throw new Error("Twilio credentials missing");
  }
  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

async function sendWhatsAppMessage({ to, body }) {
  if (!to) {
    throw new Error("WhatsApp destination missing");
  }
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!from) {
    throw new Error("TWILIO_WHATSAPP_FROM missing");
  }
  const client = getTwilioClient();
  return client.messages.create({ to, from, body });
}

async function createOutboundCall({ to, from }) {
  const client = getTwilioClient();
  const fromNumber = from || process.env.TWILIO_VOICE_FROM;
  if (!fromNumber) {
    throw new Error("TWILIO_VOICE_FROM missing");
  }
  const baseUrl = process.env.BASE_URL || "";
  if (!baseUrl) {
    throw new Error("BASE_URL missing");
  }
  return client.calls.create({
    to,
    from: fromNumber,
    url: `${baseUrl}/voice`,
  });
}

module.exports = {
  createSayResponse,
  createMessageResponse,
  createGatherResponse,
  createDialResponse,
  normalizeSpeechText,
  guessDateFromSpeech,
  guessTimeFromSpeech,
  extractNumberFromSpeech,
  sendWhatsAppMessage,
  createOutboundCall,
};
