// Global leaderboards with a local fallback.
//
//   const board = new Leaderboard({ host: import.meta.env.VITE_API_HOST, profile });
//   const { status, entries } = await board.top('sprint', 50);        // status 'online' | 'local'
//   const result = await board.submit('sprint', runResult, ghostString); // { accepted, rank, reason, status }
//   const ghost = await board.ghost('sprint', entries[0].playerId);     // base64 string or null
//
// Online it talks to the Worker (server/src/index.js), registering for a player token on first use.
// With no host, or when a request fails, it answers from a leaderboard kept in localStorage that
// holds this browser's own runs only, and says so with status 'local'. Every run is also recorded
// locally, so the fallback is never empty after a finish. Nothing here rejects.
//
// Every `modeId` here is a track key (src/meta/trackKey.js): 'sprint' is the Alpine loop,
// 'mussoorie.sprint' the Mussoorie one. Each track key is its own board online and locally.

import { levelForXp, medalTargets } from '../meta/catalog.js';
import { ensureToken, fetchWithTimeout, normalizeHost, profileLevel, readJson, storage, writeJson } from './identity.js';

const BOARD_KEY = 'slop-drift-local-board-v1';
const GHOST_PREFIX = 'slop-drift-local-ghost:';
const TOP_CACHE = 30000;
const GHOST_CACHE = 60000;
const LOCAL_MAX_PER_MODE = 50;

function kindOf(modeId) {
  return medalTargets(modeId)?.kind || null;
}

/**
 * Sorts entries (time ascending or score descending; earlier `at` wins ties), keeps each player's best
 * and assigns ranks. Exported for tests.
 */
export function rankEntries(entries, kind, meId = null) {
  const best = new Map();
  const better = (a, b) => (kind === 'time' ? a.time < b.time : a.score > b.score) || ((kind === 'time' ? a.time === b.time : a.score === b.score) && a.at < b.at);
  for (const entry of entries) {
    const value = kind === 'time' ? entry.time : entry.score;
    if (!Number.isFinite(value)) continue;
    const current = best.get(entry.playerId);
    if (!current || better(entry, current)) best.set(entry.playerId, entry);
  }
  const sorted = [...best.values()].sort((a, b) => {
    const diff = kind === 'time' ? a.time - b.time : b.score - a.score;
    return diff !== 0 ? diff : a.at - b.at;
  });
  return sorted.map((entry, index) => ({
    rank: index + 1,
    playerId: entry.playerId,
    name: entry.name,
    level: entry.level || 1,
    time: kind === 'time' ? entry.time : null,
    score: kind === 'score' ? entry.score : null,
    hasGhost: Boolean(entry.hasGhost),
    at: entry.at || 0,
    isMe: meId !== null && entry.playerId === meId,
  }));
}

export class Leaderboard {
  /**
   * @param {object} options
   * @param {string} [options.host]   API host (VITE_API_HOST); empty -> local only.
   * @param {{id:string, name:string, level?:number, xp?:number}} options.profile
   */
  constructor({ host = '', profile } = {}) {
    this.host = normalizeHost(host);
    this.profile = profile || { id: 'anonymous-player', name: 'Driver' };
    this.cache = new Map();
    this.ghostCache = new Map();
    /** 'online' while the last request reached the server, 'local' otherwise. */
    this.status = this.host ? 'online' : 'local';
  }

  updateProfile(profile) {
    if (profile) this.profile = { ...this.profile, ...profile };
  }

  get level() {
    return profileLevel(this.profile, levelForXp);
  }

  /**
   * @returns {Promise<{status:'online'|'local', entries:import('../core/contracts.js').LeaderboardEntry[]}>}
   */
  async top(modeId, limit = 50) {
    const kind = kindOf(modeId);
    if (!kind) return { status: this.host ? 'online' : 'local', entries: [] };
    const count = Math.max(1, Math.min(100, Math.floor(limit) || 50));
    if (this.host) {
      const key = `${modeId}|${count}`;
      const hit = this.cache.get(key);
      if (hit && Date.now() - hit.at < TOP_CACHE) return { status: 'online', entries: this.markMe(hit.entries) };
      try {
        const response = await fetchWithTimeout(`${this.host}/api/top?mode=${encodeURIComponent(modeId)}&limit=${count}`);
        if (!response.ok) throw new Error(`top ${response.status}`);
        const data = await response.json();
        const entries = (Array.isArray(data.entries) ? data.entries : []).slice(0, count).map((row, index) => ({
          rank: Number(row.rank) || index + 1,
          playerId: String(row.playerId),
          name: String(row.name),
          level: Number(row.level) || 1,
          time: kind === 'time' ? Number(row.time) : null,
          score: kind === 'score' ? Number(row.score) : null,
          hasGhost: Boolean(row.hasGhost),
          at: Number(row.at) || 0,
          isMe: false,
        }));
        this.cache.set(key, { at: Date.now(), entries });
        this.status = 'online';
        return { status: 'online', entries: this.markMe(entries) };
      } catch {
        this.status = 'local';
      }
    }
    return { status: 'local', entries: this.localTop(modeId, count) };
  }

