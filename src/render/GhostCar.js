// A translucent replay car: the procedural model re-skinned with two shared ghost materials (a tinted
// shell and a darker one for tyres, glass and trim) that glow at grazing angles, plus a name tag.
//
//   const ghost = new GhostCar({ paintColor: 'ember', name: 'Harsh', detail: 'PB 1:52.3' });
//   scene.add(ghost.group);
//   every frame:  const pose = player.poseAt(t, pos, quat);
//                 ghost.setPose(pos, quat, pose.steer, t);
//                 ghost.update(camera, playerCarPosition);
import * as THREE from 'three';
import { PAINT_OPTIONS } from '../config.js';
import { ProceduralCar } from './ProceduralCar.js';
import { NameTag } from './NameTag.js';

const WHEEL_KEYS = ['frontLeft', 'frontRight', 'rearLeft', 'rearRight'];
const TWO_PI = Math.PI * 2;
// Cockpit-only parts of ProceduralCar (dashboard, gauges): hidden, they only add clutter through the glass.
const COCKPIT_COLOR = 0x1e2226;
const GAUGE_EMISSIVE = 0x2a8fd0;

const forward = new THREE.Vector3();
const delta = new THREE.Vector3();
const centre = new THREE.Vector3();
const hsl = { h: 0, s: 0, l: 0 };
const WHITE = new THREE.Color(0xffffff);
const GHOST_BLUE = new THREE.Color(0x5fb8ff);

/** A paint id ('ember'), a number (0xff5b36) or any CSS colour string. */
export function resolvePaintColor(paint, fallback = 0xe9eef5) {
  if (paint instanceof THREE.Color) return paint.clone();
  const option = typeof paint === 'string' ? PAINT_OPTIONS.find((entry) => entry.id === paint) : null;
  const color = new THREE.Color(fallback);
  if (option) color.setHex(option.color);
  else if (typeof paint === 'number' && Number.isFinite(paint)) color.setHex(paint);
  else if (typeof paint === 'string' && /^#|^rgb|^hsl/i.test(paint)) color.setStyle(paint);
  return color;
}

function ghostMaterial(uniforms, baseAlpha) {
  const material = new THREE.MeshStandardMaterial({
    roughness: 0.45,
    metalness: 0,
    transparent: true,
    depthWrite: false,
  });
  material.userData.ghostBaseAlpha = { value: baseAlpha };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGhostOpacity = uniforms.opacity;
    shader.uniforms.uGhostRim = uniforms.rim;
    shader.uniforms.uGhostRimPower = uniforms.rimPower;
    shader.uniforms.uGhostBaseAlpha = material.userData.ghostBaseAlpha;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uGhostOpacity;
uniform float uGhostBaseAlpha;
uniform float uGhostRimPower;
uniform vec3 uGhostRim;`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
{
  float ghostFacing = clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0);
  float ghostFresnel = pow(1.0 - ghostFacing, uGhostRimPower);
  gl_FragColor.rgb += uGhostRim * ghostFresnel;
  gl_FragColor.a = uGhostOpacity * clamp(mix(uGhostBaseAlpha, 1.0, ghostFresnel), 0.0, 1.0);
}`);
  };
  material.customProgramCacheKey = () => 'slop-drift-ghost-v1';
  return material;
}

export class GhostCar {
  /**
   * @param {object} [options]
   * @param {number|string|THREE.Color} [options.paintColor]  Paint id, hex number or CSS colour.
   * @param {string} [options.name]
   * @param {string} [options.detail]   Second label line, e.g. 'PB 1:52.3'.
   * @param {{x:number,y:number,z:number}[]} [options.wheelLayout]  Vehicle.wheelLayout, as CarVisual takes it.
   */
  constructor({ paintColor = 0xe9eef5, name = 'Ghost', detail = '', wheelLayout = null } = {}) {
    this.model = new ProceduralCar({ name: 'GhostCar', wheelLayout });
    this.group = this.model;
    this.wheelRadius = this.model.dimensions.wheelRadius;

    this.uniforms = {
      opacity: { value: 1 },
      rim: { value: new THREE.Color() },
      rimPower: { value: 2.2 },
    };
    this.shellMaterial = ghostMaterial(this.uniforms, 0.3);
    this.darkMaterial = ghostMaterial(this.uniforms, 0.5);

    // Swap every material for one of the two ghost materials, then free the originals.
    const originals = new Set(this.model.materials);
    const isDark = (material) => {
      if (material === this.model.bodyMaterial) return false;
      const c = material.color;
      const emissive = material.emissive ? material.emissive.r + material.emissive.g + material.emissive.b : 0;
      return emissive === 0 && c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722 < 0.06;
    };
    this.model.traverse((node) => {
      if (!node.isMesh) return;
      const original = node.material;
      if (original.color?.getHex() === COCKPIT_COLOR || original.emissive?.getHex() === GAUGE_EMISSIVE) node.visible = false;
      node.material = isDark(original) ? this.darkMaterial : this.shellMaterial;
      node.castShadow = false;
      node.receiveShadow = false;
    });
    if (this.model.steeringWheel) this.model.steeringWheel.visible = false;
    originals.forEach((material) => material.dispose());
    this.model.textures.forEach((texture) => texture.dispose());
    this.model.materials = [this.shellMaterial, this.darkMaterial];
    this.model.textures = [];

    this.tag = new NameTag({ text: name, detail, height: 2.15 });
    this.model.add(this.tag.sprite);

    this.spin = 0;
    this.lastPosition = new THREE.Vector3();
    this.lastTime = -Infinity;
    this.hasPose = false;
    this.fade = 1;
    this.visible = true;
    this.setColor(paintColor);
  }

