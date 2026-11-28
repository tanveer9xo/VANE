// Stored-data migration, made safe (1.15). Pure functions: no IndexedDB here.
//
// On start the store reads every record (raw), then:
//   1. storedSchema(raw) says which data format is on the phone. Newer than this code → don't touch it.
//   2. If older, the store snapshots all of it into the 'snapshots' store first (the last 2 are kept).
//   3. migrateStored(raw) works out the whole new state in memory, without writing anything.
//   4. verifyMigration(raw, plan) checks nothing was lost: workouts, sets, session types, saved splits and
//      Body log entries must all still be there. If it throws, nothing is written; the old data stays as it was.
//   5. Only then does the store write the plan in ONE transaction (all or nothing), with the new format number.
import {
  SCHEMA_VERSION, APP_VERSION, DEFAULT_SETTINGS, upgradeSessionRecord, isSessionEmpty, pickSettings, normalizeSchedule,
  normalizeTemplates, defaultSchedule, normalizeSkipReasons, BREAK,
} from './model.js';
import { normalizeProfile, templatesFollowDefaultStep, profileForExisting } from './profile.js';
import { normalizeTypes, defaultTypes, withKnownTypes, BUILTIN_IDS } from './types.js';
import { normalizeSplits } from './splits.js';
import { normalizeNutrition, normalizeIntake } from './nutrition.js';

export class MigrationError extends Error {}

/** raw = { sessions: [], exercises: [], body: [], meta: { key: value } } → is there anything to protect? */
export const hasData = (raw) => raw.sessions.length > 0 || raw.body.length > 0 || Object.keys(raw.meta).length > 0;

/**
 * The data format on the phone: the stored marker (from 1.15 on), otherwise the highest session record version
 * (each session carries one), otherwise — nothing logged yet — the current one.
 */
export function storedSchema(raw) {
  const marker = raw.meta.schemaVersion;
  if (Number.isInteger(marker) && marker > 0) return marker;
  const vs = raw.sessions.map((s) => (Number.isInteger(s?.v) ? s.v : 1));
  return vs.length ? Math.max(...vs) : SCHEMA_VERSION;
}

/**
 * Everything the store needs, worked out in memory. → { state: { sessions, body, settings, … },
 * writes: { sessions: [records to put], meta: { key: value } } }
 */
export function migrateStored(raw, { today }) {
  const m = raw.meta;
  const writes = { sessions: [], meta: {} };
  const types = normalizeTypes(m.sessionTypes) ?? defaultTypes();
  if (!m.sessionTypes) writes.meta.sessionTypes = types; // v6 → v7: the built-ins become the list
  const knownIds = [...BUILTIN_IDS, ...types.map((t) => t.id)];
  // Sessions are read with this phone's own types known (custom ids included).
  return withKnownTypes(knownIds, () => {
    const sessions = [];
    for (const rec of raw.sessions) {
      const { session, changed } = upgradeSessionRecord(rec);
      if (!session) continue; // counted by verifyMigration: a lost record stops the whole update
      sessions.push(session);
      if (changed) writes.sessions.push(session);
    }
    const settings = { ...DEFAULT_SETTINGS, ...pickSettings(m.settings) };
    // v5 → v6: no profile yet. With logged workouts there's no first-run flow, just a one-time card; template
    // steps that only repeated the default now follow it (same numbers; see profile.js).
    const upgradingToV6 = !m.profile;
    const templatesRaw = upgradingToV6 ? templatesFollowDefaultStep(m.templates, settings.weightStep) : m.templates;
    const profile = upgradingToV6 ? profileForExisting(sessions.some((s) => !isSessionEmpty(s, settings))) : normalizeProfile(m.profile);
    if (upgradingToV6) writes.meta.profile = profile;
    const schedule = normalizeSchedule(m.schedule, today) ?? normalizeSchedule(m.settings?.schedule, today) ?? defaultSchedule(today);
    const templates = normalizeTemplates(templatesRaw ?? m.settings?.templates);
    if (!m.schedule || !m.templates || upgradingToV6 || m.settings?.schedule || m.settings?.templates) {
      Object.assign(writes.meta, { schedule, templates, settings });
    }
    return {
      state: {
        sessions, settings, profile, schedule, templates, types,
        body: raw.body.slice(),
        splits: normalizeSplits(m.splits),
        nutrition: normalizeNutrition(m.nutrition),
        intake: normalizeIntake(m.intake),
        skipReasons: normalizeSkipReasons(m.skipReasons),
        lastExportAt: m.lastExportAt ?? null,
      },
      writes,
    };
  });
}

