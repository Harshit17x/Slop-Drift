// Slop Drift backend: one Worker.
//   /parties/room/<modeId>   WebSocket upgrade into the Room Durable Object for that event (Room.js);
//                            modeId is a track key (src/meta/trackKey.js), e.g. 'sprint' or 'mussoorie.sprint',
//                            or a private party room 'party.<CODE>' (src/net/party.js)
//   /api/*                   REST (Hono): register, score, top, ghost, online
//
// Free-tier budget (100k requests/day for Workers + Durable Objects together) drives the design:
// leaderboard and presence reads are cached (edge Cache API + per-isolate memory), realtime traffic
// is WebSocket messages into a hibernating DO (billed 20:1), and nothing here polls.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { routePartykitRequest } from 'partyserver';
import { Room } from './Room.js';
import {
  RANKED_MODES, ROOM_MODES, SUBMIT_INTERVAL_MS, isPartyRoom, isValidPlayerId, limitsFor, originAllowed, parseJoinParams,
  sanitizeName, signToken, validateSubmission, verifyToken,
} from './validate.js';

export { Room };

const TOP_TTL = 30;
const ONLINE_TTL = 15;
const GHOST_TTL = 60;
const MAX_BODY = 100_000;

const app = new Hono();

app.use('/api/*', cors({
  origin: (origin, c) => (originAllowed(origin, c.env.ALLOWED_ORIGINS) ? origin : null),
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
  maxAge: 86400,
}));

// Browsers always send Origin on cross-site POSTs: refuse ones from elsewhere outright.
app.use('/api/*', async (c, next) => {
  const origin = c.req.header('Origin');
  if (c.req.method === 'POST' && origin && !originAllowed(origin, c.env.ALLOWED_ORIGINS)) {
    return c.json({ accepted: false, reason: 'origin-not-allowed' }, 403);
  }
  return next();
});

// ------------------------------------------------------------------ caching helpers

/** Per-isolate memory cache; the Cache API is a no-op on *.workers.dev, so this does most of the work there. */
const memory = new Map();

async function cached(c, key, ttl, produce) {
  const now = Date.now();
  const hit = memory.get(key);
  if (hit && hit.expires > now) return respondJson(hit.body, ttl);

  const cacheKey = new Request(`https://cache.slop-drift.internal/${key}`);
  const edge = typeof caches !== 'undefined' ? caches.default : null;
  if (edge) {
    const response = await edge.match(cacheKey).catch(() => null);
    if (response) {
      const body = await response.text();
      memory.set(key, { body, expires: now + ttl * 1000 });
      return respondJson(body, ttl);
    }
  }
  const data = await produce();
  const body = JSON.stringify(data);
  memory.set(key, { body, expires: now + ttl * 1000 });
  if (memory.size > 500) memory.delete(memory.keys().next().value);
  if (edge) {
    const store = new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}` } });
    c.executionCtx.waitUntil(edge.put(cacheKey, store).catch(() => {}));
  }
  return respondJson(body, ttl);
}

async function invalidate(c, keys) {
  const edge = typeof caches !== 'undefined' ? caches.default : null;
  for (const key of keys) {
    memory.delete(key);
    if (edge) c.executionCtx.waitUntil(edge.delete(new Request(`https://cache.slop-drift.internal/${key}`)).catch(() => {}));
  }
}

