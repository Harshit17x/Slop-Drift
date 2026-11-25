import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { smoothstep } from '../core/math.js';
import { JungleRoad } from './JungleRoad.js';
import { MeshBuffer } from './road/MeshBuffer.js';
import { createAsphaltReliefTexture, createAsphaltTexture, createGrainTexture, createChevronTexture, createLabelTexture, createCheckerTexture } from './road/textures.js';

// Everything you see of the road network: asphalt, shoulders and verges, painted lines, guardrails,
// reflector posts, corner chevrons, every summit plaza, and the gates of the active route.
// All static parts are merged or instanced, so the whole network is about a dozen draw calls.
//
// The cross-section mirrors the physics in Road.profileAt / World.sampleGround exactly:
// asphalt out to halfWidth, a flush gravel shoulder, then a verge falling to just above the carved bed.

const ASPHALT_TILE = 4; // metres per repeat of the asphalt texture (world-space, so overlapping roads match)
const GRAIN_TILE = 2.2;
const SURFACE_SINK = 0.004; // shoulders sit a hair below the asphalt edge they share
const VERGE_CLEARANCE = 0.02; // verge ends this far above the carved bed
const OVERLAP_SINK = 0.015; // a road passing over another surface is drawn just beneath it
const MARKING_LIFT = 0.012;
const RAIL_PROFILE = [
  [0, 0.4],
  [-0.075, 0.475],
  [-0.02, 0.55],
  [-0.075, 0.625],
  [0, 0.7],
]; // [offset toward the road, height above the road plane]
const TIGHT_CORNER = 1 / 45;

// Vertex colours, multiplied by the grain texture. Albedos are kept realistic (gravel ~0.3) so the
// roadside does not glare next to the darker asphalt and grass.
const GRAVEL = [0.38, 0.36, 0.33];
const VERGE = [0.17, 0.2, 0.1];
const SKIRT = [0.16, 0.14, 0.11];
const YELLOW = [0.93, 0.68, 0.08];
const WHITE = [0.9, 0.9, 0.87];

const location = {};
const frame = {};
const matrix = new THREE.Matrix4();
const basisX = new THREE.Vector3();
const basisY = new THREE.Vector3(0, 1, 0);
const basisZ = new THREE.Vector3();
const origin = new THREE.Vector3();

const HAS_ASSET_TEX = typeof import.meta.url === 'string' && typeof Image !== 'undefined';
const ALPINE_ROAD_URL = HAS_ASSET_TEX ? new URL('../assets/maps/alpine-road.webp', import.meta.url).href : null;
const ALPINE_SHOULDER_URL = HAS_ASSET_TEX ? new URL('../assets/maps/alpine-shoulder.webp', import.meta.url).href : null;
const MUSSOORIE_ROAD_URL = HAS_ASSET_TEX ? new URL('../assets/maps/mussoorie-road.webp', import.meta.url).href : null;
const MUSSOORIE_SHOULDER_URL = HAS_ASSET_TEX ? new URL('../assets/maps/mussoorie-shoulder.webp', import.meta.url).href : null;

