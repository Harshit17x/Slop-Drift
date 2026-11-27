// Per-car performance upgrade definitions and tuning overrides.
// Pure data + helpers: no DOM, no THREE, runs in Node tests and the browser.

export const UPGRADE_SLOTS = Object.freeze([
  Object.freeze({
    id: 'engine',
    label: 'Engine & Turbo',
    summary: 'Boosts peak torque, redline RPM, and shift speed.',
    stages: Object.freeze([
      Object.freeze({ stage: 1, level: 1, cost: 210, label: 'Stage 1 Intake', effect: '+8% torque · +250 RPM', torqueMult: 1.08, rpmAdd: 250, shiftMult: 0.96 }),
      Object.freeze({ stage: 2, level: 5, cost: 510, label: 'Stage 2 Twin-Scroll', effect: '+17% torque · +500 RPM', torqueMult: 1.17, rpmAdd: 500, shiftMult: 0.90 }),
      Object.freeze({ stage: 3, level: 9, cost: 1080, label: 'Stage 3 Forged Build', effect: '+28% torque · +800 RPM', torqueMult: 1.28, rpmAdd: 800, shiftMult: 0.80 }),
    ]),
  }),
  Object.freeze({
    id: 'tires',
    label: 'Tires & Angle Kit',
    summary: 'Improves cornering grip, drift control, and steering lock.',
    stages: Object.freeze([
      Object.freeze({ stage: 1, level: 2, cost: 200, label: 'Semi-Slick Compound', effect: '+5% grip · +2° lock', muMult: 1.05, lockAdd: 2, slideAdd: 0.03 }),
      Object.freeze({ stage: 2, level: 5, cost: 460, label: 'Wide Drift Angle Kit', effect: '+11% grip · +4° lock', muMult: 1.11, lockAdd: 4, slideAdd: 0.05 }),
      Object.freeze({ stage: 3, level: 9, cost: 990, label: 'Pro Spec Compounds', effect: '+18% grip · +7° lock', muMult: 1.18, lockAdd: 7, slideAdd: 0.07 }),
    ]),
  }),
  Object.freeze({
    id: 'nitro',
    label: 'Nitrous System',
    summary: 'Installs or upgrades N2O tank size, boost punch, and drift refill.',
    stages: Object.freeze([
      Object.freeze({ stage: 1, level: 2, cost: 270, label: 'Dry Shot N2O Kit', effect: 'Equips N2O · +15% power', capMult: 1.15, forceMult: 1.08, refillMult: 1.15 }),
      Object.freeze({ stage: 2, level: 5, cost: 580, label: 'Dual Purge Bottle', effect: '+35% tank · +16% power', capMult: 1.35, forceMult: 1.16, refillMult: 1.30 }),
      Object.freeze({ stage: 3, level: 9, cost: 1200, label: 'Direct-Port Cryo N2O', effect: '+60% tank · +25% power', capMult: 1.60, forceMult: 1.25, refillMult: 1.50 }),
    ]),
  }),
  Object.freeze({
    id: 'chassis',
    label: 'Weight & Brakes',
    summary: 'Strips chassis weight and fits larger multi-piston brake rotors.',
    stages: Object.freeze([
      Object.freeze({ stage: 1, level: 2, cost: 180, label: 'Sport Pads & Stripped Trim', effect: '-4% mass · +8% brakes', massMult: 0.96, brakeMult: 1.08 }),
      Object.freeze({ stage: 2, level: 5, cost: 440, label: 'Carbon Hood & 6-Pot Calipers', effect: '-8% mass · +16% brakes', massMult: 0.92, brakeMult: 1.16 }),
      Object.freeze({ stage: 3, level: 9, cost: 930, label: 'Full Cage & Carbon Ceramic', effect: '-13% mass · +25% brakes', massMult: 0.87, brakeMult: 1.25 }),
    ]),
  }),
]);

export const MAX_UPGRADE_STAGE = 3;

export function getUpgradeSlot(slotId) {
  return UPGRADE_SLOTS.find((slot) => slot.id === slotId) || null;
}

export function normalizeCarUpgrades(raw) {
  const out = { engine: 0, tires: 0, nitro: 0, chassis: 0 };
  if (!raw || typeof raw !== 'object') return out;
  for (const slot of UPGRADE_SLOTS) {
    const val = Math.floor(Number(raw[slot.id]) || 0);
    out[slot.id] = Math.max(0, Math.min(MAX_UPGRADE_STAGE, val));
  }
  return out;
}

function stageSpec(slotId, stage) {
  if (!stage || stage <= 0) return null;
  const slot = getUpgradeSlot(slotId);
  return slot?.stages?.find((s) => s.stage === stage) || null;
}

/** True when the car has nitrous either from factory or from Stage 1+ Nitrous upgrade. */
export function hasCarNitro(car, upgrades = null) {
  const u = normalizeCarUpgrades(upgrades);
  return Boolean(car?.nitro || u.nitro > 0);
}

