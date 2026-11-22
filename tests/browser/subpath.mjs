// GitHub Pages check: the deployable site (tools/build-site.mjs) served under a sub-path, /VANE/, the way
// https://<user>.github.io/VANE/ serves it. Headless Chrome over the DevTools protocol, no dependencies.
//   node tests/browser/subpath.mjs      (npm run test:subpath)    CHROME=/path/to/chrome to override
// Checks: nothing loads from outside /VANE/, the service worker registers with scope /VANE/ and precaches
// every asset there, the manifest resolves under /VANE/ and passes Chrome's install criteria, and the app
// (fonts, icons and the exercise library included) works offline after the first visit.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite } from '../../tools/build-site.mjs';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CDP = 9337;
const HTTP = 8767;
const BASE = `http://127.0.0.1:${HTTP}/VANE/`;
const WORK = mkdtempSync(join(tmpdir(), 'vane-subpath-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { assets } = buildSite(join(WORK, 'www', 'VANE'));
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
const requests = [];
const failed = [];
const errors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result); }
  else if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
  else if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) failed.push(`${m.params.response.status} ${m.params.response.url}`);
  else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });

// ---- first visit under /VANE/ ----
await send('Page.navigate', { url: BASE });
await sleep(2500);
check((await ev('location.pathname')) === '/VANE/' && !!(await ev(`document.querySelector('main h1')?.textContent`)), `the app renders at /VANE/ (“${await ev(`document.querySelector('main h1')?.textContent`)}”)`);
const scope = await ev(`navigator.serviceWorker.ready.then((r) => r.scope)`);
check(scope === BASE, `service worker registered with scope ${scope}`);
await ev(`new Promise((ok) => { const s = navigator.serviceWorker.controller; if (s) ok(true); else navigator.serviceWorker.addEventListener('controllerchange', () => ok(true)); setTimeout(() => ok(false), 5000); })`);
const cached = await ev(`caches.keys().then(async (keys) => { const c = await caches.open(keys.find((k) => k.startsWith('workout-tracker-'))); return { name: keys.join(','), urls: (await c.keys()).map((r) => r.url) }; })`);
const version = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8').match(/VERSION = '([^']+)'/)[1];
check(cached.name.includes(version), `cache is named for this version (${cached.name})`);
check(cached.urls.length === assets.length + 1 && cached.urls.every((u) => u.startsWith(BASE)), `all ${assets.length + 1} precached files are under /VANE/ (${cached.urls.filter((u) => !u.startsWith(BASE)).join(', ') || 'none outside'})`);
check(failed.length === 0, `no failed requests${failed.length ? `: ${failed.slice(0, 3).join(', ')}` : ''}`);
const outside = requests.filter((u) => /^https?:/.test(u) && !u.startsWith(BASE));
check(outside.length === 0, `nothing loads from outside /VANE/${outside.length ? `: ${outside.slice(0, 3).join(', ')}` : ''}`);

// ---- manifest + install criteria (Chrome's own checks) ----
const man = await send('Page.getAppManifest');
check(man.url === `${BASE}manifest.webmanifest` && (man.errors ?? []).length === 0, `manifest at ${man.url}, ${(man.errors ?? []).length} parse errors`);
const data = JSON.parse(man.data);
const abs = (u) => new URL(u, man.url).href;
check(abs(data.start_url) === BASE && abs(data.scope) === BASE && abs(data.id) === BASE, `start_url, scope and id resolve to ${BASE}`);
check(data.icons.every((i) => abs(i.src).startsWith(`${BASE}icons/`)) && data.icons.some((i) => i.sizes === '192x192') && data.icons.some((i) => i.sizes === '512x512'), 'icons resolve under /VANE/icons/ (192 and 512 present)');
const iconOk = await ev(`Promise.all(${JSON.stringify(data.icons.map((i) => i.src))}.map((s) => fetch(s).then((r) => r.ok && r.headers.get('content-type').startsWith('image/')))).then((a) => a.every(Boolean))`);
check(iconOk, 'every manifest icon loads as an image');
const inst = await send('Page.getInstallabilityErrors');
check((inst.installabilityErrors ?? []).length === 0, `Chrome's install criteria pass${(inst.installabilityErrors ?? []).length ? `: ${JSON.stringify(inst.installabilityErrors)}` : ''}`);

// ---- offline ----
await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await send('Page.navigate', { url: `${BASE}#/welcome/1` });
await sleep(2500);
check(!!(await ev(`document.querySelector('.onboard-view h1')?.textContent`)), 'offline: the app opens from the cache');
check(await ev(`document.fonts.ready.then(() => document.fonts.check('700 16px "Plus Jakarta Sans"'))`), 'offline: the font loads');
check(await ev(`fetch('data/exercises.json').then((r) => r.json()).then((l) => l.length > 800)`), 'offline: the exercise library loads');
check(await ev(`fetch('icons/icon-192.png').then((r) => r.ok)`), 'offline: icons load');
// Skip through the first run and use the app offline: plan a day, open it.
for (let i = 0; i < 5; i++) { await ev(`document.querySelector('.ob-skip').click(); true`); await sleep(400); }
check(!!(await ev(`document.querySelector('.cal-grid .cal-day')`)), 'offline: the calendar works after the first run');
await ev(`location.hash = '#/plan'; true`);
await sleep(500);
check((await ev(`document.querySelector('main h1')?.textContent`)) === 'Planner', 'offline: deep links work (#/plan)');
check(errors.length === 0, `no script errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);

console.log(`\n${failures ? `${failures} FAILED` : 'ALL PASSED'}  (served at ${BASE})`);
finish(failures ? 1 : 0);
