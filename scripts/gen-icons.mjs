// Генерує PWA-іконки з власного SVG-логотипа. Запуск: node scripts/gen-icons.mjs
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(out, { recursive: true });

// Знак: стилізований поворот дороги (виражу) з бурштиновою стрілкою.
const mark = `
  <path d="M-150 150 L-150 -10 Q-150 -150 -10 -150 L150 -150" fill="none" stroke="#2DD4A7" stroke-width="64" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M-150 150 L-150 -10 Q-150 -150 -10 -150 L150 -150" fill="none" stroke="#0E1116" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="2 44"/>
  <path d="M96 -214 L196 -150 L96 -86 Z" fill="#FFB020"/>`;

const svg = (scale, rounded) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" ${rounded ? 'rx="112"' : ''} fill="#0E1116"/>
  <g transform="translate(256 256) scale(${scale}) translate(-10 0)">${mark}</g>
</svg>`;

const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#0E1116"/>
  <g transform="translate(256 256) scale(0.8) translate(-10 0)">${mark}</g>
</svg>`;
writeFileSync(join(out, 'logo.svg'), logo);

const make = async (name, size, scale, rounded) => {
  await sharp(Buffer.from(svg(scale, rounded))).resize(size, size).png().toFile(join(out, name));
  console.log('ok', name);
};
await make('icon-192.png', 192, 0.8, true);
await make('icon-512.png', 512, 0.8, true);
await make('icon-maskable-512.png', 512, 0.6, false); // безпечна зона maskable
await make('apple-touch-icon.png', 180, 0.8, false); // iOS сам заокруглює
