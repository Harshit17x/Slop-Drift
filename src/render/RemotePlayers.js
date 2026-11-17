import * as THREE from 'three';
import { ProceduralCar } from './ProceduralCar.js';
import { NameTag } from './NameTag.js';
import { getPaint } from '../config.js';
import { RIM_OPTIONS } from '../meta/catalog.js';

const WHEEL_KEYS = ['frontLeft', 'frontRight', 'rearLeft', 'rearRight'];
const WHEEL_RADIUS = 0.34;
/** Cars closer to the camera than FADE_FAR start to fade, down to FADE_MIN opacity at FADE_NEAR. */
const FADE_FAR = 7;
const FADE_NEAR = 2.5;
const FADE_MIN = 0.18;

function rimColor(id) {
  return (RIM_OPTIONS.find((rim) => rim.id === id) || RIM_OPTIONS[0]).color;
}

/** The peer's cosmetics as one comparable key, so the car is only repainted when something changed. */
function lookKey(peer) {
  return `${peer.paint}|${peer.rim}|${peer.number}`;
}

/**
 * Other players' cars: one ProceduralCar per NetClient peer, placed from samplePeer() every frame,
 * with a NameTag (name + level) above it.
 *
 *   const remotes = new RemotePlayers({ scene, net });
 *   remotes.update(dt, camera, performance.now());   // every frame
 */
export class RemotePlayers {
  /**
   * @param {object} options
   * @param {THREE.Object3D} options.scene
   * @param {import('../net/NetClient.js').NetClient} options.net
   * @param {{x:number,y:number,z:number}[]} [options.wheelLayout]  Vehicle.wheelLayout, to match the local car exactly.
   */
  constructor({ scene, net, wheelLayout = null }) {
    this.net = net;
    this.group = new THREE.Group();
    this.group.name = 'RemotePlayers';
    scene.add(this.group);
    this.cars = new Map();
    this.carOptions = wheelLayout
      ? { wheelbase: Math.abs(wheelLayout[0].z - wheelLayout[2].z), track: Math.abs(wheelLayout[0].x) * 2, wheelCentreY: wheelLayout[0].y }
      : {};
    this.scratch = new THREE.Vector3();
  }

  /** Number of remote cars currently managed. */
  get count() {
    return this.cars.size;
  }

  setVisible(visible) {
    this.group.visible = Boolean(visible);
  }

  /**
   * @param {number} dt          Frame time in seconds (wheel spin).
   * @param {THREE.Camera} camera
   * @param {number} [renderTime] performance.now() for this frame.
   */
  update(dt, camera, renderTime = performance.now()) {
    const peers = this.net?.peers;
    if (!peers) return;
    for (const [id, entry] of this.cars) {
      if (!peers.has(id)) this.remove(id, entry);
    }
    if (!this.group.visible) return;
    const step = Math.min(Math.max(dt, 0), 0.1);
    for (const [id, peer] of peers) {
      let entry = this.cars.get(id);
      if (!entry) entry = this.add(id, peer);
      this.refresh(entry, peer);

      const sample = this.net.samplePeer(id, renderTime, entry.car.position, entry.car.quaternion);
      if (!sample) {
        entry.car.visible = false;
        continue;
      }
      entry.car.visible = true;
      entry.car.setSteering(sample.steer);
      const spin = (sample.speed / WHEEL_RADIUS) * step;
      for (const key of WHEEL_KEYS) entry.car.addWheelSpin(key, spin);
      entry.car.setBraking(sample.braking);
      entry.car.setReversing(sample.reversing);

      if (camera) {
        entry.tag.update(camera);
        const distance = this.scratch.copy(entry.car.position).distanceTo(camera.position);
        this.fade(entry, distance);
      }
    }
  }

  add(id, peer) {
    const car = new ProceduralCar({ color: getPaint(peer.paint).color, name: `Remote_${peer.name}`, ...this.carOptions });
    car.visible = false;
    car.traverse((node) => {
      if (node.isMesh) node.castShadow = true;
    });
    const tag = new NameTag({ text: peer.name, detail: `LV ${peer.level}` });
    car.add(tag.sprite);
    this.group.add(car);
    const entry = { car, tag, look: '', opacity: 1, baseTransparent: new Map() };
    for (const material of car.materials) entry.baseTransparent.set(material, { transparent: material.transparent, opacity: material.opacity, depthWrite: material.depthWrite });
    this.cars.set(id, entry);
    return entry;
  }

  refresh(entry, peer) {
    entry.tag.set(peer.name, `LV ${peer.level}`);
    const key = lookKey(peer);
    if (entry.look !== key) {
      entry.look = key;
      entry.car.setPaint(getPaint(peer.paint));
      entry.car.setRimColor(rimColor(peer.rim));
      if (peer.number) entry.car.setNumber(peer.number);
    }
  }

  /** Fade cars that sit almost on top of the camera so they never block the view. */
  fade(entry, distance) {
    const t = THREE.MathUtils.clamp((distance - FADE_NEAR) / (FADE_FAR - FADE_NEAR), 0, 1);
    const opacity = FADE_MIN + (1 - FADE_MIN) * t;
    if (Math.abs(opacity - entry.opacity) < 0.01) return;
    const wasOpaque = entry.opacity >= 0.999;
    const nowOpaque = opacity >= 0.999;
    entry.opacity = opacity;
    for (const [material, base] of entry.baseTransparent) {
      if (nowOpaque) {
        material.transparent = base.transparent;
        material.opacity = base.opacity;
        material.depthWrite = base.depthWrite;
      } else {
        material.transparent = true;
        material.opacity = base.opacity * opacity;
        material.depthWrite = false;
      }
      if (wasOpaque !== nowOpaque) material.needsUpdate = true;
    }
    entry.tag.material.opacity *= opacity < 0.5 ? 0.5 : 1;
  }

  remove(id, entry = this.cars.get(id)) {
    if (!entry) return;
    entry.tag.dispose();
    entry.car.parent?.remove(entry.car);
    entry.car.dispose();
    this.cars.delete(id);
  }

  dispose() {
    for (const [id, entry] of this.cars) this.remove(id, entry);
    this.group.parent?.remove(this.group);
  }
}
