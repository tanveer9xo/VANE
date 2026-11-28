// Saved splits (schema v10): "Save as my split" snapshots of the current week. Pure functions.
//
//   { id, name, days: { sun…sat: typeId | 'Break' | null }, types: [{ id, name, short, color, kind }],
//     templates: { typeId: [{ name, sets, repsMin, repsMax, weightStep, restSeconds } | { name, kind: 'cardio', minutes }] },
//     createdAt, updatedAt }   (cardio items: v12)
//
// A snapshot keeps the type ids, so applying it lines the week up with your history; each type's name, short
// label and colour come from the snapshot, restoring a type that was since edited, archived or deleted.
// Applying never touches logged workouts or past days: the week changes from today (store.saveWeek).
import { BREAK, PALETTE_KEYS } from './types.js';
import { isCardioItem, normalizeCardioItem } from './cardio.js';

export const MAX_SPLITS = 10;
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const RESERVED = ['__proto__', 'constructor', 'prototype'];
const intIn = (v, lo, hi) => { const n = Number(v); return v != null && v !== '' && Number.isInteger(n) && n >= lo && n <= hi ? n : null; };
/** A template item from a file: known fields only, plain values (the store normalises again when applied). */
const cleanItem = (x) => {
  const name = clean(typeof x === 'string' ? x : x?.name, 80);
  if (!name) return null;
  if (isCardioItem(x)) return normalizeCardioItem(x, (v) => clean(v, 80));
  const step = Number(x?.weightStep);
  return {
    name, sets: intIn(x?.sets, 1, 20) ?? 3, repsMin: intIn(x?.repsMin, 1, 100), repsMax: intIn(x?.repsMax, 1, 100),
    weightStep: Number.isFinite(step) && step >= 0.25 && step <= 50 ? step : null, restSeconds: intIn(x?.restSeconds, 10, 900),
  };
};

/** The type ids a week uses (no Break, no blanks), in Monday-first order, without repeats. */
export const typesInWeek = (days) => [...new Set(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((k) => days?.[k]).filter((t) => t && t !== BREAK))];

