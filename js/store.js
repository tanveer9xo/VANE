// In-memory state mirrored to IndexedDB. All data is loaded at startup (a personal log is small).
import * as db from './db.js';
import {
  APP_VERSION, SCHEMA_VERSION, DEFAULT_SETTINGS, DEFAULT_EXERCISES, DEFAULT_TEMPLATES,
  newSession, upgradeSessionRecord, exerciseKey, cleanName, isSessionEmpty, migrateBackup,
  normalizeSchedule, normalizeTemplates, defaultSchedule, pickSettings, normalizeBodyEntry, normalizeMuscles, DEFAULT_MUSCLES,
  normalizeSkipReasons, SKIP_REASONS,
} from './model.js';
import {
  loadLibrary, indexLibrary, buildCatalog, recordForName, recordFromLibrary, normalizeCatalogRecord, setTakenNames, exName,
} from './library.js';
import { isGroup } from './muscles.js';
import { withWeekFrom } from './plan.js';
import { analyze } from './consistency.js';
import { todayISO } from './dates.js';
import {
  DEFAULT_PROFILE, normalizeProfile, settingsForAnswers, templatesFollowDefaultStep, profileForExisting,
} from './profile.js';
import { setUnits, units } from './units.js';
import { DEFAULT_NUTRITION, normalizeNutrition, normalizeIntake } from './nutrition.js';
import {
  snapshotSplit, applySavedSplit, addSplit, renameSplit, duplicateSplit, updateSplit, deleteSplit, normalizeSplits,
} from './splits.js';
import {
  setTypes, defaultTypes, normalizeTypes, addType, updateType, deleteType, applyPreset, PRESETS, PRESET_TEMPLATES,
} from './types.js';

export const state = {
  sessions: new Map(), // date → session
  catalog: new Map(), // exercise key → { key, name, libId, primary, secondary, equipment, custom, favourite, needsMuscle }
  library: [], // the bundled exercise library (data/exercises.json)
  libIndex: indexLibrary([]),
  settings: { ...DEFAULT_SETTINGS },
  schedule: [], // [{ from, days: { mon…sun } }] — see model.js
  templates: {}, // { Push: [{ name, sets, repsMin, repsMax, weightStep, restSeconds }], … }
  body: new Map(), // date → { date, weight, waist, updatedAt }
  skipReasons: {}, // date → 'Busy' | 'Travel' | … for skipped planned days (optional)
  profile: { ...DEFAULT_PROFILE }, // first-run answers (schema v6) — see profile.js
  types: defaultTypes(), // session types (schema v7) — see types.js
  nutrition: { ...DEFAULT_NUTRITION }, // optional targets, off by default (schema v9) — see nutrition.js
  intake: {}, // { date: { kcal, protein } } manual daily totals
  splits: [], // saved splits (schema v10) — see splits.js
  lastExportAt: null,
};

// ---- save status (for the "Saving… / Saved" indicator) ----
const saveListeners = new Set();
export function onSaveState(fn) {
  saveListeners.add(fn);
  return () => saveListeners.delete(fn);
}
const emit = (s) => saveListeners.forEach((fn) => fn(s));

