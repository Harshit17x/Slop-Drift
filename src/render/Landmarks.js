import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const WINDOW_GLOW = new THREE.Color(0xffb35a);

/**
 * The buildings of an authored map (props.glb + the placements in map.json, via World.placements).
 * One InstancedMesh per prototype primitive, so the whole town is ~60 draw calls. Each building is
 * seated on the carved terrain: low enough that its stone plinth (5 m deep in the model) meets the
 * downhill side, sunk into the uphill side.
 */
export class Landmarks {
  constructor({ world, quality }) {
    this.world = world;
    this.quality = quality;
    this.group = new THREE.Group();
    this.group.name = 'landmarks';
    this.meshes = [];
    this.glassMaterials = [];
    this.night = false;
    this.ready = false;
  }

  /** Load the prototypes and build the instances. Resolves once they are in the scene graph. */
  async load(url) {
    const gltf = await new GLTFLoader().loadAsync(url);
    const byProp = new Map();
    for (const placement of this.world.placements) {
      if (!byProp.has(placement.prop)) byProp.set(placement.prop, []);
      byProp.get(placement.prop).push(placement);
    }
    const shadows = Boolean(this.quality?.shadowMapSize);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);

    for (const node of gltf.scene.children) {
      const placements = byProp.get(node.name);
      if (!placements?.length) continue;
      const transforms = placements.map((placement) => {
        position.set(placement.x, this.seatHeight(placement), placement.z);
        rotation.setFromAxisAngle(up, placement.yaw);
        const s = placement.scale || 1;
        scale.set(s, s, s);
        return matrix.compose(position, rotation, scale).clone();
      });
      node.updateMatrixWorld(true);
      node.traverse((child) => {
        if (!child.isMesh) return;
        // Bake the child's transform within the prototype into its geometry.
        const geometry = child.geometry.clone();
        geometry.applyMatrix4(child.matrixWorld);
        const material = child.material;
        if (material.name === 'MSR_glass') this.glassMaterials.push(material);
        const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
        transforms.forEach((transform, i) => mesh.setMatrixAt(i, transform));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.castShadow = shadows;
        mesh.receiveShadow = shadows;
        mesh.name = `${node.name}:${material.name}`;
        this.group.add(mesh);
        this.meshes.push(mesh);
      });
    }
    this.setNight(this.night);
    this.ready = true;
    return this;
  }

  /** Lowest terrain under the footprint, lifted a little toward the highest so the plinth is not buried. */
  seatHeight(placement) {
    const grid = this.world.grid;
    const c = Math.cos(placement.yaw);
    const s = Math.sin(placement.yaw);
    const hw = placement.w / 2;
    const hd = placement.d / 2;
    let low = Infinity;
    let high = -Infinity;
    for (const [lx, ly] of [[0, 0], [-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) {
      // Blender local (x, y) turned by yaw, then game z = -Blender y.
      const bx = lx * c - ly * s;
      const by = lx * s + ly * c;
      const h = grid.heightAt(placement.x + bx, placement.z - by);
      low = Math.min(low, h);
      high = Math.max(high, h);
    }
    return low + Math.min(1.5, (high - low) * 0.25) - 0.15;
  }

  /** Lit windows after dark. */
  setNight(isNight) {
    this.night = isNight;
    for (const material of this.glassMaterials) {
      material.emissive?.copy(isNight ? WINDOW_GLOW : material.color).multiplyScalar(isNight ? 1 : 0);
      material.emissiveIntensity = isNight ? 1.4 : 0;
    }
  }

  dispose() {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.meshes = [];
    this.group.parent?.remove(this.group);
  }
}
