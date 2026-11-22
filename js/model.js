// Data model, defaults, input parsing and migrations. Pure functions — no DOM, no IndexedDB.
import { isValidISODate, toISODate } from './dates.js';
import { GROUPS } from './muscles.js';
import { normalizeCatalogRecord } from './library.js';
import { normalizeProfile, templatesFollowDefaultStep } from './profile.js';
import { BREAK, BUILTIN_IDS, isTypeId, templateTypeIds, normalizeTypes, withKnownTypes } from './types.js';
import { cleanMeasurements, normalizeTracked, DEFAULT_TRACKED } from './measure.js';
import { normalizeNutrition, normalizeIntake } from './nutrition.js';

export const APP_VERSION = '1.11.0'; // keep in sync with VERSION in sw.js (a test checks this)
export const SCHEMA_VERSION = 9;

// Session types are data since v7 (js/types.js): ids are stable, names and colours are editable.
// BREAK is a deliberate rest day: valid in the schedule and as a logged day, but not a type.
export { BREAK };
/** The built-in lifting types that come with a template (the ids of DEFAULT_TEMPLATES). */
export const TEMPLATE_TYPES = ['Push', 'Pull', 'Legs', 'Upper', 'Lower', 'Full body'];
/** A session type id this device knows (built-in or yours, archived ones included). */
export const isTrainingType = (t) => isTypeId(t);

export const DEFAULT_EXERCISES = [
  'Deadlift', 'Squat', 'Leg Press', 'DB Chest Press', 'Incline DB Press', 'Pec Deck',
  'Overhead Press', 'Lateral Raise', 'Triceps Pushdown', 'Lat Pulldown', 'Barbell Row',
  'Seated Row', 'Pull-up', 'Face Pull', 'Biceps Curl', 'Leg Curl', 'Leg Extension',
  'Romanian Deadlift', 'Calf Raise', 'Hanging Leg Raise',
];

// Set types: warm-ups stay visible but never count toward volume, PRs, est. 1RM or hints.
export const SET_TYPES = ['warmup', 'working', 'failure'];
export const SET_TYPE_LABEL = { warmup: 'Warm-up', working: 'Working', failure: 'Failure' };

export const WEIGHT_STEPS = [1, 2.5, 5];
// The pound steps (2.5, 5, 10 lb) as the kg values that are stored; see units.js STEP_CHOICES.
export const WEIGHT_STEPS_ALL = [...WEIGHT_STEPS, ...[2.5, 5, 10].map((n) => Math.round(n * 0.45359237 * 10000) / 10000)];
export const DEFAULT_SETTINGS = {
  defaultCardioMinutes: 20,
  weekStartsOn: 1,
  defaultRestSeconds: 90, // used when an exercise has no restSeconds of its own
  weightStep: 2.5, // −/+ buttons and overload hints, unless the exercise sets its own
  timerSound: true,
  timerVibrate: true,
  autoStartRest: true, // start the rest countdown when a set is ticked (today only)
  timerPreset: 90, // last-used preset on the Timer tab
  keepAwake: false, // Screen Wake Lock while a workout is open
  weeklyMin: null, // sessions per week that count as a good week; null = the planned sessions
  appearance: 'system', // 'system' | 'light' | 'dark' (also kept in localStorage to apply before first paint)
  muscleTarget: 10, // weekly sets per muscle group (body map), unless muscleTargets has its own number
  muscleTargets: {}, // { 'Chest': 12, … } per-group weekly targets
  measureSites: [...DEFAULT_TRACKED], // body measurement sites shown on the Body tab (measure.js GROUPS)
};

// Optional one-tap reasons for a skipped planned day (on-device only, never required).
export const SKIP_REASONS = ['Busy', 'Travel', 'Tired', 'Sick', 'Other'];

/** { 'YYYY-MM-DD': reason } with valid dates and known reasons only. */
export function normalizeSkipReasons(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [date, reason] of Object.entries(raw)) {
    if (isValidISODate(date) && SKIP_REASONS.includes(reason)) out[date] = reason;
  }
  return out;
}

