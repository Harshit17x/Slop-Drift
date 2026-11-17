// Stand-alone look at RoadView over a stand-in ground. See viewer-common.js for camera parameters.
// Extra URL parameters: route=loop|climb|descent (gates), night=1, top=1 (look straight down from h metres).
import * as THREE from 'three';
import { createViewer } from './viewer-common.js';
import { RoadView } from '../src/render/RoadView.js';

const info = document.getElementById('info');
const params = new URLSearchParams(location.search);
const viewer = await createViewer({ onProgress: (fraction, label) => { info.textContent = `${Math.round(fraction * 100)}% ${label}`; } });
const { scene, world, renderer, camera } = viewer;

const night = params.get('night') === '1';
scene.background = new THREE.Color(night ? 0x0a1220 : 0x9cc4e4);
scene.add(new THREE.HemisphereLight(night ? 0x334466 : 0xdcebff, 0x3a3f2e, night ? 0.35 : 0.9));
const sun = new THREE.DirectionalLight(night ? 0x8fa8ff : 0xfff1d6, night ? 0.5 : 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -70;
sun.shadow.camera.right = 70;
sun.shadow.camera.top = 70;
sun.shadow.camera.bottom = -70;
sun.shadow.camera.far = 500;
sun.shadow.bias = -0.0004;
scene.add(sun, sun.target);

// Stand-in terrain: a fine patch (grid resolution) that follows the camera over a coarse, lowered backdrop.
const groundMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
function groundMesh(centreX, centreZ, span, step, sink) {
  const side = Math.round(span / step) + 1;
  const positions = new Float32Array(side * side * 3);
  const colors = new Float32Array(side * side * 3);
  const normal = {};
  for (let iz = 0; iz < side; iz += 1) {
    for (let ix = 0; ix < side; ix += 1) {
      const x = centreX - span / 2 + ix * step;
      const z = centreZ - span / 2 + iz * step;
      const n = (iz * side + ix) * 3;
      const y = world.grid.heightAt(x, z);
      positions[n] = x;
      positions[n + 1] = y - sink;
      positions[n + 2] = z;
      world.grid.normalAt(x, z, normal);
      const rock = normal.ny < 0.8 ? 1 : 0;
      const snow = y > 410 ? 1 : 0;
      colors[n] = snow ? 0.9 : rock ? 0.42 : 0.3;
      colors[n + 1] = snow ? 0.92 : rock ? 0.4 : 0.42;
      colors[n + 2] = snow ? 0.95 : rock ? 0.37 : 0.22;
    }
  }
  const indices = [];
  for (let iz = 0; iz < side - 1; iz += 1) {
    for (let ix = 0; ix < side - 1; ix += 1) {
      const a = iz * side + ix;
      indices.push(a, a + side, a + 1, a + 1, a + side, a + side + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, groundMaterial);
  mesh.receiveShadow = true;
  return mesh;
}
scene.add(groundMesh(0, 0, world.grid.half * 2, 16, 5));
let patch = null;
let patchX = Infinity;
let patchZ = Infinity;
function refreshPatch() {
  if (Math.hypot(camera.position.x - patchX, camera.position.z - patchZ) < 90) return;
  if (patch) {
    scene.remove(patch);
    patch.geometry.dispose();
  }
  patchX = Math.round(camera.position.x / 2) * 2;
  patchZ = Math.round(camera.position.z / 2) * 2;
  patch = groundMesh(patchX, patchZ, 440, 2, 0);
  scene.add(patch);
}

const roads = new RoadView({ world, anisotropy: renderer.capabilities.getMaxAnisotropy() });
scene.add(roads.group);
if (params.get('route')) roads.setRoute(world.routes[params.get('route')]);
roads.setNight(night);
globalThis.__roads = roads;

viewer.onUpdate(() => {
  if (params.get('top') === '1') camera.rotation.set(-Math.PI / 2, (-viewer.pose.yaw * Math.PI) / 180, 0, 'YXZ');
  refreshPatch();
  sun.target.position.copy(camera.position);
  sun.position.copy(camera.position).add(new THREE.Vector3(-90, 150, 60));
  const render = renderer.info.render;
  info.textContent = `${viewer.stats.fps} fps  calls ${render.calls}  tris ${render.triangles}\n`
    + `roads: ${roads.stats.drawCalls} draw calls, ${Math.round(roads.stats.triangles)} tris, built in ${roads.stats.buildMs.toFixed(0)} ms\n`
    + `x ${viewer.pose.x.toFixed(0)} z ${viewer.pose.z.toFixed(0)} h ${viewer.pose.h.toFixed(0)} yaw ${viewer.pose.yaw.toFixed(0)} pitch ${viewer.pose.pitch.toFixed(0)}`;
});
