// Cardio (schema v11): migration, optional fields, Time/Distance/Speed, totals, export/import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  derive, normalizeCardio, newCardioExercise, cardioTotals, cardioHistory, migrateTreadmillMinutes, activityFor, ACTIVITIES, FIELDS,
} from '../js/cardio.js';
import { migrateBackup, upgradeSessionRecord, SCHEMA_VERSION, isSessionEmpty, newSession } from '../js/model.js';
import { isCompleted, copySessionTo } from '../js/plan.js';
import { sessionsToCSV, csvToBackup } from '../js/csv.js';
import { weekStats } from '../js/stats.js';
import { setUnits, fmtD, fmtSp, fromShownD } from '../js/units.js';

let n = 0;
const id = () => `id${++n}`;
const entry = (name, cardio) => ({ ...newCardioExercise(name, id()), cardio: { ...normalizeCardio({}), ...cardio } });

test('the Cardio group: eight activities', () => {
  assert.deepEqual(ACTIVITIES.map((a) => a.name), ['Treadmill', 'Walking', 'Running', 'Jogging', 'Cycling', 'Rowing', 'Stairs', 'Other cardio']);
  assert.equal(activityFor('treadmill').key, 'treadmill');
  assert.equal(activityFor('Bench Press'), null);
  const ex = newCardioExercise('Rowing', 'x');
  assert.deepEqual(ex.sets, [], 'no sets, kg or reps');
  assert.equal(ex.kind, 'cardio');
});

test('v10 → v11: treadmill minutes become a Treadmill entry in that workout; nothing else changes', () => {
  assert.equal(SCHEMA_VERSION, 11);
  const done = { v: 10, date: '2026-11-10', type: 'Push', cardioMinutes: 20, finishedAt: 5, createdAt: 1, updatedAt: 1, notes: '',
    exercises: [{ id: 'a', name: 'Bench', sets: [{ weight: 60, reps: 8, done: true, type: 'working' }] }] };
  const { session } = upgradeSessionRecord(done);
  assert.equal(session.v, 11);
  assert.equal('cardioMinutes' in session, false);
  assert.deepEqual(session.exercises.map((e) => e.name), ['Bench', 'Treadmill']);
  assert.deepEqual(session.exercises[0].sets, done.exercises[0].sets, 'sets untouched');
  assert.deepEqual(session.exercises[1].cardio, { minutes: 20, distanceKm: null, speedKmh: null, incline: null, kcal: null, done: true, timerStartedAt: null });
  // A planned (not done) day keeps the minutes but isn't marked done.
  const planned = upgradeSessionRecord({ v: 10, date: '2026-12-01', type: 'Pull', cardioMinutes: 20, exercises: [], notes: '' }).session;
  assert.equal(planned.exercises[0].cardio.done, false);
  // A Cardio day with minutes counted as done before, so it still does.
  assert.equal(upgradeSessionRecord({ v: 10, date: '2026-11-11', type: 'Cardio', cardioMinutes: 30, exercises: [], notes: '' }).session.exercises[0].cardio.done, true);
  // No minutes, zero, or a Break day: nothing added.
  for (const m of [null, 0, undefined]) assert.equal(upgradeSessionRecord({ v: 10, date: '2026-11-12', type: 'Push', cardioMinutes: m, exercises: [], notes: '' }).session.exercises.length, 0);
  assert.equal(migrateTreadmillMinutes({ date: '2026-11-13', type: 'Break', cardioMinutes: 10, exercises: [] }, id).exercises.length, 0);
  // Backups from older versions go the same way.
  const out = migrateBackup({ schemaVersion: 3, sessions: [{ v: 3, date: '2026-11-10', type: 'Legs', cardioMinutes: 15, exercises: [{ name: 'Squat', sets: [{ weight: 100, reps: 5 }] }] }] });
  assert.equal(out.sessions[0].exercises.find((e) => e.kind === 'cardio').cardio.minutes, 15);
});

test('optional fields: empty stays empty (null), never 0; out-of-range is dropped', () => {
  const c = normalizeCardio({ minutes: '30', distanceKm: '', speedKmh: null, incline: 'abc', kcal: undefined });
  assert.deepEqual(c, { minutes: 30, distanceKm: null, speedKmh: null, incline: null, kcal: null, done: false, timerStartedAt: null });
  assert.equal(normalizeCardio({ minutes: 0 }).minutes, null, 'zero minutes is not a time');
  assert.equal(normalizeCardio({ incline: 0 }).incline, 0, 'a real 0 % incline is kept');
  assert.equal(normalizeCardio({ kcal: -5 }).kcal, null);
  assert.equal(normalizeCardio({ done: true }).done, false, 'Done needs a time');
  assert.equal(normalizeCardio({ done: true, minutes: 12 }).done, true, '…and nothing else');
  assert.equal(FIELDS.minutes('12,5'), 12.5);
});

