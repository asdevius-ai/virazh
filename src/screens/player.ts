import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../map/worker';
import type { LngLat, Route, RoutePoi } from '../types';
import { angleDiff, bounds, buildTrack, headingAt, pointAt, type Track } from '../geo';
import { loadRoute, loadSigns, DataError } from '../data';
import { CAR_SVG, ICON, signSvg } from '../icons';
import { Minimap } from '../map/minimap';
import { STYLE_URL, addRouteLayers, applyPalette, gradientExpr, POI_LAYER } from '../map/style';
import { clamp, h, svgEl } from '../util';
import { renderState } from './state';

const BASE_SPEED = 14; // м/с при 1×
const SPEEDS = [0.5, 1, 2, 4];
const NEXT_POI_RANGE = 150;
const DEFAULT_ZOOM = 17;
const DEFAULT_PITCH = 50;

export async function mountPlayer(root: HTMLElement, centerId: string, num: number): Promise<() => void> {
  let disposeLate: (() => void) | undefined;
  root.replaceChildren(renderState({ kind: 'loading', text: 'Завантажуємо маршрут…' }));
  let route: Route;
  try {
    route = await loadRoute(centerId, num);
  } catch (e) {
    const err = e instanceof DataError ? e : new DataError('offline', 'Помилка');
    const back = `#/center/${centerId}`;
    root.replaceChildren(
      renderState(
        err.kind === 'notfound'
          ? { kind: 'error', title: 'Маршрут не знайдено', text: 'Такого маршруту немає або він ще не опублікований.', backHref: back }
          : {
              kind: 'error',
              title: 'Немає мережі',
              text: 'Не вдалося завантажити маршрут. Перевірте інтернет і спробуйте ще раз.',
              backHref: back,
              retry: () => void mountPlayer(root, centerId, num).then((d) => (disposeLate = d)),
            },
      ),
    );
    return () => {
      disposeLate?.();
    };
  }
  return startPlayer(root, route);
}

