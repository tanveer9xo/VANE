// Security: deep-link allow-list, import guard, malicious backups, CSP, service worker, workflow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRoute, MAX_HASH } from '../js/routes.js';
import { checkFileSize, checkJSONDepth, parseBackupText, MAX_IMPORT_BYTES, LIMITS, safeKey } from '../js/importguard.js';
import { migrateBackup, normalizeMuscles, normalizeTemplates, pickSettings } from '../js/model.js';
import { normalizeTypes } from '../js/types.js';
import { normalizeSplits } from '../js/splits.js';
import { normalizeProfile } from '../js/profile.js';
import { csvToBackup } from '../js/csv.js';
import { sessionCSS } from '../js/theme.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(join(root, f), 'utf8');
const XSS = ['<script>window.__xss=1</script>', '<img src=x onerror="window.__xss=2">', '"><svg onload=alert(1)>', 'javascript:alert(1)'];

test('deep links: only allow-listed routes and arguments', () => {
  const ok = (h, name, args = []) => assert.deepEqual(parseRoute(h), { name, args }, h);
  const bad = (h) => assert.equal(parseRoute(h).invalid, true, h);
  ok('', 'cal'); ok('#/', 'cal'); ok('#/cal/2026-11', 'cal', ['2026-11']);
  ok('#/day/2026-11-20', 'day', ['2026-11-20']); ok('#/plan', 'plan'); ok('#/timer', 'timer');
  ok('#/progress', 'progress'); ok('#/progress/~records', 'progress', ['~records']);
  ok('#/progress/~body/2026-11-01', 'progress', ['~body', '2026-11-01']);
  ok('#/progress/~body/x', 'progress', ['~body']);
  ok('#/progress/db%20chest%20press', 'progress', ['db chest press']);
  ok('#/settings/nutrition', 'settings', ['nutrition']); ok('#/welcome/3', 'welcome', ['3']); ok('#/body', 'body');
  for (const h of ['#/day/2026-13-45', '#/day/../../etc', '#/cal/2026-99', '#/settings/evil', '#/welcome/9', '#/plan/x', '#/nope',
    '#/javascript:alert(1)', '#/progress/%E0%A4%A', '#/progress/a%00b', '#/progress/~secret', '#/progress/a/b', `#/progress/${'x'.repeat(MAX_HASH)}`,
    '#/day//2026-11-20', '#/__proto__', '#/constructor']) bad(h);
});

test('import guard: size, nesting depth, broken JSON', () => {
  assert.throws(() => checkFileSize(MAX_IMPORT_BYTES + 1), /too big .* limit is 20 MB/);
  checkFileSize(MAX_IMPORT_BYTES);
  assert.throws(() => checkJSONDepth('['.repeat(40) + ']'.repeat(40)), /nested too deeply/);
  checkJSONDepth('{"a":"[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[["}', 32); // brackets inside strings don't count
  assert.throws(() => parseBackupText('{"sessions": [}'), /isn’t valid JSON/);
  assert.throws(() => parseBackupText(`${'['.repeat(100000)}${']'.repeat(100000)}`), /nested too deeply/, 'no stack overflow');
  assert.equal(safeKey('__proto__'), false);
  assert.equal(safeKey('constructor'), false);
  assert.equal(safeKey('Push'), true);
});

