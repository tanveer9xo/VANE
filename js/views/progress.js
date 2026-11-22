// Progress tab: Charts / Records / Body.
//   #/progress[/<exercise key>]   #/progress/~records   #/progress/~body[/YYYY-MM-DD]   #/progress/~consistency
import { h, icon } from '../ui.js';
import { typeColor } from '../types.js';
import { groupIcon, equipmentLabel } from '../muscles.js';
import * as store from '../store.js';
import { exName } from '../library.js';
import { fmtWU, toShownW, shownVolume, wUnit } from '../units.js';
import {
  exerciseUsage, exerciseHistory, exerciseSummary, formatSets, fmtNum, fmtInt, allRecords, trendOf, stallOf,
} from '../stats.js';
import { recordRows } from '../review.js';
import { todayISO, formatShort, addDays } from '../dates.js';
import { lineChart } from '../chart.js';
import { openExercisePicker } from './picker.js';
import { renderBodySection } from './body.js';
import { renderConsistency } from './consistency.js';
import { renderBodyMap } from './bodymap.js';

const RANGES = [
  { id: '3m', label: '3M', days: 91 },
  { id: '1y', label: '1Y', days: 365 },
  { id: 'all', label: 'All', days: null },
];
const METRICS = [
  { id: 'e1rm', label: 'Est. 1RM', name: 'est. 1RM', value: (x) => Math.round(toShownW(x.best.e1rm) * 10) / 10, fmt: (v) => `${fmtNum(v, 1)} ${wUnit()}`, pr: (x) => x.isE1rmPR },
  { id: 'top', label: 'Top weight', name: 'top weight', value: (x) => Math.round(toShownW(x.top.weight) * 100) / 100, fmt: (v) => `${fmtNum(v)} ${wUnit()}`, pr: (x) => x.isWeightPR },
  { id: 'volume', label: 'Volume', name: 'volume', value: (x) => shownVolume(x.volume), fmt: (v) => `${fmtInt(v)} ${wUnit()}`, pr: () => false },
];
const REPS_METRIC = { id: 'reps', label: 'Most reps', name: 'most reps', value: (x) => x.top.reps, fmt: (v) => `${v} reps`, pr: () => false };

const pref = (k, fallback) => { try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; } };
const setPref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

export function renderProgress(root, arg, arg2) {
  const today = todayISO();
  const list = store.allSessions();
  const usage = [...exerciseUsage(list, today).values()].sort((a, b) => (a.lastDate < b.lastDate ? 1 : -1));
  const seg = { '~records': 'records', '~body': 'body', '~map': 'map', '~consistency': 'consistency' }[arg] ?? 'charts';
  const link = (id, href, label) => h('a', { class: 'seg-btn', href, 'aria-current': seg === id ? 'page' : null }, label);
  const view = h('div', { class: 'view progress-view' },
    h('header', { class: 'topbar' }, h('h1', { tabindex: '-1' }, 'Progress')),
    h('nav', { class: 'seg seg-wide seg-scroll', 'aria-label': 'Progress views' },
      link('charts', '#/progress', 'Charts'), link('records', '#/progress/~records', 'Records'),
      link('map', '#/progress/~map', 'Body map'), link('body', '#/progress/~body', 'Body'),
      link('consistency', '#/progress/~consistency', 'Consistency')));
  root.append(view);
  // Five segments don't fit a 320 px phone: the bar scrolls sideways, keeping the current one in view.
  // An edge fades out wherever more tabs sit past it, so a cut-off tab reads as "scroll for more".
  const nav = view.querySelector('.seg-scroll');
  const fade = () => {
    const more = nav.scrollWidth - nav.clientWidth;
    nav.classList.toggle('more-left', nav.scrollLeft > 2);
    nav.classList.toggle('more-right', more - nav.scrollLeft > 2);
  };
  nav.addEventListener('scroll', fade, { passive: true });
  new ResizeObserver(fade).observe(nav); // collected with the element, unlike a window listener
  requestAnimationFrame(() => {
    const cur = nav.querySelector('[aria-current="page"]');
    if (cur) nav.scrollLeft = Math.max(0, cur.offsetLeft - (nav.clientWidth - cur.offsetWidth) / 2);
    fade();
  });

  if (seg === 'body') return renderBodySection(view, arg2);
  if (seg === 'consistency') { renderConsistency(view); return undefined; }
  if (seg === 'map') return renderBodyMap(view, arg2);
  if (!usage.length && !(seg === 'charts' && arg)) {
    view.append(h('section', { class: 'empty-state' },
      icon('chart', 'empty-icon'),
      h('h2', {}, 'No progress to show yet'),
      h('p', { class: 'muted' }, 'Tick a few sets with weight and reps, and your charts and records appear here.'),
      h('a', { class: 'btn primary', href: `#/day/${today}` }, 'Open today')));
    return undefined;
  }
  if (seg === 'records') { renderRecords(view, list, today); return undefined; }
  renderCharts(view, list, usage, arg, today);
  return undefined;
}

