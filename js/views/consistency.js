// Progress → Consistency: how much of the plan gets done, how much is skipped, and the success rate.
// All figures come from consistency.js (the same definitions the calendar uses); nothing leaves the device.
import { h, icon, sheet, toast } from '../ui.js';
import * as store from '../store.js';
import { SKIP_REASONS } from '../model.js';
import { typeName } from '../types.js';
import {
  lastWeeks, currentWeek, summarize, thisWeekSoFar, weekStreaks, bestDayStreak, rollingAdherence, skipByType,
  skipByWeekday, missedDays, reasonCounts, MIN_PLANNED_WEEKS,
} from '../consistency.js';
import { currentStreak } from '../plan.js';
import { todayISO, formatShort, formatLong, weekdayLabels } from '../dates.js';
import { lineChart, barList, weekBars, withTable } from '../chart.js';

const RANGES = [
  { id: '4w', label: '4 weeks', weeks: 4 },
  { id: '12w', label: '12 weeks', weeks: 12 },
  { id: 'all', label: 'All time', weeks: null },
];
const pref = (k, fallback) => { try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; } };
const setPref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
const pct = (x) => `${Math.round(x * 100)}%`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const STATE_TEXT = {
  done: 'planned session done', movedin: 'workout done, covers a planned session from another day',
  moved: 'planned session done on another day this week', extra: 'extra workout',
  skipped: 'planned session skipped', pending: 'planned session not done yet', upcoming: 'planned',
  rest: 'rest day logged', none: 'nothing planned',
};
const HM_CLASS = {
  done: 'hm-done', movedin: 'hm-done', moved: 'hm-moved', extra: 'hm-extra', skipped: 'hm-skip', pending: 'hm-skip',
  upcoming: 'hm-empty', rest: 'hm-empty', none: 'hm-empty',
};

function infoSheet() {
  const def = (term, text) => [h('dt', {}, term), h('dd', {}, text)];
  return sheet({
    title: 'How this is counted',
    build: () => h('div', { class: 'stack' },
      h('dl', { class: 'defs' },
        def('Planned session', 'A training day in the weekly schedule that applied on that date, from the first day you used the app. Break days, future days and days before you started never count.'),
        def('Completed', 'A day with a finished workout (Finish workout) or at least one ticked set.'),
        def('Done', 'A planned session that was completed on its day, or moved to another day of the same week. A workout on a day with no plan or a Break day fills the earliest open planned session that week.'),
        def('Skipped', 'A planned session of a finished week that no completed workout covered. A day logged with Log rest day is not a skip: it is left out of the planned count.'),
        def('Extra', 'A completed workout on a day with no plan, or a Break day, that is not covering a missed session.'),
        def('Weekly adherence', 'Sessions done ÷ sessions planned, week by week, so each week is capped at 100%. A session moved within its week still counts. A session moved into the next week is a skip, and the workout counts there.'),
        def('On the day', 'Planned sessions done on their planned date ÷ planned sessions. Stricter.'),
        def('This week so far', 'The current week is never part of a percentage. It is shown separately until it ends.'),
        def('Not enough data', `Under ${MIN_PLANNED_WEEKS} finished weeks with a plan, no percentage is shown, only counts.`),
        def('Weekly streak', 'Consecutive weeks that hit the target: every planned session done, or your minimum sessions per week from Settings. Weeks with nothing planned are skipped, not broken.'),
        def('Day streak', 'Consecutive completed days. Break days and unplanned days never break it; a missed planned day does.')),
      h('p', { class: 'fine' }, 'Everything is worked out on this phone from your sessions and the schedule that applied on each date.')),
  });
}