test('Time + Distance → Speed; Time + Speed → Distance; Time only → nothing; both → as entered', () => {
  assert.deepEqual(derive({ minutes: 30, distanceKm: 5, speedKmh: null }), { distanceKm: 5, speedKmh: 10, calc: 'speed' });
  assert.deepEqual(derive({ minutes: 45, distanceKm: null, speedKmh: 8 }), { distanceKm: 6, speedKmh: 8, calc: 'distance' });
  assert.deepEqual(derive({ minutes: 30, distanceKm: null, speedKmh: null }), { distanceKm: null, speedKmh: null, calc: null }, 'Time only: nothing shown');
  assert.deepEqual(derive({ minutes: 30, distanceKm: 5, speedKmh: 12 }), { distanceKm: 5, speedKmh: 12, calc: null }, 'both entered: nothing calculated');
  assert.deepEqual(derive({ minutes: null, distanceKm: 5, speedKmh: null }), { distanceKm: 5, speedKmh: null, calc: null }, 'no time: nothing to work out');
  assert.equal(derive({ minutes: 20, distanceKm: 3.3, speedKmh: null }).speedKmh, 9.9);
  try {
    setUnits('lb');
    assert.equal(fmtD(derive({ minutes: 30, distanceKm: fromShownD(3), speedKmh: null }).distanceKm), '3');
    assert.equal(fmtSp(derive({ minutes: 30, distanceKm: fromShownD(3), speedKmh: null }).speedKmh), '6', '3 mi in 30 min = 6 mph');
  } finally { setUnits('kg'); }
});

test('totals: finished minutes always; distance only from entries that have one', () => {
  const sessions = [
    { date: '2026-11-16', type: 'Push', exercises: [entry('Treadmill', { minutes: 20, done: true })] },
    { date: '2026-11-17', type: 'Cardio', exercises: [entry('Running', { minutes: 30, distanceKm: 5, done: true })] },
    { date: '2026-11-18', type: 'Legs', exercises: [entry('Cycling', { minutes: 40, speedKmh: 24, done: true })] }, // 16 km worked out
    { date: '2026-11-19', type: 'Pull', exercises: [entry('Walking', { minutes: 15, distanceKm: 1.2, done: false })] }, // not finished
  ];
  const t = cardioTotals(sessions, '2026-11-16', '2026-11-22');
  assert.deepEqual(t, { minutes: 90, distanceKm: 21, withDistance: 2, entries: 3 });
  assert.equal(cardioHistory(sessions, 'running').length, 1);
  assert.equal(weekStats(sessions, '2026-11-20', 1, isCompleted).thisWeek.cardioMinutes, 90);
  assert.equal(weekStats(sessions, '2026-11-20', 1, isCompleted).thisWeek.sessions, 3, 'a cardio day is still one session');
});

test('a finished cardio entry completes the day; a day with only cardio is not empty; copies are blank', () => {
  const day = { date: '2026-11-20', type: 'Push', exercises: [entry('Treadmill', { minutes: 25, done: false })], notes: '' };
  assert.equal(isCompleted(day), false);
  day.exercises[0].cardio.done = true;
  assert.equal(isCompleted(day), true);
  assert.equal(isSessionEmpty({ ...newSession('2026-11-20'), exercises: [entry('Rowing', {})] }), false);
  const copy = copySessionTo(day, '2026-11-27', [day], {}, '2026-11-20');
  assert.equal(copy.exercises[0].kind, 'cardio');
  assert.deepEqual([copy.exercises[0].cardio.minutes, copy.exercises[0].cardio.done], [null, false]);
});

test('JSON and CSV keep empty cardio values empty', () => {
  const s = { date: '2026-11-18', type: 'Push', notes: '', exercises: [entry('Treadmill', { minutes: 30, incline: 5, done: true }), entry('Rowing', { minutes: 10, distanceKm: 2 })] };
  const json = migrateBackup(JSON.parse(JSON.stringify({ schemaVersion: SCHEMA_VERSION, sessions: [s] })));
  const c = json.sessions[0].exercises[0].cardio;
  assert.deepEqual([c.minutes, c.distanceKm, c.speedKmh, c.incline, c.kcal, c.done], [30, null, null, 5, null, true]);
  const csv = sessionsToCSV([s]);
  assert.match(csv, /2026-11-18,Push,Treadmill,,,,,yes,cardio,(,){7}30,,,5,/);
  const back = migrateBackup(csvToBackup(csv));
  const [t, r] = back.sessions[0].exercises;
  assert.deepEqual([t.kind, t.cardio.minutes, t.cardio.distanceKm, t.cardio.speedKmh, t.cardio.incline, t.cardio.kcal, t.cardio.done], ['cardio', 30, null, null, 5, null, true]);
  assert.deepEqual([r.cardio.minutes, r.cardio.distanceKm, r.cardio.done], [10, 2, false]);
});