/** Colour of an exercise: the session type it is logged under most often. */
const slugOf = (u) => {
  const top = Object.entries(u?.byType ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0];
  return top ? typeColor(top) : 'none';
};
const tile = (u, name) => h('span', { class: `ex-tile t-${slugOf(u)}` }, icon(groupIcon(store.primaryGroup(name))));
const TREND = { up: ['up', 'Up'], flat: ['same', 'Flat'], down: ['down', 'Down'] };

function renderCharts(view, list, usage, arg, today) {
  const wanted = (arg ?? pref('progressExercise', '')).toLowerCase();
  // Any exercise opens here: one you've logged, or any library or custom exercise (empty until you log it).
  let current = usage.find((u) => u.key === wanted);
  if (!current && arg) {
    const rec = store.catalogRecord(wanted);
    const entry = store.state.library.find((e) => e.name.toLowerCase() === wanted);
    if (rec || entry) current = { key: wanted, name: rec?.name ?? entry.name, count: 0, byType: {} };
  }
  current ??= usage[0];
  if (current.count) setPref('progressExercise', current.key);
  let rangeId = pref('progressRange', 'all');

  const rec = store.catalogRecord(current.name);
  const muscleLine = [rec?.primary?.[0] ?? null, rec?.secondary?.length ? `also ${rec.secondary.join(', ')}` : null, rec?.equipment ? equipmentLabel(rec.equipment) : null].filter(Boolean).join('; ');
  const chooser = h('button', {
    class: 'ex-chooser', 'aria-label': `Exercise: ${exName(current.name)}. Search exercises`,
    onclick: async () => {
      const name = await openExercisePicker({ usage: new Map(usage.map((u) => [u.key, u])), allowNew: false, title: 'Choose exercise' });
      if (name) location.replace(`#/progress/${encodeURIComponent(name.toLowerCase())}`);
    },
  }, tile(current, current.name), h('span', { class: 'ex-chooser-text' }, h('span', { class: 'ex-chooser-name' }, exName(current.name)),
    h('span', { class: 'muted' }, current.count ? `${current.count} sessions${muscleLine ? `. ${muscleLine}` : ''}` : muscleLine || 'Search to switch')), icon('search'));

  const body = h('div', { class: 'stack' });
  view.append(chooser, body);

  const all = exerciseHistory(list, current.key, { today });
  if (!all.length) {
    body.append(h('section', { class: 'empty-state' },
      icon('chart', 'empty-icon'),
      h('h2', {}, `No sets of ${exName(current.name)} yet`),
      h('p', { class: 'muted' }, 'Add it to a workout and tick a set. Its chart, records and trend start here.'),
      h('a', { class: 'btn primary', href: `#/day/${today}` }, 'Open today')));
    return;
  }
  const sum = exerciseSummary(all);
  const bodyweightOnly = sum.best.e1rm === 0;
  const metrics = bodyweightOnly ? [REPS_METRIC] : METRICS;
  let metricId = metrics.some((m) => m.id === pref('progressMetric', 'e1rm')) ? pref('progressMetric', 'e1rm') : metrics[0].id;
  let showAll = false;

  function draw() {
    const range = RANGES.find((r) => r.id === rangeId) ?? RANGES[2];
    const metric = metrics.find((m) => m.id === metricId) ?? metrics[0];
    const from = range.days ? addDays(today, -range.days) : '';
    const hist = all.filter((x) => x.date >= from);

    const stats = h('dl', { class: 'stat-row' },
      bodyweightOnly
        ? stat('Most reps', `${sum.maxReps}`, 'in one set')
        : stat('Best est. 1RM', fmtWU(sum.best.e1rm, 1), `${fmtWU(sum.best.weight)} × ${sum.best.reps}, ${formatShort(sum.best.date, today)}`),
      stat('Heaviest set', sum.heaviest.weight === 0 ? `BW × ${sum.heaviest.reps}` : `${fmtWU(sum.heaviest.weight)} × ${sum.heaviest.reps}`, formatShort(sum.heaviest.date, today)),
      stat('Sessions', String(sum.count), `since ${formatShort(sum.first.date, today)}`),
      stat('Last session', formatShort(sum.last.date, today), bodyweightOnly ? `${sum.last.top.reps} reps` : `top set ${fmtWU(sum.last.top.weight)} × ${sum.last.top.reps}`));

    // Trend over the last 4 sessions (est. 1RM; top reps for bodyweight) and a stall note.
    const trend = trendOf(all);
    const stall = stallOf(all);
    const what = bodyweightOnly ? 'top reps' : 'est. 1RM';
    const trendRow = h('div', { class: 'trend-row' },
      trend
        ? h('span', { class: `trend-chip trend-${trend.dir}`, id: 'trend-chip' }, icon(TREND[trend.dir][0]), `${TREND[trend.dir][1]}`,
          h('span', { class: 'trend-sub' }, ` ${trend.change > 0 ? '+' : trend.change < 0 ? '−' : ''}${Math.abs(Math.round(trend.change * 100))}% ${what}, last 4 sessions`))
        : h('span', { class: 'trend-chip trend-none', id: 'trend-chip' }, icon('same'), 'Trend after 4 sessions'),
      stall.stalled
        ? h('p', { class: 'stall-note', id: 'stall-note' }, icon('info'),
          `Stalled: no new best ${what} in the last ${stall.since} sessions (best on ${formatShort(stall.bestDate, today)}).`)
        : null);

    const filters = h('div', { class: 'filters' },
      metrics.length > 1 ? h('div', { class: 'seg', role: 'group', 'aria-label': 'Metric' }, metrics.map((m) => h('button', {
        class: 'seg-btn', 'aria-pressed': String(m.id === metricId),
        onclick: () => { metricId = m.id; setPref('progressMetric', m.id); draw(); },
      }, m.label))) : null,
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Time range' }, RANGES.map((r) => h('button', {
        class: 'seg-btn', 'aria-pressed': String(r.id === rangeId),
        onclick: () => { rangeId = r.id; setPref('progressRange', r.id); draw(); },
      }, r.label))));

    const title = `${metric.label} per session`;
    let chart;
    if (hist.length >= 3) {
      chart = lineChart(hist.map((x) => ({ date: x.date, value: metric.value(x), highlight: metric.pr(x) })), {
        label: `${title}, ${exName(current.name)}`, format: metric.fmt, valueName: metric.name, prLabels: true,
      });
    } else {
      chart = h('p', { class: 'muted chart-empty' }, hist.length
        ? `The chart appears after three sessions in this range. You have ${hist.length}. The sessions are listed below.`
        : 'No sessions in this range. Pick a longer range.');
    }

    // Every session, newest first (the first 15 until you ask for all).
    const sessions = [...all].reverse();
    const visible = showAll ? sessions : sessions.slice(0, 15);
    body.replaceChildren(
      stats,
      trendRow,
      h('section', { class: `card chart-section t-${slugOf(current)}`, 'aria-labelledby': 'chart-h' },
        h('h2', { id: 'chart-h' }, title),
        filters,
        chart,
        metric.id === 'e1rm' ? h('p', { class: 'fine' }, 'Est. 1RM = weight × (1 + reps ÷ 30). PR marks a new best.') : null),
      h('section', { class: 'card list', 'aria-labelledby': 'recent-h' },
        h('h2', { id: 'recent-h', class: 'list-title' }, `History (${sessions.length})`),
        h('ul', { class: 'rows history' }, visible.map((x) => h('li', {},
          h('a', { href: `#/day/${x.date}`, class: 'recent-row' },
            h('span', { class: 'recent-date' }, formatShort(x.date, today)),
            h('span', { class: 'recent-sets num' }, formatSets(x.sets, true)),
            h('span', { class: 'recent-val num' },
              x.isE1rmPR || x.isWeightPR ? h('span', { class: 'pr-inline' }, icon('trophy'), h('span', { class: 'pr-tag' }, 'PR')) : null,
              metric.fmt(metric.value(x))))))),
        sessions.length > visible.length
          ? h('button', { class: 'btn subtle block', onclick: () => { showAll = true; draw(); } }, `Show all ${sessions.length} sessions`) : null));
  }
  draw();
}

