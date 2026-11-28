import { h, icon, plate } from '../ui.js';
import { APP_NAME } from '../brand.js';
import * as store from '../store.js';
import { BREAK } from '../model.js';
import { typeName, typeShort, typeColor } from '../types.js';
import { dayStatus, weekProgress, progressState, currentStreak } from '../plan.js';
import { monthStats } from '../consistency.js';
import { weeklyReview } from '../review.js';
import { fmtInt, fmtNum } from '../stats.js';
import {
  todayISO, monthOf, monthKey, parseMonthKey, addMonths, monthGrid, formatMonthTitle, weekdayLabels, formatLong,
  startOfWeek, addDays, formatShort,
} from '../dates.js';
import { installState, installButton } from '../pwa.js';
import { openMusclePrompt } from './bodymap.js';
import { fmtWU, fmtLU, shownVolume, wUnit } from '../units.js';
import { reviewFocus } from '../profile.js';
import { cardioTotals } from '../cardio.js';

const STATE_WORDS = {
  done: 'completed', rest: 'rest day logged', break: 'break day', planned: 'planned', missed: 'missed', none: '',
};
const WEEK_MS = 7 * 24 * 3600 * 1000;

/** A real session (ignores days that were opened but left untouched). */
const sessionOn = (iso) => {
  const s = store.getSession(iso);
  return s && !store.isEmpty(s) ? s : null;
};

function describe(st) {
  if (st.state === 'none') return '';
  if (st.state === 'done') return `, completed${st.type ? `: ${typeName(st.type)}` : ''}`;
  if (st.state === 'rest' || st.state === 'break') return `, ${STATE_WORDS[st.state]}`;
  return `, ${STATE_WORDS[st.state]}: ${typeName(st.type)}${st.fromSession && st.sched && st.sched !== st.type ? ` (changed from ${typeName(st.sched)})` : ''}`;
}

/** A day with a cardio entry (part of that day's one session): a small badge on its cell. */
const hasCardio = (iso) => (sessionOn(iso)?.exercises ?? []).some((e) => e.kind === 'cardio');

/** Plate + short name for a day's status, or null. */
function marker(st, withLabel = true) {
  // Colour is never the only cue: every plate sits with the type's short label (name or initials).
  const color = st.type ? typeColor(st.type) : 'neutral';
  const short = st.type ? typeShort(st.type) : 'Done';
  const label = (text) => (withLabel ? h('span', { class: 'plate-label', title: st.type ? typeName(st.type) : null }, text) : null);
  switch (st.state) {
    case 'done': return [plate('done', color), label(short)];
    case 'planned': return [plate('planned', color, st.fromSession ? 'override' : ''), label(short)];
    case 'missed': return [plate('missed', color), label(short)];
    case 'rest': return [plate('rest', 'break'), label('Rest')];
    case 'break': return [plate('break', 'break'), label('Break')];
    default: return null;
  }
}

