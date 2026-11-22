// Weekly review, sets per muscle and records table rows. Pure functions — no DOM, no storage.
import { isCompleteSet, sessionVolume, prsForSession, prSetCount, REP_BUCKETS, bucketLabel } from './stats.js';
import { dayStatus } from './plan.js';
import { movingAverage } from './body.js';
import { addDays } from './dates.js';
import { exName } from './library.js';

const inRange = (s, from, to) => s.date >= from && s.date <= to;

/**
 * Review of the week starting `start`:
 *   { start, end, done, planned, volume, prevVolume, prs, prLines, bodyChange }
 * Only days up to `today` count. bodyChange = 7-day average at the week's last weigh-in day
 * minus the average the day before the week started (null without data on both sides).
 */
export function weeklyReview({ sessions, getSession, schedule, body, start, today }) {
  const end = addDays(start, 6);
  const last = end < today ? end : today;
  let done = 0;
  let planned = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    const st = dayStatus(d, getSession(d), schedule, today);
    if (st.state === 'done') { done++; planned++; } else if (['missed', 'planned'].includes(st.state)) planned++;
  }
  const week = sessions.filter((s) => inRange(s, start, last));
  const prev = sessions.filter((s) => inRange(s, addDays(start, -7), addDays(start, -1)) && s.date <= today);
  const volume = week.reduce((n, s) => n + sessionVolume(s), 0);
  const prevVolume = prev.reduce((n, s) => n + sessionVolume(s), 0);
  let prs = 0;
  const prLines = [];
  for (const s of week) {
    const map = prsForSession(sessions, s, today);
    prs += prSetCount(map);
    for (const [id, info] of map) {
      const ex = s.exercises.find((e) => e.id === id);
      info.lines.forEach((line) => prLines.push(`${ex ? exName(ex.name) : ''}: ${line}`));
    }
  }
  const lastWeighIn = body.filter((e) => inRange(e, start, last)).map((e) => e.date).sort().at(-1);
  const after = lastWeighIn ? movingAverage(body, lastWeighIn) : null;
  const before = movingAverage(body, addDays(start, -1));
  return {
    start, end, done, planned, volume, prevVolume, prs, prLines,
    bodyChange: after != null && before != null ? after - before : null,
  };
}

/**
 * Records table rows for one exercise. Consecutive rep buckets held by the very same set are merged
 * into one row, so the table never repeats a set: [{ buckets: [1, 3, 5], label: '1–5', weight, reps, date }].
 */
export function recordRows(rec) {
  const rows = [];
  for (const b of REP_BUCKETS) {
    const r = rec?.reps?.[b];
    if (!r) continue;
    const prevRow = rows.at(-1);
    if (prevRow && prevRow.weight === r.weight && prevRow.reps === r.reps && prevRow.date === r.date) {
      prevRow.buckets.push(b);
    } else {
      rows.push({ buckets: [b], weight: r.weight, reps: r.reps, date: r.date });
    }
  }
  return rows.map((r) => ({
    ...r,
    label: r.buckets.length > 1 ? `${bucketLabel(r.buckets[0])}–${bucketLabel(r.buckets.at(-1))}` : bucketLabel(r.buckets[0]),
  }));
}
