import { getMode, getPaint, MODES } from '../config.js';
import { RIM_OPTIONS } from '../meta/catalog.js';
import { GhostRecorder } from '../ghost/GhostRecorder.js';
import { GhostPlayer } from '../ghost/GhostPlayer.js';
import { loadLocalGhost, saveLocalGhost } from '../ghost/ghostStore.js';
import { decodeGhost, encodeGhost } from '../ghost/ghostCodec.js';
import { GhostCar } from '../render/GhostCar.js';
import * as THREE from 'three';

const ghostPosition = new THREE.Vector3();
const ghostQuaternion = new THREE.Quaternion();

/**
 * Everything around the driving that gives it a point: the career (XP, medals, achievements,
 * daily challenge, cosmetics), ghost replays, and the online leaderboard and players when a
 * network client is attached. Game calls the run hooks; this class talks to the HUD.
 */
export class MetaLayer {
  /**
   * @param {object} options
   * @param {import('../meta/Career.js').Career} options.career
   * @param {import('../ui/Hud.js').Hud} options.hud
   * @param {THREE.Scene} options.scene
   * @param {{x:number,y:number,z:number}[]} options.wheelLayout
   * @param {object} options.game  Callbacks into the game: beginRun(modeId, { daily }), applyTimeOfDay(name), car.
   */
  constructor({ career, hud, scene, wheelLayout, game }) {
    this.career = career;
    this.hud = hud;
    this.scene = scene;
    this.game = game;
    this.wheelLayout = wheelLayout;
    this.recorder = new GhostRecorder({ rate: 10 });
    this.ghost = null; // { player, data, kind: 'pb' | 'leaderboard', playerId }
    this.ghostCar = null;
    this.ghostVisible = true;
    this.pendingGhost = null; // a leaderboard ghost chosen for the next run
    this.leaderboard = null; // attached by attachNetwork()
    this.net = null;
    this.room = null;
    this.onlineTimer = 0;
    this.connection = 'offline';
    this.online = null;
    this.timeOfDay = 'day';
    this.bindHud();
  }

  /** Attach the online leaderboard / multiplayer client (src/net). Either may be null. */
  attachNetwork({ leaderboard = null, net = null } = {}) {
    this.leaderboard = leaderboard;
    this.net = net;
    this.updateConnection();
    if (net) {
      net.onStatus(() => this.updateConnection());
      net.onRoster((peers) => this.updateRoster(peers));
      net.join('mountain');
    }
    this.pollOnline();
    this.onlineTimer = setInterval(() => this.pollOnline(), 30000);
  }

  updateConnection() {
    const net = this.net;
    if (!net || net.mode === 'offline') this.connection = 'offline';
    else if (net.mode === 'local') this.connection = 'local';
    else this.connection = net.status === 'connected' ? 'online' : net.status === 'connecting' ? 'connecting' : 'online';
    this.refreshProfile();
  }

  /** Players in the current room, for the HUD list. Seeing anyone else during a run is an achievement. */
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

