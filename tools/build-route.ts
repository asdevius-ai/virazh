// Збірка маршруту: data/routes-src/<id>.yaml → public/data/routes/<id>.json (тип Route).
//   npx tsx tools/build-route.ts 6841_1
//   npx tsx tools/build-route.ts --all
import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import simplify from '@turf/simplify';
import { lineString } from '@turf/helpers';
import type { LngLat, PdrSign, PoiType, Route, RoutePoi, StreetSegment } from '../src/types';
import {
  P, Pt, Road, cachedFetch, fmt, haversine, loadRoads, projectOnSegment, readJson, round6, toXY, writeJson, roadName,
} from './lib';
import { lookupSign } from './sign-map';

interface Waypoint {
  lat: number;
  lng: number;
  uturn?: boolean;
  note?: string;
}
interface RouteSrc {
  id: string;
  number: number;
  name: string;
  category: string;
  sourceImage: string;
  officialLengthKm?: number;
  verified: boolean;
  notes?: string;
  streets?: string[];
  waypoints: Waypoint[];
}

const OSRM_BASES = [
  'https://router.project-osrm.org/route/v1/driving',
  'https://routing.openstreetmap.de/routed-car/route/v1/driving',
];
const MAX_COORDS = 90; // ліміт публічного OSRM — 100 координат на запит

// ---------- OSRM ----------

interface RawPath {
  pts: Pt[];
  /** ім'я для відрізка pts[k] → pts[k+1] */
  segNames: string[];
}
interface Snap {
  wpIndex: number;
  distance: number;
  name: string;
}

async function osrmRoute(coords: Pt[]): Promise<any> {
  const c = coords.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join(';');
  const q = '?overview=full&geometries=geojson&steps=true&continue_straight=true';
  let last: unknown;
  for (const base of OSRM_BASES) {
    try {
      const txt = await cachedFetch(`${base}/${c}${q}`, { retries: 3 });
      const j = JSON.parse(txt);
      if (j.code !== 'Ok') throw new Error(`OSRM ${j.code}: ${j.message ?? ''}`);
      return j;
    } catch (e) {
      last = e;
      console.warn(`  ! ${new URL(base).host}: ${(e as Error).message}`);
      // NoRoute/NoSegment — помилка даних, а не сервера: запасний сервер не допоможе
      if (/NoRoute|NoSegment|InvalidQuery/.test((e as Error).message)) break;
    }
  }
  throw last;
}

async function buildRaw(wps: Waypoint[]): Promise<{ raw: RawPath; snaps: Snap[] }> {
  // розбиття на частини в точках uturn
  const parts: number[][] = [];
  let cur = [0];
  for (let i = 1; i < wps.length; i++) {
    cur.push(i);
    if (wps[i].uturn && i < wps.length - 1) {
      parts.push(cur);
      cur = [i];
    }
  }
  parts.push(cur);
  // нарізка частин за лімітом координат
  const chunks: number[][] = [];
  for (const part of parts) {
    for (let s = 0; s < part.length - 1; s += MAX_COORDS - 1) chunks.push(part.slice(s, s + MAX_COORDS));
  }
  const pts: Pt[] = [];
  const segNames: string[] = [];
  const snaps: Snap[] = [];
  const push = (p: Pt, nameForSegToHere: string) => {
    if (pts.length && haversine(pts[pts.length - 1], p) < 0.05) return; // дубль стику
    if (pts.length) segNames.push(nameForSegToHere);
    pts.push(p);
  };
  for (const ch of chunks) {
    if (ch.length < 2) continue;
    const resp = await osrmRoute(ch.map((i) => [wps[i].lng, wps[i].lat] as Pt));
    const rt = resp.routes[0];
    resp.waypoints.forEach((w: any, k: number) => snaps.push({ wpIndex: ch[k], distance: w.distance, name: w.name || '' }));
    for (const leg of rt.legs) {
      for (const st of leg.steps) {
        const g: Pt[] = st.geometry.coordinates;
        const nm: string = st.name || '';
        g.forEach((p, k) => {
          if (pts.length === 0) push(p, nm);
          else if (k === 0) {
            // перша точка кроку збігається з кінцем попереднього; якщо ні — з'єднуємо під іменем кроку
            if (haversine(pts[pts.length - 1], p) >= 0.05) push(p, nm);
          } else push(p, nm);
        });
      }
    }
  }
  return { raw: { pts, segNames }, snaps };
}

// ---------- геометричні утиліти ----------

function cumDist(pts: Pt[]): number[] {
  const c = [0];
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + haversine(pts[i - 1], pts[i]));
  return c;
}

