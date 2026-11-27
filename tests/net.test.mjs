// Tests for src/net/* (protocol, NetClient, Leaderboard) and server/src/validate.js.
// Run: node tests/net.test.mjs   (exit code 1 on failure)
// Live server checks (optional): start `npx wrangler dev` in server/, then
//   NET_LIVE=http://127.0.0.1:8787 node tests/net.test.mjs

// In-memory localStorage before any module touches it.
const memoryStore = new Map();
globalThis.localStorage = {
  getItem: (key) => (memoryStore.has(key) ? memoryStore.get(key) : null),
  setItem: (key, value) => memoryStore.set(key, String(value)),
  removeItem: (key) => memoryStore.delete(key),
  clear: () => memoryStore.clear(),
};

const {
  PACKET_SIZE, RELAY_SIZE, FLAG_BRAKING, FLAG_DRIFTING, createSnapshot, decodeState, encodeState, packFlags,
} = await import('../src/net/protocol.js');
const { NetClient, PEER_STALE, EXTRAPOLATE_MAX } = await import('../src/net/NetClient.js');
const { Leaderboard, rankEntries } = await import('../src/net/Leaderboard.js');
const validate = await import('../server/src/validate.js');
const { encodeGhost } = await import('../src/ghost/ghostCodec.js');
const { MEDAL_TARGETS, MUSSOORIE_MEDAL_TARGETS } = await import('../src/meta/catalog.js');
const { MetaLayer } = await import('../src/game/MetaLayer.js');
const { PartyHost, MAP_SWITCH_GRACE_MS } = await import('../server/src/partyHost.js');
const { PARTY_COUNTDOWN_MS, PARTY_FINISH_GRACE_MS, partyModes } = await import('../src/net/party.js');
const { MAPS } = await import('../src/world/maps.js');
const { trackKey } = await import('../src/meta/trackKey.js');
const THREE = await import('three');
const { RemotePlayers } = await import('../src/render/RemotePlayers.js');

let failures = 0;
let passes = 0;
const pending = [];
function test(name, fn) {
  pending.push([name, fn]);
}
function assert(cond, message) {
  if (!cond) throw new Error(message || 'assertion failed');
}
function near(a, b, eps, message) {
  if (!(Math.abs(a - b) <= eps)) throw new Error(`${message || 'not near'}: ${a} vs ${b} (eps ${eps})`);
}

// Deterministic random.
let seed = 12345;
function random() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}

/** A car driving a circle of radius 80 m at 30 m/s, as a VehicleState-like object at time t (s). */
function carAt(t, out = makeState()) {
  const R = 80;
  const w = 30 / R;
  const a = t * w;
  out.position.x = R * Math.cos(a);
  out.position.y = 5 + Math.sin(t);
  out.position.z = R * Math.sin(a);
  out.velocity.x = -R * w * Math.sin(a);
  out.velocity.y = Math.cos(t);
  out.velocity.z = R * w * Math.cos(a);
  const yaw = -a; // any smooth rotation
  out.quaternion.x = 0;
  out.quaternion.y = Math.sin(yaw / 2);
  out.quaternion.z = 0;
  out.quaternion.w = Math.cos(yaw / 2);
  out.speed = 30;
  out.forwardSpeed = 30;
  out.steerAngle = 0.2;
  return out;
}
function makeState() {
  return { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 }, velocity: { x: 0, y: 0, z: 0 }, speed: 0, forwardSpeed: 0, steerAngle: 0 };
}
function packet(state, flags, timeMs) {
  const bytes = new Uint8Array(PACKET_SIZE);
  encodeState(new DataView(bytes.buffer), state, flags, timeMs);
  return bytes;
}

/** A NetClient whose transport is a recorder instead of a socket/channel. */
function fakeClient(now) {
  const client = new NetClient({ host: '', profile: { id: 'test-player-0001', name: 'Tester', level: 4 }, now });
  const sent = [];
  client.transport = {
    start() { client._setStatus('connected'); },
    stop() {},
    send(bytes) { sent.push(bytes.slice()); return true; },
    sendProfile() {},
  };
  client.join('sprint');
  return { client, sent };
}

// ------------------------------------------------------------------ protocol

test('protocol: packet sizes', () => {
  assert(PACKET_SIZE === 35, `packet ${PACKET_SIZE}`);
  assert(RELAY_SIZE === 36, `relay ${RELAY_SIZE}`);
});

test('protocol: round trip keeps pose, speed, steer and flags', () => {
  const state = carAt(2.3);
  state.quaternion = { x: 0.1, y: -0.7, z: 0.05, w: -0.7 }; // unnormalised, w < 0
  state.forwardSpeed = -4.56;
  state.steerAngle = -0.33;
  const bytes = packet(state, FLAG_BRAKING | FLAG_DRIFTING, 123456789.7);
  const out = createSnapshot();
  assert(decodeState(new DataView(bytes.buffer), 0, out), 'decodes');
  near(out.x, state.position.x, 1e-4, 'x');
  near(out.y, state.position.y, 1e-4, 'y');
  near(out.z, state.position.z, 1e-4, 'z');
  const len = Math.hypot(0.1, 0.7, 0.05, 0.7);
  // Sign flipped so w >= 0: same rotation.
  near(out.qx, -0.1 / len, 1e-4, 'qx');
  near(out.qy, 0.7 / len, 1e-4, 'qy');
  near(out.qw, 0.7 / len, 1e-4, 'qw');
  near(out.vx, state.velocity.x, 0.006, 'vx');
  near(out.speed, -4.56, 0.006, 'speed');
  near(out.steer, -0.33, 0.6 / 127, 'steer');
  assert(out.time === 123456789, 'time');
  assert(out.braking && out.drifting && !out.boosting, 'flags');
});

test('protocol: rejects garbage and NaN without touching the output', () => {
  const out = createSnapshot();
  out.x = 42;
  assert(!decodeState(new DataView(new ArrayBuffer(10)), 0, out), 'short');
  const bytes = packet(carAt(1), 0, 1);
  const view = new DataView(bytes.buffer);
  view.setFloat32(6, NaN, true);
  assert(!decodeState(view, 0, out), 'nan');
  view.setUint8(0, 99);
  assert(!decodeState(view, 0, out), 'type');
  assert(out.x === 42, 'untouched');
  const flags = packFlags({ braking: true }, { gear: 'R', boosting: true });
  assert(flags & FLAG_BRAKING && flags & 2 && flags & 8, 'packFlags');
});

// ------------------------------------------------------------------ interpolation

test('interpolation: smooth and accurate under jitter, clock offset and loss', () => {
  let now = 0;
  const client = new NetClient({ host: '', profile: { id: 'viewer-000001', name: 'Viewer' }, now: () => now });
  client.transport = null;
  client._upsertPeer('peer-a', { id: 'peer-a', name: 'Alpha', level: 2 }, false);
  const senderOffset = 987654; // sender's clock is unrelated to ours
  const latency = 40;
  const arrivals = [];
  const state = makeState();
  for (let t = 0; t < 12; t += 1 / 6) {
    if (random() < 0.05) continue; // 5% loss
    carAt(t, state);
    arrivals.push({ at: t * 1000 + latency + random() * 70, bytes: packet(state, 0, t * 1000 + senderOffset) });
  }
  arrivals.sort((a, b) => a.at - b.at);
  const pos = { x: 0, y: 0, z: 0 };
  const quat = { x: 0, y: 0, z: 0, w: 1 };
  const truth = makeState();
  let next = 0;
  let maxError = 0;
  let maxJump = 0;
  let last = null;
  let frames = 0;
  for (now = 0; now < 12000; now += 1000 / 60) {
    while (next < arrivals.length && arrivals[next].at <= now) {
      client._ingest('peer-a', new DataView(arrivals[next].bytes.buffer), 0, arrivals[next].at);
      next += 1;
    }
    const sample = client.samplePeer('peer-a', now, pos, quat);
    if (!sample || now < 3000) continue;
    frames += 1;
    const track = client.tracks.get('peer-a');
    const senderTime = (now - track.renderDelay - track.offset - senderOffset) / 1000;
    carAt(senderTime, truth);
    maxError = Math.max(maxError, Math.hypot(pos.x - truth.position.x, pos.z - truth.position.z));
    if (last) maxJump = Math.max(maxJump, Math.hypot(pos.x - last.x, pos.z - last.z));
    last = { x: pos.x, z: pos.z };
    near(Math.hypot(quat.x, quat.y, quat.z, quat.w), 1, 1e-6, 'unit quaternion');
    near(sample.steer, 0.2, 0.01, 'steer');
  }
  const delay = client.peerDelay('peer-a');
  assert(frames > 400, `frames ${frames}`);
  assert(delay >= 150 && delay <= 320, `adaptive delay ${delay}`);
  assert(maxError < 0.6, `max position error ${maxError.toFixed(3)} m`);
  // 30 m/s at 60 fps is 0.5 m per frame; allow modest unevenness.
  assert(maxJump < 0.65, `max frame step ${maxJump.toFixed(3)} m`);
  console.log(`    delay ${delay.toFixed(0)} ms, max error ${maxError.toFixed(3)} m, max frame step ${maxJump.toFixed(3)} m`);
  client.dispose();
});

