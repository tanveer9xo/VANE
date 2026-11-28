// Install button, every state, in light and dark at 320/360/412 px, on the built site under /VANE/:
//   prompt  (Android/Chromium: beforeinstallprompt) → "Install VANE" in Settings → App and a one-time Calendar card
//   ios     (iPhone Safari: no prompt exists)      → "Add to your home screen" + a sheet with the steps
//   other   (an iOS browser that can't install)     → nothing offered
//   installed (standalone, or after appinstalled)   → a quiet "Installed" in Settings, no card
// Dismissing the Calendar card is remembered. The CSP stays strict (no violations).
//   node tests/browser/install.mjs      (npm run test:install)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite } from '../../tools/build-site.mjs';

const PROJECT = fileURLToPath(new URL('../..', import.meta.url));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CDP = 9340;
const HTTP = 8770;
const BASE = `http://127.0.0.1:${HTTP}/VANE/`;
const WORK = mkdtempSync(join(tmpdir(), 'vane-install-'));
const SHOTS = process.env.SHOTS ?? join(PROJECT, 'docs', 'screenshots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
const UA = {
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  iosSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  iosChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',
};

buildSite(join(WORK, 'www', 'VANE'));
const server = spawn('python3', ['-m', 'http.server', String(HTTP), '--bind', '127.0.0.1'], { cwd: join(WORK, 'www'), stdio: 'ignore' });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${join(WORK, 'profile')}`,
  '--no-first-run', '--no-default-browser-check', ...(process.env.CI ? ['--no-sandbox'] : []), 'about:blank'], { stdio: 'ignore' });

let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };
const finish = (code) => {
  try { chrome.kill(); } catch { /* */ }
  try { server.kill(); } catch { /* */ }
  setTimeout(() => { try { rmSync(WORK, { recursive: true, force: true }); } catch { /* */ } process.exit(code); }, 300);
};
process.on('unhandledRejection', (e) => { console.error('ERROR', e); finish(2); });
process.on('uncaughtException', (e) => { console.error('ERROR', e); finish(2); });
setTimeout(() => { console.error('ERROR timed out after 20 minutes'); finish(3); }, 20 * 60000).unref();

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
  else if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; errors.push(`${d.exception?.description ?? d.text} @${d.url ?? ''}:${d.lineNumber}:${d.columnNumber}`); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(J({ id, method, params })); });
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const go = async (hash) => { await ev(`location.hash = ${J(hash)}; true`); await sleep(300); };
const text = (sel) => ev(`document.querySelector(${J(sel)})?.textContent ?? ''`);
const exists = (sel) => ev(`!!document.querySelector(${J(sel)})`);
const noOverflow = () => ev(`document.documentElement.scrollWidth <= innerWidth && ![...document.querySelectorAll('main *, dialog[open] *')].some(e => { const r = e.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1); })`);
async function shot(theme, name) {
  mkdirSync(join(SHOTS, theme), { recursive: true });
  for (let i = 0; i < 30 && (await ev(`[...document.querySelectorAll('#toasts .toast')].some(t => !t.hidden && t.getClientRects().length)`)); i++) await sleep(200);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SHOTS, theme, `${name}.png`), Buffer.from(r.data, 'base64'));
}

/** A fresh visit as a given browser: user agent, theme, width, standalone or not. */
async function visit({ ua, theme, width, standalone = false, iosStandalone = false, prompt = false, keepDismissal = false }) {
  await send('Emulation.setUserAgentOverride', { userAgent: ua, platform: ua.includes('iPhone') ? 'iPhone' : 'Linux armv8l' });
  await send('Emulation.setDeviceMetricsOverride', { width, height: 780, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
  if (!keepDismissal) await ev(`(() => { try { localStorage.removeItem('installBannerDismissed'); } catch {} return true; })()`).catch(() => {});
  const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective));
    ${iosStandalone ? "Object.defineProperty(navigator, 'standalone', { get: () => true });" : ''}
    ${prompt ? '' : "window.addEventListener('beforeinstallprompt', (e) => e.stopImmediatePropagation(), true); // this browser has no install prompt"}
    ${standalone ? "const mm = window.matchMedia.bind(window); window.matchMedia = (q) => (/display-mode:\\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : mm(q)); // opened from the home screen" : ''}` });
  await send('Page.navigate', { url: BASE });
  await ev(`new Promise((ok) => { const t = setInterval(() => { if (document.querySelector('main h1')) { clearInterval(t); ok(true); } }, 50); setTimeout(() => ok(false), 4000); })`).catch(() => {});
  await sleep(250);
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  for (let i = 0; i < 5 && (await exists('.ob-skip')); i++) { await ev(`document.querySelector('.ob-skip').click(); true`); await sleep(350); }
  if (prompt) {
    // What Chrome does when the app is installable: fire beforeinstallprompt (the app keeps it for its button).
    await ev(`(() => { const e = new Event('beforeinstallprompt', { cancelable: true }); e.prompt = () => { window.__prompted = (window.__prompted ?? 0) + 1; return Promise.resolve(); };
      e.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' }); window.dispatchEvent(e); return true; })()`);
    await sleep(400);
  }
}

