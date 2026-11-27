// Realtime presence and car state for other players in the same event.
//
//   const net = new NetClient({ host: import.meta.env.VITE_API_HOST, profile });
//   net.join('sprint');
//   // every frame:
//   net.sendState(vehicleState, { braking, boosting, drifting }, performance.now());
//   for (const id of net.peers.keys()) net.samplePeer(id, performance.now(), car.position, car.quaternion);
//
// Transports:
//   'online'  host set: WebSocket to the Cloudflare room /parties/room/<modeId> (server/src/Room.js),
//             with reconnect and exponential backoff.
//   'local'   no host: BroadcastChannel, so separate tabs of this browser see each other.
//   'offline' no host and no BroadcastChannel: everything is a quiet no-op.
//
// Sending: ~6 Hz while moving, 1 Hz when nearly stationary, one extra packet on start/stop, never
// above 15 Hz. 35-byte binary packets (src/net/protocol.js).
//
// Receiving: sender timestamps are mapped onto the local clock (per-peer offset tracking the fastest
// packet), then rendered ~150-250 ms in the past (adaptive to the measured send interval and jitter)
// with Hermite position / slerp rotation interpolation; when packets run late the pose is
// dead-reckoned along the last velocity for up to 300 ms, then held.
//
// Party rooms ('party.<CODE>', src/net/party.js): join('party.' + code, { party: { intent, mapId, modeId } })
// then sendParty(op, payload) / onParty(callback). Online the Cloudflare room is the authority; in
// local mode the host's tab runs the same reducer and broadcasts the state over the room channel.
//
// No method throws: network trouble only ever shows up in `status`.

import { PACKET_SIZE, RELAY_SIZE, createSnapshot, decodeState, encodeState, packFlags } from './protocol.js';
import { ensureToken, fetchWithTimeout, forgetToken, normalizeHost, profileLevel, socketBase } from './identity.js';
import { levelForXp } from '../meta/catalog.js';
import { createParty, eventFromOp, memberOrder, partyCodeOfRoom, step as partyStep } from './party.js';

export const SEND_HZ_MOVING = 6;
export const SEND_HZ_IDLE = 1;
/** Hard ceiling on our own send rate (the room drops connections above ~15 Hz sustained). */
export const SEND_HZ_MAX = 15;
/** Below this speed (m/s) the car counts as nearly stationary. */
export const MOVING_SPEED = 0.8;
export const INTERP_DELAY_MIN = 150;
export const INTERP_DELAY_MAX = 450;
export const EXTRAPOLATE_MAX = 300;
/** samplePeer returns null when a peer has been silent this long (ms). */
export const PEER_STALE = 5000;

const BUFFER_SIZE = 12;
const TELEPORT_DISTANCE = 30;
const HERMITE_MAX_GAP = 0.35;
const LOCAL_HEARTBEAT = 2000;
const LOCAL_TIMEOUT = 7000;
const PRESENCE_CHANNEL = 'slop-drift-presence';
const ONLINE_CACHE = 45000;
/** Local mode: how long a joining tab waits for the party's host tab before giving up (ms). */
const LOCAL_PARTY_TIMEOUT = 1500;
const LOCAL_PARTY_TICK = 250;
/** Join refusals from a party room, by close code. */
const PARTY_REFUSALS = { 4003: 'full', 4404: 'not-found', 4409: 'exists' };
const PARTY_JOIN_ERRORS = new Set(['not-found', 'exists', 'full', 'bad-map', 'bad-code']);

const defaultNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function randomId() {
  try {
    return globalThis.crypto.randomUUID().slice(0, 8);
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
}

// ------------------------------------------------------------------ interpolation track

/** Received snapshots for one peer, on the local clock. */
class Track {
  constructor() {
    this.snaps = [];
    for (let i = 0; i < BUFFER_SIZE; i += 1) this.snaps.push({ ...createSnapshot(), t: 0 });
    this.start = 0;
    this.count = 0;
    this.offset = null;
    this.lastRaw = null;
    this.lastSender = 0;
    this.interval = 1000 / SEND_HZ_MOVING;
    this.late = 0;
    this.lastSeen = -Infinity;
    /** Delay actually used for rendering: follows `delay` at most 5% of elapsed time, so playback never jumps. */
    this.renderDelay = null;
    this.lastRender = null;
    this.decoded = createSnapshot();
    this.result = { steer: 0, speed: 0, braking: false, boosting: false, drifting: false, reversing: false, airborne: false };
  }

  at(i) {
    return this.snaps[(this.start + i) % BUFFER_SIZE];
  }

  get newest() {
    return this.count ? this.at(this.count - 1) : null;
  }

  get delay() {
    return Math.max(INTERP_DELAY_MIN, Math.min(INTERP_DELAY_MAX, this.interval + 2 * this.late + 15));
  }

  /** Adds a decoded packet received at local time `now`. Returns false for duplicates / out-of-order. */
  push(view, offset, now) {
    const snap = this.decoded;
    if (!decodeState(view, offset, snap)) return false;
    // Unwrap the u32 sender clock.
    let sender;
    if (this.lastRaw === null) sender = snap.time;
    else {
      const diff = ((snap.time - this.lastRaw + 0x80000000) >>> 0) - 0x80000000;
      sender = this.lastSender + diff;
    }
    if (this.lastRaw !== null && sender <= this.lastSender) return false;
    const gap = this.lastRaw === null ? null : sender - this.lastSender;
    this.lastRaw = snap.time;
    this.lastSender = sender;

    // Offset tracks the fastest packet seen (sender clock + one-way latency), drifting slowly upward
    // so clock skew between machines cannot accumulate.
    const sample = now - sender;
    if (this.offset === null || sample < this.offset) this.offset = sample;
    else this.offset += (sample - this.offset) * 0.01;
    const t = sender + this.offset;
    const lateness = now - t;
    this.late += (lateness - this.late) * 0.1;
    if (gap !== null && gap < 600) this.interval += (gap - this.interval) * 0.15;

    const slot = this.count < BUFFER_SIZE ? this.at(this.count) : this.at(0);
    if (this.count < BUFFER_SIZE) this.count += 1;
    else this.start = (this.start + 1) % BUFFER_SIZE;
    Object.assign(slot, snap);
    slot.t = t;
    this.lastSeen = now;
    return true;
  }

  /** Writes the pose at local time `renderTime - delay`; returns the shared result object. */
  sample(renderTime, outPosition, outQuaternion) {
    if (!this.count) return null;
    const wanted = this.delay;
    if (this.renderDelay === null || this.lastRender === null || renderTime < this.lastRender) this.renderDelay = wanted;
    else {
      const room = Math.max(0, renderTime - this.lastRender) * 0.05;
      this.renderDelay += Math.max(-room, Math.min(room, wanted - this.renderDelay));
    }
    this.lastRender = renderTime;
    const target = renderTime - this.renderDelay;
    const newest = this.newest;
    const oldest = this.at(0);
    const r = this.result;

    if (target >= newest.t || this.count === 1) {
      const dt = Math.max(0, Math.min(EXTRAPOLATE_MAX, target - newest.t)) / 1000;
      writePosition(outPosition, newest.x + newest.vx * dt, newest.y + newest.vy * dt, newest.z + newest.vz * dt);
      writeQuaternion(outQuaternion, newest.qx, newest.qy, newest.qz, newest.qw);
      return fill(r, newest, newest, 0);
    }
    if (target <= oldest.t) {
      writePosition(outPosition, oldest.x, oldest.y, oldest.z);
      writeQuaternion(outQuaternion, oldest.qx, oldest.qy, oldest.qz, oldest.qw);
      return fill(r, oldest, oldest, 0);
    }
    let a = oldest;
    let b = this.at(1);
    for (let i = 1; i < this.count; i += 1) {
      b = this.at(i);
      if (b.t >= target) break;
      a = b;
    }
    const span = Math.max(1e-3, b.t - a.t);
    const s = Math.max(0, Math.min(1, (target - a.t) / span));
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    if (dx * dx + dy * dy + dz * dz > TELEPORT_DISTANCE * TELEPORT_DISTANCE) {
      const pick = s < 1 ? a : b; // respawn: jump, never slide across the map
      writePosition(outPosition, pick.x, pick.y, pick.z);
      writeQuaternion(outQuaternion, pick.qx, pick.qy, pick.qz, pick.qw);
      return fill(r, pick, pick, 0);
    }
    const seconds = span / 1000;
    if (seconds <= HERMITE_MAX_GAP) {
      // Cubic Hermite with the sent velocities: smooth through every sample, no corner cutting.
      const s2 = s * s;
      const s3 = s2 * s;
      const h00 = 2 * s3 - 3 * s2 + 1;
      const h10 = s3 - 2 * s2 + s;
      const h01 = -2 * s3 + 3 * s2;
      const h11 = s3 - s2;
      writePosition(
        outPosition,
        h00 * a.x + h10 * seconds * a.vx + h01 * b.x + h11 * seconds * b.vx,
        h00 * a.y + h10 * seconds * a.vy + h01 * b.y + h11 * seconds * b.vy,
        h00 * a.z + h10 * seconds * a.vz + h01 * b.z + h11 * seconds * b.vz,
      );
    } else {
      writePosition(outPosition, a.x + dx * s, a.y + dy * s, a.z + dz * s);
    }
    slerpInto(outQuaternion, a, b, s);
    return fill(r, a, b, s);
  }
}

function fill(result, a, b, s) {
  result.steer = a.steer + (b.steer - a.steer) * s;
  result.speed = a.speed + (b.speed - a.speed) * s;
  const pick = s < 0.5 ? a : b;
  result.braking = pick.braking;
  result.boosting = pick.boosting;
  result.drifting = pick.drifting;
  result.reversing = pick.reversing;
  result.airborne = pick.airborne;
  return result;
}

function writePosition(out, x, y, z) {
  if (!out) return;
  if (typeof out.set === 'function') out.set(x, y, z);
  else { out.x = x; out.y = y; out.z = z; }
}

function writeQuaternion(out, x, y, z, w) {
  if (!out) return;
  if (typeof out.set === 'function') out.set(x, y, z, w);
  else { out.x = x; out.y = y; out.z = z; out.w = w; }
}

function slerpInto(out, a, b, s) {
  let bx = b.qx, by = b.qy, bz = b.qz, bw = b.qw;
  let cos = a.qx * bx + a.qy * by + a.qz * bz + a.qw * bw;
  if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let k0;
  let k1;
  if (cos > 0.9995) {
    k0 = 1 - s;
    k1 = s;
  } else {
    const angle = Math.acos(cos);
    const sin = Math.sin(angle);
    k0 = Math.sin((1 - s) * angle) / sin;
    k1 = Math.sin(s * angle) / sin;
  }
  const x = a.qx * k0 + bx * k1;
  const y = a.qy * k0 + by * k1;
  const z = a.qz * k0 + bz * k1;
  const w = a.qw * k0 + bw * k1;
  const len = Math.hypot(x, y, z, w) || 1;
  writeQuaternion(out, x / len, y / len, z / len, w / len);
}

// ------------------------------------------------------------------ transports

/** WebSocket to a Cloudflare room. */
class SocketTransport {
  constructor(client, base) {
    this.client = client;
    this.base = base;
    this.socket = null;
    this.modeId = null;
    this.attempt = 0;
    this.timer = null;
    this.indexToKey = new Map();
    this.you = -1;
    this.refusal = 0;
    this.stopped = true;
    this.connectProfileKey = '';
  }

  start(modeId) {
    this.stop();
    this.modeId = modeId;
    this.stopped = false;
    this.attempt = 0;
    this.connect();
  }

  async connect() {
    if (this.stopped) return;
    const client = this.client;
    client._setStatus('connecting');
    const profile = client.profile;
    let { token, claimed } = await ensureToken(client.host, profile.id, profile.name);
    if (this.stopped) return;
    if (claimed) {
      if (typeof client.onIdentityClaimed === 'function') {
        profile.id = client.onIdentityClaimed();
      } else {
        profile.id = (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
      }
      const retryToken = await ensureToken(client.host, profile.id, profile.name);
      token = retryToken.token;
      claimed = retryToken.claimed;
      if (claimed) {
        client.error = 'identity-claimed';
        client._setStatus('disconnected');
        return;
      }
    }
    if (!token) {
      client.error = 'unreachable';
      this.retry();
      return;
    }
    const cosmetics = profile.cosmetics || {};
    const params = new URLSearchParams({
      playerId: profile.id,
      name: profile.name || 'Driver',
      level: String(client.level),
      paint: cosmetics.paint || '',
      rim: cosmetics.rim || '',
      number: cosmetics.number || '',
      neon: cosmetics.neon || '',
      car: cosmetics.car || '',
      modeId: client.currentMode || this.modeId || 'menu',
      token,
      instance: client.instanceId,
    });
    const party = client.partyJoin;
    if (party && partyCodeOfRoom(this.modeId)) {
      params.set('party', party.intent === 'create' ? 'create' : 'join');
      if (party.mapId) params.set('partyMap', party.mapId);
      if (party.modeId) params.set('partyMode', party.modeId);
    }
    this.connectProfileKey = client._profileKey();
    let socket;
    try {
      socket = new WebSocket(`${this.base}/parties/room/${encodeURIComponent(this.modeId)}?${params}`);
    } catch {
      this.retry();
      return;
    }
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    socket.onmessage = (event) => {
      if (socket !== this.socket) return;
      this.onMessage(event.data);
    };
    socket.onclose = (event) => {
      if (socket !== this.socket) return;
      this.socket = null;
      this.clearPeers();
      if (this.stopped) return;
      const code = this.refusal || event.code;
      this.refusal = 0;
      if (code === 4400) {
        client.error = 'rejected';
        client._setStatus('disconnected');
        return;
      }
      if (partyCodeOfRoom(this.modeId) && PARTY_REFUSALS[code]) {
        // No point retrying: the party is gone, full, or the code is taken.
        this.stopped = true;
        client.error = `party-${PARTY_REFUSALS[code]}`;
        client._setStatus('disconnected');
        client._emitPartyError(PARTY_REFUSALS[code], true);
        return;
      }
      client.error = code === 4003 ? 'room-full' : code === 4008 ? 'rate-limited' : 'closed';
      this.retry(code === 4003 ? 30000 : 0);
    };
    socket.onerror = () => {};
  }

  retry(minDelay = 0) {
    if (this.stopped) return;
    this.client._setStatus('disconnected');
    if (this.attempt >= 2) {
      forgetToken(this.client.host, this.client.profile.id);
    }
    const base = Math.min(30000, 1000 * 2 ** this.attempt);
    this.attempt = Math.min(this.attempt + 1, 6);
    const delay = Math.max(minDelay, base * (0.5 + Math.random() * 0.5));
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.connect(), delay);
  }

  onMessage(data) {
    const client = this.client;
    if (typeof data === 'string') {
      let message;
      try {
        message = JSON.parse(data);
      } catch {
        return;
      }
      if (message.t === 'roster') {
        this.attempt = 0;
        this.clearPeers();
        this.you = message.you;
        client.error = null;
        client._setStatus('connected');
        for (const peer of message.peers || []) this.addPeer(peer, false);
        client._emitRoster();
        // If cosmetics, car or name changed while connecting, push the fresh profile immediately.
        if (client._profileKey() !== this.connectProfileKey) this.sendProfile();
      } else if (message.t === 'join' || message.t === 'update') {
        this.addPeer(message.peer, true);
      } else if (message.t === 'full' || message.t === 'rejected') {
        // The room closes us next; remember why so onclose picks the right retry policy.
        this.refusal = message.t === 'full' ? 4003 : 4400;
        try {
          this.socket?.close();
        } catch {
          // closing anyway
        }
      } else if (message.t === 'leave') {
        const key = this.indexToKey.get(message.i);
        this.indexToKey.delete(message.i);
        if (key) client._removePeer(key);
      } else if (message.t === 'party') {
        if (message.error && PARTY_JOIN_ERRORS.has(message.error) && !client.party?.state) {
          // A refused join: the room closes us shortly; close first so we never retry.
          this.refusal = Number(Object.keys(PARTY_REFUSALS).find((code) => PARTY_REFUSALS[code] === message.error)) || 4404;
          try {
            this.socket?.close();
          } catch {
            // closing anyway
          }
          return;
        }
        if (message.error) client._emitPartyError(message.error, false);
        if (message.state && typeof message.state === 'object') client._onPartyState(message.state, Number(message.now), String(message.you || client.instanceId));
      }
      return;
    }
    const bytes = data instanceof ArrayBuffer ? data : null;
    if (!bytes || bytes.byteLength !== RELAY_SIZE) return;
    const view = new DataView(bytes);
    const key = this.indexToKey.get(view.getUint8(0));
    if (key) client._ingest(key, view, 1);
  }

  addPeer(peer, emit) {
    if (!peer || typeof peer.i !== 'number' || peer.i === this.you) return;
    let key = this.indexToKey.get(peer.i);
    if (!key) {
      key = String(peer.id);
      // The same profile in two tabs: keep both, distinguished by sender index.
      if (this.client.peers.has(key)) key = `${peer.id}~${peer.i}`;
      this.indexToKey.set(peer.i, key);
    }
    this.client._upsertPeer(key, peer, emit);
  }

  clearPeers() {
    const had = this.indexToKey.size > 0;
    this.indexToKey.clear();
    this.you = -1;
    if (had) this.client._clearPeers();
  }

  send(bytes) {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1) return false;
    socket.send(bytes);
    return true;
  }

  /** Party op to the room (the room is the authority). */
  sendParty(op, payload) {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1) return false;
    socket.send(JSON.stringify({ ...(payload || {}), t: 'party', op }));
    return true;
  }

  /** NetClient peer key of a party member (members carry their sender index as `peer`). */
  peerKey(member) {
    return Number.isInteger(member?.peer) ? this.indexToKey.get(member.peer) || null : null;
  }

  sendProfile() {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1) return;
    const client = this.client;
    const cosmetics = client.profile.cosmetics || {};
    socket.send(JSON.stringify({
      t: 'profile',
      name: client.profile.name,
      level: client.level,
      paint: cosmetics.paint,
      rim: cosmetics.rim,
      number: cosmetics.number,
      neon: cosmetics.neon,
      car: cosmetics.car,
      modeId: client.currentMode || 'menu',
    }));
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.close(1000, 'leave');
      } catch {
        // already closed
      }
    }
    this.clearPeers();
  }
}

