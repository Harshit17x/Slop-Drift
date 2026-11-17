// Standalone harness: mounts Hud + Input over a painted backdrop and drives them with fake, animated data.
// Open http://localhost:5174/tests/ui-harness.html (Vite dev server at the repo root).
// Query params: ?screen=menu|race|pause|finish|settings|loading  ?bg=snow|forest|mixed  ?touch=1  ?hx=0 (hide panel)

import { Hud } from '../src/ui/Hud.js';
import { Input } from '../src/input/Input.js';
import { DEFAULT_SETTINGS, MODES, normalizeSettings } from '../src/config.js';

const params = new URLSearchParams(location.search);
const TAU = Math.PI * 2;

// ------------------------------------------------------------------ fake road network (~2.5 km world)

function buildLoop() {
  const n = 900;
  const pts = [];
  const hs = [];
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * TAU;
    const r = 760 + 140 * Math.sin(3 * a + 0.4) + 60 * Math.cos(7 * a);
    pts.push(Math.cos(a) * r, Math.sin(a) * r * 0.86);
    hs.push(430 + 60 * Math.sin(2 * a + 0.5) + 6 * Math.sin(9 * a));
  }
  return { id: 0, closed: true, points: pts, heights: hs };
}

function buildSpur(loop) {
  const j = 610; // junction vertex on the loop
  const jx = loop.points[j * 2];
  const jz = loop.points[j * 2 + 1];
  const jh = loop.heights[j];
  const sx = 40;
  const sz = -60;
  const pts = [];
  const hs = [];
  const n = 260;
  const dx = sx - jx;
  const dz = sz - jz;
  const len = Math.hypot(dx, dz);
  const px = -dz / len;
  const pz = dx / len;
  for (let i = 0; i <= n; i += 1) {
    const u = i / n;
    const wig = 90 * Math.sin(u * Math.PI * 6) * (1 - u * 0.6);
    pts.push(jx + dx * u + px * wig, jz + dz * u + pz * wig);
    hs.push(jh + (1010 - jh) * (u * u * (3 - 2 * u)));
  }
  return { road: { id: 1, closed: false, points: pts, heights: hs }, junction: { x: jx, z: jz }, summit: { x: sx, z: sz } };
}

const loop = buildLoop();
const spur = buildSpur(loop);
const TRACK = {
  bounds: { minX: -1250, maxX: 1250, minZ: -1250, maxZ: 1250 },
  roads: [loop, spur.road],
  markers: [
    { x: loop.points[0], z: loop.points[1], kind: 'start' },
    { x: spur.junction.x, z: spur.junction.z, kind: 'junction' },
    { x: spur.summit.x, z: spur.summit.z, kind: 'summit' },
  ],
};

// Cumulative distances along the loop for constant-speed motion.
const LOOP_N = loop.points.length / 2;
const cum = new Float64Array(LOOP_N + 1);
for (let i = 1; i <= LOOP_N; i += 1) {
  const a = (i - 1) % LOOP_N;
  const b = i % LOOP_N;
  cum[i] = cum[i - 1] + Math.hypot(loop.points[b * 2] - loop.points[a * 2], loop.points[b * 2 + 1] - loop.points[a * 2 + 1]);
}
const LOOP_LEN = cum[LOOP_N];

function sampleLoop(s, out) {
  const d = ((s % LOOP_LEN) + LOOP_LEN) % LOOP_LEN;
  let lo = 0;
  let hi = LOOP_N;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid; else hi = mid;
  }
  const a = lo % LOOP_N;
  const b = (lo + 1) % LOOP_N;
  const t = (d - cum[lo]) / Math.max(1e-6, cum[lo + 1] - cum[lo]);
  const ax = loop.points[a * 2]; const az = loop.points[a * 2 + 1];
  const bx = loop.points[b * 2]; const bz = loop.points[b * 2 + 1];
  out.x = ax + (bx - ax) * t;
  out.z = az + (bz - az) * t;
  out.h = loop.heights[a] + (loop.heights[b] - loop.heights[a]) * t;
  const seg = Math.max(1e-6, cum[lo + 1] - cum[lo]);
  out.heading = Math.atan2(bx - ax, -(bz - az));
  out.grade = ((loop.heights[b] - loop.heights[a]) / seg) * 100;
  return out;
}

// ------------------------------------------------------------------ backdrop

