// First-run onboarding: five short screens (#/welcome/1 … #/welcome/5), one question each.
// Next saves that screen's answer straight away (so Back, Skip or closing the app never loses it);
// Skip moves on without saving the screen's changes. Nothing leaves the device.
import { h, icon, brandMark, plate } from '../ui.js';
import * as store from '../store.js';
import { APP_NAME } from '../brand.js';
import { BREAK, WEEKDAY_KEYS } from '../model.js';
import { PRESETS, presetWeek, typeColor, typeShort, typeName, allTypes, autoShort, BREAK as TYPE_BREAK } from '../types.js';
import { splitDaysText } from '../splits.js';
import { GOALS, EXPERIENCE, SPLITS, SESSION_CHOICES, SPLIT_SESSIONS, experienceSettings } from '../profile.js';
import { STEP_CHOICES, CM_PER_IN, parseShownW } from '../units.js';
import { todayISO, weekdayLabels } from '../dates.js';

export const STEPS = 5;

const savedSplit = (id) => (typeof id === 'string' && id.startsWith('my:') ? store.state.splits.find((s) => s.id === id.slice(3)) ?? null : null);

/** The days a split trains, in your week order: "Mon Push, Wed Pull, Fri Legs". */
export function splitDays(splitId, sessions, weekStartsOn = 1) {
  const mine = savedSplit(splitId);
  if (mine) return splitDaysText(mine, weekdayLabels(weekStartsOn).map((l) => l.abbr), weekStartsOn);
  const preset = PRESETS[splitId];
  if (!preset) return 'You plan the days in the Planner';
  const shortOf = (name) => allTypes().find((t) => !t.archived && t.name.toLowerCase() === name.toLowerCase())?.short ?? autoShort(name);
  const week = presetWeek(preset.types, sessions || preset.sessions);
  return weekdayLabels(weekStartsOn).map((l, i) => [l.abbr, week[WEEKDAY_KEYS[(weekStartsOn + i) % 7]]])
    .filter(([, t]) => t && t !== TYPE_BREAK).map(([d, t]) => `${d} ${shortOf(t)}`).join(', ');
}
const GOAL_ICON = { fat: 'flame', muscle: 'barbell', recomp: 'arrows-exchange', strength: 'trophy', consistency: 'calendar' };
const SPLIT_ICON = { ppl: 'list-details', ul: 'arrows-exchange', full: 'man', bro: 'barbell', arnold: 'trophy', custom: 'notes' };
const EXP_SUB = { new: 'Learning the lifts', mid: 'Training regularly', veteran: 'Progress comes slowly now' };

let draft = null; // answers in progress across the five screens

const freshDraft = () => ({ ...store.state.profile, bodyweight: '', waist: '' });
export const resetOnboardingDraft = () => { draft = null; };

/** Seconds → "1:30". */
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const stepLabel = (kg, units) => STEP_CHOICES[units].find((c) => Math.abs(c.kg - kg) < 1e-3)?.label ?? '';

/** A big radio tile: real <input type=radio> (keyboard + screen readers), styled as a card. */
export function tile({ name, value, label, sub, subId, checked, onpick, iconName, compact }) {
  return h('label', { class: `tile${compact ? ' compact' : ''}` },
    h('input', { type: 'radio', name, value, checked, onchange: () => onpick(value) }),
    iconName ? h('span', { class: 'tile-ic', 'aria-hidden': 'true' }, icon(iconName)) : null,
    h('span', { class: 'tile-text' }, h('span', { class: 'tile-label' }, label), sub ? h('span', { class: 'tile-sub', id: subId ?? null }, sub) : null));
}
export const fieldset = (legend, cls, ...tiles) => h('fieldset', { class: `ob-q ${cls}` }, h('legend', {}, legend), h('div', { class: 'tiles' }, tiles));

