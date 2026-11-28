// Training volume per muscle group (the body map). Pure functions, no DOM, no storage.
//
// How it's counted (also shown in the app's "How it's counted" sheet):
//   - Only ticked working sets count (warm-ups and unticked or planned sets never do; failure sets do).
//   - Each set counts 1 for every primary muscle group of its exercise and 0.5 for every secondary group.
//   - "This week" = the current week from its first day up to today.
//   - "Last 4 weeks" = the four finished weeks before this one, added up and divided by 4 (sets per week).
//   - A group's weekly target defaults to 10 sets. Under 50% of target is "Undertrained"; 0 is "No sets yet".
import { GROUPS, setWeight } from './muscles.js';
import { isCompleteSet } from './stats.js';
import { addDays, startOfWeek } from './dates.js';

export const DEFAULT_TARGET = 10;
const zero = () => Object.fromEntries(GROUPS.map((g) => [g, 0]));
const round1 = (n) => Math.round(n * 10) / 10;

/** Weighted sets per group in [from, to] (dates inclusive, never after today). groupsOf(name) → { primary, secondary }. */
export function setsByGroup(sessions, from, to, groupsOf, today) {
  const out = zero();
  for (const s of sessions) {
    if (s.date < from || s.date > to || s.date > today) continue;
    for (const ex of s.exercises) {
      const n = ex.sets.filter(isCompleteSet).length;
      if (!n) continue;
      const groups = groupsOf(ex.name);
      for (const g of GROUPS) out[g] += n * setWeight(groups, g);
    }
  }
  return out;
}

/** { perWeek: { group: sets }, from, to, weeks } for mode 'week' (this week) or '4w' (last 4 finished weeks). */
export function weeklySets(sessions, { mode = 'week', today, weekStartsOn = 1, groupsOf }) {
  const start = startOfWeek(today, weekStartsOn);
  if (mode === '4w') {
    const from = addDays(start, -28);
    const to = addDays(start, -1);
    const total = setsByGroup(sessions, from, to, groupsOf, today);
    return { perWeek: Object.fromEntries(GROUPS.map((g) => [g, round1(total[g] / 4)])), from, to, weeks: 4 };
  }
  const total = setsByGroup(sessions, start, today, groupsOf, today);
  return { perWeek: Object.fromEntries(GROUPS.map((g) => [g, round1(total[g])])), from: start, to: today, weeks: 1 };
}

export const targetFor = (group, targets = {}, fallback = DEFAULT_TARGET) => {
  const n = Number(targets?.[group]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** 'none' (no sets yet), 'under' (< 50% of target: Undertrained), 'below' (50–99%), 'met' (≥ target). */
export function statusFor(sets, target) {
  if (!(sets > 0)) return 'none';
  if (sets < target * 0.5) return 'under';
  return sets >= target ? 'met' : 'below';
}
export const STATUS_LABEL = { none: 'No sets yet', under: 'Undertrained', below: 'Below target', met: 'On target' };

/** Fill step 0–4 for the map: 0 = no sets, then ≤25%, ≤50%, <100%, ≥100% of target. */
export function rampLevel(sets, target) {
  if (!(sets > 0)) return 0;
  const f = sets / target;
  return f <= 0.25 ? 1 : f <= 0.5 ? 2 : f < 1 ? 3 : 4;
}

/** Groups under 50% of their target (including no sets yet), biggest gap first. */
export function undertrained(perWeek, targets = {}, fallback = DEFAULT_TARGET) {
  return GROUPS.map((g) => ({ group: g, sets: perWeek[g] ?? 0, target: targetFor(g, targets, fallback) }))
    .filter((r) => statusFor(r.sets, r.target) === 'none' || statusFor(r.sets, r.target) === 'under')
    .map((r) => ({ ...r, gap: round1(r.target - r.sets) }))
    .sort((a, b) => b.gap - a.gap || GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group));
}

/** Exercises that hit a group in [from, to]: [{ name, sets (weighted), role }], most first. */
export function exercisesForGroup(sessions, group, from, to, groupsOf, today) {
  const map = new Map();
  for (const s of sessions) {
    if (s.date < from || s.date > to || s.date > today) continue;
    for (const ex of s.exercises) {
      const w = setWeight(groupsOf(ex.name), group);
      const n = ex.sets.filter(isCompleteSet).length;
      if (!w || !n) continue;
      const k = ex.name.toLowerCase();
      const row = map.get(k) ?? { name: ex.name, sets: 0, role: w === 1 ? 'primary' : 'secondary' };
      row.sets += n * w;
      map.set(k, row);
    }
  }
  return [...map.values()].map((r) => ({ ...r, sets: round1(r.sets) })).sort((a, b) => b.sets - a.sets || a.name.localeCompare(b.name));
}

/** The most recent date (≤ today) with a ticked working set for the group, or null. */
export function lastTrained(sessions, group, groupsOf, today) {
  let last = null;
  for (const s of sessions) {
    if (s.date > today || (last && s.date <= last)) continue;
    if (s.exercises.some((ex) => setWeight(groupsOf(ex.name), group) > 0 && ex.sets.some(isCompleteSet))) last = s.date;
  }
  return last;
}

/**
 * Planned sets per group for the week starting weekStart: each day's own session if it has exercises
 * (its working sets, ticked or not), otherwise the weekly plan's template for that day.
 * plannedTypeFor(date) → type | null; templateFor(type) → [{ name, sets }].
 */
export function plannedByGroup({ weekStart, getSession, plannedTypeFor, templateFor, groupsOf }) {
  const out = zero();
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i);
    const s = getSession(date);
    const items = s?.exercises?.length
      ? s.exercises.map((e) => ({ name: e.name, sets: e.sets.filter((x) => x.type !== 'warmup').length }))
      : (templateFor(plannedTypeFor(date)) ?? []).filter((t) => t.kind !== 'cardio').map((t) => ({ name: t.name, sets: t.sets }));
    for (const it of items) {
      const groups = groupsOf(it.name);
      for (const g of GROUPS) out[g] += (it.sets ?? 0) * setWeight(groups, g);
    }
  }
  return Object.fromEntries(GROUPS.map((g) => [g, round1(out[g])]));
}
