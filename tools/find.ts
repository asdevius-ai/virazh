// Помічник оцифрування: пошук вулиць, перетинів і доріг поблизу за data/osm/roads.json.
//   npx tsx tools/find.ts "Назва А" "Назва Б"   — перетини двох вулиць
//   npx tsx tools/find.ts "Назва А"             — опис вулиці
//   npx tsx tools/find.ts --near <lat> <lng> [radiusM=80]
import path from 'node:path';
import { P, Pt, Road, fmt, haversine, loadRoads, normName, projectOnSegment, readJson, roadName } from './lib';

const roads = loadRoads();

interface PoiF {
  geometry: { coordinates: Pt };
  properties: Record<string, string | number>;
}
const pois = readJson<{ features: PoiF[] }>(path.join(P.osm, 'pois.geojson')).features;
const signalNodes = new Set<number>();
for (const f of pois) if (f.properties.highway === 'traffic_signals') signalNodes.add(Number(f.properties.osm_id));

// ---- індекс вузлів ----
interface NodeInfo {
  pt: Pt;
  ways: Road[];
  /** кількість «плечей» (кінець шляху = 1, внутрішній вузол = 2, пара якщо шлях замкнений) */
  arms: number;
}
const nodes = new Map<number, NodeInfo>();
for (const r of roads) {
  r.nodes.forEach((id, i) => {
    let n = nodes.get(id);
    if (!n) nodes.set(id, (n = { pt: r.geometry[i], ways: [], arms: 0 }));
    if (!n.ways.includes(r)) n.ways.push(r);
    n.arms += i === 0 || i === r.nodes.length - 1 ? 1 : 2;
  });
}

// ---- пошук назв ----
function namesOf(r: Road): string[] {
  return [r.tags['name:uk'], r.tags.name].filter((x): x is string => !!x);
}

/** Вулиці за запитом: точний збіг нормалізованої назви має пріоритет над підрядком. */
function matchStreet(q: string): { ways: Road[]; variants: Map<string, number>; others: string[] } {
  const nq = normName(q);
  const exact: Road[] = [];
  const sub: Road[] = [];
  for (const r of roads) {
    const ns = namesOf(r).map(normName);
    if (ns.some((n) => n === nq)) exact.push(r);
    else if (ns.some((n) => n.includes(nq))) sub.push(r);
  }
  const ways = exact.length ? exact : sub;
  const variants = new Map<string, number>();
  for (const r of ways) variants.set(roadName(r), (variants.get(roadName(r)) ?? 0) + 1);
  const others = exact.length ? [...new Set(sub.map(roadName))].slice(0, 8) : [];
  return { ways, variants, others };
}

function wayLen(r: Road): number {
  let s = 0;
  for (let i = 1; i < r.geometry.length; i++) s += haversine(r.geometry[i - 1], r.geometry[i]);
  return s;
}

function junctionType(id: number): string {
  const n = nodes.get(id)!;
  const parts: string[] = [];
  if (n.ways.some((w) => w.tags.junction === 'roundabout')) parts.push('кільце');
  else parts.push(n.arms === 3 ? 'T' : n.arms === 4 ? 'X' : n.arms > 4 ? `${n.arms} плечей` : `${n.arms} плеча`);
  if (signalNodes.has(id)) parts.push('світлофор');
  return parts.join(', ');
}

// ---- режим: два імені ----
function twoStreets(qa: string, qb: string) {
  const A = matchStreet(qa);
  const B = matchStreet(qb);
  if (!A.ways.length || !B.ways.length) {
    console.log(`Не знайдено: ${!A.ways.length ? qa : ''} ${!B.ways.length ? qb : ''}`.trim());
    return;
  }
  console.log(`A: ${[...A.variants.keys()].join(' | ')}${A.others.length ? `  (також підрядком: ${A.others.join(', ')})` : ''}`);
  console.log(`B: ${[...B.variants.keys()].join(' | ')}${B.others.length ? `  (також підрядком: ${B.others.join(', ')})` : ''}`);
  const bSet = new Set(B.ways);
  const found: { id: number; pt: Pt }[] = [];
  const seen = new Set<number>();
  for (const a of A.ways) {
    for (const id of a.nodes) {
      const n = nodes.get(id)!;
      if (!seen.has(id) && n.ways.some((w) => bSet.has(w))) {
        seen.add(id);
        found.push({ id, pt: n.pt });
      }
    }
  }
  if (found.length) {
    console.log(`Спільні вузли (${found.length}):`);
    for (const f of found) console.log(`  ${fmt(f.pt)}  ${junctionType(f.id)}  (node ${f.id})`);
    return;
  }
  // запасний варіант: найближчі пари точок до 40 м
  console.log('Спільних вузлів немає. Найближчі точки (до 40 м):');
  const pairs: { d: number; a: Pt; b: Pt }[] = [];
  for (const a of A.ways) {
    for (const p of a.geometry) {
      for (const b of B.ways) {
        for (let i = 1; i < b.geometry.length; i++) {
          const pr = projectOnSegment(p, b.geometry[i - 1], b.geometry[i]);
          if (pr.dist <= 40) pairs.push({ d: pr.dist, a: p, b: pr.point });
        }
      }
    }
  }
  pairs.sort((x, y) => x.d - y.d);
  const out: typeof pairs = [];
  for (const p of pairs) if (!out.some((o) => haversine(o.a, p.a) < 40)) out.push(p);
  if (!out.length) console.log('  нічого');
  for (const p of out.slice(0, 10)) console.log(`  ${p.d.toFixed(0)} м: A ${fmt(p.a)}  B ${fmt(p.b)}`);
}

