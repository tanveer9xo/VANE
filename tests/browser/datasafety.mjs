// Data safety across data-format changes, in a real browser on the built site under /VANE/ (IndexedDB for real):
//   - older stored data: snapshot first, then migrated, verified, written at once; nothing lost
//   - a migration whose check fails (a record the new format can't read): rolled back — the stored data is
//     byte-for-byte what it was — and a clear screen with an Export button for the snapshot
//   - data from a newer version (a stale cached copy of the app): "Update VANE to open this data", nothing written
//   - only the last 2 snapshots are kept; Settings → Backup shows storage protection and the last backup
//   node tests/browser/datasafety.mjs      (npm run test:datasafety)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite } from '../../tools/build-site.mjs';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CDP = 9341;
const HTTP = 8771;
const BASE = `http://127.0.0.1:${HTTP}/VANE/`;
const WORK = mkdtempSync(join(tmpdir(), 'vane-datasafety-'));
const DOWNLOADS = join(WORK, 'downloads');
mkdirSync(DOWNLOADS);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;

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
setTimeout(() => { console.error('ERROR timed out after 5 minutes'); finish(3); }, 5 * 60000).unref();

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
const text = (sel) => ev(`document.querySelector(${J(sel)})?.textContent ?? ''`);
const exists = (sel) => ev(`!!document.querySelector(${J(sel)})`);
const reload = async () => { await send('Page.reload', {}); await sleep(2200); };
/** Every record, straight from IndexedDB (not through the app). */
const raw = () => ev(`import('./js/db.js').then(async (db) => { const r = await db.readAll(); return JSON.stringify(r); })`);
const snapshots = () => ev(`import('./js/db.js').then(async (db) => (await db.getSnapshots()).map((s) => ({ id: s.id, from: s.fromVersion, to: s.toVersion, n: s.data.sessions.length })))`);
/** Replace all stored data with these records (as an older version of the app would have left them). */
const writeRaw = (data) => ev(`import('./js/db.js').then((db) => db.run(['sessions', 'exercises', 'meta', 'body'], 'readwrite', (tx) => {
  const d = ${J(data)};
  for (const n of ['sessions', 'exercises', 'meta', 'body']) tx.objectStore(n).clear();
  d.sessions.forEach((s) => tx.objectStore('sessions').put(s));
  d.body.forEach((s) => tx.objectStore('body').put(s));
  Object.entries(d.meta).forEach(([key, value]) => tx.objectStore('meta').put({ key, value }));
})).then(() => true)`);

// Realistic data as version 1.13 (format v10) stored it.
const set = (weight, reps, extra = {}) => ({ weight, reps, done: true, type: 'working', ...extra });
const ex = (name, sets) => ({ id: `${name}-1`, name, target: { sets: 3, repsMin: 8, repsMax: 10 }, weightStep: null, restSeconds: null, hintDismissed: false, note: '', sets });
const s10 = (date, type, exercises, extra = {}) => ({ v: 10, date, type, notes: '', cardioMinutes: null, startedAt: null, finishedAt: null, createdAt: 1, updatedAt: 2, exercises, ...extra });
const V10 = {
  sessions: [
    s10('2026-11-16', 'Push', [ex('DB Chest Press', [set(15, 10, { type: 'warmup' }), set(30, 8), set(30, 7)]), ex('Lateral Raise', [set(8, 12), set(8, 11)])], { finishedAt: 5, cardioMinutes: 20 }),
    s10('2026-11-17', 't-arms', [ex('EZ-Bar Curl', [set(25, 10), set(25, 9)])]),
    s10('2026-11-18', 'Legs', [ex('Squat', [set(100, 5), set(100, 5), set(100, 4, { done: false })])], { notes: 'heavy' }),
    s10('2026-11-19', 'Break', []),
  ],
  body: [{ date: '2026-11-16', weight: 81.2, waist: 86, chest: 101, updatedAt: 1 }, { date: '2026-11-18', weight: 80.9, waist: null, updatedAt: 1 }],
  meta: {
    schemaVersion: 10,
    settings: { weekStartsOn: 1, weightStep: 2.5, defaultRestSeconds: 120, defaultCardioMinutes: 20, appearance: 'system' },
    schedule: [{ from: '2026-11-01', days: { sun: 'Break', mon: 'Push', tue: 't-arms', wed: 'Legs', thu: 'Break', fri: 'Push', sat: 'Break' } }],
    templates: { Push: [{ name: 'DB Chest Press', sets: 4, repsMin: 6, repsMax: 10, weightStep: null, restSeconds: 150 }], 't-arms': [{ name: 'EZ-Bar Curl', sets: 3, repsMin: 8, repsMax: 12, weightStep: null, restSeconds: null }] },
    profile: { name: 'Sam', units: 'kg', goal: 'muscle', experience: 'mid', split: 'ppl', sessionsPerWeek: 3, heightCm: 180, onboarding: 'done', setupCardDismissed: true, updatedAt: 1 },
    sessionTypes: [
      { id: 'Push', name: 'Push', short: 'Push', color: 'red', kind: 'lift', builtin: true, hidden: false, archived: false, order: 0 },
      { id: 'Legs', name: 'Legs', short: 'Legs', color: 'gold', kind: 'lift', builtin: true, hidden: false, archived: false, order: 1 },
      { id: 'Cardio', name: 'Cardio', short: 'Cardio', color: 'cyan', kind: 'cardio', builtin: true, hidden: false, archived: false, order: 2 },
      { id: 't-arms', name: 'Arms', short: 'Arms', color: 'pink', kind: 'lift', builtin: false, hidden: false, archived: false, order: 3 },
    ],
    splits: [{ id: 's-1', name: 'My week', days: { sun: 'Break', mon: 'Push', tue: 't-arms', wed: 'Legs', thu: 'Break', fri: 'Push', sat: 'Break' }, types: [{ id: 'Push', name: 'Push', short: 'Push', color: 'red', kind: 'lift' }], templates: { Push: [] }, createdAt: 1, updatedAt: 1 }],
    nutrition: { enabled: false }, intake: {}, lastExportAt: 1763290000000,
  },
};

