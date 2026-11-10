// Повний QA (Агент C). Працює з production-збіркою / Pages (без window.__virazh).
// node scripts/qa-all.mjs <baseUrl> [--target=local|pages] [--stage=routes,fps,features,pwa,errors] [--only=1,2,3]
// Результати: data/preview/qa-c/<target>/results-<stage>.json + скріншоти.
import { chromium, devices } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const baseArg = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:4173/virazh/';
const base = baseArg.endsWith('/') ? baseArg : baseArg + '/';
const opt = (n, d) => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).split('=')[1];
const target = opt('target', base.includes('localhost') ? 'local' : 'pages');
const stages = opt('stage', 'home,routes,fps,features,pwa,errors').split(',');
const only = opt('only', '').split(',').filter(Boolean).map(Number);
const vpFilter = opt('vp', 'mobile,desktop').split(',');
const OUT = path.resolve('data/preview/qa-c', target);
fs.mkdirSync(OUT, { recursive: true });

const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const VIEWPORTS = {
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IOS_UA },
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
};
const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const centerJson = JSON.parse(fs.readFileSync('public/data/centers/6841.json', 'utf8'));
const routesMeta = centerJson.routes;
const draftExpected = routesMeta.filter((r) => !r.verified).map((r) => r.number);
const routeNums = (only.length ? only : routesMeta.map((r) => r.number));

