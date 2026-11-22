// Session types (schema v7): user-defined data instead of a fixed list.
//
//   { id, name, short, color: 'red'|…|'pink'|null, kind: 'lift'|'cardio'|'other', builtin, hidden, archived, order }
//
// - id is stable: sessions, the weekly plan and templates store it, so renaming or recolouring never rewrites
//   history. The built-in types keep their original names as ids ('Push', 'Full body', …), so data from
//   before v7 needs no rewrite at all; new types get 't-…' ids.
// - color is one of 8 palette slots (js/theme.js, validated with the dataviz validator in both themes), or
//   null = a neutral grey. A type always shows its name or short label too: colour is never the only cue.
// - hidden: kept, out of the pickers. archived: deleted but has history; past days still show its name/colour.
// This module keeps a registry of the current types (set by the store) so views and pure helpers can look
// a type up by id; the functions that change types are pure and return new lists.

export const BREAK = 'Break';
/** The 8 colour slots, in assignment order (theme.js holds their values). */
export const PALETTE_KEYS = ['red', 'blue', 'gold', 'green', 'violet', 'orange', 'cyan', 'pink'];
export const COLOR_NAMES = { red: 'Red', blue: 'Blue', gold: 'Gold', green: 'Green', violet: 'Violet', orange: 'Orange', cyan: 'Cyan', pink: 'Pink' };
export const MAX_COLOURED = PALETTE_KEYS.length;

const B = (id, short, color, kind = 'lift') => ({ id, name: id, short, color, kind, builtin: true, hidden: false, archived: false });
export const BUILTIN_TYPES = [
  B('Push', 'Push', 'red'), B('Pull', 'Pull', 'blue'), B('Legs', 'Legs', 'gold'), B('Upper', 'Upper', 'green'),
  B('Lower', 'Lower', 'violet'), B('Full body', 'Full', 'orange'), B('Cardio', 'Cardio', 'cyan', 'cardio'), B('Other', 'Other', null, 'other'),
].map((t, order) => ({ ...t, order }));
export const BUILTIN_IDS = BUILTIN_TYPES.map((t) => t.id);
export const defaultTypes = () => BUILTIN_TYPES.map((t) => ({ ...t }));

// ---------------------------------------------------------------------------
// Registry (current types; the store keeps it in sync)
// ---------------------------------------------------------------------------
let registry = new Map(defaultTypes().map((t) => [t.id, t]));
let extraKnown = null; // ids from a backup being imported (see withKnownTypes)

export function setTypes(list) { registry = new Map((list ?? defaultTypes()).map((t) => [t.id, t])); }
export const allTypes = () => [...registry.values()].sort((a, b) => a.order - b.order);
export const typeById = (id) => registry.get(id) ?? null;
/** Any type id this device (or the backup being read) knows, archived ones included. Break is not a type. */
export const isTypeId = (id) => typeof id === 'string' && id !== BREAK && (registry.has(id) || !!extraKnown?.has(id));
/** Run fn while ids from a file count as known (a v7 backup's own custom types). */
export function withKnownTypes(ids, fn) {
  const prev = extraKnown;
  extraKnown = new Set(ids);
  try { return fn(); } finally { extraKnown = prev; }
}

/** The types offered in the Planner and the Day screen: not hidden, not archived. */
export const pickerTypes = () => allTypes().filter((t) => !t.hidden && !t.archived);
/** Types that have an exercise template (lifting types). */
export const templateTypeIds = () => allTypes().filter((t) => t.kind === 'lift').map((t) => t.id);

export const typeName = (id) => (id === BREAK ? 'Break' : registry.get(id)?.name ?? (id ? String(id) : ''));
export const typeShort = (id) => (id === BREAK ? 'Break' : registry.get(id)?.short ?? autoShort(typeName(id)));
/** CSS colour key for a type: 'red'…'pink', 'neutral' (no colour slot), 'break', or 'none'. */
export const typeColor = (id) => (id === BREAK ? 'break' : !id ? 'none' : registry.get(id)?.color ?? 'neutral');
export const isCardio = (id) => registry.get(id)?.kind === 'cardio';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** A short label (≤ 6 characters) for narrow cells: "Chest + Triceps" → "C+T", "Chest day" → "Chest", "Shoulders" → "Shldr". */
export function autoShort(name) {
  const n = String(name ?? '').trim();
  if (n.length <= 6) return n;
  const words = n.split(/\s+/).filter(Boolean);
  // "Chest + Triceps" → "C+T"; "Full body" / "Chest day" → the first word when it fits.
  if (words.some((w) => /^[+&/]$/.test(w))) return words.map((w) => (/^[+&/]$/.test(w) ? w : w[0].toUpperCase())).join('').slice(0, 6);
  if (words.length > 1 && words[0].length <= 6) return words[0];
  if (words.length > 1) return words.map((w) => w[0].toUpperCase()).join('').slice(0, 6);
  const w = words[0];
  return (w[0] + w.slice(1).replace(/[aeiou]/gi, '')).slice(0, 5);
}