/** BroadcastChannel between tabs of this browser. */
class LocalTransport {
  constructor(client) {
    this.client = client;
    this.channel = null;
    this.timer = null;
    this.heard = new Map();
  }

  start(modeId) {
    this.stop();
    const channel = new BroadcastChannel(`slop-drift-room:${modeId}`);
    this.channel = channel;
    channel.onmessage = (event) => this.onMessage(event.data);
    this.post({ t: 'hello', peer: this.client._selfInfo() });
    this.timer = setInterval(() => this.heartbeat(), LOCAL_HEARTBEAT);
    this.client._setStatus('connected');
    this.client._emitRoster();
    this.code = partyCodeOfRoom(modeId);
    if (this.code) this.startParty();
  }

  // ---- party (local mode): the host's tab is the authority and runs the reducer

  startParty() {
    const client = this.client;
    const join = client.partyJoin || { intent: 'join' };
    this.joinedProfileKey = client._profileKey();
    this.partyTimer = setInterval(() => this.partyTick(), LOCAL_PARTY_TICK);
    if (join.intent === 'create') {
      const created = createParty({ code: this.code, mapId: join.mapId, modeId: join.modeId });
      if (!created) {
        client._emitPartyError('bad-map', true);
        return;
      }
      this.applyAsAuthority(created, { type: 'join', id: client.instanceId, ...this.selfMember() });
      return;
    }
    this.post({ t: 'party-op', key: client.instanceId, op: 'join', ...this.selfMember() });
    clearTimeout(this.joinTimer);
    this.joinTimer = setTimeout(() => {
      if (!client.party?.state && this.code) client._emitPartyError('not-found', true);
    }, LOCAL_PARTY_TIMEOUT);
  }

