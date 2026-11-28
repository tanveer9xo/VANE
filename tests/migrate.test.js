// Stored-data migration (1.15): every earlier format upgrades with nothing lost; a failed check changes nothing;
// a newer format isn't touched; snapshots export as importable backups; export → import is identical.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storedSchema, migrateStored, verifyMigration, makeSnapshot, snapshotToBackup, hasData, MigrationError } from '../js/migrate.js';
import { SCHEMA_VERSION, migrateBackup, BREAK } from '../js/model.js';

const TODAY = '2026-11-26';
const meta = (o) => o;

/**
 * Realistic stored data as format v saved it: the same workouts each time, in that version's shape.
 * Push day with a warm-up (v3+), a Legs day with a missed set (v2+), a rest day, a custom type (v7+),
 * a split (v10+), Body log entries (v3+, waist from v3), a profile (v6+), and settings.
 */
function fixture(v) {
  const set = (weight, reps, extra = {}) => ({ weight, reps, ...(v >= 2 ? { done: true } : {}), ...(v >= 3 ? { type: 'working' } : {}), ...extra });
  const ex = (name, sets) => ({ id: `${name}-id`, name, sets, ...(v >= 2 ? { target: null } : {}), ...(v >= 3 ? { weightStep: null, restSeconds: null, hintDismissed: false } : {}), ...(v >= 4 ? { note: '' } : {}) });
  const session = (date, type, exercises, extra = {}) => ({
    v, date, type, notes: '', cardioMinutes: null, createdAt: 1, updatedAt: 2, exercises,
    ...(v >= 4 ? { startedAt: null, finishedAt: null } : {}), ...extra,
  });
  const sessions = [
    session('2026-11-02', 'Push', [ex('DB Chest Press', [...(v >= 3 ? [set(15, 10, { type: 'warmup' })] : []), set(30, 8), set(30, 7)]), ex('Lateral Raise', [set(8, 12)])]),
    session('2026-11-03', 'Legs', [ex('Squat', [set(100, 5), set(100, 5), ...(v >= 2 ? [set(100, 3, { done: false })] : [])])], { notes: 'heavy' }),
    session('2026-11-04', v >= 2 ? BREAK : 'Rest', []),
    ...(v >= 7 ? [session('2026-11-05', 't-arms', [ex('EZ-Bar Curl', [set(25, 10)])])] : []),
  ];
  const m = {};
  m.settings = meta({ weekStartsOn: 0, weightStep: 2.5, defaultRestSeconds: 120, ...(v === 1 ? { templates: { Push: ['DB Chest Press', 'Dips'] }, schedule: ['Break', 'Push', 'Pull', 'Legs', 'Break', 'Upper', 'Lower'] } : {}) });
  if (v >= 2) {
    m.schedule = [{ from: '2026-11-01', days: { sun: BREAK, mon: 'Push', tue: 'Legs', wed: BREAK, thu: 'Pull', fri: 'Upper', sat: BREAK } }];
    m.templates = { Push: [{ name: 'DB Chest Press', sets: 4, repsMin: 6, repsMax: 10, ...(v >= 3 ? { weightStep: 1, restSeconds: 150 } : {}) }, { name: 'Dips', sets: 3, repsMin: 8, repsMax: 12 }] };
  }
  if (v >= 4) m.skipReasons = { '2026-11-06': 'Travel' };
  if (v >= 6) m.profile = { name: 'Sam', units: 'kg', goal: 'muscle', experience: 'mid', split: 'ppl', sessionsPerWeek: 3, heightCm: 180, onboarding: 'done', setupCardDismissed: false, updatedAt: 1 };
  if (v >= 7) {
    m.sessionTypes = [
      { id: 'Push', name: 'Push', short: 'Push', color: 'red', kind: 'lift', builtin: true, hidden: false, archived: false, order: 0 },
      { id: 'Pull', name: 'Pull', short: 'Pull', color: 'blue', kind: 'lift', builtin: true, hidden: false, archived: false, order: 1 },
      { id: 'Legs', name: 'Legs', short: 'Legs', color: 'gold', kind: 'lift', builtin: true, hidden: false, archived: false, order: 2 },
      { id: 'Upper', name: 'Upper', short: 'Upper', color: 'green', kind: 'lift', builtin: true, hidden: false, archived: false, order: 3 },
      { id: 't-arms', name: 'Arms', short: 'Arms', color: 'pink', kind: 'lift', builtin: false, hidden: false, archived: false, order: 4 },
    ];
    m.templates['t-arms'] = [{ name: 'EZ-Bar Curl', sets: 3, repsMin: 8, repsMax: 12, weightStep: null, restSeconds: null }];
  }
  if (v >= 9) { m.nutrition = { enabled: true, sex: 'male', birthYear: 1990, weightKg: 80, activity: 'moderate', lossPct: 20, hideNumbers: false, updatedAt: 1 }; m.intake = { '2026-11-02': { kcal: 2500, protein: 150 } }; }
  if (v >= 10) m.splits = [{ id: 's-1', name: 'My PPL', days: { sun: BREAK, mon: 'Push', tue: 'Pull', wed: 'Legs', thu: BREAK, fri: 'Push', sat: BREAK }, types: [{ id: 'Push', name: 'Push', short: 'Push', color: 'red', kind: 'lift' }, { id: 'Pull', name: 'Pull', short: 'Pull', color: 'blue', kind: 'lift' }, { id: 'Legs', name: 'Legs', short: 'Legs', color: 'gold', kind: 'lift' }], templates: { Push: [{ name: 'Dips', sets: 3, repsMin: 8, repsMax: 12, weightStep: null, restSeconds: null }], Pull: [], Legs: [] }, createdAt: 1, updatedAt: 1 }];
  const body = v >= 3 ? [{ date: '2026-11-02', weight: 81.2, waist: 86, updatedAt: 1 }, { date: '2026-11-03', weight: 80.9, waist: null, updatedAt: 1 }] : [];
  const exercises = v >= 5 ? [] : [{ key: 'dips', name: 'Dips' }];
  return { sessions, exercises, body, meta: m };
}