const scene = document.getElementById('scene');
let backdrop = params.get('bg') || 'mixed';
function paintBackdrop() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  scene.width = Math.round(innerWidth * dpr);
  scene.height = Math.round(innerHeight * dpr);
  const ctx = scene.getContext('2d');
  const w = scene.width;
  const h = scene.height;
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.6);
  sky.addColorStop(0, '#7fb6e8');
  sky.addColorStop(1, '#dcecf8');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  const ridge = (y0, amp, color, seed) => {
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 8) {
      const y = y0 + amp * (Math.sin(x / w * 7 + seed) * 0.5 + Math.sin(x / w * 17 + seed * 2) * 0.25 + Math.sin(x / w * 41) * 0.08);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };
  if (backdrop === 'snow') {
    ridge(h * 0.32, h * 0.12, '#f4f8fc', 1);
    ridge(h * 0.5, h * 0.08, '#ffffff', 2);
    ctx.fillStyle = '#eef3f8';
    ctx.fillRect(0, h * 0.7, w, h * 0.3);
  } else if (backdrop === 'forest') {
    ridge(h * 0.3, h * 0.1, '#2c3b33', 1);
    ridge(h * 0.45, h * 0.08, '#18251c', 2);
    ctx.fillStyle = '#0f1812';
    ctx.fillRect(0, h * 0.62, w, h * 0.38);
  } else {
    ridge(h * 0.28, h * 0.14, '#eef4fa', 1);
    ridge(h * 0.45, h * 0.1, '#25352b', 2);
    ctx.fillStyle = '#1a271e';
    ctx.fillRect(0, h * 0.66, w * 0.5, h * 0.34);
    ctx.fillStyle = '#f3f7fb';
    ctx.fillRect(w * 0.5, h * 0.66, w * 0.5, h * 0.34);
  }
  // A grey road vanishing toward the horizon, for context.
  ctx.fillStyle = 'rgba(70,74,80,0.95)';
  ctx.beginPath();
  ctx.moveTo(w * 0.47, h * 0.55);
  ctx.lineTo(w * 0.53, h * 0.55);
  ctx.lineTo(w * 0.85, h);
  ctx.lineTo(w * 0.15, h);
  ctx.closePath();
  ctx.fill();
}
paintBackdrop();
addEventListener('resize', paintBackdrop);

// ------------------------------------------------------------------ HUD + input

const records = {
  sprint: { time: 214.37 },
  circuit: { time: 441.02 },
  drift: { score: 48210 },
};
let settings = normalizeSettings(DEFAULT_SETTINGS);
const app = document.getElementById('app');
const hud = new Hud(app, { settings, modes: MODES, records });
const input = new Input({ root: app, touchRoot: hud.touchRoot });
hud.setTrack(TRACK);
hud.setActiveRoad(0);
window.hud = hud;
window.input = input;

const out = document.getElementById('hx-out');
const log = (line) => { out.textContent = line; };

// ------------------------------------------------------------------ fake session

const sim = {
  state: 'menu', // menu | countdown | race | pause | finish
  modeId: 'circuit',
  s: 0,
  t: 0,
  elapsed: 0,
  lapTime: 0,
  lap: 1,
  lastLap: null,
  bestLap: null,
  laps: [],
  countdown: 0,
  wrongWay: false,
  offRoad: false,
  driftScore: 0,
  bank: 0,
  mult: 1,
  topSpeed: 0,
  boost: 100,
  camera: 0,
};
const CAMERAS = ['Chase', 'Hood', 'Bumper', 'Orbit'];
const sample = { x: 0, z: 0, h: 0, heading: 0, grade: 0 };

function mode() {
  return MODES.find((m) => m.id === sim.modeId) || MODES[0];
}

function resetRun() {
  Object.assign(sim, {
    s: 0, elapsed: 0, lapTime: 0, lap: 1, lastLap: null, bestLap: null, laps: [], driftScore: 0, bank: 0, mult: 1, topSpeed: 0, boost: 100,
  });
}

function startRace(modeId = sim.modeId) {
  sim.modeId = modeId;
  resetRun();
  hud.setActiveRoad(mode().route === 'climb' || mode().route === 'descent' ? 1 : 0);
  hud.showRace();
  sim.state = 'countdown';
  sim.countdown = 3.999;
  input.setDrivingEnabled(false);
}