function stat(label, value, sub) {
  return h('div', { class: 'stat' }, h('dt', {}, label), h('dd', { class: 'num stat-v' }, value), sub ? h('dd', { class: 'stat-sub' }, sub) : null);
}

/** Per exercise: best set for 1 / 3 / 5 / 8+ reps as a compact table; repeated sets merged. */
function renderRecords(view, list, today) {
  const recs = allRecords(list, today);
  view.append(
    h('p', { class: 'fine records-note' }, 'Heaviest set for at least that many reps. Only ticked working sets count.'),
    h('ul', { class: 'records' }, recs.map((r) => {
      const rows = recordRows(r);
      return h('li', { class: 'card rec' },
        h('div', { class: 'rec-head' },
          // One icon style for every record: the accent tile, not the colour of whichever session it was logged in.
          h('a', { class: 'rec-name', href: `#/progress/${encodeURIComponent(r.key)}` }, h('span', { class: 'ex-tile t-none' }, icon(groupIcon(store.primaryGroup(r.name)))), h('span', {}, exName(r.name))),
          r.e1rm ? h('span', { class: 'rec-1rm' }, 'Est. 1RM ', h('strong', { class: 'num' }, fmtWU(r.e1rm.value, 1))) : null),
        rows.length
          ? h('table', { class: 'rec-table' },
            h('caption', { class: 'sr-only' }, `${exName(r.name)} records`),
            h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Reps'), h('th', { scope: 'col' }, 'Best set'), h('th', { scope: 'col', class: 'n' }, 'Date'))),
            h('tbody', {}, rows.map((row) => h('tr', {},
              h('th', { scope: 'row', class: 'num' }, row.label),
              h('td', { class: 'num' }, `${fmtWU(row.weight)} × ${row.reps}`),
              h('td', { class: 'n' }, formatShort(row.date, today))))))
          : h('p', { class: 'muted' }, 'Bodyweight only. Add weight to set records.'));
    })));
}
