import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TEMPLATES, DEFAULT_WEEK, BREAK, defaultSchedule } from '../js/model.js';
import {
  scheduledFor, withWeekFrom, exercisesFromTemplate, plannedExercise, isCompleted, dayStatus, weekProgress, currentWeek,
} from '../js/plan.js';
import { exerciseHistory, sessionVolume } from '../js/stats.js';

const TODAY = '2026-11-19'; // Thursday
const S = (date, type, exercises = [], extra = {}) => ({
  v: 2, date, type, notes: '', cardioMinutes: null, createdAt: 1, updatedAt: 1,
  exercises: exercises.map(([name, sets], i) => ({
    id: `${date}-${i}`, name, target: null,
    sets: sets.map(([weight, reps, done = true]) => ({ weight, reps, done })),
  })),
  ...extra,
});

test('default week: Mon Push … Sun Break, from the start date only', () => {
  const sched = defaultSchedule('2026-11-16');
  const week = ['16', '17', '18', '19', '20', '21', '22'].map((d) => scheduledFor(`2026-11-${d}`, sched));
  assert.deepEqual(week, ['Push', 'Pull', 'Legs', BREAK, 'Upper', 'Lower', BREAK]);
  assert.equal(scheduledFor('2026-11-09', sched), null); // before planning started
});

test('schedule edits apply from today; past days keep their plan', () => {
  let sched = defaultSchedule('2026-11-01');
  sched = withWeekFrom(sched, TODAY, { ...DEFAULT_WEEK, mon: 'Full body' });
  assert.equal(scheduledFor('2026-11-16', sched), 'Push'); // last Monday unchanged
  assert.equal(scheduledFor('2026-11-23', sched), 'Full body'); // next Monday changed
  assert.equal(currentWeek(sched).mon, 'Full body');
  // Editing twice on the same day replaces that day's version instead of stacking.
  sched = withWeekFrom(sched, TODAY, { ...DEFAULT_WEEK, mon: 'Legs' });
  assert.equal(sched.length, 2);
  assert.equal(scheduledFor('2026-11-23', sched), 'Legs');
});

test('template → exercises: target sets, weights from last time, nothing done', () => {
  const history = [S('2026-11-16', 'Push', [['DB Chest Press', [[35, 8], [35, 7]]]])];
  const exs = exercisesFromTemplate('Push', DEFAULT_TEMPLATES, history, '2026-11-23', TODAY);
  assert.deepEqual(exs.map((e) => e.name), DEFAULT_TEMPLATES.Push.map((t) => t.name));
  const chest = exs[0];
  assert.deepEqual(chest.target, { sets: 4, repsMin: 8, repsMax: 10 });
  const W = (weight, reps) => ({ weight, reps, done: false, type: 'working' });
  assert.deepEqual(chest.sets, [W(35, 8), W(35, 7), W(35, 7), W(35, 7)]);
  assert.deepEqual(exs[1].sets, Array(3).fill(W(null, null))); // no history → empty
  assert.equal(chest.weightStep, null); // follows the settings default (set by experience)
  assert.equal(exs[0].restSeconds, null); // default rest
  assert.equal(exercisesFromTemplate('Legs', DEFAULT_TEMPLATES, [], TODAY, TODAY)[0].restSeconds, 180); // Squat
});

test('editing a template never changes sessions built from it', () => {
  const templates = structuredClone(DEFAULT_TEMPLATES);
  const [ex] = exercisesFromTemplate('Push', templates, [], TODAY, TODAY);
  templates.Push[0].sets = 9;
  templates.Push[0].name = 'Renamed';
  assert.equal(ex.target.sets, 4);
  assert.equal(ex.name, 'DB Chest Press');
});

test('pre-filled sets do not count until done', () => {
  const s = S(TODAY, 'Push', [['DB Chest Press', [[35, 8, false], [35, 8, false]]]]);
  assert.equal(isCompleted(s), false);
  assert.equal(sessionVolume(s), 0);
  assert.equal(exerciseHistory([s], 'db chest press', { today: TODAY }).length, 0);
  s.exercises[0].sets[0].done = true;
  assert.equal(isCompleted(s), true);
  assert.equal(sessionVolume(s), 280);
});

test('dayStatus: done / planned / missed / break / rest / override', () => {
  const sched = defaultSchedule('2026-11-01');
  assert.equal(dayStatus('2026-11-17', null, sched, TODAY).state, 'missed'); // Tue Pull, nothing logged
  assert.equal(dayStatus('2026-11-17', S('2026-11-17', 'Pull', [['Pull-up', [[0, 8, false]]]]), sched, TODAY).state, 'missed'); // only pre-filled
  assert.deepEqual(dayStatus('2026-11-16', S('2026-11-16', 'Push', [['Pec Deck', [[40, 12]]]]), sched, TODAY), { state: 'done', type: 'Push', sched: 'Push' });
  assert.equal(dayStatus(TODAY, null, sched, TODAY).state, 'break'); // Thu
  assert.equal(dayStatus(TODAY, S(TODAY, BREAK), sched, TODAY).state, 'rest');
  assert.deepEqual(dayStatus('2026-11-20', null, sched, TODAY), { state: 'planned', type: 'Upper', sched: 'Upper', fromSession: false });
  const override = dayStatus('2026-11-20', S('2026-11-20', 'Legs'), sched, TODAY);
  assert.equal(override.type, 'Legs');
  assert.equal(override.fromSession, true);
  assert.equal(dayStatus('2026-10-01', null, sched, TODAY).state, 'none'); // before the plan existed
  // A future session can't be "done" even with ticked sets.
  assert.equal(dayStatus('2026-11-21', S('2026-11-21', 'Lower', [['Deadlift', [[100, 5]]]]), sched, TODAY).state, 'planned');
});

test('weekProgress counts completed vs planned training days', () => {
  const sched = defaultSchedule('2026-11-01');
  const sessions = new Map([
    ['2026-11-16', S('2026-11-16', 'Push', [['Pec Deck', [[40, 12]]]])],
    ['2026-11-18', S('2026-11-18', 'Legs', [['Squat', [[100, 5]]]])],
    ['2026-11-19', S('2026-11-19', BREAK)],
  ]);
  const wk = weekProgress((d) => sessions.get(d) ?? null, sched, TODAY, 1);
  assert.equal(wk.start, '2026-11-16');
  assert.deepEqual(wk.days.map((d) => d.state), ['done', 'missed', 'done', 'rest', 'planned', 'planned', 'break']);
  assert.equal(wk.completed, 2);
  assert.equal(wk.planned, 5); // Push, Pull, Legs, Upper, Lower
  // An unplanned extra session on a break day counts as both.
  sessions.set('2026-11-19', S('2026-11-19', 'Cardio', [], { cardioMinutes: 30 }));
  const wk2 = weekProgress((d) => sessions.get(d) ?? null, sched, TODAY, 1);
  assert.equal(wk2.completed, 3);
  assert.equal(wk2.planned, 6);
});

test('plannedExercise without a target uses last time’s set count', () => {
  const history = [S('2026-11-16', 'Push', [['Dips', [[0, 10], [0, 9]]]])];
  const ex = plannedExercise('Dips', null, history, TODAY, TODAY);
  assert.equal(ex.sets.length, 2);
  assert.equal(ex.target, null);
});
