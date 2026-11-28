// Derived numbers: estimated 1RM, history, PRs, weekly totals. Pure functions.
import { exerciseKey } from './model.js';
import { startOfWeek, addDays } from './dates.js';
import { fmtW, fmtWU } from './units.js';

/** Epley estimated 1RM. A single is taken at face value. Bodyweight (0 kg) → 0. */
export function epley(weight, reps) {
  if (!(weight > 0) || !(reps > 0)) return 0;
  return reps === 1 ? weight : weight * (1 + reps / 30);
}

/** Logged = ticked done with reps and a weight (0 = bodyweight). Any set type. */
export const isLoggedSet = (s) => s != null && s.done !== false && s.reps > 0 && s.weight != null;

/**
 * Counts toward volume, PRs, est. 1RM, progress and hints: a logged set that isn't a warm-up.
 * Unticked (planned/pre-filled), half-filled and warm-up sets are ignored everywhere.
 */
export const isCompleteSet = (s) => isLoggedSet(s) && s.type !== 'warmup';

export function setsVolume(sets) {
  return sets.filter(isCompleteSet).reduce((sum, s) => sum + s.weight * s.reps, 0);
}

export function sessionVolume(session) {
  return session.exercises.reduce((sum, ex) => sum + setsVolume(ex.sets), 0);
}

export function sessionSetCount(session) {
  return session.exercises.reduce((n, ex) => n + ex.sets.filter(isCompleteSet).length, 0);
}

/** Up to 2 decimals, no trailing zeros: 22.5, 100, 102.33 */
export function fmtNum(n, maxDecimals = 2) {
  if (n == null || !Number.isFinite(n)) return '';
  return String(Number(n.toFixed(maxDecimals)));
}

const intFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
export const fmtInt = (n) => intFmt.format(Math.round(n));

/** "32.5×8", or spaced "32.5 × 8" for running text. 0 kg = bodyweight. */
export function formatSet(s, spaced = false) {
  return `${s.weight === 0 ? 'BW' : fmtW(s.weight)}${spaced ? ' × ' : '×'}${s.reps}`;
}

export function formatSets(sets, spaced = false) {
  return sets.filter(isCompleteSet).map((x) => formatSet(x, spaced)).join(', ');
}

/** Done working sets with repeats grouped: "25×8 ×3, 22.5×8". */
export function formatSetGroups(sets) {
  const groups = [];
  for (const x of sets.filter(isCompleteSet)) {
    const label = formatSet(x);
    if (groups.at(-1)?.label === label) groups.at(-1).n++;
    else groups.push({ label, n: 1 });
  }
  return groups.map((g) => (g.n > 1 ? `${g.label} ×${g.n}` : g.label)).join(', ');
}

/**
 * Per-session history for one exercise, oldest first.
 * Options: today — ignore planned (future) sessions; before — only dates strictly before.
 * Each entry: { date, sets, best: {weight, reps, e1rm}, top: {weight, reps}, volume, isE1rmPR, isWeightPR }
 */
