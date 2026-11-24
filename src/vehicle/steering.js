// Partial Ackermann geometry. The inside tyre follows a tighter arc in hairpins,
// while the modest split keeps both fronts closer to parallel at drift lock.
export function frontWheelAngle(rackAngle, lateralOffset, wheelbase) {
  const tangent = Math.tan(rackAngle);
  return Math.atan2(tangent, 1 - 0.55 * lateralOffset * tangent / wheelbase);
}
