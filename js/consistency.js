// Consistency: how much of the plan gets done. Pure functions, no DOM, no storage.
//
// Definitions (the same ones the in-app info sheet shows):
//   planned   a training day in the schedule that applied on that date, from the first day of use,
//             not a Break day, and not deliberately logged as a rest day (those are excused).
//   completed a day with a finished workout or a ticked working set (plan.js isCompleted).
//   done      a planned session that was completed: on its own day, or moved to another day of the
//             same week (a completed workout on a day with no plan or a Break day fills the earliest
//             open planned session of that week).
//   skipped   a planned session of a finished week that no completed workout covered.
//   extra     a completed workout that fills no planned session.
// The current, unfinished week never counts toward a percentage; it is reported as "so far".
import { BREAK, isTrainingType } from './model.js';
import { typeName } from './types.js';
import { scheduledFor, isCompleted, dayStatus } from './plan.js';
import { addDays, startOfWeek, parseISODate, weekdayLabels } from './dates.js';

/** Fewer finished weeks with a plan than this → "Not enough data yet". */
export const MIN_PLANNED_WEEKS = 2;

/**
 * Per-day states:
 *   done      planned and completed on the day        moved     planned, covered by another day this week
 *   movedin   unplanned day that covers a plan        skipped   planned, finished week, not covered
 *   extra     completed, covers nothing               pending   planned, past, week not over yet
 *   upcoming  planned, today or later, not done       rest      planned day deliberately logged as rest
 *   none      nothing planned or done
 */
function analyzeWeek({ start, baseline, today, getSession, schedule }) {
  const end = addDays(start, 6);
  const complete = end < today;
  const days = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i);
    const s = getSession(date);
    const sched = date >= baseline ? scheduledFor(date, schedule) : null;
    days.push({
      date,
      type: isTrainingType(sched) ? sched : null, // what the plan said
      rest: s?.type === BREAK,
      done: date <= today && isCompleted(s),
      state: 'none',
    });
  }
  const planned = days.filter((d) => d.type && !d.rest);
  for (const d of days) if (d.type && d.rest) d.state = 'rest';
  for (const d of planned) if (d.done) d.state = 'done';
  const openPlan = planned.filter((d) => !d.done);
  const openDone = days.filter((d) => d.done && !d.type);
  openPlan.forEach((p, i) => {
    const c = openDone[i];
    if (c) { p.state = 'moved'; c.state = 'movedin'; } else if (complete) p.state = 'skipped';
    else p.state = p.date < today ? 'pending' : 'upcoming';
  });
  openDone.slice(openPlan.length).forEach((c) => { c.state = 'extra'; });

  const count = (st) => days.filter((d) => d.state === st && d.type).length;
  const onTime = count('done');
  const moved = count('moved');
  return {
    start, end, complete, days,
    planned: planned.length, onTime, moved, filled: onTime + moved,
    skipped: count('skipped'), extra: days.filter((d) => d.state === 'extra').length,
    rest: days.filter((d) => d.state === 'rest').length,
    completed: days.filter((d) => d.done).length,
  };
}

/**
 * Every week from the one containing the first day of use up to the current one.
 * firstDate = earliest logged session (or null). Plans only count from the first schedule version.
 */
export function analyze({ getSession, schedule, firstDate = null, today, weekStartsOn = 1 }) {
  const baseline = [schedule?.[0]?.from, firstDate].filter(Boolean).sort()[0] ?? null;
  const weeks = [];
  if (baseline && baseline <= today) {
    for (let start = startOfWeek(baseline, weekStartsOn); start <= today; start = addDays(start, 7)) {
      weeks.push(analyzeWeek({ start, baseline, today, getSession, schedule }));
    }
  }
  return { baseline, today, weekStartsOn, weeks };
}

export const finishedWeeks = (a) => a.weeks.filter((w) => w.complete);
export const currentWeek = (a) => a.weeks.find((w) => !w.complete) ?? null;
/** The last n finished weeks, or all when n is null. */
export const lastWeeks = (a, n = null) => (n == null ? finishedWeeks(a) : finishedWeeks(a).slice(-n));

/**
 * Totals over finished weeks, optionally limited to days where inRange(date) is true.
 * adherence = done ÷ planned (weekly adherence, each week capped at 100% by construction);
 * onTimeRate = planned sessions done on their own day ÷ planned.
 * enough is false under MIN_PLANNED_WEEKS finished weeks with a plan, and then no percentage is shown.
 */
export function summarize(weeks, inRange = () => true) {
  const out = { planned: 0, done: 0, onTime: 0, skipped: 0, extra: 0, rest: 0, weeks: 0 };
  for (const w of weeks) {
    if (!w.complete) continue;
    let weekPlanned = 0;
    for (const d of w.days) {
      if (!inRange(d.date)) continue;
      if (d.state === 'extra') out.extra++;
      if (!d.type) continue;
      if (d.state === 'rest') { out.rest++; continue; }
      out.planned++;
      weekPlanned++;
      if (d.state === 'done') { out.done++; out.onTime++; } else if (d.state === 'moved') out.done++;
      else if (d.state === 'skipped') out.skipped++;
    }
    if (weekPlanned) out.weeks++;
  }
  return {
    ...out,
    enough: out.weeks >= MIN_PLANNED_WEEKS,
    adherence: out.planned ? out.done / out.planned : null,
    onTimeRate: out.planned ? out.onTime / out.planned : null,
  };
}

