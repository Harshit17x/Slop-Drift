import * as THREE from 'three';
import { CONFIG } from '../config.js';

const UP = new THREE.Vector3(0, 1, 0);

function nameMatches(name, patterns = []) {
  const value = `${name || ''}`.toLowerCase();
  return patterns.some((pattern) => value.includes(String(pattern).toLowerCase()));
}

function surfaceFromMesh(mesh) {
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const label = `${mesh.name || ''} ${mesh.userData?.surface || ''} ${material?.name || ''}`.toLowerCase();
  if (label.includes('sand')) return 'sand';
  if (label.includes('grass')) return 'grass';
  if (label.includes('gravel')) return 'gravel';
  if (label.includes('kerb') || label.includes('curb')) return 'kerb';
  return 'asphalt';
}

export class TrackBuilder {
  constructor(root, inspection, physicsWorld) {
    this.root = root;
    this.inspection = inspection;
    this.physicsWorld = physicsWorld;
    this.physicsMeshes = [];
    this.collider = null;
    this.bounds = inspection?.bounds?.clone() || new THREE.Box3().setFromObject(root);
    this.racingLine = [];
  }

  build() {
    this.root.updateWorldMatrix(true, true);
    this.physicsMeshes = [];
    this.root.traverse((mesh) => {
      if (!mesh.isMesh || !mesh.geometry?.attributes?.position) return;
      const name = mesh.name || '';
      const excluded = nameMatches(name, CONFIG.assets.trackExclude);
      const included = CONFIG.assets.trackInclude.length === 0 || nameMatches(name, CONFIG.assets.trackInclude);
      if (!excluded && included) {
        mesh.userData.surface = mesh.userData.surface || surfaceFromMesh(mesh);
        this.physicsMeshes.push(mesh);
      }
    });
    this.bounds = new THREE.Box3().setFromObject(this.root);
    const colliderData = this.collectColliderGeometry();
    if (colliderData.vertices.length && colliderData.indices.length) {
      this.collider = this.physicsWorld.addTrimeshCollider({
        vertices: colliderData.vertices,
        indices: colliderData.indices,
        userData: { type: 'track', meshes: this.physicsMeshes.length },
      });
    }
    if (!this.collider) this.physicsWorld.addGroundFallback(this.bounds.min.y - 1);
    this.prepareRenderMaterials();
    return this;
  }

  collectColliderGeometry() {
    const vertices = [];
    const indices = [];
    for (const mesh of this.physicsMeshes) {
      const position = mesh.geometry.attributes.position;
      const index = mesh.geometry.index;
      const base = vertices.length / 3;
      const vertex = new THREE.Vector3();
      for (let i = 0; i < position.count; i += 1) {
        vertex.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
        vertices.push(vertex.x, vertex.y, vertex.z);
      }
      if (index) {
        for (let i = 0; i < index.count; i += 1) indices.push(base + index.getX(i));
      } else {
        for (let i = 0; i < position.count; i += 3) indices.push(base + i, base + i + 1, base + i + 2);
      }
    }
    return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
  }

  prepareRenderMaterials() {
    this.root.traverse((mesh) => {
      if (!mesh.isMesh) return;
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.filter(Boolean).forEach((material) => {
        material.side = THREE.DoubleSide;
        material.needsUpdate = true;
        if (material.map) {
          material.map.colorSpace = THREE.SRGBColorSpace;
          material.map.anisotropy = 8;
        }
        if ('envMapIntensity' in material) material.envMapIntensity = 1.2;
      });
    });
  }

  raycastDown(position, maxDistance = 1000) {
    return this.physicsWorld.raycast(position, { x: 0, y: -1, z: 0 }, maxDistance);
  }

  findSpawn() {
    const overridePosition = CONFIG.spawnPosition || CONFIG.race.spawnPosition;
    const overrideRotation = CONFIG.spawnRotation || CONFIG.race.spawnRotation;
    if (overridePosition) {
      const position = new THREE.Vector3(...overridePosition);
      const rotation = overrideRotation ? new THREE.Euler(...overrideRotation) : new THREE.Euler();
      return { position, rotation: new THREE.Quaternion().setFromEuler(rotation), source: 'CONFIG.spawnPosition' };
    }
    let named = null;
    this.root.traverse((node) => {
      if (!named && /start|spawn|grid|startline/i.test(node.name || '')) named = node;
    });
    if (named) {
      const box = new THREE.Box3().setFromObject(named);
      const position = box.getCenter(new THREE.Vector3());
      const hit = this.raycastDown({ x: position.x, y: this.bounds.max.y + 100, z: position.z }, 10000);
      if (hit) position.y = hit.point.y + 0.32;
      return { position, rotation: named.getWorldQuaternion(new THREE.Quaternion()), source: named.name };
    }

    const center = this.bounds.getCenter(new THREE.Vector3());
    const size = this.bounds.getSize(new THREE.Vector3());
    const candidates = [];
    for (let ix = -3; ix <= 3; ix += 1) {
      for (let iz = -3; iz <= 3; iz += 1) {
        candidates.push(new THREE.Vector3(
          center.x + (ix / 3) * size.x * 0.18,
          this.bounds.max.y + 500,
          center.z + (iz / 3) * size.z * 0.18,
        ));
      }
    }
    const hits = candidates.map((candidate) => this.raycastDown(candidate, 10000)).filter(Boolean);
    if (hits.length) {
      hits.sort((a, b) => b.point.y - a.point.y);
      const chosen = hits[Math.min(4, hits.length - 1)];
      const position = chosen.point.clone().addScaledVector(UP, 0.32);
      const spawn = { position, rotation: new THREE.Quaternion(), source: 'downward-raycast-grid' };
      console.info('[TrackBuilder] spawn selected', { source: spawn.source, position: position.toArray(), hitCount: hits.length, bounds: this.bounds.getSize(new THREE.Vector3()).toArray() });
      return spawn;
    }
    return { position: center.addScaledVector(UP, 3), rotation: new THREE.Quaternion(), source: 'bounds-fallback' };
  }

  sampleRoadPoint(x, z) {
    const hit = this.raycastDown(new THREE.Vector3(x, this.bounds.max.y + 600, z), 12000);
    return hit ? hit.point.clone() : new THREE.Vector3(x, this.bounds.min.y, z);
  }

  buildDefaultRacingLine(count = CONFIG.race.checkpoints) {
    const center = this.bounds.getCenter(new THREE.Vector3());
    const size = this.bounds.getSize(new THREE.Vector3());
    const radiusX = Math.max(20, size.x * 0.24);
    const radiusZ = Math.max(20, size.z * 0.24);
    const points = [];
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2;
      const x = center.x + Math.cos(angle) * radiusX;
      const z = center.z + Math.sin(angle) * radiusZ;
      points.push(this.sampleRoadPoint(x, z));
    }
    this.racingLine = points;
    return points;
  }

  getSurfaceMultiplier(userData = {}) {
    const label = `${userData.surface || ''} ${userData.material || ''}`.toLowerCase();
    const key = Object.keys(CONFIG.tires.surfaceFriction).find((candidate) => label.includes(candidate));
    return CONFIG.tires.surfaceFriction[key || 'default'];
  }
}
