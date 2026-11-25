// Race with friends via code: the client side of a party (src/net/party.js has the rules).
//
// A party is a private room 'party.<CODE>' joined through the NetClient (the player leaves the
// public map lobby while in it; friends' cars render through RemotePlayers as in any room). The host
// picks an event of the current map, everyone readies up, the host starts, and the authority (the
// Cloudflare room, or the host's tab in local mode) runs a 5 s countdown to a shared start time.
// Every client starts the run so its GO lands on that time (Game.beginRun(modeId, { startAt })),
// shows live standings while racing, reports its finish, and shows the shared results.
//
// Live standings (every 250 ms): finishers by finish time, then everyone still driving by distance
// along the route (yourself from the RaceSession, friends from their interpolated car positions,
// counting laps on circuits), then DNFs. Drift sessions show no live standings: friends' scores are
// not sent while driving and distance means nothing there; everyone finishes together at the time
// limit and the results rank by score.
//
// Map: a party is on one map. Joining a party on another map stores the code in sessionStorage,
// switches the map setting (which reloads the page) and rejoins after the load. `?party=CODE` in the
// URL joins on load.

import { getMode } from '../config.js';
import { mod } from '../core/math.js';
import { getCar } from '../vehicle/cars.js';
import { MAPS } from '../world/maps.js';
import {
  PARTY_MAX_MEMBERS, isPartyCode, isScoreMode, memberOrder, normalizePartyCode, partyModes, partyRoomName,
  randomPartyCode, rankResults,
} from '../net/party.js';

const STANDINGS_INTERVAL = 250;
const REJOIN_KEY = 'slop-drift-party-rejoin';
const REJOIN_MAX_AGE = 120_000;

const ERROR_TEXT = {
  'not-found': 'No party with that code. Check it and try again.',
  full: `That party is full (${PARTY_MAX_MEMBERS} drivers).`,
  exists: 'Could not create a party. Try again.',
  offline: 'Parties need multiplayer, which this browser does not support.',
  'bad-map': 'That party is on a map this version of the game does not have.',
  'bad-code': 'That is not a party code.',
  'map-failed': 'Could not load the party\'s map.',
};

const OP_ERROR_TEXT = {
  'not-host': 'Only the host can do that',
  phase: 'Not right now: the race is under way',
  'bad-mode': 'That event is not available on this map',
};

/** '1:23.45' */
export function formatRaceTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--.--';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(2).padStart(5, '0')}`;
}

function wrapSigned(value, length) {
  return mod(value + length * 0.5, length) - length * 0.5;
}

/**
 * Distance driven along a route from its start line, from a stream of positions: laps are counted
 * on closed routes by following the position around the loop. Same `d` convention as RaceSession.
 */
export class RouteProgress {
  /**
   * @param {{roads:object[], locate:(x:number, z:number, out:object, roadId:number) => object}} world
   * @param {import('../core/contracts.js').Route} route
   * @param {number} laps  Laps of the event (closed routes); 1 for point to point.
   */
  constructor(world, route, laps = 1) {
    this.world = world;
    this.route = route;
    const road = world.roads[route.roadId];
    this.closed = Boolean(route.closed);
    this.dir = route.direction < 0 ? -1 : 1;
    this.L = road.length;
    const finishD = (route.finishS - route.startS) * this.dir;
    this.lapLength = this.closed ? this.L : finishD > 0 ? finishD : route.length;
    this.laps = this.closed ? Math.max(1, laps | 0) : 1;
    this.total = this.lapLength * this.laps;
    this.loc = { roadId: -1, s: 0 };
    this.prevD = null;
    this.distance = null;
  }

  dOf(s) {
    const d = (s - this.route.startS) * this.dir;
    return this.closed ? mod(d, this.L) : d;
  }

  /** Feeds a position; returns metres driven (null until the car has been located once). */
  update(x, z) {
    const loc = this.world.locate(x, z, this.loc, this.route.roadId);
    if (!loc || loc.roadId === -1 || !Number.isFinite(loc.s)) return this.distance;
    const d = this.dOf(loc.s);
    if (this.prevD === null) {
      // Cars start a few metres behind the line, which on a loop is the end of the lap.
      this.distance = this.closed && d > this.L * 0.5 ? d - this.L : d;
    } else if (this.closed) {
      this.distance += wrapSigned(d - this.prevD, this.L);
    } else {
      this.distance = d;
    }
    this.prevD = d;
    this.distance = Math.min(this.distance, this.total);
    return this.distance;
  }
}

