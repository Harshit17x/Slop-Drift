import * as T from 'three';

const TAU = Math.PI * 2;
const COUNT = 112;

function batGeometry(phases) {
  const p = [
    0, 0, .24, -.06, 0, .04, 0, 0, -.16,
    0, 0, .24, 0, 0, -.16, .06, 0, .04,
    0, 0, .09, -.74, 0, .02, -.5, 0, -.2,
    0, 0, .09, -.5, 0, -.2, -.14, 0, -.16,
    0, 0, .09, .74, 0, .02, .5, 0, -.2,
    0, 0, .09, .5, 0, -.2, .14, 0, -.16,
  ];
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(p, 3));
  geometry.setAttribute('aPhase', new T.InstancedBufferAttribute(phases, 1));
  geometry.computeVertexNormals();
  return geometry;
}

export class HollowBats {
  constructor(world, random) {
    this.world = world;
    this.random = random;
    this.group = new T.Group();
    this.group.name = 'Hollow bats';
    const phases = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i += 1) phases[i] = random() * TAU;
    this.time = { value: 0 };
    const material = new T.MeshBasicMaterial({ color: 0x14181a, side: T.DoubleSide, fog: false });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.hcBatTime = this.time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float hcBatTime;\nattribute float aPhase;')
        .replace('#include <begin_vertex>',
          '#include <begin_vertex>\ntransformed.y += sin(hcBatTime * 17.0 + aPhase) * abs(position.x) * .72;\ntransformed.z += cos(hcBatTime * 8.0 + aPhase) * abs(position.x) * .12;');
    };
    this.material = material;
    this.geometry = batGeometry(phases);
    this.mesh = new T.InstancedMesh(this.geometry, material, COUNT);
    this.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.group.add(this.mesh);
    this.bats = Array.from({ length: COUNT }, (_, i) => ({
      i, active: false, mode: 'ambient', age: 0, life: 0, scale: 1, phase: random() * TAU,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      cx: 0, cy: 0, cz: 0, radius: 10, angle: 0, speed: 1, ceiling: Infinity,
    }));
    this.dummy = new T.Object3D();
    this.nextSpawn = 4;
    this.clear();
  }

  clear() {
    for (const bat of this.bats) {
      bat.active = false;
      bat.age = 0;
      bat.life = 0;
    }
    this.mesh.visible = false;
    this.nextSpawn = 4;
  }

  spawnAmbient(center, count, ceiling = Infinity) {
    let made = 0;
    for (const bat of this.bats) {
      if (made >= count) break;
      if (bat.active) continue;
      bat.active = true;
      bat.mode = 'ambient';
      bat.age = 0;
      bat.life = 20 + this.random() * 24;
      bat.cx = center.x + (this.random() - .5) * 12;
      bat.cy = Math.min(center.y + 3 + this.random() * 9, ceiling - 1.5);
      bat.cz = center.z + (this.random() - .5) * 12;
      bat.radius = 7 + this.random() * 19;
      bat.angle = this.random() * TAU;
      bat.speed = (.24 + this.random() * .5) * (this.random() < .5 ? -1 : 1);
      bat.phase = this.random() * TAU;
      bat.scale = .65 + this.random() * .65;
      bat.ceiling = ceiling;
      made += 1;
    }
    return made;
  }

  burst(x, y, z, count, dirX = 0, dirZ = 0, ceiling = Infinity) {
    let made = 0;
    for (const bat of this.bats) {
      if (made >= count) break;
      if (bat.active && bat.mode !== 'ambient') continue;
      if (bat.active) {
        // Recycle the oldest ambient bat when the swarm is already full.
        if (this.random() < .55) continue;
      }
      bat.active = true;
      bat.mode = 'burst';
      bat.age = 0;
      bat.life = 9 + this.random() * 9;
      bat.x = x + (this.random() - .5) * 5;
      bat.y = y + (this.random() - .5) * 2;
      bat.z = z + (this.random() - .5) * 5;
      bat.vx = dirX * (7 + this.random() * 13) + (this.random() - .5) * 7;
      bat.vy = 1.2 + this.random() * 4.2;
      bat.vz = dirZ * (7 + this.random() * 13) + (this.random() - .5) * 7;
      bat.scale = .7 + this.random() * .6;
      bat.phase = this.random() * TAU;
      bat.ceiling = ceiling;
      made += 1;
    }
    return made;
  }

  disturb(x, y, z, count) {
    return this.burst(x, y, z, count, (this.random() - .5) * 2, (this.random() - .5) * 2);
  }

  update(dt, time, carPosition, caveInside, night = true) {
    this.time.value = time;
    if (night && carPosition && time >= this.nextSpawn) {
      this.nextSpawn = time + 11 + this.random() * 15;
      let ceiling = Infinity;
      let center = { x: carPosition.x, y: carPosition.y, z: carPosition.z };
      if (caveInside) {
        const road = this.world.roads[this.world.cave.roadId];
        const f = road.frameAt((this.world.cave.s0 + this.world.cave.s1) * .5 + (this.random() - .5) * 420, {});
        center = { x: f.x, y: f.y + 2, z: f.z };
        ceiling = f.y + this.world.cave.shellHeight - 1.2;
      } else {
        const angle = this.random() * TAU, distance = 45 + this.random() * 80;
        center.x += Math.cos(angle) * distance;
        center.z += Math.sin(angle) * distance;
        center.y = this.world.heightAt(center.x, center.z) + 4;
      }
      this.spawnAmbient(center, 4 + Math.floor(this.random() * 5), ceiling);
    }
    let active = 0;
    for (const bat of this.bats) {
      if (!bat.active) {
        this.dummy.position.set(0, -500, 0);
        this.dummy.scale.setScalar(0);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(bat.i, this.dummy.matrix);
        continue;
      }
      bat.age += dt;
      if (bat.age >= bat.life) {
        bat.active = false;
        this.dummy.scale.setScalar(0);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(bat.i, this.dummy.matrix);
        continue;
      }
      if (bat.mode === 'ambient') {
        bat.angle += bat.speed * dt;
        bat.x = bat.cx + Math.cos(bat.angle) * bat.radius;
        bat.z = bat.cz + Math.sin(bat.angle) * bat.radius;
        bat.y = bat.cy + Math.sin(bat.angle * 1.7 + bat.phase) * 2.4;
      } else {
        bat.vx += (this.random() - .5) * 22 * dt;
        bat.vz += (this.random() - .5) * 22 * dt;
        bat.vy += (4.6 - bat.vy) * dt * .7;
        bat.x += bat.vx * dt;
        bat.y += bat.vy * dt;
        bat.z += bat.vz * dt;
      }
      if (bat.y > bat.ceiling) {
        bat.y = bat.ceiling;
        bat.vy = -Math.abs(bat.vy) * .45;
      }
      if (carPosition && bat.mode === 'ambient') {
        const dx = bat.x - carPosition.x, dz = bat.z - carPosition.z;
        if (dx * dx + dz * dz > 280 * 280) bat.life = Math.min(bat.life, bat.age + .1);
      }
      const heading = bat.mode === 'ambient'
        ? bat.angle + (bat.speed > 0 ? Math.PI / 2 : -Math.PI / 2)
        : Math.atan2(bat.vx, bat.vz);
      this.dummy.position.set(bat.x, bat.y, bat.z);
      this.dummy.rotation.set(0, heading, 0);
      this.dummy.scale.setScalar(bat.scale);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(bat.i, this.dummy.matrix);
      active += 1;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = active > 0;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.group.removeFromParent();
  }
}