export const TIMER_PRESETS = [45, 60, 90, 120, 180];

// ---------------------------------------------------------------------------
// Primary muscle per exercise (weekly sets per muscle). Stored as overrides keyed by exercise key;
// built-ins have defaults. Editable in the Planner.
// ---------------------------------------------------------------------------
export const MUSCLES = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core'];
export const DEFAULT_MUSCLES = {
  deadlift: 'Back', squat: 'Quads', 'leg press': 'Quads', 'db chest press': 'Chest', 'incline db press': 'Chest',
  'pec deck': 'Chest', 'overhead press': 'Shoulders', 'lateral raise': 'Shoulders', 'triceps pushdown': 'Triceps',
  'lat pulldown': 'Back', 'barbell row': 'Back', 'seated row': 'Back', 'pull-up': 'Back', 'face pull': 'Shoulders',
  'biceps curl': 'Biceps', 'leg curl': 'Hamstrings', 'leg extension': 'Quads', 'romanian deadlift': 'Hamstrings',
  'calf raise': 'Calves', 'hanging leg raise': 'Core',
};

/** { key: muscle } with only known muscles and sane keys. */
export function normalizeMuscles(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    const key = exerciseKey(k);
    if (key && (MUSCLES.includes(v) || v === null)) out[key] = v;
  }
  return out;
}

/** Icon (Tabler name) for an exercise tile, from its muscle; Cardio days get a treadmill. */
const MUSCLE_ICON = {
  Chest: 'barbell', Triceps: 'barbell', Back: 'weight', Biceps: 'weight', Shoulders: 'target',
  Quads: 'run', Hamstrings: 'run', Glutes: 'run', Calves: 'walk', Core: 'stretching',
};
export function exerciseIconName(name, overrides = {}, type = null) {
  const m = muscleFor(name, overrides);
  if (!m && type === 'Cardio') return 'treadmill';
  return MUSCLE_ICON[m] ?? 'barbell';
}

/** Primary muscle for an exercise name: override (null = explicitly untagged) → default → null. */
export function muscleFor(name, overrides = {}) {
  const key = exerciseKey(name);
  return key in overrides ? overrides[key] : DEFAULT_MUSCLES[key] ?? null;
}

// ---------------------------------------------------------------------------
// Weekly schedule
// Stored as versions so edits only apply from the day they're made:
//   [{ from: 'YYYY-MM-DD', days: { mon: 'Push', …, sun: 'Break' } }, …]   (oldest first)
// ---------------------------------------------------------------------------
export const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']; // index = Date#getDay()
export const DEFAULT_WEEK = { mon: 'Push', tue: 'Pull', wed: 'Legs', thu: BREAK, fri: 'Upper', sat: 'Lower', sun: BREAK };
export const defaultSchedule = (from) => [{ from, days: { ...DEFAULT_WEEK } }];

const normalizeDayType = (v) => (v === 'Rest' ? BREAK : isTrainingType(v) || v === BREAK ? v : null);

function daysFrom(raw) {
  if (Array.isArray(raw) && raw.length === 7) {
    return Object.fromEntries(WEEKDAY_KEYS.map((k, i) => [k, normalizeDayType(raw[i])]));
  }
  if (raw && typeof raw === 'object') return Object.fromEntries(WEEKDAY_KEYS.map((k) => [k, normalizeDayType(raw[k])]));
  return null;
}

/**
 * Accepts the current versioned format, or the 1.1 format (a bare 7-item array indexed by getDay,
 * using 'Rest'), which becomes a single version starting at `fallbackFrom`. Returns null if unusable.
 */
export function normalizeSchedule(raw, fallbackFrom) {
  if (!Array.isArray(raw)) return null;
  if (raw.length === 7 && raw.every((v) => v == null || typeof v === 'string')) {
    return isValidISODate(fallbackFrom) ? [{ from: fallbackFrom, days: daysFrom(raw) }] : null;
  }
  const byFrom = new Map();
  for (const v of raw) {
    if (!v || !isValidISODate(v.from)) continue;
    const days = daysFrom(v.days);
    if (days) byFrom.set(v.from, { from: v.from, days });
  }
  const out = [...byFrom.values()].sort((a, b) => (a.from < b.from ? -1 : 1));
  return out.length ? out : null;
}

