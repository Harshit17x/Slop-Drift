// Party room authority for one 'party.<CODE>' room (see src/net/party.js for the state machine).
// No Workers APIs: Room.js injects Durable Object storage, the alarm and its clock, so Node tests
// drive this class directly (tests/net.test.mjs).
//
// Persistence: the party state is written to storage after every change, so a hibernated or
// evicted Durable Object picks up exactly where it was. The alarm is set to the next deadline
// (countdown -> racing, finish grace, round cap) and cleared when nothing is pending.

import { createParty, eventFromOp, nextDeadline, partyCodeOfRoom, step } from '../../src/net/party.js';

const STORAGE_KEY = 'party';

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
    this.alarmAt = 0;
  }

  async load() {
    if (this.state === undefined) {
      try {
        this.state = (await this.storage.get(STORAGE_KEY)) || null;
      } catch {
        this.state = null;
      }
    }
    return this.state;
  }

  /**
   * A connection arrived. `intent` is 'create' (make the party; refused when the code is taken) or
   * 'join' (refused when there is no such party).
   * @returns {Promise<{state:object|null, error:string|null}>}
   */
  async connect(memberId, profile, { intent = 'join', mapId, modeId } = {}) {
    let state = await this.load();
    if (!this.code) return { state: null, error: 'bad-code' };
    if (!state || !Object.keys(state.members || {}).length) {
      if (intent !== 'create') return { state: null, error: 'not-found' };
      state = createParty({ code: this.code, mapId, modeId });
      if (!state) return { state: null, error: 'bad-map' };
    } else if (intent === 'create' && !state.members[memberId]) {
      return { state: null, error: 'exists' };
    }
    const result = step(state, { type: 'join', id: memberId, ...profile }, this.now());
    if (result.error) return { state: null, error: result.error };
    await this.commit(result.state);
    return { state: this.state, error: null };
  }

  /**
   * Drops members without a live connection (the Durable Object restarted without close events).
   * @param {string[]} liveIds  Member ids of the connections that are still open.
   */
  async prune(liveIds) {
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
  }

  /** A client text message {t:'party', op, ...}. */
  async message(memberId, data) {
    const state = await this.load();
    if (!state) return { state: null, error: 'not-found', changed: false };
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
    const changed = current !== state;
    if (changed) await this.commit(current);
    return { state: this.state, error, changed };
  }

  /** A connection closed. Returns the new state (null once the last member has gone). */
  async disconnect(memberId) {
    const state = await this.load();
    if (!state || !state.members[memberId]) return { state, changed: false };
    const result = step(state, { type: 'leave', id: memberId }, this.now());
    await this.commit(result.state);
    return { state: this.state, changed: true };
  }

  /** The Durable Object alarm fired. */
  async alarm() {
    const state = await this.load();
    this.alarmAt = 0;
    if (!state) return { state: null, changed: false };
    const next = step(state, { type: 'tick' }, this.now()).state;
    const changed = next !== state;
    await this.commit(next, { force: true });
    return { state: this.state, changed };
  }

  async commit(state, { force = false } = {}) {
    const empty = !state || !state.hostId || !Object.keys(state.members).length;
    this.state = empty ? null : state;
    if (empty) {
      await this.storage.delete(STORAGE_KEY);
      if (this.alarmAt) await this.storage.deleteAlarm?.();
      this.alarmAt = 0;
      return;
    }
    await this.storage.put(STORAGE_KEY, state);
    const at = nextDeadline(state);
    if (at !== this.alarmAt || force) {
      if (at > 0) await this.storage.setAlarm?.(at);
      else if (this.alarmAt) await this.storage.deleteAlarm?.();
      this.alarmAt = at;
    }
  }
}