await send('Page.enable');
await send('Runtime.enable');
await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS, eventsEnabled: false }).catch(() => {});
await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: BASE });
await sleep(2200);

// ---- 1. Older data: snapshot, migrate, verify, write once ----
await writeRaw(V10);
const before = JSON.parse(await raw());
await reload();
check(!(await exists('#blocked')) && (await exists('.cal-view')), 'format v10 data opens after the update');
const after = JSON.parse(await raw());
const snaps1 = await snapshots();
check(snaps1.length === 1 && snaps1[0].from === 10 && snaps1[0].n === 4, `a snapshot was taken first (${J(snaps1)})`);
check(after.meta.schemaVersion === 12 && after.sessions.every((s) => s.v === 12), 'the data is now format 12, every record');
const setsOf = (sessions) => sessions.flatMap((s) => s.exercises.filter((e) => e.kind !== 'cardio').flatMap((e) => e.sets.map((x) => [s.date, e.name, x.weight, x.reps, x.done, x.type])));
check(after.sessions.length === before.sessions.length && J(setsOf(after.sessions)) === J(setsOf(before.sessions)), 'every workout and every set unchanged');
check(J(after.sessions.map((s) => [s.date, s.type])) === J(before.sessions.map((s) => [s.date, s.type])), 'every session type unchanged');
check(J(after.body) === J(before.body) && J(after.meta.sessionTypes) === J(before.meta.sessionTypes)
  && J(after.meta.profile) === J(before.meta.profile), 'Body log, types and profile unchanged');
// v12: the old 20-minute default treadmill is now Treadmill (20 min), last in each template and saved split.
// (Each template the old data had, compared without cardio; types it had no template for get the defaults.)
const noCardio = (t, keys = Object.keys(before.meta.templates)) => J(keys.map((k) => (t?.[k] ?? []).filter((i) => i.kind !== 'cardio')));
const tread = { name: 'Treadmill', kind: 'cardio', minutes: 20 };
check(noCardio(after.meta.templates) === noCardio(before.meta.templates) && J(after.meta.templates.Push.at(-1)) === J(tread)
  && J(after.meta.templates['t-arms'].at(-1)) === J(tread) && J(after.meta.templates.Cardio) === J([tread]),
  `templates keep every exercise, plus Treadmill (20 min) from the old setting (${J(after.meta.templates.Push.map((i) => i.name))})`);
check(J(after.meta.splits.map((sp) => [sp.id, sp.name, sp.days, sp.types])) === J(before.meta.splits.map((sp) => [sp.id, sp.name, sp.days, sp.types]))
  && after.meta.splits.every((sp) => J(sp.templates.Push?.at(-1)) === J(tread)),
  'saved splits kept, with Treadmill in their templates');
check(!('defaultCardioMinutes' in after.meta.settings), 'the old setting is gone from storage');
check(after.sessions[0].exercises.some((e) => e.kind === 'cardio' && e.name === 'Treadmill' && e.cardio.minutes === 20 && e.cardio.done), 'old treadmill minutes became a Treadmill entry');

