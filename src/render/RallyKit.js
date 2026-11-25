import * as THREE from 'three';

const kitUrl = new URL('../assets/cars/rally-kit.glb', import.meta.url).href;
const surface = new Map();
let template;
let livery;
let rubber;
let rubberNormal;

export function hasRallyKit() {
  return Boolean(template && livery && rubber && rubberNormal);
}

export async function loadRallyKit(loader) {
  if (template) return;
  const textures = new THREE.TextureLoader();
  const [gltf, graphics, tread, normal] = await Promise.all([
    loader.loadAsync(kitUrl),
    textures.loadAsync(new URL('../assets/cars/rally-livery.png', import.meta.url).href),
    textures.loadAsync(new URL('../assets/cars/rally-tyre.png', import.meta.url).href),
    textures.loadAsync(new URL('../assets/cars/rally-tyre-normal.png', import.meta.url).href),
  ]);
  template = gltf.scene;
  template.traverse(node => {
    if (node.isMesh) surface.set(node.material.name, node.material);
  });
  livery = graphics;
  rubber = tread;
  rubber.colorSpace = THREE.SRGBColorSpace;
  rubberNormal = normal;
  for (const map of [rubber, rubberNormal]) map.wrapS = THREE.RepeatWrapping;
}

// Instances share immutable template geometry and maps, while garage fades and lighting own their materials.
export function rallyPart(name, materials) {
  const part = template?.getObjectByName(name)?.clone(true);
  part?.traverse(node => {
    if (!node.isMesh) return;
    node.material = node.material.clone();
    node.castShadow = node.receiveShadow = true;
    materials.push(node.material);
  });
  return part;
}

export function textureRallySurface(material, finish) {
  const ref = surface.get('Rally_' + finish);
  if (!ref) return material;
  material.normalMap = ref.normalMap;
  material.normalScale.copy(ref.normalScale).multiplyScalar(0.28);
  material.roughnessMap = ref.roughnessMap;
  if (finish === 'Rubber' && rubber) {
    material.map = rubber;
    material.normalMap = rubberNormal;
    material.color.setHex(0xffffff);
  } else {
    material.map = ref.map;
  }
  return material;
}

/** Wet clay lodges preferentially in the tyre texture's brown recesses.
 * Each wheel has its own uniform so a muddy inside wheel can differ from the outside pair. */
export function tyreCoat(material) {
  const coat = { value: 0.08 };
  const previous = material.onBeforeCompile;
  const key = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = function(shader, renderer) {
    previous.call(this, shader, renderer);
    shader.uniforms.uWetClay = coat;
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
      '#include <common>\nuniform float uWetClay;').replace('#include <map_fragment>', `
      #include <map_fragment>
      float packedClay = uWetClay * smoothstep(0.0,0.085,diffuseColor.r - diffuseColor.b + 0.018);
      diffuseColor.rgb = mix(diffuseColor.rgb,vec3(0.19,0.095,0.039),packedClay*0.86);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor,0.44,packedClay);');
  };
  material.customProgramCacheKey = () => key() + '-gravel-tyre';
  return coat;
}

// The side projection follows the shell, including its curved shoulders. Dirt reduces specular response.
export function rallyLivery(material, graphics = true) {
  if (!livery) return;
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = function(shader, renderer) {
    previous.call(this, shader, renderer);
    shader.uniforms.uStageMask = { value: livery };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vStagePoint;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvStagePoint = position;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uStageMask; varying vec3 vStagePoint;')
      .replace('#include <lights_physical_fragment>', `
        vec3 stageMask = texture2D(uStageMask, clamp(vec2((vStagePoint.z+2.3)/4.6, vStagePoint.y/1.5),0.0,1.0)).rgb;
        float flank = smoothstep(0.72,0.85,abs(vStagePoint.x));
        ${graphics ? 'diffuseColor.rgb = mix(diffuseColor.rgb,vec3(0.68,0.032,0.012),stageMask.r*flank); diffuseColor.rgb = mix(diffuseColor.rgb,vec3(0.90,0.82,0.66),stageMask.g*flank);' : ''}
        float mud = stageMask.b * mix(0.42, 1.0, flank);
        diffuseColor.rgb = mix(diffuseColor.rgb,mix(vec3(0.15,0.081,0.035),vec3(0.32,0.22,0.13),stageMask.b),mud);
        roughnessFactor = mix(roughnessFactor,0.93,mud);
        metalnessFactor *= 1.0-mud;
        #include <lights_physical_fragment>`);
  };
  material.customProgramCacheKey = () => previousKey() + '-stage-livery-' + graphics;
}
