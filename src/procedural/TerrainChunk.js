import * as THREE from 'three';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function terrainColor(sample, minHeight, maxHeight) {
  const normalizedHeight = clamp((sample.height - minHeight) / Math.max(0.001, maxHeight - minHeight), 0, 1);
  const slope = clamp(sample.slopeAngle / (Math.PI * 0.5), 0, 1);
  const color = new THREE.Color();
  if (slope > 0.58 || normalizedHeight > 0.84) {
    color.setRGB(0.24 + normalizedHeight * 0.14, 0.25 + normalizedHeight * 0.13, 0.2 + normalizedHeight * 0.1);
  } else if (slope > 0.38) {
    color.setRGB(0.2 + normalizedHeight * 0.1, 0.31 + normalizedHeight * 0.12, 0.14 + normalizedHeight * 0.07);
  } else if (normalizedHeight > 0.55) {
    color.setRGB(0.28 + normalizedHeight * 0.1, 0.42 + normalizedHeight * 0.13, 0.18 + normalizedHeight * 0.08);
  } else {
    color.setRGB(0.08 + normalizedHeight * 0.07, 0.22 + normalizedHeight * 0.13, 0.1 + normalizedHeight * 0.06);
  }
  return color;
}

export class TerrainChunk {
  constructor({
    heightfield,
    origin = new THREE.Vector3(),
    size = 64,
    resolution = 24,
    lodResolutions = null,
    material = null,
    minHeight = -30,
    maxHeight = 45,
  } = {}) {
    if (!heightfield) throw new Error('TerrainChunk requires a heightfield');
    this.heightfield = heightfield;
    this.origin = origin.clone ? origin.clone() : new THREE.Vector3(origin.x || 0, origin.y || 0, origin.z || 0);
    this.size = size;
    this.resolution = resolution;
    this.lodResolutions = lodResolutions || [resolution, Math.max(4, Math.floor(resolution / 2)), Math.max(2, Math.floor(resolution / 4))];
    this.material = material || new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: false });
    this.minHeight = minHeight;
    this.maxHeight = maxHeight;
    this.meshes = new Map();
    this.currentLod = 0;
    this.mesh = null;
    this.center = new THREE.Vector3(this.origin.x + size * 0.5, 0, this.origin.z + size * 0.5);
    this.bounds = new THREE.Box3(
      new THREE.Vector3(this.origin.x, minHeight, this.origin.z),
      new THREE.Vector3(this.origin.x + size, maxHeight, this.origin.z + size),
    );
  }

  buildGeometry(resolution) {
    const vertexCount = (resolution + 1) * (resolution + 1);
    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);
    const indices = new Uint32Array(resolution * resolution * 6);
    let vertexIndex = 0;
    for (let iz = 0; iz <= resolution; iz += 1) {
      const z = this.origin.z + (iz / resolution) * this.size;
      for (let ix = 0; ix <= resolution; ix += 1) {
        const x = this.origin.x + (ix / resolution) * this.size;
        const terrain = this.heightfield.sample(x, z);
        positions[vertexIndex * 3] = x;
        positions[vertexIndex * 3 + 1] = terrain.height;
        positions[vertexIndex * 3 + 2] = z;
        const color = terrainColor(terrain, this.minHeight, this.maxHeight);
        colors[vertexIndex * 3] = color.r;
        colors[vertexIndex * 3 + 1] = color.g;
        colors[vertexIndex * 3 + 2] = color.b;
        vertexIndex += 1;
      }
    }
    let index = 0;
    for (let iz = 0; iz < resolution; iz += 1) {
      for (let ix = 0; ix < resolution; ix += 1) {
        const a = iz * (resolution + 1) + ix;
        const b = a + 1;
        const c = a + resolution + 1;
        const d = c + 1;
        indices[index] = a;
        indices[index + 1] = c;
        indices[index + 2] = b;
        indices[index + 3] = b;
        indices[index + 4] = c;
        indices[index + 5] = d;
        index += 6;
      }
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

  getMesh(lod = this.currentLod) {
    const lodIndex = clamp(Math.round(lod), 0, this.lodResolutions.length - 1);
    if (!this.meshes.has(lodIndex)) {
      const geometry = this.buildGeometry(this.lodResolutions[lodIndex]);
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.name = `TerrainChunk_${this.origin.x}_${this.origin.z}_LOD${lodIndex}`;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.userData = { type: 'terrain-chunk', lod: lodIndex, origin: this.origin.clone(), size: this.size };
      this.meshes.set(lodIndex, mesh);
    }
    return this.meshes.get(lodIndex);
  }

  setLOD(lod) {
    const lodIndex = clamp(Math.round(lod), 0, this.lodResolutions.length - 1);
    if (lodIndex === this.currentLod && this.mesh) return this.mesh;
    const parent = this.mesh?.parent || null;
    const next = this.getMesh(lodIndex);
    if (this.mesh?.parent) this.mesh.parent.remove(this.mesh);
    this.mesh = next;
    if (parent && this.mesh.parent !== parent) parent.add(this.mesh);
    this.currentLod = lodIndex;
    return this.mesh;
  }

  attach(parent, lod = this.currentLod) {
    this.setLOD(lod);
    if (this.mesh.parent !== parent) parent.add(this.mesh);
    return this.mesh;
  }

  updateLOD(cameraPosition, distances = [100, 190]) {
    if (!cameraPosition) return this.currentLod;
    const dx = cameraPosition.x - this.center.x;
    const dz = cameraPosition.z - this.center.z;
    const distance = Math.hypot(dx, dz);
    const lod = distance < distances[0] ? 0 : distance < distances[1] ? 1 : 2;
    this.setLOD(lod);
    return this.currentLod;
  }

  dispose() {
    this.meshes.forEach((mesh) => mesh.geometry.dispose());
    this.meshes.clear();
    this.mesh = null;
  }
}