/** Snapshot the current week. → a split record. Throws if the week has no training days. */
const newId = (now) => `s-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export function snapshotSplit({ name, week, types, templates, id, now = Date.now() }) {
  id = id ?? newId(now);
  const title = clean(name, 40);
  if (!title) throw new Error('Give your split a name.');
  const days = Object.fromEntries(DAY_KEYS.map((k) => [k, week?.[k] ?? null]));
  const used = typesInWeek(days);
  if (!used.length) throw new Error('Your week has no training days to save. Pick a type for at least one day.');
  const byId = new Map(types.map((t) => [t.id, t]));
  return {
    id,
    name: title,
    days,
    types: used.filter((t) => byId.has(t)).map((t) => {
      const x = byId.get(t);
      return { id: x.id, name: x.name, short: x.short, color: x.color ?? null, kind: x.kind };
    }),
    templates: Object.fromEntries(used.map((t) => [t, structuredClone(templates?.[t] ?? [])])),
    createdAt: now,
    updatedAt: now,
  };
}

/** Valid saved splits only, at most 10, ids unique. */
export function normalizeSplits(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const s of raw) {
    const id = clean(s?.id, 60);
    const name = clean(s?.name, 40);
    if (!id || !name || RESERVED.includes(id) || seen.has(id) || !s.days || typeof s.days !== 'object') continue;
    const types = (Array.isArray(s.types) ? s.types : []).map((t) => ({
      id: clean(t?.id, 60), name: clean(t?.name, 40), short: clean(t?.short, 6) || clean(t?.name, 6),
      color: PALETTE_KEYS.includes(t?.color) ? t.color : null, kind: ['lift', 'cardio', 'other'].includes(t?.kind) ? t.kind : 'lift',
    })).filter((t) => t.id && t.name && t.id !== BREAK && !RESERVED.includes(t.id)).slice(0, 7);
    const ids = new Set(types.map((t) => t.id));
    const days = Object.fromEntries(DAY_KEYS.map((k) => {
      const v = s.days[k];
      return [k, v === BREAK || ids.has(v) ? v : null];
    }));
    if (!typesInWeek(days).length) continue;
    seen.add(id);
    out.push({
      id, name, days, types,
      templates: Object.fromEntries(types.map((t) => [t.id, (Array.isArray(s.templates?.[t.id]) ? s.templates[t.id] : []).slice(0, 40).map(cleanItem).filter(Boolean)])),
      createdAt: Number.isFinite(s.createdAt) ? s.createdAt : 0,
      updatedAt: Number.isFinite(s.updatedAt) ? s.updatedAt : 0,
    });
    if (out.length === MAX_SPLITS) break;
  }
  return out;
}

const same = (a, b) => a.name === b.name && a.short === b.short && (a.color ?? null) === (b.color ?? null);

/**
 * What applying a split would do (for the confirm sheet), and the result.
 * → { types, templates, week, ids, restored: [{ id, name, why: 'archived' | 'deleted' | 'edited', was? }],
 *     hidden: [names of lifting types that get hidden] }
 */
export function applySavedSplit(currentTypes, currentTemplates, split) {
  const restored = [];
  let list = currentTypes.map((t) => ({ ...t }));
  for (const snap of split.types) {
    const have = list.find((t) => t.id === snap.id);
    if (!have) {
      restored.push({ id: snap.id, name: snap.name, why: 'deleted' });
      list.push({ ...snap, builtin: false, hidden: false, archived: false, order: 0 });
      continue;
    }
    if (have.archived) restored.push({ id: snap.id, name: snap.name, why: 'archived' });
    else if (!same(have, snap)) restored.push({ id: snap.id, name: snap.name, why: 'edited', was: have.name });
    Object.assign(have, { name: snap.name, short: snap.short, color: snap.color, kind: snap.kind, hidden: false, archived: false });
  }
  const ids = split.types.map((t) => t.id);
  const hidden = list.filter((t) => t.kind === 'lift' && !t.archived && !t.hidden && !ids.includes(t.id)).map((t) => t.name);
  list = list.map((t) => (t.kind === 'lift' && !t.archived && !ids.includes(t.id) ? { ...t, hidden: true } : t));
  // The split's types first, in its order; the rest keep their relative order after them.
  const rest = list.filter((t) => !ids.includes(t.id)).sort((a, b) => a.order - b.order);
  list = [...ids.map((id) => list.find((t) => t.id === id)), ...rest].map((t, order) => ({ ...t, order }));
  const templates = { ...currentTemplates };
  for (const id of ids) templates[id] = structuredClone(split.templates[id] ?? []);
  return { types: list, templates, week: { ...split.days }, ids, restored, hidden };
}

// ---- list operations (each returns a new list; the store saves it) ----

export function addSplit(splits, split) {
  if (splits.length >= MAX_SPLITS) throw new Error(`You can save up to ${MAX_SPLITS} splits. Delete one to save another.`);
  if (splits.some((s) => s.id === split.id)) throw new Error('That split is already saved.');
  if (splits.some((s) => s.name.toLowerCase() === split.name.toLowerCase())) throw new Error(`You already have a split called “${split.name}”.`);
  return [...splits, split];
}

export function renameSplit(splits, id, name, now = Date.now()) {
  const title = clean(name, 40);
  if (!title) throw new Error('Give your split a name.');
  if (splits.some((s) => s.id !== id && s.name.toLowerCase() === title.toLowerCase())) throw new Error(`You already have a split called “${title}”.`);
  return splits.map((s) => (s.id === id ? { ...s, name: title, updatedAt: now } : s));
}

/** A copy named "… (copy)" (or "(copy 2)" …), right after the original. */
export function duplicateSplit(splits, id, now = Date.now()) {
  if (splits.length >= MAX_SPLITS) throw new Error(`You can save up to ${MAX_SPLITS} splits. Delete one to make a copy.`);
  const src = splits.find((s) => s.id === id);
  if (!src) return splits;
  let name = `${src.name} (copy)`.slice(0, 40);
  for (let n = 2; splits.some((s) => s.name.toLowerCase() === name.toLowerCase()); n++) name = `${src.name} (copy ${n})`.slice(0, 40);
  let copyId = newId(now);
  while (splits.some((s) => s.id === copyId)) copyId = newId(now);
  const copy = { ...structuredClone(src), id: copyId, name, createdAt: now, updatedAt: now };
  const i = splits.indexOf(src);
  return [...splits.slice(0, i + 1), copy, ...splits.slice(i + 1)];
}

/** "Save the current week into this split": new content, same id, name and place. */
export function updateSplit(splits, id, snapshot, now = Date.now()) {
  return splits.map((s) => (s.id === id ? { ...snapshot, id: s.id, name: s.name, createdAt: s.createdAt, updatedAt: now } : s));
}

export const deleteSplit = (splits, id) => splits.filter((s) => s.id !== id);

/** "Mon Push, Wed Pull, Fri Legs" from a split's own snapshot. */
export function splitDaysText(split, abbr, weekStartsOn = 1) {
  const names = new Map(split.types.map((t) => [t.id, t.short || t.name]));
  return abbr.map((l, i) => [l, split.days[DAY_KEYS[(weekStartsOn + i) % 7]]])
    .filter(([, t]) => t && t !== BREAK).map(([d, t]) => `${d} ${names.get(t) ?? t}`).join(', ');
}
