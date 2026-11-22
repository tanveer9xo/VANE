// End-to-end check at phone size in headless Chrome via the DevTools protocol (no dependencies).
//   node tests/browser/e2e.mjs light|dark     (npm run test:browser runs both)
//   CHROME=/path/to/chrome to override; SHOTS=dir for screenshots (default docs/screenshots/<theme>).
// The page clock is pinned to Fri 20 Nov 2026, 09:00 local so the plan and history are deterministic.
// The theme comes from the emulated system setting (prefers-color-scheme), i.e. Appearance = System.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = fileURLToPath(new URL('../..', import.meta.url));
const THEME = process.argv[2] === 'dark' ? 'dark' : 'light';
const OUT = process.env.SHOTS ? join(process.env.SHOTS, THEME) : join(PROJECT, 'docs', 'screenshots', THEME);
const WORK = mkdtempSync(join(tmpdir(), 'wt-e2e-')); // browser profile and fixtures
const C = THEME === 'dark'
  ? { page: 'rgb(15, 18, 38)', hmDone: 'rgb(200, 200, 250)', hmExtra: 'rgb(140, 140, 240)' }
  : { page: 'rgb(244, 245, 250)', hmDone: 'rgb(63, 63, 176)', hmExtra: 'rgb(110, 110, 220)' };
const UPPER_BLOCK = 'rgb(30, 122, 87)'; // #1E7A57
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CDP = 9333;
const HTTP = 8765;
const BASE = `http://127.0.0.1:${HTTP}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const server = spawn('python3', ['-m', 'http.server', String(HTTP), '--bind', '127.0.0.1'], { cwd: PROJECT, stdio: 'ignore' });
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${join(WORK, 'profile')}`,
  '--no-first-run', '--no-default-browser-check', '--bypass-app-banner-engagement-checks', 'about:blank',
], { stdio: 'ignore' });

let failures = 0;
let lastCheck = '(none yet)';
const check = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; lastCheck = msg; };
const finish = (code) => {
  try { chrome.kill(); } catch { /* */ }
  try { server.kill(); } catch { /* */ }
  setTimeout(() => { try { rmSync(WORK, { recursive: true, force: true }); } catch { /* */ } process.exit(code); }, 300);
};
process.on('unhandledRejection', (e) => { console.error('ERROR', e); finish(2); });
// Watchdog: a run takes about 3 minutes. If one hangs (a promise that never settles), fail loudly.
setTimeout(() => { console.error(`ERROR timed out after 8 minutes; last check: ${lastCheck}`); finish(3); }, 8 * 60 * 1000).unref();
process.on('uncaughtException', (e) => { console.error('ERROR', e); finish(2); });

async function getJSON(path) {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${CDP}${path}`); if (r.ok) return r.json(); } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('Chrome did not start');
}
const target = (await getJSON('/json/list')).find((t) => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let seq = 0;
const pending = new Map();
const consoleErrors = [];
const externalRequests = []; // the app must never call out: no accounts, no analytics
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id) {
    const p = pending.get(m.id); pending.delete(m.id);
    if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result);
  } else if (m.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  } else if (m.method === 'Network.requestWillBeSent') {
    const u = m.params.request.url;
    if (!u.startsWith(BASE) && !/^(data|blob|chrome|about):/.test(u)) externalRequests.push(u);
  } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const J = JSON.stringify;
// Is a visible toast drawn over any text on the page? (text nodes outside #toasts, by their line boxes)
const TOAST_OVER_TEXT = `(()=>{
  const t = [...document.querySelectorAll('#toasts .toast')].find((x) => !x.hidden && x.getClientRects().length);
  if (!t) return null;
  const tr = t.getBoundingClientRect();
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  // Buttons, links and fields count too, even without text of their own.
  for (const c of document.querySelectorAll('button, a[href], input, select, textarea, [role=button]')) {
    if (c.closest('#toasts') || !c.getClientRects().length || getComputedStyle(c).visibility === 'hidden') continue;
    const q = c.getBoundingClientRect();
    if (q.width > 1 && q.height > 1 && q.left < tr.right && q.right > tr.left && q.top < tr.bottom && q.bottom > tr.top) return '<' + c.tagName.toLowerCase() + '> ' + (c.getAttribute('aria-label') || c.textContent.trim()).slice(0, 30);
  }
  while ((n = walk.nextNode())) {
    const el = n.parentElement;
    if (!n.textContent.trim() || !el || el.closest('#toasts, .sr-only, script, style')) continue;
    const r = document.createRange(); r.selectNodeContents(n);
    for (const q of r.getClientRects()) {
      if (q.width > 1 && q.height > 1 && q.left < tr.right && q.right > tr.left && q.top < tr.bottom && q.bottom > tr.top) return n.textContent.trim().slice(0, 40);
    }
  }
  return '';
})()`;
/** Screenshot, but never with a toast over text: wait for such a toast to leave (they last 2 s), then check. */
const shot = async (name) => {
  for (let i = 0; i < 30 && (await ev(TOAST_OVER_TEXT)); i++) await sleep(100);
  const over = await ev(TOAST_OVER_TEXT);
  check(!over, `${THEME} ${name}: no toast over any text or control${over ? ` (covers "${over}")` : ''}`);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.data, 'base64'));
};
const click = (sel) => ev(`(()=>{const el=document.querySelector(${J(sel)}); if(!el) throw new Error('missing '+${J(sel)}); if (el.click) el.click(); else el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true})()`);
const clickText = (sel, text) => ev(`(()=>{const el=[...document.querySelectorAll(${J(sel)})].find(e=>e.textContent.includes(${J(text)})); if(!el) throw new Error('no '+${J(sel)}+' with '+${J(text)}); el.click(); return true})()`);
const typeInto = async (sel, text) => {
  await ev(`(()=>{const el=document.querySelector(${J(sel)}); el.focus(); el.select?.(); return true})()`);
  await send('Input.insertText', { text });
};
const setValue = (sel, value) => ev(`(()=>{const el=document.querySelector(${J(sel)}); el.value=${J(value)}; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true})()`);
const pressEnter = async () => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
};
const go = async (hash) => { await ev(`location.hash=${J(hash)}`); await sleep(400); };
const text = (sel) => ev(`document.querySelector(${J(sel)})?.textContent ?? null`);
const exists = (sel) => ev(`!!document.querySelector(${J(sel)})`);
const visible = (sel) => ev(`(()=>{const el=document.querySelector(${J(sel)}); return !!el && getComputedStyle(el).display!=='none' && el.getClientRects().length>0})()`);
const store = (expr) => ev(`import('./js/store.js').then(m => JSON.parse(JSON.stringify(${expr})))`);
const sessionOf = (date) => store(`m.getSession(${J(date)})`);
/** Toasts are queued one at a time, so wait (up to ~5 s) for one whose text matches. */
async function waitToast(re, ms = 5000) {
  for (let t = 0; t < ms; t += 150) {
    if (await ev(`[...document.querySelectorAll('#toasts .toast')].some(t => !t.hidden && ${re}.test(t.textContent))`)) return true;
    await sleep(150);
  }
  return false;
}

// Pin the clock: same offset on every load, so time keeps moving (timers work) from Fri 20 Nov 09:00.
const OFFSET = new Date(2026, 10, 20, 9, 0, 0).getTime() - Date.now();
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => { const R = Date; const off = ${OFFSET};
    class D extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + off); } static now() { return R.now() + off; } }
    globalThis.Date = D; })();`,
});
await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('DOM.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: THEME }] });
console.log(`Theme: ${THEME} (system setting)`);
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Emulation.setUserAgentOverride', {
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
});
await send('Page.navigate', { url: BASE });
await sleep(2200);
const TODAY = await ev(`import('./js/dates.js').then(m => m.todayISO())`);
check(TODAY === '2026-11-20', `clock pinned to Fri 20 Nov (${TODAY})`);
await ev(`window.__vib = []; navigator.vibrate = (p) => { window.__vib.push(p); return true; }; true`);

// ---------------- first run: onboarding, the skip-everything path ----------------
const obState = () => ev(`(()=>{const v=document.querySelector('.onboard-view'); return v ? { step: v.dataset.step, h1: document.querySelector('main h1')?.textContent, dots: document.querySelector('.ob-dots')?.getAttribute('aria-label'), back: !!document.querySelector('.ob-back'), skip: !!document.querySelector('.ob-skip'), nav: getComputedStyle(document.querySelector('.tabbar')).display } : null})()`);
check((await ev('location.hash')) === '#/welcome/1', 'fresh install opens the first-run flow');
{
  const o = await obState();
  check(o?.step === '1' && o.dots === 'Step 1 of 5' && o.back && o.skip && o.nav === 'none', `welcome: progress dots, Back and Skip, no tab bar (${J(o)})`);
  check(await ev(`document.querySelector('.ob-brand .wordmark')?.textContent === 'VANE' && document.querySelector('label[for=ob-name]').textContent === 'What should we call you?'`), 'welcome: VANE wordmark and “What should we call you?”');
  check(await ev(`/Stays on this phone/.test(document.querySelector('.ob-private').textContent)`), 'privacy line: “Stays on this phone”');
  check(await ev(`document.activeElement === document.querySelector('main h1')`), 'focus starts on the screen heading (screen readers)');
}
await go('#/plan');
check((await ev('location.hash')) === '#/welcome/1', 'other screens wait until the flow is finished or skipped');
const SKIP_TITLES = ['Welcome', 'Units and goal', 'How long have you been lifting?', 'How do you split your week?', 'A starting point'];
for (let i = 1; i <= 5; i++) {
  const o = await obState();
  check(o?.step === String(i) && o.h1 === SKIP_TITLES[i - 1] && o.back && o.skip && o.dots === `Step ${i} of 5`, `skip path, screen ${i}: “${o?.h1}” with Back, Skip and dots`);
  await click('.ob-skip');
  await sleep(450);
}
check((await ev('location.hash')) === '#/' && (await exists('.cal-view')), 'skipping every screen lands on the Calendar');
{
  const p = await store('m.state.profile');
  const st = await store('m.state.settings');
  check(p.onboarding === 'done' && p.units === 'kg' && p.goal === null && p.experience === null && p.split === null && p.name === '', `skip everything: profile stays blank, kg (${J(p)})`);
  check(st.defaultRestSeconds === 90 && st.weightStep === 2.5 && st.weeklyMin === null, 'skip everything: settings unchanged (90 s rest, 2.5 kg step, plan-based good week)');
  check((await store('m.bodyEntries()')).length === 0, 'skip everything: no body entry');
  await go('#/settings');
  check((await text('#profile .row-text strong')) === 'Set up your profile', `empty profile: the Settings card says “Set up your profile” (“${await text('#profile .row-text strong')}”)`);
  await go('#/');
  check(J((await store('m.state.schedule')).at(-1).days) === J({ mon: 'Push', tue: 'Pull', wed: 'Legs', thu: 'Break', fri: 'Upper', sat: 'Lower', sun: 'Break' }), 'skip everything: the default weekly plan');
}

// ---------------- navigation ----------------
check(J(await ev(`[...document.querySelectorAll('.tabbar a')].map(a => a.querySelector('.tab-label').textContent)`))
  === J(['Calendar', 'Planner', 'Timer', 'Progress', 'Settings']), 'bottom nav: Calendar, Planner, Timer, Progress, Settings');
check(await ev(`[...document.querySelectorAll('.tabbar a')].every(a => a.querySelector('.tab-pill svg path'))`), 'every nav item has an icon');
check(await ev(`document.fonts.ready.then(() => document.fonts.check('700 16px "Plus Jakarta Sans"') && getComputedStyle(document.body).fontFamily.startsWith('"Plus Jakarta Sans"'))`), 'Plus Jakarta Sans loaded (self-hosted)');
check((await ev(`document.documentElement.dataset.theme`)) === THEME, `system appearance gives the ${THEME} theme`);
check(await ev(`getComputedStyle(document.body).backgroundColor === ${J(C.page)}`), `${THEME} page colour`);
check(await ev(`[...document.querySelectorAll('meta[name=theme-color]')].some(m => m.media.includes(${J(THEME)}) && m.content === (${J(THEME)} === 'dark' ? '#0F1226' : '#F4F5FA'))`), 'theme-color follows the system theme');
await go('#/body');
check((await ev('location.hash')) === '#/progress/~body' && (await exists('.body-form')), '#/body redirects to Progress → Body');
check((await ev(`document.querySelector('.tabbar a[aria-current=page]').dataset.tab`)) === 'progress', 'Progress tab is current for Body');

