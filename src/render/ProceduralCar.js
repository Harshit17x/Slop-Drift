import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PAINT_MODES, patchCarPaint, setCarPaintUniforms } from './carPaintShader.js';
import { patchUnderglow } from './underglowLight.js';
import { rallyLivery, rallyPart, textureRallySurface, tyreCoat } from './RallyKit.js';
import { SURFACE } from '../config.js';
import { frontWheelAngle } from '../vehicle/steering.js';

/** Underglow light output per metre of LED strip at full (night) level. */
const UNDERGLOW_POWER = 10;

const WHEEL_KEYS = ['frontLeft', 'frontRight', 'rearLeft', 'rearRight'];

// Side silhouettes in chassis space as [z, y] pairs, front of the car toward -z.
// The chassis group sits `chassisOffsetY` above the car origin (ground level at rest).
const GLASSHOUSE = [[-0.88, 0.82], [-0.29, 1.33], [-0.13, 1.37], [1.40, 1.37], [1.54, 1.30], [1.99, 0.962], [1.54, 0.914]];
const ROOF = [[-0.31, 1.318], [-0.11, 1.398], [1.37, 1.398], [1.58, 1.315], [1.48, 1.305], [1.32, 1.345], [-0.13, 1.345]];
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

/** Loft the pressed bodywork over both wheel openings. Each station carries a sill,
 * shoulder crease and crowned bonnet; the arch openings are cut into the actual silhouette. */