  selfMember() {
    const info = this.client._selfInfo();
    return { name: info.name, level: info.level, paint: info.paint, car: info.car, peer: info.key };
  }

  isAuthority() {
    const state = this.client.party?.state;
    return Boolean(state) && state.hostId === this.client.instanceId;
  }

  /** Runs one event on `base` as the authority; broadcasts and adopts the result when it changed. */
  applyAsAuthority(base, event, from = this.client.instanceId) {
    const client = this.client;
    const { state, error } = partyStep(base, event, client.wallNow());
    if (error) {
      if (from === client.instanceId) client._emitPartyError(error, false);
      else this.post({ t: 'party-error', key: client.instanceId, to: from, error });
    }
    if (state !== base || !client.party?.state) this.publish(state);
    return state;
  }

  publish(state) {
    const client = this.client;
    const now = client.wallNow();
    if (state && state.hostId) this.post({ t: 'party', key: client.instanceId, state, now });
    client._onPartyState(state && state.hostId ? state : null, now, client.instanceId);
  }

  partyTick() {
    if (!this.isAuthority()) return;
    const state = this.client.party.state;
    if (state.phase !== 'countdown' && state.phase !== 'racing') return;
    this.applyAsAuthority(state, { type: 'tick' });
  }

  sendParty(op, payload) {
    const client = this.client;
    if (!this.channel || !this.code) return false;
    if (this.isAuthority()) {
      const event = eventFromOp(client.instanceId, { ...(payload || {}), op }, { allowJoin: true });
      if (!event) return false;
      this.applyAsAuthority(client.party.state, event);
      return true;
    }
    this.post({ ...(payload || {}), t: 'party-op', key: client.instanceId, op });
    return true;
  }

