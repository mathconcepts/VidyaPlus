// Fork Test law (plan §15 S5): brain engine modules name no exam. Every
// exam fact (marks, penalties, tolerances, topics) arrives from a pack's
// exam.yaml. Tests and fixtures are exempt; they may hold sample exam data.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ENGINE_DIRS = ['src/scoring', 'src/readiness', 'src/model', 'src/verify', 'src/exam'];
const EXAM_NAMES = /\b(gate|jee|neet|cat|upsc|gre|gmat|sat)\b/i;
const failures = [];

function walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || name === '__fixtures__') continue;
      walk(p);
    } else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) {
      readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
        if (EXAM_NAMES.test(line)) failures.push(`${p}:${i + 1}: ${line.trim()}`);
      });
    }
  }
}
ENGINE_DIRS.forEach(walk);
if (failures.length) {
  console.error('Fork Test lint: engine code names an exam. Move the fact into exam.yaml.\n' + failures.join('\n'));
  process.exit(1);
}
console.log('Fork Test lint: clean');
