import { inject } from '@vercel/analytics';
import { Game } from './core/Game.js';

const host = typeof window !== 'undefined' ? window.location.hostname : '';
if (typeof window !== 'undefined' && !window.CrazyGames && /(^|\.)slopdrift\.xyz$|\.vercel\.app$/i.test(host)) {
  inject();
}

const root = document.querySelector('#app');
const game = new Game(root);
// Handy for debugging from the console; nothing in the game reads it.
globalThis.__SLOP_DRIFT__ = game;

game.init().catch((error) => {
  console.error(error);
  const failure = document.createElement('section');
  failure.className = 'fatal-error';
  const title = document.createElement('h2');
  title.textContent = 'Slop-Drift could not start';
  const detail = document.createElement('p');
  detail.textContent = String(error?.message || error);
  const hint = document.createElement('p');
  hint.textContent = 'The game needs WebGL 2. Try a current desktop browser with hardware acceleration enabled.';
  failure.append(title, detail, hint);
  root.appendChild(failure);
});
