// Short display names for long library names (library.js exName). Stored names never change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { indexLibrary, exName, setTakenNames, DISPLAY_NAMES, cleanDisplay } from '../js/library.js';
import { PRESET_TEMPLATES } from '../js/types.js';

const library = JSON.parse(readFileSync(new URL('../data/exercises.json', import.meta.url), 'utf8'));
indexLibrary(library);

test('curated short names are real library entries and unambiguous', () => {
  const names = new Set(library.map((e) => e.name));
  for (const full of Object.keys(DISPLAY_NAMES)) assert.ok(names.has(full), full);
  assert.equal(exName('Barbell Bench Press - Medium Grip'), 'Bench Press');
  assert.equal(exName('Dips - Triceps Version'), 'Triceps Dips');
  assert.equal(exName('Arnold Dumbbell Press'), 'Arnold Press');
  // No two library entries show the same short name.
  const seen = new Map();
  for (const e of library) {
    const d = exName(e.name).toLowerCase();
    assert.ok(!seen.has(d) || seen.get(d) === e.name, `${e.name} and ${seen.get(d)} would both show as “${exName(e.name)}”`);
    seen.set(d, e.name);
  }
});

test('generic clean-up: drop the " - variant", Dumbbell → DB; ambiguous ones keep the full name', () => {
  assert.equal(cleanDisplay('Bench Press - Powerlifting'), 'Bench Press');
  assert.equal(exName('Bench Press - Powerlifting'), 'Bench Press - Powerlifting', 'would clash with the curated Bench Press');
  assert.equal(exName('Dumbbell Flyes'), 'DB Flyes');
  assert.equal(exName('Hammer Curls'), 'Hammer Curls', 'short names stay as they are');
});

test('names you typed are never changed, and block a clashing short name', () => {
  assert.equal(exName('DB Chest Press'), 'DB Chest Press');
  assert.equal(exName('my weird lift'), 'my weird lift');
  setTakenNames(['Bench Press', 'Barbell Bench Press - Medium Grip']); // you log a custom "Bench Press" too
  assert.equal(exName('Barbell Bench Press - Medium Grip'), 'Barbell Bench Press - Medium Grip');
  setTakenNames([]);
  assert.equal(exName('Barbell Bench Press - Medium Grip'), 'Bench Press');
});

test('every preset template exercise shows a name of 24 characters or fewer', () => {
  for (const list of Object.values(PRESET_TEMPLATES)) {
    for (const x of list) assert.ok(exName(x.name).length <= 24, `${x.name} → ${exName(x.name)}`);
  }
});