// ---- 2. A migration whose check fails: rolled back, explained, exportable ----
const corrupt = structuredClone(V10);
corrupt.sessions.push(s10('2026-02-30', 'Push', [ex('Bench', [set(60, 5)])])); // a date that doesn't exist: v11 can't read it
await writeRaw(corrupt);
const beforeFail = await raw();
await reload();
check(await exists('#blocked'), 'a failed check: the app shows the recovery screen instead');
check(/couldn’t update your data/.test(await text('#blocked h1')) && /nothing was changed/i.test(await text('#blocked')) && /workouts: 5 before, 4 after/.test(await text('#blocked')), `…saying what happened (“${(await text('#blocked .fine')).slice(0, 80)}”)`);
check((await raw()) === beforeFail, 'rolled back: the stored data is byte for byte what it was');
check(!(await ev(`getComputedStyle(document.querySelector('.tabbar')).display !== 'none'`)), 'nothing else can run (no tab bar)');
await ev(`location.hash = '#/settings'; true`);
await sleep(500);
check((await raw()) === beforeFail && (await exists('#blocked')), 'navigating does nothing either');
await ev(`document.getElementById('blocked-export').click(); true`);
await sleep(1500);
const files = readdirSync(DOWNLOADS).filter((f) => f.endsWith('.json'));
const exported = files.length ? JSON.parse(readFileSync(join(DOWNLOADS, files[0]), 'utf8')) : null;
check(exported?.sessions?.length === 5 && exported.schemaVersion === 10 && /Snapshot taken before/.test(exported.note), `Export downloads the snapshot as a backup (${files[0] ?? 'nothing downloaded'})`);
check((await ev(`import('./js/model.js').then((m) => { try { return m.migrateBackup(${J(exported)}).sessions.length; } catch (e) { return e.message; } })`)) === 4, 'that file imports (the unreadable record is skipped and reported on import)');
check((await snapshots()).length === 2, 'two snapshots now (each attempt is kept, at most 2)');

// ---- 3. Data from a newer version: don't touch it ----
await writeRaw({ ...V10, meta: { ...V10.meta, schemaVersion: 99 } });
const beforeNewer = await raw();
await reload();
check(/Update VANE to open this data/.test(await text('#blocked h1')) && /format 99/.test(await text('#blocked')) && (await exists('#blocked-update')), 'newer data: “Update VANE to open this data”, with Update now');
await sleep(1500);
check((await raw()) === beforeNewer, 'newer data: nothing read-modify-written');

// ---- 4. Snapshots: only the last 2 are kept ----
await writeRaw(V10);
await reload();
const snaps3 = await snapshots();
check(snaps3.length === 2 && snaps3[0].id > snaps1[0].id && !snaps3.some((x) => x.id === snaps1[0].id), `only the last 2 snapshots are kept (${snaps3.map((x) => x.id).join(', ')})`);
check(!(await exists('#blocked')) && (await ev(`import('./js/store.js').then((m) => m.allSessions().length)`)) === 4, 'and the app opens normally on the migrated data');

// ---- 4b. A 1.15 phone (format 11) whose settings were saved since, so the old treadmill setting is gone from
// them: the snapshot taken before 1.15 still has it, and it's used. ----
const migrated = JSON.parse(await raw());
const { defaultCardioMinutes: _old, ...settings11 } = V10.meta.settings;
await writeRaw({
  sessions: migrated.sessions.map((x) => ({ ...x, v: 11 })), body: V10.body,
  meta: { ...V10.meta, schemaVersion: 11, settings: settings11 },
});
await reload();
const after11 = JSON.parse(await raw());
check(!(await exists('#blocked')) && after11.meta.schemaVersion === 12 && J(after11.meta.templates.Push.at(-1)) === J(tread),
  `format 11 without the setting: Treadmill (20 min) from the pre-1.15 snapshot (${J(after11.meta.templates.Push.map((i) => [i.name, i.minutes ?? null]))})`);
check(J(after11.sessions.map((x) => x.exercises.length)) === J(migrated.sessions.map((x) => x.exercises.length)), 'workouts unchanged (no second Treadmill entry)');

// ---- 5. Settings → Backup: storage protection, last backup ----
await ev(`location.hash = '#/settings'; true`);
await sleep(700);
check(/Storage protected: (Yes|Not guaranteed)/.test(await text('#storage-line')) && (await text('#storage-line + .fine')).length > 20, `Settings → Backup: “${await text('#storage-line')}” with a short explanation`);
check(/Last backup: .*\d/.test(await text('#last-backup')), `the date of the last backup (“${await text('#last-backup')}”)`);
check(errors.length === 0, `no script errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);

console.log(`\n${failures ? `${failures} FAILED` : 'ALL PASSED'}  (${BASE})`);
finish(failures ? 1 : 0);
