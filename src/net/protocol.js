// Binary wire format for realtime car state, shared by the browser client, the Cloudflare room
// (server/src/Room.js) and the Node tests. No dependencies, no allocation on the hot path.
//
// Client -> server state packet, little endian, PACKET_SIZE bytes:
//   0  u8   type            MSG_STATE
//   1  u8   flags           FLAG_* bits
//   2  u32  time            sender clock in ms (performance.now() truncated, wraps every ~49 days)
//   6  f32  x, y, z         chassis origin, metres
//  18  i16  qx, qy, qz, qw  orientation * 32767
//  26  i16  vx, vy, vz      world velocity * 100 (cm/s, +-327 m/s)
//  32  i16  speed           forward speed * 100 (negative when reversing)
//  34  i8   steer           front wheel angle * 127 / STEER_RANGE
//
// Server -> client relay: one sender-index byte (0..255, assigned by the room) followed by the
// packet above, RELAY_SIZE bytes in total. Control messages (roster, join, leave) are JSON text.

export const PROTOCOL_VERSION = 1;
export const MSG_STATE = 1;
export const PACKET_SIZE = 35;
export const RELAY_SIZE = PACKET_SIZE + 1;
/** Largest binary frame a room accepts; anything bigger closes the connection. */
export const MAX_BINARY = 64;
/** Largest text frame a room accepts (profile updates). */
export const MAX_TEXT = 512;

export const FLAG_BRAKING = 1;
export const FLAG_BOOSTING = 2;
export const FLAG_DRIFTING = 4;
export const FLAG_REVERSING = 8;
export const FLAG_AIRBORNE = 16;

/** Radians that map to the full int8 steer range (same convention as ghost replays). */
export const STEER_RANGE = 0.6;

const Q = 32767;

function clampInt(value, min, max) {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value);
  return rounded < min ? min : rounded > max ? max : rounded;
}

function finite(value) {
  return Number.isFinite(value) ? value : 0;
}

/**
 * Writes one state packet.
 * @param {DataView} view           At least PACKET_SIZE bytes from `offset`.
 * @param {object} state            A VehicleState (position, quaternion, velocity, forwardSpeed, steerAngle).
 * @param {number} flags            FLAG_* bits.
 * @param {number} timeMs           Sender clock in ms.
 * @param {number} [offset=0]
 * @returns {number} bytes written (PACKET_SIZE)
 */
export function encodeState(view, state, flags, timeMs, offset = 0) {
  const p = state.position;
  const q = state.quaternion;
  const v = state.velocity || ZERO;
  let qx = finite(q.x), qy = finite(q.y), qz = finite(q.z), qw = finite(q.w);
  let len = Math.hypot(qx, qy, qz, qw);
  if (len < 1e-6) { qx = 0; qy = 0; qz = 0; qw = 1; len = 1; }
  // q and -q are the same rotation; keep w >= 0 so interpolation never takes the long way round.
  const sign = qw < 0 ? -1 / len : 1 / len;
  view.setUint8(offset, MSG_STATE);
  view.setUint8(offset + 1, flags & 0xff);
  view.setUint32(offset + 2, Math.floor(finite(timeMs)) >>> 0, true);
  view.setFloat32(offset + 6, finite(p.x), true);
  view.setFloat32(offset + 10, finite(p.y), true);
  view.setFloat32(offset + 14, finite(p.z), true);
  view.setInt16(offset + 18, clampInt(qx * sign * Q, -Q, Q), true);
  view.setInt16(offset + 20, clampInt(qy * sign * Q, -Q, Q), true);
  view.setInt16(offset + 22, clampInt(qz * sign * Q, -Q, Q), true);
  view.setInt16(offset + 24, clampInt(qw * sign * Q, -Q, Q), true);
  view.setInt16(offset + 26, clampInt(v.x * 100, -32767, 32767), true);
  view.setInt16(offset + 28, clampInt(v.y * 100, -32767, 32767), true);
  view.setInt16(offset + 30, clampInt(v.z * 100, -32767, 32767), true);
  const speed = state.forwardSpeed ?? state.speed ?? 0;
  view.setInt16(offset + 32, clampInt(speed * 100, -32767, 32767), true);
  view.setInt8(offset + 34, clampInt((state.steerAngle || 0) * 127 / STEER_RANGE, -127, 127));
  return PACKET_SIZE;
}

/** Fresh object with every field decodeState writes, so callers can reuse it. */
export function createSnapshot() {
  return {
    time: 0, flags: 0,
    x: 0, y: 0, z: 0,
    qx: 0, qy: 0, qz: 0, qw: 1,
    vx: 0, vy: 0, vz: 0,
    speed: 0, steer: 0,
    braking: false, boosting: false, drifting: false, reversing: false, airborne: false,
  };
}

/**
 * Reads one state packet into `out`. Returns false (leaving `out` untouched) when the bytes are
 * not a valid packet, so a bad peer can never inject NaN into the scene.
 * @param {DataView} view
 * @param {number} offset
 * @param {object} out   From createSnapshot().
 */
export function decodeState(view, offset, out) {
  if (view.byteLength - offset < PACKET_SIZE) return false;
  if (view.getUint8(offset) !== MSG_STATE) return false;
  const x = view.getFloat32(offset + 6, true);
  const y = view.getFloat32(offset + 10, true);
  const z = view.getFloat32(offset + 14, true);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
  if (Math.abs(x) > 1e6 || Math.abs(y) > 1e6 || Math.abs(z) > 1e6) return false;
  let qx = view.getInt16(offset + 18, true) / Q;
  let qy = view.getInt16(offset + 20, true) / Q;
  let qz = view.getInt16(offset + 22, true) / Q;
  let qw = view.getInt16(offset + 24, true) / Q;
  const len = Math.hypot(qx, qy, qz, qw);
  if (len < 0.5) { qx = 0; qy = 0; qz = 0; qw = 1; } else { qx /= len; qy /= len; qz /= len; qw /= len; }
  const flags = view.getUint8(offset + 1);
  out.flags = flags;
  out.time = view.getUint32(offset + 2, true);
  out.x = x; out.y = y; out.z = z;
  out.qx = qx; out.qy = qy; out.qz = qz; out.qw = qw;
  out.vx = view.getInt16(offset + 26, true) / 100;
  out.vy = view.getInt16(offset + 28, true) / 100;
  out.vz = view.getInt16(offset + 30, true) / 100;
  out.speed = view.getInt16(offset + 32, true) / 100;
  out.steer = view.getInt8(offset + 34) * STEER_RANGE / 127;
  out.braking = (flags & FLAG_BRAKING) !== 0;
  out.boosting = (flags & FLAG_BOOSTING) !== 0;
  out.drifting = (flags & FLAG_DRIFTING) !== 0;
  out.reversing = (flags & FLAG_REVERSING) !== 0;
  out.airborne = (flags & FLAG_AIRBORNE) !== 0;
  return true;
}

/** Builds the flags byte from the extras passed to NetClient.sendState and the vehicle state. */
export function packFlags(extras, state) {
  let flags = 0;
  if (extras?.braking) flags |= FLAG_BRAKING;
  if (extras?.boosting ?? state?.boosting) flags |= FLAG_BOOSTING;
  if (extras?.drifting) flags |= FLAG_DRIFTING;
  if (state?.gear === 'R' || (state?.forwardSpeed ?? 0) < -0.5) flags |= FLAG_REVERSING;
  if (state?.airborne) flags |= FLAG_AIRBORNE;
  return flags;
}

const ZERO = Object.freeze({ x: 0, y: 0, z: 0 });