function startPlayer(root: HTMLElement, route: Route): () => void {
  const track: Track = buildTrack(route.geometry.coordinates);
  const L = route.lengthM > 0 ? route.lengthM : track.total;
  const factor = track.total / L; // метри маршруту → метри трека
  const coordsB = bounds(track.coords);

  // ---------- DOM ----------
  const mapEl = h('div', { class: 'map' });
  const backBtn = h('a', { class: 'icon-btn glass', href: `#/center/${route.centerId}`, 'aria-label': 'Назад до маршрутів' });
  backBtn.innerHTML = ICON.back;
  const streetName = h('div', { class: 'street-name' }, 'Проїзд');
  const progText = h('span', { class: 'prog-text' }, `0 з ${Math.round(L)} м`);
  const draft = route.verified ? null : h('span', { class: 'badge-draft' }, 'чернетка');
  const barFill = h('i');
  const streetCard = h(
    'div',
    { class: 'street-card glass' },
    streetName,
    h('div', { class: 'prog-row' }, progText, draft),
    h('div', { class: 'bar' }, barFill),
  );
  const nextIcon = h('span', { class: 'next-icon' });
  const nextText = h('span', { class: 'next-text' });
  const nextCard = h('div', { class: 'next-card glass hidden' }, nextIcon, nextText);

  const zoomIn = h('button', { class: 'icon-btn glass', 'aria-label': 'Збільшити' });
  zoomIn.innerHTML = ICON.plus;
  const zoomOut = h('button', { class: 'icon-btn glass', 'aria-label': 'Зменшити' });
  zoomOut.innerHTML = ICON.minus;
  const zoomCol = h('div', { class: 'zoom-col' }, zoomIn, zoomOut);

  const recenter = h('button', { class: 'recenter glass hidden' });
  recenter.innerHTML = ICON.locate + '<span>До машинки</span>';
  const finishBadge = h('div', { class: 'finish-badge glass hidden' }, 'Фініш');
  const minimap = new Minimap(track);
  const minimapWrap = h('button', { class: 'minimap-wrap glass', 'aria-label': 'Показати весь маршрут' }, minimap.el);
  const attrib = h('div', { class: 'attrib' });
  attrib.innerHTML =
    '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> · <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> · <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a>';
  const mapError = h('div', { class: 'map-error hidden' }, 'Не вдалося завантажити карту. Перевірте інтернет-з’єднання.');

  const stage = h(
    'div',
    { class: 'stage' },
    mapEl,
    h('div', { class: 'hud-top' }, backBtn, streetCard),
    nextCard,
    zoomCol,
    recenter,
    finishBadge,
    minimapWrap,
    attrib,
    mapError,
  );

  // Панель керування
  const playBtn = h('button', { class: 'play-btn', 'aria-label': 'Грати' });
  playBtn.innerHTML = ICON.play;
  const restartBtn = h('button', { class: 'icon-btn ghost', 'aria-label': 'На початок' });
  restartBtn.innerHTML = ICON.restart;
  const speedBtns = SPEEDS.map((v) => {
    const b = h('button', { class: 'chip', 'aria-pressed': 'false' }, `${String(v).replace('.', ',')}×`);
    b.addEventListener('click', () => setSpeed(v));
    return b;
  });
  const thumb = h('div', { class: 'thumb' });
  const fill = h('div', { class: 'fill' });
  const scrub = h('div', { class: 'scrub', role: 'slider', 'aria-label': 'Положення на маршруті', tabindex: '0' }, h('div', { class: 'track' }, fill), thumb);
  const panel = h(
    'div',
    { class: 'panel glass' },
    scrub,
    h('div', { class: 'controls' }, restartBtn, playBtn, h('div', { class: 'speeds' }, ...speedBtns)),
  );

  root.replaceChildren(h('div', { class: 'player' }, stage, panel));
  minimap.layout();

  // ---------- Карта ----------
  const startLL = track.coords[0]!;
  const heading0 = headingAt(track, 0);
  const map: MlMap = new maplibregl.Map({
    container: mapEl,
    style: STYLE_URL,
    center: startLL,
    zoom: DEFAULT_ZOOM,
    pitch: DEFAULT_PITCH,
    bearing: heading0,
    maxPitch: 70,
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
    fadeDuration: 0,
    canvasContextAttributes: { antialias: false },
  });
  map.touchZoomRotate.enable({ around: 'center' });
  map.touchZoomRotate.disableRotation();
  map.touchPitch.disable();
  map.scrollZoom.enable({ around: 'center' });
  map.keyboard.disable();

  const carEl = svgEl(`<div class="car">${CAR_SVG}</div>`);
  const marker = new maplibregl.Marker({
    element: carEl,
    rotationAlignment: 'map',
    pitchAlignment: 'map',
    subpixelPositioning: true,
  })
    .setLngLat(startLL)
    .addTo(map);

  let mapLoaded = false;
  map.on('load', () => {
    mapLoaded = true;
    applyPalette(map);
    void addRouteLayers(map, route);
  });
  map.on('error', () => {
    if (!mapLoaded) mapError.classList.remove('hidden');
  });
  map.on('load', () => mapError.classList.add('hidden'));

  // Підпис знака по тапу.
  const poiById = new Map<string, RoutePoi>(route.pois.map((p) => [p.id, p]));
  let popup: maplibregl.Popup | null = null;
  const signs = new Map<string, string | null>();
  void loadSigns().then((m) => m.forEach((v, k) => signs.set(k, v.pdrCode)));
  map.on('click', POI_LAYER, (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const poi = poiById.get(String(f.properties?.['id']));
    if (!poi) return;
    popup?.remove();
    const code = poi.pdrCode ?? signs.get(poi.type) ?? '';
    const html = h('div', { class: 'poi-pop' }, h('b', null, code), code ? ' ' : '', poi.label);
    popup = new maplibregl.Popup({ closeButton: false, offset: 26, className: 'virazh-popup', maxWidth: '240px' })
      .setLngLat(poi.coord)
      .setDOMContent(html)
      .addTo(map);
  });
  map.on('mouseenter', POI_LAYER, () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', POI_LAYER, () => (map.getCanvas().style.cursor = ''));

  // ---------- Стан ----------
  let s = 0; // пройдено, метри маршруту
  let playing = false;
  let finished = false;
  let mult = 1;
  let dragging = false;
  let follow = true;
  let userBusy = false;

  // Камера (власний згладжений стан)
  let camLng = startLL[0];
  let camLat = startLL[1];
  let camBearing = heading0;
  let camZoom = DEFAULT_ZOOM;
  let camPitch = DEFAULT_PITCH;
  let zoomTarget = DEFAULT_ZOOM;
  let carHead = heading0;
  let padTop = 0;
  const applied = { lng: NaN, lat: NaN, b: NaN, z: NaN, p: NaN, pad: NaN };

  const tmp: LngLat = [0, 0];
  let snapNext = true;
  let lastS = 0;

  function updatePadding(): void {
    padTop = Math.round(stage.clientHeight * 0.34);
  }
  updatePadding();
  const ro = new ResizeObserver(() => {
    updatePadding();
    minimap.layout();
    map.resize();
  });
  ro.observe(stage);

  function syncCamFromMap(): void {
    const c = map.getCenter();
    camLng = c.lng;
    camLat = c.lat;
    camBearing = map.getBearing();
    camZoom = zoomTarget = map.getZoom();
    camPitch = map.getPitch();
  }

  map.on('dragstart', (e) => {
    if (!e.originalEvent) return;
    userBusy = true;
    if (follow) {
      follow = false;
      recenter.classList.remove('hidden');
    }
  });
  map.on('dragend', () => {
    userBusy = false;
    syncCamFromMap();
  });
  map.on('zoomstart', (e) => {
    if (e.originalEvent) userBusy = true;
  });
  map.on('zoomend', () => {
    if (userBusy) {
      userBusy = false;
      syncCamFromMap();
    }
  });

  recenter.addEventListener('click', () => {
    follow = true;
    recenter.classList.add('hidden');
    map.stop();
    syncCamFromMap();
    zoomTarget = Math.max(zoomTarget, 15.5);
    applied.lng = NaN;
  });
  minimapWrap.addEventListener('click', () => {
    follow = false;
    recenter.classList.remove('hidden');
    const cam = map.cameraForBounds(coordsB, { padding: { top: 150, bottom: 40, left: 40, right: 40 } });
    map.easeTo({
      center: cam?.center ?? startLL,
      zoom: cam?.zoom ?? 13,
      pitch: 0,
      bearing: 0,
      padding: { top: 0, bottom: 0, left: 0, right: 0 },
      duration: 700,
    });
  });
  zoomIn.addEventListener('click', () => zoomBy(1));
  zoomOut.addEventListener('click', () => zoomBy(-1));
  function zoomBy(d: number): void {
    if (follow) zoomTarget = clamp(zoomTarget + d, 11, 19.5);
    else map.easeTo({ zoom: map.getZoom() + d, duration: 250 });
  }

  // ---------- Плеєр ----------
  function setPlaying(v: boolean): void {
    if (v && finished) seek(0);
    playing = v;
    playBtn.innerHTML = playing ? ICON.pause : finished ? ICON.replay : ICON.play;
    playBtn.setAttribute('aria-label', playing ? 'Пауза' : 'Грати');
    lastT = performance.now();
  }
  function setSpeed(v: number): void {
    mult = v;
    speedBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(SPEEDS[i] === v)));
  }
  function seek(v: number): void {
    s = clamp(v, 0, L);
    finished = s >= L;
    finishBadge.classList.toggle('hidden', !finished);
    snapNext = true;
    forceUI = true;
    if (!playing) playBtn.innerHTML = finished ? ICON.replay : ICON.play;
  }
  playBtn.addEventListener('click', () => setPlaying(!playing));
  restartBtn.addEventListener('click', () => {
    seek(0);
    setPlaying(false);
    playBtn.innerHTML = ICON.play;
  });
  const onKey = (e: KeyboardEvent): void => {
    if (e.code === 'Space') {
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur?.();
      setPlaying(!playing);
    }
  };
  window.addEventListener('keydown', onKey);

  // Скраббер
  const scrubTo = (e: PointerEvent): void => {
    const r = scrub.getBoundingClientRect();
    // Тап біля самого краю доводить до початку/фінішу, щоб не лишалось «99,7%».
    const f = clamp((e.clientX - r.left) / r.width, 0, 1);
    seek((f > 0.985 ? 1 : f < 0.015 ? 0 : f) * L);
  };
  scrub.addEventListener('pointerdown', (e) => {
    dragging = true;
    scrub.setPointerCapture(e.pointerId);
    scrubTo(e);
  });
  scrub.addEventListener('pointermove', (e) => {
    if (dragging) scrubTo(e);
  });
  const endDrag = (): void => {
    dragging = false;
  };
  scrub.addEventListener('pointerup', endDrag);
  scrub.addEventListener('pointercancel', endDrag);
  scrub.addEventListener('keydown', (e) => {
    if (e.code === 'ArrowRight') seek(s + 50);
    else if (e.code === 'ArrowLeft') seek(s - 50);
    else return;
    e.preventDefault();
  });

  setSpeed(1);

  // ---------- Оновлення UI (лише при зміні значень) ----------
  let forceUI = true;
  let lastStreetIdx = -2;
  let lastStep = -1;
  let lastNextKey = '';
  let lastGradP = -1;
  let lastMinimapT = 0;
  let lastMinimapS = -1;
  let wasFinished = false;

  const streets = route.streets;
  const pois = route.pois;
  let nextIdx = 0;

  function streetIndex(v: number): number {
    for (let i = 0; i < streets.length; i++) {
      if (v < streets[i]!.toM) return i;
    }
    return streets.length - 1;
  }

  function updateUI(now: number): void {
    const si = streetIndex(s);
    if (si !== lastStreetIdx) {
      lastStreetIdx = si;
      const name = streets[si]?.name;
      // Безіменні ділянки: перша — виїзд із ТСЦ, остання — заїзд, решта — з'їзди розв'язок.
      streetName.textContent = name
        ? name
        : si === 0
          ? 'Виїзд із ТСЦ'
          : si === streets.length - 1
            ? 'Заїзд до ТСЦ'
            : 'З’їзд';
    }

    const step = Math.floor(s / 10);
    if (step !== lastStep || forceUI) {
      lastStep = step;
      progText.textContent = `${finished ? Math.round(L) : Math.min(Math.round(L), Math.round(s / 10) * 10)} з ${Math.round(L)} м`;
      const frac = s / L;
      barFill.style.transform = `scaleX(${frac.toFixed(4)})`;
      fill.style.transform = `scaleX(${frac.toFixed(4)})`;
      thumb.style.left = `${(frac * 100).toFixed(2)}%`;
      scrub.setAttribute('aria-valuenow', String(Math.round(frac * 100)));
    }

    // Наступний POI
    while (nextIdx > 0 && pois[nextIdx - 1]!.distanceAlongM > s) nextIdx--;
    while (nextIdx < pois.length && pois[nextIdx]!.distanceAlongM <= s) nextIdx++;
    const np = pois[nextIdx];
    let key = '';
    if (np) {
      const d = np.distanceAlongM - s;
      if (d <= NEXT_POI_RANGE) {
        const rounded = d <= 50 ? Math.max(5, Math.ceil(d / 5) * 5) : Math.ceil(d / 10) * 10;
        key = `${np.id}|${rounded}`;
        if (key !== lastNextKey) {
          if (!lastNextKey.startsWith(np.id + '|')) nextIcon.innerHTML = signSvg(np.type, 30);
          nextText.replaceChildren(
            h('span', { class: 'muted' }, 'Далі: '),
            np.label,
            h('b', null, ` — ${rounded} м`),
          );
        }
      }
    }
    if (key !== lastNextKey) {
      lastNextKey = key;
      nextCard.classList.toggle('hidden', key === '');
    }

    if (finished !== wasFinished) {
      wasFinished = finished;
      finishBadge.classList.toggle('hidden', !finished);
      if (finished) {
        playing = false;
        playBtn.innerHTML = ICON.replay;
        playBtn.setAttribute('aria-label', 'Заново');
      }
    }

    // Пройдена частина лінії та мінікарта — не частіше ~4 разів/с
    if (now - lastMinimapT > 250 || forceUI) {
      const p = s / L;
      if (mapLoaded && map.getLayer('route-line') && Math.abs(p - lastGradP) > 0.0003) {
        lastGradP = p;
        map.setPaintProperty('route-line', 'line-gradient', gradientExpr(p));
      }
      if (Math.abs(s - lastMinimapS) > 0.5) {
        lastMinimapS = s;
        minimap.draw(s * factor);
      }
      lastMinimapT = now;
    }
    forceUI = false;
  }

  // ---------- Цикл анімації ----------
  let raf = 0;
  let lastT = performance.now();

  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0, (now - lastT) / 1000));
    lastT = now;

    if (playing && !dragging) {
      s += BASE_SPEED * mult * dt;
      if (s >= L) {
        s = L;
        finished = true;
      }
    }

    const u = s * factor;
    pointAt(track, u, tmp);
    const target = headingAt(track, u);
    if (snapNext || Math.abs(s - lastS) > 60) carHead = target;
    else carHead = (carHead + angleDiff(carHead, target) * (1 - Math.exp(-dt * 7)) + 360) % 360;
    lastS = s;
    snapNext = false;

    marker.setLngLat(tmp);
    marker.setRotation(carHead);

    if (follow && !userBusy) {
      const kp = 1 - Math.exp(-dt * 12);
      camLng += (tmp[0] - camLng) * kp;
      camLat += (tmp[1] - camLat) * kp;
      camBearing = (camBearing + angleDiff(camBearing, carHead) * (1 - Math.exp(-dt * 2.6)) + 360) % 360;
      camZoom += (zoomTarget - camZoom) * (1 - Math.exp(-dt * 7));
      camPitch += (DEFAULT_PITCH - camPitch) * (1 - Math.exp(-dt * 4));
      if (
        Math.abs(camLng - applied.lng) > 1e-9 ||
        Math.abs(camLat - applied.lat) > 1e-9 ||
        Math.abs(camBearing - applied.b) > 0.01 ||
        Math.abs(camZoom - applied.z) > 0.0005 ||
        Math.abs(camPitch - applied.p) > 0.01 ||
        padTop !== applied.pad ||
        Number.isNaN(applied.lng)
      ) {
        applied.lng = camLng;
        applied.lat = camLat;
        applied.b = camBearing;
        applied.z = camZoom;
        applied.p = camPitch;
        applied.pad = padTop;
        map.jumpTo({
          center: [camLng, camLat],
          bearing: camBearing,
          zoom: camZoom,
          pitch: camPitch,
          padding: { top: padTop, bottom: 0, left: 0, right: 0 },
        });
      }
    }

    updateUI(now);
  }

  const onVis = (): void => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
      if (playing) setPlaying(false);
    } else if (!raf) {
      lastT = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };
  document.addEventListener('visibilitychange', onVis);
  raf = requestAnimationFrame(frame);

  // Для тестів/відлагодження.
  if (import.meta.env.DEV) (window as unknown as { __virazh?: unknown }).__virazh = {
    get s() {
      return s;
    },
    play: () => setPlaying(true),
    setSpeed,
    map,
    route,
  };

  return () => {
    cancelAnimationFrame(raf);
    raf = 0;
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('keydown', onKey);
    ro.disconnect();
    popup?.remove();
    map.remove();
    delete (window as unknown as { __virazh?: unknown }).__virazh;
  };
}