test('interpolation: dead reckoning when packets stop, capped, then stale', () => {
  let now = 0;
  const client = new NetClient({ host: '', profile: { id: 'viewer-000002', name: 'Viewer' }, now: () => now });
  client.transport = null;
  client._upsertPeer('peer-b', { id: 'peer-b', name: 'Bravo' }, false);
  const state = makeState();
  // Straight line along +x at 20 m/s, 6 Hz, then silence after t = 2 s.
  for (let t = 0; t <= 2.0001; t += 1 / 6) {
    state.position.x = 20 * t;
    state.velocity.x = 20;
    state.speed = 20;
    client._ingest('peer-b', new DataView(packet(state, 0, t * 1000).buffer), 0, t * 1000 + 30);
  }
  const lastX = state.position.x;
  const track = client.tracks.get('peer-b');
  const lastT = track.newest.t;
  const pos = { x: 0, y: 0, z: 0 };
  // 100 ms past the newest sample: extrapolated along the velocity.
  client.samplePeer('peer-b', lastT + track.delay + 100, pos, null);
  near(pos.x, lastX + 2, 0.05, 'extrapolated 100 ms');
  // Far past: capped at EXTRAPOLATE_MAX.
  client.samplePeer('peer-b', lastT + track.delay + 2000, pos, null);
  near(pos.x, lastX + 20 * EXTRAPOLATE_MAX / 1000, 0.05, 'capped');
  // Silent for longer than PEER_STALE: hidden.
  assert(client.samplePeer('peer-b', 2030 + PEER_STALE + 10, pos, null) === null, 'stale -> null');
  assert(client.samplePeer('nobody', 0, pos, null) === null, 'unknown -> null');
  client.dispose();
});

test('interpolation: respawn teleports instead of sliding', () => {
  let now = 0;
  const client = new NetClient({ host: '', profile: { id: 'viewer-000003', name: 'Viewer' }, now: () => now });
  client.transport = null;
  client._upsertPeer('peer-c', { id: 'peer-c', name: 'Charlie' }, false);
  const state = makeState();
  client._ingest('peer-c', new DataView(packet(state, 0, 0).buffer), 0, 0);
  state.position.x = 500;
  client._ingest('peer-c', new DataView(packet(state, 0, 166).buffer), 0, 166);
  const pos = { x: 0, y: 0, z: 0 };
  const track = client.tracks.get('peer-c');
  client.samplePeer('peer-c', 83 + track.delay, pos, null);
  assert(pos.x === 0 || pos.x === 500, `no slide (${pos.x})`);
  client.dispose();
});

// ------------------------------------------------------------------ send rate

test('sendState: 6 Hz moving, 1 Hz stationary, extra packet on stop, never above 15 Hz', () => {
  let now = 0;
  const { client, sent } = fakeClient(() => now);
  const state = carAt(0);
  const frame = 1000 / 60;
  for (now = 0; now < 3000; now += frame) client.sendState(carAt(now / 1000, state), {}, now);
  const moving = sent.length;
  assert(moving >= 17 && moving <= 19, `moving packets in 3 s: ${moving}`);
  sent.length = 0;
  state.speed = 0.1;
  state.forwardSpeed = 0.1;
  for (; now < 8000; now += frame) client.sendState(state, {}, now);
  // One immediate "stopped" packet, then 1 Hz.
  assert(sent.length >= 5 && sent.length <= 7, `stationary packets in 5 s: ${sent.length}`);
  // 240 Hz frame rate still sends ~6 Hz.
  sent.length = 0;
  state.speed = 25;
  for (; now < 10000; now += 1000 / 240) client.sendState(state, {}, now);
  assert(sent.length >= 12 && sent.length <= 14, `moving at 240 fps for 2 s: ${sent.length}`);
  // Every packet is exactly PACKET_SIZE bytes.
  assert(sent.every((bytes) => bytes.length === PACKET_SIZE), 'packet size');
  // Nothing goes out when not connected.
  client.leave();
  assert(client.sendState(state, {}, now + 5000) === false, 'not connected');
  client.dispose();
});

test('NetClient: never throws on bad input', () => {
  const { client } = fakeClient(() => 0);
  assert(client.sendState(null) === false, 'null state');
  assert(client.sendState({ position: {} , quaternion: {} }, null, 99999) !== undefined, 'partial state');
  client.join(undefined);
  client.updateProfile(null);
  assert(client.samplePeer(undefined, NaN, null, null) === null, 'sample');
  client.dispose();
});

test('local mode: two clients over BroadcastChannel see each other', async () => {
  if (typeof BroadcastChannel === 'undefined') return;
  const a = new NetClient({ profile: { id: 'same-profile-id', name: 'Tab A', level: 3, cosmetics: { paint: 'ember' } } });
  const b = new NetClient({ profile: { id: 'same-profile-id', name: 'Tab B', level: 5 } });
  assert(a.mode === 'local' && b.mode === 'local', `mode ${a.mode}`);
  a.join('climb');
  b.join('climb');
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert(a.status === 'connected', 'status');
  assert(a.peers.size === 1 && b.peers.size === 1, `peers ${a.peers.size}/${b.peers.size}`);
  const peerOfA = [...b.peers.values()][0];
  assert(peerOfA.name === 'Tab A' && peerOfA.paint === 'ember' && peerOfA.level === 3, 'roster info');
  const state = carAt(1);
  a.sendState(state, { drifting: true });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const pos = { x: 0, y: 0, z: 0 };
  const sample = b.samplePeer(peerOfA.id, performance.now(), pos, { x: 0, y: 0, z: 0, w: 1 });
  assert(sample && sample.drifting, 'state arrives');
  near(pos.x, state.position.x, 1, 'position');
  const online = await b.online();
  assert(online.rooms.climb === 2 && online.total === 2, `online ${JSON.stringify(online)}`);
  a.leave();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert(b.peers.size === 0, 'leave propagates');
  a.dispose();
  b.dispose();
});

// ------------------------------------------------------------------ parties (local transport)

const waitFor = async (cond, ms = 2000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) return false;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return true;
};

