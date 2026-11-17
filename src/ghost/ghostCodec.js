// Ghost serialisation: GhostData <-> compact base64 string, for localStorage and upload.
//
// Binary layout (version 1), all multi-byte numbers little-endian:
//   'S' 'G'          magic
//   u8  version      GHOST_VERSION
//   u8  flags        reserved, 0
//   f64 time, f64 score
//   varint rate, varint count
//   3 strings        modeId, name, paint: varint byte length + UTF-8
//   8 channels       x, y, z (millimetres), qx, qy, qz, qw (the Int16 values), steer (the Int8 values)
//                    each as count zigzag varints of the second difference v[i] - 2 v[i-1] + v[i-2]
//                    (first difference for i = 1, raw for i = 0). Motion is smooth, so most are 1 byte.
//   u32 checksum     FNV-1a of everything before it
//
// A steer value of -128 (STEER_TELEPORT) marks the first sample after a respawn: playback snaps to it
// instead of interpolating, and its steer angle reads as 0. Normal steer values are clamped to +-127.

export const GHOST_VERSION = 1;
/** Steer byte that flags a teleport (respawn) sample. */
export const STEER_TELEPORT = -128;
/** Radians represented by a steer byte of 127. */
export const STEER_SCALE = 0.6;

const MAGIC_0 = 0x53; // 'S'
const MAGIC_1 = 0x47; // 'G'
const MAX_COUNT = 200000; // ~5.5 hours at 10 Hz: anything larger is garbage.
const MAX_STRING = 256;

const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { fatal: false }) : null;

// ------------------------------------------------------------------ byte writer / reader

class Writer {
  constructor(capacity = 4096) {
    this.bytes = new Uint8Array(capacity);
    this.length = 0;
    this.view = new DataView(this.bytes.buffer);
  }

  reserve(n) {
    if (this.length + n <= this.bytes.length) return;
    let size = this.bytes.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.bytes.subarray(0, this.length));
    this.bytes = next;
    this.view = new DataView(next.buffer);
  }

  u8(value) {
    this.reserve(1);
    this.bytes[this.length++] = value & 0xff;
  }

  f64(value) {
    this.reserve(8);
    this.view.setFloat64(this.length, value, true);
    this.length += 8;
  }

  u32(value) {
    this.reserve(4);
    this.view.setUint32(this.length, value >>> 0, true);
    this.length += 4;
  }

  /** Unsigned varint; plain arithmetic so values beyond 2^31 stay exact. */
  varint(value) {
    this.reserve(8);
    let v = value;
    while (v >= 128) {
      this.bytes[this.length++] = (v % 128) | 128;
      v = Math.floor(v / 128);
    }
    this.bytes[this.length++] = v;
  }

  zigzag(value) {
    this.varint(value >= 0 ? value * 2 : -value * 2 - 1);
  }

  string(text) {
    const bytes = utf8Encode(String(text ?? '')).subarray(0, MAX_STRING);
    this.varint(bytes.length);
    this.reserve(bytes.length);
    this.bytes.set(bytes, this.length);
    this.length += bytes.length;
  }

  finish() {
    return this.bytes.subarray(0, this.length);
  }
}

class Reader {
  constructor(bytes, end) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = 0;
    this.end = end;
    this.ok = true;
  }

  need(n) {
    if (this.offset + n > this.end) this.ok = false;
    return this.ok;
  }

  u8() {
    if (!this.need(1)) return 0;
    return this.bytes[this.offset++];
  }

  f64() {
    if (!this.need(8)) return 0;
    const value = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return value;
  }

  varint() {
    let value = 0;
    let scale = 1;
    for (let i = 0; i < 8; i += 1) {
      if (!this.need(1)) return 0;
      const byte = this.bytes[this.offset++];
      value += (byte & 127) * scale;
      if (byte < 128) return value;
      scale *= 128;
    }
    this.ok = false;
    return 0;
  }

  zigzag() {
    const v = this.varint();
    return v % 2 === 0 ? v / 2 : -(v + 1) / 2;
  }

  string() {
    const length = this.varint();
    if (length > MAX_STRING || !this.need(length)) {
      this.ok = false;
      return '';
    }
    const text = utf8Decode(this.bytes.subarray(this.offset, this.offset + length));
    this.offset += length;
    return text;
  }
}

function utf8Encode(text) {
  if (encoder) return encoder.encode(text);
  const bytes = [];
  for (const ch of unescape(encodeURIComponent(text))) bytes.push(ch.charCodeAt(0));
  return Uint8Array.from(bytes);
}

function utf8Decode(bytes) {
  if (decoder) return decoder.decode(bytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  try {
    return decodeURIComponent(escape(binary));
  } catch {
    return binary;
  }
}

function fnv1a(bytes, end) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < end; i += 1) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// ------------------------------------------------------------------ base64

