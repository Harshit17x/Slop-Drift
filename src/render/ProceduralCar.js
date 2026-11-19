import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const WHEEL_KEYS = ['frontLeft', 'frontRight', 'rearLeft', 'rearRight'];
const TWO_PI = Math.PI * 2;

// Side silhouettes in chassis space as [z, y] pairs, front of the car toward -z.
// The chassis group sits `chassisOffsetY` above the car origin (ground level at rest).
const BODY_TOP = [
  [-2.12, 0.16], [-2.2, 0.36], [-2.19, 0.53], [-2.05, 0.65], [-1.55, 0.73], [-1.0, 0.79], [-0.8, 0.82],
  [0.95, 0.86], [1.55, 0.88], [1.97, 0.84], [2.1, 0.64], [2.13, 0.36], [2.05, 0.16],
];
const GLASSHOUSE = [[-0.8, 0.8], [-0.13, 1.27], [0.95, 1.29], [1.63, 0.95], [1.5, 0.8]];
const ROOF = [[-0.16, 1.255], [0.96, 1.275], [0.99, 1.315], [-0.1, 1.31]];
const SILL_Y = 0.16;
const ARCH_Y = 0.21;
const ARCH_RADIUS = 0.43;

/** Extrude a side profile across the car (x) and centre it. Profile is [z, y] pairs. */
function extrudeProfile(points, width, { bevel = 0.05, curveSegments = 10 } = {}) {
  const shape = new THREE.Shape();
  // Shape x = -z so the outline is counter-clockwise when viewed from +x.
  points.forEach(([z, y], index) => (index === 0 ? shape.moveTo(-z, y) : shape.lineTo(-z, y)));
  shape.closePath();
  const depth = Math.max(0.01, width - bevel * 2);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelSegments: 3,
    curveSegments,
  });
  // Extrusion runs along +z; turn it so it runs along x, then centre it.
  geometry.rotateY(Math.PI / 2);
  geometry.translate(-depth / 2, 0, 0);
  geometry.computeVertexNormals();
  return geometry;
}

/** Pull vertices inward as they rise (tumblehome), so the glasshouse and shoulders are not slab-sided. */
function taper(geometry, fromY, toY, amount) {
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i += 1) {
    const t = Math.min(1, Math.max(0, (position.getY(i) - fromY) / (toY - fromY)));
    position.setX(i, position.getX(i) * (1 - amount * t));
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

/** Body outline: the top line from BODY_TOP, then the underside with both wheel arches cut in. */
function bodyOutline(wheelbase) {
  const points = BODY_TOP.map((point) => point.slice());
  const half = wheelbase / 2;
  const arch = (centre) => {
    const start = Math.asin((SILL_Y - ARCH_Y) / ARCH_RADIUS);
    for (let i = 0; i <= 14; i += 1) {
      const angle = start + ((Math.PI - 2 * start) * i) / 14;
      points.push([centre + Math.cos(angle) * ARCH_RADIUS, ARCH_Y + Math.sin(angle) * ARCH_RADIUS]);
    }
  };
  arch(half);
  arch(-half);
  return points;
}

/** A box spanning from `a` to `b` (both Vector3), for pillars and struts. */
function strut(a, b, thickness, depth = thickness) {
  const direction = new THREE.Vector3().subVectors(b, a);
  const geometry = new THREE.BoxGeometry(thickness, direction.length(), depth);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  geometry.applyQuaternion(quaternion);
  geometry.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return geometry;
}

/** A round bar spanning from `a` to `b`. */
function barBetween(a, b, radius = 0.022, segments = 10) {
  const direction = new THREE.Vector3().subVectors(b, a);
  const geometry = new THREE.CylinderGeometry(radius, radius, direction.length(), segments);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  geometry.applyQuaternion(quaternion);
  geometry.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return geometry;
}

/** Dark inner shell for a wheel arch: a half cylinder whose front faces point at the wheel. */
function archLinerGeometry(radius, length, segments = 14) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * Math.PI;
    const y = Math.sin(angle) * radius;
    const z = Math.cos(angle) * radius;
    for (const x of [-length / 2, length / 2]) {
      positions.push(x, y, z);
      normals.push(0, -Math.sin(angle), -Math.cos(angle));
      uvs.push(x > 0 ? 1 : 0, i / segments);
    }
  }
  for (let i = 0; i < segments; i += 1) {
    const a0 = i * 2;
    const b0 = a0 + 1;
    const a1 = a0 + 2;
    const b1 = a0 + 3;
    indices.push(a0, b1, b0, a0, a1, b1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

/** Merge finished geometry into a single mesh, disposing every temporary. */
function mergeToMesh(geometries, material, parent, name = '') {
  const parts = geometries.map((geometry) => (geometry.index ? geometry.toNonIndexed() : geometry.clone()));
  const merged = mergeGeometries(parts, false);
  parts.forEach((geometry) => geometry.dispose());
  geometries.forEach((geometry) => geometry.dispose());
  if (!merged) return null;
  const mesh = new THREE.Mesh(merged, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function canvasTexture(canvas) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function numberTexture(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 320;
  const context = canvas.getContext('2d');
  context.fillStyle = '#f2f4f2';
  context.beginPath();
  context.roundRect(8, 8, 496, 304, 28);
  context.fill();
  context.strokeStyle = '#121518';
  context.lineWidth = 6;
  context.beginPath();
  context.roundRect(20, 20, 472, 280, 20);
  context.stroke();
  // Accent wedge and top sponsor strip.
  context.fillStyle = '#c7ff52';
  context.beginPath();
  context.moveTo(20, 20);
  context.lineTo(92, 20);
  context.lineTo(20, 126);
  context.closePath();
  context.fill();
  context.fillStyle = '#121518';
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.font = '800 30px system-ui, sans-serif';
  context.fillText('SLOP DRIFT RALLY', 104, 52);
  context.fillStyle = '#5b666e';
  context.font = '700 19px system-ui, sans-serif';
  context.fillText('MUDLINE  /  GRAVEL CO.', 104, 82);
  // Door number.
  context.textAlign = 'center';
  context.fillStyle = '#121518';
  context.font = 'italic 900 164px system-ui, sans-serif';
  context.fillText(text, 276, 198);
  context.fillStyle = '#121518';
  context.fillRect(20, 260, 472, 40);
  context.fillStyle = '#f2f4f2';
  context.font = '700 21px system-ui, sans-serif';
  context.fillText('SLOP DRIFT RALLY TEAM', 256, 281);
  return canvasTexture(canvas);
}

function plateTexture(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  context.fillStyle = '#e9eef2';
  context.beginPath();
  context.roundRect(4, 4, 248, 88, 10);
  context.fill();
  context.strokeStyle = '#1a1f24';
  context.lineWidth = 4;
  context.stroke();
  context.fillStyle = '#1f4f8f';
  context.fillRect(6, 6, 44, 84);
  context.fillStyle = '#e9eef2';
  context.font = '700 22px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('SD', 28, 50);
  context.fillStyle = '#121518';
  context.font = 'italic 800 54px system-ui, sans-serif';
  context.textAlign = 'left';
  context.fillText('SLOP', 62, 50);
  context.textAlign = 'right';
  context.fillStyle = '#5b666e';
  context.font = '800 44px system-ui, sans-serif';
  context.fillText(text, 238, 50);
  return canvasTexture(canvas);
}

function dialTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  context.fillStyle = '#0a0e11';
  context.beginPath();
  context.arc(128, 128, 124, 0, TWO_PI);
  context.fill();
  context.strokeStyle = '#2a3238';
  context.lineWidth = 4;
  context.beginPath();
  context.arc(128, 128, 120, 0, TWO_PI);
  context.stroke();
  const start = Math.PI * 0.75;
  const end = Math.PI * 2.25;
  for (let i = 0; i <= 40; i += 1) {
    const angle = start + ((end - start) * i) / 40;
    const major = i % 5 === 0;
    const inner = major ? 92 : 103;
    context.strokeStyle = i >= 32 ? '#ff4b3a' : major ? '#e8f0f2' : '#7d8d93';
    context.lineWidth = major ? 4 : 2;
    context.beginPath();
    context.moveTo(128 + Math.cos(angle) * inner, 128 + Math.sin(angle) * inner);
    context.lineTo(128 + Math.cos(angle) * 112, 128 + Math.sin(angle) * 112);
    context.stroke();
  }
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#aab8bc';
  context.font = '700 15px system-ui, sans-serif';
  for (let i = 0; i <= 8; i += 1) {
    const angle = start + ((end - start) * i) / 8;
    context.fillText(String(i), 128 + Math.cos(angle) * 76, 128 + Math.sin(angle) * 76);
  }
  context.fillStyle = '#c7ff52';
  context.font = '700 12px system-ui, sans-serif';
  context.fillText('SLOP', 128, 148);
  context.fillStyle = '#5c6c72';
  context.font = '600 10px system-ui, sans-serif';
  context.fillText('RALLY', 128, 164);
  return canvasTexture(canvas);
}

function screenTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  context.fillStyle = '#091014';
  context.fillRect(0, 0, 512, 256);
  context.strokeStyle = '#c7ff52';
  context.lineWidth = 4;
  context.strokeRect(10, 10, 492, 236);
  context.fillStyle = '#c7ff52';
  context.font = '800 26px system-ui, sans-serif';
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.fillText('SLOP DRIFT RALLY', 30, 40);
  context.fillStyle = '#e8f0f2';
  context.font = '900 76px system-ui, sans-serif';
  context.fillText('SS 04', 30, 118);
  context.fillStyle = '#8fa4aa';
  context.font = '700 22px system-ui, sans-serif';
  context.fillText('GRAVEL  /  2.4 KM', 30, 178);
  context.fillStyle = '#ff4b3a';
  context.font = '800 20px system-ui, sans-serif';
  context.fillText('NEXT 120 m', 30, 218);
  context.fillStyle = '#c7ff52';
  context.fillRect(386, 32, 96, 96);
  context.fillStyle = '#091014';
  context.font = 'italic 900 64px system-ui, sans-serif';
  context.textAlign = 'center';
  context.fillText('27', 434, 84);
  context.fillStyle = '#8fa4aa';
  context.font = '700 18px system-ui, sans-serif';
  context.fillText('CAR 27', 434, 156);
  return canvasTexture(canvas);
}

function carbonTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  context.fillStyle = '#14161a';
  context.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 8) {
    for (let x = 0; x < 128; x += 8) {
      const odd = ((x + y) / 8) % 2 === 0;
      context.fillStyle = odd ? '#20242a' : '#171a1e';
      context.fillRect(x, y, 8, 8);
      context.strokeStyle = odd ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.3)';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, y + 8);
      context.lineTo(x + 8, y);
      context.stroke();
    }
  }
  const texture = canvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(5, 5);
  return texture;
}

