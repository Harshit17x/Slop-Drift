import { clamp } from '../core/math.js';

/**
 * The terrain as a square grid of heights, centred on the origin. It is baked once at load:
 * filled from the analytic mountain, eroded, then cut and filled around the roads. Rendering and
 * physics both read this one grid, so what you see is what the wheels touch.
 */
export class TerrainGrid {
  constructor({ size, cell }) {
    this.size = size;
    this.cell = cell;
    this.half = ((size - 1) * cell) / 2;
    this.heights = new Float32Array(size * size);
    this.minHeight = 0;
    this.maxHeight = 0;
  }

  /** World coordinate of grid column/row `i`. */
  coordinate(i) {
    return i * this.cell - this.half;
  }

  /** Fill from `fn(x, z)`, yielding to the event loop between row batches via `pause`. */
  async fill(fn, pause = null) {
    const { size, heights } = this;
    for (let iz = 0; iz < size; iz += 1) {
      const z = this.coordinate(iz);
      const row = iz * size;
      for (let ix = 0; ix < size; ix += 1) heights[row + ix] = fn(this.coordinate(ix), z);
      if (pause && iz % 96 === 95) await pause(iz / size);
    }
    this.updateRange();
  }

  updateRange() {
    let min = Infinity;
    let max = -Infinity;
    const heights = this.heights;
    for (let i = 0; i < heights.length; i += 1) {
      const h = heights[i];
      if (h < min) min = h;
      if (h > max) max = h;
    }
    this.minHeight = min;
    this.maxHeight = max;
  }

  /** Bilinear height. Coordinates outside the grid clamp to its edge. */
  heightAt(x, z) {
    const size = this.size;
    let gx = (x + this.half) / this.cell;
    let gz = (z + this.half) / this.cell;
    gx = gx < 0 ? 0 : gx > size - 1.0001 ? size - 1.0001 : gx;
    gz = gz < 0 ? 0 : gz > size - 1.0001 ? size - 1.0001 : gz;
    const ix = gx | 0;
    const iz = gz | 0;
    const fx = gx - ix;
    const fz = gz - iz;
    const i = iz * size + ix;
    const heights = this.heights;
    const top = heights[i] + (heights[i + 1] - heights[i]) * fx;
    const bottom = heights[i + size] + (heights[i + size + 1] - heights[i + size]) * fx;
    return top + (bottom - top) * fz;
  }

  /**
   * Surface normal from central differences one cell wide, which keeps it continuous across cells.
   * Writes nx, ny, nz into `out`.
   */
  normalAt(x, z, out) {
    const c = this.cell;
    const dx = (this.heightAt(x + c, z) - this.heightAt(x - c, z)) / (2 * c);
    const dz = (this.heightAt(x, z + c) - this.heightAt(x, z - c)) / (2 * c);
    const inverse = 1 / Math.sqrt(dx * dx + dz * dz + 1);
    out.nx = -dx * inverse;
    out.ny = inverse;
    out.nz = -dz * inverse;
    return out;
  }

  /**
   * Droplet hydraulic erosion after Sebastian Lague's Hydraulic-Erosion (MIT), with heights in metres:
   * each droplet runs downhill, picks up soil while it has spare carrying capacity and drops it when
   * it slows, carving gullies and leaving fans. `random` is a seeded generator so the result is repeatable.
   */
  erode(config, random) {
    const { size, heights, cell } = this;
    const radius = config.radius;
    const brushOffsets = [];
    const brushWeights = [];
    let weightSum = 0;
    for (let dz = -radius; dz <= radius; dz += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const distance = Math.hypot(dx, dz);
        if (distance >= radius) continue;
        brushOffsets.push(dz * size + dx);
        brushWeights.push(1 - distance / radius);
        weightSum += 1 - distance / radius;
      }
    }
    for (let i = 0; i < brushWeights.length; i += 1) brushWeights[i] /= weightSum;
    const margin = radius + 2;
    const maxIndex = size - margin - 1;
    const maxStepChange = 0.3; // metres a single step may remove; keeps one droplet from drilling a pit

