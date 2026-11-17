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
    skyElevation: -14, lightElevation: 41, azimuth: 208,
    turbidity: 2, rayleigh: 0.9, mie: 0.003, mieG: 0.8,
    exposure: 0.62, sun: 0xa9c1ff, sunIntensity: 0.95,
    hemiSky: 0x33487a, hemiGround: 0x0a0d14, hemiIntensity: 0.75, envIntensity: 1,
    fogDensity: 0.00046, fogFloor: 0x0b1424, fogTint: 0xffffff, fogGain: 1,
    clouds: 0.3, cloudDensity: 0.3, stars: 0.95, moon: true,
  }),
});

const SHADOW_EXTENT = 72; // half-size of the shadow frustum around the focus, metres
const SHADOW_DISTANCE = 320; // how far back along the sun direction the shadow camera sits
const HORIZON_PROBES = 8;

const scratchRight = new THREE.Vector3();
const scratchUp = new THREE.Vector3();
const scratchFocus = new THREE.Vector3();
const worldUp = new THREE.Vector3(0, 1, 0);

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
      new THREE.CircleGeometry(1, 28),
      new THREE.MeshBasicMaterial({ color: 0xf2f5ff, fog: false, toneMapped: false, depthWrite: false, transparent: true }),
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
    const size = quality?.shadowMapSize ?? 2048;
    this.cloudsEnabled = quality?.clouds !== false;
    const shadow = this.sun.shadow;
    this.sun.castShadow = size > 0;
    if (size > 0 && (shadow.mapSize.x !== size || !this.shadowMapSize)) {
      shadow.mapSize.set(size, size);
      shadow.map?.dispose();
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
    const preset = PRESETS[name] || PRESETS.day;
    this.timeOfDay = PRESETS[name] ? name : 'day';
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
    this.buildEnvironment();
  }

  /** Average sky colour just above the horizon, ignoring the glare around the sun. */
  measureHorizon() {
    const preset = this.preset;
    const floor = new THREE.Color(preset.fogFloor);
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
    const tint = new THREE.Color(preset.fogTint);
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
      this.scene.environmentIntensity = this.preset.envIntensity;
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
