// JEE early-access waitlist: typed Telegram handle + 18+/parent confirmation.
(function () {
  var C = window.VIDHYA_CONFIG || {};
  var RE = /^@?[A-Za-z0-9_]{5,32}$/;
  var inp = document.getElementById('handle'), cb = document.getElementById('adult'),
      b = document.getElementById('join'), err = document.getElementById('err');
  function valid() { b.disabled = !(cb.checked && RE.test(inp.value.trim())); }
  inp.addEventListener('input', valid); cb.addEventListener('change', valid);
  b.addEventListener('click', function () {
    var handle = '@' + inp.value.trim().replace(/^@/, '');
    b.disabled = true; err.textContent = 'Saving…';
    var done = function (ok) {
      document.getElementById('wl').innerHTML = ok
        ? '<p><b>You are on the list.</b> We will message ' + handle.replace(/[<>&"]/g, '') + ' once, when JEE opens.</p>'
        : '<p>We could not reach our server.' + (C.FOUNDER_TELEGRAM ? ' Please <a href="https://t.me/' + C.FOUNDER_TELEGRAM + '">message us on Telegram</a> instead.' : ' Please try again later.') + '</p>';
    };
    if (!C.WEBHOOK_URL) return done(false);
    fetch(C.WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ type: 'jee_waitlist', handle: handle, consent_18_or_parent: true,
        website: document.getElementById('website').value, page: location.pathname, client_ts: new Date().toISOString() }) })
      .then(function (r) { return r.json(); })
      .then(function (j) { done(j && (j.ok || j.reason === 'duplicate')); })
      .catch(function () { done(false); });
  });
})();
