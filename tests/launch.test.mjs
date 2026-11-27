// First-session and retention helpers: `node tests/launch.test.mjs` (exit code 1 on failure).
// Next-event and next-unlock suggestions, the cloud/local progress merge, and the new-player ad delay.
import { Career } from '../src/meta/Career.js';
import { mirroredStorage, profileXp } from '../src/platform/progressStorage.js';
import { CrazyGamesPlatform } from '../src/platform/CrazyGames.js';

let failures = 0;
let passes = 0;
function check(name, ok, detail = '') {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `  (${detail})` : ''}`);
}
const memory = (init = {}) => {
  const data = { ...init };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
};

// ---- next event / next unlock
const career = new Career({ storage: memory(), mapId: 'mussoorie' });
const ranked = career.rankedModes();
check('the map ranks several events', ranked.length >= 3, ranked.join(','));
const first = career.nextEvent('roam');
check('after free roam, the first ranked event is suggested', first === ranked[0], first);
const afterFirst = career.nextEvent(ranked[0]);
check('after an event, the next one in order is suggested', afterFirst === ranked[1], afterFirst);
career.profile.medals[career.trackKey(ranked[1])] = 'bronze';
check('events already medalled are skipped', career.nextEvent(ranked[0]) === ranked[2], career.nextEvent(ranked[0]));
const drift = ranked.indexOf('drift');
check('after the first drift, a short event from the top of the list is next, not the long climb', career.nextEvent('drift') === ranked[0], career.nextEvent('drift'));
for (const id of ranked) career.profile.medals[career.trackKey(id)] = 'gold';
check('with every event medalled, the following event is suggested', career.nextEvent(ranked[drift]) === ranked[(drift + 1) % ranked.length]);
const unlock = career.nextUnlock();
check('a new driver sees the closest level unlock with XP to go', unlock && unlock.level >= 2 && unlock.xpToGo > 0, JSON.stringify(unlock));
career.profile.xp = 1e9;
check('nothing left to unlock by level at max XP', career.nextUnlock() === null);

// ---- cloud + local progress
const KEY = 'slop-drift-profile-v1';
const cloud = memory({ [KEY]: JSON.stringify({ xp: 100 }) });
const local = memory({ [KEY]: JSON.stringify({ xp: 900 }) });
const store = mirroredStorage(cloud, local);
check('the copy with more progress wins', profileXp(store.getItem(KEY)) === 900);
check('and is written back to the cloud', profileXp(cloud.data[KEY]) === 900);
const fresh = memory();
const store2 = mirroredStorage(fresh, memory({ [KEY]: JSON.stringify({ xp: 42 }) }));
check('a local-only save is migrated to the cloud', profileXp(store2.getItem(KEY)) === 42 && profileXp(fresh.data[KEY]) === 42);
store.setItem(KEY, JSON.stringify({ xp: 1000 }));
check('saves go to both copies', profileXp(cloud.data[KEY]) === 1000 && profileXp(local.data[KEY]) === 1000);
const asyncCloud = { getItem: () => Promise.resolve('x'), setItem: () => {} };
check('an async cloud API falls back to local', profileXp(mirroredStorage(asyncCloud, local).getItem(KEY)) === 1000);
const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
check('a throwing store does not break saving', (() => { mirroredStorage(broken, local).setItem(KEY, JSON.stringify({ xp: 5 })); return profileXp(local.data[KEY]) === 5; })());

// ---- ads
const platform = new CrazyGamesPlatform();
let requested = 0;
platform.initialized = true;
platform.sdk = { ad: { requestAd: async (_type, cb) => { requested++; cb.adFinished(); } } };
let finished = 0;
await platform.requestMidgameAd({ onFinish: () => finished++ });
check('no mid-game ad in the first minutes of a session', requested === 0 && finished === 1);
platform.sessionStart -= platform.firstAdDelay + 1000;
await platform.requestMidgameAd({ onFinish: () => finished++ });
check('ads resume after the delay', requested === 1 && finished === 2);
await platform.requestMidgameAd({ onFinish: () => finished++ });
check('and keep the 3-minute gap', requested === 1 && finished === 3);
const sdkData = memory();
platform.sdk.data = sdkData;
check('the data module is offered as cloud storage', platform.dataStorage === sdkData);
platform.initialized = false;
check('but not before the SDK is ready', platform.dataStorage === null);

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