const fmtKm = (m) => `${(m / 1000).toFixed(1).replace('.', ',')} км`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${target}]`, ...a);
const save = (stage, data) => fs.writeFileSync(path.join(OUT, `results-${stage}.json`), JSON.stringify(data, null, 2));

async function newCtx(browser, vp) {
  const ctx = await browser.newContext({ ...VIEWPORTS[vp], locale: 'uk-UA' });
  return ctx;
}
function attachCollectors(page) {
  const c = { console: [], pageerror: [], http: [], tileHttp: [], failed: [] };
  page.on('console', (m) => m.type() === 'error' && c.console.push(m.text().slice(0, 250)));
  page.on('pageerror', (e) => c.pageerror.push(e.message.slice(0, 250)));
  page.on('response', (r) => {
    if (r.status() >= 400) {
      const u = r.url();
      (u.includes('openfreemap') || /\/\d+\/\d+\/\d+/.test(u) ? c.tileHttp : c.http).push(`${r.status()} ${u.slice(0, 160)}`);
    }
  });
  page.on('requestfailed', (r) => {
    const u = r.url();
    c.failed.push(`${r.failure()?.errorText} ${u.slice(0, 160)}`);
  });
  return c;
}
async function waitMap(page) {
  await page.waitForSelector('.map .maplibregl-canvas', { timeout: 30000 });
  // чекаємо, поки з'явиться стан після завантаження стилю: канвас + ~2.5с на тайли
  await page.waitForFunction(() => document.querySelectorAll('.maplibregl-canvas').length > 0 && !document.querySelector('.map-error:not(.hidden)'), null, { timeout: 30000 }).catch(() => {});
  await sleep(2500);
}
const progress = async (page) => {
  const t = (await page.locator('.prog-text').first().innerText()).trim();
  const m = t.match(/^(\d+)\s*з\s*(\d+)\s*м$/);
  return m ? { text: t, cur: +m[1], total: +m[2] } : { text: t, cur: NaN, total: NaN };
};
const chip = (page, label) => page.locator('.chip', { hasText: label });

async function pixDiff(a, b) {
  const [ra, rb] = await Promise.all([sharp(a).resize(195).raw().toBuffer(), sharp(b).resize(195).raw().toBuffer()]);
  let diff = 0;
  const n = Math.min(ra.length, rb.length);
  for (let i = 0; i < n; i += 3) if (Math.abs(ra[i] - rb[i]) + Math.abs(ra[i + 1] - rb[i + 1]) + Math.abs(ra[i + 2] - rb[i + 2]) > 40) diff++;
  return diff / (n / 3);
}

// ---------- 1. Головна і центр ----------
async function stageHome(browser) {
  const res = {};
  for (const vp of vpFilter) {
    const ctx = await newCtx(browser, vp);
    const page = await ctx.newPage();
    const col = attachCollectors(page);
    const r = {};
    const dir = path.join(OUT, vp);
    fs.mkdirSync(dir, { recursive: true });
    await page.goto(base + '#/', { waitUntil: 'load' });
    await page.waitForSelector('.row', { timeout: 15000 }).catch(() => {});
    r.homeRows = await page.locator('.row').count();
    r.homeDisclaimer = await page.locator('.disclaimer').isVisible().catch(() => false);
    r.homeAttr = (await page.locator('.attr').innerText().catch(() => '')).includes('OpenStreetMap');
    await page.screenshot({ path: path.join(dir, 'home.png') });
    await page.goto(base + '#/center/6841', { waitUntil: 'load' });
    await page.waitForSelector('.row', { timeout: 15000 }).catch(() => {});
    await sleep(500);
    const rows = await page.locator('.row').evaluateAll((els) =>
      els.map((e) => ({
        num: e.querySelector('.badge-num')?.textContent,
        title: e.querySelector('.row-title')?.textContent,
        sub: e.querySelector('.row-sub')?.textContent,
        draft: !!e.querySelector('.badge-draft'),
      })),
    );
    r.centerRows = rows.length;
    r.lengthMismatch = [];
    for (const m of routesMeta) {
      const row = rows.find((x) => x.num === String(m.number));
      if (!row) r.lengthMismatch.push(`маршрут ${m.number}: немає рядка`);
      else if (!row.sub.startsWith(fmtKm(m.lengthM))) r.lengthMismatch.push(`маршрут ${m.number}: ${row.sub} vs ${fmtKm(m.lengthM)}`);
    }
    r.draftActual = rows.filter((x) => x.draft).map((x) => +x.num);
    r.draftExpected = draftExpected;
    r.draftOk = JSON.stringify(r.draftActual) === JSON.stringify(draftExpected);
    r.centerDisclaimer = await page.locator('.disclaimer').isVisible().catch(() => false);
    r.centerAttr = await page.locator('.attr').isVisible().catch(() => false);
    r.centerAttrText = (await page.locator('.attr').innerText().catch(() => '')).includes('OpenStreetMap');
    // footer може бути нижче за прокрутку
    await page.locator('.scroll').evaluate((e) => (e.scrollTop = e.scrollHeight)).catch(() => {});
    await sleep(200);
    r.centerDisclaimerAfterScroll = await page.locator('.disclaimer').isVisible().catch(() => false);
    r.centerAttrAfterScroll = await page.locator('.attr').isVisible().catch(() => false);
    await page.screenshot({ path: path.join(dir, 'center-bottom.png') });
    await page.locator('.scroll').evaluate((e) => (e.scrollTop = 0)).catch(() => {});
    await page.screenshot({ path: path.join(dir, 'center.png') });
    r.hscroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    r.errors = col;
    res[vp] = r;
    log('home', vp, JSON.stringify({ ...r, errors: undefined }));
    await ctx.close();
  }
  save('home', res);
}

// ---------- 2. Усі маршрути ----------
async function stageRoutes(browser) {
  const res = {};
  for (const vp of vpFilter) {
    res[vp] = {};
    const dir = path.join(OUT, vp);
    fs.mkdirSync(dir, { recursive: true });
    for (const n of routeNums) {
      const ctx = await newCtx(browser, vp);
      const page = await ctx.newPage();
      const col = attachCollectors(page);
      const meta = routesMeta.find((m) => m.number === n);
      const r = { issues: [] };
      try {
        const t0 = Date.now();
        await page.goto(base + `#/center/6841/route/${n}`, { waitUntil: 'load' });
        await waitMap(page);
        r.loadMs = Date.now() - t0;
        r.p0 = await progress(page);
        r.street0 = (await page.locator('.street-name').innerText()).trim();
        await chip(page, '4×').click();
        await page.locator('.play-btn').click();
        await sleep(2500);
        r.p1 = await progress(page);
        await sleep(3500);
        r.p2 = await progress(page);
        r.street2 = (await page.locator('.street-name').innerText()).trim();
        r.nextVisible = await page.locator('.next-card:not(.hidden)').count();
        r.draftBadge = (await page.locator('.street-card .badge-draft').count()) > 0;
        await page.screenshot({ path: path.join(dir, `route-${n}.png`) });
        r.attribVisible = await page.locator('.attrib').isVisible();
        r.totalOk = r.p0.total === Math.round(meta.lengthM);
        r.growing = r.p2.cur > r.p1.cur && r.p1.cur > r.p0.cur;
        r.streetOk = r.street0.length > 0 && r.street2.length > 0;
        r.draftOk = r.draftBadge === !meta.verified;
        if (!r.totalOk) r.issues.push(`M=${r.p0.total} != lengthM ${meta.lengthM}`);
        if (!r.growing) r.issues.push(`прогрес не росте: ${r.p0.cur}/${r.p1.cur}/${r.p2.cur}`);
        if (!r.streetOk) r.issues.push('порожня плашка вулиці');
        if (!r.draftOk) r.issues.push(`позначка «чернетка»: є=${r.draftBadge}, очікувано=${!meta.verified}`);
        if (!r.attribVisible) r.issues.push('атрибуція невидима');
      } catch (e) {
        r.issues.push('виняток: ' + e.message.slice(0, 200));
        await page.screenshot({ path: path.join(dir, `route-${n}-fail.png`) }).catch(() => {});
      }
      r.errors = col;
      const bad = col.console.length + col.pageerror.length + col.http.length;
      if (col.console.length) r.issues.push(`console.error: ${col.console.length}`);
      if (col.pageerror.length) r.issues.push(`pageerror: ${col.pageerror.length}`);
      if (col.http.length) r.issues.push(`HTTP 4xx/5xx: ${col.http.length}`);
      r.ok = r.issues.length === 0;
      res[vp][n] = r;
      log('route', vp, n, r.ok ? 'ok' : 'ISSUES ' + r.issues.join('; '), `tileHttp=${col.tileHttp.length} failed=${col.failed.length}`);
      await ctx.close();
    }
  }
  save('routes', res);
}

