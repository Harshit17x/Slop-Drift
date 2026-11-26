import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { DEG2RAD } from '../core/math.js';

// Sky, sun or moon, ambient light, haze and image-based lighting for each time of day.
// Azimuth is a compass bearing in degrees (0 = north = -Z, 90 = east = +X); elevation is above the horizon.

const PRESETS = Object.freeze({
  day: Object.freeze({
    skyElevation: 47, lightElevation: 47, azimuth: 148,
    turbidity: 2.2, rayleigh: 1.05, mie: 0.0035, mieG: 0.8,
    exposure: 0.56, sun: 0xfff2dc, sunIntensity: 5.4,
    hemiSky: 0xcfe2ff, hemiGround: 0x6b6452, hemiIntensity: 1.15, envIntensity: 0.7,
    fogDensity: 0.00027, fogFloor: 0x000000, fogTint: 0xffffff, fogGain: 1,
    clouds: 0.36, cloudDensity: 0.42, stars: 0, moon: false,
  }),
  dawn: Object.freeze({
    skyElevation: 7.5, lightElevation: 11, azimuth: 82,
    turbidity: 4.2, rayleigh: 2.1, mie: 0.005, mieG: 0.82,
    exposure: 0.6, sun: 0xffc694, sunIntensity: 4.2,
    hemiSky: 0xd9cfe2, hemiGround: 0x4d4238, hemiIntensity: 0.95, envIntensity: 0.8,
    fogDensity: 0.00042, fogFloor: 0x000000, fogTint: 0xfff0e6, fogGain: 0.95,
    clouds: 0.42, cloudDensity: 0.36, stars: 0.06, moon: false,
  }),
  sunset: Object.freeze({
    skyElevation: 4.2, lightElevation: 8, azimuth: 262,
    turbidity: 6.5, rayleigh: 3.1, mie: 0.006, mieG: 0.84,
    exposure: 0.58, sun: 0xff8b4d, sunIntensity: 4.4,
    hemiSky: 0xc9a2c0, hemiGround: 0x3a2f35, hemiIntensity: 0.85, envIntensity: 0.85,
    fogDensity: 0.00038, fogFloor: 0x000000, fogTint: 0xffe9dc, fogGain: 0.9,
    clouds: 0.46, cloudDensity: 0.4, stars: 0.12, moon: false,
  }),
  night: Object.freeze({
    skyElevation: -14, lightElevation: 27, azimuth: 208,
    turbidity: 2, rayleigh: 0.9, mie: 0.003, mieG: 0.8,
    exposure: 0.62, sun: 0xc5d6f3, sunIntensity: 1.35,
    hemiSky: 0x657aa0, hemiGround: 0x252a35, hemiIntensity: 0.85, envIntensity: 1,
    fogDensity: 0.00046, fogFloor: 0x0b1424, fogTint: 0xffffff, fogGain: 1,
    clouds: 0.3, cloudDensity: 0.3, stars: 0.95, moon: true,
  }),
});

const MUSSOORIE_OVERRIDES = Object.freeze({
  day: Object.freeze({
    skyElevation: 26, lightElevation: 24, azimuth: 232,
    turbidity: 3.0, rayleigh: 1.45, mie: 0.0046, mieG: 0.82,
    exposure: 0.59, sun: 0xffe4bd, sunIntensity: 5.5,
    hemiSky: 0xbfd9ff, hemiGround: 0x5c6248, hemiIntensity: 1.18, envIntensity: 0.86,
    fogDensity: 0.00031, fogTint: 0xf5f8ff,
    clouds: 0.44, cloudDensity: 0.45,
  }),
  dawn: Object.freeze({
    skyElevation: 8.5, lightElevation: 12, azimuth: 78,
    turbidity: 4.8, rayleigh: 2.35, mie: 0.0054,
    sun: 0xffba7a, sunIntensity: 4.5,
    hemiSky: 0xc8d4ee, hemiGround: 0x524c42, hemiIntensity: 1.0, envIntensity: 0.88,
    fogDensity: 0.00038, clouds: 0.46, cloudDensity: 0.42,
  }),
  sunset: Object.freeze({
    skyElevation: 4.8, lightElevation: 8.5, azimuth: 256,
    turbidity: 6.2, rayleigh: 3.35, mie: 0.0065,
    sun: 0xff9252, sunIntensity: 4.8,
    hemiSky: 0xd0a2c8, hemiGround: 0x45343c, hemiIntensity: 0.92, envIntensity: 0.92,
    fogDensity: 0.00036, fogTint: 0xffe6d6,
    clouds: 0.5, cloudDensity: 0.44,
  }),
  night: Object.freeze({
    lightElevation: 31, azimuth: 214,
    sunIntensity: 1.45, hemiSky: 0x6f84ac, hemiIntensity: 0.9, envIntensity: 1.05,
    fogDensity: 0.00032, clouds: 0.34, cloudDensity: 0.34,
  }),
});