function finish(kind = 'time') {
  sim.state = 'finish';
  input.setDrivingEnabled(false);
  hud.setCountdown('');
  if (kind === 'drift') {
    hud.showFinish({ modeId: 'drift', modeLabel: 'Drift Session', time: 120, score: 53480, bestScore: 48210, isRecord: true, topSpeedKmh: 167.4, respawns: 1, laps: [] });
  } else {
    const laps = sim.laps.length > 1 ? sim.laps : [221.43, 214.87, 218.02];
    const time = laps.reduce((a, b) => a + b, 0);
    hud.showFinish({ modeId: 'circuit', modeLabel: 'Ridge Circuit', time, bestTime: 441.02, isRecord: false, score: 12840, topSpeedKmh: Math.max(sim.topSpeed, 212.6), respawns: 2, laps });
  }
}

hud.onStart = (id) => startRace(id);
hud.onPause = () => { sim.state = 'pause'; input.setDrivingEnabled(false); hud.showPause('Drift score is frozen while paused.'); };
hud.onResume = () => { sim.state = 'race'; hud.showRace(); input.setDrivingEnabled(true); };
hud.onRestart = () => startRace();
hud.onMenu = () => { sim.state = 'menu'; input.setDrivingEnabled(false); hud.setActiveRoad(0); hud.showMenu(); };
hud.onOpenSettings = (source) => log(`onOpenSettings(${source})`);
hud.onCloseSettings = (source) => { log(`onCloseSettings(${source})`); if (source === 'pause') hud.showPause('Drift score is frozen while paused.'); else hud.showMenu(); };
hud.onApplySettings = (next) => {
  settings = next;
  hud.setSettings(next);
  input.setManualShift(next.transmission === 'manual');
  log(`onApplySettings\n${JSON.stringify(next, null, 1)}`);
  if (sim.state === 'pause') hud.showPause('Drift score is frozen while paused.'); else hud.showMenu();
};
hud.onFullscreen = () => {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => hud.toast('Fullscreen blocked', 'warn'));
};
hud.onCamera = () => { sim.camera = (sim.camera + 1) % CAMERAS.length; };
hud.onRespawn = () => { sim.offRoad = false; hud.toast('Respawned', 'info'); };

// ------------------------------------------------------------------ loading sequence

function runLoading(then = () => hud.showMenu()) {
  const stages = ['Generating terrain', 'Carving roads', 'Planting forest', 'Building car', 'Compiling shaders', 'Ready'];
  let p = 0;
  hud.showLoading(0, stages[0]);
  const tick = () => {
    p += 0.012 + Math.random() * 0.02;
    if (p >= 1) {
      hud.showLoading(1, stages[stages.length - 1]);
      setTimeout(() => { hud.hideLoading(); then(); }, 250);
      return;
    }
    hud.showLoading(p, stages[Math.min(stages.length - 2, Math.floor(p * (stages.length - 1)))]);
    setTimeout(tick, 40);
  };
  tick();
}

// ------------------------------------------------------------------ frame loop

const frame = {
  speedKmh: 0, gear: 1, rpm: 900, rpmMax: 7200, throttle: 0, brake: 0, boost: 100, boosting: false, surface: 'asphalt',
  position: { x: 0, z: 0 }, heading: 0, altitude: 0, grade: 0,
  drift: { active: false, angleDeg: 0, score: 0, bank: 0, multiplier: 1, comboTimer: 0, comboWindow: 2 },
  session: { modeId: 'circuit', modeLabel: '', lap: 1, laps: 2, elapsed: 0, lapTime: 0, bestLap: null, lastLap: null, progress: 0, timeLeft: null, wrongWay: false, offRoad: false },
  camera: CAMERAS[0],
  debug: '',
};
const GEAR_TOP = [0, 48, 84, 118, 152, 188, 240];

