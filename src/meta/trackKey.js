// Track keys: the id that progress is stored, ranked and shared under. Every map offers the same
// modes (src/config.js MODES) on different roads, so a time only means something next to times
// from the same map and mode. Records, ghosts, medals, leaderboards and multiplayer rooms all use
// the track key; achievements and XP events keep plain mode ids so they count on any map.
//
//   trackKey('alpine', 'climb')     -> 'climb'            (the original map keeps its old ids and data)
//   trackKey('mussoorie', 'climb')  -> 'mussoorie.climb'
//
// Pure and dependency-free: the server (server/src/validate.js) imports it too.

/** The original map. Its track keys are bare mode ids, so saves and server rows from before maps still match. */
export const LEGACY_MAP = 'alpine';

/** Map ids and mode ids are lowercase slugs, so the dot is unambiguous and safe in URLs and room names. */
const SEPARATOR = '.';

/**
 * @param {string|null|undefined} mapId  Missing means the legacy map.
 * @param {string} modeId
 * @returns {string}
 */
export function trackKey(mapId, modeId) {
  const mode = String(modeId ?? '');
  if (!mapId || mapId === LEGACY_MAP) return mode;
  return `${mapId}${SEPARATOR}${mode}`;
}

/**
 * Inverse of trackKey. A key without a separator is a legacy (alpine) key.
 * @param {string} key
 * @returns {{mapId:string, modeId:string}}
 */
export function parseTrackKey(key) {
  const text = String(key ?? '');
  const at = text.indexOf(SEPARATOR);
  if (at < 0) return { mapId: LEGACY_MAP, modeId: text };
  return { mapId: text.slice(0, at), modeId: text.slice(at + 1) };
}

/** The plain mode id inside a track key (e.g. for labels and drift/time checks). */
export function modeOfTrack(key) {
  return parseTrackKey(key).modeId;
}
