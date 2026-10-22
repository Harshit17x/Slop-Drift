import * as THREE from 'three';
import { CONFIG } from './config.js';
import { AssetLoader } from './assets/AssetLoader.js';
import { inspectModel } from './assets/ModelInspector.js';
import { PhysicsWorld } from './physics/PhysicsWorld.js';
import { Vehicle } from './physics/Vehicle.js';
import { AICar } from './ai/AICar.js';
import { CameraRig } from './camera/CameraRig.js';
import { TrackBuilder } from './track/TrackBuilder.js';
import { ProceduralTrack } from './track/ProceduralTrack.js';
import { RacingLine } from './track/RacingLine.js';
import { Checkpoints } from './track/Checkpoints.js';
import { Input } from './input/Input.js';
import { HUD } from './ui/HUD.js';
import { Menu } from './ui/Menu.js';
import { Settings } from './ui/Settings.js';
import { Minimap } from './ui/Minimap.js';
import { Particles } from './fx/Particles.js';
import { SkidMarks } from './fx/SkidMarks.js';
import { PostFX } from './fx/PostFX.js';
import { AudioManager } from './audio/AudioManager.js';

const STATES = Object.freeze({ LOADING: 'loading', MENU: 'menu', COUNTDOWN: 'countdown', RACING: 'racing', PAUSED: 'paused', FINISHED: 'finished' });

function cloneCarAsset(asset) {
  const root = asset.root.clone(true);
  root.traverse((node) => {
    if (!node.isMesh) return;
    node.material = Array.isArray(node.material)
      ? node.material.map((material) => material?.clone?.() || material)
      : node.material?.clone?.() || node.material;
  });
  const inspection = inspectModel(root, { type: 'car' });
  return { root, inspection };
}

function formatDebug(game) {
  const pose = game.player?.getPose();
  const fps = game.frameMs > 0 ? (1000 / game.frameMs).toFixed(0) : '—';
  return `FPS ${fps} · ${game.frameMs.toFixed(1)}ms\n` +
    `PHYS ${game.physics.fixedDt * 1000}ms · bodies ${game.physics.world?.bodies?.len?.() ?? '—'}\n` +
    `POS ${pose?.position.x.toFixed(1) ?? '—'} / ${pose?.position.y.toFixed(1) ?? '—'} / ${pose?.position.z.toFixed(1) ?? '—'}\n` +
    `RPM ${pose?.rpm?.toFixed(0) ?? '—'} · ${pose?.gear ?? 'N'} · ${game.camera.modeName}`;
}