await send('Page.enable');
await send('Runtime.enable');
for (const theme of ['light', 'dark']) {
  for (const width of [320, 360, 412]) {
    const tag = `${theme} ${width} px`;
    const sfx = width === 360 ? '' : `-${width}`;

    // ---- Android/Chromium: the install prompt ----
    await visit({ ua: UA.android, theme, width, prompt: true });
    await go('#/');
    if (process.env.DEBUG) console.log('  debug:', await ev(`import('./js/pwa.js').then(m => JSON.stringify({ st: m.installState(), prompt: !!m.install.prompt, sa: m.isStandalone(), dm: matchMedia('(display-mode: standalone)').matches, hash: location.hash, banners: [...document.querySelectorAll('.banner')].map(b => b.getAttribute('aria-label')) }))`), J(errors));
    await go('#/');
    check((await exists('#install-card #install-btn')) && /Install VANE/.test(await text('#install-card #install-btn')), `${tag} Android: “Install VANE” card on the Calendar`);
    check(await noOverflow(), `${tag} Android Calendar: nothing spills sideways`);
    await shot(theme, `53-install-card${sfx}`);
    await go('#/settings');
    const appBeforeAbout = await ev(`(() => { const a = document.getElementById('app'), b = document.getElementById('about'); return !!a && !!b && a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING; })()`);
    check(appBeforeAbout && /Install VANE/.test(await text('#app #install-btn')), `${tag} Settings → App (above About): “Install VANE”`);
    await ev(`document.querySelector('#app').scrollIntoView({ block: 'center' }); true`);
    await sleep(150);
    check(await noOverflow(), `${tag} Settings: nothing spills sideways`);
    await shot(theme, `54-install-settings${sfx}`);
    await ev(`document.querySelector('#app #install-btn').click(); true`);
    await sleep(300);
    check((await ev('window.__prompted')) === 1, `${tag} the button calls prompt()`);
    // Installed: the browser says so.
    await ev(`window.dispatchEvent(new Event('appinstalled')); true`);
    await sleep(600);
    check(!(await exists('#install-btn')) && /Installed/.test(await text('#installed')), `${tag} after appinstalled: a quiet “Installed”, no button`);
    await go('#/');
    check(!(await exists('#install-card')), `${tag} after appinstalled: no Calendar card`);

    // ---- iPhone Safari: no prompt exists, so the steps ----
    await visit({ ua: UA.iosSafari, theme, width });
    await go('#/');
    if (process.env.DEBUG) console.log('  ios debug:', await ev(`import('./js/pwa.js').then(m => JSON.stringify({ st: m.installState(), ua: navigator.userAgent.slice(0, 60), ios: m.isIOS(), saf: m.isIOSSafari(), sa: m.isStandalone(), inst: m.install.installed }))`));
    check(/Add to your home screen/.test(await text('#install-card #install-btn')), `${tag} iPhone Safari: “Add to your home screen” card`);
    await go('#/settings');
    check(/Add to your home screen/.test(await text('#app #install-btn')), `${tag} iPhone Safari: Settings → App button`);
    await ev(`document.querySelector('#app #install-btn').click(); true`);
    await sleep(400);
    const steps = await ev(`[...document.querySelectorAll('dialog[open] .steps li')].map(li => li.textContent.trim())`);
    check(steps.length === 3 && /Share/.test(steps[0]) && /Add to Home Screen/.test(steps[1]) && /Add/.test(steps[2]) && /only works in Safari/.test(await text('dialog[open] .ios-steps')),
      `${tag} the sheet: Share, Add to Home Screen, Add, and the Safari note`);
    check(await noOverflow(), `${tag} the steps sheet fits`);
    await shot(theme, `55-install-ios-sheet${sfx}`);
    await ev(`document.querySelector('dialog[open] .sheet-head .btn').click(); true`);
    await sleep(200);

    // ---- an iOS browser that can't add to the home screen: nothing offered ----
    await visit({ ua: UA.iosChrome, theme, width });
    await go('#/');
    check(!(await exists('#install-card')), `${tag} Chrome on iPhone: no card (it can’t install)`);
    await go('#/settings');
    check(!(await exists('#app')), `${tag} Chrome on iPhone: no App card`);

    // ---- already installed: running standalone ----
    await visit({ ua: UA.android, theme, width, standalone: true, prompt: false });
    await go('#/');
    check(!(await exists('#install-card')), `${tag} standalone: no Calendar card`);
    await go('#/settings');
    check(/Installed/.test(await text('#installed')) && !(await exists('#install-btn')), `${tag} standalone: Settings shows a quiet “Installed”`);
    await ev(`document.querySelector('#app').scrollIntoView({ block: 'center' }); true`);
    await sleep(150);
    await shot(theme, `56-install-installed${sfx}`);
    await visit({ ua: UA.iosSafari, theme, width, iosStandalone: true });
    await go('#/settings');
    check(/Installed/.test(await text('#installed')), `${tag} iPhone home-screen app (navigator.standalone): “Installed”`);
    check(J(await ev('window.__csp')) === '[]', `${tag} no CSP violations`);
  }
}

// ---- never nag: a dismissed card stays dismissed ----
await visit({ ua: UA.android, theme: 'light', width: 360, prompt: true });
await go('#/');
await ev(`document.querySelector('#install-card .icon-btn').click(); true`);
await sleep(300);
await visit({ ua: UA.android, theme: 'light', width: 360, prompt: true, keepDismissal: true });
await go('#/');
check(!(await exists('#install-card')), 'a dismissed Calendar card stays dismissed after a reload');
await go('#/settings');
check(await exists('#app #install-btn'), '…while Settings → App still offers the button');
check(errors.length === 0, `no script errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);

console.log(`\n${failures ? `${failures} FAILED` : 'ALL PASSED'}  (${BASE})`);
finish(failures ? 1 : 0);