// Monsoon Run sits under a closed canopy: a high, humid sun, dense wet haze
// and a leaf-filtered hemisphere. Values stay close to the sky probe result so
// the fog reads as depth rather than a green wash over everything.
const JUNGLE_OVERRIDES = Object.freeze({
  day: Object.freeze({
    skyElevation: 54, lightElevation: 51, azimuth: 128,
    turbidity: 4.4, rayleigh: 1.7, mie: 0.0062, mieG: 0.84,
    exposure: 0.52, sun: 0xffe6b8, sunIntensity: 5.0,
    hemiSky: 0xb2cdb4, hemiGround: 0x3d452f, hemiIntensity: 0.9, envIntensity: 0.5,
    fogDensity: 0.004, fogTint: 0xc2d2b8, fogGain: 0.8,
    clouds: 0.5, cloudDensity: 0.52,
  }),
  dawn: Object.freeze({
    skyElevation: 7, lightElevation: 10, azimuth: 92,
    turbidity: 5.2, rayleigh: 2.4, mie: 0.007, mieG: 0.84,
    exposure: 0.55, sun: 0xffc78a, sunIntensity: 4.4,
    hemiSky: 0xafc3b8, hemiGround: 0x30382a, hemiIntensity: 0.92, envIntensity: 0.6,
    fogDensity: 0.005, fogTint: 0xd8d4b8, fogGain: 0.84,
    clouds: 0.52, cloudDensity: 0.48,
  }),
  sunset: Object.freeze({
    skyElevation: 5, lightElevation: 8, azimuth: 258,
    turbidity: 5.8, rayleigh: 3.0, mie: 0.0072, mieG: 0.85,
    exposure: 0.56, sun: 0xff9a5e, sunIntensity: 4.5,
    hemiSky: 0xc0a8b0, hemiGround: 0x3a2e2a, hemiIntensity: 0.9, envIntensity: 0.7,
    fogDensity: 0.0046, fogTint: 0xe6cdb4, fogGain: 0.84,
    clouds: 0.54, cloudDensity: 0.5,
  }),
  night: Object.freeze({
    lightElevation: 30, azimuth: 206,
    sunIntensity: 1.25,
    hemiSky: 0x5f7d8c, hemiGround: 0x1e2622, hemiIntensity: 0.78, envIntensity: 0.85,
    fogDensity: 0.0042, fogTint: 0x9fb3a8, fogGain: 0.9,
    clouds: 0.36, cloudDensity: 0.38,
  }),
});

/** Resolve sky and lighting preset for a time of day and map id (Mussoorie gets Himalayan Winterline lighting). */
export function resolveAtmospherePreset(name, mapId = null) {
  const key = PRESETS[name] ? name : 'day';
  const base = PRESETS[key];
  const overrides = mapId === 'mussoorie' ? MUSSOORIE_OVERRIDES
    : mapId === 'jungle' ? JUNGLE_OVERRIDES
    : null;
  if (!overrides) return base;
  return Object.freeze({ ...base, ...(overrides[key] || {}) });
}