export function renderCalendar(root, monthArg) {
  const today = todayISO();
  const ym = parseMonthKey(monthArg) ?? monthOf(today);
  const { weekStartsOn } = store.state.settings;
  const { schedule } = store.state;
  const isCurrentMonth = monthKey(ym) === monthKey(monthOf(today));
  const go = (delta) => location.replace(`#/cal/${monthKey(addMonths(ym, delta))}`);

  const summaryLine = h('p', { class: 'cal-summary' });
  const header = h('header', { class: 'topbar cal-top' },
    h('div', { class: 'topbar-title' }, h('h1', { tabindex: '-1' }, formatMonthTitle(ym)), summaryLine),
    h('div', { class: 'topbar-actions' },
      isCurrentMonth ? null : h('button', { class: 'btn small subtle', onclick: () => location.replace(`#/cal/${monthKey(monthOf(today))}`) }, 'Today'),
      h('button', { class: 'icon-btn', 'aria-label': 'Previous month', onclick: () => go(-1) }, icon('chevL')),
      h('button', { class: 'icon-btn', 'aria-label': 'Next month', onclick: () => go(1) }, icon('chevR'))));

  const labels = weekdayLabels(weekStartsOn);
  const weekdays = h('div', { class: 'cal-weekdays', 'aria-hidden': 'true' }, labels.map((l) => h('span', {}, l.short)));

  let doneInMonth = 0;
  const cells = monthGrid(ym, weekStartsOn).map(({ iso, day, inMonth }) => {
    const st = dayStatus(iso, sessionOn(iso), schedule, today);
    if (inMonth && st.state === 'done') doneInMonth++;
    const weighed = store.state.body.get(iso);
    const cls = ['cal-day', `s-${st.state}`, st.type ? `t-${typeColor(st.type)}` : '', inMonth ? '' : 'out', iso === today ? 'today' : '', iso > today ? 'future' : ''].join(' ');
    return h('a', {
      class: cls,
      href: `#/day/${iso}`,
      'aria-label': `${formatLong(iso)}${iso === today ? ' (today)' : ''}${describe(st)}${hasCardio(iso) ? ', with cardio' : ''}${weighed ? (weighed.weight != null ? `, weigh-in ${fmtWU(weighed.weight)}` : ', measurements logged') : ''}`,
      'aria-current': iso === today ? 'date' : null,
    },
    h('span', { class: 'cal-num num' }, day),
    marker(st), // plate + short name: colour is never the only cue
    weighed ? h('span', { class: 'cal-body', title: 'Body log entry' }) : null,
    hasCardio(iso) ? h('span', { class: 'cal-cardio', title: 'Cardio' }, icon('run')) : null);
  });

  const grid = h('div', { class: 'cal-grid' }, cells);
  // Swipe left/right to change month.
  let sx = 0;
  let sy = 0;
  grid.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  grid.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 50) go(dx < 0 ? 1 : -1);
  });

  // ---------- month summary: workouts, consistency, streak ----------
  const first = `${monthKey(ym)}-01`;
  const lastDay = addDays(monthKey(addMonths(ym, 1)) + '-01', -1);
  // Same definitions as Progress → Consistency: finished weeks only, and no percentage on thin data.
  const cons = monthStats(store.consistencyAnalysis(today), first, lastDay);
  const streak = currentStreak(sessionOn, schedule, today);
  const pct = cons.enough && cons.adherence != null ? Math.round(cons.adherence * 100) : null;
  summaryLine.textContent = cons.planned ? `${cons.done} of ${cons.planned} planned done` : isCurrentMonth ? 'Your first finished week shows here' : 'Nothing planned and finished';
  const summary = h('dl', { class: 'month-stats' },
    h('div', {}, h('dt', {}, 'Workouts'), h('dd', { class: 'num' }, String(doneInMonth))),
    h('div', {}, h('dt', {}, 'Consistency'), h('dd', { class: 'num' }, pct == null ? '–' : `${pct}%`,
      h('small', {}, !cons.planned ? 'No finished weeks yet'
        : cons.enough ? `${cons.done} of ${cons.planned} planned`
          : `Not enough data yet. ${cons.done} of ${cons.planned} planned`))),
    h('div', {}, h('dt', {}, 'Streak'), h('dd', { class: 'num' }, String(streak), h('small', {}, `workout${streak === 1 ? '' : 's'} in a row`))));

  const legend = h('details', { class: 'legend-d' },
    h('summary', {}, 'Key'),
    h('ul', { class: 'legend-list' },
      h('li', {}, plate('done', 'red'), 'Done (the colour and short name show the type)'),
      h('li', {}, plate('planned', 'red'), 'Planned'),
      h('li', {}, plate('missed', 'red'), 'Missed'),
      h('li', {}, plate('break', 'break'), 'Break day'),
      h('li', {}, plate('rest', 'break'), 'Rest day logged'),
      h('li', {}, h('span', { class: 'cal-body inline', 'aria-hidden': 'true' }), 'Weigh-in')),
    h('a', { href: '#/plan', class: 'link' }, 'Edit the weekly plan'));

  // Slim brand row: scrolls away with the page; the month title below stays the screen's heading.
  const who = store.state.profile.name;
  // The wordmark alone is the logo here (no icon glyph).
  const brand = h('p', { class: 'brand-row' }, h('span', { class: 'wordmark' }, APP_NAME),
    who ? h('span', { class: 'brand-hi' }, `Hi, ${who}`) : null);

  root.append(h('div', { class: 'view cal-view' },
    brand,
    header,
    profileCard() ?? musclePrompt() ?? backupNudge() ?? installBanner(), // one banner at a time: one-time cards first
    todayActions(today, schedule),
    weekStrip(today, weekStartsOn),
    h('section', { class: 'card cal-month', 'aria-label': formatMonthTitle(ym) }, weekdays, grid),
    summary,
    legend,
    reviewCard(today, weekStartsOn)));
}

