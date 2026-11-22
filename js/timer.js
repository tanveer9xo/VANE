// One shared timer for the whole app: a rest countdown and a stopwatch.
// Timestamp-based: we store when the countdown ends (and when the stopwatch started) and derive the
// time from the clock, so locking the phone or backgrounding the app can't make it drift.
// The 250 ms tick only repaints. The Timer tab, the sticky bar on other screens and the tab badge all
// read the same state through onTimer().
import { h, icon } from './ui.js';

const KEY = 'restTimer'; // countdown (key kept from 1.3 so a running timer survives the update)
const WATCH_KEY = 'stopwatch';

// ---------- pure state helpers (unit-tested) ----------
// countdown: { endAt, pausedLeft (ms, or null when running), total (ms), label }

export function remainingMs(state, now = Date.now()) {
  if (!state) return 0;
  return Math.max(0, state.pausedLeft ?? state.endAt - now);
}

export const startState = (seconds, label, now = Date.now(), slug = null) => ({ endAt: now + seconds * 1000, pausedLeft: null, total: seconds * 1000, label, slug });

export function adjustState(state, deltaSeconds, now = Date.now()) {
  const left = Math.max(0, remainingMs(state, now) + deltaSeconds * 1000);
  const total = Math.max(state.total + deltaSeconds * 1000, left);
  return state.pausedLeft != null ? { ...state, pausedLeft: left, total } : { ...state, endAt: now + left, total };
}

export const pauseState = (state, now = Date.now()) => ({ ...state, pausedLeft: remainingMs(state, now) });
export const resumeState = (state, now = Date.now()) => ({ ...state, endAt: now + state.pausedLeft, pausedLeft: null });

/** 90 000 → "1:30" (rounds up, so it never shows 0:00 while time is left). */
export function formatClock(ms) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// stopwatch: { runningSince (ms) | null, elapsed (ms banked while paused), laps: [ms since start] }
export const watchElapsed = (w, now = Date.now()) => (w ? w.elapsed + (w.runningSince != null ? now - w.runningSince : 0) : 0);
export const watchStart = (w, now = Date.now()) => ({ elapsed: w?.elapsed ?? 0, laps: w?.laps ?? [], runningSince: now });
export const watchPause = (w, now = Date.now()) => ({ ...w, elapsed: watchElapsed(w, now), runningSince: null });
export const watchLap = (w, now = Date.now()) => ({ ...w, laps: [...w.laps, watchElapsed(w, now)] });

