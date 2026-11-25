import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { hasRallyKit, loadRallyKit } from './RallyKit.js';
import { ProceduralCar } from './ProceduralCar.js';
import { PAINT_MODES, patchCarPaint, setCarPaintUniforms } from './carPaintShader.js';
import { patchUnderglow } from './underglowLight.js';
import { CARS, getCar } from '../vehicle/cars.js';

// Cars built in Blender (tools/blender/cars/): a GLB with nodes body, wheel_FL, wheel_FR, wheel_RL,
// wheel_RR in the game's frame (metres, front toward -Z, wheels on y = 0). ModelCar keeps the
// ProceduralCar interface (steering, wheel spin, suspension, paint, underglow), so CarVisual,
// RemotePlayers and the network code treat every car the same.

const WHEEL_NODES = { frontLeft: 'wheel_FL', frontRight: 'wheel_FR', rearLeft: 'wheel_RL', rearRight: 'wheel_RR' };
const templates = new Map();

const loading = new Map();
let rallyKitLoading = null;

/**
 * Load car models once (all of them, or just `ids`); concurrent calls share the download.
 * Failures fall back to the procedural car.
 * @param {string[]} [ids]
 */
export function loadCarModels(ids) {
  const loader = new GLTFLoader();
  const wanted = CARS.filter((car) => car.model && (!ids || ids.includes(car.id)));
  const tasks = wanted.map((car) => {
    if (!loading.has(car.id)) {
      loading.set(car.id, loader.loadAsync(car.model)
        .then((gltf) => templates.set(car.id, gltf.scene))
        .catch((error) => {
          loading.delete(car.id);
          console.warn(`[cars] ${car.id} model failed to load`, error);
        }));
    }
    return loading.get(car.id);
  });
  if (!ids || ids.includes('hatch')) {
    rallyKitLoading ??= loadRallyKit(loader)
      .catch((error) => {
        rallyKitLoading = null;
        console.warn('[cars] rally kit failed to load', error);
      });
    tasks.push(rallyKitLoading);
  }
  return Promise.all(tasks);
}

/** True once this car's model is loaded and createCarModel will build its final visual. */
export function hasCarModel(carId) {
  const car = getCar(carId);
  return car.model ? templates.has(car.id) : hasRallyKit();
}

/**
 * The visual for a car id: a ModelCar when its model has loaded, else the procedural rally hatch.
 * @param {string} carId
 * @param {object} options  ProceduralCar options (color, name, wheelLayout).
 */
export function createCarModel(carId, options = {}) {
  const car = getCar(carId);
  const template = templates.get(car.id);
  const model = !car.model || !template
    ? new ProceduralCar(options)
    : new ModelCar({ ...options, car, template, chassisOffsetY: 0, underglowY: car.cockpit === 'suv' ? 0.36 : 0.12 });
  model.userData.visualCarId = car.id;
  model.userData.visualReady = hasCarModel(car.id);
  return model;
}

/**
 * This instance's copy of a model material, with the car's finish applied (cars.js `finish`, by
 * material name, or `scan` for a baked-texture car): clear-coated paint, gloss trim, satin rubber,
 * alloy, lamps and glass. Materials without an entry are cleaned up for the export quirks below.
 */
function finishMode(spec) {
  if (spec === 'maskedBody') return PAINT_MODES.MASKED_BODY;
  if (spec === 'maskedRim') return PAINT_MODES.MASKED_RIM;
  if (spec === 'solid') return PAINT_MODES.SOLID_PAINT;
  return PAINT_MODES.TRIM_ONLY;
}