  /** Re-tint the ghost (paint id, hex number or CSS colour). */
  setColor(paintColor) {
    const paint = resolvePaintColor(paintColor);
    // Keep the tint mid-bright: dark paints would vanish against forest and night, white ones against
    // snow and sky. Near-grey paints get a cool cast so they still read as a ghost on snow.
    paint.getHSL(hsl);
    const tint = new THREE.Color().setHSL(hsl.h, Math.min(hsl.s, 0.85), Math.min(0.68, Math.max(hsl.l, 0.5)));
    if (hsl.s < 0.25) tint.lerp(GHOST_BLUE, 0.45 * (1 - hsl.s / 0.25));
    this.shellMaterial.color.copy(tint);
    this.shellMaterial.emissive.copy(tint).multiplyScalar(0.28);
    this.darkMaterial.color.copy(tint).multiplyScalar(0.18);
    this.darkMaterial.emissive.copy(tint).multiplyScalar(0.06);
    this.uniforms.rim.value.copy(tint).lerp(WHITE, 0.3).multiplyScalar(1.6);
    this.tag.accent = `#${tint.clone().lerp(WHITE, 0.25).getHexString()}`;
    const { text, detail } = this.tag;
    this.tag.text = null;
    this.tag.set(text, detail);
    return this;
  }

  setLabel(name, detail = '') {
    this.tag.set(String(name ?? ''), String(detail ?? ''));
  }

  setVisible(visible) {
    this.visible = Boolean(visible);
    this.model.visible = this.visible;
  }

  /**
   * Place the ghost. `time` is the playback clock: when it goes backwards (restart) or the ghost jumps
   * (respawn), the wheels do not spin for that step.
   * @param {THREE.Vector3} position
   * @param {THREE.Quaternion} quaternion
   * @param {number} steer  Front wheel angle in radians.
   * @param {number} time
   */
  setPose(position, quaternion, steer = 0, time = 0) {
    if (this.hasPose && time >= this.lastTime) {
      delta.subVectors(position, this.lastPosition);
      if (delta.lengthSq() < 30 * 30) {
        forward.set(0, 0, -1).applyQuaternion(quaternion);
        this.spin = (this.spin + delta.dot(forward) / this.wheelRadius) % TWO_PI;
      }
    }
    this.lastPosition.copy(position);
    this.lastTime = time;
    this.hasPose = true;
    this.model.position.copy(position);
    this.model.quaternion.copy(quaternion);
    this.model.setSteering(Number.isFinite(steer) ? steer : 0);
    for (const key of WHEEL_KEYS) this.model.setWheelSpin(key, this.spin);
  }

  /**
   * Per frame: fade out when the camera (or, if given, the player's car) is close, and update the tag.
   * @param {THREE.Camera} camera
   * @param {{x:number,y:number,z:number}} [focus]  The player's car position, optional.
   */
  update(camera, focus = null) {
    if (!this.visible) return;
    centre.copy(this.model.position);
    centre.y += 0.7;
    // Gone when the camera is inside or right next to it (interior views, a ghost between the chase
    // camera and the player); overlap with the player's car is handled by `focus`.
    let fade = THREE.MathUtils.smoothstep(centre.distanceTo(camera.position), 1.5, 5.5);
    if (focus) {
      const dx = focus.x - this.model.position.x;
      const dy = focus.y - this.model.position.y;
      const dz = focus.z - this.model.position.z;
      fade = Math.min(fade, 0.2 + 0.8 * THREE.MathUtils.smoothstep(Math.hypot(dx, dy, dz), 2, 6));
    }
    this.fade = fade;
    this.uniforms.opacity.value = fade;
    const show = fade > 0.02;
    this.shellMaterial.visible = show;
    this.darkMaterial.visible = show;
    this.tag.update(camera);
    this.tag.material.opacity *= Math.max(0.35, fade);
  }

  dispose() {
    this.model.parent?.remove(this.model);
    this.tag.dispose();
    this.model.dispose();
  }
}
