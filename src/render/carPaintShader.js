import * as THREE from 'three';

/**
 * Multi-layer automotive finish shader (`onBeforeCompile` on MeshStandardMaterial /
 * MeshPhysicalMaterial):
 *  - 3-stop viewing-angle colour blend (Crevice -> Base -> Fresnel Flop highlight)
 *  - Car-local micro-metallic aluminum flake sparkle (attenuated by view distance)
 *  - Per-pixel UV paint mask / rim alloy mask (`diffuseColor.a`) with halo-free unpreblend
 *    for textured cars (`GT_Body` mode 1, `GT_Wheel` mode 2), restoring `diffuseColor.a = opacity`
 *    so remote-player ghost fading still fades the whole vehicle cleanly
 *  - Calibrated Vertex AO tint (`uVertexAoStrength`) for Thar baked BVH AO + subtle molded grain
 *    (`uGrainStrength`) for matte cladding, rubber tyres and rugged hardtop panels
 *
 * Designed to be patched BEFORE `patchUnderglow(material)` so `onBeforeCompile` and
 * `customProgramCacheKey` chain cleanly, with zero per-frame allocations when changing paint/rims.
 */

const _hsl = { h: 0, s: 0, l: 0 };

export const PAINT_MODES = Object.freeze({
  SOLID_PAINT: 0, // Solid paint slot (Thar_Paint, ProceduralCar body)
  MASKED_BODY: 1, // Porsche GT_Body (map.a = body paint mask, ORM G/B = carbon/glass/underbody)
  MASKED_RIM: 2,  // Porsche GT_Wheel (map.a = alloy spoke/lip mask, 0 = tire rubber)
  TRIM_ONLY: 3,   // Non-paint parts receiving Vertex AO strength / molded micro-grain
});

/**
 * Derive rich Crevice (deep curve/shadow) and Fresnel Flop (grazing highlight) colours from any
 * PAINT_OPTIONS entry or hex colour, while respecting explicit overrides (`creviceColor`, `flopColor`).
 */
export function derivePaintColors(paintOrColor, outBase, outCrevice, outFlop) {
  const isObj = paintOrColor && typeof paintOrColor === 'object' && !paintOrColor.isColor;
  const hex = isObj ? paintOrColor.color : paintOrColor;
  outBase.set(hex ?? 0xd62828);
  outBase.getHSL(_hsl);

  if (isObj && paintOrColor.creviceColor != null) {
    outCrevice.set(paintOrColor.creviceColor);
  } else {
    // Richer, deeper tone in crevices/concave curves (chromatic paints saturate instead of turning grey).
    const cSat = _hsl.s < 0.08 ? _hsl.s : Math.min(1, _hsl.s * 1.18 + 0.06);
    const cLum = Math.max(0.012, _hsl.l * (_hsl.l > 0.6 ? 0.58 : 0.48));
    outCrevice.setHSL(_hsl.h, cSat, cLum);
  }

  if (isObj && paintOrColor.flopColor != null) {
    outFlop.set(paintOrColor.flopColor);
  } else {
    // Grazing Fresnel flop shifts gently toward cool sky-silver or warm metallic sheen.
    const fHue = (_hsl.h + (_hsl.s < 0.12 ? 0.58 : _hsl.h < 0.45 ? 0.035 : -0.04) + 1) % 1;
    const fSat = _hsl.s < 0.08 ? 0.14 : Math.min(1, _hsl.s * 0.92 + 0.05);
    const fLum = Math.min(0.95, Math.max(_hsl.l * 1.32, _hsl.l + 0.14));
    outFlop.setHSL(fHue, fSat, fLum);
  }
}

const VERTEX_PARS = /* glsl */ `
varying vec3 vCarLocalPos;
`;

const VERTEX_MAIN = /* glsl */ `
vCarLocalPos = transformed;
`;

