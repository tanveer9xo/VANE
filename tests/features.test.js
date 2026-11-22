// Rest timer state, set types, progression hints, records, body trend, v3 migration.
import test from 'node:test';
import assert from 'node:assert/strict';
import { suggest } from '../js/progression.js';
import { remainingMs, startState, adjustState, pauseState, resumeState, formatClock } from '../js/timer.js';
import { movingAverage, trendSeries, changeOver, latestEntry } from '../js/body.js';
import {
  exerciseRecords, prsForSession, sessionVolume, exerciseHistory, lastSetsFor, lastLoggedSets, prSetCount,
} from '../js/stats.js';
import { plannedExercise, templateItemFor, restSecondsFor, weightStepFor } from '../js/plan.js';
import { migrateBackup, normalizeBodyEntry, DEFAULT_TEMPLATES, DEFAULT_SETTINGS, upgradeSessionRecord } from '../js/model.js';

const TODAY = '2026-11-19';
const set = (weight, reps, type = 'working', done = true) => ({ weight, reps, type, done });
const S = (date, exercises) => ({
  v: 3, date, type: 'Push', notes: '', cardioMinutes: null, createdAt: 1, updatedAt: 1,
  exercises: exercises.map(([name, sets], i) => ({ id: `${date}-${i}`, name, target: null, sets })),
});

// ---------------- rest timer ----------------
test('timer: remaining time is derived from the end timestamp (survives sleep/background)', () => {
  const t0 = 1_000_000;
  const st = startState(90, 'Squat', t0);
  assert.equal(remainingMs(st, t0), 90_000);
  assert.equal(remainingMs(st, t0 + 30_000), 60_000);
  assert.equal(remainingMs(st, t0 + 10 * 60_000), 0); // phone locked for 10 min → simply over
  assert.equal(formatClock(remainingMs(st, t0 + 1)), '1:30');
});

test('timer: ±15 s, pause and resume', () => {
  const t0 = 0;
  let st = startState(60, '', t0);
  st = adjustState(st, 15, t0 + 10_000);
  assert.equal(remainingMs(st, t0 + 10_000), 65_000);
  st = adjustState(st, -90, t0 + 10_000);
  assert.equal(remainingMs(st, t0 + 10_000), 0); // never negative
  st = startState(60, '', t0);
  st = pauseState(st, t0 + 20_000);
  assert.equal(remainingMs(st, t0 + 500_000), 40_000); // paused: clock doesn't matter
  st = adjustState(st, 15, t0 + 500_000);
  assert.equal(remainingMs(st, t0 + 900_000), 55_000);
  st = resumeState(st, t0 + 1_000_000);
  assert.equal(remainingMs(st, t0 + 1_010_000), 45_000);
});

test('rest/step come from the exercise, else settings', () => {
  assert.equal(restSecondsFor({ restSeconds: 180 }, DEFAULT_SETTINGS), 180);
  assert.equal(restSecondsFor({ restSeconds: null }, DEFAULT_SETTINGS), 90);
  assert.equal(weightStepFor({ weightStep: null }, { ...DEFAULT_SETTINGS, weightStep: 5 }), 5);
  assert.equal(templateItemFor('Push', 'deadlift', DEFAULT_TEMPLATES).restSeconds, 180); // found in Lower
  assert.equal(templateItemFor('Push', 'Zercher', DEFAULT_TEMPLATES), null);
});

