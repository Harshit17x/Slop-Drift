import * as THREE from 'three';
import { Heightfield } from './Heightfield.js';
import { SeededNoise } from './SeededNoise.js';
import { SURFACE_PROFILES } from './SurfaceClassifier.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function wrapAngle(value) {
  let angle = value;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function rotateAroundAxis(vector, axis, angle) {
  return vector.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, angle));
}

function smoothstep(edge0, edge1, value) {
  const amount = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function roadWidthForSample(sample, fallback) {
  return Number.isFinite(sample?.roadWidth) && sample.roadWidth > 0 ? sample.roadWidth : fallback;
}

function blendDirection(a, b, amount, fallback) {
  const direction = a.clone().lerp(b, amount);
  if (direction.lengthSq() > 0.000001) return direction.normalize();
  if (a.lengthSq() > 0.000001) return a.clone().normalize();
  if (b.lengthSq() > 0.000001) return b.clone().normalize();
  return fallback.clone().normalize();
}

function appendPathPoints(target, points) {
  points.forEach((point, index) => {
    if (target.length && index === 0) return;
    target.push(new THREE.Vector2(point[0], point[1]));
  });
}

function cubicPathPoints(start, controlA, controlB, end, steps) {
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const inverse = 1 - t;
    points.push([
      inverse * inverse * inverse * start[0] + 3 * inverse * inverse * t * controlA[0] + 3 * inverse * t * t * controlB[0] + t * t * t * end[0],
      inverse * inverse * inverse * start[1] + 3 * inverse * inverse * t * controlA[1] + 3 * inverse * t * t * controlB[1] + t * t * t * end[1],
    ]);
  }
  return points;
}

function arcPathPoints(centerX, centerZ, radius, startAngle, endAngle, steps) {
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = THREE.MathUtils.lerp(startAngle, endAngle, i / steps);
    points.push([centerX + Math.cos(angle) * radius, centerZ + Math.sin(angle) * radius]);
  }
  return points;
}

function makeRibbonGeometry(samples, leftWidth, rightWidth, normalOffset = 0) {
  const positions = new Float32Array(samples.length * 6);
  const indices = new Uint32Array(samples.length * 6);
  const baseRoadWidth = Math.max(0.001, leftWidth + rightWidth);
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    const widthScale = roadWidthForSample(sample, baseRoadWidth) / baseRoadWidth;
    const left = sample.position.clone().addScaledVector(sample.right, -leftWidth * widthScale).addScaledVector(sample.normal, normalOffset);
    const right = sample.position.clone().addScaledVector(sample.right, rightWidth * widthScale).addScaledVector(sample.normal, normalOffset);
    positions[i * 6] = left.x;
    positions[i * 6 + 1] = left.y;
    positions[i * 6 + 2] = left.z;
    positions[i * 6 + 3] = right.x;
    positions[i * 6 + 4] = right.y;
    positions[i * 6 + 5] = right.z;
    const next = (i + 1) % samples.length;
    const a = i * 2;
    const b = next * 2;
    const base = i * 6;
    indices[base] = a;
    indices[base + 1] = b;
    indices[base + 2] = a + 1;
    indices[base + 3] = b;
    indices[base + 4] = b + 1;
    indices[base + 5] = a + 1;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function makeColoredRibbonGeometry(samples, width, colors, normalOffset = 0) {
  const geometry = makeRibbonGeometry(samples, width, width, normalOffset);
  const colorArray = new Float32Array(samples.length * 6);
  const leftColor = new THREE.Color(colors.left);
  const rightColor = new THREE.Color(colors.right);
  for (let i = 0; i < samples.length; i += 1) {
    colorArray[i * 6] = leftColor.r;
    colorArray[i * 6 + 1] = leftColor.g;
    colorArray[i * 6 + 2] = leftColor.b;
    colorArray[i * 6 + 3] = rightColor.r;
    colorArray[i * 6 + 4] = rightColor.g;
    colorArray[i * 6 + 5] = rightColor.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));
  return geometry;
}

