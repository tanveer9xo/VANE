// Round 5: exercise library, muscle mapping, v4 → v5 migration, body-map volume, trend/stall, CSV round trip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  GROUPS, DATASET_TO_GROUP, V4_MUSCLE_TO_GROUP, groupsFromDataset, normalizeGroups, setWeight,
} from '../js/muscles.js';
import {
  normaliseName, ALIASES, indexLibrary, matchLibrary, buildCatalog, recordForName, normalizeCatalogRecord,
} from '../js/library.js';
import {
  setsByGroup, weeklySets, statusFor, rampLevel, undertrained, exercisesForGroup, lastTrained, plannedByGroup, targetFor,
} from '../js/volume.js';
import { trendOf, stallOf, exerciseHistory } from '../js/stats.js';
import { sessionsToCSV, csvToBackup, parseCSV } from '../js/csv.js';
import {
  migrateBackup, DEFAULT_EXERCISES, DEFAULT_MUSCLES, SCHEMA_VERSION, pickSettings, upgradeSessionRecord,
} from '../js/model.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const LIB = JSON.parse(readFileSync(`${root}data/exercises.json`, 'utf8'));
const SCHEMA = JSON.parse(readFileSync(`${root}tests/fixtures/free-exercise-db.schema.json`, 'utf8'));
const index = indexLibrary(LIB);

// ---------------- the bundled library ----------------
test('bundled library: trimmed fields only, no images, every record valid against the dataset schema', () => {
  assert.ok(LIB.length >= 800, `${LIB.length} exercises`);
  const muscles = SCHEMA.properties.primaryMuscles.items[0].enum;
  const equipment = SCHEMA.properties.equipment.enum;
  const ids = new Set();
  for (const e of LIB) {
    assert.deepEqual(Object.keys(e).sort(), ['category', 'equipment', 'id', 'level', 'name', 'primaryMuscles', 'secondaryMuscles']);
    assert.ok(!ids.has(e.id), `duplicate id ${e.id}`);
    ids.add(e.id);
    assert.ok([...e.primaryMuscles, ...e.secondaryMuscles].every((m) => muscles.includes(m)), e.id);
    assert.ok(equipment.includes(e.equipment), `${e.id} equipment ${e.equipment}`);
    assert.ok(SCHEMA.properties.level.enum.includes(e.level));
    assert.ok(SCHEMA.properties.category.enum.includes(e.category));
  }
});