function stageShell(width, wheelbase) {
  const roofline = [[-2.22,.62],[-2.07,.68],[-1.48,.766],[-.86,.832],
    [.45,.874],[1.28,.942],[1.75,.985],[2.05,.933],[2.16,.83]];
  const stations = new Set(roofline.map(([z]) => z));
  for (let i = 0; i <= 82; i++) stations.add(-2.22 + 4.38 * i / 82);
  for (const axle of [-wheelbase / 2, wheelbase / 2]) {
    for (let i = 0; i <= 32; i++) stations.add(axle + 0.435 * Math.cos(i * Math.PI / 32));
  }
  const rings = [...stations].sort((a,b) => a-b).map(z => {
    const next = roofline.findIndex(([end]) => z < end);
    const floor = next < 0 ? roofline.length - 2 : Math.max(0, next - 1);
    const [za, ya] = roofline[floor], [zb, yb] = roofline[floor + 1];
    const crown = THREE.MathUtils.lerp(ya, yb, (z - za) / (zb - za));
    const gap = Math.abs(Math.abs(z) - wheelbase / 2);
    const arch = gap < 0.435 ? 0.222 + Math.sqrt(0.435 ** 2 - gap ** 2) : 0.158;
    const bulge = Math.exp(-((gap / 0.46) ** 2));
    const w = width / 2 + 0.044 * bulge - 0.081 * THREE.MathUtils.smoothstep(Math.abs(z), 1.67, 2.22);
    const side = [[w-.038,arch], [w-.014,arch+.025], [w,Math.max(arch+.034,crown-.168)],
      [w-.012,crown-.061], [w-.068,crown-.008], [w-.172,crown+.016]];
    const half = side.map(([x,y]) => [x,y,z]);
    return [...half, [0,crown+.023,z], ...half.slice().reverse().map(([x,y]) => [-x,y,z])];
  });
  const pos=[], uv=[], index=[];
  const vertex = ([x,y,z]) => { pos.push(x,y,z); uv.push(z*1.7,(y+x)*1.7); return pos.length/3 - 1; };
  for (let edge=0; edge<rings[0].length-1; edge++) {
    let last;
    for (const ring of rings) {
      // Leave an opening underneath the glasshouse between the cowl and the parcel shelf.
      if ((edge === 5 || edge === 6) && ring[0][2] > -0.82 && ring[0][2] < 1.68) {
        last = undefined;
        continue;
      }
      const a=vertex(ring[edge]), b=vertex(ring[edge+1]);
      if (last !== undefined) index.push(last,last+1,b,last,b,a);
      last=a;
    }
  }
  for (const [ring,front] of [[rings[0],true],[rings.at(-1),false]]) {
    const centre=vertex([0,(ring[0][1]+ring[6][1])/2,ring[0][2]]);
    const ends=ring.map(vertex);
    for (let i=0;i<ends.length;i++) {
      const a=ends[i], b=ends[(i+1)%ends.length];
      index.push(centre,front?b:a,front?a:b);
    }
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos,3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv,2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
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
    const layout = options.wheelLayout?.length === 4 ? options.wheelLayout : null;
    this.dimensions = {
      length: 4.33,
      width: options.width ?? 1.8,
      wheelbase: layout ? Math.abs(layout[2].z - layout[0].z) : options.wheelbase ?? 2.55,
      track: layout ? Math.abs(layout[1].x - layout[0].x) : options.track ?? 1.686,
      wheelRadius: options.wheelRadius ?? 0.366,
      wheelWidth: options.wheelWidth ?? 0.254,
    };
    this.chassisOffsetY = options.chassisOffsetY ?? 0.13;
    this.wheelCentreY = options.wheelCentreY ?? 0.366;
    this.wheels = new Map();
    this.wheelPivots = new Map();
    this.wheelSpin = new Map();
    this.steering = 0;
    this.materials = [];
    this.textures = [];
    this.paintMeshes = [];
    this.number = String(options.number ?? '27');
    this.options = options; // subclasses (ModelCar) read their model from here in build()
    this.build(layout);
    this.buildUnderglow();
  }

  material(parameters) {
    const material = patchUnderglow(new THREE.MeshStandardMaterial(parameters));
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

  build(layout) {
    if (this.built) return this;
    this.built = true;
    const { width, wheelbase, track, wheelRadius, wheelWidth } = this.dimensions;

    const paint = patchUnderglow(patchCarPaint(new THREE.MeshPhysicalMaterial({
      color: this.color,
      metalness: 0.35,
      roughness: 0.2,
      clearcoat: 0.9,
      clearcoatRoughness: 0.06,
      envMapIntensity: 1.2,
    }), { mode: PAINT_MODES.SOLID_PAINT, paint: this.color, flake: 0.18, blend: 0.65, vertexAoStrength: 0 }));
    this.materials.push(paint);
    this.bodyMaterial = paint;
    const trim = this.material({ color: 0x15171a, metalness: 0.25, roughness: 0.6 });
    const satin = this.material({ color: 0x24282d, metalness: 0.5, roughness: 0.45 });
    const glass = this.material({ color: 0x25353e, metalness: 0.16, roughness: 0.09, transparent: true, opacity: 0.41, depthWrite: false });
    const lamp = this.material({ color: 0xfff6dc, emissive: 0xffe7b0, emissiveIntensity: 1.3, roughness: 0.15 });
    const tail = this.material({ color: 0x5c0808, emissive: 0xff1010, emissiveIntensity: 0.45, roughness: 0.3 });
    const reverse = this.material({ color: 0xdedede, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.2 });
    this.stripeMaterial = this.material({ color: 0x1b1f24, metalness: 0.3, roughness: 0.4 });
    const accent = this.material({ color: 0xc63d21, emissive: 0x000000, emissiveIntensity: 0, roughness: 0.45 });
    const dash = this.material({ color: 0x1e2226, roughness: 0.8 });
    const gauge = this.material({ color: 0x78d6ff, emissive: 0x2a8fd0, emissiveIntensity: 1.1, roughness: 0.3 });
    textureRallySurface(trim, 'Carbon');
    textureRallySurface(satin, 'Steel');
    textureRallySurface(dash, 'Flock');
    textureRallySurface(accent, 'Vermilion');
    rallyLivery(paint);
    rallyLivery(trim, false);
    this.tailMaterial = tail;
    this.reverseLampMaterial = reverse;

    this.chassis = new THREE.Group();
    this.chassis.name = 'CarChassis';
    this.chassis.position.y = this.chassisOffsetY;
    this.add(this.chassis);

    // --- body shell and glasshouse
    this.paintMeshes.push(this.part(stageShell(width, wheelbase), paint));
    this.box(1.37, 0.05, 3.87, 0, 0.18, 0, trim);
    this.box(1.47, 0.035, 0.47, 0, 0.90, 1.55, trim);
    this.part(taper(extrudeProfile(GLASSHOUSE, width - 0.22, { bevel: 0.03 }), 0.8, 1.29, 0.18), glass);
    this.part(taper(extrudeProfile(ROOF, width - 0.42, { bevel: 0.025 }), 1.25, 1.32, 0.04), paint);

    // Pillars over the glass, following the glasshouse taper.
    const inset = (y) => (width / 2 - 0.13) * (1 - 0.18 * Math.min(1, Math.max(0, (y - 0.8) / 0.49)));
    for (const side of [-1, 1]) {
      const at = (z, y) => new THREE.Vector3(side * (inset(y) + 0.012), y, z);
      this.part(strut(at(-0.88, 0.82), at(-0.28, 1.34), 0.05, 0.09), paint);
      this.part(strut(at(0.42, 0.865), at(0.41, 1.37), 0.05, 0.12), paint);
      this.part(strut(at(1.45, 1.35), at(1.97, 0.975), 0.05, 0.16), paint);
      // Door shut lines and a sill stripe in the livery colour.
      this.box(0.012, 0.5, 0.012, side * (width / 2 + 0.005), 0.55, -0.73, trim);
      this.box(0.012, 0.5, 0.012, side * (width / 2 + 0.005), 0.55, 0.36, trim);
      this.box(0.02, 0.07, 1.62, side * (width / 2 + 0.006), 0.3, -0.02, accent);
      this.box(0.031, 0.032, 0.134, side * 0.891, 0.782, 0.215, satin);
      // Mirrors.
      this.box(0.07, 0.07, 0.07, side * (width / 2 - 0.03), 0.86, -0.66, trim);
      this.box(0.18, 0.099, 0.16, side * (width / 2 + 0.07), 0.9, -0.66, paint, { y: side * 0.12 });
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
    for (const x of [-0.43, 0.43]) {
      this.box(0.086, 0.012, 1.08, x, 0.784, -1.52, this.stripeMaterial, { x: -hoodSlope });

    }
    for (const x of [-0.36, 0.22]) {
      this.box(0.51, 0.012, 0.018, x, 0.858, -0.857, trim, { y: 0.13 });
    }
    // Door number boards.
    const numberMaterial = this.material({ map: numberTexture(this.number), roughness: 0.5 });
    this.numberMaterial = numberMaterial;
    for (const side of [-1, 1]) {
      const plate = new THREE.PlaneGeometry(0.62, 0.39);
      plate.rotateY(side * Math.PI / 2);
      plate.translate(side * (width / 2 + 0.015), 0.56, -0.18);
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
    for (const side of [-1, 1]) {
      for (const y of [0.694, 0.77]) this.box(0.267, 0.014, 0.007, side * 0.682, y, 2.22, tail);
      this.box(0.084, 0.027, 0.016, side * 0.465, 0.481, 2.171, reverse);
    }
    this.box(1.6, 0.12, 0.12, 0, 0.17, 2.06, trim); // diffuser
    // Roof-mounted rally wing on two swan-neck stays.
    this.box(1.58, 0.035, 0.32, 0, 1.31, 1.86, trim, { x: -0.1 });
    for (const side of [-1, 1]) {

      this.part(strut(new THREE.Vector3(side * 0.42, 0.88, 1.66), new THREE.Vector3(side * 0.42, 1.31, 1.84), 0.04, 0.12), trim);
    }
    // Roof scoop and aerial.
    this.box(0.36, 0.07, 0.3, 0, 1.405, -0.02, trim);
    this.part(strut(new THREE.Vector3(0.3, 1.406, 0.8), new THREE.Vector3(0.34, 1.62, 0.92), 0.012), trim);

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

    for (const side of [-1, 1]) {
      const pillar = new THREE.Vector3(side * 0.57, 1.27, -0.20);
      const hoopTop = new THREE.Vector3(side * 0.60, 1.23, 0.66);
      this.part(strut(pillar, hoopTop, 0.041), satin, this.cockpit);
      this.part(strut(pillar, new THREE.Vector3(side * 0.70, 0.64, -0.73), 0.041), satin, this.cockpit);
      this.part(strut(hoopTop, new THREE.Vector3(side * 0.64, 0.38, 1.61), 0.044), satin, this.cockpit);
    }

    this.steeringWheel = new THREE.Group();
    this.steeringWheel.name = 'SteeringWheel';
    this.steeringWheel.position.set(-0.37, 0.86, -0.26);
    this.steeringWheel.rotation.x = -0.32;
    this.cockpit.add(this.steeringWheel);
    this.part(new THREE.TorusGeometry(0.17, 0.022, 8, 24), trim, this.steeringWheel);
    this.box(0.3, 0.025, 0.02, 0, 0, 0, satin, null, this.steeringWheel);
    this.box(0.025, 0.16, 0.02, 0, -0.08, 0, satin, null, this.steeringWheel);
    this.box(0.03, 0.025, 0.025, 0, 0.17, 0.005, accent, null, this.steeringWheel); // top-dead-centre marker

    this.buildWheels(layout);
    this.mergeStatic();
    this.rallyParts = [];
    for (const name of ['StageExterior', 'StageCabin']) {
      const kit = rallyPart(name, this.materials);
      if (kit) {
        this.chassis.add(kit);
        this.rallyParts.push(kit);
      }
    }
    return this;
  }

  buildWheels(layout) {
    const { wheelbase, track, wheelRadius, wheelWidth } = this.dimensions;
    const tire = this.material({ color: 0x141517, metalness: 0, roughness: 0.92 });
    textureRallySurface(tire, 'Rubber');
    const rim = this.material({ color: 0xbfc4ca, metalness: 0.85, roughness: 0.3 });
    this.rimMaterial = rim;
    const caliper = this.material({ color: 0xd6242a, metalness: 0.3, roughness: 0.45 });

    // Normalized section reduced in Blender from the driving mesh. Revolve once for all four tyres.
    const r = wheelRadius;
    const h = wheelWidth / 2;
    const section = [
      [0.59, -1], [0.89706, -1], [0.97647, -0.72], [1, 0],
      [0.97647, 0.72], [0.89706, 1], [0.59, 1],
    ].map(([radius, width]) => new THREE.Vector2(radius * r, width * h));
    const carcass = new THREE.LatheGeometry(section, 48);
    carcass.rotateZ(Math.PI / 2);
    // Interlocking shoulder blocks follow the tyre radius and rotate on the same pivot as the carcass.
    const pieces = [carcass.toNonIndexed()];
    for (let i = 0; i < 32; i++) {
      for (const row of [-1, 0, 1]) {
        const angle = (i + (row === 0 ? 0.45 : 0)) * Math.PI / 16;
        const lug = new THREE.BoxGeometry(0.073, 0.020, 0.050).toNonIndexed();
        lug.rotateY(row * 0.27);
        lug.translate(row * h * 0.54, r * (row ? 0.978 : 0.988), 0);
        lug.rotateX(angle);
        const pos = lug.attributes.position;
        for (let k = 0; k < pos.count; k++) {
          const u = (Math.atan2(pos.getZ(k), pos.getY(k)) / (2 * Math.PI) + 1) % 1;
          lug.attributes.uv.setXY(k, u, 0.5 - pos.getX(k) / (3 * h));
        }
        pieces.push(lug);
      }
    }
    const tireGeometry = mergeGeometries(pieces, false);
    carcass.dispose();
    pieces.forEach(piece => piece.dispose());

    // Rim: barrel, five spokes and a hub, one geometry. The outer face is at +x; mirrored for left wheels.
    const rimParts = [];
    const barrel = new THREE.CylinderGeometry(r * 0.605, r * 0.605, wheelWidth * 0.9, 24, 1, true);
    barrel.rotateZ(Math.PI / 2);
    rimParts.push(barrel);
    const face = new THREE.RingGeometry(r * 0.515, r * 0.605, 24);
    face.rotateY(Math.PI / 2);
    face.translate(h * 0.82, 0, 0);
    rimParts.push(face);
    for (let k = 0; k < 10; k += 1) {
      const spoke = new THREE.BoxGeometry(0.03, r * 0.48, 0.046);
      spoke.translate(h * 0.72, r * 0.295, 0);
      spoke.rotateX((k / 10) * Math.PI * 2);
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
    this.tyreCoats = new Map();
    WHEEL_KEYS.forEach((key, i) => {
      const [x, z] = positionsByKey[key];
      const outward = Math.sign(x);
      const pivot = new THREE.Group();
      pivot.name = `${key}_pivot`;
      pivot.position.set(x, this.wheelCentreY, z);
      if (layout) pivot.position.copy(layout[i]);
      pivot.userData.restY = pivot.position.y;
      const wheel = new THREE.Group();
      wheel.name = `${key}_wheel`;
      const rubber = i === 0 ? tire : textureRallySurface(this.material({ color: 0x141517, roughness: 0.92 }), 'Rubber');
      this.tyreCoats.set(key, tyreCoat(rubber));
      this.part(tireGeometry, rubber, wheel);
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

  /**
   * Neon underglow: four LED strips tucked under the sills and bumpers. The strips themselves are
   * thin emissive tubes; the light they throw on the road, verges and tyres is real shading (see
   * underglowLight.js), fed from writeUnderglow every frame. Off until setUnderglow.
   */
  buildUnderglow() {
    const { width, wheelbase } = this.dimensions;
    this.underglow = { option: null, level: 0, grounded: 1, hue: 0 };
    this.glowColor = new THREE.Color();
    this.glowTube = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false });
    // Strip end points in chassis space: between the wheel arches on each side, and across both bumpers.
    const y = this.options.underglowY ?? 0.07;
    const side = width / 2 - 0.17;
    const run = wheelbase / 2 - 0.47;
    const front = -wheelbase / 2 - 0.62;
    const rear = wheelbase / 2 + 0.56;
    this.glowStrips = [
      [new THREE.Vector3(-side, y, -run), new THREE.Vector3(-side, y, run)],
      [new THREE.Vector3(side, y, -run), new THREE.Vector3(side, y, run)],
      [new THREE.Vector3(-0.5, y, front), new THREE.Vector3(0.5, y, front)],
      [new THREE.Vector3(-0.5, y, rear), new THREE.Vector3(0.5, y, rear)],
    ];
    const tubes = this.glowStrips.map(([a, b]) => {
      const length = a.distanceTo(b);
      const g = new THREE.CapsuleGeometry(0.012, length, 3, 6);
      g.rotateZ(Math.PI / 2); // along x
      if (Math.abs(b.z - a.z) > Math.abs(b.x - a.x)) g.rotateY(Math.PI / 2);
      g.translate((a.x + b.x) / 2, y, (a.z + b.z) / 2);
      return g;
    });
    this.glowTubes = new THREE.Mesh(mergeGeometries(tubes), this.glowTube);
    tubes.forEach((g) => g.dispose());
    this.glowTubes.name = 'UnderglowStrips';
    this.glowTubes.visible = false;
    this.chassis.add(this.glowTubes);
    this.glowCentre = new THREE.Vector3(0, y, 0);
    this.glowCentreWorld = new THREE.Vector3();
  }

  /** Underglow colour: { color, cycle? } (an entry of NEON_OPTIONS), or null / color null for off. */
  setUnderglow(option) {
    const on = Boolean(option && (option.cycle || Number.isFinite(option.color)));
    this.underglow.option = on ? option : null;
    if (on && !option.cycle) this.glowColor.setHex(option.color);
    this.applyUnderglow();
    return this;
  }

  /** How strongly it shows: 1 at night, low in daylight, 0 switched off. */
  setUnderglowLevel(level) {
    this.underglow.level = Math.max(0, Math.min(1, level));
    this.applyUnderglow();
    return this;
  }

  get underglowOn() {
    return Boolean(this.underglow.option) && this.underglow.level > 0;
  }

  /**
   * Per frame: the colour cycle, and the light dimming as the car leaves the ground (the road is
   * simply further from the strips, which the inverse-square law already handles; this only avoids a
   * glow that pops when a car lands).
   * @param {number} dt
   * @param {number} [grounded]  0..1, share of wheels touching the ground.
   */
  updateUnderglow(dt, grounded = 1) {
    const glow = this.underglow;
    if (!glow.option) return;
    glow.grounded += (Math.max(0, Math.min(1, grounded)) * 0.4 + 0.6 - glow.grounded) * Math.min(1, dt * 8);
    if (glow.option.cycle) {
      glow.hue = (glow.hue + dt * 0.12) % 1;
      this.glowColor.setHSL(glow.hue, 1, 0.5);
      this.applyUnderglow();
    }
  }

  applyUnderglow() {
    const on = this.underglowOn;
    this.glowTubes.visible = on;
    if (on) this.glowTube.color.copy(this.glowColor).multiplyScalar(0.6 + 2.4 * this.underglow.level);
  }

  /**
   * Write this car's strips (world space) for the underglow light. Returns false when it is not lit.
   * @param {THREE.Vector4} sphere  Centre at strip height, and the radius beyond which it adds nothing.
   * @param {THREE.Vector3} up      The car's up axis.
   * @param {THREE.Color} color     Light colour times intensity.
   * @param {THREE.Vector3[]} a     Segment starts (written at offset..offset+3).
   * @param {THREE.Vector3[]} b     Segment ends.
   * @param {number} offset
   */
  writeUnderglow(sphere, up, color, a, b, offset) {
    if (!this.underglowOn || !this.visible) return false;
    this.chassis.updateWorldMatrix(true, false);
    const matrix = this.chassis.matrixWorld;
    for (let k = 0; k < 4; k += 1) {
      a[offset + k].copy(this.glowStrips[k][0]).applyMatrix4(matrix);
      b[offset + k].copy(this.glowStrips[k][1]).applyMatrix4(matrix);
    }
    const centre = this.glowCentreWorld.copy(this.glowCentre).applyMatrix4(matrix);
    sphere.set(centre.x, centre.y, centre.z, 6.5);
    up.setFromMatrixColumn(matrix, 1).normalize();
    const glow = this.underglow;
    // Light output per metre of strip. Squared level: dusk and day barely show it, night is vivid.
    color.copy(this.glowColor).multiplyScalar(UNDERGLOW_POWER * glow.level * glow.level * glow.grounded);
    return true;
  }

  /** Paint finish: { color, metalness?, roughness?, clearcoat?, creviceColor?, flopColor?, flake?, blend? } (an entry of PAINT_OPTIONS). */
  setPaint(paint) {
    if (paint.id === 'pearl') paint = { ...paint, color: 0xf0e5cc, creviceColor: 0xb8a98c, flopColor: 0xfff8e8, roughness: 0.31 };
    this.setColor(paint.color);
    this.bodyMaterial.metalness = paint.metalness ?? 0.35;
    this.bodyMaterial.roughness = paint.roughness ?? 0.2;
    if ('clearcoat' in this.bodyMaterial) this.bodyMaterial.clearcoat = paint.clearcoat ?? 0.9;
    setCarPaintUniforms(this.bodyMaterial, { paint });
    return this;
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
    this.numberMaterial.map.dispose();
    this.numberMaterial.map = numberTexture(text);
    this.numberMaterial.needsUpdate = true;
    return this;
  }

  setColor(color) {
    this.color.set(color);
    this.bodyMaterial.color.copy(this.color);
    setCarPaintUniforms(this.bodyMaterial, { color: this.color });
    this.stripeMaterial.color.setHex(0xca391c);
    return this;
  }

  setSteering(value) {
    this.steering = value;
    for (let i = 0; i < 2; i++) {
      const pivot = this.wheelPivots.get(WHEEL_KEYS[i]);
      pivot.rotation.y = -frontWheelAngle(value, pivot.position.x, this.dimensions.wheelbase);
    }
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
    pivot.position.y = pivot.userData.restY + compression;
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

  setTyreSurface(key, wheel, speed, dt) {
    const coat = this.tyreCoats?.get(key);
    if (!coat || !wheel.contact) return;
    const target = wheel.surface === SURFACE.MUD ? 1 :
      wheel.surface === SURFACE.DIRT || wheel.surface === SURFACE.GRAVEL ? 0.32 : 0;
    const distance = Math.abs(speed) * dt;
    const pickup = target > coat.value ? 0.09 : 0.014;
    coat.value += (target - coat.value) * (1 - Math.exp(-distance * pickup));
  }

  setQuality(quality) {
    const shadows = !quality || quality.shadowMapSize > 0;
    this.traverse((node) => {
      if (!node.isMesh) return;
      if (node.userData.baseCastShadow === undefined) node.userData.baseCastShadow = node.castShadow;
      if (node.userData.baseReceiveShadow === undefined) node.userData.baseReceiveShadow = node.receiveShadow;
      node.castShadow = shadows && Boolean(node.userData.baseCastShadow);
      node.receiveShadow = shadows && Boolean(node.userData.baseReceiveShadow);
    });
    return this;
  }

  getMountPoints() {
    return WHEEL_KEYS.map((key) => ({ key, position: this.wheelPivots.get(key).position.clone(), steer: key.startsWith('front'), drive: !this.carDef || Boolean(this.carDef.tuning?.drivetrain?.awd) || key.startsWith('rear') }));
  }

  dispose() {
    for (const part of this.rallyParts || []) part.removeFromParent();
    const geometries = new Set();
    this.traverse((node) => {
      if (node.geometry) geometries.add(node.geometry);
    });
    geometries.forEach((geometry) => geometry.dispose());
    new Set(this.materials).forEach((material) => material.dispose());
    this.numberMaterial?.map?.dispose();
    this.glowTube?.dispose();
    this.textures.forEach((texture) => texture.dispose());
    this.materials.length = 0;
  }
}
