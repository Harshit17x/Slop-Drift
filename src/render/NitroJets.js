import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Both exhaust volumes share a draw call. The nozzle and the hot core stay attached to the car
// between particle emissions, including at high road speed.
export class NitroJets extends THREE.Mesh {
  constructor() {
    const profile = [[0.036,0],[0.054,0.055],[0.070,0.16],[0.088,0.34],[0.068,0.52],[0.035,0.73],[0.002,0.93]];
    const pipes = [-0.42, 0.42].map(x => {
      const geometry = new THREE.LatheGeometry(profile.map(([r,z]) => new THREE.Vector2(r,z)), 12);
      geometry.rotateX(Math.PI / 2);
      geometry.translate(x, 0.33, 2.185);
      return geometry;
    });
    const geometry = mergeGeometries(pipes);
    pipes.forEach(pipe => pipe.dispose());
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      uniforms: { clock: { value: 0 }, power: { value: 0 } },
      vertexShader: `
        uniform float clock, power;
        varying vec2 flameUV;
        void main() {
          flameUV = uv;
          vec3 p = position;
          float t = max(0., p.z - 2.185);
          float phase = clock * 41.0 + sign(p.x) * 1.9;
          p.z = 2.185 + t * power * (1.0 + 0.12*sin(phase) + 0.06*sin(phase*1.63));
          p.x += t*t*0.023*sin(phase - t*12.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        varying vec2 flameUV;
        uniform float clock, power;
        void main() {
          float t=flameUV.y;
          float ripple=0.73+0.27*sin(t*39.0-clock*61.0 + sin(flameUV.x*18.85)*1.5);
          vec3 colour=mix(vec3(0.24,0.60,1.0),vec3(0.94,0.92,0.76),smoothstep(0.06,0.28,t));
          colour=mix(colour,vec3(1.0,0.23,0.036),smoothstep(0.24,0.65,t));
          gl_FragColor=vec4(colour, power*ripple*(1.0-smoothstep(0.45,1.0,t)));
        }`,
    });
    super(geometry, material);
    this.name = 'NitroJets';
    this.visible = false;
  }

  update(dt, boosting) {
    const u = this.material.uniforms;
    u.clock.value = (u.clock.value + dt) % 60;
    u.power.value = THREE.MathUtils.damp(u.power.value, boosting ? 1 : 0, boosting ? 36 : 24, dt);
    this.visible = u.power.value > 0.025;
  }
}
