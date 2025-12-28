/**
 * TuttiBrilli Enoteca — Voice Prompts (IT)
 * SOLO TESTI. Nessuna logica, nessun flusso.
 * Placeholders suggeriti: {{name}}, {{dateLabel}}, {{time}}, {{partySize}}, {{guess}}
 */

const PROMPTS = {
  step1_welcome_name: {
    main: "Buonasera, TuttiBrilli Enoteca. Ti do una mano con la prenotazione. Partiamo dal nome: come ti chiami?",
    short: "Buonasera, TuttiBrilli. Come ti chiami?",
    error: "Perdonami, è andato un po’ via l’audio. Mi ripeti il nome?"
  },

  step2_confirm_name_ask_date: {
    main: "Perfetto, piacere {{name}}. Per che giorno pensavi?",
    short: "Perfetto {{name}}. Per che giorno?",
    error: "Voglio essere sicuro di aver capito: il nome è {{guess}}?"
  },

  step3_confirm_date_ask_time: {
    main: "Ok, {{dateLabel}}. A che ora ti va di venire?",
    short: "Ok {{dateLabel}}. A che ora?",
    error: "Scusami, non l’ho colto bene. Che giorno intendi?",
    closedDay: {
      main: "Ti fermo solo un attimo: quel giorno siamo chiusi. Se vuoi, guardiamo insieme un’altra data.",
      short: "Quel giorno siamo chiusi. Vuoi provare un’altra data?"
    },
    todayVariant: "Perfetto, per questa sera. A che ora?"
  },

  step4_confirm_time_ask_party_size: {
    main: "Perfetto, alle {{time}}. In quanti sarete?",
    short: "Ok {{time}}. In quanti?",
    error: "Scusami, l’orario mi è sfuggito. Me lo ripeti?",
    outsideHours: {
      main: "Ti dico solo una cosa: a quell’ora il locale è ancora chiuso. Se vuoi, possiamo anticipare o spostarci un po’ più tardi.",
      short: "A quell’ora siamo chiusi. Vuoi un altro orario?"
    },
    kitchenClosed: {
      main: "A quell’ora la cucina è chiusa, però siamo aperti per bere qualcosa. Va bene lo stesso o preferisci un altro orario?",
      short: "A quell’ora la cucina è chiusa. Va bene lo stesso?"
    },
    afterDinner: "Perfetto, quindi dopocena. Quante persone sarete?"
  },

  step5_party_size_ask_notes: {
    main: "Perfetto, {{partySize}} persone. C’è qualche allergia, intolleranza o richiesta particolare?",
    short: "Ok {{partySize}}. Allergie o richieste?",
    error: "Scusami, non ho capito il numero. Me lo ripeti?",
    largeGroupPositive: "Ok, {{partySize}} persone. Ci organizziamo senza problemi. C’è qualche allergia o richiesta particolare?",
    checkingAvailability: "Un attimo solo che controllo la disponibilità per {{partySize}} persone. Ci metto pochissimo.",
    noAvailability: "Ti dico la verità: per {{partySize}} persone a quell’orario siamo al completo. Se vuoi, proviamo un altro orario o un altro giorno."
  },

  step6_collect_notes: {
    main: "Dimmi pure cosa devo segnalare.",
    short: "Cosa devo segnare?",
    error: "Scusami, non ho capito bene. Me lo ripeti con calma?",
    reassure: "Anche solo per segnalarlo alla cucina.",
    noneClose: "Perfetto, tutto ok."
  },

  step7_whatsapp_number: {
    main: "Mi lasci un numero WhatsApp? Ti mando lì la conferma.",
    short: "Un numero WhatsApp, per favore.",
    reassure: "Solo per la conferma, niente altro.",
    error: "Scusami, l’ho perso a metà. Me lo ripeti con calma?",
    spokeTooFast: "Perfetto. Me lo ridici tutto di seguito, così non sbagliamo?",
    afterCapture: "Ok, perfetto. Un attimo che ti riassumo tutto."
  },

  step8_summary_confirm: {
    main: "Allora, ricapitoliamo un attimo. {{name}}, {{dateLabel}} alle {{time}}, per {{partySize}} persone. Va bene così?",
    short: "Riepilogo veloce: {{dateLabel}}, {{time}}, {{partySize}} persone. Confermi?",
    error: "Nessun problema, sistemiamo subito.",
    confirmPrompt: "Se per te è tutto ok, confermo la prenotazione.",
    confirmShort: "Confermo?",
    hesitation: "Prenditi pure un secondo, non c’è fretta.",
    outdoorWeather: "Ti segnalo solo una cosa: il tavolo è all’esterno e il meteo è un po’ incerto. Se cambia qualcosa, ci organizziamo senza problemi.",
    kitchenNotActive: "A quell’orario la cucina non è attiva, però siamo aperti per bere qualcosa. Va bene lo stesso?",
    promoNotValid: "Ti avviso solo che a quell’orario la promo non è attiva. Il resto resta invariato.",
    tightAvailability: "È una disponibilità un po’ stretta, ma ci stiamo dentro. Se confermi, blocco subito."
  },

  step9_success: {
    main: "Perfetto, la prenotazione è confermata. Tra poco ricevi un messaggio WhatsApp con tutti i dettagli. Ti aspettiamo da TuttiBrilli.",
    short: "Fatto. Ti arriva subito la conferma su WhatsApp.",
    reassure: "Sì, è tutto confermato. Tra pochissimo ti arriva il messaggio.",
    goodbye: "A presto, buona serata."
  },

  step9_fallback_transfer_operator: {
    main: "Un attimo solo, così ti seguiamo al meglio. Ti passo subito un collega.",
    short: "Ti metto in contatto con un collega.",
    gentle: "Capisco, meglio sentirci un attimo a voce. Resta in linea, ti passo un collega.",
    value: "Così riusciamo a trovare la soluzione migliore per te."
  }
};

module.exports = { PROMPTS };