export async function init() {
  await db.open();
  const [records, custom, settings, lastExportAt, schedule, storedTemplates, muscles, skipReasons, storedProfile, storedTypes] = await Promise.all([
    db.getAll('sessions'), db.getAll('exercises'), db.getMeta('settings'), db.getMeta('lastExportAt'),
    db.getMeta('schedule'), db.getMeta('templates'), db.getMeta('muscles'), db.getMeta('skipReasons'), db.getMeta('profile'),
    db.getMeta('sessionTypes'),
  ]);
  // Schema v8 → v9: nothing stored yet means nutrition off and an empty intake log.
  const [storedNutrition, storedIntake, storedSplits] = await Promise.all([db.getMeta('nutrition'), db.getMeta('intake'), db.getMeta('splits')]);
  state.splits = normalizeSplits(storedSplits); // v9 → v10: none saved yet
  state.nutrition = normalizeNutrition(storedNutrition);
  state.intake = normalizeIntake(storedIntake);
  // Schema v6 → v7: session types become data. Without a stored list, the built-ins (whose ids are the old
  // names) are the list, so every session, plan day and template keeps pointing at the same type.
  state.types = normalizeTypes(storedTypes) ?? defaultTypes();
  setTypes(state.types);
  if (!storedTypes) await db.setMeta('sessionTypes', state.types);
  state.skipReasons = normalizeSkipReasons(skipReasons);
  (await db.getAll('body')).forEach((e) => state.body.set(e.date, e));
  const rewrites = [];
  for (const rec of records) {
    const { session, changed } = upgradeSessionRecord(rec);
    if (!session) continue;
    state.sessions.set(session.date, session);
    if (changed) rewrites.push(session);
  }
  if (rewrites.length) await db.putMany('sessions', rewrites);
  state.settings = { ...DEFAULT_SETTINGS, ...pickSettings(settings) };
  state.lastExportAt = lastExportAt ?? null;

  // Schema v5 → v6: no profile yet. With logged workouts there's no first-run flow, just a one-time card;
  // template steps that only repeated the default now follow it (same numbers; see profile.js).
  const upgradingToV6 = !storedProfile;
  const templates = upgradingToV6 ? templatesFollowDefaultStep(storedTemplates, state.settings.weightStep) : storedTemplates;
  state.profile = upgradingToV6
    ? profileForExisting([...state.sessions.values()].some((s) => !isEmpty(s)))
    : normalizeProfile(storedProfile);
  setUnits(state.profile.units);
  if (upgradingToV6) await db.setMeta('profile', state.profile);

  // Schedule & templates live under their own keys. App 1.1 kept them inside settings; a fresh
  // install gets the defaults, effective from today (so earlier days are never shown as missed).
  const today = todayISO();
  state.schedule = normalizeSchedule(schedule, today) ?? normalizeSchedule(settings?.schedule, today) ?? defaultSchedule(today);
  state.templates = normalizeTemplates(templates ?? settings?.templates);
  if (!schedule || !storedTemplates || upgradingToV6 || settings?.schedule || settings?.templates) {
    await db.run('meta', 'readwrite', (tx) => {
      const meta = tx.objectStore('meta');
      meta.put({ key: 'schedule', value: state.schedule });
      meta.put({ key: 'templates', value: state.templates });
      meta.put({ key: 'settings', value: state.settings });
    });
  }

  // Exercise catalog (schema v5). Built from the v4 custom names and muscle tags the first time, then kept
  // up to date with every name in your history and templates. Names are never changed.
  try {
    state.library = await loadLibrary();
  } catch (err) {
    console.warn(err); // offline before the library was ever cached: keep going without it
    state.library = [];
  }
  state.libIndex = indexLibrary(state.library);
  const names = [
    ...allSessions().flatMap((s) => s.exercises.map((e) => e.name)),
    ...Object.values(state.templates).flat().map((t) => t.name),
  ];
  state.catalog = buildCatalog({
    names, v4Records: custom, v4Muscles: normalizeMuscles(muscles), v4Defaults: DEFAULT_MUSCLES, index: state.libIndex,
  });
  refreshNames();
  // Without the library, unmatched names would wrongly wait for a muscle: only save once it has loaded.
  if (state.library.length) {
    const stored = new Map(custom.map((r) => [r.key, JSON.stringify(r)]));
    const changed = [...state.catalog.values()].filter((r) => stored.get(r.key) !== JSON.stringify(r));
    if (changed.length) await db.putMany('exercises', changed);
  }
}

export const allSessions = () => [...state.sessions.values()];
export const getSession = (date) => state.sessions.get(date) ?? null;
export const isEmpty = (s) => isSessionEmpty(s, state.settings);
/** A real session: ignores days that were opened but left untouched. */
export const realSession = (date) => {
  const s = state.sessions.get(date);
  return s && !isEmpty(s) ? s : null;
};

