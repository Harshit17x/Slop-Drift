import * as THREE from 'three';
import { Heightfield } from './Heightfield.js';
import { TerrainChunk } from './TerrainChunk.js';
import { MountainRoad } from './MountainRoad.js';
import { SurfaceClassifier } from './SurfaceClassifier.js';
import { SeededNoise } from './SeededNoise.js';

export class MountainWorld {
  constructor(options = {}) {
    this.options = options;
    this.seed = options.seed ?? 1337;
    this.scene = options.scene || null;
    this.root = new THREE.Group();
    this.root.name = options.name || 'MountainWorld';
    this.heightfield = options.heightfield || new Heightfield({
      seed: this.seed,
      sizeX: options.sizeX ?? 320,
      sizeZ: options.sizeZ ?? 260,
      baseHeight: options.baseHeight ?? 0,
      amplitude: options.amplitude ?? 16,
      ridgeAmplitude: options.ridgeAmplitude ?? 12,
      detailAmplitude: options.detailAmplitude ?? 3.5,
      basinDepth: options.basinDepth ?? 10,
      basinRadius: options.basinRadius ?? 0.58,
      rimHeight: options.rimHeight ?? 27,
      rimRadius: options.rimRadius ?? 0.7,
      rimWidth: options.rimWidth ?? 0.2,
      edgeDrop: options.edgeDrop ?? 18,
      ridgeFrequency: options.ridgeFrequency ?? 0.0065,
    });
    this.chunkSize = options.chunkSize ?? 64;
    this.chunkResolution = options.chunkResolution ?? 24;
    this.terrainLods = options.terrainLods || [this.chunkResolution, Math.max(4, Math.floor(this.chunkResolution / 2)), Math.max(2, Math.floor(this.chunkResolution / 4))];
    this.terrainRoot = new THREE.Group();
    this.terrainRoot.name = 'MountainTerrain';
    this.ridgeBackdrop = null;
    this.road = options.road || new MountainRoad({
      seed: this.seed,
      heightfield: this.heightfield,
      roadWidth: options.roadWidth,
      shoulderWidth: options.shoulderWidth,
      segmentCount: options.roadSegments,
      checkpointCount: options.checkpointCount,
      autoBuild: false,
    });
    this.surfaceClassifier = options.surfaceClassifier || new SurfaceClassifier({ heightfield: this.heightfield, road: this.road, options: options.surface || {} });
    this.chunks = [];
    this.checkpoints = [];
    this.built = false;
    if (options.autoBuild !== false) this.build();
    if (this.scene && this.root.parent !== this.scene) this.scene.add(this.root);
  }

  build() {
    if (this.built) return this;
    this.road.build();
    this.buildTerrain();
    this.buildRidgeBackdrop();
    this.root.add(this.terrainRoot, this.ridgeBackdrop, this.road.root);
    this.checkpoints = this.road.getCheckpointData();
    this.built = true;
    return this;
  }

  buildTerrain() {
    const bounds = this.heightfield.getBounds();
    const minX = Math.floor(bounds.minX / this.chunkSize) * this.chunkSize;
    const maxX = Math.ceil(bounds.maxX / this.chunkSize) * this.chunkSize;
    const minZ = Math.floor(bounds.minZ / this.chunkSize) * this.chunkSize;
    const maxZ = Math.ceil(bounds.maxZ / this.chunkSize) * this.chunkSize;
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide });
    for (let x = minX; x < maxX; x += this.chunkSize) {
      for (let z = minZ; z < maxZ; z += this.chunkSize) {
        const chunk = new TerrainChunk({
          heightfield: this.heightfield,
          origin: new THREE.Vector3(x, 0, z),
          size: this.chunkSize,
          resolution: this.chunkResolution,
          lodResolutions: this.terrainLods,
          material,
          minHeight: this.heightfield.baseHeight - this.heightfield.edgeDrop - this.heightfield.amplitude - this.heightfield.basinDepth,
          maxHeight: this.heightfield.baseHeight + this.heightfield.amplitude + this.heightfield.ridgeAmplitude + this.heightfield.detailAmplitude + this.heightfield.rimHeight,
        });
        chunk.attach(this.terrainRoot, 1);
        this.chunks.push(chunk);
      }
    }
  }

  buildRidgeBackdrop() {
    this.ridgeBackdrop = new THREE.Group();
    this.ridgeBackdrop.name = 'MountainRidgeBackdrop';
    const noise = new SeededNoise(this.seed + 701);
    const ridgeMaterial = new THREE.MeshStandardMaterial({ color: 0x41563a, roughness: 1, metalness: 0, flatShading: true });
    const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x5b5a4d, roughness: 0.98, metalness: 0, flatShading: true });
    let placed = 0;
    for (let index = 0; index < 64 && placed < 16; index += 1) {
      const angle = (index / 16) * Math.PI * 2 + noise.sample2D(index * 0.31, 4.4) * 0.12;
      const radius = 142 + noise.sample2D(index * 0.67, 6.2) * 16;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const nearest = this.road.getNearestPoint(x, z);
      if (nearest && nearest.distance < 32) continue;
      const terrain = this.heightfield.sample(x, z);
      const height = 28 + noise.sample2D(index * 0.91, 8.1) * 24;
      const width = 14 + noise.sample2D(index * 0.47, 2.7) * 10;
      const mountain = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 7, 2), index % 3 === 0 ? rockMaterial : ridgeMaterial);
      mountain.position.set(x, terrain.height + height * 0.42, z);
      mountain.scale.set(width, height, width * (0.82 + noise.sample2D(index * 0.52, 9.2) * 0.38));
      mountain.rotation.set(noise.sample2D(index * 0.8, 10.4) * 0.18, angle + Math.PI * 0.5, noise.sample2D(index * 0.41, 11.7) * 0.18);
      mountain.castShadow = true;
      mountain.receiveShadow = true;
      mountain.userData = { type: 'mountain-ridge-backdrop' };
      this.ridgeBackdrop.add(mountain);
      placed += 1;
    }
  }

  sampleTerrain(x, z) {
    return this.heightfield.sample(x, z);
  }

  sampleSurface(x, z) {
    return this.surfaceClassifier.classify(x, z);
  }

  classifySurface(position) {
    return this.sampleSurface(position.x, position.z);
  }

  getHeightAt(x, z) {
    return this.sampleSurface(x, z).height;
  }

  getCheckpoint(index = 0) {
    return this.road.getCheckpoint(index);
  }

  getSpawnTransform(checkpointIndex = 0) {
    return this.road.getSpawnTransform(checkpointIndex);
  }

  getRespawnTransform(checkpointIndex = 0) {
    return this.getSpawnTransform(checkpointIndex);
  }

  update(cameraPosition) {
    this.chunks.forEach((chunk) => chunk.updateLOD(cameraPosition));
    return this;
  }

  dispose() {
    this.chunks.forEach((chunk) => chunk.dispose());
    this.chunks = [];
    this.road.dispose();
    this.ridgeBackdrop = null;
    this.scene?.remove(this.root);
    this.built = false;
  }
}
