import type { LngLat } from '../types';
import type { Track } from '../geo';
import { pointAt } from '../geo';

/** Мінікарта на canvas: увесь маршрут, пройдена частина й поточна точка. Без другої карти. */
export class Minimap {
  readonly el: HTMLCanvasElement;
  private base: HTMLCanvasElement;
  private pts: Array<[number, number]> = [];
  private size = 0;
  private dpr = 1;
  private tmp: LngLat = [0, 0];

  constructor(private track: Track) {
    this.el = document.createElement('canvas');
    this.el.className = 'minimap';
    this.base = document.createElement('canvas');
  }

  /** Викликати після вставки в DOM (потрібен розмір). */
  layout(): void {
    const r = this.el.getBoundingClientRect();
    const size = Math.round(Math.min(r.width, r.height)) || 104;
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.size = size;
    for (const c of [this.el, this.base]) {
      c.width = Math.round(size * this.dpr);
      c.height = Math.round(size * this.dpr);
    }
    const coords = this.track.coords;
    let w = Infinity,
      s = Infinity,
      e = -Infinity,
      n = -Infinity;
    for (const [x, y] of coords) {
      w = Math.min(w, x);
      e = Math.max(e, x);
      s = Math.min(s, y);
      n = Math.max(n, y);
    }
    const kx = Math.cos(((s + n) / 2) * (Math.PI / 180));
    const spanX = Math.max((e - w) * kx, 1e-6);
    const spanY = Math.max(n - s, 1e-6);
    const pad = 12;
    const k = (size - pad * 2) / Math.max(spanX, spanY);
    const ox = (size - spanX * k) / 2;
    const oy = (size - spanY * k) / 2;
    this.pts = coords.map(([x, y]) => [ox + (x - w) * kx * k, oy + (n - y) * k]);

    const g = this.base.getContext('2d')!;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, size, size);
    this.path(g, 0, this.pts.length - 1);
    g.strokeStyle = '#06090D';
    g.lineWidth = 6;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.stroke();
    g.strokeStyle = '#6E7A8F';
    g.lineWidth = 3;
    g.stroke();
    this.draw(0);
  }

  private path(g: CanvasRenderingContext2D, from: number, to: number): void {
    g.beginPath();
    g.moveTo(this.pts[from]![0], this.pts[from]![1]);
    for (let i = from + 1; i <= to; i++) g.lineTo(this.pts[i]![0], this.pts[i]![1]);
  }

  /** u — пройдена відстань у метрах трека. */
  draw(u: number): void {
    if (!this.size) return;
    const g = this.el.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.el.width, this.el.height);
    g.drawImage(this.base, 0, 0);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const cum = this.track.cum;
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1]! <= u) i++;
    const a = this.pts[i]!;
    const b = this.pts[i + 1] ?? a;
    const len = cum[i + 1]! - cum[i]! || 1;
    const f = Math.min(1, Math.max(0, (u - cum[i]!) / len));
    const cx = a[0] + (b[0] - a[0]) * f;
    const cy = a[1] + (b[1] - a[1]) * f;

    if (u > 0) {
      g.beginPath();
      g.moveTo(this.pts[0]![0], this.pts[0]![1]);
      for (let j = 1; j <= i; j++) g.lineTo(this.pts[j]![0], this.pts[j]![1]);
      g.lineTo(cx, cy);
      g.strokeStyle = '#2DD4A7';
      g.lineWidth = 3;
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.stroke();
    }
    // Фініш і машинка.
    const last = this.pts[this.pts.length - 1]!;
    g.beginPath();
    g.arc(last[0], last[1], 3.5, 0, Math.PI * 2);
    g.fillStyle = '#FFB020';
    g.fill();
    g.beginPath();
    g.arc(cx, cy, 5.5, 0, Math.PI * 2);
    g.fillStyle = '#FFFFFF';
    g.fill();
    g.lineWidth = 2.5;
    g.strokeStyle = '#FFB020';
    g.stroke();
  }

  /** Допоміжне: координата за відстанню (для зовнішнього використання). */
  at(u: number): LngLat {
    return pointAt(this.track, u, this.tmp);
  }
}
