// Consistency definitions: planned / done / skipped / extra, weekly adherence, streaks, month figures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyze, summarize, finishedWeeks, lastWeeks, currentWeek, thisWeekSoFar, monthStats, weekStreaks, weekHit, bestDayStreak,
  rollingAdherence, skipByType, skipByWeekday, missedDays, reasonCounts, MIN_PLANNED_WEEKS,
} from '../js/consistency.js';
import { migrateBackup, normalizeSkipReasons, pickSettings, SKIP_REASONS } from '../js/model.js';
import { currentStreak } from '../js/plan.js';

// Mon Push, Tue Pull, Wed Legs, Thu Break, Fri Upper, Sat Lower, Sun Break
const DAYS = { mon: 'Push', tue: 'Pull', wed: 'Legs', thu: 'Break', fri: 'Upper', sat: 'Lower', sun: 'Break' };
const SCHEDULE = [{ from: '2026-11-02', days: DAYS }]; // Monday
const sess = (date, type = 'Push') => ({ date, type, cardioMinutes: null, finishedAt: null, exercises: [{ id: date, name: 'X', sets: [{ weight: 50, reps: 5, done: true, type: 'working' }] }] });
const rest = (date) => ({ date, type: 'Break', exercises: [], finishedAt: null, cardioMinutes: null });
const run = (dates, { schedule = SCHEDULE, today, rests = [], firstDate } = {}) => {
  const map = new Map([...dates.map((d) => [d, sess(d)]), ...rests.map((d) => [d, rest(d)])]);
  return analyze({ getSession: (d) => map.get(d) ?? null, schedule, firstDate: firstDate ?? dates.slice().sort()[0] ?? null, today, weekStartsOn: 1 });
};
const week = (a, start) => a.weeks.find((w) => w.start === start);
const state = (a, date) => a.weeks.flatMap((w) => w.days).find((d) => d.date === date).state;

