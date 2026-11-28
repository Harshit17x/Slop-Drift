// Racing HUD, menus, settings, results, loading screen and minimap.
// DOM is built once in the constructor. update(frame) runs every animation frame and only writes to the
// DOM when a displayed (quantised) value actually changed; it never reads layout.

import { MAPS } from '../world/maps.js';
import {
  DEFAULT_SETTINGS, HANDLING_ASSISTS, MODES, QUALITY_PRESETS, TIME_OF_DAY, UI_ACCENTS, getMode, modesForWorld, normalizeSettings,
} from '../config.js';
import { CARS, getCar } from '../vehicle/cars.js';
import { UPGRADE_SLOTS, MAX_UPGRADE_STAGE, effectiveCarRatings, effectiveClassInfo, hasCarNitro } from '../vehicle/upgradeTuning.js';
import { ElevationStrip, Minimap } from './Minimap.js';
import { CAR_UNLOCKS, MAP_UNLOCKS, MEDAL_LABELS, MEDAL_TARGETS, MEDAL_TIERS, medalTargets } from '../meta/catalog.js';
import { trackKey } from '../meta/trackKey.js';
import { CHAI_GLASS, ICON } from './icons.js';
import {
  CAR_SORT_MODES, HUB_TABS, MAP_SUBTITLES, carRatingRows,
  driveUnitSvg, eventCategoryBadge, forzaMapHubMarkup, garageHubMarkup, hubHeaderMarkup,
  mapSubtitleMarkup, sortCars,
} from './GarageUi.js';
import { DriftBackground } from './driftBackground.js';

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

const AWARD_GROUPS = [
  { id: 'racing', label: 'Racing', icon: 'trophy' },
  { id: 'drifting', label: 'Drifting', icon: 'flame' },
  { id: 'explorer', label: 'Explorer', icon: 'map' },
  { id: 'garage', label: 'Garage', icon: 'spanner' },
  { id: 'rivals', label: 'Rivals & streaks', icon: 'flag' },
];

/** One achievement card: big icon, name, what to do, a progress bar when it can be counted, the reward. */
function awardCard(a) {
  const group = AWARD_GROUPS.find((g) => g.id === a.group) || AWARD_GROUPS[0];
  const p = a.progress;
  const pct = a.unlocked ? 1 : p ? p.value / p.target : 0;
  const count = p && !a.unlocked ? `<span class="sdh-award-count sdh-num">${formatInt(p.value)} / ${formatInt(p.target)}</span>` : '';
  return `
    <li class="sdh-award ${a.unlocked ? 'is-done' : 'is-open'} is-${esc(group.id)}" style="--p:${pct.toFixed(3)}">
      <span class="sdh-award-icon">${a.unlocked ? ICON.check : ICON[group.icon]}</span>
      <span class="sdh-award-main">
        <b>${esc(a.title)}</b>
        <small>${esc(a.description)}</small>
        ${p || a.unlocked ? `<span class="sdh-award-bar"><i></i></span>` : ''}
      </span>
      <span class="sdh-award-side">${count}<em class="sdh-num">${a.unlocked ? 'Done' : `+${formatInt(a.xp)} XP`}</em></span>
    </li>`;
}

/** Awards screen: "Almost there" (closest counted goals), then each group with its own done count. */
function awardsMarkup(list) {
  const close = list.filter((a) => !a.unlocked && a.progress && a.progress.value > 0)
    .sort((x, y) => y.progress.value / y.progress.target - x.progress.value / x.progress.target).slice(0, 3);
  const almost = close.length ? `
    <section class="sdh-award-group is-almost"><h3>${ICON.speed}<span>Almost there</span></h3><ul>${close.map(awardCard).join('')}</ul></section>` : '';
  return almost + AWARD_GROUPS.map((g) => {
    const items = list.filter((a) => a.group === g.id);
    if (!items.length) return '';
    const done = items.filter((a) => a.unlocked).length;
    // Open goals first (counted ones by progress), finished ones last.
    items.sort((x, y) => (x.unlocked - y.unlocked) || ((y.progress ? y.progress.value / y.progress.target : 0) - (x.progress ? x.progress.value / x.progress.target : 0)));
    return `
      <section class="sdh-award-group is-${g.id}">
        <h3>${ICON[g.icon]}<span>${g.label}</span><em class="sdh-num">${done} / ${items.length}</em></h3>
        <ul>${items.map(awardCard).join('')}</ul>
      </section>`;
  }).join('');
}

/** Five mastery stars, `n` of them filled. */
function masteryMarkup(n) {
  return `<span class="sdh-mastery" title="Mastery ${n}/5" aria-label="Mastery ${n} of 5">${'<i class="is-on"></i>'.repeat(n)}${'<i></i>'.repeat(5 - n)}</span>`;
}

