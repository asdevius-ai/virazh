import { h } from '../util';

export type StateView =
  | { kind: 'loading'; text: string }
  | { kind: 'error'; title: string; text: string; backHref?: string; retry?: () => void };

/** Повноекранний стан: завантаження або помилка людською мовою. */
export function renderState(v: StateView): HTMLElement {
  if (v.kind === 'loading') {
    return h('div', { class: 'state' }, h('div', { class: 'spinner' }), h('p', null, v.text));
  }
  const actions = h('div', { class: 'state-actions' });
  if (v.retry) {
    const b = h('button', { class: 'btn primary' }, 'Спробувати ще');
    b.addEventListener('click', v.retry);
    actions.append(b);
  }
  if (v.backHref) actions.append(h('a', { class: 'btn', href: v.backHref }, 'Назад'));
  return h('div', { class: 'state' }, h('h2', null, v.title), h('p', null, v.text), actions);
}
