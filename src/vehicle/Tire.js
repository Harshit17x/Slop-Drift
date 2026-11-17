// Simplified peaked tyre curve (Pacejka-like shape without the trig).

/**
 * Normalised lateral force for a slip angle expressed in units of the peak slip angle.
 * Rises as x(2 - x) to 1 at x = 1, then decays exponentially toward `slideRatio`.
 * @param {number} x           |slip angle| / peak slip angle (>= 0)
 * @param {number} slideRatio  force fraction when fully sliding (0..1)
 * @param {number} falloff     decay rate beyond the peak, per peak-slip unit
 */
export function lateralCurve(x, slideRatio, falloff) {
  if (!(x > 0)) return 0;
  if (x <= 1) return x * (2 - x);
  return slideRatio + (1 - slideRatio) * Math.exp(-(x - 1) * falloff);
}
