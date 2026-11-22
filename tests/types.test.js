// Schema v7: session types as data — migration, archive-not-delete, colours, presets, backups.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_TYPES, BUILTIN_IDS, defaultTypes, normalizeTypes, addType, updateType, deleteType, nextColor, autoShort,
  applyPreset, presetWeek, PRESETS, PALETTE_KEYS, MAX_COLOURED, setTypes, typeName, typeShort, typeColor, isTypeId,
  pickerTypes, withKnownTypes, BREAK,
} from '../js/types.js';
import { SESSION_COLORS, PALETTE } from '../js/theme.js';
import { SCHEMA_VERSION, migrateBackup, upgradeSessionRecord, normalizeSession, normalizeTemplates, normalizeSchedule } from '../js/model.js';
import { sessionsToCSV, csvToBackup } from '../js/csv.js';

const reset = () => setTypes(defaultTypes());

test('v7: the built-ins keep their old names as ids, so v6 data needs no rewrite', () => {
  reset();
  assert.ok(SCHEMA_VERSION >= 7);
  assert.deepEqual(BUILTIN_IDS, ['Push', 'Pull', 'Legs', 'Upper', 'Lower', 'Full body', 'Cardio', 'Other']);
  const v6 = { v: 6, date: '2026-11-10', type: 'Full body', notes: '', createdAt: 1, updatedAt: 1, exercises: [{ id: 'a', name: 'Squat', sets: [{ weight: 100, reps: 5, done: true, type: 'working' }] }] };
  const { session } = upgradeSessionRecord(v6);
  assert.equal(session.v, SCHEMA_VERSION);
  assert.equal(session.type, 'Full body', 'the type id is unchanged');
  assert.deepEqual(session.exercises[0].sets, v6.exercises[0].sets);
  const out = migrateBackup({ schemaVersion: 6, sessions: [v6], schedule: [{ from: '2026-11-01', days: { mon: 'Push', tue: 'Full body' } }] });
  assert.equal(out.sessionTypes, null, 'a v6 file has no type list: the built-ins apply');
  assert.equal(out.sessions[0].type, 'Full body');
  assert.equal(out.schedule[0].days.tue, 'Full body');
});

test('renaming or recolouring changes only the type record, never history', () => {
  let types = defaultTypes();
  const session = normalizeSession({ date: '2026-11-10', type: 'Push', exercises: [] });
  types = updateType(types, 'Push', { name: 'Chest day', color: 'pink' });
  setTypes(types);
  assert.equal(session.type, 'Push');
  assert.equal(typeName(session.type), 'Chest day');
  assert.equal(typeColor(session.type), 'pink');
  assert.equal(typeShort('Push'), 'Chest', 'an automatic short label follows the new name');
  const own = updateType(updateType(defaultTypes(), 'Push', { short: 'CHST' }), 'Push', { name: 'Chest power' });
  assert.equal(own.find((t) => t.id === 'Push').short, 'CHST', 'a short label you set yourself survives a rename');
  reset();
});

test('delete: a type with history is archived (name and colour kept); without history it is removed', () => {
  let types = defaultTypes();
  ({ types } = addType(types, { name: 'Chest + Triceps' }));
  const ct = types.at(-1);
  const archived = deleteType(types, ct.id, true);
  assert.equal(archived.archived, true);
  const kept = archived.types.find((t) => t.id === ct.id);
  assert.ok(kept && kept.archived && kept.hidden, 'still in the list, archived');
  assert.equal(kept.name, 'Chest + Triceps');
  assert.equal(kept.color, ct.color);
  setTypes(archived.types);
  assert.equal(typeName(ct.id), 'Chest + Triceps', 'past days still show its name');
  assert.equal(typeColor(ct.id), ct.color, 'and its colour');
  assert.equal(isTypeId(ct.id), true, 'logged days still validate');
  assert.ok(!pickerTypes().some((t) => t.id === ct.id), 'not offered any more');
  const removed = deleteType(types, ct.id, false);
  assert.equal(removed.archived, false);
  assert.ok(!removed.types.some((t) => t.id === ct.id));
  // A built-in can be archived too.
  assert.equal(deleteType(defaultTypes(), 'Push', true).types.find((t) => t.id === 'Push').archived, true);
  reset();
});

test('an archived type keeps working everywhere downstream', () => {
  let types = defaultTypes();
  ({ types } = addType(types, { name: 'Arms' }));
  const id = types.at(-1).id;
  setTypes(deleteType(types, id, true).types);
  assert.equal(normalizeSession({ date: '2026-11-10', type: id, exercises: [] }).type, id);
  assert.equal(normalizeSchedule([{ from: '2026-11-01', days: { mon: id } }]).at(0).days.mon, id);
  reset();
});

