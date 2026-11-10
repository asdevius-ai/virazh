import type { Center, CenterSummary, PdrSign, PoiType, Route } from './types';
import { BASE } from './util';
import { mockCenter, mockCenters, mockRoute } from './mock/route';

export class DataError extends Error {
  constructor(
    public kind: 'offline' | 'notfound',
    message: string,
  ) {
    super(message);
  }
}

const forceMock = new URLSearchParams(location.search).get('mock') === '1';
let mockMode: boolean | undefined = forceMock ? true : undefined;
let centersCache: CenterSummary[] | undefined;

/** Повертає JSON або null, якщо файлу немає / це не JSON (dev-сервер віддає index.html). Кидає DataError('offline') при мережевій помилці. */
async function getJson<T>(path: string): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(BASE + path);
  } catch {
    throw new DataError('offline', 'Немає мережі');
  }
  if (!res.ok) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function isMock(): boolean {
  return mockMode === true;
}

export async function loadCenters(): Promise<CenterSummary[]> {
  if (centersCache) return centersCache;
  if (!forceMock) {
    const list = await getJson<CenterSummary[]>('data/centers.json');
    if (Array.isArray(list) && list.length > 0) {
      mockMode = false;
      return (centersCache = list);
    }
  }
  mockMode = true;
  return (centersCache = mockCenters());
}

export async function loadCenter(id: string): Promise<Center> {
  if (mockMode === undefined) await loadCenters();
  if (mockMode) {
    const c = mockCenter();
    if (c.id === id) return c;
    throw new DataError('notfound', 'ТСЦ не знайдено');
  }
  const c = await getJson<Center>(`data/centers/${id}.json`);
  if (!c) throw new DataError('notfound', 'ТСЦ не знайдено');
  return c;
}

export async function loadRoute(centerId: string, number: number): Promise<Route> {
  if (mockMode === undefined) await loadCenters();
  const id = `${centerId}_${number}`;
  if (mockMode) {
    const r = mockRoute();
    if (r.id === id) return r;
    throw new DataError('notfound', 'Маршрут не знайдено');
  }
  const r = await getJson<Route>(`data/routes/${id}.json`);
  if (!r || !r.geometry || r.geometry.coordinates.length < 2) {
    throw new DataError('notfound', 'Маршрут не знайдено');
  }
  return r;
}

let signsCache: Map<PoiType, PdrSign> | undefined;
/** Довідник знаків; необов'язковий — за його відсутності беремо мітки з POI. */
export async function loadSigns(): Promise<Map<PoiType, PdrSign>> {
  if (signsCache) return signsCache;
  const m = new Map<PoiType, PdrSign>();
  try {
    const list = await getJson<PdrSign[]>('data/pdr-signs.json');
    if (Array.isArray(list)) for (const s of list) m.set(s.type, s);
  } catch {
    /* довідник необов'язковий */
  }
  return (signsCache = m);
}
