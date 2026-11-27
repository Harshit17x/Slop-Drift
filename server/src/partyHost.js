// Party room authority for one 'party.<CODE>' room (see src/net/party.js for the state machine).
// No Workers APIs: Room.js injects Durable Object storage, the alarm and its clock, so Node tests
// drive this class directly (tests/net.test.mjs).
//
// Persistence: the party state is written to storage after every change, so a hibernated or
// evicted Durable Object picks up exactly where it was. The alarm is set to the next deadline
// (countdown -> racing, finish grace, round cap) and cleared when nothing is pending.

import { createParty, eventFromOp, nextDeadline, partyCodeOfRoom, step } from '../../src/net/party.js';

const STORAGE_KEY = 'party';
const GRACE_KEY = 'party-grace';
/** How long (ms) an empty party stays alive after a map switch while players reload into the new world. */
export const MAP_SWITCH_GRACE_MS = 25_000;

export class PartyHost {
  /**
   * @param {object} options
   * @param {string} options.roomName  'party.<CODE>'
   * @param {{get(key:string):Promise<any>, put(key:string, value:any):Promise<void>, delete(key:string):Promise<any>,
   *          setAlarm?(at:number):Promise<void>, deleteAlarm?():Promise<void>}} options.storage
   * @param {() => number} [options.now]  Epoch ms.
   */
  constructor({ roomName, storage, now = () => Date.now() }) {
    this.code = partyCodeOfRoom(roomName);
    this.storage = storage;
    this.now = now;
    this.state = undefined; // undefined: not loaded yet; null: no party
    this.rejoinUntil = 0;
    this.alarmAt = 0;
    this._queue = Promise.resolve();
  }

  enqueue(task) {
    const next = this._queue.then(task);
    this._queue = next.catch(() => {});
    return next;
  }

  async load() {
    if (this.state === undefined) {
      try {
        this.state = (await this.storage.get(STORAGE_KEY)) || null;
        this.rejoinUntil = Number(await this.storage.get(GRACE_KEY)) || 0;
      } catch {
        this.state = null;
        this.rejoinUntil = 0;
      }
    }
    return this.state;
  }

  /**
   * A connection arrived. `intent` is 'create' (make the party; refused when the code is taken) or
   * 'join' (refused when there is no such party).
   * @returns {Promise<{state:object|null, error:string|null}>}
   */
  connect(memberId, profile, { intent = 'join', mapId, modeId } = {}) {
    return this.enqueue(async () => {
      let state = await this.load();
      if (!this.code) return { state: null, error: 'bad-code' };
      const hasMembers = Boolean(state && Object.keys(state.members || {}).length);
      const graceActive = Boolean(state && !hasMembers && this.rejoinUntil > this.now());
      if (!state || (!hasMembers && !graceActive)) {
        if (intent !== 'create') return { state: null, error: 'not-found' };
        state = createParty({ code: this.code, mapId, modeId });
        if (!state) return { state: null, error: 'bad-map' };
      } else if (intent === 'create' && !state.members[memberId] && hasMembers) {
        return { state: null, error: 'exists' };
      }
      const result = step(state, { type: 'join', id: memberId, ...profile }, this.now());
      if (result.error) return { state: null, error: result.error };
      await this.commit(result.state);
      return { state: this.state, error: null };
    });
  }

  /**
   * Drops members without a live connection (the Durable Object restarted without close events).
   * @param {string[]} liveIds  Member ids of the connections that are still open.
   */
  prune(liveIds) {
    return this.enqueue(async () => {
      const state = await this.load();
      if (!state) return { state: null, changed: false };
      const live = new Set(liveIds);
      let next = state;
      for (const id of Object.keys(state.members)) {
        if (!live.has(id)) next = step(next, { type: 'leave', id }, this.now()).state;
      }
      if (next === state) return { state, changed: false };
      await this.commit(next);
      return { state: this.state, changed: true };
    });
  }

  /** A client text message {t:'party', op, ...}. */
  message(memberId, data) {
    return this.enqueue(async () => {
      const state = await this.load();
      if (!state) return { state: null, error: 'not-found', changed: false };
      const prevMapId = state.mapId;
      // The clock may have passed a deadline while the alarm was in flight: settle it first.
      let current = step(state, { type: 'tick' }, this.now()).state;
      const event = eventFromOp(memberId, data);
      let error = null;
      if (event) {
        const result = step(current, event, this.now());
        current = result.state;
        error = result.error;
      } else if (data?.op !== 'sync') {
        error = 'bad-input';
      }
      if (event?.type === 'select' && !error && current.mapId !== prevMapId) {
        this.rejoinUntil = this.now() + MAP_SWITCH_GRACE_MS;
      } else if (event?.type === 'start' && !error) {
        this.rejoinUntil = 0;
      }
      const changed = current !== state;
      if (changed) await this.commit(current);
      return { state: this.state, error, changed };
    });
  }

  /** A connection closed. Returns the new state (null once the last member has gone). */
  disconnect(memberId) {
    return this.enqueue(async () => {
      const state = await this.load();
      if (!state || !state.members[memberId]) return { state, changed: false };
      const result = step(state, { type: 'leave', id: memberId }, this.now());
      await this.commit(result.state);
      return { state: this.state, changed: true };
    });
  }

  /** The Durable Object alarm fired. */
  alarm() {
    return this.enqueue(async () => {
      const state = await this.load();
      this.alarmAt = 0;
      if (!state) return { state: null, changed: false };
      let next = step(state, { type: 'tick' }, this.now()).state;
      const hasMembers = Boolean(Object.keys(next.members || {}).length);
      if (!hasMembers && !(this.rejoinUntil > this.now())) next = null;
      const changed = next !== state;
      await this.commit(next, { force: true });
      return { state: this.state, changed };
    });
  }

  async commit(state, { force = false } = {}) {
    const now = this.now();
    if (this.rejoinUntil && now >= this.rejoinUntil) this.rejoinUntil = 0;
    const hasMembers = Boolean(state && Object.keys(state.members || {}).length);
    const keepForSwitch = Boolean(state && !hasMembers && this.rejoinUntil > now && state.mapId);
    const empty = !state || (!hasMembers && !keepForSwitch);
    this.state = empty ? null : state;
    if (empty) {
      this.rejoinUntil = 0;
      await this.storage.delete(STORAGE_KEY);
      await this.storage.delete(GRACE_KEY);
      if (this.alarmAt) await this.storage.deleteAlarm?.();
      this.alarmAt = 0;
      return;
    }
    await this.storage.put(STORAGE_KEY, state);
    if (this.rejoinUntil > now) await this.storage.put(GRACE_KEY, this.rejoinUntil);
    else await this.storage.delete(GRACE_KEY);
    const deadline = nextDeadline(state);
    const at = keepForSwitch ? this.rejoinUntil : (deadline && this.rejoinUntil > now ? Math.min(deadline, this.rejoinUntil) : deadline);
    if (at !== this.alarmAt || force) {
      if (at > 0) await this.storage.setAlarm?.(at);
      else if (this.alarmAt) await this.storage.deleteAlarm?.();
      this.alarmAt = at;
    }
  }
}
