// Boot + hash router.
//   #/cal/2026-11   calendar month     #/day/2026-11-19   day editor     #/plan     #/timer
//   #/progress[/deadlift]   #/progress/~records   #/progress/~body[/2026-11-19]   #/settings[/backup]
//   #/body (1.3 link) → #/progress/~body     #/welcome/1…5 first-run flow     #/settings/profile
import * as store from './store.js';
import { SCHEMA_VERSION } from './model.js';
import { h, icon, clearActionToasts } from './ui.js';
import { isValidISODate, todayISO } from './dates.js';
import { parseRoute as parseHash } from './routes.js';
import { registerServiceWorker, requestPersistence, checkForUpdate, showUpdateBanner, install } from './pwa.js';
import { renderCalendar } from './views/calendar.js';
import { renderDay } from './views/day.js';
import { renderProgress } from './views/progress.js';
import { renderSettings } from './views/settings.js';
import { renderPlanner } from './views/planner.js';
import { renderTimer } from './views/timer.js';
import { renderOnboarding } from './views/onboarding.js';
import { renderProfile } from './views/profile.js';
import { renderNutrition } from './views/nutrition.js';
import { initTimer, configureTimer } from './timer.js';
import { applyAppearance, watchSystemTheme, savedAppearance } from './theme.js';

// Session colours as CSS custom properties (.t-red { --c, --c-block, --c-tint })
// (css/sessions.css, generated from js/theme.js by tools/build-css.mjs: a file, so the CSP needs no inline style)
watchSystemTheme();

const main = document.getElementById('view');
let cleanup = null;
let lastRoute = '';

/** The current route, checked against the allow-list in routes.js. */
const parseRoute = () => parseHash(location.hash);

let routeSeq = 0;

async function route() {
  const seq = ++routeSeq;
  const prev = cleanup;
  cleanup = null;
  if (prev) await prev();
  if (seq !== routeSeq) return; // a newer navigation started while we were cleaning up
  // A new screen clears the old screen's toasts; re-rendering the same screen keeps them.
  if (location.hash !== lastRoute) clearActionToasts();
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());

  let { name, args, invalid } = parseRoute();
  // A link that isn't on the allow-list (or is malformed) goes to the Calendar instead.
  if (invalid) { location.replace('#/'); return; }
  // First run: until the five questions are answered or skipped through, every route shows the flow.
  if (store.state.profile.onboarding === 'pending' && name !== 'welcome') {
    history.replaceState(null, '', '#/welcome/1');
    ({ name, args } = parseRoute());
  } else if (name === 'welcome' && store.state.profile.onboarding !== 'pending') {
    location.replace('#/'); return;
  }
  if (name === 'body') { location.replace(`#/progress/~body${args[0] ? `/${args[0]}` : ''}`); return; }
  const tab = ['progress', 'settings', 'plan', 'timer'].includes(name) ? name : 'cal';
  document.querySelectorAll('.tabbar a').forEach((a) => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  main.replaceChildren();
  if (name === 'day' && isValidISODate(args[0])) cleanup = renderDay(main, args[0]);
  else if (name === 'progress') cleanup = renderProgress(main, args[0], args[1]);
  else if (name === 'welcome') cleanup = renderOnboarding(main, args[0]);
  else if (name === 'settings' && args[0] === 'profile') cleanup = renderProfile(main);
  else if (name === 'settings' && args[0] === 'nutrition') cleanup = renderNutrition(main);
  else if (name === 'settings') cleanup = renderSettings(main, args[0]);
  else if (name === 'plan') cleanup = renderPlanner(main);
  else if (name === 'timer') cleanup = renderTimer(main);
  else cleanup = renderCalendar(main, name === 'cal' ? args[0] : undefined);

  // Fresh screen: scroll to top and move focus to its heading (for screen readers),
  // except when re-rendering the same route.
  if (location.hash !== lastRoute) {
    window.scrollTo(0, 0);
    main.querySelector('h1')?.focus({ preventScroll: true });
  }
  lastRoute = location.hash;
}

/** Drop the launch splash (index.html shows it from the first paint while the html has class "booting"). */
function endSplash() {
  document.documentElement.classList.remove('booting');
  document.getElementById('splash')?.remove();
}

/** A JSON backup of everything, as a download (the update banner's "Export backup"). */
async function exportJSON() {
  await store.flushAll();
  const file = new File([JSON.stringify(store.exportPayload(), null, 1)], `workout-backup-${todayISO()}.json`, { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(file), download: file.name });
  document.body.append(a); a.click(); a.remove();
  await store.markExported();
}

