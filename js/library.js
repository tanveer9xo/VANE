// Exercise library (free-exercise-db, public domain; trimmed copy in data/exercises.json, precached) and the
// per-exercise catalog: which library entry a name you log is, which muscles it trains, custom or not.
// Logged history is keyed by exercise name and is never renamed; the catalog only adds information to a name.
import { groupsFromDataset, normalizeGroups, V4_MUSCLE_TO_GROUP } from './muscles.js';

export const LIBRARY_URL = 'data/exercises.json';

let cache = null;
/** The bundled library: [{ id, name, primaryMuscles, secondaryMuscles, equipment, level, category }]. */
export async function loadLibrary() {
  if (cache) return cache;
  const res = await fetch(LIBRARY_URL);
  if (!res.ok) throw new Error(`Exercise library unavailable (${res.status})`);
  cache = await res.json();
  return cache;
}
export const setLibraryForTests = (list) => { cache = list; };

/**
 * Name → comparison key: lower case, punctuation and spaces dropped, common gym short forms spelled out
 * (DB → dumbbell, BB → barbell, KB → kettlebell) and a plural "s" removed from each word.
 * "Pull-up", "Pullups" and "pull ups" all become "pullup".
 */
export function normaliseName(name) {
  const words = String(name ?? '').toLowerCase().replace(/&/g, ' and ').replace(/['’]/g, '')
    .split(/[^a-z0-9]+/).filter(Boolean)
    .map((w) => ({ db: 'dumbbell', bb: 'barbell', kb: 'kettlebell', ez: 'ez' }[w] ?? w))
    .map((w) => (w.length >= 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
  return words.join('');
}

/** The app's built-in exercise names → library ids (checked against the dataset; see tests). */
export const ALIASES = {
  deadlift: 'Barbell_Deadlift',
  squat: 'Barbell_Squat',
  'db chest press': 'Dumbbell_Bench_Press',
  'incline db press': 'Incline_Dumbbell_Press',
  'pec deck': 'Butterfly',
  'overhead press': 'Standing_Military_Press',
  'lateral raise': 'Side_Lateral_Raise',
  'lat pulldown': 'Wide-Grip_Lat_Pulldown',
  'barbell row': 'Bent_Over_Barbell_Row',
  'seated row': 'Seated_Cable_Rows',
  'pull-up': 'Pullups',
  'biceps curl': 'Dumbbell_Bicep_Curl',
  'leg curl': 'Lying_Leg_Curls',
  'calf raise': 'Standing_Calf_Raises',
};

/** { byId, byNorm } lookups for a library list. Also builds the short display names (see exName). */
export function indexLibrary(library) {
  const byId = new Map();
  const byNorm = new Map();
  for (const e of library ?? []) {
    byId.set(e.id, e);
    const k = normaliseName(e.name);
    if (!byNorm.has(k)) byNorm.set(k, e);
  }
  buildDisplayNames(library ?? []);
  return { byId, byNorm };
}

// ---------------------------------------------------------------------------
// Short display names. Library names are long ("Barbell Bench Press - Medium Grip"); the app shows a cleaned
// one ("Bench Press") everywhere except the picker's detail line. Only names exactly as the library spells
// them are shortened; a name you typed yourself is always shown as you typed it. A short name that would be
// ambiguous (two library entries, or one of your own names) is not used. Stored names never change.
// ---------------------------------------------------------------------------

/** Curated short names for common library entries (checked against the dataset in the tests). */
export const DISPLAY_NAMES = {
  'Barbell Bench Press - Medium Grip': 'Bench Press',
  'Barbell Squat': 'Squat',
  'Barbell Deadlift': 'Deadlift',
  'Bent Over Barbell Row': 'Barbell Row',
  'Standing Military Press': 'Military Press',
  'Side Lateral Raise': 'Lateral Raise',
  'Dips - Triceps Version': 'Triceps Dips',
  'Dips - Chest Version': 'Chest Dips',
  'Close-Grip Barbell Bench Press': 'Close-Grip Bench',
  'Cable Rope Overhead Triceps Extension': 'Overhead Rope Extension',
  'Arnold Dumbbell Press': 'Arnold Press',
  'Front Dumbbell Raise': 'Front Raise',
  'EZ-Bar Skullcrusher': 'Skullcrusher',
  'Seated Cable Rows': 'Seated Cable Row',
  'Wide-Grip Lat Pulldown': 'Wide Lat Pulldown',
  'Dumbbell Bench Press': 'DB Bench Press',
  'Incline Dumbbell Press': 'Incline DB Press',
  'Dumbbell Bicep Curl': 'DB Curl',
  'Lying Leg Curls': 'Lying Leg Curl',
  'Standing Calf Raises': 'Calf Raise',
};

/** Generic clean-up: drop " - variant" and "(…)", Dumbbell → DB, tidy spaces. */
export function cleanDisplay(name) {
  return String(name).split(' - ')[0].replace(/\s*\([^)]*\)/g, '').replace(/\bDumbbells?\b/g, 'DB').replace(/\s+/g, ' ').trim();
}

let display = new Map(); // lower-cased library name → short name
let libNames = new Set(); // lower-cased library names
let taken = new Set(); // lower-cased names you use that aren't library names

function buildDisplayNames(library) {
  libNames = new Set(library.map((e) => e.name.toLowerCase()));
  display = new Map();
  // Curated names first (they win a clash); then the generic clean-up where it's unambiguous.
  const curated = new Set();
  for (const e of library) {
    const d = DISPLAY_NAMES[e.name];
    if (d && !libNames.has(d.toLowerCase())) { display.set(e.name.toLowerCase(), d); curated.add(d.toLowerCase()); }
  }
  const generic = library.filter((e) => !DISPLAY_NAMES[e.name]).map((e) => [e.name, cleanDisplay(e.name)]);
  const count = new Map();
  for (const [, d] of generic) count.set(d.toLowerCase(), (count.get(d.toLowerCase()) ?? 0) + 1);
  for (const [full, d] of generic) {
    const k = d.toLowerCase();
    // Unambiguous only: one entry maps to it, it isn't a curated name, and it isn't another entry's full name.
    if (d && d !== full && count.get(k) === 1 && !curated.has(k) && !libNames.has(k)) display.set(full.toLowerCase(), d);
  }
}

/** Names you log that aren't library names (a short name equal to one of these is not used). */
export function setTakenNames(names) {
  taken = new Set([...names].map((n) => String(n).toLowerCase()).filter((n) => !libNames.has(n)));
}

/** The name to show for an exercise: the short form of a library name, otherwise the name itself. */
export function exName(name) {
  const d = display.get(String(name ?? '').toLowerCase());
  return d && !taken.has(d.toLowerCase()) ? d : name;
}

/** The library entry for a name you use, or null: alias first, then the normalised name. */
export function matchLibrary(name, index) {
  const key = String(name ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const alias = ALIASES[key];
  if (alias && index.byId.has(alias)) return index.byId.get(alias);
  return index.byNorm.get(normaliseName(name)) ?? null;
}

const exKey = (name) => String(name ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * A catalog record:
 *   { key, name, libId | null, primary: [group], secondary: [group], equipment | null,
 *     custom, favourite, needsMuscle }
 * needsMuscle = no library match and no muscle known yet → ask once ("Which muscle does this train?").
 */
export function normalizeCatalogRecord(raw) {
  const name = String(raw?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!name) return null;
  const { primary, secondary } = normalizeGroups(raw.primary, raw.secondary);
  return {
    key: exKey(name),
    name,
    libId: typeof raw.libId === 'string' && raw.libId ? raw.libId : null,
    primary,
    secondary,
    equipment: typeof raw.equipment === 'string' && raw.equipment ? raw.equipment.slice(0, 40) : null,
    custom: raw.custom === true,
    favourite: raw.favourite === true,
    needsMuscle: raw.needsMuscle === true && !primary.length,
  };
}

/** A record for a library entry, keeping the name you use. */
export function recordFromLibrary(entry, name = entry.name, extra = {}) {
  const g = groupsFromDataset(entry.primaryMuscles, entry.secondaryMuscles);
  return normalizeCatalogRecord({ name, libId: entry.id, ...g, equipment: entry.equipment, ...extra });
}

/** A record for a name: matched to the library when possible, otherwise waiting for its muscle. */
export function recordForName(name, index, extra = {}) {
  const hit = matchLibrary(name, index);
  return hit ? recordFromLibrary(hit, name, extra) : normalizeCatalogRecord({ name, needsMuscle: true, ...extra });
}

/**
 * Schema v4 → v5 catalog. Inputs:
 *   names       every exercise name in sessions and templates
 *   v4Records   the v4 "exercises" store: [{ key, name }] custom names, or v5 records already
 *   v4Muscles   the v4 muscle tags: { key: 'Chest' | … | 'Core' | null } (explicit choices override the library)
 *   v4Defaults  the v4 built-in muscle defaults ({ key: muscle }) used when nothing else is known
 *   index       indexLibrary(library)
 * Returns Map(key → record). Names are kept exactly as logged.
 */
export function buildCatalog({ names = [], v4Records = [], v4Muscles = {}, v4Defaults = {}, index }) {
  const out = new Map();
  const customKeys = new Set();
  for (const r of v4Records) {
    if (Array.isArray(r?.primary)) { const rec = normalizeCatalogRecord(r); if (rec) out.set(rec.key, rec); continue; }
    if (r?.name) customKeys.add(exKey(r.name));
  }
  const all = [...v4Records.filter((r) => !Array.isArray(r?.primary)).map((r) => r?.name), ...names].filter(Boolean);
  for (const name of all) {
    const key = exKey(name);
    if (!key || out.has(key)) continue;
    const hit = matchLibrary(name, index);
    let rec = hit ? recordFromLibrary(hit, name) : normalizeCatalogRecord({ name, custom: customKeys.has(key) });
    const tag = Object.prototype.hasOwnProperty.call(v4Muscles, key) ? v4Muscles[key] : undefined;
    if (tag !== undefined) {
      // An explicit v4 choice wins for the primary muscle; null meant "untagged".
      const g = tag ? V4_MUSCLE_TO_GROUP[tag] : null;
      rec = normalizeCatalogRecord({ ...rec, primary: g ? [g] : [], secondary: rec.secondary, needsMuscle: !g && !hit });
    } else if (!hit) {
      const g = V4_MUSCLE_TO_GROUP[v4Defaults[key]];
      rec = normalizeCatalogRecord({ ...rec, primary: g ? [g] : [], needsMuscle: !g });
    }
    out.set(key, rec);
  }
  return out;
}
