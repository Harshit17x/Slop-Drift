// Racing HUD, menus, settings, results, loading screen and minimap.
// DOM is built once in the constructor. update(frame) runs every animation frame and only writes to the
// DOM when a displayed (quantised) value actually changed; it never reads layout.

import { MAPS } from '../world/maps.js';
import {
  DEFAULT_SETTINGS, HANDLING_PRESETS, MODES, QUALITY_PRESETS, TIME_OF_DAY, normalizeSettings,
} from '../config.js';
import { ElevationStrip, Minimap } from './Minimap.js';
import { MEDAL_LABELS, MEDAL_TARGETS, MEDAL_TIERS, medalTargets } from '../meta/catalog.js';
import { trackKey } from '../meta/trackKey.js';
import { CHAI_GLASS, ICON } from './icons.js';

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

/** Medal target text: 2:48.0 for times, 8,000 for scores. */
export function formatTarget(kind, value) {
  if (!Number.isFinite(value)) return '';
  if (kind === 'score') return formatInt(value);
  const ds = Math.round(value * 10);
  const m = Math.floor(ds / 600);
  const sec = (ds % 600) / 10;
  return `${m}:${sec < 10 ? '0' : ''}${sec.toFixed(1)}`;
}

/** Best medal tier a time (lower is better) or score (higher is better) earns on a map (default Alpine), or null. */
export function medalFor(modeId, value, mapId) {
  const t = medalTargets(trackKey(mapId, modeId));
  if (!t || !Number.isFinite(value)) return null;
  let best = null;
  for (const tier of MEDAL_TIERS) {
    if (t.kind === 'score' ? value >= t[tier] : value <= t[tier]) best = tier;
  }
  return best;
}

/** Driver names: 2-16 characters of letters, digits, space, - and _. Returns the cleaned name or null. */
export function validateName(raw) {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
  return /^[A-Za-z0-9 _-]{2,16}$/.test(name) ? name : null;
}

const medalBadge = (tier, extra = '') => (tier
  ? `<span class="sdh-medal is-${esc(tier)}${extra}" title="${esc(MEDAL_LABELS[tier] || tier)} medal">${esc((MEDAL_LABELS[tier] || tier).charAt(0))}</span>`
  : `<span class="sdh-medal is-none${extra}" aria-hidden="true"></span>`);

/** Short leaderboard tab text: the mode's own `tab`, else the first word of its label. */
function tabLabel(mode) {
  return mode.tab || String(mode.label).split(' ')[0];
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

/** Party codes: 5 characters, A-Z and 2-9 only (no 0/1 to avoid confusion with O/I in a shouted code). */
export function normalizePartyCode(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 5);
}

export function isPartyCode(value) {
  return /^[A-Z2-9]{5}$/.test(String(value ?? ''));
}

/** A safe CSS colour for a car paint given as 0xRRGGBB or '#rgb'/'#rrggbb'; null otherwise. */
export function paintColor(paint) {
  if (Number.isFinite(paint)) return hex(paint);
  return typeof paint === 'string' && /^#[0-9a-f]{3,8}$/i.test(paint) ? paint : null;
}

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

/**
 * Fixed-width character cells for fast-changing numbers. Teko has proportional figures and no
 * tabular-nums feature, so each character sits in its own cell (digits share one width) and only
 * cells whose character changed are written. Same interface as Text (raw, set, setKey).
 */
class Digits {
  constructor(el, cells) {
    el.replaceChildren();
    el.classList.add('sdh-digits');
    this.cells = [];
    for (let i = 0; i < cells; i += 1) {
      const span = document.createElement('span');
      const t = document.createTextNode('');
      span.appendChild(t);
      span.className = 'sdh-c-e';
      el.appendChild(span);
      this.cells.push({ span, t, ch: '', type: 'e' });
    }
    this.raw = undefined;
  }

  set(str) {
    if (str !== this.raw) {
      this.raw = str;
      this.write(String(str));
    }
  }

  setKey(key, format) {
    if (key !== this.raw) {
      this.raw = key;
      this.write(String(format(key)));
    }
  }

  write(str) {
    const n = this.cells.length;
    const s = str.length > n ? str.slice(-n) : str;
    const pad = n - s.length;
    for (let i = 0; i < n; i += 1) {
      const cell = this.cells[i];
      const ch = i < pad ? '' : s[i - pad];
      if (ch === cell.ch) continue;
      cell.ch = ch;
      cell.t.data = ch;
      const type = ch === '' ? 'e' : (ch >= '0' && ch <= '9') ? 'd' : 'p';
      if (type !== cell.type) {
        cell.type = type;
        cell.span.className = `sdh-c-${type}`;
      }
    }
  }
}

// ------------------------------------------------------------------ icons

/** Original hill-road slogans in the spirit of mountain road signs (not copies of real ones). */
export const SLOGANS = Object.freeze([
  'Hairpins are for hair, not for haste.',
  'Chai is waiting. Arrive alive.',
  'Fog ahead. Ego behind.',
  'Monkeys have right of way.',
  'The view is better when you stop.',
  'Drift in the game, not in life.',
  'Mountains are patient. Be a mountain.',
  'Honk at the bend, not at your friend.',
  'The khud is deep. Keep your line.',
  'Blind bend, open mind, slow foot.',
  'Slow on the slope, home with hope.',
  'Brakes before bravado.',
  'Clouds are free. Brake pads are not.',
  'Landour will wait. Let it.',
  'Mist is not a race track.',
]);