// ---------- 3. FPS ----------
async function stageFps(browser) {
  const res = {};
  for (const n of [1, 5, 11]) {
    const ctx = await newCtx(browser, 'mobile');
    const page = await ctx.newPage();
    await page.goto(base + `#/center/6841/route/${n}`, { waitUntil: 'load' });
    await waitMap(page);
    await chip(page, '4×').click();
    await page.locator('.play-btn').click();
    await sleep(1500);
    const r = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const d = [];
          let last = performance.now();
          const t0 = last;
          function f(now) {
            d.push(now - last);
            last = now;
            if (now - t0 < 5000) requestAnimationFrame(f);
            else {
              d.shift();
              const s = [...d].sort((a, b) => a - b);
              const avg = d.reduce((a, b) => a + b, 0) / d.length;
              const p99 = s[Math.min(s.length - 1, Math.floor(s.length * 0.99))];
              resolve({
                frames: d.length,
                avgFps: +(1000 / avg).toFixed(1),
                p99FrameMs: +p99.toFixed(1),
                fps1pct: +(1000 / p99).toFixed(1),
                maxFrameMs: +s[s.length - 1].toFixed(1),
                over33: d.filter((x) => x > 33.4).length,
                over50: d.filter((x) => x > 50).length,
              });
            }
          }
          requestAnimationFrame(f);
        }),
    );
    res[n] = r;
    log('fps route', n, JSON.stringify(r));
    await ctx.close();
  }
  save('fps', res);
}

