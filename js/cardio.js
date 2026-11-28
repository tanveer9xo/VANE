// Cardio (schema v11): a cardio exercise is one entry in a workout, with no sets, kg or reps. Pure.
//
//   exercise: { id, name, kind: 'cardio', sets: [], cardio: { minutes, distanceKm, speedKmh, incline, kcal, done,
//               timerStartedAt } }
//
// Only Time (minutes) is needed to finish an entry; everything else is optional and stays null when empty
// (never 0). Distance and speed are stored as you typed them (km, km/h); with Time plus one of them, the other is
// worked out when shown (derive) and marked as calculated, never stored.

export const ACTIVITIES = [
  { key: 'treadmill', name: 'Treadmill', icon: 'treadmill' },
  { key: 'walking', name: 'Walking', icon: 'walk' },
  { key: 'running', name: 'Running', icon: 'run' },
  { key: 'jogging', name: 'Jogging', icon: 'run' },
  { key: 'cycling', name: 'Cycling', icon: 'bike' },
  { key: 'rowing', name: 'Rowing', icon: 'heart-rate-monitor' },
  { key: 'stairs', name: 'Stairs', icon: 'trending-up' },
  { key: 'other', name: 'Other cardio', icon: 'heart-rate-monitor' },
];
const byName = new Map(ACTIVITIES.map((a) => [a.name.toLowerCase(), a]));
export const activityFor = (name) => byName.get(String(name ?? '').trim().toLowerCase()) ?? null;
export const activityByKey = (key) => ACTIVITIES.find((a) => a.key === key) ?? null;
export const isCardioExercise = (ex) => ex?.kind === 'cardio';

const num = (v, lo, hi, dp) => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
  if (!Number.isFinite(n) || n < lo || n > hi) return null;
  return Math.round(n * 10 ** dp) / 10 ** dp;
};
/** Field limits; out of range or not a number → null (empty). */
export const FIELDS = {
  minutes: (v) => num(v, 0.1, 1440, 1),
  distanceKm: (v) => num(v, 0.01, 1000, 3),
  speedKmh: (v) => num(v, 0.1, 100, 2),
  incline: (v) => num(v, 0, 40, 1),
  kcal: (v) => { const n = num(v, 0, 10000, 0); return n; },
};

export function emptyCardio() {
  return { minutes: null, distanceKm: null, speedKmh: null, incline: null, kcal: null, done: false, timerStartedAt: null };
}

export function normalizeCardio(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const out = emptyCardio();
  for (const [k, f] of Object.entries(FIELDS)) out[k] = f(c[k]);
  out.done = c.done === true && out.minutes != null; // Done needs a time
  out.timerStartedAt = Number.isFinite(c.timerStartedAt) && c.timerStartedAt > 0 ? c.timerStartedAt : null;
  return out;
}

/** A new cardio exercise for a day (no sets). */
export function newCardioExercise(name, id) {
  return { id, name, kind: 'cardio', target: null, weightStep: null, restSeconds: null, hintDismissed: false, note: '', sets: [], cardio: emptyCardio() };
}

/**
 * Distance and speed as shown: with Time and exactly one of them, the other is worked out.
 * → { distanceKm, speedKmh, calc: 'distance' | 'speed' | null }
 * Time only (or nothing): both stay as entered, i.e. empty. Both entered: shown as entered, nothing calculated.
 */
export function derive({ minutes, distanceKm, speedKmh }) {
  const hours = minutes > 0 ? minutes / 60 : null;
  if (hours && distanceKm != null && speedKmh == null) return { distanceKm, speedKmh: Math.round((distanceKm / hours) * 100) / 100, calc: 'speed' };
  if (hours && speedKmh != null && distanceKm == null) return { distanceKm: Math.round(speedKmh * hours * 1000) / 1000, speedKmh, calc: 'distance' };
  return { distanceKm, speedKmh, calc: null };
}

/** Every cardio entry in a list of sessions: [{ date, name, minutes, distanceKm, speedKmh, incline, kcal, done, calc }]. */
export function cardioEntries(sessions) {
  const out = [];
  for (const s of sessions) {
    for (const ex of s.exercises ?? []) {
      if (!isCardioExercise(ex)) continue;
      const c = ex.cardio ?? emptyCardio();
      out.push({ date: s.date, name: ex.name, ...c, ...derive(c) });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Finished cardio in [from, to]: minutes always; distance only from entries that have one (entered or worked out
 * from Time + Speed). → { minutes, distanceKm, withDistance, entries }
 */
export function cardioTotals(sessions, from, to) {
  const done = cardioEntries(sessions).filter((e) => e.done && e.date >= from && e.date <= to);
  const withDistance = done.filter((e) => e.distanceKm != null);
  return {
    minutes: Math.round(done.reduce((n, e) => n + (e.minutes ?? 0), 0) * 10) / 10,
    distanceKm: Math.round(withDistance.reduce((n, e) => n + e.distanceKm, 0) * 100) / 100,
    withDistance: withDistance.length,
    entries: done.length,
  };
}

/** History for one activity (by exercise name), finished entries only, oldest first. */
export const cardioHistory = (sessions, name) => cardioEntries(sessions).filter((e) => e.done && e.name.toLowerCase() === String(name).toLowerCase());

/** Schema v10 → v11: treadmill minutes on a workout become a Treadmill entry in it (null/0 → nothing). */
export function migrateTreadmillMinutes(session, makeId) {
  const { cardioMinutes, ...rest } = session;
  const minutes = FIELDS.minutes(cardioMinutes);
  if (minutes == null || session.type === 'Break') return rest;
  // Done if the workout itself was done (ticked sets, finished, or a Cardio day), as the minutes counted before.
  const finished = !!session.finishedAt || session.type === 'Cardio'
    || (session.exercises ?? []).some((e) => (e.sets ?? []).some((x) => x.done && x.type !== 'warmup'));
  const entry = newCardioExercise('Treadmill', makeId());
  entry.cardio = { ...emptyCardio(), minutes, done: finished };
  return { ...rest, exercises: [...(rest.exercises ?? []), entry] };
}
