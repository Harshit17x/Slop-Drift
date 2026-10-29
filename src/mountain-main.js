import * as THREE from 'three';
import { MountainWorld, MountainVehicle, ProceduralCar, SeededNoise } from './procedural/index.js';
import { CONFIG, getHandlingPreset, getPaint, getQualityPreset, getTimePreset, loadSettings, normalizeSettings, saveSettings } from './mountain-config.js';
import { MountainInput } from './mountain-input.js';
import { MountainCameraRig } from './mountain-camera.js';
import { MountainAudio } from './mountain-audio.js';
import { MountainEffects } from './mountain-effects.js';
import { MountainHUD } from './mountain-hud.js';

const MODES = Object.freeze({
  sprint: Object.freeze({ label: 'SPRINT', laps: CONFIG.race.sprintLaps }),
  drift: Object.freeze({ label: 'DRIFT', laps: 1 }),
  circuit: Object.freeze({ label: 'CIRCUIT', laps: CONFIG.race.circuitLaps }),
  roam: Object.freeze({ label: 'ROAM', laps: 1 }),
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function damp(current, target, lambda, dt) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export class MountainGame {
  constructor(root) {
    this.root = root;
    this.settings = loadSettings();
    this.state = 'boot';
    this.mode = 'sprint';
    this.session = null;
    this.vehicle = null;
    this.world = null;
    this.effects = null;
    this.camera = null;
    this.audio = new MountainAudio();
    this.hud = null;
    this.input = null;
    this.renderer = null;
    this.scene = null;
    this.canvas = null;
    this.sun = null;
    this.hemi = null;
    this.fill = null;
    this.stars = null;
    this.decorations = null;
    this.headlights = [];
    this.headlightsEnabled = true;
    this.debugVisible = false;
    this.lastTime = 0;
    this.countdownClock = 0;
    this.countdownValue = 3;
    this.pausedFrom = 'running';
    this.settingsReturnState = 'menu';
    this.gear = 1;
    this.rpm = 900;
    this.lastGear = 1;
    this.tuning = { engineForce: CONFIG.vehicle.engineForce, lateralGrip: CONFIG.vehicle.lateralGrip, steeringResponse: CONFIG.vehicle.steeringResponse, steeringMax: THREE.MathUtils.degToRad(CONFIG.vehicle.steeringMaxDeg), maxSpeed: CONFIG.vehicle.maxSpeed };
    this.onFrame = this.onFrame.bind(this);
    this.onResize = this.resize.bind(this);
  }

  init() {
    this.createRenderer();
    this.createScene();
    this.createLighting();
    this.createStars();
    this.hud = new MountainHUD(this.root, this.settings);
    this.input = new MountainInput({ root: this.root, touchRoot: this.hud.touchRoot });
    this.createWorld();
    this.createVehicle();
    this.effects = new MountainEffects(this.scene, CONFIG.effects);
    this.camera = new MountainCameraRig({ vehicle: this.vehicle });
    this.bindUI();
    this.applySettings(this.settings, { save: false });
    this.setMenuState();
    this.resize();
    window.addEventListener('resize', this.onResize);
    this.onFullscreenChange = () => {
      if (this.state === 'running') {
        this.hud?.setStateLabel(this.mode === 'roam' ? 'EXPLORE' : 'RUNNING');
      } else if (this.state === 'countdown') {
        this.hud?.setStateLabel('STAGED');
      } else {
        this.hud?.setStateLabel('READY');
      }
    };
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    const unlockAudio = () => {
      this.audio.unlock().catch(() => {});
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    };
    window.addEventListener('pointerdown', unlockAudio, { once: true });
    window.addEventListener('keydown', unlockAudio, { once: true });
    window.addEventListener('touchstart', unlockAudio, { once: true });
    this.lastTime = performance.now();
    this.frameHandle = requestAnimationFrame(this.onFrame);
    return this;
  }

  createRenderer() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'mountain-canvas';
    this.root.appendChild(this.canvas);
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch (error) {
      throw new Error(`WebGL could not start: ${error?.message || error}`);
    }
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x050b12, 1);
  }

  createScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x4b5f82);
    this.scene.fog = new THREE.FogExp2(0x6f6a78, 0.009);
  }

  createLighting() {
    this.hemi = new THREE.HemisphereLight(0xd99592, 0x211e27, 0.42);
    this.hemi.name = 'MountainHemisphere';
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xff8a5b, 1.55);
    this.sun.name = 'MountainSun';
    this.sun.position.set(-84, 132, 48);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1536, 1536);
    this.sun.shadow.camera.near = 2;
    this.sun.shadow.camera.far = 360;
    this.sun.shadow.camera.left = -150;
    this.sun.shadow.camera.right = 150;
    this.sun.shadow.camera.top = 150;
    this.sun.shadow.camera.bottom = -150;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.fill = new THREE.DirectionalLight(0x7ca4ff, 0.22);
    this.fill.position.set(80, 42, -70);
    this.scene.add(this.fill);
  }

  createStars() {
    const noise = new SeededNoise(CONFIG.seed + 901);
    const positions = new Float32Array(420 * 3);
    for (let index = 0; index < 420; index += 1) {
      const angle = noise.sample2D(index * 0.73, 2.1) * Math.PI * 2;
      const radius = 260 + noise.sample2D(index * 0.19, 8.4) * 240;
      const height = 95 + noise.sample2D(index * 0.43, 6.2) * 180;
      positions[index * 3] = Math.cos(angle) * radius;
      positions[index * 3 + 1] = height;
      positions[index * 3 + 2] = Math.sin(angle) * radius;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: 0xdbe8ff, size: 1.3, sizeAttenuation: true, transparent: true, opacity: 0.35, depthWrite: false });
    this.stars = new THREE.Points(geometry, material);
    this.stars.name = 'ProceduralStars';
    this.scene.add(this.stars);
  }

  createWorld() {
    const quality = getQualityPreset(this.settings.quality);
    this.world = new MountainWorld({
      scene: this.scene,
      seed: CONFIG.seed,
      sizeX: CONFIG.world.sizeX,
      sizeZ: CONFIG.world.sizeZ,
      chunkSize: CONFIG.world.chunkSize,
      chunkResolution: quality.terrainResolution,
      roadWidth: CONFIG.world.roadWidth,
      shoulderWidth: CONFIG.world.shoulderWidth,
      roadSegments: CONFIG.world.roadSegments,
      checkpointCount: CONFIG.world.checkpoints,
      autoBuild: true,
    });
    this.createDecorations();
    const trackPoints = this.world.road.samples.map((sample) => sample.position.clone());
    const trackBounds = trackPoints.reduce((bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      maxX: Math.max(bounds.maxX, point.x),
      minZ: Math.min(bounds.minZ, point.z),
      maxZ: Math.max(bounds.maxZ, point.z),
    }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
    const mapPadding = CONFIG.world.roadWidth * 0.5 + CONFIG.world.shoulderWidth + 12;
    this.hud.setTrack(trackPoints, {
      minX: trackBounds.minX - mapPadding,
      maxX: trackBounds.maxX + mapPadding,
      minZ: trackBounds.minZ - mapPadding,
      maxZ: trackBounds.maxZ + mapPadding,
    });
  }

  createDecorations() {
    const noise = new SeededNoise(CONFIG.seed + 19);
    const group = new THREE.Group();
    group.name = 'ProceduralRidgeDecorations';
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x3b2c22, roughness: 1 });
    const foliageMaterial = new THREE.MeshStandardMaterial({ color: 0x193d32, roughness: 1 });
    const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x4c5357, roughness: 0.95, metalness: 0.02 });
    const trunkGeometry = new THREE.CylinderGeometry(0.12, 0.18, 1.25, 6);
    const foliageGeometry = new THREE.ConeGeometry(0.8, 2.6, 7);
    const rockGeometry = new THREE.DodecahedronGeometry(0.85, 0);
    let placed = 0;
    for (let index = 0; index < 160 && placed < 72; index += 1) {
      const angle = noise.sample2D(index * 0.61, 3.3) * Math.PI * 2;
      const radius = 76 + noise.sample2D(index * 1.11, 6.9) * 82;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const nearest = this.world.road.getNearestPoint(x, z);
      const objectRadius = index % 3 !== 1 ? 5.5 : 3.8;
      if (!nearest || nearest.distance < 24 + objectRadius) continue;
      const terrain = this.world.sampleTerrain(x, z);
      const item = new THREE.Group();
      item.position.set(x, terrain.height, z);
      if (index % 3 !== 1) {
        const rock = new THREE.Mesh(rockGeometry, rockMaterial);
        rock.scale.set(1.2 + noise.sample2D(index, 10.1) * 1.5, 0.6 + noise.sample2D(index, 9.7) * 0.7, 0.8 + noise.sample2D(index, 7.1) * 1.2);
        rock.rotation.set(noise.sample2D(index, 12.2), noise.sample2D(index, 11.4) * Math.PI, noise.sample2D(index, 8.8));
        rock.castShadow = true;
        rock.receiveShadow = true;
        item.add(rock);
      } else {
        const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
        const foliage = new THREE.Mesh(foliageGeometry, foliageMaterial);
        const scale = 0.75 + noise.sample2D(index, 4.7) * 0.9;
        trunk.scale.setScalar(scale);
        foliage.scale.setScalar(scale);
        foliage.position.y = 1.55 * scale;
        trunk.castShadow = true;
        foliage.castShadow = true;
        item.add(trunk, foliage);
      }
      item.rotation.y = noise.sample2D(index, 13.7) * Math.PI * 2;
      group.add(item);
      placed += 1;
    }
    this.decorations = group;
    this.scene.add(group);
  }

  createVehicle() {
    const paint = getPaint(this.settings.paint);
    const visual = new ProceduralCar({ color: paint.color, scale: 1 });
    this.vehicle = new MountainVehicle({
      world: this.world,
      scene: this.scene,
      visual,
      mass: CONFIG.vehicle.mass,
      engineForce: CONFIG.vehicle.engineForce,
      reverseForce: CONFIG.vehicle.reverseForce,
      brakeForce: CONFIG.vehicle.brakeForce,
      steeringMaxDeg: CONFIG.vehicle.steeringMaxDeg,
      steeringResponse: CONFIG.vehicle.steeringResponse,
      steeringReturn: CONFIG.vehicle.steeringReturn,
      lateralGrip: CONFIG.vehicle.lateralGrip,
      maxSpeed: CONFIG.vehicle.maxSpeed,
      driveLayout: CONFIG.vehicle.driveLayout,
      drift: CONFIG.drift,
    });
    this.headlights = [
      new THREE.SpotLight(0xfff0cd, 1.5, 42, THREE.MathUtils.degToRad(23), 0.45, 1.2),
      new THREE.SpotLight(0xfff0cd, 1.5, 42, THREE.MathUtils.degToRad(23), 0.45, 1.2),
    ];
    this.headlights[0].position.set(-0.58, 0.8, -2.1);
    this.headlights[1].position.set(0.58, 0.8, -2.1);
    this.headlights.forEach((light) => {
      light.castShadow = false;
      light.target.position.set(light.position.x, 0.55, -8);
      this.vehicle.visual.add(light, light.target);
    });
  }

  bindUI() {
    this.hud.onStart = (mode) => this.beginRun(mode);
    this.hud.onPause = () => this.pause();
    this.hud.onResume = () => this.resume();
    this.hud.onRestart = () => this.beginRun(this.mode);
    this.hud.onMenu = () => this.setMenuState();
    this.hud.onOpenSettings = (source) => this.openSettings(source);
    this.hud.onCloseSettings = () => this.restoreAfterSettings();
    this.hud.onApplySettings = (settings) => { this.applySettings(settings); this.restoreAfterSettings(); };
    this.hud.onFullscreen = () => this.toggleFullscreen();
    this.hud.onCamera = () => this.camera.cycle();
  }

  applySettings(settings, { save = true } = {}) {
    this.settings = normalizeSettings(settings);
    if (save) saveSettings(this.settings);
    const quality = getQualityPreset(this.settings.quality);
    if (this.renderer) {
      this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, quality.pixelRatio));
      this.renderer.shadowMap.enabled = quality.shadows;
    }
    if (this.sun) this.sun.castShadow = quality.shadows;
    if (this.effects) this.effects.setQuality(quality);
    const paint = getPaint(this.settings.paint);
    this.vehicle?.visual?.setColor(paint.color);
    const handling = getHandlingPreset(this.settings.handling);
    this.tuning = {
      engineForce: CONFIG.vehicle.engineForce * handling.engine,
      lateralGrip: CONFIG.vehicle.lateralGrip * handling.grip,
      steeringResponse: CONFIG.vehicle.steeringResponse * handling.steering,
      steeringMax: THREE.MathUtils.degToRad(CONFIG.vehicle.steeringMaxDeg * (0.9 + handling.steering * 0.1)),
      maxSpeed: CONFIG.vehicle.maxSpeed * (handling.maxSpeed / 58),
    };
    if (this.vehicle) {
      this.vehicle.lateralGrip = this.tuning.lateralGrip;
      this.vehicle.steeringResponse = this.tuning.steeringResponse;
      this.vehicle.steeringMax = this.tuning.steeringMax;
      this.vehicle.maxSpeed = this.tuning.maxSpeed;
      this.vehicle.driftModel.minSpeed = CONFIG.drift.minSpeed * (this.settings.handling === 'Sim' ? 1.08 : 0.96);
    }
    this.applyTimeOfDay();
    this.hud?.setSettings(this.settings);
    this.resize();
  }

  applyTimeOfDay() {
    const preset = getTimePreset(this.settings.timeOfDay);
    this.scene.background = new THREE.Color(preset.background);
    this.scene.fog = new THREE.FogExp2(preset.fog, preset.fogDensity);
    if (this.hemi) {
      this.hemi.color.setHex(preset.hemiSky);
      this.hemi.groundColor.setHex(preset.hemiGround);
      this.hemi.intensity = preset.ambient;
    }
    if (this.sun) {
      this.sun.color.setHex(preset.sun);
      this.sun.intensity = preset.sunIntensity;
      this.sun.position.set(this.settings.timeOfDay === 'night' ? -46 : -84, this.settings.timeOfDay === 'night' ? 74 : 132, this.settings.timeOfDay === 'night' ? 62 : 48);
    }
    if (this.fill) this.fill.intensity = this.settings.timeOfDay === 'night' ? 0.42 : 0.22;
    if (this.stars) this.stars.material.opacity = preset.stars;
    this.headlightsEnabled = this.settings.timeOfDay === 'night' || this.headlightsEnabled;
    this.headlights.forEach((light) => { light.visible = this.headlightsEnabled; });
  }

  setMenuState() {
    this.state = 'menu';
    this.session = null;
    this.audio?.silence();
    this.input?.setDrivingVisible(false);
    this.hud?.showMenu();
    this.hud?.setCountdown('');
    this.hud?.setStateLabel('READY');
    if (this.vehicle && this.world) this.vehicle.respawn(this.world.getSpawnTransform(0));
    this.camera?.setMode('chase');
  }

  beginRun(mode = 'sprint') {
    const selected = MODES[mode] ? mode : 'sprint';
    this.mode = selected;
    this.session = {
      mode: selected,
      lap: 1,
      laps: MODES[selected].laps,
      elapsed: 0,
      lapTime: 0,
      progress: 0,
      lastProgress: 0,
      hasLeftStart: false,
      wrongWay: false,
      boost: 100,
      topSpeed: 0,
      respawns: 0,
      checkpoint: 0,
      completed: false,
    };
    this.vehicle.driftModel.reset({ preserveBank: false });
    this.vehicle.respawn(this.world.getSpawnTransform(0));
    this.camera.setMode('chase');
    this.countdownClock = 0;
    this.countdownValue = 3;
    this.state = 'countdown';
    this.hud.showRace();
    this.hud.setCountdown('3');
    this.hud.setStateLabel('STAGED');
    this.input.setDrivingVisible(false);
    this.audio.unlock().then(() => this.audio.countdown(3)).catch(() => {});
  }

  start(mode = 'sprint') {
    this.beginRun(mode);
    return this;
  }

  pause() {
    if (!['running', 'countdown'].includes(this.state)) return;
    this.pausedFrom = this.state;
    this.state = 'paused';
    this.input.setDrivingVisible(false);
    this.hud.showPause(this.mode === 'drift' ? 'Drift score is frozen.' : 'Take a breath. The ridge will wait.');
    this.audio.updateTire({ intensity: 0, speedMps: 0 });
    this.audio.updateEngine({ rpm: 900, speedMps: 0, throttle: 0, boost: false });
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = this.pausedFrom;
    this.hud.showRace();
    this.input.setDrivingVisible(this.state === 'running');
  }

  openSettings(source = 'menu') {
    this.settingsReturnState = this.state !== 'settings' ? this.state : (source === 'pause' ? 'paused' : 'menu');
    this.state = 'settings';
    this.input.setDrivingVisible(false);
    this.hud.openSettings(this.settingsReturnState === 'paused' ? 'pause' : 'menu');
  }

  restoreAfterSettings() {
    const returnTarget = this.settingsReturnState || 'menu';
    if (returnTarget === 'paused') {
      this.state = 'paused';
      this.hud.showPause(this.mode === 'drift' ? 'Drift score is frozen.' : 'Take a breath. The ridge will wait.');
    } else if (returnTarget === 'running' || returnTarget === 'countdown') {
      this.state = returnTarget;
      this.hud.showRace();
      this.input.setDrivingVisible(this.state === 'running');
    } else if (returnTarget === 'finished') {
      this.state = 'finished';
    } else {
      this.state = 'menu';
      this.hud.showMenu();
    }
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
  }

  handleGlobalInput(input) {
    if (input.fullscreen) this.toggleFullscreen();
    if (input.mute) this.audio.toggleMute();
    if (input.debug) {
      this.debugVisible = !this.debugVisible;
      this.hud.setDebugVisible(this.debugVisible);
    }
    if (input.pause && ['running', 'countdown'].includes(this.state)) this.pause();
    else if (input.pause && this.state === 'paused') this.resume();
    if (!['running', 'countdown'].includes(this.state)) return;
    if (input.camera) this.camera.cycle();
    if (input.headlights) {
      this.headlightsEnabled = !this.headlightsEnabled;
      this.headlights.forEach((light) => { light.visible = this.headlightsEnabled; });
      this.audio.ui();
    }
    if (input.respawn && this.state === 'running') {
      if (this.session) this.session.respawns += 1;
      this.vehicle.respawn();
      this.audio.respawn();
    }
    if (input.transmission && this.state === 'running') {
      this.settings = normalizeSettings({ ...this.settings, transmission: this.settings.transmission === 'auto' ? 'manual' : 'auto' });
      saveSettings(this.settings);
      this.hud.setSettings(this.settings);
      this.audio.shift();
    }
  }

  updateCountdown(dt) {
    this.vehicle.step(0, { driftAssist: this.settings.driftAssist });
    this.countdownClock += dt;
    const remaining = 3 - Math.floor(this.countdownClock);
    if (remaining > 0 && remaining !== this.countdownValue) {
      this.countdownValue = remaining;
      this.hud.setCountdown(`${remaining}`);
      this.audio.countdown(remaining);
    }
    if (this.countdownClock >= 3) {
      this.state = 'running';
      this.input.setDrivingVisible(true);
      this.hud.setCountdown('GO');
      this.hud.setStateLabel(this.mode === 'roam' ? 'EXPLORE' : 'RUNNING');
      this.audio.countdown('GO');
      this.goTimer = 0.72;
    }
  }

  updateNitro(dt, input) {
    if (!this.session) return false;
    const boosting = Boolean(input.boost && input.throttle > 0 && this.session.boost > 0);
    this.vehicle.engineForce = this.tuning.engineForce * (boosting ? 1.22 : 1);
    if (boosting) this.session.boost = Math.max(0, this.session.boost - dt * 25);
    else this.session.boost = Math.min(100, this.session.boost + dt * 7);
    if (boosting && Math.random() > 0.6) this.effects.emitBoost(this.vehicle, this.vehicle.getPose());
    return boosting;
  }

  getControls(input, pose) {
    let brake = input.brake;
    if (this.settings.abs && pose.speedKmh > 18) {
      brake = Math.min(brake, 0.82);
    }
    return { throttle: input.throttle, brake, steer: input.steer, handbrake: input.handbrake, driftAssist: this.settings.driftAssist };
  }

  updateTransmission(dt, input, pose) {
    const longitudinal = pose.velocity.dot(pose.forward);
    if (longitudinal < -1.2) {
      this.gear = 'R';
      this.rpm = clamp(900 + Math.abs(longitudinal) * 140, 900, 3600);
      return;
    }
    const speed = pose.speedKmh;
    const previous = this.gear;
    if (this.settings.transmission === 'manual') {
      if (typeof this.gear !== 'number') this.gear = 1;
      if (input.manualUp) this.gear = Math.min(6, this.gear + 1);
      if (input.manualDown) this.gear = Math.max(1, this.gear - 1);
    } else {
      const next = speed < 24 ? 1 : speed < 47 ? 2 : speed < 70 ? 3 : speed < 96 ? 4 : speed < 126 ? 5 : 6;
      this.gear = next;
    }
    const ratio = [3.6, 2.4, 1.8, 1.4, 1.1, 0.9][Math.max(1, this.gear) - 1] || 0.9;
    const targetRpm = 900 + speed * ratio * 34 + pose.throttle * 980;
    this.rpm = damp(this.rpm, clamp(targetRpm, 900, 7600), 9, dt);
    if (previous !== this.gear && typeof previous === 'number') this.audio.shift();
  }

  updateProgress(pose) {
    if (!this.session) return;
    const nearest = this.world.road.getNearestPoint(this.vehicle.position.x, this.vehicle.position.z);
    const progress = nearest?.progress ?? this.session.progress;
    const previousProgress = this.session.progress;
    const speed = pose.speedMps || 0;
    this.session.progress = progress;
    this.session.wrongWay = speed > 7 && (pose.velocity.dot(pose.forward) < -1.4 || Boolean(nearest && nearest.tangent.dot(pose.forward) < -0.35));
    if (progress > 0.08) this.session.hasLeftStart = true;
    if (this.session.hasLeftStart && this.session.elapsed > 4 && previousProgress > 0.82 && progress < 0.18 && this.mode !== 'roam') {
      this.session.lap += 1;
      this.session.lapTime = 0;
      this.session.hasLeftStart = false;
      if (this.session.lap > this.session.laps) {
        this.session.lap = this.session.laps;
        this.finishRun();
        return;
      }
      this.audio.ui();
    }
    const checkpointCount = this.world.road.checkpoints.length;
    const checkpoint = Math.floor(progress * checkpointCount) % checkpointCount;
    if (checkpoint !== this.session.checkpoint && (progress >= previousProgress || previousProgress > 0.85)) {
      this.session.checkpoint = checkpoint;
      const data = this.world.road.getCheckpoint(checkpoint);
      if (data) this.vehicle.setCheckpoint(data);
    }
  }

  updateRunning(dt, input) {
    if (!this.session) return;
    this.session.elapsed += dt;
    this.session.lapTime += dt;
    const beforeRespawn = this.vehicle.respawnCount;
    const beforePose = this.vehicle.getPose();
    const boosting = this.updateNitro(dt, input);
    const snapshot = this.vehicle.step(dt, this.getControls(input, beforePose));
    if (this.vehicle.respawnCount > beforeRespawn) {
      this.session.respawns += this.vehicle.respawnCount - beforeRespawn;
      this.audio.respawn();
    }
    this.session.topSpeed = Math.max(this.session.topSpeed, snapshot.speedKmh || 0);
    this.updateTransmission(dt, input, snapshot);
    this.updateProgress(snapshot);
    this.effects.emitVehicle(this.vehicle, snapshot, dt);
    const driftAngleDeg = Math.abs(snapshot.drift?.angleDeg || 0);
    const slipIntensity = snapshot.drift?.drifting ? clamp(driftAngleDeg / 40, 0.35, 1.6) : (snapshot.brake > 0.4 && snapshot.speedMps > 8 ? 0.6 : 0);
    this.audio.updateTire({ intensity: slipIntensity, speedMps: snapshot.speedMps, surface: snapshot.surface });
    this.audio.updateEngine({ rpm: this.rpm, speedMps: snapshot.speedMps, throttle: snapshot.throttle, drifting: snapshot.drift?.drifting, boost: boosting });
    if (this.mode === 'drift' && this.session.elapsed >= CONFIG.race.driftDuration) this.finishRun();
  }

  finishRun() {
    if (this.state === 'finished' || !this.session) return;
    this.state = 'finished';
    this.session.completed = true;
    this.input.setDrivingVisible(false);
    this.hud.setCountdown('');
    this.hud.setStateLabel('FINISHED');
    const pose = this.vehicle.getPose();
    const score = (pose.drift?.bank || 0) + (pose.drift?.score || 0);
    this.audio.finish();
    this.hud.showFinish({ mode: this.mode, time: this.session.elapsed, score, topSpeed: this.session.topSpeed, respawns: this.session.respawns });
  }

  updateHUD() {
    const pose = this.vehicle?.getPose?.() || {};
    const session = this.session || { lap: 1, laps: 1, elapsed: 0, gear: 'N', rpm: 900, boost: 100, wrongWay: false };
    const debug = `state   ${this.state}\nmode    ${this.mode}\ncamera  ${this.camera?.modeName || 'CHASE'}\nsurface ${pose.surface || 'asphalt'}\nspeed   ${(pose.speedKmh || 0).toFixed(1)} km/h\nfixed   ${this.vehicle?.fixedSteps || 0}`;
    this.hud.update({ pose, session: { ...session, gear: this.gear, rpm: this.rpm }, mode: MODES[this.mode]?.label?.toLowerCase() || this.mode, camera: this.camera?.modeName || 'CHASE', debug });
  }

  onFrame(now) {
    const dt = clamp((now - this.lastTime) / 1000, 0, 0.05);
    this.lastTime = now;
    const input = this.input.update();
    this.handleGlobalInput(input);
    if (this.state === 'countdown') this.updateCountdown(dt);
    else if (this.state === 'running') this.updateRunning(dt, input);
    if (this.goTimer > 0) {
      this.goTimer -= dt;
      if (this.goTimer <= 0) this.hud.setCountdown('');
    }
    this.effects.update(dt);
    this.camera.update(dt, input);
    this.world.update(this.camera.getCamera().position);
    this.updateHUD();
    this.renderer.render(this.scene, this.camera.getCamera());
    this.frameHandle = requestAnimationFrame(this.onFrame);
  }

  resize() {
    if (!this.renderer || !this.camera) return;
    const width = Math.max(1, this.root.clientWidth || window.innerWidth);
    const height = Math.max(1, this.root.clientHeight || window.innerHeight);
    this.renderer.setSize(width, height, false);
    this.camera.resize(width, height);
  }

  getSnapshot() {
    return {
      state: this.state,
      mode: this.mode,
      settings: { ...this.settings },
      pose: this.vehicle?.getPose?.() || null,
      session: this.session ? { ...this.session, gear: this.gear, rpm: this.rpm } : null,
      camera: this.camera?.mode || 'chase',
    };
  }

  dispose() {
    cancelAnimationFrame(this.frameHandle);
    window.removeEventListener('resize', this.onResize);
    if (this.onFullscreenChange) document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    this.input?.destroy();
    this.effects?.dispose();
    this.audio.dispose();
    this.vehicle?.dispose();
    this.world?.dispose();
    if (this.decorations) {
      this.decorations.traverse((child) => {
        if (child.isMesh) {
          child.geometry?.dispose?.();
          child.material?.dispose?.();
        }
      });
      this.scene?.remove(this.decorations);
    }
    if (this.stars) {
      this.stars.geometry?.dispose?.();
      this.stars.material?.dispose?.();
      this.scene?.remove(this.stars);
    }
    this.renderer?.dispose();
    this.hud?.destroy();
  }
}

const root = document.querySelector('#app');
const game = new MountainGame(root);
globalThis.__MOUNTAIN_DRIFT__ = game;
try {
  game.init();
} catch (error) {
  console.error(error);
  const failure = document.createElement('section');
  failure.className = 'fatal-error';
  failure.innerHTML = `<div><div class="eyebrow">RUNTIME LOAD FAILURE</div><h2>Could not start Mountain Drift</h2><p>${String(error?.message || error)}</p><p>Serve the project root with <code>python -m http.server 8080</code> and allow the Three.js CDN request.</p></div>`;
  root.appendChild(failure);
}