/** 83 456 → "1:23.4"; over an hour → "1:02:03". */
export function formatWatch(ms) {
  const total = Math.floor(ms / 100);
  const tenths = total % 10;
  const s = Math.floor(total / 10);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}.${tenths}`;
}

/** "90", "1:30", "2m" → seconds (5–900) or null. */
export function parseDuration(text) {
  const s = String(text ?? '').trim().toLowerCase();
  let n = null;
  if (/^\d{1,3}$/.test(s)) n = Number(s);
  else if (/^\d{1,2}:\d{2}$/.test(s)) { const [m, sec] = s.split(':').map(Number); n = sec < 60 ? m * 60 + sec : null; }
  else if (/^\d{1,2}\s*m(in)?$/.test(s)) n = parseInt(s, 10) * 60;
  return n != null && n >= 5 && n <= 900 ? n : null;
}

/** 1 102 000 → "18:22"; over an hour → "1:18:22". */
export function formatElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

// ---------- persistence (per device; must survive a reload) ----------
const load = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const save = (k, st) => { try { st ? localStorage.setItem(k, JSON.stringify(st)) : localStorage.removeItem(k); } catch { /* ignore */ } };

// ---------- sound ----------
// The AudioContext is created/resumed inside a user gesture (ticking a set, pressing Start), so
// browsers allow it. The end beep is scheduled on the audio clock, which keeps running while the
// screen is on even if JS timers are throttled.
let audio = null;
let scheduled = [];

export function unlockAudio() {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch { audio = null; }
}

function cancelBeep() {
  scheduled.forEach((o) => { try { o.stop(); } catch { /* already stopped */ } });
  scheduled = [];
}

function beepAt(secondsFromNow) {
  if (!audio || !opts.sound()) return;
  const t0 = audio.currentTime + Math.max(0, secondsFromNow);
  [0, 0.22].forEach((offset) => {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, t0 + offset);
    gain.gain.exponentialRampToValueAtTime(0.4, t0 + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.16);
    osc.connect(gain).connect(audio.destination);
    osc.start(t0 + offset);
    osc.stop(t0 + offset + 0.18);
    scheduled.push(osc);
  });
}

// ---------- shared state + subscribers ----------
let rest = load(KEY);
let watch = load(WATCH_KEY);
let firedFor = null; // endAt we already alerted for
let tickHandle = null;
let bar = null;
let lastSpoken = null;
const listeners = new Set();
const opts = { sound: () => true, vibrate: () => true };

export const getRest = () => rest;
export const getWatch = () => watch;
export const isRunning = () => (rest && rest.pausedLeft == null && remainingMs(rest) > 0) || (watch?.runningSince != null);

/** Subscribe to every repaint (250 ms while something runs, plus on each change). Returns unsubscribe. */
export function onTimer(fn) {
  listeners.add(fn);
  fn();
  return () => listeners.delete(fn);
}

export function configureTimer({ sound, vibrate }) {
  if (sound) opts.sound = sound;
  if (vibrate) opts.vibrate = vibrate;
}

export function buzz(pattern) {
  if (opts.vibrate()) navigator.vibrate?.(pattern); // not supported on iOS — the beep and flash cover it
}

function setRest(next) {
  rest = next;
  save(KEY, rest);
  cancelBeep();
  if (rest && rest.pausedLeft == null) beepAt(remainingMs(rest) / 1000);
  changed();
}

/** slug = the session colour key to show it in (e.g. 'green'); none → the indigo accent. */
export function startRest(seconds, label = '', slug = null) {
  unlockAudio();
  firedFor = null;
  lastSpoken = null;
  setRest(startState(seconds, label, Date.now(), slug));
  say(`Rest ${spokenTime(seconds * 1000)}${label ? ` after ${label}` : ''}`);
}
export const adjustRest = (delta) => rest && setRest(adjustState(rest, delta));
export const pauseRest = () => rest && rest.pausedLeft == null && setRest(pauseState(rest));
export function resumeRest() { unlockAudio(); if (rest?.pausedLeft != null) setRest(resumeState(rest)); }
export function stopRest() { setRest(null); }

function setWatch(next) { watch = next; save(WATCH_KEY, watch); changed(); }
export const startWatch = () => setWatch(watchStart(watch));
export const pauseWatch = () => watch && setWatch(watchPause(watch));
export const lapWatch = () => watch?.runningSince != null && setWatch(watchLap(watch));
export const resetWatch = () => setWatch(null);

function finish() {
  firedFor = rest.endAt;
  buzz([200, 100, 200]);
  bar?.classList.remove('flash');
  void bar?.offsetWidth; // restart the animation
  bar?.classList.add('flash');
  document.body.classList.add('rest-over');
  setTimeout(() => document.body.classList.remove('rest-over'), 1600);
  say('Rest over');
  setTimeout(() => { if (rest && remainingMs(rest) === 0 && rest.endAt === firedFor) stopRest(); }, 5000);
}

// ---------- screen reader announcements (sparse: start, every 30 s, 10 s left, over) ----------
const spokenTime = (ms) => {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return [m ? `${m} minute${m === 1 ? '' : 's'}` : '', r ? `${r} second${r === 1 ? '' : 's'}` : ''].filter(Boolean).join(' ') || '0 seconds';
};
function say(text) {
  const live = document.getElementById('timer-live');
  if (live) live.textContent = text;
}

function tick() {
  if (rest) {
    const left = remainingMs(rest);
    if (rest.pausedLeft == null && left > 0) {
      const s = Math.ceil(left / 1000);
      if ((s % 30 === 0 || s === 10) && s !== lastSpoken) { lastSpoken = s; say(`${spokenTime(left)} left`); }
    }
    if (left === 0 && rest.pausedLeft == null && firedFor !== rest.endAt) {
      // Ended while we were away for more than a few seconds: just show it, don't beep late.
      if (Date.now() - rest.endAt > 3000) cancelBeep();
      finish();
    }
  }
  paintBar();
  listeners.forEach((fn) => fn());
  document.querySelector('.tabbar a[data-tab="timer"]')?.classList.toggle('running', !!isRunning());
}

function changed() {
  clearInterval(tickHandle);
  tickHandle = null;
  renderBar();
  tick();
  if (rest || watch?.runningSince != null) tickHandle = setInterval(tick, 250);
}

// ---------- the sticky bar shown on every screen except the Timer tab ----------
function renderBar() {
  if (!rest) { bar?.remove(); bar = null; document.body.classList.remove('has-rest'); return; }
  const paused = rest.pausedLeft != null;
  const next = h('div', { class: `rest-bar${rest.slug ? ` t-${rest.slug}` : ''}`, role: 'group', 'aria-label': 'Rest timer' },
    h('div', { class: 'rt-progress', 'aria-hidden': 'true' }),
    h('a', { class: 'rt-main', href: '#/timer', 'aria-label': 'Open the timer' },
      icon(paused ? 'pause' : 'timer', 'rt-ic'),
      h('span', { class: 'rt-label' }, paused ? 'Paused' : 'Rest', rest.label ? h('small', {}, rest.label) : null),
      h('span', { class: 'rt-time num' }, formatClock(remainingMs(rest)))),
    h('div', { class: 'rt-actions' },
      h('button', { class: 'rt-btn', 'aria-label': 'Add 15 seconds', onclick: () => adjustRest(15) }, '+15'),
      h('button', { class: 'rt-btn skip', 'aria-label': 'Skip rest', onclick: stopRest }, icon('skip'), 'Skip')));
  if (bar) bar.replaceWith(next); else document.body.append(next);
  bar = next;
  document.body.classList.add('has-rest');
}

function paintBar() {
  if (!bar || !rest) return;
  const left = remainingMs(rest);
  bar.querySelector('.rt-time').textContent = left > 0 ? formatClock(left) : 'Go';
  bar.querySelector('.rt-progress').style.transform = `scaleX(${rest.total ? left / rest.total : 0})`;
}

/** Restore timers after a reload / returning to the app. */
export function initTimer() {
  if (rest && remainingMs(rest) === 0 && rest.pausedLeft == null && Date.now() - rest.endAt > 60000) {
    rest = null; // ended long ago
    save(KEY, null);
  }
  changed();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });
}