function todayActions(today, schedule) {
  const session = sessionOn(today);
  const st = dayStatus(today, session, schedule, today);
  const prog = progressState(session);
  const type = st.type && st.type !== BREAK ? st.type : null;
  const slug = type ? typeColor(type) : null;
  const tn = type ? typeName(type) : null;
  const go = (cls, ic, text, sub) => h('a', { class: `btn block today-cta ${cls}${slug ? ` t-${slug}` : ''}`, href: `#/day/${today}` },
    icon(ic), h('span', {}, text), sub ? h('span', { class: 'cta-sub' }, sub) : null);
  let main;
  if (st.state === 'done' && prog === 'finished') main = go('done-cta', 'circle-check', `Today’s ${tn ?? 'workout'} done`, 'View');
  else if (st.state === 'done') main = go('session', 'dumbbell', `Continue today’s ${tn ?? 'workout'}`);
  else if (st.state === 'planned') main = go('session', 'dumbbell', `Start today’s ${tn}`);
  else if (st.state === 'break') main = go('soft', 'moon', 'Break day today');
  else if (st.state === 'rest') main = go('soft', 'check', 'Rest day logged');
  else main = go('accent', 'plus', 'Log today’s workout');
  const weighed = store.state.body.get(today)?.weight != null ? store.state.body.get(today) : null; // the button shows a weight
  return h('div', { class: 'today-actions' }, main,
    h('a', { class: `btn soft weigh-btn${weighed ? ' has-value' : ''}`, href: `#/progress/~body/${today}`, 'aria-label': weighed ? `Weigh-in ${fmtWU(weighed.weight)}. Edit` : 'Log weigh-in', title: 'Log weigh-in' },
      icon('scale'), weighed ? h('span', { class: 'num' }, fmtWU(weighed.weight)) : null));
}

function weekStrip(today, weekStartsOn) {
  const wk = weekProgress(sessionOn, store.state.schedule, today, weekStartsOn);
  const cardioMin = cardioTotals(store.allSessions(), startOfWeek(today, weekStartsOn), today).minutes;
  const names = weekdayLabels(weekStartsOn);
  return h('section', { class: 'week-strip', 'aria-labelledby': 'week-h' },
    h('div', { class: 'section-head' },
      h('h2', { id: 'week-h' }, 'This week'),
      h('span', { class: 'week-count' }, h('strong', { class: 'num' }, `${wk.completed} of ${wk.planned}`), ' done',
        cardioMin ? h('span', { class: 'week-cardio', id: 'week-cardio' }, ' · ', h('strong', { class: 'num' }, fmtNum(cardioMin, 1)), ' min cardio') : null)),
    h('ol', { class: 'week-days' }, wk.days.map((d, i) => {
      const slug = d.type ? typeColor(d.type) : 'none';
      return h('li', {},
        h('a', {
          class: `wd s-${d.state} t-${slug}${d.date === today ? ' today' : ''}`,
          href: `#/day/${d.date}`,
          'aria-label': `${names[i].long}${d.date === today ? ' (today)' : ''}${describe(d) || ', nothing planned'}`,
          'aria-current': d.date === today ? 'date' : null,
        },
        h('span', { class: 'wd-name' }, names[i].short),
        d.state === 'done' || d.state === 'rest'
          ? h('span', { class: 'wd-check' }, icon('check'))
          : marker(d, false) ?? h('span', { class: 'plate p-none' }),
        h('span', { class: 'plate-label' }, d.type ? typeShort(d.type) : '–')));
    })));
}

