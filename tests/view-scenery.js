// Test page for src/render/Atmosphere.js and src/render/Scenery.js.
// Extra URL parameters on top of viewer-common's: tod=dawn|day|sunset|night, quality=Low|Medium|High|Ultra.
import * as THREE from 'three';
import { createViewer } from './viewer-common.js';
import { QUALITY_PRESETS, SURFACE } from '../src/config.js';
import { Atmosphere } from '../src/render/Atmosphere.js';
import { Scenery } from '../src/render/Scenery.js';

const params = new URLSearchParams(location.search);
const info = document.querySelector('#info');
const viewer = await createViewer({ onProgress: (fraction, label) => { info.textContent = `${Math.round(fraction * 100)}% ${label}`; } });
const { scene, renderer, world, camera } = viewer;

// Stand-in ground until the real terrain mesh exists: the height grid at 8 m, coloured by height and slope.
function buildGround() {
  const step = 8;
  const half = world.grid.half;
  const count = Math.floor((half * 2) / step) + 1;
  const positions = new Float32Array(count * count * 3);
  const colors = new Float32Array(count * count * 3);
  const ground = {};
  const color = new THREE.Color();
  for (let iz = 0; iz < count; iz += 1) {
    for (let ix = 0; ix < count; ix += 1) {
      const x = ix * step - half;
      const z = iz * step - half;
      world.sampleGround(x, z, ground);
      const i = (iz * count + ix) * 3;
      positions[i] = x;
      positions[i + 1] = ground.y;
      positions[i + 2] = z;
      if (ground.surface === SURFACE.ASPHALT || ground.surface === SURFACE.GRAVEL) color.setHex(0x2c2f33);
      else if (ground.surface === SURFACE.WATER) color.setHex(0x2f6f93);
      else if (ground.surface === SURFACE.SNOW) color.setHex(0xe9eef2);
      else if (ground.surface === SURFACE.ROCK) color.setHex(0x6d6a63);
      else if (ground.surface === SURFACE.GRASS) color.setHex(0x4c6b34);
      else color.setHex(0x6f6248);
      colors[i] = color.r;
      colors[i + 1] = color.g;
      colors[i + 2] = color.b;
    }
  }
  const indices = new Uint32Array((count - 1) * (count - 1) * 6);
  let k = 0;
  for (let iz = 0; iz < count - 1; iz += 1) {
    for (let ix = 0; ix < count - 1; ix += 1) {
      const a = iz * count + ix;
      indices[k++] = a; indices[k++] = a + count; indices[k++] = a + 1;
      indices[k++] = a + 1; indices[k++] = a + count; indices[k++] = a + count + 1;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}
const groundMesh = buildGround();
scene.add(groundMesh);

let quality = QUALITY_PRESETS[params.get('quality')] || QUALITY_PRESETS.High;
const atmosphere = new Atmosphere({ scene, renderer, world, quality, timeOfDay: params.get('tod') || 'day' });
const scenery = new Scenery({ world, quality });
scene.add(scenery.group);

const focus = new THREE.Vector3();
const forward = new THREE.Vector3();
viewer.onUpdate((dt) => {
  // Pretend the car is a few metres ahead of the camera, on the ground.
  camera.getWorldDirection(forward);
  focus.copy(camera.position).addScaledVector(forward, 14);
  focus.y = world.heightAt(focus.x, focus.z);
  atmosphere.update(dt, camera, focus);
  scenery.update(camera.position);
});

let sceneryCalls = 0;
let sceneryTriangles = 0;
function measureScenery() {
  // Difference between a frame with and without the scenery group.
  renderer.info.autoReset = false;
  renderer.info.reset();
  renderer.render(scene, camera);
  const withCalls = renderer.info.render.calls;
  const withTriangles = renderer.info.render.triangles;
  scenery.group.visible = false;
  renderer.info.reset();
  renderer.render(scene, camera);
  sceneryCalls = withCalls - renderer.info.render.calls;
  sceneryTriangles = withTriangles - renderer.info.render.triangles;
  scenery.group.visible = true;
  renderer.info.autoReset = true;
  return { calls: sceneryCalls, triangles: sceneryTriangles, totalCalls: withCalls, totalTriangles: withTriangles };
}

setInterval(() => {
  const m = measureScenery();
  const s = scenery.stats;
  info.textContent = `${atmosphere.timeOfDay}  fps ${viewer.stats.fps}  scenery ${m.calls} calls ${Math.round(m.triangles / 1000)}k tris  `
    + `trees ${s.trees} rocks ${s.rocks} obstacles ${s.obstacles} meshes ${s.meshes} placed in ${s.placementMs.toFixed(0)} ms`;
}, 1000);

document.querySelectorAll('[data-tod]').forEach((button) => button.addEventListener('click', () => atmosphere.setTimeOfDay(button.dataset.tod)));
document.querySelectorAll('[data-quality]').forEach((button) => button.addEventListener('click', () => {
  quality = QUALITY_PRESETS[button.dataset.quality];
  atmosphere.setQuality(quality);
  scenery.setQuality(quality);
}));

Object.assign(globalThis.__viewer, { atmosphere, scenery, measureScenery, groundMesh });
