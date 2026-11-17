// Ways to hand control back to the browser during long work (world generation, mesh building).
//
// requestAnimationFrame does not fire at all in a background tab, and setTimeout is throttled to
// once a second or slower, so a loader built on either stalls when the player switches tabs.
// A MessageChannel message is not throttled, so it is used whenever the page is hidden.

// Browser only: in Node an open MessagePort would keep the process alive, and nothing is hidden there.
const channel = typeof document !== 'undefined' && typeof MessageChannel === 'function' ? new MessageChannel() : null;
const waiting = [];
if (channel) {
  channel.port1.onmessage = () => {
    const resolve = waiting.shift();
    if (resolve) resolve();
  };
}

/** Resolve on the next task, without the timer throttling hidden pages get. */
export function nextTask() {
  if (!channel) return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => {
    waiting.push(resolve);
    channel.port2.postMessage(0);
  });
}

/**
 * Resolve after the next paint when the page is visible (so a progress bar visibly moves), or on
 * the next task when it is hidden. Never waits more than 100 ms either way.
 */
export function nextFrame() {
  const hidden = typeof document !== 'undefined' && document.hidden;
  if (hidden || typeof requestAnimationFrame !== 'function') return nextTask();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    requestAnimationFrame(finish);
    // The tab may be hidden while we wait; rAF would then never come.
    setTimeout(finish, 100);
  });
}