test('local mode: party create, join, select, ready, synchronised start, finish, results, host hand-over', async () => {
  if (typeof BroadcastChannel === 'undefined') return;
  let wall = 1_800_000_000_000;
  const wallNow = () => wall;
  const make = (name) => {
    const client = new NetClient({ profile: { id: 'same-profile-id', name, level: 2, cosmetics: { paint: 'ember' } }, wallNow });
    const seen = [];
    client.onParty((state, info) => seen.push({ state, info }));
    return { client, seen, last: () => seen.at(-1) };
  };
  const a = make('Tab A');
  const b = make('Tab B');
  const c = make('Tab C');
  try {
    a.client.join('party.K7QXM', { party: { intent: 'create', mapId: 'mussoorie', modeId: 'sprint' } });
    assert(a.last()?.state?.hostId === a.client.instanceId, 'creator hosts at once');
    b.client.join('party.K7QXM');
    assert(await waitFor(() => b.last()?.state?.members?.[b.client.instanceId]), 'B joined');
    assert(await waitFor(() => Object.keys(a.last().state.members).length === 2), 'A sees B');
    assert(b.last().info.you === b.client.instanceId && b.last().state.hostId === a.client.instanceId, 'B knows who it is');
    assert(await waitFor(() => b.client.partyPeerKey(a.client.instanceId) === a.client.instanceId), 'B finds A\'s car by member id');

    // Only the host may pick; B's attempt is refused back to B.
    b.client.sendParty('select', { modeId: 'climb' });
    assert(await waitFor(() => b.last().info.error === 'not-host'), 'refusal reaches B');
    a.client.sendParty('select', { mapId: 'mussoorie', modeId: 'peak' });
    b.client.sendParty('ready', { ready: true });
    assert(await waitFor(() => b.last().state.modeId === 'peak' && b.last().state.members[b.client.instanceId].ready), 'select + ready');

    a.client.sendParty('start');
    assert(await waitFor(() => b.last().state.phase === 'countdown'), 'countdown reaches B');
    assert(b.last().state.startAt === wall + PARTY_COUNTDOWN_MS && b.last().info.offset === 0, 'shared start time');
    wall += PARTY_COUNTDOWN_MS;
    assert(await waitFor(() => b.last().state.phase === 'racing', 1500), 'the host tab ticks to racing');

    a.client.sendParty('finish', { time: 112.5, score: 0 });
    b.client.sendParty('finish', { time: 118.25, score: 0 });
    assert(await waitFor(() => b.last().state.phase === 'results'), 'results');
    const members = b.last().state.members;
    assert(members[a.client.instanceId].time === 112.5 && members[b.client.instanceId].time === 118.25, 'times');

    // A third tab joins; the host leaves; B (next in line) takes over as the authority.
    c.client.join('party.K7QXM');
    assert(await waitFor(() => c.last()?.state?.members?.[c.client.instanceId]), 'C joined');
    a.client.leave();
    assert(await waitFor(() => c.last().state.hostId === b.client.instanceId), 'host hand-over');
    b.client.sendParty('rematch');
    assert(await waitFor(() => c.last().state.phase === 'lobby' && c.last().state.round === 2), 'new host runs the party');
  } finally {
    a.client.dispose();
    b.client.dispose();
    c.client.dispose();
  }
});

test('local mode: joining a party nobody hosts fails', async () => {
  if (typeof BroadcastChannel === 'undefined') return;
  const client = new NetClient({ profile: { id: 'lonely-profile', name: 'Lonely' } });
  let last = null;
  client.onParty((state, info) => { last = { state, info }; });
  client.join('party.ZZZZZ');
  assert(await waitFor(() => last?.info?.fatal, 2500), 'gives up');
  assert(last.info.error === 'not-found' && last.state === null, JSON.stringify(last));
  client.dispose();
});

// ------------------------------------------------------------------ parties (server authority)

function fakeStorage() {
  const data = new Map();
  return {
    data,
    alarm: 0,
    async get(key) { return data.has(key) ? structuredClone(data.get(key)) : undefined; },
    async put(key, value) { data.set(key, structuredClone(value)); },
    async delete(key) { return data.delete(key); },
    async setAlarm(at) { this.alarm = at; },
    async deleteAlarm() { this.alarm = 0; },
  };
}

test('server party host: create/join refusals, ops, alarms, persistence, migration', async () => {
  let now = 1_800_000_000_000;
  const storage = fakeStorage();
  const host = new PartyHost({ roomName: 'party.K7QXM', storage, now: () => now });
  const profile = (name, peer) => ({ name, level: 5, paint: 'acid', peer });

  assert((await host.connect('a#1', profile('Alice', 0), { intent: 'join' })).error === 'not-found', 'join before create');
  assert((await host.connect('a#1', profile('Alice', 0), { intent: 'create', mapId: 'moon' })).error === 'bad-map', 'bad map');
  const created = await host.connect('a#1', profile('Alice', 0), { intent: 'create', mapId: 'alpine', modeId: 'climb' });
  assert(!created.error && created.state.hostId === 'a#1' && created.state.modeId === 'climb', JSON.stringify(created));
  assert((await host.connect('x#9', profile('Xavier', 5), { intent: 'create', mapId: 'alpine' })).error === 'exists', 'code taken');
  const joined = await host.connect('b#2', profile('Bob', 1), { intent: 'join' });
  assert(!joined.error && joined.state.members['b#2'].peer === 1, 'B joined with its sender index');
  assert(storage.data.get('party').members['b#2'], 'persisted');

  const refused = await host.message('b#2', { t: 'party', op: 'start' });
  assert(refused.error === 'not-host' && !refused.changed, 'not host');
  assert((await host.message('b#2', { t: 'party', op: 'teleport' })).error === 'bad-input', 'unknown op');
  assert(!(await host.message('b#2', { t: 'party', op: 'sync' })).error, 'sync is fine');
  assert((await host.message('b#2', { t: 'party', op: 'ready', ready: true })).changed, 'ready');
  const started = await host.message('a#1', { t: 'party', op: 'start' });
  assert(started.changed && started.state.phase === 'countdown' && storage.alarm === now + PARTY_COUNTDOWN_MS, `alarm ${storage.alarm - now}`);

  // Hibernation: a fresh host object on the same storage carries on.
  const woken = new PartyHost({ roomName: 'party.K7QXM', storage, now: () => now });
  now += PARTY_COUNTDOWN_MS;
  // A Durable Object alarm is consumed when it fires.
  const fire = (target) => { storage.alarm = 0; return target.alarm(); };
  const fired = await fire(woken);
  assert(fired.changed && fired.state.phase === 'racing' && storage.alarm === fired.state.raceDeadline, 'alarm: racing, cap scheduled');
  await woken.message('a#1', { t: 'party', op: 'finish', time: 104.2, score: 0 });
  assert(storage.alarm === now + PARTY_FINISH_GRACE_MS, 'grace alarm');
  now += PARTY_FINISH_GRACE_MS;
  const late = await fire(woken);
  assert(late.state.phase === 'results' && late.state.members['b#2'].dnf && storage.alarm === 0, 'deadline DNF');

  // The host leaves: B hosts. Stale members are pruned. The last one out deletes the party.
  const left = await woken.disconnect('a#1');
  assert(left.changed && left.state.hostId === 'b#2', 'migration');
  await woken.connect('c#3', profile('Cara', 2), { intent: 'join' });
  const pruned = await woken.prune(['c#3']);
  assert(pruned.changed && pruned.state.hostId === 'c#3' && !pruned.state.members['b#2'], 'pruned');
  await woken.disconnect('c#3');
  assert(woken.state === null && !storage.data.has('party'), 'empty party deleted');
  assert((await woken.connect('d#4', profile('Dee', 0), { intent: 'join' })).error === 'not-found', 'gone');
  assert(new PartyHost({ roomName: 'mountain', storage }).code === null, 'not a party room');
});

test('server party host: map-switch grace preserves room across simultaneous reloads and serializes writes', async () => {
  let now = 1_800_000_000_000;
  const storage = fakeStorage();
  const host = new PartyHost({ roomName: 'party.M4PSW', storage, now: () => now });
  const profile = (name, peer, car = 'hatch') => ({ name, level: 3, paint: 'ember', car, peer });

  const created = await host.connect('a#1', profile('Alice', 0, 'gt'), { intent: 'create', mapId: 'mussoorie', modeId: 'sprint' });
  assert(!created.error && created.state.mapId === 'mussoorie', 'created');
  await host.connect('b#2', profile('Bob', 1, 'tokyo'), { intent: 'join' });

  // Host switches map: room stays alive through simultaneous reload disconnects inside grace window.
  const switched = await host.message('a#1', { t: 'party', op: 'select', mapId: 'tokyo', modeId: 'sprint' });
  assert(switched.changed && switched.state.mapId === 'tokyo' && host.rejoinUntil === now + MAP_SWITCH_GRACE_MS, 'switched map + grace set');
  await host.disconnect('a#1');
  await host.disconnect('b#2');
  assert(host.state !== null && storage.data.has('party') && storage.alarm === host.rejoinUntil, 'empty party preserved during map-switch grace');

  // Reconnect after hibernation inside the grace window succeeds (both create/join).
  now += 5_000;
  const woken = new PartyHost({ roomName: 'party.M4PSW', storage, now: () => now });
  const [reHost, rePeer] = await Promise.all([
    woken.connect('a#3', profile('Alice', 0, 'gt'), { intent: 'create', mapId: 'tokyo', modeId: 'sprint' }),
    woken.connect('b#4', profile('Bob', 1, 'tokyo'), { intent: 'join' }),
  ]);
  assert(!reHost.error && !rePeer.error && Object.keys(woken.state.members).length === 2, 'concurrent reconnects serialized cleanly');

  // Expired grace with no connected members cleans up on alarm().
  await woken.message('a#3', { t: 'party', op: 'select', mapId: 'apex', modeId: 'sprint' });
  await woken.disconnect('a#3');
  await woken.disconnect('b#4');
  now += MAP_SWITCH_GRACE_MS;
  storage.alarm = 0;
  await woken.alarm();
  assert(woken.state === null && !storage.data.has('party'), 'expired empty map-switch party deleted');
});

