import { Game } from './core/Game.js';

const host = typeof window !== 'undefined' ? window.location.hostname : '';
const isCrazyBuild = typeof __CRAZYGAMES_BUILD__ !== 'undefined' && __CRAZYGAMES_BUILD__;
if (!isCrazyBuild && typeof window !== 'undefined' && !window.CrazyGames && /(^|\.)slopdrift\.xyz$|\.vercel\.app$/i.test(host)) {
  import('@vercel/analytics').then(({ inject }) => inject()).catch(() => {});
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
  failure.append(title, detail);
  if (/webgl|graphics context/i.test(detail.textContent)) {
    const hint = document.createElement('p');
    hint.textContent = 'The game needs WebGL 2. Try a current desktop browser with hardware acceleration enabled.';
    failure.appendChild(hint);
  }
  root.appendChild(failure);
});
