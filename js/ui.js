// Tiny DOM helpers, icons, dialogs and toasts.
import { TABLER } from './icons.js';
import { markSVG } from './brand.js';

/** h('button', { class: 'btn', onclick }, 'Label', childNode, [more]) */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  appendChildren(el, children); // children first so <select value> works
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'hidden' || k === 'disabled' || k === 'selected') el[k] = true;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  return el;
}

function appendChildren(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

// Short names used across the app → Tabler outline icons (js/icons.js).
const ALIAS = {
  chevL: 'chevron-left', chevR: 'chevron-right', chevU: 'chevron-up', chevD: 'chevron-down',
  plan: 'clipboard-list', chart: 'chart-line', dumbbell: 'barbell', phone: 'device-mobile', timer: 'stopwatch',
  play: 'player-play', pause: 'player-pause', more: 'dots', note: 'notes', gear: 'settings', info: 'info-circle',
  up: 'trending-up', down: 'trending-down', same: 'equal', vibrate: 'device-mobile-vibration', skip: 'player-skip-forward',
  reset: 'rotate', undo: 'arrow-back-up', appearance: 'sun-moon', csv: 'file-spreadsheet', heart: 'heart-rate-monitor',
  target: 'target-arrow', box: 'download', next: 'arrow-right', ruler: 'ruler-measure',
};

/** The VANE app icon, inline (decorative: the wordmark next to it carries the name). */
export function brandMark(size, cls = 'brand-mark') {
  const span = document.createElement('span');
  span.className = cls;
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = markSVG({ size });
  return span;
}

export function iconSVG(name) {
  const body = TABLER[ALIAS[name] ?? name] ?? '';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

export function icon(name, cls = '') {
  const span = document.createElement('span');
  span.className = `icon ${cls}`.trim();
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = iconSVG(name);
  return span;
}

// ---- plates: the calendar's session markers ----
// done = solid disc with a centre hole; planned = outlined ring; missed = faded ring; break = short dash.
const PLATE = {
  done: '<path fill="currentColor" fill-rule="evenodd" d="M12 1.5a10.5 10.5 0 1 1 0 21a10.5 10.5 0 1 1 0-21zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z"/>',
  planned: '<circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" stroke-width="2.5"/><circle cx="12" cy="12" r="2" fill="currentColor"/>',
  missed: '<circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" stroke-width="2"/>',
  break: '<path d="M7 12h10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>',
  rest: '<path d="M7 12h10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><path d="M9.5 16.5l1.8 1.8 3.5-3.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
};

/** <span class="plate p-done t-red"> — decorative; the caller provides the text label. */
export function plate(state, slug = 'none', cls = '') {
  const span = document.createElement('span');
  span.className = `plate p-${state} t-${slug} ${cls}`.trim();
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24">${PLATE[state] ?? ''}</svg>`;
  return span;
}

// ---- toasts ----
// One fixed slot above the nav (and above the rest bar when it shows), one toast at a time, queued, each
// gone after 2 s. Leaving a screen clears its toasts, so a message never turns up on a screen it wasn't about;
// pass { survive: true } for one that announces the navigation itself ("Day deleted" on the way back).
// A persistent toast (timeout 0, e.g. "A new version is ready") waits behind the queue and returns after it.
export const TOAST_MS = 2000;
const queue = [];
let showing = null;
let pinned = null;

function showNext() {
  const region = document.getElementById('toasts');
  if (showing) return;
  const next = queue.shift();
  if (pinned) pinned.hidden = !!next;
  if (!next) return;
  showing = next;
  region.append(next.el);
  next.timer = setTimeout(() => dismiss(next), next.timeout);
}

function dismiss(t) {
  clearTimeout(t.timer);
  t.el.remove();
  if (showing === t) showing = null;
  const i = queue.indexOf(t);
  if (i >= 0) queue.splice(i, 1);
  showNext();
}

export function toast(message, { action, timeout, survive = false } = {}) {
  const el = h('div', { class: 'toast', role: 'status' }, h('span', {}, message));
  const t = { el, timeout: timeout ?? TOAST_MS, survive };
  if (action) {
    el.dataset.action = '';
    el.append(h('button', { class: 'toast-btn', onclick: () => { dismiss(t); action.run(); } }, action.label));
  }
  if (timeout === 0) {
    pinned?.remove();
    pinned = el;
    el.classList.add('pinned');
    document.getElementById('toasts').append(el);
    el.hidden = !!showing;
    return el;
  }
  queue.push(t);
  showNext();
  return el;
}

/** Called when the screen changes: drop every toast that belongs to the old screen. */
export function clearToasts() {
  for (const t of [...queue, ...(showing ? [showing] : [])]) {
    if (t.survive) t.survive = false; // it announced this navigation; it may stay this once
    else dismiss(t);
  }
}
export const clearActionToasts = clearToasts;

// ---- dialogs ----
/** Modal with buttons; resolves to the clicked button's value ('cancel' on Esc). */
export function dialog({ title, message, buttons }) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'dialog', 'aria-labelledby': 'dlg-title' },
      h('form', { method: 'dialog' },
        h('h2', { id: 'dlg-title' }, title),
        message ? h('p', { class: 'dialog-msg' }, message) : null,
        h('div', { class: 'dialog-actions' },
          buttons.map((b) => h('button', { value: b.value, class: `btn ${b.kind ?? ''}` }, b.label)))));
    dlg.addEventListener('close', () => { resolve(dlg.returnValue || 'cancel'); dlg.remove(); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

/**
 * Bottom sheet for richer content. build(close) returns the body nodes; close(value) resolves.
 * Resolves to the value passed to close(), or null on Esc / backdrop / Cancel.
 */
export function sheet({ title, build, label }) {
  return new Promise((resolve) => {
    let result = null;
    const dlg = h('dialog', { class: 'dialog sheet', 'aria-label': label ?? title });
    const close = (v = null) => { result = v; dlg.close(); };
    dlg.append(
      h('div', { class: 'sheet-head' },
        h('h2', {}, title),
        h('button', { class: 'btn small subtle', type: 'button', onclick: () => close(null) }, 'Close')),
      h('div', { class: 'sheet-body' }, build(close)));
    dlg.addEventListener('click', (e) => { if (e.target === dlg) close(null); }); // tap the backdrop
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

export async function confirmDialog({ title, message, confirmLabel = 'OK', danger = false }) {
  const v = await dialog({
    title,
    message,
    buttons: [
      { label: 'Cancel', value: 'cancel' },
      { label: confirmLabel, value: 'ok', kind: danger ? 'danger' : 'primary' },
    ],
  });
  return v === 'ok';
}
