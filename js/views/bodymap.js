// Progress → Body map: weekly sets per muscle group on a simple front/back figure (original artwork made of
// plain shapes), coloured on a validated single-hue ramp and always labelled with the group and its number.
import { h, icon, sheet, toast } from '../ui.js';
import * as store from '../store.js';
import { exName } from '../library.js';
import { GROUPS } from '../muscles.js';
import {
  weeklySets, targetFor, statusFor, STATUS_LABEL, rampLevel, undertrained, exercisesForGroup, lastTrained, plannedByGroup,
} from '../volume.js';
import { scheduledFor, templateFor } from '../plan.js';
import { isCompleteSet, fmtNum } from '../stats.js';
import { todayISO, startOfWeek, formatShort } from '../dates.js';
import { withTable } from '../chart.js';

const NS = 'http://www.w3.org/2000/svg';
const pref = (k, fallback) => { try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; } };
const setPref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
const num = (n) => fmtNum(n, 1);
const setsText = (n) => `${num(n)} set${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------------------
// The figure. Silhouette pieces are neutral; muscle regions are drawn over them. x is mirrored about 170.
// ---------------------------------------------------------------------------
const mirror = (shape) => {
  if (shape.el === 'ellipse') return { ...shape, cx: 340 - shape.cx };
  if (shape.el === 'rect') return { ...shape, x: 340 - shape.x - shape.w };
  return { ...shape, d: shape.d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (m, x, y) => `${340 - Number(x)} ${y}`) };
};
const pair = (shape) => [shape, mirror(shape)];
const E = (cx, cy, rx, ry) => ({ el: 'ellipse', cx, cy, rx, ry });
const R = (x, y, w, hh, r = 6) => ({ el: 'rect', x, y, w, h: hh, r });
const P = (d) => ({ el: 'path', d });

const SILHOUETTE = [
  E(170, 40, 22, 24), R(160, 58, 20, 22, 6),
  P('M 128 82 Q 170 70 212 82 L 218 202 Q 170 216 122 202 Z'),
  ...pair(R(99, 86, 26, 78, 12)), ...pair(R(100, 160, 22, 80, 11)), ...pair(E(111, 250, 10, 13)),
  P('M 124 198 L 216 198 L 212 240 L 128 240 Z'),
  ...pair(R(128, 232, 40, 108, 18)), ...pair(R(132, 334, 32, 92, 14)), ...pair(E(148, 432, 16, 8)),
];

/** Regions: group, shapes, the label side and height, and where the leader line points. */
const FRONT = [
  { group: 'Neck', label: 'Neck', shapes: [R(162, 62, 16, 14, 5)], side: 'right', y: 64, at: [178, 69] },
  { group: 'Shoulders', label: 'Shoulders', shapes: pair(E(124, 97, 15, 14)), side: 'left', y: 92, at: [110, 97] },
  { group: 'Chest', label: 'Chest', shapes: pair(P('M 146 92 Q 166 88 168 96 L 168 126 Q 150 132 137 121 Q 135 104 146 92 Z')), side: 'right', y: 116, at: [196, 110] },
  { group: 'Biceps', label: 'Biceps', shapes: pair(E(112, 128, 9, 22)), side: 'left', y: 134, at: [103, 128] },
  { group: 'Abs', label: 'Abs', shapes: [R(152, 134, 36, 62, 10)], side: 'right', y: 168, at: [188, 165] },
  { group: 'Forearms', label: 'Forearms', shapes: pair(E(111, 192, 8, 24)), side: 'left', y: 188, at: [103, 192] },
  { group: 'Adductors/Abductors', label: 'Adductors', shapes: pair(E(164, 262, 6, 22)), side: 'right', y: 232, at: [176, 256] },
  { group: 'Quads', label: 'Quads', shapes: pair(E(148, 284, 15, 44)), side: 'left', y: 280, at: [133, 284] },
  { group: 'Calves', label: 'Calves', shapes: pair(E(148, 376, 10, 30)), side: 'right', y: 360, at: [200, 376] },
];
const BACK = [
  { group: 'Neck', label: 'Neck', shapes: [R(162, 62, 16, 14, 5)], side: 'right', y: 64, at: [178, 69] },
  { group: 'Shoulders', label: 'Shoulders', shapes: pair(E(124, 97, 15, 14)), side: 'left', y: 92, at: [110, 97] },
  {
    group: 'Back', label: 'Back',
    shapes: [P('M 170 76 L 198 90 L 170 120 L 142 90 Z'), ...pair(P('M 139 104 Q 131 140 149 176 L 166 168 L 166 124 Z'))],
    side: 'right', y: 120, at: [200, 126],
  },
  { group: 'Triceps', label: 'Triceps', shapes: pair(E(112, 128, 9, 22)), side: 'left', y: 134, at: [103, 128] },
  { group: 'Lower back', label: 'Lower back', shapes: [R(154, 170, 32, 28, 8)], side: 'right', y: 180, at: [186, 184] },
  { group: 'Forearms', label: 'Forearms', shapes: pair(E(111, 192, 8, 24)), side: 'left', y: 188, at: [103, 192] },
  { group: 'Glutes', label: 'Glutes', shapes: pair(E(152, 222, 17, 16)), side: 'right', y: 232, at: [205, 222] },
  { group: 'Adductors/Abductors', label: 'Abductors', shapes: pair(E(131, 228, 5, 14)), side: 'left', y: 238, at: [126, 228] },
  { group: 'Hamstrings', label: 'Hamstrings', shapes: pair(E(149, 286, 15, 40)), side: 'left', y: 296, at: [134, 286] },
  { group: 'Calves', label: 'Calves', shapes: pair(E(148, 372, 12, 30)), side: 'right', y: 360, at: [202, 372] },
];

function shapeEl(sh) {
  if (sh.el === 'ellipse') return `<ellipse cx="${sh.cx}" cy="${sh.cy}" rx="${sh.rx}" ry="${sh.ry}"/>`;
  if (sh.el === 'rect') return `<rect x="${sh.x}" y="${sh.y}" width="${sh.w}" height="${sh.h}" rx="${sh.r}"/>`;
  return `<path d="${sh.d}"/>`;
}

function figure(regions, data, { onOpen, title }) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 340 450');
  svg.setAttribute('class', 'bodymap-svg');
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', title);
  svg.innerHTML = `<g class="bm-silhouette" aria-hidden="true">${SILHOUETTE.map(shapeEl).join('')}</g>`;
  for (const r of regions) {
    const d = data[r.group];
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', `bm-region lvl-${d.level}`);
    g.setAttribute('role', 'button');
    g.setAttribute('tabindex', '0');
    g.dataset.group = r.group;
    g.setAttribute('aria-label', `${r.group}: ${setsText(d.sets)} ${d.unit}, target ${d.target}. ${STATUS_LABEL[d.status]}. Open details`);
    const left = r.side === 'left';
    const tx = left ? 6 : 334;
    const lx = left ? 84 : 256; // where the leader line starts, beside the label column
    g.innerHTML = `${r.shapes.map(shapeEl).join('')}`
      + `<line class="bm-leader" x1="${lx}" y1="${r.y + 2}" x2="${r.at[0]}" y2="${r.at[1]}"/><circle class="bm-dot" cx="${r.at[0]}" cy="${r.at[1]}" r="2.5"/>`
      + `<text class="bm-name" x="${tx}" y="${r.y}" text-anchor="${left ? 'start' : 'end'}">${r.label}</text>`
      + `<text class="bm-num" x="${tx}" y="${r.y + 16}" text-anchor="${left ? 'start' : 'end'}">${num(d.sets)}${d.status === 'under' || d.status === 'none' ? ' ↓' : ''}</text>`;
    g.addEventListener('click', () => onOpen(r.group));
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(r.group); } });
    svg.append(g);
  }
  return svg;
}

// ---------------------------------------------------------------------------
// "Which muscle does this train?" — asked once for exercises the library didn't recognise.
// ---------------------------------------------------------------------------
export async function openMusclePrompt() {
  const list = store.exercisesNeedingMuscle();
  if (!list.length) return false;
  await sheet({
    title: 'Which muscle does this train?',
    build: (close) => {
      const rows = list.map((r) => h('div', { class: 'field-row' },
        h('label', { for: `mp-${r.key}` }, r.name),
        h('select', { id: `mp-${r.key}`, dataset: { name: r.name } }, h('option', { value: '' }, 'Skip'), GROUPS.map((g) => h('option', { value: g }, g)))));
      return h('form', {
        class: 'stack',
        onsubmit: async (e) => {
          e.preventDefault();
          for (const sel of e.currentTarget.querySelectorAll('select')) await store.setPrimaryMuscle(sel.dataset.name, sel.value || null);
          close(true);
        },
      },
      h('p', { class: 'fine' }, 'These exercises aren’t in the library, so the body map doesn’t know what they train. Pick the main muscle, or skip. You only get asked once; change it later in the Planner.'),
      h('div', { class: 'card stack-tight' }, rows),
      h('button', { class: 'btn primary block', type: 'submit' }, icon('check'), 'Save muscles'));
    },
  });
  return true;
}

function infoSheet() {
  const def = (t, d) => [h('dt', {}, t), h('dd', {}, d)];
  sheet({
    title: 'How it’s counted',
    build: () => h('div', { class: 'stack' },
      h('dl', { class: 'defs' },
        def('Sets', 'Only ticked working sets count. Warm-ups, unticked and planned sets never do. Failure sets count.'),
        def('Main and helping muscles', 'Each set counts 1 for the exercise’s main muscle group and 0.5 for each group it also works (from the exercise library, or what you chose for a custom exercise).'),
        def('This week', 'From the first day of this week up to today.'),
        def('Last 4 weeks', 'The four finished weeks before this one, added up and divided by 4: an average per week.'),
        def('Target', 'Weekly sets per muscle group, 10 unless you change it in Settings.'),
        def('Undertrained', 'Under half of the target. “No sets yet” means nothing counted in this window.'),
        def('Planned', 'This week’s sets from your workouts, or from the weekly plan’s templates for days you haven’t opened yet.')),
      h('p', { class: 'fine' }, 'Muscle groups come from the free-exercise-db library (public domain). Lats, mid back and traps show as Back.')),
  });
}

export function renderBodyMap(view) {
  const today = todayISO();
  const ws = store.state.settings.weekStartsOn;
  const list = store.allSessions();
  let mode = pref('bodymapWindow', 'week') === '4w' ? '4w' : 'week';
  let side = pref('bodymapSide', 'front') === 'back' ? 'back' : 'front';
  const body = h('div', { class: 'stack bodymap' });
  view.append(
    h('div', { class: 'section-head' },
      h('h2', {}, 'Body map'),
      h('button', { class: 'btn small subtle', onclick: infoSheet }, icon('info'), 'How it’s counted')),
    body);

  const groupsOf = (name) => store.groupsOf(name);
  const anySets = list.some((s) => s.date <= today && s.exercises.some((e) => e.sets.some(isCompleteSet)));
  const fallback = store.state.settings.muscleTarget ?? 10;
  const targets = store.state.settings.muscleTargets ?? {};

  function data() {
    const w = weeklySets(list, { mode, today, weekStartsOn: ws, groupsOf });
    const unit = mode === '4w' ? 'per week' : 'this week';
    const out = {};
    for (const g of GROUPS) {
      const target = targetFor(g, targets, fallback);
      const sets = w.perWeek[g];
      out[g] = { sets, target, unit, status: statusFor(sets, target), level: rampLevel(sets, target) };
    }
    return { out, w };
  }

  function openMuscle(group) {
    const { out, w } = data();
    const d = out[group];
    const weekStart = startOfWeek(today, ws);
    const planned = plannedByGroup({
      weekStart, getSession: store.realSession, plannedTypeFor: (date) => scheduledFor(date, store.state.schedule),
      templateFor: (type) => templateFor(type, store.state.templates), groupsOf,
    })[group];
    const doneThisWeek = weeklySets(list, { mode: 'week', today, weekStartsOn: ws, groupsOf }).perWeek[group];
    const exercises = exercisesForGroup(list, group, w.from, w.to, groupsOf, today);
    const last = lastTrained(list, group, groupsOf, today);
    sheet({
      title: group,
      build: () => h('div', { class: 'stack' },
        h('dl', { class: 'summary' },
          h('div', {}, h('dt', {}, mode === '4w' ? 'Sets per week' : 'Sets this week'), h('dd', { class: 'num', id: 'ms-sets' }, num(d.sets))),
          h('div', {}, h('dt', {}, 'Weekly target'), h('dd', { class: 'num' }, String(d.target))),
          h('div', {}, h('dt', {}, 'Planned this week'), h('dd', { class: 'num', id: 'ms-planned' }, num(planned)), h('dd', { class: 'stat-sub' }, `${num(doneThisWeek)} done so far`)),
          h('div', {}, h('dt', {}, 'Last trained'), h('dd', { class: 'num ms-last' }, last ? formatShort(last, today) : 'Not yet'))),
        h('p', { class: `status-pill st-${d.status}` }, STATUS_LABEL[d.status]),
        h('h3', {}, mode === '4w' ? 'Exercises, last 4 weeks' : 'Exercises this week'),
        exercises.length
          ? h('ul', { class: 'rows ms-exercises' }, exercises.map((x) => h('li', {},
            h('a', { class: 'recent-row ms-row', href: `#/progress/${encodeURIComponent(x.name.toLowerCase())}` },
              h('span', { class: 'ms-name' }, exName(x.name)),
              h('span', { class: 'muted' }, x.role === 'primary' ? 'Main' : 'Also works'),
              h('span', { class: 'num' }, setsText(x.sets))))))
          : h('p', { class: 'muted' }, 'No sets yet in this window. Exercises that train it show up here once you tick a set.'),
        h('a', { class: 'link', href: '#/settings/targets' }, 'Change the weekly target')),
    });
  }

  function draw() {
    const { out } = data();
    const seg = (label, opts, cur, set, key) => h('div', { class: 'seg', role: 'group', 'aria-label': label }, opts.map(([id, text]) => h('button', {
      class: 'seg-btn', 'aria-pressed': String(id === cur), dataset: { [key]: id }, onclick: () => { set(id); draw(); },
    }, text)));
    const prompt = store.exercisesNeedingMuscle().length
      ? h('aside', { class: 'banner muscle-prompt' },
        h('span', { class: 'banner-ic' }, icon('man')),
        h('p', {}, `${store.exercisesNeedingMuscle().length} of your exercises need a muscle so they show on the map.`),
        h('button', { class: 'btn small accent', onclick: async () => { if (await openMusclePrompt()) { toast('Muscles saved'); draw(); } } }, 'Choose muscles'))
      : null;

    const regions = side === 'front' ? FRONT : BACK;
    const svg = figure(regions, out, { onOpen: openMuscle, title: `${side === 'front' ? 'Front' : 'Back'} of the body, sets ${mode === '4w' ? 'per week over the last 4 weeks' : 'this week'} per muscle` });
    const legend = h('ul', { class: 'legend bm-legend' },
      [['lvl-0', 'No sets'], ['lvl-1', 'Up to 25%'], ['lvl-2', '25–50%'], ['lvl-3', '50–99%'], ['lvl-4', 'At target']].map(([c, t]) => h('li', {}, h('span', { class: `bm-key ${c}`, 'aria-hidden': 'true' }), t)));
    const fig = h('figure', { class: 'chart bm-fig' }, svg, h('figcaption', { class: 'fine' }, 'Fill shows sets against each muscle’s weekly target. ↓ marks undertrained. Tap a muscle for details.'), legend);
    const table = h('table', { class: 'data-table' },
      h('caption', { class: 'sr-only' }, 'Sets per muscle group'),
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Muscle'), h('th', { scope: 'col', class: 'n' }, mode === '4w' ? 'Sets per week' : 'Sets this week'),
        h('th', { scope: 'col', class: 'n' }, 'Target'), h('th', { scope: 'col' }, 'Status'))),
      h('tbody', {}, GROUPS.map((g) => h('tr', {},
        h('th', { scope: 'row' }, h('button', { class: 'link-btn', onclick: () => openMuscle(g) }, g)),
        h('td', { class: 'n num' }, num(out[g].sets)), h('td', { class: 'n num' }, String(out[g].target)), h('td', {}, STATUS_LABEL[out[g].status])))));

    const under = undertrained(Object.fromEntries(GROUPS.map((g) => [g, out[g].sets])), targets, fallback);
    const underCard = h('section', { class: 'card', 'aria-labelledby': 'under-h' },
      h('h3', { id: 'under-h' }, 'Undertrained'),
      under.length
        ? h('ul', { class: 'rows under-list' }, under.map((r) => h('li', {},
          h('button', { class: 'under-row', onclick: () => openMuscle(r.group), dataset: { group: r.group } },
            h('span', { class: 'ms-name' }, r.group),
            h('span', { class: 'muted' }, r.sets ? `${num(r.sets)} of ${r.target} sets` : 'No sets yet'),
            h('span', { class: 'num' }, `${num(r.gap)} to go`)))))
        : h('p', { class: 'muted' }, 'Every muscle group is at half its weekly target or more.'));

    body.replaceChildren(...[
      prompt,
      anySets ? null : h('section', { class: 'empty-state' },
        icon('man', 'empty-icon'),
        h('h3', {}, 'No sets yet'),
        h('p', { class: 'muted' }, 'Tick working sets in a workout and they fill in here: each set counts for the main muscle it trains (1) and the muscles it also works (0.5). Warm-ups don’t count.'),
        h('a', { class: 'btn primary', href: `#/day/${today}` }, 'Open today')),
      h('div', { class: 'filters' },
        seg('Time window', [['week', 'This week'], ['4w', 'Last 4 weeks']], mode, (v) => { mode = v; setPref('bodymapWindow', v); }, 'window'),
        seg('Side', [['front', 'Front'], ['back', 'Back']], side, (v) => { side = v; setPref('bodymapSide', v); }, 'side')),
      h('section', { class: 'card bm-card', 'aria-label': 'Body map' }, withTable(fig, table, 'Body map')),
      underCard,
    ].filter(Boolean));
  }
  draw();
  return undefined;
}
