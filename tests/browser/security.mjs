// Security in a real browser, on the built site served under /VANE/ like GitHub Pages:
// the CSP blocks inline script and eval and nothing in normal use violates it; a malicious backup imported
// through Settings never runs and shows as text; oversized / deeply nested / wrong files are refused with a
// message and change nothing; crafted deep links fall back to the Calendar.
//   node tests/browser/security.mjs      (npm run test:security)    CHROME=/path/to/chrome to override
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite } from '../../tools/build-site.mjs';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CDP = 9339;
const HTTP = 8769;
const BASE = `http://127.0.0.1:${HTTP}/VANE/`;
const WORK = mkdtempSync(join(tmpdir(), 'vane-security-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;

buildSite(join(WORK, 'www', 'VANE'));
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
setTimeout(() => { console.error('ERROR timed out after 4 minutes'); finish(3); }, 240000).unref();

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
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(J({ id, method, params })); });
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
// Code evaluated by DevTools is exempt from the page's CSP unless asked not to be: test eval the way page code runs.
const evPage = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, allowUnsafeEvalBlockedByCSP: false });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const go = async (hash) => { await ev(`location.hash = ${J(hash)}; true`); await sleep(500); };
const text = (sel) => ev(`document.querySelector(${J(sel)})?.textContent ?? ''`);
const store = (expr) => ev(`import('./js/store.js').then((m) => JSON.parse(JSON.stringify(${expr})))`);
const waitToast = async (re, ms = 20000) => { for (let t = 0; t < ms; t += 250) { const x = await toastText(); if (re.test(x)) return x; await sleep(250); } return await toastText(); };
const clearToasts = () => ev(`import('./js/ui.js').then((m) => { m.clearToasts?.(); document.querySelectorAll('#toasts .toast').forEach((t) => t.remove()); return true; })`);
const toastText = () => ev(`[...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent).join(' | ')`);
async function importFile(name, content, choice = 'replace') {
  const path = join(WORK, name);
  writeFileSync(path, content);
  await go('#/settings');
  const { root } = await send('DOM.getDocument');
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#import-file' });
  await send('DOM.setFileInputFiles', { nodeId, files: [path] });
  await sleep(900);
  if (choice && await ev(`!!document.querySelector('dialog[open] button[value=${choice}]')`)) {
    await ev(`document.querySelector('dialog[open] button[value=${choice}]').click(); true`);
    await sleep(900);
    return true;
  }
  return false;
}