// ---------------- import a v3 backup (plan from Nov 1, history) ----------------
const W = (weight, reps, extra = {}) => ({ weight, reps, done: true, type: 'working', ...extra });
const backupPath = join(WORK, 'v3.json');
writeFileSync(backupPath, J({
  app: 'workout-tracker', schemaVersion: 3, exportedAt: '2026-11-12T10:00:00Z',
  schedule: [{ from: '2026-11-01', days: { mon: 'Push', tue: 'Pull', wed: 'Legs', thu: 'Break', fri: 'Upper', sat: 'Lower', sun: 'Break' } }],
  sessions: [
    // Consistency seed. Plan: Mon Push, Tue Pull, Wed Legs, Thu Break, Fri Upper, Sat Lower, Sun Break.
    // Week of 2 Nov: Mon, Tue and Fri on the day; Wed's Legs done Thu 5th (a Break day) = moved; Sat skipped → 4 of 5.
    // Week of 9 Nov: all five on the day, plus Sun 15th unplanned = extra → 5 of 5, 1 extra.
    ...[['2026-11-02', 'Push'], ['2026-11-03', 'Pull'], ['2026-11-05', 'Legs'], ['2026-11-09', 'Push'], ['2026-11-10', 'Pull'],
      ['2026-11-11', 'Legs'], ['2026-11-14', 'Lower'], ['2026-11-15', 'Full body']].map(([date, type]) => (
      { v: 3, date, type, notes: '', exercises: [{ name: 'Cable Crunch', sets: [W(20, 10)] }] })),
    { v: 3, date: '2026-11-06', type: 'Upper', notes: '', exercises: [{ name: 'DB Chest Press', sets: [W(27.5, 8), W(27.5, 8)] }] },
    { v: 3, date: '2026-11-13', type: 'Upper', notes: '', exercises: [
      { name: 'DB Chest Press', sets: [W(30, 8), W(30, 8), W(30, 8)] },
      { name: 'Barbell Row', sets: [W(40, 8), W(40, 8), W(40, 8)] },
    ] },
    { v: 3, date: '2026-11-16', type: 'Push', notes: '', exercises: [{ name: 'DB Chest Press', sets: [W(32.5, 8), W(32.5, 7)] }] },
    { v: 3, date: '2026-11-18', type: 'Legs', notes: '', exercises: [{ name: 'Squat', sets: [W(100, 5), W(100, 5)] }] },
  ],
  body: [{ date: '2026-11-13', weight: 81.2 }, { date: '2026-11-18', weight: 80.6 }],
}));
await go('#/settings');
{
  const { root } = await send('DOM.getDocument');
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#import-file' });
  await send('DOM.setFileInputFiles', { nodeId, files: [backupPath] });
}
await sleep(600);
await click('dialog[open] button[value=replace]');
await sleep(600);
const migrated = await sessionOf('2026-11-13');
check(migrated?.v === 7 && migrated.exercises[0].note === '' && migrated.finishedAt === null, 'v3 backup imported and migrated to v7');
check(!(await exists('#timer-sound')) && !(await ev(`[...document.querySelectorAll('button')].some(b => /Test the timer/.test(b.textContent))`)), 'Settings has no timer sound toggle or timer test');
check(await ev(`[...document.querySelectorAll('.settings-view h2')].map(h => h.textContent).join('|')`) === 'Profile|Appearance|Stats|Backup|Preferences|Weekly sets per muscle|About|Erase', 'Settings sections incl. Profile and weekly muscle targets and About');
check(await ev(`[...document.querySelectorAll('#backup button')].some(b => b.textContent.includes('CSV'))`), 'CSV export next to the JSON backup');

// ---------------- calendar: plates ----------------
await go('#/');
const plateOf = (d) => ev(`(()=>{const a=document.querySelector('.cal-day[href="#/day/${d}"]'); const p=a?.querySelector('.plate'); return p ? [...p.classList].filter(c=>/^(p|t)-/.test(c)).join(' ') + '|' + (a.querySelector('.plate-label')?.textContent ?? '') : null})()`);
check((await plateOf('2026-11-16')) === 'p-done t-red|Push', `done = solid Push plate (${await plateOf('2026-11-16')})`);
check((await plateOf('2026-11-17')) === 'p-missed t-blue|Pull', `missed = faded Pull ring (${await plateOf('2026-11-17')})`);
check((await plateOf('2026-11-19')) === 'p-break t-break|Break', `break = neutral dash (${await plateOf('2026-11-19')})`);
check((await plateOf('2026-11-21')) === 'p-planned t-violet|Lower', `planned = Lower ring (${await plateOf('2026-11-21')})`);
check(await ev(`!!document.querySelector('.cal-day[href="#/day/2026-11-18"] .cal-body')`), 'weigh-in marker on the calendar');
check(await ev(`getComputedStyle(document.querySelector('.cal-day[href="#/day/2026-11-16"] .plate')).color === 'rgb(224, 88, 78)'`), 'Push plate uses the Push plate colour');
check((await text('.today-actions .btn.block')).trim() === 'Start today’s Upper', `CTA: "${(await text('.today-actions .btn.block')).trim()}"`);
check(await ev(`!!document.querySelector('.wd.today') && document.querySelector('.wd.today').tagName === 'A'`), 'week strip day is a link; today has a ring');
check(await ev(`!document.querySelector('.legend-d').open`) && (await exists('.legend-d summary')), 'legend collapsed behind “Key”');
check(await ev(`[...document.querySelectorAll('.month-stats dt')].map(d=>d.textContent).join('|')`) === 'Workouts|Consistency|Streak', 'month summary: workouts, consistency, streak');
check((await ev(`document.querySelectorAll('.month-stats dd')[2].firstChild.textContent`)) === '1', 'streak: Wed done, Thu break skipped, Tue missed ends it → 1');
check((await ev(`document.querySelectorAll('.month-stats dd')[1].firstChild.textContent`)) === '90%'
  && (await ev(`document.querySelectorAll('.month-stats dd')[1].querySelector('small').textContent`)) === '9 of 10 planned', 'month consistency uses the shared definitions (9 of 10 = 90%)');
check(await exists('.banner a[href="#/settings/backup"]'), 'backup nudge links to Settings → Backup');
check(!(await ev(`[...document.querySelectorAll('#toasts .toast')].some(t => /Imported/.test(t.textContent))`)), 'no stale "Imported" toast after leaving Settings');
check(await exists('.today-actions a[href="#/progress/~body/2026-11-20"]'), 'quick “Log weigh-in” action');
check(await exists('.review-card .review'), 'weekly review card');
// ---------------- VANE brand row (Calendar only) ----------------
check(await ev(`(()=>{const b=document.querySelector('.cal-view > .brand-row'); return !!b && b.nextElementSibling?.classList.contains('cal-top') && b.textContent.trim()==='VANE' && !b.querySelector('.brand-mark, svg')})()`), 'Calendar: brand row is the VANE wordmark alone, above the month title');
check(await ev(`(()=>{const w=getComputedStyle(document.querySelector('.brand-row .wordmark')); const a=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(); const probe=document.createElement('i'); probe.style.color=a; document.body.append(probe); const ac=getComputedStyle(probe).color; probe.remove(); return w.color===ac && w.fontWeight==='700' && w.fontFamily.startsWith('"Plus Jakarta Sans"')})()`), 'wordmark: indigo accent, Plus Jakarta Sans 700');
check((await text('.cal-top h1')) === 'November 2026' && (await text('.cal-summary')) === '9 of 10 planned done', 'month title and "9 of 10 planned done" unchanged');
check(await ev(`(()=>{const b=document.querySelector('.brand-row'); const p=getComputedStyle(b).position; return p==='static' && !b.querySelector('h1')})()`), 'brand row is not sticky and not a heading (the month stays the h1)');
await shot('01-calendar');

// ---------------- upgrade from v5 with workouts: no flow, a one-time "Set up your profile" card ----------------
await ev(`import('./js/db.js').then(async (db) => {
  const t = await db.getMeta('templates');
  t.Push[0].weightStep = 2.5; t.Push[4].weightStep = 1; // a v5 default step, and one you chose
  await db.setMeta('templates', t);
  await db.run('meta', 'readwrite', (tx) => tx.objectStore('meta').delete('profile')); // v5 had no profile
  return true;
})`);
const sessionsBefore = await store('m.allSessions().length');
await send('Page.reload', {});
await sleep(1800);
check((await ev('location.hash')) === '#/' && !(await exists('.onboard-view')), 'v5 data with workouts: no first-run flow');
check(await ev(`(()=>{const b=document.querySelector('.banner[aria-label="Set up your profile"]'); return !!b && /Set up your profile/.test(b.textContent) && !!b.querySelector('a[href="#/settings/profile"]') && !!b.querySelector('button[aria-label^="Dismiss"]')})()`), 'one-time “Set up your profile” card with Set up and Dismiss');
check((await store('m.state.profile.onboarding')) === 'existing' && (await store('m.allSessions().length')) === sessionsBefore, 'migration keeps every session; profile marked existing');
{
  const t = await store('m.state.templates.Push');
  check(t[0].weightStep === null && t[4].weightStep === 1, 'v5 → v6: default template steps follow the setting, a chosen step stays');
}
await shot('30-profile-card');
await click('.banner[aria-label="Set up your profile"] button[aria-label^="Dismiss"]');
await sleep(300);
await send('Page.reload', {});
await sleep(1800);
check(!(await exists('.banner[aria-label="Set up your profile"]')) && (await store('m.state.profile.setupCardDismissed')) === true, 'dismissed card stays gone after a reload');
await ev(`window.__vib = []; navigator.vibrate = (p) => { window.__vib.push(p); return true; }; true`); // the reloads dropped the stub
await ev(`import('./js/store.js').then(async (m) => { const t = structuredClone(m.state.templates); t.Push[4].weightStep = null; await m.saveTemplates(t); await m.saveProfile({ onboarding: 'done' }); return true; })`);

// ---------------- day: states, tick rules, collapse ----------------
await go(`#/day/${TODAY}`);
check(await ev(`document.querySelector('.day-hero').classList.contains('t-green') && getComputedStyle(document.querySelector('.day-hero')).backgroundColor === ${J(UPPER_BLOCK)}`), 'header block in the Upper colour (#1E7A57)');
check((await text('.day-hero .hero-type')).includes('Upper'), 'Upper planned today');
check(await exists('.day-hero .hero-count') && (await exists('.day-hero .hero-bar')), 'header: big sets count and progress bar');
check(await ev(`[...document.querySelectorAll('.ex')].every(e => e.querySelector('.ex-tile svg path'))`), 'every exercise card has an icon tile');
check(await exists('.add-row') && !(await exists('.fab')), 'inline Add exercise row, no floating button');
const exNames = () => ev(`[...document.querySelectorAll('.ex .ex-name')].map(e=>e.textContent)`);
check((await exNames())[0] === 'DB Chest Press' && (await exNames())[1] === 'Barbell Row', 'Upper template loaded');
check((await text('.ex[data-exid] .last-time')).includes('32.5 × 8, 32.5 × 7'), `last time spaced: "${await text('.ex .last-time')}"`);
check((await ev(`document.querySelector('.ex:nth-child(2) .hint-text span')?.textContent`)) === 'Last time: 8, 8, 8 reps.', `hint reason lists last time's reps ("${await ev(`document.querySelector('.ex:nth-child(2) .hint-text span')?.textContent`)}")`);
check((await text('.ex:nth-child(2) .last-time')) === 'Last 40 × 8, 40 × 8, 40 × 8', `"Last" row shows every set (${await text('.ex:nth-child(2) .last-time')})`);
const rowBg = (sel) => ev(`getComputedStyle(document.querySelector(${J(sel)})).backgroundColor`);
const tickBg = (sel) => ev(`getComputedStyle(document.querySelector(${J(sel)}).querySelector('.tick-ic')).backgroundColor`);
// Third exercise has no history → empty weight: can't be ticked.
const third = '.ex:nth-child(3) .set-row:nth-child(1)';
check((await ev(`document.querySelector('${third} input').value`)) === '', 'first-time exercise: weight left empty');
await click(`${third} .tick`);
await sleep(150);
check((await ev(`document.querySelector('${third} .tick').getAttribute('aria-pressed')`)) === 'false', 'empty set cannot be ticked');
check(await ev(`document.querySelector('${third}').classList.contains('shake')`), 'shake on a blocked tick');
check(await waitToast(/needs a weight/), 'toast says what is missing');
check((await sessionOf(TODAY)) === null, 'a blocked tick saves nothing');
// Tick the first set of the second exercise (Barbell Row 40×8 from last time).
const row1 = '.ex:nth-child(2) .set-row:nth-child(1)';
const row2 = '.ex:nth-child(2) .set-row:nth-child(2)';
const undoneBg = await rowBg(row2);
const undoneTick = await tickBg(row2);
await click(`${row1} .tick`);
await sleep(300);
check((await ev(`document.querySelector('${row1} .tick').getAttribute('aria-pressed')`)) === 'true', 'set ticked');
check((await rowBg(row1)) !== undoneBg, `done row is tinted (${await rowBg(row1)} vs ${undoneBg})`);
check((await tickBg(row1)) === UPPER_BLOCK && undoneTick !== UPPER_BLOCK, `done tick is filled in the session colour, open tick is an outline (${undoneTick})`);
check(!(await exists('.ex:nth-child(2) .hint')), 'hint hidden once a set is ticked');
check(J(await ev('window.__vib')).includes('12'), 'light haptic on tick');
const s1 = await sessionOf(TODAY);
check(s1?.startedAt > 0 && s1.exercises[1].sets[0].done === true, 'first tick saves the day and starts the clock');
check((await text('.hero-count')).startsWith('1 of '), `header count: "${await text('.hero-count')}"`);
check(await ev(`parseFloat(document.querySelector('.hero-fill').style.width) > 0`), 'progress bar fills');
check(await visible('.rest-bar'), 'rest bar appears after a tick');
check(await ev(`document.querySelector('.tabbar a[data-tab=timer]').classList.contains('running')`), 'Timer tab badge while running');
check((await text('.ex:nth-child(2) .ex-count')).startsWith('1/3'), 'exercise header shows 1/3 sets');
check(!(await ev(`[...document.querySelectorAll('#toasts .toast')].some(t => /finished/.test(t.textContent))`)), 'ticking a set (not the last) never says the workout is finished');
await shot('02-day-ticked');

