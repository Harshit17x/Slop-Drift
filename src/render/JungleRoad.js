import * as THREE from 'three';
import { WASHOUT, inWashout } from '../world/jungleStage.js';
import { BRIDGE, onBridge, wetness } from '../world/Jungle.js';
import { createRandom } from '../world/noise.js';
import { createLabelTexture } from './road/textures.js';
import { MeshBuffer } from './road/MeshBuffer.js';

import { buildStageFurniture } from './JungleStageView.js';
import { jungleSoil } from './jungleSoil.js';

export class JungleRoad {
  constructor(view) {
    this.bridge = view.world.bridge;
    const road = this.bridge.road;
    const mud = jungleSoil(view);
    for (let first = 0; first < road.count; first += 64) {
      const moisture = [];
      const strip = new MeshBuffer({ uvs: true });
      // Include both banks explicitly, so even the last approach triangle meets the deck.
      const end = Math.min(first + 64, road.count);
      const distances = Array.from({ length: end - first + 1 }, (_, i) => (first + i) * road.spacing);
      for (const bank of [BRIDGE.start, BRIDGE.end, WASHOUT.lip, WASHOUT.bank]) {
        if (bank > distances[0] && bank < distances.at(-1)) distances.push(bank);
      }
      distances.sort((a,b) => a-b);
      let previous = null;
      for (const s of distances) {
        const f = road.frameAt(s, {});
        const row = [];
        for (let j = 0; j <= 16; j++) {
          const edge = (j===0 || j===16) ? 0.38*Math.sin(s*0.61+j)+0.22*Math.sin(s*1.7) : 0;
          const lateral = (j / 8 - 1) * (f.halfWidth + road.shoulderEdge + 0.6 + edge);
          const wet = wetness(s, lateral, f.curvature);
          moisture.push(wet);
          const height = f.y + f.bank * lateral + road.profileAt(Math.abs(lateral), f.halfWidth);
          row.push(strip.vertex(f.x + f.rx * lateral, height + 0.035, f.z + f.rz * lateral,
            j / 16 + 0.018*Math.sin(s/15), s / 7));
        }
        if (previous && !onBridge((s + previous.s) / 2) && !inWashout((s + previous.s) / 2)) {
          for (let j = 0; j < 16; j++) strip.quad(previous.row[j], previous.row[j+1], row[j+1], row[j]);
        }
        previous = { s, row };
      }
      const geometry = view.track(strip.build());
      geometry.setAttribute('aWet', new THREE.Float32BufferAttribute(moisture,1));
      view.addMesh(geometry, mud, 'Packed trail and wet ruts');
    }
    const timber = view.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78 }));
    const fibre = view.track(new THREE.MeshStandardMaterial({ color: 0x785a36, roughness: 0.98 }));
    const rope = view.track(new THREE.CylinderGeometry(1, 1, 1, 6));
    const random = createRandom(175);
    const segments = (BRIDGE.end - BRIDGE.start) / 2;
    this.ropes = new THREE.InstancedMesh(rope, fibre, segments * 6);
    this.ropes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ropeMatrix = new THREE.Matrix4();
    view.group.add(this.ropes);
    this.sections = [];
    for (let s = BRIDGE.start; s < BRIDGE.end; s += 2) {
      const f = road.frameAt(s + 1, {});
      const section = new THREE.Group();
      section.position.set(f.x, f.y, f.z);
      section.rotation.y = Math.atan2(f.rx, f.rz) - Math.PI / 2;
      view.group.add(section);
      const boards = new MeshBuffer({ colors: true });
      for (let i = 0; i < 5; i++) {
        const shade = 0.72 + random() * 0.4;
        boards.box((random()-0.5)*0.09, -0.08, i*0.4-0.8,
          BRIDGE.halfWidth,0,0, 0,0.08,0, 0,0,0.194, 0.34*shade,0.177*shade,0.073*shade);
      }
      // Boards share a pivot so their motion follows the sampled deck.
      section.add(new THREE.Mesh(view.track(boards.build()), timber));
      const lines = [];
      for (const side of [-1, 1]) {
        const x = side * BRIDGE.halfWidth;
        const hanger = new THREE.Object3D();
        hanger.scale.set(0.045, 1.12, 0.045);
        hanger.position.set(x, 0.53, 0);
        hanger.updateMatrix();
        lines.push(hanger.matrix);
        for (const height of [-0.13, 1.08]) {
          const rail = new THREE.Object3D();
          rail.scale.set(0.055, 2.07, 0.055);
          rail.rotation.x = Math.PI / 2;
          rail.position.set(x, height, 0);
          rail.updateMatrix();
          lines.push(rail.matrix);
        }
      }
      this.sections.push({ section, y: f.y, s: s + 1, lines });
    }
    const anchors = new MeshBuffer({ colors: true });
    for (const s of [BRIDGE.start, BRIDGE.end]) {
      const frame = road.frameAt(s, {});
      for (const side of [-1, 1]) {
        const x = frame.x + frame.rx * side * BRIDGE.halfWidth;
        const z = frame.z + frame.rz * side * BRIDGE.halfWidth;
        anchors.box(x,frame.y+0.95,z,0.145,0,0,0,1.35,0,0,0,0.145,0.18,0.095,0.045);
        for (let k=0; k<3; k++) anchors.box(x,frame.y+1+k*0.07,z,0.17,0,0,0,0.026,0,0,0,0.17,0.48,0.34,0.18);
      }
    }
    const signFrame = road.frameAt(BRIDGE.start - 42, {});
    const x = signFrame.x + signFrame.rx * 5.1, z = signFrame.z + signFrame.rz * 5.1;
    anchors.box(x,signFrame.y+1.25,z,0.085,0,0,0,1.45,0,0,0,0.085,0.22,0.14,0.07);
    view.addMesh(view.track(anchors.build()),timber,'Bridge anchors');
    const notice = view.track(createLabelTexture(['ROPE BRIDGE','40 km/h  •  CROSS STRAIGHT'], {background:'#342a1d',accent:'#f2b54f'}));
    const sign = new THREE.Mesh(view.track(new THREE.PlaneGeometry(3.1,0.9)),
      view.track(new THREE.MeshBasicMaterial({map:notice,side:THREE.DoubleSide})));
    sign.position.set(x,signFrame.y+2.25,z);
    sign.rotation.y = Math.atan2(-signFrame.tx,-signFrame.tz);
    view.group.add(sign);
    buildStageFurniture(view,mud.map);
    this.update();
  }

  update(cameraPosition) {
    const b = this.bridge;
    if (!b.broken && !this.wasBroken && cameraPosition &&
      (cameraPosition.x - b.centre.x) ** 2 + (cameraPosition.z - b.centre.z) ** 2 > 250 ** 2) return;
    this.wasBroken = b.broken;
    let index = 0;
    for (const { section, y, s, lines } of this.sections) {
      const t = Math.max(0, b.dropTime - Math.abs(s - b.centreS) * 0.009);
      section.position.y = y + b.displacement(s) - Math.min(40, 4.9 * t * t);
      section.rotation.z = b.broken ? Math.sin(s) * Math.min(t, 2) : b.loaded ? Math.sin(b.time * 12 + s * 0.1) * 0.012 : 0;
      section.visible = t < 3;
      section.updateMatrix();
      for (const line of lines) this.ropes.setMatrixAt(index++, this.ropeMatrix.multiplyMatrices(section.matrix, line));
    }
    this.ropes.instanceMatrix.needsUpdate = true;
    this.ropes.visible = b.dropTime < 3.3;
  }
}