/** The current week so far: sessions covered of the sessions planned for the whole week. */
export function thisWeekSoFar(a) {
  const w = currentWeek(a);
  return w ? { done: w.filled, planned: w.planned, extra: w.extra, start: w.start } : null;
}

/** Month figures for the calendar, using the same rules (finished weeks only). */
export const monthStats = (a, first, last) => summarize(a.weeks, (d) => d >= first && d <= last);

// ---------------------------------------------------------------------------
// Streaks in weeks: a week "hits" when its target was met.
// target = the planned sessions that week, or weeklyMin sessions (any workouts) when that is set.
// A week with a target of zero is neutral: it neither adds to nor breaks a streak.
// ---------------------------------------------------------------------------
export function weekHit(week, weeklyMin, baseline) {
  if (weeklyMin) return week.start < baseline ? null : week.completed >= weeklyMin; // first partial week is neutral
  return week.planned ? week.filled >= week.planned : null;
}

export function weekStreaks(a, weeklyMin = null) {
  const hits = finishedWeeks(a).map((w) => weekHit(w, weeklyMin, a.baseline));
  const cur = currentWeek(a);
  const curHit = cur ? weekHit(cur, weeklyMin, a.baseline) === true : false;
  let best = 0;
  let run = 0;
  for (const h of [...hits, ...(cur ? [curHit] : [])]) {
    if (h === true) { run++; best = Math.max(best, run); } else if (h === false) run = 0;
  }
  let chain = 0;
  for (let i = hits.length - 1; i >= 0; i--) {
    if (hits[i] === true) chain++;
    else if (hits[i] === false) break;
  }
  return { current: chain + (curHit ? 1 : 0), best, currentWeekHit: curHit };
}

/** Longest run of completed days that no missed planned day interrupts (Break days never do). */
export function bestDayStreak(getSession, schedule, from, today) {
  let best = 0;
  let run = 0;
  for (let d = from; d <= today; d = addDays(d, 1)) {
    const st = dayStatus(d, getSession(d), schedule, today).state;
    if (st === 'done') { run++; best = Math.max(best, run); } else if (st === 'missed') run = 0;
  }
  return best;
}

/** Rolling adherence over the last `window` finished weeks, one point per finished week with a plan. */
export function rollingAdherence(a, window = 4) {
  const weeks = finishedWeeks(a);
  const points = [];
  weeks.forEach((w, i) => {
    const slice = weeks.slice(Math.max(0, i - window + 1), i + 1);
    const planned = slice.reduce((n, x) => n + x.planned, 0);
    if (!w.planned || !planned) return;
    points.push({ date: w.start, value: Math.round((slice.reduce((n, x) => n + x.filled, 0) / planned) * 100) });
  });
  return points;
}

/** Skip rate by session type or weekday, highest first. Rows: { key, label, planned, skipped, rate }. */
function breakdown(weeks, keyOf, labelOf) {
  const map = new Map();
  for (const w of weeks) {
    if (!w.complete) continue;
    for (const d of w.days) {
      if (!d.type || d.state === 'rest') continue;
      const k = keyOf(d);
      const row = map.get(k) ?? { key: k, label: labelOf(k), planned: 0, skipped: 0 };
      row.planned++;
      if (d.state === 'skipped') row.skipped++;
      map.set(k, row);
    }
  }
  return [...map.values()].map((r) => ({ ...r, rate: r.skipped / r.planned }))
    .sort((x, y) => y.rate - x.rate || y.skipped - x.skipped || x.label.localeCompare(y.label));
}
export const skipByType = (weeks) => breakdown(weeks, (d) => d.type, (k) => typeName(k)); // by id, labelled by name
export function skipByWeekday(weeks, weekStartsOn = 1) {
  const names = weekdayLabels(weekStartsOn).map((l) => l.long);
  const nameOf = (dow) => names[(dow - weekStartsOn + 7) % 7];
  return breakdown(weeks, (d) => parseISODate(d.date).getDay(), nameOf);
}

/** Past planned days with no covering workout, newest first. Includes the current week's open days. */
export function missedDays(a, weeks = a.weeks) {
  return weeks.flatMap((w) => w.days.filter((d) => (d.state === 'skipped' || d.state === 'pending') && d.date < a.today))
    .sort((x, y) => (x.date < y.date ? 1 : -1));
}

/** Count of reasons (Busy, Travel…) on the given missed days. */
export function reasonCounts(days, reasons) {
  const counts = {};
  for (const d of days) if (reasons[d.date]) counts[reasons[d.date]] = (counts[reasons[d.date]] ?? 0) + 1;
  return counts;
}
