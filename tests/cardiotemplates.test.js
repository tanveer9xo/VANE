// Cardio in templates (schema v12): session types, Planner templates and saved splits can hold cardio items
// anywhere in the order, with a default time; a planned day opens with them pre-filled in that position.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardioItem, isCardioItem, addLegacyTreadmill, derive, normalizeCardio } from '../js/cardio.js';
import {
  normalizeTemplates, migrateBackup, SCHEMA_VERSION, DEFAULT_TEMPLATES, legacyTreadmill, newSession,
} from '../js/model.js';
import { exercisesFromTemplate, plannedExercise, templateItemFor, copySessionTo, isCompleted } from '../js/plan.js';
import { snapshotSplit, normalizeSplits, applySavedSplit } from '../js/splits.js';
import { plannedByGroup } from '../js/volume.js';
import { defaultTypes } from '../js/types.js';

const TODAY = '2026-11-28';
const lift = (name, sets = 3) => ({ name, sets, repsMin: 8, repsMax: 12, weightStep: null, restSeconds: null });

test('templates keep cardio items anywhere in the order; the default time stays empty unless set', () => {
  const t = normalizeTemplates({
    Push: [cardioItem('Treadmill', 10), lift('DB Chest Press'), { name: 'Rowing', kind: 'cardio', minutes: '' }, lift('Dips'), { name: 'Stairs', kind: 'cardio', minutes: 0 }],
    Legs: [lift('Squat'), { name: 'Cycling', kind: 'cardio', minutes: '12.5', sets: 4, repsMin: 5 }],
  });
  assert.deepEqual(t.Push.map((i) => [i.name, i.kind ?? 'lift', i.minutes ?? null]),
    [['Treadmill', 'cardio', 10], ['DB Chest Press', 'lift', null], ['Rowing', 'cardio', null], ['Dips', 'lift', null], ['Stairs', 'cardio', null]]);
  assert.deepEqual(t.Legs[1], { name: 'Cycling', kind: 'cardio', minutes: 12.5 }, 'only name, kind and minutes: no sets or reps');
  assert.equal(normalizeTemplates({ Push: [{ name: 'Treadmill', kind: 'cardio', minutes: 2000 }] }).Push[0].minutes, null, 'out of range → empty');
  // The Cardio day starts with Treadmill (Time to fill in) unless you change it; lifting defaults are unchanged.
  assert.deepEqual(normalizeTemplates(null).Cardio, [{ name: 'Treadmill', kind: 'cardio', minutes: null }]);
  assert.deepEqual(normalizeTemplates({ Cardio: [cardioItem('Rowing', 20), cardioItem('Stairs')] }).Cardio.map((i) => i.name), ['Rowing', 'Stairs']);
  assert.deepEqual(normalizeTemplates({ Cardio: [] }).Cardio, [], 'emptied on purpose stays empty');
  assert.deepEqual(normalizeTemplates(null).Push, normalizeTemplates(DEFAULT_TEMPLATES).Push);
  assert.equal(normalizeTemplates(null).Other, undefined, '"Other" types have no template');
});

test('a planned day opens with cardio in its template position, Time pre-filled, nothing done', () => {
  const templates = normalizeTemplates({ Push: [cardioItem('Treadmill', 10), lift('DB Chest Press', 2), cardioItem('Rowing')] });
  const ex = exercisesFromTemplate('Push', templates, [], '2026-11-30', TODAY);
  assert.deepEqual(ex.map((e) => [e.name, e.kind ?? 'lift']), [['Treadmill', 'cardio'], ['DB Chest Press', 'lift'], ['Rowing', 'cardio']]);
  assert.deepEqual(ex[0].sets, [], 'no sets, kg or reps');
  assert.deepEqual(ex[0].cardio, { ...normalizeCardio({}), minutes: 10 }, 'Time from the template; everything else empty');
  assert.equal(ex[0].cardio.done, false, 'not Done until you tap Done');
  assert.equal(ex[2].cardio.minutes, null, 'no default time: Time empty');
  assert.equal(ex[1].sets.length, 2);
  assert.ok(ex.every((e, i) => ex.findIndex((x) => x.id === e.id) === i), 'unique ids');
  const s = { ...newSession('2026-11-30', undefined, 'Push'), exercises: ex };
  assert.equal(isCompleted(s), false, 'a pre-filled Time alone doesn’t complete the day');
  // A cardio item never stands in for a lift of the same name.
  assert.equal(templateItemFor('Push', 'Treadmill', templates), null);
  assert.equal(plannedExercise('Treadmill', cardioItem('Treadmill', 5), [], '2026-11-30', TODAY).kind, 'cardio');
  // Copying a workout copies the cardio entry in place, with empty values.
  const done = { ...s, exercises: ex.map((e) => (e.kind === 'cardio' ? { ...e, cardio: { ...e.cardio, minutes: 30, distanceKm: 5, done: true } } : e)) };
  const copy = copySessionTo(done, '2026-12-07', [done], undefined, TODAY);
  assert.deepEqual(copy.exercises.map((e) => e.name), ['Treadmill', 'DB Chest Press', 'Rowing']);
  assert.deepEqual(copy.exercises[0].cardio, normalizeCardio({}));
});

test('weekly sets per muscle ignore cardio items in templates', () => {
  const templates = normalizeTemplates({ Push: [cardioItem('Treadmill', 20), lift('DB Chest Press', 4)] });
  const out = plannedByGroup({
    weekStart: '2026-11-30', getSession: () => null, plannedTypeFor: (d) => (d === '2026-11-30' ? 'Push' : null),
    templateFor: (t) => templates[t] ?? [], groupsOf: (n) => (n === 'DB Chest Press' ? { primary: ['Chest'], secondary: [] } : { primary: [], secondary: [] }),
  });
  assert.equal(out.Chest, 4);
});

