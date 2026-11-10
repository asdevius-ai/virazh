type Child = Node | string | null | undefined | false;

/** Мінімальний конструктор DOM-елементів. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else el.setAttribute(k, v);
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

export function svgEl(markup: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild as HTMLElement;
}

export const BASE = import.meta.env.BASE_URL;

/** Метри → «850 м» / «1,2 км». */
export function fmtDist(m: number): string {
  if (m < 1000) return `${Math.round(m)} м`;
  return `${(m / 1000).toFixed(1).replace('.', ',')} км`;
}

export function fmtKm(m: number): string {
  return `${(m / 1000).toFixed(1).replace('.', ',')} км`;
}

export function pluralRoutes(n: number): string {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return `${n} маршрут`;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return `${n} маршрути`;
  return `${n} маршрутів`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
