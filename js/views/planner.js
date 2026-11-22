// Planner tab: weekly schedule (weekday → type / Break), split presets, your session types, and per-type
// templates with sets × rep ranges. Types are data (js/types.js): everything here refers to them by id.
import { h, icon, plate, toast, confirmDialog, sheet } from '../ui.js';
import * as store from '../store.js';
import { exName } from '../library.js';
import { fmtW, parseShownW, wUnit } from '../units.js';
import {
  BREAK, WEEKDAY_KEYS, DEFAULT_WEEK, DEFAULT_TARGET,
  exerciseKey, cleanName, normalizeTarget, formatTarget, normalizeRest, normalizeStep,
} from '../model.js';
import { currentWeek, templateFor, scheduledFor } from '../plan.js';
import { weekdayLabels, todayISO, addDays } from '../dates.js';
import { exerciseUsage, lastSetsFor } from '../stats.js';
import { openExercisePicker } from './picker.js';
import { GROUPS } from '../muscles.js';
import { MAX_SPLITS, splitDaysText } from '../splits.js';
import {
  pickerTypes, allTypes, typeById, typeName, typeColor, typeShort, PRESETS, PALETTE_KEYS, COLOR_NAMES, nextColor, autoShort,
} from '../types.js';

/** Lifting types you can pick (they have templates), plus `keep` if it's hidden or archived. */
const liftTypes = (keep) => [...pickerTypes().filter((t) => t.kind === 'lift'), ...(keep && typeById(keep) && !pickerTypes().some((t) => t.id === keep) ? [typeById(keep)] : [])];

let selectedType = null; // remembered while the app is open

