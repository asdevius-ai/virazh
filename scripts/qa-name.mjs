// QA: довга назва вулиці не ламає плашку. node scripts/qa-name.mjs
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
await page.goto('http://localhost:5173/virazh/#/center/6841/route/1');
await page.waitForSelector('.street-name');
await page.evaluate(() => { document.querySelector('.street-name').textContent = 'вулиця Героїв Небесної Сотні імені Романа Шухевича'; });
const r = await page.evaluate(() => { const c = document.querySelector('.street-card').getBoundingClientRect(); const n = document.querySelector('.street-name'); return { cardH: c.height, cardW: c.width, overflow: n.scrollWidth > n.clientWidth }; });
console.log(JSON.stringify(r));
await page.screenshot({ path: 'data/preview/qa-b/longname.png', clip: { x: 0, y: 0, width: 390, height: 120 } });
await page.goto('http://localhost:5173/virazh/#/center/6841');
await page.waitForSelector('.row');
await page.screenshot({ path: 'data/preview/qa-b/center-real.png' });
await browser.close();
