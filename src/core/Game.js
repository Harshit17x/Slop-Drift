import * as THREE from 'three';
import {
  CONFIG, MODES, SURFACE_PROPS, detectInitialQuality, getMode, getQualityPreset, modesForWorld, neonLevel, nextAutoQuality,
  getSmoke, loadRecords, loadSettings, normalizeSettings, saveRecords, saveSettings,
} from '../config.js';
import { clamp } from './math.js';
import { nextFrame } from './yield.js';
import { World } from '../world/World.js';
import { getMap, loadMapData, MAPS } from '../world/maps.js';
import { RENDER_SCALE, createRenderScale, stepRenderScale } from './renderScale.js';
import { mirroredStorage } from '../platform/progressStorage.js';
import { Vehicle } from '../vehicle/Vehicle.js';
import { DriftScorer } from '../vehicle/DriftScorer.js';
import { RaceSession } from '../game/RaceSession.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { Input } from '../input/Input.js';
import { Hud, formatDelta, formatTime } from '../ui/Hud.js';
import { TerrainView } from '../render/TerrainView.js';
import { WASHOUT, inWashout } from '../world/jungleStage.js';
import { BRIDGE } from '../world/Jungle.js';
import { RoadView } from '../render/RoadView.js';
import { Scenery } from '../render/Scenery.js';
import { Atmosphere } from '../render/Atmosphere.js';
import { CarVisual } from '../render/CarVisual.js';
import { CameraRig } from '../render/CameraRig.js';
import { Effects } from '../render/Effects.js';
import { CarDamage } from '../render/CarDamage.js';
import { Career } from '../meta/Career.js';
import { MetaLayer } from '../game/MetaLayer.js';
import { NetClient } from '../net/NetClient.js';
import { Leaderboard } from '../net/Leaderboard.js';
import { RemotePlayers } from '../render/RemotePlayers.js';
import { patchUnderglowTree, underglowFrame } from '../render/underglowLight.js';
import { loadCarModels, hasCarModel, trimCarModels } from '../render/ModelCar.js';
import { getCar } from '../vehicle/cars.js';
import { applyCarUpgrades, effectiveNitroStats, hasCarNitro } from '../vehicle/upgradeTuning.js';
import { PartyRace } from '../game/PartyRace.js';
import { Traffic, NEAR_MISS_BONUS } from '../game/Traffic.js';
import { CrazyGamesPlatform } from '../platform/CrazyGames.js';

// Parks the car (menu, countdown). Handbrake only: holding the brake pedal at a standstill would
// select reverse, and the race would then start in R.
const HOLD = Object.freeze({ throttle: 0, brake: 0, steer: 0, handbrake: true, boost: false, shift: 0 });

/**
 * Owns the frame loop and the game state machine:
 *   loading -> menu -> countdown -> running <-> paused -> finished -> menu
 * Everything else (world, vehicle, session, views, HUD, audio) is a collaborator it wires together.
 */
/** Forward gears as numbers for comparing shifts ('N' and 'R' rank lowest). */
function gearRank(gear) {
  const n = Number(gear);
  return Number.isFinite(n) ? n : 0;
}

