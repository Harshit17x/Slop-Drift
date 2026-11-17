// Pure validation for the Slop Drift backend. No Workers APIs beyond Web Crypto, so Node can import
// and test it directly (tests/net.test.mjs). Event ids and medal targets come straight from the game
// source, so the server can never disagree with the client about which events exist.

import { MODES } from '../../src/config.js';
import { MEDAL_TARGETS } from '../../src/meta/catalog.js';

/** Every event id; each one gets a realtime room. */
export const ROOM_MODES = Object.freeze(MODES.map((mode) => mode.id));
/** Events with a leaderboard (all but free roam). */
export const RANKED_MODES = Object.freeze(Object.keys(MEDAL_TARGETS));

export const MAX_ROOM_SIZE = 16;
/** Ghost strings are base64; 64 KiB of text is ~48 KiB of codec bytes (~10 min at 10 Hz). */
export const MAX_GHOST_CHARS = 65536;
export const MIN_GHOST_CHARS = 40;
/** Allowed gap between the claimed time and the ghost's recorded duration. */
export const GHOST_TIME_TOLERANCE = 1.5;
export const SUBMIT_INTERVAL_MS = 10_000;
/** Generous ceiling on any timed run (an hour). */
export const MAX_TIME = 3600;

/**
 * Plausibility limits for one event: author * 0.85 is the fastest believable time,
 * author * 1.6 the highest believable drift score.
 * @returns {{kind:'time'|'score', minTime:number, maxScore:number}|null}
 */
export function limitsFor(modeId) {
  const targets = Object.prototype.hasOwnProperty.call(MEDAL_TARGETS, modeId) ? MEDAL_TARGETS[modeId] : null;
  if (!targets) return null;
  return targets.kind === 'time'
    ? { kind: 'time', minTime: targets.author * 0.85, maxScore: 0 }
    : { kind: 'score', minTime: 0, maxScore: targets.author * 1.6 };
}

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} _.\-]{0,14}[\p{L}\p{N}_.\-]$/u;

/** Trimmed display name when it is 2-16 letters, digits, space, _ . - (no leading/trailing or double spaces), else null. */
export function sanitizeName(name) {
  if (typeof name !== 'string') return null;
  const trimmed = name.normalize('NFC').trim();
  if ([...trimmed].length < 2 || [...trimmed].length > 16) return null;
  if (!NAME_RE.test(trimmed) || /\s{2,}/.test(trimmed)) return null;
  return trimmed;
}

/** Profile ids are random UUIDs; accept any 8-64 char id of letters, digits, '-' and '_'. */
export function isValidPlayerId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id);
}

export function sanitizeLevel(level) {
  const n = Math.floor(Number(level));
  return Number.isFinite(n) ? Math.max(1, Math.min(99, n)) : 1;
}

/** Cosmetic ids (paint, rim): short lowercase slugs. Door number: 1-2 digits. */
export function sanitizeCosmetic(value, kind = 'id') {
  const text = typeof value === 'string' ? value : value == null ? '' : String(value);
  if (kind === 'number') return /^\d{1,2}$/.test(text) ? text : '';
  return /^[a-z0-9-]{1,24}$/.test(text) ? text : '';
}

// ------------------------------------------------------------------ tokens

const encoder = new TextEncoder();

function toBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const keyCache = new Map();
async function hmacKey(secret) {
  let key = keyCache.get(secret);
  if (!key) {
    key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    keyCache.set(secret, key);
  }
  return key;
}

/** Player token: base64url(HMAC-SHA256(secret, playerId)). */
export async function signToken(secret, playerId) {
  if (!secret) throw new Error('TOKEN_SECRET is not configured');
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(`player:${playerId}`));
  return toBase64Url(new Uint8Array(signature));
}

