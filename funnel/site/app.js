// GATE EC Engineering Maths diagnostic — funnel v0.
// Flow: intro (18+) → 20 questions (no feedback) → one optional question →
// result (marks, estimate, weak topics, share) → typed @handle unlock (plan) →
// solutions with receipts. Solutions are revealed only after all 20 (decision T2).
(function () {
  'use strict';
  const C = window.VIDHYA_CONFIG || {};
  const S = window.VidhyaScore;
  const $ = function (sel) { return document.querySelector(sel); };
  const app = $('#app');
  const STORE = 'vidhya_diag_v1';
  const QUEUE = 'vidhya_queue_v1';
  const HANDLE_RE = /^@?[A-Za-z0-9_]{5,32}$/;
  const PREP = ['Coaching', 'Test series', 'YouTube & PYQs', 'ChatGPT / AI', 'Self-study'];

  let pack = null;
  let st = load() || { stage: 'intro', i: 0, answers: [], started: null, finished: null, prep: null, unlocked: false, handle: null, sentCompletion: false };

  // ---------- storage (best effort: private mode / blocked storage must not break the test)
  function load() { try { return JSON.parse(localStorage.getItem(STORE)); } catch (e) { return null; } }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(st)); } catch (e) { /* ignore */ } }
  function getRef() {
    let mine; try { mine = localStorage.getItem('vidhya_ref'); } catch (e) {}
    if (!mine) { mine = Math.random().toString(36).slice(2, 8); try { localStorage.setItem('vidhya_ref', mine); } catch (e) {} }
    return mine;
  }
  function inboundRef() {
    const q = new URLSearchParams(location.search);
    const r = (q.get('ref') || '').replace(/[^a-z0-9]/gi, '').slice(0, 12);
    if (r) { try { localStorage.setItem('vidhya_inref', r); } catch (e) {} return r; }
    try { return localStorage.getItem('vidhya_inref') || ''; } catch (e) { return ''; }
  }
  function utm() {
    const q = new URLSearchParams(location.search); const o = {};
    ['utm_source', 'utm_medium', 'utm_campaign', 'src'].forEach(function (k) { if (q.get(k)) o[k] = q.get(k).slice(0, 40); });
    return o;
  }

  // ---------- webhook with retry queue (text/plain avoids a CORS preflight)
  function post(payload) {
    payload.pack_version = pack ? pack.version : null;
    payload.page = location.pathname;
    payload.client_ts = new Date().toISOString();
    if (!C.WEBHOOK_URL) { enqueue(payload); return Promise.resolve({ ok: false, reason: 'no-webhook' }); }
    return fetch(C.WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json().catch(function () { return { ok: r.ok }; }); })
      .then(function (j) { if (!j || j.ok === false && j.reason !== 'duplicate') throw new Error((j && j.reason) || 'rejected'); return j; })
      .catch(function (err) { enqueue(payload); return { ok: false, reason: String(err.message || err) }; });
  }
  function enqueue(p) {
    try { const q = JSON.parse(localStorage.getItem(QUEUE) || '[]'); q.push(p); localStorage.setItem(QUEUE, JSON.stringify(q.slice(-10))); } catch (e) {}
  }
  function flushQueue() {
    if (!C.WEBHOOK_URL) return;
    let q; try { q = JSON.parse(localStorage.getItem(QUEUE) || '[]'); } catch (e) { return; }
    if (!q.length) return;
    try { localStorage.setItem(QUEUE, '[]'); } catch (e) {}
    q.forEach(function (p) { post(p); });
  }

  // ---------- helpers
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function h(html) { app.innerHTML = html; window.scrollTo(0, 0); }
  function receiptChip(r, idx) {
    const reviewed = !!r.reviewed_by;
    const label = reviewed ? '✓ SymPy check · reviewed by ' + esc(r.reviewed_by) : 'SymPy check · review pending';
    return '<button class="receipt' + (reviewed ? '' : ' pending') + '" data-receipt="' + idx + '" aria-expanded="false">' + label + '</button>' +
      '<div class="receipt-detail" id="rd' + idx + '" hidden>' +
      'Engine: ' + esc(r.engine) + '<br>Computed: ' + esc(r.working) + '<br>' +
      'All ' + r.options_checked + ' options checked; exactly one is true.' +
      (reviewed ? '<br>Reviewed ' + esc(r.reviewed_at || '') + (r.hand_solved ? ' · solved by hand' : '') : '<br>Human review not done yet.') +
      '<br><span class="small">Item ' + esc(r.source.split('/').slice(-2, -1)[0]) + ' · fingerprint ' + esc(r.fingerprint) + '</span></div>';
  }
  function bindReceipts() {
    app.querySelectorAll('[data-receipt]').forEach(function (b) {
      b.addEventListener('click', function () {
        const d = document.getElementById('rd' + b.dataset.receipt);
        d.hidden = !d.hidden; b.setAttribute('aria-expanded', String(!d.hidden));
      });
    });
  }
  function result() { return S.scoreAttempt(pack.items, st.answers); }

  // ---------- screens
  function intro() {
    const preview = pack.mode !== 'release' ? '<div class="banner">Preview build: answers are machine-checked, human review is still pending.</div>' : '';
    h(preview +
      '<span class="pill">' + esc(pack.exam) + '</span>' +
      '<h1>Find your weak GATE maths topics in 15 minutes.</h1>' +
      '<p>20 questions with GATE marking (−⅓ for a wrong answer). Every answer key is checked by a computer before it reaches you. Free.</p>' +
      '<p class="muted small">You see your marks, your weak topics and every step-by-step solution at the end. Nothing is shown during the test.</p>' +
      '<label class="check"><input type="checkbox" id="adult"> <span>I am 18 or older.</span></label>' +
      '<button class="btn btn-primary" id="start" disabled>Start the diagnostic</button>' +
      '<p class="muted small" style="margin-top:14px">No sign-up to take it. We only store your answers if you choose to unlock your plan.</p>');
    const cb = $('#adult'), b = $('#start');
    cb.addEventListener('change', function () { b.disabled = !cb.checked; });
    b.addEventListener('click', function () {
      st = { stage: 'q', i: 0, answers: new Array(pack.items.length).fill(null), started: Date.now(), finished: null, prep: null, unlocked: false, handle: null, sentCompletion: false };
      save(); question();
    });
  }

  function question() {
    const it = pack.items[st.i], n = pack.items.length, chosen = st.answers[st.i];
    const opts = Object.keys(it.options).map(function (k) {
      return '<button class="opt" data-k="' + k + '" aria-pressed="' + (chosen === k) + '"><b>' + k + '</b><span>' + esc(it.options[k]) + '</span></button>';
    }).join('');
    h('<div class="qmeta"><span>' + (st.i + 1) + ' / ' + n + ' · ' + esc(it.topic) + '</span><span>' + it.marks + ' mark' + (it.marks > 1 ? 's' : '') + '</span></div>' +
      '<div class="progress"><i style="width:' + Math.round(100 * st.i / n) + '%"></i></div>' +
      '<div class="question">' + esc(it.question) + '</div>' +
      '<div class="opts">' + opts + '</div>' +
      '<div class="nav">' +
      (st.i > 0 ? '<button class="btn btn-ghost" id="back">Back</button>' : '') +
      '<button class="btn btn-ghost" id="skip">' + (chosen ? 'Clear answer' : 'Skip (0 marks)') + '</button>' +
      '<button class="btn btn-primary" id="next">' + (st.i === n - 1 ? 'Finish' : 'Next') + '</button></div>');
    app.querySelectorAll('.opt').forEach(function (b) {
      b.addEventListener('click', function () { st.answers[st.i] = b.dataset.k; save(); question(); });
    });
    $('#skip').addEventListener('click', function () { st.answers[st.i] = null; save(); if (!chosen) advance(); else question(); });
    $('#next').addEventListener('click', advance);
    const back = $('#back'); if (back) back.addEventListener('click', function () { st.i--; save(); question(); });
  }
  function advance() {
    if (st.i < pack.items.length - 1) { st.i++; save(); question(); }
    else { st.stage = 'prep'; st.finished = Date.now(); save(); prep(); }
  }

  function prep() {
    h('<h2>One optional question</h2><p>How do you prepare maths now?</p><div class="opts">' +
      PREP.map(function (p) { return '<button class="opt" data-p="' + esc(p) + '"><span>' + esc(p) + '</span></button>'; }).join('') +
      '</div><div class="nav"><button class="btn btn-ghost" id="skipq">Skip</button></div>');
    app.querySelectorAll('[data-p]').forEach(function (b) { b.addEventListener('click', function () { st.prep = b.dataset.p; toResult(); }); });
    $('#skipq').addEventListener('click', function () { st.prep = null; toResult(); });
  }
  function toResult() {
    st.stage = 'result'; save();
    if (!st.sentCompletion) {
      const r = result();
      // Anonymous completion event: counts diagnostics for the kill-switch line. No personal data.
      post({ type: 'completion', marks: r.marks, total: r.total, right: r.right, wrong: r.wrong, skipped: r.skipped,
        weak: S.weakTopics(r), per_topic: r.topics.map(function (t) { return [t.topic, t.marks, t.max]; }),
        prep_method: st.prep, minutes: Math.round((st.finished - st.started) / 60000), ref_in: inboundRef(), ref_own: getRef(), utm: utm() });
      st.sentCompletion = true; save();
    }
    resultScreen();
  }

  function resultScreen() {
    const r = result(), est = S.estimateSection(r, pack.em_section_marks), weak = S.weakTopics(r);
    const bars = r.topics.map(function (t) {
      return '<div class="bar' + (weak.indexOf(t.topic) >= 0 ? ' weak' : '') + '"><span>' + esc(t.topic) + '</span><span class="track"><span class="fill" style="display:block;width:' + Math.round(t.pct * 100) + '%"></span></span><span>' + Math.round(t.pct * 100) + '%</span></div>';
    }).join('');
    const unlock = st.unlocked ? planHtml(r) :
      '<div class="card"><h2 style="margin-top:0">Unlock your full topic map and 14-day plan</h2>' +
      '<p>Type your Telegram username. We use it to send your plan and the daily verified question. Nothing else.</p>' +
      '<input type="text" id="handle" placeholder="@yourname" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="33">' +
      '<div class="hp" aria-hidden="true"><label>Leave empty <input type="text" id="website" tabindex="-1" autocomplete="off"></label></div>' +
      '<label class="check small"><input type="checkbox" id="consent"> <span>I am 18+ and agree that Vidhya stores my username, score and answers to send my plan (<a href="privacy.html">privacy</a>).</span></label>' +
      '<button class="btn btn-primary" id="unlock" disabled>Unlock my plan</button><div class="err" id="err"></div></div>';
    h('<span class="pill">Your result</span>' +
      '<div class="card"><div class="big">' + r.marks + ' <span class="muted" style="font-size:1rem">/ ' + r.total + ' marks</span></div>' +
      '<p>' + r.right + ' right · ' + r.wrong + ' wrong · ' + r.skipped + ' skipped (GATE marking)</p>' +
      '<p>≈ <b>' + est + ' / ' + pack.em_section_marks + '</b> in the exam\'s Engineering Maths section if today\'s accuracy held. A rough estimate, not a prediction.</p></div>' +
      '<h2>Where marks are leaking</h2><div class="bars">' + bars + '</div>' +
      '<p style="margin-top:12px">Weakest: <b>' + weak.map(esc).join(', ') + '</b></p>' +
      unlock +
      '<div class="row" style="margin-top:12px"><button class="btn btn-ghost" id="share">Share my score card</button></div>' +
      (C.BOOKING_URL ? '<p class="small" style="margin-top:12px">Preparing seriously? <a href="' + esc(C.BOOKING_URL) + '" target="_blank" rel="noopener">Talk to the builder for 15 minutes</a>.</p>' : '') +
      '<h2>Every question, solved</h2><p class="muted small">Tap a receipt to see what the computer checked.</p>' + solutionsHtml() +
      '<div class="nav"><button class="btn btn-ghost" id="again">Take it again</button></div>');
    bindReceipts();
    $('#share').addEventListener('click', function () { shareCard(r, weak); });
    $('#again').addEventListener('click', function () { st = { stage: 'intro' }; save(); intro(); });
    if (!st.unlocked) {
      const inp = $('#handle'), cb = $('#consent'), b = $('#unlock');
      const valid = function () { b.disabled = !(cb.checked && HANDLE_RE.test(inp.value.trim())); };
      inp.addEventListener('input', valid); cb.addEventListener('change', valid);
      b.addEventListener('click', function () { doUnlock(r, weak); });
    }
  }

  function doUnlock(r, weak) {
    const raw = $('#handle').value.trim(), err = $('#err');
    if (!HANDLE_RE.test(raw)) { err.textContent = 'Telegram usernames are 5–32 letters, numbers or underscores.'; return; }
    const handle = '@' + raw.replace(/^@/, '');
    $('#unlock').disabled = true; err.textContent = 'Saving…';
    post({ type: 'unlock', handle: handle, website: $('#website').value, consent_18: true,
      marks: r.marks, total: r.total, weak: weak,
      per_topic: r.topics.map(function (t) { return [t.topic, t.marks, t.max]; }),
      answers: st.answers.map(function (a) { return a || '-'; }).join(''), prep_method: st.prep,
      ref_in: inboundRef(), ref_own: getRef(), utm: utm() })
      .then(function (res) {
        st.unlocked = true; st.handle = handle; save();
        resultScreen();
        if (!res.ok) {
          const note = document.createElement('p'); note.className = 'small muted';
          note.innerHTML = 'We couldn\'t reach our server, so your plan is shown here and saved on this device. ' +
            (C.FOUNDER_TELEGRAM ? '<a href="https://t.me/' + esc(C.FOUNDER_TELEGRAM) + '" target="_blank" rel="noopener">Message the builder on Telegram</a> to get it sent to you.' : 'We\'ll retry automatically next time you open this page.');
          app.querySelector('.card + h2, #plan') && $('#plan').prepend(note);
        }
      });
  }

  function planHtml(r) {
    const plan = S.fourteenDayPlan(r);
    return '<div class="card" id="plan"><h2 style="margin-top:0">Your 14-day plan</h2>' +
      '<p class="small muted">Saved for ' + esc(st.handle || '') + '. Weakest topics first; day 14 is a timed check.</p><ol class="plan">' +
      plan.map(function (d) { return '<li><b>Day ' + d.day + ' · ' + esc(d.topic) + '.</b> ' + esc(d.task) + '</li>'; }).join('') + '</ol>' +
      (C.TELEGRAM_CHANNEL ? '<a class="btn btn-primary" href="https://t.me/' + esc(C.TELEGRAM_CHANNEL) + '" target="_blank" rel="noopener">Join the daily verified-question channel</a>' : '') +
      '</div>';
  }

  function solutionsHtml() {
    return pack.items.map(function (it, i) {
      const a = st.answers[i];
      const v = a == null ? '<span class="verdict skip">Skipped</span>' : a === it.answer ? '<span class="verdict ok">Right (+' + it.marks + ')</span>' : '<span class="verdict bad">Wrong (−' + (Math.round(it.marks / 3 * 100) / 100) + ')</span>';
      return '<div class="sol"><div class="qmeta"><span>' + (i + 1) + ' · ' + esc(it.topic) + '</span>' + v + '</div>' +
        '<div class="question" style="font-size:1rem;margin:6px 0">' + esc(it.question) + '</div>' +
        '<p class="small">Answer: <b>' + it.answer + '. ' + esc(it.options[it.answer]) + '</b>' + (a && a !== it.answer ? ' · you chose ' + a + '. ' + esc(it.options[a]) : '') + '</p>' +
        receiptChip(it.receipt, i) +
        '<div class="soltext">' + esc(it.solution) + '</div></div>';
    }).join('');
  }

  // ---------- shareable score card (canvas → PNG, Web Share where available)
  function shareCard(r, weak) {
    const link = (C.SITE_URL || location.origin + location.pathname.replace(/[^/]*$/, '')) + '?ref=' + getRef();
    const cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1080;
    const g = cv.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 1080, 1080);
    g.fillStyle = '#1d1d1f'; g.font = '700 56px system-ui, sans-serif'; g.fillText('My GATE maths check', 80, 180);
    g.font = '700 200px system-ui, sans-serif'; g.fillText(String(r.marks), 80, 440);
    g.font = '400 52px system-ui, sans-serif'; g.fillStyle = '#6e6e73'; g.fillText('/ ' + r.total + ' marks · GATE marking', 80, 520);
    g.fillStyle = '#1d1d1f'; g.font = '600 48px system-ui, sans-serif'; g.fillText('Weak: ' + weak.slice(0, 2).join(', '), 80, 640);
    g.strokeStyle = '#34c759'; g.lineWidth = 6; g.beginPath(); g.roundRect ? g.roundRect(80, 720, 920, 110, 55) : g.rect(80, 720, 920, 110); g.stroke();
    g.fillStyle = '#1f7a36'; g.font = '500 40px system-ui, sans-serif'; g.fillText('Every answer key checked by a computer', 120, 790);
    g.fillStyle = '#1d1d1f'; g.font = '600 44px system-ui, sans-serif'; g.fillText('Check yours →  ' + link.replace(/^https?:\/\//, '').slice(0, 40), 80, 960);
    cv.toBlob(function (blob) {
      const file = new File([blob], 'my-gate-maths.png', { type: 'image/png' });
      const text = 'My GATE maths: ' + r.marks + '/' + r.total + ' · weak: ' + weak[0] + '. Check yours: ' + link;
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], text: text }).catch(function () {});
      } else {
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'my-gate-maths.png'; a.click();
        if (navigator.clipboard) navigator.clipboard.writeText(text).catch(function () {});
        alertLite('Image downloaded and the share text copied.');
      }
    });
  }
  function alertLite(msg) { const p = document.createElement('p'); p.className = 'small muted'; p.textContent = msg; $('#share').after(p); }

  // ---------- boot
  function boot() {
    inboundRef(); flushQueue();
    if (C.CF_ANALYTICS_TOKEN) {
      const s = document.createElement('script'); s.defer = true; s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
      s.setAttribute('data-cf-beacon', JSON.stringify({ token: C.CF_ANALYTICS_TOKEN })); document.head.appendChild(s);
    }
    fetch('data/diagnostic.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (p) {
      pack = p;
      if (st.answers && st.answers.length !== pack.items.length) st = { stage: 'intro' };
      if (st.stage === 'q') question(); else if (st.stage === 'prep') prep(); else if (st.stage === 'result') resultScreen(); else intro();
    }).catch(function () { h('<p>Could not load the questions. Please refresh.</p>'); });
  }
  boot();
})();