export function exerciseHistory(sessions, key, { today, before } = {}) {
  const out = [];
  for (const s of sessions) {
    if (today && s.date > today) continue;
    if (before && s.date >= before) continue;
    const sets = s.exercises.filter((e) => exerciseKey(e.name) === key).flatMap((e) => e.sets).filter(isCompleteSet);
    if (!sets.length) continue;
    let best = null;
    let top = null;
    for (const set of sets) {
      const e1rm = epley(set.weight, set.reps);
      if (!best || e1rm > best.e1rm) best = { weight: set.weight, reps: set.reps, e1rm };
      if (!top || set.weight > top.weight || (set.weight === top.weight && set.reps > top.reps)) {
        top = { weight: set.weight, reps: set.reps };
      }
    }
    out.push({ date: s.date, type: s.type, sets, best, top, volume: setsVolume(sets) });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  let bestSoFar = -Infinity;
  let topSoFar = -Infinity;
  out.forEach((h, i) => {
    h.isE1rmPR = i > 0 && h.best.e1rm > 0 && h.best.e1rm > bestSoFar + 1e-9;
    h.isWeightPR = i > 0 && h.top.weight > 0 && h.top.weight > topSoFar + 1e-9;
    bestSoFar = Math.max(bestSoFar, h.best.e1rm);
    topSoFar = Math.max(topSoFar, h.top.weight);
  });
  return out;
}

export function exerciseSummary(history) {
  if (!history.length) return null;
  let best = null;
  let heaviest = null;
  for (const h of history) {
    if (!best || h.best.e1rm > best.e1rm) best = { ...h.best, date: h.date };
    if (!heaviest || h.top.weight > heaviest.weight || (h.top.weight === heaviest.weight && h.top.reps > heaviest.reps)) {
      heaviest = { ...h.top, date: h.date };
    }
  }
  const maxReps = Math.max(...history.flatMap((h) => h.sets.map((s) => s.reps)));
  return { best, heaviest, maxReps, count: history.length, first: history[0], last: history[history.length - 1] };
}

/** The most recent logged sets for an exercise before `beforeDate` (planned sessions excluded). */
export function lastSetsFor(sessions, key, beforeDate, today) {
  const hist = exerciseHistory(sessions, key, { today, before: beforeDate });
  const last = hist[hist.length - 1];
  return last ? { date: last.date, sets: last.sets } : null;
}

/**
 * The most recent logged sets *including warm-ups* (with their types), used to pre-fill a new day
 * so its structure (e.g. 2 warm-ups + 3 working) carries over. Planned sessions excluded.
 */
export function lastLoggedSets(sessions, key, beforeDate, today) {
  let best = null;
  for (const s of sessions) {
    if (s.date >= beforeDate || s.date > today) continue;
    if (best && s.date <= best.date) continue;
    const sets = s.exercises.filter((e) => exerciseKey(e.name) === key).flatMap((e) => e.sets);
    if (sets.some(isCompleteSet)) best = { date: s.date, sets: sets.filter(isLoggedSet) };
  }
  return best;
}

/** Most recent logged session of a type with at least one exercise, before `beforeDate`. */
export function lastSessionOfType(sessions, type, beforeDate, today) {
  let found = null;
  for (const s of sessions) {
    if (s.type !== type || s.date >= beforeDate || s.date > today || !s.exercises.length) continue;
    if (!found || s.date > found.date) found = s;
  }
  return found;
}

// ---------------------------------------------------------------------------
// Records: best est. 1RM and heaviest weight for at least 1, 3, 5 and 8 reps (8 = "8+").
// Only working sets that are ticked done count. Ties keep the earliest date.
// ---------------------------------------------------------------------------
export const REP_BUCKETS = [1, 3, 5, 8];
export const bucketLabel = (b) => (b === 8 ? '8+' : String(b));

function recordsFrom(history) {
  const rec = { e1rm: null, reps: Object.fromEntries(REP_BUCKETS.map((b) => [b, null])) };
  for (const { date, sets } of history) {
    for (const s of sets) {
      const e = epley(s.weight, s.reps);
      if (e > 0 && (!rec.e1rm || e > rec.e1rm.value + 1e-9)) rec.e1rm = { value: e, weight: s.weight, reps: s.reps, date };
      for (const b of REP_BUCKETS) {
        const cur = rec.reps[b];
        if (s.reps >= b && s.weight > 0 && (!cur || s.weight > cur.weight + 1e-9)) rec.reps[b] = { weight: s.weight, reps: s.reps, date };
      }
    }
  }
  return rec;
}

/** { e1rm, reps: {1,3,5,8}, sessions, last } for one exercise, or null if never logged. */
export function exerciseRecords(sessions, key, today) {
  const hist = exerciseHistory(sessions, key, { today });
  if (!hist.length) return null;
  return { ...recordsFrom(hist), sessions: hist.length, last: hist[hist.length - 1].date };
}

/** Records for every logged exercise, alphabetical. */
export function allRecords(sessions, today) {
  return [...exerciseUsage(sessions, today).values()]
    .map((u) => ({ key: u.key, name: u.name, ...exerciseRecords(sessions, u.key, today) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * PRs set in this session versus everything logged before its date.
 * Returns Map(exerciseId → { lines: string[], sets: Map(setIndex → string[]) }).
 * Only done working sets; no PRs for planned (future) days or a first-ever attempt,
 * and a rep bucket only counts once it has a previous record to beat.
 */
export function prsForSession(sessions, session, today) {
  const result = new Map();
  if (session.date > today) return result;
  for (const ex of session.exercises) {
    const prior = exerciseHistory(sessions, exerciseKey(ex.name), { today, before: session.date });
    if (!prior.length) continue;
    const rec = recordsFrom(prior);
    const working = ex.sets.map((s, i) => ({ s, i })).filter(({ s }) => isCompleteSet(s));
    const info = { lines: [], sets: new Map() };
    const tag = (i, label) => info.sets.set(i, [...(info.sets.get(i) ?? []), label]);

    let best = null;
    for (const w of working) {
      const e = epley(w.s.weight, w.s.reps);
      if (e > 0 && (!best || e > best.e)) best = { ...w, e };
    }
    if (best && rec.e1rm && best.e > rec.e1rm.value + 1e-9) {
      tag(best.i, 'Best est. 1RM');
      info.lines.push(`New best est. 1RM ${fmtWU(best.e, 1)} (was ${fmtW(rec.e1rm.value, 1)})`);
    }

    const byWeight = new Map(); // weight → buckets beaten, to keep the message short
    for (const b of REP_BUCKETS) {
      const prev = rec.reps[b];
      if (!prev) continue;
      let cand = null;
      for (const w of working) if (w.s.reps >= b && w.s.weight > 0 && (!cand || w.s.weight > cand.s.weight)) cand = w;
      if (cand && cand.s.weight > prev.weight + 1e-9) {
        tag(cand.i, `Heaviest for ${bucketLabel(b)} rep${b === 1 ? '' : 's'}`);
        const k = `${cand.s.weight}|${prev.weight}`;
        byWeight.set(k, [...(byWeight.get(k) ?? []), bucketLabel(b)]);
      }
    }
    for (const [k, buckets] of byWeight) {
      const [w, was] = k.split('|').map(Number);
      info.lines.push(`Heaviest ${fmtWU(w)} for ${buckets.join('/')} reps (was ${fmtW(was)})`);
    }
    if (info.lines.length) result.set(ex.id, info);
  }
  return result;
}

/** Number of sets flagged as PRs across a prsForSession() result. */
export const prSetCount = (prs) => [...prs.values()].reduce((n, info) => n + info.sets.size, 0);

/** Exercises with logged sets: Map(key → { key, name, count, lastDate, byType }). */
export function exerciseUsage(sessions, today) {
  const usage = new Map();
  for (const s of sessions) {
    if (s.date > today) continue;
    for (const ex of s.exercises) {
      if (!ex.sets.some(isCompleteSet)) continue;
      const key = exerciseKey(ex.name);
      const u = usage.get(key) ?? { key, name: ex.name, count: 0, lastDate: '', byType: {} };
      u.count++;
      if (s.date > u.lastDate) { u.lastDate = s.date; u.name = ex.name; }
      if (s.type) u.byType[s.type] = (u.byType[s.type] ?? 0) + 1;
      usage.set(key, u);
    }
  }
  return usage;
}

function rangeStats(sessions, from, to, isCounted) {
  const out = { sessions: 0, volume: 0, sets: 0, cardioMinutes: 0 };
  for (const s of sessions) {
    if (s.date < from || s.date > to || !isCounted(s)) continue;
    out.sessions++;
    out.volume += sessionVolume(s);
    out.sets += sessionSetCount(s);
    for (const e of s.exercises) if (e.kind === 'cardio' && e.cardio?.done) out.cardioMinutes += e.cardio.minutes ?? 0;
  }
  return out;
}

/** This week (week start → today, planned days excluded) and the whole of last week. */
export function weekStats(sessions, today, weekStartsOn = 1, isCounted = () => true) {
  const start = startOfWeek(today, weekStartsOn);
  return {
    weekStart: start,
    thisWeek: rangeStats(sessions, start, today, isCounted),
    lastWeek: rangeStats(sessions, addDays(start, -7), addDays(start, -1), isCounted),
  };
}

// ---------------------------------------------------------------------------
// Trend and stalls for one exercise (Progress → Charts). history = exerciseHistory(…), oldest first.
// value(entry) defaults to the session's best est. 1RM (top reps for bodyweight-only exercises).
// ---------------------------------------------------------------------------
const trendValue = (x) => (x.best.e1rm > 0 ? x.best.e1rm : x.top.reps);

/**
 * Up / Flat / Down over the last `n` sessions: the least-squares slope across them, as a share of their
 * mean, over the span. ≥ +1% is up, ≤ −1% is down, anything between is flat. null under `n` sessions.
 */
export function trendOf(history, n = 4, value = trendValue) {
  if (history.length < n) return null;
  const ys = history.slice(-n).map(value);
  const xm = (n - 1) / 2;
  const ym = ys.reduce((a, b) => a + b, 0) / n;
  if (!(ym > 0)) return null;
  let num = 0;
  let den = 0;
  ys.forEach((y, i) => { num += (i - xm) * (y - ym); den += (i - xm) ** 2; });
  const change = ((num / den) * (n - 1)) / ym;
  return { dir: change >= 0.01 ? 'up' : change <= -0.01 ? 'down' : 'flat', change };
}

/**
 * Sessions since the best est. 1RM was last raised (the first session counts as setting it).
 * stalled = 4 or more sessions without a new best.
 */
export function stallOf(history, value = trendValue, limit = 4) {
  if (!history.length) return { since: 0, stalled: false };
  let best = -Infinity;
  let at = 0;
  history.forEach((x, i) => { const v = value(x); if (v > best + 1e-9) { best = v; at = i; } });
  const since = history.length - 1 - at;
  return { since, stalled: since >= limit, bestDate: history[at].date };
}