function respondJson(body, ttl) {
  return new Response(body, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${ttl}` },
  });
}

async function readJson(c) {
  const length = Number(c.req.header('Content-Length') || 0);
  if (length > MAX_BODY) return null;
  const text = await c.req.text();
  if (text.length > MAX_BODY) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function secretOf(c) {
  const secret = c.env.TOKEN_SECRET;
  if (!secret || secret.length < 16) throw new Error('TOKEN_SECRET missing or shorter than 16 characters');
  return secret;
}

// ------------------------------------------------------------------ routes

app.get('/api/health', (c) => c.json({ ok: true, modes: ROOM_MODES }));

/**
 * POST {playerId, name} -> {token}. The first registration of a player id claims it; afterwards only
 * the holder of the token can submit under that id (409 for a second claim).
 */
app.post('/api/register', async (c) => {
  const body = await readJson(c);
  if (!body || !isValidPlayerId(body.playerId)) return c.json({ reason: 'bad-player' }, 400);
  const name = sanitizeName(body.name) || 'Driver';
  const result = await c.env.DB.prepare('INSERT INTO players (id, name, created_at) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO NOTHING')
    .bind(body.playerId, name, Date.now()).run();
  if (!result.meta?.changes) return c.json({ reason: 'already-registered' }, 409);
  return c.json({ token: await signToken(secretOf(c), body.playerId) });
});

/** POST {modeId, playerId, token, name, level, time|score, ghost} -> {accepted, improved, rank, reason}. */
app.post('/api/score', async (c) => {
  const body = await readJson(c);
  const checked = validateSubmission(body);
  if (!checked.ok) return c.json({ accepted: false, rank: null, reason: checked.reason }, 400);
  const entry = checked.entry;
  if (!(await verifyToken(secretOf(c), entry.playerId, body.token))) {
    return c.json({ accepted: false, rank: null, reason: 'bad-token' }, 401);
  }

  const now = Date.now();
  const gate = await c.env.DB.prepare('UPDATE players SET last_submit_at = ?1, name = ?2 WHERE id = ?3 AND last_submit_at <= ?4')
    .bind(now, entry.name, entry.playerId, now - SUBMIT_INTERVAL_MS).run();
  if (!gate.meta?.changes) {
    const known = await c.env.DB.prepare('SELECT 1 FROM players WHERE id = ?1').bind(entry.playerId).first();
    return known
      ? c.json({ accepted: false, rank: null, reason: 'rate-limited' }, 429)
      : c.json({ accepted: false, rank: null, reason: 'unregistered' }, 401);
  }

  const timed = limitsFor(entry.modeId).kind === 'time';
  const upsert = timed
    ? `INSERT INTO scores (mode, player_id, name, level, time, score, ghost, at) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7)
       ON CONFLICT(mode, player_id) DO UPDATE SET name = excluded.name, level = excluded.level, time = excluded.time,
         ghost = excluded.ghost, at = excluded.at WHERE excluded.time < scores.time`
    : `INSERT INTO scores (mode, player_id, name, level, time, score, ghost, at) VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7)
       ON CONFLICT(mode, player_id) DO UPDATE SET name = excluded.name, level = excluded.level, score = excluded.score,
         ghost = COALESCE(excluded.ghost, scores.ghost), at = excluded.at WHERE excluded.score > scores.score`;
  const rank = timed
    ? 'SELECT COUNT(*) + 1 AS rank, (SELECT time FROM scores WHERE mode = ?1 AND player_id = ?2) AS best FROM scores WHERE mode = ?1 AND time < (SELECT time FROM scores WHERE mode = ?1 AND player_id = ?2)'
    : 'SELECT COUNT(*) + 1 AS rank, (SELECT score FROM scores WHERE mode = ?1 AND player_id = ?2) AS best FROM scores WHERE mode = ?1 AND score > (SELECT score FROM scores WHERE mode = ?1 AND player_id = ?2)';
  const [written, ranked] = await c.env.DB.batch([
    c.env.DB.prepare(upsert).bind(entry.modeId, entry.playerId, entry.name, entry.level, timed ? entry.time : entry.score, entry.ghost, now),
    c.env.DB.prepare(rank).bind(entry.modeId, entry.playerId),
  ]);
  const improved = Boolean(written.meta?.changes);
  const row = ranked.results?.[0] || {};
  if (improved) await invalidate(c, topKeys(entry.modeId).concat(`ghost/${entry.modeId}/${entry.playerId}`));
  return c.json({ accepted: true, improved, rank: row.rank ?? null, best: row.best ?? null, reason: improved ? null : 'not-a-personal-best' });
});

const TOP_LIMITS = [10, 25, 50, 100];
function topKeys(modeId) {
  return TOP_LIMITS.map((limit) => `top/${modeId}/${limit}`);
}

/** GET ?mode=X&limit=50 -> {mode, kind, entries:[{rank, playerId, name, level, time, score, hasGhost, at}]}. */
app.get('/api/top', async (c) => {
  const modeId = c.req.query('mode');
  const limits = limitsFor(modeId);
  if (!limits) return c.json({ reason: 'unknown-mode' }, 400);
  const asked = Number(c.req.query('limit')) || 50;
  const limit = TOP_LIMITS.find((value) => value >= asked) || 100;
  return cached(c, `top/${modeId}/${limit}`, TOP_TTL, async () => {
    const order = limits.kind === 'time' ? 'time ASC' : 'score DESC';
    const { results } = await c.env.DB.prepare(
      `SELECT player_id, name, level, time, score, ghost IS NOT NULL AS has_ghost, at FROM scores
       WHERE mode = ?1 AND ${limits.kind === 'time' ? 'time' : 'score'} IS NOT NULL ORDER BY ${order}, at ASC LIMIT ?2`,
    ).bind(modeId, limit).all();
    return {
      mode: modeId,
      kind: limits.kind,
      entries: (results || []).map((row, index) => ({
        rank: index + 1,
        playerId: row.player_id,
        name: row.name,
        level: row.level,
        time: row.time,
        score: row.score,
        hasGhost: Boolean(row.has_ghost),
        at: row.at,
      })),
    };
  });
});

/** GET ?mode=X&player=Y -> {ghost} (null when there is none). */
app.get('/api/ghost', async (c) => {
  const modeId = c.req.query('mode');
  const playerId = c.req.query('player');
  if (!RANKED_MODES.includes(modeId) || !isValidPlayerId(playerId)) return c.json({ reason: 'bad-request' }, 400);
  return cached(c, `ghost/${modeId}/${playerId}`, GHOST_TTL, async () => {
    const row = await c.env.DB.prepare('SELECT ghost FROM scores WHERE mode = ?1 AND player_id = ?2').bind(modeId, playerId).first();
    return { ghost: row?.ghost ?? null };
  });
});

/** GET -> {total, rooms:{modeId:count}}; asks every room, cached 15 s. */
app.get('/api/online', (c) => cached(c, 'online', ONLINE_TTL, async () => {
  const counts = await Promise.all(ROOM_MODES.map(async (modeId) => {
    try {
      const stub = c.env.Room.get(c.env.Room.idFromName(modeId));
      const response = await stub.fetch(new Request(`https://room.internal/parties/room/${modeId}`, { headers: { 'x-partykit-room': modeId } }));
      const data = await response.json();
      return [modeId, Number(data.count) || 0];
    } catch {
      return [modeId, 0];
    }
  }));
  const rooms = Object.fromEntries(counts);
  return { total: counts.reduce((sum, [, count]) => sum + count, 0), rooms };
}));

app.onError((error, c) => {
  console.error(error);
  return c.json({ accepted: false, reason: 'server-error' }, 500);
});

app.notFound((c) => c.json({ reason: 'not-found' }, 404));

// ------------------------------------------------------------------ entry

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/parties/')) {
      const routed = await routePartykitRequest(request, env, {
        onBeforeConnect: async (req, lobby) => {
          const origin = req.headers.get('Origin');
          if (!originAllowed(origin, env.ALLOWED_ORIGINS)) return new Response('origin not allowed', { status: 403 });
          if (lobby.className !== 'Room' || !(ROOM_MODES.includes(lobby.name) || isPartyRoom(lobby.name))) return new Response('unknown room', { status: 404 });
          const params = parseJoinParams(new URL(req.url).searchParams);
          if (!params) return new Response('bad join parameters', { status: 400 });
          if (!(await verifyToken(env.TOKEN_SECRET, params.playerId, params.token))) return new Response('bad token', { status: 401 });
          return undefined;
        },
        // Plain HTTP into rooms is internal only (presence counts go through /api/online).
        onBeforeRequest: () => new Response('not found', { status: 404 }),
      });
      return routed || new Response('not found', { status: 404 });
    }
    return app.fetch(request, env, ctx);
  },
};