    for (let d = 0; d < config.droplets; d += 1) {
      let px = margin + random() * (size - 2 * margin - 1);
      let pz = margin + random() * (size - 2 * margin - 1);
      let dirX = 0;
      let dirZ = 0;
      let speed = 1;
      let water = 1;
      let sediment = 0;
      for (let life = 0; life < config.lifetime; life += 1) {
        const ix = px | 0;
        const iz = pz | 0;
        const fx = px - ix;
        const fz = pz - iz;
        const node = iz * size + ix;
        const h00 = heights[node];
        const h10 = heights[node + 1];
        const h01 = heights[node + size];
        const h11 = heights[node + size + 1];
        const gradX = (h10 - h00) * (1 - fz) + (h11 - h01) * fz;
        const gradZ = (h01 - h00) * (1 - fx) + (h11 - h10) * fx;
        const height = h00 * (1 - fx) * (1 - fz) + h10 * fx * (1 - fz) + h01 * (1 - fx) * fz + h11 * fx * fz;

        dirX = dirX * config.inertia - gradX * (1 - config.inertia);
        dirZ = dirZ * config.inertia - gradZ * (1 - config.inertia);
        const length = Math.hypot(dirX, dirZ);
        if (length < 1e-6) break;
        dirX /= length;
        dirZ /= length;
        px += dirX;
        pz += dirZ;
        if (px < margin || px > maxIndex || pz < margin || pz > maxIndex) break;

        const nx = px | 0;
        const nz = pz | 0;
        const nfx = px - nx;
        const nfz = pz - nz;
        const next = nz * size + nx;
        const newHeight = heights[next] * (1 - nfx) * (1 - nfz) + heights[next + 1] * nfx * (1 - nfz)
          + heights[next + size] * (1 - nfx) * nfz + heights[next + size + 1] * nfx * nfz;
        const deltaHeight = newHeight - height;

        // Slope is per cell; convert to per metre so the result does not depend on grid resolution.
        const slope = -deltaHeight / cell;
        const capacity = Math.max(slope * speed * water * config.capacity, config.minCapacity);
        if (sediment > capacity || deltaHeight > 0) {
          const amount = deltaHeight > 0 ? Math.min(deltaHeight, sediment) : (sediment - capacity) * config.deposit;
          sediment -= amount;
          heights[node] += amount * (1 - fx) * (1 - fz);
          heights[node + 1] += amount * fx * (1 - fz);
          heights[node + size] += amount * (1 - fx) * fz;
          heights[node + size + 1] += amount * fx * fz;
        } else {
          const amount = Math.min((capacity - sediment) * config.erode, -deltaHeight, maxStepChange) * config.strength;
          for (let b = 0; b < brushOffsets.length; b += 1) heights[node + brushOffsets[b]] -= amount * brushWeights[b];
          sediment += amount;
        }
        speed = Math.sqrt(Math.max(0.01, speed * speed - deltaHeight * config.gravity));
        water *= 1 - config.evaporate;
      }
    }
    this.updateRange();
  }

  /**
   * Cut and fill the terrain around roads and plazas.
   *
   * For every node near a road we keep an allowed height interval: inside the bed it is pinned just
   * below the road surface; beyond it the ground may rise no faster than `cutSlope` and fall no
   * faster than `fillSlope`. The original height is then clamped into that interval, which leaves
   * rock cuts on the uphill side and embankments on the downhill side, and untouched ground beyond.
   *
   * @param {import('./Road.js').Road[]} roads
   * @param {Array<{x:number,z:number,y:number,radius:number}>|{x:number,z:number,y:number,radius:number}|null} plazas
   *   Every plaza (a single plaza object or null is accepted too).
   * @param {object} config  The world's road config.
   */
  carve(roads, plazas, config) {
    const { size, cell, heights, half } = this;
    const lower = new Float32Array(heights.length).fill(-Infinity);
    const upper = new Float32Array(heights.length).fill(Infinity);
    // Nodes inside a bed are pinned to it outright; where two beds overlap the nearer centreline wins.
    const pinned = new Float32Array(heights.length).fill(NaN);
    const pinDistance = new Float32Array(heights.length).fill(Infinity);
    const reach = 30; // metres of cut/fill slope considered beyond the bed

    const stamp = (cx, cz, extent, evaluate) => {
      const minX = Math.max(0, Math.floor((cx - extent + half) / cell));
      const maxX = Math.min(size - 1, Math.ceil((cx + extent + half) / cell));
      const minZ = Math.max(0, Math.floor((cz - extent + half) / cell));
      const maxZ = Math.min(size - 1, Math.ceil((cz + extent + half) / cell));
      for (let iz = minZ; iz <= maxZ; iz += 1) {
        const z = iz * cell - half;
        for (let ix = minX; ix <= maxX; ix += 1) evaluate(ix * cell - half, z, iz * size + ix);
      }
    };

    const apply = (node, bedHeight, beyond, distance) => {
      if (beyond <= 0) {
        if (distance < pinDistance[node]) {
          pinDistance[node] = distance;
          pinned[node] = bedHeight;
        }
        return;
      }
      const low = bedHeight - beyond * config.fillSlope;
      const high = bedHeight + beyond * config.cutSlope;
      if (low > lower[node]) lower[node] = low;
      if (high < upper[node]) upper[node] = high;
    };

    for (const road of roads) {
      for (let i = 0; i < road.segments; i += 1) {
        const j = (i + 1) % road.count;
        const ax = road.px[i];
        const az = road.pz[i];
        const abx = road.px[j] - ax;
        const abz = road.pz[j] - az;
        const lengthSq = abx * abx + abz * abz || 1;
        const bedHalf = Math.max(road.ribbonHalfAt(i), road.ribbonHalfAt(j)) + config.bedMargin;
        const extent = bedHalf + reach;
        stamp(ax + abx * 0.5, az + abz * 0.5, extent + road.spacing, (x, z, node) => {
          const u = clamp(((x - ax) * abx + (z - az) * abz) / lengthSq, 0, 1);
          const dx = x - (ax + abx * u);
          const dz = z - (az + abz * u);
          const distance = Math.hypot(dx, dz);
          if (distance > extent) return;
          const rx = road.rx[i] + (road.rx[j] - road.rx[i]) * u;
          const rz = road.rz[i] + (road.rz[j] - road.rz[i]) * u;
          const lateral = clamp(dx * rx + dz * rz, -bedHalf, bedHalf);
          const bank = road.bank[i] + (road.bank[j] - road.bank[i]) * u;
          const surface = road.py[i] + (road.py[j] - road.py[i]) * u + lateral * bank;
          apply(node, surface - config.vergeDrop, distance - bedHalf, distance);
        });
      }
    }

    const plazaList = Array.isArray(plazas) ? plazas : plazas ? [plazas] : [];
    for (const plaza of plazaList) {
      const bedRadius = plaza.radius + config.verge + config.bedMargin;
      stamp(plaza.x, plaza.z, bedRadius + reach, (x, z, node) => {
        const distance = Math.hypot(x - plaza.x, z - plaza.z);
        if (distance > bedRadius + reach) return;
        // Rank the plaza by distance from its rim so the incoming road keeps its own bed until it is inside.
        apply(node, plaza.y - config.vergeDrop, distance - bedRadius, Math.max(0, distance - plaza.radius));
      });
    }

    for (let i = 0; i < heights.length; i += 1) {
      if (pinned[i] === pinned[i]) {
        heights[i] = pinned[i];
        continue;
      }
      const low = lower[i];
      const high = upper[i];
      if (low === -Infinity && high === Infinity) continue;
      // Two roads close together at different heights leave no room for both slopes: split the
      // difference, which forms a retaining wall between them instead of burying either road.
      heights[i] = low > high ? (low + high) * 0.5 : Math.max(low, Math.min(heights[i], high));
    }
    this.updateRange();
  }
}