test('a malicious backup: script text stays text, prototype keys are ignored, nothing is polluted', () => {
  const payload = JSON.parse(`{
    "schemaVersion": 10,
    "sessions": [{ "date": "2026-11-10", "type": "__proto__", "notes": ${JSON.stringify(XSS[0])},
      "exercises": [{ "name": ${JSON.stringify(XSS[1])}, "sets": [{ "weight": "1e999", "reps": {"x": 1} }] }] }],
    "sessionTypes": [{ "id": "__proto__", "name": "x" }, { "id": "constructor", "name": "y" }, { "id": "t-evil", "name": ${JSON.stringify(XSS[2])} }],
    "templates": { "__proto__": [{ "name": "a" }], "t-evil": [{ "name": ${JSON.stringify(XSS[3])} }] },
    "muscles": { "__proto__": "Chest", "constructor": "Back", "bench": "Chest" },
    "settings": { "__proto__": { "polluted": 1 }, "constructor": { "prototype": { "polluted": 1 } }, "weekStartsOn": 0 },
    "profile": { "__proto__": { "polluted": 1 }, "name": ${JSON.stringify(XSS[1])} },
    "splits": [{ "id": "__proto__", "name": "x", "days": { "mon": "Push" }, "types": [] }],
    "body": [{ "date": "2026-11-10", "weight": 80, "__proto__": { "polluted": 1 } }]
  }`);
  const out = migrateBackup(payload);
  assert.equal(({}).polluted, undefined, 'Object.prototype untouched');
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(out.sessions[0].type, 'Other', 'a "__proto__" type id is not trusted');
  assert.equal(out.sessions[0].notes, XSS[0], 'kept as plain text (rendered with textContent)');
  assert.equal(out.sessions[0].exercises[0].name, XSS[1].slice(0, 80).replace(/\s+/g, ' ').trim());
  assert.equal(out.sessions[0].exercises[0].sets[0].weight, null, 'non-numbers dropped');
  assert.deepEqual(out.sessionTypes.map((t) => t.id), ['t-evil'], 'prototype ids dropped');
  assert.equal(Object.getPrototypeOf(out.templates), Object.prototype, 'templates object keeps a normal prototype');
  assert.ok(!Object.prototype.hasOwnProperty.call(out.templates, '__proto__'));
  assert.deepEqual(Object.keys(out.muscles), ['bench']);
  assert.deepEqual(out.settings, { weekStartsOn: 0 }, 'settings: known keys only');
  assert.equal(out.profile.name, XSS[1].replace(/\s+/g, ' ').trim().slice(0, 40));
  assert.ok(!('polluted' in out.profile));
  assert.deepEqual(out.splits, []);
  assert.ok(!('polluted' in out.body[0]));
});

test('wrong types are refused or cleaned, with a clear message', () => {
  assert.throws(() => migrateBackup(null), /not a workout backup/);
  assert.throws(() => migrateBackup('hello'), /not a workout backup/);
  assert.throws(() => migrateBackup({ schemaVersion: 10, sessions: 'nope' }), /not a workout backup/);
  assert.throws(() => migrateBackup({ schemaVersion: 99, sessions: [] }), /newer version/);
  const out = migrateBackup({ schemaVersion: 10, sessions: [{ date: 5 }, 'x', null, []], body: { a: 1 }, settings: [], profile: 'me', splits: 7, nutrition: [], intake: 'x', sessionTypes: {} });
  assert.equal(out.sessions.length, 0);
  assert.equal(out.skipped, 4);
  assert.deepEqual(out.body, []);
  assert.deepEqual(out.settings, {});
  assert.deepEqual(out.splits, []);
  assert.equal(out.sessionTypes, null);
});

test('huge arrays: refused past the limits; per-item lists capped', () => {
  const many = Array.from({ length: LIMITS.sessions + 1 }, (_, i) => ({ date: '2026-01-01', type: null, exercises: [], n: i }));
  assert.throws(() => migrateBackup({ schemaVersion: 10, sessions: many }), /at most 20,000/);
  assert.throws(() => migrateBackup({ schemaVersion: 10, sessions: [], body: Array(LIMITS.body + 1).fill({}) }), /Body log entries; VANE imports at most 20,000/);
  const big = migrateBackup({ schemaVersion: 10, sessions: [{ date: '2026-11-10', type: 'Push', exercises: Array.from({ length: 500 }, (_, i) => ({ name: `E${i}`, sets: Array(500).fill({ weight: 1, reps: 1 }) })) }] });
  assert.equal(big.sessions[0].exercises.length, LIMITS.exercisesPerSession);
  assert.equal(big.sessions[0].exercises[0].sets.length, LIMITS.setsPerExercise);
  assert.equal(normalizeTypes(Array.from({ length: 500 }, (_, i) => ({ id: `t-${i}`, name: `T${i}` }))).length, 100);
  const sp = normalizeSplits([{ id: 's-1', name: 'S', days: { mon: 'A' }, types: [{ id: 'A', name: 'A' }], templates: { A: Array(500).fill({ name: 'x', sets: 'lots', evil: '<b>' }) } }]);
  assert.equal(sp[0].templates.A.length, 40);
  assert.deepEqual(Object.keys(sp[0].templates.A[0]).sort(), ['name', 'repsMax', 'repsMin', 'restSeconds', 'sets', 'weightStep'], 'only known fields');
});