/**
 * A rally hatchback built from code: extruded body and glasshouse with cut wheel arches, detailed
 * aero and lighting, spoked wheels with brake discs, livery and a full rally cockpit for the
 * interior camera. Static parts are merged per material; wheels, steering wheel and gauges stay
 * separate to animate.
 */
export class ProceduralCar extends THREE.Group {
  constructor(options = {}) {
    super();
    this.name = options.name || 'ProceduralCar';
    this.color = new THREE.Color(options.color ?? 0xd62828);
    this.scale.setScalar(options.scale ?? 1);
    this.dimensions = {
      length: 4.33,
      width: options.width ?? 1.8,
      wheelbase: options.wheelbase ?? 2.55,
      track: options.track ?? 1.56,
      wheelRadius: options.wheelRadius ?? 0.34,
      wheelWidth: options.wheelWidth ?? 0.235,
    };
    this.chassisOffsetY = options.chassisOffsetY ?? 0.13;
    this.wheelCentreY = options.wheelCentreY ?? 0.34;
    this.wheels = new Map();
    this.wheelPivots = new Map();
    this.wheelSpin = new Map();
    this.steering = 0;
    this.materials = [];
    this.textures = [];
    this.paintMeshes = [];
    this.dynamicRoots = new Set();
    this.needles = [];
    this.number = String(options.number ?? '27');
    this.withInterior = options.interior !== false;
    this.build();
  }

  material(parameters) {
    const material = new THREE.MeshStandardMaterial(parameters);
    this.materials.push(material);
    return material;
  }

  texture(canvas) {
    const texture = canvasTexture(canvas);
    this.textures.push(texture);
    return texture;
  }

  part(geometry, material, parent = this.chassis) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  box(w, h, d, x, y, z, material, rotation = null, parent = this.chassis) {
    const geometry = new THREE.BoxGeometry(w, h, d);
    if (rotation) geometry.rotateX(rotation.x || 0).rotateY(rotation.y || 0).rotateZ(rotation.z || 0);
    geometry.translate(x, y, z);
    return this.part(geometry, material, parent);
  }

