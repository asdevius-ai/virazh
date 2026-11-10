// PNG-прев'ю маршруту: Playwright + MapLibre GL + растрові тайли OSM.
//   npx tsx tools/preview-route.ts 6841_1 [--out file.png] [--zoom-to <fromM> <toM>]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { chromium } from 'playwright';
import type { Route } from '../src/types';
import { P, ROOT, UA, Pt, haversine, readJson } from './lib';

const args = process.argv.slice(2);
const id = args[0];
if (!id || id.startsWith('--')) {
  console.error('Використання: preview-route.ts <routeId> [--out file.png] [--zoom-to <fromM> <toM>]');
  process.exit(1);
}
const opt = (name: string, n = 1) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.slice(i + 1, i + 1 + n) : null;
};
const outArg = opt('--out');
const zoom = opt('--zoom-to', 2)?.map(Number);
const outFile = outArg ? path.resolve(outArg[0]) : path.join(P.preview, id + '.png');

const route = readJson<Route>(path.join(P.pub, 'routes', id + '.json'));
const srcFile = path.join(P.routesSrc, id + '.yaml');
const waypoints: { lat: number; lng: number }[] = fs.existsSync(srcFile)
  ? ((yaml.load(fs.readFileSync(srcFile, 'utf8')) as any).waypoints ?? [])
  : [];

// ділянка для камери
const coords = route.geometry.coordinates as Pt[];
let fit: Pt[] = coords;
if (zoom && zoom.length === 2 && zoom.every(isFinite)) {
  let d = 0;
  fit = [];
  for (let i = 0; i < coords.length; i++) {
    if (i) d += haversine(coords[i - 1], coords[i]);
    if (d >= zoom[0] && d <= zoom[1]) fit.push(coords[i]);
  }
  if (fit.length < 2) fit = coords;
}
let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
for (const [x, y] of fit) {
  w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y);
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/maplibre-gl.css">
<style>
html,body,#map{margin:0;height:100%;width:100%}
.mk{display:flex;align-items:center;justify-content:center;border-radius:50%;font:bold 12px Arial,sans-serif;border:2px solid #fff;box-shadow:0 0 3px #000;color:#fff}
.mk.big{width:28px;height:28px;font-size:15px}
.mk.wp{width:18px;height:18px;background:#1565c0;font-size:10px}
.mk.uturn{background:#e65100}
</style></head><body><div id="map"></div>
<script type="module">
import * as maplibregl from '/maplibre-gl.mjs';
const D = await (await fetch('/data.json')).json();
const map = new maplibregl.Map({
  container: 'map',
  style: { version: 8, sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19,
    attribution: '© OpenStreetMap contributors' } }, layers: [{ id: 'osm', type: 'raster', source: 'osm' }] },
  bounds: D.bounds, fitBoundsOptions: { padding: 90, maxZoom: 18 }, attributionControl: { compact: false }, fadeDuration: 0, canvasContextAttributes: { preserveDrawingBuffer: true },
});
window.__done = false;
map.on('load', () => {
  const c = document.createElement('canvas'); c.width = 24; c.height = 24;
  const g = c.getContext('2d'); g.fillStyle = '#000'; g.strokeStyle = '#fff'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(4, 4); g.lineTo(21, 12); g.lineTo(4, 20); g.lineTo(9, 12); g.closePath(); g.stroke(); g.fill();
  map.addImage('arrow', g.getImageData(0, 0, 24, 24));
  map.addSource('r', { type: 'geojson', data: { type: 'Feature', geometry: D.line } });
  map.addLayer({ id: 'casing', type: 'line', source: 'r', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#0b5d1e', 'line-width': 8 } });
  map.addLayer({ id: 'line', type: 'line', source: 'r', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#00e04b', 'line-width': 5 } });
  map.addLayer({ id: 'arrows', type: 'symbol', source: 'r', layout: { 'symbol-placement': 'line', 'symbol-spacing': 80, 'icon-image': 'arrow', 'icon-size': 0.8, 'icon-allow-overlap': true, 'icon-rotation-alignment': 'map', 'icon-ignore-placement': true } });
  const mk = (cls, text, lngLat, bg) => {
    const el = document.createElement('div'); el.className = 'mk ' + cls; el.textContent = text; if (bg) el.style.background = bg;
    new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(map);
  };
  D.waypoints.forEach((p, i) => mk('wp' + (p.uturn ? ' uturn' : ''), String(i + 1), [p.lng, p.lat]));
  mk('big', 'S', D.line.coordinates[0], '#1b9e3a');
  mk('big', 'F', D.line.coordinates[D.line.coordinates.length - 1], '#d32f2f');
  const wait = () => { if (map.loaded() && map.areTilesLoaded()) setTimeout(() => { window.__done = true; }, 600); else setTimeout(wait, 200); };
  map.once('idle', wait);
});
</script></body></html>`;

const MIME: Record<string, string> = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html; charset=utf-8' };
const mlDir = path.join(ROOT, 'node_modules', 'maplibre-gl', 'dist');
const dataJson = JSON.stringify({ line: route.geometry, waypoints, bounds: [[w, s], [e, n]] });

const server = http.createServer((req, res) => {
  const u = (req.url ?? '/').split('?')[0];
  let body: Buffer | string | null = null;
  let type = 'text/html; charset=utf-8';
  if (u === '/') body = PAGE;
  else if (u === '/data.json') { body = dataJson; type = MIME['.json']; }
  else {
    const f = path.join(mlDir, path.basename(u));
    if (fs.existsSync(f) && fs.statSync(f).isFile()) { body = fs.readFileSync(f); type = MIME[path.extname(f)] ?? 'application/octet-stream'; }
  }
  if (body === null) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': type });
  res.end(body);
});

async function main() {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as any).port;
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 }, userAgent: `${UA} (preview; Playwright)` });
    const page = await ctx.newPage();
    page.on('pageerror', (er) => console.warn('page error:', er.message));
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction('window.__done === true', undefined, { timeout: 90000 });
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    await page.screenshot({ path: outFile });
    console.log(`PNG: ${outFile}`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((er) => {
  console.error(er);
  process.exit(1);
});
