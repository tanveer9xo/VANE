// Dependency-free charts. Rules (see README → Charts): one axis, 2px lines, ≥8px markers with a 2px
// surface ring, solid hairline grid, crosshair + tooltip on hover/tap/keys, a direct label on the
// latest value, a legend only when there are two encodings, and a "View as table" toggle.
import { h } from './ui.js';
import { parseISODate, formatShort } from './dates.js';

const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function niceStep(raw) {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

/** Card body with a chart and a "View as table" toggle that swaps in an accessible table. */
export function withTable(figure, table, title) {
  let showTable = false;
  const holder = h('div', { class: 'chart-holder' }, figure);
  const btn = h('button', {
    class: 'link-btn table-toggle', 'aria-pressed': 'false',
    onclick: () => {
      showTable = !showTable;
      btn.setAttribute('aria-pressed', String(showTable));
      btn.textContent = showTable ? 'View as chart' : 'View as table';
      holder.replaceChildren(showTable ? table : figure);
    },
  }, 'View as table');
  return h('div', { class: 'chart-block', 'aria-label': title }, holder, btn);
}

/**
 * Line chart over dates.
 * points: [{ date, value, line?, highlight? }] oldest first. Markers show `value`; when `line` is given
 * (e.g. a 7-day average) a line follows it and the markers become the secondary "daily" encoding.
 * opts: { label, format(v), valueName, lineName, height, dateLabel(date) for the tooltip and table }
 */
export function lineChart(points, { label = 'Chart', format = String, valueName = 'Value', lineName = null, height = 200, dateLabel = formatShort, prLabels = false } = {}) {
  const twoEncodings = lineName != null;
  const svgHolder = h('div', { class: 'chart-svg', tabindex: '0', role: 'img', 'aria-label': `${label}. Use left and right arrows to read values.` });
  const tip = h('div', { class: 'chart-tip', hidden: true });
  const legend = twoEncodings ? h('ul', { class: 'legend' },
    h('li', {}, h('span', { class: 'key-dot', 'aria-hidden': 'true' }), valueName),
    h('li', {}, h('span', { class: 'key-line', 'aria-hidden': 'true' }), lineName)) : null;
  const fig = h('figure', { class: 'chart' }, legend, h('div', { class: 'chart-stage' }, svgHolder, tip));
  let selected = null;

  const table = h('table', { class: 'data-table' },
    h('caption', { class: 'sr-only' }, label),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Date'), h('th', { scope: 'col', class: 'n' }, valueName),
      twoEncodings ? h('th', { scope: 'col', class: 'n' }, lineName) : null)),
    h('tbody', {}, [...points].reverse().map((p) => h('tr', {},
      h('th', { scope: 'row' }, dateLabel(p.date)),
      h('td', { class: 'n num' }, format(p.value), p.highlight ? h('span', { class: 'pr-tag' }, ' PR') : null),
      twoEncodings ? h('td', { class: 'n num' }, p.line != null ? format(p.line) : '') : null))));

  function draw() {
    const W = Math.max(260, Math.round(svgHolder.clientWidth || 320));
    const H = height;
    const pad = { l: 40, r: 56, t: prLabels ? 22 : 12, b: 26 }; // right pad leaves room for the end label; top for PR badges
    const iw = W - pad.l - pad.r;
    const ih = H - pad.t - pad.b;

    const ts = points.map((p) => parseISODate(p.date).getTime());
    const t0 = Math.min(...ts);
    const t1 = Math.max(...ts);
    const lineVals = points.map((p) => (twoEncodings ? p.line : p.value));
    const vals = [...points.map((p) => p.value), ...lineVals].filter((v) => v != null);
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    const minSpan = Math.max(1, hi * 0.08);
    if (hi - lo < minSpan) { const mid = (hi + lo) / 2; lo = Math.max(0, mid - minSpan / 2); hi = lo + minSpan; }
    const step = niceStep((hi - lo) / 4);
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;

    const x = (t) => pad.l + (t1 === t0 ? iw / 2 : ((t - t0) / (t1 - t0)) * iw);
    const y = (v) => pad.t + ih - ((v - lo) / (hi - lo)) * ih;

    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true' });
    for (let v = lo; v <= hi + step / 2; v += step) {
      svg.append(s('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'grid' }));
      const t = s('text', { x: pad.l - 6, y: y(v) + 4, class: 'tick', 'text-anchor': 'end' });
      t.textContent = Number(v.toFixed(2)).toLocaleString();
      svg.append(t);
    }
    [0, points.length - 1].filter((v, i, a) => a.indexOf(v) === i).forEach((i, n) => {
      const t = s('text', { x: x(ts[i]), y: H - 6, class: 'tick', 'text-anchor': points.length === 1 ? 'middle' : n === 0 ? 'start' : 'end' });
      t.textContent = formatShort(points[i].date);
      svg.append(t);
    });

    const cursor = s('line', { y1: pad.t, y2: pad.t + ih, class: 'cursor', visibility: 'hidden' });
    svg.append(cursor);
    const path = lineVals.map((v, i) => (v == null ? null : `${x(ts[i]).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean);
    if (path.length > 1) {
      if (!twoEncodings) {
        const base = (pad.t + ih).toFixed(1);
        const xs = lineVals.map((v, i) => x(ts[i]).toFixed(1));
        svg.append(s('path', { d: `M${xs[0]},${base}L${path.join('L')}L${xs.at(-1)},${base}Z`, class: 'area' }));
      }
      svg.append(s('path', { d: `M${path.join('L')}`, class: 'line' }));
    }
    points.forEach((p, i) => {
      svg.append(s('circle', { cx: x(ts[i]), cy: y(p.value), r: twoEncodings ? 4 : p.highlight ? 5 : 4, class: `dot${twoEncodings ? ' daily' : ''}${p.highlight ? ' pr' : ''}` }));
    });
    // PR badges: a small "PR" over each marker that set a new best (PRs are rare, so this stays sparse).
    if (prLabels) {
      points.forEach((p, i) => {
        if (!p.highlight) return;
        const t = s('text', { x: x(ts[i]), y: y(p.value) - 10, class: 'pr-label', 'text-anchor': 'middle' });
        t.textContent = 'PR';
        svg.append(t);
      });
    }
    // Direct label on the latest value (the line's, when there is one).
    const li = points.length - 1;
    const lv = lineVals[li] ?? points[li].value;
    const end = s('text', { x: x(ts[li]) + 8, y: y(lv) + 4, class: 'end-label' });
    end.textContent = format(lv);
    svg.append(end);
    const sel = s('circle', { r: 6, class: 'sel', visibility: 'hidden' });
    svg.append(sel);

    const select = (i) => {
      selected = i;
      if (i == null) { cursor.setAttribute('visibility', 'hidden'); sel.setAttribute('visibility', 'hidden'); tip.hidden = true; return; }
      const p = points[i];
      const cx = x(ts[i]);
      cursor.setAttribute('x1', cx); cursor.setAttribute('x2', cx); cursor.setAttribute('visibility', 'visible');
      sel.setAttribute('cx', cx); sel.setAttribute('cy', y(p.value)); sel.setAttribute('visibility', 'visible');
      tip.replaceChildren(...[
        h('div', { class: 'tip-date' }, dateLabel(p.date)),
        h('div', { class: 'tip-row' }, h('strong', { class: 'num' }, format(p.value)), ` ${valueName}`, p.highlight ? [' ', h('span', { class: 'pr-tag' }, 'PR')] : null),
        twoEncodings && p.line != null ? h('div', { class: 'tip-row' }, h('strong', { class: 'num' }, format(p.line)), ` ${lineName}`) : null,
      ].filter(Boolean));
      tip.hidden = false;
      const left = (cx / W) * svgHolder.clientWidth;
      tip.style.left = `${Math.min(Math.max(left, 60), svgHolder.clientWidth - 60)}px`;
    };
    const nearest = (clientX) => {
      const r = svg.getBoundingClientRect();
      const px = ((clientX - r.left) / r.width) * W;
      let best = 0;
      ts.forEach((t, i) => { if (Math.abs(x(t) - px) < Math.abs(x(ts[best]) - px)) best = i; });
      return best;
    };
    svg.addEventListener('pointerdown', (e) => select(nearest(e.clientX)));
    svg.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || e.buttons) select(nearest(e.clientX)); });
    svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') select(null); });
    svgHolder.replaceChildren(svg);
    if (selected != null) select(Math.min(selected, points.length - 1));
    svgHolder.onkeydown = (e) => {
      if (e.key === 'Escape') { select(null); return; }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const cur = selected ?? (e.key === 'ArrowLeft' ? points.length : -1);
      select(Math.max(0, Math.min(points.length - 1, cur + (e.key === 'ArrowRight' ? 1 : -1))));
    };
  }

  const ro = new ResizeObserver(() => draw());
  ro.observe(svgHolder);
  requestAnimationFrame(draw);
  return withTable(fig, table, label);
}

/**
 * Horizontal bars from zero, one hue, sorted by the caller, a value label at each bar's tip.
 * rows: [{ label, value }]
 */
export function barList(rows, { label = 'Chart', format = String, valueName = 'Value', labelName = 'Muscle', detailName = null, max: fixedMax = null } = {}) {
  const max = fixedMax ?? Math.max(1, ...rows.map((r) => r.value));
  const fig = h('figure', { class: 'bars', 'aria-label': label },
    h('ul', {}, rows.map((r) => h('li', { class: 'bar-row', title: `${r.label}: ${format(r.value)}` },
      h('span', { class: 'bar-name' }, r.label),
      h('span', { class: 'bar-track' },
        h('span', { class: 'bar', style: `width:${(r.value / max) * 100}%` }),
        h('span', { class: 'bar-val num' }, format(r.value)))))));
  const table = h('table', { class: 'data-table' },
    h('caption', { class: 'sr-only' }, label),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, labelName), h('th', { scope: 'col', class: 'n' }, valueName),
      detailName ? h('th', { scope: 'col', class: 'n' }, detailName) : null)),
    h('tbody', {}, rows.map((r) => h('tr', {}, h('th', { scope: 'row' }, r.label), h('td', { class: 'n num' }, format(r.value)),
      detailName ? h('td', { class: 'n' }, r.detail ?? '') : null))));
  return withTable(fig, table, label);
}

/**
 * One column per week: the planned count as an outlined bar, the sessions done as a filled bar over it.
 * Both start at zero on one axis. The latest week is labelled directly; tap or arrow keys read any week.
 * weeks: [{ start, planned, done, extra?, partial? }]  (partial = the week is still running)
 */
export function weekBars(weeks, { label = 'Planned and done sessions per week', dateLabel = formatShort, height = 170 } = {}) {
  const tip = h('div', { class: 'chart-tip', hidden: true });
  const holder = h('div', { class: 'chart-svg', tabindex: '0', role: 'img', 'aria-label': `${label}. Use left and right arrows to read weeks.` });
  const legend = h('ul', { class: 'legend' },
    h('li', {}, h('span', { class: 'key-box outline', 'aria-hidden': 'true' }), 'Planned'),
    h('li', {}, h('span', { class: 'key-box fill', 'aria-hidden': 'true' }), 'Done'));
  const fig = h('figure', { class: 'chart' }, legend, h('div', { class: 'chart-stage' }, holder, tip));
  let selected = null;
  const readout = (w) => `${dateLabel(w.start)}${w.partial ? ' (so far)' : ''}: ${w.done} of ${w.planned} planned${w.extra ? `, ${w.extra} extra` : ''}`;

  function draw() {
    const W = Math.max(260, Math.round(holder.clientWidth || 320));
    const H = height;
    const pad = { l: 28, r: 44, t: 12, b: 24 };
    const iw = W - pad.l - pad.r;
    const ih = H - pad.t - pad.b;
    const top = Math.max(1, ...weeks.map((w) => Math.max(w.planned, w.done)));
    const y = (v) => pad.t + ih - (v / top) * ih;
    const slot = iw / weeks.length;
    const bw = Math.min(24, Math.max(3, slot * 0.6));
    const cx = (i) => pad.l + slot * i + slot / 2;
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true' });
    const step = top <= 6 ? 1 : top <= 12 ? 2 : 5;
    for (let v = 0; v <= top; v += step) {
      svg.append(s('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'grid' }));
      const t = s('text', { x: pad.l - 6, y: y(v) + 4, class: 'tick', 'text-anchor': 'end' });
      t.textContent = String(v);
      svg.append(t);
    }
    const cursor = s('rect', { y: pad.t, height: ih, width: slot, class: 'col-cursor', visibility: 'hidden' });
    svg.append(cursor);
    weeks.forEach((w, i) => {
      const x = cx(i) - bw / 2;
      if (w.planned) svg.append(s('rect', { x, y: y(w.planned), width: bw, height: ih - (y(w.planned) - pad.t), rx: 3, class: 'bar-plan' }));
      if (w.done) svg.append(s('rect', { x: x + 1.5, y: y(w.done), width: Math.max(1, bw - 3), height: ih - (y(w.done) - pad.t), rx: 2, class: `bar-done${w.partial ? ' partial' : ''}` }));
    });
    const last = weeks.at(-1);
    const end = s('text', { x: cx(weeks.length - 1) + bw / 2 + 6, y: y(Math.max(last.planned, last.done)) + 4, class: 'end-label' });
    end.textContent = `${last.done}/${last.planned}`;
    svg.append(end);
    [0, weeks.length - 1].filter((v, i, arr) => arr.indexOf(v) === i).forEach((i, n) => {
      const t = s('text', { x: cx(i), y: H - 6, class: 'tick', 'text-anchor': weeks.length === 1 ? 'middle' : n === 0 ? 'start' : 'end' });
      t.textContent = formatShort(weeks[i].start);
      svg.append(t);
    });
    const select = (i) => {
      selected = i;
      if (i == null) { cursor.setAttribute('visibility', 'hidden'); tip.hidden = true; return; }
      cursor.setAttribute('x', pad.l + slot * i);
      cursor.setAttribute('visibility', 'visible');
      const w = weeks[i];
      tip.replaceChildren(
        h('div', { class: 'tip-date' }, `${dateLabel(w.start)}${w.partial ? ', so far' : ''}`),
        h('div', { class: 'tip-row' }, h('strong', { class: 'num' }, `${w.done} of ${w.planned}`), ' planned'),
        w.extra ? h('div', { class: 'tip-row' }, h('strong', { class: 'num' }, String(w.extra)), ' extra') : null);
      tip.hidden = false;
      tip.style.left = `${Math.min(Math.max((cx(i) / W) * holder.clientWidth, 60), holder.clientWidth - 60)}px`;
    };
    const at = (clientX) => {
      const r = svg.getBoundingClientRect();
      return Math.max(0, Math.min(weeks.length - 1, Math.floor((((clientX - r.left) / r.width) * W - pad.l) / slot)));
    };
    svg.addEventListener('pointerdown', (e) => select(at(e.clientX)));
    svg.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || e.buttons) select(at(e.clientX)); });
    svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') select(null); });
    holder.replaceChildren(svg);
    if (selected != null) select(Math.min(selected, weeks.length - 1));
    holder.onkeydown = (e) => {
      if (e.key === 'Escape') { select(null); return; }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const cur = selected ?? (e.key === 'ArrowLeft' ? weeks.length : -1);
      select(Math.max(0, Math.min(weeks.length - 1, cur + (e.key === 'ArrowRight' ? 1 : -1))));
    };
  }
  new ResizeObserver(() => draw()).observe(holder);
  requestAnimationFrame(draw);

  const table = h('table', { class: 'data-table' },
    h('caption', { class: 'sr-only' }, label),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Week'), h('th', { scope: 'col', class: 'n' }, 'Planned'),
      h('th', { scope: 'col', class: 'n' }, 'Done'), h('th', { scope: 'col', class: 'n' }, 'Extra'))),
    h('tbody', {}, [...weeks].reverse().map((w) => h('tr', {},
      h('th', { scope: 'row' }, `${dateLabel(w.start)}${w.partial ? ' (so far)' : ''}`),
      h('td', { class: 'n num' }, String(w.planned)), h('td', { class: 'n num' }, String(w.done)), h('td', { class: 'n num' }, String(w.extra ?? 0))))));
  return withTable(fig, table, label);
}