// "Saved" on the session header: ≥ 4.5:1 against every session colour (opacity included).
{
  const ratios = await ev(`(()=>{
    const hero = document.querySelector('.day-hero'); const st = hero.querySelector('.save-status');
    const rgb = (c) => c.match(/[\\d.]+/g).map(Number);
    const L = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const out = {};
    const keep = hero.className;
    for (const slug of ['push','pull','legs','upper','lower','full','cardio','other','break','none']) {
      hero.className = 'day-hero t-' + slug;
      const bg = rgb(getComputedStyle(hero).backgroundColor);
      const fg = rgb(getComputedStyle(st).color);
      let a = fg[3] ?? 1; for (let e = st; e && e !== hero; e = e.parentElement) a *= +getComputedStyle(e).opacity;
      const mix = fg.slice(0, 3).map((v, i) => v * a + bg[i] * (1 - a));
      const [hi, lo] = [L(mix), L(bg)].sort((x, y) => y - x);
      out[slug] = Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
    }
    hero.className = keep;
    return out;
  })()`);
  const low = Object.entries(ratios).filter(([, r]) => r < 4.5);
  check(!low.length && (await text('.day-hero .save-status')) === 'Saved', `${THEME}: "Saved" on the header ≥ 4.5:1 on every session colour (lowest ${Math.min(...Object.values(ratios))}:1)`);
}

// Finish the exercise → collapse and move on.
await click(`${row2} .tick`);
await click('.ex:nth-child(2) .set-row:nth-child(3) .tick');
await sleep(900);
check(await ev(`document.querySelector('.ex:nth-child(2)').classList.contains('collapsed')`), 'finished exercise collapses');
check((await text('.ex:nth-child(2) .ex-summary')).startsWith('40×8 ×3'), `one-line summary: "${await text('.ex:nth-child(2) .ex-summary')}"`);
check(await ev(`(()=>{const r=document.querySelector('.ex:nth-child(3)').getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight / 2})()`), 'scrolled to the next unfinished exercise');
await click('.ex:nth-child(2) .ex-toggle');
await sleep(200);
check(await ev(`!document.querySelector('.ex:nth-child(2)').classList.contains('collapsed') && document.querySelectorAll('.ex:nth-child(2) .set-row').length === 3`), 'tap the summary to expand');
await click('.ex:nth-child(2) .ex-toggle');
await sleep(200);

// ---------------- timer tab: one shared timer ----------------
const barTime = await text('.rest-bar .rt-time');
await click('.rest-bar .rt-main');
await sleep(500);
check((await ev('location.hash')) === '#/timer', 'tapping the bar opens the Timer tab');
check(!(await visible('.rest-bar')), 'bar hidden on the Timer tab');
const ringTime = await text('.ring-time');
check(Math.abs(toSec(ringTime) - toSec(barTime)) <= 2, `ring shows the same timer (${ringTime} vs ${barTime})`);
function toSec(t) { const [m, s] = String(t).split(':').map(Number); return m * 60 + s; }
await clickText('.timer-controls button', '+15');
await sleep(300);
check(toSec(await text('.ring-time')) >= toSec(ringTime) + 13, `+15 on the Timer tab (${await text('.ring-time')})`);
await clickText('.timer-controls button', 'Pause');
await sleep(300);
check((await text('.ring-sub')) === 'Paused', 'paused on the Timer tab');
await shot('03-timer');
await go(`#/day/${TODAY}`);
check((await text('.rest-bar .rt-label')).startsWith('Paused'), 'the bar elsewhere shows the same paused timer');
await go('#/timer');
await clickText('.timer-controls button', 'Resume');
await clickText('.timer-extra button', 'Reset');
await sleep(300);
check((await store('m.state.settings.timerPreset')) === 90 && (await text('.ring-sub')) === 'Ready', 'reset → ready at the 90 s preset');
check(!(await ev(`document.querySelector('.tabbar a[data-tab=timer]').classList.contains('running')`)), 'badge cleared after reset');
await click('.preset[aria-label="60 seconds"]');
await sleep(200);
check((await store('m.state.settings.timerPreset')) === 60 && (await text('.ring-time')) === '1:00', 'preset chip remembered (60 s)');
check(J(await ev(`[...document.querySelectorAll('.presets > button.preset')].map(b => b.textContent)`)) === J(['0:45', '1:00', '1:30', '2:00', '3:00']), 'presets read 0:45, 1:00, 1:30, 2:00, 3:00');
check((await ev(`getComputedStyle(document.querySelector('.ring-fill')).strokeLinecap`)) === 'butt', 'ring has no cap notch at the top (butt caps)');
await setValue('.preset-input', '1:15');
await sleep(200);
check((await store('m.state.settings.timerPreset')) === 75, 'custom value 1:15 → 75 s');
check(await ev(`['t-sound','t-vibrate','t-auto'].every(id => document.getElementById(id))`) && (await ev(`[...document.querySelectorAll('.timer-settings button')].some(b => b.textContent === 'Test (5 s)')`)), 'timer settings: sound, vibration, auto-start, test');
await clickText('.timer-mode button', 'Stopwatch');
await sleep(150);
await clickText('.timer-controls button', 'Start');
await sleep(1300);
await click('.timer-controls button[aria-label="Lap"]');
await sleep(200);
check((await ev(`document.querySelectorAll('.laps li').length`)) === 1, 'stopwatch lap');
check(await ev(`document.querySelector('.tabbar a[data-tab=timer]').classList.contains('running')`), 'badge while the stopwatch runs');
await clickText('.timer-controls button', 'Pause');
await click('.timer-controls button[aria-label="Reset"]');
await sleep(200);
check((await text('.ring-time')) === '0:00.0', 'stopwatch reset');
await clickText('.timer-mode button', 'Rest timer');

// ---------------- finish workout ----------------
await go(`#/day/${TODAY}`);
// Per-exercise note on Barbell Row.
await click('.ex:nth-child(2) .ex-head .icon-btn');
await sleep(250);
await typeInto('#ex-note', 'Grip just outside knees');
await sleep(400);
await click('dialog[open] .sheet-head button');
await sleep(300);
check((await text('.ex:nth-child(2) .ex-note'))?.includes('Grip just outside knees') || (await sessionOf(TODAY)).exercises[1].note === 'Grip just outside knees', 'per-exercise note saved');
await click('.finish-btn');
await sleep(300);
check(await ev(`[...document.querySelectorAll('dialog[open] .summary dt')].map(d=>d.textContent).join('|')`) === 'Duration|Volume|Sets|PRs', 'finish sheet: duration, volume, sets, PRs');
check(await exists('dialog[open] #fin-cardio') && (await exists('dialog[open] #fin-notes')), 'finish sheet: treadmill minutes and notes');
await typeInto('#fin-notes', 'Felt strong');
await clickText('dialog[open] button[type=submit]', 'Finish workout');
await sleep(500);
check(await ev(`[...document.querySelectorAll('.toast')].some(t => t.textContent.includes('Nice, workout finished.'))`) || await waitToast(/Nice, workout finished\./), 'toast: Nice, workout finished.');
const fin = await sessionOf(TODAY);
check(fin.finishedAt > 0 && fin.notes === 'Felt strong', 'session marked complete with notes');
check(await exists('.finished-row'), 'day shows “Workout finished”');
await shot('04-finished');

// ---------------- copy workout ----------------
await click('.day-hero .icon-btn[aria-label="Day options"]');
await sleep(250);
await clickText('dialog[open] .menu-item', 'Copy to another date');
await sleep(300);
await setValue('#copy-date', '2026-11-27');
await clickText('dialog[open] button[type=submit]', 'Copy workout');
await sleep(500);
const copy = await sessionOf('2026-11-27');
check(copy && copy.type === 'Upper' && copy.exercises.length === fin.exercises.length, 'copied to Fri 27 Nov with the same exercises');
check(copy && copy.exercises.every((e) => e.sets.every((x) => x.done === false)) && copy.finishedAt === null, 'copy is planned: nothing ticked');
check(copy?.exercises[1].sets[0].weight === 40 && copy.exercises[1].note === 'Grip just outside knees', 'copy keeps last weights and the exercise note');

// ---------------- clear day: confirm first, then Undo ----------------
await go('#/day/2026-11-27');
await click('.day-hero .icon-btn[aria-label="Day options"]');
await sleep(250);
await clickText('dialog[open] .menu-item', 'Clear this day');
await sleep(250);
check(await exists('dialog[open] button[value=ok]') && (await sessionOf('2026-11-27')) !== null, 'Clear this day asks first and changes nothing yet');
await click('dialog[open] button[value=ok]');
await sleep(500);
check((await sessionOf('2026-11-27')) === null && (await ev('location.hash')).startsWith('#/cal/'), 'confirmed: the day is cleared');
check(await waitToast(/Day cleared/, 1000), 'toast offers Undo on the calendar');
await clickText('#toasts .toast-btn', 'Undo');
await sleep(500);
check((await sessionOf('2026-11-27'))?.exercises.length === copy.exercises.length && (await ev('location.hash')) === '#/day/2026-11-27', 'Undo brings the day back');

// ---------------- calendar after finishing ----------------
await go('#/');
check((await text('.today-actions .btn.block')).includes('Today’s Upper done'), `CTA after finishing: "${await text('.today-actions .btn.block')}"`);
check((await plateOf(TODAY)) === 'p-done t-green|Upper', 'today becomes a solid Upper plate');
check((await text('.month-stats dd:nth-of-type(1)')) !== null, 'month stats render');

// ---------------- progress: charts, records, body, muscles ----------------
await go('#/progress/db%20chest%20press');
await sleep(300);
check(await ev(`[...document.querySelectorAll('.progress-view nav .seg-btn')].map(a=>a.textContent).join('|')`) === 'Charts|Records|Body map|Body|Consistency', 'Progress segments: Charts, Records, Body map, Body, Consistency');
check(await exists('.chart-svg svg') && (await exists('.chart .end-label')), 'chart with a direct end label (3 sessions)');
check((await ev(`document.querySelectorAll('.progress-view .stat-row .stat').length`)) === 4, 'charts stat grid is full: four cards, none orphaned');
check(await ev(`[...document.querySelectorAll('.filters .seg-btn')].map(b=>b.textContent).slice(0,3).join('|')`) === 'Est. 1RM|Top weight|Volume', 'metric toggle');
await clickText('.table-toggle', 'View as table');
check(await exists('.chart-holder table.data-table'), 'chart → table view');
await go('#/progress/squat');
check(await exists('.chart-empty') && !(await exists('.chart-svg svg')), 'fewer than three sessions: no chart, the list instead');
await go('#/progress/~records');
check(await exists('.rec-table tbody tr'), 'records as a compact table');
check(await ev(`[...document.querySelectorAll('.rec-table td.num')].some(td => /^\\d+(\\.\\d+)? kg × \\d+$/.test(td.textContent))`), 'records read “32.5 kg × 8”');
check(await ev(`[...document.querySelectorAll('.rec .ex-tile')].every(t => t.classList.contains('t-none') && getComputedStyle(t).backgroundColor === getComputedStyle(document.querySelector('.rec .ex-tile')).backgroundColor)`), 'records: every exercise has the same icon style');
await shot('05-records');
await go('#/progress/~body');
check((await ev(`document.getElementById('body-date').value`)) === TODAY && (await ev(`document.getElementById('body-weight').value`)) === '80.6', 'body form: today, prefilled with last weight');
check(J(await ev(`[...document.querySelectorAll('.body-stats dt')].map(d => d.textContent)`)) === J(['Latest', 'Change, last 7 days', 'Since first entry', 'Weigh-ins']), `body cards: under 30 days of data the third card is “Since first entry” (${J(await ev(`[...document.querySelectorAll('.body-stats dt')].map(d => d.textContent)`))})`);
await typeInto('#body-weight', '80.2');
await clickText('.body-form button', 'Save weigh-in');
await sleep(500);
check((await store('m.state.body.get ? [...m.state.body.values()].length : 0')) === 3, 'weigh-in saved');
check(await ev(`document.querySelector('.body-form').getBoundingClientRect().top >= 0`), 'body form not clipped under a sticky header');


// ---------------- Round 5: exercise library, per-exercise progress, body map ----------------
const R5 = THEME === 'dark'
  ? { lvl1: 'rgb(75, 80, 174)', lvl2: 'rgb(108, 108, 214)' }
  : { lvl1: 'rgb(168, 168, 238)', lvl2: 'rgb(128, 128, 226)' };
check((await store('[...m.state.catalog.values()].find(r => r.key === "db chest press")'))?.libId === 'Dumbbell_Bench_Press', 'v5 migration linked DB Chest Press to the library (name kept)');
check((await store('m.state.library.length')) >= 800, 'library of 800+ exercises loaded from the bundle');

