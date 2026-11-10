// Мок-дані: один правдоподібний маршрут у Хмельницькому (контури вулиць — приблизні).
// Використовується, якщо public/data/centers.json відсутній/порожній або в URL є ?mock=1.
import type { Center, CenterSummary, LngLat, PoiType, Route, RoutePoi, StreetSegment } from '../types';
import { buildTrack, pointAt } from '../geo';

const CORNERS: LngLat[] = [
  [26.9502, 49.4101],
  [26.956, 49.4126],
  [26.964, 49.4152],
  [26.97, 49.4192],
  [26.9762, 49.4238],
  [26.9842, 49.4257],
  [26.9902, 49.4226],
  [26.9932, 49.4171],
  [26.9882, 49.4121],
  [26.9802, 49.4094],
  [26.9702, 49.4084],
  [26.9598, 49.4089],
  [26.9502, 49.4101],
];

function chaikin(pts: LngLat[], rounds: number): LngLat[] {
  let p = pts;
  for (let r = 0; r < rounds; r++) {
    const out: LngLat[] = [p[0]!];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i]!;
      const b = p[i + 1]!;
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    out.push(p[p.length - 1]!);
    p = out;
  }
  return p;
}

const r6 = (n: number): number => Math.round(n * 1e6) / 1e6;

const POI_DEFS: Array<[number, PoiType, string | undefined, string]> = [
  [0.05, 'traffic_signals', undefined, 'Світлофор'],
  [0.1, 'crossing', '5.38.1', 'Пішохідний перехід'],
  [0.17, 'bus_stop', '5.41.1', 'Зупинка автобуса'],
  [0.24, 'give_way', '2.1', 'Дати дорогу'],
  [0.32, 'roundabout', '4.10', 'Круговий рух'],
  [0.4, 'crossing', '5.38.1', 'Пішохідний перехід'],
  [0.48, 'speed_bump', '1.37', 'Штучна нерівність'],
  [0.57, 'stop', '2.2', 'Проїзд без зупинки заборонено'],
  [0.65, 'level_crossing', '1.1', 'Залізничний переїзд'],
  [0.74, 'traffic_signals', undefined, 'Світлофор'],
  [0.83, 'sign', '3.29', 'Обмеження швидкості'],
  [0.92, 'crossing', '5.38.1', 'Пішохідний перехід'],
];

const STREET_DEFS: Array<[number, string]> = [
  [0.14, 'вул. Західно-Окружна'],
  [0.34, 'вул. Кам’янецька'],
  [0.54, 'вул. Проскурівська'],
  [0.7, ''],
  [0.86, 'вул. Подільська'],
  [1, 'вул. Інститутська'],
];

function build(): Route {
  const c0 = CORNERS[0]!;
  const coords = chaikin(CORNERS.map((c): LngLat => [c0[0] + (c[0] - c0[0]) * 0.62, c0[1] + (c[1] - c0[1]) * 0.62]), 2).map((c): LngLat => [r6(c[0]), r6(c[1])]);
  const track = buildTrack(coords);
  const lengthM = Math.round(track.total);
  const id = '6841_1';

  const pois: RoutePoi[] = POI_DEFS.map(([f, type, code, label], i) => {
    const d = Math.round(lengthM * f);
    const p = pointAt(track, d);
    const poi: RoutePoi = {
      id: `${id}-p${i + 1}`,
      routeId: id,
      type,
      label,
      coord: [r6(p[0]), r6(p[1])],
      distanceAlongM: d,
    };
    if (code) poi.pdrCode = code;
    return poi;
  });

  const streets: StreetSegment[] = [];
  let from = 0;
  for (const [f, name] of STREET_DEFS) {
    const to = f === 1 ? lengthM : Math.round(lengthM * f);
    streets.push({ name, fromM: from, toM: to });
    from = to;
  }

  return {
    id,
    number: 1,
    name: 'Маршрут №1',
    category: 'B, C1, D1, D, BE, C1E, D1E, DE',
    lengthM,
    verified: false,
    centerId: '6841',
    geometry: { type: 'LineString', coordinates: coords },
    sourceImage: '6841_1.jpg',
    notes: 'Демонстраційний маршрут: контур приблизний, не є офіційним.',
    pois,
    streets,
  };
}

let cached: Route | undefined;
export function mockRoute(): Route {
  return (cached ??= build());
}

export function mockCenter(): Center {
  const r = mockRoute();
  return {
    id: '6841',
    name: 'ТСЦ МВС № 6841',
    city: 'Хмельницький',
    address: 'вул. Західно-Окружна, 11/1',
    coord: [26.9502, 49.4101],
    routes: [
      {
        id: r.id,
        number: r.number,
        name: r.name,
        category: r.category,
        lengthM: r.lengthM,
        verified: r.verified,
      },
    ],
  };
}

export function mockCenters(): CenterSummary[] {
  const c = mockCenter();
  return [{ id: c.id, name: c.name, city: c.city, address: c.address, routeCount: c.routes.length }];
}
