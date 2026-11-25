// Pure markup and data helpers for the Wreckfest-inspired Garage, Forza-style Map Chooser,
// and Title/Loading Start Gate. Kept DOM-free so tests can exercise sorting and formatting in Node.

import { CARS } from '../vehicle/cars.js';
import { MAPS } from '../world/maps.js';
import { ICON } from './icons.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const HUB_TABS = Object.freeze([
  Object.freeze({ id: 'garage', label: 'GARAGE', crumb: '01 · GARAGE SECTION', heading: 'GARAGE - VIEW CARS' }),
  Object.freeze({ id: 'map', label: 'MAP & DRIVE', crumb: '02 · MOUNTAIN ATLAS', heading: 'WORLD MAP - CHOOSE ROUTE' }),
  Object.freeze({ id: 'events', label: 'EVENTS', crumb: '03 · HILL TRIALS', heading: 'CAREER - EVENTS & DAILY' }),
  Object.freeze({ id: 'party', label: 'PARTY', crumb: '04 · CONVOY LOBBY', heading: 'PARTY - RACE WITH FRIENDS' }),
  Object.freeze({ id: 'leaderboard', label: 'LEADERBOARD', crumb: '05 · TIME SHEETS', heading: 'LEADERBOARD - RECORDS' }),
  Object.freeze({ id: 'achievements', label: 'AWARDS', crumb: '06 · DRIVER LOG', heading: 'AWARDS - ACHIEVEMENTS' }),
  Object.freeze({ id: 'settings', label: 'OPTIONS', crumb: '07 · TUNING & SETUP', heading: 'OPTIONS - SETTINGS' }),
]);

export const CAR_SORT_MODES = Object.freeze([
  Object.freeze({ id: 'default', label: 'DEFAULT' }),
  Object.freeze({ id: 'class', label: 'BY CLASS' }),
  Object.freeze({ id: 'favorites', label: 'FAVORITES' }),
  Object.freeze({ id: 'name', label: 'BY NAME' }),
]);

const HAS_URL = typeof import.meta.url === 'string';
export const TITLE_BACKDROP_URL = HAS_URL ? new URL('../assets/ui/title-backdrop.webp', import.meta.url).href : '';

/** Sort vehicles cleanly according to the active Wreckfest-style garage sort mode. */
export function sortCars(cars = CARS, sortMode = 'default', favorites = []) {
  const favSet = new Set(Array.isArray(favorites) ? favorites : []);
  const list = cars.slice();
  if (sortMode === 'class') {
    return list.sort((a, b) => (b.classRank || 0) - (a.classRank || 0) || a.label.localeCompare(b.label));
  }
  if (sortMode === 'name') {
    return list.sort((a, b) => a.label.localeCompare(b.label));
  }
  if (sortMode === 'favorites') {
    return list.sort((a, b) => Number(favSet.has(b.id)) - Number(favSet.has(a.id)) || (b.classRank || 0) - (a.classRank || 0));
  }
  return list;
}

/** Format the 4 primary rating bars shown in the Wreckfest-style Garage inspector. */
export function carRatingRows(car) {
  const r = car?.ratings || { acceleration: 6.5, topSpeed: 6.5, handling: 7.0, control: 7.5 };
  const fourthLabel = car?.drivetrain === 'AWD' ? 'TRAIL & GRIP' : 'DRIFT CONTROL';
  return [
    { id: 'acceleration', label: 'ACCELERATION', value: r.acceleration, icon: ICON.gauge },
    { id: 'topSpeed', label: 'MAX. SPEED', value: r.topSpeed, icon: ICON.speed },
    { id: 'handling', label: 'HANDLING', value: r.handling, icon: ICON.wheel },
    { id: 'control', label: fourthLabel, value: r.control, icon: ICON.shield },
  ];
}

