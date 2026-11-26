import * as THREE from 'three';
import { smoothstep } from '../core/math.js';
import { STAGE } from '../world/jungleStage.js';

// Low-poly wildlife rendered as one instanced sphere draw per species. Each
// animal is a small hierarchy of transforms; only the changed matrices are
// pushed once per frame, so a herd costs the same draw-call budget as a rock.

const UP = new THREE.Vector3(0, 1, 0);

class InstancedRig {
  constructor(parts, geometry, material) {
    this.parts = parts;
    this.mesh = new THREE.InstancedMesh(geometry, material, parts.length);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    parts.forEach(({ color }, i) => this.mesh.setColorAt(i, new THREE.Color(color)));
  }

  sync() {
    for (let i = 0; i < this.parts.length; i++) {
      const { node } = this.parts[i];
      node.updateWorldMatrix(true, false);
      this.mesh.setMatrixAt(i, node.matrixWorld);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

function makePart(parts, parent, x, y, z, sx, sy, sz, color, tilt = 0, yaw = 0) {
  const node = new THREE.Object3D();
  node.position.set(x, y, z);
  node.scale.set(sx, sy, sz);
  node.rotation.set(tilt, yaw, 0);
  parent.add(node);
  parts.push({ node, color });
  return node;
}

function makePivot(parts, parent, x, y, z) {
  const node = new THREE.Object3D();
  node.position.set(x, y, z);
  parent.add(node);
  return node;
}

/** Elephant family at the salt lick: they stand their ground and face the noise. */
export class ElephantHerd {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'ElephantHerd';
    const road = world.roads[0], frame = road.frameAt(STAGE.elephants, {});
    this.centre = { x: frame.x + frame.rx * 11, z: frame.z + frame.rz * 11 };
    this.parts = [];
    this.elephants = [];
    this.time = 0;
    this.alert = 0;
    this.geometry = new THREE.SphereGeometry(1, 10, 7);
    this.material = new THREE.MeshStandardMaterial({ roughness: 0.94, metalness: 0 });
    const colours = [
      { coat: 0x736a5d, shade: 0x625a4e, back: 0x847867, tusk: 0xc9b693 },
      { coat: 0x6a6255, shade: 0x5a5348, back: 0x7c7161, tusk: 0xc2ad8a },
      { coat: 0x7c7163, shade: 0x6a6153, back: 0x8c806e, tusk: 0xc9b693 },
    ];
    for (let i = 0; i < 3; i++) {
      const calf = i === 2;
      const root = new THREE.Object3D();
      root.scale.setScalar(calf ? 0.58 : 1.0 + i * 0.03);
      this.group.add(root);
      const c = colours[i];
      const parts = this.parts;
      // Barrel built from ribcage, belly and haunches so the silhouette has a
      // back line and a tucked belly instead of reading as one boulder.
      makePart(parts, root, 0, 1.58, -0.12, 0.74, 0.84, 1.28, c.coat);
      makePart(parts, root, 0, 1.42, -0.38, 0.68, 0.7, 1.16, c.shade);
      makePart(parts, root, 0, 1.78, 0.82, 0.68, 0.66, 0.6, c.coat);
      makePart(parts, root, 0, 1.66, -1.4, 0.6, 0.7, 0.58, c.shade);
      makePart(parts, root, 0, 2.12, -0.35, 0.46, 0.3, 1.05, c.back);
      makePart(parts, root, 0, 1.98, -1.3, 0.44, 0.34, 0.44, c.back);
      // Big head with a domed forehead and wide cheeks.
      const head = makePivot(parts, root, 0, 1.84, 1.4);
      makePart(parts, head, 0, 0.02, 0.12, 0.48, 0.6, 0.56, c.coat);
      makePart(parts, head, 0, 0.4, 0.3, 0.4, 0.42, 0.44, c.coat);
      makePart(parts, head, 0, 0.18, 0.55, 0.34, 0.34, 0.3, c.back);
      makePart(parts, head, 0, -0.28, 0.34, 0.41, 0.33, 0.44, c.shade);
      for (const side of [-1, 1]) {
        makePart(parts, head, side * 0.34, -0.02, 0.3, 0.24, 0.38, 0.36, c.shade);
        makePart(parts, head, side * 0.3, 0.16, 0.66, 0.035, 0.045, 0.045, 0x1d1915);
      }
      // Trunk: four tapering segments hanging from the face, with a curled tip.
      const trunk = [];
      let parent = head;
      const radii = [0.22, 0.19, 0.16, 0.12];
      const lengths = [0.32, 0.3, 0.26, 0.22];
      for (let k = 0; k < 4; k++) {
        const joint = makePivot(parts, parent, 0, k === 0 ? -0.4 : -lengths[k - 1], k === 0 ? 0.56 : 0.1);
        makePart(parts, joint, 0, -lengths[k] * 0.46, 0.02,
          radii[k], lengths[k] * 0.72, radii[k] * 0.92, k === 3 ? c.shade : c.coat, k * 0.03);
        trunk.push(joint);
        parent = joint;
      }
      const ears = [], legs = [];
      for (const side of [-1, 1]) {
        // Broad fan ears hang beside the head from a hinge at the temple, so
        // they read as ears rather than a pair of upright paddles.
        const ear = makePivot(parts, head, side * 0.46, 0.06, 0.24);
        makePart(parts, ear, side * 0.05, -0.34, -0.06, 0.045, 0.6, 0.53, c.shade);
        makePart(parts, ear, side * 0.075, -0.32, -0.02, 0.028, 0.44, 0.38, 0x6b5f52);
        ears.push(ear);
        // Two tusks: a three-joint chain that runs forward, dips, then curls up.
        const tuskX = side * 0.22;
        const tusk1 = makePivot(parts, head, tuskX, -0.42, 0.5);
        tusk1.rotation.x = 0.74;
        tusk1.rotation.z = side * -0.14;
        makePart(parts, tusk1, 0, 0, 0.16, 0.058, 0.058, 0.19, c.tusk);
        const tusk2 = makePivot(parts, tusk1, 0, 0, 0.32);
        tusk2.rotation.x = -0.5;
        makePart(parts, tusk2, 0, 0, 0.14, 0.043, 0.043, 0.17, c.tusk);
        const tusk3 = makePivot(parts, tusk2, 0, 0, 0.29);
        tusk3.rotation.x = -0.52;
        makePart(parts, tusk3, 0, 0, 0.1, 0.03, 0.03, 0.12, c.tusk);
        // Columnar legs with knees and broad feet.
        for (const fore of [-1, 1]) {
          const leg = makePivot(parts, root, side * 0.38, 1.24, fore * 0.92);
          makePart(parts, leg, 0, -0.32, 0, 0.24, 0.44, 0.26, c.coat);
          makePart(parts, leg, 0, -0.68, 0.01, 0.2, 0.3, 0.22, c.shade);
          makePart(parts, leg, 0, -0.95, 0.02, 0.2, 0.26, 0.21, c.coat);
          makePart(parts, leg, 0, -1.13, 0.04, 0.27, 0.14, 0.29, c.shade);
          legs.push(leg);
        }
      }
      // Tail with a dark tuft.
      makePart(parts, root, 0, 1.55, -1.94, 0.05, 0.5, 0.05, c.shade, 0.06);
      makePart(parts, root, 0, 1.02, -1.98, 0.08, 0.14, 0.08, 0x3a332b);
      this.elephants.push({ root, head, trunk, ears, legs, phase: i * 1.7, calf });
    }
    this.rig = new InstancedRig(this.parts, this.geometry, this.material);
    this.group.add(this.rig.mesh);
    this.group.position.set(0, 0, 0);
  }

  update(dt, camera, car) {
    const distance = Math.hypot(camera.x - this.centre.x, camera.z - this.centre.z);
    this.group.visible = distance < 165;
    if (!this.group.visible) return;
    this.time += dt;
    const carDistance = Math.hypot(car.x - this.centre.x, car.z - this.centre.z);
    const target = smoothstep(68, 26, carDistance);
    this.alert += (target - this.alert) * Math.min(1, dt * 2.2);
    const frame = this.world.roads[0].frameAt(STAGE.elephants, {});
    for (let i = 0; i < this.elephants.length; i++) {
      const e = this.elephants[i];
      const phase = e.phase;
      const lateral = [9.4, 12.2, 14.4][i];
      const along = [-4.6, 2.8, -0.9][i];
      const x = frame.x + frame.rx * lateral + frame.tx * along;
      const z = frame.z + frame.rz * lateral + frame.tz * along;
      const yaw = Math.atan2(-frame.rx, -frame.rz) + Math.sin(this.time * 0.24 + phase) * 0.18 - this.alert * 0.28 + (i - 1) * 0.34;
      // Sample the ground under the feet so a bank does not leave one side
      // hanging in the air; the herd tilts gently with the slope.
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      const sx = Math.cos(yaw), sz = -Math.sin(yaw);
      const hFront = this.world.grid.heightAt(x + fx * 1.15, z + fz * 1.15);
      const hBack = this.world.grid.heightAt(x - fx * 1.15, z - fz * 1.15);
      const hRight = this.world.grid.heightAt(x + sx * 0.55, z + sz * 0.55);
      const hLeft = this.world.grid.heightAt(x - sx * 0.55, z - sz * 0.55);
      const ground = (hFront + hBack + hRight + hLeft) * 0.25;
      const tiltX = Math.max(-0.12, Math.min(0.12, -Math.atan2(hFront - hBack, 2.3) * 0.8));
      const tiltZ = Math.max(-0.1, Math.min(0.1, Math.atan2(hRight - hLeft, 1.1) * 0.7));
      e.root.position.set(x, ground - 0.03, z);
      e.root.rotation.y = yaw;
      e.root.rotation.x = tiltX + 0.012 * Math.sin(this.time * 0.8 + phase);
      e.root.rotation.z = tiltZ;
      const flap = this.alert * (0.4 + 0.24 * Math.sin(this.time * 5.4 + phase)) + 0.06;
      for (let k = 0; k < (e.ears?.length || 0); k++) {
        e.ears[k].rotation.z = (k ? 1 : -1) * (0.14 + flap);
        e.ears[k].rotation.y = (k ? 1 : -1) * 0.18;
      }
      const lift = this.alert * (0.3 + 0.22 * Math.sin(this.time * 2.6 + phase));
      for (let k = 0; k < e.trunk.length; k++) {
        e.trunk[k].rotation.x = (k === 0 ? -0.35 : k === 3 ? 0.26 : 0.08) - lift * (0.4 + k * 0.2);
        e.trunk[k].rotation.z = Math.sin(this.time * 0.7 + phase + k) * 0.06;
      }
      if (e.legs) {
        for (let k = 0; k < e.legs.length; k++) e.legs[k].rotation.x = Math.sin(this.time * 1.1 + phase + k * 1.7) * 0.035;
      }
    }
    this.rig.sync();
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** Macaques on the bamboo run: lounging until a car scares them into the canopy. */
export class MacaqueTroop {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'MacaqueTroop';
    const road = world.roads[0];
    this.centreS = (STAGE.bamboo.start + STAGE.bamboo.end) / 2 - 46;
    this.frame = road.frameAt(this.centreS, {});
    this.centre = { x: this.frame.x - this.frame.rx * 6, z: this.frame.z - this.frame.rz * 6 };
    this.parts = [];
    this.monkeys = [];
    this.time = 0;
    this.flee = 0;
    this.active = false;
    this.geometry = new THREE.SphereGeometry(1, 8, 6);
    this.material = new THREE.MeshStandardMaterial({ roughness: 0.95 });
    const coats = [0x8b7251, 0x7b6447, 0x967a57, 0x6f5a3f];
    for (let i = 0; i < 7; i++) {
      const root = new THREE.Object3D();
      this.group.add(root);
      const coat = coats[i % coats.length];
      const parts = this.parts;
      makePart(parts, root, 0, 0.42, 0, 0.24, 0.34, 0.3, coat);
      const head = makePivot(parts, root, 0, 0.72, 0.07);
      makePart(parts, head, 0, 0, 0, 0.22, 0.22, 0.22, coat);
      makePart(parts, head, 0, -0.05, 0.19, 0.14, 0.13, 0.1, 0x3b2f24);
      makePart(parts, head, 0, -0.16, 0.2, 0.1, 0.09, 0.06, 0x2b2119);
      for (const side of [-1, 1]) makePart(parts, head, side * 0.19, 0.02, 0, 0.05, 0.08, 0.04, 0x3d3025);
      const tail = [];
      let parent = root;
      for (let k = 0; k < 3; k++) {
        const joint = makePivot(parts, parent, 0, k === 0 ? 0.44 : 0.18, k === 0 ? -0.18 : -0.1);
        makePart(parts, joint, 0, 0.18, -0.14, 0.055, 0.22, 0.055, 0x5b4a35);
        tail.push(joint);
        parent = joint;
      }
      const legs = [];
      for (const side of [-1, 1]) {
        for (const fore of [-1, 1]) {
          const leg = makePivot(parts, root, side * 0.16, 0.28, fore * 0.16);
          makePart(parts, leg, 0, -0.18, 0, 0.075, 0.2, 0.075, coat);
          legs.push({ leg, phase: (side * fore > 0 ? 0 : Math.PI) + i });
        }
      }
      this.monkeys.push({ root, head, tail, legs, phase: i * 0.9, i });
    }
    this.rig = new InstancedRig(this.parts, this.geometry, this.material);
    this.group.add(this.rig.mesh);
  }

  update(dt, camera, car) {
    const distance = Math.hypot(camera.x - this.centre.x, camera.z - this.centre.z);
    this.group.visible = distance < 150;
    if (!this.group.visible) { this.flee = 0; this.active = false; return; }
    this.time += dt;
    const carDistance = Math.hypot(car.x - this.centre.x, car.z - this.centre.z);
    if (!this.active && carDistance < 48) this.active = true;
    if (this.active) this.flee = Math.min(1, this.flee + dt * 0.6);
    else this.flee = Math.max(0, this.flee - dt * 0.15);
    const f = this.frame;
    for (const m of this.monkeys) {
      const idle = Math.sin(this.time * 0.7 + m.phase);
      const t = Math.max(0, this.flee - m.i * 0.06);
      const ease = 1 - Math.exp(-t * 2.6);
      const lateral = 5.8 + m.i * 0.45 + ease * (9 + (m.i % 3) * 2);
      const along = (m.i - 3) * 1.2 + Math.sin(this.time * 0.3 + m.phase) * 0.5;
      const x = f.x - f.rx * lateral + f.tx * along;
      const z = f.z - f.rz * lateral + f.tz * along;
      const ground = this.world.grid.heightAt(x, z);
      const leap = ease * (2.6 + (m.i % 3) * 1.1) + Math.abs(Math.sin(this.time * 3 + m.phase)) * 0.15 * (1 - ease);
      m.root.position.set(x, ground + 0.04 + leap, z);
      m.root.rotation.y = Math.atan2(-f.rx, -f.rz) + Math.sin(this.time * 0.5 + m.phase) * 0.25 - ease * 0.35;
      m.root.rotation.x = idle * 0.03 + ease * 0.25;
      m.head.rotation.x = -0.25 * (1 - ease) + Math.sin(this.time * 2.2 + m.phase) * 0.1;
      for (let k = 0; k < m.tail.length; k++) {
        m.tail[k].rotation.x = Math.sin(this.time * (2 + k) + m.phase + k) * 0.22;
        m.tail[k].rotation.z = 0.2 + Math.sin(this.time * 1.6 + m.phase + k) * 0.16;
      }
      for (const { leg, phase } of m.legs) {
        leg.rotation.x = Math.sin(this.time * 8 + phase) * 0.3 * ease + Math.sin(this.time * 1.2 + phase) * 0.03;
      }
    }
    this.rig.sync();
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** Sambar deer in the Cloud Ridge glade. They graze, then bolt at the noise. */
export class SambarDeer {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'SambarDeer';
    const road = world.roads[0];
    this.frame = road.frameAt(STAGE.deerGlade, {});
    this.centre = { x: this.frame.x + this.frame.rx * 8.2, z: this.frame.z + this.frame.rz * 8.2 };
    this.parts = [];
    this.deer = [];
    this.time = 0;
    this.flee = 0;
    this.active = false;
    this.geometry = new THREE.SphereGeometry(1, 9, 7);
    this.material = new THREE.MeshStandardMaterial({ roughness: 0.95 });
    for (let i = 0; i < 3; i++) {
      const root = new THREE.Object3D();
      root.scale.setScalar(i === 2 ? 0.92 : 1.04);
      this.group.add(root);
      const coat = i === 0 ? 0x6d5940 : i === 1 ? 0x7b6548 : 0x5f4d38;
      const mane = i === 0 ? 0x4d3d29 : 0x57452f;
      const parts = this.parts;
      // Chest and haunch are separate masses so the barrel reads long, not round.
      makePart(parts, root, 0, 1.17, 0.28, 0.3, 0.31, 0.56, coat);
      makePart(parts, root, 0, 1.19, -0.38, 0.34, 0.33, 0.48, coat);
      makePart(parts, root, 0, 1.12, -0.04, 0.31, 0.3, 0.62, coat);
      // Dark dorsal mane along the spine.
      makePart(parts, root, 0, 1.52, -0.04, 0.065, 0.06, 0.86, mane);
      // Shoulder mass blends the neck into the chest.
      makePart(parts, root, 0, 1.32, 0.52, 0.25, 0.26, 0.3, coat);
      // Neck rises forward off the shoulder, with a shaggy mane underneath.
      const neck = makePivot(parts, root, 0, 1.4, 0.5);
      makePart(parts, neck, 0, 0.22, 0.08, 0.16, 0.36, 0.2, coat, 0.24);
      makePart(parts, neck, 0, 0.1, 0.19, 0.12, 0.3, 0.1, mane, 0.3);
      makePart(parts, neck, 0, 0.1, -0.13, 0.055, 0.28, 0.055, mane);
      const head = makePivot(parts, neck, 0, 0.5, 0.24);
      makePart(parts, head, 0, 0, 0.1, 0.15, 0.17, 0.24, coat, 0.1);
      makePart(parts, head, 0, -0.05, 0.3, 0.095, 0.105, 0.16, mane);
      makePart(parts, head, 0, 0.05, 0.4, 0.055, 0.05, 0.055, 0x2a2118);
      makePart(parts, head, 0, -0.1, 0.14, 0.08, 0.06, 0.14, 0xb8a689);
      for (const side of [-1, 1]) {
        // Tall sambar ears flare out behind the eyes.
        makePart(parts, head, side * 0.15, 0.12, 0.02, 0.055, 0.16, 0.04, coat, 0, side * 0.35);
        makePart(parts, head, side * 0.08, 0.06, 0.2, 0.022, 0.022, 0.022, 0x17120d);
        if (i < 2) {
          // Thick swept-back beams with brow and forked top tines.
          const beam = makePart(parts, head, side * 0.09, 0.32, -0.04, 0.044, 0.34, 0.044, 0x6d5940, -0.35);
          beam.rotation.z = side * 0.24;
          const beamTop = makePart(parts, head, side * 0.17, 0.61, -0.16, 0.038, 0.25, 0.038, 0x6d5940, -0.2);
          beamTop.rotation.z = side * 0.5;
          const brow = makePart(parts, head, side * 0.17, 0.36, 0.17, 0.035, 0.19, 0.035, 0x6d5940, 0.75);
          brow.rotation.z = side * 0.18;
          const top = makePart(parts, head, side * 0.3, 0.76, -0.1, 0.031, 0.18, 0.031, 0x6d5940, -0.5);
          top.rotation.z = side * 0.72;
          const back = makePart(parts, head, side * 0.23, 0.76, -0.29, 0.028, 0.16, 0.028, 0x6d5940, 0.55);
          back.rotation.z = side * 0.4;
        }
      }
      const legs = [];
      for (const side of [-1, 1]) {
        for (const fore of [-1, 1]) {
          const leg = makePivot(parts, root, side * 0.18, 0.84, fore * 0.38);
          makePart(parts, leg, 0, -0.22, 0, 0.085, 0.28, 0.1, coat, 0);
          makePart(parts, leg, 0, -0.6, -0.01, 0.048, 0.26, 0.055, coat);
          makePart(parts, leg, 0, -0.82, 0.005, 0.06, 0.06, 0.09, 0x32281d);
          legs.push({ leg, phase: (side * fore > 0 ? 0 : Math.PI) + i * 0.8 });
        }
      }
      // Pale rump patch and a raised tail, the give-away of a bolting sambar.
      makePart(parts, root, 0, 1.24, -0.8, 0.14, 0.16, 0.06, 0xc9b99c);
      const tail = makePart(parts, root, 0, 1.26, -0.84, 0.055, 0.16, 0.05, 0x40311f);
      this.deer.push({ root, neck, head, legs, tail, phase: i * 1.4 });
    }
    this.rig = new InstancedRig(this.parts, this.geometry, this.material);
    this.group.add(this.rig.mesh);
  }

  update(dt, camera, car) {
    const distance = Math.hypot(camera.x - this.centre.x, camera.z - this.centre.z);
    this.group.visible = distance < 170;
    if (!this.group.visible) { this.flee = 0; this.active = false; return; }
    this.time += dt;
    const carDistance = Math.hypot(car.x - this.centre.x, car.z - this.centre.z);
    if (!this.active && carDistance < 62) this.active = true;
    if (this.active) this.flee = Math.min(1, this.flee + dt * 0.52);
    const f = this.frame;
    for (let i = 0; i < this.deer.length; i++) {
      const d = this.deer[i];
      const run = Math.max(0, this.flee - i * 0.05);
      const ease = 1 - Math.exp(-run * 2.1);
      const lateral = 8.1 + i * 1.5 + ease * (7 + i * 1.4);
      const along = -3.0 + i * 2.7 + ease * (10 + i * 2.5);
      const x = f.x + f.rx * lateral + f.tx * along;
      const z = f.z + f.rz * lateral + f.tz * along;
      const ground = this.world.grid.heightAt(x, z);
      d.root.position.set(x, ground - 0.02 + ease * Math.abs(Math.sin(this.time * 7 + d.phase)) * 0.22, z);
      d.root.rotation.y = Math.atan2(-f.rx, -f.rz) - 0.7 + i * 0.45 + ease * 0.7;
      d.root.rotation.x = -ease * 0.12;
      d.neck.rotation.x = 0.35 * (1 - ease) - 0.2 * ease + Math.sin(this.time * 1.1 + d.phase) * 0.06;
      d.head.rotation.x = -0.08 + Math.sin(this.time * 1.4 + d.phase) * 0.04;
      for (const { leg, phase } of d.legs) {
        leg.rotation.x = ease * 1.05 * Math.sin(this.time * (5.2 + ease * 4) + phase) + 0.06 * Math.sin(this.time + phase);
      }
      d.tail.rotation.x = 0.3 + ease * 0.5 + Math.sin(this.time * 4 + d.phase) * 0.2 * ease;
    }
    this.rig.sync();
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** The flash of a kingfisher over the creek, timed to the car's approach. */
export class Kingfisher {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'Kingfisher';
    this.bridge = world.bridge;
    this.frame = world.roads[0].frameAt(this.bridge.centreS - 12, {});
    this.time = 0;
    this.flight = -1;
    this.parts = [];
    this.geometry = new THREE.SphereGeometry(1, 8, 6);
    this.material = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.05 });
    const root = new THREE.Object3D();
    this.group.add(root);
    const parts = this.parts;
    makePart(parts, root, 0, 0, 0, 0.075, 0.075, 0.17, 0x1a8fae);
    makePart(parts, root, 0, 0.05, 0.14, 0.065, 0.065, 0.075, 0x216f8d);
    makePart(parts, root, 0.025, 0.055, 0.215, 0.04, 0.04, 0.04, 0x17c8d8);
    makePart(parts, root, 0, 0.04, 0.235, 0.035, 0.016, 0.09, 0x202528);
    makePart(parts, root, 0, -0.01, 0.05, 0.055, 0.05, 0.06, 0xd77a26);
    for (const side of [-1, 1]) {
      const wing = makePivot(parts, root, side * 0.06, 0.02, 0.01);
      makePart(parts, wing, side * 0.1, 0, -0.02, 0.1, 0.016, 0.06, 0x206b84);
      (this.wings ??= []).push({ wing, side });
    }
    makePart(parts, root, 0, 0.01, -0.21, 0.03, 0.018, 0.09, 0x1d5c72);
    this.root = root;
    this.rig = new InstancedRig(this.parts, this.geometry, this.material);
    this.group.add(this.rig.mesh);
  }

  update(dt, camera, car) {
    const c = this.bridge.centre;
    this.group.visible = Math.hypot(camera.x - c.x, camera.z - c.z) < 150;
    if (!this.group.visible) { this.flight = -1; return; }
    this.time += dt;
    const carDistance = Math.hypot(car.x - c.x, car.z - c.z);
    if (this.flight < 0 && carDistance < 64) this.flight = 0;
    if (this.flight >= 0) this.flight += dt;
    const f = this.frame;
    if (this.flight < 0) {
      const x = f.x - f.rx * 9, z = f.z - f.rz * 9;
      this.root.position.set(x, this.world.grid.heightAt(x, z) + 1.7, z);
      this.root.rotation.set(0, Math.atan2(-f.rx, -f.rz) + 0.5, 0);
    } else {
      const t = this.flight;
      const orbit = Math.min(t * 2.2, Math.PI * 0.5);
      const radius = 9 + t * 1.3;
      const x = c.x + Math.cos(orbit) * radius;
      const z = c.z + Math.sin(orbit) * radius;
      const y = this.world.waterLevel + 2.6 + Math.sin(orbit * 2) * 1.5 + Math.min(t, 1) * 1.2;
      this.root.position.set(x, y, z);
      this.root.rotation.set(-0.18, -orbit + Math.PI * 0.5, Math.sin(t * 2) * 0.2);
    }
    const flap = this.flight < 0 ? Math.sin(this.time * 2) * 0.04 : Math.sin(this.time * 38) * 0.9;
    for (const { wing, side } of this.wings) wing.rotation.z = side * (0.15 + flap);
    this.rig.sync();
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

export class JungleAnimals {
  constructor(world) {
    this.group = new THREE.Group();
    this.group.name = 'JungleAnimals';
    this.elephants = new ElephantHerd(world);
    this.macaques = new MacaqueTroop(world);
    this.deer = new SambarDeer(world);
    this.kingfisher = new Kingfisher(world);
    this.group.add(this.elephants.group, this.macaques.group, this.deer.group, this.kingfisher.group);
  }

  update(dt, camera, car, night) {
    this.elephants.update(dt, camera, car);
    this.macaques.update(dt, camera, car);
    this.deer.update(dt, camera, car);
    this.kingfisher.update(dt, camera, car);
    this.group.visible = true;
  }

  dispose() {
    this.elephants.dispose();
    this.macaques.dispose();
    this.deer.dispose();
    this.kingfisher.dispose();
  }
}