/** One cell per day, a week per column, oldest week first. Tap a cell to open the day. */
function heatmap(weeks, weekStartsOn, today) {
  const names = weekdayLabels(weekStartsOn);
  const monthOf = (iso) => iso.slice(0, 7);
  const cells = [h('span', { class: 'hm-corner' }), ...names.map((n) => h('span', { class: 'hm-dow', 'aria-hidden': 'true' }, n.short))];
  weeks.forEach((w, i) => {
    const first = w.days[0].date;
    const newMonth = i === 0 || monthOf(first) !== monthOf(weeks[i - 1].days[0].date);
    cells.push(h('span', { class: 'hm-month', 'aria-hidden': 'true' },
      newMonth ? new Intl.DateTimeFormat(undefined, { month: 'short' }).format(new Date(+first.slice(0, 4), +first.slice(5, 7) - 1, 1, 12)) : ''));
    w.days.forEach((d) => {
      const future = d.date > today;
      cells.push(h('a', {
        class: `hm ${HM_CLASS[d.state]}${future ? ' hm-future' : ''}${d.date === today ? ' hm-today' : ''}`,
        href: `#/day/${d.date}`,
        dataset: { date: d.date, state: d.state },
        'aria-label': `${formatLong(d.date)}${d.date === today ? ' (today)' : ''}: ${d.type && d.state !== 'movedin' && d.state !== 'extra' ? `${typeName(d.type)}, ` : ''}${STATE_TEXT[d.state]}`,
      }));
    });
  });
  const grid = h('div', { class: 'hm-grid', style: `--weeks:${weeks.length}` }, cells);
  const scroll = h('div', { class: 'hm-scroll' }, grid);
  requestAnimationFrame(() => { scroll.scrollLeft = scroll.scrollWidth; });

  const key = (cls, label) => h('li', {}, h('span', { class: `hm-key ${cls}`, 'aria-hidden': 'true' }), label);
  const legend = h('ul', { class: 'legend hm-legend' },
    key('hm-done', 'Done'), key('hm-moved', 'Done on another day'), key('hm-extra', 'Extra'),
    key('hm-skip', 'Skipped or not done'), key('hm-empty', 'Rest or no plan'));
  const fig = h('figure', { class: 'chart hm-fig' }, scroll, legend);
  const table = h('table', { class: 'data-table' },
    h('caption', { class: 'sr-only' }, 'Planned and done sessions per week'),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Week'), ['Planned', 'Done', 'Skipped', 'Extra'].map((t) => h('th', { scope: 'col', class: 'n' }, t)))),
    h('tbody', {}, [...weeks].reverse().map((w) => h('tr', {},
      h('th', { scope: 'row' }, `${formatShort(w.start)}${w.complete ? '' : ' (so far)'}`),
      [w.planned, w.filled, w.complete ? w.skipped : '–', w.extra].map((n) => h('td', { class: 'n num' }, String(n)))))));
  return withTable(fig, table, 'Heatmap of the last weeks');
}