  onPartyMessage(message) {
    const client = this.client;
    if (message.t === 'party') {
      if (!message.state || typeof message.state !== 'object' || message.state.code !== this.code) return;
      clearTimeout(this.joinTimer);
      client._onPartyState(message.state, Number(message.now), client.instanceId);
      if (client._profileKey() !== this.joinedProfileKey) {
        this.joinedProfileKey = client._profileKey();
        this.sendProfile();
      }
    } else if (message.t === 'party-op') {
      if (!this.isAuthority() || typeof message.key !== 'string') return;
      const event = eventFromOp(message.key, message, { allowJoin: true });
      if (event) this.applyAsAuthority(client.party.state, event, message.key);
    } else if (message.t === 'party-error') {
      if (message.to !== client.instanceId) return;
      const joined = Boolean(client.party?.state?.members?.[client.instanceId]);
      if (!joined) clearTimeout(this.joinTimer);
      client._emitPartyError(String(message.error), !joined && PARTY_JOIN_ERRORS.has(message.error));
    }
  }

  /** A tab left or went silent: drop it from the party; if it was the host, the next tab takes over. */
  partyPeerGone(key) {
    const client = this.client;
    const state = client.party?.state;
    if (!this.code || !state || !state.members[key]) return;
    if (this.isAuthority()) {
      this.applyAsAuthority(state, { type: 'leave', id: key });
      return;
    }
    if (key !== state.hostId) return;
    const heir = memberOrder(state).find((id) => id !== key);
    if (heir === client.instanceId) this.applyAsAuthority({ ...state, hostId: client.instanceId }, { type: 'leave', id: key });
  }

  /** Leaving the room: the authority hands the party on before going, others tell it. */
  leaveParty() {
    const client = this.client;
    const state = client.party?.state;
    if (!this.code || !state || !state.members[client.instanceId]) return;
    if (this.isAuthority()) {
      const next = partyStep(state, { type: 'leave', id: client.instanceId }, client.wallNow()).state;
      if (next.hostId) this.post({ t: 'party', key: client.instanceId, state: next, now: client.wallNow() });
    } else {
      this.post({ t: 'party-op', key: client.instanceId, op: 'leave' });
    }
  }

  peerKey(member) {
    return typeof member?.peer === 'string' ? member.peer : null;
  }

  heartbeat() {
    this.post({ t: 'here', peer: this.client._selfInfo() });
    const now = this.client.now();
    for (const [key, at] of this.heard) {
      if (now - at > LOCAL_TIMEOUT) {
        this.heard.delete(key);
        this.client._removePeer(key);
        this.partyPeerGone(key);
      }
    }
  }

  post(message) {
    try {
      this.channel?.postMessage(message);
    } catch {
      // channel closed
    }
  }

  onMessage(message) {
    if (!message || typeof message !== 'object') return;
    const client = this.client;
    const peer = message.peer;
    const key = peer?.key || message.key;
    if (typeof key !== 'string' || key === client.instanceId) return;
    if (message.t === 'party' || message.t === 'party-op' || message.t === 'party-error') {
      if (this.code) this.onPartyMessage(message);
      return;
    }
    if (message.t === 'bye') {
      this.heard.delete(key);
      client._removePeer(key);
      this.partyPeerGone(key);
      return;
    }
    if (!peer) return;
    this.heard.set(key, client.now());
    const known = client.peers.has(key);
    client._upsertPeer(key, peer, true);
    if (message.t === 'hello') this.post({ t: 'here', peer: client._selfInfo() });
    if (message.t === 'state' && message.buf instanceof ArrayBuffer && message.buf.byteLength === PACKET_SIZE) {
      client._ingest(key, new DataView(message.buf), 0);
    } else if (!known && message.t === 'state') {
      // malformed state from a new peer: keep the roster entry, ignore the packet
    }
  }

  send(bytes) {
    if (!this.channel) return false;
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    this.post({ t: 'state', peer: this.client._selfInfo(), buf });
    return true;
  }

  sendProfile() {
    this.post({ t: 'here', peer: this.client._selfInfo() });
    if (this.code && this.client.party?.state?.members?.[this.client.instanceId]) {
      this.sendParty('join', this.selfMember());
    }
  }

  stop() {
    if (this.channel) {
      this.leaveParty();
      this.post({ t: 'bye', key: this.client.instanceId });
      try {
        this.channel.close();
      } catch {
        // closed
      }
    }
    this.channel = null;
    clearInterval(this.timer);
    this.timer = null;
    clearInterval(this.partyTimer);
    clearTimeout(this.joinTimer);
    this.partyTimer = null;
    this.code = null;
    this.heard.clear();
    this.client._clearPeers();
  }
}

// ------------------------------------------------------------------ client

