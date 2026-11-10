// Бухгалтерія після оцифрування маршруту: оновлює PROGRESS.md і таблицю довжин у docs/REVIEW.md.
// Використання: node tools/done-route.mjs <N> [примітка для PROGRESS]
import fs from 'node:fs';
const n = Number(process.argv[2]);
const extra = process.argv[3] ?? '';
const route = JSON.parse(fs.readFileSync(`public/data/routes/6841_${n}.json`, 'utf8'));
const yaml = fs.readFileSync(`data/routes-src/6841_${n}.yaml`, 'utf8');
const official = Number(/officialLengthKm: ([\d.]+)/.exec(yaml)?.[1]);
const km = (route.lengthM / 1000).toFixed(1).replace('.', ',');
const dev = Math.round(((route.lengthM / 1000 - official) / official) * 100);
const state = route.verified ? 'verified' : 'чернетка';

let p = fs.readFileSync('PROGRESS.md', 'utf8').replace(/\r\n/g, '\n');
p = p.replace(
  new RegExp(`\\| ${n} \\|.*\\|`),
  `| ${n} | ${state} | ${km} км проти ${official} офіційних${extra ? '; ' + extra : ''} |`,
);
const rows = [...p.matchAll(/^\| (\d+) \| ([^|]+) \|/gm)].map((m) => m[2].trim());
const v = rows.filter((r) => r === 'verified').length;
const d = rows.filter((r) => r === 'чернетка').length;
const todo = rows.filter((r) => r === 'не почато').length;
p = p.replace(/## Маршрути \(.*\)/, `## Маршрути (${v} verified / ${d} чернеток / ${todo} не почато)`);
const next = n + 1;
p = p.replace(/Оцифрувати маршрут \d+: подивитися `data\/raw\/6841\/6841_\d+\.jpg`/, `Оцифрувати маршрут ${next}: подивитися \`data/raw/6841/6841_${next}.jpg\``);
p = p.replace(/routes-6841\.mjs \d+ && npx tsx tools\/build-route\.ts 6841_\d+ && npx tsx tools\/preview-route\.ts 6841_\d+/, `routes-6841.mjs ${next} && npx tsx tools/build-route.ts 6841_${next} && npx tsx tools/preview-route.ts 6841_${next}`);
p = p.replace(/Оновлено: .*/, `Оновлено: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`);
fs.writeFileSync('PROGRESS.md', p);

let r = fs.readFileSync('docs/REVIEW.md', 'utf8').replace(/\r\n/g, '\n');
const row = `  | ${n} | ${km} км | ${official} км | ${dev > 0 ? '+' : '−'}${Math.abs(dev)}% |`;
const rowRe = new RegExp(`^  \\| ${n} \\|.*$`, 'm');
if (rowRe.test(r)) r = r.replace(rowRe, row);
else {
  const all = [...r.matchAll(/^  \| \d+ \|.*$/gm)];
  const last = all[all.length - 1];
  r = r.slice(0, last.index + last[0].length) + '\n' + row + r.slice(last.index + last[0].length);
}
fs.writeFileSync('docs/REVIEW.md', r);
console.log(`№${n}: ${state}, ${km} км (${dev}%); разом ${v} verified / ${d} чернеток / ${todo} не почато`);
