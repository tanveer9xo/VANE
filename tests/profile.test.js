// Schema v6: the profile, the v5 → v6 migration, and what each first-run answer changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PROFILE, normalizeProfile, experienceSettings, settingsForAnswers, splitWeek, goalHint, GOAL_HINT,
  reviewFocus, templatesFollowDefaultStep, profileForExisting, GOALS, EXPERIENCE, SPLITS,
} from '../js/profile.js';
import {
  SCHEMA_VERSION, DEFAULT_SETTINGS, DEFAULT_TEMPLATES, migrateBackup, upgradeSessionRecord, normalizeTemplates, pickSettings,
} from '../js/model.js';
import {
  setUnits, fmtW, fmtWU, parseShownW, toShownW, fromShownW, stepForUnits, STEP_CHOICES, shownVolume, fmtLU, parseShownL,
} from '../js/units.js';
import { suggest } from '../js/progression.js';
import { formatSet } from '../js/stats.js';

const lb = (n) => Math.round(n * 0.45359237 * 10000) / 10000;

test('v5 sessions upgrade unchanged apart from the version', () => {
  assert.equal(SCHEMA_VERSION, 7);
  const v5 = { v: 5, date: '2026-11-10', type: 'Push', notes: 'n', cardioMinutes: null, createdAt: 1, updatedAt: 2, startedAt: null, finishedAt: null,
    exercises: [{ id: 'a', name: 'Squat', target: null, weightStep: 2.5, restSeconds: null, hintDismissed: false, note: '', sets: [{ weight: 61.2349, reps: 5, done: true, type: 'working' }] }] };
  const { session, changed } = upgradeSessionRecord(v5);
  assert.equal(changed, true);
  assert.equal(session.v, 7);
  assert.equal(session.exercises[0].weightStep, 2.5, 'logged history is never rewritten');
  assert.equal(session.exercises[0].sets[0].weight, 61.2349, 'stored weights keep 4 dp (pounds read back exactly)');
});

test('v5 backup → v6: profile null, default template steps follow the setting, chosen steps stay', () => {
  const out = migrateBackup({
    schemaVersion: 5, sessions: [{ v: 5, date: '2026-11-10', type: 'Push', exercises: [{ name: 'Bench', sets: [{ weight: 60, reps: 5 }] }] }],
    settings: { weightStep: 2.5 },
    templates: { Push: [{ name: 'Bench', sets: 3, repsMin: 5, repsMax: 8, weightStep: 2.5 }, { name: 'Fly', sets: 3, repsMin: 10, repsMax: 12, weightStep: 1 }] },
  });
  assert.equal(out.profile, null);
  assert.equal(out.sessions[0].v, 7);
  assert.equal(out.templates.Push[0].weightStep, null);
  assert.equal(out.templates.Push[1].weightStep, 1);
  // A global step of 5: only template steps equal to it follow the default.
  const five = migrateBackup({ schemaVersion: 5, sessions: [], settings: { weightStep: 5 }, templates: { Push: [{ name: 'A', weightStep: 2.5 }, { name: 'B', weightStep: 5 }] } });
  assert.deepEqual(five.templates.Push.map((t) => t.weightStep), [2.5, null]);
});

test('v6 backups carry the profile; junk answers are dropped', () => {
  const out = migrateBackup({ schemaVersion: 6, sessions: [], profile: { name: '  Sam  ', units: 'lb', goal: 'strength', experience: 'veteran', split: 'ul', sessionsPerWeek: 4, heightCm: 178, sex: 'x', birthDate: '1990-01-01', onboarding: 'done' } });
  assert.deepEqual(out.profile, { name: 'Sam', units: 'lb', goal: 'strength', experience: 'veteran', split: 'ul', sessionsPerWeek: 4, heightCm: 178, onboarding: 'done', setupCardDismissed: false, updatedAt: 0 });
  assert.equal('sex' in out.profile || 'birthDate' in out.profile, false, 'nothing medical or identifying is kept');
  const junk = normalizeProfile({ units: 'stone', goal: 'fly', experience: 99, split: 'starfish', sessionsPerWeek: 12, heightCm: 20 });
  assert.equal(junk.units, 'kg');
  assert.equal(junk.goal, null);
  assert.equal(junk.experience, null);
  assert.equal(junk.split, null);
  assert.equal(junk.sessionsPerWeek, null);
  assert.equal(junk.heightCm, null);
});