export class NetClient {
  /**
   * @param {object} options
   * @param {string} [options.host]    API host (VITE_API_HOST), e.g. 'https://slop-drift-api.you.workers.dev' or 'localhost:8787'. Empty -> local/offline.
   * @param {{id:string, name:string, level?:number, xp?:number, cosmetics?:{paint?:string, rim?:string, number?:string, neon?:string, car?:string}}} options.profile
   * @param {() => number} [options.now]  Clock in ms (tests); defaults to performance.now().
   */
  constructor({ host = '', profile, now, wallNow } = {}) {
    this.host = normalizeHost(host);
    this.now = typeof now === 'function' ? now : defaultNow;
    /** Epoch-ms clock for party deadlines (tests pass a fake). */
    this.wallNow = typeof wallNow === 'function' ? wallNow : () => Date.now();
    this.profile = { id: 'anonymous-player', name: 'Driver', cosmetics: {}, ...(profile || {}) };
    this.level = profileLevel(this.profile, levelForXp);
    this.instanceId = `${this.profile.id}#${randomId()}`;
    const hasChannel = typeof BroadcastChannel !== 'undefined';
    /** @type {'online'|'local'|'offline'} */
    this.mode = this.host ? 'online' : hasChannel ? 'local' : 'offline';
    /** @type {'connecting'|'connected'|'disconnected'} */
    this.status = 'disconnected';
    /** Last problem, for UI hints: 'unreachable' | 'identity-claimed' | 'room-full' | 'rate-limited' | 'rejected' | 'closed' | null. */
    this.error = null;
    this.modeId = null;
    this.currentMode = 'menu';
    /** @type {Map<string, import('../core/contracts.js').RemotePeer & {playerId:string}>} */
    this.peers = new Map();
    this.tracks = new Map();
    this.stats = { sent: 0, bytesSent: 0, received: 0 };
    this.listeners = new Set();
    this.statusListeners = new Set();
    this.partyListeners = new Set();
    /** Join options of the party room being joined: { intent: 'create'|'join', mapId, modeId }. */
    this.partyJoin = null;
    /** Current party room: { code, state, you, offset, error } or null outside party rooms. */
    this.party = null;

    this.packet = new Uint8Array(PACKET_SIZE);
    this.packetView = new DataView(this.packet.buffer);
    this.lastSend = -Infinity;
    this.lastMoving = false;
    this.onlineCache = null;

    this.transport = this.mode === 'online'
      ? new SocketTransport(this, socketBase(this.host))
      : this.mode === 'local' ? new LocalTransport(this) : null;

    // Presence across events for online() in local mode.
    this.presence = new Map();
    this.presenceChannel = null;
    this.presenceTimer = null;
    if (this.mode === 'local') {
      try {
        this.presenceChannel = new BroadcastChannel(PRESENCE_CHANNEL);
        this.presenceChannel.onmessage = (event) => {
          const data = event.data;
          if (!data || typeof data.key !== 'string' || data.key === this.instanceId) return;
          if (data.bye) this.presence.delete(data.key);
          else this.presence.set(data.key, { modeId: typeof data.modeId === 'string' ? data.modeId : null, at: this.now() });
        };
        this.presenceTimer = setInterval(() => this.announcePresence(), 3000);
        this.announcePresence();
      } catch {
        this.presenceChannel = null;
      }
    }

    this.onPageHide = () => this.leave();
    if (typeof addEventListener === 'function' && typeof window !== 'undefined') window.addEventListener('pagehide', this.onPageHide);
  }

  // ---------------------------------------------------------------- public API

  /**
   * Enter the room for an event id ('sprint', 'circuit', ...) or a party ('party.K7QXM'). Leaves the
   * current room first.
   * @param {string} modeId
   * @param {{party?: {intent:'create'|'join', mapId?:string, modeId?:string}}} [options]  Party rooms only.
   */
  join(modeId, options = {}) {
    try {
      if (typeof modeId !== 'string' || !modeId) return;
      if (this.modeId === modeId && this.status !== 'disconnected') return;
      this.leave();
      this.modeId = modeId;
      this.lastSend = -Infinity;
      const code = partyCodeOfRoom(modeId);
      this.partyJoin = code ? { intent: 'join', ...(options?.party || {}) } : null;
      this.party = code ? { code, state: null, you: this.instanceId, offset: null, error: null } : null;
      if (this.transport) this.transport.start(modeId);
      else if (code) this._emitPartyError('offline', true);
      this.announcePresence();
    } catch (error) {
      this.fail(error);
    }
  }

  leave() {
    try {
      if (!this.modeId) return;
      this.transport?.stop();
      this.modeId = null;
      this.party = null;
      this.partyJoin = null;
      this._clearPeers();
      this._setStatus('disconnected');
      this.announcePresence();
    } catch (error) {
      this.fail(error);
    }
  }

  setMode(modeId) {
    this.currentMode = modeId || 'menu';
    if (this.transport && typeof this.transport.sendProfile === 'function') {
      this.transport.sendProfile();
    }
  }