// ------------------------------------------------------------------ leaderboard (local)

test('Leaderboard local: time ascending, score descending, best per player', async () => {
  memoryStore.clear();
  const runs = [
    ['p-aaaaaaaa1', 'Alice', 170.5], ['p-bbbbbbbb2', 'Bob', 165.25], ['p-aaaaaaaa1', 'Alice', 160.0],
    ['p-cccccccc3', 'Cara', 199], ['p-bbbbbbbb2', 'Bob', 180], ['p-aaaaaaaa1', 'Alice', 175],
  ];
  let last;
  for (const [id, name, time] of runs) {
    const board = new Leaderboard({ host: '', profile: { id, name, level: 2 } });
    last = await board.submit('sprint', { modeId: 'sprint', time, score: 0 }, 'ghost-for-' + id);
  }
  assert(last.status === 'local' && last.accepted && !last.improved && last.rank === 1, `last ${JSON.stringify(last)}`);
  const alice = new Leaderboard({ host: '', profile: { id: 'p-aaaaaaaa1', name: 'Alice' } });
  const { status, entries } = await alice.top('sprint', 50);
  assert(status === 'local', status);
  assert(entries.map((e) => e.name).join(',') === 'Alice,Bob,Cara', entries.map((e) => e.name).join(','));
  assert(entries[0].time === 160 && entries[1].time === 165.25, 'best per player');
  assert(entries[0].isMe && !entries[1].isMe && entries[0].rank === 1 && entries[2].rank === 3, 'rank / isMe');
  assert(entries.every((e) => e.score === null && e.hasGhost), 'timed rows');
  assert((await alice.ghost('sprint', 'p-aaaaaaaa1')) === 'ghost-for-p-aaaaaaaa1', 'local ghost');

  for (const [id, score] of [['p-aaaaaaaa1', 4000], ['p-bbbbbbbb2', 9000], ['p-aaaaaaaa1', 12000], ['p-bbbbbbbb2', 100]]) {
    await new Leaderboard({ profile: { id, name: id.slice(2, 6) } }).submit('drift', { modeId: 'drift', time: 120, score });
  }
  const drift = (await alice.top('drift')).entries;
  assert(drift.map((e) => e.score).join(',') === '12000,9000', drift.map((e) => e.score).join(','));
  assert(drift.every((e) => e.time === null), 'score rows');
  const roam = await alice.submit('roam', { time: 10 });
  assert(!roam.accepted && roam.reason === 'unranked-mode', 'roam unranked');
  // Pure ranking helper: ties broken by who set it first.
  const ranked = rankEntries([{ playerId: 'x', time: 10, at: 2 }, { playerId: 'y', time: 10, at: 1 }], 'time');
  assert(ranked[0].playerId === 'y', 'tie break');
});

test('Leaderboard: unreachable host falls back to local', async () => {
  const board = new Leaderboard({ host: 'http://127.0.0.1:9', profile: { id: 'p-aaaaaaaa1', name: 'Alice' } });
  const top = await board.top('sprint', 10);
  assert(top.status === 'local' && top.entries.length === 3, `fallback ${top.status} ${top.entries.length}`);
  const result = await board.submit('sprint', { time: 150 }, null);
  assert(result.status === 'local' && result.accepted && result.reason === 'offline', JSON.stringify(result));
});

test('Leaderboard local: each map\'s track is its own board', async () => {
  memoryStore.clear();
  const board = new Leaderboard({ host: '', profile: { id: 'p-aaaaaaaa1', name: 'Alice' } });
  await board.submit('sprint', { time: 170, score: 0 }, 'alpine-ghost');
  const hills = await board.submit('mussoorie.sprint', { time: 95, score: 0 }, 'hills-ghost');
  assert(hills.accepted && hills.rank === 1, JSON.stringify(hills));
  assert((await board.top('sprint')).entries.map((e) => e.time).join(',') === '170', 'alpine board untouched');
  assert((await board.top('mussoorie.sprint')).entries.map((e) => e.time).join(',') === '95', 'mussoorie board');
  assert((await board.ghost('mussoorie.sprint', 'p-aaaaaaaa1')) === 'hills-ghost', 'mussoorie ghost');
  assert(!(await board.submit('mussoorie.roam', { time: 10 })).accepted, 'map roam unranked');
});

test('MetaLayer: rooms, leaderboards and submissions use the map\'s track keys', async () => {
  memoryStore.clear();
  const make = (mapId) => {
    const calls = { join: [], setMode: [], top: [], submit: [] };
    const hud = new Proxy({ setMap(id) { calls.hudMap = id; } }, { get: (target, key) => (key in target ? target[key] : () => {}), set: (target, key, value) => { target[key] = value; return true; } });
    const career = {
      profile: { id: 'p-aaaaaaaa1', name: 'Alice', cosmetics: { paint: 'pearl', rim: 'silver', number: '27' } },
      level: 1, run: null,
      levelInfo: () => ({ level: 1 }),
      setMap(id) { calls.careerMap = id; },
    };
    const net = {
      mode: 'local', status: 'connected', modeId: null, peers: new Map(),
      onStatus() {}, onRoster() {}, online: async () => ({ total: 1 }),
      join(id) { this.modeId = id; calls.join.push(id); },
      setMode(id) { calls.setMode.push(id); },
    };
    const leaderboard = {
      top: async (key) => { calls.top.push(key); return { status: 'local', entries: [] }; },
      submit: async (key) => { calls.submit.push(key); return { accepted: true, status: 'local' }; },
    };
    const meta = new MetaLayer({ career, hud, scene: null, wheelLayout: [], game: { records: {}, state: 'menu' }, mapId });
    meta.attachNetwork({ leaderboard, net });
    clearInterval(meta.onlineTimer);
    return { meta, calls };
  };
  const alpine = make('alpine');
  alpine.meta.joinRoom('climb');
  await alpine.meta.loadLeaderboard('climb');
  assert(alpine.calls.join.join(',') === 'mountain' && alpine.calls.top.join(',') === 'climb', `alpine ${JSON.stringify(alpine.calls)}`);
  const hills = make('mussoorie');
  hills.meta.joinRoom('climb');
  await hills.meta.loadLeaderboard('climb');
  await hills.meta.submit('climb', { time: 70 }, { version: 1, modeId: 'mussoorie.climb', name: 'Alice', time: 70, score: 0, rate: 10, count: 2,
    positions: new Float32Array(6), rotations: new Int16Array([0, 0, 0, 32767, 0, 0, 0, 32767]), steer: new Int8Array(2), paint: 'pearl' });
  assert(hills.calls.join.join(',') === 'mussoorie.mountain', `lobby ${hills.calls.join}`);
  assert(hills.calls.setMode.at(-1) === 'climb', 'presence keeps the plain mode id for labels');
  assert(hills.calls.top.join(',') === 'mussoorie.climb' && hills.calls.submit.join(',') === 'mussoorie.climb', JSON.stringify(hills.calls));
  assert(hills.calls.careerMap === 'mussoorie' && hills.calls.hudMap === 'mussoorie', 'map passed to career and hud');
  assert(hills.meta.roomLabel() === 'Summit Climb', 'friendly label');
  alpine.meta.dispose();
  hills.meta.dispose();
});

// ------------------------------------------------------------------ server validation

function makeGhost(modeId, seconds, rate = 10) {
  const count = Math.round(seconds * rate) + 1;
  const positions = new Float32Array(count * 3);
  const rotations = new Int16Array(count * 4);
  const steer = new Int8Array(count);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = i * 2;
    rotations[i * 4 + 3] = 32767;
  }
  return encodeGhost({ version: 1, modeId, name: 'Tester', time: seconds, score: 0, rate, count, positions, rotations, steer, paint: 'pearl' });
}

