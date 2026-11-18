// Canvas minimap for a large (~2.5 km) world.
// The road network is pre-rendered once to an offscreen canvas; each frame only blits a rotated
// window of it centred on the car, then draws markers and the car arrow on top.

const TAU = Math.PI * 2;
// Hill-road enamel-sign palette (matches theme.css tokens).
const ACCENT = '#F2B01E'; // marigold: active road, car
const WARM = '#C8321E'; // truck red: summit
const CHALK = '#F4F1E8';
const INK = '#14110D';
const BOARD = '#26352C';
const FLAG_BLUE = '#2A6FB0';
const WHITEWASH = '#EDE6D3';

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Normalise a track description and compute bounds when they are missing. */
export function normalizeTrack(track) {
  const roads = (track?.roads || []).filter((r) => r && r.points && r.points.length >= 4);
  let b = track?.bounds;
  if (!b || !Number.isFinite(b.minX)) {
    b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (const r of roads) {
      for (let i = 0; i < r.points.length; i += 2) {
        b.minX = Math.min(b.minX, r.points[i]);
        b.maxX = Math.max(b.maxX, r.points[i]);
        b.minZ = Math.min(b.minZ, r.points[i + 1]);
        b.maxZ = Math.max(b.maxZ, r.points[i + 1]);
      }
    }
    if (!Number.isFinite(b.minX)) b = { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 };
  }
  // Extent of the roads and markers, for the overview map (the world bounds include empty terrain).
  const e = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  const grow = (x, z) => {
    if (x < e.minX) e.minX = x;
    if (x > e.maxX) e.maxX = x;
    if (z < e.minZ) e.minZ = z;
    if (z > e.maxZ) e.maxZ = z;
  };
  for (const r of roads) for (let i = 0; i < r.points.length; i += 2) grow(r.points[i], r.points[i + 1]);
  const markers = (track?.markers || []).slice();
  for (const m of markers) grow(m.x, m.z);
  const extent = Number.isFinite(e.minX) ? e : { ...b };
  return { bounds: { ...b }, extent, roads, markers };
}

function traceRoad(ctx, road, tx, tz) {
  const p = road.points;
  ctx.moveTo(tx(p[0]), tz(p[1]));
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(tx(p[i]), tz(p[i + 1]));
  if (road.closed) ctx.closePath();
}

/** Strokes every road (inactive first, active on top). Width values are in target pixels. */
export function drawNetwork(ctx, track, activeRoad, tx, tz, width) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const passes = [
    { active: false, color: CHALK, w: width },
    { active: true, color: INK, w: width * 1.45 + Math.max(2, width * 0.8) },
    { active: true, color: ACCENT, w: width * 1.45 },
  ];
  for (const pass of passes) {
    ctx.beginPath();
    let any = false;
    for (const road of track.roads) {
      if ((road.id === activeRoad) !== pass.active) continue;
      traceRoad(ctx, road, tx, tz);
      any = true;
    }
    if (!any) continue;
    ctx.strokeStyle = pass.color;
    ctx.lineWidth = pass.w;
    ctx.stroke();
  }
}

