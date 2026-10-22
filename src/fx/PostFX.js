import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { CONFIG } from '../config.js';

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.enabled = CONFIG.graphics.postFX;
    this.composer = null;
    this.fxaa = null;
    this.bloom = null;
    this.setup();
  }

  setup() {
    try {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.22, 0.7, 0.88);
      this.composer.addPass(this.bloom);
      this.fxaa = new ShaderPass(FXAAShader);
      this.composer.addPass(this.fxaa);
      this.resize(window.innerWidth, window.innerHeight);
    } catch (error) {
      console.warn('[PostFX] disabled:', error);
      this.enabled = false;
    }
  }

  setEnabled(value) { this.enabled = Boolean(value && this.composer); }

  resize(width, height) {
    if (!this.composer) return;
    this.composer.setSize(width, height);
    if (this.fxaa) this.fxaa.material.uniforms.resolution.value.set(1 / (width * CONFIG.graphics.resolutionScale), 1 / (height * CONFIG.graphics.resolutionScale));
  }

  render() {
    if (this.enabled && this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
