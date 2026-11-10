import { loadCenters, DataError, isMock } from '../data';
import { ICON, LOGO_SVG } from '../icons';
import { h, pluralRoutes, svgEl } from '../util';
import { renderState } from './state';
import { footer } from './footer';

export async function mountHome(root: HTMLElement): Promise<() => void> {
  let alive = true;
  root.replaceChildren(renderState({ kind: 'loading', text: 'Завантажуємо список ТСЦ…' }));
  try {
    const centers = await loadCenters();
    if (!alive) return () => {};
    const list = h(
      'div',
      { class: 'list' },
      ...centers.map((c) =>
        h(
          'a',
          { class: 'row', href: `#/center/${c.id}` },
          h('div', { class: 'badge-num' }, c.id.slice(-4)),
          h(
            'div',
            { class: 'row-main' },
            h('div', { class: 'row-title' }, c.name),
            h('div', { class: 'row-sub' }, `${c.city}, ${c.address}`),
            h('div', { class: 'row-meta' }, pluralRoutes(c.routeCount)),
          ),
          svgEl(`<span class="chev">${ICON.chevron}</span>`),
        ),
      ),
    );
    root.replaceChildren(
      h(
        'div',
        { class: 'scroll' },
        h(
          'header',
          { class: 'hero' },
          svgEl(`<span class="logo">${LOGO_SVG}</span>`),
          h('h1', null, 'Вираж'),
          h(
            'p',
            null,
            'Тренажер маршрутів практичного іспиту з водіння. Відкрийте маршрут, натисніть «Грати» — машинка проїде ним, а зверху видно вулицю, знаки й переходи, що чекають попереду.',
          ),
        ),
        h('h2', { class: 'section' }, 'Територіальні сервісні центри'),
        list,
        isMock() ? h('p', { class: 'note' }, 'Показано демонстраційні дані: справжні маршрути ще не опубліковано.') : null,
        footer(),
      ),
    );
  } catch (e) {
    const offline = !(e instanceof DataError) || e.kind === 'offline';
    root.replaceChildren(
      renderState({
        kind: 'error',
        title: offline ? 'Немає мережі' : 'Не вдалося завантажити дані',
        text: 'Перевірте інтернет і спробуйте ще раз.',
        retry: () => void mountHome(root),
      }),
    );
  }
  return () => {
    alive = false;
  };
}
