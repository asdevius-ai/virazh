// QA взаємодій (потрібен window.__virazh, тобто dev-сервер). node scripts/qa-prod.mjs [baseUrl]
import { chromium } from 'playwright';
const base = process.argv[2] ?? 'http://localhost:5173/virazh/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errs = [];
page.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 200)));
page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
await page.goto(base + '?mock=1#/center/6841/route/1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__virazh?.map?.loaded(), null, { timeout: 30000 });
await page.waitForTimeout(1500);
const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return r ? { scope: r.scope, active: !!(r.active || r.installing || r.waiting) } : null; });
console.log('sw', JSON.stringify(sw));
const man = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).status);
console.log('manifest', man);
// Скраббер -> 90%, 4x, чекаємо фініш
await page.evaluate(() => window.__virazh.setSpeed(4));
const box = await page.locator('.scrub').boundingBox();
await page.mouse.click(box.x + box.width * 0.97, box.y + box.height / 2);
await page.evaluate(() => window.__virazh.play());
await page.waitForTimeout(3500);
await page.screenshot({ path: 'data/preview/qa-b/p-finish.png' });
console.log('finish badge visible:', await page.locator('.finish-badge').isVisible(), 'play icon label:', await page.locator('.play-btn').getAttribute('aria-label'));
// Drag map -> recenter
await page.locator('.play-btn').click(); // replay from start? (finished => seek 0 and play)
await page.waitForTimeout(500);
await page.mouse.move(200, 400);
await page.mouse.down();
await page.mouse.move(120, 300, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(300);
console.log('recenter visible after drag:', await page.locator('.recenter').isVisible());
await page.screenshot({ path: 'data/preview/qa-b/p-dragged.png' });
await page.locator('.recenter').click();
await page.waitForTimeout(1500);
console.log('recenter hidden after click:', !(await page.locator('.recenter').isVisible()));
// Тап по мінікарті -> весь маршрут
await page.locator('.minimap-wrap').click();
await page.waitForTimeout(1500);
await page.screenshot({ path: 'data/preview/qa-b/p-overview.png' });
// Тап по знаку
await page.evaluate(() => { const m = window.__virazh.map; const p = window.__virazh.route.pois[1]; m.jumpTo({ center: p.coord, zoom: 17, pitch: 0, bearing: 0 }); });
await page.waitForTimeout(1200);
const pt = await page.evaluate(() => { const m = window.__virazh.map; const p = m.project(window.__virazh.route.pois[1].coord); return [p.x, p.y]; });
await page.mouse.click(pt[0], pt[1]);
await page.waitForTimeout(500);
console.log('popup:', await page.locator('.poi-pop').allInnerTexts());
await page.screenshot({ path: 'data/preview/qa-b/p-popup.png' });
// Помилки
await page.goto(base + '?mock=1#/center/6841/route/99');
await page.waitForTimeout(800);
console.log('notfound text:', (await page.locator('.state').innerText()).replace(/\n/g, ' | '));
await page.screenshot({ path: 'data/preview/qa-b/p-notfound.png' });
console.log('errors:', errs.length ? errs : 'none');
await browser.close();