test('validate: limits from medal targets', () => {
  near(validate.limitsFor('sprint').minTime, MEDAL_TARGETS.sprint.author * 0.85, 1e-9, 'sprint min');
  near(validate.limitsFor('drift').maxScore, MEDAL_TARGETS.drift.author * 1.6, 1e-9, 'drift max');
  assert(validate.limitsFor('roam') === null && validate.limitsFor('__proto__') === null, 'unranked');
  assert(validate.ROOM_MODES.includes('roam') && !validate.RANKED_MODES.includes('roam'), 'mode lists');
  // Other maps are namespaced track keys; Alpine keeps the bare ids.
  near(validate.limitsFor('mussoorie.climb').minTime, MUSSOORIE_MEDAL_TARGETS.climb.author * 0.85, 1e-9, 'mussoorie climb min');
  assert(validate.limitsFor('mussoorie.roam') === null && validate.limitsFor('nowhere.climb') === null && validate.limitsFor(42) === null, 'unknown tracks');
  for (const room of ['mountain', 'sprint', 'mussoorie.mountain', 'mussoorie.sprint', 'mussoorie.roam']) assert(validate.ROOM_MODES.includes(room), `room ${room}`);
  assert(validate.RANKED_MODES.includes('mussoorie.drift') && !validate.RANKED_MODES.includes('mussoorie.roam'), 'ranked map tracks');
  assert(validate.ROOM_MODES.every((room) => /^[a-z0-9.-]+$/.test(room)), 'room names are URL-safe');
  // The Nag Tibba events exist on Mussoorie only, and are ranked from their (provisional) medal targets.
  for (const key of ['mussoorie.peak', 'mussoorie.peakdown']) {
    assert(validate.RANKED_MODES.includes(key) && validate.ROOM_MODES.includes(key), `ranked ${key}`);
    near(validate.limitsFor(key).minTime, MUSSOORIE_MEDAL_TARGETS[key.split('.')[1]].author * 0.85, 1e-9, `${key} min`);
  }
  assert(!validate.RANKED_MODES.includes('peak') && !validate.ROOM_MODES.includes('peak') && validate.limitsFor('peakdown') === null, 'no Nag Tibba on Alpine');
});

test('validate: names, ids, cosmetics, origins', () => {
  assert(validate.sanitizeName('  Harsh ') === 'Harsh', 'trim');
  assert(validate.sanitizeName('Zoë_99') === 'Zoë_99', 'unicode');
  for (const bad of ['a', 'x'.repeat(17), '<script>', 'two  spaces', '', null, 42, 'drop;table']) {
    assert(validate.sanitizeName(bad) === null, `bad name ${bad}`);
  }
  assert(validate.isValidPlayerId(crypto.randomUUID()) && !validate.isValidPlayerId('short') && !validate.isValidPlayerId('a b c d e f g h'), 'ids');
  assert(validate.sanitizeCosmetic('racing-green') === 'racing-green' && validate.sanitizeCosmetic('<b>') === '', 'paint');
  assert(validate.sanitizeCosmetic('27', 'number') === '27' && validate.sanitizeCosmetic('123', 'number') === '', 'number');
  const list = 'http://localhost:5173,https://slop-drift.vercel.app,https://slop-drift-*.vercel.app';
  assert(validate.originAllowed('http://localhost:5173', list), 'dev');
  assert(validate.originAllowed('https://slop-drift-git-main-abc.vercel.app', list), 'preview wildcard');
  assert(!validate.originAllowed('https://slop-drift-x.vercel.app.evil.com', list), 'suffix attack');
  assert(!validate.originAllowed('https://evil.vercel.app', list) && !validate.originAllowed(null, list), 'others');

  const cgList = 'https://*.game-files.crazygames.com,https://*.crazygames.com,https://crazygames.com,http://localhost:*,http://[::1]:*';
  assert(validate.originAllowed('https://12345.prod.game-files.crazygames.com', cgList), 'nested CrazyGames subdomain');
  assert(validate.originAllowed('https://games.crazygames.com', cgList) && validate.originAllowed('https://crazygames.com', cgList), 'CrazyGames root + subdomain');
  assert(validate.originAllowed('http://localhost:4173', cgList) && validate.originAllowed('http://[::1]:5173', cgList), 'localhost + IPv6 loopback ports');
  assert(!validate.originAllowed('http://localhost:80a', cgList) && !validate.originAllowed('https://evil.com/game-files.crazygames.com', cgList), 'reject malformed port/path');
  assert(!validate.originAllowed('https://a..b.game-files.crazygames.com', cgList), 'reject empty label');
});

test('validate: all 7 maps are playable in primary lobbies, ranked rooms, and party modes', () => {
  const mapIds = Object.keys(MAPS);
  assert(mapIds.length === 7, `expected 7 maps, got ${mapIds.length}`);
  assert(validate.PRIMARY_ROOMS.length === mapIds.length, `PRIMARY_ROOMS ${validate.PRIMARY_ROOMS.length} vs ${mapIds.length}`);
  for (const mapId of mapIds) {
    assert(validate.PRIMARY_ROOMS.includes(trackKey(mapId, 'mountain')), `missing primary room for ${mapId}`);
    assert(validate.ROOM_MODES.includes(trackKey(mapId, 'roam')), `missing roam room for ${mapId}`);
    const modes = partyModes(mapId);
    assert(modes.length >= 1, `no party modes for ${mapId}`);
    for (const modeId of modes) {
      const room = trackKey(mapId, modeId);
      assert(validate.ROOM_MODES.includes(room), `party mode room missing: ${room}`);
    }
  }
});