/** Constant-time comparison of a presented token with the expected one. */
export async function verifyToken(secret, playerId, token) {
  if (!secret || !isValidPlayerId(playerId) || typeof token !== 'string' || token.length < 20 || token.length > 100) return false;
  const expected = await signToken(secret, playerId);
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

// ------------------------------------------------------------------ origins

/**
 * True when `origin` matches the comma-separated allow-list. Entries may contain one '*' wildcard
 * (e.g. https://slop-drift-*.vercel.app for preview deployments).
 */
export function originAllowed(origin, allowList) {
  if (typeof origin !== 'string' || !origin) return false;
  const entries = String(allowList || '').split(',').map((entry) => entry.trim()).filter(Boolean);
  for (const entry of entries) {
    if (entry === origin) return true;
    const star = entry.indexOf('*');
    if (star >= 0) {
      const head = entry.slice(0, star);
      const tail = entry.slice(star + 1);
      const middle = origin.slice(head.length, origin.length - tail.length);
      if (origin.length >= head.length + tail.length && origin.startsWith(head) && origin.endsWith(tail) && /^[a-z0-9-]+$/i.test(middle)) return true;
    }
  }
  return false;
}

// ------------------------------------------------------------------ ghosts

function base64Bytes(text, maxBytes) {
  const clean = text.replace(/-/g, '+').replace(/_/g, '/');
  // Only decode the prefix we need: 4 base64 chars -> 3 bytes.
  const chars = Math.min(clean.length - (clean.length % 4), Math.ceil(maxBytes / 3) * 4);
  const binary = atob(clean.slice(0, chars));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Reads only the header of a ghost string written by src/ghost/ghostCodec.js (version 1):
 *   'S' 'G', u8 version, u8 flags, f64 time, f64 score (LE), varint rate, varint count, string modeId.
 * Sample i is at t = i / rate, so the recorded duration is (count - 1) / rate.
 * @returns {{version:number, time:number, score:number, rate:number, count:number, modeId:string, duration:number}|null}
 */
export function decodeGhostHeader(text) {
  try {
    if (typeof text !== 'string' || text.length < MIN_GHOST_CHARS || text.length > MAX_GHOST_CHARS) return null;
    if (!/^[A-Za-z0-9+/_=-]+$/.test(text)) return null;
    const bytes = base64Bytes(text, 96);
    if (bytes.length < 24 || bytes[0] !== 0x53 || bytes[1] !== 0x47) return null;
    const view = new DataView(bytes.buffer);
    const version = bytes[2];
    if (version !== 1) return null;
    const time = view.getFloat64(4, true);
    const score = view.getFloat64(12, true);
    let offset = 20;
    const varint = () => {
      let value = 0;
      let scale = 1;
      for (let i = 0; i < 5 && offset < bytes.length; i += 1) {
        const byte = bytes[offset++];
        value += (byte & 127) * scale;
        if (byte < 128) return value;
        scale *= 128;
      }
      return -1;
    };
    const rate = varint();
    const count = varint();
    const modeLength = varint();
    if (!(rate >= 1 && rate <= 240) || !(count >= 2) || !(modeLength >= 0 && modeLength <= 32)) return null;
    if (offset + modeLength > bytes.length) return null;
    let modeId = '';
    for (let i = 0; i < modeLength; i += 1) modeId += String.fromCharCode(bytes[offset + i]);
    if (!Number.isFinite(time) || !Number.isFinite(score)) return null;
    return { version, time, score, rate, count, modeId, duration: (count - 1) / rate };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ submissions

/**
 * Checks a POST /api/score body apart from the token and the rate limit (which need the secret and
 * the database). Returns the normalised row to store, or the reason it was rejected.
 * @returns {{ok:true, entry:{modeId:string, playerId:string, name:string, level:number, time:(number|null), score:(number|null), ghost:(string|null)}} | {ok:false, reason:string}}
 */
export function validateSubmission(body) {
  if (!body || typeof body !== 'object') return { ok: false, reason: 'bad-request' };
  const { modeId, playerId } = body;
  if (!isValidPlayerId(playerId)) return { ok: false, reason: 'bad-player' };
  const limits = limitsFor(modeId);
  if (!limits) return { ok: false, reason: 'unknown-mode' };
  const name = sanitizeName(body.name);
  if (!name) return { ok: false, reason: 'bad-name' };
  const level = sanitizeLevel(body.level);
  const ghost = body.ghost == null || body.ghost === '' ? null : body.ghost;
  if (ghost !== null && (typeof ghost !== 'string' || ghost.length > MAX_GHOST_CHARS)) return { ok: false, reason: 'ghost-too-large' };

  if (limits.kind === 'time') {
    const time = Number(body.time);
    if (typeof body.time !== 'number' || !Number.isFinite(time)) return { ok: false, reason: 'bad-time' };
    if (time < limits.minTime) return { ok: false, reason: 'implausible-time' };
    if (time > MAX_TIME) return { ok: false, reason: 'bad-time' };
    if (!ghost) return { ok: false, reason: 'ghost-required' };
    const header = decodeGhostHeader(ghost);
    if (!header) return { ok: false, reason: 'bad-ghost' };
    if (header.modeId !== modeId) return { ok: false, reason: 'ghost-mode-mismatch' };
    if (Math.abs(header.duration - time) > GHOST_TIME_TOLERANCE) return { ok: false, reason: 'ghost-time-mismatch' };
    return { ok: true, entry: { modeId, playerId, name, level, time, score: null, ghost } };
  }

  const score = Number(body.score);
  if (typeof body.score !== 'number' || !Number.isFinite(score) || score < 0) return { ok: false, reason: 'bad-score' };
  if (score > limits.maxScore) return { ok: false, reason: 'implausible-score' };
  if (ghost) {
    const header = decodeGhostHeader(ghost);
    if (!header || header.modeId !== modeId) return { ok: false, reason: 'bad-ghost' };
  }
  return { ok: true, entry: { modeId, playerId, name, level, time: null, score: Math.round(score), ghost } };
}

/** Parameters a client passes when opening a room socket, cleaned up. Null when unusable. */
export function parseJoinParams(searchParams) {
  const get = (key) => searchParams.get(key);
  const playerId = get('playerId');
  if (!isValidPlayerId(playerId)) return null;
  const name = sanitizeName(get('name'));
  if (!name) return null;
  return {
    playerId,
    name,
    level: sanitizeLevel(get('level')),
    paint: sanitizeCosmetic(get('paint')),
    rim: sanitizeCosmetic(get('rim')),
    number: sanitizeCosmetic(get('number'), 'number'),
    token: get('token') || '',
  };
}