function reviewCard(today, weekStartsOn) {
  let which = 'this';
  const holder = h('div');
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Week to review' });
  function draw() {
    const start = startOfWeek(today, weekStartsOn);
    const r = weeklyReview({
      sessions: store.allSessions(), getSession: sessionOn, schedule: store.state.schedule,
      body: store.bodyEntries(), start: which === 'this' ? start : addDays(start, -7), today,
    });
    seg.replaceChildren(...[['this', 'This week'], ['last', 'Last week']].map(([id, label]) => h('button', {
      class: 'seg-btn', 'aria-pressed': String(id === which), onclick: () => { which = id; draw(); },
    }, label)));
    const delta = r.prevVolume ? Math.round(((r.volume - r.prevVolume) / r.prevVolume) * 100) : null;
    const bw = r.bodyChange;
    // The goal picks which figure leads and adds a one-line summary (profile.js reviewFocus).
    const focus = reviewFocus(store.state.profile.goal, r, (kg) => fmtWU(kg, 1), (cm) => fmtLU(cm, 1));
    const items = {
      sessions: h('div', {}, h('dt', {}, 'Sessions'), h('dd', { class: 'num' }, `${r.done} of ${r.planned}`), h('dd', { class: 'sub' }, 'done of planned')),
      volume: h('div', {}, h('dt', {}, 'Volume'), h('dd', { class: 'num' }, `${fmtInt(shownVolume(r.volume))} ${wUnit()}`),
        h('dd', { class: 'sub' }, delta == null ? 'Nothing the week before' : `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta)}% vs the week before`)),
      prs: h('div', {}, h('dt', {}, 'PRs'), h('dd', { class: 'num' }, String(r.prs)), h('dd', { class: 'sub' }, r.prs ? 'new records' : 'none yet')),
      waist: h('div', {}, h('dt', {}, 'Waist'), h('dd', { class: 'num' }, r.waistChange == null ? '–' : `${r.waistChange > 0 ? '+' : r.waistChange < 0 ? '−' : '±'}${fmtLU(Math.abs(r.waistChange), 1)}`),
        h('dd', { class: 'sub' }, r.waistChange == null ? 'Measure this week and last' : 'vs your last measurement')),
      bodyweight: h('div', {}, h('dt', {}, 'Bodyweight'), h('dd', { class: 'num' }, bw == null ? '–' : `${bw > 0 ? '+' : bw < 0 ? '−' : '±'}${fmtWU(Math.abs(bw), 1)}`),
        h('dd', { class: 'sub' }, bw == null ? 'Weigh in to see a trend' : '7-day average')),
    };
    holder.replaceChildren(
      h('p', { class: 'fine' }, `${formatShort(r.start, today)} to ${formatShort(r.end, today)}`),
      ...(focus.headline ? [h('p', { class: 'review-headline' }, focus.headline)] : []), // replaceChildren would print a null
      h('dl', { class: 'review' }, focus.order.map((k) => items[k])),
      r.prLines.length ? h('ul', { class: 'pr-list' }, r.prLines.slice(0, 4).map((l) => h('li', {}, icon('trophy'), h('span', { class: 'pr-tag' }, 'PR'), ` ${l}`))) : null);
  }
  draw();
  return h('section', { class: 'card review-card', 'aria-labelledby': 'review-h' },
    h('div', { class: 'section-head' }, h('h2', { id: 'review-h' }, 'Weekly review'), seg),
    holder);
}

