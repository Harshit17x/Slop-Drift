import * as THREE from 'three';
import {
  CONFIG, MODES, SURFACE_PROPS, getMode, getPaint, getQualityPreset,
  loadRecords, loadSettings, normalizeSettings, saveRecords, saveSettings,
} from '../config.js';
import { clamp } from './math.js';
import { nextFrame } from './yield.js';
import { World } from '../world/World.js';
import { Vehicle } from '../vehicle/Vehicle.js';
import { DriftScorer } from '../vehicle/DriftScorer.js';
import { RaceSession } from '../game/RaceSession.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { Input } from '../input/Input.js';
import { Hud, formatDelta, formatTime } from '../ui/Hud.js';
import { TerrainView } from '../render/TerrainView.js';
import { WaterView } from '../render/WaterView.js';
import { RoadView } from '../render/RoadView.js';
import { Scenery } from '../render/Scenery.js';
import { Atmosphere } from '../render/Atmosphere.js';
import { CarVisual } from '../render/CarVisual.js';
import { CameraRig } from '../render/CameraRig.js';
import { Effects } from '../render/Effects.js';

// Parks the car (menu, countdown). Handbrake only: holding the brake pedal at a standstill would
// select reverse, and the race would then start in R.
const HOLD = Object.freeze({ throttle: 0, brake: 0, steer: 0, handbrake: true, boost: false, shift: 0 });

/**
 * Owns the frame loop and the game state machine:
 *   loading -> menu -> countdown -> running <-> paused -> finished -> menu
 * Everything else (world, vehicle, session, views, HUD, audio) is a collaborator it wires together.
 */