/** The screen shown instead of the app when the data can't be opened safely. Nothing on it writes data. */
function blockedView(b) {
  if (b.kind === 'newer') {
    return h('section', { class: 'card blocked', id: 'blocked', 'aria-labelledby': 'blocked-h' },
      h('h1', { id: 'blocked-h', tabindex: '-1' }, 'Update VANE to open this data'),
      h('p', {}, `The data on this phone was saved by a newer version of VANE (data format ${b.stored}). This copy of the app is older (format ${SCHEMA_VERSION}), so it won’t open or change that data.`),
      h('p', {}, 'Updating fixes it. Your data is safe and untouched.'),
      h('button', {
        class: 'btn primary block', id: 'blocked-update',
        onclick: async () => {
          const r = await checkForUpdate();
          if (r === 'ready') showUpdateBanner();
          else if (r === 'none' || r === 'unsupported') location.reload();
        },
      }, icon('refresh'), 'Update now'));
  }
  return h('section', { class: 'card blocked', id: 'blocked', 'aria-labelledby': 'blocked-h' },
    h('h1', { id: 'blocked-h', tabindex: '-1' }, 'VANE couldn’t update your data'),
    h('p', {}, `This version needed to update how your data is stored (format ${b.stored} → ${SCHEMA_VERSION}), and a check found a problem, so nothing was changed. Your data is exactly as it was before.`),
    h('p', { class: 'fine' }, b.message),
    b.snapshotId ? h('button', {
      class: 'btn primary block', id: 'blocked-export',
      onclick: async () => {
        const data = await store.snapshotBackup(b.snapshotId);
        const file = new File([JSON.stringify(data, null, 1)], `vane-snapshot-${todayISO()}.json`, { type: 'application/json' });
        const a = h('a', { href: URL.createObjectURL(file), download: file.name });
        document.body.append(a); a.click(); a.remove();
      },
    }, icon('download'), 'Export a backup of your data') : null,
    h('p', { class: 'fine' }, 'Keep that file safe. An update to VANE will try again; you can also import the file on another device.'),
    h('button', { class: 'btn block', onclick: () => location.reload() }, 'Try again'));
}

async function boot() {
  try {
    await store.init();
  } catch (err) {
    console.error(err);
    main.replaceChildren(h('section', { class: 'card empty-state' },
      h('h1', {}, 'Storage unavailable'),
      h('p', {}, err.message || String(err)),
      h('p', { class: 'muted' }, 'Private/incognito mode can block on-device storage. Open the app normally and try again.')));
    endSplash();
    return;
  }
  // The data couldn't be opened safely: show why, offer what helps, and change nothing.
  if (store.state.blocked) {
    document.body.classList.add('onboarding'); // no tab bar: nothing else can run
    main.replaceChildren(blockedView(store.state.blocked));
    main.querySelector('h1')?.focus();
    endSplash();
    registerServiceWorker({ onBeforeUpdate: async () => {} }); // so the update that fixes it can arrive
    if (store.state.blocked.kind === 'newer') checkForUpdate().then((r) => { if (r === 'ready') showUpdateBanner(); });
    return;
  }
  // The device copy (applied before first paint) wins; a restored backup's choice is used on a fresh device.
  const pref = store.state.settings.appearance;
  let local = null;
  try { local = localStorage.getItem('appearance'); } catch { /* blocked */ }
  if (!local && pref && pref !== 'system') applyAppearance(pref);
  else if (local && local !== pref) store.saveSettings({ appearance: savedAppearance() });
  window.addEventListener('hashchange', route);
  await route();
  endSplash(); // the first screen is on the page: the splash goes now, never later

  // Save in-flight edits whenever the app is backgrounded or closed.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') store.flushAll(); });
  window.addEventListener('pagehide', () => store.flushAll());

  configureTimer({
    sound: () => store.state.settings.timerSound !== false,
    vibrate: () => store.state.settings.timerVibrate !== false,
  });
  initTimer();

  // Phone keyboard open → hide the tab bar/rest bar so they don't ride up over the inputs.
  const isField = (el) => el?.matches?.('input:not([type=radio]):not([type=file]), textarea, select');
  document.addEventListener('focusin', (e) => { if (isField(e.target)) document.body.classList.add('typing'); });
  document.addEventListener('focusout', () => setTimeout(() => {
    if (!isField(document.activeElement)) document.body.classList.remove('typing');
  }, 50));

  registerServiceWorker({ onBeforeUpdate: () => store.flushAll(), onExport: exportJSON }); // an update never loses an edit in progress
  // Installing (or the browser offering to) changes what Settings and the Calendar show.
  install.listeners.add(() => { if (['cal', 'settings'].includes(parseRoute().name)) window.dispatchEvent(new HashChangeEvent('hashchange')); });
  requestPersistence();
}

boot();
