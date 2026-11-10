import type { Map as MlMap, ExpressionSpecification } from 'maplibre-gl';
import type { Route, PoiType } from '../types';
import { POI_TYPES, arrowImage, signImage } from '../icons';

export const STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';
export const ROUTE_COLOR = '#2DD4A7';
export const ROUTE_PASSED = '#1B7A64';

type Paint = Record<string, unknown>;

/** Перефарбовуємо базовий темний стиль OpenFreeMap під палітру «Вираж». */
const PAINT: Record<string, Paint> = {
  background: { 'background-color': '#0E1116' },
  water: { 'fill-color': '#0F2030' },
  waterway: { 'line-color': '#0F2030' },
  landuse_residential: { 'fill-color': '#12161D', 'fill-opacity': 0.9 },
  landuse_park: { 'fill-color': '#10201D' },
  landcover_wood: { 'fill-color': '#0F1D1A' },
  building: { 'fill-color': '#171C25', 'fill-outline-color': '#202735' },
  highway_path: { 'line-color': '#2A3240' },
  highway_minor: { 'line-color': '#2F3848', 'line-opacity': 1 },
  highway_major_casing: { 'line-color': '#1B212C' },
  highway_major_inner: { 'line-color': '#3A4559' },
  highway_major_subtle: { 'line-color': '#2F3848' },
  highway_motorway_casing: { 'line-color': '#1B212C' },
  highway_motorway_inner: { 'line-color': '#4A566F' },
  highway_motorway_subtle: { 'line-color': '#2F3848' },
  railway: { 'line-color': '#3A3F4B' },
  railway_minor: { 'line-color': '#3A3F4B' },
  railway_transit: { 'line-color': '#3A3F4B' },
  highway_name_other: { 'text-color': '#A3ADC0', 'text-halo-color': '#0E1116', 'text-halo-width': 1.6 },
  highway_name_motorway: { 'text-color': '#A3ADC0', 'text-halo-color': '#0E1116' },
  water_name: { 'text-color': '#5F7A93', 'text-halo-color': '#0E1116' },
};

const PLACE_LAYERS = [
  'place_other',
  'place_suburb',
  'place_village',
  'place_town',
  'place_city',
  'place_city_large',
  'place_state',
];

export function applyPalette(map: MlMap): void {
  const nameUk: ExpressionSpecification = ['coalesce', ['get', 'name:uk'], ['get', 'name']];
  for (const layer of map.getStyle().layers) {
    const p = PAINT[layer.id];
    if (p) {
      for (const [k, v] of Object.entries(p)) {
        try {
          map.setPaintProperty(layer.id, k as 'fill-color', v as string);
        } catch {
          /* шар/властивість може відрізнятися в новій версії стилю */
        }
      }
    }
    if (layer.type === 'symbol') {
      if (PLACE_LAYERS.includes(layer.id)) {
        try {
          map.setPaintProperty(layer.id, 'text-color', '#8A94A6');
          map.setPaintProperty(layer.id, 'text-halo-color', '#0E1116');
        } catch {
          /* ignore */
        }
      }
      const tf = (layer.layout as Record<string, unknown> | undefined)?.['text-field'];
      if (tf !== undefined && layer.id !== 'highway_name_motorway') {
        try {
          map.setLayoutProperty(layer.id, 'text-field', nameUk);
        } catch {
          /* ignore */
        }
      }
    }
  }
}

/** Лінія маршруту — над дорогами та їхніми підписами, під назвами місць/кордонами. */
function firstSymbolId(map: MlMap): string | undefined {
  const layers = map.getStyle().layers;
  return (layers.find((l) => l.id.startsWith('place_')) ?? layers.find((l) => l.id.startsWith('boundary_')))?.id;
}

export const POI_SOURCE = 'pois';
export const POI_LAYER = 'pois';

/** Додає маршрут, стрілки, старт/фініш і POI. Викликається один раз після завантаження стилю. */
export async function addRouteLayers(map: MlMap, route: Route): Promise<void> {
  const before = firstSymbolId(map);

  map.addSource('route', {
    type: 'geojson',
    lineMetrics: true,
    data: { type: 'Feature', properties: {}, geometry: route.geometry },
  });

  const width = (extra: number): ExpressionSpecification => [
    'interpolate',
    ['linear'],
    ['zoom'],
    11,
    2 + extra * 0.4,
    14,
    4.5 + extra * 0.6,
    17,
    8 + extra,
    19,
    15 + extra,
  ];

  map.addLayer(
    {
      id: 'route-casing',
      type: 'line',
      source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#07110F', 'line-width': width(4), 'line-opacity': 0.95 },
    },
    before,
  );
  map.addLayer(
    {
      id: 'route-line',
      type: 'line',
      source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-width': width(0), 'line-gradient': gradientExpr(0) },
    },
    before,
  );

  map.addImage('virazh-arrow', await arrowImage(), { pixelRatio: 6 });
  map.addLayer(
    {
      id: 'route-arrows',
      type: 'symbol',
      source: 'route',
      minzoom: 12,
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 60,
        'icon-image': 'virazh-arrow',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.6, 14, 0.8, 17, 1.15, 19, 1.8],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-rotation-alignment': 'map',
        'icon-pitch-alignment': 'viewport',
      },
    },
    before,
  );

  // Старт і фініш.
  const coords = route.geometry.coordinates;
  map.addSource('ends', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { kind: 'start' }, geometry: { type: 'Point', coordinates: coords[0]! } },
        {
          type: 'Feature',
          properties: { kind: 'finish' },
          geometry: { type: 'Point', coordinates: coords[coords.length - 1]! },
        },
      ],
    },
  });
  map.addLayer(
    {
      id: 'ends',
      type: 'circle',
      source: 'ends',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 4, 17, 9],
        'circle-color': ['match', ['get', 'kind'], 'start', '#FFFFFF', '#FFB020'],
        'circle-stroke-width': 3,
        'circle-stroke-color': '#0E1116',
        'circle-pitch-alignment': 'map',
      },
    },
    before,
  );

  // Знаки.
  const imgs = await Promise.all(POI_TYPES.map((t) => signImage(t).then((img) => [t, img] as const)));
  for (const [t, img] of imgs) map.addImage('sign-' + t, img, { pixelRatio: 2 });

  map.addSource(POI_SOURCE, {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: route.pois.map((p) => ({
        type: 'Feature' as const,
        properties: { id: p.id, icon: 'sign-' + p.type, type: p.type as PoiType, label: p.label, code: p.pdrCode ?? '' },
        geometry: { type: 'Point' as const, coordinates: p.coord },
      })),
    },
  });
  map.addLayer({
    id: POI_LAYER,
    type: 'symbol',
    source: POI_SOURCE,
    minzoom: 13,
    layout: {
      'icon-image': ['get', 'icon'],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 13, 0.42, 16, 0.62, 18.5, 0.85],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-pitch-alignment': 'viewport',
      'icon-rotation-alignment': 'viewport',
    },
  });
}

/** Градієнт «пройдено / попереду» вздовж лінії. p — частка [0,1]. */
export function gradientExpr(p: number): ExpressionSpecification {
  const a = Math.min(Math.max(p, 0.0002), 0.9996);
  return [
    'interpolate',
    ['linear'],
    ['line-progress'],
    0,
    ROUTE_PASSED,
    a,
    ROUTE_PASSED,
    a + 0.0003,
    ROUTE_COLOR,
    1,
    ROUTE_COLOR,
  ];
}
