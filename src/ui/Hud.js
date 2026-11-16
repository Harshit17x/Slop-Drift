// Racing HUD, menus, settings, results, loading screen and minimap.
// DOM is built once in the constructor. update(frame) runs every animation frame and only writes to the
// DOM when a displayed (quantised) value actually changed; it never reads layout.

import {
  DEFAULT_SETTINGS, HANDLING_PRESETS, PAINT_OPTIONS, QUALITY_PRESETS, TIME_OF_DAY, normalizeSettings,
} from '../config.js';
import { ElevationStrip, Minimap } from './Minimap.js';

const KMH_TO_MPH = 0.621371;
const M_TO_FT = 3.28084;

// ------------------------------------------------------------------ formatting (exported for tests)

export function formatTime(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '--:--.--';
  const cs = Math.max(0, Math.floor(seconds * 100 + 1e-6));
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${m}:${s < 10 ? '0' : ''}${s}.${c < 10 ? '0' : ''}${c}`;
}

export function formatDelta(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '';
  const sign = seconds < 0 ? '−' : '+';
  return `${sign}${Math.abs(seconds).toFixed(2)}`;
}

export function formatInt(value) {
  const n = Math.round(Number(value) || 0);
  const s = String(Math.abs(n));
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ',';
    out += s[i];
  }
  return n < 0 ? `-${out}` : out;
}

/** 'time' | 'score' | 'none' — which record a mode keeps. */
export function recordKind(mode) {
  if (!mode || mode.id === 'roam') return 'none';
  if (mode.id === 'drift' || mode.timeLimit) return 'score';
  return 'time';
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const hex = (n) => `#${(n >>> 0).toString(16).padStart(6, '0')}`;

// ------------------------------------------------------------------ cached DOM writers

/** A text slot that only touches the DOM when its value changes. */
class Text {
  constructor(el) {
    this.node = document.createTextNode('');
    el.replaceChildren(this.node);
    this.raw = undefined;
  }

  set(str) {
    if (str !== this.raw) {
      this.raw = str;
      this.node.data = str;
    }
  }

  /** Compares the raw (usually quantised numeric) key; formats only when it changed. */
  setKey(key, format) {
    if (key !== this.raw) {
      this.raw = key;
      this.node.data = format(key);
    }
  }
}

class Flag {
  constructor(el, cls) {
    this.el = el;
    this.cls = cls;
    this.v = el.classList.contains(cls);
  }

  set(on) {
    const v = Boolean(on);
    if (v !== this.v) {
      this.v = v;
      this.el.classList.toggle(this.cls, v);
    }
  }
}

class Style {
  constructor(el, prop) {
    this.el = el;
    this.prop = prop;
    this.key = undefined;
  }

  setKey(key, format) {
    if (key !== this.key) {
      this.key = key;
      this.el.style.setProperty(this.prop, format(key));
    }
  }
}

// ------------------------------------------------------------------ icons

const ICON = {
  camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13.3" r="3.4"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 5.5v13M15.5 5.5v13" stroke-width="3.2"/></svg>',
  expand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  shrink: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
  sliders: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
  respawn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4.5H9"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5z" fill="currentColor" stroke="none"/></svg>',
  restart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4.5H15"/></svg>',
  home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11.5 12 5l8 6.5M6.5 10v9h11v-9"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6 8.5 12l6 6"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
};

// ------------------------------------------------------------------ gauge geometry

const G = { cx: 110, cy: 110, r: 92, a0: 135, sweep: 270 };

function polar(r, deg) {
  const a = (deg * Math.PI) / 180;
  return [G.cx + r * Math.cos(a), G.cy + r * Math.sin(a)];
}

function arcPath(r, f0, f1) {
  const a0 = G.a0 + G.sweep * f0;
  const a1 = G.a0 + G.sweep * f1;
  const [x0, y0] = polar(r, a0);
  const [x1, y1] = polar(r, a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

let stylesRefCount = 0;

export class Hud {
  /**
   * @param {HTMLElement} root
   * @param {{settings?: Object, modes?: Array, records?: Object, injectStyles?: boolean,
   *          minimap?: {radius?: number, rotate?: boolean}}} options
   */
  constructor(root, { settings = DEFAULT_SETTINGS, modes = [], records = {}, injectStyles = true, minimap = {} } = {}) {
    this.root = root;
    this.modes = modes;
    this.records = records || {};
    this.settings = normalizeSettings(settings);
    this.uid = `sdh${Math.random().toString(36).slice(2, 8)}`;
    this.screen = 'menu';
    this.settingsOpen = false;
    this.settingsSource = 'menu';
    this.debugVisible = false;
    this.countdownText = '';
    this.track = null;
    this.activeRoad = null;
    this.lastCar = null;
    this.timers = new Set();
    this.reducedMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

    // Callbacks assigned by the game.
    const noop = () => {};
    this.onStart = noop;
    this.onPause = noop;
    this.onResume = noop;
    this.onRestart = noop;
    this.onMenu = noop;
    this.onOpenSettings = noop;
    this.onCloseSettings = noop;
    this.onApplySettings = noop;
    this.onFullscreen = noop;
    this.onCamera = noop;
    this.onRespawn = noop;

    if (injectStyles) this.injectStyles();
    this.build();
    this.bind();
    this.setRecords(this.records);
    this.setSettings(this.settings);
    this.minimap = new Minimap(this.q('.sdh-map canvas'), { radius: minimap.radius ?? 420, rotate: minimap.rotate ?? true });
    this.elevation = new ElevationStrip(this.q('.sdh-elev-strip'));
    this.applyScreen();
  }

  injectStyles() {
    this.injectedStyles = true;
    stylesRefCount += 1;
    if (document.querySelector('link[data-sdh-styles]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./hud.css', import.meta.url).href;
    link.dataset.sdhStyles = '';
    document.head.appendChild(link);
  }

  q(sel) {
    return this.el.querySelector(sel);
  }

  // ---------------------------------------------------------------- build

  build() {
    const el = document.createElement('div');
    el.className = 'sdh';
    // Hidden until hud.css applies (it overrides this with !important), so no unstyled flash on first paint.
    el.style.visibility = 'hidden';
    el.innerHTML = `
      <div class="sdh-race" aria-hidden="true">
        <section class="sdh-tl sdh-card">
          <div class="sdh-mode"><span class="sdh-mode-label"></span><span class="sdh-lap"></span></div>
          <div class="sdh-main"><span class="sdh-main-time sdh-num"></span></div>
          <div class="sdh-rows">
            <div class="sdh-row" data-row="0"><span class="sdh-k"></span><span class="sdh-v sdh-num"></span></div>
            <div class="sdh-row" data-row="1"><span class="sdh-k"></span><span class="sdh-v sdh-num"></span></div>
            <div class="sdh-row" data-row="2"><span class="sdh-k"></span><span class="sdh-v sdh-num"></span></div>
          </div>
          <div class="sdh-progress"><i></i></div>
        </section>
        <div class="sdh-tc">
          <div class="sdh-wrongway" role="alert"><span>WRONG WAY</span></div>
          <button type="button" class="sdh-offroad" data-act="respawn" tabindex="-1">
            <span class="sdh-offroad-text">Off road</span><span class="sdh-keycap">R</span><span>respawn</span>
          </button>
        </div>
        <div class="sdh-tr">
          <div class="sdh-iconbar">
            <button type="button" class="sdh-icon" data-act="camera" aria-label="Change camera" title="Camera (C)">${ICON.camera}</button>
            <button type="button" class="sdh-icon" data-act="pause" aria-label="Pause" title="Pause (Esc)">${ICON.pause}</button>
            <button type="button" class="sdh-icon sdh-fs" data-act="fullscreen" aria-label="Fullscreen" title="Fullscreen (F)">${ICON.expand}${ICON.shrink}</button>
          </div>
          <div class="sdh-cam-chip"><span></span></div>
        </div>
        <section class="sdh-bl">
          <div class="sdh-map"><canvas aria-label="Minimap"></canvas></div>
          <div class="sdh-elev sdh-card">
            <div class="sdh-elev-top">
              <span class="sdh-k">ALT</span>
              <span class="sdh-elev-alt sdh-num"></span><span class="sdh-elev-unit"></span>
              <span class="sdh-grade"><svg viewBox="0 0 20 12" aria-hidden="true"><path d="M1 11h18L19 3z"/></svg><span class="sdh-grade-v sdh-num"></span></span>
            </div>
            <canvas class="sdh-elev-strip" aria-hidden="true"></canvas>
          </div>
        </section>
        <section class="sdh-bc">
          <div class="sdh-drift">
            <div class="sdh-drift-head">
              <span class="sdh-drift-tag">DRIFT</span>
              <span class="sdh-drift-angle sdh-num"></span>
              <span class="sdh-drift-mult sdh-num"></span>
            </div>
            <div class="sdh-drift-bank sdh-num"></div>
            <div class="sdh-drift-timer"><i></i></div>
            <div class="sdh-drift-total"><span class="sdh-k">TOTAL</span><span class="sdh-drift-score sdh-num"></span></div>
          </div>
        </section>
        <section class="sdh-br">
          <div class="sdh-speedo">
            <div class="sdh-gauge">
              <svg viewBox="0 0 220 220" aria-hidden="true">
                <path class="sdh-g-track" d="${arcPath(G.r, 0, 1)}"/>
                <path class="sdh-g-red"/>
                <g class="sdh-g-ticks"></g>
                <path class="sdh-g-fill" d="${arcPath(G.r, 0, 1)}" pathLength="1000"/>
              </svg>
              <div class="sdh-readout">
                <span class="sdh-speed sdh-num"></span>
                <span class="sdh-unit"></span>
              </div>
              <div class="sdh-gearbox">
                <span class="sdh-pedal sdh-pedal-brake"><i></i></span>
                <span class="sdh-gear sdh-num"></span>
                <span class="sdh-pedal sdh-pedal-gas"><i></i></span>
              </div>
            </div>
            <div class="sdh-nitro"><span class="sdh-k">N₂O</span><div class="sdh-nitro-bar"><i></i></div></div>
          </div>
        </section>
        <pre class="sdh-debug"></pre>
      </div>
      <div class="sdh-countdown" aria-live="assertive"><span></span></div>
      <div class="sdh-toasts" aria-live="polite"></div>
      <div class="sdh-touch" aria-hidden="true"></div>
      <div class="sdh-veil"></div>
      ${this.menuMarkup()}
      ${this.pauseMarkup()}
      <aside class="sdh-panel sdh-panel-finish" data-panel="finish" aria-label="Results"><div class="sdh-finish-body"></div></aside>
      ${this.settingsMarkup()}
      <div class="sdh-loading" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-label="Loading">
        <div class="sdh-loading-inner">
          <div class="sdh-brand sdh-brand-xl"><span>SLOP</span><b>DRIFT</b></div>
          <div class="sdh-loading-sub">Mountain</div>
          <div class="sdh-loading-bar"><i></i></div>
          <div class="sdh-loading-meta"><span class="sdh-loading-label"></span><span class="sdh-loading-pct sdh-num"></span></div>
        </div>
      </div>`;
    this.root.appendChild(el);
    this.el = el;
    this.touchRoot = this.q('.sdh-touch');
    this.raceEl = this.q('.sdh-race');

    const row = (i) => this.q(`.sdh-row[data-row="${i}"]`);
    this.v = {
      modeLabel: new Text(this.q('.sdh-mode-label')),
      lap: new Text(this.q('.sdh-lap')),
      mainTime: new Text(this.q('.sdh-main-time')),
      mainWarn: new Flag(this.q('.sdh-main'), 'is-warn'),
      rows: [0, 1, 2].map((i) => ({
        el: row(i),
        k: new Text(row(i).querySelector('.sdh-k')),
        v: new Text(row(i).querySelector('.sdh-v')),
        show: new Flag(row(i), 'is-on'),
        good: new Flag(row(i), 'is-good'),
      })),
      progress: new Style(this.q('.sdh-progress i'), 'transform'),
      progressOn: new Flag(this.q('.sdh-progress'), 'is-on'),
      wrongWay: new Flag(this.q('.sdh-wrongway'), 'is-on'),
      offRoad: new Flag(this.q('.sdh-offroad'), 'is-on'),
      camChip: new Text(this.q('.sdh-cam-chip span')),
      camChipOn: new Flag(this.q('.sdh-cam-chip'), 'is-on'),
      alt: new Text(this.q('.sdh-elev-alt')),
      altUnit: new Text(this.q('.sdh-elev-unit')),
      grade: new Text(this.q('.sdh-grade-v')),
      gradeTilt: new Style(this.q('.sdh-grade svg'), 'transform'),
      gradeSteep: new Flag(this.q('.sdh-grade'), 'is-steep'),
      gradeDown: new Flag(this.q('.sdh-grade'), 'is-down'),
      driftOn: new Flag(this.q('.sdh-drift'), 'is-on'),
      driftActive: new Flag(this.q('.sdh-drift'), 'is-active'),
      driftAngle: new Text(this.q('.sdh-drift-angle')),
      driftMult: new Text(this.q('.sdh-drift-mult')),
      driftBank: new Text(this.q('.sdh-drift-bank')),
      driftTimer: new Style(this.q('.sdh-drift-timer i'), 'transform'),
      driftScore: new Text(this.q('.sdh-drift-score')),
      speed: new Text(this.q('.sdh-speed')),
      unit: new Text(this.q('.sdh-unit')),
      gear: new Text(this.q('.sdh-gear')),
      rpmFill: new Style(this.q('.sdh-g-fill'), 'stroke-dashoffset'),
      shift: new Flag(this.q('.sdh-speedo'), 'is-shift'),
      redzone: new Flag(this.q('.sdh-speedo'), 'is-red'),
      reverse: new Flag(this.q('.sdh-speedo'), 'is-reverse'),
      gas: new Style(this.q('.sdh-pedal-gas i'), 'transform'),
      brake: new Style(this.q('.sdh-pedal-brake i'), 'transform'),
      nitro: new Style(this.q('.sdh-nitro-bar i'), 'transform'),
      nitroLow: new Flag(this.q('.sdh-nitro'), 'is-low'),
      boosting: new Flag(this.q('.sdh-speedo'), 'is-boost'),
      loadingBar: new Style(this.q('.sdh-loading-bar i'), 'transform'),
      loadingLabel: new Text(this.q('.sdh-loading-label')),
      loadingPct: new Text(this.q('.sdh-loading-pct')),
    };
    this.debugEl = this.q('.sdh-debug');
    this.debugText = '';
    this.gaugeMax = 0;
    this.modeKey = null;
    this.toastsEl = this.q('.sdh-toasts');
    this.countdownEl = this.q('.sdh-countdown');
    this.countdownSpan = this.q('.sdh-countdown span');
  }

  menuMarkup() {
    const cards = this.modes.map((mode, i) => `
      <button type="button" class="sdh-mode-card" data-mode="${esc(mode.id)}" style="--i:${i}">
        <span class="sdh-mode-card-main">
          <span class="sdh-mode-card-label">${esc(mode.label)}</span>
          <span class="sdh-mode-card-tag">${esc(mode.tagline || '')}</span>
        </span>
        <span class="sdh-mode-card-rec" data-rec="${esc(mode.id)}"></span>
        <span class="sdh-mode-card-go" aria-hidden="true">${ICON.play}</span>
      </button>`).join('');
    return `
      <aside class="sdh-panel sdh-panel-menu" data-panel="menu" aria-label="Main menu">
        <header class="sdh-panel-head">
          <div class="sdh-brand"><span>SLOP</span><b>DRIFT</b></div>
          <div class="sdh-brand-sub">Mountain · 6 km loop + summit spur</div>
        </header>
        <div class="sdh-section-label">Choose an event</div>
        <div class="sdh-mode-list" role="list">${cards}</div>
        <div class="sdh-btn-row">
          <button type="button" class="sdh-btn" data-act="settings">${ICON.sliders}<span>Settings</span></button>
          <button type="button" class="sdh-btn sdh-fs" data-act="fullscreen">${ICON.expand}${ICON.shrink}<span>Fullscreen</span></button>
        </div>
        <canvas class="sdh-overview sdh-overview-menu" aria-label="Map of the mountain roads"></canvas>
        <div class="sdh-legend">
          <div class="sdh-legend-keys">
            <span><kbd>W</kbd><kbd>S</kbd> Throttle / brake</span>
            <span><kbd>A</kbd><kbd>D</kbd> Steer</span>
            <span><kbd>Space</kbd> Handbrake</span>
            <span><kbd>Shift</kbd> Nitro</span>
            <span><kbd>Q</kbd><kbd>E</kbd> Shift gear</span>
            <span><kbd>C</kbd> Camera · <kbd>B</kbd> Look back</span>
            <span><kbd>R</kbd> Respawn</span>
            <span><kbd>Esc</kbd> Pause</span>
          </div>
          <div class="sdh-legend-touch">Left pad: slide to steer · Right: gas, brake, drift, nitro</div>
          <div class="sdh-legend-pad">Gamepad: RT/LT pedals · A handbrake · B nitro · LB/RB shift</div>
        </div>
      </aside>`;
  }

  pauseMarkup() {
    return `
      <aside class="sdh-panel sdh-panel-pause" data-panel="pause" aria-label="Paused">
        <header class="sdh-panel-head">
          <div class="sdh-eyebrow sdh-pause-mode"></div>
          <h2 class="sdh-title">Paused</h2>
          <p class="sdh-copy sdh-pause-copy"></p>
        </header>
        <div class="sdh-stack">
          <button type="button" class="sdh-btn sdh-btn-primary" data-act="resume">${ICON.play}<span>Resume</span><kbd>Esc</kbd></button>
          <button type="button" class="sdh-btn" data-act="restart">${ICON.restart}<span>Restart event</span></button>
          <button type="button" class="sdh-btn" data-act="respawn">${ICON.respawn}<span>Reset to road</span><kbd>R</kbd></button>
          <button type="button" class="sdh-btn" data-act="settings">${ICON.sliders}<span>Settings</span></button>
          <button type="button" class="sdh-btn" data-act="menu">${ICON.home}<span>Main menu</span></button>
        </div>
        <canvas class="sdh-overview sdh-overview-pause" aria-label="Map of the mountain roads"></canvas>
      </aside>`;
  }

  settingsMarkup() {
    const name = (n) => `${this.uid}-${n}`;
    const seg = (key, label, options) => `
      <fieldset class="sdh-field">
        <legend>${label}</legend>
        <div class="sdh-seg" style="--n:${options.length}">
          ${options.map((o) => `<label><input type="radio" name="${name(key)}" value="${esc(o.value)}"><span>${esc(o.label)}</span></label>`).join('')}
        </div>
      </fieldset>`;
    const slider = (key, label) => `
      <label class="sdh-field sdh-slider">
        <span class="sdh-field-head"><span>${label}</span><output class="sdh-num" data-out="${key}"></output></span>
        <input type="range" min="0" max="100" step="1" name="${name(key)}">
      </label>`;
    const toggle = (key, label, hint) => `
      <label class="sdh-field sdh-toggle">
        <span><span>${label}</span><small>${hint}</small></span>
        <input type="checkbox" role="switch" name="${name(key)}">
      </label>`;
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    return `
      <aside class="sdh-panel sdh-panel-settings" data-panel="settings" aria-label="Settings">
        <header class="sdh-panel-head sdh-panel-head-row">
          <button type="button" class="sdh-icon sdh-icon-plain" data-act="settings-back" aria-label="Back">${ICON.back}</button>
          <h2 class="sdh-title">Settings</h2>
        </header>
        <form class="sdh-form" novalidate>
          <div class="sdh-group-label">Graphics</div>
          ${seg('quality', 'Quality', Object.keys(QUALITY_PRESETS).map((k) => ({ value: k, label: k })))}
          ${seg('timeOfDay', 'Time of day', TIME_OF_DAY.map((k) => ({ value: k, label: cap(k) })))}
          <fieldset class="sdh-field">
            <legend>Paint</legend>
            <div class="sdh-swatches">
              ${PAINT_OPTIONS.map((p) => `<label title="${esc(p.label)}"><input type="radio" name="${name('paint')}" value="${esc(p.id)}" aria-label="${esc(p.label)}"><span style="--c:${hex(p.color)}"></span></label>`).join('')}
            </div>
          </fieldset>
          <div class="sdh-group-label">Driving</div>
          ${seg('handling', 'Handling', HANDLING_PRESETS.map((k) => ({ value: k, label: k })))}
          ${seg('transmission', 'Transmission', [{ value: 'auto', label: 'Automatic' }, { value: 'manual', label: 'Manual' }])}
          ${slider('driftAssist', 'Drift assist')}
          ${toggle('abs', 'ABS', 'Anti-lock brakes')}
          <div class="sdh-group-label">Display &amp; audio</div>
          ${seg('units', 'Units', [{ value: 'kmh', label: 'km/h · m' }, { value: 'mph', label: 'mph · ft' }])}
          ${slider('volume', 'Master volume')}
          ${toggle('cameraShake', 'Camera shake', 'Speed and impact shake')}
        </form>
        <footer class="sdh-panel-foot">
          <button type="button" class="sdh-btn" data-act="settings-back">${ICON.back}<span>Back</span></button>
          <button type="button" class="sdh-btn sdh-btn-primary" data-act="settings-apply">${ICON.check}<span>Apply</span></button>
        </footer>
      </aside>`;
  }

  // ---------------------------------------------------------------- events

  bind() {
    this.onClick = (event) => {
      const target = event.target.closest('[data-act], [data-mode]');
      if (!target || !this.el.contains(target)) return;
      // Race-HUD buttons must not keep focus, or Space/Enter would re-trigger them instead of driving.
      if (event.detail > 0 && target.closest('.sdh-race')) target.blur();
      if (target.dataset.mode) {
        this.onStart(target.dataset.mode);
        return;
      }
      switch (target.dataset.act) {
        case 'camera': this.onCamera(); break;
        case 'pause': this.onPause(); break;
        case 'fullscreen': this.onFullscreen(); break;
        case 'respawn': this.onRespawn(); break;
        case 'resume': this.onResume(); break;
        case 'restart': this.onRestart(); break;
        case 'menu': this.onMenu(); break;
        case 'settings': {
          const source = this.screen === 'pause' ? 'pause' : 'menu';
          this.openSettings(source);
          this.onOpenSettings(source);
          break;
        }
        case 'settings-back': this.closeSettingsFromUi(false); break;
        case 'settings-apply': this.closeSettingsFromUi(true); break;
        default: break;
      }
    };
    this.el.addEventListener('click', this.onClick);

    this.form = this.q('.sdh-form');
    this.onFormInput = (event) => {
      if (event.target.type === 'range') this.renderSliderOutputs();
    };
    this.form.addEventListener('input', this.onFormInput);
    this.form.addEventListener('submit', (event) => event.preventDefault());

    // Capture-phase so the game's Input never sees an Escape that the overlays consumed.
    this.onKeyDown = (event) => {
      if (event.key === 'Escape' && !event.repeat) {
        if (this.settingsOpen) {
          event.preventDefault();
          event.stopPropagation();
          this.closeSettingsFromUi(false);
          return;
        }
        if (this.screen === 'pause') {
          event.preventDefault();
          event.stopPropagation();
          this.onResume();
          return;
        }
      }
      const panel = this.openPanel();
      if (!panel) return;
      if (event.key === 'Tab') this.trapTab(event, panel);
      else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && event.target.matches?.('.sdh-mode-card, .sdh-stack .sdh-btn')) {
        const list = [...event.target.parentElement.querySelectorAll('button')];
        const i = list.indexOf(event.target);
        const next = list[(i + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length];
        event.preventDefault();
        event.stopPropagation();
        next?.focus();
      }
    };
    window.addEventListener('keydown', this.onKeyDown, true);

    this.onFullscreenChange = () => this.el.classList.toggle('is-fullscreen', Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    this.onFullscreenChange();

    this.onTouchMode = (event) => this.el.classList.toggle('sdh--touch', Boolean(event.detail?.active));
    this.touchRoot.addEventListener('touchmodechange', this.onTouchMode);

    this.overviewObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => this.drawOverviews()) : null;
    this.el.querySelectorAll('.sdh-overview').forEach((c) => this.overviewObserver?.observe(c));
  }

  trapTab(event, panel) {
    const focusables = [...panel.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((n) => !n.disabled && n.offsetParent !== null && !(n.type === 'radio' && !n.checked));
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!panel.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // ---------------------------------------------------------------- screens

  openPanel() {
    if (this.settingsOpen) return this.q('[data-panel="settings"]');
    if (this.screen === 'menu' || this.screen === 'pause' || this.screen === 'finish') return this.q(`[data-panel="${this.screen}"]`);
    return null;
  }

  applyScreen(focus = true) {
    const prev = this.currentPanel;
    this.el.dataset.screen = this.screen;
    this.el.classList.toggle('is-settings', this.settingsOpen);
    const panel = this.openPanel();
    this.el.querySelectorAll('.sdh-panel').forEach((p) => {
      const open = p === panel;
      p.classList.toggle('is-open', open);
      p.toggleAttribute('inert', !open);
      p.setAttribute('aria-hidden', String(!open));
    });
    const racing = this.screen === 'race' || this.screen === 'pause';
    this.raceEl.toggleAttribute('inert', this.screen !== 'race');
    this.el.classList.toggle('is-racing', racing);
    this.currentPanel = panel;
    if (!panel) {
      // Leaving the overlays: drop focus so Space / Enter go to the car, not a hidden button.
      if (this.el.contains(document.activeElement)) document.activeElement.blur();
    } else if (focus && panel !== prev) {
      const target = panel.querySelector('.sdh-btn-primary, .sdh-mode-card, [data-act="restart"], button');
      const active = document.activeElement;
      if (target && (!active || active === document.body || this.el.contains(active))) {
        target.focus({ preventScroll: true });
      }
    }
    if (panel && panel.querySelector('.sdh-overview')) this.drawOverviews();
  }

  showMenu() {
    this.screen = 'menu';
    this.settingsOpen = false;
    this.applyScreen();
  }

  showRace() {
    this.screen = 'race';
    this.settingsOpen = false;
    this.applyScreen();
  }

  showPause(copyText = '') {
    this.screen = 'pause';
    this.settingsOpen = false;
    this.q('.sdh-pause-copy').textContent = copyText || 'Take a breath. The mountain will wait.';
    this.q('.sdh-pause-mode').textContent = this.v.modeLabel.raw || '';
    this.applyScreen();
  }

  /**
   * @param {{modeId:string, modeLabel?:string, time?:number, bestTime?:number, isRecord?:boolean, score?:number,
   *          bestScore?:number, topSpeedKmh?:number, respawns?:number, laps?:number[]}} result
   */
  showFinish(result = {}) {
    const mode = this.modes.find((m) => m.id === result.modeId);
    const kind = recordKind(mode || { id: result.modeId });
    const label = result.modeLabel || mode?.label || 'Event';
    const mph = this.settings.units === 'mph';
    const top = Number.isFinite(result.topSpeedKmh) ? Math.round(result.topSpeedKmh * (mph ? KMH_TO_MPH : 1)) : null;
    const laps = Array.isArray(result.laps) ? result.laps.filter(Number.isFinite) : [];
    const bestLap = laps.length ? Math.min(...laps) : null;
    let hero;
    let compare = '';
    if (kind === 'score') {
      hero = `<div class="sdh-hero sdh-num">${formatInt(result.score)}<small>pts</small></div>`;
      if (Number.isFinite(result.bestScore)) compare = `<div class="sdh-compare">Best <b class="sdh-num">${formatInt(result.bestScore)}</b></div>`;
    } else {
      hero = `<div class="sdh-hero sdh-num">${formatTime(result.time)}</div>`;
      if (Number.isFinite(result.bestTime) && Number.isFinite(result.time)) {
        const d = result.time - result.bestTime;
        const cls = d <= 0 ? 'is-good' : 'is-warn';
        compare = `<div class="sdh-compare">Best <b class="sdh-num">${formatTime(result.bestTime)}</b>${result.isRecord ? '' : ` <span class="${cls} sdh-num">${formatDelta(d)}</span>`}</div>`;
      }
    }
    const stats = [
      top != null ? ['Top speed', `${top} ${mph ? 'mph' : 'km/h'}`] : null,
      Number.isFinite(result.respawns) ? ['Respawns', String(result.respawns)] : null,
      kind !== 'score' && Number.isFinite(result.score) && result.score > 0 ? ['Drift score', formatInt(result.score)] : null,
      kind === 'score' && Number.isFinite(result.time) ? ['Time', formatTime(result.time)] : null,
    ].filter(Boolean);
    const lapRows = laps.length > 1 ? `
      <div class="sdh-section-label">Lap splits</div>
      <ol class="sdh-laps">${laps.map((t, i) => `
        <li class="${t === bestLap ? 'is-best' : ''}"><span>Lap ${i + 1}</span><span class="sdh-num">${formatTime(t)}</span>
        <span class="sdh-num sdh-lap-delta">${t === bestLap ? 'BEST' : formatDelta(t - bestLap)}</span></li>`).join('')}
      </ol>` : '';
    this.q('.sdh-finish-body').innerHTML = `
      <header class="sdh-panel-head">
        <div class="sdh-eyebrow">${esc(label)} · ${kind === 'score' ? 'Score' : 'Finish'}</div>
        <h2 class="sdh-title">${result.isRecord ? 'New record' : 'Finished'}</h2>
        ${result.isRecord ? '<div class="sdh-record-badge">NEW RECORD</div>' : ''}
      </header>
      ${hero}${compare}
      ${stats.length ? `<dl class="sdh-stats">${stats.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd class="sdh-num">${esc(v)}</dd></div>`).join('')}</dl>` : ''}
      ${lapRows}
      <div class="sdh-stack">
        <button type="button" class="sdh-btn sdh-btn-primary" data-act="restart">${ICON.restart}<span>Race again</span></button>
        <button type="button" class="sdh-btn" data-act="menu">${ICON.home}<span>Main menu</span></button>
      </div>`;
    this.q('[data-panel="finish"]').classList.toggle('is-record', Boolean(result.isRecord));
    this.screen = 'finish';
    this.settingsOpen = false;
    this.currentPanel = null; // force focus to the fresh content
    this.applyScreen();
  }

  openSettings(source = 'menu') {
    if (this.settingsOpen && this.settingsSource === source) return;
    this.settingsSource = source === 'pause' ? 'pause' : 'menu';
    if (this.settingsSource === 'pause' && this.screen !== 'pause') this.screen = 'pause';
    if (this.settingsSource === 'menu' && this.screen !== 'menu') this.screen = 'menu';
    this.setSettings(this.settings); // discard unsaved edits from a previous visit
    this.settingsOpen = true;
    this.applyScreen();
  }

  hideSettings() {
    if (!this.settingsOpen) return;
    this.settingsOpen = false;
    this.applyScreen();
  }

  closeSettingsFromUi(apply) {
    const source = this.settingsSource;
    if (apply) {
      const next = this.readSettings();
      this.settings = next;
      this.hideSettings();
      this.onApplySettings(next);
      this.toast('Settings applied', 'good');
    } else {
      this.setSettings(this.settings);
      this.hideSettings();
      this.onCloseSettings(source);
    }
  }

  // ---------------------------------------------------------------- settings form

  setSettings(settings) {
    this.settings = normalizeSettings(settings);
    const s = this.settings;
    const f = this.form || this.q('.sdh-form');
    const n = (k) => f.elements.namedItem(`${this.uid}-${k}`);
    for (const key of ['quality', 'timeOfDay', 'paint', 'handling', 'transmission', 'units']) {
      const group = n(key);
      if (group) group.value = String(s[key]);
    }
    n('driftAssist').value = String(Math.round(s.driftAssist * 100));
    n('volume').value = String(Math.round(s.volume * 100));
    n('abs').checked = s.abs;
    n('cameraShake').checked = s.cameraShake;
    this.renderSliderOutputs();
    // Units change the HUD readouts: force them to re-render on the next update.
    if (this.v) {
      this.v.speed.raw = undefined;
      this.v.alt.raw = undefined;
      this.v.unit.set(s.units === 'mph' ? 'MPH' : 'KM/H');
      this.v.altUnit.set(s.units === 'mph' ? 'ft' : 'm');
    }
  }

  readSettings() {
    const f = this.form;
    const n = (k) => f.elements.namedItem(`${this.uid}-${k}`);
    const out = { ...this.settings };
    for (const key of ['quality', 'timeOfDay', 'paint', 'handling', 'transmission', 'units']) {
      const v = n(key)?.value;
      if (v) out[key] = v;
    }
    out.driftAssist = Number(n('driftAssist').value) / 100;
    out.volume = Number(n('volume').value) / 100;
    out.abs = n('abs').checked;
    out.cameraShake = n('cameraShake').checked;
    return normalizeSettings(out);
  }

  renderSliderOutputs() {
    const f = this.form || this.q('.sdh-form');
    for (const out of f.querySelectorAll('output[data-out]')) {
      const input = f.elements.namedItem(`${this.uid}-${out.dataset.out}`);
      out.textContent = `${input.value}%`;
    }
  }

  // ---------------------------------------------------------------- records, track

  setRecords(records) {
    this.records = records || {};
    for (const mode of this.modes) {
      const cell = this.q(`[data-rec="${CSS.escape(mode.id)}"]`);
      if (!cell) continue;
      const rec = this.records[mode.id] || {};
      const kind = recordKind(mode);
      let text = '';
      if (kind === 'time') text = Number.isFinite(rec.time) ? formatTime(rec.time) : '—';
      else if (kind === 'score') text = Number.isFinite(rec.score) ? `${formatInt(rec.score)} pts` : '—';
      cell.textContent = text;
      cell.classList.toggle('is-empty', text === '—');
      cell.classList.toggle('is-none', kind === 'none');
      cell.title = kind === 'none' ? '' : 'Personal best';
    }
  }

  setTrack(track) {
    this.track = track;
    this.minimap.setTrack(track);
    this.updateElevationRoad();
    this.drawOverviews();
  }

  setActiveRoad(roadId) {
    this.activeRoad = roadId;
    this.minimap.setActiveRoad(roadId);
    this.updateElevationRoad();
    this.drawOverviews();
  }

  updateElevationRoad() {
    const road = this.track?.roads?.find((r) => r.id === this.activeRoad) || null;
    this.elevation.setRoad(road);
  }

  drawOverviews() {
    if (!this.track) return;
    for (const canvas of this.el.querySelectorAll('.sdh-panel.is-open .sdh-overview')) {
      if (canvas.clientWidth > 0) this.minimap.drawOverview(canvas, this.screen === 'pause' ? this.lastCar : null);
    }
  }

  // ---------------------------------------------------------------- transient UI

  showLoading(progress01 = 0, label = '') {
    const el = this.q('.sdh-loading');
    if (this.loadingHideTimer) {
      clearTimeout(this.loadingHideTimer);
      this.timers.delete(this.loadingHideTimer);
      this.loadingHideTimer = null;
    }
    el.classList.add('is-on');
    el.classList.remove('is-hiding');
    const p = Math.max(0, Math.min(1, Number(progress01) || 0));
    const key = Math.round(p * 1000);
    this.v.loadingBar.setKey(key, (k) => `scaleX(${k / 1000})`);
    this.v.loadingPct.setKey(Math.round(p * 100), (k) => `${k}%`);
    el.setAttribute('aria-valuenow', String(Math.round(p * 100)));
    if (label) this.v.loadingLabel.set(String(label));
  }

  hideLoading() {
    const el = this.q('.sdh-loading');
    if (!el.classList.contains('is-on') || this.loadingHideTimer) return;
    el.classList.add('is-hiding');
    this.loadingHideTimer = this.later(() => {
      el.classList.remove('is-on', 'is-hiding');
      this.loadingHideTimer = null;
    }, this.reducedMotion?.matches ? 0 : 600);
  }

  setCountdown(text) {
    const t = text == null ? '' : String(text);
    if (t === this.countdownText) return;
    this.countdownText = t;
    this.countdownSpan.textContent = t;
    this.countdownEl.classList.toggle('is-on', t !== '');
    this.countdownEl.classList.toggle('is-go', t.toUpperCase() === 'GO');
    if (t && !this.reducedMotion?.matches && this.countdownSpan.animate) {
      this.countdownSpan.animate(
        [{ transform: 'scale(1.6)', opacity: 0 }, { transform: 'scale(0.96)', opacity: 1, offset: 0.35 }, { transform: 'scale(1)', opacity: 1 }],
        { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' },
      );
    }
  }

  toast(text, kind = 'info') {
    if (!text) return;
    const item = document.createElement('div');
    item.className = `sdh-toast is-${['good', 'warn'].includes(kind) ? kind : 'info'}`;
    item.textContent = String(text);
    this.toastsEl.appendChild(item);
    while (this.toastsEl.children.length > 3) this.toastsEl.firstElementChild.remove();
    this.later(() => item.classList.add('is-leaving'), 2300);
    this.later(() => item.remove(), 2700);
  }

  setDebugVisible(visible) {
    this.debugVisible = Boolean(visible);
    this.debugEl.classList.toggle('is-on', this.debugVisible);
    if (this.debugVisible) this.debugEl.textContent = this.debugText;
  }

  later(fn, ms) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms);
    this.timers.add(id);
    return id;
  }

  // ---------------------------------------------------------------- per-frame

  setModeLayout(session) {
    const mode = this.modes.find((m) => m.id === session.modeId);
    const laps = session.laps || 0;
    const kind = session.timeLimit != null || session.timeLeft != null ? 'score' : laps > 0 ? 'time' : 'roam';
    const key = `${session.modeId}|${kind}|${laps}`;
    if (key === this.modeKey) return;
    this.modeKey = key;
    this.modeKind = kind;
    this.v.modeLabel.set(session.modeLabel || mode?.label || '');
    const [a, b, c] = this.v.rows;
    if (kind === 'time') {
      a.k.set('LAST'); b.k.set('BEST'); c.k.set('TOTAL');
      a.show.set(true); b.show.set(true); c.show.set(laps > 1);
    } else if (kind === 'score') {
      a.k.set('SCORE'); b.k.set('BEST'); c.k.set('');
      a.show.set(true); b.show.set(true); c.show.set(false);
    } else {
      a.k.set(''); b.k.set(''); c.k.set('');
      a.show.set(false); b.show.set(false); c.show.set(false);
    }
    for (const r of this.v.rows) r.v.raw = undefined;
    this.v.progressOn.set(kind !== 'roam');
    this.v.lap.raw = undefined;
  }

  rebuildGauge(rpmMax) {
    // Gauge runs ~8 % past the redline, rounded up to the next 1000 rpm.
    this.gaugeMax = Math.max(1000, Math.ceil((rpmMax * 1.08) / 1000) * 1000);
    this.rpmMax = rpmMax;
    const red = rpmMax / this.gaugeMax;
    this.q('.sdh-g-red').setAttribute('d', arcPath(G.r, red, 1));
    const ns = 'http://www.w3.org/2000/svg';
    const g = this.q('.sdh-g-ticks');
    g.replaceChildren();
    const steps = this.gaugeMax / 1000;
    for (let i = 0; i <= steps * 2; i += 1) {
      const f = i / (steps * 2);
      const major = i % 2 === 0;
      const deg = G.a0 + G.sweep * f;
      const [x0, y0] = polar(G.r - 9, deg);
      const [x1, y1] = polar(G.r - (major ? 17 : 13), deg);
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', x0.toFixed(2)); line.setAttribute('y1', y0.toFixed(2));
      line.setAttribute('x2', x1.toFixed(2)); line.setAttribute('y2', y1.toFixed(2));
      line.setAttribute('class', `${major ? 'is-major' : ''}${f >= red - 1e-6 ? ' is-red' : ''}`);
      g.appendChild(line);
      if (major) {
        const [tx, ty] = polar(G.r - 28, deg);
        const text = document.createElementNS(ns, 'text');
        text.setAttribute('x', tx.toFixed(2)); text.setAttribute('y', ty.toFixed(2));
        text.setAttribute('class', f >= red - 1e-6 ? 'is-red' : '');
        text.textContent = String(i / 2);
        g.appendChild(text);
      }
    }
    this.v.rpmFill.key = undefined;
  }

  /** @param {import('../core/contracts.js').HudFrame} f */
  update(f) {
    if (!f) return;
    const v = this.v;
    const mph = this.settings.units === 'mph';

    // Speedometer -----------------------------------------------------
    const speed = Math.round(Math.abs(f.speedKmh || 0) * (mph ? KMH_TO_MPH : 1));
    v.speed.setKey(speed, String);
    const gear = f.gear ?? 'N';
    v.gear.setKey(gear, String);
    v.reverse.set(gear === 'R');
    const rpmMax = f.rpmMax > 0 ? f.rpmMax : 7000;
    if (rpmMax !== this.rpmMax) this.rebuildGauge(rpmMax);
    const rpm = Math.max(0, f.rpm || 0);
    const frac = Math.min(1, rpm / this.gaugeMax);
    v.rpmFill.setKey(Math.round(frac * 400), (k) => String(1000 - k * 2.5));
    const ratio = rpm / rpmMax;
    v.redzone.set(ratio >= 0.97);
    v.shift.set(ratio >= 0.9 && typeof gear === 'number');
    v.gas.setKey(Math.round((f.throttle || 0) * 20), (k) => `scaleY(${k / 20})`);
    v.brake.setKey(Math.round((f.brake || 0) * 20), (k) => `scaleY(${k / 20})`);
    const boost = Math.max(0, Math.min(100, f.boost ?? 0));
    v.nitro.setKey(Math.round(boost * 2), (k) => `scaleX(${k / 200})`);
    v.nitroLow.set(boost < 15);
    v.boosting.set(Boolean(f.boosting));

    // Session -----------------------------------------------------------
    const s = f.session;
    if (s) {
      this.setModeLayout(s);
      const kind = this.modeKind;
      if (kind === 'time') {
        const lapKey = s.lap * 1000 + s.laps;
        v.lap.setKey(lapKey, () => `LAP ${Math.min(s.lap, s.laps)}/${s.laps}`);
        v.mainTime.setKey(Math.floor((s.lapTime || 0) * 100), (cs) => formatTime(cs / 100));
        v.mainWarn.set(false);
        const [a, b, c] = v.rows;
        a.v.setKey(s.lastLap ?? -1, (t) => (t < 0 ? '--:--.--' : formatTime(t)));
        b.v.setKey(s.bestLap ?? -1, (t) => (t < 0 ? '--:--.--' : formatTime(t)));
        a.good.set(s.lastLap != null && s.lastLap === s.bestLap);
        if (s.laps > 1) c.v.setKey(Math.floor((s.elapsed || 0) * 10), (ds) => formatTime(ds / 10).slice(0, -1));
      } else if (kind === 'score') {
        v.lap.set('TIME LEFT');
        const left = Math.max(0, s.timeLeft ?? 0);
        v.mainTime.setKey(Math.floor(left * 100), (cs) => formatTime(cs / 100));
        v.mainWarn.set(left < 10);
        const [a, b] = v.rows;
        a.v.setKey(Math.round(f.drift?.score || 0), formatInt);
        const best = this.records[s.modeId]?.score;
        b.v.setKey(Number.isFinite(best) ? best : -1, (n) => (n < 0 ? '—' : formatInt(n)));
      } else {
        v.lap.set('FREE ROAM');
        v.mainTime.setKey(Math.floor((s.elapsed || 0) * 10), (ds) => formatTime(ds / 10).slice(0, -1));
        v.mainWarn.set(false);
      }
      if (kind !== 'roam') v.progress.setKey(Math.round(Math.max(0, Math.min(1, s.progress || 0)) * 500), (k) => `scaleX(${k / 500})`);
      v.wrongWay.set(Boolean(s.wrongWay));
      v.offRoad.set(Boolean(s.offRoad) && !s.wrongWay);
    }

    // Drift combo --------------------------------------------------------
    const d = f.drift;
    if (d) {
      const alive = d.active || (d.bank > 0 && d.comboTimer > 0);
      v.driftOn.set(alive);
      v.driftActive.set(Boolean(d.active));
      if (alive) {
        v.driftAngle.setKey(Math.round(Math.abs(d.angleDeg || 0)), (n) => `${n}°`);
        v.driftMult.setKey(Math.round((d.multiplier || 1) * 10), (n) => `×${(n / 10).toFixed(1)}`);
        v.driftBank.setKey(Math.round(d.bank || 0), formatInt);
        const t = d.comboWindow > 0 ? Math.max(0, Math.min(1, d.comboTimer / d.comboWindow)) : 0;
        v.driftTimer.setKey(Math.round(t * 200), (k) => `scaleX(${k / 200})`);
        v.driftScore.setKey(Math.round(d.score || 0), formatInt);
      }
    }

    // Altitude and grade ---------------------------------------------------
    const alt = (f.altitude || 0) * (mph ? M_TO_FT : 1);
    v.alt.setKey(Math.round(alt), formatInt);
    const grade = f.grade || 0;
    const g10 = Math.round(grade * 10);
    v.grade.setKey(g10, (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n / 10).toFixed(1)}%`);
    v.gradeTilt.setKey(Math.round(Math.max(-30, Math.min(30, grade))), (n) => `scaleX(${n < 0 ? -1 : 1})`);
    v.gradeSteep.set(Math.abs(grade) >= 10);
    v.gradeDown.set(grade < -0.5);

    // Minimap -------------------------------------------------------------
    const p = f.position;
    if (p && this.screen === 'race') {
      const heading = f.heading || 0;
      this.minimap.update(p.x, p.z, heading);
      this.elevation.update(f.altitude || 0, p.x, p.z, performance.now());
      if (!this.lastCar) this.lastCar = { x: 0, z: 0, heading: 0 };
      this.lastCar.x = p.x;
      this.lastCar.z = p.z;
      this.lastCar.heading = heading;
    }

    // Camera chip shown briefly after a change ------------------------------
    if (f.camera && f.camera !== this.cameraLabel) {
      const first = this.cameraLabel === undefined;
      this.cameraLabel = f.camera;
      v.camChip.set(String(f.camera).toUpperCase());
      if (!first) {
        v.camChipOn.set(true);
        if (this.camTimer) clearTimeout(this.camTimer);
        this.camTimer = this.later(() => v.camChipOn.set(false), 1400);
      }
    }

    if (this.debugVisible && f.debug !== undefined && f.debug !== this.debugText) {
      this.debugText = f.debug;
      this.debugEl.textContent = f.debug;
    }
  }

  destroy() {
    window.removeEventListener('keydown', this.onKeyDown, true);
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    this.touchRoot.removeEventListener('touchmodechange', this.onTouchMode);
    this.el.removeEventListener('click', this.onClick);
    this.overviewObserver?.disconnect();
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    this.minimap.destroy();
    this.elevation.destroy();
    this.el.remove();
    if (this.injectedStyles) {
      stylesRefCount -= 1;
      if (stylesRefCount <= 0) document.querySelector('link[data-sdh-styles]')?.remove();
    }
  }
}