  /**
   * Records a finished run. Timed events need the ghost string (src/ghost/ghostCodec.js) online.
   * @param {string} modeId
   * @param {import('../core/contracts.js').RunResult} runResult
   * @param {string|null} ghostString
   * @returns {Promise<{accepted:boolean, rank:(number|null), reason:(string|null), status:'online'|'local', improved?:boolean}>}
   */
  async submit(modeId, runResult, ghostString = null) {
    const kind = kindOf(modeId);
    if (!kind || !runResult) return { accepted: false, rank: null, reason: 'unranked-mode', status: this.host ? 'online' : 'local' };
    const value = kind === 'time' ? Number(runResult.time) : Number(runResult.score);
    if (!Number.isFinite(value)) return { accepted: false, rank: null, reason: kind === 'time' ? 'bad-time' : 'bad-score', status: 'local' };
    const ghost = typeof ghostString === 'string' && ghostString ? ghostString : null;
    const local = this.recordLocal(modeId, kind, value, ghost);

    if (this.host) {
      try {
        const { token, claimed } = await ensureToken(this.host, this.profile.id, this.profile.name);
        if (claimed) return { ...local, reason: 'identity-claimed', status: 'local' };
        if (!token) throw new Error('no token');
        const body = {
          modeId,
          playerId: this.profile.id,
          token,
          name: this.profile.name,
          level: this.level,
          ghost,
          ...(kind === 'time' ? { time: value } : { score: value }),
        };
        const response = await fetchWithTimeout(`${this.host}/api/score`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }, 10000);
        if (response.status >= 500) throw new Error(`score ${response.status}`);
        const data = await response.json();
        this.status = 'online';
        for (const key of this.cache.keys()) if (key.startsWith(`${modeId}|`)) this.cache.delete(key);
        this.ghostCache.delete(`${modeId}|${this.profile.id}`);
        return {
          accepted: Boolean(data.accepted),
          rank: Number.isFinite(data.rank) ? data.rank : null,
          reason: data.reason ?? null,
          improved: Boolean(data.improved),
          status: 'online',
        };
      } catch {
        this.status = 'local';
        return { ...local, reason: 'offline' };
      }
    }
    return local;
  }

  /** Base64 ghost of a player's best run in an event, or null. */
  async ghost(modeId, playerId) {
    if (!kindOf(modeId) || typeof playerId !== 'string' || !playerId) return null;
    if (this.host) {
      const key = `${modeId}|${playerId}`;
      const hit = this.ghostCache.get(key);
      if (hit && Date.now() - hit.at < GHOST_CACHE) return hit.ghost;
      try {
        const response = await fetchWithTimeout(`${this.host}/api/ghost?mode=${encodeURIComponent(modeId)}&player=${encodeURIComponent(playerId)}`, {}, 10000);
        if (!response.ok) throw new Error(`ghost ${response.status}`);
        const data = await response.json();
        const ghost = typeof data.ghost === 'string' ? data.ghost : null;
        this.ghostCache.set(key, { at: Date.now(), ghost });
        if (ghost) return ghost;
      } catch {
        // fall back to this browser's copy
      }
    }
    try {
      return storage()?.getItem(`${GHOST_PREFIX}${modeId}:${playerId}`) || null;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------- local board

  markMe(entries) {
    return entries.map((entry) => ({ ...entry, isMe: entry.playerId === this.profile.id }));
  }

  localTop(modeId, limit) {
    const board = readJson(BOARD_KEY, {});
    const rows = Array.isArray(board?.[modeId]) ? board[modeId] : [];
    return rankEntries(rows, kindOf(modeId), this.profile.id).slice(0, limit);
  }

  recordLocal(modeId, kind, value, ghost) {
    const board = readJson(BOARD_KEY, {}) || {};
    const rows = Array.isArray(board[modeId]) ? board[modeId] : [];
    const playerId = this.profile.id;
    const previous = rows.find((row) => row.playerId === playerId);
    const improved = !previous || (kind === 'time' ? value < previous.time : value > previous.score);
    if (improved) {
      const row = {
        playerId,
        name: this.profile.name,
        level: this.level,
        time: kind === 'time' ? value : null,
        score: kind === 'score' ? value : null,
        hasGhost: Boolean(ghost),
        at: Date.now(),
      };
      const next = rankEntries(rows.filter((r) => r.playerId !== playerId).concat(row), kind)
        .slice(0, LOCAL_MAX_PER_MODE)
        .map(({ rank, isMe, ...rest }) => rest);
      board[modeId] = next;
      writeJson(BOARD_KEY, board);
      if (ghost) {
        try {
          storage()?.setItem(`${GHOST_PREFIX}${modeId}:${playerId}`, ghost);
        } catch {
          row.hasGhost = false; // quota: keep the time without the replay
        }
      }
    }
    const ranked = rankEntries(board[modeId] || rows, kind, playerId);
    const mine = ranked.find((entry) => entry.playerId === playerId);
    return { accepted: true, rank: mine ? mine.rank : null, reason: improved ? null : 'not-a-personal-best', improved, status: 'local' };
  }
}