test('saved splits keep cardio items, in order, and give them back when applied', () => {
  const types = defaultTypes();
  const templates = normalizeTemplates({ Push: [cardioItem('Treadmill', 10), lift('DB Chest Press')], Cardio: [cardioItem('Rowing', 25)] });
  const split = snapshotSplit({ name: 'PPL + cardio', week: { mon: 'Push', wed: 'Cardio', sun: 'Break' }, types, templates });
  const [stored] = normalizeSplits([JSON.parse(JSON.stringify(split))]);
  assert.deepEqual(stored.templates.Push, [{ name: 'Treadmill', kind: 'cardio', minutes: 10 }, lift('DB Chest Press')]);
  assert.deepEqual(stored.templates.Cardio, [{ name: 'Rowing', kind: 'cardio', minutes: 25 }]);
  const applied = applySavedSplit(types, normalizeTemplates(null), stored);
  assert.deepEqual(normalizeTemplates(applied.templates).Push.map((i) => i.name), ['Treadmill', 'DB Chest Press']);
});

test('backups: the old default treadmill minutes become template items; a v12 file round-trips cardio items', () => {
  // A 1.13 (v10) export: settings still carry the old 20-minute default.
  const v10 = migrateBackup({ schemaVersion: 10, settings: { weekStartsOn: 1, defaultCardioMinutes: 20 }, sessions: [], templates: { Push: [lift('Dips')] },
    splits: [{ id: 's-1', name: 'Mine', days: { mon: 'Push' }, types: [{ id: 'Push', name: 'Push', short: 'Push', color: 'red', kind: 'lift' }], templates: { Push: [lift('Dips')] } }] }, TODAY);
  assert.deepEqual(v10.templates.Push.map((i) => [i.name, i.minutes ?? null]), [['Dips', null], ['Treadmill', 20]]);
  assert.equal(v10.templates.Legs.at(-1).name, 'Treadmill', 'templates the file didn’t list (the defaults) too');
  assert.deepEqual(v10.templates.Cardio, [{ name: 'Treadmill', kind: 'cardio', minutes: 20 }]);
  assert.deepEqual(v10.splits[0].templates.Push.map((i) => i.name), ['Dips', 'Treadmill']);
  assert.equal('defaultCardioMinutes' in v10.settings, false);
  // Set to 0 (off) in the old app, or a 1.15 (v11) export without the setting: nothing added.
  for (const file of [{ schemaVersion: 10, settings: { defaultCardioMinutes: 0 } }, { schemaVersion: 11, settings: {} }]) {
    const out = migrateBackup({ ...file, sessions: [], templates: { Push: [lift('Dips')] } }, TODAY);
    assert.deepEqual(out.templates.Push.map((i) => i.name), ['Dips']);
  }
  // v12 → v12: cardio items exactly as exported.
  const templates = normalizeTemplates({ Push: [cardioItem('Treadmill', 10), lift('DB Chest Press'), cardioItem('Stairs')] });
  const back = migrateBackup(JSON.parse(JSON.stringify({ schemaVersion: SCHEMA_VERSION, sessions: [], templates })), TODAY);
  assert.deepEqual(back.templates.Push, templates.Push);
});

test('legacyTreadmill / addLegacyTreadmill: pure, adds once, keeps what is there', () => {
  const before = { Push: [lift('Dips')] };
  const copy = structuredClone(before);
  const r = legacyTreadmill({ templates: before, sessionTypes: null, splits: [], minutes: 20 });
  assert.deepEqual(before, copy, 'input untouched');
  assert.deepEqual(r.changedTypes, ['Push', 'Pull', 'Legs', 'Upper', 'Lower', 'Full body', 'Cardio']);
  const twice = addLegacyTreadmill(r.templates, ['Push'], 20);
  assert.deepEqual(twice.changed, [], 'Treadmill with a time already there: nothing added');
  assert.equal(legacyTreadmill({ templates: before, minutes: null }).minutes, null);
  assert.equal(legacyTreadmill({ templates: before, minutes: 'x' }).minutes, null);
  assert.ok(isCardioItem(r.templates.Push.at(-1)));
});

test('Time, Distance and Speed: any two give the third', () => {
  assert.deepEqual(derive({ minutes: 30, distanceKm: 5, speedKmh: null }), { distanceKm: 5, speedKmh: 10, calc: 'speed' });
  assert.deepEqual(derive({ minutes: 45, distanceKm: null, speedKmh: 8 }), { distanceKm: 6, speedKmh: 8, calc: 'distance' });
  assert.deepEqual(derive({ minutes: 20, distanceKm: null, speedKmh: 6.5 }), { distanceKm: 2.167, speedKmh: 6.5, calc: 'distance' });
  assert.deepEqual(derive({ minutes: 50, distanceKm: 7, speedKmh: null }), { distanceKm: 7, speedKmh: 8.4, calc: 'speed' });
  assert.deepEqual(derive({ minutes: null, distanceKm: 5, speedKmh: null }), { distanceKm: 5, speedKmh: null, calc: null }, 'no Time: nothing worked out');
  assert.deepEqual(derive({ minutes: 30, distanceKm: 5, speedKmh: 9 }), { distanceKm: 5, speedKmh: 9, calc: null }, 'all three typed: as typed');
});