// ---------------- set types ----------------
test('warm-ups are visible but excluded from volume, history, PRs and hints', () => {
  const prev = S('2026-11-12', [['Squat', [set(60, 5, 'warmup'), set(100, 5), set(100, 5)]]]);
  const now = S(TODAY, [['Squat', [set(140, 5, 'warmup'), set(100, 6), set(60, 10, 'warmup', false)]]]);
  const all = [prev, now];
  assert.equal(sessionVolume(now), 600); // only the 100×6 working set
  const hist = exerciseHistory(all, 'squat', { today: TODAY });
  assert.deepEqual(hist.map((h) => h.top.weight), [100, 100]); // the 140 warm-up isn't a record
  const prs = prsForSession(all, now, TODAY).get(now.exercises[0].id);
  assert.deepEqual([...prs.sets.keys()], [1]); // 100×6 beats 100×5 on est. 1RM and 5-rep; warm-up not flagged
  assert.equal(prSetCount(prsForSession(all, now, TODAY)), 1);
  assert.equal(lastSetsFor(all, 'squat', TODAY, TODAY).sets.length, 2); // working sets only
  assert.equal(lastLoggedSets(all, 'squat', TODAY, TODAY).sets.length, 3); // incl. warm-up, for pre-fill
});

test('failure sets count like working sets; unticked sets never count', () => {
  const s = S(TODAY, [['Curl', [set(20, 8, 'failure'), set(30, 8, 'working', false)]]]);
  assert.equal(sessionVolume(s), 160);
});

test('pre-fill carries warm-ups over as warm-ups, then target working sets', () => {
  const prev = S('2026-11-12', [['Squat', [set(60, 5, 'warmup'), set(80, 3, 'warmup'), set(100, 5), set(100, 4)]]]);
  const ex = plannedExercise('Squat', { sets: 3, repsMin: 5, repsMax: 8, weightStep: 5, restSeconds: 180 }, [prev], TODAY, TODAY);
  assert.deepEqual(ex.sets.map((x) => `${x.type}:${x.weight}x${x.reps}:${x.done}`),
    ['warmup:60x5:false', 'warmup:80x3:false', 'working:100x5:false', 'working:100x4:false', 'working:100x4:false']);
  assert.equal(ex.restSeconds, 180);
  assert.equal(ex.weightStep, 5);
});

// ---------------- progression hints ----------------
const range = { repsMin: 8, repsMax: 10 };
test('hint: every working set at the top of the range → add weight at the bottom of the range', () => {
  const h = suggest([{ weight: 35, reps: 10 }, { weight: 35, reps: 10 }, { weight: 35, reps: 11 }], range, 2.5);
  assert.equal(h.kind, 'increase');
  assert.equal(h.text, 'Try +2.5 kg: 37.5 × 8');
  assert.equal(h.weight, 37.5);
  assert.deepEqual(h.reps, [8, 8, 8]);
});

test('hint: 2+ sets below the range → repeat; most sets below → small drop', () => {
  const repeat = suggest([{ weight: 35, reps: 9 }, { weight: 35, reps: 7 }, { weight: 35, reps: 6 }, { weight: 35, reps: 8 }], range, 2.5);
  assert.equal(repeat.kind, 'repeat');
  assert.equal(repeat.weight, 35);
  const drop = suggest([{ weight: 35, reps: 6 }, { weight: 35, reps: 6 }, { weight: 35, reps: 5 }], range, 2.5);
  assert.equal(drop.kind, 'drop');
  assert.equal(drop.weight, 32.5);
  // Only one set missed → not a repeat.
  assert.equal(suggest([{ weight: 35, reps: 9 }, { weight: 35, reps: 7 }], range, 2.5).kind, 'rep');
});

test('hint: otherwise +1 rep at the same weight, capped at the top of the range', () => {
  const h = suggest([{ weight: 35, reps: 8 }, { weight: 35, reps: 10 }, { weight: 35, reps: 9 }], range, 2.5);
  assert.equal(h.kind, 'rep');
  assert.equal(h.text, 'Aim for +1 rep at 35 kg');
  assert.deepEqual(h.reps, [9, 10, 10]);
});

test('hint: nothing without history, a rep range, or with bodyweight-only sets', () => {
  assert.equal(suggest([], range, 2.5), null);
  assert.equal(suggest([{ weight: 35, reps: 8 }], null, 2.5), null);
  assert.equal(suggest([{ weight: 0, reps: 12 }], range, 2.5), null);
});

