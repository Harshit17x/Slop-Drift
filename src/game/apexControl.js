// Fictional event rules. Hazard timers run in simulation time and freeze on pause.
export const flagColors = {
  GREEN: 0x45d878, YELLOW: 0xffc735, 'FULL COURSE YELLOW': 0xffb622,
  RED: 0xfe3b36, BLUE: 0x438aff, CHEQUERED: 0xffffff
};

export function controlFlag(session, state, grid, playerDistance, incidentSeconds) {
  if (session.finished) return 'CHEQUERED';
  if (incidentSeconds >= 1.7) return 'RED';
  if (incidentSeconds >= .8) return 'FULL COURSE YELLOW';
  if (session.wrongWay || session.offRoad || state.upsideDown) return 'YELLOW';
  const lap = session.roadLength;
  const lapping = grid.some(bot => {
    const gap = bot.d - playerDistance, untilPass = lap - ((gap % lap + lap) % lap);
    return !bot.done && !bot.inPit && gap > lap * .8 && untilPass < 45 && bot.speed > state.speed + 1;
  });
  return lapping ? 'BLUE' : 'GREEN';
}

export function capUnderFlag(flag) {
  return flag === 'RED' ? 0 : flag === 'FULL COURSE YELLOW' ? 80 / 3.6 : Infinity;
}
