// Dev-інструмент: розстановка опорних точок маршруту й експорт блоку waypoints у YAML.
// Доступний лише в dev (#/digitizer), у production-збірку не потрапляє.
import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../map/worker';
import { h } from '../util';

interface Pt {
  lng: number;
  lat: number;
  uturn: boolean;
  note: string;
  marker: Marker;
  badge: HTMLElement;
}

export function mountDigitizer(root: HTMLElement): () => void {
  const mapEl = h('div', { class: 'map' });
  const list = h('div', { class: 'digi-list' });
  const hint = h('p', null, 'Клік по карті — нова точка. Перетягуйте маркери. Позначка «розворот» додає uturn: true.');
  const copyBtn = h('button', { class: 'btn primary' }, 'Копіювати YAML');
  const clearBtn = h('button', { class: 'btn' }, 'Очистити');
  const out = h('textarea', { rows: '1', style: 'position:absolute;left:-9999px' });
  root.replaceChildren(
    h(
      'div',
      { class: 'digi' },
      mapEl,
      h(
        'aside',
        null,
        h('header', null, h('h1', null, 'Дігітайзер'), hint, h('a', { href: '#/', style: 'color:#FFB020;font-size:13px' }, '← на головну')),
        list,
        h('footer', null, copyBtn, clearBtn),
        out,
      ),
    ),
  );

  const map: MlMap = new maplibregl.Map({
    container: mapEl,
    style: {
      version: 8,
      sources: {
        osm: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          maxzoom: 19,
          attribution: '© OpenStreetMap contributors',
        },
      },
      layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
    },
    center: [26.9871, 49.4222],
    zoom: 13,
    attributionControl: { compact: false },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');

  const pts: Pt[] = [];

  function yaml(): string {
    const lines = ['waypoints:'];
    for (const p of pts) {
      const note = p.note.replace(/"/g, '\\"');
      const u = p.uturn ? ', uturn: true' : '';
      lines.push(`  - { lat: ${p.lat.toFixed(6)}, lng: ${p.lng.toFixed(6)}${u}, note: "${note}" }`);
    }
    return lines.join('\n') + '\n';
  }

  function render(): void {
    list.replaceChildren(
      ...pts.map((p, i) => {
        p.badge.textContent = String(i + 1);
        p.badge.classList.toggle('u', p.uturn);
        const n = h('div', { class: 'n' + (p.uturn ? ' u' : '') }, String(i + 1));
        const note = h('input', { type: 'text', placeholder: 'примітка', value: p.note });
        note.addEventListener('input', () => (p.note = note.value));
        const cb = h('input', { type: 'checkbox' });
        cb.checked = p.uturn;
        cb.addEventListener('change', () => {
          p.uturn = cb.checked;
          render();
        });
        const del = h('button', { 'aria-label': 'Видалити точку' }, '✕');
        del.addEventListener('click', () => {
          p.marker.remove();
          pts.splice(pts.indexOf(p), 1);
          render();
        });
        return h('div', { class: 'digi-pt' }, n, note, h('label', null, cb, 'розворот'), del);
      }),
    );
  }

  function addPoint(lng: number, lat: number): void {
    const badge = h('div', { class: 'digi-marker' });
    const marker = new maplibregl.Marker({ element: badge, draggable: true }).setLngLat([lng, lat]).addTo(map);
    const p: Pt = { lng, lat, uturn: false, note: '', marker, badge };
    marker.on('dragend', () => {
      const ll = marker.getLngLat();
      p.lng = ll.lng;
      p.lat = ll.lat;
    });
    badge.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      p.uturn = !p.uturn;
      render();
    });
    pts.push(p);
    render();
  }

  map.on('click', (e) => addPoint(e.lngLat.lng, e.lngLat.lat));
  copyBtn.addEventListener('click', async () => {
    const text = yaml();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      out.value = text;
      out.select();
      document.execCommand('copy');
    }
    copyBtn.textContent = 'Скопійовано ✓';
    setTimeout(() => (copyBtn.textContent = 'Копіювати YAML'), 1500);
  });
  clearBtn.addEventListener('click', () => {
    for (const p of pts) p.marker.remove();
    pts.length = 0;
    render();
  });

  return () => map.remove();
}