export class Game {
  constructor(root) {
    this.root = root;
    this.settings = loadSettings();
    this.records = loadRecords();
    this.state = 'loading';
    this.mode = MODES[0];
    this.session = null;
    this.nitro = CONFIG.nitro.capacity;
    this.countdown = 0;
    this.countdownShown = '';
    this.goTimer = 0;
    this.stuckTimer = 0;
    this.headlightsWanted = false;
    this.debugVisible = false;
    this.lastTime = 0;
    this.fps = 60;
    this.pose = { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };
    this.location = {};
    this.controls = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false, shift: 0 };
    this.audioFlags = { drifting: false, boosting: false, paused: false };
    this.hudFrame = {
      speedKmh: 0, gear: 'N', rpm: 0, rpmMax: 7200, throttle: 0, brake: 0, boost: 100, boosting: false,
      surface: 'asphalt', position: { x: 0, z: 0 }, heading: 0, altitude: 0, grade: 0,
      drift: null, session: null, camera: 'CHASE', debug: '',
    };
    this.onFrame = this.onFrame.bind(this);
    this.onResize = this.onResize.bind(this);
    // Frames stop in a background tab; pause the race rather than let the clock jump on return.
    this.onVisibility = () => {
      if (document.hidden) this.pause();
    };
  }

  // ---------------------------------------------------------------- startup

  async init() {
    this.createRenderer();
    this.hud = new Hud(this.root, { settings: this.settings, modes: MODES, records: this.records });
    this.hud.showLoading(0, 'Starting up');
    this.input = new Input({ root: this.root, touchRoot: this.hud.touchRoot });
    this.audio = new AudioEngine({ volume: this.settings.volume });
    this.bindHud();
    this.bindAudioUnlock();
    await nextFrame();

    // Seconds spent in each loading stage, shown in the debug panel.
    this.loadTimings = [];
    let stageLabel = 'Starting up';
    let stageStart = performance.now();
    const mark = (label) => {
      const now = performance.now();
      if (label !== stageLabel) {
        this.loadTimings.push([stageLabel, Math.round(now - stageStart)]);
        stageLabel = label;
        stageStart = now;
      }
    };

    const quality = getQualityPreset(this.settings.quality);
    this.world = new World();
    await this.world.build((fraction, label) => {
      mark(label);
      this.hud.showLoading(fraction * 0.72, label);
    });

    // Views are built one per frame so the progress bar keeps moving.
    const stages = [
      ['Shaping the terrain', () => { this.terrain = new TerrainView({ world: this.world, quality }); this.scene.add(this.terrain.group); }],
      ['Filling the lake', () => { this.water = new WaterView({ world: this.world }); this.scene.add(this.water.group); }],
      ['Paving the roads', () => { this.roads = new RoadView({ world: this.world, quality }); this.scene.add(this.roads.group); }],
      ['Planting the forest', () => { this.scenery = new Scenery({ world: this.world, quality }); this.scene.add(this.scenery.group); }],
      ['Lighting the sky', () => { this.atmosphere = new Atmosphere({ scene: this.scene, renderer: this.renderer, world: this.world, quality }); }],
      ['Warming the engine', () => this.createVehicle()],
    ];
    for (let i = 0; i < stages.length; i += 1) {
      mark(stages[i][0]);
      this.hud.showLoading(0.72 + (0.26 * i) / stages.length, stages[i][0]);
      await nextFrame();
      stages[i][1]();
    }
    mark('Ready');

    this.hud.setTrack(this.world.getMapData());
    this.applySettings(this.settings, { save: false });
    this.enterMenu();
    this.onResize();
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.hud.showLoading(1, 'Ready');
    await nextFrame();
    this.hud.hideLoading();
    this.lastTime = performance.now();
    this.frameHandle = requestAnimationFrame(this.onFrame);
    return this;
  }

  createRenderer() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'game-canvas';
    this.root.prepend(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
  }

  createVehicle() {
    this.vehicle = new Vehicle({ world: this.world, handling: this.settings.handling });
    this.drift = new DriftScorer();
    this.car = new CarVisual({ color: getPaint(this.settings.paint).color, wheelLayout: this.vehicle.wheelLayout });
    this.scene.add(this.car.group);
    this.cameraRig = new CameraRig({ world: this.world });
    this.effects = new Effects(this.scene);
  }

  bindHud() {
    const hud = this.hud;
    hud.onStart = (modeId) => this.beginRun(modeId);
    hud.onPause = () => this.pause();
    hud.onResume = () => this.resume();
    hud.onRestart = () => this.beginRun(this.mode.id);
    hud.onMenu = () => this.enterMenu();
    hud.onRespawn = () => {
      if (this.state === 'paused') this.resume();
      this.respawn();
    };
    hud.onCamera = () => this.cameraRig.cycle();
    hud.onFullscreen = () => this.toggleFullscreen();
    hud.onOpenSettings = () => {};
    // The HUD closes its own settings panel; put the screen underneath back.
    hud.onCloseSettings = (source) => this.restoreAfterSettings(source);
    hud.onApplySettings = (settings) => {
      const source = this.state === 'paused' ? 'pause' : 'menu';
      this.applySettings(settings);
      this.restoreAfterSettings(source);
    };
  }

  restoreAfterSettings(source) {
    if (source === 'pause' && this.state === 'paused') this.hud.showPause();
    else this.hud.showMenu();
  }

  /** Browsers only start audio after a user gesture. */
  bindAudioUnlock() {
    const unlock = () => {
      this.audio.unlock();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  // ---------------------------------------------------------------- settings

  applySettings(settings, { save = true } = {}) {
    this.settings = normalizeSettings(settings);
    if (save) saveSettings(this.settings);
    const quality = getQualityPreset(this.settings.quality);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
    this.terrain.setQuality(quality);
    this.scenery.setQuality(quality);
    this.atmosphere.setQuality(quality);
    this.atmosphere.setTimeOfDay(this.settings.timeOfDay);
    this.effects.setQuality(quality);
    this.roads.setNight?.(this.atmosphere.isNight);
    this.terrain.setSun?.(this.atmosphere.sunDirection, this.atmosphere.sunColor, this.atmosphere.ambientColor);
    this.car.setColor(getPaint(this.settings.paint).color);
    this.car.setHeadlights(this.atmosphere.isNight || this.headlightsWanted);
    this.vehicle.setHandling(this.settings.handling);
    this.vehicle.setAssists({ driftAssist: this.settings.driftAssist, abs: this.settings.abs, transmission: this.settings.transmission });
    this.input.setManualShift(this.settings.transmission === 'manual');
    this.audio.setVolume(this.settings.volume);
    this.cameraRig.shakeEnabled = this.settings.cameraShake;
    this.hud.setSettings(this.settings);
    this.onResize();
  }

  // ---------------------------------------------------------------- state changes

  enterMenu() {
    this.state = 'menu';
    this.session = null;
    this.audio.silence();
    this.input.setDrivingEnabled(false);
    this.roads.setRoute(null);
    this.hud.setCountdown('');
    this.hud.setRecords(this.records);
    this.hud.showMenu();
    const route = this.world.routes.loop;
    this.vehicle.teleport(this.world.getSpawn('loop', route.startS - 8, this.pose));
    this.drift.reset();
    this.effects.clear();
    this.cameraRig.startBlend();
  }

  beginRun(modeId) {
    this.audio.unlock();
    this.mode = getMode(modeId);
    const route = this.world.routes[this.mode.route];
    this.session = new RaceSession({ world: this.world, mode: this.mode, records: this.records });
    this.vehicle.teleport(this.session.getStartPose(this.pose));
    this.drift.reset();
    this.effects.clear();
    this.nitro = CONFIG.nitro.capacity;
    this.stuckTimer = 0;
    this.roads.setRoute(this.mode.id === 'roam' ? null : route);
    this.hud.setActiveRoad(route.roadId);
    this.hud.showRace();
    this.cameraRig.setMode('chase');
    this.cameraRig.snap();
    this.input.setDrivingEnabled(false);
    this.state = 'countdown';
    this.countdown = CONFIG.race.countdownSeconds;
    this.countdownShown = '';
  }

  pause() {
    if (this.state !== 'running' && this.state !== 'countdown') return;
    this.pausedFrom = this.state;
    this.state = 'paused';
    this.input.setDrivingEnabled(false);
    this.audio.silence();
    this.hud.showPause(this.mode.id === 'drift' ? 'The clock and your combo are frozen.' : '');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = this.pausedFrom || 'running';
    this.hud.showRace();
    this.input.setDrivingEnabled(this.state === 'running');
  }

  finish(result) {
    this.state = 'finished';
    this.input.setDrivingEnabled(false);
    this.audio.finish();
    saveRecords(this.records);
    this.hud.setRecords(this.records);
    this.hud.setCountdown('');
    this.hud.showFinish(result);
    this.cameraRig.startBlend();
  }

  respawn() {
    if (!this.session || this.state !== 'running') return;
    this.vehicle.teleport(this.session.getRespawnPose(this.pose));
    this.session.addRespawn();
    this.drift.reset({ preserveBank: true });
    this.cameraRig.snap();
    this.audio.respawn();
    this.stuckTimer = 0;
    this.hud.toast('Back on the road', 'warn');
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
  }

  // ---------------------------------------------------------------- per-frame

  handleGlobalInput(input) {
    if (input.fullscreen) this.toggleFullscreen();
    if (input.mute) this.audio.toggleMute();
    if (input.debug) {
      this.debugVisible = !this.debugVisible;
      this.hud.setDebugVisible(this.debugVisible);
    }
    if (input.pause) {
      if (this.state === 'paused') this.resume();
      else this.pause();
    }
    if (this.state !== 'running' && this.state !== 'countdown') return;
    if (input.camera) this.cameraRig.cycle();
    if (input.headlights) {
      this.headlightsWanted = !this.car.headlightsOn;
      this.car.setHeadlights(this.headlightsWanted);
      this.audio.ui();
    }
    if (input.respawn) this.respawn();
    if (input.transmission) {
      const transmission = this.settings.transmission === 'auto' ? 'manual' : 'auto';
      this.applySettings({ ...this.settings, transmission });
      this.hud.toast(transmission === 'manual' ? 'Manual gearbox (Q / E)' : 'Automatic gearbox', 'info');
    }
  }

  updateCountdown(dt) {
    this.countdown -= dt;
    const shown = this.countdown > 0 ? String(Math.ceil(this.countdown)) : 'GO';
    if (shown !== this.countdownShown) {
      this.countdownShown = shown;
      this.hud.setCountdown(shown);
      this.audio.countdown(shown === 'GO' ? 'GO' : Number(shown));
    }
    if (this.countdown <= 0) {
      this.state = 'running';
      this.goTimer = 0.9;
      this.input.setDrivingEnabled(true);
    }
    return this.vehicle.step(dt, HOLD);
  }

  updateRunning(dt, input) {
    const controls = this.controls;
    const boosting = input.boost && input.throttle > 0.1 && this.nitro > 0.5;
    controls.throttle = input.throttle;
    controls.brake = input.brake;
    controls.steer = input.steer;
    controls.handbrake = input.handbrake;
    controls.boost = boosting;
    controls.shift = input.shift;

    const state = this.vehicle.step(dt, controls);
    const drift = this.drift.update(dt, state, controls);

    const nitro = CONFIG.nitro;
    if (boosting) this.nitro = Math.max(0, this.nitro - nitro.drainPerSecond * dt);
    else this.nitro = Math.min(nitro.capacity, this.nitro + (nitro.refillPerSecond + (drift.active ? nitro.driftRefill : 0)) * dt);

    if (drift.event === 'drift_end' && drift.lastDriftScore > 0) this.hud.toast(`Drift +${drift.lastDriftScore.toLocaleString()}`, 'good');
    else if (drift.event === 'wipeout') this.hud.toast('Drift lost', 'warn');

    const events = this.session.update(dt, state, drift);
    for (let i = 0; i < events.length; i += 1) this.handleSessionEvent(events[i]);

    this.effects.emit(dt, state);
    this.audioFlags.drifting = drift.active;
    this.audioFlags.boosting = boosting;
    this.audio.update(dt, state, this.audioFlags);
    if (state.shifted) this.audio.shift();
    this.checkStuck(dt, state);
    return state;
  }

  handleSessionEvent(event) {
    if (event.type === 'checkpoint') {
      this.audio.checkpoint();
      const split = event.split === null || event.split === undefined ? '' : `  ${formatDelta(event.split)}`;
      this.hud.toast(`Checkpoint ${event.index + 1}/${event.total}${split}`, event.split !== null && event.split !== undefined && event.split > 0 ? 'warn' : 'good');
    } else if (event.type === 'lap') {
      this.audio.checkpoint();
      this.hud.toast(`Lap ${event.lap}  ${formatTime(event.time)}${event.isBest ? '  best lap' : ''}`, 'good');
    } else if (event.type === 'finish') {
      this.finish(event.result);
    }
  }

  /** Put the car back on the road if it ends up on its roof, in the lake, or far out of bounds. */
  checkStuck(dt, state) {
    const drowned = state.position.y < this.world.waterLevel - 0.9;
    const flipped = state.upsideDown && state.speed < 3;
    if (drowned || flipped) this.stuckTimer += dt;
    else this.stuckTimer = 0;
    if (this.stuckTimer > (drowned ? 1.2 : 2.2) && this.state === 'running') this.respawn();
  }

  updateHud(state) {
    const frame = this.hudFrame;
    const session = this.session;
    frame.speedKmh = state.speedKmh;
    frame.gear = state.gear;
    frame.rpm = state.rpm;
    frame.rpmMax = state.rpmMax;
    frame.throttle = state.throttle;
    frame.brake = state.brake;
    frame.boost = this.nitro;
    frame.boosting = state.boosting;
    frame.surface = SURFACE_PROPS[state.surface]?.name || 'asphalt';
    frame.position.x = state.position.x;
    frame.position.z = state.position.z;
    frame.heading = Math.atan2(state.forward.x, -state.forward.z);
    frame.altitude = state.position.y - this.world.config.mountain.valleyFloor;
    const location = this.world.locate(state.position.x, state.position.z, this.location);
    if (location.roadId >= 0 && location.distance < location.halfWidth + 6) {
      const along = location.tx * state.forward.x + location.tz * state.forward.z;
      frame.grade = location.grade * 100 * (along >= 0 ? 1 : -1);
    } else {
      frame.grade = (state.forward.y / Math.max(0.2, Math.hypot(state.forward.x, state.forward.z))) * 100;
    }
    frame.drift = this.drift.snapshot();
    frame.session = session ? session.hud : null;
    frame.camera = this.cameraRig.label;
    if (this.debugVisible) {
      const info = this.renderer.info.render;
      frame.debug = `${this.fps.toFixed(0)} fps   ${info.calls} calls   ${(info.triangles / 1000).toFixed(0)}k tris\n`
        + `state ${this.state}   mode ${this.mode.id}\n`
        + `pos ${state.position.x.toFixed(0)}, ${state.position.y.toFixed(1)}, ${state.position.z.toFixed(0)}\n`
        + `speed ${state.speedKmh.toFixed(1)} km/h   slip ${(state.slipAngle * 57.3).toFixed(1)} deg\n`
        + `wheels ${state.wheelsOnGround}   surface ${frame.surface}   g ${state.gLong.toFixed(2)} / ${state.gLat.toFixed(2)}`;
    }
    if (session) this.hud.update(frame);
  }

  onFrame(now) {
    this.frameHandle = requestAnimationFrame(this.onFrame);
    const dt = clamp((now - this.lastTime) / 1000, 0, 0.1);
    this.lastTime = now;
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.05;

    const input = this.input.update();
    this.handleGlobalInput(input);

    let state;
    const paused = this.state === 'paused';
    if (this.state === 'running') state = this.updateRunning(dt, input);
    else if (this.state === 'countdown') state = this.updateCountdown(dt);
    else if (paused) state = this.vehicle.getState();
    else state = this.vehicle.step(dt, HOLD);

    if (this.goTimer > 0) {
      this.goTimer -= dt;
      if (this.goTimer <= 0) this.hud.setCountdown('');
    }

    this.car.sync(state);
    if (this.state === 'menu') this.cameraRig.orbit(dt, state.position, { radius: 11, height: 3.4, speed: 0.1 });
    else if (this.state === 'finished') this.cameraRig.orbit(dt, state.position, { radius: 8, height: 2.6, speed: 0.22 });
    else if (!paused) this.cameraRig.follow(dt, state, input);

    const camera = this.cameraRig.camera;
    if (!paused) {
      this.effects.update(dt);
      this.water.update(dt, camera);
    }
    this.effects.setLight(this.atmosphere.ambientColor);
    this.effects.setViewport(this.renderer.domElement.height, camera.fov);
    this.atmosphere.update(paused ? 0 : dt, camera, state.position);
    this.terrain.update(camera.position);
    this.scenery.update(camera.position);
    this.updateHud(state);
    this.renderer.render(this.scene, camera);
  }

  onResize() {
    const width = Math.max(1, this.root.clientWidth || window.innerWidth);
    const height = Math.max(1, this.root.clientHeight || window.innerHeight);
    this.renderer.setSize(width, height, false);
    this.cameraRig?.resize(width, height);
  }

  dispose() {
    cancelAnimationFrame(this.frameHandle);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.input?.destroy();
    this.audio?.dispose();
    this.effects?.dispose();
    this.car?.dispose();
    this.scenery?.dispose();
    this.roads?.dispose();
    this.water?.dispose();
    this.terrain?.dispose();
    this.atmosphere?.dispose();
    this.hud?.destroy();
    this.renderer?.dispose();
    this.canvas?.remove();
  }
}
