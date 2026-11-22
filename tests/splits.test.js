// Saved splits (schema v10): save, apply, update, rename, duplicate, delete, the 10-split limit, migration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  snapshotSplit, applySavedSplit, addSplit, renameSplit, duplicateSplit, updateSplit, deleteSplit, normalizeSplits, MAX_SPLITS,
  typesInWeek, splitDaysText,
} from '../js/splits.js';
import { defaultTypes, addType, updateType, deleteType, BREAK } from '../js/types.js';
import { migrateBackup, SCHEMA_VERSION, normalizeTemplates } from '../js/model.js';

const B = BREAK;
const week = { sun: B, mon: 'Push', tue: 'Pull', wed: B, thu: 'Legs', fri: 'Push', sat: B };
const tpl = { Push: [{ name: 'Bench', sets: 4, repsMin: 5, repsMax: 8, weightStep: 2.5, restSeconds: 180 }], Pull: [{ name: 'Row', sets: 3, repsMin: 8, repsMax: 12, weightStep: null, restSeconds: null }], Legs: [], Upper: [{ name: 'X', sets: 1, repsMin: 1, repsMax: 1 }] };
const snap = (over = {}) => snapshotSplit({ name: 'My 4-day', week, types: defaultTypes(), templates: tpl, id: 's-1', now: 1, ...over });

test('saving snapshots the week, the types it uses and their templates', () => {
  const s = snap();
  assert.equal(s.name, 'My 4-day');
  assert.deepEqual(s.days, week);
  assert.deepEqual(s.types.map((t) => t.id), ['Push', 'Pull', 'Legs'], 'only the types the week uses, Monday first');
  assert.deepEqual(s.types[0], { id: 'Push', name: 'Push', short: 'Push', color: 'red', kind: 'lift' });
  assert.deepEqual(Object.keys(s.templates), ['Push', 'Pull', 'Legs']);
  assert.equal(s.templates.Push[0].restSeconds, 180, 'rest and step settings are kept');
  tpl.Push[0].sets = 9;
  assert.equal(s.templates.Push[0].sets, 4, 'a snapshot, not a reference');
  tpl.Push[0].sets = 4;
  assert.throws(() => snap({ name: '  ' }), /name/);
  assert.throws(() => snap({ week: { mon: B } }), /no training days/);
  assert.deepEqual(typesInWeek(week), ['Push', 'Pull', 'Legs']);
});

test('applying restores types and templates, sets the week, hides other lifting types', () => {
  const r = applySavedSplit(defaultTypes(), normalizeTemplates({}), snap());
  assert.deepEqual(r.week, week);
  assert.deepEqual(r.ids, ['Push', 'Pull', 'Legs']);
  assert.equal(r.templates.Push[0].name, 'Bench');
  assert.deepEqual(r.restored, [], 'nothing needed restoring');
  const byId = new Map(r.types.map((t) => [t.id, t]));
  assert.ok(['Upper', 'Lower', 'Full body'].every((id) => byId.get(id).hidden && !byId.get(id).archived), 'other lifting types hidden, not deleted');
  assert.equal(byId.get('Cardio').hidden, false, 'Cardio left alone');
  assert.deepEqual(r.hidden, ['Upper', 'Lower', 'Full body']);
  assert.deepEqual(r.types.slice(0, 3).map((t) => t.id), ['Push', 'Pull', 'Legs'], 'the split’s types first');
});

test('a type since edited, archived or deleted is restored from the snapshot, and reported', () => {
  let types = defaultTypes();
  ({ types } = addType(types, { name: 'Chest + Triceps' }));
  const ct = types.at(-1);
  const s = snapshotSplit({ name: 'Bro-ish', week: { ...week, wed: ct.id }, types, templates: { ...tpl, [ct.id]: [{ name: 'Dips', sets: 3, repsMin: 8, repsMax: 12 }] }, id: 's-2', now: 1 });
  let now = updateType(types, 'Push', { name: 'Chest day', color: 'pink' }); // edited
  now = deleteType(now, 'Pull', true).types; // archived (it has history)
  now = deleteType(now, ct.id, false).types; // deleted outright
  const r = applySavedSplit(now, {}, s);
  const why = Object.fromEntries(r.restored.map((x) => [x.id, x.why]));
  assert.deepEqual(why, { Push: 'edited', Pull: 'archived', [ct.id]: 'deleted' });
  assert.equal(r.restored.find((x) => x.id === 'Push').was, 'Chest day');
  const byId = new Map(r.types.map((t) => [t.id, t]));
  assert.deepEqual([byId.get('Push').name, byId.get('Push').color], ['Push', 'red'], 'name and colour back as saved');
  assert.equal(byId.get('Pull').archived, false);
  assert.equal(byId.get(ct.id).name, 'Chest + Triceps', 'recreated with the same id, so its history lines up');
  assert.equal(r.templates[ct.id][0].name, 'Dips');
});