test('colours: next unused of 8 validated slots; beyond 8 a neutral tone', () => {
  assert.equal(PALETTE_KEYS.length, MAX_COLOURED);
  assert.equal(PALETTE.length, 8);
  for (const k of PALETTE_KEYS) assert.ok(SESSION_COLORS[k], k);
  let types = defaultTypes(); // 7 coloured built-ins
  assert.equal(nextColor(types), 'pink');
  ({ types } = addType(types, { name: 'Arms' }));
  assert.equal(types.at(-1).color, 'pink');
  ({ types } = addType(types, { name: 'Abs' }));
  assert.equal(types.at(-1).color, null, 'the 9th coloured type is neutral');
  assert.equal(typeColor('nope'), 'neutral');
  // Hiding a type frees its colour for the next one.
  types = updateType(types, 'Push', { hidden: true });
  assert.equal(nextColor(types), 'red');
});

test('short labels: name or initials, ≤ 6 characters', () => {
  assert.equal(autoShort('Legs'), 'Legs');
  assert.equal(autoShort('Chest + Triceps'), 'C+T');
  assert.equal(autoShort('Back + Biceps'), 'B+B');
  assert.equal(autoShort('Shoulders'), 'Shldr');
  assert.equal(autoShort('Upper body power day'), 'Upper');
  assert.equal(autoShort('Chest day'), 'Chest');
  assert.equal(autoShort('Strongman conditioning'), 'SC');
  assert.equal(autoShort('Full body'), 'Full');
  for (const t of BUILTIN_TYPES) assert.ok(t.short.length <= 6, t.id);
  assert.throws(() => addType(defaultTypes(), { name: 'push' }), /already/);
  assert.throws(() => addType(defaultTypes(), { name: '  ' }), /name/);
});

test('bro split: five coloured types, Mon–Fri, templates created, other lifting types hidden', () => {
  const r = applyPreset(defaultTypes(), normalizeTemplates(null), 'bro');
  assert.equal(r.ids.length, 5);
  const byId = new Map(r.types.map((t) => [t.id, t]));
  const names = r.ids.map((id) => byId.get(id).name);
  assert.deepEqual(names, ['Chest + Triceps', 'Back + Biceps', 'Legs', 'Shoulders', 'Arms']);
  assert.equal(r.ids[2], 'Legs', 'an existing type of the same name is reused (its history continues)');
  const colours = r.ids.map((id) => byId.get(id).color);
  assert.ok(colours.every(Boolean) && new Set(colours).size === 5, `five distinct colours: ${colours}`);
  assert.deepEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((k) => r.week[k]), [...r.ids, BREAK, BREAK]);
  for (const id of r.ids.filter((x) => x !== 'Legs')) assert.ok(r.templates[id].length >= 5, `${id} template`);
  assert.ok(['Push', 'Pull', 'Upper', 'Lower', 'Full body'].every((id) => byId.get(id).hidden), 'other lifting types hidden');
  assert.equal(byId.get('Cardio').hidden, false, 'Cardio is left alone');
  // Arnold next: reuses Legs, creates two more, still distinct colours among visible types.
  const a = applyPreset(r.types, r.templates, 'arnold');
  const visible = a.types.filter((t) => !t.hidden && !t.archived && t.color);
  assert.equal(new Set(visible.map((t) => t.color)).size, visible.length);
  assert.deepEqual(Object.values(a.week).filter((t) => t !== BREAK).length, 6);
  // Back to PPL: the built-ins come back with their own colours.
  const p = applyPreset(a.types, a.templates, 'ppl');
  assert.deepEqual(p.ids, ['Push', 'Pull', 'Legs']);
  assert.deepEqual(p.ids.map((id) => p.types.find((t) => t.id === id).color), ['red', 'blue', 'gold']);
  assert.deepEqual(Object.keys(PRESETS), ['ppl', 'ul', 'full', 'bro', 'arnold']);
});

test('presetWeek spreads sessions across the week', () => {
  assert.deepEqual(presetWeek(['A', 'B', 'C'], 3), { mon: 'A', tue: BREAK, wed: 'B', thu: BREAK, fri: 'C', sat: BREAK, sun: BREAK });
  assert.equal(Object.values(presetWeek(['A', 'B'], 6)).filter((x) => x !== BREAK).length, 6);
});