/** Напрям відрізка в локальних метрах [x, y]. */
function vec(a: Pt, b: Pt): [number, number] {
  return toXY(b, a);
}
function cosAngle(u: [number, number], v: [number, number]): number {
  const m = Math.hypot(...u) * Math.hypot(...v);
  return m === 0 ? 0 : (u[0] * v[0] + u[1] * v[1]) / m;
}
function bearingDeg(a: Pt, b: Pt): number {
  const [x, y] = vec(a, b);
  return (Math.atan2(x, y) * 180) / Math.PI;
}
function angDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

// ---------- streets ----------

interface Run {
  name: string;
  i0: number; // індекс першої вершини
  i1: number; // індекс останньої вершини
}

function makeRuns(raw: RawPath): Run[] {
  let runs: Run[] = [];
  raw.segNames.forEach((nm, k) => {
    const last = runs[runs.length - 1];
    if (last && last.name === nm) last.i1 = k + 1;
    else runs.push({ name: nm, i0: k, i1: k + 1 });
  });
  // дрібні безіменні відрізки (< 20 м) приєднуємо до сусіда
  const cum = cumDist(raw.pts);
  const len = (r: Run) => cum[r.i1] - cum[r.i0];
  for (let pass = 0; pass < 3; pass++) {
    const out: Run[] = [];
    for (let k = 0; k < runs.length; k++) {
      const r = runs[k];
      if (r.name === '' && len(r) < 20 && runs.length > 1) {
        if (out.length) out[out.length - 1].i1 = r.i1;
        else runs[k + 1].i0 = r.i0;
        continue;
      }
      const prev = out[out.length - 1];
      if (prev && prev.name === r.name) prev.i1 = r.i1;
      else out.push({ ...r });
    }
    runs = out;
  }
  return runs;
}

// ---------- POI ----------

interface PoiFeat {
  geometry: { coordinates: Pt };
  properties: Record<string, string | number>;
}
interface PoiCand {
  type: PoiType;
  pdrCode?: string;
  label?: string;
  coord: Pt;
  props: Record<string, string | number>;
  nodeId: number;
}

const BUMP = new Set(['bump', 'hump', 'table', 'cushion', 'yes', 'rumble_strip']);

function classify(f: PoiFeat): { type: PoiType; pdrCode?: string; label?: string }[] {
  const p = f.properties;
  const out: { type: PoiType; pdrCode?: string; label?: string }[] = [];
  const hw = p.highway as string | undefined;
  if (hw === 'crossing') out.push({ type: 'crossing' });
  if (hw === 'crossing' && p.crossing === 'traffic_signals') out.push({ type: 'traffic_signals' });
  if (hw === 'traffic_signals') out.push({ type: 'traffic_signals' });
  if (hw === 'give_way') out.push({ type: 'give_way' });
  if (hw === 'stop') out.push({ type: 'stop' });
  if (hw === 'bus_stop') out.push({ type: 'bus_stop' });
  if (p.railway === 'level_crossing') out.push({ type: 'level_crossing' });
  if (p.traffic_calming && BUMP.has(String(p.traffic_calming)) && p.traffic_calming !== 'rumble_strip') {
    out.push({ type: 'speed_bump' });
  }
  if (!out.length && p.traffic_sign) {
    const s = lookupSign(String(p.traffic_sign));
    if (s) out.push({ type: 'sign', pdrCode: s.code, label: s.label });
  }
  return out;
}

// ---------- основна збірка ----------

interface Report {
  lines: string[];
  warn: string[];
}

