import { getCar } from '../vehicle/cars.js';
import { getMode, getNeon, getPaint, getSmoke, MODES } from '../config.js';
import { RIM_OPTIONS, medalTargets } from '../meta/catalog.js';
import { LEGACY_MAP, modeOfTrack, trackKey } from '../meta/trackKey.js';
import { GhostRecorder } from '../ghost/GhostRecorder.js';
import { GhostPlayer } from '../ghost/GhostPlayer.js';
import { loadLocalGhost, saveLocalGhost } from '../ghost/ghostStore.js';
import { decodeGhost, encodeGhost } from '../ghost/ghostCodec.js';
import { GhostCar } from '../render/GhostCar.js';
import { buildPaceGhost } from '../ghost/paceGhost.js';
import { RouteProgress, formatRaceTime } from './PartyRace.js';
import * as THREE from 'three';

const ghostPosition = new THREE.Vector3();
const ghostQuaternion = new THREE.Quaternion();
const SPLIT_BUCKETS = 100;

/**
 * Builds a 0..100% progress -> elapsed-seconds lookup table for a recorded ghost on a timed route.
 * Computed once at run start so live Trackmania-style +/- split deltas cost zero locates per frame.
 */
export function buildGhostSplitTable(ghostData, world, mode) {
  if (!ghostData || !world || !mode || mode.id === 'roam' || mode.id === 'drift') return null;
  const route = world.routes?.[mode.route];
  if (!route) return null;
  const count = Math.max(0, Math.floor(ghostData.count || 0));
  if (count < 2 || !ghostData.positions?.length) return null;
  const rate = ghostData.rate > 0 ? ghostData.rate : 10;
  const tracker = new RouteProgress(world, route, mode.laps || 1);
  if (!(tracker.total > 0)) return null;

  const times = new Float32Array(SPLIT_BUCKETS + 1);
  times.fill(NaN);
  times[0] = 0;
  let maxPct = 0;
  let prevPct = 0;
  let prevTime = 0;
  for (let i = 0; i < count; i += 1) {
    const x = ghostData.positions[i * 3];
    const y = ghostData.positions[i * 3 + 1];
    const z = ghostData.positions[i * 3 + 2];
    const d = tracker.update(x, z, y);
    if (!Number.isFinite(d)) continue;
    const pct = Math.max(0, Math.min(SPLIT_BUCKETS, (d / tracker.total) * SPLIT_BUCKETS));
    const t = i / rate;
    if (pct > maxPct) {
      const startB = Math.floor(maxPct) + 1;
      const endB = Math.floor(pct);
      for (let b = startB; b <= endB; b += 1) {
        const alpha = (b - prevPct) / Math.max(1e-6, pct - prevPct);
        times[b] = prevTime + (t - prevTime) * Math.max(0, Math.min(1, alpha));
      }
      maxPct = pct;
    }
    prevPct = pct;
    prevTime = t;
  }
  const endT = Number.isFinite(ghostData.time) && ghostData.time > 0 ? ghostData.time : (count - 1) / rate;
  for (let b = Math.floor(maxPct) + 1; b <= SPLIT_BUCKETS; b += 1) {
    times[b] = endT;
  }
  return times;
}

/** Interpolates ghost elapsed time at `progress` (0..1); returns null if unavailable. */
export function ghostTimeAtProgress(table, progress) {
  if (!table || !Number.isFinite(progress)) return null;
  const scaled = Math.max(0, Math.min(SPLIT_BUCKETS, progress * SPLIT_BUCKETS));
  const lo = Math.floor(scaled);
  const hi = Math.min(SPLIT_BUCKETS, lo + 1);
  const a = table[lo];
  const b = table[hi];
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return a + (b - a) * (scaled - lo);
}

/**
 * Everything around the driving that gives it a point: the career (XP, Credits, upgrades,
 * car/map/feature unlocks, medals, achievements, daily challenge, cosmetics), ghost replays,
 * live ghost split deltas, and the online leaderboard and players when a network client is attached.
 */