export function renderOnboarding(root, stepArg) {
  const step = Math.min(STEPS, Math.max(1, Number.parseInt(stepArg, 10) || 1));
  if (!draft) draft = freshDraft();
  document.body.classList.add('onboarding');
  const goTo = (n) => { location.hash = `#/welcome/${n}`; };
  const units = () => draft.units;
  const error = h('p', { class: 'ob-error', id: 'ob-error', role: 'alert', hidden: true });
  const showError = (msg, field) => {
    error.textContent = msg; error.hidden = false;
    field?.setAttribute('aria-invalid', 'true'); field?.setAttribute('aria-describedby', 'ob-error'); field?.focus();
  };

  // ---------- screens ----------
  let content;
  let save; // → patch to save on Next (or false to stay on the screen)
  if (step === 1) {
    const name = h('input', {
      id: 'ob-name', class: 'ob-input', type: 'text', value: draft.name, maxlength: '40', autocomplete: 'nickname',
      autocapitalize: 'words', enterkeyhint: 'next', placeholder: 'Your name or a nickname',
      oninput: (e) => { draft.name = e.target.value; },
    });
    content = [
      h('div', { class: 'ob-brand' }, brandMark(64), h('span', { class: 'wordmark' }, APP_NAME)),
      h('h1', { tabindex: '-1' }, 'Welcome'),
      h('p', { class: 'ob-lead' }, 'Five quick questions to set things up. Skip any of them.'),
      h('div', { class: 'ob-q' }, h('label', { for: 'ob-name', class: 'ob-label' }, 'What should we call you?'), name),
    ];
    save = () => ({ name: draft.name });
  } else if (step === 2) {
    const unitsQ = () => fieldset('Weights in', 'units',
      ['kg', 'lb'].map((u) => tile({ name: 'units', value: u, label: u === 'kg' ? 'Kilograms (kg)' : 'Pounds (lb)', checked: draft.units === u, compact: true, onpick: (v) => { draft.units = v; } })));
    const goalQ = () => fieldset('Your main goal', 'goal',
      Object.entries(GOALS).map(([id, label]) => tile({ name: 'goal', value: id, label, iconName: GOAL_ICON[id], checked: draft.goal === id, onpick: (v) => { draft.goal = v; } })));
    content = [h('h1', { tabindex: '-1' }, 'Units and goal'), unitsQ(), goalQ(),
      h('p', { class: 'ob-note' }, 'Your goal shapes the wording of hints and the weekly review.')];
    save = () => ({ units: draft.units, goal: draft.goal });
  } else if (step === 3) {
    content = [h('h1', { tabindex: '-1' }, 'How long have you been lifting?'),
      fieldset('Experience', 'experience sr-legend', Object.entries(EXPERIENCE).map(([id, label]) => {
        const s = experienceSettings(id, units());
        return tile({ name: 'experience', value: id, label, sub: `${EXP_SUB[id]}. ${stepLabel(s.weightStep, units())} steps, ${clock(s.defaultRestSeconds)} rest.`, checked: draft.experience === id, onpick: (v) => { draft.experience = v; } });
      })),
      h('p', { class: 'ob-note' }, 'Sets the default −/+ step, the jump in overload hints and the rest time. Change any of them later.')];
    save = () => ({ experience: draft.experience });
  } else if (step === 4) {
    let sessionsQ;
    const ws = store.state.settings.weekStartsOn;
    // Each split card lists its actual days; they follow the sessions-per-week choice (updated in place).
    const refreshDays = () => Object.keys(SPLITS).forEach((id) => { // saved splits have fixed days
      const el = document.getElementById(`split-days-${id}`);
      if (el) el.textContent = splitDays(id, draft.sessionsPerWeek, ws);
    });
    const drawSessions = () => sessionsQ.replaceWith(sessionsQ = sessionsField());
    const sessionsField = () => fieldset('Sessions per week', 'sessions',
      SESSION_CHOICES.map((n) => tile({ name: 'sessions', value: String(n), label: String(n), compact: true, checked: draft.sessionsPerWeek === n, onpick: (v) => { draft.sessionsPerWeek = Number(v); refreshDays(); } })));
    sessionsQ = sessionsField();
    content = [h('h1', { tabindex: '-1' }, 'How do you split your week?'),
      fieldset('Training split', 'split sr-legend', [...Object.entries(SPLITS).filter(([id]) => id !== 'custom'), ...store.state.splits.map((sp) => [`my:${sp.id}`, sp.name]), ['custom', SPLITS.custom]].map(([id, label]) => tile({
        name: 'split', value: id, label: id.startsWith('my:') ? `${label} (yours)` : label, iconName: SPLIT_ICON[id] ?? 'star',
        sub: splitDays(id, draft.sessionsPerWeek, ws), subId: `split-days-${id.replace(':', '-')}`,
        checked: draft.split === id,
        onpick: (v) => {
          const mine = savedSplit(v);
          if (mine) { draft.sessionsPerWeek = Object.values(mine.days).filter((t) => t && t !== TYPE_BREAK).length; drawSessions(); refreshDays(); }
          else if (!draft.sessionsPerWeek) { draft.sessionsPerWeek = SPLIT_SESSIONS[v]; drawSessions(); refreshDays(); }
          draft.split = v;
          // The next question sits below: bring it into view, clear of the Next button.
          sessionsQ.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        },
      }))),
      sessionsQ,
      h('p', { class: 'ob-note' }, 'Sessions per week is your “good week” on Consistency. You can change it there too.')];
    // A saved split is applied as saved (its own days); the profile records it as your own plan.
    save = () => (savedSplit(draft.split) ? { split: 'custom', sessionsPerWeek: draft.sessionsPerWeek, mySplit: draft.split.slice(3) }
      : { split: draft.split, sessionsPerWeek: draft.sessionsPerWeek });
  } else {
    const lb = units() === 'lb';
    const num = (id, key, unit, label) => h('span', { class: 'ob-num' },
      h('input', { id, class: 'ob-input num', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: draft[key], 'aria-label': label, oninput: (e) => { draft[key] = e.target.value; e.target.removeAttribute('aria-invalid'); error.hidden = true; } }),
      h('span', { class: 'unit', 'aria-hidden': 'true' }, unit));
    const field = (id, label, ...inputs) => h('div', { class: 'ob-field' }, h('label', { for: id, class: 'ob-label' }, label), h('div', { class: 'ob-nums' }, inputs));
    content = [h('h1', { tabindex: '-1' }, 'A starting point'),
      h('p', { class: 'ob-lead' }, 'All optional. Your bodyweight becomes the first entry in your Body log.'),
      field('ob-bw', 'Bodyweight', num('ob-bw', 'bodyweight', units(), `Bodyweight in ${units()}`)),
      field('ob-waist', 'Waist', num('ob-waist', 'waist', lb ? 'in' : 'cm', `Waist in ${lb ? 'inches' : 'centimetres'}`)),
      error,
      weekPreview()];
    save = () => {
      const kg = draft.bodyweight.trim() ? parseShownW(draft.bodyweight) : null;
      if (draft.bodyweight.trim() && (kg == null || kg < 20 || kg > 400)) {
        return showError(`Enter a bodyweight between ${lb ? '45 and 880 lb' : '20 and 400 kg'}, or leave it blank.`, document.getElementById('ob-bw')), false;
      }
      const waistRaw = draft.waist.trim() ? Number(draft.waist.replace(',', '.')) : null;
      const waistCm = waistRaw == null ? null : lb ? waistRaw * CM_PER_IN : waistRaw;
      if (waistRaw != null && (!Number.isFinite(waistRaw) || waistCm < 30 || waistCm > 300)) return showError(`Enter a waist between ${lb ? '12 and 118 in' : '30 and 300 cm'}, or leave it blank.`, document.getElementById('ob-waist')), false;
      if (waistCm != null && kg == null) return showError('Add your bodyweight to log your waist, or clear the waist.', document.getElementById('ob-bw')), false;
      return { body: kg == null ? null : { weight: kg, waist: waistCm == null ? null : Math.round(waistCm * 10) / 10 } };
    };
  }

  // ---------- finish ----------
  async function finish(answers) {
    if (answers?.body) await store.saveBodyEntry({ date: todayISO(), ...answers.body });
    await store.saveProfile({ onboarding: 'done' });
    const custom = draft.split === 'custom'; // a saved split is not "Custom": it already has its days
    draft = null;
    document.body.classList.remove('onboarding');
    location.replace(custom ? '#/plan' : '#/');
  }

  async function next(e) {
    e?.preventDefault();
    const patch = save();
    if (patch === false) return;
    if (step === STEPS) { await finish(patch); return; }
    const { mySplit, ...profilePatch } = patch;
    await store.saveProfile(profilePatch, { applySplit: !mySplit });
    if (mySplit) await store.useMySplit(mySplit);
    goTo(step + 1);
  }
  async function skip() {
    // This screen's changes are dropped: the draft goes back to what's saved.
    const saved = store.state.profile;
    if (step === 1) draft.name = saved.name;
    if (step === 2) { draft.units = saved.units; draft.goal = saved.goal; }
    if (step === 3) draft.experience = saved.experience;
    if (step === 4) { draft.split = saved.split; draft.sessionsPerWeek = saved.sessionsPerWeek; }
    if (step === STEPS) { await finish(null); return; }
    goTo(step + 1);
  }

  const dots = h('ol', { class: 'ob-dots', 'aria-label': `Step ${step} of ${STEPS}` },
    Array.from({ length: STEPS }, (_, i) => h('li', { class: i + 1 === step ? 'on' : i + 1 < step ? 'past' : '', 'aria-hidden': 'true' })));
  const top = h('div', { class: 'ob-top' },
    h('button', { type: 'button', class: 'btn subtle ob-back', disabled: step === 1, 'aria-label': step === 1 ? 'Back (this is the first step)' : `Back to step ${step - 1}`, onclick: () => goTo(step - 1) }, icon('chevL'), 'Back'),
    dots,
    h('button', { type: 'button', class: 'btn subtle ob-skip', onclick: skip, 'aria-label': step === STEPS ? 'Skip and start' : 'Skip this question' }, 'Skip'));

  const form = h('form', { class: 'ob-form', novalidate: true, onsubmit: next },
    h('div', { class: 'ob-body' }, content),
    h('div', { class: 'ob-actions' },
      h('button', { type: 'submit', class: 'btn primary block ob-next' }, step === STEPS ? 'Start' : 'Next', icon(step === STEPS ? 'check' : 'arrow-right'))));

  root.append(h('div', { class: 'view onboard-view', 'data-step': String(step) },
    top, form,
    h('p', { class: 'ob-private' }, icon('lock'), 'Stays on this phone. No account.')));
  return () => document.body.classList.remove('onboarding');
}

