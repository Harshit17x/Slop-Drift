import * as THREE from 'three';

// The terrain is drawn as flat grid patches that are displaced in the vertex shader from a height
// texture, and shaded in the fragment shader from world position, slope and altitude. Everything is
// layered onto MeshStandardMaterial, so standard lights, shadow maps and scene fog keep working.

const VERTEX_PARS = /* glsl */ `
attribute vec2 aChunk;
attribute float aSkirt;
uniform highp sampler2D uHeightMap;
uniform float uLodStep;
uniform float uCell;
uniform float uHalf;
uniform float uSkirtDepth;
varying vec3 vTerrainPos;
`;

const VERTEX_BEGIN = /* glsl */ `
// Patch vertices sit on grid nodes: fetch the exact node height (no filtering, no cracks inside a level).
ivec2 terrainTexel = ivec2(floor(aChunk / uLodStep + position.xz + 0.5));
float terrainHeight = texelFetch(uHeightMap, terrainTexel, 0).r;
vec2 terrainNode = aChunk + position.xz * uLodStep;
vec3 transformed = vec3(terrainNode.x * uCell - uHalf, terrainHeight - aSkirt * uSkirtDepth, terrainNode.y * uCell - uHalf);
vTerrainPos = vec3(transformed.x, terrainHeight, transformed.z);
`;

const FRAGMENT_PARS = /* glsl */ `
uniform sampler2D uControl;   // rg: world normal xz, b: baked occlusion, a: road proximity
uniform sampler2D uNoise;     // four channels of tiling fractal noise
uniform sampler2D uSunShade;  // large-scale terrain shadow for the current sun
uniform float uControlScale;
uniform float uControlBias;
uniform float uHalf;
uniform float uSnowLine;
uniform float uTreeLine;
uniform float uWaterLevel;
uniform float uValleyFloor;
uniform float uSunShadeStrength;
uniform vec4 uGrassBank;      // xy: centre (world x, z), z: radius (0 = none); grass holds on steeper banks inside
varying vec3 vTerrainPos;
float terrainOcclusion = 1.0;
float terrainSunShade = 1.0;
vec3 terrainWorldNormal = vec3(0.0, 1.0, 0.0);
float terrainRoughness = 1.0;

// Triplanar lookup: projecting only from above (xz) stretches detail into vertical streaks on
// cuts and cliffs. Blend top and side projections by how much the surface faces each axis.
vec4 terrainTriplanar(vec3 p, vec3 weights, float scale) {
  vec4 top = texture2D(uNoise, p.xz / scale);
  if (weights.y > 0.995) return top;
  vec4 sideX = texture2D(uNoise, p.zy / scale + 0.37);
  vec4 sideZ = texture2D(uNoise, p.xy / scale + 0.61);
  return top * weights.y + sideX * weights.x + sideZ * weights.z;
}
`;