// The parts that must be unchanged, in a form every version shares.
const workouts = (sessions) => sessions.map((s) => ({
  date: s.date, type: s.type === 'Rest' ? BREAK : s.type, notes: s.notes ?? '',
  exercises: s.exercises.filter((e) => e.kind !== 'cardio').map((e) => ({ name: e.name, sets: e.sets.map((x) => ({ weight: x.weight, reps: x.reps, done: x.done ?? true, type: x.type ?? 'working' })) })),
}));
const tplItems = (t) => Object.fromEntries(Object.entries(t ?? {}).map(([k, list]) => [k, list.map((i) => ({ name: typeof i === 'string' ? i : i.name, sets: i.sets ?? 3, repsMin: i.repsMin ?? 8, repsMax: i.repsMax ?? 12 }))]));

for (let v = 1; v < SCHEMA_VERSION; v++) {
  test(`stored format v${v} → v${SCHEMA_VERSION}: workouts, sets, types, templates, splits, Body log, profile and settings unchanged`, () => {
    const raw = fixture(v);
    assert.equal(storedSchema(raw), v);
    const before = structuredClone(raw);
    const plan = migrateStored(raw, { today: TODAY });
    verifyMigration(raw, plan); // throws if anything was lost
    assert.deepEqual(raw, before, 'migrating never modifies the data it reads (the old data stays until the new is written)');
    const s = plan.state;
    assert.deepEqual(workouts(s.sessions), workouts(raw.sessions), 'every workout and set, as it was');
    assert.ok(s.sessions.every((x) => x.v === SCHEMA_VERSION));
    if (v >= 7) assert.deepEqual(s.types.map((t) => [t.id, t.name, t.color]), raw.meta.sessionTypes.map((t) => [t.id, t.name, t.color]), 'session types');
    else assert.ok(['Push', 'Legs'].every((id) => s.types.some((t) => t.id === id)), 'built-in types for older data');
    const want = v === 1 ? { Push: [{ name: 'DB Chest Press', sets: 3, repsMin: 8, repsMax: 12 }, { name: 'Dips', sets: 3, repsMin: 8, repsMax: 12 }] } : tplItems(raw.meta.templates);
    for (const [k, items] of Object.entries(want)) assert.deepEqual(tplItems({ [k]: s.templates[k] })[k], items, `template ${k}`);
    if (v >= 3) assert.equal(s.templates.Push[0].restSeconds, 150, 'rest settings kept');
    assert.deepEqual(s.splits.map((x) => [x.id, x.name, x.days]), (raw.meta.splits ?? []).map((x) => [x.id, x.name, x.days]), 'saved splits');
    assert.deepEqual(s.body.map(({ date, weight, waist }) => ({ date, weight, waist })), raw.body.map(({ date, weight, waist }) => ({ date, weight, waist })), 'Body log');
    if (v >= 6) assert.deepEqual({ ...s.profile, updatedAt: 0 }, { ...raw.meta.profile, updatedAt: 0 }, 'profile');
    else assert.equal(s.profile.onboarding, 'existing', 'older data: no first-run flow, a one-time card');
    assert.deepEqual([s.settings.weekStartsOn, s.settings.weightStep, s.settings.defaultRestSeconds], [0, 2.5, 120], 'settings');
    if (v >= 4) assert.deepEqual(s.skipReasons, raw.meta.skipReasons);
    if (v >= 9) assert.deepEqual([s.nutrition.enabled, s.intake], [true, raw.meta.intake], 'nutrition and intake');
    assert.equal(plan.writes.sessions.length, raw.sessions.length, 'every older record is rewritten in the new format');
  });
}

