// Збирає public/data/centers.json і public/data/centers/<id>.json з centers-src.yaml та готових routes/*.json.
import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import type { Center, CenterSummary, LngLat, Route, RouteMeta } from '../src/types';
import { P, readJson, writeJson } from './lib';

interface CenterSrc {
  id: string;
  name: string;
  city: string;
  address: string;
  coord: LngLat;
  routeCount: number;
}

const centers = yaml.load(fs.readFileSync(P.centersSrc, 'utf8')) as CenterSrc[];
const routesDir = path.join(P.pub, 'routes');
const files = fs.existsSync(routesDir) ? fs.readdirSync(routesDir).filter((f) => f.endsWith('.json')) : [];

const summaries: CenterSummary[] = [];
fs.mkdirSync(path.join(P.pub, 'centers'), { recursive: true });
for (const c of centers) {
  const routes: RouteMeta[] = files
    .filter((f) => f.startsWith(c.id + '_'))
    .map((f) => readJson<Route>(path.join(routesDir, f)))
    .map((r) => ({ id: r.id, number: r.number, name: r.name, category: r.category, lengthM: r.lengthM, verified: r.verified }))
    .sort((a, b) => a.number - b.number);
  const center: Center = { id: c.id, name: c.name, city: c.city, address: c.address, coord: c.coord, routes };
  writeJson(path.join(P.pub, 'centers', c.id + '.json'), center);
  summaries.push({ id: c.id, name: c.name, city: c.city, address: c.address, routeCount: c.routeCount });
  console.log(`${c.id}: маршрутів у JSON — ${routes.length} із ${c.routeCount}`);
}
writeJson(path.join(P.pub, 'centers.json'), summaries);
console.log(`centers.json: ${summaries.length} центр(ів)`);
