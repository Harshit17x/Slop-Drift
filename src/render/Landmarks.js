import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const WINDOW_GLOW = new THREE.Color(0xffb35a);
const SUNSET_WINDOW_GLOW = new THREE.Color(0xffa048);

const HAS_ASSET_TEX = typeof import.meta.url === 'string' && typeof Image !== 'undefined';
const BUILDING_ATLAS_URL = HAS_ASSET_TEX
  ? new URL('../assets/maps/mussoorie-buildings.webp', import.meta.url).href
  : null;

// Quadrant coordinates in Three.js UV space (flipY = true: v=0.5..1 is top row, v=0..0.5 is bottom row).
const QUAD_PLASTER = Object.freeze({ kind: 'plaster', offset: [0.0, 0.5], scale: 0.28, neutral: 0.67, detail: 0.72, roughness: 0.88, metalness: 0.02 });
const QUAD_CORRUGATED = Object.freeze({ kind: 'corrugated', offset: [0.5, 0.5], scale: 0.44, neutral: 0.59, detail: 0.92, roughness: 0.52, metalness: 0.22 });
const QUAD_STONE = Object.freeze({ kind: 'stone', offset: [0.0, 0.0], scale: 0.30, neutral: 0.49, detail: 0.94, roughness: 0.90, metalness: 0.02 });
const QUAD_TIMBER = Object.freeze({ kind: 'timber', offset: [0.5, 0.0], scale: 0.46, neutral: 0.53, detail: 0.90, roughness: 0.84, metalness: 0.03 });

const MASONRY_HERITAGE_PROPS = new Set(['P_ClockTower', 'P_Church', 'P_Temple', 'P_CamelRock']);
const NO_SHADOW_MATERIALS = new Set(['MSR_glass', 'MSR_marigold', 'MSR_saffron', 'MSR_flag_green', 'MSR_tarp_blue']);

/**
 * Pure material classifier mapping props.glb `MSR_*` materials (and heritage landmark prototypes)
 * to seam-free quadrants of `mussoorie-buildings.webp`. Exported for headless verification.
 */
export function classifyLandmarkSurface(materialName = '', propName = '') {
  if (materialName === 'MSR_glass') return { kind: 'glass' };
  if (materialName === 'MSR_steel' || materialName === 'MSR_black') return { kind: 'metal' };
  if (materialName === 'MSR_tin_green' || materialName === 'MSR_tin_red' || materialName === 'MSR_tarp_blue') {
    return materialName === 'MSR_tarp_blue'
      ? { ...QUAD_CORRUGATED, scale: 0.55, detail: 0.55, roughness: 0.78, metalness: 0.05 }
      : QUAD_CORRUGATED;
  }
  if (materialName === 'MSR_stone' || materialName === 'MSR_dark_stone' || materialName === 'MSR_rock') {
    return QUAD_STONE;
  }
  if (materialName === 'MSR_timber') {
    return QUAD_TIMBER;
  }
  if (materialName === 'MSR_marigold' || materialName === 'MSR_saffron' || materialName === 'MSR_flag_green') {
    return { ...QUAD_PLASTER, scale: 0.65, detail: 0.38, roughness: 0.85, metalness: 0 };
  }
  if (MASONRY_HERITAGE_PROPS.has(propName) && (materialName === 'MSR_cream' || materialName === 'MSR_whitewash' || materialName === 'MSR_ochre')) {
    return { ...QUAD_STONE, detail: 0.86, neutral: 0.52 };
  }
  return QUAD_PLASTER;
}