const setCount = (sessions) => sessions.reduce((n, s) => n + (s?.exercises ?? []).filter((e) => e?.kind !== 'cardio')
  .reduce((k, e) => k + (Array.isArray(e?.sets) ? e.sets.length : 0), 0), 0);

/**
 * Nothing may be lost. Throws a MigrationError naming what didn't match; the store then keeps the old data.
 * (Counts only go one way: a migration may add — e.g. a Treadmill entry from old treadmill minutes — never drop.)
 */
export function verifyMigration(raw, plan) {
  const s = plan.state;
  const problems = [];
  if (s.sessions.length !== raw.sessions.length) problems.push(`workouts: ${raw.sessions.length} before, ${s.sessions.length} after`);
  const setsBefore = setCount(raw.sessions);
  const setsAfter = setCount(s.sessions);
  if (setsAfter !== setsBefore) problems.push(`sets: ${setsBefore} before, ${setsAfter} after`);
  // Every workout keeps its session type (the only renaming ever done is the 1.1 "Rest" → Break).
  const before = new Map(raw.sessions.map((r) => [r?.date, r?.type === 'Rest' ? BREAK : r?.type || null]));
  const changedType = s.sessions.filter((x) => (before.get(x.date) ?? null) !== (x.type ?? null)).length;
  if (changedType) problems.push(`session types: ${changedType} workout${changedType === 1 ? '' : 's'} would change type`);
  const storedTypes = Array.isArray(raw.meta.sessionTypes) ? raw.meta.sessionTypes.length : 0;
  if (s.types.length < storedTypes) problems.push(`session types: ${storedTypes} before, ${s.types.length} after`);
  const splitsBefore = Array.isArray(raw.meta.splits) ? raw.meta.splits.length : 0;
  if (s.splits.length !== splitsBefore) problems.push(`saved splits: ${splitsBefore} before, ${s.splits.length} after`);
  if (s.body.length !== raw.body.length) problems.push(`Body log entries: ${raw.body.length} before, ${s.body.length} after`);
  if (problems.length) throw new MigrationError(`The data check failed (${problems.join('; ')}).`);
}

/** A stored snapshot as a normal backup file, importable by this app (older formats are migrated on import). */
export function snapshotToBackup(snap) {
  const meta = Object.fromEntries((snap.data.meta ?? []).map((r) => [r.key, r.value]));
  const v = snap.fromVersion;
  return {
    app: 'workout-tracker', schemaVersion: v, appVersion: snap.appVersion, exportedAt: new Date(snap.createdAt).toISOString(),
    note: `Snapshot taken before VANE updated this phone's data from format v${v} to v${snap.toVersion}.`,
    units: 'kg',
    settings: meta.settings ?? {}, schedule: meta.schedule ?? null, templates: meta.templates ?? null,
    skipReasons: meta.skipReasons ?? {}, muscles: meta.muscles ?? {}, profile: meta.profile ?? null,
    sessionTypes: meta.sessionTypes ?? null, nutrition: meta.nutrition ?? null, intake: meta.intake ?? {}, splits: meta.splits ?? [],
    exercises: v >= 5 ? snap.data.exercises : undefined,
    customExercises: v < 5 ? (snap.data.exercises ?? []).map((r) => r.name) : undefined,
    body: snap.data.body ?? [],
    sessions: snap.data.sessions ?? [],
  };
}

/** A snapshot record of every store. */
export function makeSnapshot(raw, fromVersion, now = Date.now()) {
  return {
    id: now, fromVersion, toVersion: SCHEMA_VERSION, appVersion: APP_VERSION, createdAt: now,
    data: { sessions: raw.sessions, exercises: raw.exercises, body: raw.body, meta: Object.entries(raw.meta).map(([key, value]) => ({ key, value })) },
  };
}
export const SNAPSHOTS_KEPT = 2;