/** Consistency analysis of the whole history (see consistency.js for the definitions). */
export function consistencyAnalysis(today = todayISO()) {
  let firstDate = null;
  for (const s of state.sessions.values()) if (!isEmpty(s) && (!firstDate || s.date < firstDate)) firstDate = s.date;
  return analyze({
    getSession: realSession, schedule: state.schedule, firstDate, today, weekStartsOn: state.settings.weekStartsOn,
  });
}

export async function createSession(date, type = null) {
  return addSession(newSession(date, state.settings, type));
}

/** Persist a session built elsewhere (e.g. a planned day the user just started editing). */
export async function addSession(session) {
  state.sessions.set(session.date, session);
  await saveNow(session);
  return session;
}

// ---- autosave: debounced per session, flushed on navigation / backgrounding ----
const pending = new Map(); // date → { timer, session }

export function scheduleSave(session, delay = 250) {
  const p = pending.get(session.date);
  if (p) clearTimeout(p.timer);
  emit('saving');
  pending.set(session.date, { session, timer: setTimeout(() => saveNow(session), delay) });
}

export async function saveNow(session) {
  const p = pending.get(session.date);
  if (p) { clearTimeout(p.timer); pending.delete(session.date); }
  if (state.sessions.get(session.date) !== session) return; // deleted meanwhile
  session.updatedAt = Date.now();
  emit('saving');
  try {
    await db.put('sessions', session);
    emit('saved');
  } catch (err) {
    console.error(err);
    emit('error');
  }
}

export function flushAll() {
  return Promise.all([...pending.values()].map((p) => saveNow(p.session)));
}

export async function deleteSession(date) {
  const p = pending.get(date);
  if (p) { clearTimeout(p.timer); pending.delete(date); }
  state.sessions.delete(date);
  await db.del('sessions', date);
}

// ---- exercises: the catalog ----
const keyOf = (name) => exerciseKey(name);
export const catalogRecord = (name) => state.catalog.get(keyOf(name)) ?? null;
/** { primary: [group], secondary: [group] } for a name you log: its record, else a live library match, else empty. */
export function groupsOf(name) {
  const r = state.catalog.get(keyOf(name)) ?? recordForName(cleanName(name), state.libIndex);
  return r ? { primary: r.primary, secondary: r.secondary } : { primary: [], secondary: [] };
}

/** Give every name in your sessions and templates a catalog record (after imports and template edits). */
/** Names you use that aren't library names block a clashing short display name (library.js exName). */
const refreshNames = () => setTakenNames([...state.catalog.values()].map((r) => r.name));
/** The name to show for an exercise: a library name's short form, otherwise the name as logged. */
export const exLabel = (name) => exName(name);

export async function syncCatalog() {
  if (!state.library.length) return;
  const names = [
    ...allSessions().flatMap((s) => s.exercises.map((e) => e.name)),
    ...Object.values(state.templates).flat().map((t) => t.name),
  ];
  const added = [];
  for (const n of names) {
    if (state.catalog.has(keyOf(n))) continue;
    const r = recordForName(cleanName(n), state.libIndex);
    if (r) { state.catalog.set(r.key, r); added.push(r); }
  }
  refreshNames();
  if (added.length) await db.putMany('exercises', added);
}
export const primaryGroup = (name) => groupsOf(name).primary[0] ?? null;

async function putRecord(rec) {
  const r = normalizeCatalogRecord(rec);
  if (!r) return null;
  state.catalog.set(r.key, r);
  refreshNames();
  await db.put('exercises', r);
  return r;
}

/** Make sure a name has a catalog record (library match, or waiting for its muscle). */
export async function ensureExercise(name, extra = {}) {
  const have = catalogRecord(name);
  if (have) return have;
  return putRecord(recordForName(cleanName(name), state.libIndex, extra));
}

/** A library entry, added under its own name. */
export async function addLibraryExercise(entry) {
  return catalogRecord(entry.name) ?? putRecord(recordFromLibrary(entry));
}

