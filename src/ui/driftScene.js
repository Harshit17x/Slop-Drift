// The loading / title screen background: the rally hatch drifting a figure-eight hill road between
// two hairpins, seen from above with a chase camera: counter-steer, rear-tyre smoke, fading skid
// marks, headlight beams, deodars and parapet stones sliding past. Plain Canvas 2D and no DOM, so it
// runs inside a worker (driftWorker.js) and keeps moving while the game loads on the main thread.
// World units: the car is 46 long; the camera zoom maps that to about 11% of the screen's short side.

const PALETTE = {
  ground: '#17251d',
  speck: 'rgba(159, 176, 168, 0.10)',
  treeShadow: 'rgba(0, 0, 0, 0.35)',
  tree: '#0f1c15',
  treeMid: '#1b3326',
  treeTop: '#2a4a36',
  parapetLight: '#EDE6D3',
  parapetDark: '#14110D',
  shoulder: '#100f0c',
  asphalt: '#36332e',
  line: 'rgba(237, 230, 211, 0.8)',
  dash: 'rgba(237, 230, 211, 0.55)',
  body: '#F2B01E',
  ink: '#14110D',
  glass: '#1d2b23',
  stripe: '#C8321E',
};

const LAP_SECONDS = 15;
const SAMPLES = 900;
const TRACK_A = 900; // lemniscate half-width
const ROAD_WIDTH = 74;
const CAR_LENGTH = 46;
const MARK_LIFE = 5;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** A scratch canvas: OffscreenCanvas where it exists (always, in a worker), else a detached DOM canvas. */
function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** The road: a lemniscate (figure-eight) around the origin, sampled by arc length with heading and signed curvature. */
export function buildTrack(a = TRACK_A) {
  const b = a * 1.1;
  const raw = [];
  for (let i = 0; i <= 2400; i += 1) {
    const t = (i / 2400) * Math.PI * 2;
    const d = 1 + Math.sin(t) ** 2;
    raw.push([(a * Math.cos(t)) / d, (b * Math.sin(t) * Math.cos(t)) / d]);
  }
  const cum = [0];
  for (let i = 1; i < raw.length; i += 1) cum.push(cum[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
  const length = cum[cum.length - 1];
  const pts = [];
  let j = 0;
  for (let i = 0; i < SAMPLES; i += 1) {
    const s = (i / SAMPLES) * length;
    while (cum[j + 1] < s) j += 1;
    const f = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
    pts.push({ x: raw[j][0] + (raw[j + 1][0] - raw[j][0]) * f, y: raw[j][1] + (raw[j + 1][1] - raw[j][1]) * f });
  }
  const ds = length / SAMPLES;
  for (let i = 0; i < SAMPLES; i += 1) {
    const n = pts[(i + 1) % SAMPLES];
    pts[i].heading = Math.atan2(n.y - pts[i].y, n.x - pts[i].x);
  }
  for (let i = 0; i < SAMPLES; i += 1) pts[i].curvature = wrap(pts[(i + 1) % SAMPLES].heading - pts[i].heading) / ds;
  return { pts, length, a };
}

/** Deodars and ground specks scattered around the track (trees kept off the road), as flat arrays. */
function scatter(track) {
  const rand = rng(1907);
  const clear = (x, y, margin) => {
    for (let i = 0; i < SAMPLES; i += 4) {
      const p = track.pts[i];
      if (Math.abs(p.x - x) < margin && Math.abs(p.y - y) < margin && Math.hypot(p.x - x, p.y - y) < margin) return false;
    }
    return true;
  };
  const span = track.a * 1.5;
  const trees = [];
  for (let n = 0; n < 1400; n += 1) {
    const x = (rand() * 2 - 1) * span;
    const y = (rand() * 2 - 1) * span * 0.75;
    const r = 11 + rand() * 15;
    // Thicker forest away from the road, a few loners near it.
    if (!clear(x, y, ROAD_WIDTH * 0.5 + 18 + r)) continue;
    if (rand() < 0.35 && !clear(x, y, ROAD_WIDTH * 2.5)) continue;
    trees.push(x, y, r);
  }
  const specks = [];
  for (let n = 0; n < 5000; n += 1) specks.push((rand() * 2 - 1) * span, (rand() * 2 - 1) * span * 0.75, 1 + rand() * 2.5);
  return { trees, specks };
}

function makeSmokeSprite(size) {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(244, 241, 232, 0.85)');
  grad.addColorStop(0.5, 'rgba(226, 222, 212, 0.4)');
  grad.addColorStop(1, 'rgba(226, 222, 212, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

function roadPath(track) {
  const P = typeof Path2D !== 'undefined' ? new Path2D() : null;
  if (!P) return null;
  P.moveTo(track.pts[0].x, track.pts[0].y);
  for (let i = 1; i < SAMPLES; i += 1) P.lineTo(track.pts[i].x, track.pts[i].y);
  P.closePath();
  return P;
}

function strokeRoad(ctx, track, path) {
  const stroke = () => {
    if (path) { ctx.stroke(path); return; }
    ctx.beginPath();
    ctx.moveTo(track.pts[0].x, track.pts[0].y);
    for (let i = 1; i < SAMPLES; i += 1) ctx.lineTo(track.pts[i].x, track.pts[i].y);
    ctx.closePath();
    ctx.stroke();
  };
  const w = ROAD_WIDTH;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';
  // Black-and-white stone parapet, dirt shoulder, edge lines, asphalt, centre dashes.
  ctx.setLineDash([]);
  ctx.strokeStyle = PALETTE.parapetLight;
  ctx.lineWidth = w + 20;
  stroke();
  ctx.setLineDash([12, 12]);
  ctx.strokeStyle = PALETTE.parapetDark;
  stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = PALETTE.shoulder;
  ctx.lineWidth = w + 10;
  stroke();
  ctx.strokeStyle = PALETTE.line;
  ctx.lineWidth = w;
  stroke();
  ctx.strokeStyle = PALETTE.asphalt;
  ctx.lineWidth = w - 6;
  stroke();
  ctx.setLineDash([18, 20]);
  ctx.strokeStyle = PALETTE.dash;
  ctx.lineWidth = 2.4;
  stroke();
  ctx.setLineDash([]);
}

function drawCar(ctx, x, y, yaw, steer, L) {
  const W = L * 0.5;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(yaw);
  // Headlight beams.
  ctx.globalCompositeOperation = 'lighter';
  const beam = ctx.createLinearGradient(L * 0.5, 0, L * 3.6, 0);
  beam.addColorStop(0, 'rgba(255, 236, 190, 0.30)');
  beam.addColorStop(1, 'rgba(255, 236, 190, 0)');
  ctx.fillStyle = beam;
  ctx.beginPath();
  ctx.moveTo(L * 0.48, -W * 0.36);
  ctx.lineTo(L * 3.6, -W * 1.9);
  ctx.lineTo(L * 3.6, W * 1.9);
  ctx.lineTo(L * 0.48, W * 0.36);
  ctx.closePath();
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  // Shadow, cast down-right like the trees.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.beginPath();
  ctx.roundRect(-L / 2 + 2, -W / 2 + 3, L + 2, W + 2, W * 0.3);
  ctx.fill();
  // Wheels: the fronts counter-steer.
  ctx.fillStyle = PALETTE.ink;
  const tw = L * 0.2;
  const th = W * 0.26;
  for (const [wx, wy, turn] of [[L * 0.3, -W * 0.5, steer], [L * 0.3, W * 0.5, steer], [-L * 0.3, -W * 0.5, 0], [-L * 0.3, W * 0.5, 0]]) {
    ctx.save();
    ctx.translate(wx, wy);
    ctx.rotate(turn);
    ctx.fillRect(-tw / 2, -th / 2, tw, th);
    ctx.restore();
  }
  // Body with a soft roof highlight, glass, rally stripe, lamps, rear wing.
  ctx.fillStyle = PALETTE.body;
  ctx.strokeStyle = PALETTE.ink;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.roundRect(-L / 2, -W / 2, L, W, W * 0.32);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 246, 214, 0.35)';
  ctx.beginPath();
  ctx.roundRect(-L * 0.24, -W * 0.3, L * 0.42, W * 0.28, W * 0.12);
  ctx.fill();
  ctx.fillStyle = PALETTE.glass;
  ctx.beginPath();
  ctx.moveTo(L * 0.24, -W * 0.38);
  ctx.lineTo(L * 0.08, -W * 0.32);
  ctx.lineTo(L * 0.08, W * 0.32);
  ctx.lineTo(L * 0.24, W * 0.38);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(-L * 0.36, -W * 0.3, L * 0.08, W * 0.6);
  ctx.fillStyle = PALETTE.stripe;
  ctx.fillRect(-L * 0.28, -W * 0.08, L * 0.36, W * 0.16);
  ctx.fillStyle = PALETTE.ink;
  ctx.fillRect(-L * 0.5, -W * 0.46, L * 0.07, W * 0.92);
  ctx.fillStyle = '#FFF4D6';
  ctx.fillRect(L * 0.44, -W * 0.38, L * 0.05, W * 0.2);
  ctx.fillRect(L * 0.44, W * 0.18, L * 0.05, W * 0.2);
  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
 * @returns {{ resize(width:number, height:number, dpr:number): void, frame(nowMs:number): void }}
 */
export function createDriftScene(ctx) {
  const canvas = ctx.canvas;
  const track = buildTrack();
  const { trees, specks } = scatter(track);
  const path = roadPath(track);
  const sprite = makeSmokeSprite(64);
  const smoke = [];
  const marks = []; // x1, y1, x2, y2, born
  let width = 1;
  let height = 1;
  let dpr = 1;
  let zoom = 1;
  let last = 0;
  let clock = 0;
  let distance = track.length * 0.8;
  let drift = 0;
  let prevRear = null;
  const cam = { x: 0, y: 0, ready: false };

  function resize(w, h, ratio) {
    width = Math.max(1, w);
    height = Math.max(1, h);
    dpr = ratio;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    zoom = (Math.min(width, height) * 0.12) / CAR_LENGTH;
  }

  function sample(s) {
    const f = ((((s % track.length) + track.length) % track.length) / track.length) * SAMPLES;
    const i = Math.floor(f);
    const p = track.pts[i];
    const n = track.pts[(i + 1) % SAMPLES];
    const k = f - i;
    return { x: p.x + (n.x - p.x) * k, y: p.y + (n.y - p.y) * k, heading: p.heading + wrap(n.heading - p.heading) * k, curvature: p.curvature };
  }

  function frame(now) {
    const dt = last ? Math.max(0, Math.min(0.05, (now - last) / 1000)) : 1 / 60;
    last = now;
    clock += dt;
    const speed = track.length / LAP_SECONDS;
    distance += speed * dt;

    const here = sample(distance);
    const ahead = sample(distance + track.length * 0.03);
    // Drift angle follows the corner ahead (turn-in), eased so the flick between hairpins swings through.
    const target = Math.max(-0.78, Math.min(0.78, ahead.curvature * track.a * 0.26));
    drift += (target - drift) * (1 - Math.exp(-dt * 3));
    const yaw = here.heading + drift;
    const L = CAR_LENGTH;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const rear = [-1, 1].map((side) => ({
      x: here.x - cos * L * 0.3 - sin * side * L * 0.25,
      y: here.y - sin * L * 0.3 + cos * side * L * 0.25,
    }));
    const sliding = Math.abs(drift) > 0.16;

    if (sliding && prevRear) {
      for (let i = 0; i < 2; i += 1) marks.push(prevRear[i].x, prevRear[i].y, rear[i].x, rear[i].y, clock);
    }
    prevRear = rear;
    while (marks.length && clock - marks[4] > MARK_LIFE) marks.splice(0, 5);

    if (sliding) {
      const rate = Math.abs(drift) * 70 * dt;
      for (const w of rear) {
        for (let n = 0; n < rate; n += 1) {
          if (smoke.length > 280) break;
          smoke.push({
            x: w.x, y: w.y,
            vx: -Math.cos(here.heading) * 45 + (Math.random() - 0.5) * 60,
            vy: -Math.sin(here.heading) * 45 + (Math.random() - 0.5) * 60,
            r: L * (0.22 + Math.random() * 0.18),
            life: 1,
            decay: 0.42 + Math.random() * 0.3,
          });
        }
      }
    }
    for (let i = smoke.length - 1; i >= 0; i -= 1) {
      const p = smoke[i];
      p.life -= p.decay * dt;
      if (p.life <= 0) { smoke.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - dt * 1.2;
      p.vy *= 1 - dt * 1.2;
      p.r += L * 0.85 * dt;
    }

    // Chase camera: looks a little ahead of the car and eases after it. The car sits right of
    // centre in landscape (the title text is on the left) and low in portrait.
    const lookX = here.x + Math.cos(here.heading) * speed * 0.18;
    const lookY = here.y + Math.sin(here.heading) * speed * 0.18;
    if (!cam.ready) { cam.x = lookX; cam.y = lookY; cam.ready = true; }
    const ease = 1 - Math.exp(-dt * 3.2);
    cam.x += (lookX - cam.x) * ease;
    cam.y += (lookY - cam.y) * ease;
    const portrait = height > width;
    const anchorX = width * (portrait ? 0.5 : 0.76);
    const anchorY = height * (portrait ? 0.84 : 0.55);
    const ox = anchorX - cam.x * zoom;
    const oy = anchorY - cam.y * zoom;
    const minX = -ox / zoom - 40;
    const maxX = (width - ox) / zoom + 40;
    const minY = -oy / zoom - 40;
    const maxY = (height - oy) / zoom + 40;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PALETTE.ground;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * ox, dpr * oy);

    ctx.fillStyle = PALETTE.speck;
    for (let i = 0; i < specks.length; i += 3) {
      const x = specks[i];
      const y = specks[i + 1];
      if (x < minX || x > maxX || y < minY || y > maxY) continue;
      ctx.fillRect(x, y, specks[i + 2], specks[i + 2]);
    }

    strokeRoad(ctx, track, path);

    ctx.lineCap = 'round';
    ctx.lineWidth = L * 0.12;
    ctx.strokeStyle = '#080706';
    for (let i = 0; i < marks.length; i += 5) {
      const age = clock - marks[i + 4];
      ctx.globalAlpha = 0.55 * (1 - age / MARK_LIFE);
      ctx.beginPath();
      ctx.moveTo(marks[i], marks[i + 1]);
      ctx.lineTo(marks[i + 2], marks[i + 3]);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    drawCar(ctx, here.x, here.y, yaw, -drift * 0.75, L);

    for (const p of smoke) {
      ctx.globalAlpha = Math.min(1, p.life * 0.48);
      ctx.drawImage(sprite, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    }
    ctx.globalAlpha = 1;

    // Deodars last: they stand above the road, with a shadow and three tiers lit from the top-left.
    for (let i = 0; i < trees.length; i += 3) {
      const x = trees[i];
      const y = trees[i + 1];
      const r = trees[i + 2];
      if (x < minX - r || x > maxX + r || y < minY - r || y > maxY + r) continue;
      ctx.fillStyle = PALETTE.treeShadow;
      ctx.beginPath();
      ctx.arc(x + r * 0.45, y + r * 0.55, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PALETTE.tree;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PALETTE.treeMid;
      ctx.beginPath();
      ctx.arc(x - r * 0.15, y - r * 0.15, r * 0.62, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PALETTE.treeTop;
      ctx.beginPath();
      ctx.arc(x - r * 0.25, y - r * 0.25, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return { resize, frame };
}
