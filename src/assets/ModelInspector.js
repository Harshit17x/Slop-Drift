import * as THREE from 'three';
import { CONFIG } from '../config.js';

const WHEEL_KEYS = ['FL', 'FR', 'RL', 'RR'];
const WHEEL_SCORE = /(wheel|tyre|tire|rim|susp|hub)/i;
const EXTERIOR_HINT = /(body|bumper|hood|chassis|door|wing|mirror|light|window|glass|wheel|tyre|tire|rim|susp|disc|brake)/i;

function cleanName(name = '') {
  return name.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
}

function findByCandidates(root, candidates = []) {
  const normalized = candidates.map(cleanName);
  let found = null;
  root.traverse((node) => {
    if (found || !node.name) return;
    const value = cleanName(node.name);
    if (normalized.some((candidate) => value === candidate || value.includes(candidate))) found = node;
  });
  return found;
}

function worldBounds(node) {
  node.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(node);
}

function setMaterialQuality(root, { doubleSided = false } = {}) {
  root.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = true;
    node.receiveShadow = true;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.filter(Boolean).forEach((material) => {
      material.needsUpdate = true;
      if (material.map) {
        material.map.colorSpace = THREE.SRGBColorSpace;
        material.map.anisotropy = Math.min(8, material.map.anisotropy || 8);
      }
      if (material.emissiveMap) material.emissiveMap.colorSpace = THREE.SRGBColorSpace;
      if (doubleSided) material.side = THREE.DoubleSide;
      if ('envMapIntensity' in material) material.envMapIntensity = 1.15;
    });
  });
}

function reparentWheelAtCenter(root, wheelNode) {
  if (!wheelNode || !wheelNode.parent) return wheelNode;
  const bounds = worldBounds(wheelNode);
  const center = bounds.getCenter(new THREE.Vector3());
  const pivot = new THREE.Group();
  pivot.name = `${wheelNode.name || 'wheel'}_runtime_pivot`;
  root.attach(pivot);
  pivot.position.copy(center);
  pivot.attach(wheelNode);
  wheelNode.userData.runtimeWheelPivotName = pivot.name;
  wheelNode.userData.wheelCenter = center.toArray();
  return pivot;
}

function findFallbackWheelClusters(root) {
  const candidates = [];
  root.traverse((node) => {
    if (!node.isMesh && node.children.length === 0) return;
    if (!WHEEL_SCORE.test(node.name || '')) return;
    const bounds = worldBounds(node);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    if (size.y > 1.2 || size.x > 1.2 || size.z > 1.2) return;
    candidates.push({ node, center, size });
  });
  const unique = [];
  candidates.sort((a, b) => a.size.x * a.size.y * a.size.z - b.size.x * b.size.y * b.size.z);
  candidates.forEach((candidate) => {
    if (unique.some((item) => item.center.distanceTo(candidate.center) < 0.08)) return;
    unique.push(candidate);
  });
  if (unique.length >= 4) {
    const sortedX = [...unique].sort((a, b) => a.center.x - b.center.x);
    const left = sortedX.slice(0, Math.ceil(sortedX.length / 2));
    const right = sortedX.slice(Math.ceil(sortedX.length / 2));
    const frontZ = (items) => items.reduce((sum, item) => sum + item.center.z, 0) / Math.max(1, items.length);
    const medianZ = frontZ(unique);
    return {
      FL: left.sort((a, b) => a.center.z - b.center.z)[0]?.node,
      FR: right.sort((a, b) => a.center.z - b.center.z)[0]?.node,
      RL: left.sort((a, b) => b.center.z - a.center.z)[0]?.node,
      RR: right.sort((a, b) => b.center.z - a.center.z)[0]?.node,
      medianZ,
    };
  }
  return {};
}

