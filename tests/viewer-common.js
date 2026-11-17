// Shared scaffold for the render test pages: builds the world, a renderer and a fly camera.
// URL parameters: x, z (camera position), h (height above ground), yaw, pitch (degrees),
// road + s (place the camera on a road at distance s instead: road=0 loop, road=1 spur).
// Keys: WASD move, Q/E down/up, arrows look, Shift faster.
import * as THREE from 'three';
import { World } from '../src/world/World.js';

export async function createViewer({ onProgress = () => {} } = {}) {
  const params = new URLSearchParams(location.search);
  const number = (name, fallback) => (params.has(name) ? Number(params.get(name)) : fallback);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.style.margin = '0';
  document.body.style.overflow = 'hidden';
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9cc4e4);
  const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 9000);

  const world = new World();
  await world.build(onProgress);

  const pose = { x: number('x', 0), z: number('z', 900), h: number('h', 60), yaw: number('yaw', 0), pitch: number('pitch', -12) };
  if (params.has('road')) {
    const road = world.roads[number('road', 0)];
    const frame = road.frameAt(number('s', 0), {});
    pose.x = frame.x;
    pose.z = frame.z;
    pose.yaw = (Math.atan2(frame.tx, -frame.tz) * 180) / Math.PI + number('yaw', 0);
    pose.h = number('h', 3);
  }
  const keys = new Set();
  addEventListener('keydown', (event) => keys.add(event.code));
  addEventListener('keyup', (event) => keys.delete(event.code));

  const resize = () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize);
  resize();

  const updates = [];
  let last = performance.now();
  let frames = 0;
  let fpsClock = 0;
  const stats = { fps: 0 };
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const speed = (keys.has('ShiftLeft') ? 220 : 45) * dt;
    const yaw = (pose.yaw * Math.PI) / 180;
    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    pose.x += (Math.sin(yaw) * forward + Math.cos(yaw) * strafe) * speed;
    pose.z += (-Math.cos(yaw) * forward + Math.sin(yaw) * strafe) * speed;
    pose.h += ((keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0)) * speed;
    pose.yaw += ((keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0)) * 70 * dt;
    pose.pitch += ((keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0)) * 50 * dt;
    camera.position.set(pose.x, world.heightAt(pose.x, pose.z) + pose.h, pose.z);
    camera.rotation.set((pose.pitch * Math.PI) / 180, (-pose.yaw * Math.PI) / 180, 0, 'YXZ');
    for (const update of updates) update(dt, camera);
    renderer.render(scene, camera);
    frames += 1;
    fpsClock += dt;
    if (fpsClock >= 1) {
      stats.fps = Math.round(frames / fpsClock);
      frames = 0;
      fpsClock = 0;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  const viewer = { renderer, scene, camera, world, pose, stats, onUpdate: (fn) => updates.push(fn) };
  globalThis.__viewer = viewer;
  return viewer;
}