test('stored data without a profile: workouts → no first-run flow (a card instead); nothing logged → the flow', () => {
  assert.equal(profileForExisting(true).onboarding, 'existing');
  assert.equal(profileForExisting(false).onboarding, 'pending');
  assert.equal(DEFAULT_PROFILE.onboarding, 'pending');
  assert.equal(DEFAULT_PROFILE.units, 'kg');
});

test('templates: a missing step follows the default; the built-ins all do', () => {
  assert.ok(DEFAULT_TEMPLATES.Push.every((t) => t.weightStep === null));
  assert.equal(normalizeTemplates({ Push: [{ name: 'X' }] }).Push[0].weightStep, null);
  assert.equal(normalizeTemplates({ Push: [{ name: 'X', weightStep: 1 }] }).Push[0].weightStep, 1);
  assert.deepEqual(templatesFollowDefaultStep({ Push: [{ name: 'X', weightStep: 2.5 }] }, 2.5), { Push: [{ name: 'X', weightStep: null }] });
});

test('experience → step and rest, in either unit', () => {
  assert.deepEqual(experienceSettings('new', 'kg'), { weightStep: 2.5, defaultRestSeconds: 90 });
  assert.deepEqual(experienceSettings('mid', 'kg'), { weightStep: 2.5, defaultRestSeconds: 120 });
  assert.deepEqual(experienceSettings('veteran', 'kg'), { weightStep: 1, defaultRestSeconds: 150 });
  assert.deepEqual(experienceSettings('new', 'lb'), { weightStep: lb(5), defaultRestSeconds: 90 });
  assert.deepEqual(experienceSettings('veteran', 'lb'), { weightStep: lb(2.5), defaultRestSeconds: 150 });
  assert.deepEqual(experienceSettings(null), {});
  // The lb steps are valid settings (and survive a backup).
  for (const c of STEP_CHOICES.lb) assert.equal(pickSettings({ weightStep: c.kg }).weightStep, c.kg);
});

test('answers → settings: only changed answers apply; sessions per week sets the good-week minimum', () => {
  const s = { ...DEFAULT_SETTINGS };
  const p0 = { ...DEFAULT_PROFILE };
  assert.deepEqual(settingsForAnswers(p0, { ...p0, name: 'Sam', goal: 'muscle' }, s), {}, 'name and goal change wording, not settings');
  assert.deepEqual(settingsForAnswers(p0, { ...p0, experience: 'veteran' }, s), { weightStep: 1, defaultRestSeconds: 150 });
  assert.deepEqual(settingsForAnswers(p0, { ...p0, sessionsPerWeek: 4 }, s), { weeklyMin: 4 });
  assert.deepEqual(settingsForAnswers(p0, { ...p0, units: 'lb' }, s), { weightStep: lb(5) }, '2.5 kg ↔ 5 lb');
  assert.deepEqual(settingsForAnswers({ ...p0, units: 'lb' }, p0, { ...s, weightStep: lb(10) }), { weightStep: 5 }, '10 lb ↔ 5 kg');
  // Unit and experience together: experience wins, in the new unit.
  assert.deepEqual(settingsForAnswers(p0, { ...p0, units: 'lb', experience: 'mid' }, s), { weightStep: lb(5), defaultRestSeconds: 120 });
  // Same experience again: no reset of a rest time you changed since.
  assert.deepEqual(settingsForAnswers({ ...p0, experience: 'mid' }, { ...p0, experience: 'mid' }, { ...s, defaultRestSeconds: 75 }), {});
});

test('split + sessions → the weekly plan (Custom keeps yours)', () => {
  assert.deepEqual(splitWeek('ppl', 3), { sun: 'Break', mon: 'Push', tue: 'Break', wed: 'Pull', thu: 'Break', fri: 'Legs', sat: 'Break' });
  assert.deepEqual(splitWeek('ppl', 6), { sun: 'Break', mon: 'Push', tue: 'Pull', wed: 'Legs', thu: 'Push', fri: 'Pull', sat: 'Legs' });
  assert.deepEqual(splitWeek('ul', 4), { sun: 'Break', mon: 'Upper', tue: 'Lower', wed: 'Break', thu: 'Upper', fri: 'Lower', sat: 'Break' });
  assert.deepEqual(splitWeek('full', 2), { sun: 'Break', mon: 'Full body', tue: 'Break', wed: 'Break', thu: 'Full body', fri: 'Break', sat: 'Break' });
  assert.equal(Object.values(splitWeek('ul', null)).filter((t) => t !== 'Break').length, 4, 'no number → the split’s default');
  assert.equal(splitWeek('custom', 4), null);
  for (const split of ['ppl', 'ul', 'full']) for (let n = 1; n <= 7; n++) {
    assert.equal(Object.values(splitWeek(split, n)).filter((t) => t !== 'Break').length, n, `${split} × ${n}`);
  }
});

