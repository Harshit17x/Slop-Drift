import * as THREE from 'three';

// Neon underglow as real light, not a painted decal.
//
// Each car carries four LED strips (under both sills and both bumpers). A strip is a line light, and
// the Lambertian irradiance from a uniform line segment has a closed form (the integral of N·L / d²
// along the segment), so every lit surface (asphalt, verges, parapets, the tyres and the cars
// themselves) is shaded with its own albedo, normal and inverse-square falloff. The result is the
// look of a real kit: a bright seam right under the sills that fades smoothly into a soft, even halo
// following the car's outline, with no rectangle edge and no hotspots.
//
// The shading is added to every MeshStandardMaterial through onBeforeCompile with shared uniforms,
// so the number of glowing cars can change every frame without recompiling a shader.

/** Cars that can glow at once (the local car plus the nearest remote ones). */
export const UNDERGLOW_CARS = 6;
export const UNDERGLOW_STRIPS = 4;
const SEGMENTS = UNDERGLOW_CARS * UNDERGLOW_STRIPS;

const uniforms = {
  uGlowCount: { value: 0 },
  uGlowSphere: { value: Array.from({ length: UNDERGLOW_CARS }, () => new THREE.Vector4()) },
  uGlowUp: { value: Array.from({ length: UNDERGLOW_CARS }, () => new THREE.Vector3(0, 1, 0)) },
  uGlowColor: { value: Array.from({ length: UNDERGLOW_CARS }, () => new THREE.Color(0, 0, 0)) },
  uGlowA: { value: Array.from({ length: SEGMENTS }, () => new THREE.Vector3()) },
  uGlowB: { value: Array.from({ length: SEGMENTS }, () => new THREE.Vector3()) },
};

const VERTEX_PARS = /* glsl */ `
varying vec3 vGlowWorld;
`;

const VERTEX_MAIN = /* glsl */ `
{
  vec4 glowWorld = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    glowWorld = batchingMatrix * glowWorld;
  #endif
  #ifdef USE_INSTANCING
    glowWorld = instanceMatrix * glowWorld;
  #endif
  vGlowWorld = ( modelMatrix * glowWorld ).xyz;
}
`;

const FRAGMENT_PARS = /* glsl */ `
#define GLOW_CARS ${UNDERGLOW_CARS}
varying vec3 vGlowWorld;
uniform int uGlowCount;
uniform vec4 uGlowSphere[ GLOW_CARS ];
uniform vec3 uGlowUp[ GLOW_CARS ];
uniform vec3 uGlowColor[ GLOW_CARS ];
uniform vec3 uGlowA[ GLOW_CARS * 4 ];
uniform vec3 uGlowB[ GLOW_CARS * 4 ];

// Irradiance at P (normal N) from a uniform line light A-B of unit intensity per metre:
// the closed form of the integral of dot(N, L) / d^2 along the segment.
float glowLine( vec3 P, vec3 N, vec3 A, vec3 B ) {
  vec3 l0 = A - P;
  vec3 l1 = B - P;
  float d0 = length( l0 );
  float d1 = length( l1 );
  float facing = dot( N, l0 ) / ( 2.0 * d0 ) + dot( N, l1 ) / ( 2.0 * d1 );
  return 2.0 * max( facing, 0.0 ) / ( d0 * d1 + dot( l0, l1 ) + 0.004 );
}

vec3 underglowIrradiance( vec3 P, vec3 N ) {
  vec3 E = vec3( 0.0 );
  for ( int i = 0; i < GLOW_CARS; i ++ ) {
    if ( i >= uGlowCount ) break;
    vec3 offset = P - uGlowSphere[ i ].xyz;
    float radius = uGlowSphere[ i ].w;
    float dist2 = dot( offset, offset );
    if ( dist2 > radius * radius ) continue;
    // The strips sit under the floor and point down and out: the body itself blocks anything above them.
    float below = 1.0 - smoothstep( -0.03, 0.1, dot( uGlowUp[ i ], offset ) );
    // Fade to exactly zero at the cut-off radius (the inverse-square tail is already tiny there).
    float window = 1.0 - smoothstep( radius * 0.55, radius, sqrt( dist2 ) );
    float sum = 0.0;
    for ( int s = 0; s < 4; s ++ ) sum += glowLine( P, N, uGlowA[ i * 4 + s ], uGlowB[ i * 4 + s ] );
    E += uGlowColor[ i ] * ( sum * below * window );
  }
  return E;
}
`;

const FRAGMENT_LIGHT = /* glsl */ `
#ifdef USE_UNDERGLOW
{
  vec3 glowNormal = inverseTransformDirection( normal, viewMatrix );
  reflectedLight.directDiffuse += underglowIrradiance( vGlowWorld, glowNormal ) * BRDF_Lambert( material.diffuseColor );
}
#endif
`;

/** Make a MeshStandardMaterial receive underglow light. Safe to call more than once. */
export function patchUnderglow(material) {
  if (!material?.isMeshStandardMaterial || material.userData.underglow || material.userData.noUnderglow) return material;
  material.userData.underglow = true;
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  material.onBeforeCompile = function onBeforeCompile(shader, renderer) {
    previous?.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.defines = { ...(shader.defines || {}), USE_UNDERGLOW: '' };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_MAIN}`);
    // After lights_fragment_end and anything a material appends to it (the terrain shades the sun
    // there), so the neon is never darkened by sun shadow or terrain occlusion.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <aomap_fragment>', `${FRAGMENT_LIGHT}\n#include <aomap_fragment>`);
  };
  material.customProgramCacheKey = function customProgramCacheKey() {
    return `${previousKey.call(this)}|underglow-v1`;
  };
  material.needsUpdate = true;
  return material;
}

/** Patch every standard material under `root` (the scene after the world is built). */
export function patchUnderglowTree(root) {
  root.traverse((node) => {
    if (!node.material) return;
    const list = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of list) patchUnderglow(material);
  });
}

const scratchUp = new THREE.Vector3();

/** Collects this frame's glowing cars into the shared uniforms. */
export const underglowFrame = {
  count: 0,
  maxCars: UNDERGLOW_CARS,
  setMaxCars(limit) {
    this.maxCars = Math.max(0, Math.min(UNDERGLOW_CARS, Math.round(limit ?? UNDERGLOW_CARS)));
  },
  begin() {
    this.count = 0;
  },
  /** @returns {boolean} false when every slot is taken. */
  push(car) {
    if (this.count >= this.maxCars) return false;
    const i = this.count;
    if (!car.writeUnderglow(uniforms.uGlowSphere.value[i], scratchUp, uniforms.uGlowColor.value[i], uniforms.uGlowA.value, uniforms.uGlowB.value, i * UNDERGLOW_STRIPS)) return true;
    uniforms.uGlowUp.value[i].copy(scratchUp);
    this.count += 1;
    return true;
  },
  get full() {
    return this.count >= this.maxCars;
  },
  end() {
    uniforms.uGlowCount.value = Math.min(this.count, this.maxCars);
  },
};
