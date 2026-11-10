// Завантажує офіційні схеми маршрутів ТСЦ у data/raw/<centerId>/.
// Сервер hsc.gov.ua (Akamai) відмовляє curl-у, тому ходимо справжнім браузером.
// Використання: node tools/download-raw.mjs [centerId=6841] [count=20]
import { chromium } from 'playwright';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

const centerId = process.argv[2] ?? '6841';
const count = Number(process.argv[3] ?? 20);
const PAGE = 'https://hsc.gov.ua/m-hmelnitskij-vul-zahidno-okruzhna-11-1-tsts-mvs-6841/';
const outDir = path.resolve('data/raw', centerId);
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: process.env.HEADLESS !== '0' ? true : false });
const ctx = await browser.newContext({
  locale: 'uk-UA',
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
});
const page = await ctx.newPage();
const resp = await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
console.log('page', resp?.status());
const links = await page.$$eval('a[href], img[src]', (els) =>
  els.map((e) => e.getAttribute('href') || e.getAttribute('src')).filter((u) => u && /\.(jpe?g|png)$/i.test(u)),
);
const found = [...new Set(links.filter((u) => new RegExp(`${centerId}[_-]\\d+`).test(u)))];
console.log('found on page:', found.length, found.slice(0, 3));

let ok = 0;
for (let i = 1; i <= count; i++) {
  const file = path.join(outDir, `${centerId}_${i}.jpg`);
  const url =
    found.find((u) => new RegExp(`${centerId}[_-]${i}\\.(jpe?g|png)$`, 'i').test(u)) ??
    `https://hsc.gov.ua/wp-content/uploads/2026/01/${centerId}_${i}.jpg`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await ctx.request.get(url, { headers: { referer: PAGE }, timeout: 60000 });
      const buf = await r.body();
      if (r.ok() && buf.length > 5000 && buf[0] === 0xff && buf[1] === 0xd8) {
        await writeFile(file, buf);
        console.log(i, 'ok', buf.length);
        ok++;
        break;
      }
      console.log(i, 'attempt', attempt, r.status(), buf.length);
    } catch (e) {
      console.log(i, 'attempt', attempt, String(e).slice(0, 100));
    }
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  await new Promise((r) => setTimeout(r, 400));
}
await browser.close();
console.log(`done ${ok}/${count}`);
process.exit(ok === count ? 0 : 1);
