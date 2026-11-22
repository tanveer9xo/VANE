// Nutrition targets (schema v9): formula, goal adjustments, caps and floors, ranges, under-18 guard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bmr, targets, goalAdjustment, proteinPerKg, isMinor, youngestAge, normalizeNutrition, normalizeIntake, weightDrift, missingFor,
  ACTIVITY, DEFAULT_NUTRITION,
} from '../js/nutrition.js';
import { migrateBackup, SCHEMA_VERSION } from '../js/model.js';
import { GOALS, GOAL_HINT, reviewFocus } from '../js/profile.js';

const Y = 2026;
const base = { ...DEFAULT_NUTRITION, sex: 'male', birthYear: 1996, weightKg: 80, activity: 'moderate' };
const at = (n, goal, heightCm = 178) => targets(n, { goal, heightCm, thisYear: Y });

test('Mifflin-St Jeor: +5 male, −161 female, −78 prefer not to say', () => {
  assert.equal(bmr({ sex: 'male', kg: 80, cm: 178, age: 30 }), 1767.5); // 800 + 1112.5 − 150 + 5
  assert.equal(bmr({ sex: 'female', kg: 80, cm: 178, age: 30 }), 1601.5);
  assert.equal(bmr({ sex: 'unspecified', kg: 80, cm: 178, age: 30 }), 1684.5);
  assert.deepEqual(Object.values(ACTIVITY).map((a) => a.factor), [1.2, 1.375, 1.55, 1.725]);
});

test('goal adjustments, from maintenance 2,739.6 kcal (male, 80 kg, 178 cm, 30, moderate)', () => {
  assert.equal(at(base, 'strength').calories.target, 2740, 'Get stronger: maintenance');
  assert.equal(at(base, 'consistency').calories.target, 2740, 'Stay consistent: maintenance');
  assert.equal(at(base, null).calories.target, 2740, 'no goal: maintenance');
  assert.equal(at(base, 'fat').calories.target, 2190, 'Lose fat: −20 % by default');
  assert.equal(at({ ...base, lossPct: 10 }, 'fat').calories.target, 2470, 'Lose fat: −10 % if chosen');
  assert.deepEqual([at(base, 'fat').calories.lo, at(base, 'fat').calories.hi], [2050, 2470], 'Lose fat range: −25 % to −10 %');
  assert.equal(at(base, 'muscle').calories.target, 2950, 'Build muscle: +7.5 %');
  assert.deepEqual([at(base, 'muscle').calories.lo, at(base, 'muscle').calories.hi], [2880, 3010], 'Build muscle range: +5 to +10 %');
  assert.equal(at(base, 'recomp').calories.target, 2670, 'Recomp: about maintenance, −2.5 %');
  assert.deepEqual([at(base, 'recomp').calories.lo, at(base, 'recomp').calories.hi], [2600, 2740], 'Recomp range: −5 % to maintenance');
  assert.deepEqual(goalAdjustment('fat', 25), { lo: -0.25, hi: -0.1, target: -0.25 });
});

test('protein: 1.6–2.2 g/kg (default 1.8); Lose fat and Recomp 2.0–2.2', () => {
  assert.deepEqual(at(base, 'muscle').protein, { target: 145, lo: 130, hi: 175 }); // 144 → 145, 128 → 130, 176 → 175
  assert.deepEqual(at(base, 'fat').protein, { target: 160, lo: 160, hi: 175 });
  assert.deepEqual(proteinPerKg('recomp'), { lo: 2.0, hi: 2.2, target: 2.0 });
  assert.deepEqual(proteinPerKg('strength'), { lo: 1.6, hi: 2.2, target: 1.8 });
});

test('a loss is capped at about 1 % of bodyweight a week', () => {
  // 60 kg, 195 cm, 20, very active: maintenance 2,973.5; −25 % = 743 kcal/day, cap = 60 × 0.01 × 7,700 / 7 = 660.
  const tall = { ...base, weightKg: 60, birthYear: 2006, activity: 'very', lossPct: 25 };
  const t = at(tall, 'fat', 195);
  assert.equal(t.capped, true);
  assert.equal(t.calories.target, 2310, '2,973.5 − 660');
  assert.equal(at({ ...tall, lossPct: 10 }, 'fat', 195).capped, false);
});

test('no target goes below the floor', () => {
  // 45 kg, 150 cm, 60, sedentary: maintenance 1,111.8; −20 % would be 889.
  const small = { ...base, sex: 'female', weightKg: 45, birthYear: 1966, activity: 'sedentary' };
  const t = at(small, 'fat', 150);
  assert.equal(t.floored, true);
  assert.equal(t.calories.target, 1200, 'female floor');
  assert.equal(at({ ...small, sex: 'male' }, 'fat', 150).calories.target, 1500, 'male floor');
  assert.equal(at({ ...small, sex: 'unspecified' }, 'fat', 150).calories.target, 1350, 'prefer not to say: in between');
  assert.ok(at(small, 'fat', 150).calories.lo >= 1200, 'the range respects the floor too');
});

