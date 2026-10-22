import * as THREE from 'three';
import { Heightfield } from './Heightfield.js';
import { TerrainChunk } from './TerrainChunk.js';
import { MountainRoad } from './MountainRoad.js';
import { SurfaceClassifier } from './SurfaceClassifier.js';

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
      amplitude: options.amplitude ?? 25,
      ridgeAmplitude: options.ridgeAmplitude ?? 12,
      detailAmplitude: options.detailAmplitude ?? 3.5,
    });
    this.chunkSize = options.chunkSize ?? 64;
    this.chunkResolution = options.chunkResolution ?? 24;
    this.terrainLods = options.terrainLods || [this.chunkResolution, Math.max(4, Math.floor(this.chunkResolution / 2)), Math.max(2, Math.floor(this.chunkResolution / 4))];
    this.terrainRoot = new THREE.Group();
    this.terrainRoot.name = 'MountainTerrain';
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
    this.root.add(this.terrainRoot, this.road.root);
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
          minHeight: this.heightfield.baseHeight - this.heightfield.edgeDrop - this.heightfield.amplitude,
          maxHeight: this.heightfield.baseHeight + this.heightfield.amplitude + this.heightfield.ridgeAmplitude,
        });
        chunk.attach(this.terrainRoot, 1);
        this.chunks.push(chunk);
      }
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
    this.scene?.remove(this.root);
    this.built = false;
  }
}