test('the current format is read as is: nothing to rewrite', () => {
  const plan = migrateStored(fixture(10), { today: TODAY });
  const raw11 = { ...fixture(10), sessions: plan.state.sessions, meta: { ...fixture(10).meta, schemaVersion: SCHEMA_VERSION } };
  const again = migrateStored(raw11, { today: TODAY });
  assert.equal(storedSchema(raw11), SCHEMA_VERSION);
  assert.equal(again.writes.sessions.length, 0);
});

test('old treadmill minutes become a Treadmill entry; that is the only thing a migration adds', () => {
  const raw = fixture(10);
  raw.sessions[1].cardioMinutes = 25;
  const plan = migrateStored(raw, { today: TODAY });
  verifyMigration(raw, plan);
  const legs = plan.state.sessions.find((x) => x.date === '2026-11-03');
  assert.deepEqual(legs.exercises.map((e) => e.name), ['Squat', 'Treadmill']);
});

test('an interrupted migration: a failed check stops it and the stored data is untouched', () => {
  // A record the new format can't read would be dropped: the check refuses rather than lose a workout.
  const raw = fixture(10);
  raw.sessions.push({ v: 10, date: 'not-a-date', type: 'Push', exercises: [] });
  const before = structuredClone(raw);
  const plan = migrateStored(raw, { today: TODAY });
  assert.throws(() => verifyMigration(raw, plan), (e) => e instanceof MigrationError && /workouts: 5 before, 4 after/.test(e.message));
  assert.deepEqual(raw, before, 'nothing on the phone changed');
  // Lost sets, a changed type, a lost split or Body log entry: each refused with its own reason.
  const lost = migrateStored(fixture(10), { today: TODAY });
  lost.state.sessions[0].exercises[0].sets.pop();
  assert.throws(() => verifyMigration(fixture(10), lost), /sets: 8 before, 7 after/);
  const retyped = migrateStored(fixture(10), { today: TODAY });
  retyped.state.sessions[0].type = 'Other';
  assert.throws(() => verifyMigration(fixture(10), retyped), /session types: 1 workout would change type/);
  const fewer = migrateStored(fixture(10), { today: TODAY });
  fewer.state.splits = [];
  fewer.state.body.pop();
  assert.throws(() => verifyMigration(fixture(10), fewer), /saved splits: 1 before, 0 after.*Body log entries: 2 before, 1 after/);
});

