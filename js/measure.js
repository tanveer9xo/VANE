// Body measurements (schema v8). Pure functions.
// A Body log entry is flat: { date, weight (kg) | null, waist (cm) | null, neck, shoulders, chest, armL, armR,
// forearm, hips, thighL, thighR, calf (cm, only the ones recorded), bodyFat (%, only if recorded), updatedAt }.
// Any subset is fine: nothing is required. Lengths are stored in cm whatever the profile shows.

/** Every site, in body order. `group` is what you choose to track (left/right go together). */
export const SITES = [
  { key: 'neck', label: 'Neck', group: 'neck', min: 20, max: 80 },
  { key: 'shoulders', label: 'Shoulders', group: 'shoulders', min: 60, max: 200 },
  { key: 'chest', label: 'Chest', group: 'chest', min: 50, max: 200 },
  { key: 'armL', label: 'Upper arm, left', group: 'upperArm', min: 15, max: 70 },
  { key: 'armR', label: 'Upper arm, right', group: 'upperArm', min: 15, max: 70 },
  { key: 'forearm', label: 'Forearm', group: 'forearm', min: 15, max: 60 },
  { key: 'waist', label: 'Waist', group: 'waist', min: 30, max: 300 },
  { key: 'hips', label: 'Hips', group: 'hips', min: 50, max: 200 },
  { key: 'thighL', label: 'Thigh, left', group: 'thigh', min: 25, max: 120 },
  { key: 'thighR', label: 'Thigh, right', group: 'thigh', min: 25, max: 120 },
  { key: 'calf', label: 'Calf', group: 'calf', min: 15, max: 70 },
];
export const BODY_FAT = { key: 'bodyFat', label: 'Body fat %', min: 2, max: 70 };
export const SITE_KEYS = SITES.map((s) => s.key);

/** The tracking choices (Settings → Profile and the Body tab). */
export const GROUPS = [
  { id: 'neck', label: 'Neck' }, { id: 'shoulders', label: 'Shoulders' }, { id: 'chest', label: 'Chest' },
  { id: 'upperArm', label: 'Upper arm (left and right)' }, { id: 'forearm', label: 'Forearm' }, { id: 'waist', label: 'Waist' },
  { id: 'hips', label: 'Hips' }, { id: 'thigh', label: 'Thigh (left and right)' }, { id: 'calf', label: 'Calf' },
  { id: 'bodyFat', label: 'Body fat % (your own estimate)' },
];
export const GROUP_IDS = GROUPS.map((g) => g.id);
export const DEFAULT_TRACKED = ['chest', 'waist', 'hips', 'upperArm', 'thigh'];

/** A valid tracking list (unknown ids dropped, body order kept); not an array → the defaults. */
export function normalizeTracked(raw) {
  if (!Array.isArray(raw)) return [...DEFAULT_TRACKED];
  return GROUP_IDS.filter((g) => raw.includes(g));
}

/** The sites shown for a tracking list, in body order (body fat comes separately). */
export const trackedSites = (tracked) => SITES.filter((s) => tracked.includes(s.group));
export const tracksBodyFat = (tracked) => tracked.includes('bodyFat');
export const siteByKey = (key) => (key === BODY_FAT.key ? BODY_FAT : SITES.find((s) => s.key === key) ?? null);

const num = (v) => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const round = (n, dp) => Math.round(n * 10 ** dp) / 10 ** dp;

/** One value in range (cm, 2 dp; body fat 1 dp), or null. */
export function cleanValue(key, v) {
  const s = siteByKey(key);
  const n = num(v);
  if (!s || n == null || n < s.min || n > s.max) return null;
  return round(n, key === BODY_FAT.key ? 1 : 2);
}

/** The measurement fields of an entry that hold a valid value: { chest: 101.5, bodyFat: 18, … } */
export function cleanMeasurements(raw) {
  const out = {};
  for (const key of [...SITE_KEYS, BODY_FAT.key]) {
    const v = cleanValue(key, raw?.[key]);
    if (v != null) out[key] = v;
  }
  return out;
}

/** Entries that have `key`, oldest first. */
const withKey = (entries, key) => entries.filter((e) => e[key] != null).sort((a, b) => (a.date < b.date ? -1 : 1));

/**
 * Per-site figures: latest value, change since the first entry and since the previous one (raw values, not
 * averaged: measurements are occasional). null when the site has no entries.
 */
export function siteStats(entries, key) {
  const list = withKey(entries, key);
  if (!list.length) return null;
  const first = list[0];
  const latest = list.at(-1);
  const previous = list.length > 1 ? list.at(-2) : null;
  return {
    count: list.length,
    first, latest, previous,
    sinceFirst: list.length > 1 ? round(latest[key] - first[key], 2) : null,
    sinceLast: previous ? round(latest[key] - previous[key], 2) : null,
  };
}

/** Chart points for a site: [{ date, value }] oldest first. */
export const siteSeries = (entries, key) => withKey(entries, key).map((e) => ({ date: e.date, value: e[key] }));

/** Waist ÷ height, both in cm, to 2 dp; null without both. A plain ratio of two measurements. */
export function waistToHeight(waistCm, heightCm) {
  if (!(waistCm > 0) || !(heightCm > 0)) return null;
  return round(waistCm / heightCm, 2);
}