const FRAGMENT_PARS = /* glsl */ `
varying vec3 vCarLocalPos;
uniform float uPaintMode;
uniform vec3 uPaintBase;
uniform vec3 uPaintCrevice;
uniform vec3 uPaintFlop;
uniform float uPaintFlake;
uniform float uPaintBlend;
uniform float uPaintMetalness;
uniform float uPaintRoughness;
uniform float uPaintClearcoat;
uniform vec3 uRimColor;
uniform float uRimMetalness;
uniform float uRimRoughness;
uniform float uVertexAoStrength;
uniform float uGrainStrength;

float carHash31( vec3 p ) {
  p = fract( p * vec3( 443.8975, 397.2973, 491.1871 ) );
  p += dot( p, p.yxz + 19.19 );
  return fract( ( p.x + p.y ) * p.z );
}
`;

const FRAGMENT_MAP_AFTER = /* glsl */ `
float carZoneMask = 0.0;
if ( uPaintMode > 0.5 && uPaintMode < 2.5 ) {
  carZoneMask = opacity > 0.001 ? clamp( diffuseColor.a / opacity, 0.0, 1.0 ) : 0.0;
  diffuseColor.a = opacity;
}
`;

const FRAGMENT_COLOR_REPLACE = /* glsl */ `
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
  diffuseColor.rgb *= mix( vec3( 1.0 ), vColor.rgb, uVertexAoStrength );
#endif
`;

const FRAGMENT_ROUGH_AFTER = /* glsl */ `
if ( uPaintMode > 0.5 && uPaintMode < 1.5 ) {
  roughnessFactor = mix( roughnessFactor, uPaintRoughness, carZoneMask );
} else if ( uPaintMode > 1.5 && uPaintMode < 2.5 ) {
  roughnessFactor = mix( roughnessFactor, uRimRoughness, carZoneMask );
}
if ( uGrainStrength > 0.001 ) {
  float carDist = length( vViewPosition );
  float grainFade = 1.0 / ( 1.0 + carDist * 0.28 );
  float microGrain = carHash31( floor( vCarLocalPos * 180.0 ) ) - 0.5;
  roughnessFactor = clamp( roughnessFactor + microGrain * uGrainStrength * 0.5 * grainFade, 0.04, 1.0 );
}
`;

const FRAGMENT_METAL_AFTER = /* glsl */ `
if ( uPaintMode > 0.5 && uPaintMode < 1.5 ) {
  metalnessFactor = mix( metalnessFactor, uPaintMetalness, carZoneMask );
} else if ( uPaintMode > 1.5 && uPaintMode < 2.5 ) {
  metalnessFactor = mix( metalnessFactor, uRimMetalness, carZoneMask );
}
`;