let last = performance.now();
function tickFrame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const ctl = input.update();

  // Edge actions, as the game loop would handle them.
  if (ctl.pause) {
    if (sim.state === 'race' || sim.state === 'countdown') hud.onPause();
    else if (sim.state === 'pause') hud.onResume();
  }
  if (ctl.camera) hud.onCamera();
  if (ctl.debug) { harnessDebug = !harnessDebug; hud.setDebugVisible(harnessDebug); }
  if (ctl.respawn && sim.state === 'race') hud.onRespawn();
  if (ctl.fullscreen) hud.onFullscreen();
  if (ctl.shift) hud.toast(ctl.shift > 0 ? 'Shift up' : 'Shift down', 'info');

  const running = sim.state === 'race' || sim.state === 'countdown';
  if (sim.state === 'countdown') {
    sim.countdown -= dt;
    if (sim.countdown <= 0) {
      sim.state = 'race';
      hud.setCountdown('GO');
      input.setDrivingEnabled(true);
      setTimeout(() => { if (sim.state === 'race') hud.setCountdown(''); }, 800);
    } else {
      hud.setCountdown(String(Math.ceil(sim.countdown - 0.999)));
    }
  }
  if (sim.state === 'race' || sim.state === 'menu') sim.t += dt;

  // Speed: driver input if any, else a scripted profile.
  const scripted = 120 + 95 * Math.sin(sim.t * 0.35) + 15 * Math.sin(sim.t * 1.7);
  const driven = ctl.throttle > 0 || ctl.brake > 0;
  let kmh = sim.state === 'race' ? (driven ? Math.max(0, frame.speedKmh + (ctl.throttle * 40 - ctl.brake * 90) * dt) : scripted) : sim.state === 'countdown' ? 0 : frame.speedKmh;
  if (sim.state === 'menu') kmh = 0;
  kmh = Math.max(0, kmh);
  const boosting = sim.state === 'race' && (ctl.boost || Math.sin(sim.t * 0.5) > 0.85) && sim.boost > 0;
  sim.boost = Math.max(0, Math.min(100, sim.boost + (boosting ? -24 : 6) * dt));

  if (sim.state === 'race') {
    const dir = sim.wrongWay ? -1 : 1;
    sim.s += dir * (kmh / 3.6) * dt;
    sim.elapsed += dt;
    sim.lapTime += dt;
    sim.topSpeed = Math.max(sim.topSpeed, kmh);
    const m = mode();
    if (m.laps > 0 && sim.s >= LOOP_LEN * sim.lap) {
      const lapT = sim.lapTime;
      sim.laps.push(lapT);
      const isBest = sim.bestLap == null || lapT < sim.bestLap;
      sim.lastLap = lapT;
      sim.bestLap = isBest ? lapT : sim.bestLap;
      sim.lapTime = 0;
      hud.toast(`Lap ${sim.lap} · ${lapT.toFixed(2)} s${isBest ? ' · best lap' : ''}`, isBest ? 'good' : 'info');
      sim.lap += 1;
      if (sim.lap > m.laps) finish('time');
    }
    if (m.timeLimit && sim.elapsed >= m.timeLimit) finish('drift');
  }

  // Gear and rpm from speed.
  let gear = 1;
  while (gear < 6 && kmh > GEAR_TOP[gear]) gear += 1;
  const lo = GEAR_TOP[gear - 1] * 0.82;
  const hi = GEAR_TOP[gear];
  const rpm = sim.state === 'menu' ? 900 + 60 * Math.sin(sim.t * 3) : 1600 + Math.max(0, Math.min(1.04, (kmh - lo) / (hi - lo))) * (frame.rpmMax - 1600);

  // Drift cycle: 3.5 s sliding, 2 s combo window, 4.5 s calm.
  const cyc = sim.t % 10;
  const d = frame.drift;
  if (sim.state === 'race') {
    if (cyc < 3.5) {
      d.active = true;
      d.angleDeg = 22 + 18 * Math.sin(cyc * 2.1);
      sim.bank += d.angleDeg * kmh * 0.02 * dt * 10;
      sim.mult = Math.min(5, 1 + cyc * 0.6);
      d.comboTimer = d.comboWindow;
    } else if (cyc < 5.5) {
      d.active = false;
      d.angleDeg = 0;
      d.comboTimer = Math.max(0, 5.5 - cyc);
    } else if (sim.bank > 0) {
      const gained = Math.round(sim.bank * sim.mult);
      sim.driftScore += gained;
      hud.toast(`Drift banked +${gained.toLocaleString('en-US')}`, 'good');
      sim.bank = 0;
      sim.mult = 1;
      d.comboTimer = 0;
    }
  }
  d.bank = sim.bank;
  d.multiplier = sim.mult;
  d.score = sim.driftScore;

  sampleLoop(sim.s, sample);
  const m = mode();
  const ss = frame.session;
  ss.modeId = m.id;
  ss.modeLabel = m.label;
  ss.laps = m.laps;
  ss.lap = Math.min(sim.lap, Math.max(1, m.laps));
  ss.elapsed = sim.elapsed;
  ss.lapTime = sim.lapTime;
  ss.lastLap = sim.lastLap;
  ss.bestLap = sim.bestLap;
  ss.progress = m.laps > 0 ? Math.min(1, sim.s / (LOOP_LEN * m.laps)) : (sim.s % LOOP_LEN) / LOOP_LEN;
  ss.timeLeft = m.timeLimit ? Math.max(0, m.timeLimit - sim.elapsed) : null;
  ss.wrongWay = sim.wrongWay;
  ss.offRoad = sim.offRoad;

  frame.speedKmh = kmh;
  frame.gear = sim.state === 'countdown' ? 'N' : gear;
  frame.rpm = sim.state === 'countdown' ? 1200 + 2500 * Math.abs(Math.sin(sim.countdown * 4)) : rpm;
  frame.throttle = sim.state === 'race' ? (driven ? ctl.throttle : 0.6 + 0.4 * Math.sin(sim.t * 0.9)) : 0;
  frame.brake = sim.state === 'race' ? (driven ? ctl.brake : Math.max(0, -Math.sin(sim.t * 0.9))) : 0;
  frame.boost = sim.boost;
  frame.boosting = boosting;
  frame.position.x = sample.x;
  frame.position.z = sample.z;
  frame.heading = sim.wrongWay ? sample.heading + Math.PI : sample.heading;
  frame.altitude = sample.h;
  frame.grade = sim.wrongWay ? -sample.grade : sample.grade;
  frame.camera = CAMERAS[sim.camera];
  frame.debug = `fps ${(1 / Math.max(dt, 1e-3)).toFixed(0)}\nstate ${sim.state}\ns ${sim.s.toFixed(1)} / ${LOOP_LEN.toFixed(0)} m\ninput thr ${ctl.throttle.toFixed(2)} brk ${ctl.brake.toFixed(2)} str ${ctl.steer.toFixed(2)}\nhb ${ctl.handbrake} boost ${ctl.boost} look ${ctl.freeLook.active ? `${ctl.freeLook.x.toFixed(2)},${ctl.freeLook.y.toFixed(2)}` : '-'} pad ${ctl.gamepad}`;

  if (running || sim.state === 'pause' || sim.state === 'menu') hud.update(frame);
  if (Math.floor(now / 250) !== Math.floor((now - dt * 1000) / 250) && !out.dataset.sticky) {
    out.textContent = `state ${sim.state}\nthr ${ctl.throttle.toFixed(2)} brk ${ctl.brake.toFixed(2)}\nsteer ${ctl.steer.toFixed(2)} hb ${ctl.handbrake ? 1 : 0} n2o ${ctl.boost ? 1 : 0}\nlook ${ctl.freeLook.active ? 'on' : 'off'} pad ${ctl.gamepad ? 'yes' : 'no'}\ntouch ${input.touchActive ? 'on' : 'off'}`;
  }
  requestAnimationFrame(tickFrame);
}
let harnessDebug = false;
requestAnimationFrame(tickFrame);