/** "Your week": this week's plan as it now stands (the split from step 4, or your own plan). */
function weekPreview() {
  // The weekly pattern from today on (the newest plan version), in your week order.
  const { weekStartsOn } = store.state.settings;
  const names = weekdayLabels(weekStartsOn);
  const plan = store.state.schedule.at(-1)?.days ?? {};
  const days = Array.from({ length: 7 }, (_, i) => plan[WEEKDAY_KEYS[(weekStartsOn + i) % 7]] ?? null);
  const training = days.filter((t) => t && t !== BREAK).length;
  return h('section', { class: 'ob-week', 'aria-labelledby': 'ob-week-h' },
    h('div', { class: 'section-head' }, h('h2', { id: 'ob-week-h' }, 'Your week'), h('span', { class: 'week-count' }, h('strong', { class: 'num' }, String(training)), ` session${training === 1 ? '' : 's'}`)),
    h('ol', { class: 'week-days' }, days.map((type, i) => {
      const slug = type ? typeColor(type) : 'none';
      const label = type ? typeShort(type) : '–';
      return h('li', {}, h('span', { class: `wd s-planned t-${slug}`, 'aria-label': `${names[i].long}: ${type === BREAK ? 'rest' : type ? typeName(type) : 'nothing planned'}` },
        h('span', { class: 'wd-name' }, names[i].short),
        type && type !== BREAK ? plate('planned', slug) : h('span', { class: 'plate p-none' }),
        h('span', { class: 'plate-label' }, label)));
    })),
    h('p', { class: 'fine' }, 'Change any day in the Planner.'));
}
