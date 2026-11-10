import { loadCenter, DataError } from '../data';
import { ICON } from '../icons';
import { fmtKm, h, svgEl } from '../util';
import { renderState } from './state';
import { footer } from './footer';

export async function mountCenter(root: HTMLElement, id: string): Promise<() => void> {
  let alive = true;
  root.replaceChildren(renderState({ kind: 'loading', text: 'Завантажуємо маршрути…' }));
  try {
    const c = await loadCenter(id);
    if (!alive) return () => {};
    const back = h('a', { class: 'icon-btn glass', href: '#/', 'aria-label': 'Назад' });
    back.innerHTML = ICON.back;
    const rows = [...c.routes]
      .sort((a, b) => a.number - b.number)
      .map((r) =>
        h(
          'a',
          { class: 'row', href: `#/center/${c.id}/route/${r.number}` },
          h('div', { class: 'badge-num' }, String(r.number)),
          h(
            'div',
            { class: 'row-main' },
            h('div', { class: 'row-title' }, r.name, r.verified ? null : h('span', { class: 'badge-draft' }, 'чернетка')),
            h('div', { class: 'row-sub' }, `${fmtKm(r.lengthM)} · категорії ${r.category}`),
          ),
          svgEl(`<span class="chev">${ICON.chevron}</span>`),
        ),
      );
    root.replaceChildren(
      h(
        'div',
        { class: 'scroll' },
        h(
          'header',
          { class: 'topbar' },
          back,
          h('div', null, h('h1', { class: 'h1-sm' }, c.name), h('p', { class: 'sub' }, `${c.city}, ${c.address}`)),
        ),
        h('h2', { class: 'section' }, 'Маршрути іспиту'),
        rows.length ? h('div', { class: 'list' }, ...rows) : h('p', { class: 'note' }, 'Маршрутів поки немає.'),
        footer(),
      ),
    );
  } catch (e) {
    const notfound = e instanceof DataError && e.kind === 'notfound';
    root.replaceChildren(
      renderState(
        notfound
          ? { kind: 'error', title: 'ТСЦ не знайдено', text: 'Такого центру немає у списку.', backHref: '#/' }
          : {
              kind: 'error',
              title: 'Немає мережі',
              text: 'Не вдалося завантажити маршрути. Перевірте інтернет і спробуйте ще раз.',
              backHref: '#/',
              retry: () => void mountCenter(root, id),
            },
      ),
    );
  }
  return () => {
    alive = false;
  };
}