/**
 * Live standings rows for the HUD.
 * @param {object} state      Party state.
 * @param {string} you        Your member id.
 * @param {Map<string, number|null>|Object<string, number|null>} distances  Metres along the route per member (null: unknown).
 * @param {{lapLength:number, laps:number, total:number}} track
 * @param {Object<string, number>} [localTimes]  Finish times known locally but not yet in the state (yourself).
 * @returns {import('../core/contracts.js').StandingRow[]}
 */
export function buildStandings(state, you, distances, track, localTimes = {}) {
  const get = (id) => {
    const value = distances instanceof Map ? distances.get(id) : distances?.[id];
    return Number.isFinite(value) ? value : null;
  };
  const ids = memberOrder(state).filter((id) => state.members[id].inRace);
  const finished = [];
  const driving = [];
  const dnf = [];
  for (const id of ids) {
    const member = state.members[id];
    const time = member.finished && !member.dnf ? member.time : localTimes[id];
    if (member.dnf) dnf.push({ id, member });
    else if (Number.isFinite(time)) finished.push({ id, member, time });
    else driving.push({ id, member, distance: get(id) });
  }
  finished.sort((a, b) => a.time - b.time || a.member.seq - b.member.seq);
  driving.sort((a, b) => {
    if (a.distance === null || b.distance === null) return (a.distance === null) - (b.distance === null) || a.member.seq - b.member.seq;
    return b.distance - a.distance || a.member.seq - b.member.seq;
  });
  const rows = [];
  for (const entry of finished) rows.push({ id: entry.id, name: entry.member.name, detail: `FIN ${formatRaceTime(entry.time)}` });
  const lead = driving.find((entry) => entry.distance !== null);
  // Gaps are to the leader on the road, or to the finish line once somebody has crossed it.
  const reference = finished.length ? track.total : lead?.distance ?? null;
  driving.forEach((entry) => {
    let detail = '—';
    if (entry.distance !== null) {
      const isLeader = !finished.length && entry === lead;
      if (isLeader) {
        detail = track.laps > 1
          ? `Lap ${Math.min(track.laps, Math.max(1, Math.floor(Math.max(0, entry.distance) / track.lapLength) + 1))}/${track.laps}`
          : `${Math.round(Math.max(0, Math.min(1, entry.distance / track.total)) * 100)}%`;
      } else {
        const gap = Math.max(0, reference - entry.distance);
        detail = gap >= track.lapLength && track.laps > 1 ? `+${Math.floor(gap / track.lapLength)} lap` : `+${Math.round(gap)} m`;
      }
    }
    rows.push({ id: entry.id, name: entry.member.name, detail });
  });
  for (const entry of dnf) rows.push({ id: entry.id, name: entry.member.name, detail: 'DNF' });
  return rows.map((row, index) => ({ position: index + 1, name: row.name, isYou: row.id === you, detail: row.detail }));
}

/** Shared results for hud.showPartyResults. */
export function buildResults(state, you, isHost) {
  const map = MAPS[state.mapId];
  return {
    modeLabel: getMode(state.modeId).label,
    mapLabel: map?.label || state.mapId,
    isScore: isScoreMode(state.modeId),
    round: state.round,
    isHost,
    rows: rankResults(state).map(({ id, position, member }) => ({
      position,
      name: member.name,
      isYou: id === you,
      time: member.dnf ? undefined : member.time ?? undefined,
      score: member.dnf ? undefined : member.score ?? undefined,
      dnf: Boolean(member.dnf),
    })),
  };
}

function sessionStore() {
  try {
    return globalThis.sessionStorage || null;
  } catch {
    return null;
  }
}

