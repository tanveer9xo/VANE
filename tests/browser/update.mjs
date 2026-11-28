// Update flow: simulate a version bump on the server and check that the "Update ready" banner appears (a
// banner, not a toast), can be dismissed and brought back, and that tapping it moves to the new version with
// every piece of stored data intact, including an edit still waiting to be saved.
//   node tests/browser/update.mjs      (npm run test:update)    CHROME=/path/to/chrome to override
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite } from '../../tools/build-site.mjs';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CDP = 9338;
const HTTP = 8768;
const BASE = `http://127.0.0.1:${HTTP}/VANE/`;
const WORK = mkdtempSync(join(tmpdir(), 'vane-update-'));
const SITE = join(WORK, 'www', 'VANE');
const NEXT = '99.0.0-test';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

buildSite(SITE);
const OLD = readFileSync(join(SITE, 'sw.js'), 'utf8').match(/VERSION = '([^']+)'/)[1];
const server = spawn('python3', ['-m', 'http.server', String(HTTP), '--bind', '127.0.0.1'], { cwd: join(WORK, 'www'), stdio: 'ignore' });
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${join(WORK, 'profile')}`,
  '--no-first-run', '--no-default-browser-check', ...(process.env.CI ? ['--no-sandbox'] : []), 'about:blank',
], { stdio: 'ignore' });

let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };
const finish = (code) => {
  try { chrome.kill(); } catch { /* */ }
  try { server.kill(); } catch { /* */ }
  setTimeout(() => { try { rmSync(WORK, { recursive: true, force: true }); } catch { /* */ } process.exit(code); }, 300);
};
process.on('unhandledRejection', (e) => { console.error('ERROR', e); finish(2); });
setTimeout(() => { console.error('ERROR timed out after 3 minutes'); finish(3); }, 180000).unref();

let target;
for (let i = 0; i < 75 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === 'page'); } catch { await sleep(200); }
}
if (!target) throw new Error('Chrome did not start');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let seq = 0;
const pending = new Map();
const errors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result); }
  else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const go = async (hash) => { await ev(`location.hash = ${JSON.stringify(hash)}; true`); await sleep(500); };
const waitFor = async (expr, ms = 15000) => { for (let t = 0; t < ms; t += 250) { if (await ev(expr)) return true; await sleep(250); } return false; };

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });

// ---- first visit: install, skip the first run, store some data ----
await send('Page.navigate', { url: BASE });
await sleep(2000);
check(await waitFor(`!!navigator.serviceWorker.controller`), `version ${OLD} installed and in control`);
for (let i = 0; i < 5; i++) { await ev(`document.querySelector('.ob-skip')?.click(); true`); await sleep(400); }
const TODAY = await ev(`import('./js/dates.js').then((m) => m.todayISO())`);
await ev(`import('./js/store.js').then(async (m) => {
  await m.saveProfile({ name: 'Sam', units: 'kg' });
  await m.saveSettings({ measureSites: ['chest', 'calf', 'bodyFat'] });
  await m.saveBodyEntry({ date: ${JSON.stringify(TODAY)}, weight: 80.5, chest: 101, bodyFat: 18 });
  const s = await m.createSession(${JSON.stringify(TODAY)}, 'Push');
  s.notes = 'saved before the update';
  const { newCardioExercise } = await import('./js/cardio.js');
  s.exercises.push(newCardioExercise('Treadmill', 'cardio-1'));
  await m.saveNow(s);
  localStorage.setItem('appearance', 'dark');
  return true;
})`);
// Someone else's things on the same origin (on github.io every site of the account shares it): never touched.
await ev(`(async () => {
  await (await caches.open('another-site-cache')).put('/another/x', new Response('theirs'));
  await new Promise((ok, no) => { const r = indexedDB.open('another-site-db', 1); r.onupgradeneeded = () => r.result.createObjectStore('s').put('theirs', 'k'); r.onsuccess = () => { r.result.close(); ok(); }; r.onerror = no; });
  localStorage.setItem('another-site-key', 'theirs');
  return true;
})()`);
const rawBefore = JSON.parse(await ev(`import('./js/db.js').then(async (db) => JSON.stringify(await db.readAll()))`));
const before = await ev(`import('./js/store.js').then((m) => JSON.stringify({ body: m.bodyEntries(), sessions: m.allSessions().length, profile: m.state.profile.name, sites: m.state.settings.measureSites }))`);
check(!(await ev(`!!document.getElementById('update-banner')`)), 'no update banner while nothing new is out');

// ---- the server gets a new version ----
// …and this update also changes the data format (11 → 12), so it migrates the stored data on reload.
const SCHEMA_OLD = Number(readFileSync(join(SITE, 'sw.js'), 'utf8').match(/const SCHEMA = (\d+);/)[1]);
const SCHEMA_NEW = SCHEMA_OLD + 1;
for (const [file, from, to] of [['sw.js', `VERSION = '${OLD}'`, `VERSION = '${NEXT}'`], ['js/model.js', `APP_VERSION = '${OLD}'`, `APP_VERSION = '${NEXT}'`],
  ['sw.js', `const SCHEMA = ${SCHEMA_OLD};`, `const SCHEMA = ${SCHEMA_NEW};`], ['js/model.js', `SCHEMA_VERSION = ${SCHEMA_OLD};`, `SCHEMA_VERSION = ${SCHEMA_NEW};`]]) {
  const p = join(SITE, file);
  writeFileSync(p, readFileSync(p, 'utf8').replace(from, to));
}
await go('#/settings');
check((await ev(`document.querySelector('#about .about-version')?.textContent`)) === `Version ${OLD}`, `Settings → About shows the version (${OLD})`);
await ev(`[...document.querySelectorAll('#about button')].find((b) => b.textContent.includes('Check for updates')).click(); true`);
check(await waitFor(`!!document.getElementById('update-banner')`), 'Check for updates finds the new version: the banner appears');
check(await ev(`(()=>{const b=document.getElementById('update-banner'); return b.textContent.includes('Update ready. Tap to refresh') && b.getAttribute('role') === 'status' && !b.closest('#toasts') && ![...document.querySelectorAll('#toasts .toast')].some((t) => /update/i.test(t.textContent) && !/banner/.test(t.textContent))})()`), 'it is a banner (“Update ready. Tap to refresh”), not a toast');
check(await ev(`(()=>{const b=document.getElementById('update-banner').getBoundingClientRect(); const m=document.getElementById('view').getBoundingClientRect(); return b.top >= 0 && b.bottom <= m.top + 1})()`), 'the banner sits above the page content, not over it');
check(await waitFor(`!document.querySelector('#update-banner .update-data').hidden`, 4000) && /Export a backup before updating/.test(await ev(`document.querySelector('#update-banner .update-data').textContent`)) && (await ev(`!!document.querySelector('#update-banner #update-export')`)),
  'this update changes the data format: the banner says to export a backup first, with an Export button');
await ev(`document.querySelector('#update-banner .update-x').click(); true`);
await sleep(200);
check(!(await ev(`!!document.getElementById('update-banner')`)), 'Dismiss hides it');
await ev(`[...document.querySelectorAll('#about button')].find((b) => b.textContent.includes('Check for updates')).click(); true`);
check(await waitFor(`!!document.getElementById('update-banner')`, 5000), 'Check for updates brings it back');

// A workout in progress: on the Day screen, a time typed into the cardio card a moment before tapping Update,
// plus an edit still waiting in the autosave delay.
await ev(`location.hash = ${JSON.stringify(`#/day/${TODAY}`)}; true`);
await sleep(600);
await ev(`(() => { const i = document.querySelector('.cardio-card [data-fkey$=":min"]'); i.focus(); i.value = '33'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await ev(`import('./js/store.js').then((m) => { const s = m.getSession(${JSON.stringify(TODAY)}); s.notes = 'typed just before tapping Update'; m.scheduleSave(s, 60000); return true; })`);
await ev(`document.querySelector('#update-banner .update-go').click(); true`);
await sleep(1000);
check(await waitFor(`document.readyState === 'complete' && !!document.querySelector('main h1')`), 'the app reloads');
await sleep(1200);

// ---- after the update ----
check((await ev('location.hash')) === `#/day/${TODAY}` && (await ev(`document.querySelector('.cardio-card [data-fkey$=":min"]')?.value`)) === '33', 'the reload comes back to the same screen, with the workout in progress as it was');
const rawAfter = JSON.parse(await ev(`import('./js/db.js').then(async (db) => JSON.stringify(await db.readAll()))`));
const snaps = await ev(`import('./js/db.js').then(async (db) => (await db.getSnapshots()).map((x) => [x.fromVersion, x.toVersion, x.data.sessions.length]))`);
check(rawAfter.meta.schemaVersion === SCHEMA_NEW && JSON.stringify(snaps) === JSON.stringify([[SCHEMA_OLD, SCHEMA_NEW, rawBefore.sessions.length]]), `the update's data change took a snapshot first, then migrated (${JSON.stringify(snaps)})`);
const sets = (x) => JSON.stringify(x.sessions.map((q) => [q.date, q.type, q.exercises.map((e) => [e.name, e.sets.length, e.kind ?? null])]));
check(sets(rawAfter) === sets(rawBefore) && JSON.stringify(rawAfter.body) === JSON.stringify(rawBefore.body) && JSON.stringify(rawAfter.meta.sessionTypes) === JSON.stringify(rawBefore.meta.sessionTypes),
  'workouts, Body log and types are all still there after the migration');
check(await ev(`(async () => (await caches.keys()).includes('another-site-cache') && (await (await (await caches.open('another-site-cache')).match('/another/x')).text()) === 'theirs')()`), 'another site’s cache on the same origin is untouched');
check(await ev(`new Promise((ok) => { const r = indexedDB.open('another-site-db'); r.onsuccess = () => { const g = r.result.transaction('s').objectStore('s').get('k'); g.onsuccess = () => { r.result.close(); ok(g.result === 'theirs'); }; }; r.onerror = () => ok(false); })`), 'another IndexedDB database on the same origin is untouched');
check((await ev(`localStorage.getItem('another-site-key')`)) === 'theirs', 'localStorage is untouched');
await go('#/settings');
check((await ev(`document.querySelector('#about .about-version')?.textContent`)) === `Version ${NEXT}`, `now running ${NEXT}`);
check(await ev(`caches.keys().then((k) => k.includes('workout-tracker-${NEXT}') && !k.includes('workout-tracker-${OLD}'))`), `only this app's old file cache is gone, the new one in place (${(await ev('caches.keys()')).join(', ')})`);
check(!(await ev(`!!document.getElementById('update-banner')`)), 'no banner after updating');
const after = await ev(`import('./js/store.js').then((m) => JSON.stringify({ body: m.bodyEntries(), sessions: m.allSessions().length, profile: m.state.profile.name, sites: m.state.settings.measureSites }))`);
check(after === before, 'every stored record survived: Body log, workouts, profile and settings');
check((await ev(`import('./js/store.js').then((m) => m.getSession(${JSON.stringify(TODAY)}).notes)`)) === 'typed just before tapping Update', 'an edit still in the autosave delay was saved before the reload');
check((await ev(`localStorage.getItem('appearance')`)) === 'dark', 'the on-device appearance choice survived');
check(errors.length === 0, `no script errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);

console.log(`\n${failures ? `${failures} FAILED` : 'ALL PASSED'}  (${OLD} → ${NEXT} at ${BASE})`);
finish(failures ? 1 : 0);