test('validate: HMAC tokens', async () => {
  const secret = 'test-secret-0123456789abcdef';
  const id = 'player-12345678';
  const token = await validate.signToken(secret, id);
  assert(/^[A-Za-z0-9_-]{43}$/.test(token), `token shape ${token}`);
  assert(await validate.verifyToken(secret, id, token), 'valid');
  assert(!(await validate.verifyToken(secret, 'player-87654321', token)), 'other id');
  assert(!(await validate.verifyToken('another-secret-0123456789', id, token)), 'other secret');
  assert(!(await validate.verifyToken(secret, id, token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A'))), 'tampered');
});

test('validate: ghost header agrees with src/ghost/ghostCodec.js', () => {
  const ghost = makeGhost('climb', 100.4);
  const header = validate.decodeGhostHeader(ghost);
  assert(header && header.modeId === 'climb' && header.rate === 10 && header.count === 1005, JSON.stringify(header));
  near(header.duration, 100.4, 1e-9, 'duration');
  near(header.time, 100.4, 1e-9, 'time');
  assert(validate.decodeGhostHeader('not a ghost at all, just some text here') === null, 'garbage');
  assert(validate.decodeGhostHeader(btoa('XX' + 'a'.repeat(60))) === null, 'magic');
  console.log(`    ghost for a 100 s run at 10 Hz: ${ghost.length} chars`);
});

test('validate: submissions', () => {
  const base = { modeId: 'sprint', playerId: 'player-12345678', name: 'Tester', level: 7 };
  const min = validate.limitsFor('sprint').minTime;
  const ok = validate.validateSubmission({ ...base, time: 160.2, ghost: makeGhost('sprint', 160.2) });
  assert(ok.ok && ok.entry.time === 160.2 && ok.entry.score === null && ok.entry.level === 7, JSON.stringify(ok));
  const reasons = [
    [{ ...base, modeId: 'roam', time: 160 }, 'unknown-mode'],
    [{ ...base, name: 'x', time: 160, ghost: makeGhost('sprint', 160) }, 'bad-name'],
    [{ ...base, time: min - 1, ghost: makeGhost('sprint', min - 1) }, 'implausible-time'],
    [{ ...base, time: Infinity }, 'bad-time'],
    [{ ...base, time: '160' }, 'bad-time'],
    [{ ...base, time: 160 }, 'ghost-required'],
    [{ ...base, time: 160, ghost: makeGhost('sprint', 158) }, 'ghost-time-mismatch'],
    [{ ...base, time: 160, ghost: makeGhost('climb', 160) }, 'ghost-mode-mismatch'],
    [{ ...base, time: 160, ghost: 'A'.repeat(validate.MAX_GHOST_CHARS + 1) }, 'ghost-too-large'],
    [{ ...base, time: 160, ghost: 'A'.repeat(200) }, 'bad-ghost'],
    [{ ...base, modeId: 'drift', score: MEDAL_TARGETS.drift.author * 1.6 + 1 }, 'implausible-score'],
    [{ ...base, modeId: 'drift', score: -5 }, 'bad-score'],
    [{ ...base, playerId: '../etc' , time: 160 }, 'bad-player'],
  ];
  for (const [body, reason] of reasons) {
    const result = validate.validateSubmission(body);
    assert(!result.ok && result.reason === reason, `${reason}: got ${JSON.stringify(result)}`);
  }
  const inside = validate.validateSubmission({ ...base, time: 160, ghost: makeGhost('sprint', 161.4) });
  assert(inside.ok, 'within 1.5 s tolerance');
  const drift = validate.validateSubmission({ ...base, modeId: 'drift', score: 8123.6 });
  assert(drift.ok && drift.entry.score === 8124 && drift.entry.time === null, 'drift without ghost');

  // Namespaced map tracks: the ghost must carry the same track key.
  const hills = { ...base, modeId: 'mussoorie.climb' };
  const hillsOk = validate.validateSubmission({ ...hills, time: 72.3, ghost: makeGhost('mussoorie.climb', 72.3) });
  assert(hillsOk.ok && hillsOk.entry.modeId === 'mussoorie.climb', JSON.stringify(hillsOk));
  const alpineGhost = validate.validateSubmission({ ...hills, time: 72.3, ghost: makeGhost('climb', 72.3) });
  assert(!alpineGhost.ok && alpineGhost.reason === 'ghost-mode-mismatch', 'alpine ghost on a mussoorie board');
  // 72 s is a Mussoorie silver but impossibly fast on the Alpine climb.
  const crossMap = validate.validateSubmission({ ...base, modeId: 'climb', time: 72.3, ghost: makeGhost('climb', 72.3) });
  assert(!crossMap.ok && crossMap.reason === 'implausible-time', 'limits are per track');
});

// ------------------------------------------------------------------ live server (optional)

const LIVE = process.env.NET_LIVE;
const ORIGIN = 'http://localhost:5173';

async function api(path, body, origin = ORIGIN) {
  const response = await fetch(`${LIVE}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json().catch(() => null), headers: response.headers };
}

function openSocket(modeId, params, origin = ORIGIN) {
  return new Promise((resolve) => {
    const query = new URLSearchParams(params).toString();
    const ws = new WebSocket(`${LIVE.replace(/^http/, 'ws')}/parties/room/${modeId}?${query}`, origin ? { headers: { Origin: origin } } : undefined);
    ws.binaryType = 'arraybuffer';
    const socket = { ws, text: [], binary: [], closed: null, opened: false };
    ws.onopen = () => { socket.opened = true; resolve(socket); };
    ws.onmessage = (event) => (typeof event.data === 'string' ? socket.text.push(JSON.parse(event.data)) : socket.binary.push(new Uint8Array(event.data)));
    ws.onclose = (event) => { socket.closed = event.code; resolve(socket); };
    ws.onerror = () => {};
  });
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (LIVE) {
  const run = Date.now().toString(36);
  const idA = `live-a-${run}`;
  const idB = `live-b-${run}`;
  const idC = `live-c-${run}`;
  let tokenA;
  let tokenB;

  test('live: register, duplicate claim, CORS', async () => {
    const a = await api('/api/register', { playerId: idA, name: 'Live A' });
    assert(a.status === 200 && a.data.token, `register ${a.status}`);
    tokenA = a.data.token;
    tokenB = (await api('/api/register', { playerId: idB, name: 'Live B' })).data.token;
    const again = await api('/api/register', { playerId: idA, name: 'Thief' });
    assert(again.status === 409, `second claim ${again.status}`);
    assert(a.headers.get('access-control-allow-origin') === ORIGIN, 'cors header');
    const evil = await api('/api/register', { playerId: idC, name: 'Evil' }, 'https://evil.example');
    assert(evil.status === 403, `foreign origin ${evil.status}`);
  });

  test('live: room roster, relay with sender index, join/leave deltas, rejections', async () => {
    const params = (id, token, name) => ({ playerId: id, name, level: '4', paint: 'ember', rim: 'gold', number: '27', token });
    const noOrigin = await openSocket('roam', params(idA, tokenA, 'Live A'), null);
    assert(!noOrigin.opened, 'socket without Origin refused');
    const badToken = await openSocket('roam', params(idA, tokenB, 'Live A'));
    assert(!badToken.opened, 'socket with wrong token refused');
    const badRoom = await openSocket('nowhere', params(idA, tokenA, 'Live A'));
    assert(!badRoom.opened, 'unknown room refused');

    const a = await openSocket('roam', params(idA, tokenA, 'Live A'));
    assert(a.opened, 'A connects');
    await wait(150);
    const rosterA = a.text.find((m) => m.t === 'roster');
    assert(rosterA && rosterA.peers.length === 0, `A roster ${JSON.stringify(a.text)}`);
    const b = await openSocket('roam', params(idB, tokenB, 'Live B'));
    await wait(200);
    const rosterB = b.text.find((m) => m.t === 'roster');
    assert(rosterB && rosterB.peers.length === 1 && rosterB.peers[0].id === idA && rosterB.peers[0].paint === 'ember', `B roster ${JSON.stringify(rosterB)}`);
    const join = a.text.find((m) => m.t === 'join');
    assert(join && join.peer.id === idB && join.peer.i === rosterB.you, `A saw join ${JSON.stringify(a.text)}`);

    // A sends 3 packets; B receives them prefixed with A's index.
    for (let i = 0; i < 3; i += 1) {
      a.ws.send(packet(carAt(i), FLAG_DRIFTING, i * 166));
      await wait(70);
    }
    await wait(200);
    assert(b.binary.length === 3 && a.binary.length === 0, `relay counts B=${b.binary.length} A=${a.binary.length}`);
    assert(b.binary[0].length === RELAY_SIZE && b.binary[0][0] === rosterA.you, 'sender index prefix');
    const out = createSnapshot();
    decodeState(new DataView(b.binary[2].buffer), 1, out);
    near(out.x, carAt(2).position.x, 1e-3, 'relayed x');

    // Profile update reaches B.
    a.ws.send(JSON.stringify({ t: 'profile', name: 'Live A2', level: 9 }));
    await wait(150);
    const update = b.text.find((m) => m.t === 'update');
    assert(update && update.peer.name === 'Live A2' && update.peer.level === 9, 'profile update');

    // Presence count.
    const online = await api('/api/online');
    assert(online.status === 200 && typeof online.data.rooms.roam === 'number', `online ${JSON.stringify(online.data)}`);

    // Oversize packet closes the sender; B sees A leave.
    a.ws.send(new Uint8Array(200));
    await wait(300);
    assert(a.closed === 1009, `oversize close ${a.closed}`);
    const leave = b.text.find((m) => m.t === 'leave');
    assert(leave && leave.i === rosterA.you, `leave ${JSON.stringify(b.text)}`);

    // Flooding (> 15 Hz sustained) gets B dropped.
    const flood = b.ws;
    for (let i = 0; i < 80 && b.closed === null; i += 1) {
      flood.send(packet(carAt(i), 0, i * 10));
      await wait(10);
    }
    await wait(300);
    assert(b.closed === 4008, `flood close ${b.closed}`);
  });

  test('live: room cap of 16', async () => {
    const sockets = [];
    for (let i = 0; i < 17; i += 1) {
      const id = `live-cap-${run}-${i}`;
      const token = (await api('/api/register', { playerId: id, name: `Cap ${i}` })).data.token;
      sockets.push(await openSocket('descent', { playerId: id, name: `Cap ${i}`, level: '1', token }));
      await wait(30);
    }
    await wait(800);
    // The 17th is told the room is full (the room's own close frame follows 500 ms later; wrangler dev
    // does not always deliver it, which is why clients close themselves on 'full').
    assert(sockets.slice(0, 16).every((s) => s.text[0]?.t === 'roster' && s.closed === null), 'first 16 admitted');
    assert(sockets[16].text[0]?.t === 'full' && !sockets[16].text.some((m) => m.t === 'roster'), 'the 17th is refused');
    // A NetClient arriving at a full room reports it and backs off instead of hammering.
    const NativeWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = class extends NativeWebSocket {
      constructor(url) {
        super(url, { headers: { Origin: ORIGIN } });
      }
    };
    const late = new NetClient({ host: LIVE, profile: { id: `live-cap-late-${run}`, name: 'Late' } });
    late.join('descent');
    for (let i = 0; i < 40 && late.error !== 'room-full'; i += 1) await wait(50);
    globalThis.WebSocket = NativeWebSocket;
    assert(late.error === 'room-full' && late.status === 'disconnected', `late client ${late.status} ${late.error}`);
    late.dispose();
    for (const s of sockets) s.ws.close();
  });

  test('live: party room create, join, start countdown, refusals', async () => {
    const code = Array.from({ length: 5 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 31)]).join('');
    const params = (id, token, name, extra) => ({ playerId: id, name, level: '4', token, instance: `${id}#live`, ...extra });
    const missing = await openSocket(`party.${code}`, params(idA, tokenA, 'Live A', { party: 'join' }));
    await wait(200);
    assert(missing.text.some((m) => m.t === 'party' && m.error === 'not-found'), `unknown party ${JSON.stringify(missing.text)}`);
    missing.ws.close();
    const a = await openSocket(`party.${code}`, params(idA, tokenA, 'Live A', { party: 'create', partyMap: 'alpine', partyMode: 'climb' }));
    await wait(200);
    const created = a.text.find((m) => m.t === 'party' && m.state);
    assert(created && created.state.hostId === `${idA}#live` && created.you === `${idA}#live` && Number.isFinite(created.now), JSON.stringify(a.text));
    const b = await openSocket(`party.${code}`, params(idB, tokenB, 'Live B', { party: 'join' }));
    await wait(200);
    const seen = b.text.filter((m) => m.t === 'party' && m.state).at(-1);
    assert(seen && Object.keys(seen.state.members).length === 2 && seen.you === `${idB}#live`, JSON.stringify(b.text));
    b.ws.send(JSON.stringify({ t: 'party', op: 'start' }));
    await wait(200);
    assert(b.text.some((m) => m.t === 'party' && m.error === 'not-host'), 'only the host starts');
    a.ws.send(JSON.stringify({ t: 'party', op: 'start' }));
    await wait(300);
    const countdown = b.text.filter((m) => m.t === 'party' && m.state).at(-1);
    assert(countdown.state.phase === 'countdown' && countdown.state.startAt - countdown.now > 4000, JSON.stringify(countdown));
    await wait(5500);
    const racing = b.text.filter((m) => m.t === 'party' && m.state).at(-1);
    assert(racing.state.phase === 'racing', `alarm moved the party on: ${racing.state.phase}`);
    a.ws.close();
    await wait(300);
    const handed = b.text.filter((m) => m.t === 'party' && m.state).at(-1);
    assert(handed.state.hostId === `${idB}#live`, 'host hand-over');
    b.ws.close();
  });

  test('live: NetClient party over a real socket (create, join, start, unknown code)', async () => {
    const NativeWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = class extends NativeWebSocket {
      constructor(url) {
        super(url, { headers: { Origin: ORIGIN } });
      }
    };
    const clients = [];
    try {
      const make = (suffix, name) => {
        const client = new NetClient({ host: LIVE, profile: { id: `live-party-${suffix}-${run}`, name, level: 3 } });
        const seen = [];
        client.onParty((state, info) => seen.push({ state, info }));
        clients.push(client);
        return { client, seen, last: () => seen.at(-1) };
      };
      const code = Array.from({ length: 5 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 31)]).join('');
      const a = make('a', 'Party A');
      const b = make('b', 'Party B');
      a.client.join(`party.${code}`, { party: { intent: 'create', mapId: 'mussoorie', modeId: 'peak' } });
      for (let i = 0; i < 60 && !a.last()?.state; i += 1) await wait(50);
      assert(a.last()?.state?.hostId === a.client.instanceId && a.last().state.modeId === 'peak', `A ${JSON.stringify(a.last())}`);
      b.client.join(`party.${code}`);
      for (let i = 0; i < 60 && !b.last()?.state?.members?.[b.client.instanceId]; i += 1) await wait(50);
      assert(b.last().info.you === b.client.instanceId, 'B member');
      for (let i = 0; i < 40 && !b.client.partyPeerKey(a.client.instanceId); i += 1) await wait(50);
      assert(b.client.partyPeerKey(a.client.instanceId) === `live-party-a-${run}`, `peer key ${b.client.partyPeerKey(a.client.instanceId)}`);
      a.client.sendParty('start');
      for (let i = 0; i < 40 && b.last().state.phase !== 'countdown'; i += 1) await wait(50);
      assert(b.last().state.phase === 'countdown' && Math.abs(b.last().info.offset) < 2000, `countdown offset ${b.last().info.offset}`);
      const lost = make('c', 'Party C');
      lost.client.join('party.ZZZZZ');
      for (let i = 0; i < 60 && !lost.last()?.info?.fatal; i += 1) await wait(50);
      assert(lost.last()?.info?.error === 'not-found' && lost.client.error === 'party-not-found', `lost ${JSON.stringify(lost.last())} ${lost.client.error}`);
      await wait(1500);
      assert(lost.client.status === 'disconnected', 'no retry after not-found');
    } finally {
      for (const client of clients) client.dispose();
      globalThis.WebSocket = NativeWebSocket;
    }
  });

  test('live: score submission, validation, rate limit, best only, top, ghost', async () => {
    const min = validate.limitsFor('climb').minTime;
    const submit = (extra) => api('/api/score', { modeId: 'climb', playerId: idA, token: tokenA, name: 'Live A', level: 4, ...extra });
    const forged = await api('/api/score', { modeId: 'climb', playerId: idA, token: tokenB, name: 'Live A', time: 120, ghost: makeGhost('climb', 120) });
    assert(forged.status === 401 && forged.data.reason === 'bad-token', `forged ${JSON.stringify(forged.data)}`);
    const tooFast = await submit({ time: min - 2, ghost: makeGhost('climb', min - 2) });
    assert(tooFast.status === 400 && tooFast.data.reason === 'implausible-time', 'too fast');
    const noGhost = await submit({ time: 120 });
    assert(noGhost.data.reason === 'ghost-required', 'ghost required');
    const mismatch = await submit({ time: 120, ghost: makeGhost('climb', 110) });
    assert(mismatch.data.reason === 'ghost-time-mismatch', 'ghost mismatch');
    const first = await submit({ time: 120.5, ghost: makeGhost('climb', 120.5) });
    assert(first.status === 200 && first.data.accepted && first.data.improved && first.data.rank >= 1, `first ${JSON.stringify(first.data)}`);
    const tooSoon = await submit({ time: 119, ghost: makeGhost('climb', 119) });
    assert(tooSoon.status === 429 && tooSoon.data.reason === 'rate-limited', `rate ${tooSoon.status}`);
    const b = await api('/api/score', { modeId: 'climb', playerId: idB, token: tokenB, name: 'Live B', level: 2, time: 118, ghost: makeGhost('climb', 118) });
    assert(b.data.accepted && b.data.improved, 'B accepted');
    const top = await api('/api/top?mode=climb&limit=50');
    const mine = top.data.entries.filter((e) => e.playerId === idA || e.playerId === idB);
    assert(mine.length === 2 && mine[0].playerId === idB && mine[0].time === 118 && mine[1].time === 120.5 && mine[0].hasGhost, `top ${JSON.stringify(mine)}`);
    const ghost = await api(`/api/ghost?mode=climb&player=${idB}`);
    assert(ghost.data.ghost === makeGhost('climb', 118), 'ghost download');
    const drift = await api('/api/score', { modeId: 'drift', playerId: idB, token: tokenB, name: 'Live B', score: 99999 });
    assert(drift.data.reason === 'implausible-score', 'drift ceiling');
  });

  test('live: Leaderboard client online (register, submit, top, ghost)', async () => {
    const board = new Leaderboard({ host: LIVE, profile: { id: `live-lb-${run}`, name: 'Board', level: 5 } });
    const ghost = makeGhost('descent', 95.25);
    const result = await board.submit('descent', { modeId: 'descent', time: 95.25, score: 0 }, ghost);
    assert(result.status === 'online' && result.accepted && result.rank >= 1, `submit ${JSON.stringify(result)}`);
    const again = await board.submit('descent', { modeId: 'descent', time: 99 }, makeGhost('descent', 99));
    assert(again.status === 'online' && !again.accepted && again.reason === 'rate-limited', `again ${JSON.stringify(again)}`);
    const top = await board.top('descent', 50);
    const me = top.entries.find((e) => e.isMe);
    assert(top.status === 'online' && me && me.time === 95.25 && me.hasGhost && me.level === 5, `top ${JSON.stringify(me)}`);
    assert((await board.ghost('descent', `live-lb-${run}`)) === ghost, 'ghost');
  });

  test('live: NetClient over a real socket (two clients)', async () => {
    const NativeWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = class extends NativeWebSocket {
      constructor(url) {
        super(url, { headers: { Origin: ORIGIN } });
      }
    };
    try {
      const a = new NetClient({ host: LIVE, profile: { id: `live-nc-a-${run}`, name: 'Net A', level: 3, cosmetics: { paint: 'acid' } } });
      const b = new NetClient({ host: LIVE, profile: { id: `live-nc-b-${run}`, name: 'Net B', level: 6 } });
      assert(a.mode === 'online', a.mode);
      a.join('circuit');
      b.join('circuit');
      for (let i = 0; i < 40 && (a.status !== 'connected' || b.status !== 'connected' || a.peers.size < 1); i += 1) await wait(50);
      assert(a.status === 'connected' && b.status === 'connected', `status ${a.status}/${b.status} ${a.error}/${b.error}`);
      assert(a.peers.size === 1 && b.peers.size === 1, `peers ${a.peers.size}/${b.peers.size}`);
      const peerA = b.peers.get(`live-nc-a-${run}`);
      assert(peerA && peerA.paint === 'acid' && peerA.level === 3, 'peer info');
      const start = performance.now();
      let sent = 0;
      while (performance.now() - start < 2000) {
        if (a.sendState(carAt((performance.now() - start) / 1000), { braking: true })) sent += 1;
        await wait(16);
      }
      await wait(300);
      const pos = { x: 0, y: 0, z: 0 };
      const sample = b.samplePeer(peerA.id, performance.now(), pos, { x: 0, y: 0, z: 0, w: 1 });
      assert(sample && sample.braking, 'sample from live packets');
      console.log(`    live: ${sent} packets in 2 s (${(sent / 2).toFixed(1)} Hz), ${a.stats.bytesSent} bytes sent, B received ${b.stats.received}, delay ${b.peerDelay(peerA.id).toFixed(0)} ms`);
      assert(b.stats.received >= sent - 1, 'all relayed');
      const online = await b.online(); // server-cached for 15 s, so only the shape is checked
      assert(Number.isFinite(online.total) && typeof online.rooms.circuit === 'number', `online ${JSON.stringify(online)}`);
      a.dispose();
      await wait(300);
      assert(b.peers.size === 0, 'leave reached B');
      b.dispose();
    } finally {
      globalThis.WebSocket = NativeWebSocket;
    }
  });
}

test('local mode: party propagates car and paint updates across tabs', async () => {
  if (typeof BroadcastChannel === 'undefined') return;
  const make = (name, car, paint) => {
    const client = new NetClient({ profile: { id: 'same-profile-id', name, level: 2, cosmetics: { paint, car } } });
    const seen = [];
    client.onParty((state, info) => seen.push({ state, info }));
    return { client, seen, last: () => seen.at(-1) };
  };
  const a = make('Host A', 'tokyo', 'ember');
  const b = make('Guest B', 'gt', 'acid');
  try {
    a.client.join('party.M7QXP', { party: { intent: 'create', mapId: 'mussoorie', modeId: 'sprint' } });
    b.client.join('party.M7QXP');
    assert(await waitFor(() => a.client.peers.size === 1 && a.last()?.state?.members?.[b.client.instanceId]?.car === 'gt'), 'initial car sync');
    b.client.updateProfile({ name: 'Guest B2', cosmetics: { paint: 'violet', car: 'thar' } });
    assert(await waitFor(() => {
      const peer = a.client.peers.get(b.client.instanceId);
      const member = a.last()?.state?.members?.[b.client.instanceId];
      return peer?.car === 'thar' && peer?.paint === 'violet' && member?.car === 'thar' && member?.paint === 'violet' && member?.name === 'Guest B2';
    }), 'updated car + paint sync in peers and party');
  } finally {
    a.client.dispose();
    b.client.dispose();
  }
});

test('SocketTransport flushes profile/car edits made while connecting', async () => {
  memoryStore.clear();
  const prevFetch = globalThis.fetch;
  const prevWs = globalThis.WebSocket;
  const sockets = [];
  globalThis.fetch = async () => new Response(JSON.stringify({ token: 'tok-01234567890123456789' }), { status: 200 });
  class MockSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      sockets.push(this);
    }
    send(data) { this.sent.push(data); }
    close() { this.readyState = 3; }
  }
  globalThis.WebSocket = MockSocket;
  const client = new NetClient({ host: 'https://api.example.com', profile: { id: 'p-connect-race-1', name: 'Racer', level: 2, cosmetics: { car: 'hatch', paint: 'pearl' } } });
  try {
    client.join('sprint');
    await waitFor(() => sockets.length === 1);
    const sock = sockets[0];
    // Simulate changing car in garage while the WebSocket handshake is still open.
    client.updateProfile({ cosmetics: { car: 'tokyo', paint: 'ember' } });
    assert(sock.sent.length === 0, 'not sent before open');
    sock.readyState = 1;
    sock.onmessage({ data: JSON.stringify({ t: 'roster', you: 0, peers: [] }) });
    const profileMsg = sock.sent.map((raw) => JSON.parse(raw)).find((m) => m.t === 'profile');
    assert(profileMsg && profileMsg.car === 'tokyo' && profileMsg.paint === 'ember', `flushed on connect: ${JSON.stringify(sock.sent)}`);
  } finally {
    client.dispose();
    globalThis.fetch = prevFetch;
    globalThis.WebSocket = prevWs;
  }
});

