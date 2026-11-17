import * as THREE from 'three';

/** Growable vertex/index lists that turn into one BufferGeometry. Keeps the road builders readable. */
export class MeshBuffer {
  constructor({ uvs = false, colors = false, normals = false } = {}) {
    this.positions = [];
    this.indices = [];
    this.uvs = uvs ? [] : null;
    this.colors = colors ? [] : null;
    this.normals = normals ? [] : null;
  }

  get vertexCount() {
    return this.positions.length / 3;
  }

  /** Append a vertex and return its index. Optional channels are ignored when not enabled. */
  vertex(x, y, z, u = 0, v = 0, r = 1, g = 1, b = 1, nx = 0, ny = 1, nz = 0) {
    const index = this.positions.length / 3;
    this.positions.push(x, y, z);
    if (this.uvs) this.uvs.push(u, v);
    if (this.colors) this.colors.push(r, g, b);
    if (this.normals) this.normals.push(nx, ny, nz);
    return index;
  }

  triangle(a, b, c) {
    this.indices.push(a, b, c);
  }

  /** Quad a-b-c-d given in order around its perimeter. */
  quad(a, b, c, d) {
    this.indices.push(a, b, c, a, c, d);
  }

  /** Box given by a centre and three half-extent vectors (a, b, d), which need not be axis-aligned. */
  box(cx, cy, cz, ax, ay, az, bx, by, bz, dx, dy, dz, r = 1, g = 1, b = 1, u = 0, v = 0) {
    const corner = (sa, sb, sd) => this.vertex(
      cx + ax * sa + bx * sb + dx * sd,
      cy + ay * sa + by * sb + dy * sd,
      cz + az * sa + bz * sb + dz * sd,
      u, v, r, g, b,
    );
    // A left-handed frame would turn every face inside out, so flip the winding for those.
    const handed = ax * (by * dz - bz * dy) + ay * (bz * dx - bx * dz) + az * (bx * dy - by * dx);
    // Each face gets its own vertices so computeVertexNormals keeps the edges crisp.
    const face = (points) => {
      const ids = points.map((p) => corner(p[0], p[1], p[2]));
      if (handed >= 0) this.quad(ids[0], ids[1], ids[2], ids[3]);
      else this.quad(ids[3], ids[2], ids[1], ids[0]);
    };
    face([[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]);
    face([[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]);
    face([[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]]);
    face([[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]);
    face([[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]);
    face([[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]);
  }

  get triangleCount() {
    return this.indices.length / 3;
  }

  build() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    if (this.uvs) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    if (this.colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setIndex(this.positions.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.indices, 1) : new THREE.Uint16BufferAttribute(this.indices, 1));
    if (this.normals) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    else geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
  }
}
