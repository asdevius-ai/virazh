// QA: скріншоти екранів у двох в'юпортах. Запуск: node scripts/qa-shots.mjs [baseUrl]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173/virazh/';
const out = 'data/preview/qa-b';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
for (const [name, vp, mobile] of [
  ['m', { width: 390, height: 844 }, true],
  ['d', { width: 1280, height: 800 }, false],
]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: mobile ? 2 : 1, hasTouch: mobile, isMobile: mobile });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[${name}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[${name}] pageerror ${e.message}`));
  await page.goto(base + '?mock=1#/', { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${out}/${name}-1-home.png` });
  await page.goto(base + '?mock=1#/center/6841', { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${out}/${name}-2-center.png` });
  await page.goto(base + '?mock=1#/center/6841/route/1', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__virazh?.map?.loaded(), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/${name}-3-player-idle.png` });
  await page.evaluate(() => {
    window.__virazh.setSpeed(4);
    window.__virazh.play();
  });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${out}/${name}-4-player-4x.png` });
  const s = await page.evaluate(() => window.__virazh.s);
  console.log(name, 'distance after 6s @4x:', Math.round(s));
  await ctx.close();
}
await browser.close();
console.log('console errors:', errors.length ? errors : 'none');