  rounded(w, h, d, radius, x, y, z, material, rotation = null, parent = this.chassis) {
    const geometry = new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, Math.min(w, h, d) * 0.45));
    if (rotation) geometry.rotateX(rotation.x || 0).rotateY(rotation.y || 0).rotateZ(rotation.z || 0);
    geometry.translate(x, y, z);
    return this.part(geometry, material, parent);
  }

  build() {
    if (this.built) return this;
    this.built = true;

    const paint = new THREE.MeshPhysicalMaterial({
      color: this.color,
      metalness: 0.25,
      roughness: 0.42,
      clearcoat: 0.38,
      clearcoatRoughness: 0.36,
      envMapIntensity: 0.55,
    });
    this.materials.push(paint);
    this.bodyMaterial = paint;
    if (this.withInterior) this.enableCabinCutout(paint);

    const trim = this.material({ color: 0x16191d, metalness: 0.25, roughness: 0.6 });
    const satin = this.material({ color: 0x363c43, metalness: 0.55, roughness: 0.4 });
    const glass = this.withInterior
      ? this.material({
          color: 0x13212a,
          metalness: 0.45,
          roughness: 0.04,
          transparent: true,
          opacity: 0.38,
          depthWrite: false,
          envMapIntensity: 1.8,
        })
      : this.material({ color: 0x0a121b, metalness: 0.65, roughness: 0.05 });
    const lamp = this.material({ color: 0x33424e, metalness: 0.9, roughness: 0.04, emissive: 0xffe7b0, emissiveIntensity: 0 });
    const drl = this.material({ color: 0xfff5df, emissive: 0xfff1c9, emissiveIntensity: 1.35, roughness: 0.3 });
    const tail = this.material({ color: 0x4a0505, emissive: 0xd20c0c, emissiveIntensity: 0.45, roughness: 0.55 });
    const reverse = this.material({ color: 0xdedede, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.2 });
    const stripe = this.material({ color: 0x1b1f24, metalness: 0.3, roughness: 0.4 });
    const accent = this.material({ color: 0xc7ff52, emissive: 0x3a5a00, emissiveIntensity: 0.25, roughness: 0.45 });
    const dash = this.material({ color: 0x22262b, emissive: 0x0a0c0f, emissiveIntensity: 0.25, roughness: 0.82, envMapIntensity: 0.4 });
    const gauge = this.material({ color: 0x78d6ff, emissive: 0x2a8fd0, emissiveIntensity: 1.1, roughness: 0.3 });
    const carbonMap = carbonTexture();
    this.textures.push(carbonMap);
    const carbon = this.material({ map: carbonMap, metalness: 0.3, roughness: 0.5 });
    const mirror = this.material({ color: 0x4b5b66, metalness: 0.9, roughness: 0.16 });
    const fabric = this.material({ color: 0x2c3137, emissive: 0x080a0c, emissiveIntensity: 0.2, roughness: 0.96, envMapIntensity: 0.35 });
    const harness = this.material({ color: 0xb02020, roughness: 0.7 });
    const amber = this.material({ color: 0xff9a1e, emissive: 0xff7a00, emissiveIntensity: 0.55, roughness: 0.28 });
    const numberMap = numberTexture(this.number);
    const numberMaterial = this.material({ map: numberMap, roughness: 0.5 });
    const roofNumberMaterial = this.material({ map: numberMap, color: 0xc7ff52, roughness: 0.5 });
    const plateMaterial = this.material({ map: this.texture(plateTexture(this.number)), roughness: 0.55 });
    const mats = { paint, trim, satin, glass, lamp, drl, tail, reverse, stripe, accent, dash, gauge, carbon, fabric, harness, amber, mirror, number: numberMaterial, roofNumber: roofNumberMaterial, plate: plateMaterial };

    this.tailMaterial = tail;
    this.reverseLampMaterial = reverse;
    this.headlightMaterial = lamp;
    this.stripeMaterial = stripe;
    this.satinMaterial = satin;
    this.glassMaterial = glass;
    this.numberMaterial = numberMaterial;
    this.roofNumberMaterial = roofNumberMaterial;
    this.plateMaterial = plateMaterial;

    this.chassis = new THREE.Group();
    this.chassis.name = 'CarChassis';
    this.chassis.position.y = this.chassisOffsetY;
    this.add(this.chassis);

    this.buildShell(mats);
    this.buildExterior(mats);
    if (this.withInterior) this.buildCockpit(mats);
    this.buildWheels();
    this.mergeStatic();
    this.setTelemetry();
    return this;
  }

  buildShell(mats) {
    const { paint, trim, satin, glass, stripe, accent, number, amber } = mats;
    const { width, wheelbase, track } = this.dimensions;

    // --- body shell and glasshouse
    this.part(taper(extrudeProfile(bodyOutline(wheelbase), width, { bevel: 0.07 }), 0.55, 0.9, 0.05), paint);
    this.part(taper(extrudeProfile(GLASSHOUSE, width - 0.22, { bevel: 0.03 }), 0.8, 1.29, 0.18), glass);
    this.part(taper(extrudeProfile(ROOF, width - 0.42, { bevel: 0.025 }), 1.25, 1.32, 0.04), paint);

    // Pillars over the glass, following the glasshouse taper.
    const inset = (y) => (width / 2 - 0.13) * (1 - 0.18 * Math.min(1, Math.max(0, (y - 0.8) / 0.49)));
    for (const side of [-1, 1]) {
      const at = (z, y) => new THREE.Vector3(side * (inset(y) + 0.012), y, z);
      this.part(strut(at(-0.78, 0.82), at(-0.13, 1.27), 0.05, 0.09), paint);
      this.part(strut(at(0.32, 0.84), at(0.34, 1.28), 0.05, 0.12), paint);
      this.part(strut(at(0.95, 1.28), at(1.62, 0.9), 0.045, 0.11), paint);
      // Door shut lines and a sill stripe in the livery colour.
      this.box(0.012, 0.5, 0.012, side * (width / 2 + 0.005), 0.55, -0.73, trim);
      this.box(0.012, 0.5, 0.012, side * (width / 2 + 0.005), 0.55, 0.36, trim);
      this.box(0.02, 0.07, 1.62, side * (width / 2 + 0.006), 0.3, -0.02, accent);
      // Door handle and lock.
      this.box(0.03, 0.035, 0.17, side * 0.886, 0.77, 0.19, satin);
      this.box(0.014, 0.05, 0.06, side * 0.902, 0.72, 0.28, trim);
      // Mirrors: painted housing, glass face and an indicator repeater.
      const mirrorX = side * (width / 2 + 0.07);
      this.part(strut(new THREE.Vector3(side * (width / 2 - 0.02), 0.84, -0.66), new THREE.Vector3(mirrorX, 0.91, -0.64), 0.03, 0.05), satin);
      this.rounded(0.13, 0.1, 0.19, 0.03, mirrorX, 0.92, -0.63, paint);
      const mirrorFace = new THREE.PlaneGeometry(0.11, 0.07);
      mirrorFace.translate(mirrorX, 0.92, -0.532);
      this.part(mirrorFace, mats.mirror);
      this.box(0.02, 0.018, 0.05, mirrorX + side * 0.066, 0.9, -0.69, amber);
      // Arch flares: dark lips that make the arches read from a distance.
      for (const z of [wheelbase / 2, -wheelbase / 2]) {
        const flare = new THREE.TorusGeometry(ARCH_RADIUS + 0.02, 0.035, 6, 18, Math.PI * 1.04);
        flare.rotateY(Math.PI / 2);
        flare.translate(side * (width / 2 - 0.02), ARCH_Y, z);
        this.part(flare, trim);
        // Larger mud flap with a livery strip.
        this.box(0.24, 0.18, 0.022, side * (track / 2), 0.14, z + 0.47, trim);
        this.box(0.18, 0.03, 0.008, side * (track / 2), 0.06, z + 0.484, accent);
      }
      // Fender vents behind the front arch.
      for (let i = 0; i < 3; i += 1) {
        this.box(0.014, 0.13, 0.026, side * 0.905, 0.52, -0.88 + i * 0.055, trim);
      }
      // Rolled lip along the rocker.
      this.box(0.05, 0.07, 1.6, side * 0.895, 0.19, 0.1, mats.carbon);
    }

    // Fuel filler on the right rear quarter.
    const filler = new THREE.CylinderGeometry(0.06, 0.06, 0.014, 16);
    filler.rotateZ(Math.PI / 2);
    filler.translate(0.888, 0.68, 1.58);
    this.part(filler, satin);
    this.box(0.01, 0.02, 0.06, 0.897, 0.68, 1.61, accent);

    // Livery: twin stripes over the bonnet, roof and hatch. The shell is bevelled outward by
    // ~5 cm, so every stripe is placed from measured surface heights instead of the raw profile.
    for (const x of [-0.17, 0.17]) {
      // Bonnet front and rear sections follow the two different rake angles.
      this.box(0.16, 0.01, 0.5, x, 0.756, -1.79, stripe, { x: -0.158 });
      this.box(0.16, 0.01, 0.54, x, 0.822, -1.29, stripe, { x: -0.108 });
      // Roof stripes stop short of the number board so it can sit flush on the panel.
      this.box(0.15, 0.01, 0.42, x, 1.344, 0.075, stripe);
      this.box(0.15, 0.01, 0.2, x, 1.344, 0.85, stripe);
      // Rear hatch deck.
      this.box(0.15, 0.01, 0.34, x, 0.922, 1.77, stripe, { x: 0.095 });
    }

    // Door number boards, with plate rivets.
    for (const side of [-1, 1]) {
      const plate = new THREE.PlaneGeometry(0.72, 0.45);
      plate.rotateY(side * Math.PI / 2);
      plate.translate(side * 0.907, 0.56, -0.18);
      this.part(plate, number);
      for (const dz of [-0.3, 0.3]) {
        for (const dy of [-0.185, 0.185]) {
          const rivet = new THREE.CylinderGeometry(0.008, 0.008, 0.012, 6);
          rivet.rotateZ(Math.PI / 2);
          rivet.translate(side * 0.912, 0.56 + dy, -0.18 + dz);
          this.part(rivet, satin);
        }
      }
    }

    // Rear hatch number, lying on the deck, and a pair of plate lights.
    const hatchNumber = new THREE.PlaneGeometry(0.34, 0.22);
    hatchNumber.rotateX(-Math.PI / 2 + 0.09);
    hatchNumber.translate(0, 0.928, 1.8);
    this.part(hatchNumber, number);
    const plateMesh = new THREE.PlaneGeometry(0.34, 0.12);
    plateMesh.translate(0, 0.36, 2.196);
    this.part(plateMesh, mats.plate);
    for (const x of [-0.1, 0.1]) {
      this.box(0.035, 0.014, 0.01, x, 0.435, 2.194, satin);
    }

    // Sunstrip across the top of the windscreen.
    this.part(strut(new THREE.Vector3(-0.6, 1.24, -0.185), new THREE.Vector3(0.6, 1.24, -0.185), 0.025, 0.016), trim);
  }

  buildExterior(mats) {
    const { paint, trim, satin, carbon, lamp, drl, tail, reverse, accent, amber, number } = mats;
    const { width, track, wheelbase } = this.dimensions;

    // --- front fascia. The extruded nose reaches z=-2.25 because of its bevel, so every part
    // here is deliberately proud of that plane instead of buried inside the shell.
    // Painted bumper cover with a carbon lip and a central intake keeps the nose from
    // reading as one black slab.
    this.rounded(1.72, 0.24, 0.16, 0.05, 0, 0.3, -2.235, paint);
    this.box(1.7, 0.05, 0.1, 0, 0.175, -2.27, carbon);
    this.box(0.96, 0.1, 0.05, 0, 0.28, -2.3, carbon);
    for (let i = 0; i < 6; i += 1) this.box(0.012, 0.09, 0.02, -0.32 + i * 0.128, 0.28, -2.33, satin);
    this.box(1.6, 0.014, 0.02, 0, 0.412, -2.322, accent);
    for (const side of [-1, 1]) {
      // Round rally lamp sunk into the painted bumper: dark housing, chrome reflector and glass.
      const housing = new THREE.CylinderGeometry(0.088, 0.088, 0.06, 18);
      housing.rotateX(Math.PI / 2);
      housing.translate(side * 0.63, 0.28, -2.302);
      this.part(housing, carbon);
      const reflector = new THREE.CylinderGeometry(0.078, 0.078, 0.008, 18);
      reflector.rotateX(Math.PI / 2);
      reflector.translate(side * 0.63, 0.28, -2.331);
      this.part(reflector, satin);
      const lens = new THREE.CylinderGeometry(0.064, 0.064, 0.014, 18);
      lens.rotateX(Math.PI / 2);
      lens.translate(side * 0.63, 0.28, -2.34);
      this.part(lens, lamp);
      const ring = new THREE.TorusGeometry(0.072, 0.007, 6, 20);
      ring.translate(side * 0.63, 0.28, -2.346);
      this.part(ring, satin);
      // Front tow hook on the bumper face.
      const hook = new THREE.TorusGeometry(0.04, 0.011, 6, 14);
      hook.translate(side * 0.47, 0.215, -2.34);
      this.part(hook, mats.harness);
    }
    // Upper fascia: a compact centre grille flanked by painted lamp pods.
    this.box(0.62, 0.16, 0.04, 0, 0.49, -2.255, trim);
    for (let i = 0; i < 6; i += 1) this.box(0.012, 0.14, 0.016, -0.23 + i * 0.092, 0.49, -2.28, satin);
    this.box(0.075, 0.038, 0.02, 0, 0.49, -2.284, accent);
    for (const side of [-1, 1]) {
      const x = side * 0.61;
      this.rounded(0.52, 0.19, 0.07, 0.025, x, 0.49, -2.245, paint);
      this.box(0.46, 0.145, 0.02, x, 0.485, -2.282, carbon);
      for (const dx of [-0.1, 0.1]) {
        const bowl = new THREE.CylinderGeometry(0.05, 0.05, 0.018, 16);
        bowl.rotateX(Math.PI / 2);
        bowl.translate(x + dx, 0.472, -2.288);
        this.part(bowl, trim);
        const reflector = new THREE.CylinderGeometry(0.042, 0.042, 0.006, 16);
        reflector.rotateX(Math.PI / 2);
        reflector.translate(x + dx, 0.472, -2.298);
        this.part(reflector, satin);
        const lens = new THREE.SphereGeometry(0.04, 14, 10);
        lens.scale(1, 1, 0.4);
        lens.translate(x + dx, 0.472, -2.302);
        this.part(lens, lamp);
        const ring = new THREE.TorusGeometry(0.045, 0.006, 6, 18);
        ring.translate(x + dx, 0.472, -2.305);
        this.part(ring, satin);
      }
      this.box(0.44, 0.016, 0.016, x, 0.558, -2.284, drl);
      this.box(0.05, 0.035, 0.02, x + side * 0.2, 0.438, -2.286, amber);
    }
    this.box(1.74, 0.03, 0.36, 0, 0.145, -2.14, carbon);

    // Bonnet scoop, louvres and pins. Heights follow the measured beveled bonnet surface.
    this.rounded(0.52, 0.06, 0.4, 0.025, 0, 0.857, -1.22, carbon, { x: -0.108 });
    this.box(0.4, 0.03, 0.05, 0, 0.862, -1.42, trim, { x: -0.108 });
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i += 1) {
        this.box(0.22, 0.008, 0.05, side * 0.36, 0.804 + i * 0.009, -1.5 + i * 0.08, satin);
      }
      const pin = new THREE.CylinderGeometry(0.015, 0.015, 0.03, 8);
      pin.translate(side * 0.74, 0.74, -1.94);
      this.part(pin, satin);
    }

    // --- rear end
    for (const side of [-1, 1]) {
      const x = side * 0.6;
      this.box(0.5, 0.16, 0.08, x, 0.7, 2.11, trim, { y: side * 0.15 });
      for (let i = 0; i < 3; i += 1) this.box(0.05, 0.11, 0.02, x + (i - 1) * 0.13, 0.7, 2.156, tail, { y: side * 0.15 });
      this.box(0.08, 0.05, 0.02, x + side * 0.19, 0.64, 2.15, amber, { y: side * 0.15 });
      this.box(0.12, 0.06, 0.04, side * 0.32, 0.46, 2.15, reverse);
      // Exhaust: a hot outer tip with a dark bore.
      const pipe = new THREE.CylinderGeometry(0.058, 0.062, 0.2, 14, 1, true);
      pipe.rotateX(Math.PI / 2);
      pipe.translate(side * 0.52, 0.18, 2.18);
      this.part(pipe, satin);
      const bore = new THREE.CylinderGeometry(0.048, 0.048, 0.02, 14);
      bore.rotateX(Math.PI / 2);
      bore.translate(side * 0.52, 0.18, 2.282);
      this.part(bore, trim);
      // Rear tow hook.
      const hook = new THREE.TorusGeometry(0.045, 0.012, 6, 14);
      hook.translate(side * 0.55, 0.24, 2.2);
      this.part(hook, mats.harness);
    }
    this.box(0.7, 0.05, 0.04, 0, 0.72, 2.13, tail);
    this.box(1.64, 0.2, 0.1, 0, 0.3, 2.14, trim);
    this.box(1.5, 0.03, 0.32, 0, 0.16, 2.02, carbon);
    for (let i = 0; i < 5; i += 1) this.box(0.018, 0.16, 0.34, -0.6 + i * 0.3, 0.21, 2.04, carbon);
    this.box(0.12, 0.03, 0.02, 0, 0.66, 2.16, tail);

    // Hatch-mounted rally wing on swan-neck stays.
    this.box(1.5, 0.045, 0.34, 0, 1.035, 1.98, carbon, { x: -0.16 });
    this.box(1.44, 0.05, 0.02, 0, 1.058, 2.135, carbon, { x: -0.16 });
    for (const side of [-1, 1]) {
      this.box(0.042, 0.16, 0.32, side * 0.77, 1.005, 1.97, carbon);
      this.box(0.046, 0.016, 0.3, side * 0.77, 0.935, 1.97, accent);
      this.part(strut(new THREE.Vector3(side * 0.4, 0.862, 1.76), new THREE.Vector3(side * 0.4, 1.06, 1.95), 0.032, 0.07), carbon);
      this.part(strut(new THREE.Vector3(side * 0.66, 0.875, 1.8), new THREE.Vector3(side * 0.66, 1.04, 1.96), 0.022, 0.05), carbon);
    }
    // Rear wiper parked on the hatch.
    this.part(barBetween(new THREE.Vector3(-0.05, 1.0, 1.56), new THREE.Vector3(0.32, 1.02, 1.49), 0.008), satin);
    this.box(0.03, 0.03, 0.04, -0.05, 1.0, 1.56, satin);

    // Roof number board, raised clear of the roof stripes and readable from the chase camera.
    const roofNumber = new THREE.PlaneGeometry(0.62, 0.4);
    roofNumber.rotateX(-Math.PI / 2);
    roofNumber.translate(0, 1.336, 0.52);
    this.part(roofNumber, mats.roofNumber);

    // Roof scoop, antenna and a small roof vent.
    this.rounded(0.42, 0.09, 0.36, 0.03, 0, 1.33, -0.02, carbon);
    this.box(0.34, 0.055, 0.02, 0, 1.34, -0.195, trim);
    for (let i = 0; i < 3; i += 1) this.box(0.012, 0.05, 0.04, -0.1 + i * 0.1, 1.34, -0.2, satin);
    this.box(0.34, 0.025, 0.04, 0, 1.372, -0.18, trim);
    for (let i = 0; i < 3; i += 1) this.box(0.3, 0.008, 0.02, 0, 1.352, -0.12 + i * 0.03, satin);
    this.part(strut(new THREE.Vector3(0.3, 1.31, 0.8), new THREE.Vector3(0.34, 1.62, 0.92), 0.012), satin);
    const antennaBase = new THREE.CylinderGeometry(0.02, 0.024, 0.035, 8);
    antennaBase.translate(0.3, 1.32, 0.8);
    this.part(antennaBase, satin);

    // --- underbody: flat floor, wheel-well liners and inner walls
    this.box(1.3, 0.03, 3.9, 0, 0.145, 0, satin);
    for (const z of [wheelbase / 2, -wheelbase / 2]) {
      const liner = archLinerGeometry(ARCH_RADIUS - 0.015, 1.62);
      liner.translate(0, ARCH_Y, z);
      this.part(liner, trim);
      for (const dz of [-0.5, 0.5]) this.box(1.5, 0.42, 0.02, 0, 0.26, z + dz, trim);
    }

    // Rear-view mirror is interior-only; keep the exterior door glass clean.
  }

  buildCockpit(mats) {
    const { trim, satin, accent, dash, carbon, fabric, harness, mirror, stripe } = mats;
    const { width } = this.dimensions;

    this.interior = new THREE.Group();
    this.interior.name = 'RallyCockpit';
    this.chassis.add(this.interior);
    // Soft cabin fill so the wheel, dash and seats stay readable at night. It is a small,
    // shadowless point light and only exists on the player's full-interior car.
    this.cabinLight = new THREE.PointLight(0xffd7a1, 0.35, 2.6, 2);
    this.cabinLight.position.set(0, 1.02, 0.15);
    this.cabinLight.castShadow = false;
    this.interior.add(this.cabinLight);
    const add = (w, h, d, radius, x, y, z, material, rotation = null) =>
      this.rounded(w, h, d, radius, x, y, z, material, rotation, this.interior);

    // Instrument textures only exist when the cockpit is built.
    const dialMap = dialTexture();
    const screenMap = screenTexture();
    this.textures.push(dialMap, screenMap);
    mats.dial = this.material({
      map: dialMap,
      emissive: 0xffffff,
      emissiveMap: dialMap,
      emissiveIntensity: 0.55,
      roughness: 0.38,
    });
    mats.screen = this.material({
      map: screenMap,
      emissive: 0xffffff,
      emissiveMap: screenMap,
      emissiveIntensity: 0.8,
      roughness: 0.35,
    });
    const shiftLight = this.material({ color: 0x2a0a08, emissive: 0xff2a1a, emissiveIntensity: 0.12, roughness: 0.4 });
    this.shiftLightMaterial = shiftLight;
    const headlinerMaterial = this.material({ color: 0x4c535a, emissive: 0x121518, emissiveIntensity: 0.25, roughness: 0.96, envMapIntensity: 0.4 });

    // --- headliner: hides the raw underside of the roof and lifts the cabin out of blackness
    const headliner = new THREE.PlaneGeometry(1.62, 1.32);
    headliner.rotateX(Math.PI / 2);
    headliner.translate(0, 1.242, 0.38);
    this.part(headliner, headlinerMaterial, this.interior);

    // Windscreen header trim closes the gap between the headliner and the glass.
    this.box(1.3, 0.035, 0.08, 0, 1.246, -0.21, trim, null, this.interior);
    this.box(0.5, 0.012, 0.03, 0, 1.218, -0.245, stripe, null, this.interior);

    // --- floor, tunnel, firewall and bulkhead
    add(1.66, 0.04, 1.9, 0.02, 0, 0.15, 0.12, dash);
    add(0.26, 0.18, 1.6, 0.04, 0, 0.28, 0.05, dash);
    add(1.5, 0.72, 0.04, 0.02, 0, 0.55, 0.76, dash);
    add(1.66, 0.65, 0.05, 0.02, 0, 0.475, -0.78, dash);
    this.box(1.3, 0.16, 0.06, 0, 0.17, 0.76, satin, null, this.interior);

    // --- dashboard
    add(1.5, 0.15, 0.42, 0.04, 0, 0.73, -0.58, dash);
    add(1.5, 0.05, 0.4, 0.02, 0, 0.795, -0.55, fabric);
    add(1.4, 0.2, 0.16, 0.03, 0, 0.57, -0.56, dash);
    add(0.42, 0.24, 0.2, 0.03, -0.37, 0.84, -0.55, dash);
    add(0.46, 0.03, 0.24, 0.015, -0.37, 0.952, -0.56, dash, { x: -0.08 });

    // Centre stack: display, switch bank and vents.
    add(0.38, 0.46, 0.2, 0.03, 0.02, 0.63, -0.55, dash);
    this.box(0.32, 0.19, 0.02, 0.02, 0.78, -0.462, trim, null, this.interior);
    const screen = new THREE.PlaneGeometry(0.28, 0.15);
    screen.translate(0.02, 0.78, -0.452);
    this.part(screen, mats.screen, this.interior);
    this.box(0.34, 0.06, 0.04, 0.02, 0.55, -0.44, satin, null, this.interior);
    for (let i = 0; i < 5; i += 1) {
      this.box(0.03, 0.016, 0.02, -0.1 + i * 0.06, 0.575, -0.432, trim, null, this.interior);
    }
    for (const x of [-0.5, 0.5]) {
      add(0.16, 0.1, 0.06, 0.02, x, 0.86, -0.46, trim);
      for (let i = 0; i < 3; i += 1) this.box(0.13, 0.008, 0.02, x, 0.83 + i * 0.03, -0.43, satin, null, this.interior);
    }
    // Passenger grab handle, warning lamps and intercom.
    this.box(0.3, 0.04, 0.04, 0.55, 0.85, -0.4, satin, null, this.interior);
    for (const x of [0.48, 0.62]) this.part(barBetween(new THREE.Vector3(x, 0.84, -0.42), new THREE.Vector3(x, 0.85, -0.53), 0.015), satin, this.interior);
    for (const x of [0.2, 0.24, 0.28]) this.box(0.016, 0.02, 0.012, x, 0.905, -0.43, mats.gauge, null, this.interior);
    add(0.1, 0.05, 0.12, 0.01, 0.32, 0.55, -0.44, satin);

    // --- instrument cluster: printed faces plus live needles
    this.dialGroup = new THREE.Group();
    this.dialGroup.name = 'GaugeCluster';
    this.dialGroup.position.set(-0.37, 0.885, -0.44);
    this.dialGroup.rotation.x = -0.3;
    this.interior.add(this.dialGroup);
    for (const x of [-0.065, 0.065]) {
      const face = new THREE.CircleGeometry(0.052, 24);
      face.translate(x, 0, 0);
      this.part(face, mats.dial, this.dialGroup);
      const ring = new THREE.TorusGeometry(0.054, 0.006, 6, 20);
      ring.translate(x, 0, 0.002);
      this.part(ring, satin, this.dialGroup);
    }
    for (const x of [-0.065, 0.065]) {
      const needleGroup = new THREE.Group();
      needleGroup.position.set(x, 0, 0.012);
      needleGroup.rotation.z = 2.35;
      this.dialGroup.add(needleGroup);
      const needleGeometry = new THREE.BoxGeometry(0.006, 0.05, 0.004);
      needleGeometry.translate(0, 0.022, 0);
      const needle = this.part(needleGeometry, accent, needleGroup);
      needle.castShadow = false;
      needle.receiveShadow = false;
      this.needles.push(needleGroup);
      this.dynamicRoots.add(needleGroup);
    }
    this.tachNeedle = this.needles[0];
    this.speedNeedle = this.needles[1];
    for (const x of [-0.44, -0.37, -0.3]) {
      this.box(0.035, 0.018, 0.012, x, 0.976, -0.56, shiftLight, null, this.interior);
    }

    // --- steering wheel: merged per material, spins as one group
    this.steeringWheel = new THREE.Group();
    this.steeringWheel.name = 'SteeringWheel';
    this.steeringWheel.position.set(-0.37, 0.72, -0.3);
    this.steeringWheel.rotation.x = -0.34;
    this.interior.add(this.steeringWheel);
    this.dynamicRoots.add(this.steeringWheel);

    const rimGeometry = new THREE.TorusGeometry(0.17, 0.024, 8, 28);
    mergeToMesh([rimGeometry], trim, this.steeringWheel, 'WheelRim');
    const spokeParts = [];
    const leftSpoke = new THREE.BoxGeometry(0.13, 0.045, 0.025);
    leftSpoke.translate(-0.085, 0, 0);
    spokeParts.push(leftSpoke);
    const rightSpoke = new THREE.BoxGeometry(0.13, 0.045, 0.025);
    rightSpoke.translate(0.085, 0, 0);
    spokeParts.push(rightSpoke);
    const bottomSpoke = new THREE.BoxGeometry(0.045, 0.12, 0.025);
    bottomSpoke.translate(0, -0.085, 0);
    spokeParts.push(bottomSpoke);
    const hub = new THREE.CylinderGeometry(0.055, 0.055, 0.04, 16);
    hub.rotateX(Math.PI / 2);
    hub.translate(0, 0, 0.005);
    spokeParts.push(hub);
    for (let i = 0; i < 6; i += 1) {
      const angle = (i / 6) * TWO_PI;
      const bolt = new THREE.CylinderGeometry(0.008, 0.008, 0.012, 8);
      bolt.rotateX(Math.PI / 2);
      bolt.translate(Math.cos(angle) * 0.035, Math.sin(angle) * 0.035, 0.028);
      spokeParts.push(bolt);
    }
    const collar = new THREE.CylinderGeometry(0.048, 0.052, 0.05, 16);
    collar.rotateX(Math.PI / 2);
    collar.translate(0, 0, 0.045);
    spokeParts.push(collar);
    mergeToMesh(spokeParts, carbon, this.steeringWheel, 'WheelSpokes');
    const paddleParts = [];
    for (const side of [-1, 1]) {
      const paddle = new THREE.BoxGeometry(0.09, 0.028, 0.012);
      paddle.translate(side * 0.115, -0.02, -0.02);
      paddleParts.push(paddle);
    }
    mergeToMesh(paddleParts, carbon, this.steeringWheel, 'WheelPaddles');
    const marker = new THREE.BoxGeometry(0.035, 0.02, 0.02);
    marker.translate(0, 0.168, 0.02);
    mergeToMesh([marker], accent, this.steeringWheel, 'WheelMarker');

    // Column, cowl and stalks.
    this.part(barBetween(new THREE.Vector3(-0.37, 0.64, -0.66), new THREE.Vector3(-0.37, 0.73, -0.31), 0.035), satin, this.interior);
    add(0.2, 0.12, 0.16, 0.03, -0.37, 0.685, -0.58, dash);
    this.box(0.13, 0.02, 0.02, -0.49, 0.69, -0.53, satin, null, this.interior);
    this.box(0.13, 0.02, 0.02, -0.25, 0.69, -0.53, satin, null, this.interior);

    // --- bucket seats, rails and harnesses
    for (const side of [-1, 1]) {
      const x = side * 0.37;
      add(0.44, 0.08, 0.42, 0.028, x, 0.43, 0.18, fabric);
      add(0.44, 0.06, 0.1, 0.02, x, 0.44, 0.36, fabric);
      add(0.42, 0.5, 0.1, 0.04, x, 0.66, 0.44, fabric, { x: -0.14 });
      for (const inner of [-1, 1]) {
        add(0.08, 0.15, 0.4, 0.028, x + inner * 0.21, 0.47, 0.18, fabric);
        add(0.07, 0.34, 0.12, 0.028, x + inner * 0.21, 0.68, 0.46, fabric, { x: -0.14 });
        add(0.07, 0.16, 0.1, 0.028, x + inner * 0.16, 0.9, 0.45, fabric, { x: -0.14 });
        this.box(0.014, 0.3, 0.014, x + inner * 0.246, 0.68, 0.47, accent, { x: -0.14 }, this.interior);
      }
      add(0.24, 0.14, 0.1, 0.03, x, 0.98, 0.46, fabric, { x: -0.12 });
      this.box(0.03, 0.05, 0.02, x - 0.085, 0.86, 0.405, trim, null, this.interior);
      this.box(0.03, 0.05, 0.02, x + 0.085, 0.86, 0.405, trim, null, this.interior);
      for (const inner of [-1, 1]) {
        this.box(0.055, 0.42, 0.012, x + inner * 0.08, 0.7, 0.38, harness, { x: -0.14 }, this.interior);
      }
      this.box(0.3, 0.05, 0.012, x, 0.53, 0.31, harness, null, this.interior);
      this.box(0.04, 0.03, 0.5, x - 0.2, 0.38, 0.2, satin, null, this.interior);
      this.box(0.04, 0.03, 0.5, x + 0.2, 0.38, 0.2, satin, null, this.interior);
    }

    // --- roll cage, padding and door bars
    const bar = (a, b, radius = 0.021) => this.part(barBetween(a, b, radius), satin, this.interior);
    bar(new THREE.Vector3(-0.68, 0.32, 0.66), new THREE.Vector3(-0.6, 1.18, 0.66));
    bar(new THREE.Vector3(0.68, 0.32, 0.66), new THREE.Vector3(0.6, 1.18, 0.66));
    bar(new THREE.Vector3(-0.6, 1.18, 0.66), new THREE.Vector3(0.6, 1.18, 0.66));
    bar(new THREE.Vector3(-0.6, 1.05, 0.66), new THREE.Vector3(0.6, 1.05, 0.66));
    bar(new THREE.Vector3(-0.6, 1.18, 0.66), new THREE.Vector3(0.66, 0.34, 0.66), 0.019);
    for (const side of [-1, 1]) {
      // The front hoop hugs the A-pillar and tucks under the roof header, out of the eye line.
      bar(new THREE.Vector3(side * 0.64, 0.86, -0.7), new THREE.Vector3(side * 0.54, 1.235, -0.19), 0.019);
      bar(new THREE.Vector3(side * 0.72, 0.3, -0.6), new THREE.Vector3(side * 0.72, 0.92, 0.55), 0.019);
      bar(new THREE.Vector3(side * 0.72, 0.92, -0.6), new THREE.Vector3(side * 0.72, 0.3, 0.55), 0.019);
      this.part(barBetween(new THREE.Vector3(side * 0.72, 0.56, -0.24), new THREE.Vector3(side * 0.72, 0.72, 0.08), 0.038), fabric, this.interior);
      this.part(barBetween(new THREE.Vector3(side * 0.72, 0.72, -0.24), new THREE.Vector3(side * 0.72, 0.56, 0.08), 0.038), fabric, this.interior);
    }
    bar(new THREE.Vector3(-0.54, 1.235, -0.19), new THREE.Vector3(0.54, 1.235, -0.19), 0.019);
    bar(new THREE.Vector3(-0.64, 0.86, -0.66), new THREE.Vector3(0.64, 0.86, -0.66), 0.019);

    // --- door cards
    for (const side of [-1, 1]) {
      const x = side * 0.76;
      add(0.03, 0.76, 1.6, 0.012, x, 0.52, 0.05, dash);
      add(0.09, 0.07, 0.44, 0.02, x - side * 0.045, 0.61, 0.25, fabric);
      this.box(0.03, 0.16, 0.02, x - side * 0.02, 0.7, 0.55, harness, null, this.interior);
      const speaker = new THREE.CylinderGeometry(0.075, 0.075, 0.03, 18);
      speaker.rotateZ(Math.PI / 2);
      speaker.translate(x - side * 0.02, 0.4, 0.62);
      this.part(speaker, satin, this.interior);
      const speakerRing = new THREE.TorusGeometry(0.075, 0.008, 6, 18);
      speakerRing.rotateY(-side * Math.PI / 2);
      speakerRing.translate(x - side * 0.035, 0.4, 0.62);
      this.part(speakerRing, trim, this.interior);
      this.box(0.08, 0.02, 0.14, x - side * 0.02, 0.64, 0.02, satin, null, this.interior);
      this.box(0.03, 0.16, 0.4, x - side * 0.01, 0.28, 0.35, dash, null, this.interior);
      this.box(0.04, 0.03, 1.55, x - side * 0.005, 0.9, 0.05, satin, null, this.interior);
      // Rally window net on the driver's side.
      if (side < 0) {
        for (let i = 0; i < 4; i += 1) {
          this.box(0.008, 0.34, 0.008, -0.735, 1.07, -0.02 + i * 0.155, satin, null, this.interior);
        }
        for (let i = 0; i < 3; i += 1) {
          this.box(0.008, 0.008, 0.48, -0.735, 0.93 + i * 0.14, 0.21, satin, null, this.interior);
        }
        this.box(0.02, 0.06, 0.02, -0.735, 0.98, -0.04, harness, null, this.interior);
      }
    }

    // --- pedals and footwell
    for (const x of [-0.52, -0.4, -0.28]) {
      this.box(0.07, 0.11, 0.02, x, 0.3, -0.73, satin, null, this.interior);
      this.box(0.06, 0.09, 0.01, x, 0.3, -0.718, trim, null, this.interior);
      this.part(barBetween(new THREE.Vector3(x, 0.5, -0.62), new THREE.Vector3(x, 0.3, -0.72), 0.01), satin, this.interior);
    }
    this.box(0.12, 0.16, 0.02, -0.72, 0.34, -0.62, trim, null, this.interior);

    // --- shifter, handbrake and extinguisher
    const shifterBase = new THREE.CylinderGeometry(0.08, 0.08, 0.06, 16);
    shifterBase.translate(0, 0.4, 0.02);
    this.part(shifterBase, trim, this.interior);
    const boot = new THREE.CylinderGeometry(0.03, 0.08, 0.1, 14);
    boot.translate(0, 0.44, 0.03);
    this.part(boot, trim, this.interior);
    this.part(barBetween(new THREE.Vector3(0, 0.45, 0.03), new THREE.Vector3(0, 0.56, 0.065), 0.012), satin, this.interior);
    const knob = new THREE.SphereGeometry(0.035, 12, 8);
    knob.translate(0, 0.57, 0.065);
    this.part(knob, trim, this.interior);
    this.box(0.04, 0.012, 0.02, 0, 0.585, 0.065, accent, null, this.interior);
    this.part(barBetween(new THREE.Vector3(-0.17, 0.4, 0.18), new THREE.Vector3(-0.2, 0.55, 0.12), 0.014), satin, this.interior);
    this.part(barBetween(new THREE.Vector3(-0.18, 0.47, 0.16), new THREE.Vector3(-0.2, 0.54, 0.125), 0.022), harness, this.interior);
    const extinguisher = new THREE.CylinderGeometry(0.05, 0.05, 0.28, 14);
    extinguisher.rotateX(Math.PI / 2);
    extinguisher.translate(0.52, 0.4, -0.48);
    this.part(extinguisher, harness, this.interior);
    this.box(0.012, 0.06, 0.2, 0.572, 0.4, -0.48, accent, null, this.interior);
    this.box(0.08, 0.04, 0.02, 0.52, 0.45, -0.48, trim, null, this.interior);
    this.box(0.08, 0.04, 0.02, 0.52, 0.35, -0.48, trim, null, this.interior);

    // --- pillar trims, sun visors, dome light and rear-view mirror
    for (const side of [-1, 1]) {
      // Wide trim panels cover the painted inner faces of the A- and B-pillars.
      this.part(strut(new THREE.Vector3(side * 0.75, 0.8, -0.79), new THREE.Vector3(side * 0.66, 1.262, -0.14), 0.034, 0.13), fabric, this.interior);
      this.part(strut(new THREE.Vector3(side * 0.655, 0.86, 0.33), new THREE.Vector3(side * 0.6, 1.25, 0.35), 0.028, 0.14), fabric, this.interior);
      this.rounded(0.42, 0.025, 0.17, 0.012, side * 0.3, 1.2, -0.09, fabric, { x: 0.14 }, this.interior);
    }
    this.rounded(0.16, 0.03, 0.1, 0.012, 0, 1.238, 0.5, satin, null, this.interior);
    this.part(barBetween(new THREE.Vector3(0, 1.3, -0.18), new THREE.Vector3(0, 1.235, -0.17), 0.012), satin, this.interior);
    this.box(0.16, 0.055, 0.04, 0, 1.22, -0.17, trim, null, this.interior);
    const mirrorFace = new THREE.PlaneGeometry(0.145, 0.045);
    mirrorFace.translate(0, 1.22, -0.148);
    this.part(mirrorFace, mirror, this.interior);
  }

  buildWheels() {
    const { wheelbase, track, wheelRadius: r, wheelWidth } = this.dimensions;
    const h = wheelWidth / 2;
    const tire = this.material({ color: 0x141517, metalness: 0, roughness: 0.92 });
    const rim = this.material({ color: 0xbfc4ca, metalness: 0.85, roughness: 0.3 });
    this.rimMaterial = rim;
    const caliper = this.material({ color: 0xd6242a, metalness: 0.3, roughness: 0.45 });

    // Tyre: a lathe of a rounded section, with tread blocks merged in. The geometry is shared by
    // all four wheels, so the extra blocks are paid for once.
    const section = [
      [r * 0.68, -h], [r - 0.035, -h], [r - 0.008, -h * 0.72], [r, -h * 0.25], [r, h * 0.25],
      [r - 0.008, h * 0.72], [r - 0.035, h], [r * 0.68, h],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const tireParts = [new THREE.LatheGeometry(section, 32)];
    for (let i = 0; i < 24; i += 1) {
      const lug = new THREE.BoxGeometry(0.075, wheelWidth * 0.72, 0.016);
      lug.translate(0, 0, r - 0.002);
      lug.rotateY((i / 24) * TWO_PI);
      tireParts.push(lug);
    }
    const tireGeometry = mergeGeometries(tireParts.map((geometry) => geometry.toNonIndexed()), false);
    tireParts.forEach((geometry) => geometry.dispose());
    tireGeometry.rotateZ(Math.PI / 2);

    // Rim: barrel, outer lip, ten spokes, hub and lug nuts, merged into one geometry.
    const rimParts = [];
    const barrel = new THREE.CylinderGeometry(r * 0.69, r * 0.69, wheelWidth * 0.9, 24, 1, true);
    barrel.rotateZ(Math.PI / 2);
    rimParts.push(barrel);
    const lip = new THREE.TorusGeometry(r * 0.7, 0.024, 6, 24);
    lip.rotateY(Math.PI / 2);
    lip.translate(h * 0.9, 0, 0);
    rimParts.push(lip);
    const face = new THREE.RingGeometry(r * 0.58, r * 0.69, 24);
    face.rotateY(Math.PI / 2);
    face.translate(h * 0.82, 0, 0);
    rimParts.push(face);
    for (let k = 0; k < 10; k += 1) {
      const spoke = new THREE.BoxGeometry(0.022, r * 0.58, 0.055);
      spoke.translate(h * 0.7, r * 0.31, 0);
      spoke.rotateX((k / 10) * TWO_PI);
      rimParts.push(spoke);
    }
    const hub = new THREE.CylinderGeometry(r * 0.16, r * 0.16, 0.05, 12);
    hub.rotateZ(Math.PI / 2);
    hub.translate(h * 0.78, 0, 0);
    rimParts.push(hub);
    for (let i = 0; i < 5; i += 1) {
      const angle = (i / 5) * TWO_PI;
      const nut = new THREE.CylinderGeometry(0.011, 0.011, 0.025, 6);
      nut.rotateZ(Math.PI / 2);
      nut.translate(h * 0.84, Math.cos(angle) * 0.035, Math.sin(angle) * 0.035);
      rimParts.push(nut);
    }
    const rimGeometry = mergeGeometries(rimParts.map((geometry) => geometry.toNonIndexed()), false);
    rimParts.forEach((geometry) => geometry.dispose());
    const rimMirrored = rimGeometry.clone().scale(-1, 1, 1);
    // Mirroring flips winding; flip it back so the faces stay front-facing.
    const positions = rimMirrored.attributes.position;
    for (let i = 0; i < positions.count; i += 3) {
      for (const attribute of [rimMirrored.attributes.position, rimMirrored.attributes.normal, rimMirrored.attributes.uv]) {
        if (!attribute) continue;
        for (let c = 0; c < attribute.itemSize; c += 1) {
          const a = attribute.array[(i + 1) * attribute.itemSize + c];
          attribute.array[(i + 1) * attribute.itemSize + c] = attribute.array[(i + 2) * attribute.itemSize + c];
          attribute.array[(i + 2) * attribute.itemSize + c] = a;
        }
      }
    }
    rimMirrored.computeVertexNormals();

    const caliperGeometry = new THREE.BoxGeometry(0.06, 0.12, 0.17);
    const positionsByKey = {
      frontLeft: [-track / 2, -wheelbase / 2],
      frontRight: [track / 2, -wheelbase / 2],
      rearLeft: [-track / 2, wheelbase / 2],
      rearRight: [track / 2, wheelbase / 2],
    };
    WHEEL_KEYS.forEach((key) => {
      const [x, z] = positionsByKey[key];
      const outward = Math.sign(x);
      const pivot = new THREE.Group();
      pivot.name = `${key}_pivot`;
      pivot.position.set(x, this.wheelCentreY, z);
      const wheel = new THREE.Group();
      wheel.name = `${key}_wheel`;
      this.part(tireGeometry, tire, wheel);
      this.part(outward > 0 ? rimGeometry : rimMirrored, rim, wheel);

      // Brake disc and hat, inboard of the rim face. Discs spin with the wheel.
      const discParts = [];
      const disc = new THREE.CylinderGeometry(r * 0.56, r * 0.56, 0.022, 20);
      disc.rotateZ(Math.PI / 2);
      disc.translate(-outward * h * 0.18, 0, 0);
      discParts.push(disc);
      const hat = new THREE.CylinderGeometry(r * 0.2, r * 0.23, 0.05, 14);
      hat.rotateZ(Math.PI / 2);
      hat.translate(-outward * h * 0.08, 0, 0);
      discParts.push(hat);
      const discGeometry = mergeGeometries(discParts.map((geometry) => geometry.toNonIndexed()), false);
      discParts.forEach((geometry) => geometry.dispose());
      const discMesh = this.part(discGeometry, this.satinMaterial, wheel);
      discMesh.castShadow = false;

      pivot.add(wheel);
      // Calipers do not spin: they hang off the pivot, just inside the spokes.
      const caliperMesh = this.part(caliperGeometry, caliper, pivot);
      caliperMesh.position.set(outward * h * 0.2, r * 0.42, key.startsWith('front') ? -0.07 : 0.07);
      this.add(pivot);
      this.wheels.set(key, wheel);
      this.wheelPivots.set(key, pivot);
      this.wheelSpin.set(key, 0);
    });
  }

  /**
   * The body is an extruded solid, so its beltline would read as a white floor from the cockpit
   * camera. Discard the top skin inside the glasshouse footprint: the shoulders and pillars stay,
   * and a matching depth material keeps the sun from being shadowed out of the cabin.
   */
  enableCabinCutout(material) {
    const inject = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCabinLocal;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCabinLocal = transformed;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCabinLocal;')
        .replace('void main() {', `void main() {
          if (vCabinLocal.x > -0.7 && vCabinLocal.x < 0.7
            && vCabinLocal.y > 0.74 && vCabinLocal.y < 1.06
            && vCabinLocal.z > -0.82 && vCabinLocal.z < 1.38) discard;`);
    };
    material.onBeforeCompile = inject;
    material.customProgramCacheKey = () => 'cabin-cutout';
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.onBeforeCompile = inject;
    depth.customProgramCacheKey = () => 'cabin-cutout-depth';
    material.customDepthMaterial = depth;
    this.cabinCutoutDepth = depth;
  }

  /**
   * Fold every static chassis part into one mesh per material: the body is made of ~200
   * primitives, which would otherwise cost two draw calls each (colour and shadow pass).
   * Interior parts go to their own group so the whole cockpit can be hidden for ghosts and
   * remote cars; the steering wheel and gauge needles stay separate because they move.
   */
  mergeStatic() {
    this.updateMatrixWorld(true);
    const toChassis = new THREE.Matrix4().copy(this.chassis.matrixWorld).invert();
    const isUnder = (node, root) => {
      for (let parent = node; parent; parent = parent.parent) if (parent === root) return true;
      return false;
    };
    const isDynamic = (node) => {
      for (let parent = node; parent; parent = parent.parent) if (this.dynamicRoots.has(parent)) return true;
      return false;
    };
    const byMaterial = new Map();
    const remove = [];
    this.chassis.traverse((node) => {
      if (!node.isMesh || isDynamic(node)) return;
      const interior = this.interior ? isUnder(node, this.interior) : false;
      // Different primitive types carry different attribute sets; keep the ones every part has.
      let geometry = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
      for (const name of Object.keys(geometry.attributes)) {
        if (name !== 'position' && name !== 'normal' && name !== 'uv') geometry.deleteAttribute(name);
      }
      if (!geometry.attributes.uv) {
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2));
      }
      geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toChassis, node.matrixWorld));
      const key = `${node.material.uuid}|${interior ? 'i' : 'e'}`;
      if (!byMaterial.has(key)) byMaterial.set(key, { material: node.material, interior, geometries: [] });
      byMaterial.get(key).geometries.push(geometry);
      remove.push(node);
    });
    remove.forEach((node) => {
      node.parent.remove(node);
      node.geometry.dispose();
    });
    this.paintMeshes = [];
    byMaterial.forEach(({ material, interior, geometries }) => {
      const merged = mergeGeometries(geometries, false);
      geometries.forEach((geometry) => geometry.dispose());
      if (!merged) return;
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = `${interior ? 'Cockpit' : 'CarBody'}_${material.uuid.slice(0, 6)}`;
      mesh.castShadow = !interior && material !== this.glassMaterial;
      mesh.receiveShadow = !interior;
      (interior ? this.interior : this.chassis).add(mesh);
      if (!interior && material === this.bodyMaterial) this.paintMeshes.push(mesh);
    });
  }

  /** Paint finish: { color, metalness?, roughness? } (an entry of PAINT_OPTIONS). */
  setPaint(paint) {
    this.bodyMaterial.metalness = paint.metalness ?? 0.35;
    this.bodyMaterial.roughness = paint.roughness ?? 0.32;
    return this.setColor(paint.color);
  }

  setRimColor(color) {
    this.rimMaterial.color.set(color);
    return this;
  }

  /** Door number, one or two digits. */
  setNumber(number) {
    const text = String(number ?? '').replace(/\D/g, '').slice(0, 2) || '27';
    if (text === this.number) return this;
    this.number = text;
    const map = numberTexture(text);
    this.numberMaterial.map.dispose();
    this.numberMaterial.map = map;
    this.numberMaterial.needsUpdate = true;
    if (this.roofNumberMaterial) {
      this.roofNumberMaterial.map = map;
      this.roofNumberMaterial.needsUpdate = true;
    }
    if (this.plateMaterial) {
      this.plateMaterial.map.dispose();
      this.plateMaterial.map = plateTexture(text);
      this.plateMaterial.needsUpdate = true;
    }
    return this;
  }

  setColor(color) {
    this.color.set(color);
    this.bodyMaterial.color.copy(this.color);
    // Stripes stay readable on any paint: dark on light cars, light on dark ones.
    const luminance = this.color.r * 0.2126 + this.color.g * 0.7152 + this.color.b * 0.0722;
    this.stripeMaterial.color.setHex(luminance > 0.35 ? 0x1b1f24 : 0xeef1f4);
    return this;
  }

  setHeadlights(on) {
    if (this.headlightMaterial) this.headlightMaterial.emissiveIntensity = on ? 2.6 : 0.04;
    if (this.cabinLight) this.cabinLight.intensity = on ? 0.85 : 0.35;
    return this;
  }

  setSteering(value) {
    this.steering = value;
    this.wheelPivots.get('frontLeft').rotation.y = -value;
    this.wheelPivots.get('frontRight').rotation.y = -value;
    // Seen from the driver's seat (+z looking toward -z), a right turn is clockwise: negative about z.
    if (this.steeringWheel) this.steeringWheel.rotation.z = -value * 2.6;
  }

  setWheelSpin(key, value) {
    if (!this.wheels.has(key)) return;
    this.wheelSpin.set(key, value);
    this.wheels.get(key).rotation.x = -value;
  }

  addWheelSpin(key, delta) {
    const value = (this.wheelSpin.get(key) || 0) + delta;
    this.setWheelSpin(key, value);
    return value;
  }

  /** `compression` is in metres; a compressed spring moves the wheel up into the arch. */
  setSuspension(key, compression = 0) {
    const pivot = this.wheelPivots.get(key);
    if (!pivot) return;
    pivot.position.y = this.wheelCentreY + Math.max(-0.14, Math.min(0.14, compression));
  }

  setBodyDynamics({ roll = 0, pitch = 0, squat = 0 } = {}) {
    this.chassis.rotation.z = roll;
    this.chassis.rotation.x = pitch;
    this.chassis.position.y = this.chassisOffsetY + squat;
  }

  setBraking(isBraking) {
    this.tailMaterial.emissiveIntensity = isBraking ? 2.8 : 0.45;
    this.tailMaterial.color.setHex(isBraking ? 0xff2020 : 0x4a0505);
  }

  setReversing(isReversing) {
    this.reverseLampMaterial.emissiveIntensity = isReversing ? 2.4 : 0;
  }

  /** Live gauges: needles sweep, shift lights come on near the redline. */
  setTelemetry({ speedKmh = 0, rpm = 0, rpmMax = 7000 } = {}) {
    const tach = Math.min(1, Math.max(0, rpm / (rpmMax || 7000)));
    const speed = Math.min(1, Math.max(0, speedKmh / 180));
    if (this.tachNeedle) this.tachNeedle.rotation.z = 2.35 - 4.7 * tach;
    if (this.speedNeedle) this.speedNeedle.rotation.z = 2.35 - 4.7 * speed;
    if (this.shiftLightMaterial) {
      this.shiftLightMaterial.emissiveIntensity = tach > 0.92 ? 2.4 : tach > 0.8 ? 0.9 : 0.12;
    }
    return this;
  }

  setInteriorVisible(visible) {
    if (this.interior) this.interior.visible = Boolean(visible);
    return this;
  }

  getMountPoints() {
    return WHEEL_KEYS.map((key) => ({ key, position: this.wheelPivots.get(key).position.clone(), steer: key.startsWith('front'), drive: key.startsWith('rear') }));
  }

  dispose() {
    const geometries = new Set();
    this.traverse((node) => {
      if (node.geometry) geometries.add(node.geometry);
    });
    geometries.forEach((geometry) => geometry.dispose());
    new Set(this.materials).forEach((material) => material.dispose());
    this.cabinCutoutDepth?.dispose();
    this.numberMaterial?.map?.dispose();
    this.plateMaterial?.map?.dispose();
    this.textures.forEach((texture) => texture.dispose());
    this.materials.length = 0;
    this.textures.length = 0;
  }
}
