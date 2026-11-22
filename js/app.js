// Boot + hash router.
//   #/cal/2026-11   calendar month     #/day/2026-11-19   day editor     #/plan     #/timer
//   #/progress[/deadlift]   #/progress/~records   #/progress/~body[/2026-11-19]   #/settings[/backup]
//   #/body (1.3 link) → #/progress/~body     #/welcome/1…5 first-run flow     #/settings/profile
import * as store from './store.js';
import { h, clearActionToasts } from './ui.js';
import { isValidISODate } from './dates.js';
import { registerServiceWorker, requestPersistence } from './pwa.js';
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
import { sessionCSS, applyAppearance, watchSystemTheme, savedAppearance } from './theme.js';

// Session colours as CSS custom properties (.t-push { --c, --c-block, --c-tint }), from js/theme.js.
document.head.append(Object.assign(document.createElement('style'), { textContent: sessionCSS() }));
watchSystemTheme();

const main = document.getElementById('view');
let cleanup = null;
let lastRoute = '';

function parseRoute() {
  const [name, ...args] = location.hash.replace(/^#\/?/, '').split('/');
  return { name: name || 'cal', args: args.map((a) => decodeURIComponent(a)) };
}

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

  let { name, args } = parseRoute();
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

  registerServiceWorker({ onBeforeUpdate: () => store.flushAll() }); // an update never loses an edit in progress
  requestPersistence();
}

boot();
