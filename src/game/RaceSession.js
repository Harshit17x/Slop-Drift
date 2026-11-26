// Race rules for one run of a game mode: timing, laps, checkpoints, splits, records,
// wrong-way / off-road detection and respawn positions. Pure logic: no DOM, no THREE scene.
//
// Progress is measured as `d`, metres along the route in its driving direction from the start line:
//   closed routes: d = mod((s - startS) * direction, roadLength)  -> 0..L, the start/finish line is d = 0 = L
//   open routes:   d = (s - startS) * direction                   -> 0 at the start, finishD at the finish
// Gates (checkpoints, then the lap or finish line) are only counted when d moves forward across them
// between two consecutive updates by no more than the car could physically have travelled.

import { mod, clamp, saturate } from '../core/math.js';

const START_BEHIND = 6; // metres behind the start line for the start pose
const WRONG_WAY_SPEED = 5; // m/s
const WRONG_WAY_COS = -0.3; // velocity vs route direction, cos of the angle (about 107 degrees)
const DEBOUNCE = 1; // seconds a condition must hold before wrong-way / off-road raises
const OFFROAD_MARGIN = 4; // metres beyond halfWidth
const VALID_MARGIN = 0.75; // metres beyond halfWidth still accepted as a respawn position
const TELEPORT_FACTOR = 2.5; // travel budget multiplier on speed * dt (s runs faster than speed on the inside of bends)
const TELEPORT_SLACK = 3; // metres of slack on top of the travel budget

function makeLocation() {
  return { roadId: -1, s: 0, progress: 0, lateral: 0, distance: 0, halfWidth: 0, y: 0, tx: 0, ty: 0, tz: 1 };
}

/** Wrap a difference into (-L/2, L/2]. */
function wrapSigned(value, length) {
  const v = mod(value + length * 0.5, length) - length * 0.5;
  return v === -length * 0.5 ? length * 0.5 : v;
}

export class RaceSession {
  constructor({ world, mode, records = {} }) {
    if (!world || !mode) throw new Error('RaceSession: world and mode are required');
    const route = world.routes?.[mode.route];
    if (!route) throw new Error(`RaceSession: unknown route '${mode.route}'`);
    const road = world.roads?.[route.roadId];
    if (!road) throw new Error(`RaceSession: unknown road ${route.roadId}`);

    this.world = world;
    this.mode = mode;
    this.records = records || {};
    this.route = route;
    this.routeKey = mode.route;
    this.roadId = route.roadId;
    this.roadLength = road.length;
    this.closed = Boolean(route.closed);
    this.dir = route.direction < 0 ? -1 : 1;
    this.L = this.closed ? road.length : Infinity;

    if (this.closed) {
      this.finishD = this.L;
    } else {
      const fd = (route.finishS - route.startS) * this.dir;
      this.finishD = fd > 0 ? fd : route.length;
    }

    // Kind of run.
    const laps = mode.laps | 0;
    if ((laps > 0 || mode.practice) && this.closed) this.kind = 'laps';
    else if (laps > 0) this.kind = 'p2p';
    else if (mode.timeLimit > 0) this.kind = 'score';
    else this.kind = 'free';
    this.totalLaps = this.kind === 'laps' ? laps : this.kind === 'p2p' ? 1 : 0;
    this.timeLimit = this.kind === 'score' ? mode.timeLimit : null;
    this.isRace = this.kind === 'laps' || this.kind === 'p2p';

    // Checkpoints as d values, strictly inside (0, finishD), in driving order.
    const cps = [];
    for (const s of route.checkpoints || []) {
      const d = this._dOf(s);
      if (d > 0 && d < this.finishD && (cps.length === 0 || d > cps[cps.length - 1])) cps.push(d);
    }
    // A lap needs at least one intermediate gate, otherwise rocking back and forth over the line would count.
    if (cps.length === 0 && this.kind === 'laps') cps.push(this.finishD * 0.5);
    this.cpD = cps;
    this.cpCount = cps.length;

    // Run state.
    this.elapsed = 0;
    this.finished = false;
    this.result = null;
    this.lapsDone = 0;
    this.nextGate = 0; // 0..cpCount-1 = checkpoint, cpCount = lap / finish line
    this.lapStart = 0;
    this.lastLap = null;
    this.limitGrace = mode.limitGrace ?? .65;
    this.trackWarnings = 0;
    this.penaltySeconds = 0;
    this.lapInvalid = false;
    this.hadInvalidLap = false;
    this.sessionBestLap = null;
    this.lapTimes = [];
    this.splits = new Array(this.totalLaps * this.cpCount).fill(null);
    this.topSpeed = 0;
    this.respawns = 0;
    this.lastScore = 0;

    // Tracking state.
    this._loc = makeLocation();
    this._anyLoc = makeLocation();
    this._events = [];
    this._hasPrev = false;
    this._prevD = 0;
    this._prevSpeed = 0;
    this._budget = 0;
    this._respawnPending = false;
    this._legit = true; // false while the car is beyond a gate it has not legitimately crossed
    this._curD = this._startD();
    this._lastValidD = this._curD;
    this._wrongTimer = 0;
    this._offTimer = 0;
    this.wrongWay = false;
    this.offRoad = false;

    const record = this.records[mode.id];
    this.hud = {
      modeId: mode.id,
      modeLabel: mode.label,
      lap: this.totalLaps > 0 ? 1 : 0,
      laps: this.totalLaps,
      elapsed: 0,
      lapTime: 0,
      bestLap: record && typeof record.bestLap === 'number' ? record.bestLap : null,
      lastLap: null,
      progress: 0,
      timeLeft: this.timeLimit,
      wrongWay: false,
      offRoad: false,
    };
  }

