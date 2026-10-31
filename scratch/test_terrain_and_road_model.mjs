import * as THREE from 'three';
import { MountainWorld } from '../src/procedural/MountainWorld.js';
import { TerrainChunk } from '../src/procedural/TerrainChunk.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    failed += 1;
    throw new Error(message);
  } else {
    console.log(`✅ PASS: ${message}`);
    passed += 1;
  }
}

console.log('--- STARTING TERRAIN & ROAD 3D MODEL VERIFICATION ---');

const scene = new THREE.Scene();
const world = new MountainWorld({ scene, autoBuild: true });
const road = world.road;

// 1. Terrain does not poke through road surface
{
  let maxAbove = -Infinity;
  let sampleCount = 0;
  for (let i = 0; i < road.samples.length; i += 1) {
    const s = road.samples[i];
    const halfW = s.halfWidth;
    for (let o = -halfW; o <= halfW; o += halfW * 0.25) {
      const p = s.position.clone().addScaledVector(s.right, o);
      const terrainH = world.sampleTerrain(p.x, p.z).height;
      const diff = terrainH - p.y;
      if (diff > maxAbove) maxAbove = diff;
      sampleCount += 1;
    }
  }
  assert(maxAbove < 0, `Terrain never pokes through road surface across ${sampleCount} sample points (max diff = ${maxAbove.toFixed(4)}m)`);
}

// 2. Road does not float unsupported in thin air
{
  let maxDrop = -Infinity;
  for (let i = 0; i < road.samples.length; i += 1) {
    const s = road.samples[i];
    const terrainH = world.sampleTerrain(s.position.x, s.position.z).height;
    const drop = s.position.y - terrainH;
    if (drop > maxDrop) maxDrop = drop;
  }
  assert(maxDrop <= 0.65, `Road sits firmly on solid foundation bed across entire circuit (max drop = ${maxDrop.toFixed(4)}m)`);
}

// 3. Chunk boundaries have seamless vertex normals
{
  const chunkA = world.chunks.find((c) => c.origin.x === 0 && c.origin.z === 0);
  const chunkB = world.chunks.find((c) => c.origin.x === 64 && c.origin.z === 0);
  assert(chunkA != null && chunkB != null, 'Adjacent terrain chunks located');

  const geoA = chunkA.getMesh(0).geometry;
  const geoB = chunkB.getMesh(0).geometry;
  const normA = geoA.attributes.normal.array;
  const normB = geoB.attributes.normal.array;
  const res = chunkA.resolution;

  let maxNormalDiff = 0;
  for (let iz = 0; iz <= res; iz += 1) {
    const idxA = (iz * (res + 1) + res) * 3;
    const idxB = (iz * (res + 1) + 0) * 3;
    const diff = Math.max(
      Math.abs(normA[idxA] - normB[idxB]),
      Math.abs(normA[idxA + 1] - normB[idxB + 1]),
      Math.abs(normA[idxA + 2] - normB[idxB + 2]),
    );
    if (diff > maxNormalDiff) maxNormalDiff = diff;
  }
  assert(maxNormalDiff < 0.0001, `Boundary vertex normals are completely seamless between chunks (max diff = ${maxNormalDiff.toFixed(6)})`);
}

// 4. Geometry contains UV coordinates
{
  const chunkMesh = world.chunks[0].getMesh(0);
  assert(chunkMesh.geometry.attributes.uv != null, 'Terrain chunk has UV coordinates attribute');
  assert(road.roadMesh.geometry.attributes.uv != null, 'Road surface has UV coordinates attribute');
  assert(road.shoulderMesh.geometry.attributes.uv != null, 'Road shoulder has UV coordinates attribute');
}

// 5. Road markings
{
  assert(road.centerlineMesh != null, 'MountainRoadCenterline mesh exists');
  assert(road.centerlineMesh.name === 'MountainRoadCenterline', 'Centerline has correct name');
  assert(road.edgeLinesMesh != null, 'MountainRoadEdgeLines mesh exists');
  assert(road.edgeLinesMesh.name === 'MountainRoadEdgeLines', 'Edge lines have correct name');
}

// 6. Road grade vertical profile smoothness
{
  let maxSlopeChange = 0;
  for (let i = 1; i < road.samples.length - 1; i += 1) {
    const prev = road.samples[i - 1].position;
    const curr = road.samples[i].position;
    const next = road.samples[i + 1].position;
    const d1 = curr.distanceTo(prev);
    const d2 = next.distanceTo(curr);
    const s1 = (curr.y - prev.y) / d1;
    const s2 = (next.y - curr.y) / d2;
    const diff = Math.abs(s2 - s1);
    if (diff > maxSlopeChange) maxSlopeChange = diff;
  }
  assert(maxSlopeChange < 0.12, `Road vertical slope change is smooth without spikes (max jerk = ${maxSlopeChange.toFixed(4)})`);
}

console.log(`\n========================================`);
console.log(`ALL TERRAIN & ROAD TESTS PASSED: ${passed} passed, ${failed} failed`);
console.log(`========================================\n`);