test('JSON backups carry custom types; their sessions, plan and templates survive import', () => {
  reset();
  let types = defaultTypes();
  ({ types } = addType(types, { name: 'Chest + Triceps' }));
  const id = types.at(-1).id;
  const out = migrateBackup({
    schemaVersion: 7, sessionTypes: types,
    sessions: [{ v: 7, date: '2026-11-10', type: id, exercises: [{ name: 'Dips', sets: [{ weight: 0, reps: 10, done: true, type: 'working' }] }] }],
    schedule: [{ from: '2026-11-01', days: { mon: id } }],
    templates: { [id]: [{ name: 'Dips', sets: 3, repsMin: 8, repsMax: 12 }] },
  });
  assert.equal(out.sessions[0].type, id, 'a type this device has never seen is kept from the file');
  assert.equal(out.schedule[0].days.mon, id);
  assert.equal(out.templates[id][0].name, 'Dips');
  assert.equal(out.sessionTypes.find((t) => t.id === id).name, 'Chest + Triceps');
  // Without the file's list, an unknown id can't be trusted.
  assert.equal(migrateBackup({ schemaVersion: 7, sessions: [{ date: '2026-11-10', type: 't-mystery', exercises: [] }] }).sessions[0].type, 'Other');
  assert.equal(isTypeId(id), false, 'reading a file does not register its types');
  assert.equal(withKnownTypes([id], () => isTypeId(id)), true);
  assert.deepEqual(normalizeTypes([{ id: 'x', name: 'X', color: 'chartreuse' }])[0].color, null);
});

test('CSV: types travel by name and come back to the same id; unknown names become types', () => {
  let types = defaultTypes();
  ({ types } = addType(types, { name: 'Back + Biceps' }));
  const id = types.at(-1).id;
  setTypes(types);
  const csv = sessionsToCSV([{ date: '2026-11-10', type: id, exercises: [{ name: 'Row', sets: [{ weight: 50, reps: 8, done: true, type: 'working' }] }] }]);
  assert.match(csv, /2026-11-10,Back \+ Biceps,Row/);
  const back = csvToBackup(csv);
  assert.equal(back.sessions[0].type, id);
  const fresh = csvToBackup('date,session type,exercise,set number,weight,reps\r\n2026-11-11,Glutes Day,Hip Thrust,1,80,10\r\n');
  const made = fresh.sessionTypes.find((t) => t.name === 'Glutes Day');
  assert.ok(made, 'an unknown type name becomes a type');
  assert.equal(fresh.sessions[0].type, made.id);
  assert.ok(fresh.sessionTypes.some((t) => t.id === id), 'your own types are kept in the list');
  assert.equal(migrateBackup(fresh).sessions[0].type, made.id);
  reset();
});

test('templates: every lifting type gets a list; a custom type keeps its own', () => {
  let types = defaultTypes();
  ({ types } = addType(types, { name: 'Arms' }));
  const id = types.at(-1).id;
  setTypes(types);
  const t = normalizeTemplates({ [id]: [{ name: 'Curl', sets: 3, repsMin: 10, repsMax: 12 }] });
  assert.equal(t[id][0].name, 'Curl');
  assert.ok(t.Push.length > 0, 'built-ins fall back to their defaults');
  assert.deepEqual(normalizeTemplates({})[id], [], 'a new lifting type starts empty');
  reset();
});

test('a preset replaces planned future days you did not edit; days you edited keep your choice', async () => {
  const { withWeekFrom, dayStatus } = await import('../js/plan.js');
  const { defaultSchedule } = await import('../js/model.js');
  reset();
  const today = '2026-11-20';
  let schedule = defaultSchedule('2026-11-01'); // Mon Push, Tue Pull, Wed Legs, Thu Break, Fri Upper, Sat Lower
  const edited = { date: '2026-12-01', type: 'Pull', exercises: [{ name: 'Row', sets: [{ weight: 60, reps: 8, done: false, type: 'working' }] }], notes: '' };
  const sessions = new Map([[edited.date, edited]]);
  const r = applyPreset(defaultTypes(), {}, 'bro');
  setTypes(r.types);
  schedule = withWeekFrom(schedule, today, r.week);
  const st = (d) => dayStatus(d, sessions.get(d) ?? null, schedule, today);
  const bb = r.types.find((t) => t.name === 'Back + Biceps').id;
  assert.equal(st('2026-11-24').type, bb, 'next Tuesday (never opened or edited) now follows the bro split');
  assert.equal(st('2026-11-24').state, 'planned');
  assert.equal(st('2026-11-28').state, 'break', 'Saturday: the old Lower day becomes a break');
  assert.equal(st('2026-12-01').type, 'Pull', 'a future day you edited keeps your choice');
  assert.equal(st('2026-12-01').sched, bb, '…and knows the plan changed under it');
  assert.equal(st('2026-11-16').type, 'Push', 'past days keep the plan they had');
  reset();
});