const FRAGMENT_BEFORE_LIGHTING = /* glsl */ `
{
  float dotNV = clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
  float carDist = length( vViewPosition );
  float detailFade = 1.0 / ( 1.0 + carDist * 0.25 );

  if ( uPaintMode < 0.5 ) {
    // Solid car paint (Thar_Paint / Hatch): 3-stop Crevice -> Base -> Fresnel Flop blend + metallic flakes
    float flopT = pow( 1.0 - dotNV, 2.4 ) * uPaintBlend;
    float crownT = smoothstep( 0.32, 0.94, dotNV );
    vec3 coatColor = mix( uPaintCrevice, uPaintBase, mix( 0.42, 1.0, crownT ) );
    coatColor = mix( coatColor, uPaintFlop, flopT );
    if ( uPaintFlake > 0.001 ) {
      float f1 = carHash31( floor( vCarLocalPos * 230.0 ) );
      float sparkle = smoothstep( 0.80, 0.99, f1 ) * uPaintFlake * detailFade * ( 0.35 + 0.65 * dotNV );
      coatColor = mix( coatColor, uPaintFlop * 1.18 + vec3( 0.04 ), sparkle );
    }
    // Preserve any baked Vertex AO already applied cleanly in color_fragment without mutating base tint
    vec3 aoOnly = vec3( 1.0 );
    #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
      aoOnly = mix( vec3( 1.0 ), vColor.rgb, uVertexAoStrength );
    #endif
    diffuseColor.rgb = coatColor * aoOnly;
  } else if ( uPaintMode < 1.5 ) {
    // Porsche GT_Body: halo-free inverse-preblend separation between trim/carbon/glass & painted body
    vec3 cleanTrim = max( diffuseColor.rgb - vec3( carZoneMask * 0.72 ), vec3( 0.0 ) );
    float panelAo = clamp( mix( 0.74, 1.0, diffuseColor.g / max( carZoneMask, 0.35 ) ), 0.68, 1.02 );
    float flopT = pow( 1.0 - dotNV, 2.4 ) * uPaintBlend;
    float crownT = smoothstep( 0.30, 0.94, dotNV );
    vec3 coatColor = mix( uPaintCrevice, uPaintBase, mix( 0.46, 1.0, crownT ) );
    coatColor = mix( coatColor, uPaintFlop, flopT );
    if ( uPaintFlake > 0.001 ) {
      float f1 = carHash31( floor( vCarLocalPos * 230.0 ) );
      float sparkle = smoothstep( 0.80, 0.99, f1 ) * uPaintFlake * detailFade * ( 0.35 + 0.65 * dotNV );
      coatColor = mix( coatColor, uPaintFlop * 1.18 + vec3( 0.04 ), sparkle );
    }
    diffuseColor.rgb = cleanTrim + coatColor * ( panelAo * carZoneMask );
  } else if ( uPaintMode < 2.5 ) {
    // Porsche GT_Wheel: halo-free separation between matte dark tire & forged tintable alloy rim
    vec3 cleanTire = max( diffuseColor.rgb - vec3( carZoneMask * 0.52 ), vec3( 0.0 ) );
    float spokeShade = clamp( mix( 0.58, 1.12, diffuseColor.g / max( carZoneMask, 0.35 ) ), 0.45, 1.12 );
    diffuseColor.rgb = cleanTire + ( uRimColor * spokeShade ) * carZoneMask;
  } else if ( uGrainStrength > 0.001 ) {
    // Molded plastic cladding, matte rubber, or rugged roof micro-grain
    float grain = ( carHash31( floor( vCarLocalPos * 180.0 ) ) - 0.5 ) * uGrainStrength * detailFade;
    diffuseColor.rgb = max( diffuseColor.rgb * ( 1.0 + grain * 0.35 ), vec3( 0.0 ) );
  }
}
`;

const FRAGMENT_CLEARCOAT_AFTER = /* glsl */ `
#ifdef USE_CLEARCOAT
if ( uPaintMode > 0.5 && uPaintMode < 1.5 ) {
  // Porsche: full lacquer clearcoat on paint & optical glass (low roughness), satin coat on woven carbon
  float trimCoat = roughnessFactor < 0.08 ? 0.90 : ( roughnessFactor < 0.45 ? 0.28 : 0.04 );
  material.clearcoat = saturate( mix( trimCoat, uPaintClearcoat, carZoneMask ) );
} else if ( uPaintMode > 1.5 && uPaintMode < 2.5 ) {
  material.clearcoat = saturate( mix( 0.0, 0.42, carZoneMask ) );
}
#endif
`;

/**
 * Attach multi-layer automotive paint & micro-detail uniforms to a MeshStandard/PhysicalMaterial.
 * Call BEFORE `patchUnderglow(material)`.
 */
