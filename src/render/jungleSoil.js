import * as THREE from 'three';

// Use the same interpolated wetness that the tyres sample. The fine-scale
// texture breaks the water into irregular pools within each larger mud patch.
export function jungleSoil(view) {
  const texture = view.track(new THREE.TextureLoader().load(new URL('../assets/maps/jungle-soil.webp', import.meta.url).href));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.MirroredRepeatWrapping;
  texture.anisotropy = 4;
  const material = view.track(new THREE.MeshStandardMaterial({map:texture, bumpMap:texture,
    bumpScale:0.055, roughness:0.92, envMapIntensity:0.39}));
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'attribute float aWet; varying float wetSoil; varying vec2 forestXZ;\n' +
      shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nwetSoil=aWet; forestXZ=position.xz;');
    shader.fragmentShader = `
      varying float wetSoil;
      varying vec2 forestXZ;
      float canopyHash(vec2 p) {
        vec3 q = fract(p.xyx * 0.1031);
        q += dot(q, q.yzx + 33.33);
        return fract((q.x+q.y)*q.z);
      }
      float canopyNoise(vec2 p) {
        vec2 i=floor(p), f=fract(p);
        f=f*f*(3.0-2.0*f);
        return mix(mix(canopyHash(i),canopyHash(i+vec2(1.,0.)),f.x),
                   mix(canopyHash(i+vec2(0.,1.)),canopyHash(i+vec2(1.)),f.x),f.y);
      }
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      #include <map_fragment>
      float bough = 0.52*canopyNoise(forestXZ*0.20) + 0.28*canopyNoise(forestXZ*0.68) + 0.20*canopyNoise(forestXZ*2.24);
      float fleck = smoothstep(0.46,0.67,bough);
      float pool = smoothstep(0.80,0.93, wetSoil + 0.44*(canopyNoise(forestXZ*0.89)-0.5) + 0.09*sin(vMapUv.x*34.0));
      diffuseColor.rgb *= mix(vec3(0.38,0.44,0.44), vec3(1.34,1.21,0.99),fleck);
      diffuseColor.rgb *= 1.0-0.43*wetSoil;
      diffuseColor.rgb = mix(diffuseColor.rgb,vec3(0.054,0.043,0.021)*(0.65+fleck*0.65),0.81*pool);
    `).replace('#include <roughnessmap_fragment>', `
      #include <roughnessmap_fragment>
      roughnessFactor = mix(0.92-0.27*wetSoil,0.17,pool);
    `).replace('#include <lights_fragment_end>', `
      #include <lights_fragment_end>
      // A water-filled rut sees the dark overhead leaves between gaps in the sky.
      vec3 reflectedRay = reflect(normalize(vViewPosition * -1.0), normal);
      vec3 worldRay = inverseTransformDirection(reflectedRay, viewMatrix);
      vec2 overhead = forestXZ + worldRay.xz * (8.0 / max(0.18,worldRay.y));
      float opening = smoothstep(0.52,0.76,canopyNoise(overhead*0.19)*0.65 + canopyNoise(overhead*0.67)*0.35);
      reflectedLight.indirectSpecular *= mix(vec3(1.0),mix(vec3(0.29,0.34,0.13),vec3(0.85,0.83,0.63),opening),pool);
    `);
  };
  return material;
}