// ---- режим: одна вулиця ----
interface Edge {
  way: Road;
  i: number; // ребро між вузлами i та i+1
  visited: boolean;
}

function oneStreet(q: string) {
  const S = matchStreet(q);
  if (!S.ways.length) {
    console.log(`Не знайдено: ${q}`);
    return;
  }
  const wset = new Set(S.ways);
  console.log(`Варіанти назв: ${[...S.variants].map(([n, c]) => `«${n}» (${c} ділянок)`).join('; ')}`);
  if (S.others.length) console.log(`Також підрядком: ${S.others.join(', ')}`);
  let lo = Infinity, hi = -Infinity, wl = Infinity, el = -Infinity, total = 0;
  for (const r of S.ways) {
    total += wayLen(r);
    for (const [x, y] of r.geometry) {
      lo = Math.min(lo, y); hi = Math.max(hi, y); wl = Math.min(wl, x); el = Math.max(el, x);
    }
  }
  console.log(`bbox: lat ${lo.toFixed(6)}..${hi.toFixed(6)}, lng ${wl.toFixed(6)}..${el.toFixed(6)}; сумарна довжина ${Math.round(total)} м`);

  // граф ребер
  const adj = new Map<number, Edge[]>();
  const edges: Edge[] = [];
  for (const r of S.ways) {
    for (let i = 0; i + 1 < r.nodes.length; i++) {
      const e: Edge = { way: r, i, visited: false };
      edges.push(e);
      for (const id of [r.nodes[i], r.nodes[i + 1]]) {
        if (!adj.has(id)) adj.set(id, []);
        adj.get(id)!.push(e);
      }
    }
  }
  const startsPref = [...adj.entries()].filter(([, es]) => es.length === 1).map(([id]) => id);
  const chains: { id: number; e?: Edge; fwd?: boolean }[][] = [];
  const walk = (start: number) => {
    const chain: { id: number; e?: Edge; fwd?: boolean }[] = [{ id: start }];
    let cur = start;
    for (;;) {
      const nxt = (adj.get(cur) ?? []).find((e) => !e.visited);
      if (!nxt) break;
      nxt.visited = true;
      const a = nxt.way.nodes[nxt.i];
      const b = nxt.way.nodes[nxt.i + 1];
      const fwd = a === cur;
      cur = fwd ? b : a;
      chain.push({ id: cur, e: nxt, fwd });
    }
    return chain;
  };
  for (const s of startsPref) if ((adj.get(s) ?? []).some((e) => !e.visited)) chains.push(walk(s));
  for (const e of edges) if (!e.visited) chains.push(walk(e.way.nodes[e.i]));

  console.log(`Ланцюгів (непересічних шляхів): ${chains.length}`);
  chains.forEach((chain, ci) => {
    const pts: Pt[] = chain.map((c) => nodes.get(c.id)!.pt);
    const cum: number[] = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversine(pts[i - 1], pts[i]));
    const len = cum[cum.length - 1];
    console.log(`\n[${ci + 1}] довжина ${Math.round(len)} м; початок ${fmt(pts[0])} → кінець ${fmt(pts[pts.length - 1])}`);
    // точки кожні ~300 м
    const samples: string[] = [];
    let next = 0;
    for (let i = 0; i < pts.length; i++) {
      if (cum[i] >= next || i === pts.length - 1) {
        samples.push(`${Math.round(cum[i])}м ${fmt(pts[i])}`);
        next = cum[i] + 300;
      }
    }
    console.log('  точки: ' + samples.join(' | '));
    // oneway-ділянки
    const ow: string[] = [];
    chain.forEach((c, i) => {
      if (!c.e) return;
      const o = c.e.way.tags.oneway;
      const isOw = o === 'yes' || o === '-1' || o === 'true' || c.e.way.tags.junction === 'roundabout';
      if (!isOw) return;
      const wayDir = o === '-1' ? !c.fwd : c.fwd; // true — рух збігається з порядком ланцюга
      const lab = `${Math.round(cum[i - 1])}..${Math.round(cum[i])}м ${wayDir ? 'вздовж' : 'проти'} ланцюга`;
      const last = ow[ow.length - 1];
      if (last && last.endsWith(lab.slice(lab.indexOf('м ') + 2)) && last.includes(`..${Math.round(cum[i - 1])}м`)) {
        ow[ow.length - 1] = last.replace(/\.\.\d+м/, `..${Math.round(cum[i])}м`);
      } else ow.push(lab);
    });
    console.log('  oneway: ' + (ow.length ? ow.join('; ') : 'немає'));
    // перетини
    const cross: string[] = [];
    const seenKeys: { name: string; pt: Pt }[] = [];
    let unnamed = 0;
    chain.forEach((c, i) => {
      const n = nodes.get(c.id)!;
      const others = n.ways.filter((w) => !wset.has(w));
      if (!others.length) return;
      const names = [...new Set(others.map((w) => roadName(w)).filter(Boolean))];
      if (!names.length) {
        unnamed++;
        return;
      }
      for (const nm of names) {
        if (seenKeys.some((k) => k.name === nm && haversine(k.pt, n.pt) < 30)) continue;
        seenKeys.push({ name: nm, pt: n.pt });
        cross.push(`  ${Math.round(cum[i])}м ${fmt(n.pt)} ${nm} [${junctionType(c.id)}]`);
      }
    });
    console.log(`  перетинають (${cross.length}${unnamed ? `, + ${unnamed} безіменних` : ''}):`);
    for (const c of cross) console.log(c);
  });
}

