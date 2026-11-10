// PreToolUse-хук: якщо будь-який лічильник у usage-state.json >= 85% і для цього
// вікна ще не спрацьовував — блокує виклик (exit 2), щоб агент зробив чекпоінт.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THRESHOLD = 85;
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const stateFile = path.join(dir, 'usage-state.json');
const firedFile = path.join(dir, 'usage-guard-fired.json');

const read = (f) => {
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
};

const state = read(stateFile);
const limits = state?.rate_limits;
if (!limits || typeof limits !== 'object') process.exit(0);

const fired = read(firedFile) ?? {};
const hits = [];
for (const [name, v] of Object.entries(limits)) {
  const pct = Number(v?.used_percentage);
  if (!Number.isFinite(pct) || pct < THRESHOLD) continue;
  // Ключ вікна: час скидання, а якщо його нема — календарна доба.
  const windowKey = String(v?.resets_at ?? new Date().toISOString().slice(0, 10));
  if (fired[name] === windowKey) continue;
  fired[name] = windowKey;
  hits.push(`${name}: ${Math.round(pct)}%`);
}
if (!hits.length) process.exit(0);
try {
  writeFileSync(firedFile, JSON.stringify(fired, null, 2));
} catch {}
process.stderr.write(
  `ЛІМІТ: зроби чекпоінт і зупинись (${hits.join(', ')}). Онови PROGRESS.md, git commit, git push, заверши роботу.`,
);
process.exit(2);