// Body map: hand-worked from the seed. This week: Chest 2, Back 3, Shoulders 2.5, Biceps 1.5, Quads 2, Forearms 0.
await go('#/progress/~map');
await sleep(300);
const region = (g) => ev(`(()=>{const r=document.querySelector('.bm-region[data-group="${g}"]'); return r ? { num: r.querySelector('.bm-num').textContent.replace(' ↓', ''), under: r.querySelector('.bm-num').textContent.endsWith('↓'), name: r.querySelector('.bm-name').textContent, lvl: [...r.classList].find(c=>c.startsWith('lvl-')), fill: getComputedStyle(r.querySelector('ellipse, rect, path')).fill, label: r.getAttribute('aria-label') } : null})()`);
const chest = await region('Chest');
check(chest?.num === '2' && chest.under && chest.name === 'Chest' && chest.lvl === 'lvl-1', `front map: Chest shows its name, 2 sets and the undertrained mark (${J(chest)})`);
check(chest?.fill === R5.lvl1, `${THEME}: Chest filled with ramp step 1 (${chest?.fill})`);
check((await region('Forearms'))?.num.startsWith('0') && (await region('Forearms')).lvl === 'lvl-0', 'Forearms: 0, no fill, marked undertrained');
check((await region('Quads'))?.num === '2' && (await region('Shoulders'))?.num === '2.5' && (await region('Biceps'))?.num === '1.5', 'Quads 2, Shoulders 2.5 (secondary sets count 0.5), Biceps 1.5');
check(await ev(`[...document.querySelectorAll('.bm-region')].every(r => r.querySelector('.bm-name').textContent && r.querySelector('.bm-num').textContent && r.getAttribute('aria-label').includes('target'))`), 'every region has a label, a number and a spoken description');
check(J(await ev(`[...document.querySelectorAll('.under-list .ms-name')].map(e=>e.textContent)`)) === J(['Forearms', 'Abs', 'Adductors/Abductors', 'Neck', 'Lower back', 'Triceps', 'Hamstrings', 'Glutes', 'Calves', 'Biceps', 'Chest', 'Quads', 'Shoulders', 'Back']), `undertrained list in order of gap (${J(await ev(`[...document.querySelectorAll('.under-list .ms-name')].map(e=>e.textContent)`))})`);
check(!(await ev(`/weak|lagging|fail/i.test(document.querySelector('.bodymap').innerText)`)), 'neutral wording: no “weak” or shaming copy');
await shot('21-bodymap-front');
await clickText('.bodymap .seg-btn', 'Back');
await sleep(200);
const back = await region('Back');
check(back?.num === '3' && back.lvl === 'lvl-2' && back.fill === R5.lvl2, `back map: Back 3 sets, ramp step 2 (${J(back)})`);
check((await region('Glutes'))?.num === '1' && (await region('Lower back'))?.num === '1', 'back map: Glutes 1 and Lower back 1 (from Squat, as secondary 0.5 × 2)');
await shot('22-bodymap-back');
await clickText('.bodymap .seg-btn', 'Front');
await clickText('.bodymap .seg-btn', 'Last 4 weeks');
await sleep(200);
check((await region('Abs'))?.num === '2', `last 4 weeks: Abs averages 2 per week (8 Cable Crunch sets ÷ 4) (${(await region('Abs'))?.num})`);
await clickText('.bodymap .seg-btn', 'This week');
await sleep(200);
await clickText('.bm-card .table-toggle', 'View as table');
check((await ev(`document.querySelectorAll('.bm-card table tbody tr').length`)) === 14, 'body map as a table: 14 muscle groups');
await clickText('.bm-card .table-toggle', 'View as chart');
await click('.bm-region[data-group="Chest"]');
await sleep(300);
check((await text('dialog[open] .sheet-head h2')) === 'Chest' && (await text('#ms-sets')) === '2', 'tap Chest: sheet with sets this week');
check((await text('#ms-planned')) === '10', `planned this week from workouts and plan: 10 (${await text('#ms-planned')})`);
check((await text('dialog[open] .ms-last')) === '16 Nov', 'last trained 16 Nov');
check(await ev(`[...document.querySelectorAll('dialog[open] .ms-exercises .ms-name')].map(e=>e.textContent).join('|') === 'DB Chest Press'`), 'exercises that hit it: DB Chest Press');
await shot('23-muscle-sheet');
await click('dialog[open] .sheet-head button');
await sleep(200);
await clickText('.progress-view .section-head button', 'How it’s counted');
await sleep(200);
check(await ev(`[...document.querySelectorAll('dialog[open] .defs dt')].map(d=>d.textContent).join('|').startsWith('Sets|Main and helping muscles|This week|Last 4 weeks')`), 'body map rules in a “How it’s counted” sheet');
await click('dialog[open] .sheet-head button');
await sleep(200);
// Weekly target per muscle (Settings): Chest at 4 → 2 sets is half the target, no longer undertrained.
await go('#/settings/targets');
await setValue('#target-Chest', '4');
await sleep(200);
check((await store('m.state.settings.muscleTargets')).Chest === 4, 'weekly target per muscle saved');
await go('#/progress/~map');
check(!(await ev(`[...document.querySelectorAll('.under-list .ms-name')].some(e => e.textContent === 'Chest')`)) && (await region('Chest')).lvl === 'lvl-2', 'with a target of 4, Chest leaves the undertrained list');
await go('#/settings/targets');
await setValue('#target-Chest', '');
await sleep(200);

// Per-exercise progress: trend, stall, PR badges, history; any library exercise opens.
await go('#/progress/cable%20crunch');
await sleep(300);
check((await text('#trend-chip')).trim().startsWith('Flat'), `trend chip: Flat (${await text('#trend-chip')})`);
check((await text('#stall-note'))?.trim().startsWith('Stalled: no new best est. 1RM in the last 7 sessions'), `stalled note (${await text('#stall-note')})`);
await shot('20-exercise-stalled');
await go('#/progress/db%20chest%20press');
await sleep(300);
check((await text('#trend-chip')).trim() === 'Trend after 4 sessions', 'trend waits for 4 sessions');
check((await ev(`document.querySelectorAll('.chart .pr-label').length`)) >= 1, 'PR badges on the chart');
check((await text('#recent-h')) === 'History (3)', 'per-exercise history list');
await shot('19-exercise-chart');
await click('.ex-chooser');
await sleep(300);
check(!(await exists('dialog.picker .picker-create')), 'chart search: no “Create” option');
await typeInto('#picker-q', 'barbell curl');
await sleep(250);
await click('dialog.picker .picker-opt[data-key="barbell curl"]');
await sleep(400);
check((await ev('location.hash')) === '#/progress/barbell%20curl' && (await text('.empty-state h2')) === 'No sets of Barbell Curl yet', 'any library exercise opens in Charts');
await go('#/day/2026-11-16');
check(await exists('.ex .pr-tag'), 'PR badge on the day screen when a set beat the previous best');

// The picker: library, filters, favourites, custom exercises.
await go(`#/day/${TODAY}`);
await click('.add-row');
await sleep(400);
check(/^Search 8\d\d exercises$/.test(await ev(`document.getElementById('picker-q').placeholder`)), `picker searches the whole library (${await ev(`document.getElementById('picker-q').placeholder`)})`);
check(J(await ev(`[...document.querySelectorAll('.picker-section')].map(e=>e.textContent)`)) === J(['Recent', 'All exercises']), 'recent exercises on top');
check((await ev(`document.querySelectorAll('.picker-opt').length`)) <= 60 && (await exists('.picker-more')), `only the first rows are drawn (${await ev(`document.querySelectorAll('.picker-opt').length`)}), “Show more” for the rest`);
await shot('17-picker');
await click('.fchip[data-value="Chest"]');
await click('.fchip[data-value="dumbbell"]');
await typeInto('#picker-q', 'press');
await sleep(250);
check(await ev(`(()=>{const m=[...document.querySelectorAll('.picker-opt:not([aria-disabled]) .opt-meta')].map(e=>e.textContent); return m.length > 0 && m.every(t => t.startsWith('Chest') && t.includes('Dumbbell'))})()`), 'muscle and equipment chips filter the list');
await click('.picker-opt[data-key="dumbbell bench press"] .star');
await sleep(250);
check((await store('m.catalogRecord("Dumbbell Bench Press")'))?.favourite === true, 'star saves a favourite');
check((await ev(`document.querySelector('.picker-opt[data-key="dumbbell bench press"]')?.textContent`))?.includes('Already added'), 'a library entry you log under your own name counts as that exercise (DB Chest Press is already in the workout)');
await shot('18-picker-filtered');
await click('.fchip[data-value="Chest"]');
await click('.fchip[data-value="dumbbell"]');
await setValue('#picker-q', '');
await sleep(250);
check(J(await ev(`[...document.querySelectorAll('.picker-section')].map(e=>e.textContent)`)) === J(['Favourites', 'Recent', 'All exercises']), 'favourites first');
await click('.picker-create');
await sleep(200);
await setValue('#cx-name', 'Landmine Press X');
await setValue('#cx-primary', 'Shoulders');
await setValue('#cx-secondary', 'Triceps');
await setValue('#cx-equipment', 'barbell');
await clickText('dialog.picker button[type=submit]', 'Create exercise');
await sleep(500);
const lm = await store('m.catalogRecord("Landmine Press X")');
check(lm?.custom === true && J(lm.primary) === J(['Shoulders']) && J(lm.secondary) === J(['Triceps']) && lm.equipment === 'barbell', 'custom exercise created with its muscles and equipment');
check((await exNames()).includes('Landmine Press X'), 'and added to the workout');
check(await store('m.exportPayload().exercises.some(r => r.name === "Landmine Press X" && r.custom && r.primary[0] === "Shoulders")'), 'backups carry custom exercises and muscle tags');
check(await ev(`Promise.all([import('./js/csv.js'), import('./js/store.js')]).then(([c, m]) => c.sessionsToCSV(m.allSessions(), {}, [...m.state.catalog.values()]).includes('Landmine Press X,,,,,,exercise,,Shoulders,Triceps,barbell,yes'))`), 'CSV carries custom exercises and muscle tags');

// ---------------- consistency ----------------
// Hand-worked from the seed: weeks of 2 and 9 Nov are finished with 10 planned, 9 done (8 on the day, 1 moved),
// 1 skipped (Sat 7th), 1 extra (Sun 15th). The week of 16 Nov is running: Mon, Wed and today done = 3 of 5.
await go('#/progress/~consistency');
await sleep(300);
const T = (sel) => text(sel);
check(await ev(`[...document.querySelectorAll('.progress-view nav .seg-btn')].map(a=>a.textContent).join('|')`) === 'Charts|Records|Body map|Body|Consistency', 'Progress segments: Charts, Records, Body map, Body, Consistency');
check(await ev(`(()=>{const n=document.querySelector('.progress-view nav'); const r=n.getBoundingClientRect(); const c=n.querySelector('[aria-current=page]').getBoundingClientRect(); return c.left >= r.left - 0.5 && c.right <= r.right + 0.5 && c.height >= 40})()`), 'the current Progress segment is fully in view (the bar scrolls if needed)');
check((await T('#cons-pct')) === '90%' && (await T('#cons-sub')) === '9 of 10 planned sessions', `headline: ${await T('#cons-pct')}, ${await T('#cons-sub')}`);
check((await T('#cons-ontime')) === '80%', `on-the-day rate ${await T('#cons-ontime')}`);
check((await T('#cons-sofar')).startsWith('3 of 5 planned sessions this week so far'), `this week so far: "${await T('#cons-sofar')}"`);
check(J(await ev(`['cnt-done','cnt-skipped','cnt-extra'].map(id => document.getElementById(id).textContent)`)) === J(['9', '1', '1']), 'done 9, skipped 1, extra 1');
check((await T('#streak-week')) === '1' && (await T('#streak-day')) === '2', `streaks: week ${await T('#streak-week')}, day ${await T('#streak-day')}`);
check((await ev(`document.querySelector('#streak-week').parentElement.querySelector('.stat-sub').textContent`)) === 'best 1 week'
  && (await ev(`document.querySelector('#streak-day').parentElement.querySelector('.stat-sub').textContent`)) === 'best 7 days', 'best streaks: 1 week, 7 days');
// heatmap: one cell per day, states match the hand-worked outcome
const hm = (d) => ev(`document.querySelector('.hm[data-date="${d}"]')?.dataset.state ?? null`);
const wantStates = { '2026-11-02': 'done', '2026-11-03': 'done', '2026-11-04': 'moved', '2026-11-05': 'movedin', '2026-11-06': 'done',
  '2026-11-07': 'skipped', '2026-11-08': 'none', '2026-11-12': 'none', '2026-11-15': 'extra', '2026-11-16': 'done', '2026-11-17': 'pending',
  '2026-11-18': 'done', '2026-11-19': 'none', '2026-11-20': 'done', '2026-11-21': 'upcoming' };
