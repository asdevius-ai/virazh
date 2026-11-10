// У production-збірці бандл maplibre-gl переміщується, тож шлях до воркера задаємо явно.
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

setWorkerUrl(workerUrl);