// ---------------- records ----------------
test('records: heaviest for ≥1/3/5/8 reps and best est. 1RM, done working sets only', () => {
  const sessions = [
    S('2026-11-02', [['Bench', [set(100, 1), set(90, 3), set(80, 8)]]]),
    S('2026-11-09', [['Bench', [set(85, 5), set(120, 1, 'warmup'), set(110, 1, 'working', false)]]]),
    S('2026-11-30', [['Bench', [set(200, 1)]]]), // planned (future) — ignored
  ];
  const r = exerciseRecords(sessions, 'bench', TODAY);
  assert.deepEqual(r.reps[1], { weight: 100, reps: 1, date: '2026-11-02' });
  assert.deepEqual(r.reps[3], { weight: 90, reps: 3, date: '2026-11-02' });
  assert.deepEqual(r.reps[5], { weight: 85, reps: 5, date: '2026-11-09' });
  assert.deepEqual(r.reps[8], { weight: 80, reps: 8, date: '2026-11-02' });
  assert.equal(Math.round(r.e1rm.value * 10) / 10, 101.3); // 80×8
  assert.equal(r.sessions, 2);
});

// ---------------- body ----------------
const body = [
  { date: '2026-11-01', weight: 82.0 }, { date: '2026-11-05', weight: 81.6 },
  { date: '2026-11-10', weight: 81.4 }, { date: '2026-11-12', weight: 81.0, waist: 86 },
  { date: '2026-11-17', weight: 80.6 }, { date: '2026-11-18', weight: 81.2 }, { date: '2026-11-19', weight: 80.5, waist: 85 },
];
test('body: 7-day moving average, 7/30-day change, latest', () => {
  assert.equal(movingAverage(body, '2026-11-19').toFixed(2), '80.77'); // 13th–19th: 80.6, 81.2, 80.5
  assert.equal(movingAverage(body, '2026-11-12').toFixed(2), '81.20'); // 6th–12th: 81.4, 81.0
  assert.equal(changeOver(body, 7).toFixed(2), '-0.43');
  assert.equal(movingAverage(body, '2026-10-20'), null);
  assert.equal(changeOver(body, 30), null); // nothing around Oct 20
  assert.equal(latestEntry(body).weight, 80.5);
  assert.equal(latestEntry(body, 'waist').waist, 85);
  assert.equal(trendSeries(body).length, 7);
});

test('body entries are validated', () => {
  assert.equal(normalizeBodyEntry({ date: '2026-11-19', weight: '80,5' }).weight, 80.5);
  assert.equal(normalizeBodyEntry({ date: '2026-11-19', weight: 5 }), null);
  assert.equal(normalizeBodyEntry({ date: 'nope', weight: 80 }), null);
  assert.equal(normalizeBodyEntry({ date: '2026-11-19', weight: 80, waist: 'x' }).waist, null);
});

// ---------------- migration ----------------
test('v2 backup → v3: set types, rest/step fields, empty body log', () => {
  const out = migrateBackup({
    schemaVersion: 2,
    sessions: [{ v: 2, date: '2026-11-18', type: 'Legs', exercises: [{ name: 'Squat', sets: [{ weight: 100, reps: 5, done: true }] }] }],
  });
  assert.deepEqual(out.sessions[0].exercises[0].sets, [{ weight: 100, reps: 5, done: true, type: 'working' }]);
  assert.deepEqual(out.body, []);
  const withBody = migrateBackup({ schemaVersion: 3, sessions: [], body: [{ date: '2026-11-19', weight: 80 }, { date: 'x', weight: 1 }] });
  assert.equal(withBody.body.length, 1);
  assert.equal(upgradeSessionRecord({ v: 2, date: '2026-11-18', exercises: [{ name: 'Squat', sets: [{ weight: 1, reps: 1, done: false }] }] }).session.exercises[0].sets[0].type, 'working');
});