  /**
   * Call every frame; sends at most ~6 Hz moving / 1 Hz stationary.
   * @param {import('../core/contracts.js').VehicleState} state
   * @param {{braking?:boolean, boosting?:boolean, drifting?:boolean}} [extras]
   * @param {number} [now]  performance.now()
   * @returns {boolean} true when a packet went out this call.
   */
  sendState(state, extras, now = this.now()) {
    try {
      if (!this.transport || this.status !== 'connected' || !state?.position || !state?.quaternion) return false;
      const speed = Math.abs(state.speed ?? state.forwardSpeed ?? 0);
      const moving = speed > MOVING_SPEED;
      const elapsed = now - this.lastSend;
      const interval = 1000 / (moving ? SEND_HZ_MOVING : SEND_HZ_IDLE);
      const due = elapsed >= interval * 0.95 || (moving !== this.lastMoving && elapsed >= 1000 / SEND_HZ_MAX);
      if (!due) return false;
      encodeState(this.packetView, state, packFlags(extras, state), now);
      if (!this.transport.send(this.packet)) return false;
      this.lastSend = now;
      this.lastMoving = moving;
      this.stats.sent += 1;
      this.stats.bytesSent += PACKET_SIZE;
      return true;
    } catch (error) {
      this.fail(error);
      return false;
    }
  }

  /**
   * Interpolated pose of a peer at `renderTime` (performance.now()), written into the outputs
   * (THREE.Vector3 / THREE.Quaternion or plain {x,y,z(,w)}).
   * @returns {{steer:number, speed:number, braking:boolean, boosting:boolean, drifting:boolean, reversing:boolean, airborne:boolean}|null}
   *   A shared object (read it now, do not keep it); null when the peer is unknown, has sent nothing yet, or went silent.
   */
  samplePeer(id, renderTime, outPosition, outQuaternion) {
    try {
      const track = this.tracks.get(id);
      if (!track || !track.count) return null;
      if (renderTime - track.lastSeen > PEER_STALE) return null;
      return track.sample(renderTime, outPosition, outQuaternion);
    } catch (error) {
      this.fail(error);
      return null;
    }
  }

