// Mutation test: corrupting an answer key in a bank copy must make the build refuse to ship.
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const repo = path.resolve(__dirname, '../..');
const build = path.join(repo, 'funnel/build/build_diagnostic.py');

function run(args, env) { return spawnSync('python3', [build, ...args], { cwd: repo, encoding: 'utf8', env: { ...process.env, ...env } }); }

test('clean build passes in preview mode', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-'));
  const r = run(['--out', path.join(tmp, 'd.json')]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test('--release refuses while human review is pending', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-'));
  const r = run(['--release', '--out', path.join(tmp, 'd.json')]);
  assert.strictEqual(r.status, 2, r.stdout + r.stderr);
});

test('a flipped answer key fails the build', () => {
  const src = path.join(repo, 'data/courses/gate-em/topics');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-'));
  fs.cpSync(src, path.join(tmp, 'topics'), { recursive: true });
  // find the file holding la-001 and flip its key
  let flipped = false;
  for (const f of walk(path.join(tmp, 'topics'))) {
    const t = fs.readFileSync(f, 'utf8');
    const m = t.match(/("id":\s*"la-001"[\s\S]*?"(?:correct_answer|answer)":\s*")([A-D])"/);
    if (m) {
      const other = m[2] === 'A' ? 'B' : 'A';
      fs.writeFileSync(f, t.replace(m[0], m[1] + other + '"')); flipped = true; break;
    }
  }
  assert.ok(flipped, 'could not locate la-001 in the bank copy');
  const r = run(['--topics', path.join(tmp, 'topics'), '--out', path.join(tmp, 'd.json')]);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
});

function* walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) yield* walk(p); else yield p; } }