const cleanText = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Valid type records (null if unusable). Unknown colours become neutral; built-ins keep their ids. */
export function normalizeTypes(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  const seen = new Set();
  raw.forEach((t, i) => {
    const id = cleanText(t?.id, 60);
    const name = cleanText(t?.name, 40);
    if (!id || !name || id === BREAK || seen.has(id)) return;
    seen.add(id);
    out.push({
      id,
      name,
      short: cleanText(t.short, 6) || autoShort(name),
      color: PALETTE_KEYS.includes(t.color) ? t.color : null,
      kind: ['lift', 'cardio', 'other'].includes(t.kind) ? t.kind : 'lift',
      builtin: BUILTIN_IDS.includes(id) && t.builtin !== false,
      hidden: t.hidden === true,
      archived: t.archived === true,
      order: Number.isFinite(t.order) ? t.order : i,
    });
  });
  return out.length ? out : null;
}

/** The next palette colour no active (visible, not archived) type uses; null once all 8 are taken. */
export function nextColor(types, exceptId = null) {
  const used = new Set(types.filter((t) => !t.hidden && !t.archived && t.id !== exceptId).map((t) => t.color).filter(Boolean));
  return PALETTE_KEYS.find((k) => !used.has(k)) ?? null;
}

const idFor = (name, types) => {
  const base = `t-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'type'}`;
  let id = base;
  for (let n = 2; types.some((t) => t.id === id); n++) id = `${base}-${n}`;
  return id;
};

/** Add a type: next unused colour (neutral beyond 8), short label from the name. → { types, type } */
export function addType(types, { name, short, color, kind = 'lift' }) {
  const clean = cleanText(name, 40);
  if (!clean) throw new Error('Give the session type a name.');
  if (types.some((t) => !t.archived && t.name.toLowerCase() === clean.toLowerCase())) throw new Error(`There is already a type called “${clean}”.`);
  const type = {
    id: idFor(clean, types), name: clean, short: cleanText(short, 6) || autoShort(clean),
    color: color === undefined ? nextColor(types) : PALETTE_KEYS.includes(color) ? color : null,
    kind, builtin: false, hidden: false, archived: false, order: Math.max(-1, ...types.map((t) => t.order)) + 1,
  };
  return { types: [...types, type], type };
}

/** Rename, recolour, change the short label, hide or show. History refers to the id, so nothing else changes. */
export function updateType(types, id, patch) {
  return types.map((t) => {
    if (t.id !== id) return t;
    const name = patch.name !== undefined ? cleanText(patch.name, 40) || t.name : t.name;
    return {
      ...t,
      name,
      short: patch.short !== undefined ? cleanText(patch.short, 6) || autoShort(name) : patch.name !== undefined && t.short === autoShort(t.name) ? autoShort(name) : t.short,
      color: patch.color !== undefined ? (PALETTE_KEYS.includes(patch.color) ? patch.color : null) : t.color,
      hidden: patch.hidden !== undefined ? !!patch.hidden : t.hidden,
    };
  });
}

/**
 * Delete a type. With history (logged days or past plan days use it) it's archived instead: out of every
 * picker, but past days keep its name and colour. Without history it's removed. → { types, archived }
 */
export function deleteType(types, id, hasHistory) {
  if (hasHistory) return { types: types.map((t) => (t.id === id ? { ...t, archived: true, hidden: true } : t)), archived: true };
  return { types: types.filter((t) => t.id !== id), archived: false };
}

// ---------------------------------------------------------------------------
// Presets: create (or reuse by name) the types and their templates, and a weekly pattern
// ---------------------------------------------------------------------------
const X = (name, sets, repsMin, repsMax, restSeconds = null) => ({ name, sets, repsMin, repsMax, weightStep: null, restSeconds });
const ISO = 60;
const HEAVY = 180;
/** Templates for the new preset types (exercise names from the bundled library or your built-ins). */
export const PRESET_TEMPLATES = {
  'Chest + Triceps': [X('Barbell Bench Press - Medium Grip', 4, 6, 10, HEAVY), X('Incline DB Press', 3, 8, 12), X('Pec Deck', 3, 12, 15, ISO),
    X('Dips - Triceps Version', 3, 8, 12), X('Triceps Pushdown', 3, 10, 12, ISO), X('Cable Rope Overhead Triceps Extension', 3, 10, 15, ISO)],
  'Back + Biceps': [X('Pull-up', 3, 6, 10), X('Barbell Row', 4, 6, 10), X('Lat Pulldown', 3, 8, 12), X('Seated Row', 3, 10, 12),
    X('Biceps Curl', 3, 10, 12, ISO), X('Hammer Curls', 3, 10, 12, ISO)],
  Shoulders: [X('Overhead Press', 4, 6, 10, HEAVY), X('Arnold Dumbbell Press', 3, 8, 12), X('Lateral Raise', 4, 12, 15, ISO),
    X('Reverse Flyes', 3, 12, 15, ISO), X('Front Dumbbell Raise', 2, 12, 15, ISO), X('Barbell Shrug', 3, 10, 15, ISO)],
  Arms: [X('Close-Grip Barbell Bench Press', 3, 6, 10), X('EZ-Bar Curl', 3, 8, 12), X('EZ-Bar Skullcrusher', 3, 10, 12, ISO),
    X('Preacher Curl', 3, 10, 12, ISO), X('Triceps Pushdown', 3, 12, 15, ISO), X('Concentration Curls', 2, 12, 15, ISO)],
  'Chest + Back': [X('Barbell Bench Press - Medium Grip', 4, 6, 10, HEAVY), X('Pull-up', 4, 6, 10), X('Incline DB Press', 3, 8, 12),
    X('Barbell Row', 3, 6, 10), X('Dumbbell Flyes', 3, 10, 12, ISO), X('Seated Row', 3, 10, 12)],
  'Shoulders + Arms': [X('Overhead Press', 4, 6, 10, HEAVY), X('Lateral Raise', 3, 12, 15, ISO), X('EZ-Bar Curl', 3, 8, 12),
    X('Close-Grip Barbell Bench Press', 3, 6, 10), X('Hammer Curls', 3, 10, 12, ISO), X('Triceps Pushdown', 3, 10, 12, ISO)],
};

