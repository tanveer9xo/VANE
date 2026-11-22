// Schema v4, timer/stopwatch, weekly review, muscles, records table, CSV, copy workout, streaks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEMA_VERSION, migrateBackup, upgradeSessionRecord, normalizeSession, normalizeMuscles, muscleFor, pickSettings,
  DEFAULT_SETTINGS, defaultSchedule,
} from '../js/model.js';
import {
  watchElapsed, watchStart, watchPause, watchLap, formatWatch, parseDuration, formatElapsed,
} from '../js/timer.js';
import { weeklyReview, recordRows } from '../js/review.js';
import { sessionsToCSV, csvField } from '../js/csv.js';
import {
  currentStreak, copySessionTo, progressState, isCompleted, lastNoteFor, plannedExercise, dayStatus,
} from '../js/plan.js';
import { exerciseRecords, formatSetGroups } from '../js/stats.js';
import { suggest } from '../js/progression.js';

const TODAY = '2026-11-19'; // a Thursday
const set = (weight, reps, type = 'working', done = true) => ({ weight, reps, type, done });
const S = (date, type, exercises, extra = {}) => ({
  v: 4, date, type, notes: '', cardioMinutes: null, startedAt: null, finishedAt: null, createdAt: 1, updatedAt: 1,
  exercises: exercises.map(([name, sets, note = ''], i) => ({ id: `${date}-${i}`, name, target: null, note, sets })),
  ...extra,
});

// ---------------- schema v4 ----------------
test('v3 records gain note, startedAt and finishedAt on their way to the current schema', () => {
  assert.ok(SCHEMA_VERSION >= 7);
  const v3 = { v: 3, date: '2026-11-01', type: 'Push', notes: '', cardioMinutes: 20, createdAt: 1, updatedAt: 1,
    exercises: [{ id: 'a', name: 'Squat', target: null, weightStep: null, restSeconds: null, hintDismissed: false, sets: [set(100, 5)] }] };
  const { session, changed } = upgradeSessionRecord(v3);
  assert.equal(changed, true);
  assert.equal(session.v, SCHEMA_VERSION);
  assert.equal(session.exercises[0].note, '');
  assert.equal(session.startedAt, null);
  assert.equal(session.finishedAt, null);
  assert.deepEqual(session.exercises[0].sets, [set(100, 5)]);
});

test('v3 backup migrates up to the current schema; v0–v2 backups still import', () => {
  const v3 = migrateBackup({
    schemaVersion: 3,
    sessions: [{ v: 3, date: '2026-11-10', type: 'Legs', notes: '', exercises: [{ name: 'Squat', sets: [set(100, 5)] }] }],
    body: [{ date: '2026-11-10', weight: 80 }],
  });
  assert.equal(v3.sessions[0].v, SCHEMA_VERSION);
  assert.equal(v3.sessions[0].exercises[0].note, '');
  assert.deepEqual(v3.muscles, {});
  assert.equal(v3.body.length, 1);

  const v4 = migrateBackup({ schemaVersion: 4, sessions: [], muscles: { 'Hip Thrust': 'Glutes', squat: 'Banana', 'leg press': null } });
  assert.deepEqual(v4.muscles, { 'hip thrust': 'Glutes', 'leg press': null });

  const bare = migrateBackup([{ date: '2026-01-01', type: 'Push', exercises: [{ name: 'Bench', sets: [{ weight: 60, reps: 5 }] }] }]);
  assert.equal(bare.sessions[0].v, SCHEMA_VERSION);
  assert.equal(bare.sessions[0].exercises[0].sets[0].done, true);
  assert.equal(bare.sessions[0].exercises[0].sets[0].type, 'working');
  const v1 = migrateBackup({ schemaVersion: 1, sessions: [{ date: '2026-01-02', type: 'Rest', exercises: [] }] });
  assert.equal(v1.sessions[0].type, 'Break');
  const v2 = migrateBackup({ schemaVersion: 2, sessions: [{ v: 2, date: '2026-01-03', type: 'Pull', exercises: [{ name: 'Row', sets: [{ weight: 50, reps: 8, done: false }] }] }] });
  assert.equal(v2.sessions[0].exercises[0].sets[0].done, false);
  assert.throws(() => migrateBackup({ schemaVersion: SCHEMA_VERSION + 1, sessions: [] }), /newer version/);
});

