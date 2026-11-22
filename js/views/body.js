// Progress → Body: bodyweight and body measurements per date. Any subset of an entry is fine (measure.js).
// Bodyweight gets a 7-day moving-average trend; each measurement site gets its own titled chart.
import { h, icon, toast, sheet } from '../ui.js';
import * as store from '../store.js';
import { fmtNum } from '../stats.js';
import { trendSeries, changeOver, latestEntry, movingAverage } from '../body.js';
import { todayISO, formatShort, isValidISODate, addDays, daysBetween } from '../dates.js';
import { lineChart } from '../chart.js';
import { nutritionCard } from './nutrition.js';
import { fmtW, fmtWU, fmtL, fmtLU, parseShownW, parseShownL, toShownW, toShownL, wUnit, lUnit } from '../units.js';
import {
  GROUPS, trackedSites, tracksBodyFat, normalizeTracked, siteStats, siteSeries, siteByKey, BODY_FAT, cleanValue, waistToHeight, SITE_KEYS,
} from '../measure.js';

const RANGES = [
  { id: '1m', label: '1M', days: 31 },
  { id: '3m', label: '3M', days: 91 },
  { id: 'all', label: 'All', days: null },
];
let rangeId = '3m';

const signed = (n, unit, dp = 1) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${fmtNum(Math.abs(n), dp)}${unit === '%' ? '' : ' '}${unit}`;
const tracked = () => normalizeTracked(store.state.settings.measureSites);
/** A value for display: lengths in the profile's unit, body fat in %. */
const show = (key, v) => (key === BODY_FAT.key ? `${fmtNum(v, 1)}%` : fmtLU(v));
const showChange = (key, d) => (key === BODY_FAT.key ? signed(d, '%') : signed(toShownL(d), lUnit()));

/** Checkboxes for the sites to track; saves straight away. Used here and in Settings → Profile. */
export function siteChooser(onChange = () => {}) {
  const now = tracked();
  return h('fieldset', { class: 'site-chooser' },
    h('legend', { class: 'sr-only' }, 'Measurements to track'),
    GROUPS.map((g) => h('label', { class: 'check-row' },
      h('input', {
        type: 'checkbox', value: g.id, checked: now.includes(g.id),
        onchange: async (e) => {
          const set = new Set(tracked());
          if (e.target.checked) set.add(g.id); else set.delete(g.id);
          await store.saveSettings({ measureSites: normalizeTracked([...set]) });
          onChange();
        },
      }),
      h('span', {}, g.label))));
}

/** Renders into the Progress view. `dateArg` (YYYY-MM-DD) opens that day's entry for editing. */
export function renderBodySection(view, dateArg) {
  const today = todayISO();
  const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
  const entries = store.bodyEntries();
  const weighIns = entries.filter((e) => e.weight != null);
  const latest = latestEntry(weighIns);
  const startDate = isValidISODate(dateArg) && dateArg <= today ? dateArg : today;
  const sites = trackedSites(tracked());
  const withFat = tracksBodyFat(tracked());

  // ---------- entry form ----------
  const dateIn = h('input', { id: 'body-date', type: 'date', max: today, required: true, value: startDate });
  const numIn = (id, placeholder, label) => h('input', { id, class: 'num-input wide', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder, 'aria-label': label });
  const weightIn = numIn('body-weight', wUnit(), `Bodyweight in ${wUnit()}`);
  // Waist keeps its old id; the other sites are body-m-<key>.
  const siteIns = new Map(sites.map((s) => [s.key, numIn(s.key === 'waist' ? 'body-waist' : `body-m-${s.key}`, lUnit(), `${s.label} in ${lUnit() === 'in' ? 'inches' : 'centimetres'}`)]));
  const fatIn = withFat ? numIn('body-fat', '%', 'Body fat percentage, your own estimate') : null;
  const lastHint = h('span', { class: 'field-hint num', id: 'body-last' }, latest ? `Last: ${fmtWU(latest.weight)}` : '');
  const saveLabel = h('span', {}, 'Save entry');
  const saveBtn = h('button', { class: 'btn primary block', type: 'submit' }, icon('check'), saveLabel);

  // A date with an entry loads it for editing; a new date starts empty (your last weight is shown as a hint,
  // so saving only a measurement never logs an old weight again).
  function load() {
    const e = store.state.body.get(dateIn.value);
    weightIn.value = e?.weight != null ? fmtW(e.weight) : '';
    for (const [key, input] of siteIns) input.value = e?.[key] != null ? fmtL(e[key], 2) : '';
    if (fatIn) fatIn.value = e?.bodyFat != null ? fmtNum(e.bodyFat, 1) : '';
    for (const el of view.querySelectorAll('.body-form [aria-invalid]')) el.removeAttribute('aria-invalid');
    saveLabel.textContent = e ? 'Update entry' : 'Save entry';
  }
  dateIn.addEventListener('change', load);

  const bad = (input, msg) => { input.setAttribute('aria-invalid', 'true'); input.focus(); toast(msg); return true; };
  const form = h('form', {
    class: 'card body-form', 'aria-labelledby': 'bf-h', novalidate: true,
    onsubmit: async (ev) => {
      ev.preventDefault();
      if (!isValidISODate(dateIn.value)) { toast('Pick a date.'); return; }
      // Start from the saved entry, so sites you don't track any more keep their values.
      const next = { ...(store.state.body.get(dateIn.value) ?? {}), date: dateIn.value };
      const w = weightIn.value.trim();
      next.weight = w ? parseShownW(w) : null;
      if (w && (next.weight == null || next.weight < 20 || next.weight > 400)) {
        bad(weightIn, `Bodyweight must be ${wUnit() === 'lb' ? '45 to 880 lb' : '20 to 400 kg'}.`); return;
      }
      for (const [key, input] of siteIns) {
        const raw = input.value.trim();
        const cm = raw ? parseShownL(raw) : null;
        const s = siteByKey(key);
        if (raw && cleanValue(key, cm) == null) {
          bad(input, `${s.label} must be ${fmtL(s.min, 0)} to ${fmtL(s.max, 0)} ${lUnit()}.`); return;
        }
        next[key] = cm;
      }
      if (fatIn) {
        const raw = fatIn.value.trim();
        if (raw && cleanValue(BODY_FAT.key, raw) == null) { bad(fatIn, 'Body fat must be 2 to 70%.'); return; }
        next.bodyFat = raw ? Number(raw.replace(',', '.')) : null;
      }
      const hasAny = next.weight != null || next.bodyFat != null || SITE_KEYS.some((k) => next[k] != null);
      if (!hasAny) { bad(weightIn, 'Enter your bodyweight or at least one measurement.'); return; }
      await store.saveBodyEntry(next);
      const n = [...siteIns.keys()].filter((k) => next[k] != null).length + (next.bodyFat != null ? 1 : 0);
      const what = [next.weight != null ? fmtWU(next.weight) : null, n ? `${n} measurement${n === 1 ? '' : 's'}` : null].filter(Boolean).join(' and ');
      toast(`Saved ${what} for ${formatShort(dateIn.value, today)}`, { survive: true });
      document.activeElement?.blur();
      location.replace('#/progress/~body');
      rerender();
    },
  },
  h('h2', { id: 'bf-h' }, 'Weigh-in'),
  h('p', { class: 'fine' }, 'Everything is optional: log your weight, any measurements, or both.'),
  h('div', { class: 'field-row' }, h('label', { for: 'body-date' }, 'Date'), dateIn),
  h('div', { class: 'field-row' }, h('label', { for: 'body-weight' }, 'Bodyweight', h('span', { class: 'muted' }, ` (${wUnit()})`), lastHint), weightIn),
  sites.length || fatIn ? h('fieldset', { class: 'measure-fields' },
    h('legend', {}, 'Measurements', h('span', { class: 'muted' }, ` (${lUnit()})`)),
    sites.map((s) => h('div', { class: 'field-row' }, h('label', { for: siteIns.get(s.key).id }, s.label), siteIns.get(s.key))),
    fatIn ? h('div', { class: 'field-row' }, h('label', { for: 'body-fat' }, 'Body fat %', h('small', {}, 'your own estimate')), fatIn) : null) : null,
  h('button', { type: 'button', class: 'btn small subtle choose-sites', onclick: chooseSites }, icon('ruler'), 'Choose measurements'),
  saveBtn);
  load();
  view.append(form);

  async function chooseSites() {
    await sheet({ title: 'Measurements to track', build: () => h('div', { class: 'stack' },
      h('p', { class: 'fine' }, `Shown in the form and the Measurements card. Lengths are in ${lUnit() === 'in' ? 'inches' : 'cm'} (your profile’s units). Values you've logged are kept even if you stop tracking a site.`),
      siteChooser()) });
    rerender();
  }

  if (!entries.length) {
    view.append(h('section', { class: 'empty-state' },
      icon('scale', 'empty-icon'),
      h('h2', {}, 'No entries yet'),
      h('p', { class: 'muted' }, 'Weigh in a few mornings a week; the 7-day average smooths out day-to-day noise. Measure every week or two.')),
    nutritionCard());
    return undefined;
  }

  // ---------- bodyweight: change stats ----------
  // "Change, last 7 days" needs a week of history; until 30 days of history exist the third card is
  // "Since first entry" instead of a 30-day figure. Always four cards, so the grid is never ragged.
  if (latest) {
    const first = weighIns[0];
    const span = daysBetween(first.date, latest.date);
    const sinceFirst = weighIns.length > 1 ? movingAverage(weighIns, latest.date) - first.weight : null;
    const c7 = span >= 7 ? changeOver(weighIns, 7) : null;
    const c30 = span >= 30 ? changeOver(weighIns, 30) : null;
    const latestWaist = latestEntry(entries, 'waist');
    view.append(h('dl', { class: 'card stat-row body-stats' },
      stat('Latest', fmtWU(latest.weight), formatShort(latest.date, today)),
      c7 != null
        ? stat('Change, last 7 days', signed(toShownW(c7), wUnit()), '7-day average vs a week earlier')
        : stat('Change, last 7 days', '–', 'Needs a week of weigh-ins'),
      c30 != null
        ? stat('Change, last 30 days', signed(toShownW(c30), wUnit()), '7-day average vs 30 days earlier')
        : stat('Since first entry', sinceFirst != null ? signed(toShownW(sinceFirst), wUnit()) : '–',
          sinceFirst != null ? `from ${formatShort(first.date, today)}` : 'Log another weigh-in'),
      latestWaist
        ? stat('Waist', fmtLU(latestWaist.waist), formatShort(latestWaist.date, today))
        : stat('Weigh-ins', String(weighIns.length), `since ${formatShort(first.date, today)}`)));

    // ---------- bodyweight: chart ----------
    const chartHolder = h('div');
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Time range' });
    const drawChart = () => {
      const range = RANGES.find((r) => r.id === rangeId);
      const from = range.days ? addDays(today, -range.days) : '';
      const pts = trendSeries(weighIns).filter((p) => p.date >= from);
      seg.replaceChildren(...RANGES.map((r) => h('button', {
        class: 'seg-btn', 'aria-pressed': String(r.id === rangeId), onclick: () => { rangeId = r.id; drawChart(); },
      }, r.label)));
      chartHolder.replaceChildren(pts.length >= 3
        ? lineChart(pts.map((p) => ({ date: p.date, value: toShownW(p.value), line: Math.round(toShownW(p.avg) * 10) / 10 })), {
          label: 'Bodyweight and 7-day average', format: (v) => `${fmtNum(v, 1)} ${wUnit()}`, valueName: 'Daily weigh-in', lineName: '7-day average',
        })
        : h('p', { class: 'muted chart-empty' }, pts.length
          ? `The chart appears after three weigh-ins in this range. You have ${pts.length}.`
          : 'No weigh-ins in this range. Pick a longer range.'));
    };
    drawChart();
    view.append(h('section', { class: 'card chart-section', 'aria-labelledby': 'trend-h' },
      h('h2', { id: 'trend-h' }, 'Bodyweight trend'),
      h('div', { class: 'filters' }, seg),
      chartHolder));
  }

  // ---------- measurements ----------
  const keys = [...sites.map((s) => s.key), ...(withFat ? [BODY_FAT.key] : [])];
  const latestWaist = latestEntry(entries, 'waist');
  const heightCm = store.state.profile.heightCm;
  const ratio = latestWaist && heightCm ? waistToHeight(latestWaist.waist, heightCm) : null;
  view.append(h('section', { class: 'card measures', id: 'measures', 'aria-labelledby': 'measures-h' },
    h('div', { class: 'section-head' }, h('h2', { id: 'measures-h' }, 'Measurements'),
      h('button', { class: 'btn small subtle', onclick: chooseSites }, 'Choose')),
    ratio != null ? h('div', { class: 'whtr' },
      h('p', { class: 'whtr-line' }, 'Waist-to-height ', h('strong', { class: 'num', id: 'whtr' }, fmtNum(ratio, 2))),
      h('details', {}, h('summary', {}, 'How it’s counted'),
        h('p', { class: 'fine' }, `Your latest waist (${fmtLU(latestWaist.waist)}, ${formatShort(latestWaist.date, today)}) divided by your height (${fmtLU(heightCm)}). Both are lengths, so the units cancel: it's the same number in cm or inches. It's just a ratio of two of your own measurements.`))) : null,
    keys.length
      ? h('ul', { class: 'rows measure-list' }, keys.map((key) => measureRow(key)))
      : h('p', { class: 'muted' }, 'No sites chosen. Tap Choose to pick which measurements to track.')));

  function measureRow(key) {
    const s = siteByKey(key);
    const st = siteStats(entries, key);
    return h('li', {}, h('button', {
      class: 'measure-row', dataset: { site: key }, disabled: !st,
      'aria-label': st ? `${s.label}: ${show(key, st.latest[key])}. Show trend` : `${s.label}: no entries yet`,
      onclick: () => openSite(key),
    },
    h('span', { class: 'measure-name' }, s.label),
    h('span', { class: 'measure-val num' }, st ? show(key, st.latest[key]) : '–'),
    h('span', { class: 'measure-sub' }, !st ? 'No entries yet'
      : [st.sinceFirst != null ? `${showChange(key, st.sinceFirst)} since first` : 'First entry', st.sinceLast != null ? `${showChange(key, st.sinceLast)} since last` : null].filter(Boolean).join(' · ')),
    st ? icon('chevR') : null));
  }

  function openSite(key) {
    const s = siteByKey(key);
    const st = siteStats(entries, key);
    const conv = (v) => (key === BODY_FAT.key ? v : Math.round(toShownL(v) * 100) / 100);
    const unit = key === BODY_FAT.key ? '%' : lUnit();
    const pts = siteSeries(entries, key).map((p) => ({ date: p.date, value: conv(p.value) }));
    sheet({
      title: s.label, // every chart is titled with its site: colour is never the only cue
      build: () => h('div', { class: 'stack site-sheet', dataset: { site: key } },
        h('dl', { class: 'stat-row' },
          stat('Latest', show(key, st.latest[key]), formatShort(st.latest.date, today)),
          stat('Since first', st.sinceFirst != null ? showChange(key, st.sinceFirst) : '–', st.sinceFirst != null ? `from ${formatShort(st.first.date, today)}` : 'Only one entry'),
          stat('Since last', st.sinceLast != null ? showChange(key, st.sinceLast) : '–', st.previous ? `vs ${formatShort(st.previous.date, today)}` : 'Only one entry'),
          stat('Entries', String(st.count), `since ${formatShort(st.first.date, today)}`)),
        pts.length >= 2
          ? lineChart(pts, { label: `${s.label} trend`, format: (v) => `${fmtNum(v, 1)}${unit === '%' ? '%' : ` ${unit}`}`, valueName: s.label })
          : h('p', { class: 'muted chart-empty' }, 'The chart appears after two entries.')),
    });
  }

  // ---------- nutrition (optional; offered here, set up in Settings) ----------
  const nut = nutritionCard();
  if (nut) view.append(nut);

  // ---------- entries ----------
  const summary = (e) => {
    const n = [...SITE_KEYS, BODY_FAT.key].filter((k) => e[k] != null).length;
    return n ? `${n} measurement${n === 1 ? '' : 's'}` : '';
  };
  view.append(h('section', { class: 'card list', 'aria-labelledby': 'entries-h' },
    h('h2', { id: 'entries-h', class: 'list-title' }, 'Entries'),
    h('ul', { class: 'rows body-list' }, [...entries].reverse().slice(0, 60).map((e) => h('li', { class: 'body-row' },
      h('button', {
        class: 'body-edit', 'aria-label': `Edit entry for ${formatShort(e.date, today)}`,
        onclick: () => {
          dateIn.value = e.date;
          load();
          form.scrollIntoView({ behavior: 'smooth', block: 'start' });
          weightIn.focus({ preventScroll: true });
        },
      },
      h('span', { class: 'recent-date' }, formatShort(e.date, today)),
      h('span', { class: 'num body-w' }, e.weight != null ? fmtWU(e.weight) : '–'),
      h('span', { class: 'num muted' }, summary(e))),
      h('button', {
        class: 'icon-btn subtle', 'aria-label': `Delete entry for ${formatShort(e.date, today)}`,
        onclick: async () => {
          await store.deleteBodyEntry(e.date);
          rerender();
          toast(`Deleted ${formatShort(e.date, today)}`, {
            timeout: 6000,
            action: { label: 'Undo', run: async () => { await store.saveBodyEntry(e); rerender(); } },
          });
        },
      }, icon('trash')))))));
  return undefined;
}

function stat(label, value, sub) {
  return h('div', { class: 'stat' }, h('dt', {}, label), h('dd', { class: 'num stat-v' }, value), sub ? h('dd', { class: 'stat-sub' }, sub) : null);
}