// ---------- 4. Функції на маршруті 1 ----------
async function stageFeatures(browser) {
  const res = {};
  const meta = routesMeta.find((m) => m.number === 1);
  const route = JSON.parse(fs.readFileSync('public/data/routes/6841_1.json', 'utf8'));
  for (const vp of vpFilter) {
    const r = {};
    const dir = path.join(OUT, vp);
    fs.mkdirSync(dir, { recursive: true });
    const ctx = await newCtx(browser, vp);
    const page = await ctx.newPage();
    const col = attachCollectors(page);
    const check = (k, ok, info) => {
      r[k] = { ok: !!ok, info };
      log('feat', vp, k, ok ? 'ok' : 'FAIL', info ?? '');
    };
    await page.goto(base + `#/center/6841/route/1`, { waitUntil: 'load' });
    await waitMap(page);
    const map = page.locator('.map');
    const scrub = page.locator('.scrub');
    const sb = async () => scrub.boundingBox();
    const clickScrub = async (f) => {
      const b = await sb();
      if (f >= 1) {
        await page.mouse.move(b.x + b.width * 0.9, b.y + b.height / 2);
        await page.mouse.down();
        await page.mouse.move(b.x + b.width + 25, b.y + b.height / 2, { steps: 5 });
        await page.mouse.up();
        await sleep(400);
        return;
      }
      await page.mouse.click(b.x + Math.min(b.width - 1, b.width * f), b.y + b.height / 2);
      await sleep(400);
    };

    // пауза
    await chip(page, '4×').click();
    await page.locator('.play-btn').click();
    await sleep(2000);
    const a1 = await progress(page);
    await page.locator('.play-btn').click(); // пауза
    await sleep(400);
    const a2 = await progress(page);
    await sleep(1800);
    const a3 = await progress(page);
    const lbl = await page.locator('.play-btn').getAttribute('aria-label');
    check('pause', a1.cur > 0 && a2.cur === a3.cur && lbl === 'Грати', `${a1.cur} -> ${a2.cur} -> ${a3.cur}, aria=${lbl}`);

    // скраббер: середина
    await clickScrub(0.5);
    const mid = await progress(page);
    check('scrub_mid', Math.abs(mid.cur / mid.total - 0.5) < 0.06, mid.text);
    await page.screenshot({ path: path.join(dir, 'feat-scrub-mid.png') });
    // скраббер: кінець
    await clickScrub(1);
    await sleep(600);
    const fin = await progress(page);
    const finBadge = await page.locator('.finish-badge:not(.hidden)').count();
    const finLbl = await page.locator('.play-btn').getAttribute('aria-label');
    check('scrub_end', fin.cur === fin.total && finBadge === 1, `${fin.text}, badge=${finBadge}, play aria=${finLbl}`);
    await page.screenshot({ path: path.join(dir, 'feat-finish.png') });
    // «заново»
    await page.locator('.play-btn').click();
    await sleep(1500);
    const rp = await progress(page);
    const badgeAfter = await page.locator('.finish-badge:not(.hidden)').count();
    check('replay', rp.cur < rp.total * 0.2 && badgeAfter === 0, `${rp.text}, badge=${badgeAfter}`);
    await page.locator('.play-btn').click(); // пауза

    // перетягування карти -> «До машинки»
    await clickScrub(0.25);
    const mb = await map.boundingBox();
    const cx = mb.x + mb.width / 2, cy = mb.y + mb.height * 0.6;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 90, cy - 70, { steps: 10 });
    await page.mouse.up();
    await sleep(500);
    const rec1 = await page.locator('.recenter:not(.hidden)').count();
    await page.screenshot({ path: path.join(dir, 'feat-dragged.png') });
    await page.locator('.recenter').click();
    await sleep(800);
    const rec2 = await page.locator('.recenter:not(.hidden)').count();
    check('drag_recenter', rec1 === 1 && rec2 === 0, `після drag=${rec1}, після тапу=${rec2}`);

    // масштаб +/- (пікселі карти змінюються)
    const clip = { x: mb.x, y: mb.y, width: mb.width, height: mb.height };
    const shot0 = await page.screenshot({ clip });
    await page.getByLabel('Збільшити').click();
    await page.getByLabel('Збільшити').click();
    await sleep(1500);
    const shot1 = await page.screenshot({ clip });
    await page.getByLabel('Зменшити').click();
    await page.getByLabel('Зменшити').click();
    await page.getByLabel('Зменшити').click();
    await page.getByLabel('Зменшити').click();
    await sleep(1800);
    const shot2 = await page.screenshot({ clip });
    const d01 = await pixDiff(shot0, shot1), d12 = await pixDiff(shot1, shot2);
    await fs.promises.writeFile(path.join(dir, 'feat-zoom-in.png'), shot1);
    await fs.promises.writeFile(path.join(dir, 'feat-zoom-out.png'), shot2);
    check('zoom', d01 > 0.03 && d12 > 0.03, `зміна пікселів: +2 → ${(d01 * 100).toFixed(1)}%, −4 → ${(d12 * 100).toFixed(1)}%`);

    // тап по знаку: скрабимо до POI, шукаємо іконку навколо машинки
    let popupText = null, popPoi = null;
    outer: for (const poi of route.pois.filter((p) => p.pdrCode).slice(0, 4)) {
      const frac = (poi.distanceAlongM - 25) / meta.lengthM;
      await clickScrub(frac);
      await sleep(1800);
      const car = await page.locator('.car').boundingBox().catch(() => null);
      if (!car) continue;
      const ccx = car.x + car.width / 2, ccy = car.y + car.height / 2;
      const offs = [];
      for (let dy = -160; dy <= 40; dy += 20) for (let dx = -80; dx <= 80; dx += 20) offs.push([dx, dy]);
      offs.sort((p, q) => Math.hypot(p[0], p[1] + 60) - Math.hypot(q[0], q[1] + 60));
      for (const [dx, dy] of offs) {
        await page.mouse.click(ccx + dx, ccy + dy);
        await sleep(120);
        const t = await page.locator('.poi-pop').first().innerText({ timeout: 150 }).catch(() => null);
        if (t) { popupText = t; popPoi = poi; await page.screenshot({ path: path.join(dir, 'feat-popup.png') }); break outer; }
      }
    }
    check('poi_popup', popupText && /\d+\.\d+/.test(popupText), popupText ? `«${popupText.replace(/\n/g, ' ')}» (очікувався ${popPoi.pdrCode} ${popPoi.label})` : 'підпис не знайдено після сканування навколо машинки');

    // мінікарта
    const mmb = await page.locator('.minimap-wrap').boundingBox();
    await page.locator('.minimap-wrap').click();
    await sleep(1600);
    const rec3 = await page.locator('.recenter:not(.hidden)').count();
    await page.screenshot({ path: path.join(dir, 'feat-overview.png') });
    const ovShot = await page.screenshot({ clip });
    check('minimap_overview', rec3 === 1, `«До машинки» з'явилась=${rec3}; (див. feat-overview.png)`);
    r.minimapSize = mmb && `${Math.round(mmb.width)}x${Math.round(mmb.height)}`;

    // «Далі: …»
    await page.locator('.recenter').click().catch(() => {});
    const poi2 = route.pois[1];
    await clickScrub((poi2.distanceAlongM - 100) / meta.lengthM);
    await sleep(800);
    const next = await page.locator('.next-card:not(.hidden)').innerText().catch(() => null);
    const nm = next && next.replace(/\s+/g, ' ').match(/Далі:\s*(.+?)\s*—\s*(\d+)\s*м/);
    await page.screenshot({ path: path.join(dir, 'feat-next.png') });
    check('next_card', !!nm && +nm[2] <= 150 && +nm[2] > 0, next ? next.replace(/\n/g, ' ') : 'плашки немає');
    // перекриття плашок: street-card, next-card, minimap, recenter, zoom
    const boxes = {};
    for (const [k, sel] of Object.entries({ street: '.street-card', next: '.next-card', minimap: '.minimap-wrap', zoom: '.zoom-col', panel: '.panel', recenter: '.recenter', back: '.hud-top .icon-btn', attrib: '.attrib' })) {
      boxes[k] = await page.locator(sel).first().boundingBox().catch(() => null);
    }
    const ov = (a, b) => a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    const overlaps = [];
    const ks = Object.keys(boxes);
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) if (ov(boxes[ks[i]], boxes[ks[j]])) overlaps.push(`${ks[i]}×${ks[j]}`);
    check('hud_overlaps', overlaps.length === 0, overlaps.join(', ') || 'перекриттів немає (у стані «Далі» у стеженні)');

    // назад
    await page.getByLabel('Назад до маршрутів').click();
    await page.waitForSelector('.row', { timeout: 8000 }).catch(() => {});
    const url = page.url();
    check('back', /#\/center\/6841\/?$/.test(url) && (await page.locator('.row').count()) === 20, url);
    r.errors = col;
    res[vp] = r;
    await ctx.close();
  }
  save('features', res);
}

