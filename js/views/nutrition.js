// Settings → Nutrition (#/settings/nutrition): optional daily calorie and protein estimates, adults only,
// plus a simple manual intake log. Off by default; everything is optional and stays on this phone.
import { h, icon, toast, sheet } from '../ui.js';
import * as store from '../store.js';
import {
  SEXES, ACTIVITY, LOSS_CHOICES, targets, missingFor, isMinor, weightDrift, proteinPerKg, goalAdjustment, ADULT_AGE,
} from '../nutrition.js';
import { GOALS } from '../profile.js';
import { latestEntry } from '../body.js';
import { fmtW, fmtWU, fmtL, parseShownW, parseShownL, wUnit, lUnit } from '../units.js';
import { todayISO, formatShort, addDays } from '../dates.js';
import { tile, fieldset } from './onboarding.js';

const int = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const kcal = (n) => `${int.format(n)} kcal`;
const pct = (f) => `${f > 0 ? '+' : f < 0 ? '−' : ''}${Math.round(Math.abs(f) * 1000) / 10}%`;
const thisYear = () => new Date(`${todayISO()}T12:00:00`).getFullYear();
const latestWeight = () => latestEntry(store.bodyEntries().filter((e) => e.weight != null))?.weight ?? null;
const estimate = () => targets(store.state.nutrition, { goal: store.state.profile.goal, heightCm: store.state.profile.heightCm, thisYear: thisYear() });
const minor = () => isMinor(store.state.nutrition.birthYear, thisYear());

/** One progress bar: logged vs target. With numbers hidden, only the bar shows. */
function bar(label, value, target, unit, hide) {
  const frac = target ? Math.min(1, (value ?? 0) / target) : 0;
  return h('div', { class: 'intake-bar' },
    h('div', { class: 'intake-bar-head' }, h('span', {}, label),
      hide ? null : h('span', { class: 'num' }, value == null ? `– of ${int.format(target)} ${unit}` : `${int.format(value)} of ${int.format(target)} ${unit}`)),
    h('div', {
      class: 'bar-track', role: 'progressbar', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': '100',
      'aria-valuenow': String(Math.round(frac * 100)), 'aria-valuetext': value == null ? 'nothing logged' : `${Math.round(frac * 100)}% of the estimate`,
    }, h('span', { class: 'bar-fill', style: `width:${Math.round(frac * 100)}%` })));
}

/** Settings and Body tab summary line. */
export function nutritionSummary() {
  if (minor()) return `For adults (${ADULT_AGE}+)`;
  if (!store.state.nutrition.enabled) return 'Off';
  const t = estimate();
  if (!t) return 'On: finish setup for an estimate';
  return store.state.nutrition.hideNumbers ? 'On (numbers hidden)' : `On: about ${kcal(t.calories.target)}, ${t.protein.target} g protein`;
}

/** The card on the Body tab: an offer when off, today's bars when on; nothing for under-18s. */
export function nutritionCard() {
  if (minor()) return null;
  const n = store.state.nutrition;
  const t = n.enabled ? estimate() : null;
  const today = store.state.intake[todayISO()] ?? {};
  return h('section', { class: 'card nutrition-card', id: 'nutrition-card', 'aria-labelledby': 'nut-card-h' },
    h('div', { class: 'section-head' }, h('h2', { id: 'nut-card-h' }, 'Nutrition'),
      h('a', { class: 'btn small subtle', href: '#/settings/nutrition' }, n.enabled ? 'Open' : 'Set up')),
    !n.enabled
      ? h('p', { class: 'muted' }, 'Optional: daily calorie and protein estimates for your goal, and a simple log. Off until you switch it on.')
      : t
        ? h('div', { class: 'stack' }, bar('Calories today', today.kcal, t.calories.target, 'kcal', n.hideNumbers), bar('Protein today', today.protein, t.protein.target, 'g', n.hideNumbers))
        : h('p', { class: 'muted' }, 'Finish setup for an estimate.'));
}