await send('Page.enable');
await send('Runtime.enable');
await send('DOM.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
// Record every CSP violation from the very first script.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + (e.blockedURI || '') + ' ' + (e.sample || '')));` });
await send('Page.navigate', { url: BASE });
await sleep(2500);
for (let i = 0; i < 5; i++) { await ev(`document.querySelector('.ob-skip')?.click(); true`); await sleep(350); }

// ---- CSP ----
check(/default-src 'self'/.test(await ev(`document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? ''`)), 'CSP meta is in force');
for (const h of ['#/', '#/plan', '#/timer', '#/progress', '#/progress/~map', '#/progress/~body', '#/progress/~consistency', '#/settings', '#/settings/profile', '#/settings/nutrition', '#/day/2026-11-20']) await go(h);
check(J(await ev('window.__csp')) === '[]', `normal use breaks no CSP rule (${J(await ev('window.__csp'))})`);
await ev(`(() => { const s = document.createElement('script'); s.textContent = 'window.__inline = 1'; document.body.append(s); return true; })()`);
await sleep(200);
check((await ev('window.__inline')) === undefined, 'an injected inline <script> does not run');
check(await evPage(`(() => { try { eval('1 + 1'); return false; } catch (e) { return e instanceof EvalError; } })()`), 'eval is blocked');
check(await evPage(`(() => { try { new Function('return 1')(); return false; } catch (e) { return e instanceof EvalError; } })()`), 'new Function is blocked');
await ev(`(() => { const s = document.createElement('script'); s.src = 'https://example.com/x.js'; document.body.append(s); return true; })()`);
await sleep(300);
check((await ev('window.__csp')).some((v) => /script-src/.test(v) && /example\.com/.test(v)), 'scripts from other hosts are blocked');
await ev('window.__csp = []; true');

// ---- a malicious backup ----
const XSS_IMG = '<img src=x onerror="window.__xss=1">';
const XSS_SCRIPT = '<script>window.__xss=2</script>';
const XSS_SVG = '"><svg onload="window.__xss=3">';
const evil = `{
  "schemaVersion": 10,
  "sessions": [{ "date": "2026-11-18", "type": "t-evil", "notes": ${J(XSS_SCRIPT)}, "finishedAt": 1,
    "exercises": [{ "name": ${J(XSS_IMG)}, "sets": [{ "weight": 50, "reps": 8, "done": true, "type": "working" }] }] }],
  "sessionTypes": [{ "id": "t-evil", "name": ${J(XSS_SVG)}, "short": "<b>", "color": "red\\" onload=\\"x" }, { "id": "__proto__", "name": "p" },
    { "id": "Push", "name": "Push", "builtin": true }],
  "templates": { "t-evil": [{ "name": ${J(XSS_IMG)}, "sets": 3, "repsMin": 8, "repsMax": 10 }], "__proto__": [{ "name": "x" }] },
  "profile": { "name": ${J(XSS_IMG)}, "goal": "fat", "__proto__": { "polluted": 1 } },
  "settings": { "__proto__": { "polluted": 1 }, "constructor": { "prototype": { "polluted": 1 } } },
  "body": [{ "date": "2026-11-18", "weight": 80, "chest": 100 }],
  "muscles": { "__proto__": "Chest" },
  "splits": [{ "id": "s-x", "name": ${J(XSS_SVG)}, "days": { "mon": "t-evil" }, "types": [{ "id": "t-evil", "name": ${J(XSS_SCRIPT)} }],
    "templates": { "t-evil": [{ "name": ${J(XSS_IMG)} }] } }],
  "nutrition": { "enabled": true, "sex": "<x>", "birthYear": "1990<script>" },
  "intake": { "__proto__": { "kcal": 1 }, "2026-11-18": { "kcal": "<1>", "protein": 100 } }
}`;
check(await importFile('evil.json', evil), 'the malicious backup is accepted (as data) after confirming');
for (const h of ['#/', '#/cal/2026-11', '#/day/2026-11-18', '#/plan', '#/progress', '#/progress/~records', '#/progress/~body', '#/progress/~consistency', '#/settings', '#/settings/profile', '#/settings/nutrition']) await go(h);
await go('#/day/2026-11-18');
check((await ev('window.__xss')) === undefined, 'nothing from the backup ran, on any screen');
check((await text('.ex-name')) === XSS_IMG && (await text('.hero-type')).includes('<svg onload'), 'the script text shows as plain text (exercise name, session type)');
check((await ev(`document.querySelectorAll('main img, main script, main svg[onload], main [onerror], main [onload]').length`)) === 0, 'no element from the backup made it into the page');
await go('#/plan');
check((await text('.my-split-name')).includes('<svg') && (await ev(`!document.querySelector('.my-split [onload]')`)), 'saved split names stay text');
check((await ev('({}).polluted')) === undefined && (await ev('Object.prototype.polluted')) === undefined, 'Object.prototype not polluted');
check((await store('m.state.types.filter(t => t.id === "__proto__").length')) === 0 && (await store('m.state.types.find(t => t.id === "t-evil").color')) === null, 'a "__proto__" type and a bad colour are dropped');
check(J(await ev('window.__csp')) === '[]', `still no CSP violations (${J(await ev('window.__csp'))})`);

// ---- files that are refused, with a message, changing nothing ----
const before = await store('m.allSessions().length');
await importFile('huge.json', `{"schemaVersion":10,"sessions":[],"pad":"${'x'.repeat(21 * 1024 * 1024)}"}`, null);
check(/too big .*limit is 20 MB.*Nothing was imported/.test(await waitToast(/too big/)), `a 21 MB file is refused before it's read (“${(await toastText()).slice(0, 90)}”)`);
await clearToasts();
await importFile('deep.json', `{"schemaVersion":10,"sessions":[],"x":${'['.repeat(50000)}${']'.repeat(50000)}}`, null);
check(/nested too deeply/.test(await waitToast(/nested/)), 'deeply nested JSON is refused');
await clearToasts();
await importFile('many.json', J({ schemaVersion: 10, sessions: Array.from({ length: 20001 }, () => ({ date: '2026-01-01' })) }), null);
check(/at most 20,000/.test(await waitToast(/at most/)), 'too many workouts: refused with a message');
await clearToasts();
await importFile('wrong.json', '{"schemaVersion":10,"sessions":"nope"}', null);
check(/not a workout backup/.test(await waitToast(/not a workout/)), 'wrong types: “not a workout backup”');
await clearToasts();
await importFile('broken.json', '{"sessions": [', null);
check(/isn’t valid JSON/.test(await waitToast(/valid JSON/)), 'broken JSON: a plain message');
check((await store('m.allSessions().length')) === before, 'none of the refused files changed anything');

// ---- crafted deep links ----
for (const h of ['#/day/../../etc', '#/progress/%E0%A4%A', '#/javascript:alert(1)', '#/settings/evil', '#/welcome/9', '#/__proto__', `#/progress/${'x'.repeat(400)}`]) {
  await ev(`location.hash = ${J(h)}; true`);
  await sleep(500);
  check((await ev('location.hash')) === '#/' && !!(await ev(`document.querySelector('.cal-view')`)), `${h.slice(0, 40)} → the Calendar`);
}
await go('#/progress/~body/2026-11-18');
check((await ev(`document.getElementById('body-date')?.value`)) === '2026-11-18', 'a valid deep link still works');

// ---- external links ----
await go('#/settings');
check(await ev(`[...document.querySelectorAll('a[target=_blank]')].every((a) => a.rel.split(' ').includes('noopener') && a.rel.split(' ').includes('noreferrer'))`), 'external links: rel="noopener noreferrer"');
check(errors.length === 0, `no script errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);

console.log(`\n${failures ? `${failures} FAILED` : 'ALL PASSED'}  (${BASE})`);
finish(failures ? 1 : 0);
