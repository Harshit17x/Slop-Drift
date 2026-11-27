// Fujimi Rally scenery: the Blender GLB (tools/blender/fujimi) with the repo's original Tokyo art
// put on its facades by material name. Track kit is instanced from layout.json; the dense city, Mount
// Fuji, the skyline and the crest walls arrive merged and placed. Adds the ground, the bay, floodlight
// and street-lamp pools, moving point lights and the clipping zones that light up when you slide through.
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRandom } from '../world/noise.js';

// Literal new URL(..., import.meta.url) calls so Vite bundles every asset in production builds.
const SCENERY_URL = new URL('../assets/maps/fujimi/fujimi.glb', import.meta.url).href;
const TOWER_URL = new URL('../assets/maps/tokyo-tower.glb', import.meta.url).href;
const ADS = [new URL('../assets/maps/tokyo-ad0.webp', import.meta.url).href, new URL('../assets/maps/tokyo-ad1.webp', import.meta.url).href, new URL('../assets/maps/tokyo-ad2.webp', import.meta.url).href, new URL('../assets/maps/tokyo-ad3.webp', import.meta.url).href];
// Facade atlases (tools/blender/fujimi/make_facades.py): 2 x 2 slots, albedo plus a lit-window mask.
const ATLASES = {
  FJ_tex_office: [new URL('../assets/maps/fujimi/office-atlas.webp', import.meta.url).href, new URL('../assets/maps/fujimi/office-atlas-emit.webp', import.meta.url).href],
  FJ_tex_res: [new URL('../assets/maps/fujimi/res-atlas.webp', import.meta.url).href, new URL('../assets/maps/fujimi/res-atlas-emit.webp', import.meta.url).href],
};
const FUJI_URL = new URL('../assets/maps/fujimi/fuji.webp', import.meta.url).href;
// Slots of the 2048 x 1024 shop atlas, in the order build_fujimi.py's SHOP_SLOTS expects.
const GRILL = new URL('../assets/maps/tokyo-grill.webp', import.meta.url).href;
const MARKET = new URL('../assets/maps/tokyo-market.webp', import.meta.url).href;
const RAMEN = new URL('../assets/maps/tokyo-ramen.webp', import.meta.url).href;
const SHOP_ART = [GRILL, MARKET, RAMEN, new URL('../assets/maps/tokyo-gamehall.webp', import.meta.url).href,
  new URL('../assets/maps/tokyo-workshop.webp', import.meta.url).href, new URL('../assets/maps/tokyo-shops.webp', import.meta.url).href, RAMEN, MARKET];
// Eight vertical neon blades for the sign atlas (original names, drawn with system Japanese fonts).
const BLADES = [['カラオケ', '#ff2d8a'], ['ラーメン', '#ffb21a'], ['居酒屋', '#e0242e'], ['焼肉', '#ff6a00'],
  ['ホテル', '#7b5cff'], ['薬局', '#18c27a'], ['ゲーム', '#16b8ff'], ['駐車場', '#2b5bff']];
const EMISSIVE = { FJ_tex_office: 1.15, FJ_tex_res: 1.05, FJ_tex_shops: 0.9 };
const DAY_GLOW = 0.12;   // share of the night glow left on windows and shopfronts in daylight
const QUAY_Z = 246;            // game z of the waterfront (Blender y = -246)
const ZONE_IDLE = new T.Color(0x35e6ff);
const ZONE_HIT = new T.Color(0xff3cb4);
const BONUS = 250;