export class MetaLayer {
  constructor({ career, hud, scene, wheelLayout, game, mapId = LEGACY_MAP }) {
    this.career = career;
    this.hud = hud;
    this.mapId = mapId;
    this.lobby = trackKey(mapId, 'mountain');
    career.setMap?.(mapId);
    hud.setMap?.(mapId);
    this.scene = scene;
    this.game = game;
    this.wheelLayout = wheelLayout;
    this.recorder = new GhostRecorder({ rate: 10 });
    this.ghost = null;
    this.ghostSplitTable = null;
    this.ghostDelta = null;
    this.ghostCar = null;
    this.ghostVisible = true;
    this.pendingGhost = null;
    this.leaderboard = null;
    this.net = null;
    this.room = null;
    this.partyRoom = null;
    this.onlineTimer = 0;
    this.connection = 'offline';
    this.online = null;
    this.timeOfDay = 'day';
    this.bindHud();
  }

  attachNetwork({ leaderboard = null, net = null } = {}) {
    this.leaderboard = leaderboard;
    this.net = net;
    this.updateConnection();
    if (net) {
      net.onIdentityClaimed = () => this.career.rollPlayerId();
      net.onStatus(() => this.updateConnection());
      net.onRoster((peers) => this.updateRoster(peers));
      net.join(this.lobby);
    }
    this.pollOnline();
    this.onlineTimer = setInterval(() => this.pollOnline(), 60000);
    this._onVisibilityChange = () => {
      if (typeof document !== 'undefined' && !document.hidden && this.net?.status !== 'connected') {
        this.pollOnline();
      }
    };
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', this._onVisibilityChange);
    }
  }

  updateConnection() {
    const net = this.net;
    if (!net || net.mode === 'offline') this.connection = 'offline';
    else if (net.mode === 'local') this.connection = 'local';
    else this.connection = net.status === 'connected' ? 'online' : net.status === 'connecting' ? 'connecting' : 'online';
    this.refreshProfile();
  }

  updateRoster(peers) {
    const list = [{ id: this.career.profile.id, name: this.career.profile.name, level: this.career.level, modeLabel: this.roomLabel(), isMe: true }];
    for (const [id, peer] of peers || []) {
      const modeId = peer.modeId;
      const label = (!modeId || modeId === 'menu') ? 'Menu' : (getMode(modeId)?.label || 'Driving');
      list.push({ id, name: peer.name, level: peer.level, modeLabel: label, isMe: false });
    }
    this.hud.setPlayers(list);
    this.online = list.length;
    this.refreshProfile();
    if (list.length > 1 && this.career.run) this.career.onMultiplayer();
  }

  roomLabel() {
    return this.room ? getMode(this.room).label : 'Menu';
  }

  async pollOnline() {
    if (typeof document !== 'undefined' && document.hidden) return;
    if (this.net?.status === 'connected') {
      this.online = (this.net.peers?.size ?? 0) + 1;
      this.refreshProfile();
      return;
    }
    if (!this.net || this.game.state === 'running' || this.game.state === 'countdown') return;
    try {
      const { total } = await this.net.online();
      this.online = Number.isFinite(total) ? total : null;
      this.refreshProfile();
    } catch {
      // Presence is decoration; ignore failures.
    }
  }

  trackKey(modeId) {
    return trackKey(this.mapId, modeId);
  }

  joinRoom(modeId) {
    this.room = modeId;
    if (this.net && !this.partyRoom && this.net.modeId !== this.lobby) {
      this.net.join(this.lobby);
    }
    this.net?.setMode(modeId);
    this.updateRoster(this.net?.peers);
  }

  leaveRoom() {
    this.room = null;
    this.net?.setMode('menu');
    this.updateRoster(this.net?.peers);
  }

  enterParty(roomName, options) {
    this.partyRoom = roomName;
    this.net?.join(roomName, options);
    this.net?.setMode(this.room || 'menu');
    this.updateRoster(this.net?.peers);
  }

  exitParty() {
    if (!this.partyRoom) return;
    this.partyRoom = null;
    this.net?.join(this.lobby);
    this.net?.setMode(this.room || 'menu');
    this.updateRoster(this.net?.peers);
  }

  // ------------------------------------------------------------------ HUD

  bindHud() {
    const { hud, career } = this;
    hud.onRename = (name) => {
      const firstLaunch = career.needsName;
      if (!career.setName(name)) career.keepName();
      this.refreshProfile();
      if (firstLaunch && this.game.state === 'menu' && this.game.pendingRoamOnName) {
        this.game.pendingRoamOnName = false;
        this.game.startFirstDrive();
      }
    };
    hud.onFavoriteCar = (carId) => {
      career.toggleFavoriteCar(carId);
      hud.setGarage(career.garage());
    };
    hud.onCosmetic = (slot, value) => {
      if (career.setCosmetic(slot, value)) {
        this.applyLook(this.game.car);
        this.syncNetProfile();
        this.game.partyRace?.pushView?.();
      }
      hud.setGarage(career.garage());
    };
    hud.onPreviewCar = (carId) => this.previewGarageCar(carId);
    hud.onBuyUpgrade = (carId, slotId) => {
      const res = career.buyUpgrade(carId, slotId);
      if (res.ok) {
        this.game.audio?.purchase?.();
        this.game.applyActiveVehicleTuning?.();
        this.flushEvents();
        this.refreshAll();
        hud.toast(`${res.stage.label} installed!`, 'good');
      } else {
        const msg = res.reason === 'level-locked' ? `Reach Level ${res.level} for this stage`
          : res.reason === 'insufficient-credits' ? `Need ${res.cost?.toLocaleString('en-US')} CR`
            : res.reason === 'car-locked' ? 'Unlock this car first'
              : 'Already maxed out';
        hud.toast(msg, 'warn');
      }
    };
    hud.onBuyCarEarly = (carId) => {
      const res = career.buyCarEarly(carId);
      if (res.ok) {
        this.game.audio?.purchase?.();
        this.applyLook(this.game.car);
        this.syncNetProfile();
        this.flushEvents();
        this.refreshAll();
        hud.toast(`${getCar(carId).label} unlocked early!`, 'good');
      } else {
        hud.toast(res.reason === 'insufficient-credits' ? 'Not enough Chai Credits yet' : 'Cannot unlock yet', 'warn');
      }
    };
    hud.onTestDriveCar = (carId) => {
      const activateTrial = () => {
        if (!career.startTrialCar(carId)) return;
        this.applyLook(this.game.car);
        this.refreshAll();
        hud.toast(`Test Drive active: ${getCar(carId).label} for 1 run!`, 'good');
      };
      if (this.game.platform?.initialized) {
        this.game.audio?.silence?.();
        this.game.platform.requestRewardedAd({
          onStart: () => this.game.audio?.setAdMuted?.(true),
          onReward: activateTrial,
          onFinish: () => this.game.audio?.setAdMuted?.(false),
        });
      } else {
        activateTrial();
      }
    };
    hud.onDoubleRewards = () => {
      const applyDouble = () => {
        const bonus = career.claimAdDoubleBonus();
        if (!bonus) return;
        this.game.audio?.purchase?.();
        this.refreshAll();
        hud.applyAdDoubleBonus?.(bonus);
        hud.toast(`2x Bonus! +${bonus.xpBonus} XP · +${bonus.crBonus} CR`, 'good');
      };
      if (this.game.platform?.initialized) {
        this.game.audio?.silence?.();
        this.game.platform.requestRewardedAd({
          onStart: () => this.game.audio?.setAdMuted?.(true),
          onReward: applyDouble,
          onFinish: () => this.game.audio?.setAdMuted?.(false),
        });
      } else {
        applyDouble();
      }
    };
    hud.onStartDaily = () => {
      const daily = career.daily();
      if (daily.timeOfDay) this.game.applyTimeOfDay(daily.timeOfDay);
      this.game.beginRun(daily.modeId);
    };
    hud.onDuel = (rivalId) => this.startDuel(rivalId);
    hud.onRaceGhost = () => {
      if (career.isFeatureUnlocked && !career.isFeatureUnlocked('ghosts')) {
        hud.toast('Ghost Rivals unlock at Level 2', 'info');
        return;
      }
      this.ghostVisible = true;
      this.game.beginRun(this.game.mode.id);
    };
    hud.onToggleGhost = () => {
      this.ghostVisible = !this.ghostVisible;
      this.ghostCar?.setVisible(this.ghostVisible && Boolean(this.ghost));
      if (this.ghost) hud.setGhost({ name: this.ghost.data.name || 'Ghost', kind: this.ghost.kind, visible: this.ghostVisible });
    };
    hud.onOpenLeaderboard = (modeId) => this.loadLeaderboard(modeId);
    hud.onLeaderboardRequest = (modeId) => this.loadLeaderboard(modeId);
    hud.onRaceLeaderboardGhost = (modeId, playerId) => this.raceLeaderboardGhost(modeId, playerId);
  }

  publicProfile() {
    const profile = this.career.profile;
    return {
      id: profile.id,
      name: profile.name,
      level: this.career.level,
      cosmetics: { ...profile.cosmetics, car: this.career.activeCarId?.() ?? profile.cosmetics.car },
    };
  }

  refreshProfile() {
    this.hud.setProfile({
      name: this.career.profile.name,
      level: this.career.levelInfo(),
      credits: this.career.credits ?? 0,
      connection: this.connection,
      online: this.online,
      adDoubleReady: Boolean(this.game.platform?.initialized && this.career.lastReward && !this.career.lastReward.claimed && (this.career.lastReward.xpGained > 0 || this.career.lastReward.creditsGained > 0)),
      trialCar: this.career.trialCar || null,
    });
    this.syncNetProfile();
  }

  syncNetProfile() {
    const profile = this.publicProfile();
    const key = `${profile.name}|${profile.level}|${profile.cosmetics.paint}|${profile.cosmetics.rim}|${profile.cosmetics.number}|${profile.cosmetics.neon}|${profile.cosmetics.car}`;
    if (key === this.sentProfileKey) return;
    this.sentProfileKey = key;
    this.net?.updateProfile?.(profile);
    this.leaderboard?.updateProfile?.(profile);
  }

  refreshAll() {
    const { hud, career } = this;
    this.refreshProfile();
    hud.setMedals(career.medalBoard());
    hud.setDaily(career.daily());
    hud.setRivals?.(career.rivals(undefined, this.game.records));
    hud.setAchievements(career.achievements());
    hud.setGarage(career.garage());
  }

  welcome() {
    if (this.career.needsName) this.hud.promptName(this.career.profile.name);
  }

  applyLook(car, overrideCarId = null) {
    const cosmetics = this.career.profile.cosmetics;
    const activeCarId = overrideCarId || this.career.activeCarId?.() || cosmetics.car;
    if (car === this.game.car && this.game.setCar) {
      this.game.setCar(activeCarId);
      car = this.game.car;
    }
    this.game.effects?.setSmokeColor?.(getSmoke(cosmetics.smoke).rgb);
    car.setLook({
      paint: getPaint(cosmetics.paint),
      rimColor: (RIM_OPTIONS.find((rim) => rim.id === cosmetics.rim) || RIM_OPTIONS[0]).color,
      number: cosmetics.number,
      neon: getNeon(cosmetics.neon && cosmetics.neon !== 'off' ? cosmetics.neon : getCar(activeCarId).neon || cosmetics.neon),
    });
  }

  /** Visually showcase any car in the 3D Garage (including locked ones) without equipping it to drive. */
  previewGarageCar(carId) {
    if (!carId || !this.game.car) return;
    this.applyLook(this.game.car, carId);
  }

  // ------------------------------------------------------------------ leaderboard

  async loadLeaderboard(modeId) {
    const { hud } = this;
    if (!MODES.some((mode) => mode.id === modeId) || modeId === 'roam' || !medalTargets(this.trackKey(modeId))) return;
    hud.setLeaderboard(modeId, { status: 'loading', entries: [] });
    try {
      const response = this.leaderboard ? await this.leaderboard.top(this.trackKey(modeId), 50) : this.localBoard(modeId);
      hud.setLeaderboard(modeId, { status: response.status, entries: response.entries });
    } catch {
      hud.setLeaderboard(modeId, { status: 'error', entries: [] });
    }
  }

  localBoard(modeId) {
    const record = this.game.records[modeId];
    const profile = this.career.profile;
    const isScore = modeId === 'drift';
    const value = isScore ? record?.score : record?.time;
    if (!Number.isFinite(value)) return { status: 'local', entries: [] };
    return {
      status: 'local',
      entries: [{
        rank: 1, playerId: profile.id, name: profile.name, level: this.career.level,
        time: isScore ? null : value, score: isScore ? value : null,
        hasGhost: Boolean(loadLocalGhost(this.trackKey(modeId))), at: Date.now(), isMe: true,
      }],
    };
  }

  async raceLeaderboardGhost(modeId, playerId) {
    if (this.career.isFeatureUnlocked && !this.career.isFeatureUnlocked('ghosts')) {
      this.hud.toast('Ghost Rivals unlock at Level 2', 'info');
      return;
    }
    let data = null;
    const key = this.trackKey(modeId);
    if (playerId === this.career.profile.id) {
      data = loadLocalGhost(key);
    } else if (this.leaderboard) {
      try {
        const text = await this.leaderboard.ghost(key, playerId);
        data = text ? decodeGhost(text) : null;
      } catch {
        data = null;
      }
    }
    if (!data) {
      this.hud.toast('That ghost is not available', 'warn');
      return;
    }
    this.pendingGhost = { data, kind: playerId === this.career.profile.id ? 'pb' : 'leaderboard', playerId };
    this.ghostVisible = true;
    this.game.beginRun(modeId);
  }

  // ------------------------------------------------------------------ runs

  beginRun(modeId, timeOfDay) {
    this.timeOfDay = timeOfDay;
    if (this.career.run) this.career.abandonRun();
    this.career.beginRun({
      modeId,
      timeOfDay,
      carId: this.career.activeCarId?.() || this.career.profile.cosmetics?.car,
      settings: this.game.settings,
    });
    if (this.duel && this.duel.modeId !== modeId) this.duel = null;
    if (this.duel) {
      this.career.run.rivalId = this.duel.id;
      this.duel.clock = 0;
      this.duel.finishedAt = null;
    }
    this.recorder.discard();
    const profile = this.career.profile;
    const key = this.trackKey(modeId);
    if (modeId !== 'roam') this.recorder.start(key, profile.name, profile.cosmetics.paint);

    const ghostsUnlocked = this.career.isFeatureUnlocked ? this.career.isFeatureUnlocked('ghosts') : true;
    let choice = this.pendingGhost && this.pendingGhost.data.modeId === key ? this.pendingGhost : null;
    this.pendingGhost = null;
    if (!choice && modeId !== 'roam' && ghostsUnlocked) {
      const data = loadLocalGhost(key);
      if (data) choice = { data, kind: 'pb', playerId: profile.id };
    }
    if (!ghostsUnlocked) choice = null;
    // A duel always shows the rival's car, whatever the ghost unlock or toggle says.
    if (this.duel) {
      choice = { data: this.duel.ghost, kind: 'rival' };
      this.ghostVisible = true;
    }
    this.setGhost(choice, modeId);
  }

  /** Race a rival: their pace ghost drives the event and crosses the line at their time. */
  startDuel(rivalId) {
    const rival = this.career.rivals(undefined, this.game.records).find((r) => r.id === rivalId);
    if (!rival || rival.state === 'locked') {
      this.hud.toast('Beat the rival before this one first', 'warn');
      return;
    }
    const mode = getMode(rival.modeId);
    const route = this.game.world?.routes?.[mode.route];
    const ghost = route && buildPaceGhost(this.game.world, route, mode.laps || 1, rival.time, {
      name: rival.name, paint: rival.paint, modeId: this.trackKey(rival.modeId),
    });
    if (!ghost) {
      this.hud.toast('This duel is not available on this map', 'warn');
      return;
    }
    this.duel = { id: rival.id, modeId: rival.modeId, ghost, catchUp: rival.catchUp, easeOff: rival.easeOff };
    this.hud.toast(`${rival.name}: beat ${formatRaceTime(rival.time)} on ${rival.modeLabel}`, 'info');
    this.game.beginRun(rival.modeId);
  }

  setGhost(choice, modeId = null) {
    this.ghost = choice ? { ...choice, player: new GhostPlayer(choice.data) } : null;
    this.ghostDelta = null;
    if (!this.ghost) {
      this.ghostSplitTable = null;
      this.ghostCar?.setVisible(false);
      this.hud.setGhost(null);
      return;
    }
    const mode = modeId ? getMode(modeId) : this.game.mode;
    this.ghostSplitTable = buildGhostSplitTable(this.ghost.data, this.game.world, mode);
    const data = this.ghost.data;
    const label = this.ghost.kind === 'pb' ? 'Your best' : data.name || 'Ghost';
    if (!this.ghostCar) {
      this.ghostCar = new GhostCar({ paintColor: data.paint || 'pearl', name: label, wheelLayout: this.wheelLayout });
      this.scene.add(this.ghostCar.group);
    } else {
      this.ghostCar.setColor(data.paint || 'pearl');
    }
    this.ghostCar.setLabel(label, formatGhostDetail(data));
    this.ghostCar.setVisible(this.ghostVisible);
    this.hud.setGhost({ name: label, kind: this.ghost.kind, visible: this.ghostVisible });
  }

  frame(dt, state, drift, elapsed, camera, sessionHud = null) {
    this.career.trackFrame(dt, state, drift);
    if (this.recorder.active) this.recorder.sample(elapsed, state);
    if (this.ghost?.kind === 'rival' && this.duel) {
      this.stepRival(dt, elapsed, sessionHud);
      this.updateGhost(this.duel.clock, camera, state.position);
      this.flushEvents();
      return;
    }
    this.updateGhost(elapsed, camera, state.position);
    if (this.ghostSplitTable && sessionHud && elapsed > 0.2 && Number.isFinite(sessionHud.progress)) {
      const ghostTime = ghostTimeAtProgress(this.ghostSplitTable, sessionHud.progress);
      this.ghostDelta = ghostTime !== null ? elapsed - ghostTime : null;
    } else {
      this.ghostDelta = null;
    }
    this.flushEvents();
  }

  /**
   * Rubber-banded rival: their replay clock runs faster while you lead (catchUp) and, for the easier
   * tiers, a touch slower when they are far ahead (easeOff), so the duel stays close but still has to be won.
   */
  stepRival(dt, elapsed, sessionHud) {
    const duel = this.duel;
    const total = duel.ghost.time;
    const atYou = sessionHud && Number.isFinite(sessionHud.progress) ? ghostTimeAtProgress(this.ghostSplitTable, sessionHud.progress) : null;
    // Seconds the rival leads by at your position (+ = you are behind), on the rival's own clock.
    const lead = atYou === null || elapsed < 0.5 ? 0 : duel.clock - atYou;
    let rate = 1;
    if (lead < 0) rate = 1 + Math.min(duel.catchUp, -lead * 0.08);
    else if (lead > 2.5) rate = 1 - Math.min(duel.easeOff, (lead - 2.5) * 0.02);
    duel.clock = Math.min(total, duel.clock + dt * rate);
    if (duel.finishedAt === null && duel.clock >= total) duel.finishedAt = elapsed;
    this.ghostDelta = atYou === null || elapsed < 0.2 ? null : lead;
  }

  /** When the rival crossed (or, still racing, will cross) the line, on the run clock. */
  rivalFinishTime(elapsed) {
    const duel = this.duel;
    if (!duel) return null;
    return duel.finishedAt ?? elapsed + Math.max(0, duel.ghost.time - duel.clock);
  }

  updateGhost(elapsed, camera, focus) {
    if (!this.ghost || !this.ghostCar) return;
    const pose = this.ghost.player.poseAt(Math.max(0, elapsed), ghostPosition, ghostQuaternion);
    this.ghostCar.setPose(ghostPosition, ghostQuaternion, pose.steer, elapsed);
    this.ghostCar.setVisible(this.ghostVisible);
    this.ghostCar.update(camera, focus);
  }

  idle(camera, focus) {
    if (this.ghost && this.ghostCar) this.updateGhost(0, camera, focus);
    this.flushEvents();
  }

  flushEvents() {
    const events = this.career.drainEvents();
    for (let i = 0; i < events.length; i += 1) this.hud.notify(events[i]);
    if (events.length) this.refreshProfile();
  }

  sessionEvent(event) {
    this.career.onSessionEvent(event);
  }

  respawn(elapsed, state) {
    this.career.onRespawn();
    if (this.recorder.active) this.recorder.markTeleport(elapsed, state);
  }

  finish(result) {
    const modeId = result.modeId;
    const beatGhost = this.ghost?.kind === 'leaderboard' && (modeId === 'drift' ? result.score > this.ghost.data.score : result.time < this.ghost.data.time);
    if (beatGhost) this.career.onBeatGhost();
    if (this.duel && this.career.run?.rivalId) this.career.run.rivalFinish = this.rivalFinishTime(result.time);
    const rewards = this.career.finishRun(result, { settings: this.game.settings, carId: this.game.carId });
    if (rewards) rewards.upNext = this.upNext(modeId);
    const ghost = this.recorder.active ? this.recorder.finish(result.time, result.score) : null;
    if (ghost && result.isRecord) {
      saveLocalGhost(this.trackKey(modeId), ghost);
      this.submit(modeId, result, ghost);
    }
    if (rewards?.trialEnded || this.career.clearTrialCar()) {
      this.applyLook(this.game.car);
      this.syncNetProfile();
    }
    this.hideGhost();
    this.flushEvents();
    this.refreshAll();
    return rewards;
  }

  consumeTrial() {
    if (this.career.clearTrialCar()) {
      this.applyLook(this.game.car);
      this.syncNetProfile();
    }
  }

  upNext(modeId) {
    const nextId = this.career.nextEvent(modeId);
    const mode = nextId ? this.game.modes?.find((entry) => entry.id === nextId) : null;
    return { modeId: mode ? mode.id : null, modeLabel: mode?.label || null, daily: this.career.daily(), unlock: this.career.nextUnlock(), nextMap: this.career.nextMap?.() || null };
  }

  async submit(modeId, result, ghost) {
    if (!this.leaderboard) return;
    try {
      const response = await this.leaderboard.submit(this.trackKey(modeId), result, encodeGhost(ghost));
      if (response?.accepted && response.status === 'online' && Number.isFinite(response.rank)) {
        this.hud.toast(`Global rank #${response.rank} on ${getMode(modeId).label}`, 'good');
      }
    } catch {
      // Leaderboards are best effort; the local record and ghost are already saved.
    }
  }

  leaveRun() {
    this.duel = null;
    const summary = this.career.run ? this.career.abandonRun() : null;
    this.recorder.discard();
    if (summary?.trialEnded || this.career.clearTrialCar()) {
      this.applyLook(this.game.car);
      this.syncNetProfile();
    }
    this.hideGhost();
    this.flushEvents();
    this.refreshAll();
  }

  hideGhost() {
    this.ghost = null;
    this.ghostSplitTable = null;
    this.ghostDelta = null;
    this.ghostCar?.setVisible(false);
    this.hud.setGhost(null);
  }

  dispose() {
    clearInterval(this.onlineTimer);
    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function' && this._onVisibilityChange) {
      document.removeEventListener('visibilitychange', this._onVisibilityChange);
    }
    this.ghostCar?.dispose();
    this.ghostCar = null;
  }
}

function formatGhostDetail(data) {
  if (modeOfTrack(data.modeId) === 'drift') return `${Math.round(data.score).toLocaleString('en-US')} pts`;
  const minutes = Math.floor(data.time / 60);
  return `${minutes}:${(data.time - minutes * 60).toFixed(2).padStart(5, '0')}`;
}