  // ---------------------------------------------------------------- public API

  /** SpawnPose a few metres behind the start line, facing the driving direction. */
  getStartPose(out) {
    const d = this._startD();
    this.world.getSpawn(this.routeKey, this._sOf(d), out);
    // The car will be placed here, so the first update measures movement from this point.
    if (!this._hasPrev && !this.finished) {
      this._prevD = d;
      this._hasPrev = true;
      this._curD = d;
    }
    return out;
  }

  /** Last valid on-road position on the route, on the centreline, facing the driving direction. */
  getRespawnPose(out) {
    this.world.getSpawn(this.routeKey, this._sOf(this._lastValidD), out);
    return out;
  }

  addRespawn() {
    this.respawns += 1;
    if (this.world.apex && this.isRace) this.hadInvalidLap = this.lapInvalid = true;
    this._respawnPending = true;
  }

  update(dt, state, drift) {
    const events = this._events;
    events.length = 0;
    if (this.finished || !state) return events;
    if (!(dt > 0) || !Number.isFinite(dt)) dt = 0;

    const elapsedBefore = this.elapsed;
    this.elapsed += dt;

    const vel = state.velocity;
    const vx = vel ? vel.x : 0;
    const vz = vel ? vel.z : 0;
    const speed = Number.isFinite(state.speed) ? state.speed : Math.hypot(vx, vel ? vel.y : 0, vz);
    if (speed > this.topSpeed) this.topSpeed = speed;
    if (drift) this.lastScore = (drift.bank || 0) + (drift.score || 0);

    this._budget += Math.max(speed, this._prevSpeed) * dt * TELEPORT_FACTOR;
    this._prevSpeed = speed;

    const px = state.position ? state.position.x : 0;
    const pz = state.position ? state.position.z : 0;
    const loc = this.world.locate(px, pz, this._loc, this.roadId, state.position?.y);
    let located = Boolean(loc) && loc.roadId !== -1 && Number.isFinite(loc.s);

    if(this.world.apex && this.isRace && located && this.apexExitD!=null){
      const resumed=this._dOf(loc.s),jump=wrapSigned(resumed-this.apexExitD,this.roadLength);
      if (!this._respawnPending && jump > 0 && this._distTo(this._gateD(this.nextGate), this.apexExitD) <= jump) this._legit = false;
      this.apexExitD = null;
    }
    if (located) {
      const d = this._dOf(loc.s);
      if (!this._hasPrev) {
        this._hasPrev = true;
        if (this._respawnPending) this._legit = true;
      } else {
        const delta = this.closed ? wrapSigned(d - this._prevD, this.L) : d - this._prevD;
        const teleport = this._respawnPending || Math.abs(delta) > this._budget + TELEPORT_SLACK;
        if (teleport) this._onTeleport(d, delta);
        else this._crossGates(delta, elapsedBefore, dt, events);
      }
      this._prevD = d;
      this._curD = d;
      this._budget = 0;
      this._respawnPending = false;
    }

    if (this.world.apex && this.isRace) {
      if (!located) {
        if (this._hasPrev) this.apexExitD = this._prevD;
        this._hasPrev = false;
        this._budget = 0;
        this.outsideSeconds = (this.outsideSeconds || 0) + dt;
        if (!this.warnedHere && this.outsideSeconds >= this.limitGrace) {
          this.warnedHere = true;
          this.lapInvalid = true;
          this.hadInvalidLap = true;
          this.trackWarnings++;
          if (this.trackWarnings % 3 === 0) this.penaltySeconds += 5;
          events.push({type:'apexLimit', count:this.trackWarnings, penalty:this.penaltySeconds});
        }
      } else {
        this.outsideSeconds = 0;
        this.warnedHere = false;
      }
    }
    if (this.finished) {
      this._writeHud();
      return events;
    }

    // Wrong-way and off-road conditions.
    let offCond;
    let tx = 0;
    let tz = 0;
    let haveTangent = false;
    if (this.isRace) {
      offCond = !located || Math.abs(loc.lateral) > loc.halfWidth + OFFROAD_MARGIN;
      if (located) {
        tx = loc.tx;
        tz = loc.tz;
        haveTangent = true;
      }
    } else {
      // Free modes may roam onto any road: off-road against the nearest road of any kind.
      const any = this.world.locate(px, pz, this._anyLoc, -1, state.position?.y);
      const anyOk = Boolean(any) && any.roadId !== -1 && Number.isFinite(any.lateral);
      offCond = !anyOk || Math.abs(any.lateral) > any.halfWidth + OFFROAD_MARGIN;
      if (anyOk && any.roadId === this.roadId) {
        tx = any.tx;
        tz = any.tz;
        haveTangent = true;
      }
    }
    const hSpeed = Math.hypot(vx, vz);
    const wrongCond = haveTangent && hSpeed > WRONG_WAY_SPEED && ((vx * tx + vz * tz) * this.dir) / hSpeed < WRONG_WAY_COS;

    if (wrongCond) {
      this._wrongTimer += dt;
      if (!this.wrongWay && this._wrongTimer >= DEBOUNCE) {
        this.wrongWay = true;
        events.push({ type: 'wrongWay', active: true });
      }
    } else {
      this._wrongTimer = 0;
      if (this.wrongWay) {
        this.wrongWay = false;
        events.push({ type: 'wrongWay', active: false });
      }
    }
    if (offCond) {
      this._offTimer += dt;
      if (!this.offRoad && this._offTimer >= DEBOUNCE) {
        this.offRoad = true;
        events.push({ type: 'offRoad', active: true });
      }
    } else {
      this._offTimer = 0;
      if (this.offRoad) {
        this.offRoad = false;
        events.push({ type: 'offRoad', active: false });
      }
    }

    // Respawn position: only from continuous, legitimate, on-road driving.
    if (
      located &&
      this._legit &&
      !wrongCond &&
      !state.airborne &&
      !state.upsideDown &&
      Math.abs(loc.lateral) <= loc.halfWidth + VALID_MARGIN
    ) {
      this._lastValidD = this.closed ? this._curD : clamp(this._curD, this._minD(), this.finishD);
    }

    // Score attack ends on time.
    if (this.kind === 'score' && this.elapsed >= this.timeLimit) {
      this.elapsed = this.timeLimit;
      this._finish(this.timeLimit, events);
    }

    this._writeHud();
    return events;
  }