// ---- режим: поблизу ----
function near(lat: number, lng: number, radius: number) {
  const p: Pt = [lng, lat];
  const found: { r: Road; d: number; pt: Pt }[] = [];
  for (const r of roads) {
    let best: { d: number; pt: Pt } | null = null;
    for (let i = 1; i < r.geometry.length; i++) {
      const pr = projectOnSegment(p, r.geometry[i - 1], r.geometry[i]);
      if (!best || pr.dist < best.d) best = { d: pr.dist, pt: pr.point };
    }
    if (best && best.d <= radius) found.push({ r, d: best.d, pt: best.pt });
  }
  found.sort((a, b) => a.d - b.d);
  console.log(`Дороги в ${radius} м від ${lat.toFixed(6)}, ${lng.toFixed(6)} (${found.length}):`);
  for (const f of found.slice(0, 25)) {
    const ow = f.r.tags.oneway ? ` oneway=${f.r.tags.oneway}` : '';
    const rb = f.r.tags.junction ? ` junction=${f.r.tags.junction}` : '';
    console.log(`  ${f.d.toFixed(0)} м  ${roadName(f.r) || '(без назви)'}  [${f.r.tags.highway}${ow}${rb}]  way ${f.r.id}  найближча ${fmt(f.pt)}`);
  }
  const js: { d: number; id: number; n: NodeInfo }[] = [];
  for (const [id, n] of nodes) {
    if (n.arms < 3) continue;
    const d = haversine(p, n.pt);
    if (d <= radius) js.push({ d, id, n });
  }
  js.sort((a, b) => a.d - b.d);
  console.log(`Перехрестя (${js.length}):`);
  for (const j of js.slice(0, 12)) {
    const nm = [...new Set(j.n.ways.map((w) => roadName(w) || `(${w.tags.highway})`))].join(' x ');
    console.log(`  ${j.d.toFixed(0)} м  ${fmt(j.n.pt)}  ${nm}  [${junctionType(j.id)}]`);
  }
}

const args = process.argv.slice(2);
if (args[0] === '--near') {
  const [lat, lng, r] = args.slice(1).map(Number);
  if (!isFinite(lat) || !isFinite(lng)) {
    console.error('Використання: find.ts --near <lat> <lng> [radiusM=80]');
    process.exit(1);
  }
  near(lat, lng, r || 80);
} else if (args.length === 2) twoStreets(args[0], args[1]);
else if (args.length === 1) oneStreet(args[0]);
else {
  console.error('Використання:\n  find.ts "А" "Б"\n  find.ts "А"\n  find.ts --near <lat> <lng> [radiusM]');
  process.exit(1);
}
