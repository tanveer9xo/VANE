// Profile (schema v6): the first-run answers and what each one changes. Pure functions, no storage.
//
//   { name, units: 'kg'|'lb', goal, experience, split, sessionsPerWeek, heightCm,
//     onboarding: 'pending' | 'done' | 'existing', setupCardDismissed, updatedAt }
//
// onboarding: 'pending'  = a new install; the first-run flow shows until it's finished or skipped through
//             'done'     = finished (answers may still be blank: every question can be skipped)
//             'existing' = data from before v6; no flow, a one-time "Set up your profile" card instead
// Nothing here is medical: no conditions, sex or birth date. Everything stays on the device.
import { BREAK, WEEKDAY_KEYS } from './model.js';
import { STEP_CHOICES, stepForUnits } from './units.js';

export const GOALS = { fat: 'Lose fat', muscle: 'Build muscle', strength: 'Get stronger', consistency: 'Stay consistent' };
export const EXPERIENCE = { new: 'New', mid: '1–3 years', veteran: '3+ years' };
export const SPLITS = { ppl: 'Push/Pull/Legs', ul: 'Upper/Lower', full: 'Full body', bro: 'Bro split', arnold: 'Arnold split', custom: 'Custom' };
export const SESSION_CHOICES = [2, 3, 4, 5, 6];
/** A sensible default number of sessions for each split (pre-selected on the split screen). */
export const SPLIT_SESSIONS = { ppl: 3, ul: 4, full: 3, bro: 5, arnold: 6, custom: 3 };

export const DEFAULT_PROFILE = {
  name: '', units: 'kg', goal: null, experience: null, split: null, sessionsPerWeek: null, heightCm: null,
  onboarding: 'pending', setupCardDismissed: false, updatedAt: 0,
};

const oneOf = (v, obj) => (Object.prototype.hasOwnProperty.call(obj, v) ? v : null);

export function normalizeProfile(raw) {
  const p = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const spw = Number(p.sessionsPerWeek);
  const height = Number(p.heightCm);
  return {
    name: typeof p.name === 'string' ? p.name.replace(/\s+/g, ' ').trim().slice(0, 40) : '',
    units: p.units === 'lb' ? 'lb' : 'kg',
    goal: oneOf(p.goal, GOALS),
    experience: oneOf(p.experience, EXPERIENCE),
    split: oneOf(p.split, SPLITS),
    sessionsPerWeek: Number.isInteger(spw) && spw >= 1 && spw <= 7 ? spw : null,
    heightCm: p.heightCm != null && Number.isFinite(height) && height >= 100 && height <= 250 ? Math.round(height * 10) / 10 : null,
    onboarding: ['pending', 'done', 'existing'].includes(p.onboarding) ? p.onboarding : 'done',
    setupCardDismissed: p.setupCardDismissed === true,
    updatedAt: Number.isFinite(p.updatedAt) ? p.updatedAt : 0,
  };
}

// ---------------------------------------------------------------------------
// Answer → setting
// ---------------------------------------------------------------------------

/**
 * Experience → the default −/+ step (and overload-hint jump) and the default rest between sets.
 *   New        2.5 kg / 5 lb, 90 s   steady jumps while everything still moves quickly
 *   1–3 years  2.5 kg / 5 lb, 120 s  same jumps, a little more rest for heavier work
 *   3+ years   1 kg / 2.5 lb, 150 s  small jumps: progress comes in small steps
 * Per-exercise steps and rests in the Planner still win.
 */
export const EXPERIENCE_SETTINGS = {
  new: { step: 1, rest: 90 }, // index into STEP_CHOICES[unit]: 0 = small, 1 = middle, 2 = big
  mid: { step: 1, rest: 120 },
  veteran: { step: 0, rest: 150 },
};
export function experienceSettings(experience, units = 'kg') {
  const e = EXPERIENCE_SETTINGS[experience];
  if (!e) return {};
  return { weightStep: STEP_CHOICES[units === 'lb' ? 'lb' : 'kg'][e.step].kg, defaultRestSeconds: e.rest };
}

/**
 * The settings that follow from a change of answers. `prev` is the profile before, `next` after.
 * Only answers that changed produce settings, so editing your name never resets your rest time.
 */
export function settingsForAnswers(prev, next, settings) {
  const patch = {};
  if (next.units !== prev.units) patch.weightStep = stepForUnits(settings.weightStep, next.units);
  if (next.experience && next.experience !== prev.experience) Object.assign(patch, experienceSettings(next.experience, next.units));
  if (next.sessionsPerWeek && next.sessionsPerWeek !== prev.sessionsPerWeek) patch.weeklyMin = next.sessionsPerWeek;
  return patch;
}

