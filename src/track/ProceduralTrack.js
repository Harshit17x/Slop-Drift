import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

function buildStrip(points, halfWidth, y = 0) {
  const vertices = [];
  const indices = [];
  const count = points.length;
  for (let i = 0; i < count; i += 1) {
    const previous = points[(i - 1 + count) % count];
    const next = points[(i + 1) % count];
    const tangent = next.clone().sub(previous).setY(0).normalize();
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const left = points[i].clone().addScaledVector(side, halfWidth); left.y = y;
    const right = points[i].clone().addScaledVector(side, -halfWidth); right.y = y;
    vertices.push(left.x, left.y, left.z, right.x, right.y, right.z);
  }
  for (let i = 0; i < count; i += 1) {
    const next = (i + 1) % count;
    const a = i * 2;
    const b = next * 2;
    indices.push(a, b, a + 1, b, b + 1, a + 1);
  }
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}

function makeStripMesh(points, halfWidth, material, y = 0) {
  const { vertices, indices } = buildStrip(points, halfWidth, y);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  return { mesh: new THREE.Mesh(geometry, material), vertices, indices };
}

function makeCurbMesh(points, innerWidth, outerWidth, material, y = 0.018) {
  const vertices = [];
  const indices = [];
  const count = points.length;
  for (let i = 0; i < count; i += 1) {
    const previous = points[(i - 1 + count) % count];
    const next = points[(i + 1) % count];
    const tangent = next.clone().sub(previous).setY(0).normalize();
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const leftInner = points[i].clone().addScaledVector(side, innerWidth); leftInner.y = y;
    const leftOuter = points[i].clone().addScaledVector(side, outerWidth); leftOuter.y = y;
    const rightInner = points[i].clone().addScaledVector(side, -innerWidth); rightInner.y = y;
    const rightOuter = points[i].clone().addScaledVector(side, -outerWidth); rightOuter.y = y;
    vertices.push(leftInner.x, leftInner.y, leftInner.z, leftOuter.x, leftOuter.y, leftOuter.z, rightInner.x, rightInner.y, rightInner.z, rightOuter.x, rightOuter.y, rightOuter.z);
  }
  for (let i = 0; i < count; i += 1) {
    const next = (i + 1) % count;
    const a = i * 4;
    const b = next * 4;
    indices.push(a, b, a + 1, b, b + 1, a + 1, a + 2, a + 3, b + 2, b + 2, a + 3, b + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

export class ProceduralTrack {
  constructor(scene, physicsWorld) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.root = new THREE.Group();
    this.root.name = 'Procedural_Race_Track';
    this.centerline = [];
    this.collider = null;
    this.bounds = new THREE.Box3();
  }

  build() {
    const control = [
      new THREE.Vector3(-82, 0, -35), new THREE.Vector3(-20, 0, -47), new THREE.Vector3(48, 0, -42),
      new THREE.Vector3(82, 0, -15), new THREE.Vector3(84, 0, 22), new THREE.Vector3(61, 0, 53),
      new THREE.Vector3(18, 0, 62), new THREE.Vector3(-21, 0, 52), new THREE.Vector3(-45, 0, 28),
      new THREE.Vector3(-72, 0, 42), new THREE.Vector3(-101, 0, 25), new THREE.Vector3(-112, 0, -5),
    ];
    const curve = new THREE.CatmullRomCurve3(control, true, 'catmullrom', 0.22);
    this.centerline = curve.getPoints(240).map((point) => new THREE.Vector3(point.x, 0, point.z));
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(300, 250),
      new THREE.MeshStandardMaterial({ color: 0x2b5a3c, roughness: 1, metalness: 0 }),
    );
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -0.16;
    grass.receiveShadow = true;
    this.root.add(grass);

    const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.9, metalness: 0.02, side: THREE.DoubleSide });
    const curbMaterial = new THREE.MeshStandardMaterial({ color: 0xe04c56, roughness: 0.82, side: THREE.DoubleSide });
    const road = makeStripMesh(this.centerline, 7, roadMaterial, 0);
    road.mesh.receiveShadow = true;
    road.mesh.castShadow = true;
    this.root.add(road.mesh);
    const curbs = makeCurbMesh(this.centerline, 7.0, 7.55, curbMaterial, 0.018);
    curbs.renderOrder = 2;
    this.root.add(curbs);

    const start = new THREE.Vector3(-82, 0.035, -35);
    const startLine = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.018, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55 }));
    startLine.position.copy(start);
    startLine.rotation.y = Math.PI / 2;
    startLine.receiveShadow = true;
    this.root.add(startLine);

    const markerMaterial = new THREE.MeshStandardMaterial({ color: 0xffd166, emissive: 0x4d3100, emissiveIntensity: 0.35 });
    for (let i = 0; i < this.centerline.length; i += 20) {
      const p = this.centerline[i];
      const next = this.centerline[(i + 1) % this.centerline.length];
      const tangent = next.clone().sub(p).setY(0).normalize();
      const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.6, 8), markerMaterial);
      post.position.copy(p).addScaledVector(side, 7.6); post.position.y = 0.8;
      post.castShadow = true;
      this.root.add(post);
    }

    this.collider = this.physicsWorld.addTrimeshCollider({ vertices: road.vertices, indices: road.indices, userData: { type: 'procedural-track', surface: 'asphalt' } });
    // Safety floor prevents a missed triangle or a large drift from making the car disappear.
    this.physicsWorld.addGroundFallback(-0.22);
    this.bounds.setFromObject(this.root);
    return this;
  }

  buildDefaultRacingLine() {
    return this.centerline.map((point) => point.clone());
  }

  findSpawn() {
    const position = this.centerline[0]?.clone() || new THREE.Vector3(-82, 0, -35);
    const next = this.centerline[1] || position.clone().add(new THREE.Vector3(1, 0, 0));
    const tangent = next.clone().sub(position).setY(0).normalize();
    const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), tangent);
    position.y += 0.32;
    return { position, rotation, source: 'procedural-start-line' };
  }

  sampleRoadPoint(x, z) {
    return new THREE.Vector3(x, 0, z);
  }
}