  /** How many people are online across all rooms (menus only; it costs server requests). */
  async pollOnline() {
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

  joinRoom(modeId) {
    this.room = modeId;
    if (this.net && this.net.modeId !== 'mountain') {
      this.net.join('mountain');
    }
    this.net?.setMode(modeId);
    this.updateRoster(this.net?.peers);
  }

  leaveRoom() {
    this.room = null;
    this.net?.setMode('menu');
    this.updateRoster(this.net?.peers);
  }

  // ------------------------------------------------------------------ HUD

  bindHud() {
    const { hud, career } = this;
    hud.onRename = (name) => {
      const firstLaunch = career.needsName;
      if (!career.setName(name)) career.keepName();
      this.refreshProfile();
      if (firstLaunch && this.game.state === 'menu') this.game.startFirstDrive();
    };
    hud.onCosmetic = (slot, value) => {
      if (career.setCosmetic(slot, value)) {
        this.applyLook(this.game.car);
        this.syncNetProfile();
      }
      hud.setGarage(career.garage());
    };
    hud.onStartDaily = () => {
      const daily = career.daily();
      if (daily.timeOfDay) this.game.applyTimeOfDay(daily.timeOfDay);
      this.game.beginRun(daily.modeId);
    };
    hud.onRaceGhost = () => {
      // Results screen: run the same event again against the personal best (now this run, if it was one).
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
    return { id: profile.id, name: profile.name, level: this.career.level, cosmetics: { ...profile.cosmetics } };
  }

  refreshProfile() {
    this.hud.setProfile({ name: this.career.profile.name, level: this.career.levelInfo(), connection: this.connection, online: this.online });
    this.syncNetProfile();
  }

  /** Tell the network about name, level or cosmetic changes, and only then (each message costs quota). */
  syncNetProfile() {
    const profile = this.publicProfile();
    const key = `${profile.name}|${profile.level}|${profile.cosmetics.paint}|${profile.cosmetics.rim}|${profile.cosmetics.number}`;
    if (key === this.sentProfileKey) return;
    this.sentProfileKey = key;
    this.net?.updateProfile?.(profile);
    this.leaderboard?.updateProfile?.(profile);
  }

  /** Push every piece of career state to the HUD (after load and after each run). */
  refreshAll() {
    const { hud, career } = this;
    this.refreshProfile();
    hud.setMedals(career.medalBoard());
    hud.setDaily(career.daily());
    hud.setAchievements(career.achievements());
    hud.setGarage(career.garage());
  }

  /** First launch: ask for a driver name. */
  welcome() {
    if (this.career.needsName) this.hud.promptName(this.career.profile.name);
  }

  applyLook(car) {
    const cosmetics = this.career.profile.cosmetics;
    car.setLook({
      paint: getPaint(cosmetics.paint),
      rimColor: (RIM_OPTIONS.find((rim) => rim.id === cosmetics.rim) || RIM_OPTIONS[0]).color,
      number: cosmetics.number,
    });
  }

  // ------------------------------------------------------------------ leaderboard

  async loadLeaderboard(modeId) {
    const { hud } = this;
    if (!MODES.some((mode) => mode.id === modeId) || modeId === 'roam') return;
    hud.setLeaderboard(modeId, { status: 'loading', entries: [] });
    try {
      const response = this.leaderboard ? await this.leaderboard.top(modeId, 50) : this.localBoard(modeId);
      hud.setLeaderboard(modeId, { status: response.status, entries: response.entries });
    } catch {
      hud.setLeaderboard(modeId, { status: 'error', entries: [] });
    }
  }

  /** Without a leaderboard service: this browser's best on the event, if any. */
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
        hasGhost: Boolean(loadLocalGhost(modeId)), at: Date.now(), isMe: true,
      }],
    };
  }

  async raceLeaderboardGhost(modeId, playerId) {
    let data = null;
    if (playerId === this.career.profile.id) {
      data = loadLocalGhost(modeId);
    } else if (this.leaderboard) {
      try {
        const text = await this.leaderboard.ghost(modeId, playerId);
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
    this.career.beginRun({ modeId, timeOfDay });
    this.recorder.discard();
    const profile = this.career.profile;
    if (modeId !== 'roam') this.recorder.start(modeId, profile.name, profile.cosmetics.paint);

    // Race a chosen leaderboard ghost, otherwise your own best on this event.
    let choice = this.pendingGhost && this.pendingGhost.data.modeId === modeId ? this.pendingGhost : null;
    this.pendingGhost = null;
    if (!choice && modeId !== 'roam') {
      const data = loadLocalGhost(modeId);
      if (data) choice = { data, kind: 'pb', playerId: profile.id };
    }
    this.setGhost(choice);
  }

  setGhost(choice) {
    this.ghost = choice ? { ...choice, player: new GhostPlayer(choice.data) } : null;
    if (!this.ghost) {
      this.ghostCar?.setVisible(false);
      this.hud.setGhost(null);
      return;
    }
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

  /** Every frame of a running event. `elapsed` is the race clock (0 at the start line). */
  frame(dt, state, drift, elapsed, camera) {
    this.career.trackFrame(dt, state, drift);
    if (this.recorder.active) this.recorder.sample(elapsed, state);
    this.updateGhost(elapsed, camera, state.position);
    this.flushEvents();
  }

  updateGhost(elapsed, camera, focus) {
    if (!this.ghost || !this.ghostCar) return;
    const pose = this.ghost.player.poseAt(Math.max(0, elapsed), ghostPosition, ghostQuaternion);
    this.ghostCar.setPose(ghostPosition, ghostQuaternion, pose.steer, elapsed);
    this.ghostCar.setVisible(this.ghostVisible);
    this.ghostCar.update(camera, focus);
  }

  /** Countdown and menus: keep the ghost parked on the start line and its label facing the camera. */
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

  /**
   * A run reached the finish. Returns the RewardSummary for the results screen.
   * @param {import('../core/contracts.js').RunResult} result
   */
  finish(result) {
    const modeId = result.modeId;
    const beatGhost = this.ghost?.kind === 'leaderboard' && (modeId === 'drift' ? result.score > this.ghost.data.score : result.time < this.ghost.data.time);
    if (beatGhost) this.career.onBeatGhost();
    const rewards = this.career.finishRun(result);
    const ghost = this.recorder.active ? this.recorder.finish(result.time, result.score) : null;
    if (ghost && result.isRecord) {
      saveLocalGhost(modeId, ghost);
      this.submit(modeId, result, ghost);
    }
    this.hideGhost();
    this.flushEvents();
    this.refreshAll();
    return rewards;
  }

  async submit(modeId, result, ghost) {
    if (!this.leaderboard) return;
    try {
      const response = await this.leaderboard.submit(modeId, result, encodeGhost(ghost));
      if (response?.accepted && response.status === 'online' && Number.isFinite(response.rank)) {
        this.hud.toast(`Global rank #${response.rank} on ${getMode(modeId).label}`, 'good');
      }
    } catch {
      // Leaderboards are best effort; the local record and ghost are already saved.
    }
  }

  /** Leaving a run without finishing (menu, restart, free roam). */
  leaveRun() {
    if (this.career.run) this.career.abandonRun();
    this.recorder.discard();
    this.hideGhost();
    this.flushEvents();
    this.refreshAll();
  }

  hideGhost() {
    this.ghost = null;
    this.ghostCar?.setVisible(false);
    this.hud.setGhost(null);
  }

  dispose() {
    clearInterval(this.onlineTimer);
    this.ghostCar?.dispose();
    this.ghostCar = null;
  }
}

function formatGhostDetail(data) {
  if (data.modeId === 'drift') return `${Math.round(data.score).toLocaleString('en-US')} pts`;
  const minutes = Math.floor(data.time / 60);
  return `${minutes}:${(data.time - minutes * 60).toFixed(2).padStart(5, '0')}`;
}
