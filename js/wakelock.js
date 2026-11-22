// Keep the screen awake during a workout (Screen Wake Lock API). Where it isn't supported the toggle
// is shown as unavailable and nothing else changes. The browser drops the lock whenever the page is
// hidden, so it's re-requested when the page becomes visible again.

let sentinel = null;
let wanted = false;

export const wakeLockSupported = () => typeof navigator !== 'undefined' && 'wakeLock' in navigator;

async function acquire() {
  if (!wanted || sentinel || document.visibilityState !== 'visible' || !wakeLockSupported()) return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => { sentinel = null; });
  } catch {
    sentinel = null; // e.g. battery saver; not worth bothering the user about
  }
}

/** Turn the wish on/off. Resolves to whether a lock is currently held. */
export async function setKeepAwake(on) {
  wanted = on;
  if (on) await acquire();
  else if (sentinel) { const s = sentinel; sentinel = null; await s.release().catch(() => {}); }
  return !!sentinel;
}

export const isAwake = () => !!sentinel;

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') acquire(); });
}