/** "Create custom exercise": name, primary muscle, optional secondary, equipment. */
export async function createCustomExercise({ name, primary, secondary = null, equipment = null }) {
  const clean = cleanName(name);
  if (!clean) throw new Error('Give the exercise a name.');
  if (!isGroup(primary)) throw new Error('Pick the main muscle it trains.');
  const existing = catalogRecord(clean);
  return putRecord({
    ...(existing ?? {}), name: existing?.name ?? clean, custom: existing ? existing.custom : true,
    libId: existing?.libId ?? null, primary: [primary], secondary: secondary ? [secondary] : [], equipment, needsMuscle: false,
  });
}

export async function toggleFavourite(name) {
  const r = await ensureExercise(name);
  return putRecord({ ...r, favourite: !r.favourite });
}

/** Set (or clear with null) the main muscle of an exercise; answers the one-time muscle question. */
export async function setPrimaryMuscle(name, group) {
  const r = await ensureExercise(name);
  const primary = isGroup(group) ? [group] : [];
  return putRecord({ ...r, primary, secondary: r.secondary.filter((g) => g !== group), needsMuscle: false });
}

/** Exercises you've used that still need their muscle (the one-time question). */
export function exercisesNeedingMuscle() {
  const used = new Set([
    ...allSessions().flatMap((s) => s.exercises.map((e) => keyOf(e.name))),
    ...Object.values(state.templates).flat().map((t) => keyOf(t.name)),
  ]);
  return [...state.catalog.values()].filter((r) => r.needsMuscle && used.has(r.key));
}

/** Every exercise name you've used or added: catalog, history, built-ins. [{ key, name }] */
export function allExerciseNames() {
  const map = new Map();
  const add = (name) => { const k = keyOf(name); if (k && !map.has(k)) map.set(k, cleanName(name)); };
  DEFAULT_EXERCISES.forEach(add);
  state.catalog.forEach((r) => add(r.name));
  state.sessions.forEach((s) => s.exercises.forEach((e) => add(e.name)));
  return [...map].map(([key, name]) => ({ key, name }));
}

/** Kept for the planner and day screen: a typed name becomes a catalog record. */
export const addCustomExercise = (name) => ensureExercise(name, { custom: true });

// ---- settings ----
export async function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  await db.setMeta('settings', state.settings);
}

// ---- profile ----
/**
 * Save profile answers. Returns the settings they changed. Answers apply from now on: the units only change
 * what's shown (data stays in kg/cm), and a split rewrites the weekly plan from today, never past days.
 */
export async function saveProfile(patch, { applySplit = true } = {}) {
  const prev = state.profile;
  const next = normalizeProfile({ ...prev, ...patch, updatedAt: Date.now() });
  const settingsPatch = settingsForAnswers(prev, next, state.settings);
  state.profile = next;
  setUnits(next.units);
  await db.setMeta('profile', next);
  if (Object.keys(settingsPatch).length) await saveSettings(settingsPatch);
  if (applySplit && PRESETS[next.split] && (next.split !== prev.split || next.sessionsPerWeek !== prev.sessionsPerWeek)) {
    await usePreset(next.split, next.sessionsPerWeek); // Custom isn't a preset: your plan stays
  }
  return settingsPatch;
}

// ---- session types ----
async function saveTypes(list) {
  state.types = list;
  setTypes(list);
  await db.setMeta('sessionTypes', list);
}

/** A type has history if a logged day or a past plan day uses it (then it's archived, never removed). */
export function typeHasHistory(id, today = todayISO()) {
  for (const s of state.sessions.values()) if (s.type === id) return true;
  return state.schedule.some((v, i) => {
    const until = state.schedule[i + 1]?.from ?? '9999-12-31';
    return v.from < today && until > v.from && Object.values(v.days).includes(id);
  });
}

/** Add a session type (next free colour) with an optional template. → the new type */
export async function addSessionType(fields, template = []) {
  const { types, type } = addType(state.types, fields);
  await saveTypes(types);
  await saveTemplates({ ...state.templates, [type.id]: template });
  return type;
}

/** Rename, recolour, change the short label, hide or show. History refers to the id and never changes. */
export async function editSessionType(id, patch) {
  await saveTypes(updateType(state.types, id, patch));
  if (patch.hidden) await dropFromPlan(id);
}