test('a newer stored format is recognised (a stale copy of the app must not touch it)', () => {
  const raw = { ...fixture(10), meta: { ...fixture(10).meta, schemaVersion: SCHEMA_VERSION + 1 } };
  assert.equal(storedSchema(raw), SCHEMA_VERSION + 1);
  assert.ok(storedSchema(raw) > SCHEMA_VERSION);
  assert.equal(storedSchema({ sessions: [{ v: 99, date: '2026-01-01' }], exercises: [], body: [], meta: {} }), 99, 'or from the records themselves');
  assert.equal(storedSchema({ sessions: [], exercises: [], body: [], meta: {} }), SCHEMA_VERSION, 'nothing stored: a fresh start');
  assert.equal(hasData({ sessions: [], exercises: [], body: [], meta: {} }), false);
});

test('a snapshot exports as a normal backup that imports back to the same data', () => {
  for (const v of [3, 7, 10]) {
    const raw = fixture(v);
    const snap = makeSnapshot(raw, v, 1700000000000);
    assert.equal(snap.fromVersion, v);
    const back = migrateBackup(JSON.parse(JSON.stringify(snapshotToBackup(snap))));
    const plan = migrateStored(raw, { today: TODAY });
    assert.deepEqual(workouts(back.sessions), workouts(plan.state.sessions), `v${v} snapshot: workouts`);
    assert.deepEqual(back.body.map((e) => [e.date, e.weight]), plan.state.body.map((e) => [e.date, e.weight]), `v${v} snapshot: Body log`);
    if (v >= 7) assert.deepEqual(back.sessionTypes.map((t) => t.id), plan.state.types.map((t) => t.id));
  }
});

test('export → import round trip is identical', () => {
  const s = migrateStored(fixture(10), { today: TODAY }).state;
  const payload = {
    app: 'workout-tracker', schemaVersion: SCHEMA_VERSION, sessions: s.sessions, settings: s.settings, schedule: s.schedule, templates: s.templates,
    body: s.body, skipReasons: s.skipReasons, profile: s.profile, sessionTypes: s.types, nutrition: s.nutrition, intake: s.intake, splits: s.splits,
  };
  const back = migrateBackup(JSON.parse(JSON.stringify(payload)));
  assert.deepEqual(back.sessions, s.sessions, 'workouts, byte for byte');
  assert.deepEqual(back.schedule, s.schedule);
  assert.deepEqual(back.templates, s.templates);
  assert.deepEqual(back.body, s.body);
  assert.deepEqual(back.skipReasons, s.skipReasons);
  assert.deepEqual(back.profile, s.profile);
  assert.deepEqual(back.sessionTypes, s.types);
  assert.deepEqual(back.nutrition, s.nutrition);
  assert.deepEqual(back.intake, s.intake);
  assert.deepEqual(back.splits, s.splits);
  for (const [k, val] of Object.entries(back.settings)) assert.deepEqual(val, s.settings[k], `setting ${k}`);
});

test('the service worker reports the same data format as the app (for the "export before updating" prompt)', async () => {
  const { readFileSync } = await import('node:fs');
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.equal(Number(sw.match(/const SCHEMA = (\d+);/)[1]), SCHEMA_VERSION);
  assert.match(sw, /key\.startsWith\('workout-tracker-'\) && key !== CACHE/, 'cleanup removes only this app’s own old caches');
  assert.doesNotMatch(sw, /indexedDB|localStorage|deleteDatabase|\.clear\(/, 'the service worker never touches stored data');
});