export class Game {
  constructor(container = document.querySelector('#app')) {
    this.container = container;
    this.state = STATES.LOADING;
    this.mode = 'time-trial';
    this.lastTime = performance.now();
    this.frameMs = 16.6;
    this.elapsed = 0;
    this.countdown = 0;
    this.debug = false;
    this.pausedByUser = false;
    this.track = null;
    this.line = null;
    this.checkpoints = null;
    this.ais = [];
    this.lastSpawn = null;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.graphics.maxPixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.renderer.shadowMap.enabled = CONFIG.graphics.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = 'game-canvas';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x7fb3d5);
    this.scene.fog = new THREE.FogExp2(0x7fb3d5, 0.0024);
    this.camera = new CameraRig(this.renderer, null);
    this.postFX = new PostFX(this.renderer, this.scene, this.camera.camera);
    this.physics = new PhysicsWorld();
    this.camera.physicsWorld = this.physics;
    this.input = new Input({ root: container });
    this.audio = new AudioManager();
    this.hud = new HUD(container);
    this.menu = new Menu(container);
    this.settings = new Settings(container, this.input);
    this.minimap = new Minimap(container);
    this.particles = new Particles(this.scene);
    this.skidMarks = new SkidMarks(this.scene);
    this.loader = new AssetLoader({ onProgress: (event) => this.updateLoading(event) });
    this.loading = this.createLoadingOverlay();
    this.pauseOverlay = this.createPauseOverlay();
    this.finishOverlay = this.createFinishOverlay();
    this.addLights();
    this.menu.hide();
    this.hud.setVisible(false);
    this.wireUI();
    window.addEventListener('resize', () => this.resize());
    this.loop = this.loop.bind(this);
  }

  addLights() {
    const hemi = new THREE.HemisphereLight(0xc6e2ff, 0x314b35, 2.25);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xffe3b0, 4.8);
    this.sun.position.set(-120, 240, 80);
    this.sun.castShadow = CONFIG.graphics.shadows;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 800;
    this.sun.shadow.camera.left = -250;
    this.sun.shadow.camera.right = 250;
    this.sun.shadow.camera.top = 250;
    this.sun.shadow.camera.bottom = -250;
    this.scene.add(this.sun);
    this.ambientGlow = new THREE.PointLight(0x4c97ff, 1.5, 180);
    this.ambientGlow.position.set(0, 30, 0);
    this.scene.add(this.ambientGlow);
  }

  createLoadingOverlay() {
    const overlay = document.createElement('section');
    overlay.className = 'loading-overlay';
    overlay.innerHTML = `<div class="loading-card"><div class="eyebrow">INITIALIZING RACE CONTROL</div><h2>Loading Hungaroring</h2><p data-status>Preparing assets…</p><div class="loading-track"><i data-fill></i></div><span data-percent>0%</span></div>`;
    this.container.appendChild(overlay);
    return overlay;
  }

  updateLoading(event) {
    if (!this.loading) return;
    const percent = Math.round((event.ratio || 0) * 100);
    this.loading.querySelector('[data-status]').textContent = `${event.type === 'car' ? 'Inspecting Alfa Romeo 155' : 'Streaming Hungaroring geometry'}…`;
    this.loading.querySelector('[data-fill]').style.width = `${percent}%`;
    this.loading.querySelector('[data-percent]').textContent = `${percent}%`;
  }

  createPauseOverlay() {
    const overlay = document.createElement('section');
    overlay.className = 'pause-overlay hidden';
    overlay.innerHTML = `<div class="pause-card"><div class="eyebrow">RACE CONTROL</div><h2>Paused</h2><button class="ui-button primary" data-resume>Resume</button><button class="ui-button" data-restart>Restart</button><button class="ui-button" data-settings>Settings</button><button class="ui-button" data-menu>Quit to menu</button></div>`;
    this.container.appendChild(overlay);
    overlay.querySelector('[data-resume]').addEventListener('click', () => this.resume());
    overlay.querySelector('[data-restart]').addEventListener('click', () => this.startMode(this.mode));
    overlay.querySelector('[data-settings]').addEventListener('click', () => this.settings.show());
    overlay.querySelector('[data-menu]').addEventListener('click', () => this.toMenu());
    return overlay;
  }

  createFinishOverlay() {
    const overlay = document.createElement('section');
    overlay.className = 'finish-overlay hidden';
    overlay.innerHTML = `<div class="finish-card"><div class="eyebrow">SESSION COMPLETE</div><h2>Checkered flag</h2><div class="results" data-results></div><button class="ui-button primary" data-retry>Retry</button><button class="ui-button" data-finish-menu>Back to menu</button></div>`;
    this.container.appendChild(overlay);
    overlay.querySelector('[data-retry]').addEventListener('click', () => this.startMode(this.mode));
    overlay.querySelector('[data-finish-menu]').addEventListener('click', () => this.toMenu());
    return overlay;
  }

  wireUI() {
    this.menu.onStart = (mode) => this.startMode(mode);
    this.menu.onSettings = () => this.settings.show();
    this.settings.onChange = ({ units }) => this.hud.setUnits(units);
  }

  async init() {
    await this.physics.init();
    const car = await this.loader.load(CONFIG.assets.car, 'car');
    let trackAsset = null;
    if (CONFIG.assets.useProvidedTrack) trackAsset = await this.loader.load(CONFIG.assets.track, 'track');
    this.assets = { car, track: trackAsset };
    if (trackAsset) {
      this.scene.add(trackAsset.root);
      this.track = new TrackBuilder(trackAsset.root, trackAsset.inspection, this.physics).build();
    } else {
      this.track = new ProceduralTrack(this.scene, this.physics).build();
      this.scene.add(this.track.root);
    }
    this.line = new RacingLine(this.track.buildDefaultRacingLine());
    this.checkpoints = new Checkpoints(this.line.points);
    this.minimap.setTrack(this.line.points, this.track.bounds);
    this.debugGroup = this.checkpoints.createDebugObject();
    this.debugLine = this.line.toLineObject();
    this.debugGroup.visible = false;
    this.debugLine.visible = false;
    this.scene.add(this.debugGroup, this.debugLine);

    const spawn = this.getRaceSpawn();
    this.lastSpawn = spawn;
    const playerAsset = cloneCarAsset(car);
    this.player = new Vehicle({ physicsWorld: this.physics, carAsset: playerAsset, scene: this.scene, color: 0xc92c42 });
    this.player.respawn(spawn);
    this.camera.attachVehicle(this.player);
    this.spawnAI();
    this.hud.setVisible(true);
    this.menu.show();
    this.loading.classList.add('hidden');
    this.state = STATES.MENU;
    this.lastTime = performance.now();
    requestAnimationFrame(this.loop);
  }

  getRaceSpawn() {
    if (this.track.racingLine?.length) return this.track.findSpawn();
    const point = this.line.points[0] || new THREE.Vector3();
    const next = this.line.points[1] || point.clone().add(new THREE.Vector3(0, 0, -1));
    const forward = next.clone().sub(point).setY(0).normalize();
    return { position: point.clone().add(new THREE.Vector3(0, 0.32, 0)), rotation: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), forward) };
  }

  spawnAI() {
    this.ais.forEach((ai) => ai.dispose());
    this.ais = [];
    const count = this.mode === 'race' ? CONFIG.race.aiCount : 0;
    for (let i = 0; i < count; i += 1) {
      const asset = cloneCarAsset(this.assets.car);
      const colors = [0x2e86de, 0xfca311, 0x8ac926, 0x8338ec, 0xff006e, 0x4cc9f0, 0xf77f00];
      const ai = new AICar({ physicsWorld: this.physics, carAsset: asset, scene: this.scene, racingLine: this.line, color: colors[i % colors.length], offset: (i % 2 ? 1 : -1) * (2.3 + (i % 3) * 0.55), difficulty: i % 3 === 0 ? 'Hard' : 'Medium' });
      ai.spawnAtDistance((i + 1) * 12);
      this.ais.push(ai);
    }
  }

  startMode(mode) {
    this.mode = mode;
    this.menu.hide();
    this.finishOverlay.classList.add('hidden');
    this.pauseOverlay.classList.add('hidden');
    this.hud.setMode(mode);
    this.hud.setVisible(true);
    this.spawnAI();
    this.lastSpawn = this.getRaceSpawn();
    this.player.respawn(this.lastSpawn);
    this.player.drivetrain.setReverse(false);
    this.checkpoints.reset();
    this.countdown = 3.4;
    this.elapsed = 0;
    this.state = STATES.COUNTDOWN;
    this.audio.unlock();
  }

  pause() {
    if (this.state !== STATES.RACING && this.state !== STATES.COUNTDOWN) return;
    this.state = STATES.PAUSED;
    this.pauseOverlay.classList.remove('hidden');
    this.hud.setVisible(false);
  }

  resume() {
    this.state = STATES.RACING;
    this.pauseOverlay.classList.add('hidden');
    this.hud.setVisible(true);
    this.audio.unlock();
  }

  toMenu() {
    this.state = STATES.MENU;
    this.pauseOverlay.classList.add('hidden');
    this.finishOverlay.classList.add('hidden');
    this.hud.setVisible(false);
    this.menu.show();
  }

  finish() {
    this.state = STATES.FINISHED;
    this.hud.setVisible(false);
    this.finishOverlay.querySelector('[data-results]').innerHTML = `<div><span>Mode</span><strong>${this.mode.replace('-', ' ').toUpperCase()}</strong></div><div><span>Best lap</span><strong>${this.checkpoints.bestLap ? (this.checkpoints.bestLap / 1000).toFixed(2) : '—'}s</strong></div><div><span>Drift bank</span><strong>${Math.round(this.player.driftSystem.bank).toLocaleString()}</strong></div>`;
    this.finishOverlay.classList.remove('hidden');
  }

  handleInput(dt) {
    const input = this.input.update();
    if (input.pause) { this.pause(); return input; }
    if (input.camera) this.camera.cycle();
    if (input.respawn) this.player.respawn(this.lastSpawn);
    if (input.transmission) this.player.drivetrain.toggleAutomatic();
    if (input.headlights) this.player.headlights = !this.player.headlights;
    if (input.mute) this.audio.toggleMute();
    if (input.debug) {
      this.debug = !this.debug;
      this.debugGroup.visible = this.debug;
      this.debugLine.visible = this.debug;
    }
    this.camera.setFreeLook({ ...input.freeLook, lookBack: input.lookBack });
    return input;
  }

  updateCountdown(dt) {
    this.countdown -= dt;
    const display = this.countdown > 2.55 ? '3' : this.countdown > 1.7 ? '2' : this.countdown > 0.85 ? '1' : this.countdown > 0 ? 'GO' : '';
    this.hud.showCountdown(display);
    if (display && display !== this.lastCountdownDisplay) { this.audio.countdown(display); this.lastCountdownDisplay = display; }
    if (this.countdown <= 0) { this.hud.showCountdown(''); this.state = STATES.RACING; this.lastCountdownDisplay = ''; }
  }

  updateRacing(dt, controls) {
    const playerResult = this.player.step(dt, {
      ...controls,
      headlights: this.player.headlights,
      launch: this.elapsed < 3 && controls.throttle > 0.8 && controls.brake > 0.8,
      driftAssist: CONFIG.drift.assistStrength,
    });
    const playerPose = this.player.getPose();
    this.ais.forEach((ai) => ai.stepAI(dt, playerPose));
    this.physics.step(dt);
    this.player.updateVisual(dt);
    this.ais.forEach((ai) => ai.updateVisual(dt));
    this.elapsed += dt;
    if (controls.nitro && playerResult.nitroActive) this.audio.nitro();
    if (playerResult.transmission?.lastShift) this.audio.engineShift();
    this.audio.updateEngine({ rpm: playerPose.rpm, throttle: playerPose.throttle, nitro: playerResult.nitroActive, cockpit: this.camera.modeName === 'cockpit' });
    this.emitFX(playerPose, playerResult.maxSlip);
    const race = this.checkpoints.update(playerPose.position, playerPose.velocity);
    if (race.finished && this.mode !== 'free-roam') this.finish();
    if (playerPose.drift?.drifting && Math.abs(playerPose.drift.angleDeg) > 18) this.audio.tireSqueal(Math.min(1, Math.abs(playerPose.drift.angleDeg) / 50));
    if (this.player.flipTimer > 3 || this.player.stuckTimer > 5) this.player.respawn(this.lastSpawn);
    return { ...playerPose, race, playerResult };
  }

  emitFX(pose, maxSlip) {
    this.player.wheels.forEach((wheel) => {
      if (!wheel.tire.contact) return;
      const slip = Math.max(maxSlip, Math.abs(wheel.tire.slipAngle) * 2);
      if (slip > 0.32) {
        const point = wheel.tire.contact.point;
        this.particles.spawnSmoke(point, Math.min(1.3, slip), pose.surface);
        if (slip > 0.5) this.skidMarks.add(point, pose.forward, slip);
      }
    });
    if (pose.nitro < 99 && pose.throttle > 0.2) {
      const exhaust = pose.position.clone().addScaledVector(pose.forward, -2.05).add(new THREE.Vector3(0, 0.4, 0));
      this.particles.spawn('flame', exhaust, pose.forward.clone().multiplyScalar(-2), 1.25);
    }
  }

  updateHUD(snapshot) {
    if (!snapshot) return;
    const aiPositions = this.ais.map((ai) => ai.getPose().position);
    const totalCars = this.ais.length + 1;
    const position = 1 + this.ais.filter((ai) => ai.getPose().speedMps > snapshot.speedMps + 1).length;
    this.hud.update({
      ...snapshot,
      position,
      totalCars,
      lap: snapshot.race?.lap,
      laps: snapshot.race?.laps,
      lapTime: snapshot.race?.lapTime,
      bestLap: snapshot.race?.bestLap,
      wrongWay: snapshot.race?.wrongWay,
      debug: this.debug ? formatDebug(this) : '',
    });
    this.minimap.update(snapshot.position, aiPositions);
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height);
    this.camera.resize(width, height);
    this.postFX.resize(width, height);
  }

  loop(now) {
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000));
    this.lastTime = now;
    this.frameMs += (dt * 1000 - this.frameMs) * 0.08;
    if (this.state !== STATES.PAUSED && this.state !== STATES.MENU && this.state !== STATES.FINISHED) {
      const input = this.handleInput(dt);
      if (this.state === STATES.COUNTDOWN) this.updateCountdown(dt);
      if (this.state === STATES.RACING) this.updateHUD(this.updateRacing(dt, input));
    }
    this.particles.update(dt);
    this.skidMarks.update(dt);
    this.camera.update(dt);
    this.postFX.render();
    requestAnimationFrame(this.loop);
  }
}

export { STATES };
