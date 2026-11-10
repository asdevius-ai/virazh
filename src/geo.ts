import type { LngLat } from './types';

const R = 6371008.8;
const rad = Math.PI / 180;

export function haversine(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * rad;
  const dLng = (b[0] - a[0]) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Азимут a→b у градусах [0, 360). */
export function bearing(a: LngLat, b: LngLat): number {
  const y = Math.sin((b[0] - a[0]) * rad) * Math.cos(b[1] * rad);
  const x =
    Math.cos(a[1] * rad) * Math.sin(b[1] * rad) -
    Math.sin(a[1] * rad) * Math.cos(b[1] * rad) * Math.cos((b[0] - a[0]) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

/** Найкоротша різниця кутів to-from у (-180, 180]. */
export function angleDiff(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

export interface Track {
  coords: LngLat[];
  /** Накопичена відстань до кожної вершини, метри. */
  cum: number[];
  total: number;
}

export function buildTrack(coords: LngLat[]): Track {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1]! + haversine(coords[i - 1]!, coords[i]!));
  }
  return { coords, cum, total: cum[cum.length - 1] ?? 0 };
}

/** Індекс відрізка, що містить відстань u (бінарний пошук). */
function segIndex(t: Track, u: number): number {
  let lo = 0;
  let hi = t.cum.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (t.cum[mid]! <= u) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}

export function pointAt(t: Track, u: number, out: LngLat = [0, 0]): LngLat {
  const d = clampU(t, u);
  const i = segIndex(t, d);
  const a = t.coords[i]!;
  const b = t.coords[i + 1] ?? a;
  const len = t.cum[i + 1]! - t.cum[i]! || 1;
  const f = (d - t.cum[i]!) / len;
  out[0] = a[0] + (b[0] - a[0]) * f;
  out[1] = a[1] + (b[1] - a[1]) * f;
  return out;
}

function clampU(t: Track, u: number): number {
  return u < 0 ? 0 : u > t.total ? t.total : u;
}

/** Курс руху в точці u: від (u-3) до (u+10), щоб згладити зламані вершини. */
export function headingAt(t: Track, u: number): number {
  const a = pointAt(t, Math.max(0, Math.min(u, t.total - 13) - 3));
  const b = pointAt(t, Math.min(t.total, Math.max(u, 3) + 10));
  return bearing(a, b);
}

export function bounds(coords: LngLat[]): [LngLat, LngLat] {
  let w = Infinity,
    s = Infinity,
    e = -Infinity,
    n = -Infinity;
  for (const [x, y] of coords) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [
    [w, s],
    [e, n],
  ];
}
