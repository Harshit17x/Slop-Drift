import * as T from 'three';

// A natural rock shell is swept along the surveyed road. The terrain keeps the
// carriageway carved; this module hides the cutting with a roof strip, two
// portal faces and an irregular arch. Nothing here changes the road profile.
const TAU = Math.PI * 2;

function archHeight(lat, half, height) {
  const t = Math.min(1, Math.abs(lat) / half);
  return height * Math.sqrt(Math.max(0, 1 - t * t));
}

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const c = canvas.getContext('2d');
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,226,170,1)');
  g.addColorStop(.28, 'rgba(255,168,74,.62)');
  g.addColorStop(.62, 'rgba(255,112,36,.2)');
  g.addColorStop(1, 'rgba(255,90,20,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  return texture;
}

function flameTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 96;
  const c = canvas.getContext('2d');
  const body = c.createRadialGradient(32, 60, 2, 32, 56, 42);
  body.addColorStop(0, 'rgba(255,255,232,1)');
  body.addColorStop(.22, 'rgba(255,232,142,1)');
  body.addColorStop(.52, 'rgba(255,150,40,.86)');
  body.addColorStop(.78, 'rgba(230,70,10,.34)');
  body.addColorStop(1, 'rgba(120,20,0,0)');
  c.fillStyle = body;
  c.beginPath();
  c.moveTo(32, 3);
  c.bezierCurveTo(47, 30, 59, 52, 50, 73);
  c.bezierCurveTo(44, 89, 20, 89, 14, 73);
  c.bezierCurveTo(5, 52, 17, 30, 32, 3);
  c.fill();
  const core = c.createRadialGradient(32, 62, 1, 32, 62, 18);
  core.addColorStop(0, 'rgba(255,255,244,1)');
  core.addColorStop(.6, 'rgba(255,224,130,.9)');
  core.addColorStop(1, 'rgba(255,160,40,0)');
  c.fillStyle = core;
  c.beginPath();
  c.ellipse(32, 62, 12, 18, 0, 0, Math.PI * 2);
  c.fill();
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  return texture;
}