export class FujimiScene {
  constructor({ world, quality }) {
    this.world = world;
    this.group = new T.Group();
    this.group.name = 'Fujimi Rally';
    this.disposables = [];
    this.zones = (world.driftZones || []).map((zone) => ({ ...zone, glow: 0, armed: true, posts: [] }));
    this.sources = [];      // floodlights and street lamps: {x, y, z, fx, fz, mast}
    this.anisotropy = Math.max(1, Math.min(8, quality?.anisotropy ?? 4));
    this.buildGround();
    this.lights = [0, 1, 2, 3].map(() => {
      const light = new T.PointLight(0xffe2b8, 0, 40, 1.6);
      this.group.add(light);
      return light;
    });
    // Lit windows and signs: [material, night intensity]. By day they drop to a faint glow.
    this.glowing = [];
    this.night = null;
    // Game awaits this before the first frame (same hook as Tokyo's tower). Reflections come from the sky.
    this.towerReady = this.load()
      .catch((error) => console.error('Could not load the Fujimi scenery', error));
  }

  track(item) {
    this.disposables.push(item);
    return item;
  }

  texture(src, repeat = false) {
    const tex = this.track(new T.TextureLoader().load(src));
    tex.flipY = false;            // glTF UVs
    tex.colorSpace = T.SRGBColorSpace;
    tex.anisotropy = this.anisotropy;
    if (repeat) tex.wrapS = tex.wrapT = T.RepeatWrapping;
    return tex;
  }

