// Settings → Profile (#/settings/profile): edit every first-run answer. Saved as you change it.
// Changes apply from now on; logged workouts and body entries are never rewritten (data stays in kg/cm).
import { h, icon } from '../ui.js';
import * as store from '../store.js';
import { GOALS, EXPERIENCE, SPLITS, SESSION_CHOICES, SPLIT_SESSIONS } from '../profile.js';
import { STEP_CHOICES } from '../units.js';
import { tile, fieldset } from './onboarding.js';

const GOAL_ICON = { fat: 'flame', muscle: 'barbell', strength: 'trophy', consistency: 'calendar' };
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function renderProfile(root) {
  const view = h('div', { class: 'view profile-view' });
  root.append(view);
  const status = h('p', { class: 'save-line', role: 'status', 'aria-live': 'polite' });

  async function save(patch, message = 'Saved. Applies from now on.') {
    const changed = await store.saveProfile(patch);
    if (patch.onboarding === undefined && store.state.profile.onboarding === 'existing') {
      await store.saveProfile({ setupCardDismissed: true }); // set up: the calendar card has done its job
    }
    const bits = [];
    if (changed.defaultRestSeconds) bits.push(`rest ${clock(changed.defaultRestSeconds)}`);
    if (changed.weightStep) bits.push(`${STEP_CHOICES[store.state.profile.units].find((c) => Math.abs(c.kg - changed.weightStep) < 1e-3)?.label} steps`);
    if (changed.weeklyMin) bits.push(`good week = ${changed.weeklyMin} sessions`);
    draw(`${message}${bits.length ? ` Now: ${bits.join(', ')}.` : ''}`);
  }

  /** Rebuild in place, keeping keyboard focus on the same control. */
  function draw(msg = '') {
    const a = document.activeElement;
    const focusSel = a && view.contains(a) ? (a.name && a.type === 'radio' ? `input[name="${a.name}"][value="${a.value}"]` : a.id ? `#${a.id}` : null) : null;
    const p = store.state.profile;
    const s = store.state.settings;

    const name = h('input', {
      id: 'pf-name', class: 'ob-input', type: 'text', value: p.name, maxlength: '40', autocomplete: 'nickname', placeholder: 'Your name or a nickname',
      onchange: (e) => save({ name: e.target.value }),
    });
    const stepNow = STEP_CHOICES[p.units].find((c) => Math.abs(c.kg - s.weightStep) < 1e-3)?.label ?? `${s.weightStep} kg`;

    view.replaceChildren(
      h('header', { class: 'topbar' },
        h('a', { class: 'icon-btn', href: '#/settings', 'aria-label': 'Back to Settings' }, icon('chevL')),
        h('div', { class: 'topbar-title' }, h('h1', { tabindex: '-1' }, 'Profile'))),
      h('p', { class: 'fine' }, icon('lock'), ' Stays on this phone. Changes apply from now on; past workouts and logs are never rewritten.'),
      status,
      h('section', { class: 'card', 'aria-labelledby': 'pf-name-h' },
        h('h2', { id: 'pf-name-h' }, h('label', { for: 'pf-name' }, 'Name')), name),
      h('section', { class: 'card' },
        fieldset('Units', 'units', ['kg', 'lb'].map((u) => tile({ name: 'units', value: u, label: u === 'kg' ? 'Kilograms (kg)' : 'Pounds (lb)', compact: true, checked: p.units === u, onpick: (v) => save({ units: v }) }))),
        h('p', { class: 'fine' }, 'Weights and lengths everywhere use this. Your data is kept in kg and cm, so switching back and forth loses nothing.')),
      h('section', { class: 'card' },
        fieldset('Goal', 'goal', Object.entries(GOALS).map(([id, label]) => tile({ name: 'goal', value: id, label, iconName: GOAL_ICON[id], checked: p.goal === id, onpick: (v) => save({ goal: v }) }))),
        h('p', { class: 'fine' }, 'Changes the wording of overload hints and which figure leads the weekly review.')),
      h('section', { class: 'card' },
        fieldset('Experience', 'experience', Object.entries(EXPERIENCE).map(([id, label]) => tile({ name: 'experience', value: id, label, compact: true, checked: p.experience === id, onpick: (v) => save({ experience: v }) }))),
        h('p', { class: 'fine' }, `Sets the default −/+ step and rest time. Now: ${stepNow} steps, ${clock(s.defaultRestSeconds)} rest (also in Settings → Preferences).`)),
      h('section', { class: 'card' },
        fieldset('Training split', 'split', Object.entries(SPLITS).map(([id, label]) => tile({
          name: 'split', value: id, label, compact: true, checked: p.split === id,
          onpick: (v) => save({ split: v, sessionsPerWeek: p.sessionsPerWeek ?? SPLIT_SESSIONS[v] }, v === 'custom' ? 'Saved. Your weekly plan is unchanged.' : 'Saved. Your weekly plan is filled from today.'),
        }))),
        fieldset('Sessions per week', 'sessions', SESSION_CHOICES.map((n) => tile({ name: 'sessions', value: String(n), label: String(n), compact: true, checked: p.sessionsPerWeek === n, onpick: (v) => save({ sessionsPerWeek: Number(v) }) }))),
        h('p', { class: 'fine' }, 'Picking a split or a number of sessions fills your weekly plan from today (Custom keeps your own). Sessions per week is also your good-week minimum on Consistency. ',
          h('a', { class: 'link', href: '#/plan' }, 'Open the Planner'))),
      h('section', { class: 'card', 'aria-labelledby': 'pf-body-h' },
        h('h2', { id: 'pf-body-h' }, 'Body'),
        h('p', { class: 'fine' }, 'Bodyweight and waist are entries in your ', h('a', { class: 'link', href: '#/progress/~body' }, 'Body log'), '.')),
    );
    status.textContent = msg;
    if (focusSel) view.querySelector(focusSel)?.focus();
  }
  draw();
}