const FRAGMENT_COLOR = /* glsl */ `
{
  vec3 wp = vTerrainPos;
  vec2 controlUv = (wp.xz + uHalf) * uControlScale + uControlBias;
  vec4 control = texture2D(uControl, controlUv);
  vec2 nxz = control.rg * 2.0 - 1.0;
  vec3 nW = normalize(vec3(nxz.x, sqrt(max(0.02, 1.0 - dot(nxz, nxz))), nxz.y));
  float viewDistance = length(cameraPosition - wp);

  vec3 triWeights = pow(abs(nW), vec3(4.0));
  triWeights /= triWeights.x + triWeights.y + triWeights.z;
  vec4 nBroad = texture2D(uNoise, wp.xz / 620.0);
  vec4 nMid = terrainTriplanar(wp + vec3(nBroad.x, 0.0, nBroad.y) * 25.0, triWeights, 71.0);
  vec4 nFine = terrainTriplanar(wp, triWeights, 9.3);
  vec4 nMicro = terrainTriplanar(wp, triWeights, 1.9);
  float nearFade = 1.0 - smoothstep(40.0, 160.0, viewDistance);
  float midFade = 1.0 - smoothstep(350.0, 1400.0, viewDistance);

  // Fine relief: tilt the shading normal with the noise gradient, strongest up close and on rock.
  vec2 bump = (nFine.xy - 0.5) * 0.55 * midFade + (nMicro.zw - 0.5) * 0.45 * nearFade;
  float slopeRaw = 1.0 - nW.y;

  float altitude = wp.y + (nBroad.r - 0.5) * 70.0 + (nMid.g - 0.5) * 22.0;
  float alpine = smoothstep(uTreeLine - 70.0, uTreeLine + 55.0, altitude);
  // Above the tree line vegetation gives up sooner, so bare ground starts on gentler slopes.
  float alpineBias = alpine;
  // Thresholds on 1 - normal.y: 0.11 is a 27 degree slope, 0.2 is 37 degrees, 0.34 is 49 degrees.
  // Inside a grass bank (the switchback terraces) turf holds up to ~60 degrees: cut slopes of
  // 1 : 1.6 and fills of 1 : 1.3 stay green and only true cliffs show rock.
  float bank = uGrassBank.z > 0.0 ? 1.0 - smoothstep(uGrassBank.z * 0.8, uGrassBank.z, distance(wp.xz, uGrassBank.xy)) : 0.0;
  float steep = smoothstep(0.2 + 0.3 * bank, 0.34 + 0.32 * bank, slopeRaw + (nMid.b - 0.5) * 0.1 + alpineBias * 0.05);
  float scree = smoothstep(0.125 + 0.3 * bank, 0.23 + 0.32 * bank, slopeRaw + (nMid.a - 0.5) * 0.09 + alpineBias * 0.07);

  // Ground cover by altitude: lush valley grass, darker forest floor on the flanks, pale alpine turf.
  vec3 meadow = mix(vec3(0.115, 0.175, 0.048), vec3(0.2, 0.235, 0.07), nMid.r);
  vec3 forest = mix(vec3(0.055, 0.1, 0.038), vec3(0.095, 0.14, 0.05), nMid.g);
  vec3 turf = mix(vec3(0.2, 0.2, 0.095), vec3(0.27, 0.245, 0.135), nMid.b);
  float forestBand = smoothstep(uValleyFloor + 25.0, uValleyFloor + 90.0, altitude) * (1.0 - alpine);
  forestBand *= smoothstep(0.32, 0.62, nBroad.g + nMid.a * 0.35);
  vec3 cover = mix(meadow, forest, forestBand);
  cover = mix(cover, turf, alpine);
  cover *= 0.82 + 0.36 * nFine.r * midFade + 0.18 * (nMicro.r - 0.5) * nearFade;

  vec3 earth = mix(vec3(0.16, 0.125, 0.09), vec3(0.25, 0.205, 0.15), nMid.r);
  earth = mix(earth, vec3(0.27, 0.255, 0.235), alpine * 0.8);
  earth *= 0.8 + 0.4 * nFine.g * midFade;

  // Rock in distinct horizontal beds so cuts and cliffs read as layered stone, not a smooth wash.
  // The beds dip across the mountain instead of following altitude, otherwise every slope shows
  // evenly spaced contour lines. Heavy warping and patchy seams keep them irregular.
  float strataPhase = dot(wp, vec3(0.16, 0.5, -0.11)) + nMid.r * 7.0 + nBroad.b * 12.0 + nFine.a * 1.6;
  float strata = smoothstep(0.2, 0.8, sin(strataPhase) * 0.5 + 0.5);
  float seams = smoothstep(0.9, 0.99, sin(strataPhase * 2.3 + 1.7) * 0.5 + 0.5) * smoothstep(0.35, 0.65, nMid.b);
  vec3 rock = mix(vec3(0.12, 0.115, 0.11), vec3(0.26, 0.245, 0.225), strata * 0.35 + nMid.g * 0.35 + nFine.b * 0.3);
  rock = mix(rock, vec3(0.23, 0.19, 0.15), nBroad.a * 0.45);
  rock *= 0.7 + 0.55 * nFine.r * midFade + 0.35 * (nMicro.g - 0.5) * nearFade;
  rock *= 1.0 - seams * 0.3;

  vec3 albedo = mix(cover, earth, scree);
  albedo = mix(albedo, rock, steep);
  float rough = mix(mix(1.0, 0.96, scree), 0.88, steep);

  // The flat carved bed beside the road is a ditch of trampled earth and rough grass, not more
  // gravel; the cut faces above it stay rock.
  float bed = control.a * (1.0 - smoothstep(0.06, 0.16, slopeRaw));
  vec3 ditch = mix(earth * 0.9, cover * 0.95, smoothstep(0.3, 0.7, nFine.a + (nMicro.b - 0.5) * 0.3 * nearFade));
  albedo = mix(albedo, ditch, bed);

  // Pale shore and dark wet ground around and under the water.
  float shore = 1.0 - smoothstep(uWaterLevel + 0.4, uWaterLevel + 3.2, wp.y + (nMid.b - 0.5) * 1.5);
  albedo = mix(albedo, vec3(0.36, 0.33, 0.25) * (0.85 + 0.3 * nFine.r), shore * (1.0 - steep));
  albedo *= 1.0 - 0.55 * smoothstep(uWaterLevel + 0.2, uWaterLevel - 2.5, wp.y);

  // Snow settles above the snow line, creeping lower in gullies and thinning on steep faces.
  float snowEdge = altitude + (nFine.r - 0.5) * 16.0 * midFade - bed * 14.0;
  float snow = smoothstep(uSnowLine - 28.0, uSnowLine + 34.0, snowEdge);
  snow *= 1.0 - smoothstep(0.26, 0.5, slopeRaw + (nFine.g - 0.5) * 0.1);
  float dusting = smoothstep(uSnowLine - 95.0, uSnowLine - 10.0, snowEdge) * smoothstep(0.55, 0.8, nMid.a + nFine.b * 0.3) * (1.0 - steep);
  snow = clamp(max(snow, dusting * 0.75), 0.0, 1.0);
  // Wind-packed drifts and a cooler tint in hollows, so large snowfields are not a flat white sheet.
  float drift = nMid.b * 0.6 + nFine.a * 0.4;
  vec3 snowColor = mix(vec3(0.7, 0.76, 0.86), vec3(0.88, 0.9, 0.93), smoothstep(0.25, 0.75, drift));
  snowColor *= 0.9 + 0.1 * nMicro.r * nearFade;
  snowColor = mix(snowColor * vec3(0.9, 0.94, 1.0), snowColor, clamp(control.b / 0.86, 0.0, 1.0));
  albedo = mix(albedo, snowColor, snow);
  rough = mix(rough, 0.62, snow);
  bump *= 1.0 - snow * 0.75;

  terrainWorldNormal = normalize(nW + vec3(bump.x, 0.0, bump.y) * (0.35 + 0.65 * steep));
  // Occlusion is stored with 0.86 as "open ground"; ridges go slightly above, gullies well below.
  terrainOcclusion = clamp(control.b / 0.86, 0.0, 1.16);
  terrainSunShade = mix(1.0, texture2D(uSunShade, controlUv).r, uSunShadeStrength);
  terrainRoughness = rough;
  diffuseColor.rgb = albedo * mix(0.72, 1.0, min(1.0, terrainOcclusion));
}
`;

