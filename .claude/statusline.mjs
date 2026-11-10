// Статус-рядок: зберігає rate_limits у .claude/usage-state.json і друкує «5h: N%».
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let input = {};
  try {
    input = JSON.parse(raw || '{}');
  } catch {}
  const rl = input.rate_limits;
  if (rl && typeof rl === 'object') {
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        path.join(dir, 'usage-state.json'),
        JSON.stringify({ rate_limits: rl, source: 'statusline', updated_at: new Date().toISOString() }, null, 2),
      );
    } catch {}
  }
  const p = rl?.five_hour?.used_percentage;
  process.stdout.write(typeof p === 'number' ? `5h: ${Math.round(p)}%` : '5h: —');
});
