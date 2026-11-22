import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseWeight, parseReps, parseMinutes, normalizeSession, migrateBackup, mergeSessions, newSession, newExercise,
  isSessionEmpty, exerciseKey, upgradeSessionRecord, SCHEMA_VERSION, APP_VERSION, DEFAULT_EXERCISES,
} from '../js/model.js';

test('parseWeight handles decimals, commas and junk', () => {
  assert.equal(parseWeight('22.5'), 22.5);
  assert.equal(parseWeight('22,5'), 22.5);
  assert.equal(parseWeight(' 100 '), 100);
  assert.equal(parseWeight('22.'), 22);
  assert.equal(parseWeight('.5'), 0.5);
  assert.equal(parseWeight('0'), 0); // bodyweight
  assert.equal(parseWeight('1.256'), 1.26);
  assert.equal(parseWeight(''), null);
  assert.equal(parseWeight('abc'), null);
  assert.equal(parseWeight('-5'), null);
  assert.equal(parseWeight('1e3'), null);
  assert.equal(parseWeight(42.5), 42.5);
  assert.equal(parseWeight(NaN), null);
});

test('parseReps only accepts whole numbers', () => {
  assert.equal(parseReps('8'), 8);
  assert.equal(parseReps('8.5'), null);
  assert.equal(parseReps(''), null);
  assert.equal(parseReps(12), 12);
  assert.equal(parseReps('1000'), null);
});

test('parseMinutes', () => {
  assert.equal(parseMinutes('20'), 20);
  assert.equal(parseMinutes('12,5'), 12.5);
  assert.equal(parseMinutes('2000'), null);
});

test('default exercise list is seeded', () => {
  assert.equal(DEFAULT_EXERCISES.length, 20);
  assert.ok(DEFAULT_EXERCISES.includes('Romanian Deadlift'));
});

test('newSession prefills default cardio; empty detection ignores untouched default', () => {
  const s = newSession('2026-11-19', { defaultCardioMinutes: 20, weekStartsOn: 1 });
  assert.equal(s.cardioMinutes, 20);
  assert.equal(s.v, SCHEMA_VERSION);
  assert.ok(isSessionEmpty(s));
  assert.ok(!isSessionEmpty({ ...s, type: 'Push' }));
  assert.ok(!isSessionEmpty({ ...s, cardioMinutes: 35 }));
  assert.ok(!isSessionEmpty({ ...s, notes: 'felt good' }));
  assert.ok(!isSessionEmpty({ ...s, exercises: [newExercise('Squat')] }));
});

test('newExercise copies sets (not references) and defaults to one blank set', () => {
  const src = [{ weight: 35, reps: 8 }];
  const ex = newExercise('  db   chest press ', src);
  assert.equal(ex.name, 'db chest press');
  src[0].weight = 99;
  assert.equal(ex.sets[0].weight, 35);
  assert.deepEqual(newExercise('Squat').sets, [{ weight: null, reps: null, done: false, type: 'working' }]);
  assert.equal(ex.sets[0].done, false); // copied sets must be ticked to count
});

test('exerciseKey is case and whitespace insensitive', () => {
  assert.equal(exerciseKey('  Lat   Pulldown '), exerciseKey('lat pulldown'));
});

test('normalizeSession rejects bad dates and coerces fields', () => {
  assert.equal(normalizeSession({ date: '2026-02-30' }), null);
  assert.equal(normalizeSession(null), null);
  const s = normalizeSession({
    date: '2026-11-19', type: 'Arms', cardioMinutes: '15',
    exercises: [{ name: 'Curl', sets: [{ weight: '12,5', reps: '10' }, { weight: 'x', reps: 3 }] }, { name: '' }],
  });
  assert.equal(s.type, 'Other');
  assert.equal(s.cardioMinutes, 15);
  assert.equal(s.exercises.length, 1);
  assert.deepEqual(s.exercises[0].sets, [{ weight: 12.5, reps: 10, done: true, type: 'working' }, { weight: null, reps: 3, done: true, type: 'working' }]);
  assert.equal(s.notes, '');
});

test('migrateBackup upgrades an unversioned array (v0)', () => {
  const out = migrateBackup([{ date: '2026-01-02', type: 'Push', exercises: [] }, { date: 'bad' }]);
  assert.equal(out.sessions.length, 1);
  assert.equal(out.skipped, 1);
  assert.equal(out.sessions[0].v, SCHEMA_VERSION);
});