function loadAtlasTexture(url, maxAnisotropy) {
  const tex = new THREE.TextureLoader().load(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

/**
 * The buildings of an authored map (props.glb + the placements in map.json, via World.placements).
 * One InstancedMesh per prototype primitive, with seam-free local triplanar mapping into
 * `mussoorie-buildings.webp` (plaster, corrugated tin, ashlar stone masonry, deodar timber),
 * mullioned reflective glass windows, and distance-culled hero shadows.
 */
export class Landmarks {
  constructor({ world, quality }) {
    this.world = world;
    this.quality = quality;
    this.group = new THREE.Group();
    this.group.name = 'landmarks';
    this.meshes = [];
    this.heroShadowMeshes = [];
    this.glassMaterials = [];
    this.clonedMaterials = [];
    this.atlasTexture = null;
    this.night = false;
    this.warmGlow = false;
    this.ready = false;
  }

  /** Build or reuse a surface-patched material so WebGL compiles only 2 shared landmark shaders. */
  prepareMaterial(baseMaterial, propName) {
    const surface = classifyLandmarkSurface(baseMaterial.name, propName);
    const cacheKey = `${baseMaterial.name}:${surface.kind}:${MASONRY_HERITAGE_PROPS.has(propName) ? 'h' : 's'}`;
    if (!this.materialCache) this.materialCache = new Map();
    if (this.materialCache.has(cacheKey)) return this.materialCache.get(cacheKey);

    const mat = baseMaterial.clone();
    this.clonedMaterials.push(mat);

    if (surface.kind === 'glass') {
      mat.roughness = 0.14;
      mat.metalness = 0.34;
      mat.envMapIntensity = 1.85;
      mat.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vLmkGlassPos;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLmkGlassPos = position;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vLmkGlassPos;')
          .replace(
            '#include <map_fragment>',
            `#include <map_fragment>
            float mulY = smoothstep(0.05, 0.085, abs(fract(vLmkGlassPos.y * 1.45) - 0.5));
            float mulX = smoothstep(0.045, 0.08, abs(fract((vLmkGlassPos.x + vLmkGlassPos.z) * 1.55) - 0.5));
            float paneMask = mulY * mulX;
            diffuseColor.rgb = mix(diffuseColor.rgb * 0.24, diffuseColor.rgb * 1.15, paneMask);`,
          )
          .replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
            float gMulY = smoothstep(0.05, 0.085, abs(fract(vLmkGlassPos.y * 1.45) - 0.5));
            float gMulX = smoothstep(0.045, 0.08, abs(fract((vLmkGlassPos.x + vLmkGlassPos.z) * 1.55) - 0.5));
            totalEmissiveRadiance *= (gMulY * gMulX) * (0.72 + 0.28 * sin(vLmkGlassPos.x * 2.1 + vLmkGlassPos.y * 1.7));`,
          );
      };
      mat.customProgramCacheKey = () => 'mussoorie-glass-v1';
      this.glassMaterials.push(mat);
      this.materialCache.set(cacheKey, mat);
      return mat;
    }

    if (surface.kind === 'metal') {
      mat.roughness = Math.min(mat.roughness ?? 0.5, 0.44);
      mat.metalness = Math.max(mat.metalness ?? 0.45, 0.58);
      mat.envMapIntensity = 1.25;
      this.materialCache.set(cacheKey, mat);
      return mat;
    }

    mat.roughness = surface.roughness;
    mat.metalness = surface.metalness;
    mat.envMapIntensity = surface.kind === 'corrugated' ? 0.92 : 0.62;

    if (this.atlasTexture) {
      const uQuadOffset = { value: new THREE.Vector2(surface.offset[0], surface.offset[1]) };
      const uTriScale = { value: surface.scale };
      const uNeutralLuma = { value: surface.neutral };
      const uDetailStrength = { value: surface.detail };
      const uAtlasMap = { value: this.atlasTexture };
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uAtlasMap = uAtlasMap;
        shader.uniforms.uQuadOffset = uQuadOffset;
        shader.uniforms.uTriScale = uTriScale;
        shader.uniforms.uNeutralLuma = uNeutralLuma;
        shader.uniforms.uDetailStrength = uDetailStrength;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vLmkLocalPos;\nvarying vec3 vLmkLocalNorm;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLmkLocalPos = position;\nvLmkLocalNorm = normal;');
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            `#include <common>
            uniform sampler2D uAtlasMap;
            uniform vec2 uQuadOffset;
            uniform float uTriScale;
            uniform float uNeutralLuma;
            uniform float uDetailStrength;
            varying vec3 vLmkLocalPos;
            varying vec3 vLmkLocalNorm;`,
          )
          .replace(
            '#include <map_fragment>',
            `#include <map_fragment>
            vec3 lmkNrm = abs(normalize(vLmkLocalNorm));
            vec3 lmkW = pow(max(lmkNrm, vec3(0.001)), vec3(6.0));
            lmkW /= (lmkW.x + lmkW.y + lmkW.z);

            vec2 lmkSpan = vec2(0.470);
            vec2 lmkMargin = vec2(0.015);
            vec2 lmkUvX = uQuadOffset + lmkMargin + fract(vLmkLocalPos.zy * uTriScale) * lmkSpan;
            vec2 lmkUvY = uQuadOffset + lmkMargin + fract(vLmkLocalPos.xz * uTriScale) * lmkSpan;
            vec2 lmkUvZ = uQuadOffset + lmkMargin + fract(vLmkLocalPos.xy * uTriScale) * lmkSpan;

            vec3 lmkTexX = textureGrad(uAtlasMap, lmkUvX, dFdx(vLmkLocalPos.zy * uTriScale) * lmkSpan, dFdy(vLmkLocalPos.zy * uTriScale) * lmkSpan).rgb;
            vec3 lmkTexY = textureGrad(uAtlasMap, lmkUvY, dFdx(vLmkLocalPos.xz * uTriScale) * lmkSpan, dFdy(vLmkLocalPos.xz * uTriScale) * lmkSpan).rgb;
            vec3 lmkTexZ = textureGrad(uAtlasMap, lmkUvZ, dFdx(vLmkLocalPos.xy * uTriScale) * lmkSpan, dFdy(vLmkLocalPos.xy * uTriScale) * lmkSpan).rgb;
            vec3 lmkTex = lmkTexX * lmkW.x + lmkTexY * lmkW.y + lmkTexZ * lmkW.z;

            vec3 lmkDetail = mix(vec3(1.0), lmkTex / vec3(max(0.15, uNeutralLuma)), uDetailStrength);
            float lmkAo = mix(0.82, 1.04, smoothstep(-0.3, 2.2, vLmkLocalPos.y));
            diffuseColor.rgb *= clamp(lmkDetail * lmkAo, vec3(0.42), vec3(1.42));`,
          )
          .replace(
            '#include <roughnessmap_fragment>',
            `#include <roughnessmap_fragment>
            float lmkLum = dot(lmkTex, vec3(0.299, 0.587, 0.114));
            float lmkRel = clamp((lmkLum - uNeutralLuma) * 1.8, -0.5, 0.5);
            roughnessFactor = clamp(roughnessFactor - lmkRel * 0.20, 0.14, 0.98);`,
          );
      };
      mat.customProgramCacheKey = () => 'mussoorie-landmark-triplanar-v1';
    }

    this.materialCache.set(cacheKey, mat);
    return mat;
  }

  /** Load the prototypes and build the instances. Resolves once they are in the scene graph. */
  async load(url) {
    if (BUILDING_ATLAS_URL && !this.atlasTexture) {
      const aniso = Math.min(8, Math.max(1, Number(this.quality?.anisotropy || 4)));
      this.atlasTexture = loadAtlasTexture(BUILDING_ATLAS_URL, aniso);
    }

    const gltf = await new GLTFLoader().loadAsync(url);
    const byProp = new Map();
    for (const placement of this.world.placements) {
      if (!byProp.has(placement.prop)) byProp.set(placement.prop, []);
      byProp.get(placement.prop).push(placement);
    }
    const shadows = Boolean(this.quality?.shadowMapSize);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);

    for (const node of gltf.scene.children) {
      const placements = byProp.get(node.name);
      if (!placements?.length) continue;
      const transforms = placements.map((placement) => {
        position.set(placement.x, this.seatHeight(placement), placement.z);
        rotation.setFromAxisAngle(up, placement.yaw);
        const s = placement.scale || 1;
        scale.set(s, s, s);
        return matrix.compose(position, rotation, scale).clone();
      });
      node.updateMatrixWorld(true);
      node.traverse((child) => {
        if (!child.isMesh) return;
        // Bake the child's transform within the prototype into its geometry.
        const geometry = child.geometry.clone();
        geometry.applyMatrix4(child.matrixWorld);
        const material = this.prepareMaterial(child.material, node.name);
        const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
        transforms.forEach((transform, i) => mesh.setMatrixAt(i, transform));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        const allowShadow = !NO_SHADOW_MATERIALS.has(child.material.name);
        mesh.userData.allowShadow = allowShadow;
        mesh.castShadow = shadows && allowShadow;
        mesh.receiveShadow = shadows;
        mesh.name = `${node.name}:${child.material.name}`;
        this.group.add(mesh);
        this.meshes.push(mesh);
        if (allowShadow && transforms.length <= 2) {
          this.heroShadowMeshes.push(mesh);
        }
      });
    }
    this.setNight(this.night, this.warmGlow);
    this.ready = true;
    return this;
  }

  /** Lowest terrain under the footprint, lifted a little toward the highest so the plinth is not buried. */
  seatHeight(placement) {
    const grid = this.world.grid;
    const c = Math.cos(placement.yaw);
    const s = Math.sin(placement.yaw);
    const hw = placement.w / 2;
    const hd = placement.d / 2;
    let low = Infinity;
    let high = -Infinity;
    for (const [lx, ly] of [[0, 0], [-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) {
      // Blender local (x, y) turned by yaw, then game z = -Blender y.
      const bx = lx * c - ly * s;
      const by = lx * s + ly * c;
      const h = grid.heightAt(placement.x + bx, placement.z - by);
      low = Math.min(low, h);
      high = Math.max(high, h);
    }
    return low + Math.min(1.5, (high - low) * 0.25) - 0.15;
  }

  setQuality(quality) {
    this.quality = quality;
    const shadows = Boolean(quality?.shadowMapSize);
    if (this.atlasTexture) {
      const aniso = Math.min(8, Math.max(1, Number(quality?.anisotropy || 4)));
      if (this.atlasTexture.anisotropy !== aniso) {
        this.atlasTexture.anisotropy = aniso;
        this.atlasTexture.needsUpdate = true;
      }
    }
    for (const mesh of this.meshes) {
      mesh.castShadow = shadows && Boolean(mesh.userData.allowShadow);
      mesh.receiveShadow = shadows;
    }
  }

  /** Disable shadow casting on distant hero landmarks beyond shadow range. */
  update(camera) {
    if (!camera || !this.heroShadowMeshes.length || !this.quality?.shadowMapSize) return;
    const camPos = camera.position;
    for (const mesh of this.heroShadowMeshes) {
      const sphere = mesh.boundingSphere;
      if (!sphere) continue;
      const maxD = 340 + sphere.radius;
      mesh.castShadow = camPos.distanceToSquared(sphere.center) <= maxD * maxD;
    }
  }

  /** Lit windows after dark or warm evening glow at sunset. */
  setNight(isNight, isWarm = false) {
    this.night = Boolean(isNight);
    this.warmGlow = Boolean(isWarm);
    const active = this.night || this.warmGlow;
    const targetColor = this.night ? WINDOW_GLOW : SUNSET_WINDOW_GLOW;
    const intensity = this.night ? 1.55 : (this.warmGlow ? 0.58 : 0);
    for (const material of this.glassMaterials) {
      material.emissive?.copy(active ? targetColor : material.color).multiplyScalar(active ? 1 : 0);
      material.emissiveIntensity = intensity;
    }
  }

  dispose() {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    for (const mat of this.clonedMaterials) mat.dispose();
    this.atlasTexture?.dispose();
    this.atlasTexture = null;
    this.meshes = [];
    this.heroShadowMeshes = [];
    this.clonedMaterials = [];
    this.glassMaterials = [];
    this.materialCache?.clear();
    this.group.parent?.remove(this.group);
  }
}