/** Which days train for n sessions a week (Mon = 0 … Sun = 6), spread out with rest between. */
const SPREAD = { 1: [0], 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 4, 5], 6: [0, 1, 2, 3, 4, 5], 7: [0, 1, 2, 3, 4, 5, 6] };
const SPLIT_TYPES = { ppl: ['Push', 'Pull', 'Legs'], ul: ['Upper', 'Lower'], full: ['Full body'] };
const MON_FIRST = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** A split and sessions per week → the Planner's week ({ mon: 'Push', …, sun: 'Break' }); null for Custom. */
export function splitWeek(split, sessions) {
  const types = SPLIT_TYPES[split];
  if (!types) return null;
  const n = Math.min(7, Math.max(1, sessions || SPLIT_SESSIONS[split]));
  const days = Object.fromEntries(WEEKDAY_KEYS.map((k) => [k, BREAK]));
  SPREAD[n].forEach((d, i) => { days[MON_FIRST[d]] = types[i % types.length]; });
  return days;
}

// ---------------------------------------------------------------------------
// Goal → wording
// ---------------------------------------------------------------------------

/** One short sentence after an overload hint, by goal and hint kind (increase | rep | repeat | drop). */
export const GOAL_HINT = {
  fat: {
    increase: 'Getting stronger while you lose fat is a great sign.',
    rep: 'Keeping your strength is the aim while you lose fat.',
    repeat: 'Holding this weight is a win while you lose fat.',
    drop: 'A lighter day is fine while you lose fat.',
  },
  muscle: {
    increase: 'You topped the rep range, so more weight keeps the muscle growing.',
    rep: 'More reps at this weight add the volume that builds muscle.',
    repeat: 'Build your reps into the range before adding weight.',
    drop: 'A little lighter gets you the reps that build muscle.',
  },
  strength: {
    increase: 'Every set hit the top: time to go heavier.',
    rep: 'One more rep now, more weight next time.',
    repeat: 'Own this weight before going heavier.',
    drop: 'Step back a little, then build up heavier.',
  },
  consistency: {
    increase: 'Showing up is paying off.',
    rep: 'Just beat last time by one rep.',
    repeat: 'Matching last time is a win.',
    drop: 'Lighter is fine. Showing up is what counts.',
  },
};
export const goalHint = (goal, kind) => GOAL_HINT[goal]?.[kind] ?? null;

/**
 * Weekly review by goal: which figure leads and a one-line summary.
 *   r: weeklyReview() output; w(kg) formats a weight with its unit.
 * Returns { order: ['sessions'|'volume'|'prs'|'bodyweight', …], headline: string | null }.
 */
export function reviewFocus(goal, r, w = (kg) => `${kg} kg`) {
  const base = ['sessions', 'volume', 'prs', 'bodyweight'];
  const lead = { fat: 'bodyweight', muscle: 'volume', strength: 'prs', consistency: 'sessions' }[goal];
  if (!lead) return { order: base, headline: null };
  const order = [lead, ...base.filter((k) => k !== lead)];
  const delta = r.prevVolume ? Math.round(((r.volume - r.prevVolume) / r.prevVolume) * 100) : null;
  let headline;
  if (goal === 'fat') {
    const bw = r.bodyChange;
    headline = bw == null ? 'Lose fat: weigh in a few times this week to see the trend.'
      : bw < 0 ? `Lose fat: your 7-day average is down ${w(Math.abs(bw))}. Keep lifting to hold on to muscle.`
        : bw > 0 ? `Lose fat: your 7-day average is up ${w(bw)}. One week is noise; watch the trend.`
          : 'Lose fat: your 7-day average held steady.';
  } else if (goal === 'muscle') {
    headline = delta == null ? 'Build muscle: volume is the number to grow week to week.'
      : delta >= 0 ? `Build muscle: volume is up ${delta}% on the week before.`
        : `Build muscle: volume is down ${Math.abs(delta)}% on the week before.`;
  } else if (goal === 'strength') {
    headline = r.prs ? `Get stronger: ${r.prs} new record${r.prs === 1 ? '' : 's'} this week.`
      : 'Get stronger: no new records yet. Heavier sets will show here.';
  } else {
    headline = r.planned ? `Stay consistent: ${r.done} of ${r.planned} planned sessions done.`
      : 'Stay consistent: nothing planned this week.';
  }
  return { order, headline };
}

// ---------------------------------------------------------------------------
// Schema v5 → v6
// ---------------------------------------------------------------------------

/**
 * Template steps that only repeated the global default (2.5 kg, the old built-in value) become null, meaning
 * "use the default", so the experience answer can set it. Same numbers today; steps you chose stay.
 */
export function templatesFollowDefaultStep(templates, globalStep = 2.5) {
  if (!templates || typeof templates !== 'object') return templates;
  return Object.fromEntries(Object.entries(templates).map(([type, list]) => [type,
    Array.isArray(list) ? list.map((it) => (it && typeof it === 'object' && Number(it.weightStep) === globalStep ? { ...it, weightStep: null } : it)) : list]));
}

/** The profile for data that has none: logged workouts → no flow, a card instead; nothing logged → the flow. */
export function profileForExisting(hasWorkouts) {
  return { ...DEFAULT_PROFILE, onboarding: hasWorkouts ? 'existing' : 'pending' };
}
