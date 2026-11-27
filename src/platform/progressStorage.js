// Progress storage that writes to both the CrazyGames data module (cloud) and localStorage, and reads
// whichever copy holds more progress, so a player keeps their career across devices and cleared
// browser storage, and a local save made while the SDK was unavailable is never thrown away.

function read(store, key) {
  try {
    const value = store?.getItem(key);
    // An async (promise) API is not something this synchronous storage can use: treat it as empty.
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

function write(store, key, value) {
  try {
    store?.setItem(key, value);
  } catch {
    // A full or blocked store must not stop the game; the other copy still saves.
  }
}

/** XP in a saved profile, or -1 when it cannot be read. */
export function profileXp(text) {
  try {
    const xp = JSON.parse(text)?.xp;
    return Number.isFinite(xp) ? xp : -1;
  } catch {
    return -1;
  }
}

/**
 * @param {{getItem:Function,setItem:Function}} cloud
 * @param {{getItem:Function,setItem:Function}|null} local
 * @param {(a:string,b:string)=>number} [rank] larger means more progress (default: profile XP)
 */
export function mirroredStorage(cloud, local, rank = profileXp) {
  return {
    getItem(key) {
      const a = read(cloud, key);
      const b = read(local, key);
      const best = a == null ? b : b == null ? a : rank(b) > rank(a) ? b : a;
      if (best != null && best !== a) write(cloud, key, best);
      if (best != null && best !== b) write(local, key, best);
      return best;
    },
    setItem(key, value) {
      write(local, key, value);
      write(cloud, key, value);
    },
  };
}