test('sessions keep finishedAt/startedAt and per-exercise notes; junk is dropped', () => {
  const s = normalizeSession({ date: TODAY, type: 'Upper', startedAt: 1000, finishedAt: 'x', exercises: [{ name: 'Row', note: 'Seat 4', sets: [] }] });
  assert.equal(s.startedAt, 1000);
  assert.equal(s.finishedAt, null);
  assert.equal(s.exercises[0].note, 'Seat 4');
  assert.equal(normalizeSession({ date: TODAY, exercises: [{ name: 'Row', note: 42, sets: [] }] }).exercises[0].note, '');
});

test('new timer settings are validated on import', () => {
  assert.deepEqual(pickSettings({ timerVibrate: false, autoStartRest: 'yes', keepAwake: true, timerPreset: 75 }),
    { timerVibrate: false, keepAwake: true, timerPreset: 75 });
  assert.deepEqual(pickSettings({ timerPreset: 3 }), {});
  assert.equal(DEFAULT_SETTINGS.autoStartRest, true);
});

// ---------------- timer / stopwatch ----------------
test('stopwatch is timestamp-based: start, pause, resume, laps', () => {
  let w = watchStart(null, 0);
  assert.equal(watchElapsed(w, 5_000), 5_000);
  w = watchLap(w, 5_000);
  w = watchPause(w, 8_000);
  assert.equal(watchElapsed(w, 100_000), 8_000); // paused: clock doesn't matter
  w = watchStart(w, 100_000);
  assert.equal(watchElapsed(w, 102_000), 10_000);
  w = watchLap(w, 102_000);
  assert.deepEqual(w.laps, [5_000, 10_000]);
  assert.equal(formatWatch(83_456), '1:23.4');
  assert.equal(formatWatch(3_723_000), '1:02:03');
  assert.equal(formatElapsed(1_102_000), '18:22');
  assert.equal(formatElapsed(4_702_000), '1:18:22');
});

test('custom rest length parsing', () => {
  assert.equal(parseDuration('75'), 75);
  assert.equal(parseDuration('1:15'), 75);
  assert.equal(parseDuration('2m'), 120);
  assert.equal(parseDuration('1:75'), null);
  assert.equal(parseDuration('3'), null); // under 5 s
  assert.equal(parseDuration('20:00'), null); // over 15 min
  assert.equal(parseDuration('abc'), null);
});

test('overload hints carry a reason', () => {
  const up = suggest([set(25, 8), set(25, 8), set(25, 8)], { repsMin: 6, repsMax: 8 }, 2.5);
  assert.equal(up.kind, 'increase');
  assert.equal(up.reason, 'Last time: 8, 8, 8 reps.');
  const rep = suggest([set(25, 7), set(25, 6)], { repsMin: 6, repsMax: 8 }, 2.5);
  assert.equal(rep.reason, 'Last time: 7, 6 reps.');
});

// ---------------- muscles ----------------
test('muscle tags: defaults, overrides and explicit untag', () => {
  assert.equal(muscleFor('DB Chest Press'), 'Chest');
  assert.equal(muscleFor('Zercher Squat'), null);
  assert.equal(muscleFor('Squat', { squat: 'Glutes' }), 'Glutes');
  assert.equal(muscleFor('Squat', { squat: null }), null);
  assert.deepEqual(normalizeMuscles(['x']), {});
});

// ---------------- records table ----------------
test('records table merges buckets held by the same set', () => {
  const list = [
    S('2026-11-02', 'Push', [['Bench', [set(60, 8), set(70, 3)]]]),
    S('2026-11-09', 'Push', [['Bench', [set(80, 1)]]]),
  ];
  const rows = recordRows(exerciseRecords(list, 'bench', TODAY));
  assert.deepEqual(rows.map((r) => [r.label, r.weight, r.reps, r.date]), [
    ['1', 80, 1, '2026-11-09'],
    ['3', 70, 3, '2026-11-02'],
    ['5–8+', 60, 8, '2026-11-02'],
  ]);
  assert.deepEqual(recordRows(null), []);
});

