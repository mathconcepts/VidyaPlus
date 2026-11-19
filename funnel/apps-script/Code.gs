/**
 * Vidhya funnel webhook → Registry Sheet.
 * Deploy as a Web App (Execute as: Me, Who has access: Anyone). See README.md.
 *
 * Accepts text/plain JSON POSTs (no CORS preflight) of three types:
 *   completion   anonymous: marks, per-topic, prep method, ref codes   → tab "Completions"
 *   unlock       lead: Telegram handle + score + answers + 18+ consent → tab "Leads"
 *   jee_waitlist handle + 18+/parent consent                           → tab "JEE waitlist"
 *
 * Hardening (eng-review A1): honeypot, handle regex, 300 writes/day cap,
 * LockService, dedupe on handle+type, and every cell written with a leading
 * apostrophe so nothing a visitor types is evaluated as a formula.
 */
var DAILY_CAP = 300;
var HANDLE_RE = /^@?[A-Za-z0-9_]{5,32}$/;

var TABS = {
  completion: { name: 'Completions', header: ['received_at', 'marks', 'total', 'right', 'wrong', 'skipped', 'weak', 'per_topic', 'prep_method', 'minutes', 'ref_in', 'ref_own', 'utm', 'pack_version'] },
  unlock: { name: 'Leads', header: ['received_at', 'handle', 'marks', 'total', 'weak', 'per_topic', 'answers', 'prep_method', 'consent_18', 'ref_in', 'ref_own', 'utm', 'pack_version', 'status', 'notes'] },
  jee_waitlist: { name: 'JEE waitlist', header: ['received_at', 'handle', 'consent_18_or_parent', 'status'] }
};

function doPost(e) {
  var body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return out_({ ok: false, reason: 'bad-json' }); }
  var res = handle_(body, SpreadsheetApp.getActiveSpreadsheet(), PropertiesService.getScriptProperties(), new Date());
  return out_(res);
}

function doGet() { return out_({ ok: true, service: 'vidhya-funnel', time: new Date().toISOString() }); }

/** Pure-ish core so it can be unit-tested with fakes (see tests/apps_script.test.js). */
function handle_(b, ss, props, now) {
  if (!b || typeof b !== 'object') return { ok: false, reason: 'bad-body' };
  if (b.website) return { ok: true, reason: 'ignored' };          // honeypot: pretend success
  var spec = TABS[b.type];
  if (!spec) return { ok: false, reason: 'bad-type' };

  var handle = '';
  if (b.type !== 'completion') {
    if (!HANDLE_RE.test(String(b.handle || ''))) return { ok: false, reason: 'bad-handle' };
    handle = '@' + String(b.handle).replace(/^@/, '').toLowerCase();
    var consent = b.type === 'unlock' ? b.consent_18 : b.consent_18_or_parent;
    if (consent !== true) return { ok: false, reason: 'no-consent' };
  }

  var lock = typeof LockService !== 'undefined' ? LockService.getScriptLock() : null;
  if (lock && !lock.tryLock(10000)) return { ok: false, reason: 'busy' };
  try {
    var day = Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd');
    var key = 'count_' + day;
    var n = Number(props.getProperty(key) || 0);
    if (n >= DAILY_CAP) return { ok: false, reason: 'daily-cap' };

    var sh = ss.getSheetByName(spec.name) || ss.insertSheet(spec.name);
    if (sh.getLastRow() === 0) sh.appendRow(spec.header);

    if (handle) {
      var last = sh.getLastRow();
      if (last > 1) {
        var existing = sh.getRange(2, 2, last - 1, 1).getValues();
        for (var i = 0; i < existing.length; i++) {
          if (String(existing[i][0]).replace(/^'/, '').toLowerCase() === handle) return { ok: true, reason: 'duplicate' };
        }
      }
    }

    var ts = Utilities.formatDate(now, 'Asia/Kolkata', "yyyy-MM-dd'T'HH:mm:ssXXX");
    var row;
    if (b.type === 'completion') {
      row = [ts, num_(b.marks), num_(b.total), num_(b.right), num_(b.wrong), num_(b.skipped), list_(b.weak), json_(b.per_topic),
        str_(b.prep_method, 40), num_(b.minutes), str_(b.ref_in, 12), str_(b.ref_own, 12), json_(b.utm), str_(b.pack_version, 20)];
    } else if (b.type === 'unlock') {
      row = [ts, handle, num_(b.marks), num_(b.total), list_(b.weak), json_(b.per_topic), str_(b.answers, 40), str_(b.prep_method, 40),
        'yes', str_(b.ref_in, 12), str_(b.ref_own, 12), json_(b.utm), str_(b.pack_version, 20), 'new', ''];
    } else {
      row = [ts, handle, 'yes', 'new'];
    }
    sh.appendRow(row.map(safe_));
    props.setProperty(key, String(n + 1));
    return { ok: true };
  } finally {
    if (lock) lock.releaseLock();
  }
}

// Every visitor-supplied value is stored as text: a leading ' stops =, +, -, @ being run as formulas.
function safe_(v) { return typeof v === 'number' ? v : "'" + String(v == null ? '' : v); }
function num_(v) { var x = Number(v); return isFinite(x) ? Math.round(x * 100) / 100 : ''; }
function str_(v, max) { return String(v == null ? '' : v).replace(/[\r\n\t]/g, ' ').slice(0, max || 200); }
function list_(v) { return Array.isArray(v) ? v.map(function (x) { return str_(x, 40); }).slice(0, 8).join(', ') : ''; }
function json_(v) { try { return str_(JSON.stringify(v == null ? '' : v), 600); } catch (e) { return ''; } }
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/** Run once from the editor to create the three tabs with headers. */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(TABS).forEach(function (k) {
    var sh = ss.getSheetByName(TABS[k].name) || ss.insertSheet(TABS[k].name);
    if (sh.getLastRow() === 0) { sh.appendRow(TABS[k].header); sh.setFrozenRows(1); }
  });
}

if (typeof module !== 'undefined') module.exports = { handle_: handle_, safe_: safe_, TABS: TABS, DAILY_CAP: DAILY_CAP };