test('units: shown in lb, stored in kg, exact round trip', () => {
  try {
    setUnits('lb');
    const kg = parseShownW('135');
    assert.equal(kg, lb(135));
    assert.equal(fmtW(kg), '135');
    assert.equal(fmtWU(100), '220.46 lb');
    assert.equal(fmtW(fromShownW(toShownW(32.5))), '71.65');
    assert.equal(formatSet({ weight: lb(185), reps: 5 }), '185×5');
    assert.equal(shownVolume(1000), 2205);
    assert.equal(fmtLU(81.28), '32 in');
    assert.equal(parseShownL('32'), 81.28);
    assert.equal(parseShownW('abc'), null);
    assert.equal(parseShownW('0'), 0, 'bodyweight stays 0');
    // Overload hint in lb: +5 lb from 135 × 10 → 140.
    const hint = suggest([{ weight: lb(135), reps: 10 }, { weight: lb(135), reps: 10 }], { repsMin: 8, repsMax: 10 }, lb(5), { fmt: (k) => fmtW(k), unit: 'lb' });
    assert.equal(hint.text, 'Try +5 lb: 140 × 8');
    assert.equal(fmtW(hint.weight), '140');
  } finally {
    setUnits('kg');
  }
  assert.equal(fmtWU(100), '100 kg');
  assert.equal(stepForUnits(2.5, 'lb'), lb(5));
  assert.equal(stepForUnits(lb(2.5), 'kg'), 1);
  assert.equal(stepForUnits(3, 'kg'), 2.5, 'an unknown step falls back to the middle choice');
});

test('goal → hint wording: a sentence per goal and hint kind; no goal = unchanged', () => {
  for (const goal of Object.keys(GOALS)) for (const kind of ['increase', 'rep', 'repeat', 'drop']) assert.ok(goalHint(goal, kind), `${goal}/${kind}`);
  assert.equal(goalHint(null, 'increase'), null);
  const last = [{ weight: 30, reps: 12 }, { weight: 30, reps: 12 }];
  const plain = suggest(last, { repsMin: 8, repsMax: 12 }, 2.5);
  assert.equal(plain.reason, 'Last time: 12, 12 reps.');
  const strong = suggest(last, { repsMin: 8, repsMax: 12 }, 2.5, { goalNote: (k) => goalHint('strength', k) });
  assert.equal(strong.text, 'Try +2.5 kg: 32.5 × 8');
  assert.equal(strong.reason, `Last time: 12, 12 reps. ${GOAL_HINT.strength.increase}`);
  const fat = suggest(last, { repsMin: 8, repsMax: 12 }, 2.5, { goalNote: (k) => goalHint('fat', k) });
  assert.notEqual(fat.reason, strong.reason);
});

test('goal → weekly review: the lead figure and headline', () => {
  const r = { done: 3, planned: 4, volume: 11000, prevVolume: 10000, prs: 2, bodyChange: -0.4 };
  assert.deepEqual(reviewFocus(null, r), { order: ['sessions', 'volume', 'prs', 'bodyweight'], headline: null });
  assert.equal(reviewFocus('fat', r).order[0], 'bodyweight');
  assert.equal(reviewFocus('fat', r, (kg) => `${kg} kg`).headline, 'Lose fat: your 7-day average is down 0.4 kg. Keep lifting to hold on to muscle.');
  assert.equal(reviewFocus('muscle', r).order[0], 'volume');
  assert.equal(reviewFocus('muscle', r).headline, 'Build muscle: volume is up 10% on the week before.');
  assert.equal(reviewFocus('strength', r).order[0], 'prs');
  assert.equal(reviewFocus('strength', r).headline, 'Get stronger: 2 new records this week.');
  assert.equal(reviewFocus('consistency', r).headline, 'Stay consistent: 3 of 4 planned sessions done.');
  assert.equal(new Set(reviewFocus('fat', r).order).size, 4, 'every figure still shows');
});

test('labels for every answer', () => {
  assert.deepEqual(Object.values(GOALS), ['Lose fat', 'Build muscle', 'Get stronger', 'Stay consistent']);
  assert.deepEqual(Object.values(EXPERIENCE), ['New', '1–3 years', '3+ years']);
  assert.deepEqual(Object.values(SPLITS), ['Push/Pull/Legs', 'Upper/Lower', 'Full body', 'Bro split', 'Arnold split', 'Custom']);
});