const gotStates = {};
for (const d of Object.keys(wantStates)) gotStates[d] = await hm(d);
check(J(gotStates) === J(wantStates), `heatmap cells match the seeded history${J(gotStates) === J(wantStates) ? '' : ` ${J(gotStates)}`}`);
check((await ev(`document.querySelectorAll('.hm').length`)) === 28, 'heatmap: 4 weeks × 7 days');
check(await ev(`(()=>{const c=n=>getComputedStyle(document.querySelector('.hm[data-date="'+n+'"]'),'::before'); return c('2026-11-02').backgroundColor===${J(C.hmDone)} && c('2026-11-15').backgroundColor===${J(C.hmExtra)} && c('2026-11-07').backgroundColor==='rgba(0, 0, 0, 0)'})()`), 'heatmap: done is the darkest step, extra the middle step, skipped an outline');
check(await ev(`[...document.querySelectorAll('.hm-legend li')].map(l=>l.textContent).join('|')`) === 'Done|Done on another day|Extra|Skipped or not done|Rest or no plan', 'heatmap legend labels every state');
check(await ev(`document.querySelector('.hm[data-date="2026-11-07"]').getBoundingClientRect().width >= 22`), 'heatmap hit area is larger than the mark');
// weekly bars
check((await ev(`document.querySelectorAll('.bar-plan').length`)) === 3 && (await ev(`document.querySelectorAll('.bar-done').length`)) === 3, 'weekly bars: outlined planned and filled done');
check((await T('.chart .end-label')) === '3/5', `latest week labelled directly (${await T('.chart .end-label')})`);
// trend: under three finished weeks with a plan → no chart
check(await ev(`document.querySelector('#trend-h').parentElement.querySelector('.chart-empty')?.textContent.includes('three finished weeks') ?? false`), 'trend: no line from two points');
// where I skip
check((await ev(`document.querySelector('#where-h').parentElement.querySelector('.bar-row .bar-name').textContent`)) === 'Lower'
  && (await ev(`document.querySelector('#where-h').parentElement.querySelector('.bar-row .bar-val').textContent`)) === '50%', 'where I skip: Lower first at 50%');
check((await ev(`[...document.querySelectorAll('#where-h ~ div .bar-row .bar-name')].map(e=>e.textContent)[0]`)) === 'Lower'
  && (await ev(`document.querySelectorAll('#where-h ~ div .bar-row').length`)) >= 5, 'by type and by weekday sorted bars');
// a table toggle on each chart
check((await ev(`document.querySelectorAll('.cons .table-toggle').length`)) === 4, 'view as table on the bars, heatmap and both skip charts');
await clickText('#bars-h ~ .chart-block .table-toggle', 'View as table');
check(await exists('#bars-h ~ .chart-block table.data-table'), 'weekly bars → table');
// range toggle and info sheet
await clickText('.cons .seg-btn', '4 weeks');
await sleep(200);
check((await T('#cons-pct')) === '90%', '4-week range keeps the same figures (only 2 finished planned weeks exist)');
await clickText('.cons .seg-btn', '12 weeks');
await clickText('.cons-top button', 'How it’s counted');
await sleep(250);
check(await ev(`[...document.querySelectorAll('dialog[open] .defs dt')].map(d=>d.textContent).slice(0,5).join('|')`) === 'Planned session|Completed|Done|Skipped|Extra', 'info sheet lists the definitions');
await click('dialog[open] .sheet-head button');
await sleep(200);
// skip reasons: one from this screen, one from the day screen
await click('.missed-row .reason[data-date="2026-11-07"][data-reason="Busy"]');
await sleep(300);
check((await store('m.state.skipReasons')).hasOwnProperty('2026-11-07') && (await store('m.state.skipReasons'))['2026-11-07'] === 'Busy', 'one-tap reason saved');
await go('#/day/2026-11-17');
await click('.skip-row .reason[data-reason="Tired"]');
await sleep(300);
check((await store('m.state.skipReasons'))['2026-11-17'] === 'Tired' && (await sessionOf('2026-11-17')) === null, 'reason from the day screen saves no workout');
await go('#/progress/~consistency');
check(await ev(`[...document.querySelectorAll('#reason-counts div')].map(d=>d.textContent).join('|')`) === 'Busy1|Tired1', 'skip reason counts');
check(await ev(`import('./js/csv.js').then(async c => { const m = await import('./js/store.js'); const csv = c.sessionsToCSV(m.allSessions(), m.state.skipReasons); return csv.includes('2026-11-07,,,,,,,,skipped,Busy') && csv.includes('record,skip reason'); })`), 'CSV carries skip reasons');
check((await store('m.exportPayload().skipReasons'))['2026-11-07'] === 'Busy', 'backup carries skip reasons');
// heatmap tap opens the day
await click('.hm[data-date="2026-11-07"]');
await sleep(300);
check((await ev('location.hash')) === '#/day/2026-11-07', 'tapping a heatmap day opens it');
// minimum sessions per week (setting) changes the weekly streak
await go('#/settings');
await setValue('#weekly-min', '3');
await sleep(150);
check(!(await ev(`[...document.querySelectorAll('#toasts .toast')].some(t => !t.hidden)`)), 'no toast for an autosaved setting');
check(new Set(await ev(`[...document.querySelectorAll('.settings-view .card > p.muted, .settings-view .card > p.fine')].map(p => getComputedStyle(p).fontSize)`)).size === 1, 'every Settings card uses one body-text size');
await sleep(250);
await go('#/progress/~consistency');
check((await T('#streak-week')) === '3', `weekly streak with a minimum of 3 per week: ${await T('#streak-week')}`);
await go('#/settings');
await setValue('#weekly-min', '');
await sleep(250);
check((await store('m.state.settings.weeklyMin')) === null, 'weekly minimum cleared');
// a month with no finished weeks: counts, no percentage
await go('#/cal/2026-12');
check((await ev(`document.querySelectorAll('.month-stats dd')[1].firstChild.textContent`)) === '–', 'month with no finished planned weeks shows no percentage');
await go('#/progress/~consistency');
await sleep(300);
await shot('07-consistency');
await ev(`window.scrollTo(0, 700)`);
await sleep(200);
await shot('08-consistency-heatmap');

// ---------------- no overlap: toast, rest bar, nav, content ----------------
const rect = (sel) => ev(`(()=>{const e=document.querySelector(${J(sel)}); if(!e) return null; const r=e.getBoundingClientRect(); return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,h:r.height}})()`);
const showToast = (msg, opts = {}) => ev(`import('./js/ui.js').then(m => { m.toast(${J(msg)}, ${J(opts)}); return true; })`);
const visibleToasts = () => ev(`[...document.querySelectorAll('#toasts .toast')].filter(t => !t.hidden && t.getClientRects().length).map(t => t.textContent)`);
async function checkStack(where) {
  const nav = await rect('.tabbar');
  const bar = await ev(`getComputedStyle(document.querySelector('.rest-bar') ?? document.body).display !== 'none' && !!document.querySelector('.rest-bar')`) ? await rect('.rest-bar') : null;
  const t = await rect('#toasts .toast:not([hidden])');
  if (bar) check(bar.bottom <= nav.top + 0.5, `${where}: rest bar sits above the nav`);
  if (t) check(t.bottom <= (bar ? bar.top : nav.top) + 0.5, `${where}: toast sits above the ${bar ? 'rest bar' : 'nav'}`);
  // Scrolled to the very bottom, the last content is above the bar/nav, never behind it.
  await ev(`window.scrollTo(0, document.documentElement.scrollHeight)`);
  await sleep(120);
  const lastBottom = await ev(`(()=>{const els=[...document.querySelectorAll('main .view > *')].filter(e => e.getClientRects().length); return els.at(-1).getBoundingClientRect().bottom})()`);
  check(lastBottom <= (bar ? bar.top : nav.top) + 0.5, `${where}: last content (${Math.round(lastBottom)}) clears the ${bar ? 'rest bar' : 'nav'} (${Math.round(bar ? bar.top : nav.top)})`);
}
await go(`#/day/${TODAY}`);
await click('.ex:nth-child(1) .set-row:nth-child(1) .tick'); // an open set on today's Upper → rest in the Upper colour
await sleep(300);
check(await ev(`document.querySelector('.rest-bar').classList.contains('t-green') && getComputedStyle(document.querySelector('.rest-bar')).backgroundColor === ${J(UPPER_BLOCK)}`), 'rest bar in the session colour');
check(J(await ev(`[...document.querySelectorAll('.rest-bar button')].map(b => b.textContent.trim())`)) === J(['+15', 'Skip']) && (await text('.rest-bar .rt-label')).startsWith('Rest'), `rest bar: Rest, time, +15, Skip (${J(await ev(`[...document.querySelectorAll('.rest-bar button')].map(b => b.textContent)`))}, ${await text('.rest-bar .rt-label')})`);
check(await ev(`parseFloat(getComputedStyle(document.querySelector('.rest-bar .rt-time')).fontSize) >= 20`), 'rest time at 20 px');
await showToast('Copied to Fri 27 Nov');
await sleep(150);
await checkStack('day');
await shot('09-day-rest-toast');
// toast queue: one at a time, about 2 s each
await showToast('First');
await showToast('Second');
await sleep(100);
check((await visibleToasts()).length === 1, `one toast at a time (${J(await visibleToasts())})`);
await sleep(2300);
check(J(await visibleToasts()) === J(['First']) || J(await visibleToasts()) === J(['Second']), `queued toasts follow each other (${J(await visibleToasts())})`);
await sleep(4600);
check((await visibleToasts()).length === 0, 'toasts auto-dismiss');
await go('#/timer');
await ev(`window.scrollTo(0, document.documentElement.scrollHeight)`);
await showToast('Copied to Fri 27 Nov');
await sleep(150);
const tToast = await rect('#toasts .toast:not([hidden])');
const tMode = await rect('.timer-mode');
const tCtl = await rect('.timer-controls');
check(tToast && (tToast.top >= tCtl.bottom || tToast.bottom <= tCtl.top) && tToast.top >= tMode.bottom, 'timer: toast never covers the mode switch or controls');
check(tMode.top < (await rect('.ring')).top, 'timer: Rest timer / Stopwatch switch sits under the title');
await shot('10-timer-toast');
await checkStack('timer');
await go('#/');
await showToast('Copied to Fri 27 Nov');
await sleep(150);
await checkStack('calendar');
await click('.rest-bar .skip');
await sleep(200);
check(!(await exists('.rest-bar')), 'Skip closes the bar');

// ---------------- "Nice, workout finished." only for the last set or Finish ----------------
await ev(`import('./js/store.js').then(async (m) => {
  const { newSession, newExercise } = await import('./js/model.js');
  const s = newSession('2026-11-19', m.state.settings, 'Other');
  s.exercises = [newExercise('Plank Row', [{ weight: 10, reps: 10 }, { weight: 10, reps: 10 }])];
  await m.addSession(s);
  return true;
})`);
await go('#/day/2026-11-19');
await click('.set-row:nth-child(1) .tick');
await sleep(300);
check(!(await ev(`[...document.querySelectorAll('#toasts .toast')].some(t => /finished/.test(t.textContent))`)) && !(await sessionOf('2026-11-19')).finishedAt, 'first of two sets: not finished, no toast');
await click('.set-row:nth-child(2) .tick');
await sleep(300);
check(await waitToast(/^Nice, workout finished\.$/, 1500) && (await sessionOf('2026-11-19')).finishedAt > 0, 'ticking the last set finishes the workout: "Nice, workout finished."');
await sleep(400);
await click('.ex-toggle');
await sleep(200);
await click('.set-row:nth-child(2) .tick');
await sleep(300);
check((await sessionOf('2026-11-19')).finishedAt === null, 'unticking that set straight away un-finishes it');
await ev(`import('./js/store.js').then((m) => m.deleteSession('2026-11-19'))`);
await sleep(2200);

// ---------------- one-time "Which muscle does this train?" ----------------
await ev(`import('./js/store.js').then(async (m) => {
  const { newSession, newExercise } = await import('./js/model.js');
  const s = newSession('2026-11-19', m.state.settings, 'Other');
  s.exercises = [newExercise('Zercher Lunge Thing', [{ weight: 40, reps: 8 }])];
  await m.addSession(s);
  await m.ensureExercise('Zercher Lunge Thing');
  return true;
})`);
await go('#/');
check((await text('.banner p'))?.includes('Zercher Lunge Thing'), 'unmatched exercise: the calendar asks which muscle it trains');
await clickText('.banner .btn', 'Choose muscles');
await sleep(300);
await setValue('dialog[open] select', 'Quads');
await clickText('dialog[open] button[type=submit]', 'Save muscles');
await sleep(400);
check(J((await store('m.catalogRecord("Zercher Lunge Thing")')).primary) === J(['Quads']) && !(await ev(`[...document.querySelectorAll('.banner p')].some(p => p.textContent.includes('Zercher'))`)), 'answered once: muscle saved, question gone');
await ev(`import('./js/store.js').then((m) => m.deleteSession('2026-11-19'))`);