// ------------------------------------------------------------------ DOM-write self test

function domWriteTest() {
  const before = JSON.parse(JSON.stringify(frame));
  hud.update(frame);
  let mutations = 0;
  const mo = new MutationObserver((list) => { mutations += list.length; });
  mo.observe(hud.el, { subtree: true, childList: true, attributes: true, characterData: true });
  for (let i = 0; i < 5; i += 1) hud.update(frame);
  const pending = mo.takeRecords().length;
  mo.disconnect();
  const total = mutations + pending;
  const line = `DOM-write test: ${total} mutations for 5 identical update() calls (${total === 0 ? 'PASS' : 'FAIL'})`;
  out.dataset.sticky = '1';
  out.textContent = line;
  setTimeout(() => delete out.dataset.sticky, 4000);
  void before;
  return total;
}
window.domWriteTest = domWriteTest;

// ------------------------------------------------------------------ harness controls

const modeSelect = document.querySelector('[data-h="mode"]');
for (const m of MODES) modeSelect.add(new Option(m.label, m.id, false, m.id === sim.modeId));
modeSelect.addEventListener('change', () => startRace(modeSelect.value));

const harnessPanel = document.getElementById('harness');
if (params.get('hx') === '0') harnessPanel.style.display = 'none';
harnessPanel.addEventListener('click', (event) => {
  const b = event.target.closest('[data-h]');
  if (!b || b.tagName === 'SELECT') return;
  b.blur();
  switch (b.dataset.h) {
    case 'collapse': harnessPanel.classList.toggle('is-collapsed'); break;
    case 'loading': runLoading(); break;
    case 'menu': hud.onMenu(); break;
    case 'race': startRace(); break;
    case 'pause': if (sim.state !== 'race') { startRace(); sim.state = 'race'; sim.countdown = 0; hud.setCountdown(''); } hud.onPause(); break;
    case 'finish': finish('time'); break;
    case 'finish-drift': finish('drift'); break;
    case 'settings': hud.openSettings(sim.state === 'pause' ? 'pause' : 'menu'); break;
    case 'wrongway': sim.wrongWay = !sim.wrongWay; break;
    case 'offroad': sim.offRoad = !sim.offRoad; break;
    case 'toast-info': hud.toast('Checkpoint 2 · 1:12.40', 'info'); break;
    case 'toast-good': hud.toast('Sector best −0.84', 'good'); break;
    case 'toast-warn': hud.toast('Nitro empty', 'warn'); break;
    case 'debug': harnessDebug = !harnessDebug; hud.setDebugVisible(harnessDebug); break;
    case 'touch': input.touchSeen = !input.touchSeen; input.refreshTouchVisibility(); break;
    case 'manual': input.setManualShift(!input.manualShift); break;
    case 'bg-snow': backdrop = 'snow'; paintBackdrop(); break;
    case 'bg-forest': backdrop = 'forest'; paintBackdrop(); break;
    case 'bg-mixed': backdrop = 'mixed'; paintBackdrop(); break;
    case 'selftest': domWriteTest(); break;
    default: break;
  }
});

