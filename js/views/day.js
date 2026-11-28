// Day screen: log a set in two taps. Sticky session bar, collapsible exercise groups, finish sheet.
import { h, icon, plate, toast, confirmDialog, sheet } from '../ui.js';
import * as store from '../store.js';
import { exName as exLabel } from '../library.js';
import { fmtW, fmtWU, parseShownW, shownVolume, wUnit, toShownW, fromShownW } from '../units.js';
import { goalHint } from '../profile.js';
import { activityFor, newCardioExercise, isCardioExercise, derive, FIELDS as CARDIO_FIELDS } from '../cardio.js';
import { dUnit, spUnit, toShownD, fromShownD, fmtD, fmtSp } from '../units.js';
import { pickerTypes, typeById, typeName, typeColor } from '../types.js';
import {
  BREAK, SKIP_REASONS, uid, SET_TYPE_LABEL, isTrainingType, newSession, newExercise, newSet,
  exerciseKey, cleanName, cleanNote, parseWeight, parseReps, parseMinutes, formatTarget, formatReps,
} from '../model.js';
import {
  lastSetsFor, lastLoggedSets, formatSet, lastSessionOfType, prsForSession, prSetCount, formatSets, formatSetGroups, fmtNum, fmtInt, sessionVolume,
  sessionSetCount, exerciseUsage, isLoggedSet,
} from '../stats.js';
import {
  scheduledFor, exercisesFromTemplate, plannedExercise, templateItemFor, templateFor, restSecondsFor, weightStepFor,
  copySessionTo,
} from '../plan.js';
import { suggest } from '../progression.js';
import { startRest, stopRest, getRest, formatClock, formatElapsed, buzz } from '../timer.js';
import { setKeepAwake, wakeLockSupported } from '../wakelock.js';
import { todayISO, addDays, formatDayTitle, formatShort, monthOf, monthKey, relativeDay, isValidISODate } from '../dates.js';
import { openExercisePicker } from './picker.js';
import { groupIcon } from '../muscles.js';

const REST_PRESETS = [45, 60, 90, 120, 180, 240];
const SET_CYCLE = { working: 'warmup', warmup: 'failure', failure: 'working' };
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const isExDone = (ex) => (isCardioExercise(ex) ? !!ex.cardio?.done : ex.sets.length > 0 && ex.sets.every((s) => s.done));