test('collapsed summary groups repeated sets', () => {
  assert.equal(formatSetGroups([set(25, 8), set(25, 8), set(25, 8)]), '25×8 ×3');
  assert.equal(formatSetGroups([set(25, 8), set(25, 8), set(22.5, 8), set(10, 10, 'warmup')]), '25×8 ×2, 22.5×8');
});

// ---------------- CSV ----------------
test('CSV: one row per set, plus rest days and skip reasons; quoted and formula-safe', () => {
  const csv = sessionsToCSV([
    S('2026-11-17', 'Pull', [['Row, cable', [set(50, 8), set(null, null, 'working', false)]]]),
    S('2026-11-16', 'Push', [['=HYPERLINK("x")', [set(0, 10, 'warmup')]]]),
    S('2026-11-18', 'Break', []),
  ], { '2026-11-19': 'Busy', '2026-11-17': 'Tired' }); // the 17th has a workout, so its reason isn't a skip row
  const lines = csv.trimEnd().split('\r\n');
  assert.equal(lines[0], 'date,session type,exercise,set number,weight,reps,set type,done,record,skip reason,primary muscle,secondary muscles,equipment,custom,site,value');
  assert.equal(lines[1], '2026-11-16,Push,"\'=HYPERLINK(""x"")",1,0,10,warmup,yes,set,,,,,,,');
  assert.equal(lines[2], '2026-11-17,Pull,"Row, cable",1,50,8,working,yes,set,,,,,,,');
  assert.equal(lines[3], '2026-11-17,Pull,"Row, cable",2,,,working,no,set,,,,,,,');
  assert.equal(lines[4], '2026-11-18,Break,,,,,,,rest day,,,,,,,');
  assert.equal(lines[5], '2026-11-19,,,,,,,,skipped,Busy,,,,,,');
  assert.equal(lines.length, 6);
  assert.equal(csvField('-5'), "'-5");
  assert.equal(csvField(-5), '-5'); // numbers are left alone
});

// ---------------- plan: streak, consistency, finish, copy ----------------
const schedule = defaultSchedule('2026-11-01'); // Mon Push, Tue Pull, Wed Legs, Thu Break, Fri Upper, Sat Lower, Sun Break

test('streak skips break days and unplanned days, ends at a missed day', () => {
  const byDate = new Map([
    ['2026-11-09', S('2026-11-09', 'Push', [['Bench', [set(60, 8)]]])], // Mon
    ['2026-11-10', null], // Tue Pull missed → streak stops before here
    ['2026-11-11', S('2026-11-11', 'Legs', [['Squat', [set(100, 5)]]])],
    ['2026-11-14', S('2026-11-14', 'Lower', [['Deadlift', [set(140, 3)]]])], // Sat; Fri 13 Upper missed!
    ['2026-11-16', S('2026-11-16', 'Push', [['Bench', [set(60, 8)]]])],
    ['2026-11-17', S('2026-11-17', 'Pull', [['Row', [set(50, 8)]]])],
    ['2026-11-18', S('2026-11-18', 'Legs', [['Squat', [set(100, 5)]]])],
  ]);
  const get = (d) => byDate.get(d) ?? null;
  // Today Thu 19 = Break, Sun 15 = Break: neither breaks it. Fri 13 was missed.
  assert.equal(currentStreak(get, schedule, TODAY), 4);
  // Today planned and not done yet doesn't break it either.
  assert.equal(currentStreak(get, schedule, '2026-11-18'), 4);
});