// ------------------------------------------------------------------ initial screen

if (params.get('touch') === '1') { input.touchSeen = true; input.refreshTouchVisibility(); }
const initial = params.get('screen') || 'loading';
const go = {
  loading: () => runLoading(),
  menu: () => hud.showMenu(),
  race: () => { startRace(); sim.countdown = 0.01; },
  pause: () => { startRace(); sim.state = 'race'; sim.countdown = 0; hud.setCountdown(''); sim.t = 1; for (let i = 0; i < 3; i += 1) hud.update(frame); hud.onPause(); },
  finish: () => finish('time'),
  'finish-drift': () => finish('drift'),
  settings: () => { hud.showMenu(); hud.openSettings('menu'); },
};
(go[initial] || go.loading)();
if (initial === 'race' || initial === 'pause') { sim.state = initial === 'pause' ? 'pause' : 'race'; input.setDrivingEnabled(initial === 'race'); }

// ------------------------------------------------------------------ layout check: window.layoutCheck()
// Reports HUD blocks that leave the viewport or overlap each other, plus horizontal page scroll.
window.layoutCheck = () => {
  const sel = ['.sdh-tl', '.sdh-tc', '.sdh-iconbar', '.sdh-map', '.sdh-elev', '.sdh-drift', '.sdh-speedo', '.sdt-steer', '.sdt-pedals', '.sdt-actions', '.sdh-panel.is-open'];
  const W = innerWidth;
  const H = innerHeight;
  const boxes = [];
  for (const s of sel) {
    const e = document.querySelector(s);
    if (!e || getComputedStyle(e).display === 'none' || e.closest('.sdh-race,.sdh-touch') && getComputedStyle(e.closest('.sdh-race,.sdh-touch')).visibility === 'hidden') continue;
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 2) continue;
    boxes.push([s, r]);
  }
  const issues = [];
  for (const [s, r] of boxes) {
    if (s.startsWith('.sdh-panel')) continue;
    if (r.left < -0.5 || r.top < -0.5 || r.right > W + 0.5 || r.bottom > H + 0.5) issues.push(`clip ${s}`);
  }
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const [a, ra] = boxes[i];
      const [b, rb] = boxes[j];
      if (a.startsWith('.sdh-panel') || b.startsWith('.sdh-panel')) continue; // race HUD is dimmed under panels by design
      if (ra.left < rb.right - 1 && rb.left < ra.right - 1 && ra.top < rb.bottom - 1 && rb.top < ra.bottom - 1) issues.push(`overlap ${a} x ${b}`);
    }
  }
  if (document.documentElement.scrollWidth > W) issues.push('horizontal scroll');
  const panel = document.querySelector('.sdh-panel.is-open');
  if (panel && panel.getBoundingClientRect().right > W + 0.5) issues.push('panel clipped');
  return { W, H, issues };
};
