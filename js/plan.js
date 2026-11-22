// Weekly plan logic: what's scheduled on a date, building a day from a template, day status, week progress.
// Pure functions — no DOM, no storage.
import { BREAK, WEEKDAY_KEYS, isTrainingType, exerciseKey, uid, newSession, cleanNote } from './model.js';
import { parseISODate, addDays, startOfWeek } from './dates.js';
import { lastLoggedSets, isCompleteSet, isLoggedSet } from './stats.js';

/** The schedule version in force on `date` (latest with from ≤ date), or null before planning began. */
export function scheduleVersionFor(date, schedule) {
  let found = null;
  for (const v of schedule ?? []) if (v.from <= date) found = v;
  return found;
}

/** Scheduled type for a date: a training type, BREAK, or null. */
export function scheduledFor(date, schedule) {
  const v = scheduleVersionFor(date, schedule);
  const d = parseISODate(date);
  return v && d ? v.days[WEEKDAY_KEYS[d.getDay()]] ?? null : null;
}

/** The week as it currently applies (latest version), or null. */
export const currentWeek = (schedule) => (schedule?.length ? schedule[schedule.length - 1].days : null);

/** New schedule list where `days` applies from `today` on; earlier days keep their plan. */
export function withWeekFrom(schedule, today, days) {
  return [...(schedule ?? []).filter((v) => v.from < today), { from: today, days: { ...days } }];
}

export const templateFor = (type, templates) => templates?.[type] ?? [];

/**
 * One planned exercise, all sets not done. Weights/reps come from the last logged session:
 * its warm-ups carry over as warm-ups, then `item.sets` working sets (or as many as last time).
 * `item` may be a template item { sets, repsMin, repsMax, weightStep, restSeconds } or null.
 */
export function plannedExercise(name, item, sessions, date, today) {
  const last = lastLoggedSets(sessions, exerciseKey(name), date, today);
  const warmups = (last?.sets ?? []).filter((s) => s.type === 'warmup');
  const working = (last?.sets ?? []).filter((s) => s.type !== 'warmup');
  const count = Math.max(1, item?.sets ?? working.length ?? 1);
  const sets = [
    ...warmups.map((s) => ({ weight: s.weight, reps: s.reps, done: false, type: 'warmup' })),
    ...Array.from({ length: count }, (_, i) => {
      const src = working[i] ?? working[working.length - 1];
      return { weight: src?.weight ?? null, reps: src?.reps ?? null, done: false, type: src?.type === 'failure' ? 'failure' : 'working' };
    }),
  ];
  return {
    id: uid(),
    name,
    target: item ? { sets: item.sets, repsMin: item.repsMin, repsMax: item.repsMax } : null,
    weightStep: item?.weightStep ?? null,
    restSeconds: item?.restSeconds ?? null,
    hintDismissed: false,
    note: lastNoteFor(sessions, exerciseKey(name), date, today),
    sets,
  };
}

/** The most recent non-empty per-exercise note before `date`, so it shows up next time. */
export function lastNoteFor(sessions, key, date, today) {
  let found = null;
  for (const s of sessions) {
    if (s.date >= date || s.date > today) continue;
    const ex = s.exercises.find((e) => exerciseKey(e.name) === key && e.note?.trim());
    if (ex && (!found || s.date > found.date)) found = { date: s.date, note: ex.note };
  }
  return cleanNote(found?.note ?? '');
}

/**
 * A planned (nothing ticked) copy of `source` on `date`: same type and exercises, weights from the
 * last time each exercise was logged before `date` (falling back to the source's own sets).
 */
export function copySessionTo(source, date, sessions, settings, today) {
  const s = newSession(date, settings, source.type);
  s.cardioMinutes = source.cardioMinutes ?? s.cardioMinutes;
  s.exercises = source.exercises.map((ex) => {
    const workingCount = Math.max(1, ex.sets.filter((x) => x.type !== 'warmup').length);
    const item = { ...(ex.target ?? {}), sets: workingCount, weightStep: ex.weightStep, restSeconds: ex.restSeconds };
    const planned = plannedExercise(ex.name, item, sessions, date, today);
    planned.target = ex.target ? { ...ex.target } : null;
    const own = ex.sets.filter(isLoggedSet);
    if (planned.sets.every((x) => x.weight == null) && own.length) {
      planned.sets = own.map((x) => ({ weight: x.weight, reps: x.reps, done: false, type: x.type ?? 'working' }));
    }
    planned.note = ex.note || planned.note;
    return planned;
  });
  return s;
}