// ---------- 5. PWA ----------
async function stagePwa(browser) {
  const r = {};
  const ctx = await browser.newContext({ ...VIEWPORTS.mobile, locale: 'uk-UA' });
  const page = await ctx.newPage();
  const col = attachCollectors(page);
  const origin = new URL(base).origin;
  await page.goto(base, { waitUntil: 'load' });
  const mUrl = await page.evaluate(() => document.querySelector('link[rel=manifest]')?.href ?? null);
  r.manifestUrl = mUrl;
  const mr = mUrl ? await page.request.get(mUrl) : null;
  r.manifestStatus = mr?.status();
  try {
    const man = await mr.json();
    r.manifestValid = true;
    r.start_url = man.start_url; r.scope = man.scope; r.display = man.display;
    r.icons = [];
    for (const ic of man.icons) {
      const u = new URL(ic.src, mUrl).href;
      const resp = await page.request.get(u);
      r.icons.push({ src: ic.src, status: resp.status(), type: resp.headers()['content-type'] });
    }
  } catch (e) { r.manifestValid = false; r.manifestErr = e.message; }
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.active, null, { timeout: 20000 }).catch(() => {});
  r.sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? { scope: reg.scope, state: (reg.active || reg.installing || reg.waiting)?.state, script: (reg.active || reg.installing || reg.waiting)?.scriptURL } : null;
  });
  r.swFetchStatus = (await page.request.get(base + 'sw.js')).status();
  // відвідати маршрут (кешування даних), потім перезавантаження для контролю SW
  await page.goto(base + '#/center/6841', { waitUntil: 'load' });
  await page.waitForSelector('.row');
  await page.goto(base + '#/center/6841/route/7', { waitUntil: 'load' });
  await waitMap(page);
  await page.reload({ waitUntil: 'load' });
  await waitMap(page);
  r.controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  r.cacheKeys = await page.evaluate(async () => { const o = {}; for (const k of await caches.keys()) o[k] = (await (await caches.open(k)).keys()).length; return o; });
  // офлайн
  await ctx.setOffline(true);
  const off = {};
  try {
    await page.goto(base, { waitUntil: 'load', timeout: 15000 });
    await page.waitForSelector('.row, .state', { timeout: 8000 }).catch(() => {});
    off.home = { rows: await page.locator('.row').count(), state: (await page.locator('.state').innerText().catch(() => '')).replace(/\n/g, ' | ') };
    await page.screenshot({ path: path.join(OUT, 'pwa-offline-home.png') });
  } catch (e) { off.home = { error: e.message.slice(0, 160) }; }
  try {
    await page.goto(base + '#/center/6841', { waitUntil: 'load', timeout: 15000 });
    await sleep(1500);
    off.center = { rows: await page.locator('.row').count(), state: (await page.locator('.state').innerText().catch(() => '')).replace(/\n/g, ' | ') };
  } catch (e) { off.center = { error: e.message.slice(0, 160) }; }
  try {
    await page.goto(base + '#/center/6841/route/7', { waitUntil: 'load', timeout: 15000 });
    await page.reload({ waitUntil: 'load', timeout: 15000 });
    await sleep(4000);
    off.route7 = {
      canvas: await page.locator('.maplibregl-canvas').count(),
      street: await page.locator('.street-name').innerText().catch(() => null),
      prog: await page.locator('.prog-text').innerText().catch(() => null),
      mapError: await page.locator('.map-error:not(.hidden)').count(),
      state: (await page.locator('.state').innerText().catch(() => '')).replace(/\n/g, ' | '),
    };
    await page.screenshot({ path: path.join(OUT, 'pwa-offline-route7.png') });
  } catch (e) { off.route7 = { error: e.message.slice(0, 160) }; }
  try {
    // не відвіданий маршрут офлайн
    await page.goto(base + '#/center/6841/route/15', { waitUntil: 'load', timeout: 15000 });
    await sleep(2500);
    off.route15_unvisited = { state: (await page.locator('.state').innerText().catch(() => '')).replace(/\n/g, ' | '), prog: await page.locator('.prog-text').innerText().catch(() => null) };
  } catch (e) { off.route15_unvisited = { error: e.message.slice(0, 160) }; }
  r.offline = off;
  await ctx.setOffline(false);
  r.errors = col;
  save('pwa', r);
  log('pwa', JSON.stringify({ ...r, errors: undefined }));
  await ctx.close();
}