/** Marker glyph centred at (x, y); s is the glyph radius in pixels. */
export function drawMarker(ctx, kind, x, y, s, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.lineWidth = Math.max(1, s * 0.28);
  ctx.strokeStyle = INK;
  if (kind === 'start' || kind === 'finish') {
    const q = s * 0.62;
    ctx.fillStyle = '#fff';
    ctx.fillRect(-q, -q, q * 2, q * 2);
    ctx.fillStyle = '#111';
    ctx.fillRect(-q, -q, q, q);
    ctx.fillRect(0, 0, q, q);
    ctx.strokeRect(-q, -q, q * 2, q * 2);
  } else if (kind === 'summit') {
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.lineTo(s * 0.95, s * 0.7);
    ctx.lineTo(-s * 0.95, s * 0.7);
    ctx.closePath();
    ctx.fillStyle = WARM;
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.7);
    ctx.lineTo(s * 0.7, 0);
    ctx.lineTo(0, s * 0.7);
    ctx.lineTo(-s * 0.7, 0);
    ctx.closePath();
    ctx.fillStyle = FLAG_BLUE;
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawCarArrow(ctx, s) {
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.lineTo(s * 0.72, s * 0.8);
  ctx.lineTo(0, s * 0.42);
  ctx.lineTo(-s * 0.72, s * 0.8);
  ctx.closePath();
  ctx.lineWidth = Math.max(1.5, s * 0.22);
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = ACCENT;
  ctx.fill();
}

export class Minimap {
  /**
   * @param {HTMLCanvasElement} canvas  Sized by CSS; pixel size follows its layout box.
   * @param {{radius?: number, rotate?: boolean, roadPx?: number}} options
   *   radius: metres from the car to the rim; rotate: heading-up (true) or north-up; roadPx: road width in CSS px.
   */
  constructor(canvas, { radius = 400, rotate = true, roadPx = 3.2 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.radius = radius;
    this.rotate = rotate;
    this.roadPx = roadPx;
    this.track = null;
    this.activeRoad = null;
    this.base = null;
    this.baseScale = 1;
    this.dpr = 1;
    this.size = 0;
    this.bg = null;
    this.dirty = true;
    this.lastX = NaN;
    this.lastZ = NaN;
    this.lastH = NaN;
    this.resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
    this.resizeObserver?.observe(canvas);
    this.resize();
  }

  resize() {
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const css = Math.max(1, Math.round(this.canvas.clientWidth || this.canvas.width || 1));
    const px = Math.round(css * dpr);
    if (px === this.size && dpr === this.dpr) return;
    this.dpr = dpr;
    this.size = px;
    this.canvas.width = px;
    this.canvas.height = px;
    this.base = null;
    this.bg = null;
    this.dirty = true;
    if (Number.isFinite(this.lastX)) this.draw(this.lastX, this.lastZ, this.lastH);
  }

  setTrack(track) {
    this.track = normalizeTrack(track);
    this.base = null;
    this.dirty = true;
  }

  setActiveRoad(id) {
    if (id === this.activeRoad) return;
    this.activeRoad = id;
    this.base = null;
    this.dirty = true;
  }

  setRotate(rotate) {
    this.rotate = Boolean(rotate);
    this.dirty = true;
  }

  /** Device pixels per metre in the local view. */
  get viewScale() {
    return this.innerR / this.radius;
  }

  /** Radius of the board-green field inside the enamel ring, device px. */
  get innerR() {
    return this.size / 2 - 10 * this.dpr;
  }

  buildBase() {
    const t = this.track;
    if (!t || this.size < 8) return;
    const { minX, maxX, minZ, maxZ } = t.bounds;
    const pad = 60;
    const extent = Math.max(maxX - minX, maxZ - minZ) + pad * 2;
    // At least as sharp as the view (no upscaling blur), capped at 2048 px of backing store.
    this.baseScale = Math.min(this.viewScale * 1.15, 2048 / extent);
    const w = Math.ceil((maxX - minX + pad * 2) * this.baseScale);
    const h = Math.ceil((maxZ - minZ + pad * 2) * this.baseScale);
    this.baseOriginX = minX - pad;
    this.baseOriginZ = minZ - pad;
    const base = makeCanvas(Math.max(1, w), Math.max(1, h));
    const ctx = base.getContext('2d');
    const k = this.baseScale;
    const ox = this.baseOriginX;
    const oz = this.baseOriginZ;
    // Road width is specified in screen pixels, so convert through the view/base ratio.
    const roadWidth = (this.roadPx * this.dpr * this.baseScale) / this.viewScale;
    drawNetwork(ctx, t, this.activeRoad, (x) => (x - ox) * k, (z) => (z - oz) * k, roadWidth);
    this.base = base;
  }

  buildBackground() {
    const s = this.size;
    const bg = makeCanvas(s, s);
    const ctx = bg.getContext('2d');
    const r = s / 2;
    // Enamel sign: flag-blue ring, whitewash rim, flat board-green field.
    ctx.fillStyle = FLAG_BLUE;
    ctx.beginPath();
    ctx.arc(r, r, r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = WHITEWASH;
    ctx.beginPath();
    ctx.arc(r, r, this.innerR + 3 * this.dpr, 0, TAU);
    ctx.fill();
    ctx.fillStyle = BOARD;
    ctx.beginPath();
    ctx.arc(r, r, this.innerR, 0, TAU);
    ctx.fill();
    // Range rings every 100 m, chalk dashes.
    ctx.setLineDash([3 * this.dpr, 5 * this.dpr]);
    ctx.strokeStyle = 'rgba(244,241,232,0.18)';
    ctx.lineWidth = this.dpr;
    for (let m = 100; m < this.radius; m += 100) {
      ctx.beginPath();
      ctx.arc(r, r, m * this.viewScale, 0, TAU);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    this.bg = bg;
  }

  /** Cheap per-frame call; redraws only when the car moved or turned noticeably. */
  update(x, z, heading) {
    if (!this.dirty
      && Math.abs(x - this.lastX) < 0.08
      && Math.abs(z - this.lastZ) < 0.08
      && Math.abs(heading - this.lastH) < 0.002) return;
    this.draw(x, z, heading);
  }

  draw(x, z, heading) {
    this.lastX = x;
    this.lastZ = z;
    this.lastH = heading;
    this.dirty = false;
    const ctx = this.ctx;
    const s = this.size;
    if (s < 8) return;
    if (!this.bg) this.buildBackground();
    if (!this.base && this.track) this.buildBase();
    const r = s / 2;
    const dpr = this.dpr;
    const rot = this.rotate ? -heading : 0;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const vs = this.viewScale;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, s, s);
    ctx.drawImage(this.bg, 0, 0);

    if (this.base) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(r, r, this.innerR, 0, TAU);
      ctx.clip();
      const k = vs / this.baseScale;
      ctx.setTransform(cos * k, sin * k, -sin * k, cos * k, r, r);
      ctx.drawImage(this.base, -(x - this.baseOriginX) * this.baseScale, -(z - this.baseOriginZ) * this.baseScale);
      ctx.restore();
    }

    // Markers stay upright; ones outside the view are pinned to the rim as direction hints.
    if (this.track) {
      const rim = this.innerR - 6 * dpr;
      for (const m of this.track.markers) {
        const dx = (m.x - x) * vs;
        const dz = (m.z - z) * vs;
        let px = dx * cos - dz * sin;
        let py = dx * sin + dz * cos;
        const d = Math.hypot(px, py);
        let alpha = 1;
        if (d > rim) {
          if (m.kind === 'junction') continue;
          px *= rim / d;
          py *= rim / d;
          alpha = 0.7;
        }
        drawMarker(ctx, m.kind, r + px, r + py, 5.5 * dpr, alpha);
      }
    }

    // North tick on the rim.
    const nx = this.rotate ? -Math.sin(heading) : 0;
    const ny = this.rotate ? -Math.cos(heading) : -1;
    ctx.save();
    ctx.translate(r + nx * (r - 4.5 * dpr), r + ny * (r - 4.5 * dpr));
    ctx.fillStyle = WHITEWASH;
    ctx.fillRect(-5 * dpr, -5 * dpr, 10 * dpr, 10 * dpr);
    ctx.font = `600 ${Math.round(10 * dpr)}px Khand, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = INK;
    ctx.fillText('N', 0, 0.5 * dpr);
    ctx.restore();

    ctx.save();
    ctx.translate(r, r);
    if (!this.rotate) ctx.rotate(heading);
    drawCarArrow(ctx, 7 * dpr);
    ctx.restore();

    ctx.beginPath();
    ctx.arc(r, r, r - 1.5 * dpr, 0, TAU);
    ctx.lineWidth = 3 * dpr;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }

  /**
   * Draws the whole network fitted into another canvas (menu / pause overview). Call on show, not per frame.
   * @param {HTMLCanvasElement} canvas
   * @param {{x:number,z:number,heading:number}|null} car
   */
  drawOverview(canvas, car = null) {
    if (!this.track) return;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const cw = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const ch = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = BOARD;
    ctx.fillRect(0, 0, cw, ch);
    const { minX, maxX, minZ, maxZ } = this.track.extent;
    const pad = 16 * dpr;
    const k = Math.min((cw - pad * 2) / Math.max(1, maxX - minX), (ch - pad * 2) / Math.max(1, maxZ - minZ));
    const ox = (cw - (maxX - minX) * k) / 2;
    const oz = (ch - (maxZ - minZ) * k) / 2;
    const tx = (x) => ox + (x - minX) * k;
    const tz = (z) => oz + (z - minZ) * k;
    drawNetwork(ctx, this.track, this.activeRoad, tx, tz, 2.2 * dpr);
    for (const m of this.track.markers) drawMarker(ctx, m.kind, tx(m.x), tz(m.z), 5 * dpr);
    if (car && Number.isFinite(car.x)) {
      ctx.save();
      ctx.translate(tx(car.x), tz(car.z));
      ctx.rotate(car.heading || 0);
      drawCarArrow(ctx, 7 * dpr);
      ctx.restore();
    }
  }

  destroy() {
    this.resizeObserver?.disconnect();
    this.base = null;
    this.bg = null;
  }
}

/**
 * Elevation strip under the minimap. With per-point heights on the active road (road.heights, optional,
 * same length as points / 2) it draws the road's profile and a marker at the car; otherwise it draws a
 * rolling trace of the car's recent altitude.
 */
export class ElevationStrip {
  constructor(canvas, { traceSeconds = 60, sampleMs = 250 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sampleMs = sampleMs;
    this.samples = new Float32Array(Math.ceil((traceSeconds * 1000) / sampleMs));
    this.count = 0;
    this.head = 0;
    this.lastSampleAt = -Infinity;
    this.profile = null;
    this.profileImage = null;
    this.nearIndex = 0;
    this.lastMarkerPx = -1;
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    this.resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
    this.resizeObserver?.observe(canvas);
    this.resize();
  }

  resize() {
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const w = Math.max(1, Math.round((this.canvas.clientWidth || 1) * dpr));
    const h = Math.max(1, Math.round((this.canvas.clientHeight || 1) * dpr));
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = w;
    this.canvas.height = h;
    this.profileImage = null;
    this.lastMarkerPx = -1;
    this.redraw();
  }

  /** @param {{points:number[], heights?:number[], closed?:boolean}|null} road */
  setRoad(road) {
    this.profile = null;
    this.profileImage = null;
    this.lastMarkerPx = -1;
    if (road && road.heights && road.heights.length * 2 >= road.points.length && road.points.length >= 4) {
      const n = road.points.length / 2;
      const dist = new Float32Array(n);
      let minH = Infinity;
      let maxH = -Infinity;
      for (let i = 0; i < n; i += 1) {
        if (i > 0) dist[i] = dist[i - 1] + Math.hypot(road.points[i * 2] - road.points[i * 2 - 2], road.points[i * 2 + 1] - road.points[i * 2 - 1]);
        minH = Math.min(minH, road.heights[i]);
        maxH = Math.max(maxH, road.heights[i]);
      }
      this.profile = { points: road.points, heights: road.heights, dist, total: dist[n - 1] || 1, minH, maxH, n };
      this.nearIndex = 0;
    }
    this.redraw();
  }

  get hasProfile() {
    return Boolean(this.profile);
  }

  nearest(x, z) {
    const p = this.profile;
    const pts = p.points;
    let best = this.nearIndex;
    let bestD = Infinity;
    const scan = (from, to) => {
      for (let i = from; i <= to; i += 1) {
        const j = ((i % p.n) + p.n) % p.n;
        const dx = pts[j * 2] - x;
        const dz = pts[j * 2 + 1] - z;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = j; }
      }
    };
    scan(this.nearIndex - 40, this.nearIndex + 40);
    if (bestD > 40 * 40) scan(0, p.n - 1); // lost track (respawn, teleport): full search
    this.nearIndex = best;
    return bestD < 80 * 80 ? best : -1;
  }

  update(altitude, x, z, now) {
    if (this.profile) {
      const i = this.nearest(x, z);
      const px = i < 0 ? -1 : Math.round((this.profile.dist[i] / this.profile.total) * (this.w - 1));
      if (px !== this.lastMarkerPx) {
        this.lastMarkerPx = px;
        this.redraw();
      }
      return;
    }
    if (now - this.lastSampleAt < this.sampleMs || !Number.isFinite(altitude)) return;
    this.lastSampleAt = now;
    this.samples[this.head] = altitude;
    this.head = (this.head + 1) % this.samples.length;
    this.count = Math.min(this.count + 1, this.samples.length);
    this.redraw();
  }

  redraw() {
    const { ctx, w, h, dpr } = this;
    if (w < 2 || h < 2) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (this.profile) {
      if (!this.profileImage) this.profileImage = this.renderProfile();
      ctx.drawImage(this.profileImage, 0, 0);
      if (this.lastMarkerPx >= 0) {
        const p = this.profile;
        const x = this.lastMarkerPx;
        // Height at the marker: nearest profile sample.
        const hy = p.heights[this.nearIndex];
        const y = this.yFor(hy, p.minH, p.maxH);
        ctx.fillStyle = 'rgba(242,176,30,0.45)';
        ctx.fillRect(x - dpr * 0.5, 0, dpr, h);
        ctx.beginPath();
        ctx.arc(x, y, 3 * dpr, 0, TAU);
        ctx.fillStyle = ACCENT;
        ctx.fill();
        ctx.lineWidth = 1.5 * dpr;
        ctx.strokeStyle = INK;
        ctx.stroke();
      }
      return;
    }
    if (this.count < 2) return;
    let lo = Infinity;
    let hi = -Infinity;
    const n = this.count;
    const len = this.samples.length;
    const start = (this.head - n + len) % len;
    for (let i = 0; i < n; i += 1) {
      const v = this.samples[(start + i) % len];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (hi - lo < 20) { const mid = (hi + lo) / 2; lo = mid - 10; hi = mid + 10; }
    ctx.beginPath();
    for (let i = 0; i < n; i += 1) {
      const x = w - ((n - 1 - i) / (len - 1)) * w;
      const y = this.yFor(this.samples[(start + i) % len], lo, hi);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeStyle = CHALK;
    ctx.lineJoin = 'round';
    ctx.stroke();
    const lx = w;
    const ly = this.yFor(this.samples[(this.head - 1 + len) % len], lo, hi);
    ctx.beginPath();
    ctx.arc(lx - 3 * dpr, ly, 2.5 * dpr, 0, TAU);
    ctx.fillStyle = ACCENT;
    ctx.fill();
  }

  yFor(v, lo, hi) {
    const m = 3 * this.dpr;
    return this.h - m - ((v - lo) / Math.max(1e-6, hi - lo)) * (this.h - m * 2);
  }

  renderProfile() {
    const p = this.profile;
    const img = makeCanvas(this.w, this.h);
    const ctx = img.getContext('2d');
    const step = Math.max(1, Math.floor(p.n / (this.w * 1.5)));
    const line = new Path2D();
    line.moveTo(0, this.yFor(p.heights[0], p.minH, p.maxH));
    for (let i = step; i < p.n; i += step) {
      line.lineTo((p.dist[i] / p.total) * this.w, this.yFor(p.heights[i], p.minH, p.maxH));
    }
    line.lineTo(this.w, this.yFor(p.heights[p.n - 1], p.minH, p.maxH));
    const area = new Path2D(line);
    area.lineTo(this.w, this.h);
    area.lineTo(0, this.h);
    area.closePath();
    ctx.fillStyle = 'rgba(244,241,232,0.16)';
    ctx.fill(area);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.25 * this.dpr;
    ctx.strokeStyle = CHALK;
    ctx.stroke(line);
    return img;
  }

  destroy() {
    this.resizeObserver?.disconnect();
  }
}
