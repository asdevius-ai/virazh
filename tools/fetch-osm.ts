// Вивантаження доріг і POI Хмельницького з Overpass → data/osm/.
import path from 'node:path';
import { cachedFetch, P, writeJson } from './lib';

const BBOX = '49.36,26.86,49.48,27.08'; // south,west,north,east
const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

async function overpass(query: string): Promise<any> {
  let last: unknown;
  for (const m of MIRRORS) {
    try {
      const txt = await cachedFetch(m, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        retries: 2,
      });
      return JSON.parse(txt);
    } catch (e) {
      last = e;
      console.warn(`Overpass ${m}: ${(e as Error).message}`);
    }
  }
  throw last;
}

const HW =
  'motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service';

async function main() {
  const roadsQ = `[out:json][timeout:180];way["highway"~"^(${HW})$"](${BBOX});out body geom;`;
  const roadsRaw = await overpass(roadsQ);
  const keep = ['name', 'name:uk', 'oneway', 'junction', 'highway', 'ref'];
  const roads = roadsRaw.elements
    .filter((e: any) => e.type === 'way' && e.geometry)
    .map((e: any) => {
      const tags: Record<string, string> = {};
      for (const k of keep) if (e.tags?.[k] !== undefined) tags[k] = e.tags[k];
      return {
        id: e.id,
        nodes: e.nodes as number[],
        geometry: e.geometry.map((g: any) => [g.lon, g.lat]),
        tags,
      };
    });
  writeJson(path.join(P.osm, 'roads.json'), roads);
  console.log(`roads.json: ${roads.length} доріг`);

  const poiQ = `[out:json][timeout:180];(
node["highway"~"^(crossing|traffic_signals|give_way|stop|bus_stop)$"](${BBOX});
node["railway"="level_crossing"](${BBOX});
node["traffic_calming"](${BBOX});
node["traffic_sign"](${BBOX});
);out body;`;
  const poiRaw = await overpass(poiQ);
  const features = poiRaw.elements
    .filter((e: any) => e.type === 'node')
    .map((e: any) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [e.lon, e.lat] },
      properties: { ...(e.tags ?? {}), osm_id: e.id },
    }));
  writeJson(path.join(P.osm, 'pois.geojson'), { type: 'FeatureCollection', features });
  console.log(`pois.geojson: ${features.length} точок`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
