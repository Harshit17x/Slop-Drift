// Tests for the party state machine (src/net/party.js) and the client-side party helpers
// (src/game/PartyRace.js: standings, results, route progress, the client flow against a fake net).
// Run: node tests/party.test.mjs   (exit code 1 on failure)

const memoryStore = new Map();
globalThis.localStorage = {
  getItem: (key) => (memoryStore.has(key) ? memoryStore.get(key) : null),
  setItem: (key, value) => memoryStore.set(key, String(value)),
  removeItem: (key) => memoryStore.delete(key),
  clear: () => memoryStore.clear(),
};

const party = await import('../src/net/party.js');
const {
  PARTY_ALPHABET, PARTY_COUNTDOWN_MS, PARTY_FINISH_GRACE_MS, PARTY_MAX_MEMBERS, PARTY_RACE_CAP_MS,
  createParty, eventFromOp, isPartyCode, memberOrder, nextDeadline, normalizePartyCode, partyCodeOfRoom,
  partyModes, partyRoomName, randomPartyCode, rankResults, reduce, step,
} = party;
const { PartyRace, RouteProgress, buildResults, buildStandings, formatRaceTime } = await import('../src/game/PartyRace.js');
const { isPartyRoom } = await import('../server/src/validate.js');

let failures = 0;
let passes = 0;
const pending = [];
function test(name, fn) {
  pending.push([name, fn]);
}
function assert(cond, message) {
  if (!cond) throw new Error(message || 'assertion failed');
}
function eq(a, b, message) {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${message || 'not equal'}: ${sa} vs ${sb}`);
}

const T0 = 1_700_000_000_000;

/** A party on `mapId` with members a, b, c... joined in order (a hosts). */
function lobby(ids = ['a', 'b', 'c'], mapId = 'mussoorie', modeId = 'sprint') {
  let state = createParty({ code: 'K7QXM', mapId, modeId });
  for (const id of ids) state = reduce(state, { type: 'join', id, name: `Driver ${id.toUpperCase()}`, level: 3, paint: 'ember', peer: id }, T0);
  return state;
}

function stepAt(state, event, now = T0) {
  return step(state, event, now);
}

function ok(result, message) {
  assert(!result.error, `${message || 'step'}: ${result.error}`);
  return result.state;
}

function refused(state, event, error, now = T0) {
  const result = step(state, event, now);
  assert(result.error === error, `${JSON.stringify(event)} -> ${result.error}, wanted ${error}`);
  assert(result.state === state, 'refused events leave the state untouched');
}

/** Started and past the countdown. */
function racing(ids = ['a', 'b', 'c'], modeId = 'sprint') {
  let state = lobby(ids, 'mussoorie', modeId);
  state = ok(stepAt(state, { type: 'start', id: ids[0] }, T0));
  return ok(stepAt(state, { type: 'tick' }, T0 + PARTY_COUNTDOWN_MS));
}

// ------------------------------------------------------------------ codes

test('codes: format, alphabet, normalisation, room names', () => {
  assert(PARTY_ALPHABET.length === 31 && !/[ILO01]/.test(PARTY_ALPHABET), 'no look-alike characters');
  let seed = 7;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 500; i += 1) assert(isPartyCode(randomPartyCode(random)), 'random codes are valid');
  assert(isPartyCode(randomPartyCode(() => 0.999999999)), 'top of the range');
  assert(isPartyCode('K7QXM') && !isPartyCode('k7qxm') && !isPartyCode('K7QX') && !isPartyCode('K7QXMM'), 'length / case');
  assert(!isPartyCode('K7QXO') && !isPartyCode('K1QXM') && !isPartyCode(null), 'excluded characters');
  assert(normalizePartyCode(' k7q-xm ') === 'K7QXM' && normalizePartyCode('nope') === '', 'normalise');
  assert(partyRoomName('K7QXM') === 'party.K7QXM' && partyRoomName('bad') === null, 'room name');
  assert(partyCodeOfRoom('party.K7QXM') === 'K7QXM' && partyCodeOfRoom('sprint') === null && partyCodeOfRoom('party.k7qxm') === null, 'code of room');
  assert(isPartyRoom('party.K7QXM') && !isPartyRoom('party.K7QX') && !isPartyRoom('party.K7QXO') && !isPartyRoom('sprint') && !isPartyRoom(7), 'server validator agrees');
});

test('modes: every ranked event of the map, never roam', () => {
  eq(partyModes('alpine'), ['sprint', 'circuit', 'climb', 'descent', 'drift'], 'alpine');
  eq(partyModes('mussoorie'), ['sprint', 'circuit', 'climb', 'descent', 'drift', 'peak', 'peakdown'], 'mussoorie');
  eq(partyModes('nowhere'), [], 'unknown map');
  assert(createParty({ code: 'K7QXM', mapId: 'alpine', modeId: 'peak' }).modeId === 'sprint', 'unknown mode falls back');
  assert(createParty({ code: 'bad', mapId: 'alpine' }) === null && createParty({ code: 'K7QXM', mapId: 'moon' }) === null, 'bad create');
});

// ------------------------------------------------------------------ membership

test('join: first member hosts, join order, rejoin keeps place, names sanitised', () => {
  let state = lobby(['a', 'b']);
  assert(state.hostId === 'a', 'creator hosts');
  eq(memberOrder(state), ['a', 'b'], 'order');
  state = reduce(state, { type: 'join', id: 'c', name: '  <script>  ', level: 'x', paint: 'NOT A PAINT' }, T0);
  const c = state.members.c;
  assert(c.name === 'Driver' && c.level === 1 && c.paint === '', `sanitised ${JSON.stringify(c)}`);
  state = reduce(state, { type: 'join', id: 'a', name: 'Renamed', level: 9 }, T0);
  assert(state.members.a.name === 'Renamed' && state.members.a.seq === 0 && state.hostId === 'a', 'rejoin refreshes in place');
  refused(state, { type: 'join', id: '', name: 'x' }, 'bad-input');
  refused(state, { type: 'join', id: 'bad id with spaces' }, 'bad-input');
});

test('join: at most 8 members', () => {
  const ids = Array.from({ length: PARTY_MAX_MEMBERS }, (_, i) => `m${i}`);
  const state = lobby(ids);
  assert(Object.keys(state.members).length === 8, 'eight fit');
  refused(state, { type: 'join', id: 'ninth', name: 'Ninth' }, 'full');
  const after = reduce(state, { type: 'leave', id: 'm3' }, T0);
  assert(!step(after, { type: 'join', id: 'ninth', name: 'Ninth' }, T0).error, 'room again after a leave');
});

test('leave: host migrates to the earliest remaining member; last one empties the party', () => {
  let state = lobby(['a', 'b', 'c']);
  state = reduce(state, { type: 'leave', id: 'a' }, T0);
  assert(state.hostId === 'b', `host ${state.hostId}`);
  state = reduce(state, { type: 'join', id: 'a', name: 'Back' }, T0);
  assert(memberOrder(state).join() === 'b,c,a' && state.hostId === 'b', 'a rejoins at the back');
  state = reduce(state, { type: 'leave', id: 'c' }, T0);
  assert(state.hostId === 'b', 'non-host leaving keeps the host');
  state = reduce(reduce(state, { type: 'leave', id: 'b' }, T0), { type: 'leave', id: 'a' }, T0);
  assert(state.hostId === null && Object.keys(state.members).length === 0, 'empty');
  refused(lobby(['a']), { type: 'leave', id: 'zz' }, 'not-member');
});

// ------------------------------------------------------------------ lobby rules

test('select: host only, lobby/results only, valid modes of the map, resets ready', () => {
  let state = lobby(['a', 'b']);
  state = reduce(state, { type: 'ready', id: 'b', ready: true }, T0);
  refused(state, { type: 'select', id: 'b', modeId: 'climb' }, 'not-host');
  refused(state, { type: 'select', id: 'x', modeId: 'climb' }, 'not-member');
  refused(state, { type: 'select', id: 'a', modeId: 'roam' }, 'bad-mode');
  refused(state, { type: 'select', id: 'a', modeId: 'nonsense' }, 'bad-mode');
  refused(state, { type: 'select', id: 'a', mapId: 'moon', modeId: 'sprint' }, 'bad-mode');
  refused(state, { type: 'select', id: 'a', mapId: 'alpine', modeId: 'peak' }, 'bad-mode');
  state = ok(stepAt(state, { type: 'select', id: 'a', modeId: 'peak' }));
  assert(state.modeId === 'peak' && !state.members.b.ready, 'selected, ready reset');
  state = ok(stepAt(state, { type: 'select', id: 'a', mapId: 'alpine', modeId: 'drift' }));
  assert(state.mapId === 'alpine' && state.modeId === 'drift', 'map change');
  const started = reduce(state, { type: 'start', id: 'a' }, T0);
  refused(started, { type: 'select', id: 'a', modeId: 'sprint' }, 'phase');
});

test('ready: members toggle in lobby, booleans only', () => {
  let state = lobby(['a', 'b']);
  state = ok(stepAt(state, { type: 'ready', id: 'b', ready: true }));
  assert(state.members.b.ready, 'ready');
  assert(step(state, { type: 'ready', id: 'b', ready: true }).state === state, 'no-op keeps the object');
  refused(state, { type: 'ready', id: 'b', ready: 'yes' }, 'bad-input');
  refused(state, { type: 'ready', id: 'q', ready: true }, 'not-member');
  refused(reduce(state, { type: 'start', id: 'a' }, T0), { type: 'ready', id: 'b', ready: false }, 'phase');
});

// ------------------------------------------------------------------ the race

test('start: host only, countdown to now + 5 s, tick goes racing at startAt', () => {
  let state = lobby(['a', 'b']);
  refused(state, { type: 'start', id: 'b' }, 'not-host');
  state = ok(stepAt(state, { type: 'start', id: 'a' }, T0));
  assert(state.phase === 'countdown' && state.startAt === T0 + PARTY_COUNTDOWN_MS, `countdown ${state.startAt - T0}`);
  assert(Object.values(state.members).every((m) => m.inRace && !m.finished), 'everyone in the round');
  assert(nextDeadline(state) === state.startAt, 'alarm at the start');
  refused(state, { type: 'start', id: 'a' }, 'phase');
  assert(reduce(state, { type: 'tick' }, T0 + 4999) === state, 'not yet');
  // Joining during the countdown still makes the start.
  state = reduce(state, { type: 'join', id: 'c', name: 'Late C' }, T0 + 1000);
  assert(state.members.c.inRace, 'countdown joiner races');
  state = reduce(state, { type: 'tick' }, T0 + 5000);
  assert(state.phase === 'racing', state.phase);
  assert(nextDeadline(state) === T0 + PARTY_COUNTDOWN_MS + PARTY_RACE_CAP_MS, 'round cap scheduled');
  // Joining mid-race waits for the next round.
  state = reduce(state, { type: 'join', id: 'd', name: 'Later D' }, T0 + 9000);
  assert(!state.members.d.inRace, 'mid-race joiner waits');
  refused(state, { type: 'finish', id: 'd', time: 50 }, 'phase');
});

test('finish: validation, ordering by time, grace deadline, results when all done', () => {
  let state = racing(['a', 'b', 'c']);
  refused(lobby(['a']), { type: 'finish', id: 'a', time: 10 }, 'phase');
  for (const time of [0, -1, NaN, Infinity, 3601, '90', null]) refused(state, { type: 'finish', id: 'a', time }, 'bad-input');
  state = ok(stepAt(state, { type: 'finish', id: 'b', time: 101.5, score: 0 }, T0 + 110_000));
  assert(state.finishDeadline === T0 + 110_000 + PARTY_FINISH_GRACE_MS, 'grace from the first finish');
  refused(state, { type: 'finish', id: 'b', time: 99 }, 'phase');
  state = ok(stepAt(state, { type: 'finish', id: 'a', time: 99.25 }, T0 + 112_000));
  assert(state.finishDeadline === T0 + 110_000 + PARTY_FINISH_GRACE_MS, 'deadline fixed by the first finisher');
  assert(state.phase === 'racing', 'c still driving');
  state = ok(stepAt(state, { type: 'finish', id: 'c', time: 120 }, T0 + 130_000));
  assert(state.phase === 'results', state.phase);
  eq(rankResults(state).map((r) => `${r.position}${r.id}`), ['1a', '2b', '3c'], 'by time');
});

test('finish: a DNF does not start the grace period; everyone DNF ends the round', () => {
  let state = racing(['a', 'b']);
  state = ok(stepAt(state, { type: 'finish', id: 'a', dnf: true }, T0 + 20_000));
  assert(state.members.a.dnf && state.finishDeadline === 0 && state.phase === 'racing', 'dnf');
  state = ok(stepAt(state, { type: 'finish', id: 'b', dnf: true }, T0 + 21_000));
  assert(state.phase === 'results', 'all out');
});

test('deadline: unfinished racers become DNF; the round cap ends abandoned races', () => {
  let state = racing(['a', 'b', 'c']);
  state = reduce(state, { type: 'finish', id: 'c', time: 80 }, T0 + 90_000);
  assert(reduce(state, { type: 'tick' }, state.finishDeadline - 1) === state, 'before the deadline');
  state = reduce(state, { type: 'tick' }, state.finishDeadline);
  assert(state.phase === 'results' && state.members.a.dnf && state.members.b.dnf && !state.members.c.dnf, 'dnfs');
  eq(rankResults(state).map((r) => r.id), ['c', 'a', 'b'], 'finisher first, dnfs in join order');
  let idle = racing(['a', 'b']);
  idle = reduce(idle, { type: 'tick' }, idle.raceDeadline);
  assert(idle.phase === 'results' && idle.members.a.dnf && idle.members.b.dnf, 'cap');
});

test('leave mid-race: remaining finishers complete the round; host migrates', () => {
  let state = racing(['a', 'b']);
  state = reduce(state, { type: 'finish', id: 'b', time: 70 }, T0 + 80_000);
  state = reduce(state, { type: 'leave', id: 'a' }, T0 + 81_000);
  assert(state.phase === 'results' && state.hostId === 'b', `${state.phase} ${state.hostId}`);
});

test('drift: ranked by score, higher first; score required', () => {
  let state = racing(['a', 'b', 'c'], 'drift');
  refused(state, { type: 'finish', id: 'a', time: 120 }, 'bad-input');
  refused(state, { type: 'finish', id: 'a', time: 120, score: -5 }, 'bad-input');
  state = reduce(state, { type: 'finish', id: 'a', time: 120, score: 4200.4 }, T0 + 125_000);
  state = reduce(state, { type: 'finish', id: 'b', time: 120, score: 9100 }, T0 + 125_100);
  state = reduce(state, { type: 'finish', id: 'c', dnf: true }, T0 + 125_200);
  assert(state.phase === 'results', state.phase);
  eq(rankResults(state).map((r) => `${r.id}:${r.member.score}`), ['b:9100', 'a:4200', 'c:null'], 'by score');
});

test('rematch / select from results: back to the lobby, results cleared, round + 1', () => {
  let state = racing(['a', 'b']);
  state = reduce(state, { type: 'finish', id: 'a', time: 60 }, T0 + 70_000);
  state = reduce(state, { type: 'finish', id: 'b', time: 61 }, T0 + 70_500);
  refused(state, { type: 'rematch', id: 'b' }, 'not-host');
  refused(lobby(['a']), { type: 'rematch', id: 'a' }, 'phase');
  const again = ok(stepAt(state, { type: 'rematch', id: 'a' }, T0 + 80_000));
  assert(again.phase === 'lobby' && again.round === 2 && again.modeId === 'sprint', 'rematch');
  assert(Object.values(again.members).every((m) => !m.finished && !m.dnf && m.time === null && !m.inRace && !m.ready), 'cleared');
  const other = ok(stepAt(state, { type: 'select', id: 'a', modeId: 'climb' }, T0 + 80_000));
  assert(other.phase === 'lobby' && other.round === 2 && other.modeId === 'climb', 'another event');
  const next = ok(stepAt(again, { type: 'start', id: 'a' }, T0 + 90_000));
  assert(next.phase === 'countdown' && next.startAt === T0 + 90_000 + PARTY_COUNTDOWN_MS, 'second round starts');
});

test('invalid input never throws and never changes state', () => {
  const state = lobby(['a']);
  for (const event of [null, undefined, 7, {}, { type: 'explode', id: 'a' }, { type: 'start' }, { type: 'select', id: 'a' }]) {
    assert(step(state, event, T0).state === state, `event ${JSON.stringify(event)}`);
  }
  assert(step(null, { type: 'tick' }, T0).error === 'bad-input', 'null state');
  assert(step(state, { type: 'tick' }, NaN).error === 'bad-input', 'NaN clock');
  // Ops from the wire carry only their own fields and the sender's id.
  eq(eventFromOp('a', { op: 'finish', time: 5, id: 'b', members: {} }), { type: 'finish', id: 'a', time: 5, score: undefined, dnf: undefined }, 'finish op');
  assert(eventFromOp('a', { op: 'join', name: 'x' }) === null && eventFromOp('a', { op: 'join' }, { allowJoin: true }).type === 'join', 'join gated');
  assert(eventFromOp('a', { op: 'tick' }) === null && eventFromOp('a', null) === null, 'tick / garbage');
});

// ------------------------------------------------------------------ PartyRace helpers

/** A straight closed road of 1000 m along +x (s = x), and an open 600 m spur along +z on road 1. */
function fakeWorld() {
  return {
    roads: [{ length: 1000 }, { length: 800 }],
    routes: {
      loop: { id: 'loop', roadId: 0, closed: true, direction: 1, startS: 100, finishS: 100, length: 1000, checkpoints: [] },
      climb: { id: 'climb', roadId: 1, closed: false, direction: -1, startS: 700, finishS: 100, length: 600, checkpoints: [] },
    },
    locate(x, z, out, roadId) {
      out.roadId = roadId;
      out.s = roadId === 0 ? ((x % 1000) + 1000) % 1000 : z;
      return out;
    },
  };
}

test('RouteProgress: counts laps on a loop from behind the line; open routes are direct', () => {
  const world = fakeWorld();
  const loop = new RouteProgress(world, world.routes.loop, 2);
  assert(loop.total === 2000 && loop.lapLength === 1000, 'two laps');
  assert(loop.update(94, 0) === -6, `behind the line ${loop.distance}`);
  for (let x = 94; x <= 100 + 1500; x += 40) loop.update(x, 0);
  assert(Math.abs(loop.distance - 1474) < 1e-9, `one and a half laps ${loop.distance}`);
  loop.update(100 + 1450, 0); // a respawn a little back
  assert(Math.abs(loop.distance - 1450) < 1e-9, 'goes back');
  for (let x = 1550; x <= 100 + 2600; x += 40) loop.update(x, 0);
  assert(loop.distance === 2000, 'capped at the finish');
  const climb = new RouteProgress(world, world.routes.climb, 1);
  assert(climb.total === 600, `spur ${climb.total}`);
  assert(climb.update(0, 400) === 300, 'direction -1');
  assert(climb.update(0, NaN) === 300, 'unlocated keeps the last value');
});

test('buildStandings: finishers by time, then distance, unknown, DNF; details', () => {
  let state = racing(['a', 'b', 'c', 'd', 'e']);
  state = reduce(state, { type: 'finish', id: 'd', dnf: true }, T0 + 6000);
  const track = { lapLength: 1000, laps: 2, total: 2000 };
  let rows = buildStandings(state, 'b', new Map([['a', 900], ['b', 1250], ['c', 700], ['e', null]]), track);
  eq(rows.map((r) => `${r.position}:${r.name.slice(-1)}:${r.detail}`), ['1:B:Lap 2/2', '2:A:+350 m', '3:C:+550 m', '4:E:—', '5:D:DNF'], 'live');
  assert(rows[0].isYou && !rows[1].isYou, 'isYou');
  rows = buildStandings(state, 'b', { a: 100, b: 1250, c: 0 }, track);
  assert(rows[2].detail === '+1 lap', `lapped ${rows[2].detail}`);
  // Somebody finished: they lead, gaps are to the finish line; a local finish shows before the ack.
  state = reduce(state, { type: 'finish', id: 'c', time: 83.456 }, T0 + 90_000);
  rows = buildStandings(state, 'b', new Map([['a', 1900], ['b', 2000]]), track, { b: 84.5 });
  eq(rows.map((r) => `${r.name.slice(-1)}:${r.detail}`), ['C:FIN 1:23.46', 'B:FIN 1:24.50', 'A:+100 m', 'E:—', 'D:DNF'], 'finished');
  const sprint = buildStandings(racing(['a', 'b']), 'a', { a: 300, b: 200 }, { lapLength: 1000, laps: 1, total: 1000 });
  assert(sprint[0].detail === '30%' && sprint[1].detail === '+100 m', 'one-lap details');
  assert(formatRaceTime(61.5) === '1:01.50' && formatRaceTime(NaN) === '--:--.--', 'format');
});

test('buildResults: shared results rows', () => {
  let state = racing(['a', 'b', 'c'], 'drift');
  state = reduce(state, { type: 'finish', id: 'a', time: 120, score: 300 }, T0 + 1);
  state = reduce(state, { type: 'finish', id: 'b', time: 120, score: 900 }, T0 + 2);
  state = reduce(state, { type: 'tick' }, state.finishDeadline);
  const results = buildResults(state, 'a', true);
  assert(results.isScore && results.modeLabel === 'Drift Session' && results.mapLabel === 'Mussoorie' && results.round === 1 && results.isHost, JSON.stringify(results));
  eq(results.rows.map((r) => [r.position, r.name, r.isYou, r.score ?? null, r.dnf]), [[1, 'Driver B', false, 900, false], [2, 'Driver A', true, 300, false], [3, 'Driver C', false, null, true]], 'rows');
});

// ------------------------------------------------------------------ PartyRace flow against a fake net

function fakeHud() {
  const calls = { party: [], standings: [], results: [], toasts: [], opened: 0 };
  return {
    calls,
    setParty(view) { calls.party.push(view); },
    setRaceStandings(rows) { calls.standings.push(rows); },
    showPartyResults(results) { calls.results.push(results); },
    openParty() { calls.opened += 1; },
    toast(text) { calls.toasts.push(text); },
  };
}

function fakeNet(you = 'me#1') {
  const net = {
    instanceId: you,
    sent: [],
    joined: [],
    listeners: new Set(),
    onParty(callback) { this.listeners.add(callback); return () => this.listeners.delete(callback); },
    join(room, options) { this.joined.push([room, options]); },
    leave() { this.joined.push(['left']); },
    sendParty(op, payload = {}) { this.sent.push({ op, ...payload }); return true; },
    partyPeerKey: (id) => (id === you ? null : `peer:${id}`),
    positions: {},
    samplePeer(key, now, out) {
      const pos = this.positions[key];
      if (!pos) return null;
      out.x = pos.x; out.z = pos.z;
      return {};
    },
    emit(state, info = {}) {
      for (const listener of this.listeners) listener(state, { you, offset: 0, error: null, fatal: false, ...info });
    },
  };
  return net;
}

test('PartyRace: create, lobby view, synchronised start, standings, finish, results, rematch', () => {
  const world = fakeWorld();
  const hud = fakeHud();
  const net = fakeNet('me#1');
  const runs = [];
  const game = {
    state: 'menu', mode: { id: 'circuit' }, world, settings: { map: 'mussoorie' },
    modes: ['sprint', 'circuit', 'climb', 'descent', 'drift', 'peak', 'peakdown', 'roam'].map((id) => ({ id })),
    session: null,
    beginRun(modeId, options) { runs.push([modeId, options]); this.state = 'countdown'; this.session = { mode: { id: modeId }, hud: { progress: 0 } }; return true; },
    enterMenu() { this.state = 'menu'; },
  };
  const race = new PartyRace({ game, net, hud, meta: null, mapId: 'mussoorie' });
  hud.onPartyCreate();
  const [room, options] = net.joined[0];
  assert(partyCodeOfRoom(room) && options.party.intent === 'create' && options.party.mapId === 'mussoorie' && options.party.modeId === 'circuit', JSON.stringify(net.joined));
  assert(hud.calls.party.at(-1).status === 'connecting', 'connecting view');

  // The authority answers: we host a lobby, a friend joins.
  const code = partyCodeOfRoom(room);
  let state = createParty({ code, mapId: 'mussoorie', modeId: 'circuit' });
  state = reduce(state, { type: 'join', id: 'me#1', name: 'Me', level: 4 }, T0);
  state = reduce(state, { type: 'join', id: 'friend#2', name: 'Friend', level: 7, paint: 'acid' }, T0);
  net.emit(state);
  let view = hud.calls.party.at(-1);
  assert(view.status === 'lobby' && view.isHost && view.canStart && view.code === code && view.modeLabel === 'Ridge Circuit', JSON.stringify(view));
  assert(view.members.length === 2 && view.members[0].isYou && view.members[0].isHost && view.members[1].paint === 'acid', 'members');
  assert(view.modes.length === 7 && !view.modes.some((m) => m.id === 'roam'), 'modes');
  assert(view.shareUrl.endsWith(`?party=${code}`), view.shareUrl);
  assert(!view.allReady && view.readyCount === 1, 'ready counts');

  hud.onPartySelect('climb');
  hud.onPartyReady(true);
  hud.onPartyStart();
  eq(net.sent.map((m) => m.op), ['select', 'ready', 'start'], 'ops sent');
  assert(net.sent[0].mapId === 'mussoorie' && net.sent[0].modeId === 'climb', 'select payload');

  // Countdown with the authority's clock 2 s ahead of ours.
  state = reduce(state, { type: 'start', id: 'me#1' }, T0);
  net.emit(state, { offset: 2000 });
  assert(runs.length === 1 && runs[0][0] === 'circuit' && runs[0][1].party && runs[0][1].startAt === state.startAt - 2000, JSON.stringify(runs));
  assert(hud.calls.party.at(-1).status === 'countdown' && Number.isFinite(hud.calls.party.at(-1).startsIn), 'countdown view');
  net.emit(state, { offset: 2000 });
  assert(runs.length === 1, 'the same round starts once');

  // Racing: standings from our session and the friend's car.
  state = reduce(state, { type: 'tick' }, state.startAt);
  net.emit(state);
  game.state = 'running';
  game.session.hud.progress = 0.3; // 600 m of the 2-lap 2000 m circuit
  net.positions['peer:friend#2'] = { x: 94, z: 0 };
  race.tick();
  net.positions['peer:friend#2'] = { x: 400, z: 0 };
  race.tick();
  const rows = hud.calls.standings.at(-1);
  eq(rows.map((r) => `${r.position}:${r.name}:${r.detail}`), ['1:Me:Lap 1/2', '2:Friend:+300 m'], 'standings');

  // We finish; the friend quits; results.
  game.state = 'finished';
  race.onFinish({ time: 95.5, score: 0 });
  assert(net.sent.at(-1).op === 'finish' && net.sent.at(-1).time === 95.5 && !net.sent.at(-1).dnf, 'finish sent');
  state = reduce(state, { type: 'finish', id: 'me#1', time: 95.5, score: 0 }, T0 + 100_000);
  state = reduce(state, { type: 'finish', id: 'friend#2', dnf: true }, T0 + 101_000);
  net.emit(state);
  const results = hud.calls.results.at(-1);
  assert(results && results.rows[0].isYou && results.rows[0].time === 95.5 && results.rows[1].dnf && results.isHost, JSON.stringify(results));
  assert(hud.calls.standings.at(-1) === null, 'standings hidden');

  // Rematch: back to the lobby panel.
  hud.onPartyRematch();
  state = reduce(state, { type: 'rematch', id: 'me#1' }, T0 + 110_000);
  net.emit(state);
  assert(hud.calls.results.at(-1) === null && hud.calls.opened >= 1 && game.state === 'menu', 'back to lobby');
  assert(hud.calls.party.at(-1).round === 2, 'round 2');

  hud.onPartyLeave();
  assert(hud.calls.party.at(-1) === null && net.joined.at(-1)[0] === 'left', 'left');
  race.dispose();
});

test('PartyRace: quitting mid-race is a DNF; late joiners wait; refused joins show an error', () => {
  const world = fakeWorld();
  const hud = fakeHud();
  const net = fakeNet('me#1');
  const game = {
    state: 'menu', mode: { id: 'sprint' }, world, settings: { map: 'mussoorie' }, modes: [{ id: 'sprint' }], session: null,
    beginRun() { this.state = 'countdown'; return true; },
    enterMenu() { this.state = 'menu'; },
  };
  const race = new PartyRace({ game, net, hud, meta: null, mapId: 'mussoorie' });
  assert(!hud.onPartyJoin('nope'), 'bad code refused locally');
  hud.onPartyJoin('k7q xm');
  assert(net.joined[0][0] === 'party.K7QXM' && net.joined[0][1].party.intent === 'join', 'joins the normalised code');
  net.emit(null, { error: 'not-found', fatal: true });
  let view = hud.calls.party.at(-1);
  assert(view.status === 'error' && /No party/.test(view.error), JSON.stringify(view));

  // Join a race already under way: wait.
  hud.onPartyJoin('K7QXM');
  let state = racing(['host', 'me#1'].slice(0, 1));
  state = reduce(state, { type: 'join', id: 'me#1', name: 'Me' }, T0 + 7000);
  net.emit(state);
  view = hud.calls.party.at(-1);
  assert(view.status === 'racing' && !view.isHost && race.runRound === 0, 'late joiner waits');

  // Next round we race, then quit to the menu.
  state = reduce(reduce(state, { type: 'finish', id: 'host', time: 50 }, T0 + 8000), { type: 'rematch', id: 'host' }, T0 + 9000);
  state = reduce(state, { type: 'start', id: 'host' }, T0 + 10_000);
  net.emit(state);
  assert(race.runActive, 'racing this round');
  race.onLeaveRun();
  assert(net.sent.at(-1).op === 'finish' && net.sent.at(-1).dnf === true, 'dnf on quit');
  race.dispose();
});

test('PartyRace: a party on another map stores the code and switches the map', async () => {
  const store = new Map();
  globalThis.sessionStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const hud = fakeHud();
  const net = fakeNet('me#1');
  let applied = null;
  const game = {
    state: 'menu', world: fakeWorld(), settings: { map: 'mussoorie', quality: 'High' }, modes: [],
    applySettings(settings) { applied = settings; },
  };
  const race = new PartyRace({ game, net, hud, meta: null, mapId: 'mussoorie' });
  hud.onPartyJoin('K7QXM');
  let state = createParty({ code: 'K7QXM', mapId: 'alpine', modeId: 'sprint' });
  state = reduce(reduce(state, { type: 'join', id: 'host', name: 'Host' }, T0), { type: 'join', id: 'me#1', name: 'Me' }, T0);
  net.emit(state);
  assert(applied && applied.map === 'alpine' && applied.quality === 'High', `applied ${JSON.stringify(applied)}`);
  const saved = JSON.parse(store.get('slop-drift-party-rejoin'));
  assert(saved.code === 'K7QXM' && saved.mapId === 'alpine', 'rejoin saved');
  // After the reload, on Alpine: boot() rejoins.
  const net2 = fakeNet('me#2');
  const race2 = new PartyRace({ game: { ...game, settings: { map: 'alpine' } }, net: net2, hud: fakeHud(), meta: null, mapId: 'alpine' });
  await race2.boot();
  assert(net2.joined[0]?.[0] === 'party.K7QXM' && !store.has('slop-drift-party-rejoin'), 'rejoined after reload');
  race.dispose();
  race2.dispose();
  delete globalThis.sessionStorage;
});

test('PartyRace: exposes member car labels from state and live roster updates', () => {
  const hud = fakeHud();
  const net = fakeNet('me#1');
  net.peers = new Map([['peer:friend#2', { name: 'Friend', level: 7, paint: 'acid', car: 'tokyo' }]]);
  net.rosterListeners = new Set();
  net.onRoster = (cb) => { net.rosterListeners.add(cb); return () => net.rosterListeners.delete(cb); };
  const game = { state: 'menu', mode: { id: 'sprint' }, carId: 'gt', world: fakeWorld(), settings: { map: 'mussoorie' }, modes: [{ id: 'sprint' }] };
  const race = new PartyRace({ game, net, hud, meta: null, mapId: 'mussoorie' });
  hud.onPartyCreate();
  let state = createParty({ code: 'K7QXM', mapId: 'mussoorie', modeId: 'sprint' });
  state = reduce(state, { type: 'join', id: 'me#1', name: 'Me', level: 4, car: 'gt' }, T0);
  state = reduce(state, { type: 'join', id: 'friend#2', name: 'Friend', level: 7, paint: 'acid' }, T0);
  net.emit(state);
  let view = hud.calls.party.at(-1);
  assert(view.members[0].car === 'gt' && view.members[0].carLabel === 'Track GT3', JSON.stringify(view.members[0]));
  assert(view.members[1].car === 'tokyo' && view.members[1].carLabel === 'Tokyo Sedan', JSON.stringify(view.members[1]));
  net.peers.get('peer:friend#2').car = 'thar';
  for (const cb of net.rosterListeners) cb(net.peers);
  view = hud.calls.party.at(-1);
  assert(view.members[1].car === 'thar' && view.members[1].carLabel === 'Hill 4x4', JSON.stringify(view.members[1]));
  race.dispose();
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
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