// ---------- 6. Глибокі посилання / помилки ----------
async function stageErrors(browser) {
  const res = {};
  for (const vp of vpFilter) {
    const dir = path.join(OUT, vp);
    fs.mkdirSync(dir, { recursive: true });
    const ctx = await newCtx(browser, vp);
    const out = {};
    for (const [k, hash] of Object.entries({ deep7: '#/center/6841/route/7', route99: '#/center/6841/route/99', center999: '#/center/999', garbage: '#/foo/bar' })) {
      const page = await ctx.newPage();
      const col = attachCollectors(page);
      await page.goto(base + hash, { waitUntil: 'load' });
      await sleep(4500);
      out[k] = {
        state: (await page.locator('.state').innerText().catch(() => '')).replace(/\n/g, ' | '),
        canvas: await page.locator('.maplibregl-canvas').count(),
        prog: await page.locator('.prog-text').innerText().catch(() => null),
        bodyTextLen: (await page.locator('body').innerText()).trim().length,
        backBtn: await page.locator('.state a.btn').count(),
        errors: { console: col.console, pageerror: col.pageerror },
      };
      await page.screenshot({ path: path.join(dir, `deeplink-${k}.png`) });
      log('errors', vp, k, JSON.stringify(out[k]));
      await page.close();
    }
    res[vp] = out;
    await ctx.close();
  }
  save('errors', res);
}

const browser = await chromium.launch({ args: GL });
const stageFns = { home: stageHome, routes: stageRoutes, fps: stageFps, features: stageFeatures, pwa: stagePwa, errors: stageErrors };
for (const s of stages) {
  if (!stageFns[s]) continue;
  log('=== stage', s);
  try { await stageFns[s](browser); } catch (e) { log('STAGE FAILED', s, e.stack); }
}
await browser.close();