export function renderPlanner(root) {
  const today = todayISO();
  if (!selectedType) {
    const upcoming = [0, 1, 2, 3, 4, 5, 6].map((n) => scheduledFor(addDays(today, n), store.state.schedule));
    selectedType = upcoming.find((t) => liftTypes().some((x) => x.id === t)) ?? liftTypes()[0]?.id ?? null;
  }
  if (selectedType && !typeById(selectedType)) selectedType = liftTypes()[0]?.id ?? null;

  // ---------- weekly schedule ----------
  const ws = store.state.settings.weekStartsOn;
  const schedRows = h('div', { class: 'sched' });
  function drawSchedule() {
    const week = currentWeek(store.state.schedule) ?? {};
    schedRows.replaceChildren(...weekdayLabels(ws).map((label, i) => {
      const key = WEEKDAY_KEYS[(ws + i) % 7];
      const value = week[key] ?? '';
      // Every type you can pick, plus Break (and this day's type if it's since been hidden).
      const options = [...pickerTypes(), ...(value && value !== BREAK && typeById(value) && !pickerTypes().some((t) => t.id === value) ? [typeById(value)] : [])];
      return h('div', { class: 'field-row sched-row' },
        h('label', { for: `sched-${key}` },
          plate(value === BREAK ? 'break' : value ? 'done' : 'none', value ? typeColor(value) : 'none', 'small'),
          label.long),
        h('select', { id: `sched-${key}`, value, onchange: (e) => saveDay(key, e.target.value || null) },
          h('option', { value: '' }, '—'),
          options.map((t) => h('option', { value: t.id }, t.name)),
          h('option', { value: BREAK }, 'Break')));
    }));
  }

  async function saveDay(key, value) {
    await store.saveWeek({ ...(currentWeek(store.state.schedule) ?? {}), [key]: value });
    drawSchedule(); // saved automatically; the note above says it applies from today
  }

  // ---------- saved splits ("Yours") ----------
  const mySplits = h('div', { class: 'my-splits', id: 'my-splits' });
  const abbr = weekdayLabels(ws).map((l) => l.abbr);
  function drawMySplits() {
    const list = store.state.splits;
    const full = list.length >= MAX_SPLITS;
    mySplits.replaceChildren(...[ // (filtered: replaceChildren would print a null)
      list.length ? h('ul', { class: 'my-split-list', 'aria-label': 'Your saved splits' }, list.map((sp) => h('li', { class: 'my-split', dataset: { split: sp.id } },
        h('button', { class: 'my-split-apply', 'aria-label': `Apply your split ${sp.name}`, onclick: () => applyMine(sp.id) },
          h('span', { class: 'my-split-name' }, sp.name, h('span', { class: 'yours' }, 'Yours')),
          h('span', { class: 'my-split-days' }, splitDaysText(sp, abbr, ws))),
        h('button', { class: 'icon-btn', 'aria-label': `${sp.name} options`, onclick: () => splitMenu(sp.id) }, icon('more'))))) : null,
      h('button', { class: 'btn small soft save-split', disabled: full, onclick: saveAsMine }, icon('plus'), 'Save as my split'),
      full ? h('p', { class: 'fine' }, `You have ${MAX_SPLITS} saved splits, the most there can be. Delete one to save another.`) : null,
    ].filter(Boolean));
  }

  /** Ask for a name (new split or rename). Resolves to the name, or null. */
  const askName = (title, value = '', action = 'Save') => sheet({
    title,
    build: (close) => {
      const input = h('input', { id: 'split-name', class: 'ob-input', type: 'text', maxlength: '40', value, placeholder: 'e.g. My 4-day', autocomplete: 'off' });
      return h('form', { class: 'type-form', novalidate: true, onsubmit: (e) => { e.preventDefault(); close(input.value); } },
        h('div', { class: 'ob-field' }, h('label', { for: 'split-name', class: 'ob-label' }, 'Name'), input),
        h('button', { class: 'btn primary block', type: 'submit' }, action));
    },
  });

  async function saveAsMine() {
    const name = await askName('Save as my split', '', 'Save split');
    if (name == null) return;
    try {
      const sp = await store.saveMySplit(name);
      toast(`Saved “${sp.name}”: this week, its ${sp.types.length} session type${sp.types.length === 1 ? '' : 's'} and their templates`);
    } catch (e) { toast(e.message); }
    drawMySplits();
  }

  async function splitMenu(id) {
    const sp = store.state.splits.find((x) => x.id === id);
    const pick = await sheet({
      title: sp.name,
      build: (close) => h('div', { class: 'menu' },
        h('button', { class: 'menu-item', onclick: () => close('apply') }, icon('check'), 'Apply from today'),
        h('button', { class: 'menu-item', onclick: () => close('rename') }, icon('notes'), 'Rename'),
        h('button', { class: 'menu-item', disabled: store.state.splits.length >= MAX_SPLITS, onclick: () => close('duplicate') }, icon('copy'), 'Duplicate'),
        h('button', { class: 'menu-item', onclick: () => close('update') }, icon('refresh'), 'Save the current week into this split'),
        h('button', { class: 'menu-item danger', onclick: () => close('delete') }, icon('trash'), 'Delete')),
    });
    try {
      if (pick === 'apply') return applyMine(id);
      if (pick === 'rename') { const n = await askName(`Rename ${sp.name}`, sp.name, 'Rename'); if (n != null) { await store.renameMySplit(id, n); toast('Renamed'); } }
      if (pick === 'duplicate') { await store.duplicateMySplit(id); toast(`Copied “${sp.name}”`); }
      if (pick === 'update' && await confirmDialog({ title: `Update ${sp.name}?`, message: `${sp.name} takes this week, its session types and their templates as they are now. Your current week doesn't change.`, confirmLabel: 'Update split' })) {
        await store.updateMySplit(id); toast(`“${sp.name}” updated from this week`);
      }
      if (pick === 'delete' && await confirmDialog({ title: `Delete ${sp.name}?`, message: 'Only the saved split is removed. Your week, session types, templates and workouts stay as they are.', confirmLabel: 'Delete', danger: true })) {
        await store.deleteMySplit(id); toast(`Deleted “${sp.name}”`);
      }
    } catch (e) { toast(e.message); }
    drawMySplits();
    return undefined;
  }

  /** The confirm sheet says exactly what will change before anything does. */
  async function applyMine(id) {
    const p = store.previewMySplit(id);
    if (!p) return;
    const names = p.split.types.map((t) => t.name);
    const why = (r) => (r.why === 'deleted' ? `${r.name} was deleted since you saved this split: it's recreated as saved.`
      : r.why === 'archived' ? `${r.name} was archived: it's restored, with its history.`
        : `${r.was !== r.name ? `${r.was} was called ${r.name}` : `${r.name} was edited`} when you saved this split: its name, label and colour go back to how they were saved.`);
    const ok = await sheet({
      title: `Apply ${p.split.name}?`,
      build: (close) => h('div', { class: 'stack apply-sheet' },
        h('p', {}, h('strong', {}, 'Replaces your week from today. '), `Restores these session types and templates: ${names.join(', ')}.`),
        h('p', { class: 'muted' }, splitDaysText(p.split, abbr, ws)),
        p.restored.length ? h('ul', { class: 'apply-notes' }, p.restored.map((r) => h('li', {}, icon('info'), h('span', {}, why(r))))) : null,
        p.hidden.length ? h('p', { class: 'fine' }, `Hidden, not deleted (show them again in Session types): ${p.hidden.join(', ')}.`) : null,
        h('p', { class: 'fine' }, 'Logged workouts and past days don’t change.'),
        h('div', { class: 'row-btns' },
          h('button', { class: 'btn subtle', onclick: () => close(false) }, 'Cancel'),
          h('button', { class: 'btn primary', id: 'apply-split', onclick: () => close(true) }, 'Apply'))),
    });
    if (!ok) return;
    const r = await store.useMySplit(id);
    selectedType = r.ids.find((x) => typeById(x)?.kind === 'lift') ?? selectedType;
    drawAll();
    toast(`${p.split.name} set from today`);
  }

  const scheduleCard = h('section', { class: 'card', 'aria-labelledby': 'sched-h' },
    h('h2', { id: 'sched-h' }, 'Weekly schedule'),
    h('p', { class: 'muted' }, 'Shown on the calendar. A planned day opens with its template filled in. Changes apply from today; past days and logged workouts never change.'),
    schedRows,
    h('div', { class: 'presets' },
      h('p', { class: 'fine' }, 'Start from a split: creates its session types and templates (all editable) and fills the week from today.'),
      h('div', { class: 'preset-btns' }, Object.entries(PRESETS).map(([id, p]) => h('button', {
        class: 'btn small soft', dataset: { preset: id },
        onclick: async () => {
          const ok = await confirmDialog({
            title: `Use the ${p.label}?`,
            message: `${p.types.join(', ')}. Missing types are created with a starter template; other lifting types are hidden (their history stays). Your week is replaced from today.`,
            confirmLabel: `Use ${p.label}`,
          });
          if (!ok) return;
          const r = await store.usePreset(id);
          selectedType = r.ids[0];
          drawAll();
          toast(`${p.label} set from today`);
        },
      }, p.label))),
      mySplits),
    h('div', { class: 'row-btns' },
      h('button', {
        class: 'btn small subtle',
        onclick: async () => { await store.saveWeek(DEFAULT_WEEK); drawSchedule(); toast('Schedule reset'); },
      }, 'Reset to default'),
      h('button', {
        class: 'btn small subtle',
        onclick: async () => {
          await store.saveWeek(Object.fromEntries(WEEKDAY_KEYS.map((k) => [k, null])));
          drawSchedule();
          toast('Schedule cleared');
        },
      }, 'Clear')));

  // ---------- templates ----------
  const tplCard = h('section', { class: 'card', 'aria-labelledby': 'tpl-h' });
  let items = []; // working copy of the selected template
  let saveTimer = null;

  const persist = async () => { if (selectedType) await store.saveTemplates({ ...store.state.templates, [selectedType]: items.map((it) => ({ ...it })) }); };
  const persistSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 300); };

  function drawTemplates() {
    clearTimeout(saveTimer);
    const fkey = document.activeElement?.dataset?.fkey;
    items = templateFor(selectedType, store.state.templates).map((it) => ({ ...it }));
    tplCard.replaceChildren(
      h('h2', { id: 'tpl-h' }, 'Templates'),
      h('p', { class: 'muted' }, 'Loaded when you start a day of that type, with weights from last time. The muscle tag feeds “Sets per muscle” in Progress.'),
      h('fieldset', { class: 'chips tpl-types' },
        h('legend', { class: 'sr-only' }, 'Template to edit'),
        liftTypes(selectedType).map((t) => h('label', { class: `chip t-${typeColor(t.id)}` },
          h('input', {
            type: 'radio', name: 'tpl-type', value: t.id, checked: t.id === selectedType, dataset: { fkey: `tpl-${t.id}` },
            onchange: async () => { await persist(); selectedType = t.id; drawTemplates(); },
          }),
          h('span', {}, t.name, h('span', { class: 'chip-count' }, String(templateFor(t.id, store.state.templates).length)))))),
      !selectedType ? h('p', { class: 'muted empty-ex' }, 'No lifting types to edit. Add one under Session types.')
        : items.length
          ? h('ol', { class: 'tpl-list', 'aria-label': `${typeName(selectedType)} template` }, items.map(itemRow))
          : h('p', { class: 'muted empty-ex' }, `No exercises in the ${typeName(selectedType)} template yet. Add one below.`),
      selectedType ? h('button', { class: 'btn block add-ex', onclick: addToTemplate }, icon('plus'), `Add exercise to ${typeName(selectedType)}`) : null);
    if (fkey) {
      // Keep keyboard focus on the moved item; if its button just became disabled (top/bottom), use a sibling.
      const el = tplCard.querySelector(`[data-fkey="${CSS.escape(fkey)}"]`);
      (el?.disabled ? el.closest('.tpl-item').querySelector('.tpl-tools button:not(:disabled)') : el)?.focus();
    }
  }

  function itemRow(it, i) {
    const id = exerciseKey(it.name);
    const num = (field, label, min, max) => h('input', {
      class: 'num-input tpl-num', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off',
      'aria-label': `${it.name}: ${label}`, value: it[field] ?? '', dataset: { fkey: `${field}-${id}` },
      oninput: (e) => {
        const n = Number(e.target.value);
        const ok = e.target.value === '' ? field !== 'sets' : Number.isInteger(n) && n >= min && n <= max;
        e.target.setAttribute('aria-invalid', ok ? 'false' : 'true');
        if (!ok) return;
        it[field] = e.target.value === '' ? null : n;
        persistSoon();
      },
      onchange: () => {
        // Normalise (e.g. swap 12–8 to 8–12) and show the result.
        const t = normalizeTarget(it) ?? DEFAULT_TARGET;
        Object.assign(it, t);
        drawTemplatesSoon();
      },
    });
    return h('li', { class: 'tpl-item' },
      h('div', { class: 'tpl-top' },
        h('span', { class: 'tpl-n', 'aria-hidden': 'true' }, i + 1),
        h('input', {
          class: 'tpl-name', type: 'text', value: exName(it.name), title: exName(it.name) !== it.name ? it.name : null, autocomplete: 'off', autocapitalize: 'words',
          'aria-label': `Exercise ${i + 1} name`, dataset: { fkey: `name-${id}` },
          onchange: (e) => rename(i, e.target),
        }),
        h('span', { class: 'tpl-tools' },
          h('button', {
            class: 'icon-btn subtle small', 'aria-label': `Move ${exName(it.name)} up`, disabled: i === 0,
            dataset: { fkey: `up-${id}` }, onclick: () => move(i, -1),
          }, icon('chevU')),
          h('button', {
            class: 'icon-btn subtle small', 'aria-label': `Move ${exName(it.name)} down`, disabled: i === items.length - 1,
            dataset: { fkey: `down-${id}` }, onclick: () => move(i, 1),
          }, icon('chevD')),
          h('button', {
            class: 'icon-btn subtle small', 'aria-label': `Remove ${exName(it.name)} from ${typeName(selectedType)} template`,
            onclick: async () => { items.splice(i, 1); await persist(); drawTemplates(); },
          }, icon('x')))),
      h('div', { class: 'tpl-target' },
        num('sets', 'sets', 1, 20), h('span', { class: 'muted' }, 'sets ×'),
        num('repsMin', 'minimum reps', 1, 100), h('span', { class: 'muted' }, '–'),
        num('repsMax', 'maximum reps', 1, 100), h('span', { class: 'muted' }, 'reps'),
        h('span', { class: 'sr-only' }, `Currently ${formatTarget(it)}`)),
      h('div', { class: 'tpl-target' },
        h('span', { class: 'muted' }, 'Rest'),
        h('input', {
          class: 'num-input tpl-num wide', type: 'text', inputmode: 'numeric', autocomplete: 'off',
          'aria-label': `${it.name}: rest seconds (blank = default)`, placeholder: String(store.state.settings.defaultRestSeconds),
          value: it.restSeconds ?? '', dataset: { fkey: `rest-${id}` },
          onchange: (e) => {
            const v = e.target.value.trim() === '' ? null : normalizeRest(e.target.value);
            if (e.target.value.trim() !== '' && v == null) { toast('Rest must be 10–900 seconds'); e.target.value = it.restSeconds ?? ''; return; }
            it.restSeconds = v;
            persistSoon();
          },
        }),
        h('span', { class: 'muted' }, 's · Step'),
        h('input', {
          class: 'num-input tpl-num wide', type: 'text', inputmode: 'decimal', autocomplete: 'off',
          'aria-label': `${it.name}: weight step in ${wUnit()} (blank = default)`, value: it.weightStep == null ? '' : fmtW(it.weightStep),
          placeholder: fmtW(store.state.settings.weightStep), dataset: { fkey: `step-${id}` },
          onchange: (e) => {
            // Blank = follow the default step (Settings, set by your experience in Profile).
            const v = e.target.value.trim() === '' ? null : normalizeStep(parseShownW(e.target.value));
            if (e.target.value.trim() !== '' && v == null) { toast(`Step must be ${fmtW(0.25)}–${fmtW(50)} ${wUnit()}`); e.target.value = it.weightStep == null ? '' : fmtW(it.weightStep); return; }
            it.weightStep = v;
            persistSoon();
          },
        }),
        h('span', { class: 'muted' }, wUnit())),
      h('div', { class: 'tpl-target' },
        h('label', { class: 'muted', for: `muscle-${id}` }, 'Muscle'),
        h('select', {
          id: `muscle-${id}`, class: 'tpl-muscle', value: store.primaryGroup(it.name) ?? '', dataset: { fkey: `muscle-${id}` },
          onchange: async (e) => { await store.setPrimaryMuscle(it.name, e.target.value || null); },
        }, h('option', { value: '' }, 'Untagged'), GROUPS.map((m) => h('option', { value: m }, m)))));
  }

  // Redraw after the browser has moved focus, so the newly focused field keeps focus.
  const drawTemplatesSoon = () => setTimeout(async () => { await persist(); drawTemplates(); }, 0);

  async function rename(i, input) {
    const name = cleanName(input.value);
    if (name === exName(items[i].name)) return; // the short name it already shows: no change
    const clash = items.some((it, j) => j !== i && exerciseKey(it.name) === exerciseKey(name));
    if (!name || clash) {
      toast(clash ? `${name} is already in this template` : 'Name can’t be empty');
      input.value = items[i].name;
      return;
    }
    items[i].name = name;
    if (!store.allExerciseNames().some((n) => n.key === exerciseKey(name))) await store.addCustomExercise(name);
    drawTemplatesSoon();
  }

  async function move(i, dir) {
    [items[i], items[i + dir]] = [items[i + dir], items[i]];
    await persist();
    drawTemplates();
  }

  async function addToTemplate() {
    const list = store.allSessions();
    const name = await openExercisePicker({
      names: store.allExerciseNames(),
      usage: exerciseUsage(list, today),
      present: new Set(items.map((it) => exerciseKey(it.name))),
      type: selectedType,
      lastFor: (key) => lastSetsFor(list, key, addDays(today, 1), today),
    });
    if (!name) return;
    const key = exerciseKey(name);
    const known = store.allExerciseNames().find((n) => n.key === key);
    const display = known?.name ?? cleanName(name);
    if (!known) await store.addCustomExercise(display);
    items.push({ name: display, ...DEFAULT_TARGET, weightStep: null, restSeconds: null });
    await persist();
    drawTemplates();
  }

  const resetTemplates = h('button', {
    class: 'btn small subtle',
    onclick: async () => {
      const ok = await confirmDialog({
        title: 'Reset all templates?',
        message: 'Every template goes back to the starter exercises. Logged workouts stay as they are.',
        confirmLabel: 'Reset',
      });
      if (!ok) return;
      await store.resetTemplates();
      drawTemplates();
      toast('Templates reset');
    },
  }, 'Reset templates to defaults');

  // ---------- session types ----------
  const typesCard = h('section', { class: 'card types-card', id: 'types', 'aria-labelledby': 'types-h' });
  function drawTypes() {
    const active = allTypes().filter((t) => !t.archived);
    const archived = allTypes().filter((t) => t.archived);
    const row = (t) => h('li', { class: `type-row t-${typeColor(t.id)}${t.hidden ? ' is-hidden' : ''}`, dataset: { type: t.id } },
      plate(t.archived ? 'missed' : 'done', typeColor(t.id)),
      h('span', { class: 'type-text' },
        h('strong', {}, t.name),
        h('small', {}, [t.short !== t.name ? `Shows as “${t.short}”` : null, t.color ? COLOR_NAMES[t.color] : 'Neutral', t.hidden && !t.archived ? 'Hidden' : null,
          t.archived ? 'Archived: past days keep it' : null, t.kind === 'lift' ? `${templateFor(t.id, store.state.templates).length} exercises` : null].filter(Boolean).join(' · '))),
      t.archived ? null : h('button', { class: 'icon-btn', 'aria-label': `Edit ${t.name}`, onclick: () => editType(t.id) }, icon('notes')),
      t.archived ? null : h('button', { class: 'icon-btn', 'aria-label': `Delete ${t.name}`, onclick: () => removeType(t.id) }, icon('trash')));
    typesCard.replaceChildren(
      h('div', { class: 'section-head' }, h('h2', { id: 'types-h' }, 'Session types'),
        h('button', { class: 'btn small accent', onclick: () => editType(null) }, icon('plus'), 'Add')),
      h('p', { class: 'muted' }, 'Name, colour and template for each kind of day. Renaming or recolouring never changes logged workouts. Up to 8 types get their own colour; more get a neutral grey and show their label.'),
      h('ul', { class: 'type-list' }, active.map(row)),
      ...(archived.length ? [h('details', { class: 'archived' }, h('summary', {}, `Archived (${archived.length})`), h('ul', { class: 'type-list' }, archived.map(row)))] : [])); // replaceChildren would print a null
  }

  /** Add (id = null) or edit a type: name, short label, colour, hidden. */
  async function editType(id) {
    const t = id ? typeById(id) : null;
    let color = t ? t.color : nextColor(store.state.types);
    let hidden = t?.hidden ?? false;
    const err = h('p', { class: 'ob-error', role: 'alert', hidden: true, id: 'type-err' });
    const usedBy = (k) => store.state.types.find((x) => x.color === k && x.id !== id && !x.hidden && !x.archived)?.name;
    const result = await sheet({
      title: t ? `Edit ${t.name}` : 'New session type',
      build: (close) => {
        const name = h('input', { id: 'type-name', class: 'ob-input', type: 'text', maxlength: '40', value: t?.name ?? '', placeholder: 'e.g. Chest + Triceps', autocomplete: 'off' });
        // Only a label you set yourself is filled in; an automatic one follows the name.
        const short = h('input', { id: 'type-short', class: 'ob-input', type: 'text', maxlength: '6', value: t && t.short !== autoShort(t.name) ? t.short : '', placeholder: t ? autoShort(t.name) : 'auto', autocomplete: 'off' });
        name.addEventListener('input', () => { short.placeholder = autoShort(name.value) || 'auto'; });
        const swatch = (k) => h('label', { class: `swatch-opt t-${k ?? 'neutral'}` },
          h('input', { type: 'radio', name: 'type-color', value: k ?? '', checked: color === k, onchange: () => { color = k; } }),
          h('span', { class: 'swatch', 'aria-hidden': 'true' }),
          h('span', { class: 'swatch-text' }, h('span', { class: 'swatch-name' }, k ? COLOR_NAMES[k] : 'Neutral'),
            k && usedBy(k) ? h('small', {}, usedBy(k)) : null));
        return h('form', {
          class: 'type-form', novalidate: true,
          onsubmit: (e) => {
            e.preventDefault();
            if (!name.value.trim()) { err.textContent = 'Give the session type a name.'; err.hidden = false; name.setAttribute('aria-invalid', 'true'); name.setAttribute('aria-describedby', 'type-err'); name.focus(); return; }
            close({ name: name.value, short: short.value, color, hidden });
          },
        },
        h('div', { class: 'ob-field' }, h('label', { for: 'type-name', class: 'ob-label' }, 'Name'), name),
        h('div', { class: 'ob-field' }, h('label', { for: 'type-short', class: 'ob-label' }, 'Short label', h('small', {}, ' up to 6 letters, for calendar cells')), short),
        h('fieldset', { class: 'ob-q' }, h('legend', {}, 'Colour'),
          h('div', { class: 'swatches' }, [...PALETTE_KEYS, null].map(swatch)),
          h('p', { class: 'fine' }, 'The name or short label always shows next to the colour.')),
        t ? h('div', { class: 'field-row' }, h('label', { for: 'type-hidden' }, 'Hide from pickers', h('small', {}, 'Kept with its history; not offered in the plan or on the Day screen')),
          h('input', { id: 'type-hidden', type: 'checkbox', class: 'switch', checked: hidden, onchange: (e) => { hidden = e.target.checked; } })) : null,
        err,
        h('button', { class: 'btn primary block', type: 'submit' }, t ? 'Save' : 'Add type'));
      },
    });
    if (!result) return;
    try {
      if (t) {
        await store.editSessionType(id, result);
        toast(`${result.name.trim() || t.name} saved`);
      } else {
        const type = await store.addSessionType({ name: result.name, short: result.short, color: result.color });
        selectedType = type.id;
        toast(`${type.name} added. Add exercises to its template below.`);
      }
    } catch (e) { toast(e.message); return; }
    drawAll();
  }

  async function removeType(id) {
    const t = typeById(id);
    const history = store.typeHasHistory(id);
    const ok = await confirmDialog({
      title: history ? `Archive ${t.name}?` : `Delete ${t.name}?`,
      message: history
        ? `${t.name} has logged days, so it's archived instead of deleted: it leaves your pickers and your plan from today, and past days keep its name and colour.`
        : `${t.name} and its template are removed, and it leaves your plan from today. Nothing has been logged with it.`,
      confirmLabel: history ? 'Archive' : 'Delete',
      danger: !history,
    });
    if (!ok) return;
    const { archived } = await store.removeSessionType(id);
    if (selectedType === id) selectedType = liftTypes()[0]?.id ?? null;
    drawAll();
    toast(archived ? `${t.name} archived` : `${t.name} deleted`);
  }

  function drawAll() { drawSchedule(); drawTypes(); drawTemplates(); drawMySplits(); }

  drawAll();
  root.append(h('div', { class: 'view plan-view' },
    h('header', { class: 'topbar' }, h('h1', { tabindex: '-1' }, 'Planner')),
    h('div', { class: 'stack' }, scheduleCard, typesCard, tplCard, h('div', { class: 'row-btns center' }, resetTemplates))));

  // Leaving the tab: make sure a pending edit is written.
  return async () => { if (saveTimer) { clearTimeout(saveTimer); await persist(); } };
}