/** Compact top-down schematic SVG highlighting the driven wheels (RWD vs AWD). */
export function driveUnitSvg(drivetrain = 'RWD') {
  const awd = drivetrain === 'AWD' || drivetrain === '4WD';
  const frontFill = awd ? 'var(--marigold)' : 'rgba(244,241,232,0.22)';
  const rearFill = 'var(--marigold)';
  return `
    <svg class="sdh-du-svg" viewBox="0 0 64 40" aria-hidden="true">
      <rect x="10" y="3" width="12" height="7" rx="1.5" fill="${frontFill}" stroke="var(--ink)" stroke-width="1.5"/>
      <rect x="42" y="3" width="12" height="7" rx="1.5" fill="${rearFill}" stroke="var(--ink)" stroke-width="1.5"/>
      <rect x="10" y="30" width="12" height="7" rx="1.5" fill="${frontFill}" stroke="var(--ink)" stroke-width="1.5"/>
      <rect x="42" y="30" width="12" height="7" rx="1.5" fill="${rearFill}" stroke="var(--ink)" stroke-width="1.5"/>
      <path d="M16 10v20M48 10v20M16 20h32" stroke="var(--chalk)" stroke-width="2.4" stroke-linecap="round"/>
      <circle cx="48" cy="20" r="3" fill="var(--marigold)" stroke="var(--ink)" stroke-width="1.4"/>
      ${awd ? '<circle cx="16" cy="20" r="3" fill="var(--marigold)" stroke="var(--ink)" stroke-width="1.4"/>' : ''}
      <path d="M4 20h6M5 17l-3 3 3 3" stroke="var(--marigold)" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
}

/** Category pill metadata for Forza-style event selector cards. */
export function eventCategoryBadge(mode) {
  if (!mode) return { tag: 'EVENT', cls: 'is-road' };
  if (mode.id === 'roam') return { tag: 'FREE ROAM', cls: 'is-roam' };
  if (mode.id === 'drift') return { tag: 'DRIFT ZONE', cls: 'is-drift' };
  if (mode.id === 'climb' || mode.id === 'peak') return { tag: 'HILL CLIMB', cls: 'is-climb' };
  if (mode.id === 'descent' || mode.id === 'peakdown') return { tag: 'TOUGE', cls: 'is-touge' };
  return { tag: 'CIRCUIT', cls: 'is-road' };
}

/** Top header bar shared across the entire Starting Hub (Wreckfest 2 structure, Slop-Drift palette). */
export function hubHeaderMarkup(uid, chaiGlass) {
  const tabs = HUB_TABS.map((t) => `
    <button type="button" class="sdh-hub-tab" data-act="hub-tab" data-hub-tab="${escHtml(t.id)}" aria-selected="false">
      <span>${escHtml(t.label)}</span>
    </button>`).join('');
  return `
    <header class="sdh-hub-top" aria-label="Starting navigation">
      <div class="sdh-hub-crumb">
        <span class="sdh-hub-eyebrow" data-hub="crumb">01 · GARAGE SECTION</span>
        <h1 class="sdh-hub-heading" data-hub="heading">GARAGE - VIEW CARS</h1>
      </div>
      <div class="sdh-hub-bar">
        <div class="sdh-hub-brand">
          <div class="sdh-brand sdh-brand-hub"><span>SLOP DRIFT</span><small lang="hi">मसूरी</small>${chaiGlass}</div>
          <span class="sdh-hub-tagline">DRIVE HARD. CHAI WAITS.</span>
        </div>
        <button type="button" class="sdh-hub-convoy" data-act="hub-tab" data-hub-tab="party" title="Online drivers & Party">
          <span class="sdh-hub-convoy-dots" data-hub="convoyDots"></span>
          <span class="sdh-hub-convoy-plus">+</span>
          <span class="sdh-hub-convoy-txt"><i class="sdh-dot"></i><span data-p="connText">Offline</span></span>
        </button>
        <div class="sdh-hub-pills">
          <button type="button" class="sdh-hub-stat" data-act="hub-tab" data-hub-tab="map" title="Current mountain map">
            ${ICON.map}<span class="sdh-num" data-hub="mapName">MUSSOORIE</span>
          </button>
          <button type="button" class="sdh-hub-stat" data-act="hub-tab" data-hub-tab="achievements" title="Medals earned">
            ${ICON.trophy}<span class="sdh-num" data-hub="medalCount">0</span>
          </button>
          <div class="sdh-hub-xpbox" title="Driver XP progress">
            <div class="sdh-hub-xprow">
              <span class="sdh-num" data-hub="xpFraction">0 / 150 XP</span>
            </div>
            <div class="sdh-xp sdh-hub-xpbar"><i data-p="xp"></i></div>
          </div>
          <div class="sdh-hub-driver">
            <div class="sdh-hub-driver-meta">
              <button type="button" class="sdh-pb-name" data-act="rename" title="Rename driver">
                <span data-p="name">Driver</span>${ICON.pencil}
              </button>
              <input class="sdh-pb-input" type="text" maxlength="16" autocomplete="off" spellcheck="false" aria-label="Driver name" hidden>
              <span class="sdh-hub-level">LEVEL <b class="sdh-num" data-p="level">1</b></span>
            </div>
            <span class="sdh-lv-badge sdh-num" data-p="level">1</span>
          </div>
          <button type="button" class="sdh-icon sdh-icon-plain sdh-fs" data-act="fullscreen" aria-label="Fullscreen" title="Fullscreen (F)">${ICON.expand}${ICON.shrink}</button>
        </div>
      </div>
      <nav class="sdh-hub-nav" aria-label="Main sections">
        <button type="button" class="sdh-hub-bumper" data-act="hub-prev" aria-label="Previous section" title="Previous tab (Q)"><kbd>Q</kbd></button>
        <div class="sdh-hub-tabs" role="tablist">${tabs}</div>
        <button type="button" class="sdh-hub-bumper" data-act="hub-next" aria-label="Next section" title="Next tab (E)"><kbd>E</kbd></button>
      </nav>
    </header>`;
}

/** Wreckfest 2-inspired full-screen Garage showcase inside Slop-Drift's theme. */
export function garageHubMarkup() {
  const mapCount = Object.keys(MAPS).length;
  return `
    <section class="sdh-hub-view sdh-garage-view" data-hub-view="garage" aria-label="Garage">
      <div class="sdh-garage-subhead">
        <div class="sdh-garage-subleft">
          <button type="button" class="sdh-pill-back" data-act="hub-tab" data-hub-tab="map" title="Go to World Map">
            ${ICON.back}<span>GARAGE</span>
          </button>
          <span class="sdh-pill-count">${CARS.length} CARS AVAILABLE</span>
          <div class="sdh-garage-subtabs" role="group" aria-label="Garage mode">
            <button type="button" class="sdh-subpill is-on" data-act="garage-mode" data-gmode="view">VIEW CARS</button>
            <button type="button" class="sdh-subpill" data-act="garage-mode" data-gmode="customize">${ICON.paint}<span>PAINT &amp; LOOK</span></button>
          </div>
        </div>
        <div class="sdh-garage-lighting" role="group" aria-label="Preview lighting">
          <span class="sdh-light-label">${ICON.sun}<span>LIGHT</span></span>
          <button type="button" class="sdh-light-btn" data-act="garage-time" data-time="dawn">DAWN</button>
          <button type="button" class="sdh-light-btn" data-act="garage-time" data-time="day">DAY</button>
          <button type="button" class="sdh-light-btn" data-act="garage-time" data-time="sunset">DUSK</button>
          <button type="button" class="sdh-light-btn" data-act="garage-time" data-time="night">NIGHT</button>
          <button type="button" class="sdh-light-btn sdh-light-lamps" data-act="garage-lights" aria-pressed="false" title="Toggle headlights (H)">LAMPS</button>
        </div>
      </div>

      <div class="sdh-garage-main">
        <div class="sdh-garage-left">
          <div class="sdh-garage-inspect" data-gpanel="view">
            <button type="button" class="sdh-fav-btn" data-act="car-favorite" aria-pressed="false">
              <span class="sdh-fav-ico">${ICON.star}</span>
              <span data-g="favLabel">ADD TO FAVORITES</span>
            </button>
            <h2 class="sdh-car-hero" data-g="title">RALLY<br>HATCH</h2>
            <div class="sdh-car-badges">
              <span class="sdh-class-badge sdh-num" data-g="classBadge">B185</span>
              <span class="sdh-origin-badge" data-g="origin">IND</span>
              <span class="sdh-cat-badge" data-g="category">DRIFT SPEC</span>
            </div>
            <p class="sdh-car-blurb" data-g="blurb"></p>
            <div class="sdh-stat-list" data-g="stats"></div>
            <div class="sdh-car-specs" data-g="specs" hidden></div>
          </div>

          <div class="sdh-garage-custom" data-gpanel="customize" hidden>
            <div class="sdh-custom-head">
              <span class="sdh-eyebrow" data-g="customTitle">CUSTOMIZING · RALLY HATCH</span>
              <button type="button" class="sdh-subpill" data-act="garage-mode" data-gmode="view">DONE</button>
            </div>
            <div class="sdh-custom-scroll">
              <div class="sdh-group-label">Paint finish</div>
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
              <p class="sdh-credit">Hill 4x4 model: "Mahindra - Thar Roxx" by ansari_studios, CC BY 4.0.</p>
            </div>
          </div>
        </div>

        <div class="sdh-garage-stage" data-garage-stage aria-label="3D vehicle showcase — drag to rotate">
          <img class="sdh-garage-fallback-img" alt="" decoding="async">
          <div class="sdh-stage-hint">DRAG TO ROTATE 360°</div>
        </div>

        <div class="sdh-garage-right">
          <div class="sdh-garage-cta-stack">
            <button type="button" class="sdh-btn sdh-btn-primary sdh-garage-go" data-act="goto-map">
              ${ICON.map}<span>CHOOSE MAP &amp; DRIVE</span>
            </button>
            <button type="button" class="sdh-btn sdh-garage-quick" data-act="garage-quick-drive">
              ${ICON.play}<span>QUICK FREE ROAM</span>
            </button>
          </div>
          <div class="sdh-drive-unit">
            <div class="sdh-du-title">DRIVE UNIT</div>
            <div class="sdh-du-body" data-g="driveUnit"></div>
            <div class="sdh-du-meta"><span data-g="drivetrain">RWD</span> · <span data-g="gearbox">6-SPD</span></div>
          </div>
        </div>
      </div>

      <div class="sdh-garage-bottom">
        <div class="sdh-garage-carousel">
          <button type="button" class="sdh-car-arrow" data-act="car-prev" aria-label="Previous car">${ICON.chevronLeft}</button>
          <div class="sdh-car-cards" role="listbox" aria-label="Select vehicle" data-g="cards"></div>
          <button type="button" class="sdh-car-arrow" data-act="car-next" aria-label="Next car">${ICON.chevronRight}</button>
        </div>
        <footer class="sdh-garage-footer">
          <button type="button" class="sdh-hint-btn" data-act="goto-map"><kbd>ENTER</kbd><span>CHOOSE MAP (${mapCount})</span></button>
          <button type="button" class="sdh-hint-btn" data-act="car-favorite"><kbd>C</kbd><span>TO FAVORITES</span></button>
          <button type="button" class="sdh-hint-btn" data-act="car-sort"><kbd>X</kbd><span>SORTING <b data-g="sortLabel">DEFAULT</b></span></button>
          <button type="button" class="sdh-hint-btn" data-act="garage-toggle-custom"><kbd>V</kbd><span>CUSTOMIZE LOOK</span></button>
          <button type="button" class="sdh-hint-btn" data-act="car-specs"><kbd>BACKSPACE</kbd><span>DISPLAY INFORMATION</span></button>
        </footer>
      </div>
    </section>`;
}

/** Forza Horizon-inspired Mountain Map & Event Route Chooser. */
export function forzaMapHubMarkup() {
  const regions = Object.values(MAPS).map((map) => `
    <button type="button" class="sdh-forza-region" data-act="map-preview" data-map="${escHtml(map.id)}" aria-pressed="false">
      ${map.preview ? `<img class="sdh-forza-region-img" src="${escHtml(map.preview)}" alt="" decoding="async">` : ''}
      <span class="sdh-forza-region-body">
        <span class="sdh-forza-region-top">
          <b>${escHtml(map.label)}</b>
          <span class="sdh-forza-region-badge" data-fmap-badge="${escHtml(map.id)}">PREVIEW</span>
        </span>
        <small>${escHtml(map.tagline)}</small>
      </span>
    </button>`).join('');

  return `
    <section class="sdh-hub-view sdh-forza-view" data-hub-view="map" aria-label="Choose mountain and event" hidden>
      <div class="sdh-forza-regions" role="group" aria-label="Mountains">${regions}</div>

      <div class="sdh-forza-grid">
        <div class="sdh-forza-stage">
          <div class="sdh-forza-stage-head">
            <div class="sdh-forza-stage-title">
              <span class="sdh-map-stage-status">Driving now</span>
              <h2 class="sdh-map-stage-name">Mussoorie</h2>
            </div>
            <div class="sdh-forza-stage-tools">
              <button type="button" class="sdh-subpill is-on" data-act="forza-view" data-fview="map">ROUTE MAP</button>
              <button type="button" class="sdh-subpill" data-act="forza-view" data-fview="drone">DRONE PREVIEW</button>
            </div>
          </div>

          <div class="sdh-forza-canvas-wrap">
            <canvas class="sdh-overview sdh-overview-forza" aria-label="Interactive route map"></canvas>
            <div class="sdh-forza-pins" data-forza="pins"></div>
            <div class="sdh-map-frame sdh-forza-drone" hidden>
              <img class="sdh-map-shot" alt="" decoding="async">
              <video class="sdh-map-clip" muted loop playsinline preload="none" tabindex="-1" aria-hidden="true"></video>
            </div>
          </div>

          <div class="sdh-forza-stage-foot">
            <p class="sdh-map-stage-tag"></p>
            <ul class="sdh-map-stage-chips"></ul>
          </div>
        </div>

        <aside class="sdh-forza-inspector" aria-label="Event launcher">
          <div class="sdh-forza-car-pill">
            <span>ACTIVE CAR</span>
            <b data-forza="activeCar">RALLY HATCH · B185</b>
            <button type="button" class="sdh-subpill" data-act="hub-tab" data-hub-tab="garage">CHANGE</button>
          </div>

          <div class="sdh-forza-tod" role="group" aria-label="Time of day">
            <span class="sdh-section-label">TIME OF DAY</span>
            <div class="sdh-forza-tod-btns">
              <button type="button" class="sdh-light-btn" data-act="garage-time" data-time="dawn">DAWN</button>
              <button type="button" class="sdh-light-btn" data-act="garage-time" data-time="day">DAY</button>
              <button type="button" class="sdh-light-btn" data-act="garage-time" data-time="sunset">SUNSET</button>
              <button type="button" class="sdh-light-btn" data-act="garage-time" data-time="night">NIGHT</button>
            </div>
          </div>

          <div class="sdh-forza-events-head">
            <span class="sdh-section-label" data-forza="eventsTitle">SELECT EVENT ROUTE</span>
          </div>
          <div class="sdh-forza-events" data-forza="events"></div>

          <div class="sdh-forza-launch">
            <button type="button" class="sdh-btn sdh-btn-primary sdh-forza-start" data-act="forza-start">
              ${ICON.play}<span data-forza="startLabel">START EVENT</span>
            </button>
            <button type="button" class="sdh-btn sdh-btn-primary sdh-map-go" data-act="map-go" hidden></button>
            <button type="button" class="sdh-btn sdh-forza-roam" data-act="forza-roam">
              ${ICON.compass || ICON.map}<span>FREE ROAM</span>
            </button>
          </div>
        </aside>
      </div>
    </section>`;
}
