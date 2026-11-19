// Fills contact details from config.js on the static pages.
(function () {
  var C = window.VIDHYA_CONFIG || {};
  var m = document.getElementById('mail');
  if (m && C.CONTACT_EMAIL) { m.href = 'mailto:' + C.CONTACT_EMAIL; m.textContent = C.CONTACT_EMAIL; }
  var tg = document.getElementById('tg'), l = document.getElementById('tglink');
  if (tg && C.FOUNDER_TELEGRAM) { l.href = 'https://t.me/' + C.FOUNDER_TELEGRAM; l.textContent = '@' + C.FOUNDER_TELEGRAM; tg.hidden = false; }
})();