const SHADOW_EXTENT = 72; // half-size of the shadow frustum around the focus, metres
const SHADOW_DISTANCE = 320; // how far back along the sun direction the shadow camera sits
const HORIZON_PROBES = 8;

const scratchRight = new THREE.Vector3();
const scratchUp = new THREE.Vector3();
const scratchFocus = new THREE.Vector3();
const worldUp = new THREE.Vector3(0, 1, 0);

const scratchSunBlend = new THREE.Color(0xffe2a8);
const scratchFloorColor = new THREE.Color();
const scratchTintColor = new THREE.Color();

function directionFrom(azimuth, elevation, target) {
  const a = azimuth * DEG2RAD;
  const e = elevation * DEG2RAD;
  return target.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}

export class Atmosphere {
  /**
   * @param {object} options
   * @param {THREE.Scene} options.scene
   * @param {THREE.WebGLRenderer} options.renderer
   * @param {object} [options.world]  Used only for the map size (shadow depth range).
   * @param {object} [options.quality]  Entry of QUALITY_PRESETS.
   * @param {string} [options.timeOfDay]
   */
  constructor({ scene, renderer, world = null, quality = null, timeOfDay = 'day' }) {
    this.scene = scene;
    this.renderer = renderer;
    this.world = world;
    this.sunDirection = new THREE.Vector3(0, 1, 0);
    this.sunColor = new THREE.Color();
    this.ambientColor = new THREE.Color();
    this.fogColor = new THREE.Color();
    this.isNight = false;
    this.timeOfDay = '';
    this.preset = PRESETS.day;
    this.cloudsEnabled = true;
    this.shadowMapSize = 2048;
    this.time = 0;

    if (renderer.toneMapping !== THREE.ACESFilmicToneMapping) renderer.toneMapping = THREE.ACESFilmicToneMapping;
    if (renderer.outputColorSpace !== THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.previousBackground = scene.background;
    scene.background = null;

    // The dome follows the camera and draws first, so it never hides far terrain.
    this.sky = new Sky();
    this.sky.name = 'AtmosphereSky';
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    this.sky.material.depthTest = false;
    scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.sun.name = 'AtmosphereSun';
    this.sun.shadow.bias = -0.00035;
    this.sun.shadow.normalBias = 0.08;
    const shadowCamera = this.sun.shadow.camera;
    shadowCamera.left = -SHADOW_EXTENT;
    shadowCamera.right = SHADOW_EXTENT;
    shadowCamera.top = SHADOW_EXTENT;
    shadowCamera.bottom = -SHADOW_EXTENT;
    shadowCamera.near = 1;
    shadowCamera.far = SHADOW_DISTANCE * 2;
    shadowCamera.updateProjectionMatrix();
    scene.add(this.sun, this.sun.target);

    this.hemisphere = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    this.hemisphere.name = 'AtmosphereHemisphere';
    scene.add(this.hemisphere);

    this.fog = new THREE.FogExp2(0xffffff, 0.0003);
    scene.fog = this.fog;

    this.stars = this.createStars();
    scene.add(this.stars);
    this.moon = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, toneMapped: false,
        vertexShader: `
          varying vec2 disc;
          void main() {
            disc = (uv - 0.5) * 3.2;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `
          varying vec2 disc;
          void main() {
            float r = length(disc);
            float edge = max(fwidth(r), 0.002);
            float surface = 1.0 - smoothstep(1.0 - edge, 1.0 + edge, r);
            vec3 normal = vec3(disc, sqrt(max(0.0, 1.0 - r*r)));
            float phase = max(dot(normal, normalize(vec3(-0.32, 0.22, 0.92))), 0.0);
            float maria = smoothstep(0.1, 0.8, sin(7.0*disc.x + 1.4*sin(5.0*disc.y)) * cos(6.0*disc.y));
            vec3 face = vec3(0.82, 0.87, 0.95) * (0.16 + 0.84*sqrt(phase)) * (1.0 - 0.17*maria);
            float halo = 0.14 * pow(1.0 - smoothstep(1.0, 1.56, r), 3.0);
            gl_FragColor = vec4(mix(vec3(0.28, 0.38, 0.56), face, surface), surface + (1.0 - surface)*halo);
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.moon.name = 'AtmosphereMoon';
    this.moon.frustumCulled = false;
    this.moon.renderOrder = -998;
    scene.add(this.moon);

    // A second dome, never shown, is rendered into small targets to measure the horizon colour
    // (so the haze matches the sky exactly) and to build the reflection/ambient environment.
    this.probeSky = new Sky();
    this.probeSky.scale.setScalar(1000);
    this.probeScene = new THREE.Scene();
    this.probeScene.add(this.probeSky);
    this.probeCamera = new THREE.PerspectiveCamera(16, 1, 1, 2000);
    this.probeTarget = new THREE.WebGLRenderTarget(4, 4, { type: THREE.FloatType, depthBuffer: false });
    this.probePixels = new Float32Array(4 * 4 * 4);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.environmentTarget = null;

    if (quality) this.setQuality(quality);
    this.setTimeOfDay(timeOfDay);
  }

  createStars() {
    const count = 1500;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    // Fixed pseudo-random sequence so the sky is the same every run.
    let state = 0x2f6e2b1;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    for (let i = 0; i < count; i += 1) {
      const y = random() * 1.05 - 0.05;
      const angle = random() * Math.PI * 2;
      const ring = Math.sqrt(Math.max(0, 1 - y * y));
      positions[i * 3] = Math.cos(angle) * ring;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = Math.sin(angle) * ring;
      const brightness = 0.35 + 0.65 * Math.pow(random(), 3);
      const warmth = random();
      colors[i * 3] = brightness * (0.85 + 0.15 * warmth);
      colors[i * 3 + 1] = brightness * 0.92;
      colors[i * 3 + 2] = brightness * (1 - 0.18 * warmth);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: 1.8, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0,
      fog: false, depthWrite: false, toneMapped: false,
    });
    const stars = new THREE.Points(geometry, material);
    stars.name = 'AtmosphereStars';
    stars.frustumCulled = false;
    stars.renderOrder = -999;
    stars.visible = false;
    return stars;
  }

  setQuality(quality) {
    const requested = quality?.shadowMapSize ?? 2048;
    const maxTex = Number(this.renderer?.capabilities?.maxTextureSize) || 0;
    const size = requested > 0 && maxTex > 0 && maxTex <= 4096 ? Math.min(requested, 2048) : requested;
    this.cloudsEnabled = quality?.clouds !== false;
    const shadow = this.sun.shadow;
    this.sun.castShadow = size > 0;
    shadow.autoUpdate = size > 0;
    if (size > 0 && (shadow.mapSize.x !== size || !this.shadowMapSize)) {
      shadow.mapSize.set(size, size);
      shadow.map?.dispose();
      shadow.map = null;
    } else if (size === 0 && shadow.map) {
      shadow.map.dispose();
      shadow.map = null;
    }
    this.shadowMapSize = size;
    this.applyClouds();
  }

  applyClouds() {
    const uniforms = this.sky.material.uniforms;
    uniforms.cloudCoverage.value = this.cloudsEnabled ? this.preset.clouds : 0;
    uniforms.cloudDensity.value = this.preset.cloudDensity;
  }

  setTimeOfDay(name) {
    const key = PRESETS[name] ? name : 'day';
    const preset = resolveAtmospherePreset(key, this.world?.config?.map);
    this.timeOfDay = key;
    this.preset = preset;
    this.isNight = preset.moon;

    directionFrom(preset.azimuth, preset.lightElevation, this.sunDirection);
    for (const sky of [this.sky, this.probeSky]) {
      const uniforms = sky.material.uniforms;
      uniforms.turbidity.value = preset.turbidity;
      uniforms.rayleigh.value = preset.rayleigh;
      uniforms.mieCoefficient.value = preset.mie;
      uniforms.mieDirectionalG.value = preset.mieG;
      // The sky's own sun can sit below the horizon (night) while the light comes from the moon.
      directionFrom(preset.moon ? preset.azimuth + 180 : preset.azimuth, preset.skyElevation, uniforms.sunPosition.value);
    }
    this.sky.material.uniforms.showSunDisc.value = preset.moon ? 0 : 1;
    this.probeSky.material.uniforms.showSunDisc.value = 0;
    this.probeSky.material.uniforms.cloudCoverage.value = 0;
    this.applyClouds();

    this.renderer.toneMappingExposure = preset.exposure;
    this.sunColor.setHex(preset.sun);
    this.sun.color.copy(this.sunColor);
    this.sun.intensity = preset.sunIntensity;
    this.hemisphere.color.setHex(preset.hemiSky);
    this.hemisphere.groundColor.setHex(preset.hemiGround);
    this.hemisphere.intensity = preset.hemiIntensity;
    this.ambientColor.setHex(preset.hemiSky).multiplyScalar(preset.hemiIntensity * 0.5);

    this.stars.material.opacity = preset.stars;
    this.stars.visible = preset.stars > 0.01;
    this.moon.visible = preset.moon;

    this.measureHorizon();
    this.fog.color.copy(this.fogColor);
    this.fog.density = preset.fogDensity;
    if (this.world?.config.map === 'hollow') {
      this.sky.visible=false;
      this.fog.color.setHex(preset.moon ? 0x293f50 : 0x6f939f);
      this.scene.background=this.fog.color.clone();
      this.fogColor.copy(this.fog.color);
      this.fog.density=preset.moon ? .0095 : .0074;
      this.sun.color.setHex(0xadcddc);
      this.sun.intensity=preset.moon ? .85 : 2.4;
      this.hemisphere.color.setHex(0xa2c2cc);
      this.hemisphere.groundColor.setHex(0x34454a);
      this.hemisphere.intensity=1.2;
      this.stars.visible=false;
    }
    if (this.world?.bridge) {
      // A little extra leaf-green bounce; the presets already carry the haze.
      this.sun.color.lerp(scratchSunBlend, preset.moon ? 0 : 0.22);
      this.hemisphere.groundColor.setHex(0x3c4327);
      this.hemisphere.intensity *= 0.86;
    }
    this.buildEnvironment();
  }

  /** Average sky colour just above the horizon, ignoring the glare around the sun. */
  measureHorizon() {
    const preset = this.preset;
    const floor = scratchFloorColor.setHex(preset.fogFloor);
    const renderer = this.renderer;
    const previousTarget = renderer.getRenderTarget();
    const samples = [];
    try {
      for (let k = 0; k < HORIZON_PROBES; k += 1) {
        const azimuth = (k / HORIZON_PROBES) * 360 + 11;
        directionFrom(azimuth, 2.5, scratchFocus);
        this.probeCamera.position.set(0, 0, 0);
        this.probeCamera.lookAt(scratchFocus);
        renderer.setRenderTarget(this.probeTarget);
        renderer.render(this.probeScene, this.probeCamera);
        renderer.readRenderTargetPixels(this.probeTarget, 0, 0, 4, 4, this.probePixels);
        let r = 0;
        let g = 0;
        let b = 0;
        for (let i = 0; i < 16; i += 1) {
          r += this.probePixels[i * 4];
          g += this.probePixels[i * 4 + 1];
          b += this.probePixels[i * 4 + 2];
        }
        if (Number.isFinite(r + g + b)) samples.push({ r: r / 16, g: g / 16, b: b / 16, sum: r + g + b });
      }
    } catch {
      samples.length = 0;
    }
    renderer.setRenderTarget(previousTarget);

    if (samples.length >= 4) {
      // Drop the two brightest directions (toward the sun) so the haze takes the calmer sky colour.
      samples.sort((a, b) => a.sum - b.sum);
      const kept = samples.slice(0, samples.length - 2);
      let r = 0;
      let g = 0;
      let b = 0;
      for (const sample of kept) {
        r += sample.r;
        g += sample.g;
        b += sample.b;
      }
      this.fogColor.setRGB(r / kept.length, g / kept.length, b / kept.length);
    } else {
      // Reading float targets is unsupported here: fall back to the ambient sky tint.
      this.fogColor.setHex(preset.hemiSky).multiplyScalar(0.9);
    }
    const tint = scratchTintColor.setHex(preset.fogTint);
    this.fogColor.multiply(tint).multiplyScalar(preset.fogGain);
    this.fogColor.r = Math.max(this.fogColor.r, floor.r);
    this.fogColor.g = Math.max(this.fogColor.g, floor.g);
    this.fogColor.b = Math.max(this.fogColor.b, floor.b);
  }

  /** Prefiltered sky for reflections and ambient light on physically based materials. */
  buildEnvironment() {
    const previous = this.environmentTarget;
    try {
      this.environmentTarget = this.pmrem.fromScene(this.probeScene, 0, 1, 2000);
      this.scene.environment = this.environmentTarget.texture;
      this.scene.environmentIntensity = this.preset.envIntensity * (this.world?.config.map === 'hollow' ? .22 : this.world?.bridge ? .48 : 1);
    } catch {
      this.environmentTarget = null;
      this.scene.environment = null;
    }
    previous?.dispose();
  }

  /**
   * @param {number} dt
   * @param {THREE.Camera} camera
   * @param {THREE.Vector3} [focusPosition]  Where shadows should be sharpest (the car). Defaults to the camera.
   */
  update(dt, camera, focusPosition = null) {
    this.time += dt;
    this.sky.material.uniforms.time.value = this.time;

    const far = camera.far || 6000;
    this.sky.position.copy(camera.position);
    this.sky.scale.setScalar(far);
    if (this.stars.visible) {
      this.stars.position.copy(camera.position);
      this.stars.scale.setScalar(far * 0.82);
    }
    if (this.moon.visible) {
      const distance = far * 0.8;
      this.moon.position.copy(camera.position).addScaledVector(this.sunDirection, distance);
      this.moon.scale.setScalar(distance * 0.022);
      this.moon.lookAt(camera.position);
    }

    // Centre the shadow frustum on the focus, moving it in whole shadow texels so edges do not crawl.
    const focus = scratchFocus.copy(focusPosition || camera.position);
    if (this.sun.castShadow) {
      scratchRight.crossVectors(worldUp, this.sunDirection).normalize();
      scratchUp.crossVectors(this.sunDirection, scratchRight);
      const texel = (SHADOW_EXTENT * 2) / this.shadowMapSize;
      const alongRight = focus.dot(scratchRight);
      const alongUp = focus.dot(scratchUp);
      focus.addScaledVector(scratchRight, Math.round(alongRight / texel) * texel - alongRight);
      focus.addScaledVector(scratchUp, Math.round(alongUp / texel) * texel - alongUp);
    }
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(this.sunDirection, SHADOW_DISTANCE);
    this.sun.target.updateMatrixWorld();
  }

  dispose() {
    const scene = this.scene;
    scene.remove(this.sky, this.sun, this.sun.target, this.hemisphere, this.stars, this.moon);
    if (scene.fog === this.fog) scene.fog = null;
    if (this.environmentTarget && scene.environment === this.environmentTarget.texture) scene.environment = null;
    scene.background = this.previousBackground;
    this.environmentTarget?.dispose();
    this.environmentTarget = null;
    this.pmrem.dispose();
    this.probeTarget.dispose();
    this.sun.shadow.map?.dispose();
    for (const object of [this.sky, this.probeSky, this.stars, this.moon]) {
      object.geometry.dispose();
      object.material.dispose();
    }
  }
}

export const ATMOSPHERE_PRESETS = PRESETS;