async function buildRoute(id: string): Promise<void> {
  const srcFile = path.join(P.routesSrc, id + '.yaml');
  if (!fs.existsSync(srcFile)) throw new Error(`Немає ${srcFile}`);
  const src = yaml.load(fs.readFileSync(srcFile, 'utf8')) as RouteSrc;
  if (!src.waypoints || src.waypoints.length < 2) throw new Error('Потрібно ≥ 2 опорні точки');
  const centerId = id.split('_')[0];
  const rep: Report = { lines: [], warn: [] };
  console.log(`\n=== ${id}: ${src.name} (${src.waypoints.length} опорних точок) ===`);

  const { raw, snaps } = await buildRaw(src.waypoints);
  const rawCum = cumDist(raw.pts);
  const rawLen = rawCum[rawCum.length - 1];

  // --- streets / спрощення по відрізках однієї вулиці (межі вулиць не зсуваються) ---
  const runs = makeRuns(raw);
  const line: Pt[] = [];
  const runStart: number[] = []; // індекс у спрощеній лінії, де починається run
  for (const r of runs) {
    const seg = raw.pts.slice(r.i0, r.i1 + 1).map((p) => [round6(p[0]), round6(p[1])] as Pt);
    let s = seg;
    if (seg.length > 2) {
      s = simplify(lineString(seg), { tolerance: 0.00002, highQuality: true }).geometry.coordinates as Pt[];
    }
    runStart.push(line.length ? line.length - 1 : 0);
    for (let k = line.length ? 1 : 0; k < s.length; k++) line.push(s[k]);
  }
  const cum = cumDist(line);
  const lengthM = Math.round(cum[cum.length - 1]);

  const streets: StreetSegment[] = [];
  runs.forEach((r, k) => {
    const from = k === 0 ? 0 : Math.round(cum[runStart[k]]);
    const to = k === runs.length - 1 ? lengthM : Math.round(cum[runStart[k + 1]]);
    if (to <= from) return;
    const prev = streets[streets.length - 1];
    if (prev && prev.name === r.name) prev.toM = to;
    else streets.push({ name: r.name, fromM: from, toM: to });
  });
  if (streets.length) {
    streets[0].fromM = 0;
    streets[streets.length - 1].toM = lengthM;
    for (let k = 1; k < streets.length; k++) streets[k].fromM = streets[k - 1].toM;
  }

  // проєкція довільної точки на спрощену лінію
  const project = (p: Pt) => {
    let best = { dist: Infinity, along: 0, seg: 0, point: line[0] };
    for (let k = 1; k < line.length; k++) {
      const pr = projectOnSegment(p, line[k - 1], line[k]);
      if (pr.dist < best.dist) {
        best = { dist: pr.dist, along: cum[k - 1] + pr.t * (cum[k] - cum[k - 1]), seg: k - 1, point: pr.point };
      }
    }
    return best;
  };

  // --- POI ---
  const roads = loadRoads();
  const nodeWays = new Map<number, { way: Road; i: number }[]>();
  for (const r of roads) r.nodes.forEach((n, i) => {
    if (!nodeWays.has(n)) nodeWays.set(n, []);
    nodeWays.get(n)!.push({ way: r, i });
  });
  const signs = readJson<PdrSign[]>(path.join(P.pub, 'pdr-signs.json'));
  const signBy = new Map(signs.map((s) => [s.type, s]));
  const feats = readJson<{ features: PoiFeat[] }>(path.join(P.osm, 'pois.geojson')).features;

  // bbox лінії з відступом ~30 м
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of line) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const pad = 0.0004;

  interface Found extends RoutePoi { _dist: number }
  const found: Found[] = [];
  for (const f of feats) {
    const c = f.geometry.coordinates;
    if (c[0] < minX - pad || c[0] > maxX + pad || c[1] < minY - pad || c[1] > maxY + pad) continue;
    const types = classify(f);
    if (!types.length) continue;
    const nodeId = Number(f.properties.osm_id);
    const onWay = nodeWays.get(nodeId);
    // кандидати проходів: усі відрізки в межах 15 м
    const cands: { seg: number; dist: number; along: number; point: Pt }[] = [];
    for (let k = 1; k < line.length; k++) {
      const pr = projectOnSegment(c, line[k - 1], line[k]);
      if (pr.dist <= 15) cands.push({ seg: k - 1, dist: pr.dist, along: cum[k - 1] + pr.t * (cum[k] - cum[k - 1]), point: pr.point });
    }
    if (!cands.length) continue;
    cands.sort((a, b) => a.along - b.along);
    const clusters: (typeof cands)[] = [];
    for (const cd of cands) {
      const last = clusters[clusters.length - 1];
      if (last && cd.along - last[last.length - 1].along <= 100) last.push(cd);
      else clusters.push([cd]);
    }
    for (const cl of clusters) {
      const best = cl.reduce((a, b) => (b.dist < a.dist ? b : a));
      // вузол на дорозі: має бути майже на лінії і дорога має йти паралельно маршруту
      let dirOk = true;
      if (onWay) {
        if (best.dist > 6) continue;
        const rv: [number, number][] = [];
        for (const s of [best.seg - 1, best.seg, best.seg + 1]) if (s >= 0 && s < line.length - 1) rv.push(vec(line[s], line[s + 1]));
        const wvs: [number, number][] = [];
        for (const { way, i } of onWay) {
          if (i > 0) wvs.push(vec(way.geometry[i - 1], way.geometry[i]));
          if (i < way.geometry.length - 1) wvs.push(vec(way.geometry[i], way.geometry[i + 1]));
        }
        if (!rv.some((r) => wvs.some((w) => Math.abs(cosAngle(r, w)) >= 0.5))) continue;
        // напрям знака give_way/stop
        const dir = f.properties.direction as string | undefined;
        if ((dir === 'forward' || dir === 'backward') && types.some((t) => t.type === 'give_way' || t.type === 'stop')) {
          const r0 = vec(line[best.seg], line[best.seg + 1]);
          let bestW = wvs[0], bc = 0;
          for (const w of wvs) if (Math.abs(cosAngle(r0, w)) >= Math.abs(bc)) { bc = cosAngle(r0, w); bestW = w; }
          // wvs містять вектори в напрямку way, тож знак cos відповідає forward/backward
          void bestW;
          dirOk = dir === 'forward' ? bc > 0 : bc < 0;
        }
      } else if (f.properties.highway === 'bus_stop' && best.dist > 3) {
        // правосторонній рух: зупинка має бути праворуч від напрямку руху
        const a = line[best.seg], b = line[best.seg + 1];
        const [bx, by] = vec(a, b);
        const [px, py] = vec(a, c);
        if (bx * py - by * px > 0) continue; // ліворуч
      }
      if (!dirOk) continue;
      for (const t of types) {
        const sg = signBy.get(t.type);
        if (!sg) continue;
        found.push({
          id: '',
          routeId: id,
          type: t.type,
          ...(t.type === 'sign' ? { pdrCode: t.pdrCode } : sg.pdrCode ? { pdrCode: sg.pdrCode } : {}),
          label: t.type === 'sign' ? t.label! : sg.label,
          coord: [round6(best.point[0]), round6(best.point[1])] as LngLat,
          distanceAlongM: Math.round(best.along),
          _dist: best.dist,
        });
      }
    }
  }

  // в'їзди на кола: перехід у way з junction=roundabout
  const rbNodes: Pt[] = [];
  for (const r of roads) if (r.tags.junction === 'roundabout') rbNodes.push(...r.geometry);
  let inRb = false;
  const rbSg = signBy.get('roundabout');
  for (let k = 0; k < raw.pts.length && rbSg; k++) {
    const p = raw.pts[k];
    const near = rbNodes.some((n) => Math.abs(n[0] - p[0]) < 0.00005 && Math.abs(n[1] - p[1]) < 0.00003 && haversine(n, p) < 2.5);
    if (near && !inRb) {
      const pr = project(p);
      found.push({
        id: '', routeId: id, type: 'roundabout', ...(rbSg.pdrCode ? { pdrCode: rbSg.pdrCode } : {}), label: rbSg.label,
        coord: [round6(pr.point[0]), round6(pr.point[1])] as LngLat, distanceAlongM: Math.round(pr.along), _dist: pr.dist,
      });
    }
    inRb = near;
  }

  // дублікати одного типу ближче 12 м уздовж маршруту — зливаємо
  found.sort((a, b) => a.distanceAlongM - b.distanceAlongM || a._dist - b._dist);
  const kept: Found[] = [];
  for (const f of found) {
    const dup = kept.find((k) => k.type === f.type && Math.abs(k.distanceAlongM - f.distanceAlongM) < 12);
    if (!dup) kept.push(f);
  }
  const pois: RoutePoi[] = kept.map((f, i) => {
    const { _dist, ...rest } = f;
    void _dist;
    return { ...rest, id: `${id}-p${i + 1}` };
  });

  // --- запис ---
  const route: Route = {
    id,
    number: src.number,
    name: src.name,
    category: src.category,
    lengthM,
    verified: !!src.verified,
    centerId,
    geometry: { type: 'LineString', coordinates: line.map((p) => [p[0], p[1]] as LngLat) },
    sourceImage: src.sourceImage,
    ...(src.notes ? { notes: src.notes } : {}),
    pois,
    streets,
  };
  writeJson(path.join(P.pub, 'routes', id + '.json'), route);

  // ---------- звіт перевірок ----------
  const out = (s: string) => console.log(s);
  out(`Файл: public/data/routes/${id}.json  (вершин: ${line.length}, сирих: ${raw.pts.length}; сира довжина ${Math.round(rawLen)} м)`);
  if (src.officialLengthKm) {
    const dev = ((lengthM / 1000 - src.officialLengthKm) / src.officialLengthKm) * 100;
    out(`Довжина: ${(lengthM / 1000).toFixed(2)} км vs офіційні ${src.officialLengthKm} км  (${dev >= 0 ? '+' : ''}${dev.toFixed(1)}%)${Math.abs(dev) > 15 ? '  ПОПЕРЕДЖЕННЯ: відхилення > 15%' : ''}`);
  } else out(`Довжина: ${(lengthM / 1000).toFixed(2)} км (officialLengthKm не задано)`);

  try {
    const centers = yaml.load(fs.readFileSync(P.centersSrc, 'utf8')) as { id: string; coord: LngLat }[];
    const ctr = centers.find((c) => c.id === centerId);
    if (ctr) {
      const ds = haversine(line[0], ctr.coord as Pt);
      const df = haversine(line[line.length - 1], ctr.coord as Pt);
      out(`До ТСЦ: старт ${Math.round(ds)} м${ds > 100 ? ' ПОПЕРЕДЖЕННЯ' : ''}, фініш ${Math.round(df)} м${df > 100 ? ' ПОПЕРЕДЖЕННЯ' : ''}`);
    }
  } catch { /* центр не обов'язковий */ }

  const snapLines: string[] = [];
  const seen = new Set<string>();
  for (const s of snaps) {
    const key = `${s.wpIndex}`;
    const w = src.waypoints[s.wpIndex];
    const flag = s.distance > 25 ? '  ПОПЕРЕДЖЕННЯ >25 м' : '';
    const l = `  #${s.wpIndex + 1} ${fmt([w.lng, w.lat])} → ${s.distance.toFixed(0)} м, «${s.name || '(без назви)'}»${w.note ? ` (${w.note})` : ''}${flag}`;
    if (seen.has(key)) continue; // точки uturn/стику траплялись двічі — друкуємо одну
    seen.add(key);
    if (s.distance > 25 || s.distance > 10) snapLines.push(l);
  }
  out(`Притягування опорних точок OSRM (показано > 10 м; усього ${src.waypoints.length}, макс ${Math.max(...snaps.map((s) => s.distance)).toFixed(0)} м):`);
  out(snapLines.length ? snapLines.join('\n') : '  усі ≤ 10 м');

  // підозрілі розвороти (на сирій геометрії)
  const uturnWps = src.waypoints.filter((w) => w.uturn).map((w) => [w.lng, w.lat] as Pt);
  const rbFlag = raw.pts.map((p) => rbNodes.some((n) => Math.abs(n[0] - p[0]) < 0.00005 && Math.abs(n[1] - p[1]) < 0.00003 && haversine(n, p) < 2.5));
  const susp: string[] = [];
  let lastFlagAlong = -1e9;
  for (let i = 1; i < raw.pts.length - 1; i++) {
    let a = i + 1;
    while (a < raw.pts.length - 1 && haversine(raw.pts[i], raw.pts[a]) < 3) a++;
    let j = i;
    while (j + 1 < raw.pts.length && rawCum[j + 1] - rawCum[i] <= 40) j++;
    if (j <= a) continue;
    let b = j - 1;
    while (b > a && haversine(raw.pts[b], raw.pts[j]) < 3) b--;
    const h1 = bearingDeg(raw.pts[i], raw.pts[a]);
    const h2 = bearingDeg(raw.pts[b], raw.pts[j]);
    if (angDiff(h1, h2) <= 150) continue;
    if (rbFlag[i] || rbFlag[j]) continue;
    if (uturnWps.some((u) => haversine(u, raw.pts[i]) < 60)) continue;
    if (rawCum[i] - lastFlagAlong < 60) continue;
    lastFlagAlong = rawCum[i];
    susp.push(`  ~${Math.round(rawCum[i])} м від старту: ${fmt(raw.pts[i])} (зміна курсу ${angDiff(h1, h2).toFixed(0)}°)`);
  }
  out(`Підозрілі розвороти: ${susp.length ? susp.length + '  ПОПЕРЕДЖЕННЯ' : 'немає'}`);
  if (susp.length) out(susp.join('\n'));

  out(`streets (${streets.length}):`);
  for (const s of streets) out(`  ${String(s.fromM).padStart(6)}–${String(s.toM).padEnd(6)} ${String(s.toM - s.fromM).padStart(5)} м  ${s.name || '(без назви)'}`);

  const counts: Record<string, number> = {};
  for (const p of pois) counts[p.type] = (counts[p.type] ?? 0) + 1;
  out(`POI (${pois.length}): ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(', ') || 'немає'}`);
  void roadName;
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Використання: build-route.ts <routeId> | --all');
    process.exit(1);
  }
  const ids =
    arg === '--all'
      ? fs.readdirSync(P.routesSrc).filter((f) => f.endsWith('.yaml')).map((f) => f.replace(/\.yaml$/, ''))
      : [arg];
  let failed = 0;
  for (const id of ids) {
    try {
      await buildRoute(id);
    } catch (e) {
      failed++;
      console.error(`ПОМИЛКА ${id}: ${(e as Error).message}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

main();