export function renderConsistency(view) {
  const today = todayISO();
  const ws = store.state.settings.weekStartsOn;
  const a = store.consistencyAnalysis(today);
  let rangeId = pref('consistencyRange', '12w');
  const body = h('div', { class: 'stack cons' });

  view.append(
    h('div', { class: 'section-head cons-top' },
      h('h2', {}, 'Consistency'),
      h('button', { class: 'btn small subtle', onclick: infoSheet }, icon('info'), 'How it’s counted')),
    body);

  if (!a.weeks.length) {
    body.append(h('section', { class: 'empty-state' },
      icon('calendar', 'empty-icon'),
      h('h2', {}, 'Nothing to measure yet'),
      h('p', { class: 'muted' }, 'Set a weekly plan in the Planner and log a workout. After two finished weeks you get a success rate.'),
      h('a', { class: 'btn primary', href: '#/plan' }, 'Open the planner')));
    return;
  }

  function draw() {
    const range = RANGES.find((r) => r.id === rangeId) ?? RANGES[1];
    const weeks = lastWeeks(a, range.weeks);
    const sum = summarize(weeks);
    const so = thisWeekSoFar(a);
    const cur = currentWeek(a);
    const weeklyMin = store.state.settings.weeklyMin;

    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Time range' }, RANGES.map((r) => h('button', {
      class: 'seg-btn', 'aria-pressed': String(r.id === rangeId), dataset: { range: r.id },
      onclick: () => { rangeId = r.id; setPref('consistencyRange', r.id); draw(); },
    }, r.label)));

    // 1. headline
    const headline = h('section', { class: 'card cons-head', 'aria-labelledby': 'cons-h' },
      h('h3', { id: 'cons-h', class: 'cons-label' }, 'Weekly adherence'),
      sum.enough
        ? h('div', { class: 'cons-row' },
          h('div', {}, h('div', { class: 'cons-big num', id: 'cons-pct' }, pct(sum.adherence)),
            h('p', { class: 'cons-sub', id: 'cons-sub' }, `${sum.done} of ${plural(sum.planned, 'planned session')}`)),
          h('div', { class: 'cons-side' }, h('div', { class: 'cons-mid num', id: 'cons-ontime' }, pct(sum.onTimeRate)), h('p', { class: 'cons-sub' }, 'on the day')))
        : h('div', {},
          h('div', { class: 'cons-nodata', id: 'cons-pct' }, 'Not enough data yet'),
          h('p', { class: 'cons-sub', id: 'cons-sub' }, `${sum.done} of ${plural(sum.planned, 'planned session')} in finished weeks.`),
          h('p', { class: 'fine' }, `A percentage appears after ${MIN_PLANNED_WEEKS} finished weeks with a plan. You have ${sum.weeks}.`)),
      so ? h('p', { class: 'cons-sub', id: 'cons-sofar' }, h('strong', { class: 'num' }, `${so.done} of ${so.planned}`), ' planned sessions this week so far', so.extra ? `, plus ${plural(so.extra, 'extra')}` : '') : null);

    // 2. done / skipped / extra
    const counts = h('section', { class: 'card', 'aria-labelledby': 'counts-h' },
      h('h3', { id: 'counts-h' }, 'Done, skipped and extra'),
      h('dl', { class: 'stat-row cons-counts' },
        stat('Done', sum.done, 'planned sessions', 'cnt-done'),
        stat('Skipped', sum.skipped, 'planned, not done', 'cnt-skipped'),
        stat('Extra', sum.extra, 'unplanned workouts', 'cnt-extra')),
      sum.rest ? h('p', { class: 'fine' }, `${plural(sum.rest, 'rest day')} logged on planned days. Not counted as skips.`) : null);

    // 3. streaks
    const ws3 = weekStreaks(a, weeklyMin);
    const dayNow = a.baseline ? currentStreak(store.realSession, store.state.schedule, today) : 0;
    const dayBest = a.baseline ? bestDayStreak(store.realSession, store.state.schedule, a.baseline, today) : 0;
    const streaks = h('section', { class: 'card', 'aria-labelledby': 'streak-h' },
      h('h3', { id: 'streak-h' }, 'Streaks'),
      h('dl', { class: 'stat-row' },
        stat('Weekly streak', ws3.current, `best ${ws3.best} week${ws3.best === 1 ? '' : 's'}`, 'streak-week'),
        stat('Day streak', dayNow, `best ${dayBest} day${dayBest === 1 ? '' : 's'}`, 'streak-day')),
      h('div', { class: 'field-row good-week' },
        h('label', { for: 'cons-min' }, 'Good week', h('small', {}, weeklyMin ? `${weeklyMin} or more workouts` : 'blank = every planned session done')),
        h('input', {
          id: 'cons-min', class: 'num-input', type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: 'plan', value: weeklyMin ?? '',
          'aria-describedby': 'cons-min-help',
          onchange: async (e) => {
            const raw = e.target.value.trim();
            const n = /^\d{1,2}$/.test(raw) ? Number(raw) : null;
            if (raw && (n == null || n < 1 || n > 14)) { toast('Enter 1 to 14, or leave blank.'); e.target.value = weeklyMin ?? ''; return; }
            await store.saveSettings({ weeklyMin: n });
            window.dispatchEvent(new HashChangeEvent('hashchange'));
          },
        })),
      h('p', { class: 'fine', id: 'cons-min-help' }, 'Set from sessions per week in your Profile. Streaks count weeks that reach it.'));

    // 4. weekly bars (finished weeks in range, plus the running week)
    const barWeeks = [...weeks, ...(cur ? [cur] : [])].slice(-52).map((w) => ({
      start: w.start, planned: w.planned, done: w.filled, extra: w.extra, partial: !w.complete,
    }));
    const bars = h('section', { class: 'card', 'aria-labelledby': 'bars-h' },
      h('h3', { id: 'bars-h' }, 'Planned and done per week'),
      barWeeks.length ? weekBars(barWeeks, { dateLabel: (d) => `Week of ${formatShort(d)}` }) : h('p', { class: 'muted' }, 'No finished weeks yet.'),
      cur ? h('p', { class: 'fine' }, 'The last bar is this week so far.') : null);

    // 5. heatmap
    const hmWeeks = a.weeks.slice(range.weeks == null ? -52 : -12);
    const heat = h('section', { class: 'card', 'aria-labelledby': 'heat-h' },
      h('h3', { id: 'heat-h' }, 'Day by day'),
      heatmap(hmWeeks, ws, today),
      h('p', { class: 'fine' }, 'Tap a day to open it.'));

    // 6. trend
    const first = weeks[0]?.start ?? '';
    const trendPts = rollingAdherence(a, 4).filter((p) => p.date >= first);
    const trend = h('section', { class: 'card', 'aria-labelledby': 'trend-h' },
      h('h3', { id: 'trend-h' }, 'Rolling 4-week adherence'),
      sum.enough && trendPts.length >= 3
        ? lineChart(trendPts, {
          label: 'Rolling 4-week adherence', format: (v) => `${v}%`, valueName: '4-week adherence',
          dateLabel: (d) => `Week of ${formatShort(d)}`,
        })
        : h('p', { class: 'muted chart-empty' }, 'The trend appears after three finished weeks with a plan.'));

    // 7. where I skip
    const rows = (list) => list.map((r) => ({ label: r.label, value: Math.round(r.rate * 100), detail: `${r.skipped} of ${r.planned}` }));
    const skipChart = (list, labelName, label) => barList(rows(list), {
      label, format: (v) => `${v}%`, valueName: 'Skip rate', labelName, detailName: 'Skipped', max: 100,
    });
    const where = h('section', { class: 'card', 'aria-labelledby': 'where-h' },
      h('h3', { id: 'where-h' }, 'Where I skip'),
      sum.enough
        ? h('div', { class: 'stack' },
          h('div', {}, h('p', { class: 'fine' }, 'By session type, most skipped first'), skipChart(skipByType(weeks), 'Session type', 'Skip rate by session type')),
          h('div', {}, h('p', { class: 'fine' }, 'By weekday, most skipped first'), skipChart(skipByWeekday(weeks, ws), 'Weekday', 'Skip rate by weekday')))
        : h('p', { class: 'muted' }, `This appears after ${MIN_PLANNED_WEEKS} finished weeks with a plan.`));

    // 8. skip reasons (optional)
    const missed = missedDays(a, [...weeks, ...(cur ? [cur] : [])]);
    const counted = reasonCounts(missed, store.state.skipReasons);
    const reasons = h('section', { class: 'card', 'aria-labelledby': 'why-h' },
      h('h3', { id: 'why-h' }, 'Skipped days'),
      h('p', { class: 'fine' }, 'Optional. Tap a reason to note why a planned day didn’t happen. It stays on this phone.'),
      Object.keys(counted).length
        ? h('dl', { class: 'reason-counts', id: 'reason-counts' }, SKIP_REASONS.filter((r) => counted[r]).map((r) => h('div', {},
          h('dt', {}, r), h('dd', { class: 'num' }, String(counted[r])))))
        : null,
      missed.length
        ? h('ul', { class: 'rows missed-list' }, missed.slice(0, 8).map((d) => h('li', { class: 'missed-row' },
          h('a', { href: `#/day/${d.date}`, class: 'missed-day' }, h('span', {}, `${formatShort(d.date)}`), h('span', { class: 'muted' }, ` ${typeName(d.type)}`)),
          reasonChips(d.date, () => draw()))))
        : h('p', { class: 'muted' }, 'No skipped days in this range.'));

    body.replaceChildren(seg, headline, counts, streaks, bars, heat, trend, where, reasons);
  }

  function reasonChips(date, after) {
    const cur = store.state.skipReasons[date] ?? null;
    return h('div', { class: 'reasons', role: 'group', 'aria-label': `Reason for ${formatShort(date)}` }, SKIP_REASONS.map((r) => h('button', {
      class: 'reason', 'aria-pressed': String(cur === r), dataset: { date, reason: r },
      onclick: async () => {
        await store.setSkipReason(date, cur === r ? null : r);
        after();
        body.querySelector(`.reason[data-date="${date}"][data-reason="${r}"]`)?.focus({ preventScroll: true });
      },
    }, r)));
  }

  draw();
}

function stat(label, value, sub, id) {
  return h('div', { class: 'stat' }, h('dt', {}, label), h('dd', { class: 'num stat-v', id }, String(value)), sub ? h('dd', { class: 'stat-sub' }, sub) : null);
}
