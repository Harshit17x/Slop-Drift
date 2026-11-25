import * as THREE from 'three';
import { createRandom } from '../../world/noise.js';

// Procedural canvas textures for the road surfaces and signs. All tile seamlessly.

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Tileable smooth noise in [0, 1]: a wrapped lattice of random values, cosine interpolated, a few octaves. */
function tileableNoise(size, random, baseCells = 4, octaves = 4) {
  const field = new Float32Array(size * size);
  let amplitude = 1;
  let total = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    const cells = baseCells << octave;
    const lattice = new Float32Array(cells * cells);
    for (let i = 0; i < lattice.length; i += 1) lattice[i] = random();
    for (let y = 0; y < size; y += 1) {
      const gy = (y / size) * cells;
      const y0 = Math.floor(gy);
      const fy = gy - y0;
      const sy = fy * fy * (3 - 2 * fy);
      const rowA = (y0 % cells) * cells;
      const rowB = ((y0 + 1) % cells) * cells;
      for (let x = 0; x < size; x += 1) {
        const gx = (x / size) * cells;
        const x0 = Math.floor(gx);
        const fx = gx - x0;
        const sx = fx * fx * (3 - 2 * fx);
        const a = lattice[rowA + (x0 % cells)];
        const b = lattice[rowA + ((x0 + 1) % cells)];
        const c = lattice[rowB + (x0 % cells)];
        const d = lattice[rowB + ((x0 + 1) % cells)];
        field[y * size + x] += (a + (b - a) * sx + (c + (d - c) * sx - (a + (b - a) * sx)) * sy) * amplitude;
      }
    }
    total += amplitude;
    amplitude *= 0.5;
  }
  for (let i = 0; i < field.length; i += 1) field[i] /= total;
  return field;
}

function finishTexture(canvas, anisotropy, repeat = true) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
  }
  texture.anisotropy = anisotropy;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

/**
 * Asphalt: mid-grey binder with fine aggregate speckle over soft low-frequency blotches.
 * The blotches are what the material samples again at a much larger scale to hide the tiling.
 */
export function createAsphaltTexture(anisotropy = 8, size = 512) {
  const random = createRandom(9107);
  const canvas = makeCanvas(size, size);
  const context = canvas.getContext('2d');
  const image = context.createImageData(size, size);
  const blotch = tileableNoise(size, random, 3, 5);
  const hairline = tileableNoise(size, random, 6, 4);
  for (let i = 0; i < size * size; i += 1) {
    const speckle = random();
    let value = 86 + (blotch[i] - 0.5) * 48 + (speckle - 0.5) * 32;
    if (speckle > 0.962) value += 48; // pale stone chips
    else if (speckle < 0.032) value -= 28; // open pores
    const vein = Math.abs(hairline[i] - 0.5);
    if (vein < 0.0085) value -= 24 * (1 - vein / 0.0085); // subtle sealed hairline frost tar seam
    image.data[i * 4] = value;
    image.data[i * 4 + 1] = value + 1;
    image.data[i * 4 + 2] = value + 4;
    image.data[i * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return finishTexture(canvas, anisotropy);
}

/**
 * Tileable roughness & surface-relief texture for asphalt: crushed stone grit bump + worn sealant lines.
 */
export function createAsphaltReliefTexture(anisotropy = 8, size = 512) {
  const random = createRandom(6283);
  const canvas = makeCanvas(size, size);
  const context = canvas.getContext('2d');
  const image = context.createImageData(size, size);
  const grit = tileableNoise(size, random, 5, 5);
  const crack = tileableNoise(size, random, 6, 4);
  for (let i = 0; i < size * size; i += 1) {
    const pebble = random();
    let value = 178 + (grit[i] - 0.5) * 58 + (pebble - 0.5) * 54;
    if (pebble > 0.95) value += 36;
    const vein = Math.abs(crack[i] - 0.5);
    if (vein < 0.011) value = 68 + (vein / 0.011) * 45; // smooth shiny tar seal inside crack
    value = Math.max(48, Math.min(248, value));
    image.data[i * 4] = value;
    image.data[i * 4 + 1] = value;
    image.data[i * 4 + 2] = value;
    image.data[i * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  const texture = finishTexture(canvas, anisotropy);
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

/** Neutral gravel/soil grain around mid-white; hue comes from vertex colours. */
export function createGrainTexture(anisotropy = 8, size = 256) {
  const random = createRandom(4421);
  const canvas = makeCanvas(size, size);
  const context = canvas.getContext('2d');
  const image = context.createImageData(size, size);
  const blotch = tileableNoise(size, random, 4, 4);
  for (let i = 0; i < size * size; i += 1) {
    const speckle = random();
    let value = 196 + (blotch[i] - 0.5) * 70 + (speckle - 0.5) * 64;
    if (speckle > 0.94) value += 34;
    else if (speckle < 0.07) value -= 50;
    value = Math.max(60, Math.min(255, value));
    image.data[i * 4] = value;
    image.data[i * 4 + 1] = value;
    image.data[i * 4 + 2] = value;
    image.data[i * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return finishTexture(canvas, anisotropy);
}

/** Black board with yellow chevrons pointing toward +u. Texel (0, 0) is plain dark for the board's back and legs. */
export function createChevronTexture(anisotropy = 8) {
  const canvas = makeCanvas(256, 128);
  const context = canvas.getContext('2d');
  context.fillStyle = '#17181a';
  context.fillRect(0, 0, 256, 128);
  context.fillStyle = '#ffc61a';
  for (let k = 0; k < 3; k += 1) {
    const x = 26 + k * 74;
    context.beginPath();
    context.moveTo(x, 14);
    context.lineTo(x + 34, 14);
    context.lineTo(x + 70, 64);
    context.lineTo(x + 34, 114);
    context.lineTo(x, 114);
    context.lineTo(x + 36, 64);
    context.closePath();
    context.fill();
  }
  context.fillStyle = '#17181a';
  context.fillRect(0, 0, 8, 8);
  return finishTexture(canvas, anisotropy, false);
}

/** Banner or sign with one or two lines of text. */
export function createLabelTexture(lines, { width = 512, height = 128, background = '#11161c', color = '#f4f7f3', accent = '#c7ff52' } = {}) {
  const canvas = makeCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
  context.fillStyle = accent;
  context.fillRect(0, 0, width, Math.round(height * 0.07));
  context.fillRect(0, height - Math.round(height * 0.07), width, Math.round(height * 0.07));
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const list = Array.isArray(lines) ? lines : [lines];
  list.forEach((text, index) => {
    const big = index === 0;
    const sizePx = Math.round(height * (list.length === 1 ? 0.56 : big ? 0.44 : 0.24));
    context.font = `900 ${sizePx}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
    context.fillStyle = big ? color : accent;
    const y = list.length === 1 ? height * 0.52 : big ? height * 0.4 : height * 0.76;
    context.fillText(text, width / 2, y, width * 0.92);
  });
  return finishTexture(canvas, 4, false);
}

/** Start/finish line: two rows of black and white squares. */
export function createCheckerTexture() {
  const canvas = makeCanvas(256, 32);
  const context = canvas.getContext('2d');
  for (let x = 0; x < 16; x += 1) {
    for (let y = 0; y < 2; y += 1) {
      context.fillStyle = (x + y) % 2 === 0 ? '#f2f2ee' : '#16171a';
      context.fillRect(x * 16, y * 16, 16, 16);
    }
  }
  return finishTexture(canvas, 8, false);
}
