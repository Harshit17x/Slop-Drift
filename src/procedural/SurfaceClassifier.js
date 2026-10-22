import * as THREE from 'three';

export const SURFACE_PROFILES = Object.freeze({
  asphalt: Object.freeze({ name: 'asphalt', friction: 1, rollingResistance: 0.014, speedLimit: 90 }),
  shoulder: Object.freeze({ name: 'shoulder', friction: 0.72, rollingResistance: 0.038, speedLimit: 60 }),
  gravel: Object.freeze({ name: 'gravel', friction: 0.58, rollingResistance: 0.065, speedLimit: 48 }),
  grass: Object.freeze({ name: 'grass', friction: 0.5, rollingResistance: 0.08, speedLimit: 38 }),
  rock: Object.freeze({ name: 'rock', friction: 0.4, rollingResistance: 0.11, speedLimit: 28 }),
  cliff: Object.freeze({ name: 'cliff', friction: 0.12, rollingResistance: 0.16, speedLimit: 0 }),
});

function vectorFromNormal(normal) {
  return new THREE.Vector3(normal.x, normal.y, normal.z);
}

export class SurfaceClassifier {
  constructor({ heightfield, road = null, options = {} } = {}) {
    if (!heightfield) throw new Error('SurfaceClassifier requires a heightfield');
    this.heightfield = heightfield;
    this.road = road;
    this.rockSlope = options.rockSlope ?? Math.PI * 0.34;
    this.cliffSlope = options.cliffSlope ?? Math.PI * 0.68;
    this.rockHeight = options.rockHeight ?? 34;
  }

  profile(name) {
    return SURFACE_PROFILES[name] || SURFACE_PROFILES.grass;
  }

  classify(x, z) {
    const terrain = this.heightfield.sample(x, z);
    const roadSurface = this.road?.sampleSurface(x, z) || null;
    if (roadSurface) {
      const profile = this.profile(roadSurface.surface);
      return {
        ...terrain,
        ...roadSurface,
        normal: roadSurface.normal ? vectorFromNormal(roadSurface.normal) : vectorFromNormal(terrain.normal),
        surface: roadSurface.surface,
        friction: profile.friction,
        rollingResistance: profile.rollingResistance,
        speedLimit: profile.speedLimit,
        cliff: false,
      };
    }
    let surface = 'grass';
    if (!terrain.inside || terrain.slopeAngle >= this.cliffSlope) surface = 'cliff';
    else if (terrain.slopeAngle >= this.rockSlope || terrain.height >= this.rockHeight) surface = 'rock';
    const profile = this.profile(surface);
    return {
      ...terrain,
      normal: vectorFromNormal(terrain.normal),
      surface,
      friction: profile.friction,
      rollingResistance: profile.rollingResistance,
      speedLimit: profile.speedLimit,
      cliff: surface === 'cliff',
      distanceToRoad: Infinity,
    };
  }

  sample(position) {
    return this.classify(position.x, position.z);
  }
}
