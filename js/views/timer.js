// Timer tab: rest countdown with presets, and a stopwatch. Both read the one shared timer in timer.js,
// so this page, the sticky bar elsewhere and the tab badge always agree.
import { h, icon, toast } from '../ui.js';
import * as store from '../store.js';
import { TIMER_PRESETS } from '../model.js';
import {
  onTimer, getRest, getWatch, remainingMs, formatClock, watchElapsed, formatWatch,
  startRest, adjustRest, pauseRest, resumeRest, stopRest, startWatch, pauseWatch, lapWatch, resetWatch, unlockAudio,
  parseDuration,
} from '../timer.js';

const pref = (k, fallback) => { try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; } };
const setPref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

export function renderTimer(root) {
  let mode = pref('timerMode', 'rest') === 'watch' ? 'watch' : 'rest';
  const settings = () => store.state.settings;
  const R = 46; // ring radius in a 100×100 viewBox
  const C = 2 * Math.PI * R;

  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `<circle class="ring-track" cx="50" cy="50" r="${R}"/><circle class="ring-fill" cx="50" cy="50" r="${R}" stroke-dasharray="${C}" transform="rotate(-90 50 50)"/>`;
  const fill = svg.querySelector('.ring-fill');

  const time = h('div', { class: 'ring-time num' });
  const sub = h('div', { class: 'ring-sub' });
  const ring = h('div', { class: 'ring', role: 'timer', 'aria-labelledby': 'ring-time-label' },
    svg, h('div', { class: 'ring-center', id: 'ring-time-label' }, time, sub));

  const presets = h('div', { class: 'presets', role: 'group', 'aria-label': 'Rest length' });
  const controls = h('div', { class: 'timer-controls' });
  const extra = h('div', { class: 'timer-extra' });
  const other = h('p', { class: 'timer-other' });

  let stage = null;
  const modeSeg = h('div', { class: 'seg seg-wide timer-mode', role: 'group', 'aria-label': 'Timer mode' },
    [['rest', 'Rest timer'], ['watch', 'Stopwatch']].map(([id, label]) => h('button', {
      class: 'seg-btn', 'aria-pressed': String(mode === id), dataset: { mode: id },
      onclick: () => { mode = id; setPref('timerMode', id); build(); },
    }, label)));

  // ---------- settings on this page ----------
  const toggle = (id, label, key, after, ic) => h('div', { class: 'row switch-row' },
    ic ? h('span', { class: 'row-ic' }, icon(ic)) : null,
    h('label', { for: id }, label),
    h('input', {
      id, type: 'checkbox', class: 'switch', checked: settings()[key] !== false,
      onchange: async (e) => { await store.saveSettings({ [key]: e.target.checked }); after?.(e.target.checked); },
    }));
  const settingsList = h('section', { class: 'card list timer-settings', 'aria-labelledby': 'timer-set-h' },
    h('h2', { id: 'timer-set-h', class: 'list-title' }, 'Timer settings'),
    toggle('t-sound', 'Sound', 'timerSound', (on) => on && unlockAudio(), 'volume'),
    toggle('t-vibrate', 'Vibration', 'timerVibrate', (on) => on && navigator.vibrate?.(30), 'vibrate'),
    toggle('t-auto', 'Auto-start after ticking a set', 'autoStartRest', null, 'play'),
    h('div', { class: 'row' },
      h('span', { class: 'row-ic' }, icon('bell')),
      h('span', { class: 'row-text' }, 'Check sound and vibration'),
      h('button', { class: 'btn small', onclick: () => { mode = 'rest'; setPref('timerMode', 'rest'); build(); startRest(5, 'Test'); } }, 'Test (5 s)')),
    'vibrate' in navigator ? null : h('p', { class: 'fine' }, 'This browser can’t vibrate. iPhone flashes the screen and beeps instead.'));

  // ---------- rest mode ----------
  function restPresets() {
    const current = settings().timerPreset;
    const custom = !TIMER_PRESETS.includes(current);
    const chip = (secs) => h('button', {
      class: 'preset num', 'aria-pressed': String(secs === current), 'aria-label': `${secs} seconds`,
      onclick: () => pickPreset(secs),
    }, formatClock(secs * 1000));
    const customIn = h('input', {
      class: 'preset-input num', type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: 'm:ss',
      'aria-label': 'Custom rest length, seconds or minutes:seconds', value: custom ? formatClock(current * 1000) : '',
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } },
      onchange: (e) => {
        const secs = parseDuration(e.target.value);
        if (secs == null) { toast('Enter 5 s to 15 min, like 75 or 1:15'); e.target.setAttribute('aria-invalid', 'true'); return; }
        pickPreset(secs);
      },
    });
    presets.replaceChildren(...TIMER_PRESETS.map(chip),
      h('label', { class: `preset custom${custom ? ' on' : ''}` }, h('span', {}, 'Custom'), customIn));
  }

  async function pickPreset(secs) {
    await store.saveSettings({ timerPreset: secs });
    const r = getRest();
    if (r && remainingMs(r) > 0) startRest(secs, r.label); // running: restart at the new length
    restPresets();
    paint();
  }

  function restControls() {
    const r = getRest();
    const running = r && r.pausedLeft == null && remainingMs(r) > 0;
    const paused = r && r.pausedLeft != null;
    const main = running
      ? h('button', { class: 'btn session big', onclick: pauseRest }, icon('pause'), 'Pause')
      : paused
        ? h('button', { class: 'btn session big', onclick: resumeRest }, icon('play'), 'Resume')
        : h('button', { class: 'btn session big', onclick: () => startRest(settings().timerPreset, '') }, icon('play'), 'Start');
    controls.replaceChildren(
      h('button', { class: 'btn round', 'aria-label': 'Subtract 15 seconds', disabled: !r, onclick: () => adjustRest(-15) }, '−15'),
      main,
      h('button', { class: 'btn round', 'aria-label': 'Add 15 seconds', disabled: !r, onclick: () => adjustRest(15) }, '+15'));
    extra.replaceChildren(r ? h('button', { class: 'btn subtle', onclick: stopRest }, icon('reset'), 'Reset') : h('span', { class: 'fine' }, 'Tap a length, then Start.'));
  }

  // ---------- stopwatch mode ----------
  const laps = h('ol', { class: 'laps', 'aria-label': 'Laps' });
  function watchControls() {
    const w = getWatch();
    const running = w?.runningSince != null;
    controls.replaceChildren(
      h('button', { class: 'btn round', disabled: !running, onclick: lapWatch, 'aria-label': 'Lap' }, icon('flag')),
      running
        ? h('button', { class: 'btn session big', onclick: pauseWatch }, icon('pause'), 'Pause')
        : h('button', { class: 'btn session big', onclick: startWatch }, icon('play'), w ? 'Resume' : 'Start'),
      h('button', { class: 'btn round', disabled: !w || running, onclick: resetWatch, 'aria-label': 'Reset' }, icon('reset')));
    extra.replaceChildren(laps);
    drawLaps();
  }
  let lapCount = -1;
  function drawLaps() {
    const list = getWatch()?.laps ?? [];
    if (list.length === lapCount) return;
    lapCount = list.length;
    laps.replaceChildren(...list.map((t, i) => h('li', {},
      h('span', {}, `Lap ${i + 1}`),
      h('span', { class: 'num' }, formatWatch(t - (list[i - 1] ?? 0))),
      h('span', { class: 'num muted' }, formatWatch(t)))).reverse());
  }

  // ---------- paint (every tick) ----------
  let lastShape = '';
  function paint() {
    const r = getRest();
    const w = getWatch();
    // The ring takes the colour of the session that started the rest, else the accent.
    const slug = mode === 'rest' && r?.slug ? r.slug : null;
    if (stage && stage.dataset.slug !== (slug ?? '')) {
      stage.className = `card timer-stage${slug ? ` t-${slug}` : ''}`;
      stage.dataset.slug = slug ?? '';
    }
    if (mode === 'rest') {
      const total = r ? r.total : settings().timerPreset * 1000;
      const left = r ? remainingMs(r) : total;
      time.textContent = r && left === 0 ? 'Go' : formatClock(left);
      sub.textContent = !r ? 'Ready' : r.pausedLeft != null ? 'Paused' : left === 0 ? 'Rest over' : r.label ? `Rest · ${r.label}` : 'Resting';
      fill.style.strokeDashoffset = String(C * (1 - (total ? left / total : 0)));
      ring.classList.toggle('idle', !r);
      other.textContent = w?.runningSince != null ? `Stopwatch running: ${formatWatch(watchElapsed(w))}` : '';
    } else {
      const ms = watchElapsed(w);
      time.textContent = formatWatch(ms);
      sub.textContent = !w ? 'Ready' : w.runningSince != null ? 'Running' : 'Paused';
      fill.style.strokeDashoffset = String(C * (1 - ((ms / 1000) % 60) / 60));
      ring.classList.toggle('idle', !w);
      other.textContent = r && remainingMs(r) > 0 ? `Rest timer: ${formatClock(remainingMs(r))} left` : '';
      drawLaps();
    }
    // Rebuild the buttons only when the state's shape changes (keeps focus stable).
    const shape = `${mode}|${!!r}|${r?.pausedLeft != null}|${r ? remainingMs(r) > 0 : ''}|${!!w}|${w?.runningSince != null}`;
    if (shape !== lastShape) {
      lastShape = shape;
      const fkey = document.activeElement?.closest('.timer-controls') ? document.activeElement.textContent : null;
      if (mode === 'rest') restControls(); else watchControls();
      if (fkey) [...controls.querySelectorAll('button')].find((b) => !b.disabled && b.classList.contains('big'))?.focus();
    }
  }

  function build() {
    lastShape = '';
    lapCount = -1;
    modeSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    presets.hidden = mode !== 'rest';
    if (mode === 'rest') restPresets();
    paint();
  }

  stage = h('div', { class: 'card timer-stage' }, ring, other, presets, controls, extra);
  root.append(h('div', { class: 'view timer-view' },
    h('header', { class: 'topbar' }, h('h1', { tabindex: '-1' }, 'Timer')),
    modeSeg,
    stage,
    settingsList));
  build();
  const off = onTimer(paint);
  document.body.classList.add('on-timer');
  return () => { off(); document.body.classList.remove('on-timer'); };
}