const FRAGMENT_NORMAL = /* glsl */ `
normal = normalize((viewMatrix * vec4(terrainWorldNormal, 0.0)).xyz);
`;

const FRAGMENT_LIGHTS_END = /* glsl */ `
reflectedLight.indirectDiffuse *= terrainOcclusion;
reflectedLight.directDiffuse *= terrainSunShade;
reflectedLight.directSpecular *= terrainSunShade;
`;

/**
 * Shared uniforms for every terrain level of detail.
 * @param {object} options
 * @param {THREE.Texture} options.control  RGBA8 at grid resolution.
 * @param {THREE.Texture} options.noise    Tiling RGBA noise.
 * @param {THREE.Texture} options.sunShade Coarse R8 sun shadow.
 */
export function createTerrainUniforms({ control, noise, sunShade, grid, mountain, grassBank = null }) {
  return {
    uControl: { value: control },
    uNoise: { value: noise },
    uSunShade: { value: sunShade },
    // Texel centres sit on grid nodes: uv = (node + 0.5) / size.
    uControlScale: { value: 1 / (grid.cell * grid.size) },
    uControlBias: { value: 0.5 / grid.size },
    uCell: { value: grid.cell },
    uHalf: { value: grid.half },
    uSnowLine: { value: mountain.snowLine },
    uTreeLine: { value: mountain.treeLine },
    uWaterLevel: { value: mountain.waterLevel },
    uValleyFloor: { value: mountain.valleyFloor },
    uSunShadeStrength: { value: 0.8 },
    uGrassBank: { value: new THREE.Vector4(grassBank?.x ?? 0, grassBank?.z ?? 0, grassBank?.radius ?? 0, 0) },
  };
}

/** One material per level of detail: they share a program and differ only in three uniforms. */
export function createTerrainMaterial(shared, { heightMap, lodStep, skirtDepth }) {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  const own = {
    uHeightMap: { value: heightMap },
    uLodStep: { value: lodStep },
    uSkirtDepth: { value: skirtDepth },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, own);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
      .replace('#include <begin_vertex>', VERTEX_BEGIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <map_fragment>', FRAGMENT_COLOR)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = terrainRoughness;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAGMENT_NORMAL}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${FRAGMENT_LIGHTS_END}`);
  };
  material.customProgramCacheKey = () => 'slop-terrain-v7';
  material.userData.terrainUniforms = own;
  return material;
}

/** 256x256 RGBA texture of tiling fractal value noise, one independent pattern per channel. */
export function createNoiseTexture(seed = 7) {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  const lattice = (ix, iy, period, salt) => {
    const x = ((ix % period) + period) % period;
    const y = ((iy % period) + period) % period;
    let h = (seed + salt * 7919) ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const value = (x, y, period, salt) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = x - x0;
    const ty = y - y0;
    const u = tx * tx * (3 - 2 * tx);
    const v = ty * ty * (3 - 2 * ty);
    const a = lattice(x0, y0, period, salt);
    const b = lattice(x0 + 1, y0, period, salt);
    const c = lattice(x0, y0 + 1, period, salt);
    const d = lattice(x0 + 1, y0 + 1, period, salt);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  for (let channel = 0; channel < 4; channel += 1) {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        let total = 0;
        let amplitude = 0.5;
        let period = 4;
        for (let octave = 0; octave < 5; octave += 1) {
          total += value((x / size) * period, (y / size) * period, period, channel * 13 + octave) * amplitude;
          amplitude *= 0.5;
          period *= 2;
        }
        // Stretch the contrast: the raw sum clusters around the middle.
        const stretched = Math.min(1, Math.max(0, (total / 0.96875 - 0.5) * 1.7 + 0.5));
        data[(y * size + x) * 4 + channel] = Math.round(stretched * 255);
      }
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}