/** Presets: the types they use (by name) and how many sessions a week by default. */
export const PRESETS = {
  ppl: { label: 'Push/Pull/Legs', types: ['Push', 'Pull', 'Legs'], sessions: 3 },
  ul: { label: 'Upper/Lower', types: ['Upper', 'Lower'], sessions: 4 },
  full: { label: 'Full body', types: ['Full body'], sessions: 3 },
  bro: { label: 'Bro split', types: ['Chest + Triceps', 'Back + Biceps', 'Legs', 'Shoulders', 'Arms'], sessions: 5 },
  arnold: { label: 'Arnold split', types: ['Chest + Back', 'Shoulders + Arms', 'Legs'], sessions: 6 },
};

/** Which days train for n sessions a week (Mon = 0 … Sun = 6), spread out with rest between. */
const SPREAD = { 1: [0], 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 4, 5], 6: [0, 1, 2, 3, 4, 5], 7: [0, 1, 2, 3, 4, 5, 6] };
const MON_FIRST = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
// A split with 5+ types does one of each Mon–Fri at 5 a week; smaller splits rest midweek.
const SPREAD_WIDE = { ...SPREAD, 5: [0, 1, 2, 3, 4] };

/**
 * Apply a preset. Types are matched by name (a visible or hidden type of that name is reused and shown
 * again; an archived one is not), missing ones are created with their template. The other lifting types
 * are hidden (their history stays; show them again in Session types). Cardio and Other are left alone.
 * Colours: reused types keep theirs unless an active type already has it; new types get the next unused.
 * → { types, templates, week: { mon…sun: id | 'Break' }, ids: [type ids in preset order] }
 */
export function applyPreset(types, templates, presetId, sessions) {
  const preset = PRESETS[presetId];
  if (!preset) throw new Error(`Unknown preset ${presetId}`);
  let list = types.map((t) => ({ ...t }));
  const nextTemplates = { ...templates };
  const ids = [];
  for (const name of preset.types) {
    const found = list.find((t) => !t.archived && t.name.toLowerCase() === name.toLowerCase());
    if (found) { found.hidden = false; ids.push(found.id); continue; }
    const { types: added, type } = addType(list, { name, color: null }); // coloured below
    list = added;
    ids.push(type.id);
    nextTemplates[type.id] = (PRESET_TEMPLATES[name] ?? []).map((x) => ({ ...x }));
  }
  // Hide the other lifting types; then make sure the preset's types have distinct colours.
  list = list.map((t) => (t.kind === 'lift' && !t.archived && !ids.includes(t.id) ? { ...t, hidden: true } : t));
  // The preset's types come first, in its order; the rest keep their relative order after them.
  const rest = list.filter((t) => !ids.includes(t.id)).sort((a, b) => a.order - b.order);
  list = [...ids.map((id) => list.find((t) => t.id === id)), ...rest].map((t, order) => ({ ...t, order }));
  const taken = new Set(list.filter((t) => !t.hidden && !t.archived && !ids.includes(t.id)).map((t) => t.color).filter(Boolean));
  for (const id of ids) {
    const t = list.find((x) => x.id === id);
    if (t.color && !taken.has(t.color)) { taken.add(t.color); continue; }
    t.color = PALETTE_KEYS.find((k) => !taken.has(k)) ?? null;
    if (t.color) taken.add(t.color);
  }
  return { types: list, templates: nextTemplates, week: presetWeek(ids, sessions ?? preset.sessions), ids };
}

/** Type ids + sessions per week → { mon…sun }, cycling the types over the training days. */
export function presetWeek(ids, sessions) {
  const n = Math.min(7, Math.max(1, sessions || ids.length));
  const days = Object.fromEntries(['sun', ...MON_FIRST.slice(0, 6)].map((k) => [k, BREAK])); // stored order: sun…sat
  const spread = ids.length >= 5 ? SPREAD_WIDE : SPREAD;
  spread[n].forEach((d, i) => { days[MON_FIRST[d]] = ids[i % ids.length]; });
  return days;
}