  /** A canvas texture drawn now and again as its images arrive. */
  atlas(width, height, draw) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const tex = this.track(new T.CanvasTexture(canvas));
    tex.flipY = false;
    tex.colorSpace = T.SRGBColorSpace;
    tex.anisotropy = this.anisotropy;
    const ctx = canvas.getContext('2d');
    const loader = new T.ImageLoader();
    draw(ctx, (src, x, y, w, h) => loader.load(src, (img) => { ctx.drawImage(img, x, y, w, h); tex.needsUpdate = true; }));
    tex.needsUpdate = true;
    return tex;
  }

  buildAtlases() {
    this.shopAtlas = this.atlas(2048, 1024, (ctx, put) => {
      ctx.fillStyle = '#2a2622';
      ctx.fillRect(0, 0, 2048, 1024);
      SHOP_ART.forEach((src, k) => put(src, (k % 4) * 512, Math.floor(k / 4) * 512, 512, 512));
    });
    this.signAtlas = this.atlas(2048, 1024, (ctx, put) => {
      ctx.fillStyle = '#0b0b10';
      ctx.fillRect(0, 0, 2048, 1024);
      ADS.forEach((src, k) => put(src, (k % 2) * 512, Math.floor(k / 2) * 512, 512, 512));
      BLADES.forEach(([text, color], k) => {
        const x = 1024 + k * 128;
        ctx.fillStyle = color;
        ctx.fillRect(x + 6, 6, 116, 1012);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 6;
        ctx.strokeRect(x + 14, 14, 100, 996);
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 84px "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const chars = [...text];
        const step = Math.min(200, 900 / chars.length);
        chars.forEach((ch, i) => ctx.fillText(ch, x + 64, 512 + (i - (chars.length - 1) / 2) * step));
      });
    });
  }

  buildGround() {
    // Concrete apron with slab joints and oil stains.
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    const rand = createRandom(2611);
    const img = ctx.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 58 + rand() * 18;
      img.data.set([v, v + 1, v + 4, 255], i);
    }
    ctx.putImageData(img, 0, 0);
    ctx.strokeStyle = 'rgba(20,20,24,.6)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, 256, 256);
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = `rgba(10,10,12,${0.08 + rand() * 0.12})`;
      ctx.beginPath();
      ctx.ellipse(rand() * 256, rand() * 256, 8 + rand() * 30, 5 + rand() * 16, rand() * 3, 0, 7);
      ctx.fill();
    }
    const tex = this.track(new T.CanvasTexture(c));
    tex.colorSpace = T.SRGBColorSpace;
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    tex.repeat.set(220, 220);
    tex.anisotropy = this.anisotropy;
    const ground = new T.Mesh(this.track(new T.PlaneGeometry(4400, 4400)),
      this.track(new T.MeshStandardMaterial({ map: tex, roughness: 0.62, metalness: 0.08 })));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.06;
    ground.receiveShadow = true;
    this.group.add(ground);

    // Tokyo Bay south of the quay: glossy, it mirrors the sky.
    const bay = new T.Mesh(this.track(new T.PlaneGeometry(9000, 4000)),
      this.track(new T.MeshStandardMaterial({ color: 0x1b4660, roughness: 0.12, metalness: 0.35, envMapIntensity: 1.2 })));
    bay.rotation.x = -Math.PI / 2;
    bay.position.set(0, -1.6, QUAY_Z + 0.6 + 2000);
    this.group.add(bay);
  }

  async load() {
    this.buildAtlases();
    this.ads = ADS.map((src) => this.texture(src));
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(SCENERY_URL);
    if (this.disposed) return;
    const placements = this.world.mapData?.placements || {};
    for (const node of [...gltf.scene.children]) {   // copy: adding a backdrop node re-parents it
      if (node.name.startsWith('BG_')) this.addBackdrop(node);
      else if (placements[node.name]) this.addInstances(node, placements[node.name]);
    }
    this.buildPools();
    this.addTower();
  }

  /** The material for a glTF material name. The export has no normals, so lit surfaces shade flat. */
  material(source, hasColors) {
    this.materialCache ??= new Map();
    const key = `${source.name}|${hasColors}`;
    if (this.materialCache.has(key)) return this.materialCache.get(key);
    const name = source.name;
    let material;
    if (ATLASES[name]) {
      material = this.facadeMaterial(name, hasColors);
    } else if (name === 'FJ_tex_shops') {
      material = new T.MeshStandardMaterial({ map: this.shopAtlas, emissiveMap: this.shopAtlas, emissive: 0xffffff,
        emissiveIntensity: EMISSIVE[name], roughness: 0.55, vertexColors: hasColors, flatShading: true });
      this.glowing.push([material, EMISSIVE[name]]);
      material.emissiveIntensity = EMISSIVE[name] * (this.night ? 1 : DAY_GLOW);
    } else if (name === 'FJ_fuji') {
      // Fuji's sunlight and haze are baked into its texture; scene fog would hide it, so it is unlit and clear.
      material = new T.MeshBasicMaterial({ map: this.texture(FUJI_URL), fog: false });
    } else if (name === 'FJ_dirt') {
      // Soft-edged grime: opaque at the blob centre (u = 0), clear at its rim (u = 1).
      const ramp = document.createElement('canvas');
      ramp.width = 64;
      ramp.height = 1;
      const g = ramp.getContext('2d').createLinearGradient(0, 0, 64, 0);
      g.addColorStop(0, '#fff');
      g.addColorStop(0.45, '#999');
      g.addColorStop(1, '#000');
      const rctx = ramp.getContext('2d');
      rctx.fillStyle = g;
      rctx.fillRect(0, 0, 64, 1);
      material = new T.MeshStandardMaterial({ color: 0x3d3022, alphaMap: this.track(new T.CanvasTexture(ramp)), vertexColors: true,
        transparent: true, opacity: 0.85, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    } else if (name === 'FJ_tex_signs') {
      material = new T.MeshBasicMaterial({ map: this.signAtlas, toneMapped: false });
      material.color.setScalar(0.9);
    } else if (name === 'FJ_glow') {
      material = new T.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    } else if (name === 'FJ_backdrop') {
      // Fuji's moonlight is baked into its vertex colours; fog would hide it, so it is unlit and clear.
      material = new T.MeshBasicMaterial({ vertexColors: true, fog: false });
    } else if (name === 'FJ_skid') {
      material = new T.MeshBasicMaterial({ color: 0x000000, vertexColors: true, transparent: true, opacity: 0.55,
        depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    } else {
      material = source.clone();
      material.flatShading = true;
      material.vertexColors = hasColors;
      if (material.emissiveIntensity > 1) material.toneMapped = false;
    }
    this.track(material);
    this.materialCache.set(key, material);
    return material;
  }

  /**
   * A facade atlas material. UVs are (slot * 100 + u, v) in repeats: the shader picks the slot, tiles it
   * with fract() and samples with the continuous gradient so mip levels hold across seams. Only the
   * lit-window mask glows, scaled per building by its vertex tint.
   */
  facadeMaterial(name, hasColors) {
    const [albedoUrl, emitUrl] = ATLASES[name];
    const map = this.texture(albedoUrl);
    const emissiveMap = this.texture(emitUrl);
    const office = name === 'FJ_tex_office';
    const material = new T.MeshStandardMaterial({ map, emissiveMap, emissive: 0xffffff, emissiveIntensity: EMISSIVE[name],
      roughness: office ? 0.35 : 0.8, metalness: office ? 0.3 : 0.02, vertexColors: hasColors, flatShading: true });
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <map_fragment>', `
          float fjSlot = floor(vMapUv.x / 100.0);
          vec2 fjLocal = vec2(vMapUv.x - fjSlot * 100.0, vMapUv.y);
          vec2 fjUv = (vec2(mod(fjSlot, 2.0), floor(fjSlot / 2.0)) + 0.002 + fract(fjLocal) * 0.996) * 0.5;
          vec2 fjDx = dFdx(fjLocal) * 0.5;
          vec2 fjDy = dFdy(fjLocal) * 0.5;
          diffuseColor *= textureGrad(map, fjUv, fjDx, fjDy);`)
        .replace('#include <emissivemap_fragment>', `
          totalEmissiveRadiance *= textureGrad(emissiveMap, fjUv, fjDx, fjDy).rgb;
          #ifdef USE_COLOR
            totalEmissiveRadiance *= vColor.rgb * vColor.rgb * 1.35;
          #endif`);
    };
    material.customProgramCacheKey = () => `fujimi-facade-${name}`;
    this.glowing.push([material, EMISSIVE[name]]);
    material.emissiveIntensity = EMISSIVE[name] * (this.night ? 1 : DAY_GLOW);
    return material;
  }

  addBackdrop(node) {
    node.traverse((mesh) => {
      if (!mesh.isMesh) return;
      this.track(mesh.geometry);
      mesh.material = this.material(mesh.material, Boolean(mesh.geometry.attributes.color));
      if (node.name === 'BG_Fuji') mesh.renderOrder = -5;
    });
    this.group.add(node);
  }

  /** One InstancedMesh per primitive (and per billboard variant), placed from layout.json. */
  addInstances(node, group) {
    const parts = [];
    node.traverse((child) => { if (child.isMesh) parts.push(child); });
    const count = group.t.length / 4;
    const variants = group.variant ? [...new Set(group.variant)] : [null];
    const matrix = new T.Matrix4();
    const position = new T.Vector3();
    const rotation = new T.Quaternion();
    const one = new T.Vector3(1, 1, 1);
    const up = new T.Vector3(0, 1, 0);
    const color = new T.Color();
    const kit = node.name.startsWith('K_');
    for (const variant of variants) {
      const members = [];
      for (let k = 0; k < count; k++) if (variant === null || group.variant[k] === variant) members.push(k);
      for (const part of parts) {
        const name = part.material.name;
        let material;
        if (name === 'FJ_billboard') {
          material = this.track(new T.MeshBasicMaterial({ map: node.name === 'K_Gantry' ? this.startScreen() : this.ads[(variant ?? 0) % 4],
            toneMapped: false }));
          material.color.setScalar(0.85);
        } else if (node.name === 'K_ClipPost' && name === 'FJ_neon_cyan') {
          material = this.track(new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
        } else if (/^K_(Tree|Bush)/.test(node.name)) {
          // Foliage: weld the blobs (one colour each) and smooth-shade them so canopies read soft, not faceted.
          part.geometry = mergeVertices(part.geometry, 1e-3);
          part.geometry.computeVertexNormals();
          this.foliage ??= this.track(new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }));
          material = this.foliage;
        } else {
          material = this.material(part.material, Boolean(part.geometry.attributes.color));
        }
        const mesh = new T.InstancedMesh(this.track(part.geometry), material, members.length);
        mesh.name = `${node.name}:${name}`;
        members.forEach((k, n) => {
          const t = group.t;
          position.set(t[k * 4], t[k * 4 + 1], t[k * 4 + 2]);
          rotation.setFromAxisAngle(up, t[k * 4 + 3]);
          mesh.setMatrixAt(n, matrix.compose(position, rotation, one));
          if (group.tint) mesh.setColorAt(n, color.setHex(group.tint[k]));
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        // Night: only the tall structures throw moon shadows (the low kit would double its triangles).
        mesh.castShadow = /^K_(Mast|Gantry|Grandstand|Billboard|Crane|Tree\w+)$/.test(node.name);
        mesh.receiveShadow = kit;
        this.group.add(mesh);
        if (node.name === 'K_ClipPost' && name === 'FJ_neon_cyan') this.bindPosts(mesh, group);
      }
    }
    if (node.name === 'K_Mast' || node.name === 'K_StreetLamp') {
      const mast = node.name === 'K_Mast';
      for (let k = 0; k < count; k++) {
        const yaw = group.t[k * 4 + 3];
        this.sources.push({ x: group.t[k * 4], y: group.t[k * 4 + 1], z: group.t[k * 4 + 2], fx: Math.sin(yaw), fz: Math.cos(yaw), mast });
      }
    }
  }

  /** Each clipping post glows in its zone's colour. */
  bindPosts(mesh, group) {
    this.postMesh = mesh;
    for (let k = 0; k < group.t.length / 4; k++) {
      const x = group.t[k * 4];
      const z = group.t[k * 4 + 2];
      let best = null;
      let bestD = Infinity;
      for (const zone of this.zones) {
        const d = Math.hypot(zone.x - x, zone.z - z);
        if (d < bestD) { bestD = d; best = zone; }
      }
      best?.posts.push(k);
      mesh.setColorAt(k, ZONE_IDLE);
    }
    mesh.instanceColor.needsUpdate = true;
  }

  startScreen() {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#12051a';
    ctx.fillRect(0, 0, 1024, 128);
    ctx.fillStyle = '#ff3cb4';
    ctx.fillRect(0, 118, 1024, 10);
    ctx.font = '700 italic 68px "Chakra Petch", "Hiragino Sans", "Yu Gothic", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('富士見  RALLY', 40, 62);
    ctx.fillStyle = '#35e6ff';
    ctx.textAlign = 'right';
    ctx.fillText('START', 990, 62);
    const tex = this.track(new T.CanvasTexture(c));
    tex.flipY = false;            // glTF UVs
    tex.colorSpace = T.SRGBColorSpace;
    return tex;
  }

  /** Warm light pools on the ground in front of every floodlight and street lamp (additive decals). */
  buildPools() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const fade = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    fade.addColorStop(0, 'rgba(255,255,255,1)');
    fade.addColorStop(0.3, 'rgba(255,255,255,.5)');
    fade.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, 64, 64);
    const tex = this.track(new T.CanvasTexture(c));
    const quad = this.track(new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
    const pools = new T.InstancedMesh(quad, this.track(new T.MeshBasicMaterial({ map: tex, color: 0x6f6a62, transparent: true,
      depthWrite: false, blending: T.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4 })), this.sources.length);
    const m = new T.Matrix4();
    const ground = {};
    const up = new T.Vector3(0, 1, 0);
    const tilt = new T.Quaternion();
    const normal = new T.Vector3();
    const where = new T.Vector3();
    const size = new T.Vector3();
    this.sources.forEach((s, k) => {
      const reach = s.mast ? 10 : 2;
      size.set(s.mast ? 30 : 13, 1, s.mast ? 24 : 13);
      // Sit each pool on the surface under it, tilted to its slope (the road climbs and drops past the masts).
      const x = s.x + s.fx * reach;
      const z = s.z + s.fz * reach;
      this.world.sampleGround(x, z, ground, s.y + 2);
      const onGround = ground.y > -0.06;
      tilt.setFromUnitVectors(up, onGround ? normal.set(ground.nx, ground.ny, ground.nz).normalize() : up);
      m.compose(where.set(x, Math.max(ground.y, -0.06) + 0.06, z), tilt, size);
      pools.setMatrixAt(k, m);
    });
    pools.renderOrder = 2;
    pools.visible = this.night === true;
    this.pools = pools;
    this.group.add(pools);
  }

  addTower() {
    const tower = this.world.tower;
    if (!tower) return;
    new GLTFLoader().loadAsync(TOWER_URL).then(({ scene }) => {
      if (this.disposed) {
        scene.traverse((n) => { n.geometry?.dispose(); n.material?.dispose(); });
        return;
      }
      scene.traverse((n) => { if (n.isMesh) { this.track(n.geometry); this.track(n.material); } });
      scene.position.set(tower.x, 0, tower.z);
      this.group.add(scene);
    });
  }

  /**
   * Called once per simulation step. A drift through a zone pays a clip bonus once per pass and
   * flashes its posts; returns { name, bonus } on the frame it pays.
   */
  clipZone(state, drift) {
    let paid = null;
    for (const zone of this.zones) {
      const d = Math.hypot(state.position.x - zone.x, state.position.z - zone.z);
      if (d > 26) zone.armed = true;
      else if (zone.armed && d < 10 && drift?.active) {
        zone.armed = false;
        zone.glow = 1;
        paid = { name: zone.name, bonus: BONUS };
      }
    }
    return paid;
  }

  setQuality() {}

  /** Day or night: windows and shopfronts glow fully only at night; light pools and point lights are night-only. */
  setNight(night) {
    if (night === this.night) return;
    this.night = night;
    for (const [material, intensity] of this.glowing) material.emissiveIntensity = intensity * (night ? 1 : DAY_GLOW);
    if (this.pools) this.pools.visible = night;
    if (!night) for (const light of this.lights) light.intensity = 0;
  }

  update(cameraPosition, dt = 0, night = false) {
    this.setNight(Boolean(night));
    // Flash fading clipping zones back to cyan.
    if (this.postMesh) {
      const color = new T.Color();
      let dirty = false;
      for (const zone of this.zones) {
        if (zone.glow <= 0) continue;
        zone.glow = Math.max(0, zone.glow - dt * 0.6);
        color.copy(ZONE_IDLE).lerp(ZONE_HIT, Math.min(1, zone.glow * 1.5));
        for (const k of zone.posts) this.postMesh.setColorAt(k, color);
        dirty = true;
      }
      if (dirty) this.postMesh.instanceColor.needsUpdate = true;
    }
    // Four real lights ride on the nearest floodlights and lamps so the car body catches them.
    this.lightTimer = (this.lightTimer || 0) - dt;
    if (this.night && this.sources.length && this.lightTimer <= 0) {
      this.lightTimer = 0.25;
      const near = this.sources.map((s) => [Math.hypot(s.x - cameraPosition.x, s.z - cameraPosition.z), s])
        .sort((a, b) => a[0] - b[0]);
      this.lights.forEach((light, k) => {
        const [d, s] = near[k];
        const reach = s.mast ? 7 : 1.6;
        light.position.set(s.x + s.fx * reach, s.y + (s.mast ? 11 : 6.2), s.z + s.fz * reach);
        light.intensity = d < 110 ? (s.mast ? 120 : 60) : 0;
        light.distance = s.mast ? 46 : 22;
      });
    }
  }

  dispose() {
    this.disposed = true;
    for (const item of this.disposables) item.dispose?.();
    this.group.removeFromParent();
  }
}
