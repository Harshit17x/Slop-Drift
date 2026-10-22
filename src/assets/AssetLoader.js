import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { CONFIG } from '../config.js';
import { inspectModel } from './ModelInspector.js';

export class AssetLoader {
  constructor({ onProgress = () => {} } = {}) {
    this.onProgress = onProgress;
    this.manager = undefined;
    this.loader = new GLTFLoader(this.manager);
    this.draco = new DRACOLoader();
    this.draco.setDecoderPath(CONFIG.assets.dracoPath);
    this.loader.setDRACOLoader(this.draco);
    this.loader.setMeshoptDecoder(MeshoptDecoder);
  }

  load(url, type) {
    return new Promise((resolve, reject) => {
      this.loader.load(url, (gltf) => {
        const root = gltf.scene || gltf.scenes?.[0];
        if (!root) return reject(new Error(`GLB ${url} did not contain a scene`));
        const inspection = inspectModel(root, { type });
        resolve({ gltf, root, inspection });
      }, (event) => {
        const ratio = event.total ? event.loaded / event.total : 0;
        this.onProgress({ url, type, ratio, loaded: event.loaded, total: event.total });
      }, reject);
    });
  }

  async loadAll() {
    const [car, track] = await Promise.all([
      this.load(CONFIG.assets.car, 'car'),
      this.load(CONFIG.assets.track, 'track'),
    ]);
    return { car, track };
  }

  dispose() {
    this.draco.dispose();
  }
}
