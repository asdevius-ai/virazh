// Власні SVG-іконки: дорожні знаки в стилі українських, машинка, логотип.
import type { PoiType } from './types';

const RED = '#D6262B';
const BLUE = '#1B5FC1';

function circleArrows(): string {
  // Три дугові стрілки по колу (знак 4.10 «Круговий рух»).
  let out = '';
  const cx = 32;
  const cy = 32;
  const r = 15;
  for (let k = 0; k < 3; k++) {
    const a0 = (k * 120 + 15) * (Math.PI / 180);
    const a1 = (k * 120 + 85) * (Math.PI / 180);
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    out += `<path d="M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" fill="none" stroke="#fff" stroke-width="4.5"/>`;
    // Наконечник стрілки по дотичній (напрямок руху — за годинниковою стрілкою)
    const tx = x1 + 6 * -Math.sin(a1);
    const ty = y1 + 6 * Math.cos(a1);
    const lx = x1 + 5.5 * Math.cos(a1);
    const ly = y1 + 5.5 * Math.sin(a1);
    const rx = x1 - 5.5 * Math.cos(a1);
    const ry = y1 - 5.5 * Math.sin(a1);
    out += `<path d="M${tx.toFixed(1)} ${ty.toFixed(1)} L${lx.toFixed(1)} ${ly.toFixed(1)} L${rx.toFixed(1)} ${ry.toFixed(1)}Z" fill="#fff"/>`;
  }
  return out;
}

const warnTri = (inner: string): string =>
  `<polygon points="32,6 59,54 5,54" fill="#fff" stroke="${RED}" stroke-width="6" stroke-linejoin="round"/>${inner}`;

const SIGNS: Record<PoiType, string> = {
  crossing: `<rect x="3" y="3" width="58" height="58" rx="8" fill="${BLUE}"/>
    <polygon points="32,10 53,49 11,49" fill="#fff" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="33" cy="22.5" r="3.2" fill="#111"/>
    <path d="M33 26 L30 35 M33 26 L36 33 M31.5 30 L26.5 33 M33 28 L38.5 28.5 M30 35 L27 44 M30 35 L35 40 L35 44" fill="none" stroke="#111" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  traffic_signals: `<rect x="17" y="3" width="30" height="58" rx="10" fill="#15181e" stroke="#fff" stroke-width="3"/>
    <circle cx="32" cy="16" r="6.5" fill="#E5322D"/><circle cx="32" cy="32" r="6.5" fill="#FFB020"/><circle cx="32" cy="48" r="6.5" fill="#2DD4A7"/>`,
  give_way: `<polygon points="6,9 58,9 32,56" fill="#fff" stroke="${RED}" stroke-width="7" stroke-linejoin="round"/>`,
  stop: `<polygon points="21,3 43,3 61,21 61,43 43,61 21,61 3,43 3,21" fill="${RED}" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>
    <text x="32" y="38" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="17" fill="#fff">STOP</text>`,
  roundabout: `<circle cx="32" cy="32" r="29" fill="${BLUE}"/>${circleArrows()}`,
  level_crossing: warnTri(
    `<rect x="19" y="30" width="26" height="6" fill="#111"/>
     <path d="M23 30 L27 36 M30 30 L34 36 M37 30 L41 36" stroke="#fff" stroke-width="2"/>
     <rect x="19" y="38" width="3" height="9" fill="#111"/><rect x="42" y="38" width="3" height="9" fill="#111"/>`,
  ),
  speed_bump: warnTri(
    `<path d="M16 47 Q32 22 48 47 Z" fill="#111"/><rect x="14" y="46" width="36" height="3" fill="#111"/>`,
  ),
  bus_stop: `<rect x="3" y="3" width="58" height="58" rx="8" fill="${BLUE}"/>
    <rect x="12" y="14" width="40" height="30" rx="6" fill="#fff"/>
    <rect x="16" y="18" width="14" height="10" rx="2" fill="${BLUE}"/><rect x="34" y="18" width="14" height="10" rx="2" fill="${BLUE}"/>
    <rect x="12" y="33" width="40" height="3" fill="${BLUE}"/>
    <circle cx="20" cy="47" r="4.5" fill="#fff"/><circle cx="44" cy="47" r="4.5" fill="#fff"/>`,
  sign: warnTri(
    `<rect x="29.5" y="21" width="5" height="19" rx="2" fill="#111"/><circle cx="32" cy="46" r="3" fill="#111"/>`,
  ),
};

export function signSvg(type: PoiType, size = 64): string {
  const inner = SIGNS[type] ?? SIGNS.sign;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">${inner}</svg>`;
}