/** Exercises for a fresh day of `type` (deep copies — later template edits never touch the session). */
export function exercisesFromTemplate(type, templates, sessions, date, today) {
  return templateFor(type, templates).map((item) => plannedExercise(item.name, item, sessions, date, today));
}

/**
 * Template item for an exercise: from this type's template first, otherwise any template that has it
 * (so a Deadlift added by hand still gets its rest time and step). null if none.
 */
export function templateItemFor(type, name, templates) {
  const key = exerciseKey(name);
  const find = (list) => list?.find((t) => exerciseKey(t.name) === key) ?? null;
  return find(templates?.[type]) ?? Object.values(templates ?? {}).map(find).find(Boolean) ?? null;
}

export const restSecondsFor = (ex, settings) => ex.restSeconds ?? settings.defaultRestSeconds ?? 90;
export const weightStepFor = (ex, settings) => ex.weightStep ?? settings.weightStep ?? 2.5;

/**
 * A training day counts as completed once at least one working set is done, Cardio minutes are
 * logged on a Cardio day, or the workout was finished from its summary sheet.
 */
export function isCompleted(session) {
  if (!session || session.type === BREAK) return false;
  return !!session.finishedAt || session.exercises.some((e) => e.sets.some(isCompleteSet))
    || (session.type === 'Cardio' && session.cardioMinutes > 0);
}

/**
 * Status of a date for the calendar:
 *   done    — completed training (type = what was actually done)
 *   rest    — break deliberately logged
 *   break   — scheduled break, nothing logged
 *   planned — training planned (today or later), not done yet
 *   missed  — training was planned on a past date and not done
 *   none    — nothing planned or logged
 * `fromSession` marks a one-off override (the day's own session sets the type).
 */
export function dayStatus(date, session, schedule, today) {
  const sched = scheduledFor(date, schedule);
  if (session?.type === BREAK) return { state: 'rest', type: BREAK, sched };
  if (session && date <= today && isCompleted(session)) return { state: 'done', type: session.type, sched };
  const type = session?.type ?? sched;
  if (!type) return { state: 'none', type: null, sched };
  if (type === BREAK) return { state: 'break', type, sched };
  return { state: date < today ? 'missed' : 'planned', type, sched, fromSession: !!session?.type };
}

/**
 * Where a session stands: 'empty' (nothing ticked), 'started' (something ticked), 'finished'.
 */
export function progressState(session) {
  if (!session) return 'empty';
  if (session.finishedAt) return 'finished';
  return isCompleted(session) ? 'started' : 'empty';
}

/**
 * Current streak: consecutive completed training days counting back from today.
 * Break days, rest days and unplanned days are skipped (they never break it); a missed planned day ends it.
 * Today counts if done, and doesn't break it if still planned.
 */
export function currentStreak(getSession, schedule, today, limit = 730) {
  let streak = 0;
  for (let i = 0; i < limit; i++) {
    const date = addDays(today, -i);
    const st = dayStatus(date, getSession(date), schedule, today);
    if (st.state === 'done') streak++;
    else if (st.state === 'missed') break;
  }
  return streak;
}

/** The week containing `today`: per-day status plus completed vs planned training days. */
export function weekProgress(getSession, schedule, today, weekStartsOn = 1) {
  const start = startOfWeek(today, weekStartsOn);
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i);
    return { date, ...dayStatus(date, getSession(date), schedule, today) };
  });
  const completed = days.filter((d) => d.state === 'done').length;
  const planned = days.filter((d) => d.state === 'done' || (isTrainingType(d.type) && d.state !== 'rest')).length;
  return { start, days, completed, planned };
}
