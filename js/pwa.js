// Service worker registration, install prompt, persistent storage.
import { h, toast } from './ui.js';

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

/** Ask the server for a newer version now. Resolves to 'found', 'none' or 'unsupported'. */
export async function checkForUpdate() {
  if (!registration) return 'unsupported';
  try {
    await registration.update();
  } catch {
    return 'none'; // offline
  }
  const pending = registration.installing || registration.waiting;
  return pending ? 'found' : 'none';
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  let reloadOnControllerChange = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadOnControllerChange) location.reload();
  });

  const offerUpdate = (reg) => {
    toast('A new version is ready.', {
      timeout: 0,
      action: {
        label: 'Update',
        run: () => {
          reloadOnControllerChange = true;
          reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
        },
      },
    }).removeAttribute('data-action'); // survive navigation
  };

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