/** Delete, or archive when it has history. It leaves the plan from today either way. → { archived } */
export async function removeSessionType(id) {
  const { types, archived } = deleteType(state.types, id, typeHasHistory(id));
  await saveTypes(types);
  await dropFromPlan(id);
  if (!archived) {
    const { [id]: _gone, ...rest } = state.templates;
    await saveTemplates(rest);
  }
  return { archived };
}

async function dropFromPlan(id) {
  const week = state.schedule.at(-1)?.days ?? {};
  if (Object.values(week).includes(id)) {
    await saveWeek(Object.fromEntries(Object.entries(week).map(([k, v]) => [k, v === id ? null : v])));
  }
}

/** Apply a split preset: its types and templates (created or reused, all editable) and the week from today. */
export async function usePreset(presetId, sessions) {
  const r = applyPreset(state.types, state.templates, presetId, sessions);
  await saveTypes(r.types);
  await saveTemplates(r.templates);
  await saveWeek(r.week);
  return r;
}

// ---- saved splits ("Save as my split") ----
async function saveSplits(list) {
  state.splits = list;
  await db.setMeta('splits', list);
}
const currentSnapshot = (name, id) => snapshotSplit({
  name, id, week: state.schedule.at(-1)?.days ?? {}, types: state.types, templates: state.templates,
});
/** Save the current week, its types and templates under a name. Throws on no name, a clash or the 10 limit. */
export async function saveMySplit(name) {
  const split = currentSnapshot(name);
  await saveSplits(addSplit(state.splits, split));
  return split;
}
export const renameMySplit = (id, name) => saveSplits(renameSplit(state.splits, id, name));
export const duplicateMySplit = (id) => saveSplits(duplicateSplit(state.splits, id));
export const deleteMySplit = (id) => saveSplits(deleteSplit(state.splits, id));
/** "Save the current week into this split". */
export async function updateMySplit(id) {
  const s = state.splits.find((x) => x.id === id);
  await saveSplits(updateSplit(state.splits, id, currentSnapshot(s?.name ?? 'Split')));
}
/** What applying would change (nothing is saved): restored types, hidden types. */
export function previewMySplit(id) {
  const split = state.splits.find((x) => x.id === id);
  return split ? { split, ...applySavedSplit(state.types, state.templates, split) } : null;
}
/** Apply a saved split: its types and templates come back as saved, and the week changes from today. */
export async function useMySplit(id) {
  const p = previewMySplit(id);
  if (!p) return null;
  await saveTypes(p.types);
  await saveTemplates(p.templates);
  await saveWeek(p.week);
  return p;
}

// ---- nutrition (optional, adults only, on this phone) ----
export async function saveNutrition(patch) {
  state.nutrition = normalizeNutrition({ ...state.nutrition, ...patch, updatedAt: Date.now() }); // under-18 → off
  await db.setMeta('nutrition', state.nutrition);
  return state.nutrition;
}

/** Manual daily totals; both blank removes the day. */
export async function saveIntake(date, { kcal = null, protein = null }) {
  const next = { ...state.intake };
  if (kcal == null && protein == null) delete next[date]; else next[date] = { kcal, protein };
  state.intake = normalizeIntake(next);
  await db.setMeta('intake', state.intake);
}

// ---- body log ----
export const bodyEntries = () => [...state.body.values()].sort((a, b) => (a.date < b.date ? -1 : 1));

export async function saveBodyEntry(raw) {
  const entry = normalizeBodyEntry({ ...raw, updatedAt: Date.now() });
  if (!entry) throw new Error(`Enter a bodyweight (${units() === 'lb' ? '45 to 880 lb' : '20 to 400 kg'}) or at least one measurement.`);
  state.body.set(entry.date, entry);
  await db.put('body', entry);
  return entry;
}

export async function deleteBodyEntry(date) {
  state.body.delete(date);
  await db.del('body', date);
}

