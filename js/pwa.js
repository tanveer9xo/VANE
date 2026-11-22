// Service worker registration, install prompt, persistent storage.
import { h, icon, toast } from './ui.js';

export const install = { prompt: null, listeners: new Set() };
const notify = () => install.listeners.forEach((fn) => fn());

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // keep it for our own "Install" button
  install.prompt = e;
  notify();
});
window.addEventListener('appinstalled', () => {
  install.prompt = null;
  notify();
  toast('App installed');
});

export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export async function promptInstall() {
  const p = install.prompt;
  if (!p) return false;
  install.prompt = null;
  p.prompt();
  const { outcome } = await p.userChoice;
  notify();
  return outcome === 'accepted';
}

let registration = null;

// ---------------------------------------------------------------------------
// Updates. A new version installs in the background (the new service worker waits); a banner at the top of
// the page, in the page flow (never over content, never a toast), offers it. Tapping it saves any edit in
// progress, lets the new worker take over and reloads. Only the app's own file cache is replaced: your data
// (IndexedDB, and the appearance setting in localStorage) is never touched.
// ---------------------------------------------------------------------------
let beforeUpdate = async () => {};
let reloadOnControllerChange = false;

function updateBanner() {
  return document.getElementById('update-banner');
}

/** Show (or show again) the "Update ready" banner for a waiting worker. */
export function showUpdateBanner(reg = registration) {
  if (!reg?.waiting || !navigator.serviceWorker.controller) return false;
  updateBanner()?.remove();
  const banner = h('div', { id: 'update-banner', class: 'update-banner', role: 'status' },
    h('button', {
      class: 'update-go', type: 'button',
      onclick: async (e) => {
        e.currentTarget.disabled = true;
        await beforeUpdate(); // write any in-flight edit first
        reloadOnControllerChange = true;
        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        else location.reload();
      },
    }, icon('refresh'), h('span', {}, 'Update ready. Tap to refresh')),
    h('button', { class: 'icon-btn update-x', type: 'button', 'aria-label': 'Dismiss: update later', onclick: () => banner.remove() }, icon('x')));
  document.body.insertBefore(banner, document.getElementById('view'));
  return true;
}

/**
 * Ask the server for a newer version now. Resolves to 'ready' (waiting: the banner is shown again),
 * 'found' (downloading: the banner appears when it's ready), 'none' or 'unsupported'.
 */
export async function checkForUpdate() {
  if (!registration) return 'unsupported';
  if (registration.waiting && showUpdateBanner()) return 'ready';
  try {
    await registration.update();
  } catch {
    return 'none'; // offline
  }
  if (registration.waiting && showUpdateBanner()) return 'ready';
  return registration.installing ? 'found' : 'none';
}

/** `onBeforeUpdate` runs before the new version takes over (the app passes "save everything now"). */
export function registerServiceWorker({ onBeforeUpdate } = {}) {
  if (!('serviceWorker' in navigator)) return;
  if (onBeforeUpdate) beforeUpdate = onBeforeUpdate;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadOnControllerChange) location.reload();
  });
  const offerUpdate = (reg) => showUpdateBanner(reg);

  navigator.serviceWorker.register('./sw.js').then((reg) => {
    registration = reg;
    if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg);
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      sw?.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(reg);
      });
    });
  }).catch((err) => console.warn('Service worker registration failed', err));
}

export async function storageInfo() {
  const s = navigator.storage;
  return {
    supported: !!s?.persist,
    persisted: s?.persisted ? await s.persisted() : false,
    estimate: s?.estimate ? await s.estimate() : null,
  };
}

/** Ask the browser not to evict our data. Chrome decides silently; Firefox may prompt. */
export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** Instructions block for platforms without a programmatic install prompt. */
export function installHelp() {
  if (isIOS()) {
    return h('p', { class: 'muted' },
      'On iPhone: open this page in Safari, tap Share, then “Add to Home Screen”.');
  }
  return h('p', { class: 'muted' },
    'Open your browser menu and choose “Install app” or “Add to Home screen”. Chrome on Android shows an Install button here when it can.');
}
