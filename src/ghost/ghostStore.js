// Personal-best ghost per track, in localStorage. Never throws: storage may be missing, full or blocked.
// `modeId` below is a track key (src/meta/trackKey.js): the bare mode id on Alpine, 'mussoorie.climb'
// and so on elsewhere. A stored ghost's own modeId must match it, so ghosts never cross maps.
import { decodeGhost, encodeGhost } from './ghostCodec.js';

export const GHOST_KEY_PREFIX = 'slop-drift-ghost-v1:';

function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function ghostKey(modeId) {
  return GHOST_KEY_PREFIX + String(modeId ?? '');
}

/**
 * @param {string} modeId  Track key.
 * @param {import('../core/contracts.js').GhostData|string} ghost  GhostData, or an already encoded string.
 * @returns {boolean} true when stored (false on quota errors, missing storage or an invalid ghost).
 */
export function saveLocalGhost(modeId, ghost) {
  const store = storage();
  if (!store) return false;
  try {
    const encoded = typeof ghost === 'string' ? (decodeGhost(ghost) ? ghost : null) : encodeGhost(ghost);
    if (!encoded) return false;
    store.setItem(ghostKey(modeId), encoded);
    return true;
  } catch {
    return false;
  }
}

/** @returns {import('../core/contracts.js').GhostData|null} */
export function loadLocalGhost(modeId) {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(ghostKey(modeId));
    if (!raw) return null;
    const ghost = decodeGhost(raw);
    if (!ghost) return null;
    if (ghost.modeId && modeId != null && ghost.modeId !== String(modeId)) return null;
    return ghost;
  } catch {
    return null;
  }
}

/** @returns {boolean} */
export function clearLocalGhost(modeId) {
  const store = storage();
  if (!store) return false;
  try {
    store.removeItem(ghostKey(modeId));
    return true;
  } catch {
    return false;
  }
}