  /** callback(peers) on every join, leave or profile change. Returns an unsubscribe function. */
  onRoster(callback) {
    if (typeof callback !== 'function') return () => {};
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * A party op for the current party room: 'select' {mapId, modeId}, 'ready' {ready}, 'start',
   * 'finish' {time, score, dnf}, 'rematch', 'sync'. Returns false when it could not be sent.
   */
  sendParty(op, payload = {}) {
    try {
      if (!this.party || typeof op !== 'string' || typeof this.transport?.sendParty !== 'function') return false;
      return this.transport.sendParty(op, payload);
    } catch (error) {
      this.fail(error);
      return false;
    }
  }

  /**
   * callback(state, info) on every party state change and refusal. state: the party state (null when
   * the party could not be joined or ended); info: { you, offset, error, fatal } where `offset` is
   * ms to add to Date.now() to get the authority's clock, `error` a refusal code, and `fatal` true
   * when the party room is unusable (not found, full, ...). Returns an unsubscribe function.
   */
  onParty(callback) {
    if (typeof callback !== 'function') return () => {};
    this.partyListeners.add(callback);
    return () => this.partyListeners.delete(callback);
  }

  /** The key in `peers` (for samplePeer) of a party member id, or null (yourself, or not seen yet). */
  partyPeerKey(memberId) {
    const member = this.party?.state?.members?.[memberId];
    if (!member || memberId === this.party.you) return null;
    const key = this.transport?.peerKey?.(member) ?? null;
    return key && this.peers.has(key) ? key : null;
  }

  /** callback(status, error) when the connection status changes. Returns an unsubscribe function. */
  onStatus(callback) {
    if (typeof callback !== 'function') return () => {};
    this.statusListeners.add(callback);
    return () => this.statusListeners.delete(callback);
  }

  /** Players per event. Online: the Worker (cached 15 s); local: tabs of this browser. Never rejects. */
  async online() {
    const self = this.modeId ? { total: 1, rooms: { [this.modeId]: 1 } } : { total: 0, rooms: {} };
    try {
      if (this.mode === 'online') {
        const now = this.now();
        if (this.onlineCache && now - this.onlineCache.at < ONLINE_CACHE) return this.onlineCache.data;
        const response = await fetchWithTimeout(`${this.host}/api/online`);
        if (!response.ok) throw new Error(`online ${response.status}`);
        const data = await response.json();
        const result = { total: Number(data.total) || 0, rooms: data.rooms && typeof data.rooms === 'object' ? data.rooms : {} };
        this.onlineCache = { at: now, data: result };
        return result;
      }
      if (this.mode === 'local') {
        const now = this.now();
        const rooms = { ...self.rooms };
        let total = self.total;
        for (const [key, entry] of this.presence) {
          if (now - entry.at > 8000) {
            this.presence.delete(key);
            continue;
          }
          if (!entry.modeId) continue;
          rooms[entry.modeId] = (rooms[entry.modeId] || 0) + 1;
          total += 1;
        }
        return { total, rooms };
      }
    } catch {
      // fall through: report what we know locally
    }
    if (this.modeId) {
      const count = this.peers.size + 1;
      return { total: count, rooms: { [this.modeId]: count } };
    }
    return self;
  }

  /** New name, level or cosmetics: others see the change immediately. */
  updateProfile(profile) {
    try {
      if (!profile) return;
      this.profile = { ...this.profile, ...profile, cosmetics: { ...(this.profile.cosmetics || {}), ...(profile.cosmetics || {}) } };
      this.level = profileLevel(this.profile, levelForXp);
      if (this.status === 'connected') this.transport?.sendProfile();
    } catch (error) {
      this.fail(error);
    }
  }

  dispose() {
    try {
      this.leave();
      clearInterval(this.presenceTimer);
      if (this.presenceChannel) {
        try {
          this.presenceChannel.postMessage({ key: this.instanceId, bye: true });
          this.presenceChannel.close();
        } catch {
          // closed
        }
      }
      this.presenceChannel = null;
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', this.onPageHide);
      this.listeners.clear();
      this.statusListeners.clear();
      this.partyListeners.clear();
    } catch (error) {
      this.fail(error);
    }
  }

  // ---------------------------------------------------------------- internals (transports, tests)

  announcePresence() {
    try {
      this.presenceChannel?.postMessage({ key: this.instanceId, modeId: this.modeId });
    } catch {
      // closed
    }
  }

  fail(error) {
    this.error = 'internal';
    if (typeof console !== 'undefined') console.warn('[net]', error);
  }

  _selfInfo() {
    const cosmetics = this.profile.cosmetics || {};
    return {
      key: this.instanceId,
      id: this.profile.id,
      name: this.profile.name,
      level: this.level,
      paint: cosmetics.paint || '',
      rim: cosmetics.rim || '',
      number: cosmetics.number || '',
      neon: cosmetics.neon || '',
      car: cosmetics.car || '',
      modeId: this.currentMode || 'menu',
    };
  }

  _profileKey() {
    const cosmetics = this.profile.cosmetics || {};
    return `${this.profile.name}|${this.level}|${cosmetics.paint || ''}|${cosmetics.rim || ''}|${cosmetics.number || ''}|${cosmetics.neon || ''}|${cosmetics.car || ''}|${this.currentMode || 'menu'}`;
  }

  /** A party state arrived (`now`: the authority's clock when it was sent). */
  _onPartyState(state, now, you) {
    const party = this.party;
    if (!party) return;
    if (state && state.code !== party.code) return;
    // The sample that arrived fastest is the best estimate of the authority's clock (latency >= 0).
    if (Number.isFinite(now)) {
      const sample = now - this.wallNow();
      party.offset = party.offset === null ? sample : Math.max(party.offset, sample);
    }
    party.state = state;
    party.you = you || party.you;
    party.error = null;
    if (state && this.partyJoin) this.partyJoin.intent = 'join'; // reconnects rejoin, never re-create
    this._emitParty({ fatal: false, error: null });
  }

  _emitPartyError(error, fatal) {
    if (!this.party) return;
    this.party.error = error;
    if (fatal) this.party.state = null;
    this._emitParty({ fatal, error });
  }

  _emitParty({ fatal, error }) {
    const party = this.party;
    if (!party) return;
    const info = { you: party.you, offset: party.offset ?? 0, error, fatal };
    for (const listener of this.partyListeners) {
      try {
        listener(party.state, info);
      } catch (failure) {
        this.fail(failure);
      }
    }
  }

  _setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) {
      try {
        listener(status, this.error);
      } catch (error) {
        this.fail(error);
      }
    }
  }

  _emitRoster() {
    for (const listener of this.listeners) {
      try {
        listener(this.peers);
      } catch (error) {
        this.fail(error);
      }
    }
  }

  _upsertPeer(key, info, emit = true) {
    const existing = this.peers.get(key);
    const peer = existing || { id: key, playerId: '', name: '', level: 1, paint: '', rim: '', number: '', neon: '', car: '', modeId: 'menu', lastSeen: 0 };
    const before = existing ? `${peer.name}|${peer.level}|${peer.paint}|${peer.rim}|${peer.number}|${peer.neon}|${peer.car}|${peer.modeId}` : null;
    peer.playerId = String(info.id ?? peer.playerId);
    peer.name = String(info.name ?? peer.name).slice(0, 24);
    peer.level = Number(info.level) || 1;
    if (info.paint !== undefined) peer.paint = String(info.paint ?? '');
    if (info.rim !== undefined) peer.rim = String(info.rim ?? '');
    if (info.number !== undefined) peer.number = String(info.number ?? '');
    if (info.neon !== undefined) peer.neon = String(info.neon ?? '');
    if (info.car !== undefined) peer.car = String(info.car ?? '');
    peer.modeId = info.modeId || peer.modeId || 'menu';
    if (!existing) {
      this.peers.set(key, peer);
      this.tracks.set(key, new Track());
    }
    const changed = before !== `${peer.name}|${peer.level}|${peer.paint}|${peer.rim}|${peer.number}|${peer.neon}|${peer.car}|${peer.modeId}`;
    if (emit && changed) this._emitRoster();
    return peer;
  }

  _removePeer(key) {
    if (!this.peers.delete(key)) return;
    this.tracks.delete(key);
    this._emitRoster();
  }

  _clearPeers() {
    if (!this.peers.size) return;
    this.peers.clear();
    this.tracks.clear();
    this._emitRoster();
  }

  /** Feed one state packet for a known peer (transports call this; tests too). */
  _ingest(key, view, offset, receivedAt = this.now()) {
    const track = this.tracks.get(key);
    if (!track) return false;
    if (!track.push(view, offset, receivedAt)) return false;
    this.stats.received += 1;
    const peer = this.peers.get(key);
    if (peer) peer.lastSeen = receivedAt;
    return true;
  }

  /** Current interpolation delay for a peer in ms (debug HUD). */
  peerDelay(id) {
    const track = this.tracks.get(id);
    return track ? track.renderDelay ?? track.delay : null;
  }
}
