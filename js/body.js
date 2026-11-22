// Bodyweight trend maths. Pure functions.
import { addDays } from './dates.js';

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Trailing 7-day moving average at `date`: the mean of entries in [date-6, date].
 * null if there are none in that window.
 */
export function movingAverage(entries, date, field = 'weight', days = 7) {
  const from = addDays(date, -(days - 1));
  const xs = entries.filter((e) => e.date >= from && e.date <= date && e[field] != null).map((e) => e[field]);
  return xs.length ? mean(xs) : null;
}

/** entries sorted oldest first → [{ date, value, avg }] */
export function trendSeries(entries, field = 'weight') {
  const sorted = entries.filter((e) => e[field] != null).sort((a, b) => (a.date < b.date ? -1 : 1));
  return sorted.map((e) => ({ date: e.date, value: e[field], avg: movingAverage(sorted, e.date, field) }));
}

/**
 * Change over the last `days`: smoothed value at the latest entry minus smoothed value `days` earlier.
 * Using the 7-day average at both ends keeps a single heavy/light morning from dominating.
 * null when there's no data in the earlier window.
 */
export function changeOver(entries, days, field = 'weight') {
  const withField = entries.filter((e) => e[field] != null);
  if (!withField.length) return null;
  const latest = withField.reduce((a, b) => (a.date > b.date ? a : b)).date;
  const now = movingAverage(withField, latest, field);
  const then = movingAverage(withField, addDays(latest, -days), field);
  return now == null || then == null ? null : now - then;
}

export function latestEntry(entries, field = 'weight') {
  const withField = entries.filter((e) => e[field] != null);
  return withField.length ? withField.reduce((a, b) => (a.date > b.date ? a : b)) : null;
}