// ---------------------------------------------------------------------------
// Templates: { Push: [{ name, sets, repsMin, repsMax }], … } for TEMPLATE_TYPES
// ---------------------------------------------------------------------------
export const DEFAULT_TARGET = { sets: 3, repsMin: 8, repsMax: 12 };
// Template item: { name, sets, repsMin, repsMax, weightStep (kg), restSeconds } — null step/rest = the settings default
const ISO = 60; // isolation work
const HEAVY = 180; // big compound lifts
const T = (name, sets, repsMin, repsMax, restSeconds = null) => ({ name, sets, repsMin, repsMax, weightStep: null, restSeconds });

export const DEFAULT_TEMPLATES = {
  Push: [
    T('DB Chest Press', 4, 8, 10), T('Incline DB Press', 3, 8, 12), T('Pec Deck', 3, 12, 15, ISO),
    T('Overhead Press', 3, 6, 10), T('Lateral Raise', 3, 12, 15, ISO), T('Triceps Pushdown', 3, 10, 12, ISO),
  ],
  Pull: [
    T('Pull-up', 3, 6, 10), T('Lat Pulldown', 3, 8, 12), T('Barbell Row', 4, 6, 10),
    T('Seated Row', 3, 10, 12), T('Face Pull', 3, 12, 15, ISO), T('Biceps Curl', 3, 10, 12, ISO),
  ],
  Legs: [
    T('Squat', 4, 5, 8, HEAVY), T('Romanian Deadlift', 3, 8, 10), T('Leg Press', 3, 10, 12),
    T('Leg Curl', 3, 10, 12, ISO), T('Leg Extension', 3, 12, 15, ISO), T('Calf Raise', 4, 10, 15, ISO),
  ],
  Upper: [
    T('DB Chest Press', 3, 6, 10), T('Barbell Row', 3, 6, 10), T('Incline DB Press', 3, 8, 12),
    T('Lat Pulldown', 3, 8, 12), T('Pec Deck', 2, 12, 15, ISO), T('Lateral Raise', 3, 12, 15, ISO),
    T('Biceps Curl', 2, 10, 12, ISO), T('Triceps Pushdown', 2, 10, 12, ISO),
  ],
  Lower: [
    T('Deadlift', 3, 3, 5, HEAVY), T('Leg Press', 3, 8, 12), T('Leg Curl', 3, 10, 12, ISO),
    T('Leg Extension', 3, 12, 15, ISO), T('Calf Raise', 4, 10, 15, ISO), T('Hanging Leg Raise', 3, 10, 15, ISO),
  ],
  'Full body': [
    T('Squat', 3, 5, 8, HEAVY), T('DB Chest Press', 3, 8, 10), T('Lat Pulldown', 3, 8, 12),
    T('Romanian Deadlift', 3, 8, 10), T('Overhead Press', 3, 8, 10),
  ],
};

const intIn = (v, lo, hi) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
};

/** { sets, repsMin, repsMax } — reps may be null (no rep target). null if nothing usable. */
export function normalizeTarget(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const sets = intIn(raw.sets, 1, 20);
  let repsMin = intIn(raw.repsMin, 1, 100);
  let repsMax = intIn(raw.repsMax, 1, 100);
  if (repsMin == null) repsMin = repsMax;
  if (repsMax == null) repsMax = repsMin;
  if (repsMin != null && repsMax < repsMin) [repsMin, repsMax] = [repsMax, repsMin];
  if (sets == null && repsMin == null) return null;
  return { sets: sets ?? DEFAULT_TARGET.sets, repsMin, repsMax };
}

export function formatReps(t) {
  if (!t || t.repsMin == null) return '';
  return t.repsMin === t.repsMax ? String(t.repsMin) : `${t.repsMin}–${t.repsMax}`;
}