test('rename, duplicate, update, delete', () => {
  let list = addSplit([], snap());
  list = renameSplit(list, 's-1', 'Strength 4', 2);
  assert.equal(list[0].name, 'Strength 4');
  list = duplicateSplit(list, 's-1', 3);
  assert.deepEqual(list.map((s) => s.name), ['Strength 4', 'Strength 4 (copy)']);
  assert.notEqual(list[1].id, 's-1');
  list = duplicateSplit(list, 's-1', 4);
  assert.equal(list[1].name, 'Strength 4 (copy 2)');
  const fresh = snapshotSplit({ name: 'ignored', week: { ...week, sat: 'Upper' }, types: defaultTypes(), templates: tpl, id: 'tmp', now: 5 });
  list = updateSplit(list, 's-1', fresh, 5);
  assert.equal(list[0].id, 's-1');
  assert.equal(list[0].name, 'Strength 4', 'updating keeps the name');
  assert.equal(list[0].days.sat, 'Upper', '…and takes the current week');
  assert.ok(list[0].types.some((t) => t.id === 'Upper'));
  list = deleteSplit(list, 's-1');
  assert.ok(!list.some((s) => s.id === 's-1'));
  assert.throws(() => renameSplit(list, list[0].id, list[1].name), /already/);
  assert.throws(() => addSplit(list, { ...snap(), id: 'x', name: list[0].name }), /already/);
});

test('at most 10 saved splits', () => {
  let list = [];
  for (let i = 0; i < MAX_SPLITS; i++) list = addSplit(list, snap({ id: `s-${i}`, name: `Split ${i}` }));
  assert.equal(list.length, 10);
  assert.throws(() => addSplit(list, snap({ id: 's-x', name: 'Eleven' })), /up to 10/);
  assert.throws(() => duplicateSplit(list, 's-0'), /up to 10/);
  assert.equal(normalizeSplits([...list, snap({ id: 's-y', name: 'Extra' })]).length, 10, 'an import never goes past 10');
});

test('v9 → v10: no saved splits yet; everything else kept; v10 backups carry them', () => {
  assert.equal(SCHEMA_VERSION, 10);
  const out = migrateBackup({ schemaVersion: 9, sessions: [{ v: 9, date: '2026-11-10', type: 'Push', exercises: [] }], body: [{ date: '2026-11-01', weight: 80 }] });
  assert.deepEqual(out.splits, []);
  assert.equal(out.sessions[0].v, 10);
  assert.equal(out.body[0].weight, 80);
  const v10 = migrateBackup({ schemaVersion: 10, sessions: [], splits: [snap(), { id: 'bad', name: '', days: {} }, { id: 's-z', name: 'Empty week', days: { mon: B }, types: [] }] });
  assert.deepEqual(v10.splits.map((s) => s.name), ['My 4-day'], 'invalid splits are dropped');
  assert.equal(v10.splits[0].templates.Push[0].name, 'Bench');
});

test('days text for the split list and onboarding', () => {
  const abbr = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  assert.equal(splitDaysText(snap(), abbr), 'Mon Push, Tue Pull, Thu Legs, Fri Push');
});

test('ids stay unique even when saved in the same millisecond', () => {
  const a = snapshotSplit({ name: 'A', week, types: defaultTypes(), templates: tpl, now: 7 });
  const b = snapshotSplit({ name: 'B', week, types: defaultTypes(), templates: tpl, now: 7 });
  assert.notEqual(a.id, b.id);
  let list = addSplit(addSplit([], a), b);
  list = duplicateSplit(duplicateSplit(list, a.id, 7), a.id, 7);
  assert.equal(new Set(list.map((s) => s.id)).size, list.length);
  assert.throws(() => addSplit(list, a), /already saved/);
});
