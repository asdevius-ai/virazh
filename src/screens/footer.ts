import { h } from '../util';

export function footer(): HTMLElement {
  return h(
    'footer',
    { class: 'foot' },
    h('p', { class: 'disclaimer' }, 'Тільки для ознайомлення: фактичний маршрут залежить від екзаменатора.'),
    h(
      'p',
      { class: 'attr' },
      'Карта ',
      h('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener' }, '© OpenStreetMap contributors'),
      ' · OpenFreeMap · OpenMapTiles',
    ),
  );
}
