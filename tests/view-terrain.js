// Terrain render test page. See viewer-common.js for camera URL parameters and keys.
// Extra parameters: sun=<elevation degrees>, az=<azimuth degrees>, quality=Low|Medium|High|Ultra, roads=0 to hide the debug ribbon.
import * as THREE from 'three';
import { createViewer } from './viewer-common.js';
import { TerrainView } from '../src/render/TerrainView.js';
import { WaterView } from '../src/render/WaterView.js';
import { QUALITY_PRESETS } from '../src/config.js';

const info = document.getElementById('info');
const params = new URLSearchParams(location.search);
const viewer = await createViewer({ onProgress: (fraction, label) => { info.textContent = `${label} ${Math.round(fraction * 100)}%`; } });
const { scene, world, renderer, camera } = viewer;

const elevation = (Number(params.get('sun') ?? 42) * Math.PI) / 180;
const azimuth = (Number(params.get('az') ?? 215) * Math.PI) / 180;
const sunDirection = new THREE.Vector3(Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), -Math.cos(elevation) * Math.cos(azimuth));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
sun.position.copy(sunDirection).multiplyScalar(500);
scene.add(sun, new THREE.HemisphereLight(0xbcd7f5, 0x4a4a3c, 0.85));
scene.fog = new THREE.FogExp2(0x9cc4e4, 0.00042);

const quality = QUALITY_PRESETS[params.get('quality')] || QUALITY_PRESETS.High;
const started = performance.now();
const terrain = new TerrainView({ world, quality });
terrain.setSun(sunDirection, sun.color, null);
const water = new WaterView({ world });
water.setSun(sunDirection, sun.color, scene.fog.color);
const setupMs = performance.now() - started;
scene.add(terrain.group, water.group);

// Stand-in for the road mesh (another module draws the real one): a dark ribbon at the road surface.
if (params.get('roads') !== '0') {
  const frame = {};
  for (const road of world.roads) {
    const positions = [];
    const indices = [];
    const count = Math.floor(road.length / 2);
    for (let i = 0; i <= count; i += 1) {
      road.frameAt(Math.min(road.length - 0.01, i * 2) % (road.closed ? road.length : Infinity), frame);
      const half = frame.halfWidth + 1.4;
      positions.push(frame.x - frame.rx * half, frame.y - frame.ry * half + 0.03, frame.z - frame.rz * half);
      positions.push(frame.x + frame.rx * half, frame.y + frame.ry * half + 0.03, frame.z + frame.rz * half);
      if (i < count) indices.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    scene.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.9, side: THREE.DoubleSide })));
  }
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(world.plaza.radius, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.9 }));
  plaza.position.set(world.plaza.x, world.plaza.y + 0.03, world.plaza.z);
  scene.add(plaza);
}

let worstFrame = 0;
let worstUpdate = 0;
viewer.onUpdate((dt) => {
  const t0 = performance.now();
  terrain.update(camera.position);
  worstUpdate = Math.max(worstUpdate, performance.now() - t0);
  water.update(dt);
  worstFrame = Math.max(worstFrame, dt * 1000);
});
setInterval(() => {
  const render = renderer.info.render;
  info.textContent = `fps ${viewer.stats.fps}  calls ${render.calls}  tris ${render.triangles.toLocaleString()}\n`
    + `terrain tris ${terrain.stats.triangles.toLocaleString()}  chunks/lod ${terrain.stats.chunks.join(' ')}\n`
    + `bake ${terrain.stats.bakeMs.toFixed(0)} ms  setup ${setupMs.toFixed(0)} ms  worst update ${worstUpdate.toFixed(2)} ms  worst frame ${worstFrame.toFixed(0)} ms\n`
    + `pos ${viewer.pose.x.toFixed(0)}, ${viewer.pose.z.toFixed(0)}  h ${viewer.pose.h.toFixed(0)}  yaw ${viewer.pose.yaw.toFixed(0)}  pitch ${viewer.pose.pitch.toFixed(0)}`;
  worstFrame = 0;
}, 500);
globalThis.__terrain = { terrain, water, setupMs, sun, sunDirection };
