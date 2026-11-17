// Small allocation-free math helpers shared by every module.

export const TAU = Math.PI * 2;
export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export function saturate(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function inverseLerp(a, b, value) {
  return a === b ? 0 : (value - a) / (b - a);
}

export function remap(value, inMin, inMax, outMin, outMax) {
  return lerp(outMin, outMax, saturate(inverseLerp(inMin, inMax, value)));
}

export function smoothstep(edge0, edge1, value) {
  const t = saturate((value - edge0) / (edge1 - edge0 || 1e-9));
  return t * t * (3 - 2 * t);
}

/** Frame-rate independent exponential approach factor: lerp(current, target, dampFactor(rate, dt)). */
export function dampFactor(rate, dt) {
  return 1 - Math.exp(-rate * dt);
}

export function damp(current, target, rate, dt) {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

/** Move `current` toward `target` by at most `maxDelta`. */
export function approach(current, target, maxDelta) {
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(angle) {
  let a = (angle + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Positive modulo. */
export function mod(value, n) {
  return ((value % n) + n) % n;
}

export function sign(value) {
  return value < 0 ? -1 : 1;
}

export function finiteOr(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}