test('on the day: a planned session done on its own date', () => {
  const a = run(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-06', '2026-11-07'], { today: '2026-11-09' });
  const w = week(a, '2026-11-02');
  assert.deepEqual([w.planned, w.onTime, w.moved, w.filled, w.skipped, w.extra], [5, 5, 0, 5, 0, 0]);
  assert.equal(state(a, '2026-11-05'), 'none'); // Break day
  assert.equal(summarize(a.weeks).adherence, 1);
});

test('a session moved to another day of the same week still counts', () => {
  // Wed Legs is done on Thu (a Break day) instead.
  const a = run(['2026-11-02', '2026-11-03', '2026-11-05', '2026-11-06', '2026-11-07'], { today: '2026-11-09' });
  const w = week(a, '2026-11-02');
  assert.deepEqual([w.planned, w.onTime, w.moved, w.filled, w.skipped, w.extra], [5, 4, 1, 5, 0, 0]);
  assert.equal(state(a, '2026-11-04'), 'moved'); // the planned day
  assert.equal(state(a, '2026-11-05'), 'movedin'); // the day it was really done: not an extra
  const s = summarize(a.weeks);
  assert.equal(s.adherence, 1); // weekly adherence counts it
  assert.equal(s.onTimeRate, 4 / 5); // the stricter rate doesn't
});

test('a session moved into the next week is a skip in the first week', () => {
  // Sat Lower (7th) is done on Mon the 9th, which is also a planned Push day: Mon's own plan is covered
  // by that workout, and the 9th has nothing left to give, so week 1 skips Lower.
  const a = run(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-06', '2026-11-09'], { today: '2026-11-17' });
  const w1 = week(a, '2026-11-02');
  assert.deepEqual([w1.planned, w1.filled, w1.skipped], [5, 4, 1]);
  assert.equal(state(a, '2026-11-07'), 'skipped');
  assert.equal(state(a, '2026-11-09'), 'done'); // it is Monday's own planned session
  // Done on a non-planned day of the next week instead (Sun the 8th is week 1; Thu the 12th is week 2).
  const b = run(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-06', '2026-11-12'], { today: '2026-11-17' });
  assert.equal(state(b, '2026-11-07'), 'skipped');
  assert.equal(week(b, '2026-11-02').skipped, 1);
  // …and in the next week it fills Monday's open session instead.
  assert.equal(state(b, '2026-11-09'), 'moved');
  assert.equal(state(b, '2026-11-12'), 'movedin');
});

test('Break days are never skips; a completed workout on one is an extra', () => {
  const a = run(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-06', '2026-11-07', '2026-11-05'], { today: '2026-11-09' });
  const w = week(a, '2026-11-02');
  assert.equal(w.skipped, 0);
  assert.equal(w.extra, 1);
  assert.equal(state(a, '2026-11-05'), 'extra');
  assert.equal(state(a, '2026-11-08'), 'none'); // Sunday break, nothing logged: nothing counted
  assert.equal(summarize(a.weeks).extra, 1);
});

test('an unplanned-day workout is an extra (no schedule on that weekday)', () => {
  const sched = [{ from: '2026-11-02', days: { ...DAYS, sun: null } }];
  const a = run(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-06', '2026-11-07', '2026-11-08'], { today: '2026-11-10', schedule: sched });
  assert.equal(state(a, '2026-11-08'), 'extra');
});

test('a day logged as a rest day is excused, not a skip', () => {
  const a = run(['2026-11-02', '2026-11-03', '2026-11-06', '2026-11-07'], { today: '2026-11-09', rests: ['2026-11-04'] });
  const w = week(a, '2026-11-02');
  assert.deepEqual([w.planned, w.rest, w.skipped, w.filled], [4, 1, 0, 4]); // Wed left out of the planned count
  assert.equal(state(a, '2026-11-04'), 'rest');
  assert.equal(summarize(a.weeks).rest, 1);
});

test('schedule changes apply from their date; earlier weeks keep the old plan', () => {
  const schedule = [
    { from: '2026-11-02', days: DAYS },
    { from: '2026-11-09', days: { mon: 'Push', tue: null, wed: null, thu: null, fri: 'Upper', sat: null, sun: null } },
  ];
  const a = run(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-06', '2026-11-07', '2026-11-09'], { today: '2026-11-17', schedule });
  assert.equal(week(a, '2026-11-02').planned, 5);
  assert.equal(week(a, '2026-11-09').planned, 2);
  assert.equal(week(a, '2026-11-09').skipped, 1); // Friday the 13th
  assert.equal(state(a, '2026-11-10'), 'none'); // the old Tuesday Pull no longer exists
});

test('first-week baseline: nothing counts before the first day of use or the schedule', () => {
  // Schedule starts on Wed the 4th. Mon the 2nd and Tue the 3rd must not be planned (or missed).
  const schedule = [{ from: '2026-11-04', days: DAYS }];
  const a = run(['2026-11-04', '2026-11-06'], { today: '2026-11-10', schedule });
  assert.equal(a.baseline, '2026-11-04');
  const w = week(a, '2026-11-02');
  assert.deepEqual([w.planned, w.filled, w.skipped], [3, 2, 1]); // Wed, Fri, Sat only
  assert.equal(state(a, '2026-11-02'), 'none');
  assert.equal(state(a, '2026-11-03'), 'none');
  // The very first week is partial but still a finished week.
  assert.equal(finishedWeeks(a).length, 1);
});

test('a workout before the plan starts covers an open session of that week', () => {
  // Schedule starts Wed the 4th, first workout is Mon the 2nd. It is unplanned, so it fills the first open session.
  const schedule = [{ from: '2026-11-04', days: DAYS }];
  const a = run(['2026-11-02', '2026-11-04'], { today: '2026-11-10', schedule });
  assert.equal(a.baseline, '2026-11-02');
  assert.equal(state(a, '2026-11-02'), 'movedin');
  assert.equal(state(a, '2026-11-06'), 'moved');
  assert.equal(state(a, '2026-11-07'), 'skipped');
  assert.equal(state(a, '2026-11-03'), 'none'); // no plan yet on Tuesday: never a skip
});

test('a week with zero planned sessions has no adherence and is left out', () => {
  const sched = [{ from: '2026-11-02', days: { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } }];
  const a = run(['2026-11-03'], { today: '2026-11-10', schedule: sched });
  const w = week(a, '2026-11-02');
  assert.deepEqual([w.planned, w.filled, w.extra], [0, 0, 1]);
  const s = summarize(a.weeks);
  assert.equal(s.planned, 0);
  assert.equal(s.adherence, null);
  assert.equal(s.weeks, 0);
  assert.equal(s.enough, false);
  assert.equal(weekHit(w, null, a.baseline), null); // neutral for streaks
});

test('the current week is excluded from percentages and shown as so far', () => {
  // Today is Wed the 11th (week of the 9th). Mon done; Tue not (yet resolved); Wed upcoming.
  const a = run(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-06', '2026-11-07', '2026-11-09'], { today: '2026-11-11' });
  assert.equal(finishedWeeks(a).length, 1);
  assert.equal(currentWeek(a).start, '2026-11-09');
  assert.equal(state(a, '2026-11-10'), 'pending'); // not skipped: the week isn't over
  assert.equal(state(a, '2026-11-11'), 'upcoming');
  assert.equal(summarize(a.weeks).planned, 5); // only the finished week
  assert.deepEqual(thisWeekSoFar(a), { done: 1, planned: 5, extra: 0, start: '2026-11-09' });
});

test('under two finished weeks with a plan: not enough data, counts only', () => {
  assert.equal(MIN_PLANNED_WEEKS, 2);
  const a = run(['2026-11-02', '2026-11-03', '2026-11-06'], { today: '2026-11-10' }); // one finished week
  const s = summarize(a.weeks);
  assert.equal(s.enough, false);
  assert.deepEqual([s.done, s.planned, s.skipped], [3, 5, 2]); // the counts are still there
  const two = run(['2026-11-02', '2026-11-03', '2026-11-06', '2026-11-09'], { today: '2026-11-17' });
  assert.equal(summarize(two.weeks).enough, true);
});

test('headline: pooled weekly adherence and the on-the-day rate over a range', () => {
  // Week 1: 3 of 5 (Mon, Wed, Fri on the day). Week 2: 4 of 5 (one moved to Thu). Week 3 is current.
  const dates = ['2026-11-02', '2026-11-04', '2026-11-06', '2026-11-09', '2026-11-10', '2026-11-12', '2026-11-13', '2026-11-16'];
  const a = run(dates, { today: '2026-11-17' });
  const all = summarize(lastWeeks(a, null));
  assert.deepEqual([all.done, all.planned, all.onTime, all.skipped, all.extra], [7, 10, 6, 3, 0]);
  assert.equal(all.adherence, 0.7);
  assert.equal(all.onTimeRate, 0.6);
  const last1 = summarize(lastWeeks(a, 1));
  assert.deepEqual([last1.done, last1.planned], [4, 5]);
  assert.equal(last1.enough, false); // a 1-week window is too thin
});

test('weekly streaks: planned target, minimum sessions, neutral weeks', () => {
  // Weeks of the 2nd, 9th, 16th: hit, hit, miss; today is in the week of the 23rd.
  const full = (m) => [`2026-11-${m}`, `2026-11-${String(+m + 1).padStart(2, '0')}`, `2026-11-${String(+m + 2).padStart(2, '0')}`, `2026-11-${String(+m + 4).padStart(2, '0')}`, `2026-11-${String(+m + 5).padStart(2, '0')}`];
  const dates = [...full('02'), ...full('09'), '2026-11-16'];
  const a = run(dates, { today: '2026-11-24' });
  assert.deepEqual(weekStreaks(a, null), { current: 0, best: 2, currentWeekHit: false });
  // With a minimum of 1 per week, the third week (one workout) hits and the streak is 3.
  assert.deepEqual(weekStreaks(a, 1), { current: 3, best: 3, currentWeekHit: false });
  // A hit running week counts toward the current streak.
  const b = run([...dates, '2026-11-23', '2026-11-24'], { today: '2026-11-24' });
  assert.equal(weekStreaks(b, 2).currentWeekHit, true);
  assert.deepEqual(weekStreaks(b, 2), { current: 1, best: 2, currentWeekHit: true }); // the week of the 16th (1 workout) broke it
  // A first partial week is neutral under a minimum.
  const part = run(['2026-11-04'], { today: '2026-11-10', schedule: [{ from: '2026-11-04', days: DAYS }] });
  assert.equal(weekHit(part.weeks[0], 3, part.baseline), null);
});

test('day streak: Break days never break it, a missed planned day does', () => {
  const dates = new Set(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-06', '2026-11-09']); // Sat 7th missed
  const get = (d) => (dates.has(d) ? sess(d) : null);
  assert.equal(currentStreak(get, SCHEDULE, '2026-11-09'), 1); // Sat missed
  assert.equal(bestDayStreak(get, SCHEDULE, '2026-11-02', '2026-11-09'), 4); // Mon–Wed, Thu Break skipped, Fri
});

test('rolling 4-week adherence', () => {
  const dates = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-06', '2026-11-07', '2026-11-09']; // 5/5, then 1/5
  const a = run(dates, { today: '2026-11-17' });
  assert.deepEqual(rollingAdherence(a, 4), [{ date: '2026-11-02', value: 100 }, { date: '2026-11-09', value: 60 }]);
});

test('where I skip: by session type and weekday, most skipped first', () => {
  // Week 1 skips Sat Lower; week 2 skips Sat Lower and Wed Legs.
  const dates = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-06', '2026-11-09', '2026-11-10', '2026-11-13'];
  const a = run(dates, { today: '2026-11-17' });
  const types = skipByType(a.weeks);
  assert.deepEqual(types.map((r) => [r.label, r.planned, r.skipped]), [['Lower', 2, 2], ['Legs', 2, 1], ['Pull', 2, 0], ['Push', 2, 0], ['Upper', 2, 0]]);
  assert.equal(types[0].rate, 1);
  const days = skipByWeekday(a.weeks, 1);
  assert.deepEqual(days.slice(0, 2).map((r) => r.label), ['Saturday', 'Wednesday']);
});

test('skip reasons: only on missed days, counted per reason', () => {
  const a = run(['2026-11-02', '2026-11-03', '2026-11-06'], { today: '2026-11-10' });
  const missed = missedDays(a);
  // Mon the 9th is in the running week: not final yet, but it can still be given a reason.
  assert.deepEqual(missed.map((d) => d.date), ['2026-11-09', '2026-11-07', '2026-11-04']);
  assert.deepEqual(reasonCounts(missed, { '2026-11-07': 'Busy', '2026-11-04': 'Busy', '2026-11-03': 'Sick' }), { Busy: 2 });
});

test('month figures use the same rules and agree with the totals', () => {
  const dates = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-06', '2026-11-09', '2026-11-10'];
  const a = run(dates, { today: '2026-12-01' });
  const month = monthStats(a, '2026-11-01', '2026-11-30');
  const all = summarize(a.weeks);
  assert.deepEqual([month.done, month.planned, month.skipped], [all.done, all.planned, all.skipped]);
  assert.equal(month.adherence, all.adherence);
  // A month that holds no finished week with a plan has no percentage.
  const early = monthStats(run(dates, { today: '2026-11-05' }), '2026-11-01', '2026-11-05');
  assert.equal(early.planned, 0);
  assert.equal(early.enough, false);
});

test('empty history', () => {
  const a = analyze({ getSession: () => null, schedule: [], firstDate: null, today: '2026-11-10', weekStartsOn: 1 });
  assert.deepEqual(a.weeks, []);
  assert.equal(summarize(a.weeks).enough, false);
});

// ---------------- stored fields ----------------
test('skip reasons and the weekly minimum survive import and are validated', () => {
  assert.deepEqual(normalizeSkipReasons({ '2026-11-07': 'Busy', '2026-02-31': 'Busy', '2026-11-08': 'Lazy', x: 'Sick' }), { '2026-11-07': 'Busy' });
  assert.deepEqual(normalizeSkipReasons([1]), {});
  assert.deepEqual(SKIP_REASONS, ['Busy', 'Travel', 'Tired', 'Sick', 'Other']);
  const v3 = migrateBackup({ schemaVersion: 3, sessions: [] });
  assert.deepEqual(v3.skipReasons, {});
  const v4 = migrateBackup({ schemaVersion: 4, sessions: [], skipReasons: { '2026-11-07': 'Travel' } });
  assert.deepEqual(v4.skipReasons, { '2026-11-07': 'Travel' });
  assert.deepEqual(migrateBackup({ schemaVersion: 4, sessions: [] }).skipReasons, {}); // a 1.4 backup without the field
  assert.deepEqual(pickSettings({ weeklyMin: 3 }), { weeklyMin: 3 });
  assert.deepEqual(pickSettings({ weeklyMin: null }), { weeklyMin: null });
  assert.deepEqual(pickSettings({ weeklyMin: 0 }), {});
  assert.deepEqual(pickSettings({ weeklyMin: 'x' }), {});
});