export function patchCarPaint(material, options = {}) {
  if (!material?.isMeshStandardMaterial) return material;
  if (material.userData.carPaintUniforms) {
    setCarPaintUniforms(material, options);
    return material;
  }

  const mode = options.mode ?? PAINT_MODES.TRIM_ONLY;
  const paintUniforms = {
    uPaintMode: { value: mode },
    uPaintBase: { value: new THREE.Color(0xe9eef5) },
    uPaintCrevice: { value: new THREE.Color(0x8a95a6) },
    uPaintFlop: { value: new THREE.Color(0xffffff) },
    uPaintFlake: { value: options.flake ?? 0.18 },
    uPaintBlend: { value: options.blend ?? 0.65 },
    uPaintMetalness: { value: options.paintMetalness ?? material.metalness ?? 0.32 },
    uPaintRoughness: { value: options.paintRoughness ?? material.roughness ?? 0.16 },
    uPaintClearcoat: { value: options.paintClearcoat ?? material.clearcoat ?? 0.88 },
    uRimColor: { value: new THREE.Color(options.rimColor ?? 0xbfc4ca) },
    uRimMetalness: { value: options.rimMetalness ?? 0.88 },
    uRimRoughness: { value: options.rimRoughness ?? 0.20 },
    uVertexAoStrength: { value: options.vertexAoStrength ?? 0.55 },
    uGrainStrength: { value: options.grainStrength ?? 0.0 },
  };
  material.userData.carPaintUniforms = paintUniforms;
  setCarPaintUniforms(material, options);

  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  material.onBeforeCompile = function onBeforeCompile(shader, renderer) {
    previous?.call(this, shader, renderer);
    Object.assign(shader.uniforms, paintUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${FRAGMENT_MAP_AFTER}`)
      .replace('#include <color_fragment>', FRAGMENT_COLOR_REPLACE)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FRAGMENT_ROUGH_AFTER}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${FRAGMENT_METAL_AFTER}`)
      .replace('#include <lights_physical_fragment>', `${FRAGMENT_BEFORE_LIGHTING}\n#include <lights_physical_fragment>\n${FRAGMENT_CLEARCOAT_AFTER}`);
  };
  material.customProgramCacheKey = function customProgramCacheKey() {
    const prev = previousKey ? previousKey.call(this) : '';
    return `${prev}|car-paint-v1`;
  };
  material.needsUpdate = true;
  return material;
}

/** Update live paint/rim uniforms in-place with zero heap allocations or shader recompiles. */
export function setCarPaintUniforms(material, options = {}) {
  const u = material?.userData?.carPaintUniforms;
  if (!u) return;
  if (options.mode !== undefined) u.uPaintMode.value = options.mode;
  if (options.paint !== undefined) {
    derivePaintColors(options.paint, u.uPaintBase.value, u.uPaintCrevice.value, u.uPaintFlop.value);
    const isObj = options.paint && typeof options.paint === 'object' && !options.paint.isColor;
    if (isObj) {
      if (options.paint.flake !== undefined) u.uPaintFlake.value = options.paint.flake;
      if (options.paint.blend !== undefined) u.uPaintBlend.value = options.paint.blend;
      if (options.paint.metalness !== undefined) u.uPaintMetalness.value = options.paint.metalness;
      if (options.paint.roughness !== undefined) u.uPaintRoughness.value = options.paint.roughness;
      if (options.paint.clearcoat !== undefined) u.uPaintClearcoat.value = options.paint.clearcoat;
    }
  } else if (options.color !== undefined) {
    derivePaintColors(options.color, u.uPaintBase.value, u.uPaintCrevice.value, u.uPaintFlop.value);
  }
  if (options.flake !== undefined) u.uPaintFlake.value = options.flake;
  if (options.blend !== undefined) u.uPaintBlend.value = options.blend;
  if (options.paintMetalness !== undefined) u.uPaintMetalness.value = options.paintMetalness;
  if (options.paintRoughness !== undefined) u.uPaintRoughness.value = options.paintRoughness;
  if (options.paintClearcoat !== undefined) u.uPaintClearcoat.value = options.paintClearcoat;
  if (options.rimColor !== undefined) u.uRimColor.value.set(options.rimColor);
  if (options.rimMetalness !== undefined) u.uRimMetalness.value = options.rimMetalness;
  if (options.rimRoughness !== undefined) u.uRimRoughness.value = options.rimRoughness;
  if (options.vertexAoStrength !== undefined) u.uVertexAoStrength.value = options.vertexAoStrength;
  if (options.grainStrength !== undefined) u.uGrainStrength.value = options.grainStrength;
}
