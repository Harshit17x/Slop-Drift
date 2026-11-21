// "Race with friends via code": the party state machine, shared by the Cloudflare room
// (server/src/partyHost.js inside server/src/Room.js) and the local BroadcastChannel transport
// (src/net/NetClient.js, where the host's tab is the authority). Pure: no clocks, no I/O; `now` is
// passed in as epoch milliseconds of the authority's clock.
//
//   lobby -> countdown -> racing -> results -> (rematch | select) -> lobby
//
// State:
//   { code, hostId, mapId, modeId, phase, startAt, round, members, finishDeadline, raceDeadline, seq }
//   members[id] = { name, level, paint, peer, seq, ready, inRace, finished, time, score, dnf }
//     seq     join order; the host migrates to the lowest seq left
//     peer    opaque key other clients use to find this member's car (sender index online,
//             NetClient instance id locally); never trusted for anything else
//     inRace  part of the current round (false for someone who joined mid-race: they wait)
//
// Events: {type, id (acting member), ...}
//   join {name, level, paint, peer}   leave   select {mapId?, modeId}   ready {ready}
//   start   finish {time, score, dnf}   rematch   tick
// step() returns { state, error }; a rejected event returns the same state object and an error code
// ('full' | 'not-member' | 'not-host' | 'phase' | 'bad-mode' | 'bad-input' | 'empty').

import { MODES } from '../config.js';
import { medalTargets } from '../meta/catalog.js';
import { trackKey } from '../meta/trackKey.js';
import { MAPS } from '../world/maps.js';
import { sanitizeCosmetic, sanitizeLevel, sanitizeName } from '../../server/src/validate.js';

export const PARTY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PARTY_CODE_LENGTH = 5;
export const PARTY_MAX_MEMBERS = 8;
export const PARTY_ROOM_PREFIX = 'party.';
/** Synchronised countdown length (ms) from the host pressing start to the green light. */
export const PARTY_COUNTDOWN_MS = 5000;
/** After the first finisher, everyone else has this long (ms) before they are marked DNF. */
export const PARTY_FINISH_GRACE_MS = 60_000;
/** Hard cap on a round (ms after the start), so an abandoned race always reaches results. */
export const PARTY_RACE_CAP_MS = 20 * 60_000;
/** Same ceiling as the leaderboard (server/src/validate.js MAX_TIME). */
const MAX_TIME = 3600;
const MAX_SCORE = 10_000_000;