// ---------------- appearance: saved on the device, applied before first paint ----------------
if (THEME === 'light') {
  await go('#/settings');
  await click('[data-appearance="dark"]');
  await sleep(200);
  check((await ev(`document.documentElement.dataset.theme`)) === 'dark' && (await ev(`localStorage.getItem('appearance')`)) === 'dark', 'Appearance → Dark applies and is saved on the device');
  check(await ev(`[...document.querySelectorAll('meta[name=theme-color]')].every(m => m.content === '#0F1226' && !m.media)`), 'status bar colour follows the chosen theme');
  check((await store('m.state.settings.appearance')) === 'dark', 'appearance is in settings (backups)');
  // Reload and read the theme before any module script runs: the inline head script must have set it.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('readystatechange', () => { if (!window.__firstTheme) window.__firstTheme = document.documentElement.dataset.theme + '|' + document.documentElement.style.colorScheme; }, { once: true });` });
  await send('Page.reload', {});
  await sleep(1800);
  check((await ev(`window.__firstTheme`)) === 'dark|dark', `no theme flash: dark is set before the stylesheet and modules load (${await ev('window.__firstTheme')})`);
check(await ev(`getComputedStyle(document.body).backgroundColor === 'rgb(15, 18, 38)'`), 'dark page after reload');
  await shot('16-settings-dark');
  await go('#/settings');
  await click('[data-appearance="system"]');
  await sleep(200);
  check((await ev(`document.documentElement.dataset.theme`)) === 'light' && (await ev(`localStorage.getItem('appearance')`)) === 'system', 'back to System → light (the emulated phone setting)');
}

// ---------------- splash: on at first paint, gone as soon as the first screen renders ----------------
await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  window.__splash = { atStart: null, view: null, gone: null, viewAtGone: null };
  // Frame by frame until either the splash or the first screen shows: the splash must come first.
  // (A frame before the parser reaches the body paints nothing but the page colour.)
  const probe = () => {
    const sp = document.getElementById('splash');
    const v = document.getElementById('view');
    if (sp && getComputedStyle(sp).display === 'flex') { window.__splash.atStart = true; return; }
    if (v && v.children.length) { window.__splash.atStart = false; return; }
    requestAnimationFrame(probe);
  };
  requestAnimationFrame(probe);
  new MutationObserver(() => {
    const v = document.getElementById('view');
    if (window.__splash.view === null && v && v.children.length) window.__splash.view = performance.now();
    if (window.__splash.gone === null && document.readyState !== 'loading' && !document.documentElement.classList.contains('booting')) {
      window.__splash.gone = performance.now(); window.__splash.viewAtGone = !!v?.children.length;
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
})();` });
await send('Page.reload', {});
await sleep(1800);
const sp = await ev('window.__splash');
check(sp.atStart === true, 'splash (icon + VANE) is on screen from the first paint');
check(sp.viewAtGone === true && sp.gone - sp.view < 100, `splash leaves as soon as the first screen is there (${Math.round(sp.gone - sp.view)} ms after it)`);
check(!(await exists('#splash')) && (await visible('.tabbar')), 'splash removed; nav visible');
// Put the splash back for one capture (it's normally gone too fast to see).
await ev(`import('./js/brand.js').then((m) => { document.body.insertAdjacentHTML('afterbegin', m.splashHTML()); document.documentElement.classList.add('booting'); return true; })`);
await sleep(150);
await shot('29-splash');
await ev(`document.documentElement.classList.remove('booting'); document.getElementById('splash').remove(); true`);

// ---------------- Settings → About: VANE, version, credit ----------------
await go('#/settings');
check(await ev(`(()=>{const a=document.querySelector('#about'); const v=a.querySelector('.about-version')?.textContent; return a.querySelector('.about-brand .wordmark')?.textContent==='VANE' && !!a.querySelector('.about-brand .brand-mark svg') && v==='Version '+${J(await ev(`import('./js/model.js').then(m=>m.APP_VERSION)`))} && /free-exercise-db/.test(a.querySelector('.credit').textContent) && !!a.querySelector('.credit a[href*="free-exercise-db"]')})()`), 'About: VANE, version and the free-exercise-db credit');
check(!(await exists('.settings-view .brand-row, .progress-view .brand-row')) && (await text('main h1')) === 'Settings', 'other tabs keep their own titles (no brand row)');

// ---------------- more screens for review ----------------
await go('#/progress/db%20chest%20press');
await sleep(300);
await shot('11-progress-chart');
await go('#/progress/~body');
await shot('12-body');
await go('#/settings');
await shot('13-settings');
await go('#/plan');
await shot('14-planner');

// ---------------- 320 px and 412 px ----------------
for (const width of [320, 412]) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 780, deviceScaleFactor: 2, mobile: true });
  for (const hash of ['#/', `#/day/${TODAY}`, '#/day/2026-11-27', '#/timer', '#/progress', '#/progress/~records', '#/progress/~map', '#/progress/~consistency', '#/settings', '#/settings/profile', '#/plan']) {
    await go(hash);
    const over = await ev(`(()=>{const w=innerWidth; return [...document.querySelectorAll('main *')].filter(e => { const r=e.getBoundingClientRect(); return r.width && (r.right > w + 1 || r.left < -1) && !e.closest('.hm-scroll, .chart-svg, .seg-scroll, .filter-row'); }).slice(0,3).map(e => e.className || e.tagName)})()`);
    check((await ev(`document.documentElement.scrollWidth <= innerWidth`)) && over.length === 0, `${width} px ${hash}: nothing spills sideways${over.length ? ` (${J(over)})` : ''}`);
  }
  await go('#/day/2026-11-27');
  await shot(`15-day-${width}`);
  // Brand row, month header and About: no two pieces overlap.
  const OVERLAP = (sels) => `(()=>{const els=[...document.querySelectorAll(${J(sels)})].filter(e=>e.getClientRects().length); const out=[];
    for (let i=0;i<els.length;i++) for (let j=i+1;j<els.length;j++) { if (els[i].contains(els[j])||els[j].contains(els[i])) continue;
      const a=els[i].getBoundingClientRect(), b=els[j].getBoundingClientRect();
      if (a.left<b.right-0.5 && b.left<a.right-0.5 && a.top<b.bottom-0.5 && b.top<a.bottom-0.5) out.push((els[i].className||els[i].tagName)+' × '+(els[j].className||els[j].tagName)); }
    return out.slice(0,3)})()`;
  for (const hash of ['#/', '#/cal/2026-09']) {
    await go(hash);
    const o = await ev(OVERLAP('.brand-row .brand-mark, .brand-row .wordmark, .cal-top h1, .cal-summary, .cal-top .topbar-actions > *, .banner, .today-actions'));
    check(o.length === 0, `${width} px ${hash}: brand row and month header don't overlap${o.length ? ` (${J(o)})` : ''}`);
  }
  await go('#/');
  await shot(`26-calendar-${width}`);
  await go('#/settings');
  await ev(`document.querySelector('#about').scrollIntoView({ block: 'start' }); true`);
  await sleep(200);
  const oa = await ev(OVERLAP('#about h2, #about .brand-mark, #about .wordmark, #about .about-version, #about .kv > div, #about .btn, #about p'));
  check(oa.length === 0, `${width} px Settings → About: nothing overlaps${oa.length ? ` (${J(oa)})` : ''}`);
  await shot(`27-about-${width}`);
  await go('#/progress/~map');
  await shot(`24-bodymap-${width}`);
  await go('#/day/2026-11-27');
  await click('.add-row');
  await sleep(400);
  const pOver = await ev(`(()=>{const w=innerWidth; return [...document.querySelectorAll('dialog.picker *')].filter(e => { const r=e.getBoundingClientRect(); return r.width && (r.right > w + 1 || r.left < -1) && !e.closest('.filter-row'); }).slice(0,3).map(e => e.className || e.tagName)})()`);
  check(pOver.length === 0, `${width} px picker: nothing spills sideways${pOver.length ? ` (${J(pOver)})` : ''}`);
  await shot(`25-picker-${width}`);
  await click('dialog.picker .picker-head .btn');
  await sleep(200);
}
await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });

// ---------------- offline + fonts ----------------
await go('#/');
await sleep(800);
check(await ev(`navigator.serviceWorker.getRegistration().then(r => !!r?.active)`), 'service worker active');
await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await send('Page.reload', { ignoreCache: true });
await sleep(2000);
check(await exists('.cal-grid .cal-day'), 'reload offline: app renders');
check(await ev(`document.fonts.ready.then(() => document.fonts.check('700 16px "Plus Jakarta Sans"') && [...document.fonts].some(f => f.family.includes('Plus Jakarta') && f.status === 'loaded'))`), 'font loads offline from the cache');
check(await ev(`!!document.querySelector('.tabbar svg path') && !!document.querySelector('.cal-top .icon-btn svg path')`), 'icons render offline (inline sprite)');
await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

// ---------------- layout at 360 px ----------------
await go(`#/day/2026-11-27`);
check(await ev(`document.documentElement.scrollWidth <= innerWidth`), 'no horizontal scroll at 360 px');
check(await ev(`[...document.querySelectorAll('.tick, .step-btn, .add-row, .ex-toggle, .icon-btn, .hero-type, .btn')].filter(b => b.offsetParent).every(b => b.getBoundingClientRect().height >= 44)`), 'tap targets are at least 44 px tall');
await shot('06-day-360');

// No stray "null"/"undefined" text on any screen.
for (const hash of ['#/', `#/day/${TODAY}`, '#/day/2026-11-27', '#/day/2026-11-19', '#/plan', '#/timer', '#/progress', '#/progress/~records', '#/progress/~map', '#/progress/~body', '#/progress/~consistency', '#/settings', '#/settings/profile']) {
  await go(hash);
  { const m = await ev(`(document.querySelector('main').innerText.match(/.{0,30}\\b(null|undefined|NaN)\\b.{0,30}/) ?? [''])[0]`); check(!m, `no stray null/undefined text on ${hash}${m ? ` (“${m}”)` : ''}`); }
}

// ---------------- Settings → Profile: edit every answer; changes apply from now on ----------------
const pick = (name, value) => click(`input[name="${name}"][value="${value}"]`);
await go('#/settings');
check(await exists('#profile a.row-link[href="#/settings/profile"]'), 'Settings → Profile row');
await click('#profile a.row-link');
await sleep(400);
check((await text('main h1')) === 'Profile' && (await ev(`['units','goal','experience','split','sessions'].every(n => document.querySelectorAll('input[type=radio][name='+n+']').length) && !!document.querySelector('#pf-name') && !document.querySelector('#pf-ht')`)), 'Profile edits name, units, goal, experience, split and sessions (no height field)');
check(!(await ev(`/birth|\\bsex\\b|gender|medical|condition/i.test(document.querySelector('main').innerText)`)), 'no birth date, sex or medical questions');
await shot('36-profile');
const chestBefore = await sessionOf('2026-11-16');
await pick('units', 'lb');
await sleep(300);
check((await store('m.state.profile.units')) === 'lb' && Math.abs((await store('m.state.settings.weightStep')) - 2.268) < 1e-3, 'Profile → lb: the 2.5 kg step becomes 5 lb');
await go('#/day/2026-11-27');
check(await ev(`(()=>{const i=[...document.querySelectorAll('.set-row input[inputmode=decimal]')].find(x => x.value === '71.65'); return !!i && i.closest('.val').querySelector('.unit').textContent === 'lb' && /weight in lb/.test(i.getAttribute('aria-label'))})()`), 'lb everywhere: 32.5 kg shows as 71.65 lb on the day screen');
await ev(`(()=>{const i=[...document.querySelectorAll('.set-row input[inputmode=decimal]')].find(x => x.value === '71.65'); i.closest('.set-row').querySelector('.step-btn[aria-label*="weight plus"]').click(); return true})()`);
await sleep(200);
check(await ev(`[...document.querySelectorAll('.set-row input[inputmode=decimal]')].some(x => x.value === '76.65')`) && /weight plus 5 lb/.test(await ev(`document.querySelector('.step-btn[aria-label*="weight plus"]').getAttribute('aria-label')`)), '+ adds exactly 5 lb (71.65 → 76.65)');
check(J((await sessionOf('2026-11-16')).exercises) === J(chestBefore.exercises), 'switching units rewrites no history (still stored in kg)');
await go('#/progress/~body');
check(await ev(`/ lb$/.test(document.querySelector('.body-stats .stat-v').textContent) && document.querySelector('#body-weight').placeholder === 'lb'`), 'lb on the Body log');
await go('#/');
check(await ev(`/ lb/.test(document.querySelector('.weigh-btn').textContent) && /lb/.test(document.querySelector('.review').textContent)`), 'lb on the Calendar weigh-in and weekly review');
await go('#/settings');
check(await ev(`[...document.querySelectorAll('#weight-step option')].map(o=>o.textContent).join('|') === '2.5 lb|5 lb|10 lb'`), 'step choices in lb');
await go('#/settings/profile');
await pick('units', 'kg');
await sleep(300);
check((await store('m.state.settings.weightStep')) === 2.5, 'back to kg: 5 lb → 2.5 kg, nothing lost');
await pick('goal', 'strength');
await sleep(300);
await go('#/day/2026-11-27');
const strengthLines = await ev(`import('./js/profile.js').then(m => Object.values(m.GOAL_HINT.strength))`);
check(await ev(`[...document.querySelectorAll('.hint-text')].some(t => ${J(strengthLines)}.some(l => t.textContent.includes(l)))`), 'goal “Get stronger” changes the hint wording');
await go('#/');
check(await ev(`/^Get stronger:/.test(document.querySelector('.review-headline')?.textContent ?? '') && document.querySelector('.review > div dt').textContent === 'PRs'`), 'goal “Get stronger” leads the weekly review with records');
await go('#/settings/profile');
await pick('experience', 'veteran');
await sleep(300);
check((await store('m.state.settings.defaultRestSeconds')) === 150 && (await store('m.state.settings.weightStep')) === 1, 'experience 3+ years: 1 kg steps, 2:30 rest');
check(/rest 2:30/.test(await text('.save-line')), `Profile says what changed (“${await text('.save-line')}”)`);
await pick('sessions', '5');
await sleep(300);
check((await store('m.state.settings.weeklyMin')) === 5, 'sessions per week → good-week minimum');
await go('#/progress/~consistency');
check((await ev(`document.querySelector('#cons-min')?.value`)) === '5', 'good-week minimum shows (and stays editable) on Consistency');
await setValue('#cons-min', '3');
await sleep(300);
check((await store('m.state.settings.weeklyMin')) === 3, 'edited on Consistency');