test('migrateBackup merges two sessions on the same date (one per day)', () => {
  const out = migrateBackup({
    schemaVersion: 1,
    sessions: [
      { date: '2026-01-02', type: 'Push', exercises: [{ name: 'Squat', sets: [{ weight: 100, reps: 5 }] }], notes: 'am' },
      { date: '2026-01-02', type: 'Cardio', cardioMinutes: 20, exercises: [{ name: 'squat', sets: [{ weight: 110, reps: 3 }] }], notes: 'pm' },
    ],
  });
  assert.equal(out.sessions.length, 1);
  const s = out.sessions[0];
  assert.equal(s.type, 'Push');
  assert.equal(s.exercises.length, 1);
  assert.equal(s.exercises[0].sets.length, 2);
  assert.equal(s.notes, 'am\n\npm');
  assert.equal(s.cardioMinutes, 20);
});

test('migrateBackup refuses newer schemas and junk', () => {
  assert.throws(() => migrateBackup({ schemaVersion: SCHEMA_VERSION + 1, sessions: [] }), /newer version/);
  assert.throws(() => migrateBackup('nope'), /not a workout backup/);
  assert.throws(() => migrateBackup({ schemaVersion: 1, foo: 1 }), /not a workout backup/);
});

test('migrateBackup sanitises settings and custom exercises', () => {
  const out = migrateBackup({ schemaVersion: 1, sessions: [], customExercises: ['Hip Thrust', { name: 'Dips' }, 3], settings: { weekStartsOn: 0, defaultCardioMinutes: 'x', evil: 1 } });
  assert.deepEqual(out.customExercises, ['Hip Thrust', 'Dips']);
  assert.deepEqual(out.settings, { weekStartsOn: 0 });
});

test('upgradeSessionRecord leaves current records untouched', () => {
  const s = newSession('2026-11-19');
  assert.deepEqual(upgradeSessionRecord(s), { session: s, changed: false });
  const legacy = upgradeSessionRecord({ date: '2026-11-19', exercises: [] });
  assert.equal(legacy.changed, true);
  assert.equal(legacy.session.v, SCHEMA_VERSION);
});

test('mergeSessions keeps first type, sums cardio', () => {
  const a = { ...newSession('2026-01-01'), type: null, cardioMinutes: 10 };
  const b = { ...newSession('2026-01-01'), type: 'Legs', cardioMinutes: 5 };
  const m = mergeSessions(a, b);
  assert.equal(m.type, 'Legs');
  assert.equal(m.cardioMinutes, 15);
});

test('service worker precaches every app file and matches APP_VERSION', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  assert.match(sw, new RegExp(`const VERSION = '${APP_VERSION.replace(/\./g, '\\.')}'`));
  const walk = (dir) => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  const files = ['js', 'css', 'icons', 'fonts', 'data'].flatMap((d) => walk(join(root, d))).filter((p) => !p.endsWith('.txt')).map((p) => `./${relative(root, p)}`);
  for (const f of [...files, './index.html', './manifest.webmanifest']) {
    assert.ok(sw.includes(`'${f}'`), `sw.js ASSETS is missing ${f}`);
  }
});


test('v1 → current: stored sessions get done working sets, target, rest, step and note fields', () => {
  const v1 = { v: 1, date: '2026-11-01', type: 'Push', notes: '', cardioMinutes: null, createdAt: 1, updatedAt: 1,
    exercises: [{ id: 'a', name: 'Squat', sets: [{ weight: 100, reps: 5 }] }] };
  const { session, changed } = upgradeSessionRecord(v1);
  assert.equal(changed, true);
  assert.equal(session.v, 7);
  assert.deepEqual(session.exercises[0].sets, [{ weight: 100, reps: 5, done: true, type: 'working' }]);
  assert.equal(session.exercises[0].note, '');
  assert.equal(session.startedAt, null);
  assert.equal(session.finishedAt, null);
  assert.equal(session.exercises[0].target, null);
  assert.equal(session.exercises[0].restSeconds, null);
  assert.equal(session.exercises[0].weightStep, null);
});