export class PartyRace {
  /**
   * @param {object} options
   * @param {object} options.game  Game: beginRun(modeId, {startAt, party}), enterMenu(), applySettings(), settings, state, session, vehicle, world, modes.
   * @param {import('../net/NetClient.js').NetClient} options.net
   * @param {object} options.hud
   * @param {import('./MetaLayer.js').MetaLayer} options.meta  enterParty(room, options) / exitParty().
   * @param {string} options.mapId  Map of this page load.
   */
  constructor({ game, net, hud, meta, mapId }) {
    this.game = game;
    this.net = net;
    this.hud = hud;
    this.meta = meta;
    this.mapId = mapId;
    this.code = null;
    this.state = null;
    this.you = net?.instanceId || null;
    this.offset = 0;
    this.status = null; // null: not in a party
    this.error = null;
    this.createAttempts = 0;
    this.runRound = 0; // party round whose run this client started (0: none)
    this.runActive = false; // that run is still on the road
    this.localFinish = null; // our finish time until the authority confirms it
    this.shownResultsRound = 0;
    this.progress = new Map(); // member id -> RouteProgress
    this.peerPosition = { x: 0, y: 0, z: 0 };
    this.timer = null;
    this.unsubscribe = net ? net.onParty((state, info) => this.onParty(state, info)) : () => {};
    this.unsubRoster = net?.onRoster ? net.onRoster(() => {
      if (this.inParty && this.state) this.pushView();
    }) : () => {};
    this.bindHud();
  }

  bindHud() {
    const hud = this.hud;
    hud.onPartyCreate = () => this.createParty();
    hud.onPartyJoin = (code) => this.joinParty(code);
    hud.onPartyLeave = () => this.leave();
    hud.onPartySelect = (modeId) => this.select(modeId);
    hud.onPartyReady = (ready) => this.setReady(ready);
    hud.onPartyStart = () => this.start();
    hud.onPartyRematch = () => this.rematch();
    hud.onPartyCopyLink = () => this.copyLink();
  }

  /** After the game has loaded: a pending map-switch rejoin, or ?party=CODE in the URL. */
  boot() {
    const store = sessionStore();
    let pending = null;
    try {
      pending = JSON.parse(store?.getItem(REJOIN_KEY) || 'null');
      store?.removeItem(REJOIN_KEY);
    } catch {
      pending = null;
    }
    let code = null;
    try {
      const cgInvite = this.game.platform?.getInviteParam?.('party');
      if (cgInvite) code = normalizePartyCode(cgInvite) || null;
      const url = new URL(globalThis.location.href);
      const linked = url.searchParams.get('party');
      if (!code && linked !== null) {
        code = normalizePartyCode(linked) || null;
        url.searchParams.delete('party');
        globalThis.history?.replaceState(globalThis.history.state, '', `${url.pathname}${url.search}${url.hash}`);
      }
    } catch {
      // no location (tests)
    }
    if (!code && pending && isPartyCode(pending.code) && Date.now() - (pending.at || 0) < REJOIN_MAX_AGE) {
      code = pending.code;
      this.expectMap = pending.mapId;
    }
    if (code) {
      this.joinParty(code);
      this.hud.openParty?.();
      return true;
    }
    return false;
  }

  get inParty() {
    return this.status !== null;
  }

  get isHost() {
    return Boolean(this.state) && this.state.hostId === this.you;
  }

  get me() {
    return this.state?.members?.[this.you] || null;
  }

  // ------------------------------------------------------------------ actions (HUD callbacks)

  createParty() {
    if (!this.net) return this.fail('offline');
    const modes = this.availableModes(this.mapId);
    const current = this.game.mode?.id;
    const modeId = modes.some((mode) => mode.id === current) ? current : modes[0]?.id;
    this.connect(randomPartyCode(), { intent: 'create', mapId: this.mapId, modeId });
    return true;
  }

  joinParty(code) {
    const clean = normalizePartyCode(code);
    if (!clean) {
      this.hud.toast?.(ERROR_TEXT['bad-code'], 'warn');
      return false;
    }
    if (!this.net) return this.fail('offline');
    if (this.code === clean && this.state) {
      this.hud.openParty?.();
      return true;
    }
    this.createAttempts = 0;
    this.connect(clean, { intent: 'join' });
    return true;
  }