  // ---------------------------------------------------------------- internals

  _dOf(s) {
    return this.closed ? mod((s - this.route.startS) * this.dir, this.L) : (s - this.route.startS) * this.dir;
  }

  _sOf(d) {
    const s = this.route.startS + d * this.dir;
    return this.closed ? mod(s, this.L) : clamp(s, 0, this.roadLength);
  }

  /** Smallest d an open route allows (the road end behind the start line). */
  _minD() {
    return this._dOf(this._sOf(-1e9));
  }

  _startD() {
    return this._dOf(this._sOf(-START_BEHIND));
  }

  _gateD(index) {
    return index < this.cpCount ? this.cpD[index] : this.finishD;
  }

  /** Forward distance from `from` to gate g (closed: modular, in [0, L)). */
  _distTo(g, from) {
    return this.closed ? mod(g - from, this.L) : g - from;
  }

  _crossGates(delta, elapsedBefore, dt, events) {
    const prevD = this._prevD;
    if (delta < 0) {
      // Reversing back behind the gate we jumped past restores a legitimate position.
      if (!this._legit && this.isRace) {
        const back = this.closed ? mod(prevD - this._gateD(this.nextGate), this.L) : prevD - this._gateD(this.nextGate);
        if (back >= 0 && back < -delta) this._legit = true;
      }
      return;
    }
    if (!this.isRace || delta === 0) return;
    for (;;) {
      const dist = this._distTo(this._gateD(this.nextGate), prevD);
      if (!(dist > 0 && dist <= delta)) break;
      const t = elapsedBefore + dt * (dist / delta);
      this._legit = true;
      this._passGate(t, events);
      if (this.finished) break;
    }
  }