/** "4 × 8–10", "3 × 5", "3 sets" */
export function formatTarget(t) {
  if (!t) return '';
  return t.repsMin == null ? `${t.sets} sets` : `${t.sets} × ${formatReps(t)}`;
}

/** Weight step in kg (0.25–50) or null. */
export function normalizeStep(v) {
  const n = parseWeight(v);
  return n != null && n >= 0.25 && n <= 50 ? n : null;
}

/** Rest in seconds (10–900) or null (= use the default). */
export function normalizeRest(v) {
  const n = intIn(v, 10, 900);
  return n;
}

/** Valid templates for every TEMPLATE_TYPE; missing types fall back to the defaults. */
export function normalizeTemplates(raw) {
  const out = {};
  // Every lifting type gets a list (built-ins fall back to their defaults); any other known type keeps its own.
  const ids = new Set([...TEMPLATE_TYPES, ...templateTypeIds(), ...Object.keys(raw ?? {}).filter(isTypeId)]);
  for (const type of ids) {
    const list = Array.isArray(raw?.[type]) ? raw[type] : DEFAULT_TEMPLATES[type] ?? [];
    const seen = new Set();
    out[type] = list.map((item) => {
      const name = cleanName(typeof item === 'string' ? item : item?.name);
      if (!name || seen.has(name.toLowerCase())) return null;
      seen.add(name.toLowerCase());
      const target = typeof item === 'string' ? null : normalizeTarget(item);
      return {
        name,
        ...(target ?? DEFAULT_TARGET),
        weightStep: normalizeStep(item?.weightStep),
        restSeconds: normalizeRest(item?.restSeconds),
      };
    }).filter(Boolean).slice(0, 40);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function cleanName(name) {
  return String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** Case/whitespace-insensitive identity for an exercise name. */
export function exerciseKey(name) {
  return cleanName(name).toLowerCase();
}

const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10000) / 10000;

/**
 * Weight in kg. Typed text "22.5", "22,5", "22." → number (2 dp) or null. 0 = bodyweight.
 * Stored numbers keep 4 dp, so a weight typed in pounds (converted to kg) reads back exactly.
 */
export function parseWeight(input) {
  if (input == null) return null;
  if (typeof input === 'number') return Number.isFinite(input) && input >= 0 && input < 10000 ? round4(input) : null;
  const s = String(input).trim().replace(',', '.');
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n < 10000 ? round2(n) : null;
}

/** Whole reps 0–999 or null. */
export function parseReps(input) {
  if (input == null) return null;
  if (typeof input === 'number') return Number.isInteger(input) && input >= 0 && input < 1000 ? input : null;
  const s = String(input).trim();
  if (!/^\d{1,3}$/.test(s)) return null;
  return Number(s);
}

/** Minutes 0–1440, decimals allowed, or null. */
export function parseMinutes(input) {
  const n = parseWeight(input);
  return n == null || n > 1440 ? null : n;
}

export function newSession(date, settings = DEFAULT_SETTINGS, type = null) {
  const now = Date.now();
  return {
    v: SCHEMA_VERSION,
    date,
    type,
    exercises: [],
    cardioMinutes: type === BREAK ? null : settings.defaultCardioMinutes || null,
    notes: '',
    startedAt: null, // first set ticked (ms)
    finishedAt: null, // "Finish workout" confirmed (ms)
    createdAt: now,
    updatedAt: now,
  };
}

export const newSet = (weight = null, reps = null, type = 'working') => ({ weight, reps, done: false, type });

/**
 * Exercise: { id, name, target: { sets, repsMin, repsMax } | null (the rep range), weightStep, restSeconds,
 *             hintDismissed, sets: [{ weight, reps, done, type }] }
 * Copied/pre-filled sets start not done: they only count once you tick them.
 */
export function newExercise(name, sets, opts = {}) {
  const copied = (sets ?? []).map((s) => newSet(s.weight ?? null, s.reps ?? null, SET_TYPES.includes(s.type) ? s.type : 'working'));
  return {
    id: uid(),
    name: cleanName(name),
    target: opts.target ? { sets: opts.target.sets, repsMin: opts.target.repsMin, repsMax: opts.target.repsMax } : null,
    weightStep: normalizeStep(opts.weightStep),
    restSeconds: normalizeRest(opts.restSeconds),
    hintDismissed: false,
    note: cleanNote(opts.note),
    sets: copied.length ? copied : [newSet()],
  };
}

/**
 * "Empty" = the user opened a day but entered nothing meaningful.
 * Such sessions are discarded when leaving the day screen.
 */
export function isSessionEmpty(s, settings = DEFAULT_SETTINGS) {
  const cardioUntouched = !s.cardioMinutes || s.cardioMinutes === settings.defaultCardioMinutes;
  return !s.type && s.exercises.length === 0 && !s.notes.trim() && cardioUntouched;
}

function normalizeExercise(raw) {
  const name = cleanName(raw?.name);
  if (!name) return null;
  const sets = Array.isArray(raw.sets)
    ? raw.sets.map((s) => ({
      weight: parseWeight(s?.weight),
      reps: parseReps(s?.reps),
      done: s?.done !== false,
      type: SET_TYPES.includes(s?.type) ? s.type : 'working',
    }))
    : [];
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
    name,
    target: normalizeTarget(raw.target),
    weightStep: normalizeStep(raw.weightStep),
    restSeconds: normalizeRest(raw.restSeconds),
    hintDismissed: raw.hintDismissed === true,
    note: cleanNote(raw.note),
    sets,
  };
}

/** Per-exercise note (seat position, machine setting…): one short line or two. */
export function cleanNote(v) {
  return typeof v === 'string' ? v.slice(0, 500) : '';
}

/** Coerce any session-shaped object into a valid current-version session, or null. */
export function normalizeSession(raw) {
  if (!raw || typeof raw !== 'object' || !isValidISODate(raw.date)) return null;
  let type = null;
  if (isTrainingType(raw.type) || raw.type === BREAK) type = raw.type;
  else if (raw.type === 'Rest') type = BREAK;
  else if (typeof raw.type === 'string' && raw.type.trim()) type = 'Other';
  const ts = (n) => (Number.isFinite(n) && n > 0 ? n : Date.now());
  return {
    v: SCHEMA_VERSION,
    date: raw.date,
    type,
    exercises: Array.isArray(raw.exercises) ? raw.exercises.map(normalizeExercise).filter(Boolean) : [],
    cardioMinutes: parseMinutes(raw.cardioMinutes),
    notes: typeof raw.notes === 'string' ? raw.notes.slice(0, 10000) : '',
    startedAt: Number.isFinite(raw.startedAt) && raw.startedAt > 0 ? raw.startedAt : null,
    finishedAt: Number.isFinite(raw.finishedAt) && raw.finishedAt > 0 ? raw.finishedAt : null,
    createdAt: ts(raw.createdAt),
    updatedAt: ts(raw.updatedAt),
  };
}

/** One session per day: fold b into a (used when an import has two sessions on one date). */
export function mergeSessions(a, b) {
  const exercises = [...a.exercises];
  for (const ex of b.exercises) {
    const existing = exercises.find((e) => exerciseKey(e.name) === exerciseKey(ex.name));
    if (existing) existing.sets = [...existing.sets, ...ex.sets];
    else exercises.push(ex);
  }
  const typeA = a.type === BREAK ? null : a.type;
  return {
    ...a,
    type: typeA ?? b.type ?? a.type,
    exercises,
    cardioMinutes: (a.cardioMinutes ?? 0) + (b.cardioMinutes ?? 0) || null,
    notes: [a.notes, b.notes].filter((n) => n.trim()).join('\n\n'),
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
  };
}

// ---------------------------------------------------------------------------
// Migrations
//
// Stored records: SESSION_MIGRATIONS[n] upgrades a session record from v=n to v=n+1.
// Backups:        BACKUP_MIGRATIONS[n] upgrades an export payload from schemaVersion n to n+1.
// To change the schema: bump SCHEMA_VERSION, add a step to both tables, and (if the
// IndexedDB layout changes) add an `oldVersion < N` block in db.js.
// ---------------------------------------------------------------------------

export const SESSION_MIGRATIONS = {
  // v1 → v2: sets gain `done` (everything logged before v2 was real work), exercises gain `target`.
  1: (s) => ({
    ...s,
    v: 2,
    exercises: (s.exercises ?? []).map((e) => ({
      ...e,
      target: e.target ?? null,
      sets: (e.sets ?? []).map((set) => ({ ...set, done: true })),
    })),
  }),
  // v2 → v3: sets gain `type` (all existing sets were working sets); exercises gain rest/step.
  2: (s) => ({
    ...s,
    v: 3,
    exercises: (s.exercises ?? []).map((e) => ({
      ...e,
      weightStep: e.weightStep ?? null,
      restSeconds: e.restSeconds ?? null,
      hintDismissed: false,
      sets: (e.sets ?? []).map((set) => ({ ...set, type: set.type ?? 'working' })),
    })),
  }),
  // v3 → v4: exercises gain a `note`; sessions gain startedAt/finishedAt (unknown for old days).
  3: (s) => ({
    ...s,
    v: 4,
    startedAt: s.startedAt ?? null,
    finishedAt: s.finishedAt ?? null,
    exercises: (s.exercises ?? []).map((e) => ({ ...e, note: e.note ?? '' })),
  }),
  // v4 → v5: sessions are unchanged (names are never rewritten); the exercise catalog is new, see library.js.
  4: (s) => ({ ...s, v: 5 }),
  // v5 → v6: sessions are unchanged; the profile is new (see profile.js). Logged numbers are never rewritten.
  5: (s) => ({ ...s, v: 6 }),
  // v6 → v7: session types become data (types.js). Built-in ids are the old names, so sessions are unchanged.
  6: (s) => ({ ...s, v: 7 }),
  // v7 → v8: sessions unchanged; Body log entries gain optional measurement fields (measure.js).
  7: (s) => ({ ...s, v: 8 }),
  // v8 → v9: sessions unchanged; optional nutrition targets and an intake log are new (nutrition.js).
  8: (s) => ({ ...s, v: 9 }),
};

// ---------------------------------------------------------------------------
// Body log: one entry per date { date, weight (kg) | null, waist (cm) | null, …other sites (cm), bodyFat (%),
// updatedAt }. Since v8 any subset is fine (see measure.js); an entry with no valid value at all is dropped.
// ---------------------------------------------------------------------------
export function normalizeBodyEntry(raw) {
  if (!raw || !isValidISODate(raw.date)) return null;
  const w = parseWeight(raw.weight);
  const weight = w != null && w >= 20 && w <= 400 ? w : null;
  const { waist = null, ...rest } = cleanMeasurements(raw);
  if (weight == null && waist == null && !Object.keys(rest).length) return null;
  return {
    date: raw.date,
    weight,
    waist,
    ...rest,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
  };
}

export const BACKUP_MIGRATIONS = {
  // v0 = unversioned: a bare array of sessions, or { sessions } without schemaVersion.
  0: (data) => ({
    schemaVersion: 1,
    sessions: Array.isArray(data) ? data : data?.sessions ?? [],
    customExercises: Array.isArray(data) ? [] : data?.customExercises ?? [],
    settings: Array.isArray(data) ? {} : data?.settings ?? {},
  }),
  // v1 → v2: sessions as above; schedule/templates move out of settings (app 1.1) to top level.
  1: (data) => ({
    ...data,
    schemaVersion: 2,
    // Leave a missing/non-array `sessions` alone so the file is still rejected below.
    sessions: Array.isArray(data.sessions)
      ? data.sessions.map((s) => (s && typeof s === 'object' ? SESSION_MIGRATIONS[1](s) : s))
      : data.sessions,
    schedule: data.schedule ?? data.settings?.schedule ?? null,
    templates: data.templates ?? data.settings?.templates ?? null,
  }),
  // v2 → v3: set types, exercise rest/step, and the body log.
  2: (data) => ({
    ...data,
    schemaVersion: 3,
    sessions: Array.isArray(data.sessions)
      ? data.sessions.map((s) => (s && typeof s === 'object' ? SESSION_MIGRATIONS[2](s) : s))
      : data.sessions,
    body: data.body ?? [],
  }),
  // v3 → v4: exercise notes, session start/finish, muscle tags, skip reasons (the weekly minimum is a setting).
  3: (data) => ({
    ...data,
    schemaVersion: 4,
    sessions: Array.isArray(data.sessions)
      ? data.sessions.map((s) => (s && typeof s === 'object' ? SESSION_MIGRATIONS[3](s) : s))
      : data.sessions,
    muscles: data.muscles ?? {},
    skipReasons: data.skipReasons ?? {},
  }),
  // v4 → v5: custom names and muscle tags become one exercise catalog. The conversion needs the library,
  // so the v4 fields are kept here and the store builds the catalog on import (library.js buildCatalog).
  4: (data) => ({
    ...data,
    schemaVersion: 5,
    sessions: Array.isArray(data.sessions)
      ? data.sessions.map((s) => (s && typeof s === 'object' ? SESSION_MIGRATIONS[4](s) : s))
      : data.sessions,
    exercises: Array.isArray(data.exercises) ? data.exercises : null,
  }),
  // v5 → v6: the profile (null in older files), and template steps that only repeated the default follow it.
  5: (data) => ({
    ...data,
    schemaVersion: 6,
    sessions: Array.isArray(data.sessions)
      ? data.sessions.map((s) => (s && typeof s === 'object' ? SESSION_MIGRATIONS[5](s) : s))
      : data.sessions,
    templates: templatesFollowDefaultStep(data.templates, WEIGHT_STEPS_ALL.includes(Number(data.settings?.weightStep)) ? Number(data.settings.weightStep) : 2.5),
    profile: data.profile ?? null,
  }),
  // v6 → v7: no type list in older files (the built-ins are used); the ids in sessions, plan and templates stay.
  6: (data) => ({
    ...data,
    schemaVersion: 7,
    sessions: Array.isArray(data.sessions)
      ? data.sessions.map((s) => (s && typeof s === 'object' ? SESSION_MIGRATIONS[6](s) : s))
      : data.sessions,
    sessionTypes: Array.isArray(data.sessionTypes) ? data.sessionTypes : null,
  }),
  // v7 → v8: Body log entries keep weight and waist as they are; the other sites are new and optional.
  7: (data) => ({
    ...data,
    schemaVersion: 8,
    sessions: Array.isArray(data.sessions)
      ? data.sessions.map((s) => (s && typeof s === 'object' ? SESSION_MIGRATIONS[7](s) : s))
      : data.sessions,
    body: Array.isArray(data.body) ? data.body : [],
  }),
  // v8 → v9: nutrition targets (off) and an empty intake log; nothing else changes.
  8: (data) => ({
    ...data,
    schemaVersion: 9,
    sessions: Array.isArray(data.sessions)
      ? data.sessions.map((s) => (s && typeof s === 'object' ? SESSION_MIGRATIONS[8](s) : s))
      : data.sessions,
    nutrition: data.nutrition ?? null,
    intake: data.intake ?? {},
  }),
};

/** Upgrade a stored session record. Returns { session, changed }. */
export function upgradeSessionRecord(rec) {
  if (rec?.v === SCHEMA_VERSION) return { session: rec, changed: false };
  let s = rec;
  let v = Number.isInteger(rec?.v) ? rec.v : 1;
  while (v < SCHEMA_VERSION && SESSION_MIGRATIONS[v]) {
    s = SESSION_MIGRATIONS[v](s);
    v += 1;
  }
  return { session: normalizeSession(s), changed: true };
}

export function pickSettings(raw) {
  const out = {};
  const cardio = parseMinutes(raw?.defaultCardioMinutes);
  if (cardio != null) out.defaultCardioMinutes = cardio;
  if (raw?.weekStartsOn === 0 || raw?.weekStartsOn === 1) out.weekStartsOn = raw.weekStartsOn;
  const rest = normalizeRest(raw?.defaultRestSeconds);
  if (rest != null) out.defaultRestSeconds = rest;
  if (WEIGHT_STEPS_ALL.includes(Number(raw?.weightStep))) out.weightStep = Number(raw.weightStep);
  for (const k of ['timerSound', 'timerVibrate', 'autoStartRest', 'keepAwake']) {
    if (typeof raw?.[k] === 'boolean') out[k] = raw[k];
  }
  const preset = intIn(raw?.timerPreset, 5, 900);
  if (preset != null) out.timerPreset = preset;
  if (['system', 'light', 'dark'].includes(raw?.appearance)) out.appearance = raw.appearance;
  const target = intIn(raw?.muscleTarget, 1, 40);
  if (target != null) out.muscleTarget = target;
  if (raw?.muscleTargets && typeof raw.muscleTargets === 'object' && !Array.isArray(raw.muscleTargets)) {
    out.muscleTargets = Object.fromEntries(Object.entries(raw.muscleTargets)
      .filter(([g, n]) => GROUPS.includes(g) && intIn(n, 1, 40) != null).map(([g, n]) => [g, Number(n)]));
  }
  if (Array.isArray(raw?.measureSites)) out.measureSites = normalizeTracked(raw.measureSites);
  if (raw?.weeklyMin === null) out.weeklyMin = null;
  else if (intIn(raw?.weeklyMin, 1, 14) != null) out.weeklyMin = intIn(raw.weeklyMin, 1, 14);
  return out;
}

/**
 * Parse any supported backup payload into current-version data.
 * `today` dates a legacy (unversioned) schedule. Throws on unusable input. Never touches storage.
 */
export function migrateBackup(input, today = toISODate(new Date())) {
  if (input == null || typeof input !== 'object') throw new Error('This file is not a workout backup.');
  let data = input;
  let version = !Array.isArray(data) && Number.isInteger(data.schemaVersion) ? data.schemaVersion : 0;
  if (version > SCHEMA_VERSION) {
    throw new Error(`This backup is from a newer version of the app (schema ${version}). Update the app first.`);
  }
  while (version < SCHEMA_VERSION) {
    const step = BACKUP_MIGRATIONS[version];
    if (!step) throw new Error(`No migration from schema ${version}.`);
    data = step(data);
    version = data.schemaVersion;
  }
  if (!Array.isArray(data.sessions)) throw new Error('This file is not a workout backup.');
  // A v7 file's own types (custom ids) count as known while its sessions, plan and templates are read.
  const sessionTypes = normalizeTypes(data.sessionTypes);
  return withKnownTypes([...BUILTIN_IDS, ...(sessionTypes ?? []).map((t) => t.id)], () => readBackup(data, today, sessionTypes));
}

function readBackup(data, today, sessionTypes) {

  const byDate = new Map();
  let skipped = 0;
  for (const raw of data.sessions) {
    const s = normalizeSession(raw);
    if (!s) { skipped++; continue; }
    byDate.set(s.date, byDate.has(s.date) ? mergeSessions(byDate.get(s.date), s) : s);
  }
  const customExercises = (Array.isArray(data.customExercises) ? data.customExercises : [])
    .map((c) => cleanName(typeof c === 'string' ? c : c?.name))
    .filter(Boolean);
  const exportedDay = Date.parse(data.exportedAt) ? toISODate(new Date(data.exportedAt)) : today;

  return {
    sessions: [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
    customExercises,
    settings: pickSettings(data.settings),
    schedule: normalizeSchedule(data.schedule, exportedDay),
    templates: data.templates ? normalizeTemplates(data.templates) : null,
    body: (Array.isArray(data.body) ? data.body : []).map(normalizeBodyEntry).filter(Boolean),
    muscles: normalizeMuscles(data.muscles),
    exercises: Array.isArray(data.exercises) ? data.exercises.map(normalizeCatalogRecord).filter(Boolean) : null,
    skipReasons: normalizeSkipReasons(data.skipReasons),
    profile: data.profile ? normalizeProfile(data.profile) : null,
    sessionTypes,
    nutrition: normalizeNutrition(data.nutrition),
    intake: normalizeIntake(data.intake),
    skipped,
  };
}
