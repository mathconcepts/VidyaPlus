// Funnel configuration — the only file Giri edits after deploy.
// Leave a value empty to switch that feature off; the page degrades honestly.
window.VIDHYA_CONFIG = {
  // Google Apps Script web-app URL (Deploy → New deployment → Web app → URL ending in /exec).
  WEBHOOK_URL: '',
  // Public Telegram channel for daily verified polls, e.g. 'vidhya_gate_maths' (no @).
  TELEGRAM_CHANNEL: '',
  // Giri's Telegram username for the "message me instead" fallback, e.g. 'giri_vidhya' (no @).
  FOUNDER_TELEGRAM: '',
  // Public URL of this site, used in share links. e.g. 'https://vidhya-gate.pages.dev'
  SITE_URL: '',
  // Optional booking link for the 15-minute call (Cal.com / Google appointment page).
  BOOKING_URL: '',
  // Cloudflare Web Analytics token (cookieless page counts). Empty = no analytics at all.
  CF_ANALYTICS_TOKEN: '',
  CONTACT_EMAIL: 'mathconcepts1@gmail.com',
};
