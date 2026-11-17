// Shared by NetClient and Leaderboard: API host normalisation and the per-player token that proves
// "this browser owns this profile id" to the Worker (POST /api/register, stored in localStorage).

const TOKEN_PREFIX = 'slop-drift-net-token:';

/** 'localhost:8787' -> 'http://localhost:8787'; 'api.example.com' -> 'https://api.example.com'; '' -> ''. */
export function normalizeHost(host) {
  if (typeof host !== 'string') return '';
  let value = host.trim().replace(/\/+$/, '');
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) {
    const local = /^(localhost|127\.|\[::1\]|0\.0\.0\.0|[^/]+\.localhost)/i.test(value);
    value = `${local ? 'http' : 'https'}://${value}`;
  }
  return value;
}

/** http(s) base -> ws(s) base. */
export function socketBase(httpBase) {
  return httpBase.replace(/^http/i, 'ws');
}

export function storage() {
  try {
    const store = globalThis.localStorage;
    if (!store) return null;
    const probe = '__slop_drift_probe__';
    store.setItem(probe, '1');
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}

export function readJson(key, fallback) {
  try {
    const text = storage()?.getItem(key);
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key, value) {
  try {
    storage()?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function fetchWithTimeout(url, options = {}, timeoutMs = 6000) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  return fetch(url, { ...options, signal: controller?.signal }).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

const pending = new Map();

/**
 * The token for `playerId` on `host`, registering on first use.
 * Resolves { token, claimed }: token is null when the server is unreachable (try again later) or when
 * the id was already claimed by another browser (claimed: true, 409; retrying will not help).
 */
export function ensureToken(host, playerId, name) {
  if (!host || !playerId) return Promise.resolve({ token: null, claimed: false });
  const key = `${TOKEN_PREFIX}${host}|${playerId}`;
  try {
    const stored = storage()?.getItem(key);
    if (stored) return Promise.resolve({ token: stored, claimed: false });
  } catch {
    // fall through to registering
  }
  if (pending.has(key)) return pending.get(key);
  const request = fetchWithTimeout(`${host}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId, name }),
  })
    .then(async (response) => {
      if (response.status === 409) return { token: null, claimed: true };
      if (!response.ok) return { token: null, claimed: false };
      const data = await response.json();
      if (typeof data?.token !== 'string') return { token: null, claimed: false };
      try {
        storage()?.setItem(key, data.token);
      } catch {
        // token lives for this session only
      }
      return { token: data.token, claimed: false };
    })
    .catch(() => ({ token: null, claimed: false }))
    .finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}

/** Forget a token the server rejected, so the next ensureToken registers again. */
export function forgetToken(host, playerId) {
  try {
    storage()?.removeItem(`${TOKEN_PREFIX}${host}|${playerId}`);
  } catch {
    // nothing to forget
  }
}

/** Level from a profile that may carry `level` directly or only `xp`. */
export function profileLevel(profile, levelForXp) {
  const level = Number(profile?.level);
  if (Number.isFinite(level) && level >= 1) return Math.floor(level);
  if (levelForXp && Number.isFinite(profile?.xp)) return levelForXp(profile.xp);
  return 1;
}