/** Data from before profiles (schema v6): a one-time, dismissible nudge instead of the first-run flow. */
function profileCard() {
  const p = store.state.profile;
  if (p.onboarding !== 'existing' || p.setupCardDismissed) return null;
  const el = h('aside', { class: 'banner', 'aria-label': 'Set up your profile' },
    h('span', { class: 'banner-ic' }, icon('user')),
    h('p', {}, h('strong', {}, 'Set up your profile. '), 'Units, goal and experience tune hints and rest times. Stays on this phone.'),
    h('a', { class: 'btn small accent', href: '#/settings/profile' }, 'Set up'),
    h('button', {
      class: 'icon-btn small', 'aria-label': 'Dismiss: don’t show again',
      onclick: async () => { el.remove(); await store.saveProfile({ setupCardDismissed: true }); },
    }, icon('x')));
  return el;
}

/** One-time question for exercises the library didn't recognise (after the v5 migration or a new name). */
function musclePrompt() {
  const list = store.exercisesNeedingMuscle();
  if (!list.length) return null;
  const el = h('aside', { class: 'banner', 'aria-label': 'Muscles to choose' },
    h('span', { class: 'banner-ic' }, icon('man')),
    h('p', {}, list.length === 1 ? `Which muscle does ${list[0].name} train?` : `Which muscles do ${list.length} of your exercises train?`),
    h('button', { class: 'btn small accent', onclick: async () => { await openMusclePrompt(); window.dispatchEvent(new HashChangeEvent('hashchange')); } }, 'Choose muscles'),
    h('button', {
      class: 'icon-btn small', 'aria-label': 'Skip: don’t ask again',
      onclick: async () => { for (const r of list) await store.setPrimaryMuscle(r.name, null); el.remove(); },
    }, icon('x')));
  return el;
}

function backupNudge() {
  const hasData = store.allSessions().some((s) => !store.isEmpty(s));
  const last = store.state.lastExportAt;
  if (!hasData || (last && Date.now() - last < WEEK_MS)) return null;
  let dismissedAt = 0;
  try { dismissedAt = Number(localStorage.getItem('backupNudgeDismissedAt')) || 0; } catch { /* storage blocked */ }
  if (Date.now() - dismissedAt < WEEK_MS) return null;
  const el = h('aside', { class: 'banner', 'aria-label': 'Backup reminder' },
    h('span', { class: 'banner-ic' }, icon('download')),
    h('p', {}, last ? 'No backup in 7 days. ' : 'No backup yet. ', 'Your workouts only live on this phone.'),
    h('a', { class: 'btn small accent', href: '#/settings/backup' }, 'Back up now'),
    h('button', {
      class: 'icon-btn small', 'aria-label': 'Dismiss for a week',
      onclick: () => { try { localStorage.setItem('backupNudgeDismissedAt', String(Date.now())); } catch { /* ignore */ } el.remove(); },
    }, icon('x')));
  return el;
}

/** One-time, dismissible "Install VANE" card (dismissal remembered). Nothing once installed or if the browser can't. */
function installBanner() {
  let dismissed = false;
  try { dismissed = localStorage.getItem('installBannerDismissed') === '1'; } catch { /* storage blocked: show it */ }
  const st = installState();
  if (dismissed || (st !== 'prompt' && st !== 'ios')) return null;
  const banner = h('aside', { class: 'banner install-card', id: 'install-card', 'aria-label': 'Install VANE' },
    h('span', { class: 'banner-ic' }, icon('phone')),
    h('p', {}, st === 'ios' ? 'Add VANE to your home screen: full screen, offline, one tap away.' : 'Install VANE: full screen, offline, one tap away.'),
    installButton('btn small accent'),
    h('button', {
      class: 'icon-btn small', 'aria-label': 'Dismiss: don’t show again',
      onclick: () => {
        try { localStorage.setItem('installBannerDismissed', '1'); } catch { /* ignore */ }
        banner.remove();
      },
    }, icon('x')));
  return banner;
}