test('finishing marks a day complete; progress state', () => {
  const s = S(TODAY, 'Upper', [['Row', [set(50, 8, 'working', false)]]]);
  assert.equal(isCompleted(s), false);
  assert.equal(progressState(s), 'empty');
  s.exercises[0].sets[0].done = true;
  assert.equal(progressState(s), 'started');
  s.finishedAt = 123;
  assert.equal(progressState(s), 'finished');
  const cardioOnly = S(TODAY, 'Upper', [], { cardioMinutes: 20, finishedAt: 5 });
  assert.equal(isCompleted(cardioOnly), true);
  assert.equal(dayStatus(TODAY, cardioOnly, schedule, TODAY).state, 'done');
});

test('per-exercise notes carry over to the next time', () => {
  const list = [
    S('2026-11-02', 'Push', [['Pec Deck', [set(40, 12)], 'Seat 3']]),
    S('2026-11-09', 'Push', [['Pec Deck', [set(45, 12)], 'Seat 4, handles low']]),
    S('2026-11-30', 'Push', [['Pec Deck', [], 'future note']]),
  ];
  assert.equal(lastNoteFor(list, 'pec deck', TODAY, TODAY), 'Seat 4, handles low');
  assert.equal(lastNoteFor(list, 'pec deck', '2026-11-05', TODAY), 'Seat 3');
  assert.equal(plannedExercise('Pec Deck', null, list, TODAY, TODAY).note, 'Seat 4, handles low');
});

test('copy workout creates an unticked plan with latest weights', () => {
  const src = S('2026-11-16', 'Push', [
    ['DB Chest Press', [set(15, 10, 'warmup'), set(30, 8), set(30, 8)], 'Bench at 30°'],
    ['New Thing', [set(12, 10)]],
  ], { finishedAt: 9, startedAt: 1 });
  src.exercises[0].target = { sets: 2, repsMin: 8, repsMax: 10 };
  const later = S('2026-11-18', 'Upper', [['DB Chest Press', [set(32.5, 8)]]]);
  const copy = copySessionTo(src, '2026-11-23', [src, later], DEFAULT_SETTINGS, TODAY);
  assert.equal(copy.date, '2026-11-23');
  assert.equal(copy.type, 'Push');
  assert.equal(copy.finishedAt, null);
  assert.equal(copy.startedAt, null);
  const press = copy.exercises[0];
  assert.deepEqual(press.target, { sets: 2, repsMin: 8, repsMax: 10 });
  assert.ok(press.sets.every((x) => x.done === false));
  assert.deepEqual(press.sets.filter((x) => x.type !== 'warmup').map((x) => x.weight), [32.5, 32.5]); // latest weights
  assert.equal(press.note, 'Bench at 30°');
  assert.notEqual(press.id, src.exercises[0].id);
  // Never logged before the target date except in the source: falls back to the source's sets.
  assert.deepEqual(copy.exercises[1].sets.map((x) => [x.weight, x.reps, x.done]), [[12, 10, false]]);
  // The source is untouched.
  assert.ok(src.exercises[0].sets.every((x) => x.done));
});

test('weekly review: done vs planned, volume vs last week, PRs, bodyweight', () => {
  const list = [
    S('2026-11-09', 'Push', [['Bench', [set(60, 8)]]]),
    S('2026-11-16', 'Push', [['Bench', [set(65, 8)]]]), // PR
    S('2026-11-17', 'Pull', [['Row', [set(50, 10)]]]),
  ];
  const get = (d) => list.find((s) => s.date === d) ?? null;
  const body = [
    { date: '2026-11-14', weight: 81 }, { date: '2026-11-15', weight: 81 },
    { date: '2026-11-17', weight: 80 }, { date: '2026-11-19', weight: 80 },
  ];
  const r = weeklyReview({ sessions: list, getSession: get, schedule, body, start: '2026-11-16', today: TODAY });
  assert.equal(r.done, 2);
  assert.equal(r.planned, 5); // Mon Tue Wed (missed) + Fri Sat (planned)
  assert.equal(r.volume, 65 * 8 + 50 * 10);
  assert.equal(r.prevVolume, 480);
  assert.equal(r.prs, 1);
  assert.match(r.prLines[0], /^Bench: /);
  // avg at 19th = mean(81, 80, 80, 81... window 13–19) vs avg at 15th
  assert.ok(r.bodyChange < 0);
});
