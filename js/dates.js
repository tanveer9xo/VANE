// All workout dates are *local* calendar dates stored as 'YYYY-MM-DD' strings.
// Never derive them with toISOString(): that converts to UTC and can shift the day.

const pad = (n) => String(n).padStart(2, '0');

export function toISODate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO(now = new Date()) {
  return toISODate(now);
}

/** Parse 'YYYY-MM-DD' as a local date at noon (noon sidesteps DST-at-midnight quirks). */
export function parseISODate(s) {
  if (typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  return toISODate(d) === s ? d : null; // rejects 2026-02-30 etc.
}

export const isValidISODate = (s) => parseISODate(s) !== null;

export function addDays(iso, n) {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a, b) {
  return Math.round((parseISODate(b) - parseISODate(a)) / 86400000);
}

/** { year, month } with month 1–12. */
export function monthOf(iso) {
  return { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) };
}

export function monthKey({ year, month }) {
  return `${year}-${pad(month)}`;
}

export function parseMonthKey(s) {
  const m = /^(\d{4})-(\d{2})$/.exec(s ?? '');
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(m[1]), month };
}

export function addMonths({ year, month }, delta) {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (((idx % 12) + 12) % 12) + 1 };
}

/** weekStartsOn: 0 = Sunday, 1 = Monday. */
export function startOfWeek(iso, weekStartsOn = 1) {
  const d = parseISODate(iso);
  const diff = (d.getDay() - weekStartsOn + 7) % 7;
  d.setDate(d.getDate() - diff);
  return toISODate(d);
}

/** Always 6 rows × 7 days so the calendar height never jumps between months. */
export function monthGrid({ year, month }, weekStartsOn = 1) {
  const first = toISODate(new Date(year, month - 1, 1, 12));
  let cur = startOfWeek(first, weekStartsOn);
  const days = [];
  for (let i = 0; i < 42; i++) {
    days.push({ iso: cur, day: Number(cur.slice(8)), inMonth: Number(cur.slice(5, 7)) === month });
    cur = addDays(cur, 1);
  }
  return days;
}

// ---- Formatting (uses the device locale) ----
const fmtCache = new Map();
function dtf(opts) {
  const key = JSON.stringify(opts);
  if (!fmtCache.has(key)) fmtCache.set(key, new Intl.DateTimeFormat(undefined, opts));
  return fmtCache.get(key);
}

export function formatLong(iso) {
  return dtf({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(parseISODate(iso));
}

export function formatDayTitle(iso) {
  return dtf({ weekday: 'short', day: 'numeric', month: 'short' }).format(parseISODate(iso));
}

export function formatShort(iso, today = todayISO()) {
  const sameYear = iso.slice(0, 4) === today.slice(0, 4);
  const opts = sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' };
  return dtf(opts).format(parseISODate(iso));
}

export function formatMonthTitle({ year, month }) {
  return dtf({ month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1, 12));
}

export function weekdayLabels(weekStartsOn = 1) {
  // 2024-01-07 was a Sunday.
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(2024, 0, 7 + ((weekStartsOn + i) % 7), 12);
    return { short: dtf({ weekday: 'narrow' }).format(d), abbr: dtf({ weekday: 'short' }).format(d), long: dtf({ weekday: 'long' }).format(d) };
  });
}

export function relativeDay(iso, today = todayISO()) {
  const n = daysBetween(today, iso);
  if (n === 0) return 'Today';
  if (n === -1) return 'Yesterday';
  if (n === 1) return 'Tomorrow';
  return n < 0 ? `${-n} days ago` : `In ${n} days`;
}
