// Спільні утиліти пайплайна: шляхи, мережа з кешем і паузами, геометрія.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');
export const P = {
  cache: path.join(ROOT, 'data', 'cache'),
  osm: path.join(ROOT, 'data', 'osm'),
  routesSrc: path.join(ROOT, 'data', 'routes-src'),
  preview: path.join(ROOT, 'data', 'preview'),
  pub: path.join(ROOT, 'public', 'data'),
  centersSrc: path.join(ROOT, 'data', 'centers-src.yaml'),
};

export const UA = 'virazh-data-pipeline/0.1';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const lastCall = new Map<string, number>();

/** Пауза ≥ 1 с між запитами до одного хоста. */
async function throttle(host: string) {
  const last = lastCall.get(host) ?? 0;
  const wait = last + 1100 - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall.set(host, Date.now());
}

export interface FetchOpts {
  method?: 'GET' | 'POST';
  body?: string;
  headers?: Record<string, string>;
  /** не кешувати */
  noCache?: boolean;
  retries?: number;
}

/** Текстова відповідь із кешем (ключ — хеш запиту) і повторами на 429/5xx. */
export async function cachedFetch(url: string, opts: FetchOpts = {}): Promise<string> {
  fs.mkdirSync(P.cache, { recursive: true });
  const key = crypto
    .createHash('sha1')
    .update(`${opts.method ?? 'GET'}\n${url}\n${opts.body ?? ''}`)
    .digest('hex');
  const file = path.join(P.cache, key + '.txt');
  if (!opts.noCache && fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  const host = new URL(url).host;
  const retries = opts.retries ?? 4;
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    await throttle(host);
    try {
      const res = await fetch(url, {
        method: opts.method ?? 'GET',
        body: opts.body,
        headers: { 'User-Agent': UA, ...(opts.headers ?? {}) },
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status} ${host}`);
        await sleep(3000 * (i + 1));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${host}: ${(await res.text()).slice(0, 200)}`);
      const text = await res.text();
      if (!opts.noCache) fs.writeFileSync(file, text);
      return text;
    } catch (e) {
      lastErr = e;
      if (e instanceof Error && e.message.startsWith('HTTP 4')) throw e;
      await sleep(3000 * (i + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ---------- геометрія (плоска проєкція, достатньо для метрів на масштабі міста) ----------

const R = 6371008.8;
const rad = Math.PI / 180;

export type Pt = [number, number]; // [lng, lat]

/** Відстань haversine, м. */
export function haversine(a: Pt, b: Pt): number {
  const dLat = (b[1] - a[1]) * rad;
  const dLng = (b[0] - a[0]) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Локальні метри відносно точки-початку (equirectangular). */
export function toXY(p: Pt, o: Pt): [number, number] {
  return [(p[0] - o[0]) * rad * R * Math.cos(o[1] * rad), (p[1] - o[1]) * rad * R];
}

export interface Proj {
  /** відстань від точки до відрізка, м */
  dist: number;
  /** частка вздовж відрізка 0..1 */
  t: number;
  point: Pt;
}

/** Проєкція точки на відрізок a-b. */
export function projectOnSegment(p: Pt, a: Pt, b: Pt): Proj {
  const [px, py] = toXY(p, a);
  const [bx, by] = toXY(b, a);
  const len2 = bx * bx + by * by;
  let t = len2 === 0 ? 0 : (px * bx + py * by) / len2;
  t = Math.max(0, Math.min(1, t));
  const dx = px - t * bx;
  const dy = py - t * by;
  return { dist: Math.hypot(dx, dy), t, point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] };
}

export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function fmt(p: Pt): string {
  return `${p[1].toFixed(6)}, ${p[0].toFixed(6)}`;
}

export function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

export function writeJson(file: string, data: unknown, pretty = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, pretty ? 2 : undefined) + '\n');
}

/** Нормалізація назви для пошуку: нижній регістр, без «вулиця/проспект/вул.» тощо. */
export function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ʼ’`]/g, "'")
    .replace(/(^|\s)(вулиця|вул|проспект|просп|пр-т|провулок|пров|бульвар|бул|площа|пл|шосе|проїзд|узвіз)\.?(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface Road {
  id: number;
  nodes: number[];
  geometry: Pt[];
  tags: Record<string, string>;
}

export function loadRoads(): Road[] {
  return readJson<Road[]>(path.join(P.osm, 'roads.json'));
}

export function roadName(r: Road): string {
  return r.tags['name:uk'] ?? r.tags.name ?? '';
}