function loadTileTexture(url, anisotropy) {
  const tex = new THREE.TextureLoader().load(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = anisotropy;
  return tex;
}

export class RoadView {
  /**
   * @param {object} options
   * @param {import('../world/World.js').World} options.world  A built world.
   * @param {object} [options.quality]  Entry of QUALITY_PRESETS; small props stop casting shadows when shadows are off.
   * @param {number} [options.anisotropy]  Texture anisotropy; pass renderer.capabilities.getMaxAnisotropy() when available.
   */
  constructor({ world, quality = null, anisotropy = 8 }) {
    const started = performance.now();
    this.world = world;
    this.config = world.config.road;
    this.group = new THREE.Group();
    this.group.name = 'RoadView';
    this.gates = new THREE.Group();
    this.gates.name = 'RouteGates';
    this.group.add(this.gates);
    this.castSmallShadows = !quality || quality.shadowMapSize > 0;
    this.night = false;
    const mapId = world.config?.map || 'alpine';
    this.isAlpine = !world.config?.map || world.config.map === 'alpine';
    this.isMussoorie = mapId === 'mussoorie';
    const roadTexUrl = mapId === 'hollow' ? new URL('../assets/maps/hollow-road.webp', import.meta.url).href : this.isMussoorie ? MUSSOORIE_ROAD_URL : (this.isAlpine ? ALPINE_ROAD_URL : null);
    const shoulderTexUrl = this.isMussoorie ? MUSSOORIE_SHOULDER_URL : (this.isAlpine ? ALPINE_SHOULDER_URL : null);
    this.hasPhotoRoad = Boolean(roadTexUrl);
    this.hasPhotoShoulder = Boolean(shoulderTexUrl);
    this.disposables = [];
    this.gateDisposables = [];

    this.textures = {
      asphalt: roadTexUrl
        ? this.track(loadTileTexture(roadTexUrl, anisotropy))
        : this.track(createAsphaltTexture(anisotropy)),
      asphaltRelief: this.track(createAsphaltReliefTexture(anisotropy)),
      grain: shoulderTexUrl
        ? this.track(loadTileTexture(shoulderTexUrl, anisotropy))
        : this.track(createGrainTexture(anisotropy)),
      chevron: this.track(createChevronTexture(anisotropy)),
      checker: this.track(createCheckerTexture()),
    };
    this.reflectorMaterial = this.track(new THREE.MeshStandardMaterial({ color: 0xffa51f, emissive: 0xff8a10, emissiveIntensity: 0.25, roughness: 0.35 }));
    this.lightMaterial = this.track(new THREE.MeshStandardMaterial({ color: 0xc7ff52, emissive: 0xa6ff2a, emissiveIntensity: 0.9, roughness: 0.4 }));
    this.steelMaterial = this.track(new THREE.MeshStandardMaterial({ color: 0xb9c0c6, roughness: 0.42, metalness: 0.75, side: THREE.DoubleSide }));
    this.darkMaterial = this.track(new THREE.MeshStandardMaterial({ color: 0x23272c, roughness: 0.6, metalness: 0.5 }));

    if (mapId === 'hollow') {
      this.buildSurfaces();
      this.asphaltMesh.material[0].color.setHex(0x999d95);
      this.asphaltMesh.material[0].roughness=.53;
      this.steelMaterial.color.setHex(0x787a71);
      this.steelMaterial.roughness=.72;
      this.buildRails();
      this.buildReflectors();
      this.buildMarkings();
    } else if (world.bridge) {
      this.jungle = new JungleRoad(this);
    } else {
      this.buildSurfaces();
      this.buildMarkings();
      this.buildRails();
      this.buildDelineators();
      this.buildReflectors();
      this.buildChevrons();
      this.buildSummitMarker();
    }

    this.stats = { buildMs: performance.now() - started, triangles: 0, drawCalls: 0 };
    this.group.traverse((node) => {
      if (!node.isMesh) return;
      const perInstance = node.geometry.index ? node.geometry.index.count / 3 : node.geometry.attributes.position.count / 3;
      this.stats.triangles += perInstance * (node.isInstancedMesh ? node.count : 1);
      this.stats.drawCalls += 1;
    });
  }

  track(resource) {
    this.disposables.push(resource);
    return resource;
  }

  addMesh(geometry, material, name, { cast = false, receive = true, parent = this.group } = {}) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    mesh.matrixAutoUpdate = false;
    parent.add(mesh);
    return mesh;
  }

  // ------------------------------------------------------------------ helpers

  /** Height of a road's banked plane at sample i, `lateral` metres right of the centreline. */
  planeY(road, i, lateral) {
    return road.py[i] + lateral * road.bank[i];
  }

  /**
   * Best surface class another road or a plaza offers at (x, z): 0 asphalt, 1 shoulder, 2 verge, 9 none.
   * `exceptRoad` is the road asking (-1: a plaza is asking, so plazas do not count); with `lowerOnly`
   * only roads listed before it (and the plazas) count.
   */
  coverClass(x, z, exceptRoad, lowerOnly = false) {
    let best = 9;
    const roads = this.world.roads;
    for (let r = 0; r < roads.length; r += 1) {
      if (r === exceptRoad || (lowerOnly && r > exceptRoad)) continue;
      const road = roads[r];
      if (!road.locate(x, z, location) || location.beyondEnd) continue;
      const a = location.distance;
      const surfaceClass = a <= location.halfWidth ? 0 : a <= location.halfWidth + road.shoulderEdge ? 1 : a <= location.halfWidth + road.vergeEdge ? 2 : 9;
      if (surfaceClass < best) best = surfaceClass;
    }
    if (exceptRoad !== -1) {
      for (const plaza of this.world.plazas) {
        const distance = Math.hypot(x - plaza.x, z - plaza.z);
        if (distance <= plaza.radius) best = 0;
        else if (distance <= plaza.radius + this.config.verge && best > 2) best = 2;
      }
    }
    return best;
  }

  /** Instance matrix for an upright object at (x, y, z) whose local +Z points along (zx, zz). */
  setUpright(target, index, x, y, z, zx, zz) {
    const length = Math.hypot(zx, zz) || 1;
    basisZ.set(zx / length, 0, zz / length);
    basisX.crossVectors(basisY, basisZ);
    matrix.makeBasis(basisX, basisY, basisZ);
    matrix.setPosition(x, y, z);
    target.setMatrixAt(index, matrix);
  }

  // ------------------------------------------------------------------ asphalt, shoulders, verges

  buildSurfaces() {
    const world = this.world;
    const asphalt = new MeshBuffer({ uvs: true, colors: true, normals: true });
    const soft = new MeshBuffer({ uvs: true, colors: true });
    const hollowGroups=[];
    const laneOffsets = [-1, -0.55, 0, 0.55, 1];
    const laneTone = [1, 0.9, 0.97, 0.9, 1];

    for (const road of world.roads) {
      const base = asphalt.vertexCount;
      for (let i = 0; i < road.count; i += 1) {
        const halfWidth = road.halfWidth[i];
        const gradX = road.grade[i] * road.tx[i] + road.bank[i] * road.rx[i];
        const gradZ = road.grade[i] * road.tz[i] + road.bank[i] * road.rz[i];
        const inverse = 1 / Math.sqrt(gradX * gradX + gradZ * gradZ + 1);
        // Rubber builds up on the driving lines, most of all through tight corners.
        const wear = 0.1 * smoothstep(1 / 70, 1 / 24, Math.abs(road.curvature[i]));
        for (let k = 0; k < 5; k += 1) {
          const lateral = laneOffsets[k] * halfWidth;
          const x = road.px[i] + road.rx[i] * lateral;
          const z = road.pz[i] + road.rz[i] * lateral;
          let y = this.planeY(road, i, lateral);
          if (this.coverClass(x, z, road.id, true) === 0) y -= OVERLAP_SINK;
          const tone = laneTone[k] - (k === 1 || k === 3 ? wear : 0);
          asphalt.vertex(x, y, z, x / ASPHALT_TILE, z / ASPHALT_TILE, tone, tone, tone, -gradX * inverse, inverse, -gradZ * inverse);
        }
      }
      for (let i = 0; i < road.segments; i += 1) {
        const a = base + i * 5;
        const b = base + ((i + 1) % road.count) * 5;
        for (let k = 0; k < 4; k += 1) asphalt.quad(a + k, a + k + 1, b + k + 1, b + k);
      }
      if(world.config.map==="hollow")hollowGroups.push({id:road.id,count:road.segments*24});
      this.buildSoftEdges(road, soft);
    }
    this.buildPlazaSurfaces(asphalt, soft);

    const isPhotoRoad = this.hasPhotoRoad;
    const isPhotoShoulder = this.hasPhotoShoulder;
    const asphaltMaterial = this.track(new THREE.MeshStandardMaterial({
      map: this.textures.asphalt,
      bumpMap: isPhotoRoad ? this.textures.asphalt : this.textures.asphaltRelief,
      bumpScale: isPhotoRoad ? 0.044 : 0.036,
      roughnessMap: this.textures.asphaltRelief,
      vertexColors: true,
      roughness: 0.88,
      metalness: 0.04,
    }));
    // Multi-scale blotches kill repetition; worn wheel-path polish and subtle tar streaks add micro-realism.
    asphaltMaterial.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <map_fragment>', /* glsl */ `
          #ifdef USE_MAP
            vec3 fineGrain = texture2D( map, vMapUv ).rgb;
            float broadPatch = texture2D( map, vMapUv * 0.083 + vec2( 0.37, 0.11 ) ).g;
            float midPatch = texture2D( map, vMapUv.yx * 0.31 + vec2( 0.73, 0.29 ) ).g;
            diffuseColor.rgb *= fineGrain * ( ${isPhotoRoad ? '0.82 + 3.4 * broadPatch' : '0.55 + 4.2 * broadPatch'} ) * ( ${isPhotoRoad ? '0.88 + 2.3 * midPatch' : '0.7 + 2.8 * midPatch'} );
          #endif
        `)
        .replace('#include <color_fragment>', /* glsl */ `
          #include <color_fragment>
          #ifdef USE_COLOR
            float trackWear = smoothstep( 0.96, 0.84, vColor.r );
            diffuseColor.rgb *= 1.0 - 0.12 * trackWear;
          #endif
        `)
        .replace('#include <roughnessmap_fragment>', /* glsl */ `
          float roughnessFactor = roughness;
          #ifdef USE_ROUGHNESSMAP
            vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
            roughnessFactor *= mix( 0.65, 1.12, texelRoughness.g );
            #ifdef USE_COLOR
              roughnessFactor *= 1.0 - 0.22 * smoothstep( 0.96, 0.84, vColor.r );
            #endif
          #endif
        `);
    };
    asphaltMaterial.customProgramCacheKey = () => (isPhotoRoad ? 'road-asphalt-photo-v3' : 'road-asphalt-v2');
    this.asphaltMesh = this.addMesh(this.track(asphalt.build()), asphaltMaterial, 'RoadAsphalt');

    if(hollowGroups.length){
      const setts=this.track(loadTileTexture(new URL('../assets/maps/hollow-setts.webp',import.meta.url).href,4));
      const cobble=this.track(new THREE.MeshStandardMaterial({map:setts,bumpMap:setts,bumpScale:.17,roughness:.61,color:0xb1b5b3}));
      const gravel=this.track(new THREE.MeshStandardMaterial({map:this.textures.grain,bumpMap:this.textures.grain,bumpScale:.12,color:0x776c59,roughness:.89}));
      const mud=this.track(new THREE.MeshStandardMaterial({map:this.textures.asphalt,bumpMap:this.textures.asphalt,bumpScale:.12,color:0x765437,roughness:.44}));
      // Water collects in irregular depressions. Reuse the street texture to
      // break up the edges, then let the scene environment light the smooth film.
      for(const surface of [asphaltMaterial,cobble]){
        const base=surface.onBeforeCompile.bind(surface);
        const baseKey=surface.customProgramCacheKey();
        surface.onBeforeCompile=(shader,renderer)=>{
          base(shader,renderer);
          shader.fragmentShader=shader.fragmentShader.replace('#include <metalnessmap_fragment>', `
            #include <metalnessmap_fragment>
            float waterLevel = sin(vMapUv.x * 1.9 + sin(vMapUv.y * 2.4)) * .24
                + cos(vMapUv.y * 3.7 - vMapUv.x * .8) * .20
                + texture2D(map, vMapUv * .65).g * .75;
            waterLevel += .16 * sin(vMapUv.y * .67 + 5.0 * cos(vMapUv.x * .49))
                + .08 * sin(vMapUv.y * 11.0 + 3.0 * sin(vMapUv.x * 8.7));
            float wet = smoothstep(.23, .53, waterLevel);
            roughnessFactor = mix(roughnessFactor, .22, wet);
            diffuseColor.rgb *= 1.0 - .32 * wet;
          `).replace('#include <normal_fragment_maps>', `
            #include <normal_fragment_maps>
            normal = normalize(mix(normal, nonPerturbedNormal, .65 * wet));
          `);
        };
        surface.customProgramCacheKey=()=>baseKey+'-hollow-water-film';
      }
      const geo=this.asphaltMesh.geometry;let start=0;
      this.asphaltMesh.material=[asphaltMaterial,cobble,gravel,mud];
      for(const {id,count} of hollowGroups){
        if(id===2){
          const step=this.world.roads[2].spacing,begin=Math.ceil(3310/step)*24,end=Math.ceil(3480/step)*24;
          geo.addGroup(start,begin,2);geo.addGroup(start+begin,end-begin,3);geo.addGroup(start+end,count-end,2);
        }else geo.addGroup(start,count,id===1?1:id===9?2:0);
        start+=count;
      }
    }
    const softMaterial = this.track(new THREE.MeshStandardMaterial({
      map: this.textures.grain,
      bumpMap: this.textures.grain,
      bumpScale: isPhotoShoulder ? 0.085 : 0.075,
      vertexColors: true,
      roughness: 0.96,
      metalness: 0,
    }));
    if (isPhotoShoulder) {
      softMaterial.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', /* glsl */ `
          #ifdef USE_MAP
            vec3 shFine = texture2D( map, vMapUv ).rgb;
            float shMacro = texture2D( map, vMapUv * 0.23 + vec2( 0.41, 0.17 ) ).g;
            diffuseColor.rgb *= shFine * mix( 0.78, 1.26, shMacro ) * 3.1;
          #endif
        `);
      };
      softMaterial.customProgramCacheKey = () => 'road-shoulder-photo-v1';
    }
    this.softMesh = this.addMesh(this.track(soft.build()), softMaterial, 'RoadShouldersAndVerges');
  }

  /** Gravel shoulder, verge and a short skirt below the verge edge, for both sides of one road. */
  buildSoftEdges(road, soft) {
    const config = this.config;
    const vergeDrop = config.vergeDrop - VERGE_CLEARANCE;
    for (const side of [-1, 1]) {
      const base = soft.vertexCount;
      for (let i = 0; i < road.count; i += 1) {
        const inner = road.halfWidth[i];
        const offsets = [inner, inner + config.shoulder, inner + config.shoulder + config.verge];
        const drops = [SURFACE_SINK, SURFACE_SINK, vergeDrop];
        const colors = [GRAVEL, GRAVEL, VERGE];
        for (let k = 0; k < 3; k += 1) {
          const lateral = side * offsets[k];
          const x = road.px[i] + road.rx[i] * lateral;
          const z = road.pz[i] + road.rz[i] * lateral;
          soft.vertex(x, this.planeY(road, i, lateral) - drops[k], z, x / GRAIN_TILE, z / GRAIN_TILE, colors[k][0], colors[k][1], colors[k][2]);
        }
        // Skirt: hides any sliver between the verge edge and the terrain, e.g. above a retaining wall.
        for (let k = 0; k < 2; k += 1) {
          const lateral = side * (offsets[2] + k * 0.4);
          const x = road.px[i] + road.rx[i] * lateral;
          const z = road.pz[i] + road.rz[i] * lateral;
          soft.vertex(x, this.planeY(road, i, side * offsets[2]) - vergeDrop - k * 1.4, z, x / GRAIN_TILE, z / GRAIN_TILE, SKIRT[0], SKIRT[1], SKIRT[2]);
        }
      }
      for (let i = 0; i < road.segments; i += 1) {
        const j = (i + 1) % road.count;
        const a = base + i * 5;
        const b = base + j * 5;
        const mid = (lateral) => {
          const ax = road.px[i] + road.rx[i] * lateral;
          const az = road.pz[i] + road.rz[i] * lateral;
          const bx = road.px[j] + road.rx[j] * lateral;
          const bz = road.pz[j] + road.rz[j] * lateral;
          return this.coverClass((ax + bx) * 0.5, (az + bz) * 0.5, road.id);
        };
        const inner = (road.halfWidth[i] + road.halfWidth[j]) * 0.5;
        // A strip is dropped where a better surface of another road (or the plaza) already covers that ground.
        const strips = [
          [0, 1, mid(side * (inner + config.shoulder * 0.5)) > 0],
          [1, 2, mid(side * (inner + config.shoulder + config.verge * 0.5)) > 1],
          [3, 4, mid(side * (inner + config.shoulder + config.verge)) > 1],
        ];
        for (const [near, far, visible] of strips) {
          if (!visible) continue;
          if (side > 0) soft.quad(a + near, a + far, b + far, b + near);
          else soft.quad(a + far, a + near, b + near, b + far);
        }
      }
    }
  }

  buildPlazaSurfaces(asphalt, soft) {
    for (const plaza of this.world.plazas) this.buildPlazaSurface(plaza, asphalt, soft);
  }

  /** One plaza's paving and verge ring, added to the shared asphalt and soft buffers. */
  buildPlazaSurface(plaza, asphalt, soft) {
    const config = this.config;
    const steps = 96;
    const centre = asphalt.vertex(plaza.x, plaza.y, plaza.z, plaza.x / ASPHALT_TILE, plaza.z / ASPHALT_TILE, 0.97, 0.97, 0.97, 0, 1, 0);
    const ring = asphalt.vertexCount;
    const softBase = soft.vertexCount;
    const radii = [plaza.radius, plaza.radius + config.verge, plaza.radius + config.verge, plaza.radius + config.verge + 0.4];
    const drops = [SURFACE_SINK, config.vergeDrop - VERGE_CLEARANCE, config.vergeDrop - VERGE_CLEARANCE, config.vergeDrop - VERGE_CLEARANCE + 1.4];
    const colors = [GRAVEL, VERGE, SKIRT, SKIRT];
    for (let k = 0; k < steps; k += 1) {
      const angle = (k / steps) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const x = plaza.x + cos * plaza.radius;
      const z = plaza.z + sin * plaza.radius;
      asphalt.vertex(x, plaza.y, z, x / ASPHALT_TILE, z / ASPHALT_TILE, 1, 1, 1, 0, 1, 0);
      for (let n = 0; n < 4; n += 1) {
        const sx = plaza.x + cos * radii[n];
        const sz = plaza.z + sin * radii[n];
        soft.vertex(sx, plaza.y - drops[n], sz, sx / GRAIN_TILE, sz / GRAIN_TILE, colors[n][0], colors[n][1], colors[n][2]);
      }
    }
    for (let k = 0; k < steps; k += 1) {
      const next = (k + 1) % steps;
      asphalt.triangle(centre, ring + next, ring + k);
      const angle = ((k + 0.5) / steps) * Math.PI * 2;
      const mx = plaza.x + Math.cos(angle) * (plaza.radius + config.verge * 0.5);
      const mz = plaza.z + Math.sin(angle) * (plaza.radius + config.verge * 0.5);
      if (this.coverClass(mx, mz, -1) <= 1) continue; // the road comes in here
      const a = softBase + k * 4;
      const b = softBase + next * 4;
      soft.quad(a, b, b + 1, a + 1);
      soft.quad(a + 2, b + 2, b + 3, a + 3);
    }
  }

  // ------------------------------------------------------------------ painted lines

  buildMarkings() {
    const world = this.world;
    const paint = new MeshBuffer({ colors: true, normals: true });
    const strip = (road, i, j, lateralI, lateralJ, width, color) => {
      const half = width * 0.5;
      const corner = (index, lateral) => {
        const x = road.px[index] + road.rx[index] * lateral;
        const z = road.pz[index] + road.rz[index] * lateral;
        return paint.vertex(x, this.planeY(road, index, lateral) + MARKING_LIFT, z, 0, 0, color[0], color[1], color[2], 0, 1, 0);
      };
      const a = corner(i, lateralI - half);
      const b = corner(i, lateralI + half);
      const c = corner(j, lateralJ + half);
      const d = corner(j, lateralJ - half);
      paint.quad(a, b, c, d);
    };

    for (const road of world.roads) {
      if(world.config.map==='hollow' && road.id!==0)continue;
      const count = road.count;
      // Solid double line wherever the road bends, dashes on the straights.
      const solid = new Uint8Array(count);
      for (let i = 0; i < count; i += 1) {
        if (Math.abs(road.curvature[i]) < 0.009) continue;
        for (let k = -7; k <= 7; k += 1) {
          const n = road.closed ? (i + k + count) % count : i + k;
          if (n >= 0 && n < count) solid[n] = 1;
        }
      }
      const centreClear = new Uint8Array(count);
      const edgeClear = [new Uint8Array(count), new Uint8Array(count)];
      for (let i = 0; i < count; i += 1) {
        centreClear[i] = this.coverClass(road.px[i], road.pz[i], road.id, true) === 0 ? 0 : 1;
        for (let s = 0; s < 2; s += 1) {
          const lateral = (s === 0 ? -1 : 1) * (road.halfWidth[i] + 0.5);
          edgeClear[s][i] = this.coverClass(road.px[i] + road.rx[i] * lateral, road.pz[i] + road.rz[i] * lateral, road.id) === 0 ? 0 : 1;
        }
      }
      for (let i = 0; i < road.segments; i += 1) {
        const j = (i + 1) % count;
        if (centreClear[i] && centreClear[j]) {
          if (solid[i] && solid[j]) {
            strip(road, i, j, -0.11, -0.11, 0.1, YELLOW);
            strip(road, i, j, 0.11, 0.11, 0.1, YELLOW);
          } else if (i % 6 < 2) {
            strip(road, i, j, 0, 0, 0.14, YELLOW);
          }
        }
        for (let s = 0; s < 2; s += 1) {
          if (!edgeClear[s][i] || !edgeClear[s][j]) continue;
          const sign = s === 0 ? -1 : 1;
          strip(road, i, j, sign * (road.halfWidth[i] - 0.24), sign * (road.halfWidth[j] - 0.24), 0.12, WHITE);
        }
      }
    }

    // A white ring just inside the edge of each plaza, open where the road comes in.
    for (const plaza of world.plazas) {
      const steps = 96;
      const inner = plaza.radius - 0.5;
      const outer = plaza.radius - 0.36;
      for (let k = 0; k < steps; k += 1) {
        const a0 = (k / steps) * Math.PI * 2;
        const a1 = ((k + 1) / steps) * Math.PI * 2;
        const mid = (a0 + a1) * 0.5;
        if (this.coverClass(plaza.x + Math.cos(mid) * plaza.radius, plaza.z + Math.sin(mid) * plaza.radius, -1) === 0) continue;
        const point = (angle, radius) => paint.vertex(plaza.x + Math.cos(angle) * radius, plaza.y + MARKING_LIFT, plaza.z + Math.sin(angle) * radius, 0, 0, WHITE[0], WHITE[1], WHITE[2], 0, 1, 0);
        paint.quad(point(a0, inner), point(a1, inner), point(a1, outer), point(a0, outer));
      }
    }

    const material = this.track(new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.68, metalness: 0, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6,
    }));
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vMarkXz;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMarkXz = position.xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vMarkXz;')
        .replace('#include <map_fragment>', /* glsl */ `
          #include <map_fragment>
          float chip = fract( sin( dot( floor( vMarkXz * 9.0 ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
          float streak = sin( vMarkXz.x * 1.4 + vMarkXz.y * 0.9 ) * 0.5 + 0.5;
          if ( chip < 0.14 * ( 0.4 + 0.6 * streak ) ) diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.18, 0.19, 0.20 ), 0.65 );
        `);
    };
    material.customProgramCacheKey = () => 'road-marking-wear-v1';
    this.markingMesh = this.addMesh(this.track(paint.build()), material, 'RoadMarkings');
  }

  // ------------------------------------------------------------------ guardrails

  buildRails() {
    const world = this.world;
    const config = this.config;
    const beams = new MeshBuffer();
    const postSpots = [];
    this.reflectorSpots = [];
    const points = RAIL_PROFILE.length;

    for (const road of world.roads) {
      const count = road.count;
      for (const side of [-1, 1]) {
        const flags = side < 0 ? road.railLeft : road.railRight;
        const isOn = (i) => {
          if (road.closed) return flags[(i + count) % count] === 1;
          return i >= 0 && i < count && flags[i] === 1;
        };
        const vertexOf = new Int32Array(count).fill(-1);
        const ensure = (i) => {
          if (vertexOf[i] >= 0) return vertexOf[i];
          const terminal = !isOn(i - 1) || !isOn(i + 1); // rail ends are turned down to the ground
          const lateral = side * (road.halfWidth[i] + config.shoulder + config.railOffset);
          const y = this.planeY(road, i, lateral);
          vertexOf[i] = beams.vertexCount;
          for (let p = 0; p < points; p += 1) {
            const offset = lateral + side * RAIL_PROFILE[p][0];
            beams.vertex(road.px[i] + road.rx[i] * offset, y + RAIL_PROFILE[p][1] * (terminal ? 0.3 : 1) - (terminal ? 0.1 : 0), road.pz[i] + road.rz[i] * offset);
          }
          if (!terminal && i % 2 === 0) postSpots.push(road.px[i] + road.rx[i] * (lateral + side * 0.05), y, road.pz[i] + road.rz[i] * (lateral + side * 0.05), road.tx[i], road.tz[i]);
          if (!terminal && i % 8 === 4) {
            const face = lateral - side * 0.095;
            this.reflectorSpots.push(road.px[i] + road.rx[i] * face, y + 0.55, road.pz[i] + road.rz[i] * face, road.tx[i], road.tz[i]);
          }
          return vertexOf[i];
        };
        for (let i = 0; i < road.segments; i += 1) {
          const j = (i + 1) % count;
          if (!flags[i] || !flags[j]) continue;
          const a = ensure(i);
          const b = ensure(j);
          for (let p = 0; p < points - 1; p += 1) beams.quad(a + p, b + p, b + p + 1, a + p + 1);
        }
      }
    }

    // Ring around each plaza, open where its road arrives.
    for (const plaza of world.plazas) {
      const steps = 72;
      const radius = plaza.radius + config.railOffset;
      const open = [];
      for (let k = 0; k < steps; k += 1) {
        const angle = (k / steps) * Math.PI * 2;
        open.push(world.inPlazaEntry(plaza.x + Math.cos(angle) * radius, plaza.z + Math.sin(angle) * radius));
      }
      const base = beams.vertexCount;
      for (let k = 0; k < steps; k += 1) {
        const angle = (k / steps) * Math.PI * 2;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const terminal = open[(k + 1) % steps] || open[(k - 1 + steps) % steps];
        for (let p = 0; p < points; p += 1) {
          const r = radius + RAIL_PROFILE[p][0];
          beams.vertex(plaza.x + cos * r, plaza.y + RAIL_PROFILE[p][1] * (terminal ? 0.3 : 1) - (terminal ? 0.1 : 0), plaza.z + sin * r);
        }
        if (!open[k] && !terminal && k % 2 === 0) postSpots.push(plaza.x + cos * (radius + 0.05), plaza.y, plaza.z + sin * (radius + 0.05), -sin, cos);
        if (!open[k] && !terminal && k % 4 === 1) this.reflectorSpots.push(plaza.x + cos * (radius - 0.095), plaza.y + 0.55, plaza.z + sin * (radius - 0.095), -sin, cos);
      }
      for (let k = 0; k < steps; k += 1) {
        const next = (k + 1) % steps;
        if (open[k] || open[next]) continue;
        const a = base + k * points;
        const b = base + next * points;
        for (let p = 0; p < points - 1; p += 1) beams.quad(a + p, b + p, b + p + 1, a + p + 1);
      }
    }

    this.railMesh = this.addMesh(this.track(beams.build()), this.steelMaterial, 'Guardrails', { cast: true });

    const postGeometry = this.track(new THREE.BoxGeometry(0.1, 0.86, 0.14));
    const postMaterial = this.track(new THREE.MeshStandardMaterial({ color: 0x8f979e, roughness: 0.55, metalness: 0.6 }));
    const posts = new THREE.InstancedMesh(postGeometry, postMaterial, postSpots.length / 5);
    for (let n = 0; n < posts.count; n += 1) {
      const o = n * 5;
      this.setUpright(posts, n, postSpots[o], postSpots[o + 1] + 0.28, postSpots[o + 2], postSpots[o + 3], postSpots[o + 4]);
    }
    this.finishInstances(posts, 'GuardrailPosts', this.castSmallShadows);
  }

  finishInstances(mesh, name, cast = false) {
    mesh.name = name;
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox();
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    return mesh;
  }

  // ------------------------------------------------------------------ reflector posts

  buildDelineators() {
    const world = this.world;
    const config = this.config;
    const spots = [];
    for (const road of world.roads) {
      for (const side of [-1, 1]) {
        const flags = side < 0 ? road.railLeft : road.railRight;
        for (let i = 6; i < road.count; i += 12) {
          if (flags[i]) continue;
          const lateral = side * (road.halfWidth[i] + config.shoulder + 0.3);
          const x = road.px[i] + road.rx[i] * lateral;
          const z = road.pz[i] + road.rz[i] * lateral;
          if (this.coverClass(x, z, road.id) <= 1) continue;
          const y = this.planeY(road, i, lateral);
          spots.push(x, y, z, road.tx[i], road.tz[i]);
          this.reflectorSpots.push(x, y + 0.78, z, road.rx[i], road.rz[i]);
        }
      }
    }
    // White blade with a dark band near the top; the reflector sits in the band.
    const blade = new MeshBuffer({ colors: true });
    blade.box(0, 0.42, 0, 0.055, 0, 0, 0, 0.56, 0, 0, 0, 0.018, 0.92, 0.92, 0.9);
    blade.box(0, 0.78, 0, 0.058, 0, 0, 0, 0.1, 0, 0, 0, 0.021, 0.08, 0.08, 0.09);
    const material = this.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));
    const mesh = new THREE.InstancedMesh(this.track(blade.build()), material, spots.length / 5);
    for (let n = 0; n < mesh.count; n += 1) {
      const o = n * 5;
      this.setUpright(mesh, n, spots[o], spots[o + 1], spots[o + 2], spots[o + 3], spots[o + 4]);
    }
    this.finishInstances(mesh, 'Delineators', this.castSmallShadows);
  }

  buildReflectors() {
    const spots = this.reflectorSpots;
    const geometry = this.track(new THREE.BoxGeometry(0.05, 0.075, 0.1));
    const mesh = new THREE.InstancedMesh(geometry, this.reflectorMaterial, spots.length / 5);
    for (let n = 0; n < mesh.count; n += 1) {
      const o = n * 5;
      this.setUpright(mesh, n, spots[o], spots[o + 1], spots[o + 2], spots[o + 3], spots[o + 4]);
    }
    this.finishInstances(mesh, 'Reflectors');
    this.reflectorSpots = null;
  }

  // ------------------------------------------------------------------ corner chevrons

  buildChevrons() {
    const world = this.world;
    const config = this.config;
    // Boards alternate between the two directions of travel, each showing which way its traffic must turn.
    const spots = { right: [], left: [] };
    for (const road of world.roads) {
      let serial = 0;
      for (let i = 0; i < road.count; i += 3) {
        const curvature = road.curvature[i];
        if (Math.abs(curvature) < TIGHT_CORNER) continue;
        const side = curvature > 0 ? -1 : 1; // outside of the bend
        const lateral = side * (road.halfWidth[i] + config.shoulder + config.railOffset + 0.8);
        const x = road.px[i] + road.rx[i] * lateral;
        const z = road.pz[i] + road.rz[i] * lateral;
        if (this.coverClass(x, z, road.id) <= 1) continue;
        const travel = serial % 2 === 0 ? 1 : -1;
        serial += 1;
        // Face partly back along the approach and partly toward the inside of the bend.
        const nx = -side * road.rx[i] * 0.55 - travel * road.tx[i] * 0.83;
        const nz = -side * road.rz[i] * 0.55 - travel * road.tz[i] * 0.83;
        const turnsRight = curvature * travel > 0;
        (turnsRight ? spots.right : spots.left).push(x, this.planeY(road, i, lateral), z, nx, nz);
      }
    }
    const material = this.track(new THREE.MeshStandardMaterial({ map: this.textures.chevron, roughness: 0.55, metalness: 0.1 }));
    for (const kind of ['right', 'left']) {
      const list = spots[kind];
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(this.track(chevronGeometry(kind === 'left')), material, list.length / 5);
      for (let n = 0; n < mesh.count; n += 1) {
        const o = n * 5;
        this.setUpright(mesh, n, list[o], list[o + 1], list[o + 2], list[o + 3], list[o + 4]);
      }
      this.finishInstances(mesh, `Chevrons_${kind}`, this.castSmallShadows);
    }
  }

  // ------------------------------------------------------------------ summit

  /**
   * A stone obelisk on a plinth at every plaza, with a sign naming it (plaza.label, else SUMMIT) and
   * its displayed altitude. Plinths and obelisks are merged across plazas; each sign has its own texture.
   */
  buildSummitMarker() {
    const world = this.world;
    const plazas = world.plazas;
    this.summitSignMaterials = [];
    if (!plazas.length) return;
    const stone = new MeshBuffer({ colors: true });
    const obelisks = [];
    for (const plaza of plazas) {
      const road = world.roads[plaza.roadId] || world.roads[world.roads.length - 1];
      const last = road.count - 1;
      // Stand the marker on the far side of the plaza from the incoming road, facing arrivals.
      const ax = road.tx[last];
      const az = road.tz[last];
      const x = plaza.x + ax * (plaza.radius - 4.5);
      const z = plaza.z + az * (plaza.radius - 4.5);

      // Plinth squared up to the approach so the sign on its front face reads straight on.
      stone.box(x, plaza.y + 0.6, z, az * 1.5, 0, -ax * 1.5, 0, 0.6, 0, ax * 1.5, 0, az * 1.5, 0.5, 0.5, 0.48);
      stone.box(x, plaza.y + 1.3, z, az * 1.0, 0, -ax * 1.0, 0, 0.1, 0, ax * 1.0, 0, az * 1.0, 0.58, 0.58, 0.56);
      const obelisk = new THREE.CylinderGeometry(0.12, 0.62, 5.2, 4, 1);
      obelisk.rotateY(Math.atan2(ax, az) + Math.PI / 4);
      obelisk.translate(x, plaza.y + 1.4 + 2.6, z);
      obelisks.push(obelisk);

      const altitude = Math.round(world.displayAltitude ? world.displayAltitude(plaza.y) : plaza.y);
      const title = plaza.label ? plaza.label.toUpperCase() : 'SUMMIT';
      const label = this.track(createLabelTexture([title, `${altitude} M`], { width: 512, height: 256 }));
      const signMaterial = this.track(new THREE.MeshStandardMaterial({ map: label, roughness: 0.6, emissive: 0xffffff, emissiveMap: label, emissiveIntensity: this.night ? 0.7 : 0.12 }));
      if (!this.signGeometry) this.signGeometry = this.track(new THREE.PlaneGeometry(2.0, 1.0));
      const sign = new THREE.Mesh(this.signGeometry, signMaterial);
      sign.name = `SummitSign_${plaza.id}`;
      sign.position.set(x - ax * 1.52, plaza.y + 0.62, z - az * 1.52);
      sign.rotation.y = Math.atan2(-ax, -az);
      sign.castShadow = false;
      this.group.add(sign);
      this.summitSignMaterials.push(signMaterial);
    }
    const stoneMaterial = this.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }));
    this.addMesh(this.track(stone.build()), stoneMaterial, 'SummitPlinth', { cast: true });
    const obeliskGeometry = obelisks.length === 1 ? obelisks[0] : mergeGeometries(obelisks, false);
    if (obelisks.length > 1) obelisks.forEach((geometry) => geometry.dispose());
    const obeliskMaterial = this.track(new THREE.MeshStandardMaterial({ color: 0x9a9b97, roughness: 0.85, flatShading: true }));
    this.addMesh(this.track(obeliskGeometry), obeliskMaterial, 'SummitObelisk', { cast: true });
  }

  // ------------------------------------------------------------------ route gates

  /**
   * Show the start/finish gantry, start line and checkpoint gates of one route (an entry of world.routes),
   * or nothing when `route` is null.
   */
  setRoute(route) {
    this.clearGates();
    if (!route) return;
    const road = this.world.roads[route.roadId];
    const sameLine = route.closed || Math.abs(route.finishS - route.startS) < 1;
    this.addGantry(road, route.startS, route.direction, sameLine ? ['START  ·  FINISH'] : ['START']);
    if (!sameLine) this.addGantry(road, route.finishS, route.direction, ['FINISH']);

    const gates = route.checkpoints || [];
    if (!gates.length) return;
    const pylonGeometry = this.trackGate(new THREE.BoxGeometry(0.26, 3.1, 0.26));
    const capGeometry = this.trackGate(new THREE.BoxGeometry(0.34, 0.5, 0.34));
    const pylons = new THREE.InstancedMesh(pylonGeometry, this.darkMaterial, gates.length * 2);
    const caps = new THREE.InstancedMesh(capGeometry, this.lightMaterial, gates.length * 2);
    gates.forEach((s, index) => {
      road.frameAt(s, frame);
      const flat = Math.hypot(frame.rx, frame.rz) || 1;
      for (let k = 0; k < 2; k += 1) {
        const lateral = (k === 0 ? -1 : 1) * (frame.halfWidth + this.config.shoulder + this.config.railOffset + 0.7);
        const x = frame.x + (frame.rx / flat) * lateral;
        const z = frame.z + (frame.rz / flat) * lateral;
        const y = frame.y + lateral * frame.bank;
        this.setUpright(pylons, index * 2 + k, x, y + 1.25, z, frame.tx, frame.tz);
        this.setUpright(caps, index * 2 + k, x, y + 3.05, z, frame.tx, frame.tz);
      }
    });
    for (const mesh of [pylons, caps]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = mesh === pylons && this.castSmallShadows;
      mesh.receiveShadow = true;
      this.gates.add(mesh);
    }
  }

  trackGate(resource) {
    this.gateDisposables.push(resource);
    return resource;
  }

  addGantry(road, s, direction, lines) {
    road.frameAt(s, frame);
    const flat = Math.hypot(frame.rx, frame.rz) || 1;
    const rx = frame.rx / flat;
    const rz = frame.rz / flat;
    const tangentFlat = Math.hypot(frame.tx, frame.tz) || 1;
    const tx = frame.tx / tangentFlat;
    const tz = frame.tz / tangentFlat;
    const reach = frame.halfWidth + this.config.shoulder + this.config.railOffset + 0.9;
    const height = 5.6;
    const structure = new MeshBuffer();
    for (const side of [-1, 1]) {
      const x = frame.x + rx * side * reach;
      const z = frame.z + rz * side * reach;
      const y = frame.y + side * reach * frame.bank;
      structure.box(x, y + height * 0.5 - 0.4, z, rx * 0.16, 0, rz * 0.16, 0, height * 0.5 + 0.4, 0, tx * 0.16, 0, tz * 0.16);
    }
    structure.box(frame.x, frame.y + height, frame.z, rx * (reach + 0.3), 0, rz * (reach + 0.3), 0, 0.2, 0, tx * 0.2, 0, tz * 0.2);
    structure.box(frame.x, frame.y + height - 0.75, frame.z, rx * (reach + 0.1), 0, rz * (reach + 0.1), 0, 0.06, 0, tx * 0.08, 0, tz * 0.08);
    this.addMesh(this.trackGate(structure.build()), this.darkMaterial, 'Gantry', { cast: true, parent: this.gates });

    // Banner faces the cars coming toward it.
    const label = this.trackGate(createLabelTexture(lines, { width: 1024, height: 128 }));
    const bannerMaterial = this.trackGate(new THREE.MeshStandardMaterial({ map: label, emissive: 0xffffff, emissiveMap: label, emissiveIntensity: this.night ? 0.9 : 0.15, roughness: 0.6 }));
    const banner = new THREE.Mesh(this.trackGate(new THREE.PlaneGeometry(reach * 1.6, reach * 0.2)), bannerMaterial);
    banner.name = 'GantryBanner';
    banner.position.set(frame.x - tx * direction * 0.24, frame.y + height - 0.38 - reach * 0.02, frame.z - tz * direction * 0.24);
    banner.rotation.y = Math.atan2(-tx * direction, -tz * direction);
    banner.userData.banner = true;
    this.gates.add(banner);

    // Chequered line across the asphalt.
    const line = new MeshBuffer({ uvs: true, normals: true });
    const depth = 0.9;
    const corner = (lateral, along, u, v) => line.vertex(
      frame.x + rx * lateral + tx * along,
      frame.y + lateral * frame.bank + along * frame.grade + MARKING_LIFT + 0.006,
      frame.z + rz * lateral + tz * along,
      u, v, 1, 1, 1, frame.nx, frame.ny, frame.nz,
    );
    const half = frame.halfWidth - 0.4;
    line.quad(corner(-half, -depth, 0, 0), corner(half, -depth, 1, 0), corner(half, depth, 1, 1), corner(-half, depth, 0, 1));
    const lineMaterial = this.trackGate(new THREE.MeshStandardMaterial({
      map: this.textures.checker, roughness: 0.6, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -10,
    }));
    this.addMesh(this.trackGate(line.build()), lineMaterial, 'StartLine', { parent: this.gates });
  }

  clearGates() {
    while (this.gates.children.length) this.gates.remove(this.gates.children[0]);
    this.gateDisposables.forEach((resource) => resource.dispose());
    this.gateDisposables = [];
  }

  /** Brighten reflectors, gate lights and banners after dark. */
  setNight(isNight) {
    this.night = Boolean(isNight);
    this.reflectorMaterial.emissiveIntensity = this.night ? 1.8 : 0.25;
    this.lightMaterial.emissiveIntensity = this.night ? 2.4 : 0.9;
    for (const material of this.summitSignMaterials || []) material.emissiveIntensity = this.night ? 0.7 : 0.12;
    this.gates.traverse((node) => {
      if (node.userData.banner) node.material.emissiveIntensity = this.night ? 0.9 : 0.15;
    });
  }

  dispose() {
    this.clearGates();
    this.jungle?.ropes.dispose();
    this.disposables.forEach((resource) => resource.dispose());
    this.disposables = [];
    this.group.removeFromParent();
  }
}

/** Chevron board: textured face toward +Z, a plain back box and two legs. `mirror` flips the arrows. */
function chevronGeometry(mirror) {
  const buffer = new MeshBuffer({ uvs: true });
  const dark = 0.01; // UV of the plain dark texel
  buffer.box(0, 1.3, -0.025, 0.56, 0, 0, 0, 0.31, 0, 0, 0, 0.022, 1, 1, 1, dark, dark);
  for (const side of [-1, 1]) buffer.box(side * 0.38, 0.45, -0.06, 0.03, 0, 0, 0, 0.75, 0, 0, 0, 0.03, 1, 1, 1, dark, dark);
  const u0 = mirror ? 1 : 0;
  const u1 = mirror ? 0 : 1;
  const a = buffer.vertex(-0.55, 1.0, 0, u0, 1);
  const b = buffer.vertex(0.55, 1.0, 0, u1, 1);
  const c = buffer.vertex(0.55, 1.6, 0, u1, 0);
  const d = buffer.vertex(-0.55, 1.6, 0, u0, 0);
  buffer.quad(a, b, c, d);
  return buffer.build();
}