// A tileable grey value-noise field used as a bump map. Vertex colours carry
// the large-scale tone; this carries the grain and cracks that make the shell
// read as stone under a moving headlight.
function rockTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  const image = context.createImageData(size, size);
  const hash = (x, y) => {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const smooth = (t) => t * t * (3 - 2 * t);
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    const u = smooth(xf), v = smooth(yf);
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let value = 0, amplitude = .5, frequency = 3;
      for (let octave = 0; octave < 5; octave += 1) {
        value += amplitude * noise((x * frequency) / size, (y * frequency) / size);
        amplitude *= .5;
        frequency *= 2;
      }
      // Strata and hairline cracks.
      value += .09 * Math.sin(y * .11 + noise(x * .02, y * .02) * 7);
      const crack = noise((x * .045) + 11.3, (y * .09) + 4.7);
      if (crack > .735) value *= .55;
      const shade = Math.max(0, Math.min(255, Math.round(value * 255)));
      const i = (y * size + x) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = shade;
      image.data[i + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new T.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

function sweepShell(world, random) {
  const cave = world.cave, road = world.roads[cave.roadId];
  const ring = 41;
  const length = cave.s1 - cave.s0 + 6;
  const rings = 260;
  // Uneven ring spacing stops the facets from lining up into corrugation.
  const steps = new Float32Array(rings);
  let total = 0;
  for (let i = 0; i < rings; i += 1) { steps[i] = .55 + random(); total += steps[i]; }
  let travelled = 0;
  const positions = [], colors = [], uvs = [], indices = [];
  const colour = new T.Color();
  for (let i = 0; i < rings; i += 1) {
    const s = cave.s0 - 3 + (length * travelled) / total;
    travelled += steps[i];
    const f = road.frameAt(s, {});
    const jitter = (random() - .5) * 1.6;
    for (let j = 0; j < ring; j += 1) {
      const a = Math.PI * (1 - j / (ring - 1));
      // Three superimposed waves at different frequencies break the tube into
      // buttresses, ledges and hollows instead of a smooth extruded arch.
      const wobble = 1
        + .055 * Math.sin(s * .091 + a * 2.7)
        + .038 * Math.sin(s * .233 - a * 5.1)
        + .022 * Math.sin(s * .571 + a * 8.3);
      const rx = (cave.shellHalf + .35) * wobble;
      const ry = (cave.shellHeight + .35)
        * (.94 + .055 * Math.sin(s * .067 + a * 2.3) + .028 * Math.sin(s * .311 - a * 4.9));
      let lat = Math.cos(a) * rx;
      let y = Math.sin(a) * ry;
      if (j === 0 || j === ring - 1) { lat *= 1.03; y = -1.5; }
      positions.push(
        f.x + lat * f.rx + (jitter + .35 * Math.sin(s * .7 + a * 11)) * f.tx,
        f.y + y,
        f.z + lat * f.rz + (jitter + .35 * Math.sin(s * .7 + a * 11)) * f.tz,
      );
      // Layered colour noise, kept very dark: the headlights and the torches
      // should be the only things that make the rock readable.
      const n = .5 + .5 * Math.sin(s * .17 + a * 4.3 + f.x * .011);
      const m = .5 + .5 * Math.sin(s * .41 - a * 7.9 + f.z * .017);
      const grain = .5 + .5 * Math.sin(s * 2.7 + a * 23 + f.x * .061);
      const grit = .5 + .5 * Math.sin(s * 5.3 - a * 37 + f.z * .093);
      const band = .5 + .5 * Math.sin(y * .9 + s * .05);
      const base = .008 + .014 * n + .010 * m * (.6 + .4 * band) + .006 * grain + .004 * grit;
      colour.setRGB(base * .94, base * .99, base * 1.03);
      if (n > .9) colour.multiplyScalar(1.25);
      colors.push(colour.r, colour.g, colour.b);
      uvs.push(s / 8, a * 3);
    }
  }
  for (let i = 0; i < rings - 1; i += 1) {
    for (let j = 0; j < ring - 1; j += 1) {
      const a = i * ring + j, b = a + ring, c = a + 1, d = b + 1;
      indices.push(a, b, d, a, d, c);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function roofStrip(world) {
  const cave = world.cave, road = world.roads[cave.roadId];
  const half = cave.roofHalf, cols = 12, step = 6;
  const rows = Math.ceil((cave.s1 - cave.s0 - 2) / step) + 1;
  const positions = [], colors = [], uvs = [], indices = [];
  const colour = new T.Color();
  for (let i = 0; i < rows; i += 1) {
    const s = cave.s0 + 1 + ((cave.s1 - cave.s0 - 2) * i) / (rows - 1);
    const f = road.frameAt(s, {});
    for (let j = 0; j <= cols; j += 1) {
      const lat = -half + (2 * half * j) / cols;
      const x = f.x + lat * f.rx, z = f.z + lat * f.rz;
      positions.push(x, cave.surface(x, z) + .14, z);
      const n = .5 + .5 * Math.sin(x * .037 + z * .029);
      colour.setRGB(.035 + .04 * n, .034 + .038 * n, .032 + .034 * n);
      colors.push(colour.r, colour.g, colour.b);
      uvs.push((lat + half) / 4, s / 8);
    }
  }
  for (let i = 0; i < rows - 1; i += 1) {
    for (let j = 0; j < cols; j += 1) {
      const a = i * (cols + 1) + j, b = a + cols + 1, c = a + 1, d = b + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function portalFace(world, random, s, outward) {
  const cave = world.cave, road = world.roads[cave.roadId];
  const f = road.frameAt(s, {});
  const half = cave.roofHalf + 2, cols = 34, rows = 12;
  const positions = [], colors = [], uvs = [], indices = [];
  const colour = new T.Color();
  // The top of the face is pushed a couple of metres back into the mountain
  // and the opening edge is deliberately uneven, so the mouth reads as a break
  // in the rock rather than a freestanding arch.
  const lean = new Float32Array(cols + 1);
  for (let j = 0; j <= cols; j += 1) {
    lean[j] = 1.2 + random() * 3.6;
  }
  const mouth = (lat) => {
    const t = Math.min(1, Math.abs(lat) / cave.shellHalf);
    const shape = 1 + .07 * Math.sin(lat * 1.9 + 1.1) + .045 * Math.sin(lat * 4.3 - .7);
    return cave.shellHeight * Math.sqrt(Math.max(0, 1 - t * t)) * shape;
  };
  for (let j = 0; j <= cols; j += 1) {
    const lat = -half + (2 * half * j) / cols;
    const x = f.x + lat * f.rx, z = f.z + lat * f.rz;
    // The top edge sits just above the terrain so it hides the front of the
    // roof strip; the slope behind the portal then rises past it.
    const top = cave.surface(x, z) + 3.5;
    const bottom = Math.abs(lat) <= cave.shellHalf
      ? f.y + mouth(lat) + .08
      : f.y - 1.4;
    for (let i = 0; i <= rows; i += 1) {
      const t = i / rows;
      // Broad lobes and finer creases push the face in and out of the portal
      // plane, so the headlights rake across rock instead of a flat sheet.
      const relief = 2.4 * Math.sin(lat * .31 + t * 3.7) + 1.3 * Math.sin(lat * .77 - t * 8.1 + 1.7);
      const push = -outward * (lean[j] * t + relief * (.35 + .65 * t));
      const side = (random() - .5) * .9;
      const px = x + push * f.tx + side * f.rx;
      const pz = z + push * f.tz + side * f.rz;
      const y = bottom + (top - bottom) * t + (i > 0 && i < rows ? (random() - .5) * .5 : 0);
      positions.push(px, y, pz);
      const n = .5 + .5 * Math.sin(lat * 1.7 + y * .9 + x * .013);
      const m = .5 + .5 * Math.sin(lat * .53 - y * .31 + 2.1);
      const base = .012 + .024 * n + .012 * m;
      colour.setRGB(base * 1.06, base, base * .91);
      colors.push(colour.r, colour.g, colour.b);
      uvs.push((lat + half) / 8, (y - f.y) / 8);
    }
  }
  for (let j = 0; j < cols; j += 1) {
    for (let i = 0; i < rows; i += 1) {
      const a = j * (rows + 1) + i, b = (j + 1) * (rows + 1) + i, c = a + 1, d = b + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function buildHollowCave(world, random) {
  const cave = world.cave;
  if (!cave) return null;
  const road = world.roads[cave.roadId];
  const group = new T.Group();
  group.name = 'Hollow Vein cave';
  const rockMap = rockTexture();
  const rock = new T.MeshStandardMaterial({ vertexColors: true, roughness: .99, metalness: .01, bumpMap: rockMap, bumpScale: .16, side: T.DoubleSide });
  const darkRock = new T.MeshStandardMaterial({ color: 0x3c3d36, roughness: 1, metalness: .01, flatShading: true });
  const wood = new T.MeshStandardMaterial({ color: 0x2c221a, roughness: .92 });
  const flameMap = flameTexture();
  const flameMaterial = new T.PointsMaterial({
    map: flameMap, color: 0xffb060, size: 1.15, transparent: true, opacity: .92,
    blending: T.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const glowMap = glowTexture();
  const spillMaterial = new T.MeshBasicMaterial({
    map: glowMap, color: 0xff9a4a, transparent: true, opacity: .42,
    blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide,
  });
  const objects = [];
  const add = (geometry, material) => {
    const mesh = new T.Mesh(geometry, material);
    group.add(mesh);
    objects.push(mesh);
    return mesh;
  };

  // The inner shell ignores distance fog: a lit grey haze inside would read as
  // a hangar. The walls stay black and only the exit glows.
  const shellRock = rock.clone();
  shellRock.fog = false;
  add(sweepShell(world, random), shellRock);
  add(roofStrip(world), rock);
  add(portalFace(world, random, cave.s0, -1), rock);
  add(portalFace(world, random, cave.s1, 1), rock);

  // Stalactites, stalagmites and wall outcrops share one draw call each.
  const dummy = new T.Object3D();
  const matrices = [];
  const push = (x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0, order = 'XYZ') => {
    dummy.position.set(x, y, z);
    dummy.rotation.set(rx, ry, rz, order);
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    matrices.push(dummy.matrix.clone());
  };
  const stalactites = [];
  for (let s = cave.s0 + 5; s < cave.s1 - 5; s += 5.5) {
    const f = road.frameAt(s, {});
    const lat = (random() - .5) * 7.2;
    const ceiling = f.y + archHeight(lat, cave.shellHalf, cave.shellHeight) - .15;
    const length = .8 + random() * 2.8;
    const width = .3 + random() * .55;
    push(f.x + lat * f.rx, ceiling - length * .5 + .6, f.z + lat * f.rz, width, length, width, Math.PI, random() * TAU, 0);
    stalactites.push({ x: f.x + lat * f.rx, y: ceiling, z: f.z + lat * f.rz, length });
  }
  const stalagmites = [];
  for (let s = cave.s0 + 9; s < cave.s1 - 9; s += 8) {
    const f = road.frameAt(s, {});
    const side = random() < .5 ? -1 : 1;
    const lat = side * (6.6 + random() * 1.1);
    const length = .35 + random() * 1.5;
    const width = .16 + random() * .32;
    push(f.x + lat * f.rx, f.y + length * .5 - .1, f.z + lat * f.rz, width, length, width, 0, random() * TAU, 0);
    stalagmites.push({ x: f.x + lat * f.rx, y: f.y, z: f.z + lat * f.rz });
  }
  const instance = (geometry, material, list) => {
    const mesh = new T.InstancedMesh(geometry, material, list.length);
    list.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
    mesh.computeBoundingSphere();
    group.add(mesh);
    objects.push(mesh);
    return mesh;
  };
  instance(new T.ConeGeometry(.5, 1, 6), darkRock, matrices);
  matrices.length = 0;
  for (const s of [cave.s0, cave.s1]) {
    const f = road.frameAt(s, {});
    // Loose blocks at the foot of the portal, not a ring around the mouth.
    for (let i = 0; i < 8; i += 1) {
      const side = i % 2 ? 1 : -1;
      const lat = side * (cave.shellHalf + 1.1 + random() * 4.2);
      const y = f.y + .3 + random() * 1.8;
      push(f.x + lat * f.rx, y, f.z + lat * f.rz, 1.3 + random() * 2.7, 1 + random() * 2.3, 1.3 + random() * 2.7,
        random() * TAU, random() * TAU, random() * TAU);
    }
  }
  instance(new T.DodecahedronGeometry(.5), darkRock, matrices);
  matrices.length = 0;
  // Fallen blocks along the shoulders give the floor a broken edge and catch
  // the headlights as the car passes.
  for (let s = cave.s0 + 18; s < cave.s1 - 18; s += 27) {
    const f = road.frameAt(s, {});
    const side = random() < .5 ? -1 : 1;
    const lat = side * (7.4 + random() * 1.2);
    const size = .8 + random() * 1.6;
    push(f.x + lat * f.rx, f.y + size * .3, f.z + lat * f.rz, size, size * .8, size,
      random() * TAU, random() * TAU, random() * TAU);
  }
  instance(new T.DodecahedronGeometry(.5), darkRock, matrices);

  // Wooden fire torches alternate along the walls. Their flames are one
  // additive point cloud, so the whole cave costs a handful of draw calls.
  const torchSpots = [], bracketMatrices = [], stickMatrices = [], spillMatrices = [];
  const wallSpillMatrices = [];
  for (let s = cave.s0 + 24, i = 0; s < cave.s1 - 14; s += 43, i += 1) {
    const f = road.frameAt(s, {});
    const side = i % 2 ? 1 : -1;
    const inward = -side;
    const wallLat = side * (cave.shellHalf - .35);
    const wx = f.x + wallLat * f.rx, wz = f.z + wallLat * f.rz;
    const yaw = Math.atan2(inward * f.rx, inward * f.rz);
    // A diagonal bracket carries the torch out of the wall, so the silhouette
    // is a burning brand rather than a street lamp on a post.
    push(wx + inward * .55 * f.rx, f.y + 2.75, wz + inward * .55 * f.rz, .16, 1.25, .16, .5, yaw, 0, 'YXZ');
    bracketMatrices.push(matrices.pop());
    push(wx + inward * 1.12 * f.rx, f.y + 3.25, wz + inward * 1.12 * f.rz, .13, .9, .13, .5, yaw, 0, 'YXZ');
    stickMatrices.push(matrices.pop());
    const fx = wx + inward * 1.48 * f.rx, fz = wz + inward * 1.48 * f.rz;
    const fy = f.y + 3.62;
    push(fx - inward * 2.1 * f.rx, f.y + .025, fz - inward * 2.1 * f.rz, 6.2, 1, 6.2, -Math.PI / 2, 0, 0);
    spillMatrices.push(matrices.pop());
    push(wx + inward * .09 * f.rx, f.y + 2.8, wz + inward * .09 * f.rz, 4.6, 3.4, 1, 0, yaw, 0);
    wallSpillMatrices.push(matrices.pop());
    torchSpots.push({ x: fx, y: fy, z: fz });
  }
  instance(new T.BoxGeometry(1, 1, 1), wood, bracketMatrices);
  instance(new T.CylinderGeometry(.5, .7, 1, 6), wood, stickMatrices);
  const spillGeo = new T.PlaneGeometry(1, 1);
  const spills = instance(spillGeo, spillMaterial, spillMatrices);
  spills.renderOrder = 2;
  const wallSpills = instance(spillGeo, spillMaterial, wallSpillMatrices);
  wallSpills.renderOrder = 2;

  const glowPositions = new Float32Array(torchSpots.length * 3);
  torchSpots.forEach((t, i) => { glowPositions.set([t.x, t.y + .1, t.z], i * 3); });
  const glowGeometry = new T.BufferGeometry();
  glowGeometry.setAttribute('position', new T.BufferAttribute(glowPositions, 3));
  const glowMaterial = new T.PointsMaterial({
    map: glowMap, color: 0xff9a4a, size: 2.6, transparent: true, opacity: .62,
    blending: T.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const glow = new T.Points(glowGeometry, glowMaterial);
  group.add(glow);
  objects.push(glow);

  const flamePositions = new Float32Array(torchSpots.length * 3);
  torchSpots.forEach((t, i) => { flamePositions.set([t.x, t.y + .12, t.z], i * 3); });
  const flameGeometry = new T.BufferGeometry();
  flameGeometry.setAttribute('position', new T.BufferAttribute(flamePositions, 3));
  const flames = new T.Points(flameGeometry, flameMaterial);
  flames.renderOrder = 3;
  group.add(flames);
  objects.push(flames);

  // Two real point lights follow the nearest torches; the rest is emissive.
  const lights = [new T.PointLight(0xffa054, 0, 17, 2), new T.PointLight(0xffa054, 0, 17, 2)];
  for (const light of lights) group.add(light);

  const obstacles = [];
  for (let s = cave.s0 - 1; s <= cave.s1 + 1; s += 4) {
    const f = road.frameAt(s, {});
    for (const side of [-1, 1]) {
      const lat = side * (cave.shellHalf - .25);
      obstacles.push(f.x + lat * f.rx, f.z + lat * f.rz, 1.55);
    }
  }
  const time = { value: 0 };
  return {
    group,
    obstacles,
    torchSpots,
    update(dt, carPosition, inside) {
      time.value += dt;
      const t = time.value;
      const flicker = .8 + .12 * Math.sin(t * 9) + .07 * Math.sin(t * 23 + 1.7);
      flameMaterial.opacity = .7 + .26 * flicker;
      flameMaterial.size = 1.0 + .32 * flicker;
      if (!carPosition) return;
      const ranked = [];
      for (let i = 0; i < torchSpots.length; i += 1) {
        const spot = torchSpots[i];
        const d = Math.hypot(spot.x - carPosition.x, spot.z - carPosition.z);
        ranked.push({ d, spot });
      }
      ranked.sort((a, b) => a.d - b.d);
      for (let i = 0; i < lights.length; i += 1) {
        const item = ranked[i];
        const light = lights[i];
        if (!item || !inside) { light.intensity = 0; continue; }
        light.position.set(item.spot.x, item.spot.y, item.spot.z);
        light.intensity = Math.max(0, 1 - item.d / 30) * (11 + 3 * Math.sin(t * 11 + i * 3));
      }
    },
    dispose() {
      for (const object of objects) {
        object.geometry?.dispose();
        if (Array.isArray(object.material)) object.material.forEach(m => m.dispose());
        else object.material?.dispose();
      }
      for (const material of [rock, shellRock, darkRock, wood, flameMaterial, spillMaterial, glowMaterial]) material.dispose();
      glowMap.dispose();
      flameMap.dispose();
      rockMap.dispose();
      for (const light of lights) light.dispose();
      group.removeFromParent();
    },
  };
}