const CODE_RE = new RegExp(`^[${PARTY_ALPHABET}]{${PARTY_CODE_LENGTH}}$`);
const ID_RE = /^[A-Za-z0-9_#~.-]{1,80}$/;

/** True for a well-formed party code ('K7QXM'). */
export function isPartyCode(code) {
  return typeof code === 'string' && CODE_RE.test(code);
}

/** Upper-cases and strips spaces / dashes from typed or pasted codes; '' when it cannot be a code. */
export function normalizePartyCode(text) {
  const clean = String(text ?? '').toUpperCase().replace(/[\s-]/g, '');
  return isPartyCode(clean) ? clean : '';
}

/** A fresh random code. `random` returns [0, 1) (tests pass a seeded one). */
export function randomPartyCode(random = Math.random) {
  let code = '';
  for (let i = 0; i < PARTY_CODE_LENGTH; i += 1) code += PARTY_ALPHABET[Math.floor(random() * PARTY_ALPHABET.length) % PARTY_ALPHABET.length];
  return code;
}

/** 'party.K7QXM' for a valid code, else null. */
export function partyRoomName(code) {
  return isPartyCode(code) ? `${PARTY_ROOM_PREFIX}${code}` : null;
}

/** The code inside a party room name, or null when it is not one. */
export function partyCodeOfRoom(name) {
  if (typeof name !== 'string' || !name.startsWith(PARTY_ROOM_PREFIX)) return null;
  const code = name.slice(PARTY_ROOM_PREFIX.length);
  return isPartyCode(code) ? code : null;
}

/**
 * Events a party may race on a map: every ranked event (it has medal targets on that map, exactly
 * the set the server keeps rooms and leaderboards for), never free roam.
 * @returns {string[]} mode ids in MODES order; [] for an unknown map.
 */
export function partyModes(mapId) {
  if (typeof mapId !== 'string' || !Object.prototype.hasOwnProperty.call(MAPS, mapId)) return [];
  return MODES.filter((mode) => mode.id !== 'roam' && medalTargets(trackKey(mapId, mode.id))).map((mode) => mode.id);
}

/** Drift ranks by score (higher first); every other event by time. */
export function isScoreMode(modeId) {
  return modeId === 'drift';
}

/**
 * A new, empty party (the creator joins with a 'join' event next). Null for a bad code or map.
 * An unknown or missing mode falls back to the map's first event.
 */
export function createParty({ code, mapId, modeId } = {}) {
  if (!isPartyCode(code)) return null;
  const modes = partyModes(mapId);
  if (!modes.length) return null;
  return {
    code,
    hostId: null,
    mapId,
    modeId: modes.includes(modeId) ? modeId : modes[0],
    phase: 'lobby',
    startAt: 0,
    round: 1,
    members: {},
    finishDeadline: 0,
    raceDeadline: 0,
    seq: 0,
  };
}

/** Member ids in join order. */
export function memberOrder(state) {
  return Object.keys(state?.members || {}).sort((a, b) => state.members[a].seq - state.members[b].seq);
}

/** The next moment (epoch ms) a 'tick' would change this state, or 0 when nothing is scheduled. */
export function nextDeadline(state) {
  if (!state) return 0;
  if (state.phase === 'countdown') return state.startAt;
  if (state.phase === 'racing') {
    const finish = state.finishDeadline > 0 ? state.finishDeadline : Infinity;
    const cap = state.raceDeadline > 0 ? state.raceDeadline : Infinity;
    const at = Math.min(finish, cap);
    return Number.isFinite(at) ? at : 0;
  }
  return 0;
}

/**
 * Finishers first (time ascending, or score descending in drift), then DNFs, in join order.
 * Only members who took part in the round.
 * @returns {{id:string, position:number, member:object}[]}
 */
export function rankResults(state) {
  if (!state) return [];
  const score = isScoreMode(state.modeId);
  const order = memberOrder(state).filter((id) => state.members[id].inRace);
  const done = order.filter((id) => state.members[id].finished && !state.members[id].dnf);
  const dnf = order.filter((id) => !(state.members[id].finished && !state.members[id].dnf));
  done.sort((a, b) => {
    const ma = state.members[a];
    const mb = state.members[b];
    const diff = score ? mb.score - ma.score : ma.time - mb.time;
    return diff || ma.finishedAt - mb.finishedAt || ma.seq - mb.seq;
  });
  return [...done, ...dnf].map((id, index) => ({ id, position: index + 1, member: state.members[id] }));
}

// ------------------------------------------------------------------ reducer

function clone(state) {
  const members = {};
  for (const [id, member] of Object.entries(state.members)) members[id] = { ...member };
  return { ...state, members };
}

function reject(state, error) {
  return { state, error };
}

function clearRound(member) {
  member.finished = false;
  member.dnf = false;
  member.time = null;
  member.score = null;
  member.finishedAt = 0;
}

function finite(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/** Racing -> results when nobody in the round is still driving. */
function maybeComplete(next, now) {
  if (next.phase !== 'racing') return next;
  const racers = Object.values(next.members).filter((member) => member.inRace);
  if (racers.every((member) => member.finished)) toResults(next, now);
  return next;
}

function toResults(next) {
  for (const member of Object.values(next.members)) {
    if (member.inRace && !member.finished) {
      member.finished = true;
      member.dnf = true;
    }
    member.ready = false;
  }
  next.phase = 'results';
  next.finishDeadline = 0;
  next.raceDeadline = 0;
  return next;
}

function backToLobby(next) {
  next.phase = 'lobby';
  next.round += 1;
  next.startAt = 0;
  next.finishDeadline = 0;
  next.raceDeadline = 0;
  for (const member of Object.values(next.members)) {
    clearRound(member);
    member.inRace = false;
    member.ready = false;
  }
  return next;
}

/**
 * Applies one event.
 * @param {object} state  From createParty() (or a previous step).
 * @param {{type:string, id?:string}} event
 * @param {number} now  Epoch ms on the authority's clock.
 * @returns {{state:object, error:(string|null)}}
 */
export function step(state, event, now) {
  if (!state || typeof state !== 'object' || !event || typeof event !== 'object') return reject(state, 'bad-input');
  if (!Number.isFinite(now)) return reject(state, 'bad-input');
  const id = event.id;
  const member = typeof id === 'string' ? state.members[id] : undefined;
  const isHost = Boolean(member) && state.hostId === id;

  switch (event.type) {
    case 'join': {
      if (typeof id !== 'string' || !ID_RE.test(id)) return reject(state, 'bad-input');
      const name = sanitizeName(event.name) || (member ? member.name : 'Driver');
      const level = sanitizeLevel(event.level ?? member?.level);
      const paint = sanitizeCosmetic(event.paint) || member?.paint || '';
      const peer = typeof event.peer === 'string' || Number.isInteger(event.peer) ? event.peer : member?.peer ?? null;
      const next = clone(state);
      if (member) {
        // Rejoin (or a profile change): keep the place, refresh the look.
        Object.assign(next.members[id], { name, level, paint, peer });
        return { state: next, error: null };
      }
      if (Object.keys(state.members).length >= PARTY_MAX_MEMBERS) return reject(state, 'full');
      const joined = {
        name, level, paint, peer,
        seq: next.seq,
        ready: false,
        // Joining during the countdown still makes the start; mid-race joiners wait for the next round.
        inRace: state.phase === 'countdown',
        finished: false, dnf: false, time: null, score: null, finishedAt: 0,
      };
      next.seq += 1;
      next.members[id] = joined;
      if (!next.hostId || !next.members[next.hostId]) next.hostId = id;
      return { state: next, error: null };
    }

    case 'leave': {
      if (!member) return reject(state, 'not-member');
      const next = clone(state);
      delete next.members[id];
      if (next.hostId === id) next.hostId = memberOrder(next)[0] || null;
      if (!next.hostId) return { state: next, error: null }; // empty: the caller disposes of it
      return { state: maybeComplete(next, now), error: null };
    }

    case 'select': {
      if (!member) return reject(state, 'not-member');
      if (!isHost) return reject(state, 'not-host');
      if (state.phase !== 'lobby' && state.phase !== 'results') return reject(state, 'phase');
      const mapId = event.mapId == null ? state.mapId : event.mapId;
      const modes = partyModes(mapId);
      if (!modes.length || !modes.includes(event.modeId)) return reject(state, 'bad-mode');
      const next = clone(state);
      next.mapId = mapId;
      next.modeId = event.modeId;
      // Picking another event from the results screen is the way back to the lobby.
      if (state.phase === 'results') backToLobby(next);
      for (const m of Object.values(next.members)) m.ready = false;
      return { state: next, error: null };
    }

    case 'ready': {
      if (!member) return reject(state, 'not-member');
      if (state.phase !== 'lobby' && state.phase !== 'results') return reject(state, 'phase');
      if (typeof event.ready !== 'boolean') return reject(state, 'bad-input');
      if (member.ready === event.ready) return { state, error: null };
      const next = clone(state);
      next.members[id].ready = event.ready;
      return { state: next, error: null };
    }

    case 'start': {
      if (!member) return reject(state, 'not-member');
      if (!isHost) return reject(state, 'not-host');
      if (state.phase !== 'lobby') return reject(state, 'phase');
      if (!Object.keys(state.members).length) return reject(state, 'empty');
      if (!partyModes(state.mapId).includes(state.modeId)) return reject(state, 'bad-mode');
      const next = clone(state);
      next.phase = 'countdown';
      next.startAt = now + PARTY_COUNTDOWN_MS;
      next.finishDeadline = 0;
      next.raceDeadline = next.startAt + PARTY_RACE_CAP_MS;
      for (const m of Object.values(next.members)) {
        clearRound(m);
        m.inRace = true;
      }
      return { state: next, error: null };
    }

    case 'finish': {
      if (!member) return reject(state, 'not-member');
      if (state.phase !== 'racing') return reject(state, 'phase');
      if (!member.inRace) return reject(state, 'phase');
      if (member.finished) return reject(state, 'phase');
      const dnf = event.dnf === true;
      const score = isScoreMode(state.modeId);
      if (!dnf) {
        if (!finite(event.time, 1e-3, MAX_TIME)) return reject(state, 'bad-input');
        if (score && !finite(event.score, 0, MAX_SCORE)) return reject(state, 'bad-input');
      }
      const next = clone(state);
      const m = next.members[id];
      m.finished = true;
      m.dnf = dnf;
      m.time = dnf ? null : event.time;
      m.score = dnf ? null : score ? Math.round(event.score) : finite(event.score, 0, MAX_SCORE) ? Math.round(event.score) : 0;
      m.finishedAt = now;
      if (!dnf && !(next.finishDeadline > 0)) next.finishDeadline = now + PARTY_FINISH_GRACE_MS;
      return { state: maybeComplete(next, now), error: null };
    }

    case 'rematch': {
      if (!member) return reject(state, 'not-member');
      if (!isHost) return reject(state, 'not-host');
      if (state.phase !== 'results') return reject(state, 'phase');
      return { state: backToLobby(clone(state)), error: null };
    }

    case 'tick': {
      if (state.phase === 'countdown' && now >= state.startAt) {
        const next = clone(state);
        next.phase = 'racing';
        return { state: maybeComplete(next, now), error: null };
      }
      if (state.phase === 'racing') {
        const deadline = nextDeadline(state);
        if (deadline > 0 && now >= deadline) return { state: toResults(clone(state), now), error: null };
      }
      return { state, error: null };
    }

    default:
      return reject(state, 'bad-input');
  }
}

/** step() without the error: the next state (the same object when the event was rejected). */
export function reduce(state, event, now) {
  return step(state, event, now).state;
}

/**
 * Turns a client message {op, ...} into a reducer event for member `id`, copying only the fields
 * that op uses (so a client can never set someone else's id or smuggle extra state). Null for an
 * unknown op. 'join' is not accepted from the wire online (the room joins you on connect).
 */
export function eventFromOp(id, message, { allowJoin = false } = {}) {
  if (!message || typeof message !== 'object') return null;
  switch (message.op) {
    case 'select': return { type: 'select', id, mapId: message.mapId, modeId: message.modeId };
    case 'ready': return { type: 'ready', id, ready: message.ready };
    case 'start': return { type: 'start', id };
    case 'finish': return { type: 'finish', id, time: message.time, score: message.score, dnf: message.dnf };
    case 'rematch': return { type: 'rematch', id };
    case 'join': return allowJoin ? { type: 'join', id, name: message.name, level: message.level, paint: message.paint, peer: message.peer } : null;
    case 'leave': return allowJoin ? { type: 'leave', id } : null;
    default: return null;
  }
}