// ---------------- muscle mapping ----------------
test('muscle mapping: 14 groups, and every dataset muscle maps to one', () => {
  assert.equal(GROUPS.length, 14);
  assert.deepEqual(GROUPS, ['Chest', 'Back', 'Lower back', 'Shoulders', 'Biceps', 'Triceps', 'Forearms', 'Abs', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Adductors/Abductors', 'Neck']);
  const datasetMuscles = SCHEMA.properties.primaryMuscles.items[0].enum;
  assert.deepEqual(Object.keys(DATASET_TO_GROUP).sort(), [...datasetMuscles].sort());
  for (const m of datasetMuscles) assert.ok(GROUPS.includes(DATASET_TO_GROUP[m]), m);
  assert.equal(DATASET_TO_GROUP.lats, 'Back');
  assert.equal(DATASET_TO_GROUP['middle back'], 'Back');
  assert.equal(DATASET_TO_GROUP.traps, 'Back');
  assert.equal(DATASET_TO_GROUP['lower back'], 'Lower back');
  assert.equal(DATASET_TO_GROUP.abductors, 'Adductors/Abductors');
  assert.equal(DATASET_TO_GROUP.adductors, 'Adductors/Abductors');
  assert.equal(V4_MUSCLE_TO_GROUP.Core, 'Abs');
  assert.ok(Object.values(V4_MUSCLE_TO_GROUP).every((g) => GROUPS.includes(g)));
});

test('groups from the dataset: merged, primary wins, unknown names dropped', () => {
  assert.deepEqual(groupsFromDataset(['middle back'], ['biceps', 'lats', 'shoulders']), { primary: ['Back'], secondary: ['Biceps', 'Shoulders'] });
  assert.deepEqual(groupsFromDataset(['lower back'], ['lats', 'traps', 'middle back', 'glutes']), { primary: ['Lower back'], secondary: ['Back', 'Glutes'] });
  assert.deepEqual(groupsFromDataset(['abductors', 'adductors'], []), { primary: ['Adductors/Abductors'], secondary: [] });
  assert.deepEqual(groupsFromDataset(['wings'], ['chest']), { primary: [], secondary: ['Chest'] });
  assert.deepEqual(normalizeGroups('Chest', ['Chest', 'Triceps', 'Nope']), { primary: ['Chest'], secondary: ['Triceps'] });
  assert.equal(setWeight({ primary: ['Chest'], secondary: ['Triceps'] }, 'Chest'), 1);
  assert.equal(setWeight({ primary: ['Chest'], secondary: ['Triceps'] }, 'Triceps'), 0.5);
  assert.equal(setWeight({ primary: ['Chest'], secondary: ['Triceps'] }, 'Quads'), 0);
});

// ---------------- matching names to the library ----------------
test('name normalising: case, punctuation, plurals and gym short forms', () => {
  assert.equal(normaliseName('Pull-up'), normaliseName('Pullups'));
  assert.equal(normaliseName('pull ups'), 'pullup');
  assert.equal(normaliseName('DB Bench Press'), normaliseName('Dumbbell Bench Press'));
  assert.equal(normaliseName('Leg Extension'), normaliseName('Leg Extensions'));
  assert.equal(normaliseName('Calf Raises - With Bands'), 'calfraisewithband');
  assert.notEqual(normaliseName('Leg Press'), normaliseName('Leg Curl'));
});

test('every alias points at a real library entry, and every built-in exercise is matched', () => {
  for (const [name, id] of Object.entries(ALIASES)) assert.ok(index.byId.has(id), `${name} → ${id}`);
  for (const name of DEFAULT_EXERCISES) assert.ok(matchLibrary(name, index), `${name} has no library match`);
  assert.equal(matchLibrary('DB Chest Press', index).id, 'Dumbbell_Bench_Press');
  assert.equal(matchLibrary('pull-up', index).id, 'Pullups');
  assert.equal(matchLibrary('Leg Extension', index).id, 'Leg_Extensions');
  assert.equal(matchLibrary('cable crunch', index).id, 'Cable_Crunch');
  assert.equal(matchLibrary('Zercher Squat Deluxe', index), null);
});

// ---------------- v4 → v5 migration ----------------
test('v4 → v5: library matches, v4 tags and defaults; names kept exactly; unknowns wait for their muscle', () => {
  const catalog = buildCatalog({
    names: ['db chest press', 'Squat', 'Zercher Squat Deluxe', 'Plank Row', 'Cable Crunch'],
    v4Records: [{ key: 'my hip thing', name: 'My Hip Thing' }, { key: 'plank row', name: 'Plank Row' }],
    v4Muscles: { 'my hip thing': 'Glutes', squat: 'Glutes', 'cable crunch': null },
    v4Defaults: DEFAULT_MUSCLES,
    index,
  });
  const press = catalog.get('db chest press');
  assert.equal(press.name, 'db chest press'); // as logged: never renamed
  assert.equal(press.libId, 'Dumbbell_Bench_Press');
  assert.deepEqual([press.primary, press.secondary], [['Chest'], ['Shoulders', 'Triceps']]);
  assert.equal(press.needsMuscle, false);
  // An explicit v4 tag wins for the main muscle, the library still gives the helpers.
  assert.deepEqual(catalog.get('squat').primary, ['Glutes']);
  assert.ok(catalog.get('squat').secondary.includes('Hamstrings'));
  // A v4 custom exercise with a tag keeps it and stays custom.
  assert.deepEqual(catalog.get('my hip thing'), {
    key: 'my hip thing', name: 'My Hip Thing', libId: null, primary: ['Glutes'], secondary: [], equipment: null, custom: true, favourite: false, needsMuscle: false,
  });
  // No match and nothing known: ask once.
  assert.equal(catalog.get('zercher squat deluxe').needsMuscle, true);
  assert.equal(catalog.get('plank row').needsMuscle, true);
  assert.equal(catalog.get('plank row').custom, true);
  // "Untagged" chosen in v4 on a library exercise: no muscle, and no question either.
  assert.deepEqual(catalog.get('cable crunch').primary, []);
  assert.equal(catalog.get('cable crunch').needsMuscle, false);
});

test('v5 catalog is stable: running the migration again changes nothing', () => {
  const first = buildCatalog({ names: ['DB Chest Press', 'Zercher Squat Deluxe'], index });
  const again = buildCatalog({ names: ['DB Chest Press', 'Zercher Squat Deluxe', 'Leg Press'], v4Records: [...first.values()], index });
  assert.deepEqual(again.get('db chest press'), first.get('db chest press'));
  assert.deepEqual(again.get('zercher squat deluxe'), first.get('zercher squat deluxe'));
  assert.equal(again.get('leg press').libId, 'Leg_Press');
});

test('v4 backups still import (exercises built on import); v5 backups carry the catalog', () => {
  const v4 = migrateBackup({ schemaVersion: 4, sessions: [{ v: 4, date: '2026-11-10', type: 'Push', exercises: [{ name: 'DB Chest Press', sets: [{ weight: 30, reps: 8 }] }] }], customExercises: ['Hip Thing'], muscles: { 'hip thing': 'Glutes' } });
  assert.ok(SCHEMA_VERSION >= 7);
  assert.equal(v4.sessions[0].v, SCHEMA_VERSION);
  assert.equal(v4.sessions[0].exercises[0].name, 'DB Chest Press');
  assert.equal(v4.exercises, null);
  assert.deepEqual(v4.customExercises, ['Hip Thing']);
  assert.deepEqual(v4.muscles, { 'hip thing': 'Glutes' });
  const v5 = migrateBackup({ schemaVersion: 5, sessions: [], exercises: [{ name: 'Hip Thing', primary: ['Glutes'], custom: true, favourite: true }, { name: '' }] });
  assert.equal(v5.exercises.length, 1);
  assert.equal(v5.exercises[0].favourite, true);
  assert.equal(upgradeSessionRecord({ v: 4, date: '2026-11-10', exercises: [] }).session.v, SCHEMA_VERSION);
  assert.deepEqual(normalizeCatalogRecord({ name: 'X', primary: ['Chest'], needsMuscle: true }).needsMuscle, false);
  assert.equal(recordForName('Nothing Like It', index).needsMuscle, true);
});

test('weekly muscle targets are validated settings', () => {
  assert.deepEqual(pickSettings({ muscleTarget: 12, muscleTargets: { Chest: 14, Quads: 0, Wings: 3, Back: '8' } }), { muscleTarget: 12, muscleTargets: { Chest: 14, Back: 8 } });
  assert.deepEqual(pickSettings({ muscleTarget: 99 }), {});
  assert.equal(targetFor('Chest', { Chest: 14 }, 10), 14);
  assert.equal(targetFor('Back', { Chest: 14 }, 10), 10);
});

// ---------------- body map volume ----------------
const set = (weight, reps, type = 'working', done = true) => ({ weight, reps, type, done });
const S = (date, exercises) => ({ date, type: 'Push', exercises: exercises.map(([name, sets]) => ({ name, sets })) });
const GR = {
  bench: { primary: ['Chest'], secondary: ['Shoulders', 'Triceps'] },
  row: { primary: ['Back'], secondary: ['Biceps'] },
  squat: { primary: ['Quads'], secondary: ['Glutes'] },
};
const groupsOf = (name) => GR[name.toLowerCase()] ?? { primary: [], secondary: [] };
const TODAY = '2026-11-20'; // Friday; weeks start Monday the 16th

test('volume: primary 1, secondary 0.5, warm-ups and unticked sets excluded', () => {
  const sessions = [
    S('2026-11-16', [['Bench', [set(20, 10, 'warmup'), set(60, 8), set(60, 8), set(60, 7, 'failure'), set(60, 8, 'working', false)]]]),
    S('2026-11-18', [['Row', [set(50, 10), set(50, 10)]]]),
    S('2026-11-25', [['Bench', [set(60, 8)]]]), // future: not counted
  ];
  const v = setsByGroup(sessions, '2026-11-16', '2026-11-22', groupsOf, TODAY);
  assert.equal(v.Chest, 3); // 2 working + 1 failure; the warm-up and the unticked set don't count
  assert.equal(v.Shoulders, 1.5);
  assert.equal(v.Triceps, 1.5);
  assert.equal(v.Back, 2);
  assert.equal(v.Biceps, 1);
  assert.equal(v.Quads, 0);
});

test('volume windows: this week, and last 4 finished weeks averaged per week', () => {
  const sessions = [
    S('2026-11-16', [['Bench', [set(60, 8), set(60, 8)]]]), // this week
    S('2026-11-09', [['Bench', [set(60, 8), set(60, 8), set(60, 8), set(60, 8)]]]),
    S('2026-11-02', [['Bench', [set(60, 8), set(60, 8), set(60, 8), set(60, 8)]]]),
    S('2026-10-19', [['Bench', [set(60, 8), set(60, 8), set(60, 8), set(60, 8)]]]), // 4th week back
    S('2026-10-12', [['Bench', [set(60, 8)]]]), // 5th week back: outside
    S('2026-10-26', [['Squat', [set(100, 5)]]]),
  ];
  const week = weeklySets(sessions, { mode: 'week', today: TODAY, weekStartsOn: 1, groupsOf });
  assert.equal(week.perWeek.Chest, 2);
  assert.equal(week.from, '2026-11-16');
  const four = weeklySets(sessions, { mode: '4w', today: TODAY, weekStartsOn: 1, groupsOf });
  assert.deepEqual([four.from, four.to, four.weeks], ['2026-10-19', '2026-11-15', 4]);
  assert.equal(four.perWeek.Chest, 3); // (4 + 4 + 4) / 4; this week and the 5th week back are left out
  assert.equal(four.perWeek.Quads, 0.3); // 1 / 4 = 0.25, shown to one decimal
  assert.equal(four.perWeek.Glutes, 0.1); // 0.5 / 4 = 0.125
});

test('status, ramp level and the undertrained list (biggest gap first)', () => {
  assert.equal(statusFor(0, 10), 'none');
  assert.equal(statusFor(4.5, 10), 'under');
  assert.equal(statusFor(5, 10), 'below');
  assert.equal(statusFor(10, 10), 'met');
  assert.deepEqual([0, 2, 2.5, 5, 9.9, 10, 14].map((n) => rampLevel(n, 10)), [0, 1, 1, 2, 3, 4, 4]);
  const per = Object.fromEntries(GROUPS.map((g) => [g, 10]));
  Object.assign(per, { Chest: 4, Calves: 0, Neck: 1, Back: 6 });
  const list = undertrained(per, { Neck: 4 }, 10);
  assert.deepEqual(list.map((r) => [r.group, r.gap]), [['Calves', 10], ['Chest', 6], ['Neck', 3]]);
});

test('muscle sheet data: exercises that hit it, last trained, planned vs done', () => {
  const sessions = [
    S('2026-11-12', [['Row', [set(50, 10)]]]),
    S('2026-11-16', [['Bench', [set(60, 8), set(60, 8)]], ['Row', [set(50, 10, 'warmup')]]]),
  ];
  assert.deepEqual(exercisesForGroup(sessions, 'Shoulders', '2026-11-16', TODAY, groupsOf, TODAY), [{ name: 'Bench', sets: 1, role: 'secondary' }]);
  assert.equal(lastTrained(sessions, 'Back', groupsOf, TODAY), '2026-11-12'); // the 16th was only a warm-up
  assert.equal(lastTrained(sessions, 'Quads', groupsOf, TODAY), null);
  const planned = plannedByGroup({
    weekStart: '2026-11-16',
    getSession: (d) => sessions.find((s) => s.date === d) ?? null,
    plannedTypeFor: (d) => (d === '2026-11-18' ? 'Legs' : null),
    templateFor: (t) => (t === 'Legs' ? [{ name: 'Squat', sets: 4 }] : []),
    groupsOf,
  });
  assert.equal(planned.Chest, 2); // the day's own session (working sets, ticked or not)
  assert.equal(planned.Back, 0); // warm-ups aren't planned working sets
  assert.equal(planned.Quads, 4); // from the plan's template
  assert.equal(planned.Glutes, 2);
});

// ---------------- trend and stall ----------------
const H = (vals) => vals.map((e, i) => ({ date: `2026-11-${String(i + 1).padStart(2, '0')}`, best: { e1rm: e }, top: { reps: 8 } }));
test('trend over the last 4 sessions: up, flat, down; none before 4 sessions', () => {
  assert.equal(trendOf(H([100, 102, 104, 106])).dir, 'up');
  assert.equal(trendOf(H([100, 100.2, 99.9, 100.1])).dir, 'flat');
  assert.equal(trendOf(H([110, 106, 104, 100])).dir, 'down');
  assert.equal(trendOf(H([50, 100, 102, 104, 106])).dir, 'up'); // only the last 4 count
  assert.equal(trendOf(H([100, 104, 106])), null);
});

test('stalled: 4 or more sessions without a new best est. 1RM', () => {
  assert.deepEqual(stallOf(H([100, 105, 104, 103, 105, 102])), { since: 4, stalled: true, bestDate: '2026-11-02' });
  assert.equal(stallOf(H([100, 105, 104, 103, 106])).stalled, false);
  assert.equal(stallOf(H([100, 99, 98])).stalled, false);
  assert.equal(stallOf([]).stalled, false);
  // Works on real history entries too.
  const hist = exerciseHistory([S('2026-11-02', [['Bench', [set(60, 8)]]]), S('2026-11-09', [['Bench', [set(62.5, 8)]]])], 'bench', { today: TODAY });
  assert.equal(stallOf(hist).since, 0);
});

// ---------------- CSV round trip ----------------
test('CSV round trip keeps sessions, sets, rest days, skip reasons, custom exercises and muscle tags', () => {
  const sessions = [
    { date: '2026-11-16', type: 'Push', exercises: [{ name: 'Bench, wide', sets: [set(20, 10, 'warmup'), set(60, 8), set(null, null, 'working', false)] }, { name: 'Hip Thing', sets: [set(40, 12)] }] },
    { date: '2026-11-18', type: 'Break', exercises: [] },
  ];
  const catalog = [
    { name: 'Bench, wide', primary: ['Chest'], secondary: ['Triceps', 'Shoulders'], equipment: 'barbell', custom: false },
    { name: 'Hip Thing', primary: ['Glutes'], secondary: [], equipment: null, custom: true },
    { name: 'Never Logged', primary: ['Neck'], secondary: [], equipment: 'other', custom: true },
  ];
  const csv = sessionsToCSV(sessions, { '2026-11-19': 'Travel' }, catalog);
  const back = migrateBackup(csvToBackup(csv));
  assert.equal(back.sessions.length, 2);
  const push = back.sessions.find((s) => s.date === '2026-11-16');
  assert.deepEqual(push.exercises.map((e) => e.name), ['Bench, wide', 'Hip Thing']);
  assert.deepEqual(push.exercises[0].sets, [set(20, 10, 'warmup'), set(60, 8), set(null, null, 'working', false)]);
  assert.equal(back.sessions.find((s) => s.date === '2026-11-18').type, 'Break');
  assert.deepEqual(back.skipReasons, { '2026-11-19': 'Travel' });
  const byName = Object.fromEntries(back.exercises.map((r) => [r.name, r]));
  assert.deepEqual([byName['Hip Thing'].primary, byName['Hip Thing'].custom], [['Glutes'], true]);
  assert.deepEqual(byName['Bench, wide'].secondary, ['Triceps', 'Shoulders']);
  assert.equal(byName['Never Logged'].primary[0], 'Neck'); // custom exercises travel even without sets
});

test('CSV import accepts a 1.4–1.6 export (no muscle columns) and rejects other files', () => {
  const old = 'date,session type,exercise,set number,weight,reps,set type,done,record,skip reason\r\n2026-11-16,Push,Bench,1,60,8,working,yes,set,\r\n';
  const b = migrateBackup(csvToBackup(old));
  assert.equal(b.sessions[0].exercises[0].sets[0].weight, 60);
  assert.throws(() => csvToBackup('name,age\r\nBob,3\r\n'), /isn’t a workout export/);
  assert.deepEqual(parseCSV('a,"b ""q"", c"\r\n1,2\n'), [['a', 'b "q", c'], ['1', '2']]);
});
