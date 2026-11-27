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
const _skinCache = new Map();
let _fallbackSkinTex = null;

function fallbackSkinTexture() {
  if (!_fallbackSkinTex) {
    _fallbackSkinTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    _fallbackSkinTex.needsUpdate = true;
  }
  return _fallbackSkinTex;
}

/** Load and cache a car skin texture (`512x512` seamless wrap WebP), notifying active listeners on load. */
export function loadSkinTexture(url, onReady) {
  if (!url || typeof Image === 'undefined') return null;
  let entry = _skinCache.get(url);
  if (!entry) {
    entry = { tex: null, ready: false, waiters: [] };
    _skinCache.set(url, entry);
    const tex = new THREE.TextureLoader().load(url, () => {
      entry.ready = true;
      for (const cb of entry.waiters.splice(0)) cb(tex);
    });
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 8;
    entry.tex = tex;
  }
  if (entry.ready) {
    onReady?.(entry.tex);
  } else if (onReady) {
    entry.waiters.push(onReady);
  }
  return entry.tex;
}

export const PAINT_MODES = Object.freeze({
  SOLID_PAINT: 0, // Solid paint slot (Thar_Paint, Tokyo_Paint, RJ_Paint, ProceduralCar body)
  MASKED_BODY: 1, // Track GT3 GT_Body (map.a = body paint mask, ORM G/B = carbon/glass/underbody)
  MASKED_RIM: 2,  // Track GT3 GT_Wheel (map.a = alloy spoke/lip mask, 0 = tire rubber)
  TRIM_ONLY: 3,   // Non-paint parts receiving Vertex AO strength / molded micro-grain
});

export const SKIN_FINISHES = Object.freeze({
  GLOSS: 0,
  SATIN: 1,
  CARBON: 2,
  BRUSHED: 3,
});

/**
 * Compute shared chassis-local bounding box across a vehicle's paintable body meshes so
 * `sampleCarSkin` maps front-to-rear & spine-to-rocker proportionally on every silhouette.
 */
export function computeCarPaintBounds(meshesOrRoot, predicate = null) {
  const box = new THREE.Box3();
  const meshBox = new THREE.Box3();
  const rootInv = new THREE.Matrix4();
  const relMat = new THREE.Matrix4();
  const items = Array.isArray(meshesOrRoot) ? meshesOrRoot : [];
  if (!Array.isArray(meshesOrRoot) && meshesOrRoot?.traverse) {
    meshesOrRoot.updateMatrixWorld?.(true);
    rootInv.copy(meshesOrRoot.matrixWorld).invert();
    meshesOrRoot.traverse((node) => {
      if (node.isMesh && (!predicate || predicate(node))) items.push(node);
    });
  }
  for (const mesh of items) {
    if (!mesh?.geometry) continue;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    if (!mesh.geometry.boundingBox) continue;
    meshBox.copy(mesh.geometry.boundingBox);
    if (!Array.isArray(meshesOrRoot) && meshesOrRoot?.matrixWorld) {
      relMat.multiplyMatrices(rootInv, mesh.matrixWorld);
      meshBox.applyMatrix4(relMat);
    }
    box.union(meshBox);
  }
  if (box.isEmpty()) {
    return { min: [-1.05, 0.12, -2.35], size: [2.10, 1.30, 4.70] };
  }
  const size = new THREE.Vector3();
  box.getSize(size);
  return {
    min: [box.min.x, box.min.y, box.min.z],
    size: [Math.max(0.2, size.x), Math.max(0.2, size.y), Math.max(0.4, size.z)],
  };
}

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
varying vec3 vCarLocalNormal;
`;

const VERTEX_MAIN = /* glsl */ `
vCarLocalPos = transformed;
vCarLocalNormal = objectNormal;
`;

const FRAGMENT_PARS = /* glsl */ `
varying vec3 vCarLocalPos;
varying vec3 vCarLocalNormal;
uniform float uPaintMode;
uniform sampler2D uSkinMap;
uniform float uSkinMix;
uniform vec3 uCarBoundsMin;
uniform vec3 uCarBoundsSize;
uniform float uSkinScale;
uniform float uSkinIridescence;
uniform float uSkinFinish;
uniform float uClearcoatRough;
uniform vec3 uPaintBase;
uniform vec3 uPaintCrevice;
uniform vec3 uPaintFlop;
uniform float uPaintFlake;
uniform float uPaintBlend;
uniform float uSaltline;
uniform float uPaintMetalness;
uniform float uPaintRoughness;
uniform float uPaintClearcoat;
uniform vec3 uRimColor;
uniform float uRimMetalness;
uniform float uRimRoughness;
uniform float uVertexAoStrength;
uniform float uGrainStrength;

