import * as THREE from 'three';
import { MeshBuffer } from './road/MeshBuffer.js';
import { createRandom } from '../world/noise.js';
import { STAGE } from '../world/jungleStage.js';
import { plantGeometry } from './junglePlants.js';

// Hand-made adventure beats off the racing line: a working timber camp, a
// moss-eaten forest shrine, an anti-poaching watchtower and a bamboo tunnel
// grown over the road. Everything is batched into three vertex-coloured meshes
// (timber, metal, cloth) so the whole layer costs only a few draw calls.

const scratch = {};

function roadFrame(world, s, side, lateral) {
  const road = world.roads[0];
  const frame = road.frameAt(s, {});
  const x = frame.x + frame.rx * side * lateral;
  const z = frame.z + frame.rz * side * lateral;
  return { frame, x, z, y: world.grid.heightAt(x, z) };
}

function boxAt(buffer, frame, x, y, z, w, h, d, r, g, b) {
  buffer.box(x, y, z,
    frame.rx * w, 0, frame.rz * w,
    0, h, 0,
    frame.tx * d, 0, frame.tz * d,
    r, g, b);
}

function tube(buffer, ax, ay, az, bx, by, bz, radiusA, radiusB, r, g, b, sides = 6) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const length = Math.hypot(dx, dy, dz);
  if (length < 1e-4) return;
  const ux = dx / length, uy = dy / length, uz = dz / length;
  const rx = Math.abs(uy) < 0.9 ? 0 : 1;
  const ry = Math.abs(uy) < 0.9 ? 1 : 0;
  let sx = uy * 0 - uz * ry, sy = uz * rx - ux * 0, sz = ux * ry - uy * rx;
  const sl = Math.hypot(sx, sy, sz) || 1;
  sx /= sl; sy /= sl; sz /= sl;
  const tx = uy * sz - uz * sy, ty = uz * sx - ux * sz, tz = ux * sy - uy * sx;
  const ringA = [], ringB = [];
  for (let i = 0; i < sides; i++) {
    const angle = i / sides * Math.PI * 2;
    const c = Math.cos(angle), s = Math.sin(angle);
    const ox = sx * c + tx * s, oy = sy * c + ty * s, oz = sz * c + tz * s;
    ringA.push(buffer.vertex(ax + ox * radiusA, ay + oy * radiusA, az + oz * radiusA, 0, 0, r, g, b));
    ringB.push(buffer.vertex(bx + ox * radiusB, by + oy * radiusB, bz + oz * radiusB, 0, 0, r, g, b));
  }
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    buffer.quad(ringA[i], ringA[j], ringB[j], ringB[i]);
  }
  const ca = buffer.vertex(ax, ay, az, 0, 0, r * 0.8, g * 0.8, b * 0.8);
  const cb = buffer.vertex(bx, by, bz, 0, 0, r * 0.8, g * 0.8, b * 0.8);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    buffer.triangle(ca, ringA[j], ringA[i]);
    buffer.triangle(cb, ringB[i], ringB[j]);
  }
}

