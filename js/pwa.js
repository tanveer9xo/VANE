// Service worker registration, install, persistent storage.
import { h, icon, toast, sheet } from './ui.js';
import { SCHEMA_VERSION } from './model.js';

// ---------------------------------------------------------------------------
// Install. Android/Chromium: the browser's beforeinstallprompt is kept for our own "Install VANE" button.
// iPhone/iPad Safari has no install prompt: "Add to your home screen" opens the steps instead. Other iOS browsers
// can't install a web app, so nothing is offered there. Installed (standalone) → a quiet "Installed" state.
// ---------------------------------------------------------------------------
export const install = { prompt: null, installed: false, listeners: new Set() };
const notify = () => install.listeners.forEach((fn) => fn());

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // keep it for our own "Install VANE" button
  install.prompt = e;
  notify();
});
window.addEventListener('appinstalled', () => {
  install.prompt = null;
  install.installed = true;
  requestPersistence(); // an installed app is the best case for keeping storage
  notify();
  toast('VANE is installed');
});

export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

/** Safari on iPhone/iPad, the only iOS browser that can add a web app to the home screen. */
export function isIOSSafari(ua = navigator.userAgent) {
  return isIOS() && /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|YaBrowser|DuckDuckGo|Instagram|FBAN|FBAV|Line\/|Snapchat/.test(ua);
}

/** 'installed' | 'prompt' (Chromium can install now) | 'ios' (Safari: show the steps) | 'none' (nothing to offer). */
export function installState() {
  if (install.installed || isStandalone()) return 'installed';
  if (install.prompt) return 'prompt';
  if (isIOSSafari()) return 'ios';
  return 'none';
}

/** The steps for Safari, in a sheet. */
export function openIOSInstallSheet() {
  return sheet({
    title: 'Add VANE to your home screen',
    build: () => h('div', { class: 'stack ios-steps' },
      h('ol', { class: 'steps' },
        h('li', {}, icon('share-ios'), h('span', {}, 'Tap ', h('strong', {}, 'Share'), ' (the square with an arrow, at the bottom or top of Safari).')),
        h('li', {}, icon('plus'), h('span', {}, 'Scroll down and tap ', h('strong', {}, 'Add to Home Screen'), '.')),
        h('li', {}, icon('check'), h('span', {}, 'Tap ', h('strong', {}, 'Add'), '. VANE opens from your home screen, full screen and offline.'))),
      h('p', { class: 'fine' }, 'This only works in Safari. If you opened VANE from another app or browser, open this page in Safari first.')),
  });
}

/** The install button for this browser, or null. */
export function installButton(cls = 'btn primary block') {
  const st = installState();
  if (st === 'prompt') return h('button', { class: cls, id: 'install-btn', onclick: () => promptInstall() }, icon('phone'), 'Install VANE');
  if (st === 'ios') return h('button', { class: cls, id: 'install-btn', onclick: () => openIOSInstallSheet() }, icon('share-ios'), 'Add to your home screen');
  return null;
}

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
let registered = null; // resolves once register() has finished (or failed)
const registrationReady = new Promise((r) => { registered = r; });

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

let exportBackup = null; // set by the app: downloads a JSON backup

/** Ask a waiting worker which app version and data format it brings. → { version, schema } or null */
function askVersion(worker, ms = 1500) {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const t = setTimeout(() => resolve(null), ms);
    ch.port1.onmessage = (e) => { clearTimeout(t); resolve(e.data); };
    try { worker.postMessage({ type: 'VERSION' }, [ch.port2]); } catch { clearTimeout(t); resolve(null); }
  });
}

/** Show (or show again) the "Update ready" banner for a waiting worker. */
export function showUpdateBanner(reg = registration) {
  if (!reg?.waiting || !navigator.serviceWorker.controller) return false;
  updateBanner()?.remove();
  const dataNote = h('div', { class: 'update-data', hidden: true },
    h('span', {}, 'This update changes how your data is stored. Export a backup before updating.'),
    exportBackup ? h('button', { class: 'btn small soft', type: 'button', id: 'update-export', onclick: () => exportBackup() }, icon('download'), 'Export backup') : null);
  askVersion(reg.waiting).then((info) => { if (info && info.schema > SCHEMA_VERSION) dataNote.hidden = false; });
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
    h('button', { class: 'icon-btn update-x', type: 'button', 'aria-label': 'Dismiss: update later', onclick: () => banner.remove() }, icon('x')),
    dataNote);
  document.body.insertBefore(banner, document.getElementById('view'));
  return true;
}

/**
 * Ask the server for a newer version now. Resolves to 'ready' (waiting: the banner is shown again),
 * 'found' (downloading: the banner appears when it's ready), 'none' or 'unsupported'.
 */
export async function checkForUpdate() {
  await Promise.race([registrationReady, new Promise((r) => setTimeout(r, 3000))]);
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
export function registerServiceWorker({ onBeforeUpdate, onExport } = {}) {
  if (!('serviceWorker' in navigator)) { registered(); return; }
  if (onBeforeUpdate) beforeUpdate = onBeforeUpdate;
  if (onExport) exportBackup = onExport;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadOnControllerChange) location.reload();
  });
  const offerUpdate = (reg) => showUpdateBanner(reg);

  // updateViaCache 'none': update checks always ask the network, never the HTTP cache.
  navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' }).then((reg) => {
    registration = reg;
    if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg);
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      sw?.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(reg);
      });
    });
    registered();
  }).catch((err) => { console.warn('Service worker registration failed', err); registered(); });
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