// ---- skip reasons ----
/** Set or clear (null) the reason a planned day was skipped. */
export async function setSkipReason(date, reason) {
  const next = { ...state.skipReasons };
  if (SKIP_REASONS.includes(reason)) next[date] = reason; else delete next[date];
  state.skipReasons = next;
  await db.setMeta('skipReasons', state.skipReasons);
}

// ---- plan ----
/** Change the weekly schedule from today on; past days keep the plan they had. */
export async function saveWeek(days) {
  state.schedule = withWeekFrom(state.schedule, todayISO(), days);
  await db.setMeta('schedule', state.schedule);
}

export async function saveTemplates(templates) {
  state.templates = normalizeTemplates(templates);
  await db.setMeta('templates', state.templates);
  await syncCatalog();
}

/** Every template back to its starter list: the built-in defaults, a preset type's list, or empty. */
export async function resetTemplates() {
  const out = {};
  for (const t of state.types) {
    if (t.kind === 'lift') out[t.id] = structuredClone(DEFAULT_TEMPLATES[t.id] ?? PRESET_TEMPLATES[t.name] ?? []);
  }
  await saveTemplates(out);
}

// ---- backup ----
export function exportPayload() {
  return {
    app: 'workout-tracker',
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    units: 'kg', // stored units: weights in kg and lengths in cm, whatever the profile shows
    profile: state.profile,
    sessionTypes: state.types, // schema v7: ids are what sessions, plan and templates refer to
    nutrition: state.nutrition, // schema v9 (off unless you switched it on)
    intake: state.intake,
    splits: state.splits, // schema v10
    settings: state.settings,
    schedule: state.schedule,
    templates: state.templates,
    body: bodyEntries(),
    skipReasons: state.skipReasons,
    exercises: [...state.catalog.values()], // custom exercises and muscle tags (schema v5)
    sessions: allSessions().filter((s) => !isEmpty(s)).sort((a, b) => (a.date < b.date ? -1 : 1)),
  };
}

export async function markExported() {
  state.lastExportAt = Date.now();
  await db.setMeta('lastExportAt', state.lastExportAt);
}

/**
 * mode: 'merge' (imported day replaces the same date; your plan is kept)
 *    or 'replace' (wipe first; plan and settings come from the file when it has them).
 */