function groundPad(buffer, world, x, z, radius, r, g, b, segments = 18, rings = 4) {
  const hash = (px, pz) => {
    const s = Math.sin(px * 12.9898 + pz * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };
  const shade = (px, pz, edge) => (0.84 + hash(px, pz) * 0.24) * (edge ? 0.88 : 1);
  const centre = buffer.vertex(x, world.grid.heightAt(x, z) + 0.035, z, 0, 0,
    r * shade(x, z, false), g * shade(x, z, false), b * shade(x, z, false));
  // Concentric rings follow the ground far better than one flat fan, so a pad
  // on a slope never lifts off the terrain at its rim.
  let previous = null;
  for (let ring = 1; ring <= rings; ring++) {
    const t = ring / rings;
    const edge = ring === rings;
    const current = [];
    for (let i = 0; i < segments; i++) {
      const angle = i / segments * Math.PI * 2;
      const jitter = edge ? 0.9 + hash(i * 7.13, ring) * 0.2 : 1;
      const px = x + Math.cos(angle) * radius * t * jitter;
      const pz = z + Math.sin(angle) * radius * t * jitter;
      const s = shade(px, pz, edge);
      current.push(buffer.vertex(px, world.grid.heightAt(px, pz) + 0.035, pz, 0, 0, r * s, g * s, b * s));
    }
    if (!previous) {
      for (let i = 0; i < segments; i++) buffer.triangle(centre, current[i], current[(i + 1) % segments]);
    } else {
      for (let i = 0; i < segments; i++) {
        const j = (i + 1) % segments;
        buffer.quad(previous[i], previous[j], current[j], current[i]);
      }
    }
    previous = current;
  }
}

/** Scatter flat leaf litter over a pad so a dirt disc never reads as a polygon. */
function padLitter(buffer, world, x, z, radius, count, random) {
  for (let i = 0; i < count; i++) {
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * radius;
    const px = x + Math.cos(angle) * distance;
    const pz = z + Math.sin(angle) * distance;
    const py = world.grid.heightAt(px, pz) + 0.045;
    const size = 0.16 + random() * 0.38;
    const spin = random() * Math.PI * 2;
    const ax = Math.cos(spin) * size, az = Math.sin(spin) * size;
    const bx = -Math.sin(spin) * size * 0.55, bz = Math.cos(spin) * size * 0.55;
    const shade = 0.75 + random() * 0.4;
    const col = random() < 0.55 ? [0.22, 0.155, 0.07] : [0.15, 0.2, 0.07];
    const lift = 0.01 + random() * 0.025;
    const a = buffer.vertex(px - ax - bx, py, pz - az - bz, 0, 0, col[0] * shade, col[1] * shade, col[2] * shade);
    const c = buffer.vertex(px + ax - bx, py + lift, pz + az - bz, 0, 0, col[0] * shade * 1.1, col[1] * shade * 1.1, col[2] * shade);
    const d = buffer.vertex(px + ax + bx, py, pz + az + bz, 0, 0, col[0] * shade, col[1] * shade, col[2] * shade);
    const e = buffer.vertex(px - ax + bx, py + lift, pz - az + bz, 0, 0, col[0] * shade * 0.9, col[1] * shade * 0.9, col[2] * shade * 0.9);
    buffer.quad(a, c, d, e);
  }
}

function tarp(buffer, frame, x, y, z, halfW, halfD, sag, r, g, b) {
  const corner = (sx, sz, dy) => buffer.vertex(
    x + frame.rx * sx * halfW + frame.tx * sz * halfD,
    y + dy,
    z + frame.rz * sx * halfW + frame.tz * sz * halfD, 0, 0, r, g, b,
  );
  const a = corner(-1, -1, sag * 0.4), bb = corner(1, -1, sag * 0.4);
  const c = corner(1, 1, sag * 0.4), e = corner(-1, 1, sag * 0.4);
  const mid = buffer.vertex(x, y + sag, z, 0, 0, r * 1.08, g * 1.08, b * 1.08);
  buffer.triangle(a, bb, mid);
  buffer.triangle(bb, c, mid);
  buffer.triangle(c, e, mid);
  buffer.triangle(e, a, mid);
}

export class JungleSetPieces {
  constructor(world, quality = null, foliage = null) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'JungleSetPieces';
    this.random = createRandom(world.config.seed + 9001);
    this.time = { value: 0 };
    this.disposables = [];
    this.wood = new MeshBuffer({ colors: true });
    this.metal = new MeshBuffer({ colors: true });
    this.cloth = new MeshBuffer({ colors: true });
    this.foliage = foliage;
    this.leafMatrices = [];
    this.leafDummy = new THREE.Object3D();
    this.obstacles = [];
    this.buildTimberCamp();
    this.buildShrine();
    this.buildWatchtower();
    this.buildBambooRun();
    this.buildElephantLick();
    this.buildDeerGlade();
    this.finish(quality);
    for (let i = 0; i < this.obstacles.length; i += 3) {
      world.staticObstacles.push(this.obstacles[i], this.obstacles[i + 1], this.obstacles[i + 2]);
    }
  }

  obstacle(x, z, radius) {
    this.obstacles.push(x, z, radius);
  }

  leafCard(x, y, z, size, yaw, color, pitch = 0) {
    if (!this.foliage) return;
    const d = this.leafDummy;
    d.position.set(x, y, z);
    d.rotation.set(pitch, yaw, 0);
    d.scale.set(size, size * 0.9, size);
    d.updateMatrix();
    this.leafMatrices.push([d.matrix.clone(), color]);
  }

  buildTimberCamp() {
    const { frame, x, z, y } = roadFrame(this.world, STAGE.timberCamp, 1, 12.4);
    groundPad(this.wood, this.world, x, z, 6.6, 0.155, 0.12, 0.075, 26);
    padLitter(this.wood, this.world, x, z, 7.3, 120, this.random);
    this.obstacle(x, z, 2.4);
    const base = y + 0.3;
    const R = (w, h, d, cx, cy, cz, colour = [0.3, 0.2, 0.11]) =>
      boxAt(this.wood, frame, x + frame.rx * cx + frame.tx * cz, base + cy, z + frame.rz * cx + frame.tz * cz, w, h, d, ...colour);
    const world = (cx, cz) => {
      const px = x + frame.rx * cx + frame.tx * cz;
      const pz = z + frame.rz * cx + frame.tz * cz;
      return { px, pz, gy: this.world.grid.heightAt(px, pz) };
    };
    // ---- Stilted saw shed, 5.8 m long and open toward the road.
    const shedX = 1.5;
    for (const cx of [shedX - 2.4, shedX + 2.4]) {
      for (const cz of [-2.9, 2.9]) {
        const { px, pz, gy } = world(cx, cz);
        tube(this.wood, px, gy - 0.15, pz, px, base + 0.55, pz, 0.17, 0.14, 0.26, 0.17, 0.09, 7);
        tube(this.wood, px, base + 0.55, pz, px, base + 2.66, pz, 0.14, 0.12, 0.25, 0.17, 0.09, 6);
      }
    }
    R(5.0, 0.18, 6.0, shedX, 0.55, 0, [0.32, 0.22, 0.12]);
    // Back wall and far gable wall are boarded; the road side and the approach
    // end stay open so the truss, saw bench and log deck read from the stage.
    R(0.14, 2.1, 5.8, shedX + 2.4, 1.6, 0, [0.25, 0.17, 0.09]);
    R(4.8, 2.1, 0.14, shedX, 1.6, 2.9, [0.27, 0.18, 0.1]);
    // Approach end: a waist-high board wall under the open header.
    R(4.8, 0.92, 0.14, shedX, 1.01, -2.9, [0.29, 0.19, 0.1]);
    R(4.9, 0.12, 0.2, shedX, 2.64, -2.9, [0.22, 0.15, 0.08]);
    for (const cx of [shedX - 1.55, shedX + 1.55]) {
      R(0.18, 2.1, 0.18, cx, 1.6, -2.9, [0.31, 0.21, 0.11]);
    }
    for (let i = 0; i < 7; i++) R(0.07, 2.0, 0.08, shedX + 2.32, 1.6, -2.4 + i * 0.8, [0.2, 0.14, 0.08]);
    // Horizontal board lines break the flat walls into sawn planks.
    for (let k = 0; k < 5; k++) {
      R(4.62, 0.035, 0.02, shedX, 0.74 + k * 0.4, 2.98, [0.17, 0.11, 0.055]);
    }
    for (let k = 0; k < 2; k++) {
      R(4.62, 0.035, 0.02, shedX, 0.8 + k * 0.34, -2.98, [0.17, 0.11, 0.055]);
    }
    // Interior: stacked sawn planks, a tool board and a coiled cable on the
    // back wall, visible through the open approach bay.
    for (let i = 0; i < 4; i++) {
      R(2.0 - i * 0.1, 0.12, 0.9, shedX + 1.55, 0.72 + i * 0.13, -1.5, [0.5, 0.4, 0.25]);
    }
    R(0.06, 0.95, 1.9, shedX + 2.31, 1.95, 1.1, [0.2, 0.15, 0.09]);
    // A bright window and workbench break up the back wall, so the open bay
    // reads as a workshop interior instead of a flat brown plane.
    R(0.05, 0.85, 1.5, shedX + 2.32, 2.05, -2.05, [0.18, 0.13, 0.07]);
    R(0.04, 0.68, 1.28, shedX + 2.29, 2.05, -2.05, [0.6, 0.68, 0.58]);
    for (const wy of [1.84, 2.26]) R(0.04, 0.045, 1.3, shedX + 2.27, wy, -2.05, [0.2, 0.15, 0.08]);
    R(0.62, 0.12, 3.0, shedX + 2.0, 1.12, -0.2, [0.54, 0.43, 0.27]);
    for (const cz of [-1.5, 1.1]) {
      R(0.1, 0.5, 0.1, shedX + 2.24, 0.8, cz, [0.28, 0.19, 0.09]);
      R(0.07, 0.5, 0.07, shedX + 1.75, 0.8, cz, [0.28, 0.19, 0.09]);
    }
    R(0.42, 0.2, 0.24, shedX + 2.0, 1.28, 1.32, [0.4, 0.42, 0.4]);
    R(0.36, 0.24, 0.56, shedX + 2.02, 1.3, 0.35, [0.56, 0.1, 0.06]);
    R(0.08, 0.06, 0.3, shedX + 2.02, 1.45, 0.35, [0.16, 0.13, 0.1]);
    // Painted board over the bench.
    R(0.05, 0.62, 1.15, shedX + 2.31, 1.95, -0.7, [0.74, 0.66, 0.46]);
    R(0.04, 0.36, 0.3, shedX + 2.27, 1.95, -0.7, [0.12, 0.3, 0.13]);
    for (let i = 0; i < 4; i++) {
      R(0.05, 0.3 + (i % 2) * 0.22, 0.04, shedX + 2.26, 1.7 + (i % 2) * 0.1, 0.45 + i * 0.32, [0.44, 0.4, 0.32]);
    }
    tube(this.metal, x + frame.rx * (shedX + 2.25) + frame.tx * 2.0, base + 1.55, z + frame.rz * (shedX + 2.25) + frame.tz * 2.0,
      x + frame.rx * (shedX + 2.25) + frame.tx * 2.0, base + 2.15, z + frame.rz * (shedX + 2.25) + frame.tz * 2.0,
      0.2, 0.2, 0.16, 0.15, 0.13, 8);
    // Triangular gable infill closes the ends under the pitched roof.
    for (const end of [-1, 1]) {
      const ez = z + frame.tz * (end * 2.92);
      this.wood.triangle(
        this.wood.vertex(x + frame.rx * (shedX - 2.4), base + 2.66, ez + frame.rz * (shedX - 2.4), 0, 0, 0.27, 0.18, 0.1),
        this.wood.vertex(x + frame.rx * (shedX + 2.4), base + 2.66, ez + frame.rz * (shedX + 2.4), 0, 0, 0.27, 0.18, 0.1),
        this.wood.vertex(x + frame.rx * shedX, base + 4.02, ez + frame.rz * shedX, 0, 0, 0.3, 0.2, 0.11),
      );
      R(0.09, 1.15, 0.06, shedX, 3.28, end * 2.95, [0.17, 0.11, 0.06]);
      // Dark louvre vent in the gable peak.
      R(0.72, 0.4, 0.06, shedX, 3.5, end * 2.99, [0.1, 0.08, 0.06]);
      for (let k = 0; k < 3; k++) R(0.76, 0.035, 0.03, shedX, 3.38 + k * 0.12, end * 3.03, [0.2, 0.16, 0.11]);
    }
    // Company board on the approach gable, cream with a dark green tree mark.
    const signX = x + frame.rx * shedX;
    const signZ = z + frame.rz * shedX + frame.tz * -3.01;
    boxAt(this.cloth, frame, signX, base + 3.18, signZ, 2.0, 0.52, 0.05, 0.82, 0.72, 0.46);
    this.cloth.triangle(
      this.cloth.vertex(signX - frame.rx * 0.56 + frame.tx * -0.06, base + 3.36, signZ - frame.rz * 0.56 + frame.tz * -0.06, 0, 0, 0.08, 0.2, 0.09),
      this.cloth.vertex(signX + frame.rx * 0.56 + frame.tx * -0.06, base + 3.36, signZ + frame.rz * 0.56 + frame.tz * -0.06, 0, 0, 0.08, 0.2, 0.09),
      this.cloth.vertex(signX + frame.tx * -0.06, base + 2.98, signZ + frame.tz * -0.06, 0, 0, 0.08, 0.2, 0.09),
    );
    // Gabled corrugated roof: ridge along the road, 27-degree pitch, deep eaves.
    const sheet = (cx, cy, flip) => {
      this.metal.box(
        x + frame.rx * cx, base + cy, z + frame.rz * cx,
        -frame.rx * 1.35 * flip, 0.58, -frame.rz * 1.35 * flip,
        0, 0.06, 0,
        frame.tx * 3.25, 0, frame.tz * 3.25,
        0.5, 0.29, 0.14,
      );
    };
    sheet(shedX - 1.35, 3.44, -1);
    sheet(shedX + 1.35, 3.44, 1);
    tube(this.metal, x + frame.rx * shedX, base + 4.02, z + frame.rz * shedX - frame.tz * 3.3,
      x + frame.rx * shedX, base + 4.02, z + frame.rz * shedX + frame.tz * 3.3,
      0.12, 0.12, 0.22, 0.22, 0.2, 5);
    // Corrugation battens running eave to ridge.
    for (let i = 0; i < 6; i++) {
      const cz = -2.7 + i * 1.08;
      for (const side of [-1, 1]) {
        tube(this.metal,
          x + frame.rx * (shedX + side * 2.66) + frame.tx * cz, base + 2.88, z + frame.rz * (shedX + side * 2.66) + frame.tz * cz,
          x + frame.rx * shedX + frame.tx * cz, base + 4.01, z + frame.rz * shedX + frame.tz * cz,
          0.028, 0.028, 0.42, 0.24, 0.11, 4);
      }
    }
    // King-post truss and saw bench under the roof.
    R(4.8, 0.16, 0.2, shedX, 2.56, 0, [0.22, 0.15, 0.08]);
    tube(this.wood, x + frame.rx * shedX, base + 2.6, z + frame.rz * shedX,
      x + frame.rx * shedX, base + 3.98, z + frame.rz * shedX,
      0.08, 0.07, 0.22, 0.15, 0.08, 5);
    for (const side of [-1, 1]) {
      tube(this.wood,
        x + frame.rx * (shedX + side * 2.2), base + 2.62, z + frame.rz * (shedX + side * 2.2),
        x + frame.rx * shedX, base + 3.88, z + frame.rz * shedX,
        0.06, 0.055, 0.22, 0.15, 0.08, 5);
    }
    // Hanging work lamps and a big saw blade leaning on the back wall.
    for (const cz of [0.7, -1.4]) {
      tube(this.metal, x + frame.rx * (shedX - 0.2) + frame.tx * cz, base + 2.8, z + frame.rz * (shedX - 0.2) + frame.tz * cz,
        x + frame.rx * (shedX - 0.2) + frame.tx * cz, base + 2.36, z + frame.rz * (shedX - 0.2) + frame.tz * cz,
        0.015, 0.015, 0.3, 0.28, 0.2, 4);
      this.cloth.box(x + frame.rx * (shedX - 0.2) + frame.tx * cz, base + 2.3, z + frame.rz * (shedX - 0.2) + frame.tz * cz,
        0.22, 0.13, 0.22, 0, 0, 0, 0.22, 0, 0.22, 1.0, 0.84, 0.55);
    }
    tube(this.metal, x + frame.rx * (shedX + 2.2), base + 0.55, z + frame.rz * (shedX + 2.2) + frame.tz * 2.33,
      x + frame.rx * (shedX + 2.27), base + 1.5, z + frame.rz * (shedX + 2.27) + frame.tz * 2.33,
      0.46, 0.46, 0.3, 0.3, 0.28, 12);
    R(2.0, 0.14, 0.9, shedX - 1.0, 1.05, -0.9, [0.34, 0.24, 0.13]);
    tube(this.metal, x + frame.rx * (shedX - 1.0) + frame.tx * -0.9, base + 1.25, z + frame.rz * (shedX - 1.0) + frame.tz * -0.9,
      x + frame.rx * (shedX - 0.2) + frame.tx * -0.9, base + 1.25, z + frame.rz * (shedX - 0.2) + frame.tz * -0.9,
      0.5, 0.5, 0.6, 0.59, 0.55, 14);
    // Sawdust cone under the bench.
    const dust = world(shedX - 1.0, -0.9);
    tube(this.wood, dust.px, dust.gy + 0.02, dust.pz, dust.px, dust.gy + 0.42, dust.pz, 0.95, 0.08, 0.56, 0.45, 0.26, 9);
    // A peeled log runs down a timber chute toward the yard.
    const chute = world(shedX - 2.2, -2.3);
    for (const side of [-1, 1]) {
      tube(this.wood,
        x + frame.rx * (shedX - 2.2) + frame.tx * (-2.3 + side * 0.55), base + 1.22,
        z + frame.rz * (shedX - 2.2) + frame.tz * (-2.3 + side * 0.55),
        x + frame.rx * (shedX - 5.2) + frame.tx * (-2.3 + side * 0.55), chute.gy + 0.42,
        z + frame.rz * (shedX - 5.2) + frame.tz * (-2.3 + side * 0.55),
        0.11, 0.11, 0.32, 0.22, 0.11, 6);
    }
    tube(this.wood,
      x + frame.rx * (shedX - 2.3) + frame.tx * -2.3, base + 1.36,
      z + frame.rz * (shedX - 2.3) + frame.tz * -2.3,
      x + frame.rx * (shedX - 5.1) + frame.tx * -2.3, chute.gy + 0.66,
      z + frame.rz * (shedX - 5.1) + frame.tz * -2.3,
      0.38, 0.34, 0.5, 0.38, 0.2, 9);
    // ---- Log deck between the shed and the verge, stacked low so the open bay
    // and the saw bench still read over the top of it.
    const deckX = -4.2;
    const deck = world(deckX, 1.7);
    for (let row = 0; row < 2; row++) {
      const count = 4 - row;
      for (let i = 0; i < count; i++) {
        const cx = deckX + (i - (count - 1) / 2) * 0.92;
        const py = deck.gy + 0.4 + row * 0.76;
        const cz = 1.7;
        const px = x + frame.rx * cx;
        const pz = z + frame.rz * cx;
        const shade = row % 2 ? [0.52, 0.4, 0.23] : [0.45, 0.33, 0.18];
        tube(this.wood,
          px - frame.tx * 2.7 + frame.tx * cz, py, pz - frame.tz * 2.7 + frame.tz * cz,
          px + frame.tx * 2.7 + frame.tx * cz, py, pz + frame.tz * 2.7 + frame.tz * cz,
          0.43, 0.43, ...shade, 9);
        // Sawn faces on the approach end, ringed with dark radial cracks.
        tube(this.wood,
          px - frame.tx * 2.73 + frame.tx * cz, py, pz - frame.tz * 2.73 + frame.tz * cz,
          px - frame.tx * 2.66 + frame.tx * cz, py, pz - frame.tz * 2.66 + frame.tz * cz,
          0.41, 0.41, 0.58, 0.47, 0.3, 9);
        const faceX = px - frame.tx * 2.75 + frame.tx * cz;
        const faceZ = pz - frame.tz * 2.75 + frame.tz * cz;
        for (let k = 0; k < 3; k++) {
          const a = this.random() * Math.PI * 2;
          const ca = Math.cos(a), sa = Math.sin(a);
          tube(this.wood,
            faceX + frame.rx * ca * 0.06, py + sa * 0.06, faceZ + frame.rz * ca * 0.06,
            faceX + frame.rx * ca * 0.35, py + sa * 0.35, faceZ + frame.rz * ca * 0.35,
            0.016, 0.011, 0.32, 0.24, 0.13, 4);
        }
      }
    }
    this.obstacle(x + frame.rx * deckX + frame.tx * 1.7, z + frame.rz * deckX + frame.tz * 1.7, 2.6);
    // ---- Steel gantry over the deck, with a hanging grapple.
    for (const cz of [-2.9, 2.9]) {
      const { px, pz, gy } = world(deckX, cz);
      tube(this.metal, px, gy - 0.1, pz, px, base + 4.8, pz, 0.22, 0.16, 0.3, 0.29, 0.24, 7);
      // Rusted foot collar.
      tube(this.metal, px, gy + 0.14, pz, px, base + 0.42, pz, 0.235, 0.2, 0.33, 0.22, 0.11, 7);
      tube(this.metal, px, base + 4.2, pz, x + frame.rx * deckX, base + 2.4, z + frame.tz * (cz * 0.45),
        0.09, 0.07, 0.3, 0.28, 0.22, 5);
      this.obstacle(px, pz, 0.38);
    }
    tube(this.metal,
      x + frame.rx * deckX - frame.tx * 3.1, base + 4.7, z + frame.rz * deckX - frame.tz * 3.1,
      x + frame.rx * deckX + frame.tx * 3.1, base + 4.7, z + frame.rz * deckX + frame.tz * 3.1,
      0.18, 0.18, 0.38, 0.3, 0.17, 7);
    tube(this.metal,
      x + frame.rx * deckX + frame.tx * 0.6, base + 4.6, z + frame.rz * deckX + frame.tz * 0.6,
      x + frame.rx * deckX + frame.tx * 0.6, base + 3.1, z + frame.rz * deckX + frame.tz * 0.6,
      0.025, 0.025, 0.18, 0.17, 0.15, 4);
    for (const side of [-1, 1]) {
      tube(this.metal,
        x + frame.rx * deckX + frame.tx * 0.6, base + 3.1, z + frame.rz * deckX + frame.tz * 0.6,
        x + frame.rx * (deckX + side * 0.55) + frame.tx * 0.6, base + 2.55, z + frame.rz * (deckX + side * 0.55) + frame.tz * 0.6,
        0.075, 0.05, 0.42, 0.3, 0.14, 5);
    }
    // ---- Yellow skidder parked beyond the shed, nose out so the machine reads
    // from the approach instead of hiding behind the back wall.
    const skidX = 6.0, skidZ = -4.4;
    const skid = world(skidX, skidZ);
    const skidBox = (w, h, d, cx, cy, cz, colour) =>
      boxAt(this.wood, frame, x + frame.rx * cx + frame.tx * cz, skid.gy + cy, z + frame.rz * cx + frame.tz * cz, w, h, d, ...colour);
    const yellow = [0.7, 0.46, 0.04], yellowDark = [0.46, 0.3, 0.03];
    const black = [0.1, 0.1, 0.095], steel = [0.34, 0.35, 0.33];
    // Chassis, belly guard and articulated rear frame.
    skidBox(1.5, 0.55, 2.4, skidX, 1.18, skidZ, yellow);
    skidBox(1.6, 0.2, 2.5, skidX, 0.84, skidZ, black);
    skidBox(1.4, 0.45, 0.85, skidX, 1.08, skidZ + 1.62, yellowDark);
    // Sloped engine hood, dark grille and radiator slats.
    skidBox(1.3, 0.62, 1.1, skidX, 1.64, skidZ - 0.5, yellow);
    skidBox(0.86, 0.05, 0.9, skidX, 1.97, skidZ - 0.55, yellowDark);
    skidBox(1.18, 0.38, 0.16, skidX, 1.62, skidZ - 1.08, black);
    for (let i = 0; i < 4; i++) skidBox(1.04, 0.04, 0.03, skidX, 1.48 + i * 0.1, skidZ - 1.17, steel);
    // Insulated cab with dark glass, yellow roof and an amber beacon.
    skidBox(1.26, 0.94, 1.16, skidX, 1.98, skidZ + 0.5, [0.14, 0.16, 0.15]);
    skidBox(1.4, 0.1, 1.3, skidX, 2.5, skidZ + 0.5, yellow);
    for (const side of [-1, 1]) {
      skidBox(0.07, 0.9, 0.07, skidX + side * 0.61, 2.02, skidZ - 0.06, black);
    }
    skidBox(0.12, 0.1, 0.12, skidX + 0.4, 2.59, skidZ + 0.9, [0.95, 0.55, 0.08]);
    // Black exhaust stack with a rain cap.
    const stack = world(skidX + 0.55, skidZ - 0.55);
    tube(this.wood, stack.px, skid.gy + 1.9, stack.pz, stack.px, skid.gy + 2.9, stack.pz,
      0.065, 0.055, ...black, 6);
    tube(this.wood, stack.px, skid.gy + 2.9, stack.pz, stack.px, skid.gy + 3.0, stack.pz,
      0.11, 0.05, 0.24, 0.22, 0.19, 6);
    // Big lugged wheels: dark tyres, steel axles and yellow hubs.
    for (const cz of [skidZ - 1.3, skidZ + 1.3]) {
      for (const side of [-1, 1]) {
        const wx = x + frame.rx * (skidX + side * 0.98) + frame.tx * cz;
        const wz = z + frame.rz * (skidX + side * 0.98) + frame.tz * cz;
        tube(this.wood, wx - frame.rx * 0.22, skid.gy + 0.7, wz - frame.rz * 0.22,
          wx + frame.rx * 0.22, skid.gy + 0.7, wz + frame.rz * 0.22,
          0.7, 0.7, ...black, 12);
        tube(this.wood, wx - frame.rx * 0.26, skid.gy + 0.7, wz - frame.rz * 0.26,
          wx + frame.rx * 0.26, skid.gy + 0.7, wz + frame.rz * 0.26,
          0.3, 0.3, ...yellow, 10);
        tube(this.wood, wx - frame.rx * 0.3, skid.gy + 0.7, wz - frame.rz * 0.3,
          wx + frame.rx * 0.3, skid.gy + 0.7, wz + frame.rz * 0.3,
          0.12, 0.12, ...steel, 6);
      }
    }
    // Axles and mudguards.
    for (const cz of [skidZ - 1.3, skidZ + 1.3]) {
      const ax = world(skidX - 1.03, cz), bx = world(skidX + 1.03, cz);
      tube(this.wood, ax.px, skid.gy + 0.7, ax.pz, bx.px, skid.gy + 0.7, bx.pz,
        0.09, 0.09, ...steel, 5);
    }
    skidBox(1.9, 0.1, 1.0, skidX, 1.58, skidZ - 1.3, yellowDark);
    skidBox(1.9, 0.1, 1.0, skidX, 1.58, skidZ + 1.3, yellowDark);
    // Front blade with push arms and a dark cutting edge.
    const blade = world(skidX, skidZ - 2.45);
    this.wood.box(blade.px, blade.gy + 0.66, blade.pz,
      frame.rx * 1.52, 0, frame.rz * 1.52,
      0, 0.64, 0,
      frame.tx * 0.07, 0.18, frame.tz * 0.07,
      0.62, 0.44, 0.06);
    this.wood.box(blade.px, blade.gy + 0.08, blade.pz - frame.tz * 0.14,
      frame.rx * 1.52, 0, frame.rz * 1.52,
      0, 0.09, 0,
      frame.tx * 0.08, 0.02, frame.tz * 0.08,
      0.16, 0.14, 0.13);
    for (const side of [-1, 1]) {
      const a = world(skidX + side * 0.55, skidZ - 1.0);
      const b = world(skidX + side * 0.95, skidZ - 2.2);
      tube(this.wood, a.px, skid.gy + 0.78, a.pz, b.px, blade.gy + 0.36, b.pz,
        0.075, 0.075, ...steel, 5);
    }
    // Rear winch, grapple and a couple of cut logs.
    skidBox(0.7, 0.45, 0.36, skidX, 1.48, skidZ + 2.0, black);
    const grappleA = world(skidX, skidZ + 2.1);
    const grappleB = world(skidX, skidZ + 2.9);
    tube(this.wood, grappleA.px, skid.gy + 1.7, grappleA.pz,
      grappleB.px, skid.gy + 2.35, grappleB.pz,
      0.1, 0.08, ...steel, 6);
    for (const side of [-1, 1]) {
      const claw = world(skidX + side * 0.62, skidZ + 3.25);
      tube(this.wood, grappleB.px, skid.gy + 2.35, grappleB.pz,
        claw.px, skid.gy + 1.95, claw.pz,
        0.06, 0.045, ...black, 5);
    }
    for (let i = 0; i < 3; i++) {
      const log = world(skidX - 0.5 + i * 0.55, skidZ + 3.9);
      tube(this.wood, log.px - frame.tx * 1.2, log.gy + 0.32, log.pz - frame.tz * 1.2,
        log.px + frame.tx * 1.2, log.gy + 0.32, log.pz + frame.tz * 1.2,
        0.28, 0.28, 0.44, 0.3, 0.16, 8);
    }
    this.obstacle(x + frame.rx * skidX + frame.tx * skidZ, z + frame.rz * skidX + frame.tz * skidZ, 1.9);
    // ---- Fuel drums under a lean-to tarp.
    const drumColours = [[0.55, 0.22, 0.08], [0.14, 0.22, 0.3], [0.6, 0.26, 0.1], [0.2, 0.24, 0.16]];
    for (let i = 0; i < 4; i++) {
      const { px, pz, gy } = world(2.3 + (i % 2) * 0.85, 5.5 + Math.floor(i / 2) * 0.85);
      tube(this.metal, px, gy - 0.05, pz, px, gy + 1.0, pz, 0.33, 0.33, ...drumColours[i], 10);
      tube(this.metal, px, gy + 0.24, pz, px, gy + 0.32, pz, 0.35, 0.35, 0.26, 0.22, 0.16, 10);
    }
    tarp(this.cloth, frame, x + frame.rx * 2.6 + frame.tx * 5.9, base + 2.15, z + frame.rz * 2.6 + frame.tz * 5.9,
      1.5, 2.1, 0.3, 0.44, 0.34, 0.14);
    // ---- A giant felled trunk with a root plate, behind the shed.
    tube(this.wood,
      x + frame.rx * 3.4 + frame.tx * 6.0, base + 1.0, z + frame.rz * 3.4 + frame.tz * 6.0,
      x + frame.rx * 4.4 + frame.tx * 11.4, base + 0.42, z + frame.rz * 4.4 + frame.tz * 11.4,
      0.85, 0.52, 0.3, 0.21, 0.11, 10);
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2;
      const { px, pz, gy } = world(4.4 + Math.cos(a) * 2.1, 11.0 + Math.sin(a) * 1.3);
      tube(this.wood,
        x + frame.rx * 3.4 + frame.tx * 6.0, base + 1.0, z + frame.rz * 3.4 + frame.tz * 6.0,
        px, gy + 0.1, pz, 0.46, 0.16, 0.26, 0.19, 0.1, 6);
    }
    // ---- Fire ring with log seats and cloth flames.
    const fire = world(-5.7, 4.9);
    groundPad(this.wood, this.world, fire.px, fire.pz, 0.8, 0.09, 0.07, 0.05, 10);
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * Math.PI * 2;
      const px = fire.px + Math.cos(a) * 0.85;
      const pz = fire.pz + Math.sin(a) * 0.85;
      boxAt(this.wood, frame, px, this.world.grid.heightAt(px, pz) + 0.1, pz, 0.2, 0.2, 0.2, 0.33, 0.3, 0.25);
    }
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2 + 0.5;
      tube(this.wood,
        fire.px + Math.cos(a) * 1.6, fire.gy + 0.25, fire.pz + Math.sin(a) * 1.6,
        fire.px + Math.cos(a + 0.6) * 2.4, fire.gy + 0.2, fire.pz + Math.sin(a + 0.6) * 2.4,
        0.18, 0.14, 0.33, 0.24, 0.13, 6);
    }
    for (let i = 0; i < 4; i++) {
      this.cloth.triangle(
        this.cloth.vertex(fire.px - 0.22 + i * 0.04, fire.gy + 0.12, fire.pz, 0, 0, 0.98, 0.46, 0.07),
        this.cloth.vertex(fire.px + 0.2, fire.gy + 0.1, fire.pz + 0.14, 0, 0, 0.92, 0.3, 0.05),
        this.cloth.vertex(fire.px + 0.02, fire.gy + 0.7 + i * 0.14, fire.pz + 0.04, 0, 0, 1.0, 0.76, 0.18),
      );
    }
  }

  buildShrine() {
    const { frame, x, z, y } = roadFrame(this.world, STAGE.shrine, -1, 9.2);
    groundPad(this.wood, this.world, x, z, 4.9, 0.2, 0.23, 0.12, 22);
    padLitter(this.wood, this.world, x, z, 4.6, 36, this.random);
    this.obstacle(x, z, 2.4);
    const base = y + 0.12;
    const R = (w, h, d, cx, cy, cz, colour = [0.34, 0.25, 0.15]) =>
      boxAt(this.wood, frame, x + frame.rx * cx + frame.tx * cz, base + cy, z + frame.rz * cx + frame.tz * cz, w, h, d, ...colour);
    // Mossy stone steps climbing from the road to a paved plinth.
    const stone = (w, h, d, cx, cy, cz, tone) => R(w, h, d, cx, cy, cz, tone);
    for (let step = 0; step < 3; step++) {
      stone(2.7 - step * 0.12, 0.2, 0.78, 2.05 - step * 0.4, 0.09 + step * 0.17, 0,
        step === 2 ? [0.2, 0.22, 0.16] : [0.16, 0.18, 0.13]);
    }
    stone(1.9, 0.28, 2.9, -0.05, 0.6, 0, [0.19, 0.21, 0.15]);
    // Weeds in the step joints and a worn centre line.
    for (let i = 0; i < 9; i++) {
      stone(0.1, 0.05, 0.16, 1.7 + this.random() * 0.75, 0.23 + this.random() * 0.32,
        -1.2 + this.random() * 2.4, i % 2 ? [0.16, 0.26, 0.1] : [0.12, 0.2, 0.08]);
    }
    // Four carved posts on the plinth, front pair carrying the shrine facade.
    for (const cx of [0.72, -0.78]) {
      for (const cz of [-1.3, 1.3]) {
        R(0.3, 2.5, 0.3, cx, 1.97, cz, [0.32, 0.22, 0.12]);
        R(0.4, 0.14, 0.4, cx, 3.27, cz, [0.44, 0.25, 0.09]);
        // Carved rings at the post feet.
        R(0.4, 0.12, 0.4, cx, 0.86, cz, [0.24, 0.17, 0.1]);
      }
    }
    // Beams run post to post; no slab ceiling, so the roof reads as a roof.
    R(0.22, 0.24, 2.9, 0.72, 3.32, 0, [0.36, 0.24, 0.11]);
    for (const cz of [-1.3, 1.3]) R(1.75, 0.22, 0.22, -0.03, 3.32, cz, [0.34, 0.22, 0.1]);
    // Steep thatched roof: the ridge runs away from the road, with deep eaves
    // on all four sides, red fascia and a slim gold spire.
    const eaveY = base + 3.38, ridgeY = base + 4.72;
    for (const side of [-1, 1]) {
      this.wood.box(
        x, base + 4.05, z + frame.tz * (side * 0.95),
        -frame.tx * (0.95 * side), 0.67, -frame.tz * (0.95 * side),
        0, 0.05, 0,
        frame.rx * 1.92, 0, frame.rz * 1.92,
        0.3, 0.24, 0.14,
      );
      // Layered thatch courses and a sewn ridge line. Dry thatch is a warm
      // grey-straw, which separates the roof from the brown timber below.
      for (let course = 0; course < 8; course++) {
        const t = (course + 0.5) / 8;
        const py = ridgeY - 1.34 * t;
        const cz = z + frame.tz * (side * 1.9 * t);
        tube(this.wood,
          x - frame.rx * 1.945, py, cz - frame.rz * 1.945,
          x + frame.rx * 1.945, py, cz + frame.rz * 1.945,
          0.075, 0.075, 0.36, 0.3, 0.19, 4);
      }
      // Red eave trim catches the eye through the green.
      tube(this.cloth,
        x - frame.rx * 1.97, eaveY, z + frame.tz * (side * 1.92) - frame.rz * 1.97,
        x + frame.rx * 1.97, eaveY, z + frame.tz * (side * 1.92) + frame.rz * 1.97,
        0.065, 0.065, 0.6, 0.1, 0.05, 5);
      // Bargeboards run up the gable ends to the ridge.
      for (const end of [-1, 1]) {
        tube(this.wood,
          x + frame.rx * (end * 1.94), eaveY, z + frame.tz * (side * 1.9),
          x + frame.rx * (end * 1.94), ridgeY, z,
          0.06, 0.05, 0.3, 0.19, 0.08, 4);
      }
    }
    tube(this.wood, x - frame.rx * 1.96, ridgeY, z - frame.rz * 1.96,
      x + frame.rx * 1.96, ridgeY, z + frame.rz * 1.96,
      0.13, 0.13, 0.3, 0.2, 0.08, 6);
    // Cream plaster gable filling the road-facing end of the roof, with a
    // gold plaque flush to the wall instead of floating inside the thatch.
    const gableX = x + frame.rx * 1.9;
    this.cloth.triangle(
      this.cloth.vertex(gableX, eaveY + 0.01, z - frame.tz * 1.82, 0, 0, 0.78, 0.68, 0.48),
      this.cloth.vertex(gableX, eaveY + 0.01, z + frame.tz * 1.82, 0, 0, 0.78, 0.68, 0.48),
      this.cloth.vertex(gableX, ridgeY - 0.01, z, 0, 0, 0.86, 0.76, 0.54),
    );
    R(0.1, 0.55, 0.7, 1.9, 4.02, 0, [0.66, 0.45, 0.1]);
    R(0.06, 0.38, 0.5, 1.95, 4.04, 0, [0.9, 0.66, 0.16]);
    // Gold finial: a stepped cap and a tapered spire.
    R(0.3, 0.16, 0.3, 0, 4.8, 0, [0.78, 0.56, 0.14]);
    R(0.2, 0.12, 0.2, 0, 4.92, 0, [0.9, 0.68, 0.2]);
    tube(this.wood,
      x, ridgeY + 0.22, z,
      x, ridgeY + 0.82, z,
      0.13, 0.025, 0.88, 0.66, 0.18, 6);
    tube(this.wood,
      x, ridgeY + 0.84, z,
      x, ridgeY + 0.94, z,
      0.075, 0.03, 0.92, 0.72, 0.22, 5);
    // Deep-red awning over the steps.
    tarp(this.cloth, frame, x + frame.rx * 1.7, base + 3.08, z,
      0.72, 1.32, 0.24, 0.58, 0.1, 0.05);
    // Idol niche, brass bell and offering stones.
    R(0.12, 1.35, 1.5, -0.42, 1.62, 0, [0.12, 0.15, 0.11]);
    R(0.58, 0.7, 0.5, 0.05, 1.12, 0, [0.72, 0.5, 0.14]);
    R(0.32, 0.34, 0.3, 0.12, 1.62, 0, [0.84, 0.62, 0.18]);
    tube(this.metal, x + frame.rx * 1.1, base + 2.66, z + frame.rz * 1.1,
      x + frame.rx * 1.1, base + 2.26, z + frame.rz * 1.1, 0.075, 0.17, 0.74, 0.54, 0.15, 8);
    // Marigold garlands hang from the eave fascia, thick enough to read at speed.
    for (let i = 0; i < 23; i++) {
      const t = i / 22;
      R(0.13, 0.13, 0.13, 1.96, 3.34 - 0.18 * Math.sin(t * Math.PI), (t - 0.5) * 2.8, [1.0, 0.5, 0.04]);
    }
    for (const cz of [-1.36, 1.36]) {
      for (let i = 0; i < 7; i++) {
        R(0.11, 0.11, 0.11, 1.96, 3.2 - i * 0.27, cz, [1.0, 0.54, 0.05]);
      }
    }
    // Stone lamp pillars flanking the approach.
    for (const cz of [-1.9, 1.9]) {
      const lx = x + frame.rx * 2.95 + frame.tx * cz;
      const lz = z + frame.rz * 2.95 + frame.tz * cz;
      const gy = this.world.grid.heightAt(lx, lz);
      tube(this.wood, lx, gy - 0.1, lz, lx, gy + 1.5, lz, 0.24, 0.2, 0.4, 0.38, 0.3, 6);
      boxAt(this.wood, frame, lx, gy + 1.6, lz, 0.5, 0.22, 0.5, 0.3, 0.28, 0.22);
      this.cloth.box(lx, gy + 1.72, lz, 0.13, 0, 0.13, 0.2, 0, 0, 0.13, 0, 0.13, 0.96, 0.55, 0.1);
    }
    // A vermilion torii at the verge, with upswept lintels. It stands six
    // metres before the pavilion so the approach reads gate first, then shrine.
    const gateLateral = 5.3;
    const gateLead = 6.5;
    const gx = x + frame.rx * (9.2 - gateLateral) - frame.tx * gateLead;
    const gz = z + frame.rz * (9.2 - gateLateral) - frame.tz * gateLead;
    const gateTop = base + 2.85;
    const vermilion = [0.72, 0.13, 0.07], vermilionDark = [0.5, 0.09, 0.05], lacquer = [0.14, 0.1, 0.07];
    for (const cz of [-2.15, 2.15]) {
      const px = gx + frame.tx * cz;
      const pz = gz + frame.tz * cz;
      const gy = this.world.grid.heightAt(px, pz);
      tube(this.wood, px, gy - 0.15, pz, px, gy + 0.35, pz, 0.31, 0.29, ...lacquer, 8);
      tube(this.wood, px, gy + 0.35, pz, px, gateTop, pz, 0.27, 0.21, ...vermilion, 8);
      this.obstacle(px, pz, 0.32);
    }
    // Lower lintel (nuki) and upper beam (kasagi) with upturned ends.
    tube(this.wood,
      gx + frame.tx * -2.15, gateTop - 0.06, gz + frame.tz * -2.15,
      gx + frame.tx * 2.15, gateTop - 0.06, gz + frame.tz * 2.15,
      0.15, 0.15, ...vermilionDark, 8);
    tube(this.wood,
      gx + frame.tx * -2.3, gateTop + 0.3, gz + frame.tz * -2.3,
      gx + frame.tx * 2.3, gateTop + 0.3, gz + frame.tz * 2.3,
      0.17, 0.17, ...vermilion, 8);
    for (const side of [-1, 1]) {
      const ax = gx + frame.tx * (side * 2.3), az = gz + frame.tz * (side * 2.3);
      const bx = gx + frame.tx * (side * 3.0), bz = gz + frame.tz * (side * 3.0);
      tube(this.wood, ax, gateTop + 0.3, az, bx, gateTop + 0.62, bz,
        0.16, 0.1, ...vermilion, 6);
      boxAt(this.wood, frame, bx, gateTop + 0.66, bz, 0.22, 0.12, 0.22, ...lacquer);
    }
    // A small plaque on the lintel, thin across the gate and broad along it.
    boxAt(this.cloth, frame, gx, gateTop + 0.3, gz, 0.1, 0.44, 0.92, 0.82, 0.68, 0.26);
    boxAt(this.cloth, frame, gx + frame.rx * 0.055, gateTop + 0.3, gz, 0.04, 0.3, 0.62, 0.56, 0.12, 0.06);
    // Saffron banners face the approach, so the gate reads head-on.
    const by = gateTop - 0.14;
    for (const cz of [-1.12, 1.12]) {
      const bx = gx + frame.tx * cz;
      const bz = gz + frame.tz * cz;
      this.cloth.triangle(
        this.cloth.vertex(bx - frame.rx * 0.32, by, bz - frame.rz * 0.32, 0, 0, 0.96, 0.5, 0.05),
        this.cloth.vertex(bx + frame.rx * 0.32, by, bz + frame.rz * 0.32, 0, 0, 0.96, 0.5, 0.05),
        this.cloth.vertex(bx + frame.rx * 0.05, by - 1.3, bz + frame.rz * 0.05, 0, 0, 0.88, 0.3, 0.04),
      );
      this.cloth.triangle(
        this.cloth.vertex(bx - frame.rx * 0.32, by - 1.28, bz - frame.rz * 0.32, 0, 0, 0.7, 0.12, 0.05),
        this.cloth.vertex(bx + frame.rx * 0.32, by - 1.28, bz + frame.rz * 0.32, 0, 0, 0.7, 0.12, 0.05),
        this.cloth.vertex(bx + frame.rx * 0.05, by - 1.62, bz + frame.rz * 0.05, 0, 0, 0.7, 0.12, 0.05),
      );
    }
    // Prayer flags run from the gate, over the road, into the far trees.
    const flagStart = { x: gx, z: gz, y: gateTop - 0.05 };
    const flagEnd = roadFrame(this.world, STAGE.shrine + 9, 1, 9.5);
    const colours = [[0.88, 0.16, 0.1], [1.0, 0.76, 0.12], [0.12, 0.44, 0.72], [0.16, 0.58, 0.22], [0.94, 0.9, 0.8]];
    for (let i = 0; i < 26; i++) {
      const t = (i + 0.5) / 26;
      const px = flagStart.x + (flagEnd.x - flagStart.x) * t;
      const pz = flagStart.z + (flagEnd.z - flagStart.z) * t;
      const py = flagStart.y + (flagEnd.y + 2.8 - flagStart.y) * t - Math.sin(t * Math.PI) * 0.65;
      const col = colours[i % colours.length];
      this.cloth.triangle(
        this.cloth.vertex(px - frame.tx * 0.3, py, pz - frame.tz * 0.3, 0, 0, ...col),
        this.cloth.vertex(px + frame.tx * 0.3, py, pz + frame.tz * 0.3, 0, 0, ...col),
        this.cloth.vertex(px + frame.rx * 0.04, py - 0.58, pz + frame.rz * 0.04, 0, 0, ...col),
      );
    }
    // A second line runs back through the pavilion for depth.
    for (let i = 0; i < 14; i++) {
      const t = (i + 0.5) / 14;
      const px = flagStart.x + frame.tx * -5.8 * t;
      const pz = flagStart.z + frame.tz * -5.8 * t;
      const py = flagStart.y - 0.35 * t - Math.sin(t * Math.PI) * 0.5;
      const col = colours[(i + 2) % colours.length];
      this.cloth.triangle(
        this.cloth.vertex(px - frame.tx * 0.24, py, pz - frame.tz * 0.24, 0, 0, ...col),
        this.cloth.vertex(px + frame.tx * 0.24, py, pz + frame.tz * 0.24, 0, 0, ...col),
        this.cloth.vertex(px - frame.rx * 0.04, py - 0.5, pz - frame.rz * 0.04, 0, 0, ...col),
      );
    }
  }

  buildDeerGlade() {
    const { frame, x, z } = roadFrame(this.world, STAGE.deerGlade, 1, 9.5);
    const base = this.world.grid.heightAt(x, z);
    // A natural glade keeps the terrain; only leaf litter marks the browsing ground.
    padLitter(this.wood, this.world, x, z, 5.6, 52, this.random);
    const at = (cx, cz) => {
      const px = x + frame.rx * cx + frame.tx * cz;
      const pz = z + frame.rz * cx + frame.tz * cz;
      return { px, pz, gy: this.world.grid.heightAt(px, pz) };
    };
    // A mossy fallen log along the back of the glade.
    const a = at(2.0, 4.0), b = at(4.8, 6.8);
    tube(this.wood, a.px, a.gy + 0.42, a.pz, b.px, b.gy + 0.3, b.pz, 0.4, 0.28, 0.34, 0.27, 0.15, 8);
    tube(this.cloth, a.px, a.gy + 0.68, a.pz, b.px, b.gy + 0.54, b.pz, 0.3, 0.2, 0.22, 0.4, 0.12, 6);
    this.obstacle((a.px + b.px) / 2, (a.pz + b.pz) / 2, 1.3);
    // Broken branch stubs.
    for (const t of [0.28, 0.62]) {
      const px = a.px + (b.px - a.px) * t, pz = a.pz + (b.pz - a.pz) * t;
      tube(this.wood, px, this.world.grid.heightAt(px, pz) + 0.6, pz,
        px + frame.tx * 0.9, this.world.grid.heightAt(px, pz) + 0.95, pz + frame.tz * 0.9,
        0.12, 0.06, 0.32, 0.25, 0.14, 5);
    }
    // Boulder outcrops and a mineral lick where the herd browses. Each face
    // keeps its own vertices, so the rock reads as a chipped low-poly stone
    // instead of a smooth moss-covered egg.
    const boulder = (cx, cz, r, h, tone) => {
      const c = at(cx, cz);
      const rnd = this.random;
      const segs = 7, rings = 3;
      const rows = [];
      for (let ring = 0; ring <= rings; ring++) {
        const a = (ring / rings) * Math.PI * 0.5;
        const ry = c.gy + Math.sin(a) * h - 0.06;
        const rr = Math.cos(a) * r;
        const row = [];
        for (let j = 0; j < segs; j++) {
          const t = (j / segs) * Math.PI * 2;
          const jitter = 1 + (rnd() - 0.5) * 0.36;
          row.push([
            c.px + Math.cos(t) * rr * jitter,
            ry + (rnd() - 0.5) * h * 0.16,
            c.pz + Math.sin(t) * rr * jitter,
          ]);
        }
        rows.push(row);
      }
      const top = [c.px + (rnd() - 0.5) * r * 0.3, c.gy + h * 1.03, c.pz + (rnd() - 0.5) * r * 0.3];
      const vert = (p, s) => this.wood.vertex(p[0], p[1], p[2], 0, 0,
        tone[0] * s, tone[1] * s, tone[2] * s);
      for (let ring = 0; ring < rings; ring++) {
        for (let j = 0; j < segs; j++) {
          const k = (j + 1) % segs;
          const a = vert(rows[ring][j], 0.78 + rnd() * 0.3);
          const b = vert(rows[ring][k], 0.78 + rnd() * 0.3);
          const cc = vert(rows[ring + 1][k], 0.82 + rnd() * 0.3);
          const d = vert(rows[ring + 1][j], 0.82 + rnd() * 0.3);
          this.wood.quad(a, b, cc, d);
        }
      }
      for (let j = 0; j < segs; j++) {
        const k = (j + 1) % segs;
        this.wood.triangle(
          vert(rows[rings][j], 0.9 + rnd() * 0.2),
          vert(rows[rings][k], 0.9 + rnd() * 0.2),
          vert(top, 1.06),
        );
      }
      // Mossy skirt so the rock sits in the litter, not on it.
      const skirt = [];
      for (let j = 0; j < segs; j++) {
        const t = (j / segs) * Math.PI * 2;
        skirt.push(this.wood.vertex(c.px + Math.cos(t) * r * 1.06, c.gy - 0.15,
          c.pz + Math.sin(t) * r * 1.06, 0, 0, tone[0] * 0.5, tone[1] * 0.56, tone[2] * 0.42));
      }
      for (let j = 0; j < segs; j++) {
        const k = (j + 1) % segs;
        this.wood.quad(
          this.wood.vertex(rows[0][j][0], rows[0][j][1], rows[0][j][2], 0, 0,
            tone[0] * 0.8, tone[1] * 0.82, tone[2] * 0.68),
          this.wood.vertex(rows[0][k][0], rows[0][k][1], rows[0][k][2], 0, 0,
            tone[0] * 0.8, tone[1] * 0.82, tone[2] * 0.68),
          skirt[k], skirt[j],
        );
      }
      this.obstacle(c.px, c.pz, r * 0.9);
    };
    boulder(-1.0, -4.2, 0.95, 0.52, [0.32, 0.3, 0.26]);
    boulder(3.0, -3.0, 0.62, 0.38, [0.28, 0.27, 0.23]);
    boulder(1.4, 2.6, 0.76, 0.44, [0.33, 0.32, 0.28]);
    const lick = at(-0.4, 3.5);
    boxAt(this.wood, frame, lick.px, lick.gy + 0.14, lick.pz, 0.42, 0.3, 0.34, 0.66, 0.62, 0.47);
    boxAt(this.wood, frame, lick.px, lick.gy + 0.34, lick.pz, 0.28, 0.16, 0.22, 0.56, 0.56, 0.4);
    // Deer trail and fresh slots in the soft ground.
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const px = x - frame.rx * (2.3 - t * 1.3) + frame.tx * (2.8 + t * 4.2);
      const pz = z - frame.rz * (2.3 - t * 1.3) + frame.tz * (2.8 + t * 4.2);
      boxAt(this.wood, frame, px, this.world.grid.heightAt(px, pz) + 0.045, pz, 0.26, 0.03, 0.2, 0.33, 0.27, 0.18);
    }
    // Low ferns frame the far side of the glade only, so the herd stays visible
    // from the road instead of grazing behind a screen of leaves.
    for (let i = 0; i < 22; i++) {
      const offR = 1.2 + this.random() * 4.8;
      const offT = (this.random() * 2 - 1) * 5.8;
      const px = x + frame.rx * offR + frame.tx * offT;
      const pz = z + frame.rz * offR + frame.tz * offT;
      this.leafCard(px, this.world.grid.heightAt(px, pz) + 0.24, pz,
        0.34 + this.random() * 0.3, this.random() * 6.28, i % 3 ? 0x3a5b22 : 0x456629, 0.15);
    }
  }

  buildWatchtower() {
    const { frame, x, z, y } = roadFrame(this.world, STAGE.watchtower, 1, 10.5);
    groundPad(this.wood, this.world, x, z, 5.0, 0.24, 0.17, 0.1, 20);
    padLitter(this.wood, this.world, x, z, 4.6, 30, this.random);
    this.obstacle(x, z, 2.1);
    const base = y + 0.05;
    const H = 5.5;
    const corners = [[-1.9, -1.9], [1.9, -1.9], [-1.9, 1.9], [1.9, 1.9]];
    for (const [cx, cz] of corners) {
      const px = x + frame.rx * cx + frame.tx * cz;
      const pz = z + frame.rz * cx + frame.tz * cz;
      tube(this.wood, px, base - 0.25, pz, px, base + H, pz, 0.14, 0.1, 0.26, 0.18, 0.1, 7);
      // Painted safety band, readable through the undergrowth.
      tube(this.cloth, px, base + 1.15, pz, px, base + 1.62, pz, 0.15, 0.15, 0.82, 0.36, 0.08, 7);
    }
    // Cross bracing on all four faces.
    for (const [a, b] of [[0, 1], [2, 3], [0, 2], [1, 3]]) {
      const [ax, az] = corners[a], [bx, bz] = corners[b];
      tube(this.wood,
        x + frame.rx * ax + frame.tx * az, base + 0.8, z + frame.rz * ax + frame.tz * az,
        x + frame.rx * bx + frame.tx * bz, base + H * 0.7, z + frame.rz * bx + frame.tz * bz,
        0.055, 0.055, 0.25, 0.18, 0.1, 6);
    }
    const deck = base + H;
    this.wood.box(x, deck, z, frame.rx * 2.2, 0, frame.rz * 2.2, 0.11, 0, 0,
      frame.tx * 2.2, 0, frame.tz * 2.2, 0.32, 0.23, 0.12);
    // Railings.
    for (const [cx, cz, w, d] of [[0, -2.15, 2.2, 0.05], [0, 2.15, 2.2, 0.05], [-2.15, 0, 0.05, 2.2], [2.15, 0, 0.05, 2.2]]) {
      this.wood.box(x + frame.rx * cx + frame.tx * cz, deck + 0.95, z + frame.rz * cx + frame.tz * cz,
        frame.rx * w, 0, frame.rz * w, 0.58, 0, 0, frame.tx * d, 0, frame.tz * d, 0.29, 0.22, 0.12);
    }
    // Pitched corrugated roof with a ridge cap and deep eaves.
    for (const side of [-1, 1]) {
      this.metal.box(x + frame.rx * side * 1.32, deck + 3.45, z,
        frame.rx * 1.42 * side, -0.5, frame.rz * 1.42 * side,
        0, 0.055, 0,
        frame.tx * 2.85, 0, frame.tz * 2.85,
        0.24, 0.26, 0.2);
    }
    tube(this.metal, x, deck + 3.96, z - frame.tz * 2.9,
      x, deck + 3.96, z + frame.tz * 2.9, 0.1, 0.1, 0.3, 0.32, 0.26, 6);
    for (let i = 0; i < 4; i++) {
      const cx = -1.1 + i * 0.73;
      tube(this.metal, x + frame.rx * cx, deck + 3.0, z - frame.tz * 2.82,
        x + frame.rx * cx, deck + 3.53, z - frame.tz * 1.15,
        0.025, 0.025, 0.32, 0.33, 0.27, 4);
    }
    for (const [cx, cz] of corners) {
      tube(this.wood, x + frame.rx * cx * 0.98 + frame.tx * cz * 0.98, deck, z + frame.rz * cx * 0.98 + frame.tz * cz * 0.98,
        x + frame.rx * cx * 0.98 + frame.tx * cz * 0.98, deck + 3.02, z + frame.rz * cx * 0.98 + frame.tz * cz * 0.98,
        0.06, 0.06, 0.26, 0.19, 0.1, 6);
    }
    // Solar panel strapped to the sunny pitch of the roof.
    this.metal.box(x + frame.rx * 1.0, deck + 3.3, z,
      frame.rx * 0.82, -0.58, frame.rz * 0.82,
      0, 0.06, 0,
      frame.tx * 0.62, 0, frame.tz * 0.62,
      0.07, 0.12, 0.2);
    // Ladder on the road-facing side.
    for (const side of [-1, 1]) {
      const px = x + frame.rx * -2.05 + frame.tx * (side * 0.38);
      const pz = z + frame.rz * -2.05 + frame.tz * (side * 0.38);
      tube(this.wood, px, base, pz, px, deck + 0.15, pz, 0.055, 0.055, 0.3, 0.22, 0.11, 6);
    }
    for (let i = 0; i < 10; i++) {
      const py = base + 0.45 + i * 0.5;
      this.wood.box(x + frame.rx * -2.05, py, z + frame.rz * -2.05,
        frame.rx * 0.06, 0, frame.rz * 0.06, 0.04, 0, 0, frame.tx * 0.45, 0, frame.tz * 0.45,
        0.28, 0.2, 0.1);
    }
    // Spotlight, a red beacon and a radio mast.
    tube(this.metal, x + frame.rx * -1.4, deck + 4.0, z + frame.rz * -1.4,
      x + frame.rx * -1.75, deck + 3.6, z + frame.rz * -1.75, 0.065, 0.13, 0.42, 0.4, 0.34, 7);
    this.metal.box(x + frame.rx * 1.4, deck + 4.0, z + frame.rz * 1.4,
      frame.rx * 0.13, 0, frame.rz * 0.13, 0.12, 0, 0, frame.tx * 0.13, 0, frame.tz * 0.13, 0.72, 0.1, 0.07);
    tube(this.metal, x + frame.rx * 1.5, deck + 3.6, z + frame.rz * 1.5,
      x + frame.rx * 1.5, deck + 6.7, z + frame.rz * 1.5, 0.045, 0.025, 0.4, 0.42, 0.38, 5);
    tube(this.wood, x + frame.rx * -1.6, deck + 3.55, z + frame.rz * -1.6,
      x + frame.rx * -1.6, deck + 5.7, z + frame.rz * -1.6, 0.035, 0.02, 0.32, 0.24, 0.13, 5);
    this.cloth.box(x + frame.rx * -1.6 + frame.tx * 0.5, deck + 5.35, z + frame.rz * -1.6 + frame.tz * 0.5,
      frame.rx * 0.03, 0, frame.rz * 0.03, 0.18, 0, 0, frame.tx * 0.5, 0, frame.tz * 0.5,
      0.72, 0.18, 0.1);
    // Sandbag ring and a stencilled supply crate at the base.
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2;
      const px = x + Math.cos(a) * 2.45;
      const pz = z + Math.sin(a) * 2.45;
      boxAt(this.cloth, frame, px, this.world.grid.heightAt(px, pz) + 0.13, pz, 0.4, 0.16, 0.28, 0.42, 0.38, 0.27);
    }
  }

  buildBambooRun() {
    const road = this.world.roads[0];
    const random = this.random;
    const greens = [
      [0.1, 0.19, 0.04], [0.13, 0.25, 0.055], [0.17, 0.31, 0.075], [0.22, 0.37, 0.1],
    ];
    const leafColours = [0x3f6626, 0x4c7730, 0x587f36, 0x6b9440, 0x355a20];
    const pick = (i) => greens[i % greens.length];
    for (let s = STAGE.bamboo.start; s <= STAGE.bamboo.end; s += 9) {
      // halfWidth is per-sample on the road; the frame carries the interpolated value.
      const frame = road.frameAt(s, {});
      const half = frame.halfWidth;
      for (const side of [-1, 1]) {
        // Two woven arches per step, offset along the road so the roof stays irregular.
        for (let arch = 0; arch < 2; arch++) {
          const along = arch ? 0.9 : -0.9;
          const groundX = frame.x + frame.rx * side * (half + 1.8);
          const groundZ = frame.z + frame.rz * side * (half + 1.8);
          const groundY = this.world.grid.heightAt(groundX, groundZ);
          const px = frame.x + frame.tx * along;
          const pz = frame.z + frame.tz * along;
          const shade = pick(arch + (side > 0 ? 1 : 0));
          tube(this.wood, groundX, groundY, groundZ,
            px + frame.rx * side * (half + 0.6), groundY + 3.25, pz + frame.rz * side * (half + 0.6),
            0.13, 0.1, ...shade, 6);
          tube(this.wood,
            px + frame.rx * side * (half + 0.6), groundY + 3.25, pz + frame.rz * side * (half + 0.6),
            px - frame.rx * side * (half * 0.15), groundY + 5.45, pz - frame.rz * side * (half * 0.15),
            0.1, 0.075, ...shade, 6);
          tube(this.wood,
            px - frame.rx * side * (half * 0.15), groundY + 5.45, pz - frame.rz * side * (half * 0.15),
            px - frame.rx * side * (half * 0.62), groundY + 5.75, pz - frame.rz * side * (half * 0.62),
            0.075, 0.05, ...shade, 6);
          for (let leaf = 0; leaf < 3; leaf++) {
            const alongLeaf = (leaf - 1) * 0.55;
            this.leafCard(
              px - frame.rx * side * (half * 0.2) + frame.tx * alongLeaf,
              groundY + 5.55 + random() * 0.5,
              pz - frame.rz * side * (half * 0.2) + frame.tz * alongLeaf,
              0.95 + random() * 0.7, random() * 6.28,
              leafColours[(leaf + (side > 0 ? 1 : 0)) % leafColours.length],
              (random() - 0.5) * 0.5,
            );
          }
        }
        // Standing grove either side of the road; taller culms disappear into the canopy.
        for (let culm = 0; culm < 3; culm++) {
          const lateral = half + 2.0 + random() * 6.5;
          const along = (random() - 0.5) * 7;
          const px = frame.x + frame.rx * side * lateral + frame.tx * along;
          const pz = frame.z + frame.rz * side * lateral + frame.tz * along;
          const ground = this.world.grid.heightAt(px, pz);
          const height = 6 + random() * 5.5;
          const lean = (random() - 0.5) * 1.6;
          const shade = pick(culm + (side > 0 ? 1 : 0));
          tube(this.wood, px, ground - 0.15, pz,
            px + frame.tx * lean, ground + height, pz + frame.tz * lean,
            0.14, 0.08, ...shade, 6);
          for (let node = 1; node <= 3; node++) {
            const y = ground + height * node / 4;
            const nx = px + frame.tx * lean * (node / 4);
            const nz = pz + frame.tz * lean * (node / 4);
            this.wood.box(nx, y, nz, frame.rx * 0.12, 0, frame.rz * 0.12,
              0.035, 0, 0, frame.tx * 0.12, 0, frame.tz * 0.12, ...pick(culm + 1));
          }
          for (let leaf = 0; leaf < 3; leaf++) {
            const angle = leaf * 2.1 + random();
            const ox = Math.cos(angle) * 0.55, oz = Math.sin(angle) * 0.55;
            this.leafCard(
              px + frame.tx * lean + ox, ground + height - 0.4 - random() * 0.7, pz + frame.tz * lean + oz,
              1.0 + random() * 0.85, random() * 6.28,
              leafColours[(leaf + culm + (side > 0 ? 2 : 0)) % leafColours.length],
              (random() - 0.5) * 0.6,
            );
          }
          this.leafCard(px + frame.tx * lean * 0.7, ground + height * 0.62, pz + frame.tz * lean * 0.7,
            0.75 + random() * 0.55, random() * 6.28,
            leafColours[(culm + 1) % leafColours.length], (random() - 0.5) * 0.7);
        }
      }
      // Tie the arches together over the centreline.
      if ((s - STAGE.bamboo.start) % 27 === 0) {
        const left = half * 0.62;
        tube(this.wood,
          frame.x - frame.rx * left, frame.y + 5.7, frame.z - frame.rz * left,
          frame.x + frame.rx * left, frame.y + 5.85, frame.z + frame.rz * left,
          0.06, 0.06, 0.3, 0.42, 0.14, 5);
      }
      // Hanging vines and red festival ribbons.
      for (let k = 0; k < 4; k++) {
        const t = (k + 0.5) / 4;
        const px = frame.x + frame.rx * (t - 0.5) * half * 1.5;
        const pz = frame.z + frame.rz * (t - 0.5) * half * 1.5;
        const py = frame.y + 5.9 + Math.sin(s * 0.13 + k) * 0.35;
        tube(this.cloth, px, py, pz, px + 0.1, py - 2.4 - k * 0.45, pz + 0.04,
          0.022, 0.014, 0.2, 0.36, 0.12, 4);
        if ((s + k) % 18 < 9) {
          this.cloth.box(px, py - 1.5, pz, 0.14, 0, 0.025, 0.02, 0, 0, 0.014, 0.22, 0.014, 0.72, 0.1, 0.06);
        }
      }
    }
  }

  buildElephantLick() {
    const { frame, x, z, y } = roadFrame(this.world, STAGE.elephants, 1, 15);
    // Natural lick: churned clay and litter, no artificial terrace.
    padLitter(this.wood, this.world, x, z, 8.6, 110, this.random);
    // A wallow, a mineral log and fresh tracks in the churned clay.
    const wx = x + frame.tx * 3.4;
    const wz = z + frame.tz * 3.4;
    groundPad(this.wood, this.world, wx, wz, 3.4, 0.12, 0.095, 0.06, 16);
    this.metal.box(wx, this.world.grid.heightAt(wx, wz) + 0.03, wz,
      frame.rx * 2.3, 0, frame.rz * 2.3, 0.015, 0, 0,
      frame.tx * 1.7, 0, frame.tz * 1.7, 0.055, 0.075, 0.045);
    for (let i = 0; i < 9; i++) {
      const a = this.random() * Math.PI * 2;
      const r = 1.2 + this.random() * 4.8;
      const px = x + frame.rx * Math.cos(a) * r + frame.tx * (Math.sin(a) * r + 1.2);
      const pz = z + frame.rz * Math.cos(a) * r + frame.tz * (Math.sin(a) * r + 1.2);
      const py = this.world.grid.heightAt(px, pz) + 0.045;
      this.wood.box(px, py, pz, frame.rx * 0.26, 0, frame.rz * 0.26,
        0.012, 0, 0, frame.tx * 0.34, 0, frame.tz * 0.34, 0.1, 0.08, 0.05);
    }
    tube(this.wood,
      x + frame.rx * -3.4 + frame.tx * -3.2, y + 0.55, z + frame.rz * -3.4 + frame.tz * -3.2,
      x + frame.rx * 2.2 + frame.tx * -3.2, y + 0.32, z + frame.rz * 2.2 + frame.tz * -3.2,
      0.44, 0.34, 0.3, 0.24, 0.14, 8);
    // A cracked salt block, licked smooth.
    this.wood.box(x + frame.rx * -1.2 + frame.tx * -3.3, y + 0.22, z + frame.rz * -1.2 + frame.tz * -3.3,
      frame.rx * 0.42, 0, frame.rz * 0.42, 0.36, 0, 0, frame.tx * 0.32, 0, frame.tz * 0.32, 0.62, 0.56, 0.42);
    // A termite spike beside the clearing.
    tube(this.wood,
      x + frame.rx * 5.6, this.world.grid.heightAt(x + frame.rx * 5.6, z + frame.rz * 5.6), z + frame.rz * 5.6,
      x + frame.rx * 5.6, y + 2.2, z + frame.rz * 5.6,
      0.38, 0.1, 0.42, 0.3, 0.16, 8);
    this.obstacle(x + frame.rx * 5.6, z + frame.rz * 5.6, 0.5);
    // Fallen browse and a stripped sapling.
    for (let i = 0; i < 3; i++) {
      const cx = -4.5 + i * 1.4;
      const cz = 4.6 + i * 0.8;
      tube(this.wood,
        x + frame.rx * cx + frame.tx * cz, y + 0.45, z + frame.rz * cx + frame.tz * cz,
        x + frame.rx * (cx + 2.2) + frame.tx * (cz + 1.1), y + 0.18, z + frame.rz * (cx + 2.2) + frame.tz * (cz + 1.1),
        0.1, 0.07, 0.31, 0.26, 0.14, 5);
    }
    for (let i = 0; i < 6; i++) {
      const a = this.random() * Math.PI * 2;
      const r = 2.7 + this.random() * 2.2;
      this.leafCard(wx + Math.cos(a) * r, this.world.grid.heightAt(wx + Math.cos(a) * r, wz + Math.sin(a) * r) + 0.34,
        wz + Math.sin(a) * r, 0.4 + this.random() * 0.3, a, 0x3a5b22, 0.2);
    }
  }

  finish(quality) {
    const clothMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true, side: THREE.DoubleSide, roughness: 0.9, metalness: 0,
    });
    clothMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.time;
      shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         transformed.x += sin(uTime * 2.1 + position.x * 0.35 + position.z * 0.28) * 0.035;
         transformed.z += cos(uTime * 1.7 + position.x * 0.22) * 0.025;`,
      );
    };
    const materials = [
      new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xa28c6e, side: THREE.DoubleSide, roughness: 0.9, metalness: 0 }),
      new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x969a92, side: THREE.DoubleSide, roughness: 0.68, metalness: 0.28 }),
      clothMaterial,
    ];
    const buffers = [this.wood, this.metal, this.cloth];
    buffers.forEach((buffer, index) => {
      if (!buffer.triangleCount) return;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffer.positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(buffer.colors, 3));
      geometry.setIndex(buffer.indices);
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, materials[index]);
      mesh.name = ['SetPieceTimber', 'SetPieceMetal', 'SetPieceCloth'][index];
      mesh.receiveShadow = true;
      mesh.castShadow = index !== 2;
      this.group.add(mesh);
      this.disposables.push(geometry);
    });
    if (this.foliage && this.leafMatrices.length) {
      const geometry = plantGeometry(1, 0, 0.22);
      const leaves = new THREE.InstancedMesh(geometry, this.foliage, this.leafMatrices.length);
      leaves.name = 'SetPieceLeaves';
      leaves.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      this.leafMatrices.forEach(([matrix, color], i) => {
        leaves.setMatrixAt(i, matrix);
        leaves.setColorAt(i, new THREE.Color(color));
      });
      leaves.instanceMatrix.needsUpdate = true;
      leaves.computeBoundingSphere();
      leaves.receiveShadow = true;
      this.group.add(leaves);
      this.disposables.push(geometry);
    }
    materials.forEach((material) => this.disposables.push(material));
  }

  update(dt) {
    this.time.value += dt;
  }

  dispose() {
    this.group.parent?.remove(this.group);
    for (const resource of this.disposables) resource.dispose();
  }
}
