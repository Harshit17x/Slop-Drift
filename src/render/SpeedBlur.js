import * as THREE from 'three';
import { smoothstep } from '../core/math.js';

// Composite over the finished canvas so the scene keeps its native MSAA, colour
// grading and exposure. No previous frames to smear across cuts or respawns.
export class SpeedBlur {
  constructor() {
    this.size = new THREE.Vector2();
    this.direction = new THREE.Vector3();
    this.uniforms = {
      frame: { value: null },
      flow: { value: new THREE.Vector3() },
      strength: { value: 0 },
      cockpit: { value: false },
      economical: { value: false },
    };
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, depthTest: false, depthWrite: false, toneMapped: false,
      vertexShader: `
        varying vec2 screenUV;
        void main() {
          screenUV = position.xy * 0.5 + 0.5;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D frame;
        uniform vec3 flow;
        uniform float strength;
        uniform bool cockpit, economical;
        varying vec2 screenUV;
        void main() {
          vec2 p = screenUV - 0.5;
          // Leave the apex and the chase car sharp. In the cockpit, protect the dash too.
          float edge = smoothstep(0.19, 0.52, length(vec2(p.x, p.y * 0.54)));
          if (cockpit) edge *= smoothstep(0.24, 0.56, screenUV.y);
          if (edge <= 0.0) discard;
          vec2 ray = (p * flow.z - flow.xy) * strength * edge;
          vec4 color = texture2D(frame, screenUV);
          if (economical) {
            color = 0.4 * color + 0.3 * (texture2D(frame, screenUV - ray * 0.65)
                                       + texture2D(frame, screenUV + ray * 0.65));
          } else {
            color = 0.28 * color + 0.23 * (texture2D(frame, screenUV - ray * 0.45)
                                        + texture2D(frame, screenUV + ray * 0.45))
                                + 0.13 * (texture2D(frame, screenUV - ray)
                                        + texture2D(frame, screenUV + ray));
          }
          gl_FragColor = color;
        }`,
    });
    this.pass = new THREE.Mesh(geometry, material);
    this.pass.frustumCulled = false;
    this.camera = new THREE.OrthographicCamera();
  }

  render(renderer, camera, state, cockpit) {
    const amount = smoothstep(55, 175, state.speedKmh);
    if (amount === 0) return;
    renderer.getDrawingBufferSize(this.size);
    const { x: width, y: height } = this.size;
    if (!width || !height) return;
    let frame = this.uniforms.frame.value;
    if (!frame || frame.image.width !== width || frame.image.height !== height) {
      frame?.dispose();
      frame = new THREE.FramebufferTexture(width, height);
      frame.minFilter = frame.magFilter = THREE.LinearFilter;
      this.uniforms.frame.value = frame;
    }
    // Perspective motion radiates from the direction of travel. Sideways velocity
    // during a drift shifts the streaks across the screen with the passing scenery.
    const dir = this.direction.copy(state.velocity).transformDirection(camera.matrixWorldInverse);
    const projection = camera.projectionMatrix.elements;
    this.uniforms.flow.value.set(dir.x * projection[0] * 0.5, dir.y * projection[5] * 0.5, -dir.z);
    this.uniforms.strength.value = amount * 0.033;
    this.uniforms.cockpit.value = cockpit;
    renderer.copyFramebufferToTexture(frame);
    const clear = renderer.autoClear;
    const reset = renderer.info.autoReset;
    renderer.autoClear = renderer.info.autoReset = false;
    try {
      renderer.render(this.pass, this.camera);
    } finally {
      renderer.autoClear = clear;
      renderer.info.autoReset = reset;
    }
  }

  dispose() {
    this.pass.material.dispose();
    this.pass.geometry.dispose();
    this.uniforms.frame.value?.dispose();
  }
}