test('RemotePlayers tracks wanted car id, swaps on change and handles missing/incomplete models', () => {
  const prevDoc = globalThis.document;
  const fakeCtx = () => ({
    fillStyle: '', font: '', textAlign: '', textBaseline: '',
    beginPath() {}, roundRect() {}, fill() {}, fillRect() {}, clearRect() {},
    measureText: (t) => ({ width: String(t || '').length * 10 }), fillText() {},
  });
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: fakeCtx }) };
  try {
    const scene = new THREE.Scene();
    const peers = new Map([['p1', { id: 'p1', name: 'Friend', level: 5, paint: 'ember', rim: 'silver', number: '7', neon: 'off', car: 'tokyo' }]]);
    const net = {
      peers,
      samplePeer: () => ({ steer: 0.1, speed: 12, braking: false, boosting: false, drifting: false, reversing: false }),
    };
    const remotes = new RemotePlayers({ scene, net });
    remotes.update(1 / 60, new THREE.PerspectiveCamera(), 100);
    const entry = remotes.cars.get('p1');
    assert(entry && entry.carId === 'tokyo' && entry.visualReady === false, 'fallback hatch keeps target carId and awaits model load');
    peers.get('p1').car = 'gt';
    remotes.update(1 / 60, new THREE.PerspectiveCamera(), 116);
    assert(remotes.cars.get('p1').carId === 'gt', 'rebuilt immediately when peer switches car');
    remotes.dispose();
  } finally {
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
  }
});

// ------------------------------------------------------------------ run

for (const [name, fn] of pending) {
  try {
    await fn();
    passes += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${name}\n     ${error.stack || error.message}`);
  }
}
console.log(`\n${passes} passed, ${failures} failed${LIVE ? '' : ' (set NET_LIVE=http://127.0.0.1:8787 to include live server tests)'}`);
process.exit(failures ? 1 : 0);
