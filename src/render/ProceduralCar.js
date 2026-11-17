import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const WHEEL_KEYS = ['frontLeft', 'frontRight', 'rearLeft', 'rearRight'];

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

function numberTexture(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 160;
  const context = canvas.getContext('2d');
  context.fillStyle = '#f2f4f2';
  context.beginPath();
  context.roundRect(6, 6, 244, 148, 26);
  context.fill();
  context.fillStyle = '#121518';
  context.font = 'italic 900 118px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, 128, 86);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * A rally hatchback built from code: extruded body and glasshouse with cut wheel arches, spoked
 * wheels with calipers, lamps, wing, livery and a simple cockpit for the interior camera.
 * Static parts are merged per material; wheels and the steering wheel stay separate to animate.
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
    this.build();
  }

  material(parameters) {
    const material = new THREE.MeshStandardMaterial(parameters);
    this.materials.push(material);
    return material;
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

  build() {
    if (this.built) return this;
    this.built = true;
    const { width, wheelbase, track, wheelRadius, wheelWidth } = this.dimensions;

    const paint = this.material({ color: this.color, metalness: 0.35, roughness: 0.32 });
    this.bodyMaterial = paint;
    const trim = this.material({ color: 0x15171a, metalness: 0.25, roughness: 0.6 });
    const satin = this.material({ color: 0x24282d, metalness: 0.5, roughness: 0.45 });
    const glass = this.material({ color: 0x0b131c, metalness: 0.6, roughness: 0.06 });
    const lamp = this.material({ color: 0xfff6dc, emissive: 0xffe7b0, emissiveIntensity: 1.3, roughness: 0.15 });
    const tail = this.material({ color: 0x5c0808, emissive: 0xff1010, emissiveIntensity: 0.45, roughness: 0.3 });
    const reverse = this.material({ color: 0xdedede, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.2 });
    this.stripeMaterial = this.material({ color: 0x1b1f24, metalness: 0.3, roughness: 0.4 });
    const accent = this.material({ color: 0xc7ff52, emissive: 0x3a5a00, emissiveIntensity: 0.25, roughness: 0.45 });
    const dash = this.material({ color: 0x1e2226, roughness: 0.8 });
    const gauge = this.material({ color: 0x78d6ff, emissive: 0x2a8fd0, emissiveIntensity: 1.1, roughness: 0.3 });
    this.tailMaterial = tail;
    this.reverseLampMaterial = reverse;

    this.chassis = new THREE.Group();
    this.chassis.name = 'CarChassis';
    this.chassis.position.y = this.chassisOffsetY;
    this.add(this.chassis);

    // --- body shell and glasshouse
    this.paintMeshes.push(this.part(taper(extrudeProfile(bodyOutline(wheelbase), width, { bevel: 0.07 }), 0.55, 0.9, 0.05), paint));
    this.part(taper(extrudeProfile(GLASSHOUSE, width - 0.22, { bevel: 0.03 }), 0.8, 1.29, 0.18), glass);
    this.part(taper(extrudeProfile(ROOF, width - 0.42, { bevel: 0.025 }), 1.25, 1.32, 0.04), paint);

    // Pillars over the glass, following the glasshouse taper.
    const inset = (y) => (width / 2 - 0.13) * (1 - 0.18 * Math.min(1, Math.max(0, (y - 0.8) / 0.49)));
    for (const side of [-1, 1]) {
      const at = (z, y) => new THREE.Vector3(side * (inset(y) + 0.012), y, z);
      this.part(strut(at(-0.78, 0.82), at(-0.13, 1.27), 0.05, 0.09), paint);
      this.part(strut(at(0.32, 0.84), at(0.34, 1.28), 0.05, 0.12), paint);
      this.part(strut(at(0.95, 1.28), at(1.6, 0.96), 0.05, 0.16), paint);
      // Door shut lines and a sill stripe in the livery colour.
      this.box(0.012, 0.5, 0.012, side * (width / 2 + 0.005), 0.55, -0.73, trim);
      this.box(0.012, 0.5, 0.012, side * (width / 2 + 0.005), 0.55, 0.36, trim);
      this.box(0.02, 0.07, 1.62, side * (width / 2 + 0.006), 0.3, -0.02, accent);
      // Mirrors.
      this.box(0.07, 0.07, 0.07, side * (width / 2 - 0.03), 0.86, -0.66, trim);
      this.box(0.2, 0.12, 0.13, side * (width / 2 + 0.07), 0.9, -0.66, paint, { y: side * 0.12 });
      // Arch flares: dark lips that make the arches read from a distance.
      for (const z of [wheelbase / 2, -wheelbase / 2]) {
        const flare = new THREE.TorusGeometry(ARCH_RADIUS + 0.02, 0.035, 6, 18, Math.PI * 1.04);
        flare.rotateY(Math.PI / 2);
        flare.translate(side * (width / 2 - 0.02), ARCH_Y, z);
        this.part(flare, trim);
        // Mud flap behind each wheel.
        this.box(0.2, 0.2, 0.02, side * (track / 2), 0.12, z + 0.47, trim);
      }
    }

    // Livery: twin stripes over the bonnet, roof and hatch.
    const hoodSlope = Math.atan2(0.79 - 0.66, 2.05 - 1.0);
    for (const x of [-0.17, 0.17]) {
      this.box(0.16, 0.012, 1.08, x, 0.735, -1.52, this.stripeMaterial, { x: -hoodSlope });
      this.box(0.15, 0.012, 1.06, x, 1.317, 0.42, this.stripeMaterial);
    }
    // Door number boards.
    const numberMaterial = this.material({ map: numberTexture('27'), roughness: 0.5 });
    this.textures.push(numberMaterial.map);
    for (const side of [-1, 1]) {
      const plate = new THREE.PlaneGeometry(0.62, 0.39);
      plate.rotateY(side * Math.PI / 2);
      plate.translate(side * (width / 2 + 0.008), 0.56, -0.18);
      this.part(plate, numberMaterial);
    }

    // --- front
    this.box(1.0, 0.16, 0.06, 0, 0.38, -2.19, trim); // grille
    this.box(0.92, 0.02, 0.02, 0, 0.42, -2.225, satin);
    this.box(0.92, 0.02, 0.02, 0, 0.36, -2.225, satin);
    this.box(1.7, 0.05, 0.22, 0, 0.13, -2.1, trim); // splitter
    for (const side of [-1, 1]) {
      this.box(0.42, 0.1, 0.12, side * 0.6, 0.57, -2.12, lamp, { x: 0.5, y: -side * 0.18 });
      this.box(0.46, 0.13, 0.13, side * 0.6, 0.565, -2.105, trim, { x: 0.5, y: -side * 0.18 });
      const fog = new THREE.CylinderGeometry(0.06, 0.06, 0.05, 14);
      fog.rotateX(Math.PI / 2);
      fog.translate(side * 0.62, 0.3, -2.18);
      this.part(fog, lamp);
    }
    // Bonnet vents.
    for (const side of [-1, 1]) this.box(0.26, 0.02, 0.32, side * 0.36, 0.74, -1.42, trim, { x: -hoodSlope });

    // --- rear
    for (const side of [-1, 1]) {
      this.box(0.46, 0.13, 0.05, side * 0.6, 0.7, 2.1, tail, { y: side * 0.15 });
      this.box(0.12, 0.06, 0.04, side * 0.32, 0.46, 2.13, reverse);
      const exhaust = new THREE.CylinderGeometry(0.055, 0.06, 0.16, 14, 1, true);
      exhaust.rotateX(Math.PI / 2);
      exhaust.translate(side * 0.42, 0.2, 2.1);
      this.part(exhaust, satin);
    }
    this.box(0.7, 0.05, 0.04, 0, 0.72, 2.13, tail); // light bar
    this.box(1.6, 0.12, 0.12, 0, 0.17, 2.06, trim); // diffuser
    // Roof-mounted rally wing on two swan-neck stays.
    this.box(1.58, 0.035, 0.32, 0, 1.25, 1.86, trim, { x: -0.1 });
    for (const side of [-1, 1]) {
      this.box(0.03, 0.26, 0.36, side * 0.8, 1.21, 1.86, accent);
      this.part(strut(new THREE.Vector3(side * 0.42, 0.88, 1.66), new THREE.Vector3(side * 0.42, 1.24, 1.84), 0.04, 0.12), trim);
    }
    // Roof scoop and aerial.
    this.box(0.36, 0.07, 0.3, 0, 1.33, -0.02, trim);
    this.part(strut(new THREE.Vector3(0.3, 1.31, 0.8), new THREE.Vector3(0.34, 1.62, 0.92), 0.012), trim);

    // --- cockpit (seen through the glass and from the interior camera)
    this.cockpit = new THREE.Group();
    this.cockpit.name = 'RallyCockpit';
    this.chassis.add(this.cockpit);
    this.box(1.48, 0.16, 0.44, 0, 0.74, -0.56, dash, null, this.cockpit);
    this.box(1.4, 0.04, 0.36, 0, 0.83, -0.6, trim, null, this.cockpit);
    this.box(0.3, 0.11, 0.12, -0.37, 0.87, -0.43, trim, null, this.cockpit);
    for (const x of [-0.44, -0.3]) {
      const dial = new THREE.CylinderGeometry(0.045, 0.045, 0.012, 16);
      dial.rotateX(Math.PI / 2 - 0.35);
      dial.translate(x, 0.875, -0.365);
      this.part(dial, gauge, this.cockpit);
    }
    this.box(0.22, 0.12, 0.62, 0, 0.5, -0.05, dash, null, this.cockpit); // centre tunnel
    for (const side of [-1, 1]) {
      this.box(0.48, 0.12, 0.46, side * 0.37, 0.4, 0.2, dash, null, this.cockpit);
      this.box(0.48, 0.66, 0.12, side * 0.37, 0.72, 0.46, dash, { x: -0.12 }, this.cockpit);
    }
    // Roll cage hoop behind the seats.
    const hoop = [new THREE.Vector3(-0.68, 0.3, 0.66), new THREE.Vector3(-0.6, 1.2, 0.66), new THREE.Vector3(0.6, 1.2, 0.66), new THREE.Vector3(0.68, 0.3, 0.66)];
    for (let i = 0; i < 3; i += 1) this.part(strut(hoop[i], hoop[i + 1], 0.04), satin, this.cockpit);
    this.part(strut(new THREE.Vector3(-0.6, 1.2, 0.66), new THREE.Vector3(0.66, 0.32, 0.66), 0.035), satin, this.cockpit);

    this.steeringWheel = new THREE.Group();
    this.steeringWheel.name = 'SteeringWheel';
    this.steeringWheel.position.set(-0.37, 0.86, -0.26);
    this.steeringWheel.rotation.x = -0.32;
    this.cockpit.add(this.steeringWheel);
    this.part(new THREE.TorusGeometry(0.17, 0.022, 8, 24), trim, this.steeringWheel);
    this.box(0.3, 0.025, 0.02, 0, 0, 0, satin, null, this.steeringWheel);
    this.box(0.025, 0.16, 0.02, 0, -0.08, 0, satin, null, this.steeringWheel);
    this.box(0.03, 0.025, 0.025, 0, 0.17, 0.005, accent, null, this.steeringWheel); // top-dead-centre marker

    this.buildWheels();
    this.mergeStatic();
    return this;
  }

  buildWheels() {
    const { wheelbase, track, wheelRadius, wheelWidth } = this.dimensions;
    const tire = this.material({ color: 0x141517, metalness: 0, roughness: 0.92 });
    const rim = this.material({ color: 0xbfc4ca, metalness: 0.85, roughness: 0.3 });
    const caliper = this.material({ color: 0xd6242a, metalness: 0.3, roughness: 0.45 });

    // Tyre: a lathe of a rounded section, axis along x.
    const r = wheelRadius;
    const h = wheelWidth / 2;
    const section = [
      [r * 0.68, -h], [r - 0.035, -h], [r - 0.008, -h * 0.72], [r, -h * 0.25], [r, h * 0.25],
      [r - 0.008, h * 0.72], [r - 0.035, h], [r * 0.68, h],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const tireGeometry = new THREE.LatheGeometry(section, 28);
    tireGeometry.rotateZ(Math.PI / 2);

    // Rim: barrel, five spokes and a hub, one geometry. The outer face is at +x; mirrored for left wheels.
    const rimParts = [];
    const barrel = new THREE.CylinderGeometry(r * 0.69, r * 0.69, wheelWidth * 0.9, 24, 1, true);
    barrel.rotateZ(Math.PI / 2);
    rimParts.push(barrel);
    const face = new THREE.RingGeometry(r * 0.6, r * 0.69, 24);
    face.rotateY(Math.PI / 2);
    face.translate(h * 0.82, 0, 0);
    rimParts.push(face);
    for (let k = 0; k < 5; k += 1) {
      const spoke = new THREE.BoxGeometry(0.03, r * 0.56, 0.065);
      spoke.translate(h * 0.72, r * 0.3, 0);
      spoke.rotateX((k / 5) * Math.PI * 2);
      rimParts.push(spoke);
    }
    const hub = new THREE.CylinderGeometry(r * 0.16, r * 0.16, 0.05, 12);
    hub.rotateZ(Math.PI / 2);
    hub.translate(h * 0.76, 0, 0);
    rimParts.push(hub);
    const rimGeometry = mergeGeometries(rimParts.map((g) => g.toNonIndexed()), false);
    rimParts.forEach((g) => g.dispose());
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
      pivot.add(wheel);
      // Calipers do not spin: they hang off the pivot, just inside the spokes.
      const caliperMesh = this.part(caliperGeometry, caliper, pivot);
      caliperMesh.position.set(outward * h * 0.42, r * 0.36, key.startsWith('front') ? -0.07 : 0.07);
      this.add(pivot);
      this.wheels.set(key, wheel);
      this.wheelPivots.set(key, pivot);
      this.wheelSpin.set(key, 0);
    });
  }

  /**
   * Fold every static chassis part into one mesh per material: the body is made of ~80 primitives,
   * which would otherwise cost two draw calls each (colour and shadow pass). The steering wheel
   * stays separate because it turns.
   */
  mergeStatic() {
    this.updateMatrixWorld(true);
    const toChassis = new THREE.Matrix4().copy(this.chassis.matrixWorld).invert();
    const byMaterial = new Map();
    const remove = [];
    this.chassis.traverse((node) => {
      if (!node.isMesh) return;
      for (let parent = node.parent; parent && parent !== this.chassis; parent = parent.parent) {
        if (parent === this.steeringWheel) return;
      }
      // Different primitive types carry different attribute sets; keep the ones every part has.
      let geometry = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
      for (const name of Object.keys(geometry.attributes)) {
        if (name !== 'position' && name !== 'normal' && name !== 'uv') geometry.deleteAttribute(name);
      }
      if (!geometry.attributes.uv) {
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2));
      }
      geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toChassis, node.matrixWorld));
      if (!byMaterial.has(node.material)) byMaterial.set(node.material, []);
      byMaterial.get(node.material).push(geometry);
      remove.push(node);
    });
    remove.forEach((node) => {
      node.parent.remove(node);
      node.geometry.dispose();
    });
    this.paintMeshes = [];
    byMaterial.forEach((geometries, material) => {
      const merged = mergeGeometries(geometries, false);
      geometries.forEach((geometry) => geometry.dispose());
      if (!merged) return;
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = `CarBody_${material.uuid.slice(0, 6)}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.chassis.add(mesh);
      if (material === this.bodyMaterial) this.paintMeshes.push(mesh);
    });
  }

  setColor(color) {
    this.color.set(color);
    this.bodyMaterial.color.copy(this.color);
    // Stripes stay readable on any paint: dark on light cars, light on dark ones.
    const luminance = this.color.r * 0.2126 + this.color.g * 0.7152 + this.color.b * 0.0722;
    this.stripeMaterial.color.setHex(luminance > 0.35 ? 0x1b1f24 : 0xeef1f4);
    return this;
  }

  setSteering(value) {
    this.steering = value;
    this.wheelPivots.get('frontLeft').rotation.y = -value;
    this.wheelPivots.get('frontRight').rotation.y = -value;
    // Seen from the driver's seat (+z looking toward -z), a right turn is clockwise: negative about z.
    this.steeringWheel.rotation.z = -value * 2.6;
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
    this.tailMaterial.color.setHex(isBraking ? 0xff2020 : 0x5c0808);
  }

  setReversing(isReversing) {
    this.reverseLampMaterial.emissiveIntensity = isReversing ? 2.4 : 0;
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
    this.textures.forEach((texture) => texture.dispose());
    this.materials.length = 0;
  }
}
