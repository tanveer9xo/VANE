// Muscle groups: the one place that maps the exercise library's muscle names (free-exercise-db) and the
// app's older muscle tags to the 14 display groups used by the body map, the planner and the picker.
// Pure data and functions; tests in tests/muscles.test.js.

/** Display groups, in a fixed order (body map labels, tables, filter chips). */
export const GROUPS = [
  'Chest', 'Back', 'Lower back', 'Shoulders', 'Biceps', 'Triceps', 'Forearms',
  'Abs', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Adductors/Abductors', 'Neck',
];

/** free-exercise-db muscle names (schema.json enum) → display group. */
export const DATASET_TO_GROUP = {
  abdominals: 'Abs',
  abductors: 'Adductors/Abductors',
  adductors: 'Adductors/Abductors',
  biceps: 'Biceps',
  calves: 'Calves',
  chest: 'Chest',
  forearms: 'Forearms',
  glutes: 'Glutes',
  hamstrings: 'Hamstrings',
  lats: 'Back',
  'lower back': 'Lower back',
  'middle back': 'Back',
  neck: 'Neck',
  quadriceps: 'Quads',
  shoulders: 'Shoulders',
  traps: 'Back',
  triceps: 'Triceps',
};

/** Muscle tags from app 1.4–1.6 (schema v4) → display group. */
export const V4_MUSCLE_TO_GROUP = {
  Chest: 'Chest', Back: 'Back', Shoulders: 'Shoulders', Biceps: 'Biceps', Triceps: 'Triceps',
  Quads: 'Quads', Hamstrings: 'Hamstrings', Glutes: 'Glutes', Calves: 'Calves', Core: 'Abs',
};

export const isGroup = (g) => GROUPS.includes(g);

/**
 * Library muscles → { primary: [group], secondary: [group] }. Several muscles can share a group (lats and
 * traps are both Back); a group that is primary is never also listed as secondary. Unknown names are dropped.
 */
export function groupsFromDataset(primaryMuscles = [], secondaryMuscles = []) {
  const map = (list) => [...new Set((list ?? []).map((m) => DATASET_TO_GROUP[m]).filter(Boolean))];
  const primary = map(primaryMuscles);
  const secondary = map(secondaryMuscles).filter((g) => !primary.includes(g));
  return { primary, secondary };
}

/** Clean a stored { primary, secondary } pair: known groups only, no duplicates, primary wins. */
export function normalizeGroups(primary, secondary) {
  const p = [...new Set((Array.isArray(primary) ? primary : primary ? [primary] : []).filter(isGroup))];
  const s = [...new Set((Array.isArray(secondary) ? secondary : secondary ? [secondary] : []).filter(isGroup))].filter((g) => !p.includes(g));
  return { primary: p, secondary: s };
}

/** How much one ticked working set counts for a group: 1 if primary, 0.5 if secondary, else 0. */
export function setWeight(groups, group) {
  if (groups?.primary?.includes(group)) return 1;
  if (groups?.secondary?.includes(group)) return 0.5;
  return 0;
}

/** Tile icon (Tabler name) for a group. Cardio days get a treadmill. */
const GROUP_ICON = {
  Chest: 'barbell', Triceps: 'barbell', Back: 'weight', 'Lower back': 'weight', Biceps: 'weight', Forearms: 'weight',
  Shoulders: 'target', Abs: 'stretching', Neck: 'stretching', Quads: 'run', Hamstrings: 'run', Glutes: 'run',
  'Adductors/Abductors': 'run', Calves: 'walk',
};
export const groupIcon = (group, type = null) => (!group && type === 'Cardio' ? 'treadmill' : GROUP_ICON[group] ?? 'barbell');

/** Equipment values in the library (schema.json enum), as filter labels. null → "None". */
export const EQUIPMENT = [
  'barbell', 'dumbbell', 'cable', 'machine', 'body only', 'kettlebells', 'bands', 'e-z curl bar',
  'medicine ball', 'exercise ball', 'foam roll', 'other',
];
export const equipmentLabel = (e) => (e ? e[0].toUpperCase() + e.slice(1) : 'None');