export function renderDay(root, date) {
  const today = todayISO();
  const when = date > today ? 'future' : date === today ? 'today' : 'past';
  const scheduled = scheduledFor(date, store.state.schedule);

  // A day with nothing logged opens pre-filled from the weekly plan as an unsaved *draft*;
  // it's saved the moment you change anything. Viewing alone never creates data.
  let session = store.getSession(date);
  let draft = false;
  if (!session && isTrainingType(scheduled)) {
    session = buildSession(scheduled);
    draft = true;
  }
  let trainAnyway = false;
  const expanded = new Set(); // finished exercises the user opened again
  const shut = new Set(); // unfinished exercises the user collapsed
  let autoFinished = false; // finished by ticking the last set (undone if that set is unticked)

  const view = h('div', { class: 'view day-view' });
  root.append(view);

  const saveStatus = h('span', { class: 'save-status', 'aria-live': 'polite' });
  const offSave = store.onSaveState((st) => {
    saveStatus.dataset.state = st;
    saveStatus.textContent = { saving: 'Saving', saved: 'Saved', error: 'Not saved. Check storage in Settings.' }[st] ?? '';
  });

  let exList = null;
  let barEls = null;
  let heroObserver = null;
  let mini = null;
  const cardioTimers = new Set(); // running Start/Stop timers on cardio cards

  // A day starts from its type's template, in order, cardio included (a Cardio day's template is Treadmill).
  function buildSession(type) {
    const s = newSession(date, store.state.settings, type);
    s.exercises = exercisesFromTemplate(type, store.state.templates, store.allSessions(), date, today);
    return s;
  }

  // Re-render the whole screen, keeping focus on the same logical control.
  function render() {
    const fkey = document.activeElement?.dataset?.fkey;
    cardioTimers.forEach(clearInterval);
    cardioTimers.clear();
    let body;
    if (session && session.type !== BREAK) body = editor();
    else if (session) body = restDay();
    else if (scheduled === BREAK && !trainAnyway) body = breakState();
    else body = emptyState();
    // The whole screen takes the session colour: header, progress, buttons, done tint, rest bar.
    view.className = `view day-view t-${heroSlug() ?? 'none'}`;
    const top = hero();
    view.replaceChildren(top, miniBar(), body);
    heroObserver?.disconnect();
    heroObserver = new IntersectionObserver(([e]) => view.querySelector('.day-mini')?.classList.toggle('show', !e.isIntersecting && !!session && session.type !== BREAK), { threshold: 0 });
    heroObserver.observe(top.querySelector('.hero-row') ?? top);
    if (fkey) view.querySelector(`[data-fkey="${CSS.escape(fkey)}"]`)?.focus({ preventScroll: true });
    if (session && session.type !== BREAK) refreshDerived();
    tickClock();
  }

  function ensureSaved() {
    if (!draft) return;
    draft = false;
    store.addSession(session);
    view.querySelector('.draft-note')?.remove();
  }

  function changed() {
    ensureSaved();
    store.scheduleSave(session);
    refreshDerived();
  }

  async function structural() {
    ensureSaved();
    await store.saveNow(session);
    render();
  }

  async function start(type) {
    session = type === BREAK ? newSession(date, store.state.settings, BREAK) : buildSession(type);
    draft = false;
    await store.addSession(session);
    render();
  }

  // Slim sticky bar that slides in once the header block scrolls away, so progress stays in view.
  function miniBar() {
    const slug = heroSlug();
    mini = { count: h('span', { class: 'num' }), clock: h('span', { class: 'num mini-clock' }) };
    return h('div', { class: `day-mini${slug ? ` t-${slug}` : ' t-none'}`, 'aria-hidden': 'true' },
      h('span', { class: 'mini-name' }, session?.type ? typeName(session.type) : ''), mini.count, mini.clock);
  }

  // ---------- header block in the session colour: name, date, menu, big sets count, progress ----------
  function heroSlug() {
    const t = session?.type ?? (scheduled && !trainAnyway ? scheduled : null);
    return t ? typeColor(t) : null;
  }

  function hero() {
    const slug = heroSlug();
    const training = session && session.type !== BREAK;
    const name = session?.type ? typeName(session.type) : session ? 'Workout' : scheduled === BREAK && !trainAnyway ? 'Break day' : scheduled && !trainAnyway ? typeName(scheduled) : 'No workout yet';
    const count = h('span', { class: 'hero-count num', 'aria-live': 'polite' });
    const pr = h('span', { class: 'hero-pr', hidden: true });
    const fill = h('span', { class: 'hero-fill' });
    const clock = h('span', { class: 'chip on-block hero-clock', hidden: true }, icon('clock'), h('span', { class: 'num' }));
    // Cardio is part of the day (still one session): a small badge with its minutes.
    const cardioList = training ? session.exercises.filter(isCardioExercise) : [];
    const cardioMin = cardioList.reduce((n, e) => n + (e.cardio.minutes ?? 0), 0);
    const cardioBadge = cardioList.length ? h('span', { class: 'chip on-block hero-cardio', id: 'hero-cardio' }, icon('run'),
      h('span', {}, cardioMin ? `Cardio ${fmtNum(cardioMin, 1)} min` : 'Cardio')) : null;
    barEls = { count, clock, fill, pr };
    return h('header', { class: `day-hero${slug ? ` t-${slug}` : ' t-none'}` },
      h('div', { class: 'hero-top' },
        h('a', { class: 'icon-btn on-block', href: `#/cal/${monthKey(monthOf(date))}`, 'aria-label': 'Back to calendar' }, icon('chevL')),
        h('div', { class: 'hero-title' },
          h('h1', { tabindex: '-1' },
            session && session.type !== BREAK
              ? h('button', { class: 'hero-type', onclick: openTypeSheet, dataset: { fkey: 'type-chip' }, 'aria-label': `Session type: ${name}. Change` },
                name, icon('chevD', 'small'))
              : h('span', { class: 'hero-type' }, name)),
          h('p', { class: 'hero-date' }, `${formatDayTitle(date)}, ${relativeDay(date, today).toLowerCase()}`, ' ', saveStatus)),
        h('button', { class: 'icon-btn on-block', 'aria-label': 'Day options', onclick: openMenu }, icon('more'))),
      training ? [
        h('div', { class: 'hero-row' }, count, pr),
        h('div', { class: 'hero-bar', role: 'presentation' }, fill),
        h('div', { class: 'hero-chips' }, clock, cardioBadge),
      ] : null);
  }

  function tickClock() {
    if (!barEls || !session?.startedAt) return;
    barEls.clock.hidden = false;
    const end = session.finishedAt ?? Date.now();
    barEls.clock.lastChild.textContent = formatElapsed(end - session.startedAt);
    if (mini) mini.clock.textContent = formatElapsed(end - session.startedAt);
    barEls.clock.setAttribute('aria-label', `${session.finishedAt ? 'Workout took' : 'Elapsed'} ${formatElapsed(end - session.startedAt)}`);
  }
  const clockHandle = setInterval(tickClock, 1000);

  // ---------- scheduled break, nothing logged ----------
  function breakState() {
    return h('section', { class: 'empty-state' },
      plate('break', 'break', 'big'),
      h('h2', {}, 'Break day'),
      h('p', { class: 'muted' }, 'Rest is part of the plan.'),
      h('div', { class: 'stack' },
        h('button', { class: 'btn primary block', onclick: () => start(BREAK) },
          when === 'future' ? 'Keep as rest day' : 'Log rest day'),
        h('button', { class: 'btn block', onclick: () => { trainAnyway = true; render(); } }, 'Train anyway')),
      weighInLink());
  }

  function restDay() {
    return h('div', { class: 'stack' },
      h('section', { class: 'empty-state' },
        plate('rest', 'break', 'big'),
        h('h2', {}, when === 'future' ? 'Rest day planned' : 'Rest day logged'),
        h('p', { class: 'muted' }, 'Changed your mind? Pick a session type.'),
        typeButtons()),
      notesField(),
      weighInLink(),
      deleteButton());
  }

  // ---------- nothing planned (or "train anyway") ----------
  function emptyState() {
    return h('section', { class: 'empty-state' },
      h('h2', {}, trainAnyway ? 'Train anyway' : when === 'future' ? 'Nothing planned' : 'No workout logged'),
      h('p', { class: 'muted' }, 'Pick a session type. Its template loads with your last weights.'),
      typeButtons(),
      h('div', { class: 'stack' },
        h('button', { class: 'btn block', onclick: () => start(null) }, icon('plus'),
          when === 'future' ? 'Plan without a type' : 'Start without a type'),
        trainAnyway ? null : h('button', { class: 'btn block subtle', onclick: () => start(BREAK) }, 'Mark as break day')),
      weighInLink());
  }

  function typeButtons() {
    // Every type you can pick (Session types in the Planner), each with its name: colour is never the only cue.
    return h('div', { class: 'type-grid' }, pickerTypes().map((t) => h('button', {
      class: `type-opt t-${typeColor(t.id)}`, onclick: () => (session ? changeType(t.id) : start(t.id)),
    }, plate('done', typeColor(t.id)), h('span', {}, t.name))));
  }

  function weighInLink() {
    const e = store.state.body.get(date);
    if (!e && date > today) return null;
    return h('a', { class: 'card row-link', href: `#/progress/~body/${date}` },
      icon('scale'),
      e ? (e.weight != null ? h('span', {}, 'Weigh-in ', h('strong', { class: 'num' }, fmtWU(e.weight))) : h('span', {}, 'Body log: measurements')) : h('span', {}, 'Log weigh-in'),
      icon('chevR', 'end'));
  }

  // ---------- editor ----------
  function editor() {
    const list = store.allSessions();
    const parts = [];

    if (draft) {
      parts.push(h('p', { class: 'draft-note' }, icon('info'),
        h('span', {}, h('strong', {}, `${typeName(session.type)} from your plan. `),
          when === 'future'
            ? 'Nothing is saved until you change something.'
            : 'Weights are from last time. Tick each set when you finish it.')));
    } else if (scheduled && session.type && session.type !== scheduled) {
      parts.push(h('p', { class: 'draft-note' }, icon('info'), h('span', {}, `Changed from ${typeName(scheduled)} for this day only.`)));
    }

    // A past planned day with nothing logged: offer an optional one-tap reason.
    if (draft && when === 'past') parts.push(skipReasonRow());

    exList = h('div', { class: 'ex-list' }, session.exercises.map((ex) => exerciseGroup(ex, list)));
    parts.push(h('section', { class: 'ex-section', 'aria-label': 'Exercises' },
      exList,
      session.exercises.length ? null : h('p', { class: 'muted empty-ex' }, 'No exercises yet. Add one to get going.'),
      h('button', { class: 'add-row', onclick: addExerciseFlow, dataset: { fkey: 'add-exercise' } }, icon('plus'), 'Add exercise')));

    if (when !== 'future') parts.push(finishBlock());
    parts.push(notesField(), weighInLink());
    if (!draft) parts.push(deleteButton());
    return h('div', { class: 'stack day-body' }, parts);
  }

  function skipReasonRow() {
    const row = h('div', { class: 'skip-row' });
    const draw = () => {
      const cur = store.state.skipReasons[date] ?? null;
      row.replaceChildren(
        h('p', { class: 'fine' }, 'Skipped this day? Note why. It’s optional.'),
        h('div', { class: 'reasons', role: 'group', 'aria-label': 'Reason for skipping' }, SKIP_REASONS.map((r) => h('button', {
          class: 'reason', 'aria-pressed': String(cur === r), dataset: { reason: r },
          onclick: async () => {
            await store.setSkipReason(date, cur === r ? null : r);
            draw();
            row.querySelector(`[data-reason="${r}"]`)?.focus({ preventScroll: true });
          },
        }, r))));
    };
    draw();
    return row;
  }

  function finishBlock() {
    if (session.finishedAt) {
      const took = session.startedAt ? ` in ${formatElapsed(session.finishedAt - session.startedAt)}` : '';
      return h('div', { class: 'card finished-row' },
        h('span', { class: 'check-dot' }, icon('check')),
        h('span', {}, `Workout finished${took}`),
        h('button', { class: 'btn small', onclick: openFinishSheet }, 'See summary'));
    }
    return h('button', { class: 'btn session block finish-btn', onclick: openFinishSheet }, icon('flag'), 'Finish workout');
  }

  function notesField() {
    return h('div', { class: 'card field notes-field' },
      h('label', { for: 'notes', class: 'label' }, 'Notes'),
      autoGrow(h('textarea', {
        id: 'notes', rows: '2', placeholder: 'How did it feel?', dataset: { fkey: 'notes' },
        value: session?.notes ?? '',
        oninput: (e) => { session.notes = e.target.value; autoGrowNow(e.target); changed(); },
      })));
  }

  function deleteButton() {
    return h('button', { class: 'btn danger-ghost block', onclick: deleteDay }, icon('trash'),
      scheduled ? 'Clear this day' : 'Delete this day');
  }

  // ---------- menus & sheets ----------
  function openMenu() {
    const list = store.allSessions();
    const last = session?.type && session.type !== BREAK ? lastSessionOfType(list, session.type, date, today) : null;
    const missing = missingFromTemplate();
    sheet({
      title: formatDayTitle(date),
      label: 'Day options',
      build: (close) => {
        const item = (ic, label, fn, cls = '') => h('button', { class: `menu-item ${cls}`, onclick: () => { close(); fn(); } }, icon(ic), h('span', {}, label));
        const awake = h('input', {
          id: 'keep-awake', type: 'checkbox', class: 'switch', checked: !!store.state.settings.keepAwake, disabled: !wakeLockSupported(),
          onchange: async (e) => {
            await store.saveSettings({ keepAwake: e.target.checked });
            const held = await setKeepAwake(e.target.checked && when === 'today');
            if (e.target.checked && when === 'today' && !held) toast('Couldn’t keep the screen on right now.');
          },
        });
        return h('div', { class: 'menu' },
          h('div', { class: 'menu-row2' },
            h('a', { class: 'menu-item', href: `#/day/${addDays(date, -1)}`, onclick: (e) => { e.preventDefault(); close(); location.replace(`#/day/${addDays(date, -1)}`); } }, icon('chevL'), h('span', {}, 'Previous day')),
            h('a', { class: 'menu-item', href: `#/day/${addDays(date, 1)}`, onclick: (e) => { e.preventDefault(); close(); location.replace(`#/day/${addDays(date, 1)}`); } }, h('span', {}, 'Next day'), icon('chevR'))),
          session && session.type !== BREAK ? item('plus', 'Add exercise', addExerciseFlow) : null,
          session ? item('dumbbell', 'Change session type', openTypeSheet) : null,
          missing.length ? item('plan', `Add missing from ${typeName(session.type)} template (${missing.length})`, addMissing) : null,
          last ? item('copy', `Copy exercises from last ${typeName(session.type)} (${formatShort(last.date, today)})`, () => copyFrom(last)) : null,
          session && !draft && session.type !== BREAK && session.exercises.length ? item('calendar', 'Copy to another date', openCopySheet) : null,
          h('div', { class: 'menu-item switch-row' },
            icon('sun'),
            h('label', { for: 'keep-awake' }, 'Keep screen awake', h('small', {}, wakeLockSupported() ? 'During today’s workout' : 'Not supported in this browser')),
            awake),
          session && !draft ? item('trash', scheduled ? 'Clear this day' : 'Delete this day', deleteDay, 'danger') : null);
      },
    });
  }

  function openTypeSheet() {
    sheet({
      title: 'Session type',
      // Your types plus Break; a hidden or archived type this day already uses stays listed.
      build: (close) => h('div', { class: 'type-grid' }, [
        ...pickerTypes().map((t) => t.id),
        ...(session?.type && session.type !== BREAK && !pickerTypes().some((t) => t.id === session.type) && typeById(session.type) ? [session.type] : []),
        BREAK,
      ].map((t) => h('button', {
        class: `type-opt t-${typeColor(t)}`, 'aria-pressed': String(session?.type === t),
        onclick: () => { close(); changeType(t); },
      }, plate(t === BREAK ? 'break' : 'done', typeColor(t)), h('span', {}, typeName(t))))),
    });
  }

  // ---------- type changes ----------
  const hasEnteredSets = () => session.exercises.some((e) => e.sets.some((s) => s.done));

  async function changeType(t) {
    if (!session) { start(t); return; }
    if (t === session.type) return;
    if (hasEnteredSets()) {
      const ok = await confirmDialog({
        title: `Switch to ${typeName(t)}?`,
        message: t === BREAK
          ? 'This day becomes a rest day and the sets you’ve ticked are removed.'
          : `This loads your ${typeName(t)} template in place of the current exercises. Ticked sets are removed.`,
        confirmLabel: 'Switch',
        danger: true,
      });
      if (!ok) return;
    }
    session.type = t;
    if (t === BREAK) {
      session.exercises = [];
      session.startedAt = null;
      session.finishedAt = null;
    } else {
      session.exercises = exercisesFromTemplate(t, store.state.templates, store.allSessions(), date, today);
    }
    await structural();
  }

  function missingFromTemplate() {
    if (!session?.type || session.type === BREAK) return [];
    const present = new Set(session.exercises.map((e) => exerciseKey(e.name)));
    return templateFor(session.type, store.state.templates).filter((t) => !present.has(exerciseKey(t.name)));
  }

  async function addMissing() {
    const list = store.allSessions();
    missingFromTemplate().forEach((t) => session.exercises.push(plannedExercise(t.name, t, list, date, today)));
    await structural();
  }

  async function copyFrom(last) {
    const present = new Set(session.exercises.map((e) => exerciseKey(e.name)));
    const toAdd = last.exercises.filter((e) => !present.has(exerciseKey(e.name)));
    if (!toAdd.length) { toast('Those exercises are already here.'); return; }
    toAdd.forEach((e) => session.exercises.push(newExercise(e.name, e.sets.filter(isLoggedSet), e)));
    await structural();
    toast(`Copied ${toAdd.length} exercise${toAdd.length === 1 ? '' : 's'} from ${formatShort(last.date, today)}`);
  }

  // ---------- copy this workout to another date ----------
  function suggestCopyDate() {
    for (let i = 1; i <= 14; i++) {
      const d = addDays(today > date ? today : date, i);
      if (scheduledFor(d, store.state.schedule) === session.type && !store.getSession(d)) return d;
    }
    return addDays(today > date ? today : date, 1);
  }

  async function openCopySheet() {
    const target = await sheet({
      title: 'Copy to another date',
      build: (close) => {
        const input = h('input', { id: 'copy-date', type: 'date', value: suggestCopyDate(), required: true });
        return h('form', {
          class: 'stack', onsubmit: (e) => { e.preventDefault(); if (isValidISODate(input.value)) close(input.value); },
        },
        h('p', { class: 'muted' }, `Creates a planned ${session.type ? typeName(session.type) : 'workout'} with the same exercises and your latest weights. Nothing is ticked.`),
        h('div', { class: 'field' }, h('label', { for: 'copy-date', class: 'label' }, 'Date'), input),
        h('button', { class: 'btn primary block', type: 'submit' }, 'Copy workout'));
      },
    });
    if (!target) return;
    if (target === date) { toast('Pick a different date.'); return; }
    const existing = store.getSession(target);
    if (existing && !store.isEmpty(existing)) {
      const ok = await confirmDialog({
        title: `Replace ${formatDayTitle(target)}?`,
        message: 'That day already has a workout. Copying replaces it.',
        confirmLabel: 'Replace', danger: true,
      });
      if (!ok) return;
    }
    const copy = copySessionTo(session, target, store.allSessions(), store.state.settings, today);
    await store.addSession(copy);
    toast(`Copied to ${formatDayTitle(target)}`, { action: { label: 'Open', run: () => { location.hash = `#/day/${target}`; } } });
  }

  // ---------- finish sheet ----------
  async function openFinishSheet() {
    ensureSaved();
    const prs = prsForSession(store.allSessions(), session, today);
    const done = sessionSetCount(session);
    const planned = session.exercises.reduce((n, e) => n + e.sets.filter((x) => x.type !== 'warmup').length, 0);
    const end = session.finishedAt ?? Date.now();
    const lines = [...prs.entries()].flatMap(([id, info]) => {
      const ex = session.exercises.find((e) => e.id === id);
      return info.lines.map((l) => `${ex?.name}: ${l}`);
    });
    const ok = await sheet({
      title: session.finishedAt ? 'Workout summary' : 'Finish workout',
      build: (close) => {
        const notes = h('textarea', { id: 'fin-notes', rows: '3', placeholder: 'How did it feel?', value: session.notes });
        const cardioDone = session.exercises.filter((e) => isCardioExercise(e) && e.cardio.done);
        const canFinish = done > 0 || cardioDone.length > 0;
        return h('form', {
          class: 'stack', onsubmit: (e) => {
            e.preventDefault();
            if (!session.finishedAt && !canFinish) { toast('Nothing done yet. Tick a set or mark a cardio entry Done.'); return; }
            session.notes = notes.value;
            close(true);
          },
        },
        h('dl', { class: 'summary' },
          stat('Duration', session.startedAt ? formatElapsed(end - session.startedAt) : 'Not timed'),
          stat('Volume', `${fmtInt(shownVolume(sessionVolume(session)))} ${wUnit()}`),
          stat('Sets', `${done} of ${planned}`),
          stat('PRs', String(prSetCount(prs)))),
        lines.length ? h('ul', { class: 'pr-list' }, lines.map((l) => h('li', {}, icon('trophy'), h('span', { class: 'pr-tag' }, 'PR'), ` ${l}`))) : null,
        cardioDone.length ? h('p', { class: 'fin-cardio' }, icon('run'), ` Cardio: ${cardioDone.map((e) => `${e.name} ${fmtNum(e.cardio.minutes, 1)} min`).join(', ')}`) : null,
        h('div', { class: 'field' }, h('label', { for: 'fin-notes', class: 'label' }, 'Notes'), notes),
        canFinish || session.finishedAt ? null : h('p', { class: 'muted' }, 'Nothing done yet. Tick a set or mark a cardio entry Done.'),
        h('button', { class: 'btn primary block', type: 'submit' }, session.finishedAt ? 'Save summary' : 'Finish workout'));
      },
    });
    if (!ok) return;
    const first = !session.finishedAt;
    if (first) session.finishedAt = Date.now();
    await structural();
    toast(first ? 'Nice, workout finished.' : 'Summary saved.');
  }
  const stat = (k, v) => h('div', {}, h('dt', {}, k), h('dd', { class: 'num' }, v));

  // ---------- exercises ----------
  const targetText = (t) => {
    if (!t) return null;
    const sets = `${t.sets} set${t.sets === 1 ? '' : 's'}`;
    if (t.repsMin == null) return sets;
    return t.repsMin === t.repsMax ? `${sets}, ${t.repsMin} reps` : `${sets}, ${t.repsMin} to ${t.repsMax} reps`;
  };

  /**
   * One cardio entry: Time (minutes, the only thing Done needs; a Start/Stop timer can fill it in), and optional
   * Distance, Avg speed, Incline and Calories. With Time plus Distance or Speed, the other is worked out live and
   * marked "calculated" (never stored). Empty stays empty.
   */
  function cardioCard(ex) {
    const c = ex.cardio;
    const act = activityFor(ex.name);
    const art = h('article', { class: `card ex cardio-card${c.done ? ' complete' : ''}`, dataset: { exid: ex.id }, 'aria-label': `${ex.name}, cardio` });
    const calcTag = { distanceKm: h('span', { class: 'calc-tag', hidden: true }, 'calculated'), speedKmh: h('span', { class: 'calc-tag', hidden: true }, 'calculated') };
    const ins = {};
    const shown = { minutes: (v) => fmtNum(v, 1), distanceKm: (v) => fmtD(v, 2), speedKmh: (v) => fmtSp(v, 1), incline: (v) => fmtNum(v, 1), kcal: (v) => String(v) };
    const toStored = { minutes: (n) => n, distanceKm: (n) => fromShownD(n), speedKmh: (n) => fromShownD(n), incline: (n) => n, kcal: (n) => n };
    function updateCalc() {
      const d = derive(c);
      for (const key of ['distanceKm', 'speedKmh']) {
        const input = ins[key];
        const isCalc = d.calc === (key === 'distanceKm' ? 'distance' : 'speed');
        if (isCalc) {
          if (document.activeElement !== input) input.value = shown[key](d[key]);
          input.classList.add('calc');
          calcTag[key].hidden = false;
        } else if (input.classList.contains('calc')) {
          input.value = c[key] != null ? shown[key](c[key]) : '';
          input.classList.remove('calc');
          calcTag[key].hidden = true;
        }
      }
      sub.textContent = summary();
    }
    const summary = () => {
      const d = derive(c);
      return [c.minutes != null ? `${fmtNum(c.minutes, 1)} min` : null, d.distanceKm != null ? `${fmtD(d.distanceKm, 2)} ${dUnit()}` : null,
        d.speedKmh != null ? `${fmtSp(d.speedKmh, 1)} ${spUnit()}` : null].filter(Boolean).join(' · ') || 'Cardio';
    };
    const field = (key, label, unit, inputmode = 'decimal') => {
      const id = `cx-${ex.id}-${key}`;
      ins[key] = h('input', {
        id, class: 'num-input cardio-input', type: 'text', inputmode, autocomplete: 'off', placeholder: '–',
        value: c[key] != null ? shown[key](c[key]) : '', dataset: { fkey: `${ex.id}:${key === 'minutes' ? 'min' : key}` },
        'aria-label': `${ex.name}: ${label}${key === 'minutes' ? '' : ' (optional)'}, ${unit}`, onfocus: selectAll,
        oninput: (e) => {
          const raw = e.target.value.trim();
          e.target.classList.remove('calc');
          if (calcTag[key]) calcTag[key].hidden = true;
          const typed = raw === '' ? null : Number(raw.replace(',', '.'));
          const v = typed == null ? null : CARDIO_FIELDS[key](toStored[key](typed));
          c[key] = v;
          markValidity(e.target, raw === '' ? '' : v);
          if (key === 'minutes' && v == null && c.done) { c.done = false; art.classList.remove('complete'); doneBtn.setAttribute('aria-pressed', 'false'); }
          updateCalc();
          changed();
        },
        onchange: (e) => { if (c[key] != null && !e.target.classList.contains('calc')) e.target.value = shown[key](c[key]); updateCalc(); },
      });
      return h('div', { class: `cardio-field cf-${key}` },
        h('label', { for: id }, label, h('span', { class: 'muted' }, ` ${unit}`), calcTag[key] ?? null),
        ins[key]);
    };
    // Start/Stop: fills Time with the elapsed minutes. Survives leaving the screen (the start time is saved).
    const timerBtn = h('button', { class: 'btn small soft cardio-timer', type: 'button', dataset: { fkey: `${ex.id}:timer` } });
    const paintTimer = () => {
      if (!c.timerStartedAt) { timerBtn.replaceChildren(icon('play'), 'Start'); timerBtn.setAttribute('aria-label', `Start a timer for ${ex.name}`); return; }
      const sec = Math.max(0, Math.round((Date.now() - c.timerStartedAt) / 1000));
      timerBtn.replaceChildren(icon('pause'), h('span', { class: 'num' }, `Stop ${formatClock(sec)}`));
      timerBtn.setAttribute('aria-label', `Stop the timer for ${ex.name}, running ${Math.floor(sec / 60)} minutes`);
    };
    const runTimer = () => { const t = setInterval(paintTimer, 1000); cardioTimers.add(t); };
    timerBtn.addEventListener('click', () => {
      if (c.timerStartedAt) {
        c.minutes = CARDIO_FIELDS.minutes(Math.max(0.1, (Date.now() - c.timerStartedAt) / 60000));
        c.timerStartedAt = null;
        ins.minutes.value = shown.minutes(c.minutes);
        markValidity(ins.minutes, c.minutes);
        cardioTimers.forEach(clearInterval);
        cardioTimers.clear();
      } else {
        c.timerStartedAt = Date.now();
        runTimer();
      }
      paintTimer();
      updateCalc();
      changed();
    });
    if (c.timerStartedAt) runTimer();
    paintTimer();

    const doneBtn = h('button', {
      class: 'tick cardio-done', type: 'button', 'aria-pressed': String(c.done), 'aria-label': `${ex.name} done`, dataset: { fkey: `${ex.id}:done` },
      onclick: () => {
        if (!c.done && c.minutes == null) {
          // Time is the only thing Done needs; every other field may stay empty.
          toast(`Enter the time for ${ex.name}, then tap Done.`);
          ins.minutes.focus();
          return;
        }
        c.done = !c.done;
        doneBtn.setAttribute('aria-pressed', String(c.done));
        art.classList.toggle('complete', c.done);
        afterDoneChange(c.done);
        changed();
      },
    }, icon('check'));
    const sub = h('span', { class: 'ex-sub' }, summary());
    art.append(
      h('header', { class: 'ex-head' },
        h('span', { class: 'ex-tile' }, icon(act?.icon ?? 'run')),
        h('span', { class: 'ex-text' }, h('h3', { class: 'ex-name' }, ex.name), sub),
        doneBtn,
        h('button', { class: 'icon-btn subtle', 'aria-label': `Remove ${ex.name}`, onclick: () => removeExercise(ex) }, icon('trash'))),
      h('div', { class: 'cardio-body' },
        h('div', { class: 'cardio-time' }, field('minutes', 'Time', 'min'), timerBtn),
        h('div', { class: 'cardio-grid' },
          field('distanceKm', 'Distance', dUnit()), field('speedKmh', 'Avg speed', spUnit()),
          field('incline', 'Incline', '%'), field('kcal', 'Calories', 'kcal', 'numeric'))));
    updateCalc();
    return art;
  }

  /** Every exercise (sets and cardio) done on a past or today's day finishes the workout; undo straight after reopens it. */
  function afterDoneChange(nowDone) {
    const allDone = session.exercises.length && session.exercises.every(isExDone);
    if (nowDone && allDone && !session.finishedAt && when !== 'future') {
      session.finishedAt = Date.now();
      autoFinished = true;
      toast('Nice, workout finished.');
    } else if (!nowDone && autoFinished && session.finishedAt) {
      session.finishedAt = null;
      autoFinished = false;
    }
  }

  function exerciseGroup(ex, list) {
    if (isCardioExercise(ex)) return cardioCard(ex);
    const done = isExDone(ex);
    const collapsed = (done && !expanded.has(ex.id)) || shut.has(ex.id);
    const last = lastSetsFor(list, exerciseKey(ex.name), date, today);
    const lastAll = lastLoggedSets(list, exerciseKey(ex.name), date, today); // every set, warm-ups included
    const nDone = ex.sets.filter((s) => s.done).length;
    const art = h('article', { class: `card ex${collapsed ? ' collapsed' : ''}${done ? ' complete' : ''}`, dataset: { exid: ex.id }, 'aria-label': exLabel(ex.name) });
    const sub = collapsed && done ? h('span', { class: 'ex-sub ex-summary num' }, formatSetGroups(ex.sets) || `${nDone} sets`, h('span', { class: 'pr-slot' }))
      : h('span', { class: 'ex-sub' }, targetText(ex.target) ?? `${ex.sets.length} set${ex.sets.length === 1 ? '' : 's'}`);

    art.append(h('header', { class: 'ex-head' },
      h('button', {
        class: 'ex-toggle', 'aria-expanded': String(!collapsed), dataset: { fkey: `${ex.id}:toggle` },
        onclick: () => {
          if (collapsed) { expanded.add(ex.id); shut.delete(ex.id); } else { expanded.delete(ex.id); if (!done) shut.add(ex.id); }
          render();
        },
      },
      h('span', { class: 'ex-tile' }, icon(groupIcon(store.primaryGroup(ex.name), session.type))),
      h('span', { class: 'ex-text' }, h('h3', { class: 'ex-name', title: exLabel(ex.name) !== ex.name ? ex.name : null }, exLabel(ex.name)), sub),
      done ? h('span', { class: 'check-dot', title: 'All sets done' }, icon('check'))
        : h('span', { class: 'ex-count num' }, `${nDone}/${ex.sets.length}`, h('span', { class: 'sr-only' }, ' sets done')),
      icon(collapsed ? 'chevD' : 'chevU', 'ex-chev')),
      h('button', { class: 'icon-btn subtle', 'aria-label': `${exLabel(ex.name)} options`, onclick: () => openExerciseSheet(ex) }, icon('more'))));
    if (collapsed) return art;

    const rest = restSecondsFor(ex, store.state.settings);
    const step = weightStepFor(ex, store.state.settings);
    art.append(...[
      h('div', { class: 'ex-info' },
        h('button', {
          class: 'chip', dataset: { fkey: `${ex.id}:rest` }, onclick: () => openExerciseSheet(ex),
          'aria-label': `Rest ${formatClock(rest * 1000)}. Change`,
        }, icon('timer'), h('span', { class: 'num' }, formatClock(rest * 1000))),
        h('p', { class: 'last-time' }, lastAll
          ? ['Last ', h('span', { class: 'num' }, lastAll.sets.map((x) => `${x.type === 'warmup' ? 'W ' : ''}${formatSet(x, true)}`).join(', '))]
          : h('span', { class: 'first-time' }, 'First time. Starting weight?'))),
      ex.note ? h('button', { class: 'ex-note', onclick: () => openExerciseSheet(ex, true) }, icon('note'), h('span', {}, ex.note)) : null,
      hintLine(ex, last, step),
      h('p', { class: 'pr-line', hidden: true }),
      h('div', { class: 'sets', role: 'list' }, ex.sets.map((set, i) => setRow(ex, set, i, step))),
      h('button', { class: 'btn ghost small add-set', dataset: { fkey: `${ex.id}:add` }, onclick: () => addSet(ex) }, icon('plus'), 'Add set'),
    ].filter(Boolean));
    return art;
  }

  /** Progressive-overload suggestion (rules in progression.js): one compact row, hidden once any set is ticked. */
  function hintLine(ex, last, step) {
    if (ex.hintDismissed || date < today || !last || ex.sets.some((s) => s.done)) return null;
    const sug = suggest(last.sets, ex.target, step, { fmt: (kg) => fmtW(kg), unit: wUnit(), goalNote: (kind) => goalHint(store.state.profile.goal, kind) });
    if (!sug) return null;
    const ic = sug.kind === 'drop' ? 'down' : sug.kind === 'repeat' ? 'same' : 'up';
    return h('div', { class: `hint hint-${sug.kind}` },
      icon(ic, 'hint-ic'),
      h('p', { class: 'hint-text' }, h('strong', {}, sug.text), ' ', h('span', {}, sug.reason)),
      h('button', {
        class: 'pill-btn', 'aria-label': `Apply suggestion: ${sug.text}`,
        onclick: () => {
          let k = 0;
          ex.sets.forEach((set) => {
            if (set.type === 'warmup' || set.done) return;
            set.weight = sug.weight;
            set.reps = sug.reps[k] ?? sug.reps[sug.reps.length - 1];
            k++;
          });
          ex.hintDismissed = true;
          structural();
        },
      }, 'Apply'),
      h('button', { class: 'icon-btn subtle small', 'aria-label': 'Dismiss suggestion', onclick: () => { ex.hintDismissed = true; structural(); } }, icon('x')));
  }

  function openExerciseSheet(ex, focusNote = false) {
    const rest = restSecondsFor(ex, store.state.settings);
    sheet({
      title: exLabel(ex.name),
      build: (close) => {
        const note = h('textarea', {
          id: 'ex-note', rows: '2', maxlength: '500', placeholder: 'Seat height, grip, machine setting…', value: ex.note ?? '',
          oninput: (e) => { ex.note = cleanNote(e.target.value); changed(); },
        });
        if (focusNote) requestAnimationFrame(() => note.focus());
        return h('div', { class: 'stack' },
          h('div', { class: 'field' }, h('label', { for: 'ex-note', class: 'label' }, 'Note for next time'), note),
          h('div', { class: 'field' },
            h('span', { class: 'label', id: 'rest-l' }, 'Rest after each set'),
            h('div', { class: 'presets left', role: 'group', 'aria-labelledby': 'rest-l' }, REST_PRESETS.map((sec) => h('button', {
              class: 'preset num', 'aria-pressed': String(sec === rest),
              onclick: () => { ex.restSeconds = sec; close(); structural(); },
            }, formatClock(sec * 1000))))),
          h('div', { class: 'menu' },
            ex.sets.length ? h('button', { class: 'menu-item', onclick: () => { close(); removeSet(ex, ex.sets.length - 1); } }, icon('minus'), h('span', {}, 'Remove last set')) : null,
            h('button', { class: 'menu-item danger', onclick: () => { close(); removeExercise(ex); } }, icon('trash'), h('span', {}, `Remove ${exLabel(ex.name)}`))));
      },
    }).then(() => render());
  }

  /** Select the whole value on focus so typing replaces it (needs a tick on iOS). */
  function selectAll(e) { const el = e.target; setTimeout(() => el.select(), 0); }

  function setRow(ex, set, i, step) {
    const n = i + 1;
    const type = set.type ?? 'working';
    const row = h('div', { class: `set-row${set.done ? ' done' : ''} st-${type}`, role: 'listitem' });
    const repsHint = formatReps(ex.target);

    const weightIn = h('input', {
      class: 'num-input', type: 'text', inputmode: 'decimal', autocomplete: 'off', enterkeyhint: 'next',
      placeholder: '–', 'aria-label': `${exLabel(ex.name)}, set ${n}, weight in ${wUnit()}`,
      value: set.weight == null ? '' : fmtW(set.weight), dataset: { fkey: `${ex.id}:${i}:w` },
      onfocus: selectAll,
      oninput: (e) => { set.weight = parseShownW(e.target.value); markValidity(e.target, set.weight); changed(); },
      onchange: (e) => { if (set.weight != null) e.target.value = fmtW(set.weight); },
      onkeydown: enterToNext,
    });
    const repsIn = h('input', {
      class: 'num-input', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', enterkeyhint: 'next',
      placeholder: ex.target?.repsMin != null ? String(ex.target.repsMin) : '–', 'aria-label': `${exLabel(ex.name)}, set ${n}, reps${repsHint ? ` (target ${repsHint})` : ''}`,
      value: set.reps ?? '', dataset: { fkey: `${ex.id}:${i}:r` },
      onfocus: selectAll,
      oninput: (e) => { set.reps = parseReps(e.target.value); markValidity(e.target, set.reps); changed(); },
      onkeydown: enterToNext,
    });
    // Long values (102.5) get a slightly smaller numeral so they always fit the pill.
    const fit = (el) => el.classList.toggle('long', el.value.length > 4);
    [weightIn, repsIn].forEach((el) => { fit(el); el.addEventListener('input', () => fit(el)); });
    const bump = (field, delta) => {
      if (field === 'weight') {
        // Round in the shown unit, so 135 lb + 5 lb is exactly 140 lb (stored as kg).
        set.weight = Math.max(0, fromShownW(Math.round((toShownW(set.weight ?? 0) + toShownW(delta)) * 100) / 100));
        weightIn.value = fmtW(set.weight);
        markValidity(weightIn, set.weight);
      } else {
        set.reps = Math.max(0, (set.reps ?? 0) + delta);
        repsIn.value = set.reps;
        markValidity(repsIn, set.reps);
      }
      fit(weightIn);
      fit(repsIn);
      changed();
    };
    const stepBtn = (ic, aria, fkey, fn) => h('button', { class: 'step-btn', 'aria-label': aria, dataset: { fkey }, onclick: fn }, icon(ic));

    const tick = h('button', {
      class: 'tick', 'aria-pressed': String(!!set.done),
      'aria-label': `${exLabel(ex.name)}, set ${n} done`, dataset: { fkey: `${ex.id}:${i}:d` },
      onclick: () => toggleDone(ex, set, i, row, tick),
    }, h('span', { class: 'tick-ic' }, icon('check')));

    row.append(
      h('button', {
        class: 'set-type', dataset: { fkey: `${ex.id}:${i}:t` },
        'aria-label': `Set ${n}: ${SET_TYPE_LABEL[type]}. Change set type`,
        onclick: () => { set.type = SET_CYCLE[type]; structural(); },
      }, type === 'warmup' ? 'W' : type === 'failure' ? 'F' : String(n), h('span', { class: 'pr-mark' }, icon('trophy'))),
      h('div', { class: 'stepper' },
        stepBtn('minus', `${exLabel(ex.name)}, set ${n}: weight minus ${fmtWU(step)}`, `${ex.id}:${i}:w-`, () => bump('weight', -step)),
        h('span', { class: 'val' }, weightIn, h('span', { class: 'unit', 'aria-hidden': 'true' }, wUnit())),
        stepBtn('plus', `${exLabel(ex.name)}, set ${n}: weight plus ${fmtWU(step)}`, `${ex.id}:${i}:w+`, () => bump('weight', step))),
      h('div', { class: 'stepper' },
        stepBtn('minus', `${exLabel(ex.name)}, set ${n}: one rep fewer`, `${ex.id}:${i}:r-`, () => bump('reps', -1)),
        h('span', { class: 'val' }, repsIn, h('span', { class: 'unit', 'aria-hidden': 'true' }, 'reps')),
        stepBtn('plus', `${exLabel(ex.name)}, set ${n}: one more rep`, `${ex.id}:${i}:r+`, () => bump('reps', 1))),
      tick);
    return row;
  }

  function toggleDone(ex, set, i, row, tick) {
    if (!set.done) {
      const missing = [set.weight == null ? 'a weight' : null, set.reps == null || set.reps === 0 ? 'reps' : null].filter(Boolean);
      if (missing.length) {
        row.classList.remove('shake');
        void row.offsetWidth;
        row.classList.add('shake');
        toast(`Set ${i + 1} needs ${missing.join(' and ')}. Enter ${missing.length > 1 ? 'them' : 'it'}, then tick.`);
        row.querySelector(set.weight == null ? '[data-fkey$=":w"]' : '[data-fkey$=":r"]')?.focus();
        return;
      }
    }
    set.done = !set.done;
    row.classList.toggle('done', set.done);
    // Every set ticked: the workout is finished (the only other way is tapping Finish workout).
    const allDone = session.exercises.length && session.exercises.every(isExDone);
    const completesWorkout = set.done && allDone;
    if (set.done && allDone && !session.finishedAt && when !== 'future') {
      session.finishedAt = Date.now();
      autoFinished = true;
      toast('Nice, workout finished.');
    } else if (!set.done && autoFinished && session.finishedAt) {
      session.finishedAt = null; // unticked straight after: not finished after all
      autoFinished = false;
    }
    tick.setAttribute('aria-pressed', String(set.done));
    if (set.done) {
      buzz(12);
      row.closest('.ex')?.querySelector('.hint')?.remove(); // the hint was about before you started
      if (when === 'today' && !session.startedAt) session.startedAt = Date.now();
      // No rest after the set that completes the workout: there's no next set to rest for (an earlier rest stops).
      if (completesWorkout) { if (getRest()) stopRest(); } else if (when === 'today' && store.state.settings.autoStartRest !== false) startRest(restSecondsFor(ex, store.state.settings), exLabel(ex.name), typeColor(session.type));
    }
    changed();
    tickClock();
    const head = row.closest('.ex')?.querySelector('.ex-count');
    if (head) head.firstChild.textContent = `${ex.sets.filter((s) => s.done).length}/${ex.sets.length}`;
    if (set.done && isExDone(ex)) {
      // Collapse the finished exercise and bring the next unfinished one into view.
      setTimeout(() => {
        expanded.delete(ex.id);
        render();
        const idx = session.exercises.indexOf(ex);
        const next = [...session.exercises.slice(idx + 1), ...session.exercises.slice(0, idx)].find((e) => !isExDone(e));
        const card = next && view.querySelector(`[data-exid="${next.id}"]`);
        if (card) {
          card.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
          card.querySelector('.tick[aria-pressed="false"]')?.focus({ preventScroll: true });
        } else {
          view.querySelector('.finish-btn')?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
        }
      }, reducedMotion() ? 0 : 260);
    }
  }

  function addSet(ex) {
    const prev = ex.sets.at(-1);
    const type = prev?.type === 'failure' ? 'failure' : 'working';
    ex.sets.push(newSet(prev?.weight ?? null, prev?.reps ?? null, type));
    expanded.add(ex.id);
    structural();
  }

  function removeSet(ex, i) {
    ex.sets.splice(i, 1);
    structural();
  }

  async function removeExercise(ex) {
    const idx = session.exercises.indexOf(ex);
    if (idx < 0) return;
    session.exercises.splice(idx, 1);
    await structural();
    toast(`Removed ${exLabel(ex.name)}`, {
      timeout: 6000,
      action: { label: 'Undo', run: () => { session.exercises.splice(idx, 0, ex); structural(); } },
    });
  }

  async function addExerciseFlow() {
    const list = store.allSessions();
    const present = new Set(session.exercises.map((e) => exerciseKey(e.name)));
    const name = await openExercisePicker({
      names: store.allExerciseNames(),
      usage: exerciseUsage(list, today),
      present,
      type: session.type,
      lastFor: (key) => lastSetsFor(list, key, date, today),
      cardio: true,
    });
    if (!name) return;
    const act = activityFor(name);
    if (act) {
      // A cardio activity: one entry, no sets (any day, any type).
      const ex = newCardioExercise(act.name, uid());
      session.exercises.push(ex);
      await structural();
      const card = view.querySelector(`[data-exid="${ex.id}"]`);
      card?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
      card?.querySelector('[data-fkey$=":min"]')?.focus({ preventScroll: true });
      return;
    }
    const key = exerciseKey(name);
    if (present.has(key)) { toast('Already added.'); return; }
    const known = store.allExerciseNames().find((n) => n.key === key);
    const display = known?.name ?? cleanName(name);
    if (!known) await store.addCustomExercise(display);
    const ex = plannedExercise(display, templateItemFor(session.type, display, store.state.templates), list, date, today);
    session.exercises.push(ex);
    await structural();
    const card = view.querySelector(`[data-exid="${ex.id}"]`);
    card?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    // First time: no weight to copy, so ask for one.
    if (ex.sets[0]?.weight == null) card?.querySelector('[data-fkey$=":0:w"]')?.focus({ preventScroll: true });
  }

  // ---------- derived bits (PRs, counts) ----------
  function refreshDerived() {
    // The day's cardio badge follows the minutes as they're typed.
    const badge = document.getElementById('hero-cardio');
    if (badge && session) {
      const min = session.exercises.filter(isCardioExercise).reduce((n, e) => n + (e.cardio.minutes ?? 0), 0);
      badge.lastElementChild.textContent = min ? `Cardio ${fmtNum(min, 1)} min` : 'Cardio';
    }
    const prs = prsForSession(store.allSessions(), session, today);
    exList?.querySelectorAll('.ex').forEach((card) => {
      const info = prs.get(card.dataset.exid);
      const line = card.querySelector('.pr-line');
      if (line) {
        line.hidden = !info;
        line.replaceChildren(...(info ? [icon('trophy'), h('span', { class: 'pr-tag' }, 'PR'), ` ${info.lines.join('. ')}`] : []));
      }
      const slot = card.querySelector('.pr-slot');
      if (slot) slot.replaceChildren(...(info ? [' ', icon('trophy'), h('span', { class: 'pr-tag' }, 'PR')] : []));
      card.querySelectorAll('.set-row').forEach((row, i) => {
        const btn = row.querySelector('.tick');
        const labels = info?.sets.get(i);
        row.classList.toggle('pr', !!labels);
        const base = btn.getAttribute('aria-label').replace(/, new PR.*$/, '');
        btn.setAttribute('aria-label', labels ? `${base}, new PR: ${labels.join(', ')}` : base);
      });
    });
    if (barEls) {
      const total = session.exercises.reduce((n, e) => n + e.sets.length, 0);
      const done = session.exercises.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0);
      const nPR = prSetCount(prs);
      const text = `${done} of ${total} sets`;
      if (barEls.count.textContent && barEls.count.textContent !== text) {
        barEls.count.classList.remove('bump');
        void barEls.count.offsetWidth; // restart the animation
        barEls.count.classList.add('bump');
      }
      barEls.count.textContent = text;
      if (mini) mini.count.textContent = `${done}/${total} sets`;
      barEls.fill.style.width = `${total ? (done / total) * 100 : 0}%`;
      barEls.pr.hidden = !nPR;
      barEls.pr.replaceChildren(icon('trophy'), `${nPR} PR`);
      tickClock();
    }
  }

  async function deleteDay() {
    const ok = await confirmDialog({
      title: scheduled ? 'Clear this day?' : 'Delete this day?',
      message: `This removes everything logged on ${formatDayTitle(date)}${scheduled ? ' and puts it back to your weekly plan' : ''}. You can’t undo this.`,
      confirmLabel: scheduled ? 'Clear day' : 'Delete day',
      danger: true,
    });
    if (!ok) return;
    const removed = structuredClone(session);
    await store.deleteSession(date);
    session = null;
    toast(scheduled ? 'Day cleared' : 'Day deleted', {
      survive: true,
      action: { label: 'Undo', run: async () => { await store.addSession(removed); location.hash = `#/day/${date}`; } },
    });
    location.hash = `#/cal/${monthKey(monthOf(date))}`;
  }

  render();
  if (when === 'today' && store.state.settings.keepAwake) setKeepAwake(true);

  // Cleanup when leaving the screen: save, and drop a session that was opened but never used.
  return async () => {
    offSave();
    clearInterval(clockHandle);
    cardioTimers.forEach(clearInterval);
    setKeepAwake(false);
    heroObserver?.disconnect();
    if (!session || draft) return;
    await store.flushAll();
    if (store.getSession(date) === session && store.isEmpty(session)) await store.deleteSession(date);
  };
}

function markValidity(input, parsed) {
  const bad = input.value.trim() !== '' && parsed == null;
  input.setAttribute('aria-invalid', bad ? 'true' : 'false');
}

function enterToNext(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const inputs = [...document.querySelectorAll('.day-view .sets .num-input')];
  const next = inputs[inputs.indexOf(e.target) + 1];
  if (next) next.focus(); else e.target.blur();
}

function autoGrowNow(ta) {
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight + 2}px`;
}
function autoGrow(ta) {
  requestAnimationFrame(() => autoGrowNow(ta));
  return ta;
}