function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text) {
  // Accept URL-safe base64, missing padding and stray whitespace.
  let clean = text.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  while (clean.length % 4 !== 0) clean += '=';
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ------------------------------------------------------------------ channels

function writeChannel(writer, count, valueAt) {
  let prev = 0;
  let prevDelta = 0;
  for (let i = 0; i < count; i += 1) {
    const value = valueAt(i);
    const delta = value - prev;
    writer.zigzag(i === 0 ? value : i === 1 ? delta : delta - prevDelta);
    prevDelta = i === 0 ? 0 : delta;
    prev = value;
  }
}

/** Reads `count` values into `out[i * stride + offset]`; returns false when a value leaves [min, max]. */
function readChannel(reader, count, out, stride, offset, min, max, scale = 1) {
  let prev = 0;
  let delta = 0;
  for (let i = 0; i < count; i += 1) {
    const residual = reader.zigzag();
    if (!reader.ok) return false;
    let value;
    if (i === 0) value = residual;
    else {
      delta = i === 1 ? residual : delta + residual;
      value = prev + delta;
    }
    if (!(value >= min && value <= max)) return false;
    out[i * stride + offset] = value * scale;
    prev = value;
  }
  return true;
}

function validGhostShape(ghost) {
  if (!ghost || typeof ghost !== 'object') return false;
  const count = ghost.count;
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) return false;
  if (!(ghost.positions?.length >= count * 3)) return false;
  if (!(ghost.rotations?.length >= count * 4)) return false;
  if (!(ghost.steer?.length >= count)) return false;
  return Number.isFinite(ghost.rate) && ghost.rate > 0 && ghost.rate <= 240;
}

// ------------------------------------------------------------------ public API

/**
 * @param {import('../core/contracts.js').GhostData} ghost
 * @returns {string|null} base64, or null when the ghost is malformed.
 */
export function encodeGhost(ghost) {
  try {
    if (!validGhostShape(ghost)) return null;
    const { count, positions, rotations, steer } = ghost;
    const writer = new Writer(64 + count * 12);
    writer.u8(MAGIC_0);
    writer.u8(MAGIC_1);
    writer.u8(GHOST_VERSION);
    writer.u8(0);
    writer.f64(Number.isFinite(ghost.time) ? ghost.time : 0);
    writer.f64(Number.isFinite(ghost.score) ? ghost.score : 0);
    writer.varint(Math.round(ghost.rate));
    writer.varint(count);
    writer.string(ghost.modeId);
    writer.string(ghost.name);
    writer.string(ghost.paint);
    // Positions in whole millimetres; a non-finite coordinate repeats the previous one.
    for (let axis = 0; axis < 3; axis += 1) {
      let last = 0;
      writeChannel(writer, count, (i) => {
        const v = positions[i * 3 + axis];
        if (Number.isFinite(v)) last = Math.round(v * 1000);
        return last;
      });
    }
    for (let c = 0; c < 4; c += 1) {
      writeChannel(writer, count, (i) => Math.max(-32767, Math.min(32767, Math.round(rotations[i * 4 + c]) || 0)));
    }
    writeChannel(writer, count, (i) => Math.max(-128, Math.min(127, Math.round(steer[i]) || 0)));
    writer.u32(fnv1a(writer.bytes, writer.length));
    return toBase64(writer.finish());
  } catch {
    return null;
  }
}

/**
 * @param {string} text  Output of encodeGhost.
 * @returns {import('../core/contracts.js').GhostData|null} null for anything that is not a valid ghost.
 */
export function decodeGhost(text) {
  try {
    if (typeof text !== 'string' || text.length < 16 || text.length > 8e6) return null;
    const bytes = fromBase64(text);
    if (bytes.length < 30 || bytes[0] !== MAGIC_0 || bytes[1] !== MAGIC_1) return null;
    const end = bytes.length - 4;
    const stored = new DataView(bytes.buffer, bytes.byteOffset + end, 4).getUint32(0, true);
    if (stored !== fnv1a(bytes, end)) return null;
    const reader = new Reader(bytes, end);
    reader.offset = 2;
    const version = reader.u8();
    if (version !== GHOST_VERSION) return null;
    reader.u8(); // flags
    const time = reader.f64();
    const score = reader.f64();
    const rate = reader.varint();
    const count = reader.varint();
    const modeId = reader.string();
    const name = reader.string();
    const paint = reader.string();
    if (!reader.ok || !Number.isFinite(time) || !Number.isFinite(score)) return null;
    if (!(rate >= 1 && rate <= 240) || !(count >= 1 && count <= MAX_COUNT)) return null;
    // Every sample needs at least 8 bytes (one per channel): reject impossible counts before allocating.
    if (count * 8 > end - reader.offset) return null;

    const positions = new Float32Array(count * 3);
    const rotations = new Int16Array(count * 4);
    const steer = new Int8Array(count);
    for (let axis = 0; axis < 3; axis += 1) {
      if (!readChannel(reader, count, positions, 3, axis, -1e9, 1e9, 0.001)) return null;
    }
    for (let c = 0; c < 4; c += 1) {
      if (!readChannel(reader, count, rotations, 4, c, -32767, 32767)) return null;
    }
    if (!readChannel(reader, count, steer, 1, 0, -128, 127)) return null;
    if (reader.offset !== end) return null;
    return { version, modeId, name, time, score, rate, count, positions, rotations, steer, paint };
  } catch {
    return null;
  }
}