export function inspectModel(root, { type = 'car' } = {}) {
  const names = [];
  root.traverse((node) => names.push(node.name || '(unnamed)'));
  console.groupCollapsed(`[ModelInspector] ${type} asset`);
  console.info('nodes:', names.length);
  console.table(names.map((name, index) => ({ index, name })));
  console.groupEnd();

  root.updateWorldMatrix(true, true);
  const initialBounds = new THREE.Box3().setFromObject(root);
  const initialSize = initialBounds.getSize(new THREE.Vector3());
  const initialCenter = initialBounds.getCenter(new THREE.Vector3());

  if (type === 'car') {
    const longestAxis = Math.max(initialSize.x, initialSize.y, initialSize.z);
    const scale = longestAxis > 0 ? CONFIG.car.targetLength / longestAxis : 1;
    root.scale.multiplyScalar(scale);
    root.updateWorldMatrix(true, true);

    const normalizedBounds = new THREE.Box3().setFromObject(root);
    const normalizedCenter = normalizedBounds.getCenter(new THREE.Vector3());
    root.position.x -= normalizedCenter.x;
    root.position.z -= normalizedCenter.z;
    root.position.y -= normalizedBounds.min.y;

    let forwardAxis = 'z';
    const configuredAxis = CONFIG.assets.carForwardAxis;
    if (configuredAxis === 'x') {
      root.rotation.y += Math.PI / 2;
      forwardAxis = 'x';
    } else if (configuredAxis === '-x') {
      root.rotation.y -= Math.PI / 2;
      forwardAxis = '-x';
    } else if (configuredAxis === '-z') {
      root.rotation.y += Math.PI;
      forwardAxis = '-z';
    } else if (configuredAxis === 'auto' && initialSize.x > initialSize.z) {
      root.rotation.y += Math.PI / 2;
      forwardAxis = 'x';
    } else if (configuredAxis !== 'auto' && configuredAxis !== 'z') {
      forwardAxis = configuredAxis;
    }
    if (CONFIG.assets.flipCar180) root.rotation.y += Math.PI;
    root.updateWorldMatrix(true, true);

    const wheels = {};
    for (const key of WHEEL_KEYS) {
      wheels[key] = findByCandidates(root, CONFIG.assets.manualWheelNodes[key]);
    }
    const fallback = findFallbackWheelClusters(root);
    for (const key of WHEEL_KEYS) wheels[key] ||= fallback[key] || null;

    const wheelPivots = {};
    WHEEL_KEYS.forEach((key) => {
      wheelPivots[key] = wheels[key] ? reparentWheelAtCenter(root, wheels[key]) : null;
    });

    const steeringWheel = findByCandidates(root, CONFIG.assets.steeringWheelNodes);
    const cockpitNode = findByCandidates(root, CONFIG.assets.cockpitNodes);
    const bodyParts = [];
    root.traverse((node) => {
      if (node.isMesh && EXTERIOR_HINT.test(node.name || '')) bodyParts.push(node);
    });

    setMaterialQuality(root);
    const result = {
      root,
      bounds: new THREE.Box3().setFromObject(root),
      size: new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()),
      initialCenter,
      initialScale: scale,
      forwardAxis,
      wheels,
      wheelPivots,
      steeringWheel,
      cockpitNode,
      bodyParts,
      names,
    };
    root.userData.inspection = {
      type: 'car',
      forwardAxis,
      initialScale: scale,
      wheelNames: Object.fromEntries(WHEEL_KEYS.map((key) => [key, wheels[key]?.name || 'missing'])),
    };
    console.info('[ModelInspector] car normalized', {
      scale,
      forwardAxis,
      size: result.size.toArray(),
      wheels: Object.fromEntries(WHEEL_KEYS.map((key) => [key, wheels[key]?.name || 'missing'])),
      cockpit: cockpitNode?.name || 'estimated',
      steeringWheel: steeringWheel?.name || 'procedural fallback',
    });
    return result;
  }

  setMaterialQuality(root, { doubleSided: true });
  const trackBounds = new THREE.Box3().setFromObject(root);
  const trackSize = trackBounds.getSize(new THREE.Vector3());
  const targetDimension = Math.max(trackSize.x, trackSize.z);
  const autoScale = targetDimension > 250 ? 1 : targetDimension > 0 ? 2500 / targetDimension : 1;
  if (autoScale !== 1) root.scale.multiplyScalar(autoScale);
  root.updateWorldMatrix(true, true);
  const finalBounds = new THREE.Box3().setFromObject(root);
  const result = {
    root,
    bounds: finalBounds,
    size: finalBounds.getSize(new THREE.Vector3()),
    autoScale,
    names,
  };
  root.userData.inspection = { type: 'track', autoScale, nodeCount: names.length };
  console.info('[ModelInspector] track inspected', { autoScale, size: result.size.toArray(), nodes: names.length });
  return result;
}

export function estimateCockpitCamera(root, inspection) {
  const named = inspection?.cockpitNode;
  if (named) {
    const box = worldBounds(named);
    const center = box.getCenter(new THREE.Vector3());
    return center;
  }
  const bounds = new THREE.Box3().setFromObject(root);
  return new THREE.Vector3(bounds.min.x + 0.45, bounds.min.y + (bounds.max.y - bounds.min.y) * 0.72, bounds.min.z + (bounds.max.z - bounds.min.z) * 0.28);
}