test('“Prefer not to say” uses the midpoint and shows a wider range', () => {
  const m = at(base, 'strength');
  const u = at({ ...base, sex: 'unspecified' }, 'strength');
  assert.equal(u.calories.target, 2610); // 1,684.5 × 1.55
  assert.deepEqual([u.calories.lo, u.calories.hi], [2480, 2740], 'spans the female and male formulas');
  assert.ok(u.calories.hi - u.calories.lo > m.calories.hi - m.calories.lo);
  assert.deepEqual(u.bmr, { lo: 1600, hi: 1770 });
});

test('under-18 guard: with only a birth year, assume the youngest possible age', () => {
  assert.equal(youngestAge(2008, Y), 17);
  assert.equal(isMinor(2008, Y), true, 'born 2008 may still be 17 in 2026');
  assert.equal(isMinor(2007, Y), false);
  assert.equal(isMinor(null, Y), false);
  assert.equal(at({ ...base, birthYear: 2008 }, 'fat'), null, 'no targets for under-18s');
  assert.equal(normalizeNutrition({ enabled: true, birthYear: 2010 }, Y).enabled, false, 'never switched on for under-18s');
  assert.equal(normalizeNutrition({ enabled: true, birthYear: 1990 }, Y).enabled, true);
});

test('everything is optional: missing answers are listed, no estimate until there', () => {
  assert.deepEqual(missingFor(DEFAULT_NUTRITION, null), ['birth year', 'height', 'current weight', 'activity level']);
  assert.equal(at({ ...base, activity: null }, 'fat'), null);
  assert.ok(at({ ...base, sex: null }, 'fat'), 'sex is optional (treated as prefer not to say)');
  const n = normalizeNutrition({ sex: 'robot', birthYear: 1800, weightKg: 5, activity: 'couch', lossPct: 33 }, Y);
  assert.deepEqual([n.sex, n.birthYear, n.weightKg, n.activity, n.lossPct], [null, null, null, null, 20]);
});

test('weight drift: prompt when the Body log moves more than 2 kg', () => {
  assert.equal(weightDrift(base, 82.5), 2.5);
  assert.equal(weightDrift(base, 78.1), null, '1.9 kg down: not yet');
  assert.equal(weightDrift(base, 81.9), null);
  assert.equal(weightDrift({ ...base, weightKg: null }, 90), null);
});

test('intake log: manual daily totals only', () => {
  assert.deepEqual(normalizeIntake({ '2026-11-20': { kcal: '2100', protein: 150 }, bad: { kcal: 1 }, '2026-11-21': { kcal: -5 } }), { '2026-11-20': { kcal: 2100, protein: 150 } });
});

test('v8 → v9: nutrition off and empty; everything else kept', () => {
  assert.ok(SCHEMA_VERSION >= 9);
  const out = migrateBackup({ schemaVersion: 8, sessions: [], body: [{ date: '2026-11-01', weight: 80 }], profile: { goal: 'fat' } });
  assert.deepEqual(out.nutrition, { ...DEFAULT_NUTRITION });
  assert.deepEqual(out.intake, {});
  assert.equal(out.body[0].weight, 80);
  const v9 = migrateBackup({ schemaVersion: 9, sessions: [], nutrition: { enabled: true, sex: 'female', birthYear: 1990, weightKg: 65, activity: 'light' }, intake: { '2026-11-20': { kcal: 1900, protein: 120 } } });
  assert.equal(v9.nutrition.activity, 'light');
  assert.equal(v9.intake['2026-11-20'].protein, 120);
});

test('Recomp is a goal, with its own hint wording and review judged on waist, strength and weight together', () => {
  assert.equal(GOALS.recomp, 'Recomp (lose fat, build muscle)');
  for (const k of ['increase', 'rep', 'repeat', 'drop']) assert.ok(GOAL_HINT.recomp[k], k);
  const r = { done: 3, planned: 4, volume: 1, prevVolume: 1, prs: 2, bodyChange: 0.3, waistChange: -0.8 };
  const f = reviewFocus('recomp', r, (kg) => `${kg} kg`, (cm) => `${cm} cm`);
  assert.deepEqual(f.order, ['waist', 'prs', 'bodyweight', 'sessions']);
  assert.match(f.headline, /waist down 0\.8 cm/);
  assert.match(f.headline, /2 new records/);
  assert.match(f.headline, /weight up 0\.3 kg/);
  assert.doesNotMatch(f.headline, /fail|bad|should/i);
});