// ---------------- session types: a bro-split week of five coloured types ----------------
await go('#/plan');
check(await exists('#types .type-list') && (await ev(`[...document.querySelectorAll('#types .type-row strong')].map(x=>x.textContent).join(',')`)) === 'Push,Pull,Legs,Upper,Lower,Full body,Cardio,Other', 'Planner → Session types lists the built-ins');
check(await ev(`[...document.querySelectorAll('.preset-btns .btn')].map(b=>b.textContent).join('|') === 'Push/Pull/Legs|Upper/Lower|Full body|Bro split|Arnold split'`), 'presets: PPL, Upper/Lower, Full body, Bro split, Arnold split');
const cellOf = (d) => ev(`(()=>{const a=document.querySelector('.cal-day[href="#/day/${d}"]'); const p=a.querySelector('.plate'); return [...p.classList].filter(c=>/^t-/.test(c)).join('')+'|'+(a.querySelector('.plate-label')?.textContent ?? '')})()`);
// Before the preset: one future day only looked at, one edited (so it has a record of its own).
await go('#/day/2026-11-24');
check(!(await sessionOf('2026-11-24')), 'viewing a planned day saves nothing');
await go('#/day/2026-12-01');
await ev(`document.querySelector('.set-row .step-btn[aria-label*="weight plus"]').click(); true`);
await sleep(900);
check((await sessionOf('2026-12-01'))?.type === 'Pull', 'editing a planned day saves it (a day of your own)');
await go('#/plan');
await click('.preset-btns [data-preset="bro"]');
await sleep(300);
await click('dialog[open] button[value=ok]');
await sleep(700);
const bro = await store('m.state.types.filter(t => !t.hidden && !t.archived && t.kind === "lift")');
const broIds = Object.fromEntries(bro.map((t) => [t.name, t.id]));
{
  const week = (await store('m.state.schedule')).at(-1);
  const names = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((k) => week.days[k]);
  check(J(bro.map((t) => t.name).sort()) === J(['Arms', 'Back + Biceps', 'Chest + Triceps', 'Legs', 'Shoulders']) && new Set(bro.map((t) => t.color)).size === 5 && bro.every((t) => t.color), `bro split: five types, five distinct colours (${bro.map((t) => `${t.name}:${t.color}`).join(', ')})`);
  check(J(names) === J([broIds['Chest + Triceps'], broIds['Back + Biceps'], 'Legs', broIds.Shoulders, broIds.Arms, 'Break', 'Break']) && week.from === TODAY, 'bro split fills Mon–Fri from today');
  check((await store(`m.state.templates[${J(broIds['Chest + Triceps'])}].length`)) >= 5, 'Chest + Triceps comes with a starter template');
}
check(await ev(`[...document.querySelectorAll('#sched-mon option')].map(o=>o.textContent).join('|') === 'Chest + Triceps|Back + Biceps|Legs|Shoulders|Arms|Cardio|Other|Break'.replace(/^/, '—|')`), `weekly dropdown lists every type plus Break (${await ev(`[...document.querySelectorAll('#sched-mon option')].map(o=>o.textContent).join('|')`)})`);
await shot('40-planner-types');
await go('#/cal/2026-11');
check((await cellOf('2026-11-24')) === `t-${bro.find((t) => t.name === 'Back + Biceps').color}|B+B`, `preset replaces a future day you didn't edit (${await cellOf('2026-11-24')})`);
await go('#/cal/2026-12');
check((await cellOf('2026-12-01')) === 't-blue|Pull' || (await cellOf('2026-12-01')).endsWith('|Pull'), `a future day you edited keeps your choice (${await cellOf('2026-12-01')})`);
await go('#/day/2026-12-01');
check(/Changed from Back \+ Biceps/.test(await text('main')), 'its Day screen says the plan changed under it');
// Calendar: next week's five days, each a coloured plate WITH its label.
await go('#/cal/2026-11');
await go('#/cal/2026-12'); // a week with no one-off changes
const broWeek = await Promise.all(['2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10', '2026-12-11'].map(cellOf));
check(J(broWeek.map((c) => c.split('|')[1])) === J(['C+T', 'B+B', 'Legs', 'Shldr', 'Arms']) && new Set(broWeek.map((c) => c.split('|')[0])).size === 5, `calendar: five colours, each with its label (${broWeek.join(', ')})`);
check(await ev(`[...document.querySelectorAll('.cal-day .plate:not(.p-none)')].every(p => p.parentElement.querySelector('.plate-label')?.textContent.trim())`), 'colour is never the only cue: every plate on the calendar has a label');
check(await ev(`[...document.querySelectorAll('.week-days .wd')].every(w => w.querySelector('.plate-label')?.textContent.trim())`), 'every week pill has a label');
await go('#/cal/2026-11');
await ev(`document.querySelector('.cal-day[href="#/day/2026-11-24"]').scrollIntoView({ block: 'center' }); true`);
await sleep(150);
await shot('41-calendar-bro');
await go('#/day/2026-11-23');
check((await text('.hero-type')) === 'Chest + Triceps' && (await ev(`document.querySelectorAll('.ex').length`)) >= 5 && (await ev(`document.querySelector('.day-view').className.includes('t-${bro.find((t) => t.name === 'Chest + Triceps').color}')`)), 'a planned Chest + Triceps day opens with its template, in its colour');
check((await ev(`[...document.querySelectorAll('.ex-name')].map(e=>e.textContent)`)).includes('Bench Press') && (await ev(`document.querySelector('.ex-name').title`)) === 'Barbell Bench Press - Medium Grip', 'short exercise names on the Day screen (full name kept as a tooltip)');
await shot('42-day-bro');
await click('.add-row');
await sleep(400);
await typeInto('#picker-q', 'bench press medium');
await sleep(400);
check(await ev(`(()=>{const o=document.querySelector('dialog.picker .picker-opt'); return o?.querySelector('.opt-name').textContent === 'Bench Press' && o.querySelector('.opt-full')?.textContent === 'Barbell Bench Press - Medium Grip'})()`), 'picker: the short name, with the full library name in the detail line');
await shot('45-picker-short');
await click('dialog.picker .picker-head .btn');
await sleep(200);
await ev(`document.querySelector('.day-hero .icon-btn[aria-label="Day options"]').click(); true`);
await sleep(300);
await clickText('.sheet button, dialog[open] button', 'Change session type');
await sleep(300);
check(await ev(`[...document.querySelectorAll('dialog[open] .type-opt > span:last-child')].map(s=>s.textContent).join('|') === 'Chest + Triceps|Back + Biceps|Legs|Shoulders|Arms|Cardio|Other|Break'`), `Day type switcher lists every type plus Break (${await ev(`[...document.querySelectorAll('dialog[open] .type-opt > span:last-child')].map(s=>s.textContent).join('|')`)})`);
await ev(`document.querySelector('dialog[open] .sheet-head .btn').click(); true`);
await sleep(200);
// Add types until the colours run out; then a neutral tone with its label.
await go('#/plan');
const addType = async (name) => {
  await click('#types .section-head .btn');
  await sleep(300);
  await typeInto('#type-name', name);
  await click('dialog[open] .type-form button[type=submit]');
  await sleep(500);
};
await addType('Core');
await addType('Mobility');
await addType('Grip');
{
  const t = await store('m.state.types');
  const c = (n) => t.find((x) => x.name === n);
  check(c('Core').color === 'orange' && c('Mobility').color === 'pink' && c('Grip').color === null, `new types take the next unused colour, then neutral (${['Core', 'Mobility', 'Grip'].map((n) => `${n}:${c(n).color}`).join(', ')})`);
  check(await ev(`(()=>{const r=document.querySelector('#types .type-row[data-type="${c('Grip').id}"]'); return r.classList.contains('t-neutral') && /Neutral/.test(r.textContent)})()`), 'beyond 8 colours: neutral, and the list says so');
}
for (let i = 0; i < 40 && (await ev(`[...document.querySelectorAll('#toasts .toast')].some(t => !t.hidden && t.getClientRects().length)`)); i++) await sleep(200); // let the "added" toasts go
await click('#types .section-head .btn');
await sleep(300);
check(await ev(`document.querySelectorAll('dialog[open] .swatch-opt').length === 9 && [...document.querySelectorAll('dialog[open] .swatch-name')].every(n => n.textContent.trim())`), 'colour picker: 8 named colours and Neutral');
await shot('43-type-edit');
await ev(`document.querySelector('dialog[open] .sheet-head .btn').click(); true`);
await sleep(200);
// Rename + recolour never touches history; delete without history removes; with history archives.
const mob = (await store('m.state.types')).find((t) => t.name === 'Mobility');
await ev(`import('./js/store.js').then(async (m) => { await m.createSession('2026-11-08', ${J(mob.id)}); return true; })`);
await click(`#types .type-row[data-type="${mob.id}"] button[aria-label^="Edit"]`);
await sleep(300);
await typeInto('#type-name', 'Mobility flow');
await click('dialog[open] .type-form button[type=submit]');
await sleep(500);
check((await sessionOf('2026-11-08'))?.type === mob.id && (await store(`m.state.types.find(t => t.id === ${J(mob.id)}).name`)) === 'Mobility flow', 'rename: the logged day keeps the same type id');
const grip = (await store('m.state.types')).find((t) => t.name === 'Grip');
await click(`#types .type-row[data-type="${grip.id}"] button[aria-label^="Delete"]`);
await sleep(300);
check(/Delete Grip\?/.test(await text('dialog[open]')), 'no history: Delete');
await click('dialog[open] button[value=ok]');
await sleep(500);
check(!(await store(`m.state.types.some(t => t.id === ${J(grip.id)})`)), 'a type without history is deleted');
await click(`#types .type-row[data-type="${mob.id}"] button[aria-label^="Delete"]`);
await sleep(300);
check(/Archive Mobility flow\?/.test(await text('dialog[open]')), 'history: Archive instead of Delete');
await click('dialog[open] button[value=ok]');
await sleep(500);
check((await store(`m.state.types.find(t => t.id === ${J(mob.id)})?.archived`)) === true && (await exists('#types details.archived')), 'a type with history is archived, listed under Archived');
await go('#/cal/2026-11');
check((await cellOf('2026-11-08')) === 't-pink|MF', `past day keeps the archived type's name and colour (${await cellOf('2026-11-08')})`);
await go('#/progress/~consistency');
check(!(await ev(`/\\bt-[a-z]/.test(document.querySelector('main').innerText)`)) && (await exists('.cons-view, .consistency, main .card')), 'Consistency works with custom types (names, never raw ids)');
{
  const exp = await ev(`import('./js/store.js').then(m => JSON.parse(JSON.stringify(m.exportPayload())))`);
  check(exp.sessionTypes.some((t) => t.name === 'Chest + Triceps') && exp.sessionTypes.some((t) => t.archived) && exp.templates[broIds.Arms]?.length > 0, 'JSON export includes types (archived too) and their templates');
}
for (const width of [320, 412]) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 780, deviceScaleFactor: 2, mobile: true });
  for (const hash of ['#/plan', '#/cal/2026-11', '#/day/2026-11-23', '#/day/2026-11-26']) {
    await go(hash);
    const over = await ev(`(()=>{const w=innerWidth; return [...document.querySelectorAll('main *')].filter(e => { const r=e.getBoundingClientRect(); return r.width && (r.right > w + 1 || r.left < -1) && !e.closest('.hm-scroll, .chart-svg, .seg-scroll, .filter-row'); }).slice(0,3).map(e => e.className || e.tagName)})()`);
    check((await ev(`document.documentElement.scrollWidth <= innerWidth`)) && over.length === 0, `${width} px ${hash} (bro split): nothing spills sideways${over.length ? ` (${J(over)})` : ''}`);
  }
  await go('#/cal/2026-11');
  await ev(`document.querySelector('.cal-day[href="#/day/2026-11-24"]').scrollIntoView({ block: 'center' }); true`);
  await sleep(150);
  await shot(`41-calendar-bro-${width}`);
  await go('#/plan');
  await ev(`document.querySelector('#types').scrollIntoView({ block: 'start' }); true`);
  await sleep(150);
  await shot(`40-planner-types-${width}`);
  await go('#/day/2026-11-24');
  await shot(`42-day-bro-${width}`);
}
// Progress sub-tabs: a cut-off tab always sits under a visible edge fade, and every tab can be reached.
for (const width of [320, 360, 412]) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 780, deviceScaleFactor: 2, mobile: true });
  for (const hash of ['#/progress', '#/progress/~consistency']) {
    await go(hash);
    await sleep(150);
    const r = await ev(`(()=>{const n=document.querySelector('.seg-scroll'); const nr=n.getBoundingClientRect();
      const cut=[...n.querySelectorAll('.seg-btn')].map(b=>b.getBoundingClientRect()).map(b=>b.left < nr.left - 0.5 ? 'left' : b.right > nr.right + 0.5 ? 'right' : null).filter(Boolean);
      const mask=getComputedStyle(n).maskImage || getComputedStyle(n).webkitMaskImage;
      return { cut, left: n.classList.contains('more-left'), right: n.classList.contains('more-right'), mask: /gradient/.test(mask) }})()`);
    check(r.mask && r.cut.every((side) => (side === 'left' ? r.left : r.right)), `${width} px ${hash}: every cut-off tab sits under an edge fade (${J(r)})`);
  }
  await ev(`(()=>{const n=document.querySelector('.seg-scroll'); n.scrollLeft = n.scrollWidth; return true})()`);
  await sleep(200);
  check(await ev(`(()=>{const n=document.querySelector('.seg-scroll'); const nr=n.getBoundingClientRect(); const last=[...n.querySelectorAll('.seg-btn')].at(-1).getBoundingClientRect(); return last.right <= nr.right + 0.5 && (n.scrollWidth <= n.clientWidth || n.classList.contains('more-left')) && !n.classList.contains('more-right')})()`), `${width} px: scrolled to the end, the last tab shows in full and the fade moves to the left`);
  if (width === 320) { await go('#/progress/~records'); await shot('44-progress-tabs-320'); }
}
await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });

// ---------------- first run: every screen at 320 / 360 / 412, then the full flow ----------------
await ev(`import('./js/store.js').then((m) => m.eraseAll()).then(() => true)`);
await ev(`import('./js/views/onboarding.js').then((m) => { m.resetOnboardingDraft(); return true; })`);
await go('#/');
check((await ev('location.hash')) === '#/welcome/1', 'after Erase all data, the first-run flow shows again');
for (const width of [320, 412]) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 780, deviceScaleFactor: 2, mobile: true });
  for (let i = 1; i <= 5; i++) {
    await go(`#/welcome/${i}`);
    const over = await ev(`(()=>{const w=innerWidth; return [...document.querySelectorAll('main *')].filter(e => { const r=e.getBoundingClientRect(); return r.width && (r.right > w + 1 || r.left < -1); }).slice(0,3).map(e => e.className || e.tagName)})()`);
    const small = await ev(`[...document.querySelectorAll('.tile, .ob-next, .ob-back, .ob-skip, .ob-input')].filter(b => b.getClientRects().length).filter(b => b.getBoundingClientRect().height < 44).map(b => b.className)`);
    check((await ev(`document.documentElement.scrollWidth <= innerWidth`)) && over.length === 0 && small.length === 0, `${width} px onboarding ${i}: nothing spills sideways, every target ≥ 44 px${over.length || small.length ? ` (${J([...over, ...small])})` : ''}`);
    if (i === 4) {
      check((await text('#split-days-ppl')) === 'Mon Push, Wed Pull, Fri Legs' && (await text('#split-days-bro')) === 'Mon C+T, Tue B+B, Wed Legs, Thu Shldr, Fri Arms', `${width} px split cards list the actual days (“${await text('#split-days-ppl')}”)`);
      await pick('split', 'ppl');
      await sleep(500);
      const clear = `(()=>{const q=document.querySelector('fieldset.sessions').getBoundingClientRect(); const n=document.querySelector('.ob-actions .btn').getBoundingClientRect(); return q.bottom <= n.top + 0.5 && q.top >= 0})()`;
      check(await ev(clear), `${width} px step 4: picking a split brings Sessions per week fully into view above Next`);
      await ev(`document.querySelector('input[name=sessions][value="6"]').focus(); true`);
      await sleep(300);
      check(await ev(`(()=>{const t=document.querySelector('input[name=sessions][value="6"]').closest('.tile').getBoundingClientRect(); return t.bottom <= document.querySelector('.ob-actions .btn').getBoundingClientRect().top + 0.5})()`), `${width} px step 4: a focused sessions tile is never under Next`);
      await pick('sessions', '6');
      check((await text('#split-days-ppl')) === 'Mon Push, Tue Pull, Wed Legs, Thu Push, Fri Pull, Sat Legs', 'split days follow sessions per week');
      await ev(`import('./js/views/onboarding.js').then((m) => { m.resetOnboardingDraft(); return true; })`);
      await go('#/welcome/3');
      await go('#/welcome/4');
    }
    if (width === 320 && i === 4) { await ev(`window.scrollTo(0, document.documentElement.scrollHeight); true`); await sleep(200); } // as after picking a split
    if (width === 320 && [2, 4, 5].includes(i)) await shot(`3${i}-onboarding-${i}-320`);
  }
}
await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
await go('#/welcome/1');
// Keyboard: Tab from the heading reaches Back/Skip with a visible focus ring.
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
check(await ev(`(()=>{const a=document.activeElement; const cs=getComputedStyle(a); return a.matches(':focus-visible') && cs.outlineStyle === 'solid' && parseFloat(cs.outlineWidth) >= 2})()`), `keyboard focus is visible (${await ev('document.activeElement.className')})`);
await shot('31-onboarding-1');
await typeInto('#ob-name', 'Sam');
await click('.ob-next');
await sleep(450);
check((await store('m.state.profile.name')) === 'Sam' && (await ev('location.hash')) === '#/welcome/2', 'Next saves the name and moves on');
await pick('units', 'lb');
await pick('goal', 'strength');
check(await ev(`document.querySelectorAll('fieldset.ob-q legend').length === 2 && document.querySelector('input[name=goal][value=strength]').checked`), 'units and goal are radio groups with legends');
await shot('32-onboarding-2');
await click('.ob-next');
await sleep(450);
check(/2\.5 lb steps, 2:30 rest/.test(await ev(`document.querySelector('input[name=experience][value=veteran]').closest('.tile').textContent`)), 'experience options say what they set, in lb');
await pick('experience', 'veteran');
await shot('33-onboarding-3');
await click('.ob-back');
await sleep(400);
check((await ev(`document.querySelector('input[name=units][value=lb]').checked && document.querySelector('input[name=goal][value=strength]').checked`)), 'Back keeps your answers');
await click('.ob-next');
await sleep(400);
check(await ev(`document.querySelector('input[name=experience][value=veteran]').checked`), 'answer kept after going back and forward');
await click('.ob-next');
await sleep(450);
check(await ev(`['bro','arnold'].every(v => document.querySelector('input[name=split][value='+v+']'))`), 'onboarding offers Bro split and Arnold split');
await pick('split', 'ul');
await sleep(100);
check(await ev(`document.querySelector('input[name=sessions][value="4"]').checked`) && (await text('#split-days-ul')) === 'Mon Upper, Tue Lower, Thu Upper, Fri Lower', 'Upper/Lower pre-selects 4 sessions a week; its card lists the days');
await sleep(400);
check(await ev(`(()=>{const q=document.querySelector('fieldset.sessions').getBoundingClientRect(); const n=document.querySelector('.ob-actions .btn').getBoundingClientRect(); return q.bottom <= n.top + 0.5 && q.top >= 0})()`), '360 px step 4: Sessions per week fully visible above Next');
await shot('34-onboarding-4');
await click('.ob-next');
await sleep(450);
check(await ev(`[...document.querySelectorAll('.ob-week .plate-label')].map(l=>l.textContent).join(',') === 'Upper,Lower,Break,Upper,Lower,Break,Break'`), `“Your week” preview shows the Upper/Lower plan (${await ev(`[...document.querySelectorAll('.ob-week .plate-label')].map(l=>l.textContent).join(',')`)})`);
await typeInto('#ob-bw', '1000');
await click('.ob-next');
await sleep(300);
check((await ev('location.hash')) === '#/welcome/5' && /between 45 and 880 lb/.test(await text('#ob-error')) && (await ev(`document.querySelector('#ob-bw').getAttribute('aria-invalid')`)) === 'true', 'out-of-range bodyweight: inline error, field marked invalid');
await typeInto('#ob-bw', '180');
await typeInto('#ob-waist', '32');
check(!(await exists('#ob-ht')) && !/height/i.test(await text('main')), 'no height question in onboarding');
await shot('35-onboarding-5');
await click('.ob-next');
await sleep(800);
check((await ev('location.hash')) === '#/' && (await exists('.cal-view')), 'Start opens the Calendar');
{
  const p = await store('m.state.profile');
  const st = await store('m.state.settings');
  const body = await store('m.bodyEntries()');
  const week = (await store('m.state.schedule')).at(-1);
  check(p.onboarding === 'done' && p.name === 'Sam' && p.units === 'lb' && p.goal === 'strength' && p.experience === 'veteran' && p.split === 'ul' && p.sessionsPerWeek === 4 && p.heightCm === null, `profile saved (${J(p)})`);
  check(Math.abs(st.weightStep - 1.134) < 1e-3 && st.defaultRestSeconds === 150 && st.weeklyMin === 4, `answers → settings: 2.5 lb step, 2:30 rest, good week = 4 (${st.weightStep}, ${st.defaultRestSeconds}, ${st.weeklyMin})`);
  check(J(week.days) === J({ sun: 'Break', mon: 'Upper', tue: 'Lower', wed: 'Break', thu: 'Upper', fri: 'Lower', sat: 'Break' }) && week.from === TODAY, 'split fills the weekly plan from today');
  check(body.length === 1 && body[0].date === TODAY && Math.abs(body[0].weight - 81.6466) < 1e-3 && body[0].waist === 81.3, `bodyweight → first Body log entry, stored in kg/cm (${J(body)})`);
}
check((await text('.brand-row .brand-hi')) === 'Hi, Sam' && /180 lb/.test(await text('.weigh-btn')), 'Calendar: “Hi, Sam” and the weigh-in in lb');
await shot('37-calendar-after-onboarding');
await go('#/settings/profile');
check(await ev(`document.querySelector('input[name=split][value=ul]').checked && document.querySelector('input[name=goal][value=strength]').checked`), 'Profile shows the answers');
// A height stored by 1.8 (no longer asked) still travels with a backup.
await ev(`import('./js/store.js').then(async (m) => { await m.saveProfile({ heightCm: 180 }); return true; })`);
await go('#/settings');
check((await text('#profile .row-text strong')) === 'Sam' && (await text('#profile .row-text small')) === 'Goal: Get stronger', `Settings → Profile card: name and goal (“${await text('#profile .row-text')}”)`);
const exported = await ev(`import('./js/store.js').then(m => m.exportPayload())`);
check(exported.profile?.name === 'Sam' && exported.profile.units === 'lb' && exported.units === 'kg' && exported.schemaVersion === 7, 'JSON export includes the profile (data stays in kg)');
const reimported = await ev(`import('./js/model.js').then(m => m.migrateBackup(JSON.parse(${J(J(exported))})).profile)`);
check(reimported?.goal === 'strength' && reimported.split === 'ul' && reimported.heightCm === 180 && exported.profile.heightCm === 180, 'the profile (and a stored height) survives export → import');

// Custom: Start opens the Planner, and the plan is left alone.
await ev(`import('./js/store.js').then((m) => m.eraseAll()).then(() => true)`);
await go('#/');
for (let i = 1; i <= 3; i++) { await click('.ob-skip'); await sleep(400); }
await pick('split', 'custom');
await click('.ob-next');
await sleep(450);
await click('.ob-next');
await sleep(800);
check((await ev('location.hash')) === '#/plan' && (await store('m.state.profile.split')) === 'custom', 'Custom: Start opens the Planner');
check(J((await store('m.state.schedule')).at(-1).days) === J({ mon: 'Push', tue: 'Pull', wed: 'Legs', thu: 'Break', fri: 'Upper', sat: 'Lower', sun: 'Break' }), 'Custom keeps the existing plan');
check(externalRequests.length === 0, `no network calls outside the app${externalRequests.length ? `: ${externalRequests.slice(0, 3).join(', ')}` : ''}`);

// ---------------- home-screen icon (a preview page: the real launcher draws the installed icon) ----------------
// The app's service worker answers every navigation with the app shell, so bypass it for this page.
await go('#/');
await send('Network.setBypassServiceWorker', { bypass: true });
await send('Page.navigate', { url: `${BASE}tests/browser/home-screen.html` });
await sleep(800);
check(await ev(`document.title === 'VANE home-screen preview' && document.querySelectorAll('.app.vane img').length === 5 && [...document.images].every(i => i.complete && i.naturalWidth > 0)`), 'home-screen preview: all five VANE icons load');
check(await ev(`(()=>{const l=[...document.querySelectorAll('.app.vane .label')]; return l.length === 5 && l.every(x => x.textContent==='VANE' && x.scrollWidth <= x.clientWidth)})()`), 'home-screen label "VANE" fits without truncation');
await shot('28-home-icon');
await send('Network.setBypassServiceWorker', { bypass: false });
await send('Page.navigate', { url: BASE });
await sleep(1500);

check(consoleErrors.length === 0, `no console errors${consoleErrors.length ? `: ${consoleErrors.join(' | ')}` : ''}`);
console.log(`\n${failures ? `${failures} FAILED` : 'ALL PASSED'}  (screenshots: ${OUT})`);
finish(failures ? 1 : 0);