vec3 serviceStripes(vec3 coat) {
  if(uSaltline<.5)return coat;
  float band=abs(vCarLocalPos.x-.29);
  float stripe=1.-smoothstep(.064,.075,band);
  stripe=max(stripe,1.-smoothstep(.011,.019,abs(band-.105)));
  return mix(coat,vec3(.71,.66,.45),stripe*.91);
}
float carHash31( vec3 p ) {
  p = fract( p * vec3( 443.8975, 397.2973, 491.1871 ) );
  p += dot( p, p.yxz + 19.19 );
  return fract( ( p.x + p.y ) * p.z );
}

// Smooth conformal car-shell wrap mapping anchored strictly to each car's physical bounds:
// x = nose (-Z) to tail (+Z) with bumper-face wrap; y = bilateral spine (0.5) to lower skirts (0 / 1).
vec2 carWrapUv( vec3 pos, vec3 nrm ) {
  vec3 sz = max( uCarBoundsSize, vec3( 0.1 ) );
  vec3 c  = uCarBoundsMin + sz * 0.5;
  vec3 nn = normalize( nrm );
  float nx = ( pos.x - c.x ) / max( sz.x * 0.5, 0.05 );
  float ny = clamp( ( pos.y - uCarBoundsMin.y ) / max( sz.y, 0.05 ), 0.0, 1.0 );
  float nz = clamp( ( pos.z - uCarBoundsMin.z ) / max( sz.z, 0.05 ), 0.0, 1.0 );

  float noseDrop = max( 0.0, -nn.z ) * smoothstep( 0.62, 0.0, ny ) * 0.14;
  float tailDrop = max( 0.0,  nn.z ) * smoothstep( 0.62, 0.0, ny ) * 0.14;
  float uLong = clamp( nz - noseDrop + tailDrop, 0.002, 0.998 );

  float dy = ny + 0.42;
  float halfAngle = atan( nx * 0.92, dy );
  float vGirth = clamp( 0.5 + halfAngle / 2.28, 0.002, 0.998 );

  if ( uSkinScale > 1.01 ) {
    return vec2( fract( uLong * uSkinScale ), clamp( 0.5 + ( vGirth - 0.5 ) * uSkinScale, 0.002, 0.998 ) );
  }
  return vec2( uLong, vGirth );
}

vec3 sampleCarSkin( vec3 pos, vec3 nrm ) {
  return texture2D( uSkinMap, carWrapUv( pos, nrm ) ).rgb;
}