  _onTeleport(d, delta) {
    if (this._respawnPending) {
      this._legit = true;
      return;
    }
    if (!this.isRace) return;
    const g = this._gateD(this.nextGate);
    const prevD = this._prevD;
    if (delta > 0) {
      const dist = this._distTo(g, prevD);
      if (dist > 0 && dist <= delta) this._legit = false; // jumped over a gate: it is not counted
    } else if (!this._legit) {
      const back = this.closed ? mod(prevD - g, this.L) : prevD - g;
      if (back >= 0 && back < -delta) this._legit = true;
    }
    // Landing on the respawn point (caller respawned without addRespawn) is legitimate too.
    const off = this.closed ? Math.abs(wrapSigned(d - this._lastValidD, this.L)) : Math.abs(d - this._lastValidD);
    if (off < 3) this._legit = true;
  }

  _record(create) {
    let record = this.records[this.mode.id];
    if (!record && create) {
      record = {};
      this.records[this.mode.id] = record;
    }
    return record;
  }

  _passGate(t, events) {
    const index = this.nextGate;
    if (index < this.cpCount) {
      const k = this.lapsDone * this.cpCount + index;
      if (this.mode.practice || k < this.splits.length) this.splits[k] = t;
      const record = this._record(false);
      const best = record && Array.isArray(record.splits) ? record.splits[k] : null;
      events.push({ type: 'checkpoint', index, total: this.cpCount, split: typeof best === 'number' ? t - best : null });
      this.nextGate = index + 1;
      return;
    }

    // Lap or finish line.
    if (this.kind === 'p2p') {
      this.lapTimes.push(t);
      this.lapsDone = 1;
      this.lastLap = t;
      this._finish(t, events);
      return;
    }
    const lapTime = t - this.lapStart;
    this.lapStart = t;
    this.lapsDone += 1;
    this.lapTimes.push(lapTime);
    this.lastLap = lapTime;
    const record = this._record(false);
    const recordLap = record && typeof record.bestLap === 'number' ? record.bestLap : null;
    let prevBest = recordLap;
    if (this.sessionBestLap !== null && (prevBest === null || this.sessionBestLap < prevBest)) prevBest = this.sessionBestLap;
    const isBest = !this.lapInvalid && (prevBest === null || lapTime < prevBest);
    if (!this.lapInvalid && (this.sessionBestLap === null || lapTime < this.sessionBestLap)) this.sessionBestLap = lapTime;
    if (!this.lapInvalid && (recordLap === null || lapTime < recordLap)) this._record(true).bestLap = lapTime;
    events.push({ type: 'lap', lap: this.lapsDone, time: lapTime, isBest, invalid: this.lapInvalid });
    this.lapInvalid = false;
    this.nextGate = 0;
    if (!this.mode.practice && this.lapsDone >= this.totalLaps) this._finish(t, events);
  }

