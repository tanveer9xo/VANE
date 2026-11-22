// Progress → Body: bodyweight (+ optional waist) per date, trend chart with a 7-day moving average.
import { h, icon, toast } from '../ui.js';
import * as store from '../store.js';
import { fmtNum } from '../stats.js';
import { trendSeries, changeOver, latestEntry, movingAverage } from '../body.js';
import { todayISO, formatShort, isValidISODate, addDays, daysBetween } from '../dates.js';
import { lineChart } from '../chart.js';
import { fmtW, fmtWU, fmtL, fmtLU, parseShownW, parseShownL, toShownW, wUnit, lUnit } from '../units.js';

const RANGES = [
  { id: '1m', label: '1M', days: 31 },
  { id: '3m', label: '3M', days: 91 },
  { id: 'all', label: 'All', days: null },
];
let rangeId = '3m';

const signed = (n, unit) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${fmtNum(Math.abs(n), 1)} ${unit}`;

/** Renders into the Progress view. `dateArg` (YYYY-MM-DD) opens that day's entry for editing. */
export function renderBodySection(view, dateArg) {
  const today = todayISO();
  const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
  const entries = store.bodyEntries();
  const latest = latestEntry(entries);
  const startDate = isValidISODate(dateArg) && dateArg <= today ? dateArg : today;

  // ---------- entry form ----------
  const dateIn = h('input', { id: 'body-date', type: 'date', max: today, required: true, value: startDate });
  const weightIn = h('input', {
    id: 'body-weight', class: 'num-input wide', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: wUnit(),
  });
  const waistIn = h('input', {
    id: 'body-waist', class: 'num-input wide', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: lUnit(),
  });
  const saveLabel = h('span', {}, 'Save weigh-in');
  const saveBtn = h('button', { class: 'btn primary block', type: 'submit' }, icon('check'), saveLabel);

  // A date with an entry loads it for editing; otherwise the weight starts at your last value.
  function load() {
    const e = store.state.body.get(dateIn.value);
    weightIn.value = e ? fmtW(e.weight) : latest ? fmtW(latest.weight) : '';
    waistIn.value = e?.waist != null ? fmtL(e.waist) : '';
    saveLabel.textContent = e ? 'Update weigh-in' : 'Save weigh-in';
  }
  dateIn.addEventListener('change', load);
  load();

  const form = h('form', {
    class: 'card body-form', 'aria-labelledby': 'bf-h',
    onsubmit: async (e) => {
      e.preventDefault();
      if (!isValidISODate(dateIn.value)) { toast('Pick a date.'); return; }
      const weight = parseShownW(weightIn.value);
      const waist = waistIn.value.trim() ? parseShownL(waistIn.value) : null;
      if (waistIn.value.trim() && waist == null) { toast(`Waist must be a number in ${lUnit()}.`); return; }
      try {
        await store.saveBodyEntry({ date: dateIn.value, weight, waist });
        toast(`Saved ${fmtWU(weight)} for ${formatShort(dateIn.value, today)}`, { survive: true });
        document.activeElement?.blur();
        location.replace('#/progress/~body');
        rerender();
      } catch (err) {
        weightIn.setAttribute('aria-invalid', 'true');
        toast(err.message);
      }
    },
  },
  h('h2', { id: 'bf-h' }, 'Weigh-in'),
  h('div', { class: 'field-row' }, h('label', { for: 'body-date' }, 'Date'), dateIn),
  h('div', { class: 'field-row' }, h('label', { for: 'body-weight' }, 'Bodyweight', h('span', { class: 'muted' }, ` (${wUnit()})`)), weightIn),
  h('div', { class: 'field-row' }, h('label', { for: 'body-waist' }, 'Waist', h('span', { class: 'muted' }, ` (${lUnit()}, optional)`)), waistIn),
  saveBtn);
  view.append(form);

  if (!entries.length) {
    view.append(h('section', { class: 'empty-state' },
      icon('scale', 'empty-icon'),
      h('h2', {}, 'No weigh-ins yet'),
      h('p', { class: 'muted' }, 'Weigh in a few mornings a week. The 7-day average smooths out day-to-day noise.')));
    return undefined;
  }

  // ---------- change stats ----------
  // "Change, last 7 days" needs a week of history; until 30 days of history exist the third card is
  // "Since first entry" instead of a 30-day figure. Always four cards, so the grid is never ragged.
  const first = entries[0];
  const span = daysBetween(first.date, latest.date);
  const sinceFirst = entries.length > 1 ? movingAverage(entries, latest.date) - first.weight : null;
  const c7 = span >= 7 ? changeOver(entries, 7) : null;
  const c30 = span >= 30 ? changeOver(entries, 30) : null;
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
      : stat('Weigh-ins', String(entries.length), `since ${formatShort(first.date, today)}`)));

  // ---------- chart ----------
  const chartHolder = h('div');
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Time range' });
  function drawChart() {
    const range = RANGES.find((r) => r.id === rangeId);
    const from = range.days ? addDays(today, -range.days) : '';
    const pts = trendSeries(entries).filter((p) => p.date >= from);
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
  }
  drawChart();
  view.append(h('section', { class: 'card chart-section', 'aria-labelledby': 'trend-h' },
    h('h2', { id: 'trend-h' }, 'Trend'),
    h('div', { class: 'filters' }, seg),
    chartHolder));

  // ---------- entries ----------
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
      h('span', { class: 'num body-w' }, fmtWU(e.weight)),
      h('span', { class: 'num muted' }, e.waist != null ? fmtLU(e.waist) : '')),
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