function makeFinish(material, car, hasVertexColors) {
  const name = material.name.replace(/\.\d+$/, '');
  const finish = car.bakedTexture ? car.finish?.scan : car.finish?.[name];
  let copy;
  if (finish) {
    const mode = finishMode(finish.paintMode);
    const useAo = Boolean(hasVertexColors && finish.vertexAoStrength > 0);
    copy = new THREE.MeshPhysicalMaterial({
      name: material.name,
      map: car.bakedTexture ? material.emissiveMap || material.map : material.map,
      aoMap: finish.aoMapIntensity ? material.aoMap || material.roughnessMap : null,
      aoMapIntensity: finish.aoMapIntensity ?? 1,
      roughnessMap: material.roughnessMap,
      metalnessMap: material.metalnessMap,
      emissiveMap: material.emissiveMap,
      color: finish.color ?? material.color,
      metalness: finish.metalness ?? 0,
      roughness: finish.roughness ?? 0.6,
      clearcoat: finish.clearcoat ?? 0,
      clearcoatRoughness: finish.clearcoatRoughness ?? 0.1,
      emissive: finish.emissive ?? 0x000000,
      emissiveIntensity: finish.emissiveIntensity ?? 1,
      envMapIntensity: finish.envMapIntensity ?? 1,
      transparent: Boolean(finish.transparent),
      opacity: finish.opacity ?? 1,
      depthWrite: !finish.transparent,
      vertexColors: useAo,
    });
    copy.userData.role = finish.role || null;
    copy.userData.lens = Boolean(finish.lens || finish.role === 'lens');
    copy.userData.paintMode = mode;
    copy.userData.paintDefaults = finish;
    copy.userData.idleEmissive = finish.emissiveIntensity ?? 0.15;

    if (finish.paintMode || useAo || finish.grainStrength) {
      patchCarPaint(copy, {
        mode,
        paintMetalness: finish.defaultMetalness ?? finish.metalness ?? 0.35,
        paintRoughness: finish.defaultRoughness ?? finish.roughness ?? 0.18,
        paintClearcoat: finish.clearcoat ?? 0.9,
        rimMetalness: finish.rimMetalness ?? 0.88,
        rimRoughness: finish.rimRoughness ?? 0.2,
        flake: finish.flake ?? 0.18,
        blend: finish.blend ?? 0.65,
        vertexAoStrength: finish.vertexAoStrength ?? 0,
        grainStrength: finish.grainStrength ?? 0,
      });
    } else if (finish.saturation && finish.saturation !== 1) {
      // Legacy fallback for un-rebuilt baked scans.
      const amount = finish.saturation.toFixed(3);
      copy.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
          diffuseColor.rgb = max(mix(vec3(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722))), diffuseColor.rgb, ${amount}), 0.0);`);
      };
      copy.customProgramCacheKey = () => `scan-saturation-${amount}`;
    }
    return copy;
  }
  copy = material.clone();
  // SketchUp exports write colours as sRGB values where glTF expects linear ones: everything comes out pale.
  if (car.srgbFactors && !copy.map) copy.color.convertSRGBToLinear();
  if (copy.metalness === 1 && !copy.metalnessMap) {
    // Exports that never set metalness get glTF's default of fully metal: plastics mirror the sky.
    copy.metalness = 0.05;
    copy.roughness = Math.min(copy.roughness, 0.6);
  }
  if (!hasVertexColors) copy.vertexColors = false;
  return copy;
}

export class ModelCar extends ProceduralCar {
  build() {
    const { car, template } = this.options;
    this.carDef = car;
    this.chassis = new THREE.Group();
    this.chassis.name = 'CarChassis';
    this.chassis.position.y = this.chassisOffsetY;
    this.add(this.chassis);
    // Present for the ProceduralCar setters; this model has no door number, livery stripe or lamp parts of its own.
    this.cockpit = new THREE.Group();
    this.steeringWheel = new THREE.Group();
    this.stripeMaterial = new THREE.MeshStandardMaterial();
    this.tailMaterial = new THREE.MeshStandardMaterial();
    this.reverseLampMaterial = new THREE.MeshStandardMaterial();
    this.rimMaterial = new THREE.MeshStandardMaterial();
    this.paintMaterials = [];
    this.rimMaterials = [];
    this.lensMaterials = [];
    this.ownMaterials = [this.stripeMaterial, this.tailMaterial, this.reverseLampMaterial, this.rimMaterial];
    this.ownGeometries = [];

    // Every instance gets its own material copies (paint colour, remote-car fading); geometry is shared.
    const copies = new Map();
    const own = (material, hasVertexColors) => {
      const key = `${material.uuid}:${hasVertexColors ? 1 : 0}`;
      if (!copies.has(key)) {
        const copy = makeFinish(material, car, hasVertexColors);
        if (copy.userData.role === 'paint') {
          this.paintSlot = this.paintSlot || copy;
          this.paintMaterials.push(copy);
        }
        if (copy.userData.role === 'tail') this.tailMaterial = copy;
        if (copy.userData.role === 'rim') {
          this.rimMaterial = copy;
          this.rimMaterials.push(copy);
        }
        if (copy.userData.lens) {
          this.lensMaterial = copy;
          this.lensMaterials.push(copy);
        }
        patchUnderglow(copy);
        copies.set(key, copy);
        this.materials.push(copy);
        this.ownMaterials.push(copy);
      }
      return copies.get(key);
    };
    const instance = (node) => {
      const object = node.clone(true);
      object.traverse((child) => {
        if (!child.isMesh) return;
        const hasColors = Boolean(child.geometry?.attributes?.color);
        child.material = Array.isArray(child.material)
          ? child.material.map((m) => own(m, hasColors))
          : own(child.material, hasColors);
        child.castShadow = true;
        child.receiveShadow = true;
      });
      return object;
    };

    const body = instance(template.getObjectByName('body'));
    body.position.set(0, 0, 0);
    this.chassis.add(body);
    this.bodyMesh = body;
    // Exterior cabin sits behind the glass. CarVisual swaps it for the animated driver layout.
    const exteriorCabin = template.getObjectByName('ROXX_cabin') || template.getObjectByName('GT3R_ExteriorCabin') || template.getObjectByName('Tokyo_ExteriorCabin');
    if (exteriorCabin) this.chassis.add(instance(exteriorCabin));
    this.paintable = false;
    this.bodyMaterial = new THREE.MeshStandardMaterial();
    this.ownMaterials.push(this.bodyMaterial);
    if (this.paintSlot) {
      this.bodyMaterial = this.paintSlot;
      this.paintable = true;
    }
    // Lamps the model does not have as separate parts (the scanned car's tail-light bar).
    for (const [x, y, z, w, h] of car.lamps?.tail || []) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.02), this.tailMaterial);
      lamp.position.set(x, y, z);
      this.chassis.add(lamp);
      this.ownGeometries.push(lamp.geometry);
    }

    for (const [key, nodeName] of Object.entries(WHEEL_NODES)) {
      const node = template.getObjectByName(nodeName);
      const pivot = new THREE.Group();
      pivot.name = `${key}_pivot`;
      pivot.position.copy(node.position);
      pivot.userData.restY = pivot.position.y;
      const wheel = new THREE.Group();
      wheel.name = `${key}_wheel`;
      const mesh = instance(node);
      mesh.position.set(0, 0, 0);
      wheel.add(mesh);
      pivot.add(wheel);
      this.add(pivot);
      this.wheels.set(key, wheel);
      this.wheelPivots.set(key, pivot);
      this.wheelSpin.set(key, 0);
    }
    this.wheelCentreY = this.wheelPivots.get('frontLeft').position.y;
    return this;
  }

  setPaint(paint) {
    if (!this.paintable) return this;
    this.setColor(paint.color);
    const targets = this.paintMaterials?.length ? this.paintMaterials : [this.bodyMaterial];
    for (const mat of targets) {
      const defs = mat.userData.paintDefaults || {};
      const metalness = paint.metalness ?? defs.defaultMetalness ?? defs.metalness ?? 0.35;
      const roughness = paint.roughness ?? defs.defaultRoughness ?? defs.roughness ?? 0.18;
      const clearcoat = paint.clearcoat ?? defs.clearcoat ?? 0.9;
      if (mat.userData.paintMode === PAINT_MODES.MASKED_BODY) {
        // Keep scalar color/metalness/roughness at 1 on GT_Body so ORM & carbon/glass maps remain untouched.
        setCarPaintUniforms(mat, {
          paint,
          paintMetalness: metalness,
          paintRoughness: roughness,
          paintClearcoat: clearcoat,
        });
      } else {
        mat.metalness = metalness;
        mat.roughness = roughness;
        if ('clearcoat' in mat) mat.clearcoat = clearcoat;
        setCarPaintUniforms(mat, { paint });
      }
    }
    return this;
  }

  setColor(color) {
    this.color.set(color);
    if (!this.paintable) return this;
    const targets = this.paintMaterials?.length ? this.paintMaterials : [this.bodyMaterial];
    for (const mat of targets) {
      setCarPaintUniforms(mat, { color: this.color });
      if (mat.userData.paintMode !== PAINT_MODES.MASKED_BODY) {
        mat.color.copy(this.color);
      }
    }
    return this;
  }

  setRimColor(color) {
    if (!this.rimMaterials.length) {
      this.rimMaterial.color.set(color);
      return this;
    }
    for (const mat of this.rimMaterials) {
      if (mat.userData.paintMode === PAINT_MODES.MASKED_RIM) {
        setCarPaintUniforms(mat, { rimColor: color });
      } else {
        mat.color.set(color);
      }
    }
    return this;
  }

  setNumber() {
    return this;
  }

  /** Headlamp lenses glow with the headlights. */
  setHeadlamps(on) {
    for (const mat of this.lensMaterials) {
      mat.emissiveIntensity = on ? 2.2 : (mat.userData.idleEmissive ?? 0.15);
    }
  }

  /** Wheel pivots rest at the model's own axle height. */
  setSuspension(key, compression = 0) {
    const pivot = this.wheelPivots.get(key);
    if (!pivot) return;
    pivot.position.y = pivot.userData.restY + Math.max(-0.2, Math.min(0.2, compression));
  }

  dispose() {
    // The template's geometry and textures are shared by every instance: only drop this car's copies.
    new Set(this.ownMaterials).forEach((material) => material.dispose());
    this.ownGeometries.forEach((geometry) => geometry.dispose());
    this.glowTube?.dispose();
    this.glowTubes?.geometry.dispose();
    this.materials.length = 0;
  }
}