test('v1 backup from app 1.1 (schedule/templates in settings) migrates to v2', () => {
  const out = migrateBackup({
    schemaVersion: 1,
    exportedAt: '2026-11-19T10:00:00.000Z',
    sessions: [{ v: 1, date: '2026-11-18', type: 'Legs', exercises: [{ name: 'Squat', sets: [{ weight: 100, reps: 5 }] }] }],
    settings: { weekStartsOn: 1, schedule: ['Rest', 'Push', 'Pull', 'Legs', 'Rest', 'Upper', 'Lower'], templates: { Push: ['Bench', 'Dips'] } },
  });
  assert.equal(out.sessions[0].exercises[0].sets[0].done, true);
  assert.equal(out.schedule.length, 1);
  assert.deepEqual(out.schedule[0].days, { sun: 'Break', mon: 'Push', tue: 'Pull', wed: 'Legs', thu: 'Break', fri: 'Upper', sat: 'Lower' });
  assert.match(out.schedule[0].from, /^2026-11-(19|20)$/); // local date of exportedAt
  assert.deepEqual(out.templates.Push.map((t) => t.name), ['Bench', 'Dips']);
  assert.deepEqual(out.templates.Push[0], { name: 'Bench', sets: 3, repsMin: 8, repsMax: 12, weightStep: null, restSeconds: null });
  assert.deepEqual(out.body, []);
  assert.equal(out.templates.Legs[0].name, 'Squat'); // missing types fall back to defaults
  assert.deepEqual(out.settings, { weekStartsOn: 1 });
});

test('v2 backup round-trips schedule versions and templates', () => {
  const schedule = [
    { from: '2026-11-01', days: { mon: 'Push', tue: 'Pull', wed: 'Legs', thu: 'Break', fri: 'Upper', sat: 'Lower', sun: 'Break' } },
    { from: '2026-11-20', days: { mon: 'Full body', tue: null, wed: 'Bogus', thu: 'Break', fri: 'Upper', sat: 'Lower', sun: 'Break' } },
  ];
  const out = migrateBackup({ schemaVersion: 2, sessions: [], schedule, templates: { Push: [{ name: 'Bench', sets: 5, repsMin: 12, repsMax: 6 }] } });
  assert.equal(out.schedule.length, 2);
  assert.equal(out.schedule[1].days.wed, null);
  assert.equal(out.schedule[1].days.mon, 'Full body');
  assert.deepEqual(out.templates.Push[0], { name: 'Bench', sets: 5, repsMin: 6, repsMax: 12, weightStep: null, restSeconds: null }); // swapped range; no step = the default
  assert.equal(migrateBackup({ schemaVersion: 2, sessions: [] }).schedule, null);
});

test('targets: normalise and format', async () => {
  const { normalizeTarget, formatTarget } = await import('../js/model.js');
  assert.equal(formatTarget({ sets: 4, repsMin: 8, repsMax: 10 }), '4 × 8–10');
  assert.equal(formatTarget({ sets: 3, repsMin: 5, repsMax: 5 }), '3 × 5');
  assert.equal(formatTarget(normalizeTarget({ sets: 3 })), '3 sets');
  assert.deepEqual(normalizeTarget({ sets: '4', repsMin: '10' }), { sets: 4, repsMin: 10, repsMax: 10 });
  assert.equal(normalizeTarget({ sets: 0 }), null);
  assert.equal(normalizeTarget(null), null);
});

test('default templates: built-in exercises only, chest = DB Chest Press / Incline DB Press / Pec Deck', async () => {
  const { DEFAULT_TEMPLATES, TEMPLATE_TYPES } = await import('../js/model.js');
  const builtins = new Set(DEFAULT_EXERCISES);
  assert.deepEqual(Object.keys(DEFAULT_TEMPLATES), TEMPLATE_TYPES);
  for (const t of TEMPLATE_TYPES) {
    assert.ok(DEFAULT_TEMPLATES[t].length >= 5, `${t} has a starter template`);
    for (const item of DEFAULT_TEMPLATES[t]) {
      assert.ok(builtins.has(item.name), `${item.name} is built-in`);
      assert.ok(item.sets >= 1 && item.repsMin <= item.repsMax);
    }
  }
  assert.deepEqual(DEFAULT_TEMPLATES.Push.slice(0, 3).map((i) => i.name), ['DB Chest Press', 'Incline DB Press', 'Pec Deck']);
  assert.ok(!JSON.stringify(DEFAULT_TEMPLATES).toLowerCase().includes('fly'));
});

test('Break and Upper/Lower are valid; legacy "Rest" becomes Break', () => {
  assert.equal(normalizeSession({ date: '2026-11-20', type: 'Upper' }).type, 'Upper');
  assert.equal(normalizeSession({ date: '2026-11-22', type: 'Break' }).type, 'Break');
  assert.equal(normalizeSession({ date: '2026-11-22', type: 'Rest' }).type, 'Break');
});