export class Game {
  constructor(root) {
    this.root = root;
    this.settings = loadSettings();
    this.records = loadRecords(this.settings.map); // this map's records, keyed by mode id
    this.platform = new CrazyGamesPlatform();
    this.state = 'loading';
    this.mode = MODES[0];
    this.session = null;
    this.nitro = CONFIG.nitro.capacity;
    this.countdown = 0;
    this.countdownShown = '';
    this.goTimer = 0;
    this.stuckTimer = 0;
    this.headlightsWanted = 0; // 0 off, 1 low beam, 2 high beam (H)
    this.debugVisible = false;
    this.garageOrbit = { yaw: 0, pitch: 0.08, dragging: false };
    this.pendingRoamOnName = false;
    this.lastTime = 0;
    this.fps = 60;
    this.pose = { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };
    this.location = {};
    this.controls = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false, shift: 0 };
    this.audioFlags = { drifting: false, boosting: false, paused: false };
    this.hudFrame = {
      speedKmh: 0, gear: 'N', rpm: 0, rpmMax: 7200, throttle: 0, brake: 0, boost: 100, boosting: false,
      surface: 'asphalt', position: { x: 0, z: 0 }, heading: 0, altitude: 0, grade: 0,
      drift: null, session: null, ghostDelta: null, camera: 'CHASE', debug: '',
    };
    this.onFrame = this.onFrame.bind(this);
    this.onResize = this.onResize.bind(this);
    // Frames stop in a background tab; pause the race rather than let the clock jump on return.
    this.onVisibility = () => {
      if (!document.hidden) return;
      this.pause();
    };
  }

  // ---------------------------------------------------------------- startup

  async init() {
    this.platform.loadingStart();
    const platformReady = this.platform.init().catch(() => {});
    this.createRenderer();
    this.career = new Career();
    this.hud = new Hud(this.root, { settings: this.settings, modes: MODES, records: this.records });
    this.hud.setStageMode?.('3d');
    this.hud.showLoading(0, 'Starting up');
    this.input = new Input({ root: this.root, touchRoot: this.hud.touchRoot });
    this.audio = new AudioEngine({ volume: this.settings.volume });
    this.platform.addMuteListener((muted) => this.audio.setPlatformMuted(muted));
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

    // Pick starting Auto quality from hardware capabilities; refined further once WebGL initializes & samples FPS.
    this.autoQuality = detectInitialQuality(null);
    this.autoSample = { time: 0, frames: 0 };
    this.renderScale = createRenderScale();
    this.contextLost = false;
    const quality = getQualityPreset(this.settings.quality, this.autoQuality);
    // The map is chosen once per page load; switching maps from the homepage reloads the page.
    this.map = getMap(this.settings.map);
    let mapData = null;
    if (this.map.assets) {
      mark('Reading the survey');
      this.hud.showLoading(0.01, 'Reading the survey');
      try {
        mapData = await loadMapData(this.map);
      } catch (error) {
        console.error(`Could not load the ${this.map.label} map, falling back to ${MAPS.alpine.label}`, error);
        this.map = MAPS.alpine;
        this.records = loadRecords(this.map.id);
      }
    }
    this.world = new World(this.map.config, mapData);
    await this.world.build((fraction, label) => {
      mark(label);
      this.hud.showLoading(fraction * 0.72, label);
    });
    // The SDK has had the whole world build to start; give it a little longer, then move progress to its cloud save.
    await Promise.race([platformReady, new Promise((resolve) => setTimeout(resolve, 2500))]);
    this.useCloudSave();
    // Only the events this map has roads for (no Nag Tibba events on Alpine).
    this.modes = modesForWorld(this.world);
    this.hud.setModes(this.modes);

    // Views are built one per frame so the progress bar keeps moving.
    const activeQuality = getQualityPreset(this.settings.quality, this.autoQuality);
    const stages = [
      ['Shaping the terrain', () => { if(this.map.id==='tokyo'||this.map.id==='fujimi') return; this.terrain = new TerrainView({ world: this.world, quality: activeQuality }); this.scene.add(this.terrain.group); }],
      ['Filling the lake', async () => {
        const { WaterView } = await import('../render/WaterView.js');
        this.water = new WaterView({ world: this.world });
        this.scene.add(this.water.group);
      }],
      ['Paving the roads', async () => { const RoadRenderer=this.world.apex?(await import('../render/ApexCircuitSurface.js')).ApexCircuitSurface:RoadView; this.roads = new RoadRenderer({ world: this.world, quality: activeQuality, anisotropy: activeQuality.anisotropy ?? 8 }); this.scene.add(this.roads.group); }],
      ['Building the town', async () => {
        if (!this.map.assets?.props) return;
        const { Landmarks } = await import('../render/Landmarks.js');
        this.landmarks = new Landmarks({ world: this.world, quality: activeQuality });
        try {
          await this.landmarks.load(this.map.assets.props);
          this.scene.add(this.landmarks.group);
        } catch (error) {
          console.error('Could not load the map buildings', error);
          this.landmarks = null;
        }
      }],
      ['Building roadside scenery', async () => {
        let Forest;
        if (this.map.id === 'tokyo') ({ TokyoCity: Forest } = await import('../render/TokyoCity.js'));
        else if (this.map.id === 'fujimi') ({ FujimiScene: Forest } = await import('../render/FujimiScene.js'));
        else if (this.map.id === 'hollow') ({ HollowCreekTown: Forest } = await import('../render/HollowCreekTown.js'));
        else if (this.world.bridge) ({ JungleCanopy: Forest } = await import('../render/JungleCanopy.js'));
        else if (this.world.apex) ({ApexPark:Forest}=await import('../render/ApexPark.js'));
        else Forest = Scenery;
        this.scenery = new Forest({ world: this.world, quality: activeQuality, cutRock:this.terrain?.cutRock });
        this.scene.add(this.scenery.group);
        if (this.scenery.towerReady) await this.scenery.towerReady;
        if (this.map.id === 'hollow') await this.scenery.loadCoupe(this.world);
      }],
      ['Lighting the sky', () => { this.atmosphere = new Atmosphere({ scene: this.scene, renderer: this.renderer, world: this.world, quality: activeQuality,cityPanorama:this.scenery.panorama }); }],
      // Only the equipped car's model (they are megabytes each); other cars load on demand when selected or seen online.
      ['Warming the engine', async () => { await loadCarModels([this.career.profile.cosmetics.car]); this.createVehicle(); }],
    ];
    for (let i = 0; i < stages.length; i += 1) {
      mark(stages[i][0]);
      this.hud.showLoading(0.72 + (0.26 * i) / stages.length, stages[i][0]);
      await nextFrame();
      await stages[i][1]();
    }
    mark('Ready');

    this.hud.setMap(this.map.id);
    this.hud.setTrack(this.world.getMapData());
    this.meta = new MetaLayer({ career: this.career, hud: this.hud, scene: this.scene, wheelLayout: this.vehicle.wheelLayout, game: this, mapId: this.map.id });
    this.traffic = new Traffic(this.scene, this.vehicle.wheelLayout);
    if (this.map.id === 'tokyo') {
      const { TokyoNight } = await import('../game/TokyoNight.js');
      this.adventure = new TokyoNight(this);
    }
    if (this.map.id === 'hollow') {
      const { HollowAdventure } = await import('../game/HollowAdventure.js');
      this.adventure = new HollowAdventure(this);
    }
    if (this.world.apex) {
      const {ApexPractice} = await import('../game/ApexPractice.js');
      this.apexPractice = new ApexPractice(this);
    }
    this.createNetwork();
    this.applySettings(this.settings, { save: false });
    this.meta.refreshAll();
    this.enterMenu();
    this.onResize();
    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);
    window.visualViewport?.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.hud.showLoading(1, 'Ready');
    await nextFrame();
    this.platform.loadingStop();
    const partyBooted = this.partyRace?.boot();
    if (this.settings.startGate && !partyBooted) {
      this.hud.showTitleReady();
    } else {
      this.hud.hideLoading();
      this.meta.welcome();
    }
    this.prewarmShaders();
    this.lastTime = performance.now();
    this.frameHandle = requestAnimationFrame(this.onFrame);
    return this;
  }

  createRenderer() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'game-canvas';
    this.root.prepend(this.canvas);
    const earlyPreset = getQualityPreset(this.settings.quality, this.autoQuality);
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: earlyPreset.antialias !== false,
      powerPreference: this.autoQuality === 'Low' ? 'default' : 'high-performance',
    });
    this.autoQuality = detectInitialQuality(this.renderer);
    const activeQuality = getQualityPreset(this.settings.quality, this.autoQuality);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = activeQuality.shadowMapSize > 0;
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft was removed in r180: three swaps it on the first frame and recompiles every shader
    this.onContextLost = (event) => {
      event.preventDefault();
      this.contextLost = true;
      cancelAnimationFrame(this.frameHandle);
      this.audio?.silence();
      this.hud?.toast('Graphics context paused — restoring…', 'info');
    };
    this.onContextRestored = () => {
      this.contextLost = false;
      this.applyQuality();
      this.prewarmShaders();
      this.lastTime = performance.now();
      this.frameHandle = requestAnimationFrame(this.onFrame);
    };
    this.canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    this.scene = new THREE.Scene();
  }

  createVehicle() {
    this.vehicle = new Vehicle({ world: this.world, handling: this.settings.handling });
    this.drift = new DriftScorer();
    this.carId = 'hatch';
    this.audio.setProfile(getCar(this.carId).sound || null); // setCar() skips the car it starts with
    this.car = new CarVisual({ wheelLayout: this.vehicle.wheelLayout, carId: this.carId });
    this.scene.add(this.car.group);
    this.cameraRig = new CameraRig({ world: this.world });
    this.cameraRig.cockpitEye = this.car.cockpitEye;
    this.effects = new Effects(this.scene);
    this.damage = new CarDamage({ scene: this.scene, world: this.world, effects: this.effects });
    this.damage.attach(this.car);
  }

  /**
   * Multiplayer and leaderboards. With VITE_API_HOST set (see server/README.md) they go through the
   * Cloudflare Worker; without it, tabs of this browser see each other and leaderboards are local.
   */
  createNetwork() {
    const host = import.meta.env?.VITE_API_HOST || '';
    const profile = this.meta.publicProfile();
    this.net = new NetClient({ host, profile });
    this.leaderboard = new Leaderboard({ host, profile });
    this.remotePlayers = new RemotePlayers({ scene: this.scene, net: this.net, wheelLayout: this.vehicle.wheelLayout });
    this.remotePlayers.setNeonLevel(neonLevel(this.settings.timeOfDay));
    this.meta.attachNetwork({ net: this.net, leaderboard: this.leaderboard });
    this.netExtras = { braking: false, boosting: false, drifting: false };
    // Race with friends via code (private party rooms).
    this.partyRace = new PartyRace({ game: this, net: this.net, hud: this.hud, meta: this.meta, mapId: this.map.id });
  }

  bindHud() {
    const hud = this.hud;
    hud.onStart = (modeId) => this.maybeShowMidgameAd(() => this.beginRun(modeId));
    hud.onPause = () => this.pause();
    hud.onResume = () => this.resume();
    hud.onRestart = () => this.maybeShowMidgameAd(() => this.beginRun(this.mode.id));
    hud.onMenu = () => this.maybeShowMidgameAd(() => this.enterMenu());
    hud.onRespawn = () => {
      if (this.state === 'paused') this.resume();
      this.respawn();
    };
    hud.onCamera = () => this.cameraRig.cycle();
    hud.onFullscreen = () => this.toggleFullscreen();
    // The homepage map picker: a different map means a different world, so it reloads.
    hud.onSelectMap = (mapId) => this.selectMap(mapId);
    hud.onTitleStart = (tab = 'garage') => {
      this.audio.unlock();
      this.audio.ui();
      this.pendingRoamOnName = false;
      this.hud.hideLoading();
      this.hud.setHubTab?.(tab);
      this.cameraRig?.startBlend();
      this.meta.welcome();
    };
    hud.onTitleRoam = () => {
      this.audio.unlock();
      this.audio.ui();
      this.hud.hideLoading();
      if (this.career.needsName) {
        this.pendingRoamOnName = true;
        this.meta.welcome();
      } else {
        this.beginRun('roam');
      }
    };
    hud.onToggleStartGate = (enabled) => {
      this.applySettings({ ...this.settings, startGate: Boolean(enabled) });
    };
    hud.onHubTabChange = (tab) => {
      if (tab !== 'garage') this.meta?.applyLook?.(this.car);
      this.cameraRig?.startBlend();
    };
    hud.onGarageOrbit = (dx, dy, dragging) => {
      this.garageOrbit.dragging = Boolean(dragging);
      if (dx || dy) {
        this.garageOrbit.yaw -= dx * 0.008;
        this.garageOrbit.pitch = clamp(this.garageOrbit.pitch + dy * 0.005, -0.08, 0.45);
      }
    };
    hud.onGaragePreviewTime = (timeOfDay) => {
      this.applyTimeOfDay(timeOfDay);
      this.audio.ui();
    };
    hud.onGaragePreviewLights = () => {
      this.headlightsWanted = this.car.headlightsOn ? 0 : 1;
      this.car.setHeadlights(this.headlightsWanted);
      this.audio.ui();
      return this.car.headlightsOn;
    };
    hud.onOpenSettings = () => {};
    // The HUD closes its own settings panel; put the screen underneath back.
    hud.onCloseSettings = (source) => this.restoreAfterSettings(source);
    hud.onSettingsChange = (settings) => this.applySettings(settings);
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
    const previousMap = this.settings.map;
    this.settings = normalizeSettings(settings);
    if (save) saveSettings(this.settings);
    // A different map means a different world: rebuild by reloading the page.
    if (save && this.map && this.settings.map !== previousMap && this.settings.map !== this.map.id) {
      this.hud.showLoading?.(0, `Driving to ${getMap(this.settings.map).label}`);
      window.location.reload();
      return;
    }
    this.applyQuality();
    this.atmosphere.setTimeOfDay(this.map.id === 'tokyo' ? 'night' : (this.map.id === 'fujimi' || this.world.apex) ? 'day' : this.settings.timeOfDay);
    if (this.world.apex) this.atmosphere.sky.material.uniforms.cloudCoverage.value = 0;
    this.roads.setNight?.(this.atmosphere.isNight);
    this.landmarks?.setNight(this.atmosphere.isNight, this.atmosphere.timeOfDay === 'sunset' || this.atmosphere.timeOfDay === 'dawn');
    this.terrain?.setSun?.(this.atmosphere.sunDirection, this.atmosphere.sunColor, this.atmosphere.ambientColor);
    if (this.atmosphere.isNight) {
      this.water.setSun(this.atmosphere.sunDirection, this.atmosphere.sunColor, this.atmosphere.ambientColor);
    } else {
      this.water.setSun();
    }
    this.meta?.applyLook(this.car);
    // At night the low beams come on by themselves; the driver can still pick high beam (H).
    this.car.setHeadlights(this.headlightsWanted || (this.atmosphere.isNight ? 1 : 0));
    this.car.setNight(this.atmosphere.isNight);
    if (this.hud) {
      this.hud.headlightsOn = this.car.headlightsOn;
      this.hud.syncGarageLightsButton?.();
    }
    this.car.setNeon({ level: neonLevel(this.settings.timeOfDay) });
    this.remotePlayers?.setNeonLevel(neonLevel(this.settings.timeOfDay));
    this.remotePlayers?.setNight?.(this.atmosphere.isNight || this.atmosphere.timeOfDay === 'sunset' || this.atmosphere.timeOfDay === 'dawn');
    this.applyActiveVehicleTuning();
    this.vehicle.setAssists({ driftAssist: this.settings.driftAssist, abs: this.settings.abs, transmission: this.settings.transmission });
    this.input.setManualShift(this.settings.transmission === 'manual');
    this.input.setTouchSteer?.(this.settings.touchSteer);
    this.audio.setVolume(this.settings.volume);
    this.cameraRig.shakeEnabled = this.settings.cameraShake;
    this.hud.setSettings(this.settings);
    this.onResize();
  }

  /**
   * Homepage map picker. The two maps are separate worlds, so switching saves the choice and
   * reloads into the new one (applySettings shows the loading screen before the reload).
   */
  selectMap(mapId) {
    const map = MAPS[mapId];
    if (!map || (this.state !== 'menu' && this.state !== 'finished')) return false; // 'finished': Drive it on a new-map unlock
    if (map.id === this.map?.id) {
      this.hud.toast(`Already driving ${map.label}`, 'good');
      return false;
    }
    if (this.career && !this.career.isMapUnlocked(map.id)) {
      this.hud.toast(`${map.label} unlocks at ${this.career.mapRequirementText(map.id)}`, 'warn');
      return false;
    }
    this.applySettings({ ...this.settings, map: map.id });
    return true;
  }

  /** Switch time of day and remember it (the daily challenge can ask for night). */
  applyTimeOfDay(name) {
    if (!this.world.apex && this.settings.timeOfDay !== name) this.applySettings({ ...this.settings, timeOfDay: name });
  }

  // ---------------------------------------------------------------- state changes

  enterMenu() {
    this.platform?.gameplayStop();
    this.partyRace?.onLeaveRun();
    this.meta?.leaveRun();
    this.meta?.leaveRoom();
    this.traffic?.clear();
    this.state = 'menu';
    this.session = null;
    this.apexPractice?.reset();
    this.audio.silence();
    this.input.setTouchStaged?.(false);
    this.input.setDrivingEnabled(false);
    this.roads.setRoute(null);
    this.hud.setCountdown('');
    this.hud.setRecords(this.records);
    this.hud.showMenu();
    const route = this.world.routes.loop;
    this.vehicle.teleport(this.world.getSpawn('loop', route.startS - 8, this.pose));
    this.drift.reset();
    this.effects.clear();
    this.damage.reset();
    this.cameraRig.startBlend();
  }

  /**
   * Start an event. A mode whose route this map lacks (e.g. a Nag Tibba event on Alpine, from an old
   * link or daily) is refused with a toast and nothing changes. Returns whether the run started.
   * @param {string} modeId
   * @param {{startAt?: number, party?: boolean}} [options]
   *   startAt: epoch ms (local clock) the green light must show at; the countdown runs until then
   *   instead of the usual 3 s (party races start everyone together). party: this is a party round.
   */
  beginRun(modeId, options = {}) {
    const listed = this.modes?.find(mode => mode.id === modeId);
    if (this.world.apex && !listed) return false;
    const mode = listed || getMode(modeId);
    const route = this.world.routes[mode.route];
    if (!route) {
      this.hud.toast(`${mode.label} is not on ${this.map.label}`, 'warn');
      return false;
    }
    this.platform?.gameplayStart();
    this.enterMobileLandscape();
    this.meta?.applyLook?.(this.car);
    this.applyActiveVehicleTuning();
    this.partyRace?.onRunStart(modeId, options);
    this.audio.unlock();
    this.mode = mode;
    this.session = new RaceSession({ world: this.world, mode: this.mode, records: this.records });
    const spawn=this.session.getStartPose(this.pose);
    if(mode.id==='roam' && this.world.sites){
      const p=this.world.sites.garage;
      Object.assign(spawn.position,{x:p.x-4*p.rx,y:this.world.heightAt(p.x-4*p.rx,p.z-4*p.rz),z:p.z-4*p.rz});
      const angle=Math.atan2(p.rx,p.rz);Object.assign(spawn.quaternion,{x:0,y:Math.sin(angle/2),z:0,w:Math.cos(angle/2)});
    }
    this.vehicle.teleport(spawn);
    this.adventure?.runStart(modeId);
    this.apexPractice?.reset();
    this.meta.beginRun(this.mode.id, this.atmosphere.timeOfDay);
    this.meta.joinRoom(this.mode.id);
    this.drift.reset();
    this.effects.clear();
    this.damage.reset();
    const upgrades = this.career?.carUpgrades?.(this.carId);
    const nitroStats = effectiveNitroStats(CONFIG.nitro, upgrades);
    this.nitroCapacity = nitroStats.capacity;
    this.nitro = nitroStats.capacity;
    this.fujimiClipsHit = new Set();
    this.smokeShown = null;
    if (this.settings.traffic && mode.id !== 'apex-meeting') {
      this.traffic.start(this.world, mode, `${this.map.id}:${mode.id}`);
      this.traffic.update(0, { position: { x: Infinity, z: Infinity }, speed: 0 });
    } else {
      this.traffic.clear();
    }
    this.stuckTimer = 0;
    this.world.bridge?.reset();
    this.world.washout?.reset();
    this.roads.setRoute(this.mode.id === 'roam' ? null : route);
    this.prewarmShaders(); // the start gates and banners were just built
    this.hud.setActiveRoad(route.roadId);
    this.hud.showRace();
    this.startHowTo();
    // Free roam is the calm, explore-the-mountain HUD; timed events get full telemetry.
    this.hud.setHudMode?.(this.mode.id === 'roam' ? 'calm' : 'race');
    this.cameraRig.setMode('chase');
    this.cameraRig.snap();
    this.countdownShown = '';
    if (this.mode.id === 'roam') {
      // Nothing to time, so no countdown: you are driving the moment it loads.
      this.state = 'running';
      this.countdown = 0;
      this.input.setDrivingEnabled(true);
      return true;
    }
    this.input.setDrivingEnabled(false);
    this.input.setTouchStaged?.(true);
    this.state = 'countdown';
    this.countdownStartAt = Number.isFinite(options?.startAt) ? options.startAt : null;
    this.countdown = this.countdownStartAt === null
      ? CONFIG.race.countdownSeconds
      : Math.max(0, (this.countdownStartAt - Date.now()) / 1000);
    return true;
  }

  /** Apply stock + garage upgrade tuning for the currently equipped car. */
  applyActiveVehicleTuning() {
    const car = getCar(this.carId);
    const upgrades = this.career?.carUpgrades?.(car.id);
    this.vehicle.setHandling(this.settings.handling, applyCarUpgrades(car, upgrades));
    this.input.setNitroAvailable?.(hasCarNitro(car, upgrades));
  }

  /**
   * Drive another car (an id from src/vehicle/cars.js): its own physics tuning, body and interior.
   * The caller (MetaLayer.applyLook) paints it afterwards.
   */
  setCar(carId) {
    const car = getCar(carId);
    if (car.id === this.carId) return;
    this.carId = car.id;
    const pose = this.vehicle.getState();
    this.applyActiveVehicleTuning();
    // New ride height and wheelbase: put the car back down where it was.
    this.vehicle.teleport({ position: pose.position, quaternion: pose.quaternion });
    this.buildCarVisual();
    this.audio.setProfile(car.sound || null);
    // Picked before its model finished downloading: drive the stand-in, swap the body in when it lands.
    if (!hasCarModel(car.id)) {
      loadCarModels([car.id]).then(() => {
        if (this.carId === car.id && hasCarModel(car.id)) {
          this.buildCarVisual();
          this.meta?.applyLook(this.car, car.id); // keep a locked car's garage preview, not the equipped car
        }
      });
    }
  }

  /** Replace the visible car with a fresh CarVisual for this.carId, keeping lights and neon. */
  buildCarVisual() {
    const old = this.car;
    this.car = new CarVisual({ wheelLayout: this.vehicle.wheelLayout, carId: this.carId });
    this.scene.add(this.car.group);
    this.car.setHeadlights(old.headlightMode);
    this.car.setNight(old.night);
    this.car.setNeon({ level: old.neonLevel, on: old.neonWanted });
    old.dispose();
    this.damage?.attach(this.car);
    this.cameraRig.cockpitEye = this.car.cockpitEye;
    this.effects?.setExhaustTips?.(getCar(this.carId).exhaustTips || null);
    this.prewarmShaders();
  }

  /**
   * Compile every shader now, hidden objects included (renderer.compile skips invisible ones), so
   * nothing compiles mid-drive: the first drift smoke, spark shower, cockpit view or ghost car used to
   * stall a frame for 50-300 ms. Also gives every standard material the neon underglow light.
   */
  prewarmShaders() {
    patchUnderglowTree(this.scene);
    const hidden = [];
    this.scene.traverse((node) => {
      if (!node.visible) {
        hidden.push(node);
        node.visible = true;
      }
    });
    // Materials are gathered synchronously; the compile itself runs in parallel where the GPU allows.
    const done = this.renderer.compileAsync(this.scene, this.cameraRig.camera).catch(() => {});
    for (const node of hidden) node.visible = false;
    return done;
  }

  /** Keep the career in the CrazyGames data module (follows the player's account) as well as localStorage. */
  useCloudSave() {
    const cloud = this.platform.dataStorage;
    if (!cloud) return;
    this.career.storage = mirroredStorage(cloud, this.career.storage);
    this.career.load();
    this.career.knownUnlocks = this.career.progressionUnlockedIds();
  }

  /**
   * First launch: once the driver has a name, go straight into a short scored event (a clear goal, a
   * medal and XP inside two minutes, then "Next event" on the results) rather than open free roam.
   */
  startFirstDrive() {
    if(this.map.id==='hollow'){this.beginRun('roam');this.hud.toast('Garage radio opens the Hollow Creek dispatch board.', 'info');return;}
    const first = ['drift', 'sprint'].find((id) => this.modes.some((mode) => mode.id === id));
    if (!first) {
      this.beginRun('roam');
      this.hud.toast('Explore the mountain. Esc opens the events board.', 'info');
      return;
    }
    this.beginRun(first);
    const bronze = this.career.targetsFor(first)?.bronze;
    this.hud.toast(first === 'drift'
      ? `First challenge: slide through the corners with the handbrake. ${bronze ? `Score ${bronze.toLocaleString('en-US')} for bronze.` : ''}`
      : 'First challenge: one lap against the clock. Beat the bronze time to earn your first medal.', 'info');
  }

  pause() {
    if (this.state !== 'running' && this.state !== 'countdown') return;
    this.platform?.gameplayStop();
    this.pausedFrom = this.state;
    this.state = 'paused';
    this.input.setTouchStaged?.(false);
    this.input.setDrivingEnabled(false);
    this.audio.silence();
    this.hud.showPause(this.mode.id === 'drift' ? 'The clock and your combo are frozen.' : '');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.platform?.gameplayStart();
    this.state = this.pausedFrom || 'running';
    if (this.session && !this.meta.room) this.meta.joinRoom(this.mode.id);
    this.hud.showRace();
    this.input.setDrivingEnabled(this.state === 'running');
    if (this.state === 'countdown') this.input.setTouchStaged?.(true);
  }

  finish(result) {
    this.state = 'finished';
    this.platform?.gameplayStop();
    this.input.setDrivingEnabled(false);
    this.audio.finish();
    saveRecords(this.records, this.map.id);
    this.hud.setRecords(this.records);
    this.hud.setCountdown('');
    this.adventure?.finishRace();
    const rewards = this.meta.finish(result);
    if (result?.isRecord || rewards?.medal?.tier === 'gold') {
      this.platform?.happytime();
    }
    this.hud.showFinish(result, rewards);
    this.partyRace?.onFinish(result);
    this.cameraRig.startBlend();
  }

  maybeShowMidgameAd(action) {
    if (this.state === 'finished') {
      this.audio.silence();
      this.platform.requestMidgameAd({
        onStart: () => {
          this.audio.setAdMuted(true);
        },
        onFinish: () => {
          this.audio.setAdMuted(false);
          action();
        },
      });
      return;
    }
    action();
  }

  respawn() {
    if (!this.session || this.state !== 'running') return;
    const bridge = this.world.bridge;
    const cut = this.world.washout;
    const loc = cut && this.world.locate(this.vehicle.getState().position.x, this.vehicle.getState().position.z, this.location);
    const retryJump = cut && (cut.missed || (loc.roadId === 0 && inWashout(loc.s)));
    const pose = retryJump ? this.world.getSpawn('loop', WASHOUT.retry, this.pose) : bridge?.falling || bridge?.loaded
      ? this.world.getSpawn('loop', BRIDGE.recovery, this.pose)
      : this.adventure?.recoveryPose(this.pose) ?? this.session.getRespawnPose(this.pose);
    bridge?.reset();
    cut?.reset();
    this.vehicle.teleport(pose);
    this.session.addRespawn();
    this.meta.respawn(this.session.hud.elapsed, this.vehicle.getState());
    this.drift.reset({ preserveBank: true });
    this.damage.repair();
    this.cameraRig.snap();
    this.audio.respawn();
    this.stuckTimer = 0;
    if (!this.slogan()) this.hud.toast('Back on the road', 'warn');
  }

  /**
   * Phones: go fullscreen and hold landscape when a drive starts (racing needs the width). Android
   * Chrome allows the orientation lock only in fullscreen; iOS Safari has neither, so the HUD's
   * "turn your phone" prompt covers it. Must run inside the tap that started the drive.
   */
  enterMobileLandscape() {
    if (!globalThis.matchMedia?.('(pointer: coarse)').matches || document.fullscreenElement) return;
    const request = document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
    request?.then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
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
      // The lamp switch: off, dipped (low) beam, main (high) beam.
      this.headlightsWanted = this.car.cycleHeadlights();
      this.hud.toast(['Headlights off', 'Low beam', 'High beam'][this.headlightsWanted], 'info');
      this.audio.ui();
    }
    if (input.neon) {
      if (this.car.hasNeon) {
        this.car.setNeon({ on: !this.car.neonWanted });
        this.hud.toast?.(this.car.neonWanted ? 'Underglow on' : 'Underglow off');
      } else {
        this.hud.toast?.('No underglow fitted. Pick a neon colour in the Garage');
      }
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
    // A shared start time follows the wall clock (it keeps counting through a pause or a slow frame).
    if (this.countdownStartAt !== null && this.countdownStartAt !== undefined) this.countdown = (this.countdownStartAt - Date.now()) / 1000;
    else this.countdown -= dt;
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
    const state = this.vehicle.step(dt, HOLD);
    this.sendNetState(state, false, false);
    return state;
  }

  /** Tell other players where we are (the client rate-limits itself to ~6 Hz, 1 Hz when parked). */
  sendNetState(state, boosting, drifting) {
    const extras = this.netExtras;
    extras.braking = state.brake > 0.05;
    extras.boosting = boosting;
    extras.drifting = drifting;
    this.net.sendState(state, extras, performance.now());
  }

  updateRunning(dt, input) {
    const controls = this.controls;
    const car = getCar(this.carId);
    const upgrades = this.career?.carUpgrades?.(this.carId);
    const nitroStats = effectiveNitroStats(CONFIG.nitro, upgrades);
    const boosting = hasCarNitro(car, upgrades) && input.boost && input.throttle > 0.1 && this.nitro > 0.5;
    // Crash damage: a crushed nose loses power, bent front suspension pulls to one side.
    controls.throttle = input.throttle * this.damage.powerFactor;
    controls.brake = input.brake;
    controls.steer = clamp(input.steer + this.damage.steerPull, -1, 1);
    controls.handbrake = input.handbrake;
    controls.boost = boosting;
    controls.shift = input.shift;

    const bridge = this.world.bridge;
    if (bridge) {
      const wasLoaded = bridge.loaded;
      bridge.step(dt, this.vehicle.getState(), controls);
      if (bridge.loaded && !wasLoaded) this.hud.toast('Loose planks · ease off and steer straight', 'warn');
      if (bridge.broken && !bridge.dropTime) this.hud.toast('The ropes gave way!', 'warn');
    }
    const state = this.vehicle.step(dt, controls);
    if (this.world.adventure) {
      const note = this.world.adventure.update(dt, state);
      if (note) this.hud.toast(note, 'info');
    }
    if (this.world.washout) {
      const note = this.world.washout.update(dt, state);
      if (note) this.hud.toast(note, 'info');
      if (this.world.washout.fallTime > 0.55) {
        this.respawn();
        this.hud.toast('Short landing · build speed on the run-up', 'warn');
        return this.vehicle.getState();
      }
    }
    const drift = this.drift.update(dt, state, controls);
    // Combo smoke: the stock white smoke heats up with the multiplier (x2 cyan, x3 pink, x4+ gold).
    const ownSmoke = this.career?.profile.cosmetics.smoke || 'white';
    const smokeId = ownSmoke !== 'white' ? ownSmoke
      : drift.multiplier >= 4 ? 'gold' : drift.multiplier >= 3 ? 'pink' : drift.multiplier >= 2 ? 'cyan' : 'white';
    if (smokeId !== this.smokeShown) {
      this.smokeShown = smokeId;
      this.effects.setSmokeColor?.(getSmoke(smokeId).rgb);
    }
    // Fujimi's clipping zones: a drift through one pays a bonus into the running drift.
    const clip = this.scenery.clipZone?.(state, drift);
    if (clip) {
      this.drift.score += clip.bonus;
      this.hud.toast(`${clip.name} · clip +${clip.bonus}`, 'good');
      this.hud.flashStyleCallout?.({ kind: 'clip', label: clip.name.toUpperCase(), bonus: clip.bonus });
      this.career?.onClip?.();
      this.audio.stylePing?.('transition');
      if (this.fujimiClipsHit && this.scenery.zones) {
        this.fujimiClipsHit.add(clip.name);
        if (this.fujimiClipsHit.size >= this.scenery.zones.length) this.meta?.career?.onFujimiAllClips?.();
      }
    }

    const pass = this.traffic.update(this.session.hud.elapsed, state);
    if (pass === 'nearMiss') {
      // Near miss: points into the running drift (or straight into the bank), combo kept alive, a nitro top-up.
      if (drift.active) this.drift.score += NEAR_MISS_BONUS;
      else this.drift.bank += NEAR_MISS_BONUS;
      if (this.drift.comboTimer > 0) this.drift.comboTimer = this.drift.comboWindow;
      this.nitro = Math.min(nitroStats.capacity, this.nitro + 15);
      this.hud.flashStyleCallout?.({ kind: 'nearMiss', label: 'NEAR MISS', bonus: NEAR_MISS_BONUS });
      this.audio.stylePing?.('transition');
      this.career?.onNearMiss?.();
    } else if (pass === 'crash') {
      this.vehicle.velocity.multiplyScalar(0.35);
      if (drift.active) this.drift.endDrift('wipeout');
      this.effects.sparkShower(state, 24, 1.4);
      this.hud.toast('Crashed into traffic · combo lost', 'warn');
    }

    if (drift.styleEvent) {
      this.hud.flashStyleCallout?.(drift.styleEvent);
      this.audio.stylePing?.(drift.styleEvent.kind);
      if (drift.styleEvent.kind === 'wallTap') {
        this.effects.sparkShower(state, 16, 1.1);
        this.nitro = Math.min(nitroStats.capacity, this.nitro + 12);
      }
    }

    if (boosting) this.nitro = Math.max(0, this.nitro - nitroStats.drainPerSecond * dt);
    else this.nitro = Math.min(nitroStats.capacity, this.nitro + (nitroStats.refillPerSecond + (drift.active ? nitroStats.driftRefill : 0)) * dt);

    if (drift.event === 'drift_end' && drift.lastDriftScore > 0) this.hud.toast(`Drift +${drift.lastDriftScore.toLocaleString()}`, 'good');
    else if (drift.event === 'wipeout') this.hud.toast('Drift lost', 'warn');

    const events = this.session.update(dt, state, drift);
    this.apexPractice?.update(dt,state);
    for (let i = 0; i < events.length; i += 1) this.handleSessionEvent(events[i]);
    if (this.state === 'running') this.meta.frame(dt, state, drift, this.session.hud.elapsed, this.cameraRig.camera, this.session.hud);

    this.effects.emit(dt, state);
    this.damage.update(dt, state);
    if (state.impact > 9) this.slogan();
    this.sendNetState(state, boosting, drift.active);
    if(this.state==='running')this.adventure?.update(dt,state,drift);
    this.audioFlags.drifting = drift.active;
    this.audioFlags.boosting = boosting;
    this.audio.update(dt, state, this.audioFlags);
    if (state.shifted) {
      this.audio.shift();
      // Upshift at the redline: camera tilt.
      if (gearRank(state.gear) > gearRank(this.lastGear) && this.lastRpmN > 0.9) this.cameraRig.shiftKick?.(1);
    }
    this.lastGear = state.gear;
    this.lastRpmN = state.rpmMax > 0 ? state.rpm / state.rpmMax : 0;
    if(this.state==='running')this.adventure?.checkBounds(dt,state);
    this.checkStuck(dt, state);
    return state;
  }

  handleSessionEvent(event) {
    if (event.type === 'apexLimit') this.hud.toast('Track limits · lap invalid' + (event.penalty ? ' · +' + event.penalty + ' s total' : ''), 'warn');
    this.meta.sessionEvent(event);
    if (event.type === 'checkpoint') {
      this.audio.checkpoint();
      const split = Number.isFinite(event.split) ? event.split : null;
      if (this.hud.showCheckpoint) {
        this.hud.showCheckpoint({ index: event.index, total: event.total, split, label: this.world.apex && (event.index===3 || event.index===7) ? 'SECTOR '+(event.index===3?1:2) : 'CHECKPOINT', km: this.distanceToNextGate(event) });
      } else {
        this.hud.toast(`Checkpoint ${event.index + 1}/${event.total}${split === null ? '' : `  ${formatDelta(split)}`}`, split !== null && split > 0 ? 'warn' : 'good');
      }
    } else if (event.type === 'lap') {
      this.audio.checkpoint();
      this.hud.toast(`Lap ${event.lap}  ${formatTime(event.time)}${event.isBest ? '  best lap' : ''}`, 'good');
    } else if (event.type === 'finish') {
      this.finish(event.result);
    }
  }

  /** Kilometres from the car to the next gate (or the finish) along the route, for the milestone. */
  distanceToNextGate(event) {
    const route = this.session.route;
    const road = this.world.roads[route.roadId];
    const gates = route.checkpoints;
    const nextS = event.index + 1 < gates.length ? gates[event.index + 1] : route.finishS;
    const position = this.vehicle.getState().position;
    const here = this.world.locate(position.x, position.z, this.location, route.roadId, position.y).s;
    let metres = (nextS - here) * route.direction;
    if (route.closed) metres = ((metres % road.length) + road.length) % road.length;
    return Math.max(0, metres) / 1000;
  }

  /** A BRO-style slogan board, at most every 12 s so it stays a treat rather than noise. */
  slogan() {
    const now = performance.now();
    if (!this.hud.showSlogan || now - (this.lastSlogan || -Infinity) < 12000) return false;
    this.lastSlogan = now;
    this.hud.showSlogan();
    return true;
  }

  /** Put the car back on the road if it ends up on its roof, in the lake, or far out of bounds. */
  checkStuck(dt, state) {
    const drowned = state.position.y < this.world.waterAt(state.position.x,state.position.z) - 0.9;
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
    const upgrades = this.career?.carUpgrades?.(this.carId);
    const cap = Math.max(1, this.nitroCapacity || effectiveNitroStats(CONFIG.nitro, upgrades).capacity);
    frame.boost = hasCarNitro(getCar(this.carId), upgrades) ? (this.nitro / cap) * 100 : null; // null: this car has no nitrous
    frame.boosting = state.boosting;
    frame.ghostDelta = this.meta?.ghostDelta ?? null;
    frame.surface = SURFACE_PROPS[state.surface]?.name || 'asphalt';
    frame.position.x = state.position.x;
    frame.position.z = state.position.z;
    frame.heading = Math.atan2(state.forward.x, -state.forward.z);
    frame.altitude = this.world.displayAltitude(state.position.y);
    const location = this.world.locate(state.position.x, state.position.z, this.location, -1, state.position.y);
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
    if (this.contextLost) return;
    this.frameHandle = requestAnimationFrame(this.onFrame);
    const rawMs = now - this.lastTime;
    const dt = clamp(rawMs / 1000, 0, 0.1);
    this.lastTime = now;
    if (this.usesDynamicResolution() && stepRenderScale(this.renderScale, rawMs)) this.applyPixelRatio();
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.05;

    const input = this.input.update();
    this.handleGlobalInput(input);
    this.adventure?.visibility();

    let state;
    const paused = this.state === 'paused';
    if (this.state === 'running') {
      state = this.updateRunning(dt, input);
      this.sampleAutoQuality(dt);
      this.tickHowTo(dt, state);
    }
    else if (this.state === 'countdown') state = this.updateCountdown(dt);
    else if (paused) state = this.vehicle.getState();
    else state = this.vehicle.step(dt, HOLD);

    if (this.goTimer > 0) {
      this.goTimer -= dt;
      if (this.goTimer <= 0) this.hud.setCountdown('');
    }
    // The loading/title screen is opaque: drawing the world under it only cost frames.
    if (this.hud.loadingActive) return;

    this.car.setInteriorView(this.cameraRig.mode === 'cockpit' && (this.state === 'running' || this.state === 'countdown' || paused));
    this.car.sync(state, dt);
    if (this.state === 'menu') {
      if (this.hud.isGarageShowcaseActive?.()) {
        if (!this.garageOrbit.dragging) this.garageOrbit.yaw += dt * 0.09;
        const baseYaw = Math.atan2(state.forward.x, -state.forward.z);
        this.cameraRig.showcase(dt, state.position, {
          baseYaw,
          yawOffset: this.garageOrbit.yaw,
          pitchOffset: this.garageOrbit.pitch,
        });
      } else {
        this.cameraRig.orbit(dt, state.position, { radius: 11, height: 3.4, speed: 0.1 });
      }
    } else if (this.state === 'finished') this.cameraRig.orbit(dt, state.position, { radius: 8, height: 2.6, speed: 0.22 });
    else if (!paused) this.cameraRig.follow(dt, state, input);

    if(this.world.apex)this.renderer.toneMappingExposure=this.atmosphere.preset.exposure;
    const photoCamera=this.adventure?.previewCamera?.(state);
    const camera = photoCamera || this.cameraRig.camera;
    if(this.map.id==='tokyo')this.renderer.toneMappingExposure=this.atmosphere.preset.exposure*(photoCamera?Number(this.adventure.exposure.value):1);
    if (this.state !== 'running') this.meta.idle(camera, state.position);
    if (!paused) this.remotePlayers.update(dt, camera, performance.now());
    underglowFrame.begin();
    underglowFrame.push(this.car.model);
    this.remotePlayers.pushUnderglow(underglowFrame, camera.position);
    underglowFrame.end();
    if (!paused) {
      this.effects.update(dt);
      this.water.update(dt, camera);
    }
    this.effects.setLight(this.scenery.smokeLight?.(this.atmosphere.ambientColor,state.brake>0.1) ?? this.atmosphere.ambientColor);
    this.effects.setViewport(this.renderer.domElement.height, camera.fov);
    this.atmosphere.update(paused ? 0 : dt, camera, state.position);
    this.terrain?.update(camera);
    this.scenery.update(camera.position, paused ? 0 : dt, this.atmosphere.isNight, state.position, camera);
    this.landmarks?.update?.(camera);
    this.roads.jungle?.update(camera.position);
    this.updateHud(state);
    this.renderer.render(this.scene, camera);
  }

  /** On a player's first three drives, show the controls until they get moving. */
  startHowTo() {
    let shown = 0;
    try { shown = Number(globalThis.localStorage?.getItem('slopdrift.howto')) || 0; } catch { /* storage blocked */ }
    this.howToTime = shown < 3 ? 14 : 0;
    if (this.howToTime > 0) {
      try { globalThis.localStorage?.setItem('slopdrift.howto', String(shown + 1)); } catch { /* storage blocked */ }
    }
    this.hud.showHowTo(this.howToTime > 0);
  }

  tickHowTo(dt, state) {
    if (!(this.howToTime > 0)) return;
    this.howToTime -= dt;
    // Keep it up for a few seconds even if they floor it, then let it go once they are driving.
    if (this.howToTime <= 0 || (this.howToTime < 10 && state.speedKmh > 40)) {
      this.howToTime = 0;
      this.hud.showHowTo(false);
    }
  }

  /** The graphics preset (settings.quality, or the level Auto resolved to) applied to every view. */
  applyQuality() {
    const quality = getQualityPreset(this.settings.quality, this.autoQuality);
    this.applyPixelRatio(quality);
    const shadows = quality.shadowMapSize > 0;
    if (this.renderer.shadowMap.enabled !== shadows) {
      this.renderer.shadowMap.enabled = shadows;
    }
    underglowFrame.setMaxCars(quality.underglowCars ?? 6);
    this.terrain?.setQuality?.(quality);
    this.scenery?.setQuality?.(quality);
    this.roads?.setQuality?.(quality);
    this.landmarks?.setQuality?.(quality);
    this.atmosphere?.setQuality?.(quality);
    this.effects?.setQuality?.(quality);
    this.car?.setQuality?.(quality);
    this.remotePlayers?.setQuality?.(quality);
    // Fujimi's Mount Fuji stands 3.4 km out: keep it inside the far plane on Low too.
    this.cameraRig?.setQuality?.(this.map?.id === 'fujimi' ? { ...quality, farClip: Math.max(quality?.farClip ?? 0, 5200) } : quality);
    if (!shadows || this.autoQuality === 'Low' || this.settings.quality === 'Low') {
      const keep = new Set([this.carId, ...(this.remotePlayers?.cars ? Array.from(this.remotePlayers.cars.values(), (e) => e.carId) : [])]);
      trimCarModels(keep);
    }
  }

  usesDynamicResolution() {
    return this.settings.quality === 'Auto' ||
      (this.map.id === 'apex' && ['Low','Medium'].includes(this.settings.quality));
  }

  /** Preserve the native interface while reducing the 3D buffer under sustained load. */
  applyPixelRatio(quality = getQualityPreset(this.settings.quality, this.autoQuality)) {
    const scale = this.usesDynamicResolution() ? this.renderScale.scale : 1;
    const dpr = Math.max(0.5, Math.min(window.devicePixelRatio || 1, quality.pixelRatio) * scale);
    if (Math.abs(this.renderer.getPixelRatio() - dpr) < 1e-3) return;
    this.renderer.setPixelRatio(dpr);
    this.onResize();
  }

  /**
   * Auto quality: average the frame rate over sampling windows of driving and step down smoothly
   * when sustained FPS drops under 40 fps (or two steps if critically slow < 22 fps). Stalls
   * over 0.25 s (tab switches, loading hitches) are ignored.
   */
  sampleAutoQuality(dt) {
    if (this.settings.quality !== 'Auto' || dt > 0.25 || dt <= 0) return;
    const sample = this.autoSample;
    // Resolution drops first; the preset only steps down once resolution is already at its floor.
    if (this.renderScale.scale > RENDER_SCALE.min) {
      sample.time = 0;
      sample.frames = 0;
      return;
    }
    sample.time += dt;
    sample.frames += 1;
    if (sample.time < 3.5) return;
    const avgFps = sample.frames / sample.time;
    let next = nextAutoQuality(this.autoQuality, avgFps);
    if (avgFps < 22) next = nextAutoQuality(next, avgFps);
    sample.time = 0;
    sample.frames = 0;
    if (next === this.autoQuality) return;
    this.autoQuality = next;
    this.renderScale = createRenderScale();
    this.applyQuality();
    this.onResize();
    this.hud.toast(`Graphics lowered to ${next} for smoother driving`, 'info');
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
    window.removeEventListener('orientationchange', this.onResize);
    window.visualViewport?.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.onContextLost) this.canvas?.removeEventListener('webglcontextlost', this.onContextLost);
    if (this.onContextRestored) this.canvas?.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.platform?.dispose();
    this.input?.destroy();
    this.meta?.dispose();
    this.partyRace?.dispose();
    this.remotePlayers?.dispose();
    this.net?.dispose();
    this.adventure?.dispose();
    this.audio?.dispose();
    this.damage?.dispose();
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