export function renderNutrition(root) {
  const view = h('div', { class: 'view nutrition-view' });
  root.append(view);
  const results = h('div', { class: 'stack' });
  let logDate = todayISO();

  const save = async (patch) => { await store.saveNutrition(patch); drawResults(); };

  function draw() {
    const n = store.state.nutrition;
    const p = store.state.profile;
    const lb = p.units === 'lb';
    const latest = latestWeight();
    const top = h('header', { class: 'topbar' },
      h('a', { class: 'icon-btn', href: '#/settings', 'aria-label': 'Back to Settings' }, icon('chevL')),
      h('div', { class: 'topbar-title' }, h('h1', { tabindex: '-1' }, 'Nutrition')));
    const intro = h('p', { class: 'fine' }, icon('lock'), ' Optional estimates for adults. Everything here stays on this phone.');

    const yearIn = h('input', {
      id: 'nut-year', class: 'ob-input num', type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: '4', value: n.birthYear ?? '', placeholder: 'e.g. 1990',
      onchange: async (e) => {
        const v = e.target.value.trim();
        const y = Number(v);
        if (v && !(Number.isInteger(y) && y >= 1900 && y <= thisYear())) { e.target.setAttribute('aria-invalid', 'true'); toast('Enter a year like 1990, or leave it blank.'); return; }
        await store.saveNutrition({ birthYear: v ? y : null });
        draw(); // the adult check may change what's shown
      },
    });
    const yearField = h('div', { class: 'ob-field' }, h('label', { for: 'nut-year', class: 'ob-label' }, 'Birth year'), yearIn);

    if (minor()) {
      view.replaceChildren(top, intro, h('section', { class: 'card', id: 'nut-minor' },
        h('h2', {}, `For adults (${ADULT_AGE}+)`),
        h('p', {}, 'Calorie and protein estimates are only for adults, so they stay switched off. Training, the Body log and everything else work as usual.'),
        yearField));
      return;
    }

    const onSwitch = h('input', {
      id: 'nut-on', type: 'checkbox', class: 'switch', checked: n.enabled,
      onchange: async (e) => {
        // First time on: start from your latest Body log weight.
        const patch = { enabled: e.target.checked };
        if (e.target.checked && !n.weightKg && latest) patch.weightKg = latest;
        await store.saveNutrition(patch);
        draw();
      },
    });
    const switchCard = h('section', { class: 'card' },
      h('div', { class: 'field-row' }, h('label', { for: 'nut-on' }, 'Nutrition targets', h('small', {}, 'Daily calorie and protein estimates, and a simple log')), onSwitch));
    if (!n.enabled) {
      view.replaceChildren(top, intro, switchCard,
        h('p', { class: 'muted' }, 'Off by default. Switch it on to answer a few optional questions; you can switch it off again any time.'));
      return;
    }

    // ---- about you (all optional) ----
    const heightIn = h('input', {
      id: 'nut-height', class: 'ob-input num', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: p.heightCm ? fmtL(p.heightCm, 1) : '', placeholder: lUnit(),
      onchange: async (e) => {
        const v = e.target.value.trim();
        const cm = v ? parseShownL(v) : null;
        if (v && !(cm >= 100 && cm <= 250)) { e.target.setAttribute('aria-invalid', 'true'); toast(`Enter a height of ${lb ? '40 to 98 in' : '100 to 250 cm'}, or leave it blank.`); return; }
        e.target.removeAttribute('aria-invalid');
        await store.saveProfile({ heightCm: cm });
        drawResults();
      },
    });
    const weightIn = h('input', {
      id: 'nut-weight', class: 'ob-input num', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: n.weightKg ? fmtW(n.weightKg) : '', placeholder: wUnit(),
      onchange: async (e) => {
        const v = e.target.value.trim();
        const kg = v ? parseShownW(v) : null;
        if (v && !(kg >= 20 && kg <= 400)) { e.target.setAttribute('aria-invalid', 'true'); toast(`Enter a weight of ${lb ? '45 to 880 lb' : '20 to 400 kg'}, or leave it blank.`); return; }
        e.target.removeAttribute('aria-invalid');
        await save({ weightKg: kg });
        draw();
      },
    });
    const num = (input, unit) => h('span', { class: 'ob-num' }, input, h('span', { class: 'unit', 'aria-hidden': 'true' }, unit));
    const drift = weightDrift(n, latest);
    const setup = h('section', { class: 'card', 'aria-labelledby': 'nut-you-h' },
      h('h2', { id: 'nut-you-h' }, 'About you'),
      h('p', { class: 'fine' }, 'All optional. The estimate appears once it has a birth year, height, weight and activity level.'),
      fieldset('Sex', 'nut-sex units', Object.entries(SEXES).map(([id, label]) => tile({ name: 'nut-sex', value: id, label, compact: true, checked: n.sex === id, onpick: (v) => save({ sex: v }) }))),
      yearField,
      h('div', { class: 'ob-field' }, h('label', { for: 'nut-height', class: 'ob-label' }, 'Height'), h('div', { class: 'ob-nums' }, num(heightIn, lUnit()))),
      h('div', { class: 'ob-field' }, h('label', { for: 'nut-weight', class: 'ob-label' }, 'Current weight'), h('div', { class: 'ob-nums' }, num(weightIn, wUnit())),
        latest != null && n.weightKg == null ? h('span', { class: 'field-hint' }, `Body log: ${fmtWU(latest)}`) : null),
      drift != null ? h('div', { class: 'banner nut-drift', role: 'status' },
        h('span', { class: 'banner-ic' }, icon('scale')),
        h('p', {}, `Your Body log weight is ${fmtWU(latest)}, ${fmtWU(Math.abs(drift))} ${drift > 0 ? 'more' : 'less'} than the ${fmtWU(n.weightKg)} these estimates use.`),
        h('button', { class: 'btn small accent', onclick: async () => { await save({ weightKg: latest }); draw(); } }, `Use ${fmtWU(latest)}`)) : null,
      fieldset('Activity level', 'nut-act', Object.entries(ACTIVITY).map(([id, a]) => tile({ name: 'nut-act', value: id, label: a.label, sub: a.note, checked: n.activity === id, onpick: (v) => save({ activity: v }) }))),
      p.goal === 'fat' ? fieldset('How fast to lose', 'nut-loss sessions', LOSS_CHOICES.map((x) => tile({ name: 'nut-loss', value: String(x), label: `−${x}%`, compact: true, checked: n.lossPct === x, onpick: (v) => save({ lossPct: Number(v) }) }))) : null);

    const hideSwitch = h('div', { class: 'field-row' }, h('label', { for: 'nut-hide' }, 'Hide all numbers', h('small', {}, 'Show progress as bars only')),
      h('input', { id: 'nut-hide', type: 'checkbox', class: 'switch', checked: n.hideNumbers, onchange: async (e) => { await save({ hideNumbers: e.target.checked }); } }));

    view.replaceChildren(top, intro, switchCard, results, setup, h('section', { class: 'card' }, hideSwitch));
    drawResults();
  }

  function drawResults() {
    const n = store.state.nutrition;
    const goal = store.state.profile.goal;
    const t = estimate();
    const hide = n.hideNumbers;
    const missing = missingFor(n, store.state.profile.heightCm);
    const goalLine = `${goal ? `For your goal, ${GOALS[goal]}` : 'No goal set: maintenance'}${goal === 'fat' ? ` (−${n.lossPct}%)` : ''}.`;
    const est = h('section', { class: 'card nut-targets', id: 'nut-targets', 'aria-labelledby': 'nut-t-h' },
      h('h2', { id: 'nut-t-h' }, 'Daily estimate'),
      !t ? h('p', { class: 'muted' }, `Add your ${missing.join(', ').replace(/, ([^,]*)$/, ' and $1')} to see an estimate.`)
        : hide ? h('p', { class: 'muted', id: 'nut-hidden' }, 'Numbers are hidden. Your log below shows progress as bars.')
          : h('div', { class: 'stack' },
            h('dl', { class: 'stat-row' },
              h('div', { class: 'stat' }, h('dt', {}, 'Calories'), h('dd', { class: 'num stat-v', id: 'nut-kcal' }, h('span', { class: 'approx' }, 'about'), ` ${int.format(t.calories.target)}`),
                h('dd', { class: 'stat-sub' }, `kcal a day, estimate. Range ${int.format(t.calories.lo)}–${int.format(t.calories.hi)}`)),
              h('div', { class: 'stat' }, h('dt', {}, 'Protein'), h('dd', { class: 'num stat-v', id: 'nut-protein' }, h('span', { class: 'approx' }, 'about'), ` ${t.protein.target} g`),
                h('dd', { class: 'stat-sub' }, `a day, estimate. Range ${t.protein.lo}–${t.protein.hi} g`))),
            h('p', { class: 'fine' }, goalLine,
              t.capped ? ' Kept to a loss of about 1% of your bodyweight a week.' : '',
              t.floored ? ` Kept at a minimum of ${kcal(t.calories.target)}.` : '')),
      t ? h('button', { class: 'btn small subtle', id: 'nut-how', onclick: () => howSheet(t) }, icon('info'), 'How it’s counted') : null,
      h('p', { class: 'fine nut-note' }, 'These are estimates, not rules: some days are higher, some lower, and the weekly pattern matters more. If you have a health condition, check with a doctor before changing how you eat.'));
    results.replaceChildren(est, t ? intakeCard(t) : null);
  }

  function intakeCard(t) {
    const n = store.state.nutrition;
    const day = store.state.intake[logDate] ?? {};
    const intIn = (id, value, label, max) => h('input', {
      id, class: 'num-input wide', type: 'text', inputmode: 'numeric', autocomplete: 'off', value: value ?? '', 'aria-label': label,
      onchange: async () => {
        const read = (el, mx) => { const v = el.value.trim(); if (!v) return null; const x = Number(v); return Number.isInteger(x) && x >= 0 && x <= mx ? x : NaN; };
        const k = read(document.getElementById('intake-kcal'), 20000);
        const pr = read(document.getElementById('intake-protein'), 1000);
        if (Number.isNaN(k) || Number.isNaN(pr)) { toast('Enter whole numbers, or leave a box blank.'); return; }
        await store.saveIntake(logDate, { kcal: k, protein: pr });
        drawResults();
      },
    });
    const week = Array.from({ length: 7 }, (_, i) => addDays(todayISO(), -i)).map((d) => [d, store.state.intake[d]]).filter(([, v]) => v);
    return h('section', { class: 'card', id: 'nut-log', 'aria-labelledby': 'nut-log-h' },
      h('div', { class: 'section-head' }, h('h2', { id: 'nut-log-h' }, 'Log'),
        h('input', { type: 'date', id: 'intake-date', value: logDate, max: todayISO(), 'aria-label': 'Day to log', onchange: (e) => { logDate = e.target.value || todayISO(); drawResults(); } })),
      h('p', { class: 'fine' }, 'Optional. Type your totals for the day; there’s no food list.'),
      h('div', { class: 'field-row' }, h('label', { for: 'intake-kcal' }, 'Calories', h('small', {}, 'kcal')), intIn('intake-kcal', day.kcal, 'Calories eaten, kcal', 20000)),
      h('div', { class: 'field-row' }, h('label', { for: 'intake-protein' }, 'Protein', h('small', {}, 'grams')), intIn('intake-protein', day.protein, 'Protein eaten, grams', 1000)),
      bar('Calories', day.kcal, t.calories.target, 'kcal', n.hideNumbers),
      bar('Protein', day.protein, t.protein.target, 'g', n.hideNumbers),
      week.length > 1 ? h('details', { class: 'nut-week' }, h('summary', {}, 'Last 7 days'),
        h('ul', { class: 'rows' }, week.map(([d, v]) => h('li', { class: 'nut-day' }, h('span', {}, formatShort(d, todayISO())),
          n.hideNumbers ? null : h('span', { class: 'num muted' }, `${v.kcal != null ? int.format(v.kcal) : '–'} kcal · ${v.protein ?? '–'} g`))))) : null);
  }

  function howSheet(t) {
    const n = store.state.nutrition;
    const goal = store.state.profile.goal;
    const adj = goalAdjustment(goal, n.lossPct);
    const p = proteinPerKg(goal);
    sheet({
      title: 'How it’s counted',
      build: () => h('div', { class: 'stack how-sheet' },
        h('p', {}, h('strong', {}, '1. Resting energy (BMR). '), 'The Mifflin-St Jeor formula: 10 × weight (kg) + 6.25 × height (cm) − 5 × age, then +5 for male or −161 for female. With “Prefer not to say”, VANE uses the midpoint (−78) and shows a range spanning both.',
          n.hideNumbers ? '' : ` Yours: ${int.format(t.bmr.lo)}${t.bmr.hi !== t.bmr.lo ? `–${int.format(t.bmr.hi)}` : ''} kcal.`),
        h('p', {}, h('strong', {}, '2. Your day. '), 'BMR × an activity factor: 1.2 sedentary, 1.375 light, 1.55 moderate, 1.725 very active.',
          n.hideNumbers ? '' : ` That’s about ${int.format(t.maintenance.lo)}${t.maintenance.hi !== t.maintenance.lo ? `–${int.format(t.maintenance.hi)}` : ''} kcal to stay level.`),
        h('p', {}, h('strong', {}, '3. Your goal. '), 'Lose fat −10 to −25% (you choose; −20% by default), Build muscle +5 to +10%, Recomp about level to −5%, Get stronger and Stay consistent level.',
          ` Yours: ${adj.lo === adj.hi ? 'level' : `${pct(adj.lo)} to ${pct(adj.hi)}`}.`),
        h('p', {}, h('strong', {}, '4. Limits. '), 'A loss is kept to about 1% of your bodyweight a week, and no estimate goes below 1,500 kcal (male), 1,200 (female) or 1,350 (prefer not to say).'),
        h('p', {}, h('strong', {}, '5. Protein. '), `${p.lo.toFixed(1)}–${p.hi.toFixed(1)} g per kg of bodyweight (about ${p.target.toFixed(1)} g/kg for your goal).`),
        h('p', { class: 'fine' }, 'Formulas like these are averages; real needs differ from person to person. Watch your Body log over a few weeks and adjust. If you have a health condition, are pregnant or breastfeeding, check with a doctor.')),
    });
  }

  draw();
}