/** Растеризує знак для map.addImage (96px, pixelRatio 2 → 48 CSS px при icon-size 1). */
export function signImage(type: PoiType): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image(96, 96);
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('icon ' + type));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(signSvg(type, 96));
  });
}

export const POI_TYPES = Object.keys(SIGNS) as PoiType[];

/** Темний шеврон для стрілок напрямку вздовж лінії (дивиться вправо, +x). */
export function arrowImage(): Promise<HTMLImageElement> {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="48" height="48"><path d="M2 3 L14 8 L2 13 L5 8Z" fill="#031210" stroke="#031210" stroke-width="0.6" stroke-linejoin="round"/></svg>';
  return new Promise((resolve, reject) => {
    const img = new Image(48, 48);
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('arrow'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}

/** Машинка, вид зверху, ніс вгору. */
export const CAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 80" width="36" height="60">
  <ellipse cx="24" cy="42" rx="21" ry="36" fill="rgba(0,0,0,.35)"/>
  <rect x="5" y="16" width="6" height="14" rx="2.5" fill="#12151B"/><rect x="37" y="16" width="6" height="14" rx="2.5" fill="#12151B"/>
  <rect x="5" y="52" width="6" height="14" rx="2.5" fill="#12151B"/><rect x="37" y="52" width="6" height="14" rx="2.5" fill="#12151B"/>
  <path d="M24 4 C35 4 40 10 40 22 L40 62 C40 72 34 77 24 77 C14 77 8 72 8 62 L8 22 C8 10 13 4 24 4Z" fill="#F4F6FA" stroke="#12151B" stroke-width="2"/>
  <path d="M13 27 Q24 21 35 27 L33 38 Q24 35 15 38Z" fill="#1B2431"/>
  <path d="M15 56 Q24 59 33 56 L34 64 Q24 67 14 64Z" fill="#1B2431"/>
  <rect x="21.5" y="43" width="5" height="9" rx="2" fill="#FFB020"/>
  <rect x="11" y="6.5" width="6" height="3" rx="1.5" fill="#FFB020"/><rect x="31" y="6.5" width="6" height="3" rx="1.5" fill="#FFB020"/>
  <rect x="11" y="71" width="6" height="2.5" rx="1.2" fill="#E5322D"/><rect x="31" y="71" width="6" height="2.5" rx="1.2" fill="#E5322D"/>
</svg>`;

export const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="44" height="44" aria-hidden="true">
  <rect width="64" height="64" rx="15" fill="#171B22"/>
  <path d="M16 50 V30 Q16 16 30 16 H46" fill="none" stroke="#2DD4A7" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M42 8 L56 16 L42 24Z" fill="#FFB020"/>
</svg>`;

export const ICON = {
  back: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>`,
  play: `<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M8 5.5v13a1 1 0 001.5.86l11-6.5a1 1 0 000-1.72l-11-6.5A1 1 0 008 5.5z"/></svg>`,
  pause: `<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>`,
  restart: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 5v14"/><path d="M19 6l-9 6 9 6z" fill="currentColor"/></svg>`,
  replay: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 108-8H8"/><path d="M11 1L8 4l3 3"/></svg>`,
  chevron: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
  minus: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/></svg>`,
  locate: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 17-7-4-7 4z"/></svg>`,
};
