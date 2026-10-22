import './styles.css';
import { Game } from './Game.js';

const root = document.querySelector('#app');
const game = new Game(root);
game.init().catch((error) => {
  console.error(error);
  const failure = document.createElement('section');
  failure.className = 'fatal-error';
  failure.innerHTML = `<div><div class="eyebrow">LOAD FAILURE</div><h2>Could not start the race</h2><p>${String(error?.message || error)}</p><p>Check that <code>public/models/car.glb</code> and <code>public/models/track.glb</code> are present.</p></div>`;
  root.appendChild(failure);
});

window.__DRIFT_LAB__ = game;