vec3 applyPpfIridescence( vec3 baseCol, vec3 flopCol, vec3 nrm, float dotNV ) {
  if ( uSkinIridescence <= 0.005 ) return baseCol;
  float grazing = pow( clamp( 1.0 - dotNV, 0.0, 1.0 ), 1.25 );
  float iriPhase = grazing * 1.42 + dot( normalize( nrm ), vec3( 0.31, 0.54, 0.24 ) ) * 0.28;
  vec3 spectral = 0.5 + 0.5 * cos( 6.28318 * ( iriPhase * 0.72 + vec3( 0.00, 0.33, 0.67 ) ) );
  vec3 iriTint = mix( flopCol, spectral * max( length( flopCol ) * 0.85, 0.72 ), 0.62 );
  float baseLuma = clamp( dot( baseCol, vec3( 0.299, 0.587, 0.114 ) ), 0.08, 1.0 );
  vec3 shifted = mix( baseCol * iriTint * 1.55, baseCol * 0.55 + iriTint * ( 0.32 + 0.42 * baseLuma ), 0.55 );
  return mix( baseCol, clamp( shifted, 0.0, 1.0 ), uSkinIridescence * grazing );
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
if ( uSkinMix > 0.005 && uPaintMode < 1.5 ) {
  float ppfMask = uPaintMode < 0.5 ? 1.0 : carZoneMask;
  float carDistPpf = length( vViewPosition );
  float ppfFade = 1.0 / ( 1.0 + carDistPpf * 0.16 );
  vec2 wuv = carWrapUv( vCarLocalPos, vCarLocalNormal );
  if ( uSkinFinish > 2.5 ) {
    // Brushed metallic foil: anisotropic longitudinal grain modulation
    float brush = sin( wuv.y * 1900.0 + sin( wuv.x * 90.0 ) * 2.5 ) * 0.5 + 0.5;
    roughnessFactor = mix( roughnessFactor, clamp( roughnessFactor + ( brush - 0.5 ) * 0.12 * ppfFade, 0.06, 0.68 ), ppfMask );
  } else if ( uSkinFinish > 1.5 ) {
    // 2x2 diagonal twill carbon weave specular micro-relief
    float tw = step( 2.0, mod( floor( wuv.x * 460.0 ) + floor( wuv.y * 460.0 ), 4.0 ) );
    float weaveMod = mix( -0.07, 0.14, tw ) * ppfFade;
    roughnessFactor = mix( roughnessFactor, clamp( roughnessFactor + weaveMod, 0.08, 0.85 ), ppfMask );
  } else if ( uSkinFinish > 0.5 ) {
    // Satin stealth PPF: silky velvet sheen with subtle micro-pebble dispersion
    float satinGrain = ( carHash31( floor( vCarLocalPos * 260.0 ) ) - 0.5 ) * 0.05 * ppfFade;
    roughnessFactor = mix( roughnessFactor, clamp( max( roughnessFactor, 0.34 ) + satinGrain, 0.24, 0.78 ), ppfMask );
  }
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
    // Solid / skinned car bodywork (Hatch, Thar, Tokyo, Raijin): normalized conformal PPF wrap
    float flopT = pow( 1.0 - dotNV, 2.3 ) * uPaintBlend;
    float crownT = smoothstep( 0.22, 0.94, dotNV );
    vec3 coatColor = mix( uPaintCrevice, uPaintBase, mix( 0.48, 1.0, crownT ) );
    if ( uSkinMix > 0.005 ) {
      vec3 skinTex = sampleCarSkin( vCarLocalPos, vCarLocalNormal );
      coatColor = mix( coatColor, skinTex * mix( 0.92, 1.08, crownT ), uSkinMix );
    }
    vec3 skinFlop = mix( coatColor * 1.12 + vec3( 0.02 ), mix( coatColor * 0.75 + uPaintFlop * 0.38, max( uPaintFlop * 0.58 + coatColor * 0.48, coatColor * 1.06 ), clamp( dot( coatColor, vec3( 0.33 ) ) + 0.25, 0.0, 1.0 ) ), uSkinIridescence * 0.85 );
    vec3 flopTarget = mix( uPaintFlop, skinFlop, uSkinMix * 0.85 );
    coatColor = mix( coatColor, flopTarget, flopT );
    coatColor = applyPpfIridescence( coatColor, uPaintFlop, vCarLocalNormal, dotNV );
    if ( uPaintFlake > 0.001 ) {
      float f1 = carHash31( floor( vCarLocalPos * 230.0 ) );
      float sparkle = smoothstep( 0.80, 0.99, f1 ) * uPaintFlake * detailFade * ( 0.35 + 0.65 * dotNV );
      coatColor = mix( coatColor, flopTarget * 1.14 + vec3( 0.05 ), sparkle );
    }
    vec3 aoOnly = vec3( 1.0 );
    #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
      aoOnly = mix( vec3( 1.0 ), vColor.rgb, uVertexAoStrength );
    #endif
    diffuseColor.rgb = serviceStripes(coatColor) * aoOnly;
  } else if ( uPaintMode < 1.5 ) {
    // Track GT3 GT_Body: halo-free trim separation + normalized conformal PPF wrap on painted panels
    vec3 cleanTrim = diffuseColor.rgb * clamp( 1.0 - carZoneMask * mix( 0.88, 1.05, uSkinMix ), 0.0, 1.0 );
    float panelAo = clamp( mix( 0.82, 1.02, diffuseColor.g / max( carZoneMask, 0.35 ) ), 0.76, 1.02 );
    float flopT = pow( 1.0 - dotNV, 2.3 ) * uPaintBlend;
    float crownT = smoothstep( 0.22, 0.94, dotNV );
    vec3 coatColor = mix( uPaintCrevice, uPaintBase, mix( 0.48, 1.0, crownT ) );
    if ( uSkinMix > 0.005 ) {
      vec3 skinTex = sampleCarSkin( vCarLocalPos, vCarLocalNormal );
      coatColor = mix( coatColor, skinTex * mix( 0.92, 1.08, crownT ), uSkinMix );
    }
    vec3 skinFlop = mix( coatColor * 1.12 + vec3( 0.02 ), mix( coatColor * 0.75 + uPaintFlop * 0.38, max( uPaintFlop * 0.58 + coatColor * 0.48, coatColor * 1.06 ), clamp( dot( coatColor, vec3( 0.33 ) ) + 0.25, 0.0, 1.0 ) ), uSkinIridescence * 0.85 );
    vec3 flopTarget = mix( uPaintFlop, skinFlop, uSkinMix * 0.85 );
    coatColor = mix( coatColor, flopTarget, flopT );
    coatColor = applyPpfIridescence( coatColor, uPaintFlop, vCarLocalNormal, dotNV );
    if ( uPaintFlake > 0.001 ) {
      float f1 = carHash31( floor( vCarLocalPos * 230.0 ) );
      float sparkle = smoothstep( 0.80, 0.99, f1 ) * uPaintFlake * detailFade * ( 0.35 + 0.65 * dotNV );
      coatColor = mix( coatColor, flopTarget * 1.14 + vec3( 0.05 ), sparkle );
    }
    diffuseColor.rgb = cleanTrim + serviceStripes(coatColor) * ( panelAo * carZoneMask );
  } else if ( uPaintMode < 2.5 ) {
    // Track GT3 GT_Wheel: halo-free separation between matte dark tire & forged tintable alloy rim
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
if ( uPaintMode < 0.5 ) {
  material.clearcoatRoughness = clamp( uClearcoatRough, 0.03, 0.65 );
} else if ( uPaintMode > 0.5 && uPaintMode < 1.5 ) {
  // Track GT3: full lacquer clearcoat on paint & optical glass (low roughness), satin coat on woven carbon
  float trimCoat = roughnessFactor < 0.08 ? 0.90 : ( roughnessFactor < 0.45 ? 0.28 : 0.04 );
  material.clearcoat = saturate( mix( trimCoat, uPaintClearcoat, carZoneMask ) );
  material.clearcoatRoughness = clamp( mix( material.clearcoatRoughness, uClearcoatRough, carZoneMask ), 0.03, 0.65 );
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
  const boundsMin = options.carBoundsMin ?? [-1.05, 0.12, -2.35];
  const boundsSize = options.carBoundsSize ?? [2.10, 1.30, 4.70];
  const paintUniforms = {
    uPaintMode: { value: mode },
    uSaltline: {value:0},
    uSkinMap: { value: fallbackSkinTexture() },
    uSkinMix: { value: 0 },
    uCarBoundsMin: { value: new THREE.Vector3(boundsMin[0], boundsMin[1], boundsMin[2]) },
    uCarBoundsSize: { value: new THREE.Vector3(boundsSize[0], boundsSize[1], boundsSize[2]) },
    uSkinScale: { value: options.skinScale ?? 1.0 },
    uSkinIridescence: { value: options.iridescence ?? 0.0 },
    uSkinFinish: { value: options.finishMode ?? 0.0 },
    uClearcoatRough: { value: options.clearcoatRoughness ?? material.clearcoatRoughness ?? 0.06 },
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
    return `${prev}|car-paint-skin-v3`;
  };
  material.needsUpdate = true;
  return material;
}

/** Update live paint/rim uniforms in-place with zero heap allocations or shader recompiles. */
export function setCarPaintUniforms(material, options = {}) {
  const u = material?.userData?.carPaintUniforms;
  if (!u) return;
  if (options.mode !== undefined) u.uPaintMode.value = options.mode;
  if (options.carBoundsMin) u.uCarBoundsMin.value.set(options.carBoundsMin[0], options.carBoundsMin[1], options.carBoundsMin[2]);
  if (options.carBoundsSize) u.uCarBoundsSize.value.set(options.carBoundsSize[0], options.carBoundsSize[1], options.carBoundsSize[2]);
  if (options.paint !== undefined) {
    u.uSaltline.value=options.paint?.id==='saltline'?1:0;
    derivePaintColors(options.paint, u.uPaintBase.value, u.uPaintCrevice.value, u.uPaintFlop.value);
    const isObj = options.paint && typeof options.paint === 'object' && !options.paint.isColor;
    if (isObj) {
      if (options.paint.flake !== undefined) u.uPaintFlake.value = options.paint.flake;
      if (options.paint.blend !== undefined) u.uPaintBlend.value = options.paint.blend;
      if (options.paint.metalness !== undefined) u.uPaintMetalness.value = options.paint.metalness;
      if (options.paint.roughness !== undefined) u.uPaintRoughness.value = options.paint.roughness;
      if (options.paint.clearcoat !== undefined) u.uPaintClearcoat.value = options.paint.clearcoat;
      u.uSkinScale.value = options.paint.skinScale ?? 1.0;
      u.uSkinIridescence.value = options.paint.iridescence ?? 0.0;
      u.uSkinFinish.value = options.paint.finishMode ?? 0.0;
      u.uClearcoatRough.value = options.paint.clearcoatRoughness ?? (options.paint.roughness > 0.28 ? 0.28 : 0.05);
      const skinUrl = options.paint.skinUrl || null;
      u._wantedSkinUrl = skinUrl;
      if (skinUrl) {
        loadSkinTexture(skinUrl, (tex) => {
          if (u._wantedSkinUrl !== skinUrl) return;
          u.uSkinMap.value = tex;
          u.uSkinMix.value = 1;
        });
      } else {
        u.uSkinMap.value = fallbackSkinTexture();
        u.uSkinMix.value = 0;
      }
    }
  } else if (options.skinUrl !== undefined) {
    const skinUrl = options.skinUrl || null;
    u._wantedSkinUrl = skinUrl;
    if (skinUrl) {
      loadSkinTexture(skinUrl, (tex) => {
        if (u._wantedSkinUrl !== skinUrl) return;
        u.uSkinMap.value = tex;
        u.uSkinMix.value = 1;
      });
    } else {
      u.uSkinMap.value = fallbackSkinTexture();
      u.uSkinMix.value = 0;
    }
  } else if (options.color !== undefined) {
    u.uSaltline.value=0;
    derivePaintColors(options.color, u.uPaintBase.value, u.uPaintCrevice.value, u.uPaintFlop.value);
  }
  if (options.skinScale !== undefined) u.uSkinScale.value = options.skinScale;
  if (options.iridescence !== undefined) u.uSkinIridescence.value = options.iridescence;
  if (options.finishMode !== undefined) u.uSkinFinish.value = options.finishMode;
  if (options.clearcoatRoughness !== undefined) u.uClearcoatRough.value = options.clearcoatRoughness;
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
