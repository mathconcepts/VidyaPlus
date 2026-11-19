// Runs Code.gs's core against in-memory fakes of SpreadsheetApp / Properties / Utilities.
const test = require('node:test');
const assert = require('node:assert');
global.Utilities = { formatDate: (d, tz, f) => f.startsWith('yyyy-MM-dd\'') ? d.toISOString() : d.toISOString().slice(0, 10) };
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8');
const mod = { exports: {} };
vm.runInNewContext(src, { module: mod, Utilities: global.Utilities, JSON, Math, Number, String, Array, isFinite });
const { handle_, DAILY_CAP } = mod.exports;

function fakeSheet() { const rows = []; return { rows,
  getLastRow: () => rows.length, appendRow: r => rows.push(r),
  getRange: (r, c, n) => ({ getValues: () => rows.slice(r - 1, r - 1 + n).map(x => [x[c - 1]]) }) }; }
function fakeSS() { const tabs = {}; return { tabs,
  getSheetByName: n => tabs[n] || null, insertSheet: n => (tabs[n] = fakeSheet()) }; }
function fakeProps() { const p = {}; return { getProperty: k => p[k] || null, setProperty: (k, v) => { p[k] = v; } }; }
const now = new Date('2026-11-20T10:00:00Z');
const lead = h => ({ type: 'unlock', handle: h, consent_18: true, marks: 9.33, total: 31, weak: ['Calculus'], answers: 'AB-' });

test('completion is stored anonymously with a header row', () => {
  const ss = fakeSS();
  assert.strictEqual(handle_({ type: 'completion', marks: 5, total: 31 }, ss, fakeProps(), now).ok, true);
  const t = ss.tabs.Completions.rows; assert.strictEqual(t.length, 2); assert.strictEqual(t[0][0], 'received_at');
});

test('honeypot is silently ignored', () => {
  const ss = fakeSS();
  assert.strictEqual(handle_({ ...lead('@giri_test'), website: 'x' }, ss, fakeProps(), now).reason, 'ignored');
  assert.strictEqual(ss.tabs.Leads, undefined);
});

test('bad handles and missing consent are rejected', () => {
  const ss = fakeSS(), p = fakeProps();
  for (const h of ['@ab', '=HYPERLINK("x")', 'a b c d e', '']) assert.strictEqual(handle_(lead(h), ss, p, now).reason, 'bad-handle', h);
  assert.strictEqual(handle_({ ...lead('@giri_test'), consent_18: false }, ss, p, now).reason, 'no-consent');
  assert.strictEqual(handle_({ type: 'nope' }, ss, p, now).reason, 'bad-type');
});

test('leads dedupe on handle, case-insensitively', () => {
  const ss = fakeSS(), p = fakeProps();
  assert.ok(handle_(lead('Giri_Test'), ss, p, now).ok);
  assert.strictEqual(handle_(lead('@giri_test'), ss, p, now).reason, 'duplicate');
  assert.strictEqual(ss.tabs.Leads.rows.length, 2);
});

test('formula injection is neutralised with a leading apostrophe', () => {
  const ss = fakeSS();
  handle_({ type: 'completion', prep_method: '=IMPORTXML("http://x")', marks: 1 }, ss, fakeProps(), now);
  const cell = ss.tabs.Completions.rows[1][8];
  assert.ok(cell.startsWith("'="), cell);
});

test('daily cap stops writes', () => {
  const ss = fakeSS(), p = fakeProps();
  p.setProperty('count_2026-11-20', String(DAILY_CAP));
  assert.strictEqual(handle_({ type: 'completion' }, ss, p, now).reason, 'daily-cap');
});

test('JEE waitlist needs the 18+/parent confirmation', () => {
  const ss = fakeSS(), p = fakeProps();
  assert.strictEqual(handle_({ type: 'jee_waitlist', handle: '@parent_1' }, ss, p, now).reason, 'no-consent');
  assert.ok(handle_({ type: 'jee_waitlist', handle: '@parent_1', consent_18_or_parent: true }, ss, p, now).ok);
});
