import * as THREE from 'three';
import { createRandom } from '../world/noise.js';
import { wetness } from '../world/Jungle.js';

// Monsoon dressing: a drizzle that follows the camera, low mist caught in the
// creek and hollows, and fireflies after dark. Rain is one line-segment draw,
// mist is one merged quad batch and fireflies are one point cloud.

export class JungleWeather {
  constructor(world, quality = null) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'JungleWeather';
    this.time = 0;
    this.random = createRandom(world.config.seed + 4407);
    this.effects = quality?.effects ?? 1;
    this.buildRain();
    this.buildMist();
    this.buildFireflies();
  }

  buildRain() {
    const count = Math.round(1250 * Math.max(0.35, this.effects));
    const position = new Float32Array(count * 6);
    const speed = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = (this.random() - 0.5) * 62;
      const y = this.random() * 52;
      const z = (this.random() - 0.5) * 62;
      const length = 0.45 + this.random() * 0.9;
      position.set([x, y, z, x + 0.10, y - length, z + 0.04], i * 6);
      const s = 15 + this.random() * 11;
      speed[i * 2] = s;
      speed[i * 2 + 1] = s;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
    this.rainMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0.21 },
        uNight: { value: 0 },
      },
      vertexShader: `
        attribute float aSpeed;
        uniform float uTime;
        varying float vFade;
        void main() {
          vec3 p = position;
          float fall = mod(p.y - uTime * aSpeed, 52.0);
          p.y = fall - 6.0;
          p.x += fall * 0.055 + sin(uTime * 0.7 + p.z * 0.15) * 0.5;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          vFade = smoothstep(0.0, 6.0, -mv.z) * (1.0 - smoothstep(42.0, 66.0, -mv.z));
        }`,
      fragmentShader: `
        uniform float uOpacity;
        uniform float uNight;
        varying float vFade;
        void main() {
          vec3 tint = mix(vec3(0.78, 0.86, 0.81), vec3(0.62, 0.76, 0.8), uNight);
          gl_FragColor = vec4(tint, uOpacity * vFade);
        }`,
    });
    this.rain = new THREE.LineSegments(geometry, this.rainMaterial);
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 4;
    this.group.add(this.rain);
  }

  buildMist() {
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(64, 32, 2, 64, 32, 62);
    gradient.addColorStop(0, 'rgba(255,255,255,0.5)');
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.26)');
    gradient.addColorStop(0.72, 'rgba(255,255,255,0.08)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 64);
    this.mistTexture = new THREE.CanvasTexture(canvas);
    this.mistTexture.colorSpace = THREE.SRGBColorSpace;
    this.mistTexture.wrapS = THREE.RepeatWrapping;
    const positions = [], uvs = [], indices = [];
    const road = this.world.roads[0], random = this.random;
    const addPatch = (x, y, z, width, height, angle) => {
      const cos = Math.cos(angle), sin = Math.sin(angle);
      for (let plane = 0; plane < 2; plane++) {
        const a = angle + plane * Math.PI * 0.5;
        const ax = Math.cos(a) * width, az = Math.sin(a) * width;
        const base = positions.length / 3;
        positions.push(
          x - ax, y - height * 0.5, z - az,
          x + ax, y - height * 0.5, z + az,
          x + ax, y + height * 0.5, z + az,
          x - ax, y + height * 0.5, z - az,
        );
        uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    };
    // Creek veil.
    const bridge = this.world.bridge;
    for (let i = 0; i < 9; i++) {
      const s = bridge.centreS - 42 + i * 11 + random() * 7;
      const f = road.frameAt(s, {});
      const lateral = (random() - 0.5) * 25;
      const x = f.x + f.rx * lateral, z = f.z + f.rz * lateral;
      const y = Math.max(this.world.grid.heightAt(x, z), this.world.waterLevel) + 0.5 + random() * 1.1;
      addPatch(x, y, z, 8 + random() * 8, 2.0 + random() * 1.6, random() * Math.PI);
    }
    // Damp hollows down the rest of the lap.
    for (let s = 140; s < road.length; s += 115) {
      const chainage = s + random() * 40;
      const f = road.frameAt(chainage, {});
      const lateral = (random() < 0.5 ? -1 : 1) * (f.halfWidth + 4 + random() * 12);
      const wet = wetness(chainage, lateral, f.curvature ?? 0);
      if (wet < 0.1 && random() < 0.55) continue;
      const x = f.x + f.rx * lateral, z = f.z + f.rz * lateral;
      const y = this.world.grid.heightAt(x, z) + 0.45 + random() * 0.7;
      addPatch(x, y, z, 5 + random() * 6, 1.4 + random() * 1.2, random() * Math.PI);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    this.mistMaterial = new THREE.MeshBasicMaterial({
      map: this.mistTexture, transparent: true, opacity: 0.12, depthWrite: false,
      color: 0xb9cbb4, side: THREE.DoubleSide, fog: true,
    });
    this.mist = new THREE.Mesh(geometry, this.mistMaterial);
    this.mist.renderOrder = 2;
    this.group.add(this.mist);
  }

  buildFireflies() {
    const count = 220;
    const position = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    const road = this.world.roads[0], random = this.random;
    for (let i = 0; i < count; i++) {
      const s = random() * road.length;
      const f = road.frameAt(s, {});
      const lateral = (random() < 0.5 ? -1 : 1) * (f.halfWidth + 1.5 + random() * 9);
      const x = f.x + f.rx * lateral, z = f.z + f.rz * lateral;
      position.set([x, this.world.grid.heightAt(x, z) + 0.7 + random() * 3.4, z], i * 3);
      phase[i] = random() * Math.PI * 2;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    this.fireflyMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uNight: { value: 0 } },
      vertexShader: `
        attribute float aPhase;
        uniform float uTime;
        uniform float uNight;
        varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float blink = pow(max(0.0, sin(uTime * 1.25 + aPhase)), 14.0);
          vAlpha = uNight * blink;
          gl_PointSize = (5.0 + blink * 5.0) * (240.0 / max(8.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vAlpha;
        void main() {
          vec2 q = gl_PointCoord - 0.5;
          float glow = 1.0 - smoothstep(0.08, 0.5, length(q));
          gl_FragColor = vec4(vec3(0.88, 1.0, 0.46) * (0.16 + 0.84 * glow), vAlpha * glow);
        }`,
    });
    this.fireflies = new THREE.Points(geometry, this.fireflyMaterial);
    this.fireflies.frustumCulled = false;
    this.fireflies.renderOrder = 5;
    this.group.add(this.fireflies);
  }

  update(dt, camera, night = false) {
    this.time += dt;
    this.rainMaterial.uniforms.uTime.value = this.time;
    this.rainMaterial.uniforms.uNight.value = night ? 1 : 0;
    this.rainMaterial.uniforms.uOpacity.value = 0.17 + 0.06 * Math.sin(this.time * 0.11 + 0.6);
    this.rain.position.set(camera.x, camera.y - 10, camera.z);
    this.mistMaterial.opacity = 0.1 + 0.025 * Math.sin(this.time * 0.12);
    this.mistTexture.offset.x = this.time * 0.0026;
    this.fireflyMaterial.uniforms.uTime.value = this.time;
    this.fireflyMaterial.uniforms.uNight.value = night ? 1 : 0;
    this.fireflies.visible = night;
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.rain.geometry.dispose();
    this.rainMaterial.dispose();
    this.mist.geometry.dispose();
    this.mistMaterial.dispose();
    this.mistTexture.dispose();
    this.fireflies.geometry.dispose();
    this.fireflyMaterial.dispose();
  }
}