/** Contract progress: km goals keep one decimal, counts are whole. */
function formatContract(value) {
  return Number.isInteger(value) ? formatInt(value) : value.toFixed(1);
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
    this.sub = null; // open sub-panel: 'settings' | 'leaderboard' | 'achievements' | 'party'
    this.hubTab = 'garage';
    this.lastMainTab = 'garage';
    this.garageMode = 'view';
    this.carSort = 'default';
    this.specsOpen = false;
    this.forzaModeId = modes[0]?.id || 'sprint';
    this.forzaView = 'map';
    this.stageMode = 'image';
    this.loadingActive = false;
    this.titleReady = false;
    this.headlightsOn = false;
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
    this.rivals = [];
    this.notifyBusy = false;
    this.renaming = false;
    this.dialogOpen = false;
    this.debugVisible = false;
    this.countdownText = '';
    this.track = null;
    this.activeRoad = null;
    this.lastCar = null;
    this.lastActiveCar = null;
    this.timers = new Set();
    this.party = null; // last view passed to setParty()
    this.partyResults = null;
    this.partyKey = '';
    this.standingsKey = '';
    this.finishFresh = false;
    this.reducedMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

    // Callbacks assigned by the game.
    const noop = () => {};
    this.noopRef = noop;
    this.onStart = noop;
    this.onPause = noop;
    this.onResume = noop;
    this.onRestart = noop;
    this.onMenu = noop;
    this.onOpenSettings = noop;
    this.onCloseSettings = noop;
    this.onApplySettings = noop;
    this.onSettingsChange = noop;
    this.onFullscreen = noop;
    this.onCamera = noop;
    this.onRespawn = noop;
    this.onRename = noop;
    this.onStartDaily = noop;
    this.onDuel = noop;
    this.onStartQuest = noop;
    this.onRaceGhost = noop;
    this.onOpenLeaderboard = noop;
    this.onLeaderboardRequest = noop;
    this.onRaceLeaderboardGhost = noop;
    this.onCosmetic = noop;
    this.onFavoriteCar = noop;
    this.onPreviewCar = noop;
    this.onBuyUpgrade = noop;
    this.onBuyCarEarly = noop;
    this.onTestDriveCar = noop;
    this.onDoubleRewards = noop;
    this.onToggleGhost = noop;
    this.onTitleStart = noop;
    this.onTitleRoam = noop;
    this.onToggleStartGate = noop;
    this.onHubTabChange = noop;
    this.onGarageOrbit = noop;
    this.onGaragePreviewTime = noop;
    this.onGaragePreviewLights = noop;
    // Party callbacks are assigned by the game and always invoked with `?.`.
    this.onPartyCreate = null;
    this.onPartyJoin = null;
    this.onPartyLeave = null;
    this.onPartySelect = null;
    this.onPartyReady = null;
    this.onPartyStart = null;
    this.onPartyRematch = null;
    this.onPartyBack = null;
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
        <div class="sdh-speedfx" aria-hidden="true"></div>
        <section class="sdh-tl">
          <div class="sdh-mode"><span class="sdh-mode-label"></span><span class="sdh-lap"></span></div>
          <div class="sdh-main sdh-plate"><span class="sdh-plate-ind">IND</span><span class="sdh-plate-reg">UK 07</span><span class="sdh-plate-dot">·</span><span class="sdh-main-time sdh-num"></span></div>
          <div class="sdh-ghost-delta"><span class="sdh-k">GHOST</span><span class="sdh-ghost-delta-v sdh-num"></span></div>
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
          <div class="sdh-rotate" role="dialog" aria-label="Turn your phone">
            <span class="sdh-rotate-phone" aria-hidden="true"></span>
            <b>Turn your phone sideways</b>
            <span>Driving needs the width: steering on the left, pedals on the right.</span>
            <button type="button" class="sdh-btn" data-act="portrait-ok">Play in portrait</button>
          </div>
          <div class="sdh-howto" aria-hidden="true">
            <span class="sdh-help-keys"><kbd>W</kbd> gas</span>
            <span class="sdh-help-keys"><kbd>S</kbd> brake</span>
            <span class="sdh-help-keys"><kbd>A</kbd><kbd>D</kbd> steer</span>
            <span class="sdh-help-keys"><kbd>Space</kbd> drift</span>
            <span class="sdh-help-keys"><kbd>R</kbd> respawn</span>
            <span class="sdh-help-keys"><kbd>Esc</kbd> menu</span>
            <span class="sdh-help-touch">Arrows on the left steer · Gas and brake on the right · Pause top right</span>
          </div>
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
          <div class="sdh-drift-style" aria-live="polite"><span></span><em></em></div>
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
      ${hubHeaderMarkup(this.uid, CHAI_GLASS)}
      ${this.menuMarkup()}
      ${this.pauseMarkup()}
      <aside class="sdh-panel sdh-panel-finish" data-panel="finish" aria-label="Results">
        <div class="sdh-finish-body"></div>
        <footer class="sdh-panel-foot sdh-finish-foot">
          <button type="button" class="sdh-btn sdh-btn-bonus" data-act="double-rewards" hidden>${ICON.flame}<span>2× XP &amp; CR (Ad)</span></button>
          <button type="button" class="sdh-btn sdh-btn-primary" data-act="party-back" hidden>${ICON.party}<span>Back to party</span></button>
          <button type="button" class="sdh-btn sdh-btn-primary" data-act="finish-next" hidden>${ICON.play}<span>Next event</span></button>
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
      ${this.nameDialogMarkup()}
      <div class="sdh-loading" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-label="Loading">
        <canvas class="sdh-drift-bg" aria-hidden="true"></canvas>
        <canvas class="sdh-loading-canvas" aria-hidden="true"></canvas>
        <div class="sdh-loading-fx" aria-hidden="true">
          <div class="sdh-loading-vignette"></div>
        </div>
        <div class="sdh-loading-scrim" aria-hidden="true"></div>
        <div class="sdh-loading-inner">
          <div class="sdh-title-chips">
            <span class="sdh-title-chip is-map" data-title="mapBadge">MUSSOORIE</span>
            <span class="sdh-title-chip" data-title="carBadge">RALLY HATCH</span>
            <button type="button" class="sdh-title-chip is-goals" data-act="title-events" data-title="goals" hidden></button>
          </div>
          <div class="sdh-brand sdh-brand-xl"><span>SLOP DRIFT</span>${CHAI_GLASS}</div>
          <div class="sdh-loading-sub" data-title="mapSub">${MAP_SUBTITLES.mussoorie}</div>
          <div class="sdh-slogan-board sdh-loading-slogan"><span></span></div>
          <div class="sdh-loading-progress">
            <div class="sdh-loading-bar"><i></i></div>
            <div class="sdh-loading-meta"><span class="sdh-loading-label"></span><span class="sdh-loading-pct sdh-num"></span></div>
          </div>
          <div class="sdh-loading-help">
            <span class="sdh-help-keys"><kbd>W</kbd><kbd>S</kbd> gas / brake</span>
            <span class="sdh-help-keys"><kbd>A</kbd><kbd>D</kbd> steer</span>
            <span class="sdh-help-keys"><kbd>Space</kbd> handbrake drift</span>
            <span class="sdh-help-keys"><kbd>Esc</kbd> menu</span>
            <span class="sdh-help-touch">Arrows on the left steer · Gas, brake and drift on the right</span>
          </div>
          <div class="sdh-title-actions" hidden>
            <button type="button" class="sdh-btn sdh-btn-primary sdh-title-roam" data-act="title-roam">${ICON.play}<span>DRIVE</span><kbd>ENTER</kbd></button>
            <button type="button" class="sdh-btn sdh-title-start" data-act="title-start">${ICON.car}<span>GARAGE &amp; EVENTS</span><kbd>G</kbd></button>
            <button type="button" class="sdh-btn sdh-title-maps" data-act="title-maps">${ICON.map}<span>MAP</span><kbd>M</kbd></button>
          </div>
          <div class="sdh-loading-options">
            <span class="sdh-title-keyhint" data-title="readyHint" hidden>Free roam the mountain, or pick a race from Garage &amp; Events</span>
          </div>
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
      speedFast: new Flag(this.raceEl, 'is-fast'),
      ghostDeltaOn: new Flag(this.q('.sdh-ghost-delta'), 'is-on'),
      ghostDeltaAhead: new Flag(this.q('.sdh-ghost-delta'), 'is-ahead'),
      ghostDeltaBehind: new Flag(this.q('.sdh-ghost-delta'), 'is-behind'),
      ghostDeltaVal: new Text(this.q('.sdh-ghost-delta-v')),
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
      nitroOff: new Flag(this.q('.sdh-nitro'), 'is-off'),
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
    this.renderGarageShowcase();
  }

  /** A small drawing of a mode's road (from the minimap data) so event lists read as pictures. */
  routeThumb(mode) {
    const track = this.track;
    const roadId = track?.routeRoads?.[mode?.route];
    const road = track?.roads?.find((r) => r.id === roadId);
    if (!road || road.points.length < 4) return '';
    const key = `${mode.route}`;
    if (this.routeThumbs?.has(key)) return this.routeThumbs.get(key);
    const pts = road.points;
    let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      minX = Math.min(minX, pts[i]); maxX = Math.max(maxX, pts[i]);
      minZ = Math.min(minZ, pts[i + 1]); maxZ = Math.max(maxZ, pts[i + 1]);
    }
    const W = 64; const H = 40; const pad = 4;
    const k = Math.min((W - pad * 2) / Math.max(1, maxX - minX), (H - pad * 2) / Math.max(1, maxZ - minZ));
    const ox = (W - (maxX - minX) * k) / 2; const oz = (H - (maxZ - minZ) * k) / 2;
    const step = Math.max(2, Math.floor(pts.length / 2 / 80)) * 2; // ~80 points is plenty at this size
    const coords = [];
    for (let i = 0; i < pts.length; i += step) coords.push(`${(ox + (pts[i] - minX) * k).toFixed(1)},${(oz + (pts[i + 1] - minZ) * k).toFixed(1)}`);
    const svg = `<svg class="sdh-route-thumb" viewBox="0 0 ${W} ${H}" aria-hidden="true"><polyline points="${coords.join(' ')}${road.closed ? ` ${coords[0]}` : ''}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${coords[0].split(',')[0]}" cy="${coords[0].split(',')[1]}" r="3" fill="currentColor"/></svg>`;
    this.routeThumbs?.set(key, svg);
    return svg;
  }

  modeCardsMarkup() {
    return this.modes.map((mode, i) => `
      <button type="button" class="sdh-mode-card" data-mode="${esc(mode.id)}" style="--i:${i}">
        ${this.routeThumb(mode)}
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
    if (map?.id === 'apex') {
      const world = {config:map.config,routes:Object.fromEntries(routes.map(id=>[id,true]))};
      return modesForWorld(world).filter(mode => mode.laps > 0).length;
    }
    return MODES.filter((mode) => routes.includes(mode.route)).length;
  }

  menuMarkup() {
    const cards = this.modeCardsMarkup();
    return `
      <aside class="sdh-panel sdh-panel-menu" data-panel="menu" aria-label="Starting Hub">
        ${garageHubMarkup()}
        ${forzaMapHubMarkup()}
        <section class="sdh-hub-view sdh-events-view" data-hub-view="events" aria-label="Events and daily challenge" hidden>
          <div class="sdh-events-grid">
            <div class="sdh-events-left">
              <section class="sdh-daily" aria-label="Daily challenge">
                <div class="sdh-daily-info">
                  <div class="sdh-daily-top"><span class="sdh-eyebrow">Aaj ka challenge</span><span class="sdh-streak" title="Daily streak">${ICON.flame}<b class="sdh-num" data-d="streak">0</b></span></div>
                  <div class="sdh-daily-text" data-d="text">Loading today’s challenge…</div>
                  <div class="sdh-daily-meta"><span data-d="mode"></span><span class="sdh-daily-xp" data-d="xp"></span></div>
                  <ul class="sdh-contracts" data-d="contracts" aria-label="Daily contracts"></ul>
                </div>
                <button type="button" class="sdh-btn sdh-daily-go" data-act="daily">${ICON.play}<span data-d="btn">Start</span></button>
              </section>
              <section class="sdh-rivals" aria-label="Rivals" hidden>
                <div class="sdh-section-label">Rivals</div>
                <ul class="sdh-rival-list" data-rivals></ul>
              </section>
              <section class="sdh-quests" aria-label="Map adventures" hidden>
                <div class="sdh-quests-head"><span class="sdh-section-label" data-q="title">Map Adventures</span><em class="sdh-num" data-q="summary"></em></div>
                <ul class="sdh-quest-list" data-quests></ul>
              </section>
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
              <details class="sdh-players" open>
                <summary><i class="sdh-dot"></i><span data-p="playersTitle">Online players</span><span class="sdh-players-count sdh-num" data-p="playersCount"></span></summary>
                <ul class="sdh-players-list"></ul>
              </details>
            </div>
            <div class="sdh-events-right">
              <div class="sdh-events-board-head">
                <span class="sdh-eyebrow">Hill trials &amp; drift runs</span>
                <button type="button" class="sdh-subpill" data-act="hub-tab" data-hub-tab="map">${ICON.map}<span>OPEN WORLD MAP</span></button>
              </div>
              <div class="sdh-mode-list" role="list" aria-label="Events">${cards}</div>
            </div>
          </div>
        </section>
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
        <canvas class="sdh-overview sdh-overview-pause" aria-label="Map of the roads"></canvas>
      </aside>`;
  }

  settingsMarkup() {
    const name = (n) => `${this.uid}-${n}`;
    const hint = (text) => (text ? `<small class="sdh-field-hint">${text}</small>` : '');
    const seg = (key, label, options, help = '') => `
      <fieldset class="sdh-field">
        <legend>${label}</legend>${hint(help)}
        <div class="sdh-seg" style="--n:${options.length}">
          ${options.map((o) => `<label><input type="radio" name="${name(key)}" value="${esc(o.value)}"><span>${esc(o.label)}</span></label>`).join('')}
        </div>
      </fieldset>`;
    const slider = (key, label, help = '') => `
      <label class="sdh-field sdh-slider">
        <span class="sdh-field-head"><span>${label}</span><output class="sdh-num" data-out="${key}"></output></span>${hint(help)}
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
          <p class="sdh-settings-note">Changes apply straight away.</p>
          <div class="sdh-group-label">Driving</div>
          ${seg('handling', 'Handling assist', Object.keys(HANDLING_ASSISTS).map((k) => ({ value: k, label: cap(k) })), 'Controls wheelspin and helps the tyres hold your line while turning and braking.')}
          ${seg('transmission', 'Gears', [{ value: 'auto', label: 'Automatic' }, { value: 'manual', label: 'Manual' }], 'Manual: shift with Q and E.')}
          ${toggle('driftAssist', 'Drift assist', 'Helps catch slides. In the Rally Hatch and Tokyo Sedan, tap the handbrake and hold throttle to drift.')}
          ${toggle('abs', 'ABS', 'Stops the wheels locking when you brake hard')}
          ${seg('touchSteer', 'Touch steering', [{ value: 'arrows', label: 'Arrows' }, { value: 'slider', label: 'Slider' }], 'Phones and tablets. Slider steers gradually; arrows are easier.')}
          <div class="sdh-group-label">Graphics</div>
          ${toggle('motionBlur', 'Motion blur', 'Blur passing scenery at speed')}
          ${seg('quality', 'Quality', ['Auto', ...Object.keys(QUALITY_PRESETS)].map((k) => ({ value: k, label: k })), 'Auto lowers detail by itself if the game runs slowly.')}
          ${this.mapId === 'apex' ? '' : seg('timeOfDay', 'Time of day', TIME_OF_DAY.map((k) => ({ value: k, label: cap(k) })))}
          <div class="sdh-group-label">Sound &amp; display</div>
          ${slider('volume', 'Volume')}
          ${seg('units', 'Units', [{ value: 'kmh', label: 'km/h · m' }, { value: 'mph', label: 'mph · ft' }])}
          <fieldset class="sdh-field">
            <legend>Accent colour</legend>${hint('Buttons, highlights and HUD accents.')}
            <div class="sdh-accents">
              ${Object.entries(UI_ACCENTS).map(([k, c]) => `<label title="${cap(k)}"><input type="radio" name="${name('uiAccent')}" value="${k}"><span style="--c:${c}" aria-label="${cap(k)}"></span></label>`).join('')}
            </div>
          </fieldset>
          ${toggle('cameraShake', 'Camera shake', 'At speed and on impacts')}
          ${toggle('traffic', 'Traffic', 'Road traffic on Mussoorie, Alpine Peak, Tokyo and Hollow Creek')}
          ${toggle('startGate', 'Title screen', 'Show the Drive, Garage and Map buttons after loading')}
          <div class="sdh-group-label">Controls</div>
        <div class="sdh-legend sdh-legend-settings">
          <div class="sdh-legend-keys">
            <span><kbd>W</kbd><kbd>S</kbd> Throttle / brake</span>
            <span><kbd>A</kbd><kbd>D</kbd> Steer</span>
            <span><kbd>Space</kbd> Handbrake</span>
            <span><kbd>Shift</kbd> Nitro</span>
            <span><kbd>Q</kbd><kbd>E</kbd> Shift gear</span>
            <span><kbd>C</kbd> Camera · <kbd>B</kbd> Look back</span>
            <span><kbd>Left Alt</kbd> Toggle mouse look · Right-drag for a quick look</span>
            <span><kbd>H</kbd> Lights · <kbd>G</kbd> Neon</span>
            <span><kbd>R</kbd> Respawn</span>
            <span><kbd>Esc</kbd> Pause</span>
          </div>
          <div class="sdh-legend-touch">Left: steering arrows (or slider) · Right: gas, brake, drift, nitro</div>
          <div class="sdh-legend-pad">Gamepad: RT/LT pedals · A handbrake · B nitro · LB/RB shift</div>
        </div>
        </form>
        <footer class="sdh-panel-foot">
          <button type="button" class="sdh-btn" data-act="settings-reset"><span>Reset to defaults</span></button>
          <button type="button" class="sdh-btn sdh-btn-primary" data-act="settings-back">${ICON.check}<span>Done</span></button>
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
        case 'duel': this.onDuel(target.dataset.rival); break;
        case 'quest-start': this.onStartQuest(target.dataset.quest); break;
        case 'goto-map': this.onSelectMap?.(target.dataset.map); break;
        case 'ghost': this.onToggleGhost(); break;
        case 'race-ghost': this.onRaceGhost(); break;
        case 'finish-next': if (this.finishNextMode) this.onStart(this.finishNextMode); break;
        case 'title-start': this.onTitleStart('garage'); break;
        case 'title-maps': this.onTitleStart('map'); break;
        case 'title-events': this.onTitleStart('events'); break;
        case 'title-roam': this.onTitleRoam(); break;
        case 'portrait-ok': this.el.classList.add('is-portrait-ok'); break;
        case 'toggle-start-gate': {
          const next = !this.settings.startGate;
          this.setSettings({ ...this.settings, startGate: next });
          this.onToggleStartGate(next);
          break;
        }
        case 'hub-tab': this.setHubTab(target.dataset.hubTab); break;
        case 'hub-prev': this.stepHubTab(-1); break;
        case 'hub-next': this.stepHubTab(1); break;
        case 'garage-mode': this.setGarageMode(target.dataset.gmode); break;
        case 'garage-toggle-custom': this.setGarageMode(this.garageMode === 'customize' ? 'view' : 'customize'); break;
        case 'garage-time': this.onGaragePreviewTime(target.dataset.time); break;
        case 'garage-lights': {
          const on = Boolean(this.onGaragePreviewLights());
          this.headlightsOn = on;
          this.syncGarageLightsButton();
          break;
        }
        case 'garage-quick-drive': this.onStart('roam'); break;
        case 'goto-map': this.setHubTab('map'); break;
        case 'car-prev': this.stepCar(-1); break;
        case 'car-next': this.stepCar(1); break;
        case 'car-select': this.selectCarInGarage(target.dataset.car); break;
        case 'car-buy-early': this.onBuyCarEarly(this.selectedCarId()); break;
        case 'car-test-drive': this.onTestDriveCar(this.selectedCarId()); break;
        case 'buy-upgrade': this.onBuyUpgrade(this.selectedCarId(), target.dataset.slot); break;
        case 'double-rewards': this.onDoubleRewards(); break;
        case 'car-favorite': this.toggleFavorite(this.selectedCarId()); break;
        case 'car-card-fav': this.toggleFavorite(target.dataset.car); break;
        case 'car-sort': this.cycleCarSort(); break;
        case 'car-specs': this.toggleCarSpecs(); break;
        case 'forza-view': this.setForzaView(target.dataset.fview); break;
        case 'forza-select-mode': this.selectForzaMode(target.dataset.fmode); break;
        case 'forza-start': this.onStart(this.forzaModeId || 'sprint'); break;
        case 'forza-roam': this.onStart('roam'); break;
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
        case 'garage': this.setHubTab('garage'); break;
        case 'cosmetic':
          if (target.getAttribute('aria-disabled') !== 'true') this.onCosmetic(target.dataset.slot, target.dataset.value);
          break;
        case 'party': this.openParty(); break;
        case 'party-create': this.onPartyCreate?.(); break;
        case 'party-leave': this.onPartyLeave?.(); break;
        case 'party-copy': this.onPartyCopyLink?.(); break;
        case 'party-select': this.onPartySelect?.(target.dataset.id); break;
        case 'party-map': this.onPartySelect?.(null, target.dataset.map); break;
        case 'party-ready': this.onPartyReady?.(target.getAttribute('aria-pressed') !== 'true'); break;
        case 'party-start': this.onPartyStart?.(); break;
        case 'party-rematch': this.onPartyRematch?.(); break;
        case 'party-back':
          if (typeof this.onPartyBack === 'function') this.onPartyBack();
          else this.openParty();
          break;
        case 'party-results': if (this.partyResults) this.showPartyResults(this.partyResults, { force: true }); break;
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
        case 'settings-reset': this.changeSettings({ ...DEFAULT_SETTINGS, map: this.settings.map, paint: this.settings.paint }); break;
        default: break;
      }
    };
    this.el.addEventListener('click', this.onClick);

    this.form = this.q('.sdh-form');
    this.onFormInput = (event) => {
      if (event.target.type === 'range') this.renderSliderOutputs();
    };
    this.form.addEventListener('input', this.onFormInput);
    // Every change applies at once (sliders on release), so there is no Apply step to forget.
    this.form.addEventListener('change', () => this.changeSettings(this.readSettings()));
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

    // Drag to rotate 3D car inside the garage showcase window.
    const stage = this.q('[data-garage-stage]');
    if (stage) {
      let dragPointer = null;
      let prevX = 0;
      let prevY = 0;
      stage.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || !this.isGarageShowcaseActive()) return;
        dragPointer = e.pointerId;
        prevX = e.clientX;
        prevY = e.clientY;
        stage.classList.add('is-dragging');
        try { stage.setPointerCapture(e.pointerId); } catch {}
        this.onGarageOrbit(0, 0, true);
      });
      stage.addEventListener('pointermove', (e) => {
        if (e.pointerId !== dragPointer) return;
        const dx = e.clientX - prevX;
        const dy = e.clientY - prevY;
        prevX = e.clientX;
        prevY = e.clientY;
        this.onGarageOrbit(dx, dy, true);
      });
      const stopDrag = (e) => {
        if (e.pointerId !== dragPointer) return;
        dragPointer = null;
        stage.classList.remove('is-dragging');
        this.onGarageOrbit(0, 0, false);
      };
      stage.addEventListener('pointerup', stopDrag);
      stage.addEventListener('pointercancel', stopDrag);
      stage.addEventListener('lostpointercapture', stopDrag);
    }

    // Capture-phase so the game's Input never sees an Escape or hub shortcut that the overlays consumed.
    this.onKeyDown = (event) => {
      if (this.loadingActive && this.titleReady && !event.repeat && !this.dialogOpen) {
        if (event.key === 'Enter' && !event.target?.closest?.('button')) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.onTitleRoam();
          return;
        }
        if (event.code === 'KeyG') {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.onTitleStart('garage');
          return;
        }
        if (event.code === 'KeyM') {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.onTitleStart('map');
          return;
        }
        if (event.code === 'Space' && !event.target?.closest?.('button')) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.onTitleRoam();
          return;
        }
      }
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
      const inField = event.target?.tagName === 'INPUT' || event.target?.tagName === 'TEXTAREA' || event.target?.isContentEditable;
      if (this.screen === 'menu' && !this.dialogOpen && !this.loadingActive && !this.renaming && !inField && !event.metaKey && !event.ctrlKey) {
        if (!event.repeat && (event.code === 'KeyQ' || event.code === 'KeyE')) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.stepHubTab(event.code === 'KeyE' ? 1 : -1);
          return;
        }
        if (this.isGarageShowcaseActive()) {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            event.stopImmediatePropagation();
            this.stepCar(event.key === 'ArrowRight' ? 1 : -1);
            return;
          }
          if (!event.repeat && event.code === 'KeyC') {
            event.preventDefault();
            event.stopImmediatePropagation();
            this.toggleFavorite(this.selectedCarId());
            return;
          }
          if (!event.repeat && event.code === 'KeyX') {
            event.preventDefault();
            event.stopImmediatePropagation();
            this.cycleCarSort();
            return;
          }
          if (!event.repeat && event.code === 'KeyV') {
            event.preventDefault();
            event.stopImmediatePropagation();
            this.setGarageMode(this.garageMode === 'customize' ? 'view' : 'customize');
            return;
          }
          if (!event.repeat && event.key === 'Backspace') {
            event.preventDefault();
            event.stopImmediatePropagation();
            this.toggleCarSpecs();
            return;
          }
          if (!event.repeat && event.key === 'Enter' && !event.target?.closest?.('button')) {
            event.preventDefault();
            event.stopImmediatePropagation();
            this.setHubTab('map');
            return;
          }
        } else if (!this.sub && this.hubTab === 'map' && !event.repeat && event.key === 'Enter' && !event.target?.closest?.('button')) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (this.previewMapId !== this.mapId) this.onSelectMap?.(this.previewMapId);
          else this.onStart(this.forzaModeId || 'sprint');
          return;
        }
      }
      if ((this.screen === 'race' || this.screen === 'pause') && !this.sub && !this.dialogOpen && !inField && !event.repeat && event.key === 'Backspace') {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.onRestart();
        return;
      }
      if (this.screen === 'finish' && !this.sub && !this.dialogOpen && !inField && !event.repeat) {
        if (event.code === 'KeyR') {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.onRestart();
          return;
        }
        if (event.key === 'Enter' && !event.target?.closest?.('button')) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (this.finishNextMode) this.onStart(this.finishNextMode);
          else this.onRestart();
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
      else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && event.target.matches?.('.sdh-forza-region')) {
        const tabs = [...event.target.parentElement.querySelectorAll('.sdh-forza-region')];
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
      ? new ResizeObserver(() => {
        this.syncHubOffset();
        this.drawOverviews();
      }) : null;
    this.el.querySelectorAll('.sdh-overview').forEach((c) => this.overviewObserver?.observe(c));
    const hubTop = this.q('.sdh-hub-top');
    if (hubTop) this.overviewObserver?.observe(hubTop);

    this.onWindowResize = () => {
      this.syncHubOffset();
      this.drawOverviews();
    };
    window.addEventListener('resize', this.onWindowResize);
    window.visualViewport?.addEventListener('resize', this.onWindowResize);
  }

  syncHubOffset() {
    const hubTop = this.q('.sdh-hub-top');
    if (!hubTop || !this.el) return;
    const h = hubTop.offsetHeight;
    if (h > 0) this.el.style.setProperty('--hub-top-h', `${h}px`);
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
    const activeTab = this.sub && this.screen === 'menu' ? this.sub : this.hubTab;
    this.el.dataset.screen = this.screen;
    if (this.screen !== 'race') this.showHowTo(false); // only while driving
    this.el.dataset.hubTab = activeTab;
    this.el.classList.toggle('is-settings', Boolean(this.sub));
    this.el.classList.toggle('is-3d-stage', this.stageMode === '3d');
    const hubTop = this.q('.sdh-hub-top');
    const hubOpen = this.screen === 'menu';
    if (hubTop) {
      hubTop.toggleAttribute('inert', !hubOpen || this.dialogOpen || this.loadingActive);
      hubTop.setAttribute('aria-hidden', String(!hubOpen));
      if (hubOpen) this.syncHubOffset();
    }
    this.renderHubChrome(activeTab);
    this.renderHubViews();

    const panel = this.openPanel();
    this.el.querySelectorAll('.sdh-panel').forEach((p) => {
      const open = p === panel;
      p.classList.toggle('is-open', open);
      p.classList.toggle('is-hub-docked', open && this.screen === 'menu' && p !== this.q('[data-panel="menu"]'));
      p.toggleAttribute('inert', !open);
      p.setAttribute('aria-hidden', String(!open));
    });
    const racing = this.screen === 'race' || this.screen === 'pause';
    this.raceEl.toggleAttribute('inert', this.screen !== 'race');
    this.el.classList.toggle('is-racing', racing);
    this.currentPanel = panel;
    // The flyover only runs while the Forza map drone preview is visible.
    if (this.screen === 'menu' && !this.sub && this.hubTab === 'map' && (this.forzaView === 'drone' || this.previewMapId !== this.mapId)) {
      this.playMapClip();
    } else {
      this.pauseMapClip();
    }
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
      const target = ['[aria-selected="true"]', '.sdh-btn-primary:not([hidden])', '.sdh-car-card.is-selected', '.sdh-mode-card', '.sdh-cos:not(.is-locked)', 'input:not([type="hidden"]):not(:disabled)', 'button:not([hidden])']
        .reduce((found, sel) => found || panel.querySelector(sel), null);
      const active = document.activeElement;
      if (target && (!active || active === document.body || this.el.contains(active))) {
        target.focus({ preventScroll: true });
      }
    }
    if (panel && panel.querySelector('.sdh-overview')) this.drawOverviews();
  }

  setStageMode(mode) {
    this.stageMode = mode === '3d' ? '3d' : 'image';
    this.el?.classList.toggle('is-3d-stage', this.stageMode === '3d');
  }

  isGarageShowcaseActive() {
    return this.screen === 'menu' && !this.sub && this.hubTab === 'garage' && !this.loadingActive;
  }

  setHubTab(tab) {
    const id = HUB_TABS.some((t) => t.id === tab) ? tab : 'garage';
    if (id !== 'garage' && this.garage) {
      this.previewCarId = this.garage.trialCar || this.garage.selected?.car || 'hatch';
    }
    if (['party', 'leaderboard', 'achievements', 'settings'].includes(id)) {
      this.screen = 'menu';
      this.onHubTabChange(id);
      if (id === 'party') { this.openParty(); return; }
      if (id === 'leaderboard') {
        const modeId = this.lbMode || this.rankedModes()[0]?.id;
        this.openLeaderboard(modeId, 'menu');
        this.onOpenLeaderboard(modeId);
        return;
      }
      if (id === 'achievements') { this.openSub('achievements', 'menu'); return; }
      this.openSettings('menu');
      this.onOpenSettings('menu');
      return;
    }
    this.screen = 'menu';
    this.sub = null;
    this.hubTab = id;
    this.lastMainTab = id;
    this.applyScreen(false);
    if (id === 'map') {
      this.renderForzaMap();
      this.drawOverviews();
    } else if (id === 'garage') {
      this.renderGarageShowcase();
    }
    this.onHubTabChange(id);
  }

  stepHubTab(delta) {
    const current = this.sub && this.screen === 'menu' ? this.sub : this.hubTab;
    const idx = Math.max(0, HUB_TABS.findIndex((t) => t.id === current));
    const next = HUB_TABS[(idx + delta + HUB_TABS.length) % HUB_TABS.length];
    if (next) this.setHubTab(next.id);
  }

  renderHubChrome(activeTab) {
    const tabMeta = HUB_TABS.find((t) => t.id === activeTab) || HUB_TABS[0];
    const crumb = this.q('[data-hub="crumb"]');
    const heading = this.q('[data-hub="heading"]');
    if (crumb) crumb.textContent = tabMeta.crumb;
    if (heading) {
      heading.textContent = activeTab === 'garage' && this.garageMode === 'customize'
        ? 'GARAGE - SKINS & CUSTOMIZE'
        : tabMeta.heading;
    }
    for (const btn of this.el.querySelectorAll('.sdh-hub-tab')) {
      const on = btn.dataset.hubTab === activeTab;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', String(on));
      if (on && this.screen === 'menu') btn.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
    }
  }

  renderHubViews() {
    for (const view of this.el.querySelectorAll('[data-hub-view]')) {
      view.hidden = view.dataset.hubView !== this.hubTab;
    }
  }

  showMenu() {
    this.finishFresh = false;
    this.screen = 'menu';
    this.sub = null;
    if (!['garage', 'map', 'events'].includes(this.hubTab)) this.hubTab = this.lastMainTab || 'garage';
    // Coming back from a run, the picker shows the map you are actually driving.
    if (this.previewMapId !== this.mapId) {
      this.previewMapId = this.mapId;
      this.renderMapStage();
    }
    this.applyScreen();
  }

  /** Daily, contracts and the next rival: counted on the Events tab and title screen, listed on Map & Drive. */
  renderChallenges() {
    const d = this.daily;
    const contracts = (d?.contracts || []).filter((c) => !c.done);
    const rival = this.rivals.find((r) => r.state === 'open');
    const count = (d && !d.done ? 1 : 0) + contracts.length + (rival ? 1 : 0);
    const badge = this.q('[data-tab-count="events"]');
    if (badge) {
      badge.hidden = count === 0;
      badge.textContent = String(count);
    }
    const chip = this.q('[data-title="goals"]');
    if (chip) {
      chip.hidden = count === 0;
      chip.textContent = `${count} challenge${count === 1 ? '' : 's'}`;
    }
    const goals = this.q('[data-forza="goals"]');
    if (!goals) return;
    const rows = [];
    if (d && !d.done) rows.push(`<button type="button" class="sdh-goal" data-act="daily">${ICON.flame}<span><small>Daily</small><b>${esc(d.text)}</b></span><em class="sdh-num">+${formatInt(d.xp)} XP</em></button>`);
    if (rival) rows.push(`<button type="button" class="sdh-goal is-rival" data-act="duel" data-rival="${esc(rival.id)}">${ICON.play}<span><small>${esc(rival.tierLabel)} rival</small><b>${esc(rival.name)} · ${esc(rival.modeLabel)}</b></span><em class="sdh-num">+${formatInt(rival.credits)} CR</em></button>`);
    if (contracts.length) rows.push(`<button type="button" class="sdh-goal" data-act="hub-tab" data-hub-tab="events">${ICON.check}<span><small>Contracts</small><b>${contracts.map((c) => `${esc(c.text)} ${formatContract(c.progress)}/${formatContract(c.goal)}`).join(' · ')}</b></span></button>`);
    goals.innerHTML = rows.length ? `<span class="sdh-section-label">Challenges</span>${rows.join('')}` : '';
    goals.dataset.empty = rows.length ? '' : '1';
    goals.hidden = !rows.length || this.previewMapId !== this.mapId;
  }

  /** The controls card on a new player's first drives (Game decides when). */
  showHowTo(on) {
    this.q('.sdh-howto')?.classList.toggle('is-on', Boolean(on));
  }

  showRace() {
    if (this.loadingActive) this.hideLoading();
    this.finishFresh = false;
    this.screen = 'race';
    this.sub = null;
    if (this.renaming) this.endRename(false);
    this.applyScreen();
  }

  showPause(copyText = '') {
    this.screen = 'pause';
    this.sub = null;
    const calm = this.mapId === 'tokyo' ? 'The city stays lit. Your line is waiting.' : 'Take a breath. The mountain will wait.';
    this.q('.sdh-pause-copy').textContent = copyText || calm;
    this.q('.sdh-pause-mode').textContent = this.v.modeLabel.raw || '';
    this.applyScreen();
  }

  /**
   * @param {{modeId:string, modeLabel?:string, time?:number, bestTime?:number, isRecord?:boolean, score?:number,
   *          bestScore?:number, topSpeedKmh?:number, respawns?:number, laps?:number[]}} result
   */
  showFinish(result = {}, rewards = null, options = {}) {
    const inParty = Boolean(options?.inParty);
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
          <div class="sdh-eyebrow">${esc(MAPS[this.mapId]?.label || 'Mussoorie')} → ${esc(label)}</div>
          <h2 class="sdh-title">${kind === 'score' ? 'Time’s up' : 'Finished'}</h2>
          ${result.isRecord ? '<div class="sdh-record-badge">NEW RECORD</div>' : ''}
        </header>
        <div class="sdh-stamp sdh-result-stamp ${stamp.cls}" lang="${stamp.lang}">${stamp.text}</div>
        ${hero}${compare}
        ${stats.length ? `<dl class="sdh-stats">${stats.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd class="sdh-num">${esc(v)}</dd></div>`).join('')}</dl>` : ''}
        ${this.rewardsMarkup(rewards, result.modeId)}
        ${this.upNextMarkup(rewards?.upNext)}
        ${lapRows}
        <div class="sdh-ticket-foot">Valid for one descent only · Keep left · Use horn on blind bends</div>
      </div>
      <div class="sdh-ticket-chai">${CHAI_GLASS}</div>`;
    this.finishModeId = result.modeId;
    // "Next event" leads when there is one, so the next goal is a single click away.
    this.finishNextMode = inParty ? null : (rewards?.upNext?.modeId || null);
    const partyBtn = this.q('[data-panel="finish"] [data-act="party-back"]');
    if (partyBtn) partyBtn.hidden = !inParty;
    const next = this.q('[data-act="finish-next"]');
    next.hidden = !this.finishNextMode;
    next.querySelector('span').textContent = this.finishNextMode ? `Next: ${rewards.upNext.modeLabel}` : 'Next event';
    const restartBtn = this.q('[data-panel="finish"] [data-act="restart"]');
    if (restartBtn) {
      restartBtn.hidden = inParty;
      restartBtn.classList.toggle('sdh-btn-primary', !this.finishNextMode && !inParty);
    }
    this.q('[data-act="race-ghost"]').hidden = kind === 'none';
    this.q('[data-act="finish-leaderboard"]').hidden = kind === 'none';
    const dbl = this.q('[data-act="double-rewards"]');
    if (dbl) {
      const canDouble = Boolean(this.profile?.adDoubleReady && rewards && (rewards.xpGained > 0 || rewards.creditsGained > 0));
      dbl.hidden = !canDouble;
      dbl.disabled = false;
    }
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
    if (this.loadingActive) this.hideLoading();
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
    const keep = room.contains(active) ? (active.dataset.act ? `[data-act="${active.dataset.act}"]${active.dataset.id ? `[data-id="${CSS.escape(active.dataset.id)}"]` : active.dataset.map ? `[data-map="${CSS.escape(active.dataset.map)}"]` : ''}` : null) : null;

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
    const maps = Array.isArray(v.maps) ? v.maps : [];
    const canPick = Boolean(v.isHost) && (status === 'lobby' || status === 'results');
    const mapBlock = canPick && maps.length > 1 && status !== 'error' && status !== 'closed' && status !== 'connecting' ? `
      <div class="sdh-section-label">Map</div>
      <div class="sdh-party-modes" role="group" aria-label="Choose the map">${maps.map((m) => `
        <button type="button" class="sdh-party-mode" data-act="party-map" data-map="${esc(m.id)}" aria-pressed="${m.id === v.mapId}">${esc(m.label)}</button>`).join('')}</div>` : '';
    const modeBlock = status === 'error' || status === 'closed' || status === 'connecting' ? '' : `
      ${mapBlock}
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
          <span class="sdh-pm-name">${col ? `<i class="sdh-pm-paint" style="background:${col}"></i>` : ''}<span class="sdh-pm-text">${esc(m.name)}</span>${m.carLabel ? `<span class="sdh-pm-car">${esc(m.carLabel)}</span>` : ''}${m.isHost ? `<span class="sdh-pm-host" title="Host">${ICON.host}<span class="sdh-sr">Host</span></span>` : ''}${m.isYou ? '<span class="sdh-pm-you">YOU</span>' : ''}</span>
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
    const kept = keep ? room.querySelector(keep) : null;
    if (kept) kept.focus({ preventScroll: true });
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
  showPartyResults(r, options = {}) {
    const force = Boolean(options?.force);
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
    if (!force && this.screen === 'menu' && this.sub !== 'party') {
      this.toast('Party results are in. Open Race with friends to view them.', 'good');
      return;
    }
    this.screen = 'party-results';
    this.sub = null;
    this.currentPanel = null;
    this.applyScreen();
    this.q('[data-panel="party-results"]').scrollTop = 0;
  }

  /** Update host-only Rematch button state when host migrates while viewing results. */
  setPartyResultsHost(isHost) {
    if (this.partyResults) this.partyResults = { ...this.partyResults, isHost: Boolean(isHost) };
    const btn = this.q('[data-act="party-rematch"]');
    if (btn) btn.hidden = !isHost;
    this.renderParty();
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

  /** Apply and save settings from the panel without closing it. */
  changeSettings(next) {
    this.setSettings(next);
    this.onSettingsChange(this.settings);
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
    for (const key of ['quality', 'timeOfDay', 'handling', 'transmission', 'units', 'touchSteer', 'uiAccent']) {
      const group = n(key);
      if (group) group.value = String(s[key]);
    }
    n('driftAssist').checked = s.driftAssist;
    n('volume').value = String(Math.round(s.volume * 100));
    n('abs').checked = s.abs;
    n('motionBlur').checked = s.motionBlur;
    n('cameraShake').checked = s.cameraShake;
    n('traffic').checked = s.traffic;
    const gateEl = n('startGate');
    if (gateEl) gateEl.checked = s.startGate;
    this.el?.style.setProperty('--marigold', UI_ACCENTS[s.uiAccent]);
    this.syncStartGateUi();
    this.syncLightingPills();
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
    for (const key of ['quality', 'timeOfDay', 'handling', 'transmission', 'units', 'touchSteer', 'uiAccent']) {
      const v = n(key)?.value;
      if (v) out[key] = v;
    }
    out.driftAssist = n('driftAssist').checked;
    out.volume = Number(n('volume').value) / 100;
    out.abs = n('abs').checked;
    out.motionBlur = n('motionBlur').checked;
    out.cameraShake = n('cameraShake').checked;
    out.traffic = n('traffic').checked;
    const gateEl = n('startGate');
    if (gateEl) out.startGate = gateEl.checked;
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
    if (!this.modes.some((m) => m.id === this.forzaModeId)) this.forzaModeId = this.modes[0]?.id || 'sprint';
    this.renderCards();
    this.renderForzaMap();
  }

  /** @param {Object<string, {medal:(string|null), next:({tier:string,target:number}|null)}>} medals */
  setMedals(medals) {
    this.medals = medals || {};
    this.renderCards();
    this.renderForzaMap();
    const total = Object.values(this.medals).filter((m) => m?.medal).length;
    const badge = this.q('[data-hub="medalCount"]');
    if (badge) badge.textContent = String(total);
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
    this.routeThumbs = new Map();
    if (this.modes?.length) this.setModes(this.modes); // event cards gain their route pictures
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
    this.loadingActive = true;
    this.titleReady = false;
    el.classList.add('is-on');
    el.classList.remove('is-hiding', 'is-title-ready');
    const actions = this.q('.sdh-title-actions');
    const hint = this.q('[data-title="readyHint"]');
    if (actions) actions.hidden = true;
    if (hint) hint.hidden = true;
    const p = Math.max(0, Math.min(1, Number(progress01) || 0));
    const key = Math.round(p * 1000);
    this.v.loadingBar.setKey(key, (k) => `scaleX(${k / 1000})`);
    this.v.loadingPct.setKey(Math.round(p * 100), (k) => `${k}%`);
    el.setAttribute('aria-valuenow', String(Math.round(p * 100)));
    if (typeof Worker !== 'undefined' || typeof requestAnimationFrame !== 'undefined') {
      this.driftBg ??= new DriftBackground(this.q('.sdh-drift-bg'));
      this.driftBg.start();
    }
    if (label) this.v.loadingLabel.set(String(label));
    this.syncStartGateUi();
    this.syncTitleBadges();
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

  /** Forza-style Ready Gate: keeps the scenic title screen open with Start / Map / Free Roam actions. */
  showTitleReady() {
    this.showLoading(1, 'Ready to drive');
    this.titleReady = true;
    const el = this.q('.sdh-loading');
    el.classList.add('is-title-ready');
    const actions = this.q('.sdh-title-actions');
    const hint = this.q('[data-title="readyHint"]');
    if (actions) actions.hidden = false;
    if (hint) hint.hidden = false;
    this.q('.sdh-hub-top')?.setAttribute('inert', '');
    this.q('.sdh-title-roam')?.focus({ preventScroll: true });
    // The 3D showcase (TitleFx, startTitleMedia) is not started: as a second WebGL renderer it halved
    // the frame rate and opened on a washed-out haze; the painted backdrop and road animation stay instead.
  }

  hideLoading() {
    const el = this.q('.sdh-loading');
    this.loadingActive = false;
    this.titleReady = false;
    el.classList.remove('is-title-ready');
    if (this.screen === 'menu' && !this.dialogOpen) {
      this.q('.sdh-hub-top')?.removeAttribute('inert');
    }
    if (!el.classList.contains('is-on') || this.loadingHideTimer) {
      this.stopTitleMedia(true);
      this.driftBg?.stop();
      return;
    }
    el.classList.add('is-hiding');
    clearInterval(this.loadingSloganTimer);
    this.loadingSloganTimer = null;
    this.loadingHideTimer = this.later(() => {
      this.stopTitleMedia(true);
      this.driftBg?.stop();
      el.classList.remove('is-on', 'is-hiding');
      this.loadingHideTimer = null;
    }, this.reducedMotion?.matches ? 0 : 600);
  }

  initTitleFx() {
    this.titleFx = null;
  }

  startTitleMedia() {
    if (this.reducedMotion?.matches) return;
  }

  resolveTitleCosmetics() {
    const g = this.garage;
    if (!g?.items?.length) return null;
    const sel = g.selected || {};
    const find = (slot, val) => g.items.find((it) => it.slot === slot && it.value === val);
    const paint = find('paint', sel.paint);
    const rim = find('rim', sel.rim);
    const neon = find('neon', sel.neon);
    return {
      paint: paint?.color !== undefined ? { color: paint.color } : null,
      rimColor: rim?.color,
      neon: neon ? { color: neon.color, cycle: neon.value === 'rainbow' } : null,
      number: sel.number || '27',
    };
  }

  stopTitleMedia() {}

  syncStartGateUi() {
    const btn = this.q('[data-act="toggle-start-gate"]');
    const state = this.q('[data-title="gateState"]');
    const on = Boolean(this.settings?.startGate);
    if (btn) btn.setAttribute('aria-pressed', String(on));
    if (state) state.textContent = on ? 'ON' : 'OFF';
  }

  syncTitleBadges() {
    const map = MAPS[this.mapId];
    const mapBadge = this.q('[data-title="mapBadge"]');
    if (mapBadge && map) mapBadge.textContent = `${map.label.toUpperCase()} · ${this.eventCount(map)} EVENTS`;
    const mapSub = this.q('[data-title="mapSub"]');
    if (mapSub) mapSub.innerHTML = mapSubtitleMarkup(this.mapId, map);
    const teleLoc = this.q('[data-title="teleLoc"]');
    if (teleLoc && map) teleLoc.textContent = `${map.label.toUpperCase()} PASS`;
    const car = getCar(this.selectedCarId());
    const carBadge = this.q('[data-title="carBadge"]');
    if (carBadge && car) carBadge.textContent = car.label.toUpperCase();
    const teleDrive = this.q('[data-title="teleDrive"]');
    if (teleDrive && car) teleDrive.textContent = car.drivetrain || 'RWD';
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
        <div class="sdh-awards"></div>
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
    const crGain = Number(r.creditsGained) || 0;
    const xp = `
      <div class="sdh-xp-block${after.level > before.level ? ' has-levelup' : ''}">
        <div class="sdh-xp-head">
          <span class="sdh-lv-badge sdh-num" data-x="lv">${before.level}</span>
          <span class="sdh-levelup">LEVEL UP</span>
          <span class="sdh-cr-total sdh-num" data-r="cr">+${formatInt(crGain)} CR</span>
          <span class="sdh-xp-total sdh-num" data-r="xp">+${formatInt(r.xpGained)} XP</span>
        </div>
        <div class="sdh-xp sdh-xp-lg"><i style="transform:scaleX(${Math.max(0, Math.min(1, before.fraction || 0))})"></i></div>
        ${lines ? `<ul class="sdh-xp-lines">${lines}</ul>` : ''}
      </div>`;
    const newMap = (r.unlocks || []).find((u) => u.slot === 'map');
    const mapUnlock = newMap ? `
      <div class="sdh-map-unlock">
        <span><small>New map unlocked</small><b>${esc(MAPS[newMap.id.slice(4)]?.label || newMap.label)}</b></span>
        <button type="button" class="sdh-btn sdh-btn-primary" data-act="goto-map" data-map="${esc(newMap.id.slice(4))}">${ICON.play}<span>Drive it</span></button>
      </div>` : '';
    const unlocks = (r.unlocks || []).length ? `
      <div class="sdh-section-label">Unlocked</div>
      <div class="sdh-chips">${r.unlocks.slice(0, 4).map((u) => `<span class="sdh-chip is-unlock">${ICON.car}${esc(u.label)}</span>`).join('')}${r.unlocks.length > 4 ? `<span class="sdh-chip">+${r.unlocks.length - 4} more</span>` : ''}</div>` : '';
    const ach = (r.achievements || []).length ? `
      <div class="sdh-section-label">Achievements</div>
      <ul class="sdh-ach-list sdh-ach-compact">${r.achievements.map((a) => `
        <li class="is-unlocked"><span class="sdh-ach-icon">${ICON.medal}</span><span class="sdh-ach-main"><b>${esc(a.title)}</b><small>${esc(a.description)}</small></span><span class="sdh-ach-xp sdh-num">+${formatInt(a.xp)}</span></li>`).join('')}
      </ul>` : '';
    const rv = r.rival;
    const rival = rv ? `
      <div class="sdh-rival-result ${rv.won ? 'is-won' : 'is-lost'}">
        <span><b>${rv.won ? `You beat ${esc(rv.name)}` : `${esc(rv.name)} wins`}</b><small>${rv.won ? `by ${Math.abs(rv.gap).toFixed(2)} s` : `You were ${rv.gap.toFixed(2)} s behind`}${rv.first ? ` · bounty +${formatInt(rv.xp)} XP +${formatInt(rv.credits)} CR` : ''}${rv.won && rv.next ? ` · next: ${esc(rv.next.name)} (${esc(rv.next.tierLabel)})` : ''}</small></span>
      </div>` : '';
    const m = r.mastery;
    const mastery = m ? `
      <div class="sdh-mastery-row"><span><b>${esc(m.label)} mastery</b><small>${m.next ? `${formatInt(m.xp)} / ${formatInt(m.next)} XP to the next star` : 'Fully mastered'}</small></span>${masteryMarkup(m.stars)}${m.newStars ? '<span class="sdh-new">NEW STAR</span>' : ''}</div>` : '';
    const daily = r.daily && r.daily.completed ? `
      <div class="sdh-daily-done">${ICON.check}<span>Daily challenge complete</span><span class="sdh-streak">${ICON.flame}<b class="sdh-num">${r.daily.streak}</b></span></div>` : '';
    return `<section class="sdh-rewards">${mapUnlock}${rival}${medal}${xp}${mastery}${daily}${unlocks}${ach}</section>`;
  }

  /** Results screen: the daily challenge or streak and the closest unlock, so there is a reason to come back. */
  upNextMarkup(up) {
    if (!up) return '';
    const rows = [];
    const row = (icon, title, detail, act = '') => rows.push(act
      ? `<li><button type="button" class="sdh-upnext-row" data-act="${act}">${icon}<span><b>${title}</b><small>${detail}</small></span></button></li>`
      : `<li><div class="sdh-upnext-row">${icon}<span><b>${title}</b><small>${detail}</small></span></div></li>`);
    if (up.nextMap) row(ICON.lock, `Next map: ${esc(up.nextMap.label)}`, `Level ${up.nextMap.level} · ${formatInt(up.nextMap.xpToGo)} XP to go`);
    const daily = up.daily;
    if (daily && !daily.done) row(ICON.flame, 'Daily challenge', `${esc(daily.text)} · +${formatInt(daily.xp)} XP`, 'daily');
    else if (daily?.done) row(ICON.flame, `${daily.streak}-day streak`, 'Back tomorrow');
    const contract = (daily?.contracts || []).find((c) => !c.done);
    if (contract) row(ICON.check, esc(contract.text), `${formatContract(contract.progress)} / ${formatContract(contract.goal)}`);
    if (!up.nextMap && up.unlock) row(ICON.lock, `Next: ${esc(up.unlock.label)}`, `Level ${up.unlock.level} · ${formatInt(up.unlock.xpToGo)} XP to go`);
    // Two rows at most: the next map and today's goal.
    return rows.length ? `<div class="sdh-section-label">Up next</div><ul class="sdh-upnext">${rows.slice(0, 2).join('')}</ul>` : '';
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
    if (name === 'garage') {
      this.setHubTab('garage');
      return;
    }
    if (name === 'settings') {
      this.openSettings(source === 'pause' ? 'pause' : 'menu');
      return;
    }
    this.subSource = source;
    const sameSub = this.sub === name;
    this.sub = name;
    this.applyScreen(!sameSub);
  }

  closeSub() {
    const was = this.sub;
    if (!was) return;
    if (was === 'settings') {
      this.closeSettingsFromUi(false);
      return;
    }
    this.sub = null;
    if (this.screen === 'menu') {
      this.hubTab = this.lastMainTab || 'garage';
      this.applyScreen(false);
      return;
    }
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
    const hubMap = this.q('[data-hub="mapName"]');
    if (hubMap && MAPS[mapId]) hubMap.textContent = MAPS[mapId].label.toUpperCase();
    this.syncTitleBadges();
    this.renderMapStage();
    if (this.lbMode) this.renderLeaderboard();
  }

  /** Show a map in the Forza map explorer without leaving the current world. */
  previewMap(mapId) {
    if (!MAPS[mapId] || this.previewMapId === mapId) return;
    this.previewMapId = mapId;
    this.renderMapStage();
    this.renderGarageShowcase();
  }

  setForzaView(view) {
    this.forzaView = view === 'drone' ? 'drone' : 'map';
    this.renderForzaMap();
    if (this.screen === 'menu' && !this.sub && this.hubTab === 'map' && (this.forzaView === 'drone' || this.previewMapId !== this.mapId)) {
      this.playMapClip();
    } else {
      this.pauseMapClip();
    }
    if (this.forzaView === 'map') this.drawOverviews();
  }

  selectForzaMode(modeId) {
    if (!this.modes.some((m) => m.id === modeId)) return;
    this.forzaModeId = modeId;
    const mode = getMode(modeId);
    const wantedIndex = this.track?.routeRoads?.[mode.route] ?? 0;
    const road = this.track?.roads?.[wantedIndex] || this.track?.roads?.[0];
    if (road && this.previewMapId === this.mapId) {
      this.setActiveRoad(road.id);
    }
    this.renderForzaMap();
  }

  /** Paint the Forza-style Mountain Map & Event Chooser stage. */
  renderMapStage() {
    this.renderForzaMap();
  }

  renderForzaMap() {
    const map = MAPS[this.previewMapId] || MAPS[this.mapId];
    if (!map || !this.el) return;
    const here = map.id === this.mapId;
    const goalsEl = this.q('[data-forza="goals"]');
    if (goalsEl) goalsEl.hidden = !here || goalsEl.dataset.empty === '1' || !goalsEl.innerHTML;
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
      shot.alt = map.previewAlt || `${map.label} from above`;
    }
    // The still is the poster and the fallback; the flyover fades in over it once it can play.
    const clip = this.q('.sdh-map-clip');
    if (clip) {
      if (map.preview) clip.setAttribute('poster', map.preview);
      else clip.removeAttribute('poster');
      if (map.clip && !this.reducedMotion?.matches && this.screen === 'menu' && !this.sub && this.hubTab === 'map' && (this.forzaView === 'drone' || !here)) {
        this.playMapClip();
      } else {
        this.pauseMapClip();
        clip.classList.remove('is-on');
      }
    }
    const status = this.q('.sdh-map-stage-status');
    if (status) {
      status.textContent = here ? 'ACTIVE REGION' : 'REMOTE PREVIEW';
      status.classList.toggle('is-here', here);
    }
    const nameEl = this.q('.sdh-map-stage-name');
    if (nameEl) nameEl.textContent = map.label;
    const tagEl = this.q('.sdh-map-stage-tag');
    if (tagEl) tagEl.textContent = map.tagline || '';
    const chipsEl = this.q('.sdh-map-stage-chips');
    if (chipsEl) {
      chipsEl.innerHTML = [
        `<li class="sdh-map-chip is-count">${this.eventCount(map)} events</li>`,
        ...(map.highlights || []).map((text) => `<li class="sdh-map-chip">${esc(text)}</li>`),
      ].join('');
    }
    let lockedMaps = 0;
    for (const tab of this.el.querySelectorAll('.sdh-forza-region')) {
      const id = tab.dataset.map;
      const mapState = this.garage?.maps?.[id];
      const mapUnlocked = mapState ? mapState.unlocked : true;
      const mapLv = mapState?.level || MAP_UNLOCKS[id]?.level || 1;
      // Grid order: the map you are on, other open maps, the "Locked" heading, then locked maps by level.
      const open = mapUnlocked || id === this.mapId;
      tab.style.order = id === this.mapId ? '1' : open ? '2' : String(100 + mapLv);
      if (!open) lockedMaps += 1;
      const on = id === map.id;
      tab.setAttribute('aria-pressed', String(on));
      tab.classList.toggle('is-current', on);
      tab.classList.toggle('is-locked', !mapUnlocked && id !== this.mapId);
      if (on && this.hubTab === 'map') tab.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
      const badge = tab.querySelector('[data-fmap-badge]');
      if (badge) {
        const isLoaded = id === this.mapId;
        badge.textContent = isLoaded ? 'DRIVING' : !mapUnlocked ? `LV ${mapLv}` : `${this.eventCount(MAPS[id])} EVENTS`;
        badge.classList.toggle('is-loaded', isLoaded);
        badge.classList.toggle('is-locked', !isLoaded && !mapUnlocked);
        if (!isLoaded && !mapUnlocked) badge.innerHTML = `${ICON.lock}LV ${mapLv}`;
      }
    }
    const lockedHead = this.q('.sdh-region-group[data-group="locked"]');
    if (lockedHead) lockedHead.hidden = lockedMaps === 0;

    // View toggle: vector road map is available for the currently loaded mountain.
    const showDrone = !here || this.forzaView === 'drone';
    const canvasWrap = this.q('.sdh-overview-forza');
    const pinsEl = this.q('[data-forza="pins"]');
    const droneEl = this.q('.sdh-forza-drone');
    if (canvasWrap) canvasWrap.hidden = showDrone;
    if (pinsEl) pinsEl.hidden = showDrone;
    if (droneEl) droneEl.hidden = !showDrone;
    for (const btn of this.el.querySelectorAll('[data-act="forza-view"]')) {
      const fview = btn.dataset.fview;
      btn.disabled = !here && fview === 'map';
      btn.classList.toggle('is-on', showDrone ? fview === 'drone' : fview === 'map');
    }
    if (!showDrone) {
      this.syncHubOffset();
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => this.drawOverviews());
      else this.drawOverviews();
    }

    // Active car reminder pill.
    const car = getCar(this.selectedCarId());
    const carPill = this.q('[data-forza="activeCar"]');
    if (carPill && car) carPill.textContent = `${car.label.toUpperCase()} · ${car.classCode || ''}`;

    // Selectable events on the previewed map.
    const mapModes = here && this.modes.length
      ? this.modes
      : modesForWorld({config:map.config,routes:Object.fromEntries((map.routes||[]).map(id=>[id,true]))});
    if (here && !mapModes.some((m) => m.id === this.forzaModeId)) {
      this.forzaModeId = mapModes[0]?.id || 'sprint';
    }
    if (pinsEl && here) {
      pinsEl.innerHTML = mapModes.map((m) => {
        const cat = eventCategoryBadge(m);
        const active = m.id === this.forzaModeId;
        return `
          <button type="button" class="sdh-forza-pin ${cat.cls}${active ? ' is-selected' : ''}" data-act="forza-select-mode" data-fmode="${esc(m.id)}" aria-pressed="${active}">
            <span class="sdh-pin-dot"></span><span>${esc(m.tab || m.label)}</span>
          </button>`;
      }).join('');
    }
    const eventsEl = this.q('[data-forza="events"]');
    const eventsTitle = this.q('[data-forza="eventsTitle"]');
    if (eventsTitle) eventsTitle.textContent = here ? 'SELECT EVENT ROUTE' : `ROUTES IN ${map.label.toUpperCase()}`;
    if (eventsEl) {
      eventsEl.innerHTML = mapModes.map((m) => {
        const cat = eventCategoryBadge(m);
        const active = here && m.id === this.forzaModeId;
        const kind = recordKind(m);
        const rec = here ? this.records[m.id] : null;
        const best = kind === 'time' && Number.isFinite(rec?.time) ? formatTime(rec.time)
          : kind === 'score' && Number.isFinite(rec?.score) ? `${formatInt(rec.score)} pts` : '';
        const med = here && kind !== 'none' ? this.medals[m.id]?.medal : null;
        return `
          <button type="button" class="sdh-forza-event${active ? ' is-selected' : ''}" ${here ? `data-act="forza-select-mode" data-fmode="${esc(m.id)}"` : 'disabled'}>
            ${here ? this.routeThumb(m) : ''}
            <span class="sdh-fe-cat ${cat.cls}">${esc(cat.tag)}</span>
            <span class="sdh-fe-main"><b>${esc(m.label)}</b><small>${esc(m.tagline || '')}</small></span>
            <span class="sdh-fe-right">${med ? medalBadge(med) : ''}${best ? `<span class="sdh-num sdh-fe-best">${esc(best)}</span>` : ''}</span>
          </button>`;
      }).join('');
    }
    const startBtn = this.q('.sdh-forza-start');
    const startLbl = this.q('[data-forza="startLabel"]');
    const roamBtn = this.q('.sdh-forza-roam');
    const go = this.q('.sdh-map-go');
    const picked = mapModes.find((m) => m.id === this.forzaModeId) || mapModes[0];
    const mapGate = this.garage?.maps?.[map.id];
    const mapUnlocked = here || !mapGate || mapGate.unlocked;
    if (startBtn) startBtn.hidden = !here;
    if (roamBtn) roamBtn.hidden = !here;
    if (startLbl && picked) startLbl.textContent = `START · ${picked.label.toUpperCase()}`;
    if (go) {
      go.hidden = here;
      go.disabled = !mapUnlocked;
      go.innerHTML = mapUnlocked
        ? `${ICON.car}<span>TRAVEL &amp; LOAD ${esc(map.label.toUpperCase())}</span>`
        : `${ICON.lock}<span>UNLOCKS AT LEVEL ${esc(mapGate?.level || MAP_UNLOCKS[map.id]?.level || 2)}</span>`;
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
    this.q('[data-panel="achievements"] .sdh-awards').innerHTML = awardsMarkup(this.achievements);
  }

  /** @param {{items:Array, selected:{paint:string, rim:string, number:string, neon?:string, car?:string}, favorites?:string[]}} garage */
  setGarage(garage) {
    this.garage = garage || { items: [], selected: {}, favorites: [] };
    const activeCar = this.garage.trialCar || this.garage.selected?.car || 'hatch';
    if (!this.previewCarId || !CARS.some((c) => c.id === this.previewCarId) || !this.isGarageShowcaseActive() || this.lastActiveCar !== activeCar) {
      this.previewCarId = activeCar;
    }
    this.lastActiveCar = activeCar;
    const items = this.garage.items || [];
    const sel = this.garage.selected || {};
    for (const slot of ['paint', 'rim', 'neon']) {
      const grid = this.q(`[data-slot-grid="${slot}"]`);
      if (!grid) continue;
      grid.innerHTML = items.filter((it) => it.slot === slot).map((it) => {
        const on = sel[slot] === it.value;
        const locked = !it.unlocked;
        const color = Number.isFinite(it.color) ? hex(it.color) : 'transparent';
        const isSkin = slot === 'paint';
        const swatchKind = isSkin ? ' is-skin' : slot === 'rim' ? ' is-rim' : slot === 'neon' ? (it.value === 'rainbow' ? ' is-neon is-rainbow' : it.value === 'off' ? ' is-neon is-off' : ' is-neon') : '';
        const flop = Number.isFinite(it.flopColor) ? hex(it.flopColor) : color;
        const crevice = Number.isFinite(it.creviceColor) ? hex(it.creviceColor) : color;
        const skinBg = isSkin && it.skinUrl
          ? `;background-image:url('${esc(it.skinUrl)}')`
          : isSkin ? `;background-image:linear-gradient(125deg,${crevice} 0%,${color} 52%,${flop} 100%)` : '';
        const tag = isSkin && it.finishTag ? `<em class="sdh-cos-tag">${esc(it.finishTag)}</em>` : '';
        return `
          <button type="button" class="sdh-cos${on ? ' is-selected' : ''}${locked ? ' is-locked' : ''}" data-act="cosmetic" data-slot="${esc(slot)}" data-value="${esc(it.value)}"
            aria-pressed="${on}" aria-disabled="${locked}" title="${esc(it.label)}${locked ? ` · ${esc(it.requirement || 'Locked')}` : ''}">
            <span class="sdh-cos-swatch${swatchKind}" style="--c:${color}${skinBg}">${locked ? ICON.lock : ''}${tag}</span>
            <span class="sdh-cos-label">${esc(it.label)}</span>
            <span class="sdh-cos-req">${locked ? esc(it.requirement || 'Locked') : on ? 'Equipped' : ''}</span>
          </button>`;
      }).join('');
    }
    const custom = items.find((it) => it.slot === 'number' && it.value === 'custom');
    const input = this.q('.sdh-number-input');
    const enabled = Boolean(custom?.unlocked);
    if (input) {
      input.disabled = !enabled;
      if (document.activeElement !== input) input.value = sel.number ?? '';
    }
    const note = this.q('.sdh-number-note');
    if (note) note.textContent = enabled ? 'Two digits, shown on the doors' : `Locked · ${custom?.requirement || 'not available'}`;
    this.q('.sdh-number-field')?.classList.toggle('is-locked', !enabled);
    this.renderGarageShowcase();
    this.renderForzaMap();
    this.syncTitleBadges();
  }

  selectedCarId() {
    return this.previewCarId || this.garage?.trialCar || this.garage?.selected?.car || 'hatch';
  }

  garageCarEntry(carId) {
    return this.garage?.items?.find((it) => it.slot === 'car' && it.value === carId) || null;
  }

  selectCarInGarage(carId) {
    if (!CARS.some((c) => c.id === carId)) return;
    this.previewCarId = carId;
    const entry = this.garageCarEntry(carId);
    const unlocked = entry ? entry.unlocked : true;
    if (unlocked) {
      this.onCosmetic('car', carId);
    } else {
      this.onPreviewCar(carId);
      this.renderGarageShowcase();
    }
  }

  setGarageMode(mode) {
    this.garageMode = mode === 'customize' ? 'customize' : mode === 'upgrades' ? 'upgrades' : 'view';
    const viewPanel = this.q('[data-gpanel="view"]');
    const upgradesPanel = this.q('[data-gpanel="upgrades"]');
    const customPanel = this.q('[data-gpanel="customize"]');
    if (viewPanel) viewPanel.hidden = this.garageMode !== 'view';
    if (upgradesPanel) upgradesPanel.hidden = this.garageMode !== 'upgrades';
    if (customPanel) customPanel.hidden = this.garageMode !== 'customize';
    for (const btn of this.el.querySelectorAll('[data-act="garage-mode"]')) {
      btn.classList.toggle('is-on', btn.dataset.gmode === this.garageMode);
    }
    this.renderHubChrome(this.sub && this.screen === 'menu' ? this.sub : this.hubTab);
  }

  toggleFavorite(carId) {
    if (!carId) return;
    if (this.onFavoriteCar && this.onFavoriteCar !== this.noopRef) {
      this.onFavoriteCar(carId);
    } else if (this.garage) {
      const favs = new Set(this.garage.favorites || []);
      if (favs.has(carId)) favs.delete(carId);
      else favs.add(carId);
      this.garage.favorites = [...favs];
      this.renderGarageShowcase();
    }
  }

  cycleCarSort() {
    const idx = CAR_SORT_MODES.findIndex((m) => m.id === this.carSort);
    this.carSort = CAR_SORT_MODES[(idx + 1) % CAR_SORT_MODES.length].id;
    this.renderGarageShowcase();
  }

  toggleCarSpecs() {
    this.specsOpen = !this.specsOpen;
    this.renderGarageShowcase();
  }

  /** Cars in the chosen sort, owned ones first and locked ones after them by unlock level. */
  carsByLock(favs) {
    const owned = (c) => this.garageCarEntry(c.id)?.unlocked ?? true;
    const sorted = sortCars(CARS, this.carSort, favs);
    return [
      ...sorted.filter(owned),
      ...sorted.filter((c) => !owned(c)).sort((a, b) => (CAR_UNLOCKS[a.id]?.level || 0) - (CAR_UNLOCKS[b.id]?.level || 0)),
    ];
  }

  stepCar(delta) {
    const favs = this.garage?.favorites || [];
    const list = this.carsByLock(favs);
    if (!list.length) return;
    const idx = Math.max(0, list.findIndex((c) => c.id === this.selectedCarId()));
    const next = list[(idx + delta + list.length) % list.length];
    if (next) this.selectCarInGarage(next.id);
  }

  syncLightingPills() {
    const tod = this.mapId === 'apex' ? 'day' : this.settings?.timeOfDay || 'day';
    for (const btn of this.el.querySelectorAll('[data-act="garage-time"]')) {
      btn.disabled = this.mapId === 'apex';
      btn.hidden = this.mapId === 'apex' && btn.dataset.time !== 'day';
      btn.classList.toggle('is-on', btn.dataset.time === tod);
      btn.setAttribute('aria-pressed', String(btn.dataset.time === tod));
    }
    this.syncGarageLightsButton();
  }

  syncGarageLightsButton() {
    const btn = this.q('[data-act="garage-lights"]');
    const on = Boolean(this.headlightsOn || this.settings?.timeOfDay === 'night');
    if (btn) {
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', String(on));
    }
  }

  renderGarageShowcase() {
    if (!this.el) return;
    const car = getCar(this.selectedCarId());
    const entry = this.garageCarEntry(car.id);
    const carUpgrades = entry?.upgrades || this.garage?.carUpgrades?.[car.id] || null;
    const unlocked = entry ? entry.unlocked : true;
    const isTrial = this.garage?.trialCar === car.id;
    const canDrive = unlocked || isTrial;
    const cls = effectiveClassInfo(car, carUpgrades);
    const ratings = effectiveCarRatings(car, carUpgrades);
    const favs = new Set(this.garage?.favorites || []);
    const isFav = favs.has(car.id);

    const favBtn = this.q('[data-act="car-favorite"]');
    const favLabel = this.q('[data-g="favLabel"]');
    if (favBtn) {
      favBtn.classList.toggle('is-fav', isFav);
      favBtn.setAttribute('aria-pressed', String(isFav));
      const ico = favBtn.querySelector('.sdh-fav-ico');
      if (ico) ico.innerHTML = isFav ? ICON.starFill : ICON.star;
    }
    if (favLabel) favLabel.textContent = isFav ? 'FAVORITE' : 'ADD TO FAVORITES';

    const titleEl = this.q('[data-g="title"]');
    if (titleEl) {
      const lines = car.titleLines || [car.label.toUpperCase()];
      titleEl.innerHTML = lines.map((line) => esc(line)).join('<br>');
    }
    const customTitle = this.q('[data-g="customTitle"]');
    if (customTitle) customTitle.textContent = `CUSTOMIZING · ${car.label.toUpperCase()}`;
    const upgradesTitle = this.q('[data-g="upgradesTitle"]');
    if (upgradesTitle) upgradesTitle.textContent = `TUNING · ${car.label.toUpperCase()}`;

    const classEl = this.q('[data-g="classBadge"]');
    if (classEl) {
      classEl.textContent = cls.code;
      classEl.className = `sdh-class-badge sdh-num is-${esc(cls.band)}`;
    }
    const originEl = this.q('[data-g="origin"]');
    if (originEl) originEl.textContent = car.origin || 'IND';
    const catEl = this.q('[data-g="category"]');
    if (catEl) catEl.textContent = car.category || 'DRIFT SPEC';
    const blurbEl = this.q('[data-g="blurb"]');
    if (blurbEl) blurbEl.textContent = car.blurb || '';

    const lockNote = this.q('[data-g="lockNote"]');
    if (lockNote) {
      if (!unlocked && isTrial) {
        lockNote.hidden = false;
        lockNote.className = 'sdh-car-lock-note is-trial';
        lockNote.textContent = 'TEST DRIVE ACTIVE · Unlocked for your next run';
      } else if (!unlocked) {
        lockNote.hidden = false;
        lockNote.className = 'sdh-car-lock-note';
        lockNote.textContent = `LOCKED · Unlocks at ${entry?.requirement || `Level ${CAR_UNLOCKS[car.id]?.level || 2}`}`;
      } else {
        lockNote.hidden = true;
      }
    }

    const goBtn = this.q('[data-act="goto-map"]');
    const quickBtn = this.q('[data-act="garage-quick-drive"]');
    const buyEarlyBtn = this.q('[data-act="car-buy-early"]');
    const trialBtn = this.q('[data-act="car-test-drive"]');
    if (goBtn) goBtn.hidden = !canDrive;
    if (quickBtn) quickBtn.hidden = !canDrive;
    if (buyEarlyBtn) {
      const cost = entry?.earlyCost || CAR_UNLOCKS[car.id]?.earlyCost || 0;
      const credits = this.garage?.credits ?? 0;
      buyEarlyBtn.hidden = unlocked || !cost;
      buyEarlyBtn.disabled = credits < cost;
      buyEarlyBtn.querySelector('span').textContent = `UNLOCK EARLY · ${formatInt(cost)} CR`;
    }
    if (trialBtn) {
      trialBtn.hidden = unlocked || isTrial;
    }

    const statsEl = this.q('[data-g="stats"]');
    if (statsEl) {
      statsEl.innerHTML = carRatingRows({ ...car, ratings }).map((row) => `
        <div class="sdh-stat-row">
          <div class="sdh-stat-head">
            <span class="sdh-stat-label">${row.icon}<span>${esc(row.label)}</span></span>
            <span class="sdh-stat-val sdh-num">${row.value.toFixed(1)}</span>
          </div>
          <div class="sdh-stat-bar"><i style="transform:scaleX(${Math.max(0.05, Math.min(1, row.value / 10))})"></i></div>
        </div>`).join('');
    }

    const specsEl = this.q('[data-g="specs"]');
    if (specsEl) {
      specsEl.hidden = !this.specsOpen;
      if (this.specsOpen && car.specs) {
        const s = car.specs;
        specsEl.innerHTML = `
          <div><dt>MASS</dt><dd class="sdh-num">${formatInt(s.massKg)} kg</dd></div>
          <div><dt>TORQUE</dt><dd class="sdh-num">${formatInt(s.peakTorqueNm)} Nm</dd></div>
          <div><dt>REDLINE</dt><dd class="sdh-num">${formatInt(s.redlineRpm)} RPM</dd></div>
          <div><dt>LAYOUT</dt><dd>${esc(s.layoutLabel)}</dd></div>
          <div><dt>SETUP</dt><dd>${esc(s.aeroLabel)}</dd></div>
          <div><dt>NITROUS</dt><dd>${hasCarNitro(car, carUpgrades) ? 'Equipped' : 'Upgrade to equip'}</dd></div>`;
      }
    }

    this.renderGarageUpgrades(car, carUpgrades, unlocked);

    const duEl = this.q('[data-g="driveUnit"]');
    if (duEl) duEl.innerHTML = driveUnitSvg(car.drivetrain);
    const dtEl = this.q('[data-g="drivetrain"]');
    if (dtEl) dtEl.textContent = car.drivetrain || 'RWD';
    const gbEl = this.q('[data-g="gearbox"]');
    if (gbEl) gbEl.textContent = car.gearboxLabel || '6-SPD';

    const fallbackImg = this.q('.sdh-garage-fallback-img');
    if (fallbackImg && car.thumbnail) {
      fallbackImg.src = car.thumbnail;
      fallbackImg.alt = car.label;
    }

    const sortMeta = CAR_SORT_MODES.find((m) => m.id === this.carSort) || CAR_SORT_MODES[0];
    const sortLabel = this.q('[data-g="sortLabel"]');
    if (sortLabel) sortLabel.textContent = sortMeta.label;

    const cardsEl = this.q('[data-g="cards"]');
    if (cardsEl) {
      const sorted = this.carsByLock(favs);
      let lockedHeaderShown = false;
      cardsEl.innerHTML = sorted.map((c) => {
        const cEntry = this.garageCarEntry(c.id);
        const cUpgrades = cEntry?.upgrades || this.garage?.carUpgrades?.[c.id];
        const cCls = effectiveClassInfo(c, cUpgrades);
        const cUnlocked = cEntry ? cEntry.unlocked : true;
        const cTrial = this.garage?.trialCar === c.id;
        const selected = c.id === car.id;
        const equipped = c.id === (this.garage?.trialCar || this.garage?.selected?.car || 'hatch');
        const f = favs.has(c.id);
        const badgeText = !cUnlocked && !cTrial
          ? `LV ${CAR_UNLOCKS[c.id]?.level || 2}`
          : cTrial ? 'TRIAL' : equipped ? 'SELECTED' : 'OWNED';
        // A divider between the cars you own and the ones still locked.
        const divider = !cUnlocked && !lockedHeaderShown
          ? `<div class="sdh-lock-divider" aria-hidden="true">${ICON.lock}<span>LOCKED</span></div>` : '';
        if (!cUnlocked) lockedHeaderShown = true;
        return `${divider}
          <div class="sdh-car-card${selected ? ' is-selected' : ''}${!cUnlocked && !cTrial ? ' is-locked' : ''}" role="option" aria-selected="${selected}">
            <button type="button" class="sdh-car-card-main" data-act="car-select" data-car="${esc(c.id)}">
              ${c.thumbnail ? `<img class="sdh-car-card-img" src="${esc(c.thumbnail)}" alt="" decoding="async">` : ''}
              ${!cUnlocked && !cTrial ? `<span class="sdh-lock-badge" aria-label="Locked until level ${CAR_UNLOCKS[c.id]?.level || 2}">${ICON.lock}</span>` : ''}
              <span class="sdh-car-card-top">
                <span class="sdh-car-card-name">${esc(c.label.toUpperCase())}</span>
                <span class="sdh-class-badge sdh-num is-${esc(cCls.band)}">${esc(cCls.code)}</span>
              </span>
              <span class="sdh-car-card-foot">
                <span class="sdh-car-card-role">${esc(c.category)}</span>
                ${cUnlocked ? masteryMarkup(cEntry?.mastery?.stars || 0) : ''}
                ${badgeText ? `<span class="sdh-car-card-eq${!cUnlocked && !cTrial ? ' is-lock' : badgeText === 'OWNED' ? ' is-owned' : ''}">${!cUnlocked && !cTrial ? ICON.lock : ''}${esc(badgeText)}</span>` : ''}
              </span>
            </button>
            <button type="button" class="sdh-car-card-fav${f ? ' is-fav' : ''}" data-act="car-card-fav" data-car="${esc(c.id)}" aria-label="Favorite ${esc(c.label)}" aria-pressed="${f}">
              ${f ? ICON.starFill : ICON.star}
            </button>
          </div>`;
      }).join('');
    }
    this.syncLightingPills();
  }

  renderGarageUpgrades(car, upgrades, carUnlocked) {
    const list = this.q('[data-g="upgradesList"]');
    if (!list) return;
    const credits = this.garage?.credits ?? 0;
    const driverLv = this.garage?.level ?? this.profile?.level?.level ?? 1;
    const u = upgrades || { engine: 0, tires: 0, nitro: 0, chassis: 0 };
    if (!carUnlocked) {
      list.innerHTML = `<div class="sdh-upgrade-locked">Unlock <b>${esc(car.label)}</b> first (at Level ${CAR_UNLOCKS[car.id]?.level || 2} or via Early Unlock) to install parts.</div>`;
      return;
    }
    list.innerHTML = UPGRADE_SLOTS.map((slot) => {
      const stage = u[slot.id] || 0;
      const maxed = stage >= MAX_UPGRADE_STAGE;
      const next = maxed ? null : slot.stages[stage];
      const lvBlocked = next && driverLv < next.level;
      const crBlocked = next && credits < next.cost;
      const disabled = maxed || lvBlocked || crBlocked;
      const pips = [1, 2, 3].map((n) => `<i class="${stage >= n ? 'is-on' : ''}"></i>`).join('');
      const btnLabel = maxed ? 'MAXED' : lvBlocked ? `LV ${next.level}` : `${formatInt(next.cost)} CR`;
      return `
        <div class="sdh-upg-row${maxed ? ' is-max' : ''}">
          <div class="sdh-upg-head">
            <b>${esc(slot.label)}</b>
            <span class="sdh-upg-pips" aria-label="Stage ${stage} of ${MAX_UPGRADE_STAGE}">${pips}</span>
          </div>
          <small class="sdh-upg-desc">${esc(next ? `${next.label} · ${next.effect}` : 'Maximum performance installed')}</small>
          <button type="button" class="sdh-subpill sdh-upg-btn${!disabled ? ' is-buy' : ''}" data-act="buy-upgrade" data-slot="${esc(slot.id)}"${disabled ? ' disabled' : ''}>
            ${lvBlocked ? ICON.lock : ''}<span class="sdh-num">${esc(btnLabel)}</span>
          </button>
        </div>`;
    }).join('');
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
    set('credits', (n) => { n.textContent = formatInt(p.credits ?? 0); });
    set('xp', (n) => { n.style.transform = `scaleX(${Math.max(0, Math.min(1, lv.fraction || 0))})`; });
    set('xpText', (n) => { n.textContent = lv.span ? `Level ${lv.level} · ${formatInt(lv.into)} / ${formatInt(lv.span)} XP` : `Level ${lv.level}`; });
    const hubXp = this.q('[data-hub="xpFraction"]');
    if (hubXp) hubXp.textContent = lv.span ? `${formatInt(lv.into)} / ${formatInt(lv.span)} XP` : `${formatInt(lv.xp)} XP`;
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
  /** The current map's rivals (Career.rivals()). */
  setRivals(rivals) {
    const list = Array.isArray(rivals) ? rivals : [];
    this.rivals = list;
    this.renderChallenges();
    const box = this.q('.sdh-rivals');
    box.hidden = list.length === 0;
    this.q('[data-rivals]').innerHTML = list.map((r) => {
      const locked = r.state === 'locked';
      const beaten = r.state === 'beaten';
      return `
        <li class="sdh-rival is-${esc(r.tier)} is-${esc(r.state)}" title="${esc(r.bio)}">
          <span class="sdh-rival-tier">${esc(r.tierLabel)}</span>
          <div class="sdh-rival-main">
            <b>${esc(r.name)}</b>
            <small>${esc(r.modeLabel)} · <span class="sdh-num">${esc(formatTime(r.time))}</span></small>
          </div>
          <button type="button" class="sdh-btn sdh-rival-go" data-act="duel" data-rival="${esc(r.id)}" ${locked ? 'disabled' : ''} aria-label="${locked ? 'Locked' : beaten ? 'Rematch' : 'Duel'} ${esc(r.name)}">${locked ? ICON.lock : beaten ? ICON.check : ICON.play}<span>${locked ? '' : beaten ? 'Again' : `+${formatInt(r.credits)}`}</span></button>
        </li>`;
    }).join('');
  }

  /** Populate map-specific story/adventure missions inside the Events hub (Tokyo Night, Hollow Radio). */
  setMapQuests(quests) {
    const box = this.q('.sdh-quests');
    if (!box) return;
    const items = Array.isArray(quests?.items) ? quests.items : [];
    box.hidden = items.length === 0;
    if (!items.length) return;
    this.q('[data-q="title"]').textContent = quests.title || 'Map Adventures';
    this.q('[data-q="summary"]').textContent = quests.summary || '';
    this.q('[data-quests]').innerHTML = items.map((q) => `
      <li class="sdh-quest${q.done ? ' is-done' : ''}${q.active ? ' is-active' : ''}${q.locked ? ' is-locked' : ''}" title="${esc(q.detail || '')}">
        <div class="sdh-quest-main">
          <b>${esc(q.title)}</b>
          <small>${esc(q.detail || '')}</small>
        </div>
        <button type="button" class="sdh-btn sdh-quest-go" data-act="quest-start" data-quest="${esc(q.id)}" ${q.locked ? 'disabled' : ''}>
          ${q.locked ? ICON.lock : q.done ? ICON.check : ICON.play}<span>${q.locked ? 'Locked' : q.done ? 'Replay' : q.active ? 'Active' : 'Start'}</span>
        </button>
      </li>`).join('');
  }

  setDaily(daily) {
    this.daily = daily || null;
    this.renderDaily();
    this.renderChallenges();
  }

  renderDaily() {
    const card = this.q('.sdh-daily');
    const d = this.daily;
    card.classList.toggle('is-empty', !d);
    card.classList.toggle('is-done', Boolean(d?.done));
    const set = (k, v) => { this.q(`[data-d="${k}"]`).textContent = v; };
    this.q('[data-d="contracts"]').innerHTML = (d?.contracts || []).map((c) => `
      <li class="${c.done ? 'is-done' : ''}"><span>${c.done ? ICON.check : ''}${esc(c.text)}</span><b class="sdh-num">${c.done ? 'Done' : `${formatContract(c.progress)}/${formatContract(c.goal)}`}</b><i style="transform:scaleX(${c.goal ? c.progress / c.goal : 0})"></i></li>`).join('');
    if (!d) {
      set('text', 'No challenge today');
      set('mode', ''); set('xp', ''); set('streak', '0'); set('btn', 'Start');
      this.q('[data-act="daily"]').disabled = true;
      return;
    }
    const extra = [d.timeOfDay ? d.timeOfDay.charAt(0).toUpperCase() + d.timeOfDay.slice(1) : '', d.clean ? 'No resets' : ''].filter(Boolean).join(' · ');
    set('text', d.text || '');
    set('mode', `${d.modeLabel || d.modeId}${extra ? ` · ${extra}` : ''}`);
    set('xp', d.done ? 'Completed' : `+${formatInt(d.xp)} XP${d.boost > 1 ? ` · x${d.boost} streak` : ''}`);
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
    const dots = this.q('[data-hub="convoyDots"]');
    if (dots) {
      const shown = this.players.slice(0, 4);
      dots.innerHTML = shown.length
        ? shown.map((p) => `<span class="sdh-convoy-avatar${p.isMe ? ' is-me' : ''}" title="${esc(p.name)}">${esc((p.name || 'D').charAt(0).toUpperCase())}</span>`).join('')
        : '<span class="sdh-convoy-avatar is-me">D</span>';
    }
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
    chip.querySelector('span').textContent = g ? (g.kind === 'pb' ? 'Ghost · Your best' : g.kind === 'rival' ? `Rival · ${g.name}` : `Ghost · ${g.name || 'Rival'}`) : '';
    this.q('.sdh-ghost-delta .sdh-k').textContent = g?.kind === 'rival' ? 'RIVAL' : 'GHOST';
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

  /** Pop a dynamic style maneuver banner above the drift combo meter (Wall Tap, Reverse Entry, etc.). */
  flashStyleCallout(ev) {
    if (!ev || !ev.label) return;
    const el = this.q('.sdh-drift-style');
    if (!el) return;
    el.querySelector('span').textContent = String(ev.label);
    el.querySelector('em').textContent = Number.isFinite(ev.bonus) && ev.bonus > 0 ? `+${formatInt(ev.bonus)}` : '';
    el.dataset.kind = ev.kind || 'transition';
    el.classList.remove('is-on');
    void el.offsetWidth;
    el.classList.add('is-on');
    if (this.styleTimer) clearTimeout(this.styleTimer);
    this.styleTimer = this.later(() => el.classList.remove('is-on'), 1350);
  }

  /** Update the finish ticket XP/CR displays after claiming a 2x rewarded bonus. */
  applyAdDoubleBonus(bonus) {
    if (!bonus) return;
    const xpEl = this.q('[data-r="xp"]');
    const crEl = this.q('[data-r="cr"]');
    if (xpEl) xpEl.textContent = `+${formatInt(bonus.xpBonus * 2)} XP`;
    if (crEl) crEl.textContent = `+${formatInt(bonus.crBonus * 2)} CR`;
    const dbl = this.q('[data-act="double-rewards"]');
    if (dbl) dbl.hidden = true;
    if (bonus.level) {
      const bar = this.q('.sdh-panel-finish .sdh-xp i');
      const lv = this.q('.sdh-panel-finish [data-x="lv"]');
      if (bar) bar.style.transform = `scaleX(${Math.max(0, Math.min(1, bonus.level.fraction || 0))})`;
      if (lv) lv.textContent = String(bonus.level.level);
    }
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
    v.speedFast.set(speed >= (mph ? 102 : 165) || Boolean(f.boosting));
    // Wind streaks: in from 160 km/h, full by 240, strong whenever the nitrous is lit.
    const kmh = Math.abs(f.speedKmh || 0);
    const fx = Math.round(Math.max(f.boosting ? 0.75 : 0, Math.min(1, (kmh - 160) / 80)) * 10) / 10;
    if (fx !== this.speedFx) {
      this.speedFx = fx;
      this.speedFxEl ??= this.q('.sdh-speedfx');
      this.speedFxEl.style.setProperty('--fx', String(Math.max(0, fx)));
      this.speedFxEl.classList.toggle('is-wind', fx > 0); // animate only while visible: an idle infinite animation still costs a composite every frame
    }
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
    v.nitroOff.set(f.boost === null);
    const boost = Math.max(0, Math.min(100, f.boost ?? 0));
    v.nitro.setKey(Math.round(boost * 2), (k) => `scaleX(${k / 200})`);
    v.nitroLow.set(boost < 15);
    v.boosting.set(Boolean(f.boosting));
    // The touch N2O button shows its own tank, since the meter is hidden on phones.
    const tank = Math.round(boost / 5);
    if (tank !== this.touchTank) {
      this.touchTank = tank;
      const button = this.touchRoot.querySelector('.sdt-boost');
      button?.style.setProperty('--fill', String(tank / 20));
      button?.classList.toggle('is-empty', tank < 1);
    }

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

    // Live Ghost Split Delta ---------------------------------------------
    const gd = f.ghostDelta;
    const hasDelta = Number.isFinite(gd) && s && this.modeKind === 'time';
    v.ghostDeltaOn.set(hasDelta);
    if (hasDelta) {
      const q = Math.round(gd * 100);
      v.ghostDeltaVal.setKey(q, (v100) => formatDelta(v100 / 100));
      v.ghostDeltaAhead.set(q <= -1);
      v.ghostDeltaBehind.set(q >= 1);
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
    window.removeEventListener('resize', this.onWindowResize);
    window.visualViewport?.removeEventListener('resize', this.onWindowResize);
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    this.touchRoot.removeEventListener('touchmodechange', this.onTouchMode);
    this.el.removeEventListener('click', this.onClick);
    this.overviewObserver?.disconnect();
    this.driftBg?.destroy();
    this.driftBg = null;
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
