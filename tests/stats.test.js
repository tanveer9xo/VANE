import test from 'node:test';
import assert from 'node:assert/strict';
import {
  epley, exerciseHistory, exerciseSummary, lastSetsFor, lastSessionOfType, prsForSession, weekStats,
  formatSets, fmtNum, sessionVolume, exerciseUsage,
} from '../js/stats.js';

const S = (date, type, exercises, extra = {}) => ({
  v: 1, date, type, notes: '', cardioMinutes: null, createdAt: 1, updatedAt: 1,
  exercises: exercises.map(([name, sets], i) => ({ id: `${date}-${i}`, name, sets: sets.map(([weight, reps]) => ({ weight, reps })) })),
  ...extra,
});

const TODAY = '2026-11-19';
const data = [
  S('2026-11-02', 'Push', [['DB Chest Press', [[30, 10], [30, 8]]]]),
  S('2026-11-09', 'Push', [['DB Chest Press', [[32.5, 8], [32.5, 8]]], ['Lateral Raise', [[10, 12]]]]),
  S('2026-11-12', 'Pull', [['Pull-up', [[0, 8], [0, 7]]]]),
  S('2026-11-16', 'Push', [['db chest press', [[35, 8], [35, 6], [null, 8], [35, null]]]]),
  S('2026-11-25', 'Push', [['DB Chest Press', [[60, 5]]]]), // planned (future)
];

test('epley', () => {
  assert.equal(epley(100, 1), 100);
  assert.ok(Math.abs(epley(100, 10) - 133.333) < 0.01);
  assert.equal(epley(0, 10), 0);
  assert.equal(epley(null, 5), 0);
  assert.equal(epley(50, 0), 0);
});

test('history ignores planned sessions, incomplete sets and name case', () => {
  const h = exerciseHistory(data, 'db chest press', { today: TODAY });
  assert.deepEqual(h.map((x) => x.date), ['2026-11-02', '2026-11-09', '2026-11-16']);
  assert.equal(h[2].sets.length, 2); // [null,8] and [35,null] dropped
  assert.equal(h[0].isE1rmPR, false); // first attempt is never a PR
});

test('PR flags follow running best', () => {
  const h = exerciseHistory(data, 'db chest press', { today: TODAY });
  // 30×10 → 40.0; 32.5×8 → 41.17 (PR); 35×8 → 44.33 (PR)
  assert.deepEqual(h.map((x) => x.isE1rmPR), [false, true, true]);
  assert.deepEqual(h.map((x) => x.isWeightPR), [false, true, true]);
});

test('summary', () => {
  const s = exerciseSummary(exerciseHistory(data, 'db chest press', { today: TODAY }));
  assert.equal(s.count, 3);
  assert.equal(s.heaviest.weight, 35);
  assert.equal(s.heaviest.reps, 8);
  assert.equal(fmtNum(s.best.e1rm, 1), '44.3');
  assert.equal(s.best.date, '2026-11-16');
});

test('lastSetsFor returns the previous logged sets, not same-day or planned', () => {
  assert.equal(formatSets(lastSetsFor(data, 'db chest press', '2026-11-16', TODAY).sets), '32.5×8, 32.5×8');
  assert.equal(lastSetsFor(data, 'db chest press', '2026-11-30', TODAY).date, '2026-11-16');
  assert.equal(lastSetsFor(data, 'squat', TODAY, TODAY), null);
});

test('formatSets shows bodyweight', () => {
  assert.equal(formatSets(lastSetsFor(data, 'pull-up', TODAY, TODAY).sets), 'BW×8, BW×7');
});

test('lastSessionOfType', () => {
  assert.equal(lastSessionOfType(data, 'Push', TODAY, TODAY).date, '2026-11-16');
  assert.equal(lastSessionOfType(data, 'Push', '2026-11-16', TODAY).date, '2026-11-09');
  assert.equal(lastSessionOfType(data, 'Legs', TODAY, TODAY), null);
});

test('prsForSession flags the right set index and skips planned days', () => {
  const session = data[3];
  const prs = prsForSession(data, session, TODAY);
  const info = prs.get(session.exercises[0].id);
  assert.ok(info);
  assert.deepEqual([...info.sets.keys()], [0]);
  assert.deepEqual(info.sets.get(0), ['Best est. 1RM', 'Heaviest for 1 rep', 'Heaviest for 3 reps', 'Heaviest for 5 reps', 'Heaviest for 8+ reps']);
  assert.deepEqual(info.lines, ['New best est. 1RM 44.3 kg (was 41.2)', 'Heaviest 35 kg for 1/3/5/8+ reps (was 32.5)']);
  assert.equal(prsForSession(data, data[4], TODAY).size, 0);
  assert.equal(prsForSession(data, data[0], TODAY).size, 0); // first time
});

test('volume and weekly stats', () => {
  assert.equal(sessionVolume(data[3]), 35 * 8 + 35 * 6);
  const w = weekStats(data, TODAY, 1);
  assert.equal(w.weekStart, '2026-11-16');
  assert.equal(w.thisWeek.sessions, 1);
  assert.equal(w.thisWeek.volume, 490);
  assert.equal(w.lastWeek.sessions, 2); // 9th and 12th
  const sundayStart = weekStats(data, TODAY, 0);
  assert.equal(sundayStart.weekStart, '2026-11-15');
});

test('exerciseUsage counts logged sessions by type', () => {
  const u = exerciseUsage(data, TODAY).get('db chest press');
  assert.equal(u.count, 3);
  assert.equal(u.byType.Push, 3);
  assert.equal(u.lastDate, '2026-11-16');
});
