// Допоміжний скрипт оцифрування: вставляє/замінює опис маршруту в tools/routes-6841.mjs.
// Використання: node tools/add-route.mjs <N> <файл-із-тілом-об'єкта>
// Файл містить JS-об'єкт маршруту без номера: { category: ..., km: ..., waypoints: [...] }
import fs from 'node:fs';
const [n, bodyFile] = process.argv.slice(2);
const body = fs.readFileSync(bodyFile, 'utf8').trim().replace(/,\s*$/, '');
const file = 'tools/routes-6841.mjs';
let s = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const startRe = new RegExp(`\\n  ${n}: \\{\\n[\\s\\S]*?\\n  \\},\\n`);
const entry = `\n  ${n}: ${body
  .split('\n')
  .map((l, i) => (i === 0 ? l : '  ' + l))
  .join('\n')},\n`;
if (startRe.test(s)) s = s.replace(startRe, () => entry);
else s = s.replace('\n};\n\nconst q =', () => `${entry}};\n\nconst q =`);
fs.writeFileSync(file, s);
console.log(`маршрут ${n} записано`);