const TACH_BLOCKS = 14;
const TACH_COLORS = ['blue', 'white', 'red', 'green', 'yellow'];

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
    this.sub = null; // open sub-panel: 'settings' | 'leaderboard' | 'achievements' | 'garage'
    this.subSource = 'menu';
    this.settingsSource = 'menu';
    this.profile = null;
    this.medals = {};
    this.mapId = this.settings.map; // the map actually loaded comes in through setMap()
    this.previewMapId = this.mapId; // the map shown in the homepage drone preview
    this.daily = null;
    this.leaderboards = {};
    this.lbMode = null;
    this.lbRequested = { mode: null, at: 0 };
    this.achievements = [];
    this.garage = null;
    this.players = [];
    this.ghost = null;
    this.notifyQueue = [];
    this.notifyBusy = false;
    this.renaming = false;
    this.dialogOpen = false;
    this.debugVisible = false;
    this.countdownText = '';
    this.track = null;
    this.activeRoad = null;
    this.lastCar = null;
    this.timers = new Set();
    this.party = null; // last view passed to setParty()
    this.partyResults = null;
    this.partyKey = '';
    this.standingsKey = '';
    this.finishFresh = false;
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
    this.onRename = noop;
    this.onStartDaily = noop;
    this.onRaceGhost = noop;
    this.onOpenLeaderboard = noop;
    this.onLeaderboardRequest = noop;
    this.onRaceLeaderboardGhost = noop;
    this.onCosmetic = noop;
    this.onToggleGhost = noop;
    // Party callbacks are assigned by the game and always invoked with `?.`.
    this.onPartyCreate = null;
    this.onPartyJoin = null;
    this.onPartyLeave = null;
    this.onPartySelect = null;
    this.onPartyReady = null;
    this.onPartyStart = null;
    this.onPartyRematch = null;
    this.onPartyCopyLink = null;

    if (injectStyles) this.injectStyles();
    this.build();
    this.bind();
    this.setRecords(this.records);
    this.setSettings(this.settings);
    this.minimap = new Minimap(this.q('.sdh-map canvas'), { radius: minimap.radius ?? 420, rotate: minimap.rotate ?? true });
    this.elevation = new ElevationStrip(this.q('.sdh-elev-strip'));
    this.renderProfile();
    this.renderDaily();
    this.renderPlayers();
    this.renderGhost();
    this.renderParty();
    this.setHudMode('race');
    this.applyScreen();
    this.markReady();
  }

  get settingsOpen() {
    return this.sub === 'settings';
  }

  set settingsOpen(open) {
    if (open) this.sub = 'settings';
    else if (this.sub === 'settings') this.sub = null;
  }

  injectStyles() {
    this.injectedStyles = true;
    stylesRefCount += 1;
    if (!document.querySelector('link[data-sdh-theme]')) {
      // Fonts and colour tokens; must come before hud.css.
      const theme = document.createElement('link');
      theme.rel = 'stylesheet';
      theme.href = new URL('./theme.css', import.meta.url).href;
      theme.dataset.sdhTheme = '';
      document.head.appendChild(theme);
    }
    let link = document.querySelector('link[data-sdh-styles]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = new URL('./hud.css', import.meta.url).href;
      link.dataset.sdhStyles = '';
      document.head.appendChild(link);
    }
    this.stylesLink = link;
  }

  /** Enables transitions once the sheet applies, so nothing animates in from browser-default styles. */
  markReady() {
    const ready = () => requestAnimationFrame(() => requestAnimationFrame(() => this.el?.classList.add('is-ready')));
    const link = this.stylesLink;
    if (link && !link.sheet) link.addEventListener('load', ready, { once: true });
    else ready();
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
        <section class="sdh-tl">
          <div class="sdh-mode"><span class="sdh-mode-label"></span><span class="sdh-lap"></span></div>
          <div class="sdh-main sdh-plate"><span class="sdh-plate-ind">IND</span><span class="sdh-plate-reg">UK 07</span><span class="sdh-plate-dot">·</span><span class="sdh-main-time sdh-num"></span></div>
          <div class="sdh-rows">
            <div class="sdh-row" data-row="0"><span class="sdh-k"></span><span class="sdh-v sdh-num"></span></div>
            <div class="sdh-row" data-row="1"><span class="sdh-k"></span><span class="sdh-v sdh-num"></span></div>
            <div class="sdh-row" data-row="2"><span class="sdh-k"></span><span class="sdh-v sdh-num"></span></div>
          </div>
          <div class="sdh-progress"><i></i></div>
          <section class="sdh-standings" aria-label="Race standings" hidden>
            <div class="sdh-st-head"><span>ORDER</span><span class="sdh-st-count sdh-num"></span></div>
            <ol class="sdh-st-list"></ol>
          </section>
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
          <div class="sdh-race-chips">
            <div class="sdh-mini-player"><span class="sdh-lv-badge sdh-lv-sm sdh-num" data-p="level"></span><span class="sdh-mini-name" data-p="name"></span><span class="sdh-mini-xp"><i data-p="xp"></i></span></div>
            <div class="sdh-online-chip"><i class="sdh-dot"></i><span data-p="onlineChip"></span></div>
            <button type="button" class="sdh-ghost-chip" data-act="ghost" tabindex="-1" title="Show or hide the ghost">${ICON.ghost}<span></span></button>
          </div>
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
          <div class="sdh-stamp sdh-drift-stamp" aria-hidden="true">DRIVE SAFE</div>
        </section>
        <section class="sdh-br">
          <div class="sdh-speedo">
            <div class="sdh-stone">
              <div class="sdh-stone-cap"><span class="sdh-unit"></span></div>
              <div class="sdh-stone-face"><span class="sdh-speed sdh-num"></span></div>
              <div class="sdh-tach" aria-hidden="true"></div>
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
      <div class="sdh-checkpoints" aria-live="polite"></div>
      <div class="sdh-slogan" aria-live="polite"><span></span></div>
      <div class="sdh-toasts" aria-live="polite"></div>
      <div class="sdh-touch" aria-hidden="true"></div>
      <div class="sdh-veil"></div>
      ${this.menuMarkup()}
      ${this.pauseMarkup()}
      <aside class="sdh-panel sdh-panel-finish" data-panel="finish" aria-label="Results">
        <div class="sdh-finish-body"></div>
        <footer class="sdh-panel-foot sdh-finish-foot">
          <button type="button" class="sdh-btn sdh-btn-primary" data-act="restart">${ICON.restart}<span>Race again</span></button>
          <button type="button" class="sdh-btn" data-act="race-ghost">${ICON.ghost}<span>Race your ghost</span></button>
          <button type="button" class="sdh-btn" data-act="finish-leaderboard">${ICON.trophy}<span>Leaderboard</span></button>
          <button type="button" class="sdh-btn" data-act="menu">${ICON.home}<span>Main menu</span></button>
        </footer>
      </aside>
      <aside class="sdh-panel sdh-panel-finish sdh-panel-party-results" data-panel="party-results" aria-label="Party results">
        <div class="sdh-party-results-body"></div>
        <footer class="sdh-panel-foot sdh-finish-foot">
          <button type="button" class="sdh-btn sdh-btn-primary" data-act="party-rematch" hidden>${ICON.restart}<span>Rematch</span></button>
          <button type="button" class="sdh-btn" data-act="party-back">${ICON.party}<span>Back to party</span></button>
          <button type="button" class="sdh-btn" data-act="party-leave">${ICON.exit}<span>Leave party</span></button>
          <button type="button" class="sdh-btn" data-act="menu">${ICON.home}<span>Main menu</span></button>
        </footer>
      </aside>
      ${this.partyMarkup()}
      ${this.settingsMarkup()}
      ${this.leaderboardMarkup()}
      ${this.achievementsMarkup()}
      ${this.garageMarkup()}
      ${this.nameDialogMarkup()}
      <div class="sdh-loading" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-label="Loading">
        <div class="sdh-loading-inner">
          <div class="sdh-brand sdh-brand-xl"><span>SLOP DRIFT</span></div>
          <div class="sdh-loading-sub"><span lang="hi">मसूरी</span> · Mussoorie · Landour</div>
          <div class="sdh-slogan-board sdh-loading-slogan"><span></span></div>
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
      mainTime: new Digits(this.q('.sdh-main-time'), 8),
      mainWarn: new Flag(this.q('.sdh-main'), 'is-warn'),
      rows: [0, 1, 2].map((i) => ({
        el: row(i),
        k: new Text(row(i).querySelector('.sdh-k')),
        v: new Digits(row(i).querySelector('.sdh-v'), 8),
        show: new Flag(row(i), 'is-on'),
        good: new Flag(row(i), 'is-good'),
      })),
      progress: new Style(this.q('.sdh-progress i'), 'transform'),
      progressOn: new Flag(this.q('.sdh-progress'), 'is-on'),
      wrongWay: new Flag(this.q('.sdh-wrongway'), 'is-on'),
      offRoad: new Flag(this.q('.sdh-offroad'), 'is-on'),
      camChip: new Text(this.q('.sdh-cam-chip span')),
      camChipOn: new Flag(this.q('.sdh-cam-chip'), 'is-on'),
      alt: new Digits(this.q('.sdh-elev-alt'), 6),
      altUnit: new Text(this.q('.sdh-elev-unit')),
      grade: new Text(this.q('.sdh-grade-v')),
      gradeTilt: new Style(this.q('.sdh-grade svg'), 'transform'),
      gradeSteep: new Flag(this.q('.sdh-grade'), 'is-steep'),
      gradeDown: new Flag(this.q('.sdh-grade'), 'is-down'),
      driftOn: new Flag(this.q('.sdh-drift'), 'is-on'),
      driftActive: new Flag(this.q('.sdh-drift'), 'is-active'),
      driftAngle: new Text(this.q('.sdh-drift-angle')),
      driftMult: new Text(this.q('.sdh-drift-mult')),
      driftBank: new Digits(this.q('.sdh-drift-bank'), 7),
      driftGrow: new Style(this.q('.sdh-drift'), '--grow'),
      driftStamp: new Flag(this.q('.sdh-drift-stamp'), 'is-on'),
      timing: new Flag(this.q('.sdh-tl'), 'is-timing'),
      driftTimer: new Style(this.q('.sdh-drift-timer i'), 'transform'),
      driftScore: new Text(this.q('.sdh-drift-score')),
      speed: new Digits(this.q('.sdh-speed'), 3),
      unit: new Text(this.q('.sdh-unit')),
      gear: new Text(this.q('.sdh-gear')),
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
    const clip = this.q('.sdh-map-clip');
    clip?.addEventListener('playing', () => clip.classList.add('is-on'));
    clip?.addEventListener('emptied', () => clip.classList.remove('is-on'));
    clip?.addEventListener('error', () => clip.classList.remove('is-on'));
    this.renderMapStage();
  }

  modeCardsMarkup() {
    return this.modes.map((mode, i) => `
      <button type="button" class="sdh-mode-card" data-mode="${esc(mode.id)}" style="--i:${i}">
        <span class="sdh-mode-card-main">
          <span class="sdh-mode-card-label">${esc(mode.label)}</span>
          <span class="sdh-mode-card-tag">${esc(mode.tagline || '')}</span>
        </span>
        <span class="sdh-mode-card-side">
          <span class="sdh-mode-card-medal" data-medal="${esc(mode.id)}"></span>
          <span class="sdh-mode-card-rec" data-rec="${esc(mode.id)}"></span>
          <span class="sdh-mode-card-next" data-next="${esc(mode.id)}"></span>
        </span>
        <span class="sdh-mode-card-go" aria-hidden="true">${ICON.play}</span>
      </button>`).join('');
  }

  /** How many events a map's roads can run (mirrors World.build's routes). */
  eventCount(map) {
    const routes = map?.routes || [];
    return MODES.filter((mode) => routes.includes(mode.route)).length;
  }

  /** Homepage map picker: one large drone shot and a tab per map. */
  mapPickerMarkup() {
    const tabs = Object.values(MAPS).map((map) => `
      <button type="button" class="sdh-map-tab" data-act="map-preview" data-map="${esc(map.id)}" aria-pressed="false" title="${esc(map.tagline)}">
        ${map.preview ? `<img class="sdh-map-tab-shot" src="${esc(map.preview)}" alt="" loading="lazy" decoding="async">` : ''}
        <span class="sdh-map-tab-text"><b>${esc(map.label)}</b><small>${this.eventCount(map)} events</small></span>
      </button>`).join('');
    return `
      <section class="sdh-maps" aria-label="Choose a map">
        <div class="sdh-maps-head">
          <span class="sdh-eyebrow">Choose your mountain</span>
          <span class="sdh-maps-hint">Drone preview</span>
        </div>
        <div class="sdh-map-stage">
          <div class="sdh-map-frame">
            <img class="sdh-map-shot" alt="" decoding="async">
            <video class="sdh-map-clip" muted loop playsinline preload="none" tabindex="-1" aria-hidden="true"></video>
            <span class="sdh-map-stage-status"></span>
          </div>
          <div class="sdh-map-stage-body">
            <h3 class="sdh-map-stage-name" aria-live="polite"></h3>
            <p class="sdh-map-stage-tag"></p>
            <ul class="sdh-map-stage-chips"></ul>
            <button type="button" class="sdh-btn sdh-btn-primary sdh-map-go" data-act="map-go" hidden></button>
          </div>
        </div>
        <div class="sdh-map-tabs" role="group" aria-label="Maps">${tabs}</div>
      </section>`;
  }

  menuMarkup() {
    const cards = this.modeCardsMarkup();
    return `
      <aside class="sdh-panel sdh-panel-menu" data-panel="menu" aria-label="Main menu">
        <div class="sdh-playerbar">
          <span class="sdh-lv-badge sdh-num" data-p="level" title="Driver level"></span>
          <div class="sdh-pb-main">
            <div class="sdh-pb-row">
              <button type="button" class="sdh-pb-name" data-act="rename" title="Rename driver"><span data-p="name"></span>${ICON.pencil}</button>
              <input class="sdh-pb-input" type="text" maxlength="16" autocomplete="off" spellcheck="false" aria-label="Driver name" hidden>
              <span class="sdh-conn" data-p="conn"><i class="sdh-dot"></i><span data-p="connText"></span></span>
            </div>
            <div class="sdh-xp" title="Progress to the next level"><i data-p="xp"></i></div>
            <div class="sdh-pb-sub" data-p="xpText"></div>
          </div>
          <button type="button" class="sdh-icon sdh-icon-plain sdh-fs" data-act="fullscreen" aria-label="Fullscreen" title="Fullscreen (F)">${ICON.expand}${ICON.shrink}</button>
        </div>
        <div class="sdh-brand sdh-brand-menu"><span>SLOP DRIFT</span><small lang="hi">मसूरी</small>${CHAI_GLASS}</div>
        ${this.mapPickerMarkup()}
        <section class="sdh-daily" aria-label="Daily challenge">
          <div class="sdh-daily-info">
            <div class="sdh-daily-top"><span class="sdh-eyebrow">Aaj ka challenge</span><span class="sdh-streak" title="Daily streak">${ICON.flame}<b class="sdh-num" data-d="streak">0</b></span></div>
            <div class="sdh-daily-text" data-d="text">Loading today’s challenge…</div>
            <div class="sdh-daily-meta"><span data-d="mode"></span><span class="sdh-daily-xp" data-d="xp"></span></div>
          </div>
          <button type="button" class="sdh-btn sdh-daily-go" data-act="daily">${ICON.play}<span data-d="btn">Start</span></button>
        </section>
        <div class="sdh-mode-list" role="list" aria-label="Events">${cards}</div>
        <button type="button" class="sdh-party-entry" data-act="party">
          <span class="sdh-party-entry-ico">${ICON.party}</span>
          <span class="sdh-party-entry-main"><b>Race with friends</b><small data-p="partyLine">Share a 5-letter code. Up to 8 drivers.</small></span>
          <span class="sdh-party-entry-code sdh-num" data-p="partyCode" hidden></span>
        </button>
        <div class="sdh-menu-actions">
          <button type="button" class="sdh-btn sdh-btn-tile" data-act="garage">${ICON.car}<span>Garage</span></button>
          <button type="button" class="sdh-btn sdh-btn-tile" data-act="leaderboard">${ICON.trophy}<span>Leaderboard</span></button>
          <button type="button" class="sdh-btn sdh-btn-tile" data-act="achievements">${ICON.medal}<span>Awards</span></button>
          <button type="button" class="sdh-btn sdh-btn-tile" data-act="settings">${ICON.sliders}<span>Settings</span></button>
        </div>
        <details class="sdh-players">
          <summary><i class="sdh-dot"></i><span data-p="playersTitle">Online players</span><span class="sdh-players-count sdh-num" data-p="playersCount"></span></summary>
          <ul class="sdh-players-list"></ul>
        </details>
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
          <div class="sdh-group-label">Driving</div>
          ${seg('handling', 'Handling', HANDLING_PRESETS.map((k) => ({ value: k, label: k })))}
          ${seg('transmission', 'Transmission', [{ value: 'auto', label: 'Automatic' }, { value: 'manual', label: 'Manual' }])}
          ${slider('driftAssist', 'Drift assist')}
          ${toggle('abs', 'ABS', 'Anti-lock brakes')}
          <div class="sdh-group-label">Display &amp; audio</div>
          ${seg('units', 'Units', [{ value: 'kmh', label: 'km/h · m' }, { value: 'mph', label: 'mph · ft' }])}
          ${slider('volume', 'Master volume')}
          ${toggle('cameraShake', 'Camera shake', 'Speed and impact shake')}
          <div class="sdh-group-label">Controls</div>
        <div class="sdh-legend sdh-legend-settings">
          <div class="sdh-legend-keys">
            <span><kbd>W</kbd><kbd>S</kbd> Throttle / brake</span>
            <span><kbd>A</kbd><kbd>D</kbd> Steer</span>
            <span><kbd>Space</kbd> Handbrake</span>
            <span><kbd>Shift</kbd> Nitro</span>
            <span><kbd>Q</kbd><kbd>E</kbd> Shift gear</span>
            <span><kbd>C</kbd> Camera · <kbd>B</kbd> Look back</span>
            <span><kbd>H</kbd> Lights · <kbd>G</kbd> Neon</span>
            <span><kbd>R</kbd> Respawn</span>
            <span><kbd>Esc</kbd> Pause</span>
          </div>
          <div class="sdh-legend-touch">Left pad: slide to steer · Right: gas, brake, drift, nitro</div>
          <div class="sdh-legend-pad">Gamepad: RT/LT pedals · A handbrake · B nitro · LB/RB shift</div>
        </div>
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
      if (target.dataset.mode && !target.dataset.act) {
        this.onStart(target.dataset.mode);
        return;
      }
      switch (target.dataset.act) {
        case 'rename': this.startRename(); break;
        case 'daily': this.onStartDaily(); break;
        case 'ghost': this.onToggleGhost(); break;
        case 'race-ghost': this.onRaceGhost(); break;
        case 'finish-leaderboard': {
          const id = this.finishModeId;
          this.openLeaderboard(id, 'finish');
          this.onOpenLeaderboard(id);
          break;
        }
        case 'leaderboard': {
          const id = this.lbMode || this.rankedModes()[0]?.id;
          this.openLeaderboard(id, 'menu');
          this.onOpenLeaderboard(id);
          break;
        }
        case 'lb-tab': this.openLeaderboard(target.dataset.tab, this.subSource); break;
        case 'lb-ghost': this.onRaceLeaderboardGhost(target.dataset.lbMode, target.dataset.player); break;
        case 'achievements': this.openSub('achievements', 'menu'); break;
        case 'garage': this.openSub('garage', 'menu'); break;
        case 'cosmetic':
          if (target.getAttribute('aria-disabled') !== 'true') this.onCosmetic(target.dataset.slot, target.dataset.value);
          break;
        case 'party': this.openParty(); break;
        case 'party-create': this.onPartyCreate?.(); break;
        case 'party-leave': this.onPartyLeave?.(); break;
        case 'party-copy': this.onPartyCopyLink?.(); break;
        case 'party-select': this.onPartySelect?.(target.dataset.id); break;
        case 'party-ready': this.onPartyReady?.(target.getAttribute('aria-pressed') !== 'true'); break;
        case 'party-start': this.onPartyStart?.(); break;
        case 'party-rematch': this.onPartyRematch?.(); break;
        case 'party-back': this.openSub('party', this.screen === 'party-results' ? 'party-results' : 'menu'); break;
        case 'party-results': if (this.partyResults) this.showPartyResults(this.partyResults); break;
        case 'map-preview': this.previewMap(target.dataset.map); break;
        case 'map-go': this.onSelectMap?.(this.previewMapId); break;
        case 'sub-back': this.closeSub(); break;
        case 'name-skip': this.skipName(); break;
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

    const renameInput = this.q('.sdh-pb-input');
    renameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); this.endRename(true); }
    });
    renameInput.addEventListener('blur', () => this.endRename(true));
    this.q('.sdh-dialog-card').addEventListener('submit', (event) => {
      event.preventDefault();
      this.confirmName();
    });
    const partyInput = this.q('.sdh-party-input');
    partyInput.addEventListener('input', () => {
      const clean = normalizePartyCode(partyInput.value);
      if (clean !== partyInput.value) partyInput.value = clean;
      this.q('.sdh-party-join').disabled = !isPartyCode(clean);
    });
    this.q('.sdh-party-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const code = normalizePartyCode(partyInput.value);
      if (isPartyCode(code)) this.onPartyJoin?.(code);
      else partyInput.focus();
    });
    const numberInput = this.q('.sdh-number-input');
    numberInput.addEventListener('change', () => this.commitNumber());
    numberInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); numberInput.blur(); }
    });

    // Capture-phase so the game's Input never sees an Escape that the overlays consumed.
    this.onKeyDown = (event) => {
      if (event.key === 'Escape' && !event.repeat) {
        if (this.dialogOpen) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.skipName();
          return;
        }
        if (this.renaming) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.endRename(false);
          return;
        }
        if (this.sub && this.sub !== 'settings') {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.closeSub();
          return;
        }
        if (this.settingsOpen) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.closeSettingsFromUi(false);
          return;
        }
        if (this.screen === 'pause') {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.onResume();
          return;
        }
      }
      const panel = this.dialogOpen ? this.q('.sdh-dialog') : this.openPanel();
      if (!panel) return;
      if (event.key === 'Tab') this.trapTab(event, panel);
      else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && event.target.matches?.('[role="tab"]')) {
        const tabs = [...event.target.parentElement.querySelectorAll('[role="tab"]')];
        const next = tabs[(tabs.indexOf(event.target) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
        event.preventDefault();
        event.stopImmediatePropagation();
        this.openLeaderboard(next.dataset.tab, this.subSource);
        this.q(`[role="tab"][data-tab="${CSS.escape(next.dataset.tab)}"]`)?.focus();
      }
      else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && event.target.matches?.('.sdh-map-tab')) {
        const tabs = [...event.target.parentElement.querySelectorAll('.sdh-map-tab')];
        const next = tabs[(tabs.indexOf(event.target) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
        event.preventDefault();
        event.stopImmediatePropagation();
        next?.focus();
        if (next) this.previewMap(next.dataset.map);
      }
      else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && event.target.matches?.('.sdh-mode-card, .sdh-stack .sdh-btn')) {
        const list = [...event.target.parentElement.querySelectorAll('button')];
        const i = list.indexOf(event.target);
        const next = list[(i + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length];
        event.preventDefault();
        event.stopImmediatePropagation();
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
    if (this.sub) return this.q(`[data-panel="${this.sub}"]`);
    if (this.screen === 'menu' || this.screen === 'pause' || this.screen === 'finish' || this.screen === 'party-results') return this.q(`[data-panel="${this.screen}"]`);
    return null;
  }

  applyScreen(focus = true) {
    const prev = this.currentPanel;
    this.el.dataset.screen = this.screen;
    this.el.classList.toggle('is-settings', Boolean(this.sub));
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
    // The flyover only runs while the homepage picker is on screen.
    if (this.screen === 'menu' && !this.sub) this.playMapClip();
    else this.pauseMapClip();
    if (this.dialogOpen) {
      // The first-run name dialog stays modal over whatever screen the game shows underneath.
      this.el.querySelectorAll('.sdh-panel').forEach((p) => p.setAttribute('inert', ''));
      return;
    }
    if (!panel) {
      // Leaving the overlays: drop focus so Space / Enter go to the car, not a hidden button.
      if (this.el.contains(document.activeElement)) document.activeElement.blur();
    } else if (focus && panel !== prev) {
      // First match in priority order (querySelector with a list would return document order).
      const target = ['[aria-selected="true"]', '.sdh-btn-primary:not([hidden])', '.sdh-mode-card', '.sdh-cos:not(.is-locked)', 'input:not([type="hidden"]):not(:disabled)', 'button:not([hidden])']
        .reduce((found, sel) => found || panel.querySelector(sel), null);
      const active = document.activeElement;
      if (target && (!active || active === document.body || this.el.contains(active))) {
        target.focus({ preventScroll: true });
      }
    }
    if (panel && panel.querySelector('.sdh-overview')) this.drawOverviews();
  }

  showMenu() {
    this.finishFresh = false;
    this.screen = 'menu';
    this.sub = null;
    // Coming back from a run, the picker shows the map you are actually driving.
    if (this.previewMapId !== this.mapId) {
      this.previewMapId = this.mapId;
      this.renderMapStage();
    }
    this.applyScreen();
  }

  showRace() {
    this.finishFresh = false;
    this.screen = 'race';
    this.sub = null;
    if (this.renaming) this.endRename(false);
    this.applyScreen();
  }

  showPause(copyText = '') {
    this.screen = 'pause';
    this.sub = null;
    this.q('.sdh-pause-copy').textContent = copyText || 'Take a breath. The mountain will wait.';
    this.q('.sdh-pause-mode').textContent = this.v.modeLabel.raw || '';
    this.applyScreen();
  }

  /**
   * @param {{modeId:string, modeLabel?:string, time?:number, bestTime?:number, isRecord?:boolean, score?:number,
   *          bestScore?:number, topSpeedKmh?:number, respawns?:number, laps?:number[]}} result
   */
  showFinish(result = {}, rewards = null) {
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
    const stamp = result.isRecord ? { text: 'शाबाश!', cls: 'is-record', lang: 'hi' }
      : rewards?.medal?.tier ? { text: 'बढ़िया!', cls: 'is-medal', lang: 'hi' } : { text: 'PASS', cls: 'is-pass', lang: 'en' };
    this.ticketNo = ((this.ticketNo || 4817) + 1) % 100000;
    this.q('.sdh-finish-body').innerHTML = `
      <div class="sdh-ticket">
        <div class="sdh-ticket-head"><span>SLOP DRIFT ROADWAYS</span><span class="sdh-num">No. ${String(this.ticketNo).padStart(5, '0')}</span></div>
        <header class="sdh-panel-head">
          <div class="sdh-eyebrow">Mussoorie → ${esc(label)}</div>
          <h2 class="sdh-title">${kind === 'score' ? 'Time’s up' : 'Finished'}</h2>
          ${result.isRecord ? '<div class="sdh-record-badge">NEW RECORD</div>' : ''}
        </header>
        <div class="sdh-stamp sdh-result-stamp ${stamp.cls}" lang="${stamp.lang}">${stamp.text}</div>
        ${hero}${compare}
        ${stats.length ? `<dl class="sdh-stats">${stats.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd class="sdh-num">${esc(v)}</dd></div>`).join('')}</dl>` : ''}
        ${this.rewardsMarkup(rewards, result.modeId)}
        ${lapRows}
        <div class="sdh-ticket-foot">Valid for one descent only · Keep left · Use horn on blind bends</div>
      </div>
      <div class="sdh-ticket-chai">${CHAI_GLASS}</div>`;
    this.finishModeId = result.modeId;
    this.q('[data-act="race-ghost"]').hidden = kind === 'none';
    this.q('[data-act="finish-leaderboard"]').hidden = kind === 'none';
    this.q('[data-panel="finish"]').classList.toggle('is-record', Boolean(result.isRecord));
    this.screen = 'finish';
    this.finishFresh = true;
    this.sub = null;
    this.currentPanel = null; // force focus to the fresh content
    this.applyScreen();
    this.q('[data-panel="finish"]').scrollTop = 0;
    if (rewards) this.animateRewards(rewards);
  }

  // ---------------------------------------------------------------- party (race with friends)

  partyMarkup() {
    return `
      <aside class="sdh-panel sdh-panel-party" data-panel="party" aria-label="Race with friends">
        <header class="sdh-panel-head sdh-panel-head-row">
          <button type="button" class="sdh-icon sdh-icon-plain" data-act="sub-back" aria-label="Back">${ICON.back}</button>
          <h2 class="sdh-title">Race with friends</h2>
        </header>
        <div class="sdh-party-start">
          <p class="sdh-copy">Open a party, send the code or link, and race the same road at the same time.</p>
          <button type="button" class="sdh-btn sdh-btn-primary" data-act="party-create">${ICON.flag}<span>Create a party</span></button>
          <div class="sdh-party-or"><span>or join with a code</span></div>
          <form class="sdh-party-form" novalidate>
            <label class="sdh-party-label" for="${this.uid}-pcode">Party code</label>
            <div class="sdh-party-form-row">
              <input id="${this.uid}-pcode" class="sdh-party-input sdh-num" type="text" maxlength="5" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="K7MPQ" aria-describedby="${this.uid}-phint">
              <button type="submit" class="sdh-btn sdh-party-join" disabled>${ICON.play}<span>Join</span></button>
            </div>
            <small id="${this.uid}-phint" class="sdh-party-hint">Five characters: letters A to Z and digits 2 to 9.</small>
          </form>
        </div>
        <div class="sdh-party-room" hidden></div>
      </aside>`;
  }

  openParty() {
    this.renderParty();
    this.openSub('party', this.screen === 'party-results' ? 'party-results' : 'menu');
    if (this.q('.sdh-party-start').hidden === false) {
      this.q('.sdh-party-input')?.focus({ preventScroll: true });
    }
  }

  /** @param {object|null} view see the Party view contract; null = not in a party. */
  setParty(view) {
    this.party = view && typeof view === 'object' ? view : null;
    this.renderParty();
  }

  partyMemberRight(m, status) {
    if (m.dnf) return '<span class="sdh-pm-res is-dnf">DNF</span>';
    if (m.finished || (status === 'results' && Number.isFinite(m.time ?? m.score))) {
      const v = Number.isFinite(m.score) && !Number.isFinite(m.time) ? `${formatInt(m.score)} pts` : formatTime(m.time);
      return `<span class="sdh-pm-res sdh-num">${esc(v)}</span>`;
    }
    return m.ready
      ? `<span class="sdh-ready is-on">${ICON.check}<span>Ready</span></span>`
      : '<span class="sdh-ready"><span>Waiting</span></span>';
  }

  renderParty() {
    const v = this.party;
    const start = this.q('.sdh-party-start');
    const room = this.q('.sdh-party-room');
    const entry = this.q('.sdh-party-entry');
    const line = entry.querySelector('[data-p="partyLine"]');
    const codeChip = entry.querySelector('[data-p="partyCode"]');
    const key = JSON.stringify([v, Boolean(this.partyResults)]);
    if (key === this.partyKey) return;
    this.partyKey = key;
    start.hidden = Boolean(v);
    room.hidden = !v;
    entry.classList.toggle('is-live', Boolean(v));
    if (!v) {
      line.textContent = 'Share a 5-letter code. Up to 8 drivers.';
      codeChip.hidden = true;
      room.replaceChildren();
      return;
    }
    const members = Array.isArray(v.members) ? v.members.slice(0, 8) : [];
    const status = v.status || 'lobby';
    const me = members.find((m) => m.isYou);
    codeChip.hidden = !v.code;
    codeChip.textContent = v.code || '';
    line.textContent = {
      connecting: 'Connecting…', lobby: `${members.length} in the lobby`, countdown: 'Starting now',
      racing: 'Race in progress', results: 'Results are in', error: 'Problem with the party', closed: 'Party closed',
    }[status] || 'Party';
    const active = document.activeElement;
    const keep = room.contains(active) ? (active.dataset.act ? `[data-act="${active.dataset.act}"]${active.dataset.id ? `[data-id="${CSS.escape(active.dataset.id)}"]` : ''}` : null) : null;

    const plate = v.code ? `
      <div class="sdh-pplate" role="group" aria-label="Party code ${esc(v.code.split('').join(' '))}">
        <span class="sdh-pplate-ind">PARTY</span>
        <span class="sdh-pplate-code sdh-num">${esc(v.code)}</span>
      </div>
      <button type="button" class="sdh-btn sdh-party-copy" data-act="party-copy">${ICON.link}<span>Copy link</span></button>` : '';
    let banner = '';
    if (status === 'connecting') banner = '<div class="sdh-party-banner">Connecting to the party…</div>';
    else if (status === 'error') banner = `<div class="sdh-party-banner is-error" role="alert">${esc(v.error || 'Something went wrong with this party.')}</div>`;
    else if (status === 'closed') banner = `<div class="sdh-party-banner is-error" role="alert">${esc(v.error || 'The host closed this party.')}</div>`;
    else if (status === 'countdown') banner = `<div class="sdh-party-banner is-go" role="status">Starting in <b class="sdh-num">${esc(Number.isFinite(v.startsIn) ? Math.max(0, Math.ceil(v.startsIn)) : '…')}</b></div>`;
    else if (status === 'racing') banner = '<div class="sdh-party-banner" role="status">Race in progress. You’ll join the next round.</div>';

    const modes = Array.isArray(v.modes) ? v.modes : [];
    const canPick = Boolean(v.isHost) && (status === 'lobby' || status === 'results');
    const modeBlock = status === 'error' || status === 'closed' || status === 'connecting' ? '' : `
      <div class="sdh-section-label">Event · ${esc(v.mapLabel || '')}${v.round > 1 ? ` · Round ${esc(v.round)}` : ''}</div>
      ${canPick && modes.length ? `<div class="sdh-party-modes" role="group" aria-label="Choose the event">${modes.map((m) => `
        <button type="button" class="sdh-party-mode" data-act="party-select" data-id="${esc(m.id)}" aria-pressed="${m.id === v.modeId}">${esc(m.label)}</button>`).join('')}</div>`
        : `<div class="sdh-party-event"><b>${esc(v.modeLabel || '—')}</b>${v.isHost ? '' : '<small>Chosen by the host</small>'}</div>`}`;

    const list = members.length && status !== 'error' && status !== 'closed' && status !== 'connecting' ? `
      <div class="sdh-section-label">Drivers · ${members.length}/8</div>
      <ul class="sdh-party-members">${members.map((m) => {
        const col = paintColor(m.paint);
        return `<li class="${m.isYou ? 'is-you' : ''}">
          <span class="sdh-lv-badge sdh-lv-sm sdh-num" title="Level">${esc(m.level ?? 1)}</span>
          <span class="sdh-pm-name">${col ? `<i class="sdh-pm-paint" style="background:${col}"></i>` : ''}<span class="sdh-pm-text">${esc(m.name)}</span>${m.isHost ? `<span class="sdh-pm-host" title="Host">${ICON.host}<span class="sdh-sr">Host</span></span>` : ''}${m.isYou ? '<span class="sdh-pm-you">YOU</span>' : ''}</span>
          ${this.partyMemberRight(m, status)}
        </li>`;
      }).join('')}</ul>` : '';

    const live = status === 'lobby' || status === 'results';
    const ready = Boolean(me?.ready);
    let foot = '';
    if (status !== 'error' && status !== 'closed' && status !== 'connecting') {
      foot += `<button type="button" class="sdh-btn${ready ? '' : ' sdh-btn-primary'}" data-act="party-ready" aria-pressed="${ready}"${live ? '' : ' disabled'}>${ICON.check}<span>${ready ? 'Not ready' : 'Ready'}</span></button>`;
      if (v.isHost) {
        foot += status === 'results'
          ? `<button type="button" class="sdh-btn sdh-btn-primary" data-act="party-rematch"${v.canStart === false ? ' disabled' : ''}>${ICON.restart}<span>Rematch</span></button>`
          : `<button type="button" class="sdh-btn sdh-btn-primary" data-act="party-start"${v.canStart && status === 'lobby' ? '' : ' disabled'}>${ICON.play}<span>Start race</span></button>`;
      }
      if (status === 'results' && this.partyResults) foot += `<button type="button" class="sdh-btn" data-act="party-results">${ICON.trophy}<span>View results</span></button>`;
    }
    foot += `<button type="button" class="sdh-btn" data-act="party-leave">${ICON.exit}<span>Leave</span></button>`;

    room.innerHTML = `
      <div class="sdh-party-codebar">${plate}</div>
      ${banner}${modeBlock}${list}
      <div class="sdh-party-foot">${foot}</div>`;
    if (keep) room.querySelector(keep)?.focus({ preventScroll: true });
    else if (this.sub === 'party' && !this.el.contains(document.activeElement)) {
      room.querySelector('.sdh-btn-primary:not(:disabled), [data-act="party-leave"]')?.focus({ preventScroll: true });
    }
  }

  /**
   * In-race standings box under the timer plate. Never touches the DOM unless the rows changed.
   * @param {{position:number, name:string, isYou?:boolean, detail?:string}[]|null} rows
   */
  setRaceStandings(rows) {
    const list = Array.isArray(rows) ? rows.slice(0, 8) : [];
    const key = list.map((r) => `${r?.position}|${r?.name}|${r?.isYou ? 1 : 0}|${r?.detail ?? ''}`).join('\n');
    if (key === this.standingsKey) return;
    this.standingsKey = key;
    const box = this.q('.sdh-standings');
    box.hidden = list.length === 0;
    box.querySelector('.sdh-st-count').textContent = list.length ? String(list.length) : '';
    this.q('.sdh-st-list').innerHTML = list.map((r) => `
      <li class="sdh-st-row${r.isYou ? ' is-you' : ''}"><span class="sdh-st-pos sdh-num">${esc(r.position)}</span><span class="sdh-st-name">${esc(r.name)}</span><span class="sdh-st-detail sdh-num">${esc(r.detail ?? '')}</span></li>`).join('');
  }

  /**
   * Party variant of the finish ticket.
   * @param {{modeLabel:string, mapLabel?:string, isScore?:boolean, round?:number, isHost?:boolean,
   *          rows:{position:number, name:string, isYou?:boolean, time?:number, score?:number, dnf?:boolean}[]}|null} r
   */
  showPartyResults(r) {
    const body = this.q('.sdh-party-results-body');
    if (!r) {
      this.partyResults = null;
      body.replaceChildren();
      this.renderParty();
      if (this.screen === 'party-results') {
        this.screen = this.finishFresh ? 'finish' : 'menu';
        this.sub = null;
        this.currentPanel = null;
        this.applyScreen();
      }
      return;
    }
    this.partyResults = r;
    this.renderParty();
    const rows = Array.isArray(r.rows) ? r.rows.slice(0, 8) : [];
    const youWon = rows.some((x) => x.isYou && x.position === 1 && !x.dnf);
    const cell = (x) => {
      if (x.dnf) return '<span class="sdh-pr-dnf">DNF</span>';
      return r.isScore ? `<span class="sdh-pr-val sdh-num">${formatInt(x.score)}<small>pts</small></span>` : `<span class="sdh-pr-val sdh-num">${formatTime(x.time)}</span>`;
    };
    this.ticketNo = ((this.ticketNo || 4817) + 1) % 100000;
    body.innerHTML = `
      <div class="sdh-ticket">
        <div class="sdh-ticket-head"><span>SLOP DRIFT ROADWAYS · PARTY</span><span class="sdh-num">No. ${String(this.ticketNo).padStart(5, '0')}</span></div>
        <header class="sdh-panel-head">
          <div class="sdh-eyebrow">${esc(r.mapLabel || 'Mussoorie')} → ${esc(r.modeLabel || 'Event')}${r.round > 1 ? ` · Round ${esc(r.round)}` : ''}</div>
          <h2 class="sdh-title">Final order</h2>
        </header>
        ${youWon ? '<div class="sdh-stamp sdh-result-stamp is-record" lang="hi">बढ़िया!</div>' : ''}
        <ol class="sdh-pr-list">${rows.map((x) => `
          <li class="${x.isYou ? 'is-you' : ''}${x.position === 1 && !x.dnf ? ' is-first' : ''}">
            <span class="sdh-pr-pos sdh-num">${x.dnf ? '–' : esc(x.position)}</span>
            <span class="sdh-pr-name">${esc(x.name)}${x.isYou ? ' <em>you</em>' : ''}${x.position === 1 && !x.dnf && !youWon ? '<span class="sdh-stamp sdh-pr-win" lang="hi">बढ़िया!</span>' : ''}</span>
            ${cell(x)}
          </li>`).join('')}</ol>
        <div class="sdh-ticket-foot">One road · One finish line · Chai is on the winner</div>
      </div>`;
    this.q('[data-act="party-rematch"]').hidden = !r.isHost;
    if (this.screen === 'menu') {
      this.toast('Party results are in. Open Race with friends to view them.', 'good');
      return;
    }
    this.screen = 'party-results';
    this.sub = null;
    this.currentPanel = null;
    this.applyScreen();
    this.q('[data-panel="party-results"]').scrollTop = 0;
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
    for (const key of ['quality', 'timeOfDay', 'handling', 'transmission', 'units']) {
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
    for (const key of ['quality', 'timeOfDay', 'handling', 'transmission', 'units']) {
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
    this.renderCards();
  }

  /**
   * Replace the events on offer: once the world is built, only the modes its routes support
   * (config.js modesForWorld), so a map without the Nag Tibba road shows no Nag Tibba events.
   * @param {Array} modes  Entries of MODES.
   */
  setModes(modes) {
    this.modes = modes || [];
    const list = this.q('.sdh-mode-list');
    if (list) list.innerHTML = this.modeCardsMarkup();
    const tabs = this.q('[data-panel="leaderboard"] .sdh-tabs');
    if (tabs) tabs.innerHTML = this.leaderboardTabsMarkup();
    if (this.lbMode && !this.rankedModes().some((m) => m.id === this.lbMode)) this.lbMode = null;
    this.renderCards();
  }

  /** @param {Object<string, {medal:(string|null), next:({tier:string,target:number}|null)}>} medals */
  setMedals(medals) {
    this.medals = medals || {};
    this.renderCards();
  }

  renderCards() {
    for (const mode of this.modes) {
      const id = CSS.escape(mode.id);
      const cell = this.q(`[data-rec="${id}"]`);
      if (!cell) continue;
      const rec = this.records[mode.id] || {};
      const kind = recordKind(mode);
      let text = '';
      if (kind === 'time') text = Number.isFinite(rec.time) ? formatTime(rec.time) : '—';
      else if (kind === 'score') text = Number.isFinite(rec.score) ? `${formatInt(rec.score)} pts` : '—';
      cell.textContent = text;
      cell.classList.toggle('is-empty', text === '—');
      cell.title = kind === 'none' ? '' : 'Personal best';
      const m = kind === 'none' ? null : this.medals[mode.id];
      this.q(`[data-medal="${id}"]`).innerHTML = kind === 'none' ? '' : medalBadge(m?.medal || null);
      const next = this.q(`[data-next="${id}"]`);
      const targetKind = MEDAL_TARGETS[mode.id]?.kind || (kind === 'score' ? 'score' : 'time');
      next.textContent = m?.next ? `${MEDAL_LABELS[m.next.tier] || m.next.tier} ${formatTarget(targetKind, m.next.target)}` : '';
      next.className = `sdh-mode-card-next${m?.next ? ` is-${m.next.tier}` : ''}`;
      this.q(`[data-mode="${id}"]`).classList.toggle('is-roam', kind === 'none');
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
    if (!this.loadingSloganTimer) {
      const span = this.q('.sdh-loading-slogan span');
      let i = Math.floor(Math.random() * SLOGANS.length);
      span.textContent = SLOGANS[i];
      this.loadingSloganTimer = setInterval(() => {
        i = (i + 1) % SLOGANS.length;
        span.textContent = SLOGANS[i];
      }, 2600);
    }
  }

  hideLoading() {
    const el = this.q('.sdh-loading');
    if (!el.classList.contains('is-on') || this.loadingHideTimer) return;
    el.classList.add('is-hiding');
    clearInterval(this.loadingSloganTimer);
    this.loadingSloganTimer = null;
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

  // ---------------------------------------------------------------- progression & online: markup

  leaderboardTabsMarkup() {
    return this.rankedModes().map((m) => `
      <button type="button" role="tab" class="sdh-tab" data-act="lb-tab" data-tab="${esc(m.id)}" aria-selected="false" tabindex="-1" title="${esc(m.label)}">${esc(tabLabel(m))}</button>`).join('');
  }

  leaderboardMarkup() {
    const tabs = this.leaderboardTabsMarkup();
    return `
      <aside class="sdh-panel sdh-panel-sub" data-panel="leaderboard" aria-label="Leaderboard">
        <header class="sdh-panel-head sdh-panel-head-row">
          <button type="button" class="sdh-icon sdh-icon-plain" data-act="sub-back" aria-label="Back">${ICON.back}</button>
          <h2 class="sdh-title">Leaderboard</h2>
        </header>
        <div class="sdh-tabs" role="tablist" aria-label="Event">${tabs}</div>
        <div class="sdh-lb-status" role="status"></div>
        <ol class="sdh-lb-list"></ol>
      </aside>`;
  }

  achievementsMarkup() {
    return `
      <aside class="sdh-panel sdh-panel-sub" data-panel="achievements" aria-label="Achievements">
        <header class="sdh-panel-head sdh-panel-head-row">
          <button type="button" class="sdh-icon sdh-icon-plain" data-act="sub-back" aria-label="Back">${ICON.back}</button>
          <h2 class="sdh-title">Achievements</h2>
          <span class="sdh-ach-count sdh-num"></span>
        </header>
        <div class="sdh-xp sdh-ach-bar"><i></i></div>
        <ul class="sdh-ach-list"></ul>
      </aside>`;
  }

  garageMarkup() {
    return `
      <aside class="sdh-panel sdh-panel-sub" data-panel="garage" aria-label="Garage">
        <header class="sdh-panel-head sdh-panel-head-row">
          <button type="button" class="sdh-icon sdh-icon-plain" data-act="sub-back" aria-label="Back">${ICON.back}</button>
          <h2 class="sdh-title">Garage</h2>
        </header>
        <div class="sdh-group-label">Paint</div>
        <div class="sdh-cos-grid" data-slot-grid="paint"></div>
        <div class="sdh-group-label">Rims</div>
        <div class="sdh-cos-grid" data-slot-grid="rim"></div>
        <div class="sdh-group-label">Neon underglow <small class="sdh-group-hint">shines at night · G toggles</small></div>
        <div class="sdh-cos-grid" data-slot-grid="neon"></div>
        <div class="sdh-group-label">Door number</div>
        <label class="sdh-number-field">
          <input class="sdh-number-input sdh-num" type="text" inputmode="numeric" maxlength="2" pattern="[0-9]{1,2}" aria-label="Door number">
          <span class="sdh-number-note"></span>
        </label>
      </aside>`;
  }

  nameDialogMarkup() {
    return `
      <div class="sdh-dialog" aria-hidden="true">
        <form class="sdh-dialog-card" role="dialog" aria-modal="true" aria-labelledby="${this.uid}-name-title" novalidate>
          <div class="sdh-brand sdh-brand-menu"><span>SLOP DRIFT</span><small lang="hi">मसूरी</small></div>
          <h2 class="sdh-title" id="${this.uid}-name-title">Pick your driver name</h2>
          <p class="sdh-copy">Shown on leaderboards and above your car online. 2–16 characters: letters, digits, space, - and _.</p>
          <input class="sdh-name-input" type="text" maxlength="16" autocomplete="off" spellcheck="false" aria-label="Driver name">
          <div class="sdh-name-error" role="alert"></div>
          <div class="sdh-btn-row">
            <button type="button" class="sdh-btn" data-act="name-skip"><span>Skip</span></button>
            <button type="submit" class="sdh-btn sdh-btn-primary">${ICON.check}<span>Let’s drive</span></button>
          </div>
        </form>
      </div>`;
  }

  /** @param {import('../core/contracts.js').RewardSummary|null} r */
  rewardsMarkup(r, modeId) {
    if (!r) return '';
    const kind = MEDAL_TARGETS[modeId]?.kind || 'time';
    let medal = '';
    if (r.medal && r.medal.tier) {
      const next = r.medal.next ? `Next: ${esc(MEDAL_LABELS[r.medal.next.tier] || r.medal.next.tier)} ${formatTarget(kind, r.medal.next.target)}` : 'Top tier reached';
      medal = `
        <div class="sdh-medal-big is-${esc(r.medal.tier)}">
          ${medalBadge(r.medal.tier, ' sdh-medal-lg')}
          <div><b>${esc(MEDAL_LABELS[r.medal.tier] || r.medal.tier)} medal</b>${r.medal.isNew ? '<span class="sdh-new">NEW</span>' : ''}<small>${next}</small></div>
        </div>`;
    }
    const before = r.before || { level: 1, fraction: 0 };
    const after = r.after || before;
    const lines = (r.lines || []).map((l) => `<li><span>${esc(l.label)}</span><span class="sdh-num">+${formatInt(l.xp)}</span></li>`).join('');
    const xp = `
      <div class="sdh-xp-block${after.level > before.level ? ' has-levelup' : ''}">
        <div class="sdh-xp-head">
          <span class="sdh-lv-badge sdh-num" data-x="lv">${before.level}</span>
          <span class="sdh-levelup">LEVEL UP</span>
          <span class="sdh-xp-total sdh-num">+${formatInt(r.xpGained)} XP</span>
        </div>
        <div class="sdh-xp sdh-xp-lg"><i style="transform:scaleX(${Math.max(0, Math.min(1, before.fraction || 0))})"></i></div>
        ${lines ? `<ul class="sdh-xp-lines">${lines}</ul>` : ''}
      </div>`;
    const unlocks = (r.unlocks || []).length ? `
      <div class="sdh-section-label">Unlocked</div>
      <div class="sdh-chips">${r.unlocks.map((u) => `<span class="sdh-chip is-unlock">${ICON.car}${esc(u.label)}</span>`).join('')}</div>` : '';
    const ach = (r.achievements || []).length ? `
      <div class="sdh-section-label">Achievements</div>
      <ul class="sdh-ach-list sdh-ach-compact">${r.achievements.map((a) => `
        <li class="is-unlocked"><span class="sdh-ach-icon">${ICON.medal}</span><span class="sdh-ach-main"><b>${esc(a.title)}</b><small>${esc(a.description)}</small></span><span class="sdh-ach-xp sdh-num">+${formatInt(a.xp)}</span></li>`).join('')}
      </ul>` : '';
    const daily = r.daily && r.daily.completed ? `
      <div class="sdh-daily-done">${ICON.check}<span>Daily challenge complete</span><span class="sdh-streak">${ICON.flame}<b class="sdh-num">${r.daily.streak}</b></span></div>` : '';
    return `<section class="sdh-rewards">${medal}${xp}${daily}${unlocks}${ach}</section>`;
  }

  animateRewards(r) {
    const block = this.q('.sdh-panel-finish .sdh-xp-block');
    const bar = block?.querySelector('.sdh-xp i');
    const lv = block?.querySelector('[data-x="lv"]');
    if (!bar || !lv) return;
    const before = r.before || { level: 1, fraction: 0 };
    const after = r.after || before;
    const levelUp = after.level > before.level;
    const to = Math.max(0, Math.min(1, after.fraction || 0));
    const from = Math.max(0, Math.min(1, before.fraction || 0));
    const finalState = () => {
      bar.style.transform = `scaleX(${to})`;
      lv.textContent = String(after.level);
      if (levelUp) block.classList.add('is-levelup');
    };
    if (this.reducedMotion?.matches || !bar.animate) {
      finalState();
      return;
    }
    const easing = 'cubic-bezier(.3,.7,.2,1)';
    const first = bar.animate([{ transform: `scaleX(${from})` }, { transform: `scaleX(${levelUp ? 1 : to})` }],
      { duration: levelUp ? 900 : 1100, delay: 450, easing, fill: 'forwards' });
    first.onfinish = () => {
      if (!levelUp) { finalState(); first.cancel(); return; }
      lv.textContent = String(after.level);
      block.classList.add('is-levelup');
      const second = bar.animate([{ transform: 'scaleX(0)' }, { transform: `scaleX(${to})` }], { duration: 800, delay: 250, easing, fill: 'forwards' });
      second.onfinish = () => { finalState(); first.cancel(); second.cancel(); };
    };
  }

  // ---------------------------------------------------------------- sub-panels

  rankedModes() {
    return this.modes.filter((m) => recordKind(m) !== 'none');
  }

  openSub(name, source = 'menu') {
    if (name === 'settings') {
      this.openSettings(source === 'pause' ? 'pause' : 'menu');
      return;
    }
    this.subSource = source;
    if (this.sub === name) return;
    this.sub = name;
    this.applyScreen();
  }

  closeSub() {
    const was = this.sub;
    if (!was) return;
    if (was === 'settings') {
      this.closeSettingsFromUi(false);
      return;
    }
    this.sub = null;
    this.applyScreen(false);
    const opener = this.openPanel()?.querySelector(was === 'leaderboard'
      ? '[data-act="leaderboard"], [data-act="finish-leaderboard"]' : `[data-act="${was}"]`);
    opener?.focus({ preventScroll: true });
  }

  /** Shows the leaderboard on a tab and asks the game for its rows (onLeaderboardRequest). */
  openLeaderboard(modeId, source) {
    const ranked = this.rankedModes();
    const id = ranked.some((m) => m.id === modeId) ? modeId : ranked[0]?.id;
    if (!id) return;
    const src = source || (this.sub === 'leaderboard' ? this.subSource : (this.screen === 'finish' ? 'finish' : 'menu'));
    this.lbMode = id;
    for (const tab of this.el.querySelectorAll('[data-panel="leaderboard"] [role="tab"]')) {
      const on = tab.dataset.tab === id;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    }
    this.renderLeaderboard();
    this.openSub('leaderboard', src);
    const now = performance.now();
    // openLeaderboard is often called twice for one click (by the button and by the game); ask once.
    if (this.lbRequested.mode !== id || now - this.lbRequested.at > 800) {
      this.lbRequested = { mode: id, at: now };
      this.onLeaderboardRequest(id);
    }
  }

  /** The map being driven: leaderboard medals and headings are for its tracks. */
  setMap(mapId) {
    this.mapId = mapId;
    this.previewMapId = mapId;
    this.renderMapStage();
    if (this.lbMode) this.renderLeaderboard();
  }

  /** Show a map in the homepage drone preview without leaving the current world. */
  previewMap(mapId) {
    if (!MAPS[mapId] || this.previewMapId === mapId) return;
    this.previewMapId = mapId;
    this.renderMapStage();
  }

  /** Paint the homepage map picker: shot, copy, chips, CTA and tab state. */
  renderMapStage() {
    const map = MAPS[this.previewMapId] || MAPS[this.mapId];
    if (!map || !this.el) return;
    const here = map.id === this.mapId;
    const shot = this.q('.sdh-map-shot');
    if (shot) {
      const src = map.preview || '';
      if (shot.getAttribute('src') !== src) {
        if (src) shot.src = src;
        else shot.removeAttribute('src');
        if (shot.animate && !this.reducedMotion?.matches) {
          shot.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
        }
      }
      shot.alt = `${map.label} from above`;
    }
    // The still is the poster and the fallback; the flyover fades in over it once it can play.
    const clip = this.q('.sdh-map-clip');
    if (clip) {
      if (map.preview) clip.setAttribute('poster', map.preview);
      else clip.removeAttribute('poster');
      if (map.clip && !this.reducedMotion?.matches) {
        if (clip.getAttribute('src') !== map.clip) {
          clip.classList.remove('is-on');
          clip.src = map.clip;
        }
        if (this.screen === 'menu' && !this.sub) this.playMapClip();
      } else {
        clip.classList.remove('is-on');
        clip.pause();
      }
    }
    const status = this.q('.sdh-map-stage-status');
    status.textContent = here ? 'Driving now' : 'Preview';
    status.classList.toggle('is-here', here);
    this.q('.sdh-map-stage-name').textContent = map.label;
    this.q('.sdh-map-stage-tag').textContent = map.tagline || '';
    this.q('.sdh-map-stage-chips').innerHTML = [
      `<li class="sdh-map-chip is-count">${this.eventCount(map)} events</li>`,
      ...(map.highlights || []).map((text) => `<li class="sdh-map-chip">${esc(text)}</li>`),
    ].join('');
    const go = this.q('.sdh-map-go');
    go.hidden = here;
    go.innerHTML = `${ICON.car}<span>Drive to ${esc(map.label)}</span>`;
    for (const tab of this.el.querySelectorAll('.sdh-map-tab')) {
      const on = tab.dataset.map === map.id;
      tab.setAttribute('aria-pressed', String(on));
      tab.classList.toggle('is-current', on);
    }
  }

  /** Start the homepage flyover, loading it only when the picker is actually shown. */
  playMapClip() {
    const clip = this.q('.sdh-map-clip');
    if (!clip || this.reducedMotion?.matches) return;
    const map = MAPS[this.previewMapId] || MAPS[this.mapId];
    if (!map?.clip) return;
    if (clip.getAttribute('src') !== map.clip) {
      clip.classList.remove('is-on');
      clip.src = map.clip;
    }
    const playing = clip.play?.();
    if (playing?.catch) playing.catch(() => {});
  }

  pauseMapClip() {
    const clip = this.q('.sdh-map-clip');
    if (clip && !clip.paused) clip.pause();
  }

  /** @param {{status:'loading'|'online'|'local'|'error', entries: import('../core/contracts.js').LeaderboardEntry[]}} data */
  setLeaderboard(modeId, data) {
    this.leaderboards[modeId] = data || { status: 'loading', entries: [] };
    if (modeId === this.lbMode) this.renderLeaderboard();
  }

  renderLeaderboard() {
    const id = this.lbMode;
    const data = this.leaderboards[id] || { status: 'loading', entries: [] };
    const status = this.q('.sdh-lb-status');
    const list = this.q('.sdh-lb-list');
    const kind = MEDAL_TARGETS[id]?.kind || (recordKind(this.modes.find((m) => m.id === id)) === 'score' ? 'score' : 'time');
    const entries = Array.isArray(data.entries) ? data.entries : [];
    const mapLabel = MAPS[this.mapId]?.label;
    const msg = {
      loading: 'Loading…',
      online: `${mapLabel ? `${esc(mapLabel)} · ` : ''}Global leaderboard · ${entries.length} ${entries.length === 1 ? 'driver' : 'drivers'}`,
      local: '<b>Local only.</b> These are this browser’s runs. Online leaderboards are not configured.',
      error: '<b>Couldn’t reach the leaderboard.</b> Check your connection and try again.',
    }[data.status] || '';
    status.innerHTML = msg;
    status.className = `sdh-lb-status is-${esc(data.status)}`;
    if (!entries.length) {
      list.innerHTML = data.status === 'loading' ? '' : '<li class="sdh-lb-empty">No runs yet. Set the first one.</li>';
      return;
    }
    list.innerHTML = entries.map((e) => {
      const value = kind === 'score' ? e.score : e.time;
      const shown = kind === 'score' ? formatInt(value) : formatTime(value);
      return `
        <li class="sdh-lb-row${e.isMe ? ' is-me' : ''}">
          <span class="sdh-lb-rank sdh-num">${esc(e.rank)}</span>
          <span class="sdh-lb-name"><b>${esc(e.name)}</b>${e.isMe ? '<em>you</em>' : ''}<small>Lv ${esc(e.level)}</small></span>
          ${medalBadge(medalFor(id, value, this.mapId))}
          <span class="sdh-lb-value sdh-num">${shown}</span>
          ${e.hasGhost ? `<button type="button" class="sdh-icon sdh-icon-sm" data-act="lb-ghost" data-lb-mode="${esc(id)}" data-player="${esc(e.playerId)}" aria-label="Race ${esc(e.name)}’s ghost" title="Race ghost">${ICON.ghost}</button>` : '<span class="sdh-icon-sm" aria-hidden="true"></span>'}
        </li>`;
    }).join('');
  }

  /** @param {{id:string,title:string,description:string,xp:number,unlocked:boolean,at:(number|null)}[]} list */
  setAchievements(list) {
    this.achievements = Array.isArray(list) ? list : [];
    const done = this.achievements.filter((a) => a.unlocked).length;
    const total = this.achievements.length;
    this.q('.sdh-ach-count').textContent = `${done} / ${total}`;
    this.q('.sdh-ach-bar i').style.transform = `scaleX(${total ? done / total : 0})`;
    this.q('[data-panel="achievements"] .sdh-ach-list').innerHTML = this.achievements.map((a) => {
      const when = a.unlocked && a.at ? new Date(a.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
      return `
        <li class="${a.unlocked ? 'is-unlocked' : 'is-locked'}">
          <span class="sdh-ach-icon">${a.unlocked ? ICON.medal : ICON.lock}</span>
          <span class="sdh-ach-main"><b>${esc(a.title)}</b><small>${esc(a.description)}</small></span>
          <span class="sdh-ach-xp sdh-num">${a.unlocked ? esc(when) : `+${formatInt(a.xp)} XP`}</span>
        </li>`;
    }).join('');
  }

  /** @param {{items:Array, selected:{paint:string, rim:string, number:string, neon?:string}}} garage */
  setGarage(garage) {
    this.garage = garage || { items: [], selected: {} };
    const items = this.garage.items || [];
    const sel = this.garage.selected || {};
    for (const slot of ['paint', 'rim', 'neon']) {
      const grid = this.q(`[data-slot-grid="${slot}"]`);
      grid.innerHTML = items.filter((it) => it.slot === slot).map((it) => {
        const on = sel[slot] === it.value;
        const locked = !it.unlocked;
        const color = Number.isFinite(it.color) ? hex(it.color) : 'transparent';
        const swatchKind = slot === 'rim' ? ' is-rim' : slot === 'neon' ? (it.value === 'rainbow' ? ' is-neon is-rainbow' : it.value === 'off' ? ' is-neon is-off' : ' is-neon') : '';
        return `
          <button type="button" class="sdh-cos${on ? ' is-selected' : ''}${locked ? ' is-locked' : ''}" data-act="cosmetic" data-slot="${esc(slot)}" data-value="${esc(it.value)}"
            aria-pressed="${on}" aria-disabled="${locked}" title="${esc(it.label)}${locked ? ` · ${esc(it.requirement || 'Locked')}` : ''}">
            <span class="sdh-cos-swatch${swatchKind}" style="--c:${color}">${locked ? ICON.lock : ''}</span>
            <span class="sdh-cos-label">${esc(it.label)}</span>
            <span class="sdh-cos-req">${locked ? esc(it.requirement || 'Locked') : on ? 'Equipped' : ''}</span>
          </button>`;
      }).join('');
    }
    const custom = items.find((it) => it.slot === 'number' && it.value === 'custom');
    const input = this.q('.sdh-number-input');
    const enabled = Boolean(custom?.unlocked);
    input.disabled = !enabled;
    if (document.activeElement !== input) input.value = sel.number ?? '';
    this.q('.sdh-number-note').textContent = enabled ? 'Two digits, shown on the doors' : `Locked · ${custom?.requirement || 'not available'}`;
    this.q('.sdh-number-field').classList.toggle('is-locked', !enabled);
  }

  commitNumber() {
    const input = this.q('.sdh-number-input');
    const v = input.value.trim();
    if (!/^[0-9]{1,2}$/.test(v)) {
      input.value = this.garage?.selected?.number ?? '';
      this.toast('Door numbers are 1–2 digits', 'warn');
      return;
    }
    if (v !== this.garage?.selected?.number) this.onCosmetic('number', v);
  }

  // ---------------------------------------------------------------- player bar, rename, first-run name

  /** @param {{name:string, level: import('../core/contracts.js').LevelInfo, connection:string, online:(number|null)}} profile */
  setProfile(profile) {
    this.profile = { ...(this.profile || {}), ...(profile || {}) };
    this.renderProfile();
  }

  renderProfile() {
    const p = this.profile || { name: 'Driver', level: { level: 1, fraction: 0, into: 0, span: 150 }, connection: 'offline', online: null };
    const lv = p.level || { level: 1, fraction: 0, into: 0, span: 0 };
    const set = (key, fn) => this.el.querySelectorAll(`[data-p="${key}"]`).forEach(fn);
    set('name', (n) => { n.textContent = p.name || 'Driver'; });
    set('level', (n) => { n.textContent = String(lv.level ?? 1); });
    set('xp', (n) => { n.style.transform = `scaleX(${Math.max(0, Math.min(1, lv.fraction || 0))})`; });
    set('xpText', (n) => { n.textContent = lv.span ? `Level ${lv.level} · ${formatInt(lv.into)} / ${formatInt(lv.span)} XP` : `Level ${lv.level}`; });
    const conn = ['online', 'connecting', 'local', 'offline'].includes(p.connection) ? p.connection : 'offline';
    const count = Number.isFinite(p.online) ? p.online : null;
    const text = {
      online: count != null ? `Online · ${formatInt(count)}` : 'Online',
      connecting: 'Connecting…',
      local: 'Local only',
      offline: 'Offline',
    }[conn];
    set('conn', (n) => { n.className = `sdh-conn is-${conn}`; n.title = text; });
    set('connText', (n) => { n.textContent = text; });
    this.renderOnlineChip();
  }

  renderOnlineChip() {
    const conn = this.profile?.connection;
    const chip = this.q('.sdh-online-chip');
    const n = Number.isFinite(this.profile?.online) ? this.profile.online : this.players.length;
    chip.classList.toggle('is-on', conn === 'online' || conn === 'connecting');
    chip.className = `sdh-online-chip${conn === 'online' || conn === 'connecting' ? ' is-on' : ''} is-${conn || 'offline'}`;
    chip.querySelector('span').textContent = conn === 'connecting' ? 'Connecting' : `${formatInt(n)} online`;
  }

  startRename() {
    if (this.renaming) return;
    const btn = this.q('.sdh-pb-name');
    const input = this.q('.sdh-pb-input');
    this.renaming = true;
    input.value = this.profile?.name || '';
    btn.hidden = true;
    input.hidden = false;
    input.focus();
    input.select();
  }

  endRename(commit) {
    if (!this.renaming) return;
    this.renaming = false;
    const btn = this.q('.sdh-pb-name');
    const input = this.q('.sdh-pb-input');
    const name = validateName(input.value);
    input.hidden = true;
    btn.hidden = false;
    if (commit && name && name !== this.profile?.name) {
      this.setProfile({ name });
      this.onRename(name);
    } else if (commit && !name && input.value.trim() !== (this.profile?.name || '')) {
      this.toast('Names are 2–16 letters, digits, space, - or _', 'warn');
    }
    if (this.screen === 'menu' && !this.sub) btn.focus({ preventScroll: true });
  }

  /** First-run dialog. Confirm or Skip both end in onRename(name). */
  promptName(currentName = '') {
    const dialog = this.q('.sdh-dialog');
    const input = this.q('.sdh-name-input');
    this.dialogSuggested = String(currentName || '');
    input.value = this.dialogSuggested;
    this.q('.sdh-name-error').textContent = '';
    this.dialogOpen = true;
    this.dialogReturnFocus = document.activeElement;
    dialog.classList.add('is-open');
    dialog.setAttribute('aria-hidden', 'false');
    this.el.querySelectorAll('.sdh-panel').forEach((p) => p.setAttribute('inert', ''));
    input.focus();
    input.select();
  }

  closeDialog() {
    const dialog = this.q('.sdh-dialog');
    this.dialogOpen = false;
    dialog.classList.remove('is-open');
    dialog.setAttribute('aria-hidden', 'true');
    this.currentPanel = null;
    this.applyScreen();
  }

  confirmName() {
    const input = this.q('.sdh-name-input');
    const name = validateName(input.value);
    if (!name) {
      this.q('.sdh-name-error').textContent = 'Use 2–16 characters: letters, digits, space, - or _.';
      input.focus();
      return;
    }
    this.closeDialog();
    this.setProfile({ name });
    this.onRename(name);
  }

  skipName() {
    const name = validateName(this.dialogSuggested) || this.dialogSuggested || this.profile?.name || 'Driver';
    this.closeDialog();
    this.setProfile({ name });
    this.onRename(name);
  }

  // ---------------------------------------------------------------- daily, players, ghost, notifications

  /** @param {import('../core/contracts.js').DailyChallenge|null} daily */
  setDaily(daily) {
    this.daily = daily || null;
    this.renderDaily();
  }

  renderDaily() {
    const card = this.q('.sdh-daily');
    const d = this.daily;
    card.classList.toggle('is-empty', !d);
    card.classList.toggle('is-done', Boolean(d?.done));
    const set = (k, v) => { this.q(`[data-d="${k}"]`).textContent = v; };
    if (!d) {
      set('text', 'No challenge today');
      set('mode', ''); set('xp', ''); set('streak', '0'); set('btn', 'Start');
      this.q('[data-act="daily"]').disabled = true;
      return;
    }
    const extra = [d.timeOfDay ? d.timeOfDay.charAt(0).toUpperCase() + d.timeOfDay.slice(1) : '', d.clean ? 'No resets' : ''].filter(Boolean).join(' · ');
    set('text', d.text || '');
    set('mode', `${d.modeLabel || d.modeId}${extra ? ` · ${extra}` : ''}`);
    set('xp', d.done ? 'Completed' : `+${formatInt(d.xp)} XP`);
    set('streak', String(d.streak || 0));
    set('btn', d.done ? 'Replay' : 'Start');
    this.q('[data-act="daily"]').disabled = false;
    this.q('.sdh-daily .sdh-streak').classList.toggle('is-hot', (d.streak || 0) > 0);
  }

  /** @param {{id:string, name:string, level:number, modeLabel:string, isMe:boolean}[]} players */
  setPlayers(players) {
    this.players = Array.isArray(players) ? players : [];
    this.renderPlayers();
    this.renderOnlineChip();
  }

  renderPlayers() {
    const list = this.q('.sdh-players-list');
    const n = this.players.length;
    this.q('[data-p="playersCount"]').textContent = String(n);
    this.q('.sdh-players').classList.toggle('is-empty', n === 0);
    list.innerHTML = n ? this.players.map((p) => `
      <li class="${p.isMe ? 'is-me' : ''}"><span class="sdh-lv-badge sdh-lv-sm sdh-num">${esc(p.level)}</span><b>${esc(p.name)}</b>${p.isMe ? '<em>you</em>' : ''}<small>${esc(p.modeLabel || '')}</small></li>`).join('')
      : '<li class="sdh-players-none">No other drivers on the mountain right now.</li>';
  }

  /** @param {{name:string, kind:'pb'|'leaderboard', visible?:boolean}|null} ghost */
  setGhost(ghost) {
    this.ghost = ghost || null;
    this.renderGhost();
  }

  renderGhost() {
    const chip = this.q('.sdh-ghost-chip');
    const g = this.ghost;
    chip.classList.toggle('is-on', Boolean(g));
    chip.classList.toggle('is-hidden-ghost', Boolean(g) && g.visible === false);
    chip.querySelector('span').textContent = g ? (g.kind === 'pb' ? 'Ghost · Your best' : `Ghost · ${g.name || 'Rival'}`) : '';
  }

  /** @param {import('../core/contracts.js').CareerEvent} event Queued: one card at a time. */
  notify(event) {
    if (!event || !event.title) return;
    this.notifyQueue.push(event);
    if (this.notifyQueue.length > 8) this.notifyQueue.shift();
    this.pumpNotify();
  }

  pumpNotify() {
    if (this.notifyBusy || !this.notifyQueue.length) return;
    const ev = this.notifyQueue.shift();
    this.notifyBusy = true;
    const type = ['achievement', 'levelUp', 'unlock', 'medal', 'daily'].includes(ev.type) ? ev.type : 'achievement';
    const tier = type === 'medal' ? MEDAL_TIERS.find((t) => `${ev.title} ${ev.detail || ''}`.toLowerCase().includes(t)) : null;
    const icon = type === 'medal' ? medalBadge(tier || 'gold', ' sdh-medal-md')
      : type === 'levelUp' ? `<span class="sdh-lv-badge sdh-num">${esc((ev.title.match(/\d+/) || ['↑'])[0])}</span>`
        : type === 'daily' ? ICON.flame : type === 'unlock' ? ICON.car : ICON.medal;
    const kicker = { achievement: 'Achievement', levelUp: 'Level up', unlock: 'Unlocked', medal: 'Medal', daily: 'Daily challenge' }[type];
    const item = document.createElement('div');
    item.className = `sdh-notify is-${type}`;
    item.innerHTML = `<span class="sdh-notify-icon">${icon}</span>
      <span class="sdh-notify-main"><small>${kicker}</small><b>${esc(ev.title)}</b>${ev.detail ? `<span>${esc(ev.detail)}</span>` : ''}</span>
      ${Number.isFinite(ev.xp) && ev.xp > 0 ? `<span class="sdh-notify-xp sdh-num">+${formatInt(ev.xp)} XP</span>` : ''}`;
    this.toastsEl.prepend(item);
    this.later(() => item.classList.add('is-leaving'), 3000);
    this.later(() => {
      item.remove();
      this.notifyBusy = false;
      this.pumpNotify();
    }, 3400);
  }

  // ---------------------------------------------------------------- hill-road moments

  /** 'calm' (free roam: speed stone, minimap, player chip only) or 'race' (full telemetry). */
  setHudMode(mode) {
    this.hudMode = mode === 'calm' ? 'calm' : 'race';
    this.el.classList.toggle('is-calm', this.hudMode === 'calm');
  }

  /**
   * Milestone stone that slides up from the bottom edge. Queued: one at a time, ~1.8 s each.
   * @param {{index:number, total:number, split:(number|null), label?:string, km:(number|null)}} cp
   */
  showCheckpoint(cp = {}) {
    this.cpQueue = this.cpQueue || [];
    this.cpQueue.push(cp);
    if (this.cpQueue.length > 6) this.cpQueue.shift();
    this.pumpCheckpoint();
  }

  pumpCheckpoint() {
    if (this.cpBusy || !this.cpQueue?.length) return;
    const cp = this.cpQueue.shift();
    this.cpBusy = true;
    const km = Number.isFinite(cp.km) ? (cp.km >= 10 ? Math.round(cp.km) : Math.round(cp.km * 10) / 10) : null;
    const count = Number.isFinite(cp.index) && Number.isFinite(cp.total) ? `${cp.index}/${cp.total}` : '';
    const split = Number.isFinite(cp.split)
      ? `<div class="sdh-cp-split sdh-num ${cp.split < 0 ? 'is-ahead' : cp.split > 0 ? 'is-behind' : 'is-even'}">${formatDelta(cp.split)}</div>` : '';
    const el = document.createElement('div');
    el.className = 'sdh-cp';
    el.innerHTML = `
      <div class="sdh-cp-stone">
        <div class="sdh-cp-cap">${esc(cp.label || 'CHECKPOINT')}</div>
        <div class="sdh-cp-big sdh-num">${km != null ? `${km}<small>KM</small>` : esc(count)}</div>
        ${km != null && count ? `<div class="sdh-cp-sub sdh-num">${esc(count)}</div>` : ''}
      </div>${split}`;
    this.q('.sdh-checkpoints').appendChild(el);
    this.later(() => el.classList.add('is-leaving'), 1800);
    this.later(() => {
      el.remove();
      this.cpBusy = false;
      this.pumpCheckpoint();
    }, 2050);
  }

  /** Yellow-and-black hill-road slogan board for ~2.5 s. Random original slogan when text is omitted. */
  showSlogan(text) {
    const board = this.q('.sdh-slogan');
    const line = text || SLOGANS[Math.floor(Math.random() * SLOGANS.length)];
    board.querySelector('span').textContent = line;
    board.classList.remove('is-on');
    void board.offsetWidth; // restart the drop-in animation (event-time only, never per frame)
    board.classList.add('is-on');
    if (this.sloganTimer) clearTimeout(this.sloganTimer);
    this.sloganTimer = this.later(() => board.classList.remove('is-on'), 2500);
    return line;
  }

  flashDriveSafe() {
    const v = this.v;
    v.driftStamp.set(true);
    if (this.stampTimer) clearTimeout(this.stampTimer);
    this.stampTimer = this.later(() => v.driftStamp.set(false), 900);
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
    // Prayer-flag tachometer: blocks light left to right; the scale runs ~8 % past the redline.
    this.gaugeMax = Math.max(1000, rpmMax * 1.08);
    this.rpmMax = rpmMax;
    const red = rpmMax / this.gaugeMax;
    const tach = this.q('.sdh-tach');
    tach.replaceChildren();
    this.tachFlags = [];
    for (let i = 0; i < TACH_BLOCKS; i += 1) {
      const b = document.createElement('i');
      const zoneRed = (i + 1) / TACH_BLOCKS > red + 1e-6;
      b.className = `is-${TACH_COLORS[i % TACH_COLORS.length]}${zoneRed ? ' is-redzone' : ''}`;
      tach.appendChild(b);
      this.tachFlags.push(new Flag(b, 'is-lit'));
    }
    this.tachLit = -1;
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
    const lit = Math.round(Math.min(1, rpm / this.gaugeMax) * TACH_BLOCKS);
    if (lit !== this.tachLit) {
      this.tachLit = lit;
      for (let i = 0; i < TACH_BLOCKS; i += 1) this.tachFlags[i].set(i < lit);
    }
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
      v.timing.set(kind !== 'roam' && (s.elapsed || 0) > 0);
      v.wrongWay.set(Boolean(s.wrongWay));
      v.offRoad.set(Boolean(s.offRoad) && !s.wrongWay);
    }

    // Drift combo --------------------------------------------------------
    const d = f.drift;
    if (d) {
      const alive = d.active || (d.bank > 0 && d.comboTimer > 0);
      v.driftOn.set(alive);
      v.driftActive.set(Boolean(d.active));
      // A combo that dies with time still on its clock was broken (spin, crash), not banked.
      const prevBank = this.driftPrevBank || 0;
      if (prevBank > 0 && !(d.bank > 0) && !d.active && (this.driftPrevTimer || 0) > 0.2) this.flashDriveSafe();
      this.driftPrevBank = d.bank || 0;
      this.driftPrevTimer = d.comboWindow > 0 ? (d.comboTimer || 0) / d.comboWindow : 0;
      if (alive) {
        v.driftGrow.setKey(Math.round(Math.min(5, d.multiplier || 1) * 10), (k) => String(1 + Math.min(0.24, (k / 10 - 1) * 0.06)));
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
    clearInterval(this.loadingSloganTimer);
    this.timers.clear();
    this.minimap.destroy();
    this.elevation.destroy();
    this.el.remove();
    if (this.injectedStyles) {
      stylesRefCount -= 1;
      if (stylesRefCount <= 0) {
        document.querySelector('link[data-sdh-styles]')?.remove();
        document.querySelector('link[data-sdh-theme]')?.remove();
      }
    }
  }
}
