// QA dev-дігітайзера. Потрібен запущений dev-сервер.
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:5173/virazh/#/digitizer');
await page.waitForTimeout(2500);
for (const [x, y] of [[400, 300], [500, 350], [600, 300]]) await page.mouse.click(x, y);
await page.locator('.digi-pt input[type=checkbox]').nth(1).check();
await page.locator('.digi-pt button').nth(2).click();
await page.getByText('Копіювати YAML').click();
console.log(await page.evaluate(() => navigator.clipboard.readText()));
await page.screenshot({ path: 'data/preview/qa-b/digitizer.png' });
console.log('errors', errs);
await browser.close();
