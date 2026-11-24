import * as THREE from 'three';
import { clamp } from '../core/math.js';
import { createNoiseTexture } from './terrainMaterial.js';

const DEPTH_SIZE = 512;
const DEFAULT_DIRECTION = new THREE.Vector3(-0.45, 0.75, 0.35).normalize();
const DEFAULT_SUN = new THREE.Color(1, 0.95, 0.82);
const DEFAULT_SKY = new THREE.Color(0.55, 0.72, 0.9);

const VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec3 vWaterPos;
void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWaterPos = worldPosition.xyz;
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uNoise;
uniform sampler2D uDepth;
uniform float uTime;
uniform float uWorldSize;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uShallowColor;
uniform vec3 uDeepColor;
varying vec3 vWaterPos;
void main() {
  float depth = texture2D(uDepth, vWaterPos.xz / uWorldSize + 0.5).r;
  if (depth <= 0.004) discard;

  // Two layers of drifting noise give ripples that never visibly repeat.
  vec2 p = vWaterPos.xz;
  vec4 a = texture2D(uNoise, p / 23.0 + vec2(uTime * 0.021, uTime * 0.013));
  vec4 b = texture2D(uNoise, p / 7.5 - vec2(uTime * 0.034, -uTime * 0.027));
  float viewDistance = length(cameraPosition - vWaterPos);
  float ripple = 0.16 * (1.0 - smoothstep(120.0, 900.0, viewDistance)) + 0.03;
  vec3 normal = normalize(vec3((a.r - 0.5 + (b.g - 0.5) * 0.6) * ripple, 1.0, (a.b - 0.5 + (b.a - 0.5) * 0.6) * ripple));

  vec3 viewDirection = normalize(cameraPosition - vWaterPos);
  float facing = max(dot(normal, viewDirection), 0.0);
  float fresnel = 0.03 + 0.97 * pow(1.0 - facing, 5.0);

  vec3 body = mix(uShallowColor, uDeepColor, smoothstep(0.0, 0.75, depth));
  body *= 0.55 + 0.45 * max(uSunDirection.y, 0.0);
  vec3 color = mix(body, uSkyColor, clamp(fresnel, 0.0, 0.85));

  vec3 halfVector = normalize(uSunDirection + viewDirection);
  float glint = pow(max(dot(normal, halfVector), 0.0), 260.0);
  color += uSunColor * glint * 1.6 * step(0.0, uSunDirection.y);

  // Thin water at the shore lets the ground show through.
  float alpha = clamp(mix(0.38, 0.93, smoothstep(0.0, 0.3, depth)) + fresnel * 0.4, 0.0, 0.97);
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/**
 * The lake: one plane at the water level, shaded with drifting ripples, a fresnel sky tint and a sun
 * glint. There is no reflection pass; depth comes from a small texture baked from the terrain grid.
 */
export class WaterView {
  constructor({ world }) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'Water';
    const grid = world.grid;
    const size = grid.half * 2;

    // Water depth, 0 on dry land, 1 at 5 m or deeper.
    const depth = new Uint8Array(DEPTH_SIZE * DEPTH_SIZE);
    let wet = 0;
    for (let j = 0; j < DEPTH_SIZE; j += 1) {
      const z = ((j + 0.5) / DEPTH_SIZE - 0.5) * size;
      for (let i = 0; i < DEPTH_SIZE; i += 1) {
        const x = ((i + 0.5) / DEPTH_SIZE - 0.5) * size;
        const value = clamp((world.waterLevel - grid.heightAt(x, z)) / 5, 0, 1);
        depth[j * DEPTH_SIZE + i] = Math.round(value * 255);
        if (value > 0) wet += 1;
      }
    }
    this.hasWater = wet > 0;
    this.depthTexture = new THREE.DataTexture(depth, DEPTH_SIZE, DEPTH_SIZE, THREE.RedFormat, THREE.UnsignedByteType);
    this.depthTexture.magFilter = THREE.LinearFilter;
    this.depthTexture.minFilter = THREE.LinearFilter;
    this.depthTexture.needsUpdate = true;
    this.noiseTexture = createNoiseTexture(world.config.seed + 101);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uNoise: { value: null },
          uDepth: { value: null },
          uTime: { value: 0 },
          uWorldSize: { value: size },
          uSunDirection: { value: DEFAULT_DIRECTION },
          uSunColor: { value: DEFAULT_SUN },
          uSkyColor: { value: DEFAULT_SKY },
          uShallowColor: { value: new THREE.Color(0.1, 0.34, 0.36) },
          uDeepColor: { value: new THREE.Color(0.02, 0.1, 0.16) },
        },
      ]),
      fog: true,
      transparent: true,
      depthWrite: false,
    });
    // UniformsUtils.merge clones values, so textures are assigned afterwards.
    this.material.uniforms.uNoise.value = this.noiseTexture;
    this.material.uniforms.uDepth.value = this.depthTexture;

    const geometry = new THREE.PlaneGeometry(size, size, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'WaterSurface';
    this.mesh.position.y = world.waterLevel;
    this.mesh.renderOrder = 2;
    this.mesh.visible = this.hasWater;
    this.group.add(this.mesh);
  }

  update(dt) {
    this.material.uniforms.uTime.value += dt;
  }

  /** Optional: match the glint and reflected tint to the current sky. */
  setSun(direction = DEFAULT_DIRECTION, sunColor = DEFAULT_SUN, skyColor = DEFAULT_SKY) {
    this.material.uniforms.uSunDirection.value.copy(direction).normalize();
    if (sunColor) this.material.uniforms.uSunColor.value.copy(sunColor);
    if (skyColor) this.material.uniforms.uSkyColor.value.copy(skyColor);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.depthTexture.dispose();
    this.noiseTexture.dispose();
    this.group.parent?.remove(this.group);
  }
}
