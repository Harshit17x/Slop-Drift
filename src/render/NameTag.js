import * as THREE from 'three';

const WIDTH = 512;
const HEIGHT = 128;

/**
 * A billboard label that floats above a car: name on the first line, optional detail (level, gap)
 * on the second. It keeps a readable on-screen size at any distance and fades out far away.
 *
 *   const tag = new NameTag({ text: 'Harsh', detail: 'LV 7', accent: '#c7ff52' });
 *   carGroup.add(tag.sprite);          // positioned 2.2 m above the car origin
 *   tag.update(camera);                // every frame
 */
export class NameTag {
  constructor({ text = '', detail = '', accent = '#c7ff52', height = 2.2 } = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.material = new THREE.SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false, depthTest: true, fog: false });
    this.sprite = new THREE.Sprite(this.material);
    this.sprite.position.y = height;
    this.sprite.renderOrder = 10;
    this.sprite.center.set(0.5, 0);
    this.accent = accent;
    this.text = null;
    this.detail = null;
    this.set(text, detail);
  }

  set(text, detail = '') {
    if (text === this.text && detail === this.detail) return;
    this.text = text;
    this.detail = detail;
    const context = this.canvas.getContext('2d');
    context.clearRect(0, 0, WIDTH, HEIGHT);
    context.font = '800 54px system-ui, -apple-system, Segoe UI, sans-serif';
    const nameWidth = context.measureText(text).width;
    context.font = '700 30px system-ui, -apple-system, Segoe UI, sans-serif';
    const detailWidth = detail ? context.measureText(detail).width : 0;
    const boxWidth = Math.min(WIDTH - 8, Math.max(nameWidth, detailWidth) + 56);
    const x = (WIDTH - boxWidth) / 2;
    context.fillStyle = 'rgba(8, 14, 18, 0.72)';
    context.beginPath();
    context.roundRect(x, 6, boxWidth, HEIGHT - 12, 22);
    context.fill();
    context.fillStyle = this.accent;
    context.fillRect(x + 18, HEIGHT - 20, boxWidth - 36, 4);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#f4f7f3';
    context.font = '800 54px system-ui, -apple-system, Segoe UI, sans-serif';
    context.fillText(text, WIDTH / 2, detail ? 44 : 60, WIDTH - 40);
    if (detail) {
      context.fillStyle = this.accent;
      context.font = '700 30px system-ui, -apple-system, Segoe UI, sans-serif';
      context.fillText(detail, WIDTH / 2, 88, WIDTH - 40);
    }
    this.texture.needsUpdate = true;
  }

  /** Keep roughly constant screen size between 8 m and 120 m, fade out beyond 260 m. */
  update(camera) {
    const world = this.sprite.getWorldPosition(scratch);
    const distance = world.distanceTo(camera.position);
    const scale = THREE.MathUtils.clamp(distance, 8, 120) * 0.055;
    this.sprite.scale.set(scale * 4, scale, 1);
    this.material.opacity = 1 - THREE.MathUtils.smoothstep(distance, 180, 260);
    this.sprite.visible = this.material.opacity > 0.01;
  }

  dispose() {
    this.sprite.parent?.remove(this.sprite);
    this.texture.dispose();
    this.material.dispose();
  }
}

const scratch = new THREE.Vector3();