test('normalisers never assign prototype keys', () => {
  assert.deepEqual(normalizeMuscles(JSON.parse('{"__proto__":"Chest"}')), {});
  assert.equal(Object.getPrototypeOf(normalizeTemplates(JSON.parse('{"__proto__":[{"name":"x"}]}'))), Object.prototype);
  assert.ok(!('polluted' in pickSettings(JSON.parse('{"__proto__":{"polluted":1}}'))));
  assert.ok(!('polluted' in normalizeProfile(JSON.parse('{"__proto__":{"polluted":1}}'))));
  const csv = csvToBackup('date,session type,exercise,set number,__proto__\r\n2026-11-11,Push,"<img src=x onerror=alert(1)>",1,x\r\n');
  assert.equal(csv.sessions[0].exercises[0].name, '<img src=x onerror=alert(1)>');
  assert.equal(({}).polluted, undefined);
});

test('CSP: strict meta tag, no inline script or style in the page', () => {
  const html = read('index.html');
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
  assert.ok(csp, 'CSP meta present');
  for (const d of ["default-src 'self'", "script-src 'self'", "style-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"]) assert.ok(csp.includes(d), d);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https?:|\*/, 'no inline, no eval, no external hosts');
  assert.doesNotMatch(html.replace(/<!--[\s\S]*?-->/g, ''), /<script(?![^>]*\bsrc=)[^>]*>|<style\b|\sstyle="|\son[a-z]+="/i, 'no inline script, style or handlers');
  assert.match(html, /<script src="js\/boot\.js"><\/script>/);
  assert.equal(read('css/sessions.css').split('\n').slice(1).join('\n').trim(), sessionCSS(), 'css/sessions.css matches js/theme.js (npm run css)');
  assert.match(read('js/boot.js'), /window\.top !== window\.self/, 'refuses to run in a frame');
});

test('code: no eval, no string timers, no HTML sinks fed with data; external links don’t leak', () => {
  const files = ['js/ui.js', 'js/app.js', 'js/pwa.js', 'js/store.js', 'js/views/settings.js', 'js/views/day.js', 'js/views/planner.js', 'js/views/body.js', 'js/views/nutrition.js'];
  for (const f of files) {
    const src = read(f);
    assert.doesNotMatch(src, /\beval\(|new Function\(|document\.write|insertAdjacentHTML|outerHTML/, f);
    assert.doesNotMatch(src, /setTimeout\(\s*['"`]/, `${f}: string timer`);
  }
  for (const m of read('js/views/settings.js').matchAll(/target: '_blank'[^)]*/g)) assert.match(m[0], /rel: 'noopener noreferrer'/);
});

test('service worker: same-origin GET inside its own path only; versioned cache; old caches of this app only', () => {
  const sw = read('sw.js');
  assert.match(sw, /if \(req\.method !== 'GET'\) return;/);
  assert.match(sw, /url\.origin !== self\.location\.origin \|\| !url\.pathname\.startsWith\(SCOPE_PATH\)/);
  assert.match(sw, /res\.ok && res\.type === 'basic' && !res\.redirected/);
  assert.match(sw, /cache: 'reload'/);
  assert.match(sw, /key\.startsWith\('workout-tracker-'\) && key !== CACHE/);
  assert.match(read('js/pwa.js'), /updateViaCache: 'none'/);
});

test('workflow: actions pinned to commit SHAs, least-privilege permissions; Dependabot on', () => {
  const wf = read('.github/workflows/pages.yml');
  const uses = [...wf.matchAll(/uses: ([^\s#]+)/g)].map((m) => m[1]);
  assert.ok(uses.length >= 5);
  for (const u of uses) assert.match(u, /@[0-9a-f]{40}$/, `${u} is pinned to a full commit SHA`);
  assert.match(wf, /^permissions:\n {2}contents: read$/m, 'workflow default: read-only');
  assert.match(wf, /deploy:[\s\S]*permissions:\n\s+contents: read\n\s+pages: write\n\s+id-token: write/, 'only deploy can write Pages');
  assert.ok(existsSync(join(root, '.github/dependabot.yml')));
  assert.ok(existsSync(join(root, 'SECURITY.md')));
});