/** Nitro multipliers derived from the installed Nitrous stage. */
export function effectiveNitroStats(baseNitro, upgrades = null) {
  const u = normalizeCarUpgrades(upgrades);
  const spec = stageSpec('nitro', u.nitro);
  const capMult = spec?.capMult ?? 1;
  const forceMult = spec?.forceMult ?? 1;
  const refillMult = spec?.refillMult ?? 1;
  return {
    capacity: Math.round((baseNitro?.capacity ?? 100) * capMult),
    drainPerSecond: baseNitro?.drainPerSecond ?? 24,
    refillPerSecond: (baseNitro?.refillPerSecond ?? 6) * refillMult,
    driftRefill: (baseNitro?.driftRefill ?? 9) * refillMult,
    forceMultiplier: (baseNitro?.forceMultiplier ?? 1.35) * forceMult,
  };
}

/**
 * Returns a fresh tuning override object merging the car's stock tuning with installed upgrades.
 * Safe to pass directly into Vehicle.setHandling(presetName, overrides).
 */
export function applyCarUpgrades(car, upgrades = null) {
  const base = car?.tuning || {};
  const u = normalizeCarUpgrades(upgrades);
  if (!u.engine && !u.tires && !u.chassis) return base;

  const engine = stageSpec('engine', u.engine);
  const tires = stageSpec('tires', u.tires);
  const chassis = stageSpec('chassis', u.chassis);

  const out = {
    ...base,
    drivetrain: base.drivetrain ? { ...base.drivetrain } : {},
    tire: base.tire ? { ...base.tire } : {},
    steering: base.steering ? { ...base.steering } : {},
    brakes: base.brakes ? { ...base.brakes } : {},
  };

  if (engine) {
    const baseTorque = out.drivetrain.peakTorque ?? 360;
    const baseRedline = out.drivetrain.redlineRpm ?? 7000;
    const baseLimiter = out.drivetrain.limiterRpm ?? (baseRedline + 200);
    const baseUpshift = out.drivetrain.upshiftRpm ?? (baseRedline - 250);
    const baseShift = out.drivetrain.shiftTime ?? 0.12;
    out.drivetrain.peakTorque = Math.round(baseTorque * engine.torqueMult);
    out.drivetrain.redlineRpm = baseRedline + engine.rpmAdd;
    out.drivetrain.limiterRpm = baseLimiter + engine.rpmAdd;
    out.drivetrain.upshiftRpm = baseUpshift + engine.rpmAdd;
    out.drivetrain.shiftTime = Math.max(0.03, Number((baseShift * engine.shiftMult).toFixed(3)));
  }

  if (tires) {
    const baseMu = out.tire.mu ?? 1.15;
    const baseSlide = out.tire.slideRatio ?? 0.86;
    const baseMaxLock = out.steering.maxLockDeg ?? 36;
    const baseMechLock = out.steering.mechanicalLockDeg ?? (baseMaxLock + 6);
    out.tire.mu = Number((baseMu * tires.muMult).toFixed(3));
    out.tire.slideRatio = Math.min(0.98, Number((baseSlide + tires.slideAdd).toFixed(3)));
    out.steering.maxLockDeg = baseMaxLock + tires.lockAdd;
    out.steering.mechanicalLockDeg = baseMechLock + tires.lockAdd;
  }

  if (chassis) {
    const baseMass = out.mass ?? car?.specs?.massKg ?? 1350;
    const baseBrake = out.brakes.maxForce ?? 18000;
    out.mass = Math.round(baseMass * chassis.massMult);
    out.brakes.maxForce = Math.round(baseBrake * chassis.brakeMult);
  }

  return out;
}

const clampRating = (v) => Math.max(1, Math.min(10, Number(v.toFixed(1))));

/** Computes live garage rating bars (1..10) reflecting installed upgrades. */
export function effectiveCarRatings(car, upgrades = null) {
  const base = car?.ratings || { acceleration: 6.5, topSpeed: 6.5, handling: 7.0, control: 7.5 };
  const u = normalizeCarUpgrades(upgrades);
  return {
    acceleration: clampRating(base.acceleration + u.engine * 0.42 + u.nitro * 0.25 + u.chassis * 0.18),
    topSpeed: clampRating(base.topSpeed + u.engine * 0.38 + u.nitro * 0.28 + u.chassis * 0.08),
    handling: clampRating(base.handling + u.tires * 0.40 + u.chassis * 0.26),
    control: clampRating(base.control + u.tires * 0.32 + u.chassis * 0.18),
  };
}

/** Computes dynamic class rank & badge code (e.g. B185 -> A232 -> S290). */
export function effectiveClassInfo(car, upgrades = null) {
  const u = normalizeCarUpgrades(upgrades);
  const delta = u.engine * 18 + u.tires * 14 + u.nitro * 10 + u.chassis * 12;
  const rank = (car?.classRank || 180) + delta;
  let band = 'c';
  let prefix = 'C';
  if (rank >= 285) {
    band = 's';
    prefix = 'S';
  } else if (rank >= 225) {
    band = 'a';
    prefix = 'A';
  } else if (rank >= 175) {
    band = 'b';
    prefix = 'B';
  }
  return { rank, band, code: `${prefix}${rank}` };
}