function makeCurbGeometry(samples, side, curbWidth, normalOffset = 0.035) {
  const positions = new Float32Array(samples.length * 6);
  const colors = new Float32Array(samples.length * 6);
  const indices = new Uint32Array(samples.length * 6);
  const red = new THREE.Color(0xc8443e);
  const white = new THREE.Color(0xe8dfc7);
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    const halfWidth = roadWidthForSample(sample, 7.6) * 0.5;
    const inner = sample.position.clone().addScaledVector(sample.right, side * (halfWidth + 0.02)).addScaledVector(sample.normal, normalOffset);
    const outer = sample.position.clone().addScaledVector(sample.right, side * (halfWidth + curbWidth)).addScaledVector(sample.normal, normalOffset);
    const offset = i * 6;
    positions[offset] = inner.x;
    positions[offset + 1] = inner.y;
    positions[offset + 2] = inner.z;
    positions[offset + 3] = outer.x;
    positions[offset + 4] = outer.y;
    positions[offset + 5] = outer.z;
    const color = (Math.floor(sample.distance / 3.2) % 2 === 0) ? red : white;
    colors[offset] = color.r;
    colors[offset + 1] = color.g;
    colors[offset + 2] = color.b;
    colors[offset + 3] = color.r;
    colors[offset + 4] = color.g;
    colors[offset + 5] = color.b;
    const next = (i + 1) % samples.length;
    const base = i * 6;
    indices[base] = i * 2;
    indices[base + 1] = next * 2;
    indices[base + 2] = i * 2 + 1;
    indices[base + 3] = next * 2;
    indices[base + 4] = next * 2 + 1;
    indices[base + 5] = i * 2 + 1;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function makeBeam(start, end, radius, material, name) {
  const direction = end.clone().sub(start);
  const length = direction.length();
  if (length <= 0.001) return null;
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 6), material);
  mesh.name = name;
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export class MountainRoad {
  constructor(options = {}) {
    this.seed = options.seed ?? 1337;
    this.noise = options.noise || new SeededNoise(this.seed + 19);
    this.heightfield = options.heightfield || new Heightfield({ seed: this.seed });
    this.root = new THREE.Group();
    this.root.name = 'MountainRoad';
    this.roadWidth = options.roadWidth ?? 7.2;
    this.shoulderWidth = options.shoulderWidth ?? 2.2;
    this.segmentCount = Math.max(24, Math.floor(options.segmentCount ?? 480));
    this.controlPointCount = Math.max(6, Math.floor(options.controlPointCount ?? 12));
    this.roadElevation = options.roadElevation ?? 0.18;
    this.spawnHeight = options.spawnHeight ?? 0.2;
    this.bankStrength = options.bankStrength ?? 0.75;
    this.maxBank = options.maxBank ?? Math.PI * 0.14;
    this.checkpointCount = Math.max(1, Math.floor(options.checkpointCount ?? 16));
    this.guardrailSpacing = Math.max(1, Math.floor(options.guardrailSpacing ?? 5));
    this.controlPoints = options.controlPoints?.map((point) => point.clone ? point.clone() : new THREE.Vector3(point.x, point.y || 0, point.z)) || null;
    this.customBanking = options.banking || null;
    this.hairpinPath = null;
    this.hairpinPathLength = 0;
    this.samples = [];
    this.checkpoints = [];
    this.totalLength = 0;
    this.spline = null;
    this.roadMesh = null;
    this.shoulderMesh = null;
    this.guardrails = null;
    this.curbs = null;
    this.hairpinWarnings = null;
    this.checkpointGroup = null;
    this.built = false;
    if (options.autoBuild !== false) this.build();
  }

  heightAt(x, z) {
    return this.heightfield?.sampleHeight ? this.heightfield.sampleHeight(x, z) : 0;
  }

  createControlPoints() {
    if (this.controlPoints?.length >= 4) {
      this.hairpinPath = null;
      this.hairpinPathLength = 0;
      return this.controlPoints.map((point) => point.clone());
    }
    const layout = [];
    const start = [-100, -55];
    appendPathPoints(layout, cubicPathPoints(start, [-78, -58], [-10, -70], [48, -54], 16));
    const hairpinStartIndex = layout.length - 1;
    appendPathPoints(layout, cubicPathPoints([48, -54], [64, -54], [74, -14], [90, -14], 12));
    appendPathPoints(layout, arcPathPoints(90, -2, 12, -Math.PI * 0.5, Math.PI * 0.5, 12));
    appendPathPoints(layout, cubicPathPoints([90, 10], [74, 10], [56, 26], [40, 26], 10));
    const hairpinEndIndex = layout.length - 1;
    appendPathPoints(layout, cubicPathPoints([40, 26], [10, 26], [-52, 38], [-78, 55], 14));
    appendPathPoints(layout, cubicPathPoints([-78, 55], [-96, 74], [-78, 97], [-48, 101], 12));
    appendPathPoints(layout, cubicPathPoints([-48, 101], [-10, 110], [42, 102], [88, 83], 16));
    appendPathPoints(layout, cubicPathPoints([88, 83], [120, 65], [140, 30], [140, -5], 14));
    appendPathPoints(layout, cubicPathPoints([140, -5], [140, -44], [115, -82], [72, -99], 14));
    appendPathPoints(layout, cubicPathPoints([72, -99], [25, -115], [-46, -112], [-88, -86], 16));
    appendPathPoints(layout, cubicPathPoints([-88, -86], [-105, -74], [-116, -60], start, 12));

    const scaleX = clamp((this.heightfield.sizeX * 0.5 - 12) / 141, 0.58, 1);
    const scaleZ = clamp((this.heightfield.sizeZ * 0.5 - 12) / 112, 0.58, 1);
    const scaledLayout = layout.map((point) => new THREE.Vector2(point.x * scaleX, point.y * scaleZ));
    this.hairpinPath = scaledLayout.slice(hairpinStartIndex, hairpinEndIndex + 1).map((point) => point.clone());
    this.hairpinPathLength = 0;
    for (let i = 1; i < this.hairpinPath.length; i += 1) this.hairpinPathLength += this.hairpinPath[i - 1].distanceTo(this.hairpinPath[i]);
    return scaledLayout.map((point) => new THREE.Vector3(point.x, this.heightAt(point.x, point.y) + this.roadElevation, point.y));
  }

  getHairpinInfluence(position) {
    if (!this.hairpinPath?.length || this.hairpinPathLength <= 0) return 0;
    let bestDistanceSq = Infinity;
    let bestAlong = 0;
    let accumulated = 0;
    for (let i = 1; i < this.hairpinPath.length; i += 1) {
      const a = this.hairpinPath[i - 1];
      const b = this.hairpinPath[i];
      const abX = b.x - a.x;
      const abY = b.y - a.y;
      const lengthSq = abX * abX + abY * abY;
      const amount = lengthSq > 0 ? clamp(((position.x - a.x) * abX + (position.z - a.y) * abY) / lengthSq, 0, 1) : 0;
      const px = a.x + abX * amount;
      const pz = a.y + abY * amount;
      const dx = position.x - px;
      const dz = position.z - pz;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq < bestDistanceSq) bestAlong = accumulated + Math.sqrt(lengthSq) * amount;
      bestDistanceSq = Math.min(bestDistanceSq, distanceSq);
      accumulated += Math.sqrt(lengthSq);
    }
    const distanceInfluence = 1 - clamp(Math.sqrt(bestDistanceSq) / Math.max(4, this.roadWidth * 2.5), 0, 1);
    const progress = bestAlong / this.hairpinPathLength;
    const taper = smoothstep(0, 0.13, progress) * smoothstep(0, 0.17, 1 - progress);
    return clamp(distanceInfluence * taper, 0, 1);
  }

  clearRenderables() {
    while (this.root.children.length) this.root.remove(this.root.children[0]);
    this.roadMesh = null;
    this.shoulderMesh = null;
    this.guardrails = null;
    this.curbs = null;
    this.hairpinWarnings = null;
    this.checkpointGroup = null;
  }

  build() {
    this.clearRenderables();
    const controls = this.createControlPoints();
    this.spline = new THREE.CatmullRomCurve3(controls, true, 'centripetal', 0.35);
    this.spline.arcLengthDivisions = Math.max(200, this.segmentCount * 2);
    this.spline.updateArcLengths();
    const rawPoints = [];
    for (let i = 0; i < this.segmentCount; i += 1) {
      const point = this.spline.getPointAt((i + 0.5) / this.segmentCount);
      point.y = this.heightAt(point.x, point.z) + this.roadElevation;
      rawPoints.push(point);
    }
    let previousRight = null;
    this.samples = rawPoints.map((position, index) => {
      const previous = rawPoints[(index - 1 + rawPoints.length) % rawPoints.length];
      const next = rawPoints[(index + 1) % rawPoints.length];
      const tangent = next.clone().sub(previous);
      if (tangent.lengthSq() < 0.000001) tangent.copy(next).sub(position);
      if (tangent.lengthSq() < 0.000001) tangent.copy(position).sub(previous);
      if (tangent.lengthSq() < 0.000001) tangent.set(0, 0, -1);
      tangent.normalize();
      const terrain = this.heightfield.sample(position.x, position.z);
      const baseNormal = new THREE.Vector3(terrain.normal.x, terrain.normal.y, terrain.normal.z);
      if (baseNormal.lengthSq() < 0.000001) baseNormal.set(0, 1, 0);
      baseNormal.normalize();
      let right = tangent.clone().cross(baseNormal).normalize();
      if (right.lengthSq() < 0.000001) {
        right = tangent.clone().cross(new THREE.Vector3(0, 1, 0));
        if (right.lengthSq() < 0.000001) right.set(1, 0, 0);
        right.normalize();
      }
      if (previousRight && right.dot(previousRight) < 0) right.negate();
      const previousDirection = position.clone().sub(previous);
      const nextDirection = next.clone().sub(position);
      const prevHeading = Math.atan2(previousDirection.x, -previousDirection.z);
      const nextHeading = Math.atan2(nextDirection.x, -nextDirection.z);
      const distance = previous.distanceTo(next) * 0.5;
      const curvature = wrapAngle(nextHeading - prevHeading) / Math.max(0.01, distance);
      const suppliedBank = typeof this.customBanking === 'function' ? this.customBanking({ index, progress: index / this.segmentCount, curvature, position: position.clone() }) : 0;
      const hairpinFactor = this.getHairpinInfluence(position);
      const hairpinBank = (Math.sign(curvature) || 1) * hairpinFactor * this.maxBank * 0.58;
      const bank = clamp(curvature * this.bankStrength + hairpinBank + (Number.isFinite(suppliedBank) ? suppliedBank : 0), -this.maxBank, this.maxBank);
      const bankedRight = rotateAroundAxis(right, tangent, bank).normalize();
      const bankedNormal = bankedRight.clone().cross(tangent).normalize();
      if (bankedNormal.dot(baseNormal) < 0) {
        bankedRight.negate();
        bankedNormal.negate();
      }
      previousRight = bankedRight.clone();
      return {
        position,
        tangent,
        right: bankedRight,
        normal: bankedNormal,
        terrainNormal: baseNormal,
        curvature,
        bank,
        hairpinFactor,
        roadWidth: this.roadWidth * (1 - hairpinFactor * 0.16),
        progress: 0,
        distance: 0,
      };
    });
    this.totalLength = 0;
    for (let i = 0; i < this.samples.length; i += 1) {
      const previous = this.samples[(i - 1 + this.samples.length) % this.samples.length];
      if (i > 0) this.totalLength += this.samples[i].position.distanceTo(previous.position);
      this.samples[i].distance = this.totalLength;
    }
    this.totalLength += this.samples[0].position.distanceTo(this.samples[this.samples.length - 1].position);
    this.samples.forEach((sample) => {
      sample.progress = sample.distance / this.totalLength;
    });
    this.buildRoadMeshes();
    this.buildGuardrails();
    this.buildHairpinWarnings();
    this.buildCheckpoints();
    this.buildSpatialGrid(28);
    this.built = true;
    return this;
  }

  buildSpatialGrid(cellSize = 28) {
    this.spatialCellSize = cellSize;
    this.spatialGrid = new Map();
    const pad = (this.roadWidth + this.shoulderWidth) * 1.5;
    for (let i = 0; i < this.samples.length; i += 1) {
      const a = this.samples[i];
      const b = this.samples[(i + 1) % this.samples.length];
      const minX = Math.min(a.position.x, b.position.x) - pad;
      const maxX = Math.max(a.position.x, b.position.x) + pad;
      const minZ = Math.min(a.position.z, b.position.z) - pad;
      const maxZ = Math.max(a.position.z, b.position.z) + pad;
      const minCx = Math.floor(minX / cellSize);
      const maxCx = Math.floor(maxX / cellSize);
      const minCz = Math.floor(minZ / cellSize);
      const maxCz = Math.floor(maxZ / cellSize);
      for (let cx = minCx; cx <= maxCx; cx += 1) {
        for (let cz = minCz; cz <= maxCz; cz += 1) {
          const key = `${cx},${cz}`;
          let bucket = this.spatialGrid.get(key);
          if (!bucket) {
            bucket = [];
            this.spatialGrid.set(key, bucket);
          }
          bucket.push(i);
        }
      }
    }
  }

  buildRoadMeshes() {
    const roadGeometry = makeColoredRibbonGeometry(this.samples, this.roadWidth * 0.5, { left: 0x34383d, right: 0x34383d }, 0.015);
    const roadMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.02, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.roadMesh = new THREE.Mesh(roadGeometry, roadMaterial);
    this.roadMesh.name = 'MountainRoadSurface';
    this.roadMesh.receiveShadow = true;
    this.roadMesh.castShadow = true;
    this.roadMesh.userData = { surface: 'asphalt', type: 'mountain-road' };
    this.root.add(this.roadMesh);

    this.curbs = new THREE.Group();
    this.curbs.name = 'MountainRoadRacingCurbs';
    const curbMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.04, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    for (const side of [-1, 1]) {
      const curb = new THREE.Mesh(makeCurbGeometry(this.samples, side, 0.48), curbMaterial);
      curb.name = side < 0 ? 'MountainRoadCurbLeft' : 'MountainRoadCurbRight';
      curb.receiveShadow = true;
      curb.castShadow = true;
      curb.userData = { surface: 'curb', type: 'racing-curb' };
      this.curbs.add(curb);
    }
    this.root.add(this.curbs);

    const shoulderSamples = this.samples.map((sample) => ({ ...sample, right: sample.right.clone(), position: sample.position.clone() }));
    const shoulderGeometry = makeShoulderGeometry(shoulderSamples, this.roadWidth * 0.5, this.shoulderWidth);
    const shoulderMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -0.5, polygonOffsetUnits: -0.5 });
    this.shoulderMesh = new THREE.Mesh(shoulderGeometry, shoulderMaterial);
    this.shoulderMesh.name = 'MountainRoadShoulders';
    this.shoulderMesh.receiveShadow = true;
    this.shoulderMesh.userData = { surface: 'shoulder', type: 'mountain-road-shoulder' };
    this.root.add(this.shoulderMesh);
  }

  buildGuardrails() {
    this.guardrails = new THREE.Group();
    this.guardrails.name = 'MountainRoadGuardrails';
    const postMaterial = new THREE.MeshStandardMaterial({ color: 0x9fa6ae, roughness: 0.5, metalness: 0.75 });
    const beamMaterial = new THREE.MeshStandardMaterial({ color: 0xcbd0d5, roughness: 0.42, metalness: 0.8 });
    for (const side of [-1, 1]) {
      for (let i = 0; i < this.samples.length; i += this.guardrailSpacing) {
        const sample = this.samples[i];
        const next = this.samples[(i + this.guardrailSpacing) % this.samples.length];
        const startOffset = roadWidthForSample(sample, this.roadWidth) * 0.5 + this.shoulderWidth * 0.8;
        const endOffset = roadWidthForSample(next, this.roadWidth) * 0.5 + this.shoulderWidth * 0.8;
        const start = sample.position.clone().addScaledVector(sample.right, side * startOffset);
        const end = next.position.clone().addScaledVector(next.right, side * endOffset);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.9, 6), postMaterial);
        post.position.copy(start).addScaledVector(sample.normal, 0.45);
        post.castShadow = true;
        post.receiveShadow = true;
        this.guardrails.add(post);
        const beamStart = start.clone().addScaledVector(sample.normal, 0.78);
        const beamEnd = end.clone().addScaledVector(next.normal, 0.78);
        const beam = makeBeam(beamStart, beamEnd, 0.07, beamMaterial, 'GuardrailBeam');
        if (beam) this.guardrails.add(beam);
      }
    }
    this.root.add(this.guardrails);
  }

  buildHairpinWarnings() {
    this.hairpinWarnings = new THREE.Group();
    this.hairpinWarnings.name = 'MountainRoadHairpinWarnings';
    const material = new THREE.MeshStandardMaterial({ color: 0xffb000, emissive: 0x7a3100, emissiveIntensity: 0.7, roughness: 0.5, metalness: 0.05 });
    const geometry = new THREE.ConeGeometry(0.28, 1.05, 4);
    let lastDistance = -Infinity;
    for (const sample of this.samples) {
      if (sample.hairpinFactor < 0.48 || sample.distance - lastDistance < 8) continue;
      const side = sample.curvature >= 0 ? 1 : -1;
      const offset = roadWidthForSample(sample, this.roadWidth) * 0.5 + this.shoulderWidth * 0.7;
      const marker = new THREE.Mesh(geometry, material);
      marker.position.copy(sample.position).addScaledVector(sample.right, side * offset).addScaledVector(sample.normal, 0.58);
      marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), sample.normal);
      marker.castShadow = true;
      marker.receiveShadow = true;
      marker.userData = { roadWarning: 'hairpin', progress: sample.progress };
      this.hairpinWarnings.add(marker);
      lastDistance = sample.distance;
    }
    this.root.add(this.hairpinWarnings);
  }

  buildCheckpoints() {
    this.checkpoints = [];
    this.checkpointGroup = new THREE.Group();
    this.checkpointGroup.name = 'MountainRoadCheckpoints';
    const postMaterial = new THREE.MeshStandardMaterial({ color: 0xffc857, emissive: 0x8a4f00, emissiveIntensity: 0.55, roughness: 0.45 });
    for (let i = 0; i < this.checkpointCount; i += 1) {
      const progress = i / this.checkpointCount;
      const index = Math.floor(progress * this.samples.length) % this.samples.length;
      const sample = this.samples[index];
      const width = roadWidthForSample(sample, this.roadWidth) * 1.12;
      const checkpoint = {
        index: i,
        progress,
        position: sample.position.clone(),
        tangent: sample.tangent.clone(),
        normal: sample.normal.clone(),
        right: sample.right.clone(),
        width,
        bank: sample.bank,
        rotation: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(sample.right, sample.normal, sample.tangent.clone().negate())),
      };
      this.checkpoints.push(checkpoint);
      const left = sample.position.clone().addScaledVector(sample.right, -width).addScaledVector(sample.normal, 1.6);
      const right = sample.position.clone().addScaledVector(sample.right, width).addScaledVector(sample.normal, 1.6);
      const postLeft = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 3.2, 8), postMaterial);
      const postRight = postLeft.clone();
      postLeft.position.copy(left).addScaledVector(sample.normal, 1.6);
      postRight.position.copy(right).addScaledVector(sample.normal, 1.6);
      postLeft.castShadow = true;
      postRight.castShadow = true;
      this.checkpointGroup.add(postLeft, postRight);
      const beam = makeBeam(left.clone().addScaledVector(sample.normal, 3.1), right.clone().addScaledVector(sample.normal, 3.1), 0.1, postMaterial, 'CheckpointBeam');
      if (beam) this.checkpointGroup.add(beam);
    }
    this.checkpointGroup.visible = false;
    this.root.add(this.checkpointGroup);
  }

  interpolateSample(index, amount = 0) {
    const a = this.samples[index % this.samples.length];
    const b = this.samples[(index + 1) % this.samples.length];
    const mix = clamp(amount, 0, 1);
    return {
      position: a.position.clone().lerp(b.position, mix),
      tangent: blendDirection(a.tangent, b.tangent, mix, new THREE.Vector3(0, 0, -1)),
      right: blendDirection(a.right, b.right, mix, new THREE.Vector3(1, 0, 0)),
      normal: blendDirection(a.normal, b.normal, mix, new THREE.Vector3(0, 1, 0)),
      terrainNormal: blendDirection(a.terrainNormal, b.terrainNormal, mix, new THREE.Vector3(0, 1, 0)),
      curvature: THREE.MathUtils.lerp(a.curvature, b.curvature, mix),
      bank: THREE.MathUtils.lerp(a.bank, b.bank, mix),
      hairpinFactor: THREE.MathUtils.lerp(a.hairpinFactor ?? 0, b.hairpinFactor ?? 0, mix),
      roadWidth: THREE.MathUtils.lerp(roadWidthForSample(a, this.roadWidth), roadWidthForSample(b, this.roadWidth), mix),
      progress: a.progress + (b.progress < a.progress ? b.progress + 1 - a.progress : b.progress - a.progress) * mix,
      distance: a.distance + (b.distance < a.distance ? b.distance + this.totalLength - a.distance : b.distance - a.distance) * mix,
    };
  }

  getNearestPoint(x, z) {
    if (!this.samples.length) return null;
    let candidateIndices = null;
    if (this.spatialGrid && this.spatialCellSize) {
      const cx = Math.floor(x / this.spatialCellSize);
      const cz = Math.floor(z / this.spatialCellSize);
      const bucket = this.spatialGrid.get(`${cx},${cz}`);
      if (bucket && bucket.length > 0) {
        candidateIndices = bucket;
      } else {
        // Sample 3x3 neighborhood if right on cell boundary
        const set = new Set();
        for (let ox = -1; ox <= 1; ox += 1) {
          for (let oz = -1; oz <= 1; oz += 1) {
            const b = this.spatialGrid.get(`${cx + ox},${cz + oz}`);
            if (b) {
              for (let k = 0; k < b.length; k += 1) set.add(b[k]);
            }
          }
        }
        if (set.size > 0) candidateIndices = Array.from(set);
      }
    }

    const indices = candidateIndices;
    const count = indices ? indices.length : this.samples.length;
    let bestDistSq = Infinity;
    let bestIndex = -1;
    let bestAmount = 0;
    let bestDx = 0;
    let bestDz = 0;

    for (let c = 0; c < count; c += 1) {
      const i = indices ? indices[c] : c;
      const a = this.samples[i];
      const b = this.samples[(i + 1) % this.samples.length];
      const abX = b.position.x - a.position.x;
      const abZ = b.position.z - a.position.z;
      const lengthSq = abX * abX + abZ * abZ;
      const amount = lengthSq > 0 ? clamp(((x - a.position.x) * abX + (z - a.position.z) * abZ) / lengthSq, 0, 1) : 0;
      const px = a.position.x + abX * amount;
      const pz = a.position.z + abZ * amount;
      const dx = x - px;
      const dz = z - pz;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq < bestDistSq) {
        bestDistSq = distanceSq;
        bestIndex = i;
        bestAmount = amount;
        bestDx = dx;
        bestDz = dz;
      }
    }

    // Fallback coarse search if point is far outside regular grid cells
    if (bestIndex === -1) {
      for (let i = 0; i < this.samples.length; i += 1) {
        const a = this.samples[i];
        const b = this.samples[(i + 1) % this.samples.length];
        const abX = b.position.x - a.position.x;
        const abZ = b.position.z - a.position.z;
        const lengthSq = abX * abX + abZ * abZ;
        const amount = lengthSq > 0 ? clamp(((x - a.position.x) * abX + (z - a.position.z) * abZ) / lengthSq, 0, 1) : 0;
        const px = a.position.x + abX * amount;
        const pz = a.position.z + abZ * amount;
        const dx = x - px;
        const dz = z - pz;
        const distanceSq = dx * dx + dz * dz;
        if (distanceSq < bestDistSq) {
          bestDistSq = distanceSq;
          bestIndex = i;
          bestAmount = amount;
          bestDx = dx;
          bestDz = dz;
        }
      }
    }

    if (bestIndex === -1) return null;
    const sample = this.interpolateSample(bestIndex, bestAmount);
    const planarRight = new THREE.Vector3(sample.right.x, 0, sample.right.z);
    if (planarRight.lengthSq() > 0.0001) planarRight.normalize();
    const signedDistance = bestDx * planarRight.x + bestDz * planarRight.z;
    return { ...sample, distanceSq: bestDistSq, distance: Math.sqrt(bestDistSq), signedDistance, index: bestIndex, amount: bestAmount };
  }

  sampleSurface(x, z) {
    const nearest = this.getNearestPoint(x, z);
    if (!nearest) return null;
    const halfWidth = roadWidthForSample(nearest, this.roadWidth) * 0.5;
    const shoulderLimit = halfWidth + this.shoulderWidth;
    if (nearest.distance > shoulderLimit) return null;
    const lateral = nearest.signedDistance;
    const planeHeight = nearest.position.y - (nearest.normal.x * (x - nearest.position.x) + nearest.normal.z * (z - nearest.position.z)) / Math.max(0.2, nearest.normal.y);
    const onRoad = Math.abs(lateral) <= halfWidth;
    const profile = onRoad ? SURFACE_PROFILES.asphalt : SURFACE_PROFILES.shoulder;
    return {
      height: planeHeight,
      normal: nearest.normal.clone(),
      surface: onRoad ? 'asphalt' : 'shoulder',
      friction: profile.friction,
      rollingResistance: profile.rollingResistance,
      distanceToRoad: nearest.distance,
      signedDistance: lateral,
      progress: ((nearest.progress % 1) + 1) % 1,
      tangent: nearest.tangent.clone(),
      bank: nearest.bank,
      inside: true,
      cliff: false,
    };
  }

  getCheckpoint(index = 0) {
    if (!this.checkpoints.length) return null;
    return this.checkpoints[((index % this.checkpoints.length) + this.checkpoints.length) % this.checkpoints.length];
  }

  getSpawnTransform(checkpointIndex = 0) {
    const checkpoint = this.getCheckpoint(checkpointIndex) || {
      position: this.samples[0]?.position || new THREE.Vector3(),
      tangent: this.samples[0]?.tangent || new THREE.Vector3(0, 0, -1),
      normal: this.samples[0]?.normal || new THREE.Vector3(0, 1, 0),
      right: this.samples[0]?.right || new THREE.Vector3(1, 0, 0),
    };
    const rotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(checkpoint.right, checkpoint.normal, checkpoint.tangent.clone().negate()));
    const position = checkpoint.position.clone();
    position.y += this.spawnHeight;
    return { position, rotation, checkpoint: checkpoint.index ?? checkpointIndex };
  }

  getCheckpointData() {
    return this.checkpoints.map((checkpoint) => ({
      ...checkpoint,
      position: checkpoint.position.clone(),
      tangent: checkpoint.tangent.clone(),
      normal: checkpoint.normal.clone(),
      right: checkpoint.right.clone(),
      rotation: checkpoint.rotation.clone(),
    }));
  }

  dispose() {
    this.root.traverse((node) => {
      if (!node.isMesh) return;
      node.geometry?.dispose?.();
      if (Array.isArray(node.material)) node.material.forEach((material) => material?.dispose?.());
      else node.material?.dispose?.();
    });
    this.clearRenderables();
    this.samples = [];
    this.checkpoints = [];
    this.built = false;
  }
}