  connect(code, party) {
    if (this.inParty) this.leave({ quiet: true });
    this.code = code;
    this.state = null;
    this.status = 'connecting';
    this.error = null;
    this.runRound = 0;
    this.runActive = false;
    this.shownResultsRound = 0;
    this.joinOptions = party;
    this.pushView();
    this.meta?.enterParty?.(partyRoomName(code), { party });
    if (!this.meta?.enterParty) this.net.join(partyRoomName(code), { party });
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), STANDINGS_INTERVAL);
  }

  leave({ quiet = false } = {}) {
    if (!this.inParty) return;
    if (this.runActive) this.reportDnf();
    clearInterval(this.timer);
    this.timer = null;
    this.code = null;
    this.state = null;
    this.status = null;
    this.error = null;
    this.localFinish = null;
    this.expectMap = null;
    this.runActive = false;
    this.runRound = 0;
    this.progress.clear();
    if (this.meta?.exitParty) this.meta.exitParty();
    else this.net?.leave();
    this.hud.setRaceStandings?.(null);
    this.hud.setParty?.(null);
    if (!quiet) this.hud.showPartyResults?.(null);
  }

  select(modeId) {
    if (!this.state) return;
    if (!this.isHost) return this.hud.toast?.(OP_ERROR_TEXT['not-host'], 'warn');
    this.net.sendParty('select', { mapId: this.mapId, modeId });
  }

  setReady(ready) {
    if (!this.state) return;
    this.net.sendParty('ready', { ready: Boolean(ready) });
  }

  start() {
    if (!this.state) return;
    if (!this.isHost) return this.hud.toast?.(OP_ERROR_TEXT['not-host'], 'warn');
    this.net.sendParty('start');
  }

  rematch() {
    if (!this.state) return;
    if (!this.isHost) return this.hud.toast?.(OP_ERROR_TEXT['not-host'], 'warn');
    this.net.sendParty('rematch');
  }

  get shareUrl() {
    if (!this.code) return '';
    try {
      return `${globalThis.location.origin}${globalThis.location.pathname}?party=${this.code}`;
    } catch {
      return `?party=${this.code}`;
    }
  }

  async copyLink() {
    const cgUrl = this.code
      ? await this.game.platform?.inviteLink?.({ party: this.code, map: this.mapId })
      : null;
    const url = cgUrl || this.shareUrl;
    if (!url) return false;
    try {
      await globalThis.navigator.clipboard.writeText(url);
      this.hud.toast?.('Party link copied', 'good');
      return true;
    } catch {
      // Clipboard API unavailable (http, permissions): the old way.
    }
    try {
      const area = document.createElement('textarea');
      area.value = url;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      if (ok) {
        this.hud.toast?.('Party link copied', 'good');
        return true;
      }
    } catch {
      // fall through
    }
    this.hud.toast?.(`Share this link: ${url}`, 'info');
    return false;
  }

  // ------------------------------------------------------------------ game hooks

  /** Game.beginRun: any run that is not this party's round abandons the party race. */
  onRunStart(modeId, options = {}) {
    if (options.party) return;
    if (this.runActive) this.reportDnf();
  }

  /** Game.finish: report our result. */
  onFinish(result) {
    if (!this.runActive || !this.state) return;
    this.runActive = false;
    this.localFinish = Number.isFinite(result?.time) ? result.time : null;
    this.net.sendParty('finish', { time: result.time, score: result.score ?? 0, dnf: false });
  }

  /** Game.enterMenu / quitting: a party race left before the finish is a DNF. */
  onLeaveRun() {
    if (this.runActive) this.reportDnf();
    this.hud.setRaceStandings?.(null);
  }

  reportDnf() {
    this.runActive = false;
    if (this.state?.phase === 'racing' || this.state?.phase === 'countdown') this.net.sendParty('finish', { dnf: true });
  }

  // ------------------------------------------------------------------ party state

  fail(error) {
    this.status = 'error';
    this.error = error;
    this.pushView();
    return false;
  }

  onParty(state, info) {
    if (!this.inParty) return;
    if (info.fatal) {
      if (info.error === 'exists' && this.joinOptions?.intent === 'create' && this.createAttempts < 3) {
        this.createAttempts += 1;
        this.connect(randomPartyCode(), this.joinOptions);
        return;
      }
      const wasIn = Boolean(this.state);
      this.state = null;
      this.runActive = false;
      this.status = wasIn ? 'closed' : 'error';
      this.error = info.error;
      this.hud.setRaceStandings?.(null);
      this.pushView();
      return;
    }
    if (!state) {
      if (info.error) this.hud.toast?.(OP_ERROR_TEXT[info.error] || 'The party refused that', 'warn');
      return;
    }
    const before = this.state;
    this.state = state;
    this.you = info.you || this.you;
    this.offset = Number.isFinite(info.offset) ? info.offset : 0;
    if (info.error && OP_ERROR_TEXT[info.error]) this.hud.toast?.(OP_ERROR_TEXT[info.error], 'warn');
    if (!state.members[this.you]) {
      this.status = 'connecting';
      this.pushView();
      return;
    }

    // A party on another map: drive there (reload), then rejoin.
    if (state.mapId !== this.mapId) {
      if (this.expectMap && this.expectMap === state.mapId) {
        this.expectMap = null;
        this.fail('map-failed');
        return;
      }
      if (MAPS[state.mapId]) {
        this.switchMap(state);
        return;
      }
      this.fail('bad-map');
      return;
    }
    this.expectMap = null;
    this.status = state.phase;
    this.error = null;
    this.onTransition(before, state);
    this.pushView();
  }

  switchMap(state) {
    try {
      sessionStore()?.setItem(REJOIN_KEY, JSON.stringify({ code: state.code, mapId: state.mapId, at: Date.now() }));
    } catch {
      // without sessionStorage the player rejoins by hand
    }
    this.hud.toast?.(`This party races on ${MAPS[state.mapId].label}. Driving there…`, 'info');
    const code = this.code;
    this.leave({ quiet: true });
    this.code = code;
    this.game.applySettings({ ...this.game.settings, map: state.mapId });
  }

  onTransition(before, state) {
    const me = state.members[this.you];
    const phaseChanged = !before || before.phase !== state.phase || before.round !== state.round;
    if (state.phase === 'countdown' && me.inRace && this.runRound !== state.round) {
      this.startRun(state);
    }
    if (state.phase === 'racing' && me.inRace && this.runRound !== state.round && !me.finished) {
      // Missed the start (e.g. the countdown state arrived late): start now, behind everyone.
      this.startRun(state);
    }
    if (state.phase === 'results' && this.shownResultsRound !== state.round) {
      this.shownResultsRound = state.round;
      this.runActive = false;
      this.hud.setRaceStandings?.(null);
      if (this.game.state === 'running' || this.game.state === 'countdown') {
        // Our run did not make the deadline: stop driving and see the results.
        if (me.inRace) this.game.enterMenu?.();
      }
      this.hud.showPartyResults?.(buildResults(state, this.you, this.isHost));
    }
    if (phaseChanged && state.phase === 'lobby' && before && before.phase === 'results') {
      // Rematch or another event: back to the lobby panel.
      this.localFinish = null;
      this.hud.showPartyResults?.(null);
      if (this.game.state === 'finished') this.game.enterMenu?.();
      this.hud.openParty?.();
    }
  }

  startRun(state) {
    this.runRound = state.round;
    this.localFinish = null;
    this.progress.clear();
    const startAt = state.startAt - this.offset; // on our clock
    const started = this.game.beginRun(state.modeId, { startAt, party: true });
    this.runActive = started !== false;
    if (!this.runActive) this.net.sendParty('finish', { dnf: true });
  }

  // ------------------------------------------------------------------ periodic: countdown + standings

  tick() {
    if (!this.state) return;
    if (this.state.phase === 'countdown') this.pushView();
    if (this.state.phase === 'racing' && this.runRound === this.state.round) this.updateStandings();
  }

  /** Track geometry of the current event on this map, or null. */
  track() {
    const mode = getMode(this.state.modeId);
    const route = this.game.world?.routes?.[mode.route];
    if (!route) return null;
    return { mode, route };
  }

  updateStandings() {
    const state = this.state;
    if (isScoreMode(state.modeId)) {
      this.hud.setRaceStandings?.(null);
      return;
    }
    const info = this.track();
    if (!info) return;
    const laps = info.mode.laps || 1;
    const distances = new Map();
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let geometry = null;
    for (const id of Object.keys(state.members)) {
      if (!state.members[id].inRace) continue;
      let tracker = this.progress.get(id);
      if (!tracker) {
        tracker = new RouteProgress(this.game.world, info.route, laps);
        this.progress.set(id, tracker);
      }
      geometry = tracker;
      if (id === this.you) {
        const session = this.game.session;
        if (session && session.mode.id === state.modeId) distances.set(id, (session.hud.progress || 0) * tracker.total);
        continue;
      }
      const key = this.net.partyPeerKey(id);
      const sample = key ? this.net.samplePeer(key, now, this.peerPosition, null) : null;
      distances.set(id, sample ? tracker.update(this.peerPosition.x, this.peerPosition.z) : tracker.distance);
    }
    if (!geometry) return;
    const localTimes = Number.isFinite(this.localFinish) ? { [this.you]: this.localFinish } : {};
    const rows = buildStandings(state, this.you, distances, { lapLength: geometry.lapLength, laps: geometry.laps, total: geometry.total }, localTimes);
    this.hud.setRaceStandings?.(rows);
  }

  // ------------------------------------------------------------------ view

  availableModes(mapId) {
    const allowed = partyModes(mapId);
    const here = mapId === this.mapId && Array.isArray(this.game.modes) ? new Set(this.game.modes.map((mode) => mode.id)) : null;
    return allowed.filter((id) => !here || here.has(id)).map((id) => ({ id, label: getMode(id).label }));
  }

  view() {
    if (!this.inParty) return null;
    const state = this.state;
    const base = {
      code: this.code,
      status: this.status,
      isHost: this.isHost,
      shareUrl: this.shareUrl,
      round: state?.round ?? 1,
    };
    if (this.status === 'error' || this.status === 'closed') {
      base.error = ERROR_TEXT[this.error] || (this.status === 'closed' ? 'The party has closed.' : 'Something went wrong with this party.');
    }
    if (!state) {
      return { ...base, mapId: this.mapId, mapLabel: MAPS[this.mapId]?.label || '', modeId: null, modeLabel: '', modes: [], members: [], canStart: false, readyCount: 0, allReady: false };
    }
    const members = memberOrder(state).map((id) => {
      const member = state.members[id];
      const peerKey = id === this.you ? null : this.net?.partyPeerKey?.(id);
      const peerInfo = peerKey ? this.net?.peers?.get?.(peerKey) : null;
      const rawCar = id === this.you
        ? (this.game?.carId || this.meta?.career?.profile?.cosmetics?.car || member.car || '')
        : (peerInfo?.car || member.car || '');
      const car = rawCar ? getCar(rawCar) : null;
      const rawPaint = id === this.you
        ? (this.meta?.career?.profile?.cosmetics?.paint || member.paint || '')
        : (peerInfo?.paint || member.paint || '');
      const row = {
        id,
        name: (id !== this.you && peerInfo?.name) || member.name,
        level: (id !== this.you && peerInfo?.level) || member.level,
        paint: rawPaint,
        car: car ? car.id : '',
        carLabel: car ? car.label : '',
        isHost: id === state.hostId, isYou: id === this.you,
        ready: Boolean(member.ready), finished: Boolean(member.finished), dnf: Boolean(member.dnf),
      };
      if (Number.isFinite(member.time)) row.time = member.time;
      if (Number.isFinite(member.score)) row.score = member.score;
      return row;
    });
    const others = members.filter((member) => !member.isHost);
    const view = {
      ...base,
      mapId: state.mapId,
      mapLabel: MAPS[state.mapId]?.label || state.mapId,
      modeId: state.modeId,
      modeLabel: getMode(state.modeId).label,
      modes: this.availableModes(state.mapId),
      members,
      canStart: this.isHost && (state.phase === 'lobby' || state.phase === 'results'),
      readyCount: members.filter((member) => member.ready || member.isHost).length,
      allReady: others.every((member) => member.ready),
    };
    if (state.phase === 'countdown') view.startsIn = Math.max(0, (state.startAt - this.offset - Date.now()) / 1000);
    return view;
  }

  pushView() {
    this.hud.setParty?.(this.view());
  }

  dispose() {
    clearInterval(this.timer);
    this.unsubscribe?.();
    this.unsubRoster?.();
  }
}