export async function importData(parsed, mode) {
  const { sessions, customExercises = [], settings, schedule, templates, body = [], muscles = {}, skipReasons = {} } = parsed;
  // The file's exercise catalog: v5 files carry it; older files are converted the same way as on startup.
  const names = sessions.flatMap((s) => s.exercises.map((e) => e.name));
  const incoming = parsed.exercises
    ? new Map(parsed.exercises.map((r) => [r.key, r]))
    : buildCatalog({
      names, v4Records: customExercises.map((n) => ({ key: keyOf(n), name: n })), v4Muscles: muscles, v4Defaults: DEFAULT_MUSCLES, index: state.libIndex,
    });
  for (const n of names) if (!incoming.has(keyOf(n))) incoming.set(keyOf(n), recordForName(n, state.libIndex));
  // Merge keeps your own exercise records (muscle tags, favourites); replace takes the file's.
  const catalog = mode === 'replace' ? incoming : new Map([...incoming, ...state.catalog]);
  // Reasons are per date, like sessions: the file wins on a clash when merging.
  const mergedReasons = mode === 'replace' ? skipReasons : { ...state.skipReasons, ...skipReasons };
  await db.run(['sessions', 'exercises', 'meta', 'body'], 'readwrite', (tx) => {
    const ss = tx.objectStore('sessions');
    const es = tx.objectStore('exercises');
    const bs = tx.objectStore('body');
    if (mode === 'replace') { ss.clear(); es.clear(); bs.clear(); }
    sessions.forEach((s) => ss.put(s));
    body.forEach((e) => bs.put(e));
    catalog.forEach((r) => es.put(r));
    if (mode === 'replace') {
      const meta = tx.objectStore('meta');
      meta.put({ key: 'settings', value: { ...DEFAULT_SETTINGS, ...settings } });
      if (schedule) meta.put({ key: 'schedule', value: schedule });
      if (templates) meta.put({ key: 'templates', value: templates });
    }
    tx.objectStore('meta').put({ key: 'skipReasons', value: mergedReasons });
  });
  state.catalog = catalog;
  refreshNames();
  state.skipReasons = mergedReasons;
  // Types: "Replace all" takes the file's list (older files: the built-ins); merging adds the file's types you
  // don't have, so every imported day keeps its name and colour. Your own types are never changed by a merge.
  if (mode === 'replace') await saveTypes(parsed.sessionTypes ?? defaultTypes());
  else if (parsed.sessionTypes) {
    const mine = new Set(state.types.map((t) => t.id));
    const added = parsed.sessionTypes.filter((t) => !mine.has(t.id));
    if (added.length) await saveTypes([...state.types, ...added.map((t, i) => ({ ...t, order: state.types.length + i }))]);
  }
  // Saved splits: "Replace all" takes the file's; merging keeps yours and adds the file's others (up to 10).
  const fileSplits = parsed.splits ?? [];
  await saveSplits(mode === 'replace' ? fileSplits
    : normalizeSplits([...state.splits, ...fileSplits.filter((f) => !state.splits.some((m) => m.id === f.id || m.name.toLowerCase() === f.name.toLowerCase()))]));
  // Nutrition: "Replace all" takes the file's; merging keeps your settings and adds the file's intake days.
  if (mode === 'replace') {
    state.nutrition = normalizeNutrition(parsed.nutrition);
    state.intake = normalizeIntake(parsed.intake);
  } else {
    state.intake = normalizeIntake({ ...parsed.intake, ...state.intake });
  }
  await db.setMeta('nutrition', state.nutrition);
  await db.setMeta('intake', state.intake);
  // Profile: "Replace all" takes the file's answers when it has them; this phone keeps its own first-run state.
  if (mode === 'replace' && parsed.profile) {
    state.profile = normalizeProfile({ ...parsed.profile, onboarding: state.profile.onboarding, setupCardDismissed: state.profile.setupCardDismissed });
    setUnits(state.profile.units);
    await db.setMeta('profile', state.profile);
  }
  if (mode === 'replace') {
    state.sessions.clear();
    state.body.clear();
    state.settings = { ...DEFAULT_SETTINGS, ...settings };
    if (schedule) state.schedule = schedule;
    if (templates) state.templates = templates;
  }
  sessions.forEach((s) => state.sessions.set(s.date, s));
  body.forEach((e) => state.body.set(e.date, e));
  await syncCatalog(); // e.g. "Replace all" from a file without your templates' exercises
}

export { migrateBackup };

export async function eraseAll() {
  await db.run(['sessions', 'exercises', 'meta', 'body'], 'readwrite', (tx) => {
    ['sessions', 'exercises', 'meta', 'body'].forEach((n) => tx.objectStore(n).clear());
  });
  state.body.clear();
  state.catalog = new Map();
  state.skipReasons = {};
  state.profile = { ...DEFAULT_PROFILE }; // back to a fresh install: the first-run flow shows again
  state.types = defaultTypes();
  setTypes(state.types);
  state.nutrition = { ...DEFAULT_NUTRITION };
  state.intake = {};
  state.splits = [];
  setUnits('kg');
  pending.forEach((p) => clearTimeout(p.timer));
  pending.clear();
  state.sessions.clear();
  state.settings = { ...DEFAULT_SETTINGS };
  state.lastExportAt = null;
  state.schedule = defaultSchedule(todayISO());
  state.templates = normalizeTemplates(DEFAULT_TEMPLATES);
  await db.run('meta', 'readwrite', (tx) => {
    tx.objectStore('meta').put({ key: 'schedule', value: state.schedule });
    tx.objectStore('meta').put({ key: 'templates', value: state.templates });
    tx.objectStore('meta').put({ key: 'profile', value: state.profile });
    tx.objectStore('meta').put({ key: 'sessionTypes', value: state.types });
    tx.objectStore('meta').put({ key: 'nutrition', value: state.nutrition });
    tx.objectStore('meta').put({ key: 'intake', value: state.intake });
  });
}