function makeShoulderGeometry(samples, halfWidth, shoulderWidth) {
  const verticesPerSample = 4;
  const positions = new Float32Array(samples.length * verticesPerSample * 3);
  const colors = new Float32Array(samples.length * verticesPerSample * 3);
  const indices = new Uint32Array(samples.length * 12);
  const baseRoadWidth = Math.max(0.001, halfWidth * 2);
  const innerColor = new THREE.Color(0x7f7560);
  const outerColor = new THREE.Color(0x5f594e);
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    const widthScale = roadWidthForSample(sample, baseRoadWidth) / baseRoadWidth;
    const sampleHalfWidth = halfWidth * widthScale;
    const leftInner = sample.position.clone().addScaledVector(sample.right, -sampleHalfWidth).addScaledVector(sample.normal, 0.022);
    const leftOuter = sample.position.clone().addScaledVector(sample.right, -(sampleHalfWidth + shoulderWidth)).addScaledVector(sample.normal, 0.012);
    const rightInner = sample.position.clone().addScaledVector(sample.right, sampleHalfWidth).addScaledVector(sample.normal, 0.022);
    const rightOuter = sample.position.clone().addScaledVector(sample.right, sampleHalfWidth + shoulderWidth).addScaledVector(sample.normal, 0.012);
    const points = [leftInner, leftOuter, rightInner, rightOuter];
    for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
      const point = points[pointIndex];
      const offset = (i * verticesPerSample + pointIndex) * 3;
      positions[offset] = point.x;
      positions[offset + 1] = point.y;
      positions[offset + 2] = point.z;
      const color = pointIndex === 0 || pointIndex === 2 ? innerColor : outerColor;
      colors[offset] = color.r;
      colors[offset + 1] = color.g;
      colors[offset + 2] = color.b;
    }
    const next = (i + 1) % samples.length;
    const current = i * verticesPerSample;
    const following = next * verticesPerSample;
    const base = i * 12;
    indices[base] = current;
    indices[base + 1] = following;
    indices[base + 2] = current + 1;
    indices[base + 3] = following;
    indices[base + 4] = following + 1;
    indices[base + 5] = current + 1;
    indices[base + 6] = current + 2;
    indices[base + 7] = current + 3;
    indices[base + 8] = following + 2;
    indices[base + 9] = following + 2;
    indices[base + 10] = current + 3;
    indices[base + 11] = following + 3;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
