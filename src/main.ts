import './style.css';
import { BASE } from './util';
import { mountHome } from './screens/home';
import { mountCenter } from './screens/center';
import { mountPlayer } from './screens/player';

const app = document.getElementById('app')!;
let dispose: (() => void) | undefined;
let token = 0;

async function route(): Promise<void> {
  const my = ++token;
  dispose?.();
  dispose = undefined;
  app.className = '';
  const hash = location.hash.replace(/^#/, '') || '/';
  const player = hash.match(/^\/center\/([^/]+)\/route\/(\d+)\/?$/);
  const center = hash.match(/^\/center\/([^/]+)\/?$/);
  let d: () => void;

  if (player) {
    app.className = 'is-player';
    d = await mountPlayer(app, decodeURIComponent(player[1]!), Number(player[2]));
  } else if (center) {
    d = await mountCenter(app, decodeURIComponent(center[1]!));
  } else if (import.meta.env.DEV && hash === '/digitizer') {
    app.className = 'is-player';
    const mod = await import('./screens/digitizer');
    d = mod.mountDigitizer(app);
  } else {
    d = await mountHome(app);
  }
  if (my !== token) d();
  else dispose = d;
}

window.addEventListener('hashchange', () => void route());
void route();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(BASE + 'sw.js', { scope: BASE }).catch(() => {
      /* офлайн-режим необовʼязковий */
    });
  });
}