  _finish(time, events) {
    this.finished = true;
    time += this.penaltySeconds;
    this.elapsed = time;
    const id = this.mode.id;
    const prior = this._record(false);
    let isRecord;
    let bestTime = prior && typeof prior.time === 'number' ? prior.time : null;
    let bestScore = prior && typeof prior.score === 'number' ? prior.score : null;
    const score = this.lastScore;
    if (this.kind === 'score') {
      isRecord = bestScore === null || score > bestScore;
      if (isRecord) {
        this._record(true).score = score;
        bestScore = score;
      }
    } else {
      isRecord = !this.hadInvalidLap && (bestTime === null || time < bestTime);
      if (isRecord) {
        const record = this._record(true);
        record.time = time;
        record.splits = this.splits.slice();
        bestTime = time;
      }
    }
    this.result = {
      modeId: id,
      modeLabel: this.mode.label,
      time,
      bestTime,
      isRecord,
      score,
      bestScore,
      topSpeedKmh: this.topSpeed * 3.6,
      respawns: this.respawns,
      laps: this.lapTimes.slice(),
    };
    events.push({ type: 'finish', result: this.result });
  }

  _progress() {
    const d = this._curD;
    if (this.kind === 'p2p') return saturate(d / this.finishD);
    if (!this.closed) return saturate(d / this.finishD);
    let lapFrac = d / this.L;
    if (this.kind === 'laps') {
      // Behind the line before the first checkpoint of a lap counts as the start of the lap.
      if (this.nextGate === 0 && lapFrac > 0.5) lapFrac = 0;
      return this.mode.practice ? saturate(lapFrac) : saturate((this.lapsDone + lapFrac) / this.totalLaps);
    }
    return saturate(lapFrac);
  }

  _writeHud() {
    const hud = this.hud;
    hud.elapsed = this.elapsed;
    hud.lap = this.mode.practice ? this.lapsDone + 1 : this.totalLaps > 0 ? Math.min(this.lapsDone + 1, this.totalLaps) : 0;
    if (this.kind === 'laps') hud.lapTime = this.finished ? this.lastLap || 0 : this.elapsed - this.lapStart;
    else hud.lapTime = this.elapsed;
    const record = this.records[this.mode.id];
    let best = record && typeof record.bestLap === 'number' ? record.bestLap : null;
    if (this.sessionBestLap !== null && (best === null || this.sessionBestLap < best)) best = this.sessionBestLap;
    hud.bestLap = best;
    hud.lastLap = this.lastLap;
    hud.progress = this.finished && this.isRace ? 1 : this._progress();
    hud.timeLeft = this.timeLimit === null ? null : Math.max(0, this.timeLimit - this.elapsed);
    hud.wrongWay = this.wrongWay;
    hud.offRoad = this.offRoad;
  }
}
