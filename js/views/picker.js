// Exercise picker: the bundled library (876 exercises) plus your own exercises and history.
// Search on top so the phone keyboard never hides results; muscle and equipment filter chips;
// favourites and recents first; only the first rows are drawn ("Show more" adds more) so it stays fast.
import { h, icon, toast } from '../ui.js';
import * as store from '../store.js';
import { exName } from '../library.js';
import { ACTIVITIES } from '../cardio.js';
import { cleanName, exerciseKey } from '../model.js';
import { formatSets } from '../stats.js';
import { formatShort } from '../dates.js';
import { GROUPS, EQUIPMENT, equipmentLabel, groupsFromDataset } from '../muscles.js';

const PAGE = 40;

/** Everything pickable, one row per name: { key, name, primary, secondary, equipment, entry, record }. */
function buildItems() {
  const items = new Map();
  for (const e of store.state.library) {
    const g = groupsFromDataset(e.primaryMuscles, e.secondaryMuscles);
    items.set(exerciseKey(e.name), { key: exerciseKey(e.name), name: e.name, ...g, equipment: e.equipment, entry: e, record: null });
  }
  // A library entry you already log under your own name ("DB Chest Press" = Dumbbell Bench Press) points
  // there, so picking either adds your name and history stays on one exercise.
  const yours = new Map([...store.state.catalog.values()].filter((r) => r.libId).map((r) => [r.libId, r]));
  for (const it of items.values()) {
    const own = yours.get(it.entry?.id);
    if (own && own.key !== it.key) it.alias = own.name;
  }
  for (const r of store.state.catalog.values()) {
    const prev = items.get(r.key);
    items.set(r.key, { ...(prev ?? {}), key: r.key, name: r.name, primary: r.primary, secondary: r.secondary, equipment: r.equipment, entry: prev?.entry ?? null, record: r });
  }
  for (const n of store.allExerciseNames()) {
    if (!items.has(n.key)) items.set(n.key, { key: n.key, name: n.name, primary: [], secondary: [], equipment: null, entry: null, record: null });
  }
  return [...items.values()];
}

/**
 * Options: usage Map(key → { count, lastDate }) for recents; present Set of keys already in the session;
 * lastFor(key) → { date, sets } | null; allowNew → offer "Create custom exercise"; title.
 * Resolves to the chosen exercise name (added to your catalog), or null if cancelled.
 */
export function openExercisePicker({ usage = new Map(), present = new Set(), lastFor = () => null, allowNew = true, title = 'Add exercise', cardio = false } = {}) {
  return new Promise((resolve) => {
    let result = null;
    let muscle = null;
    let equipment = null;
    let limit = PAGE;
    let active = -1;
    let shown = [];
    const all = buildItems();
    // The Cardio group (Day screen only): one entry each, no sets, never added to the exercise catalog.
    const cardioItems = cardio ? ACTIVITIES.map((a) => ({ key: `cardio:${a.key}`, name: a.name, primary: [], equipment: null, cardio: true })) : [];

    const input = h('input', {
      type: 'search', id: 'picker-q', class: 'picker-input', placeholder: `Search ${all.length} exercises`,
      autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false', enterkeyhint: 'search',
      role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'picker-list', 'aria-autocomplete': 'list',
    });
    const closeBtn = h('button', { class: 'btn small subtle', type: 'button' }, 'Cancel');
    const chips = (label, values, labelOf, get, set) => h('div', { class: 'filter-row', role: 'group', 'aria-label': label },
      values.map((v) => h('button', {
        type: 'button', class: 'fchip', 'aria-pressed': 'false', dataset: { value: v },
        onclick: (e) => { set(get() === v ? null : v); limit = PAGE; syncChips(); compute(); e.currentTarget.scrollIntoView({ inline: 'nearest', block: 'nearest' }); },
      }, labelOf(v))));
    const muscleChips = chips('Filter by muscle', GROUPS, (g) => g, () => muscle, (v) => { muscle = v; });
    const equipChips = chips('Filter by equipment', EQUIPMENT, equipmentLabel, () => equipment, (v) => { equipment = v; });
    function syncChips() {
      muscleChips.querySelectorAll('.fchip').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === muscle)));
      equipChips.querySelectorAll('.fchip').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === equipment)));
    }
    const list = h('div', { id: 'picker-list', class: 'picker-list', role: 'listbox', 'aria-label': 'Exercises' });
    const createBtn = allowNew ? h('button', { type: 'button', class: 'add-row picker-create', onclick: () => openCreate(cleanName(input.value)) }, icon('plus'), 'Create custom exercise') : null;
    const body = h('div', { class: 'picker-body' }, createBtn, list);
    const dlg = h('dialog', { class: 'picker', 'aria-label': title },
      h('div', { class: 'picker-head' },
        h('label', { class: 'picker-search' }, icon('search'), h('span', { class: 'sr-only' }, 'Exercise name'), input),
        closeBtn),
      h('div', { class: 'picker-filters' }, muscleChips, equipChips),
      body);

    const lastDate = (it) => usage.get(it.key)?.lastDate ?? '';
    const matches = (it) => (!muscle || it.primary.includes(muscle)) && (!equipment || it.equipment === equipment);

    function compute() {
      const q = cleanName(input.value).toLowerCase();
      const sections = [];
      if (!q && !muscle && !equipment) {
        const favs = all.filter((it) => it.record?.favourite).sort((a, b) => a.name.localeCompare(b.name));
        const recent = all.filter((it) => lastDate(it)).sort((a, b) => (lastDate(a) < lastDate(b) ? 1 : -1)).slice(0, 10);
        const rest = all.filter((it) => !it.record?.favourite).sort((a, b) => a.name.localeCompare(b.name));
        if (cardioItems.length) sections.push({ title: 'Cardio', rows: cardioItems });
        if (favs.length) sections.push({ title: 'Favourites', rows: favs });
        if (recent.length) sections.push({ title: 'Recent', rows: recent });
        sections.push({ title: 'All exercises', rows: rest, limited: true });
      } else {
        const words = q.split(' ').filter(Boolean);
        const rank = (it) => {
          // The full name or the short one shown in the list ("bench press" finds "Barbell Bench Press - Medium Grip").
          const short = exName(it.name).toLowerCase();
          const n = words.every((w) => it.key.includes(w)) ? it.key : short;
          if (!words.every((w) => n.includes(w))) return -1;
          return (n === q ? 0 : n.startsWith(q) ? 1 : n.split(/[\s-]/).some((w) => w.startsWith(words[0])) ? 2 : 3) - (it.record ? 0.5 : 0);
        };
        const rows = all.filter(matches).map((it) => ({ it, r: q ? rank(it) : 0 })).filter((x) => x.r >= 0)
          .sort((a, b) => a.r - b.r || (lastDate(b.it) > lastDate(a.it) ? 1 : -1) || a.it.name.localeCompare(b.it.name)).map((x) => x.it);
        const cardioHits = !muscle && !equipment ? cardioItems.filter((it) => words.every((w) => it.name.toLowerCase().includes(w) || 'cardio'.includes(w))) : [];
        if (cardioHits.length) sections.push({ title: 'Cardio', rows: cardioHits });
        sections.push({ title: `${rows.length} result${rows.length === 1 ? '' : 's'}`, rows, limited: true });
      }
      draw(sections, q);
    }

    function draw(sections, q) {
      shown = [];
      const nodes = [];
      for (const sec of sections) {
        nodes.push(h('p', { class: 'picker-section', role: 'presentation' }, sec.title));
        const rows = sec.limited ? sec.rows.slice(0, limit) : sec.rows;
        rows.forEach((it) => { nodes.push(row(it, shown.length)); shown.push(it); });
        if (sec.limited && sec.rows.length > limit) {
          nodes.push(h('button', { type: 'button', class: 'btn subtle block picker-more', onclick: () => { limit += PAGE * 2; compute(); } },
            `Show ${Math.min(PAGE * 2, sec.rows.length - limit)} more`));
        }
        if (!sec.rows.length) nodes.push(h('p', { class: 'muted picker-empty' }, allowNew ? 'Nothing matches. Clear a filter, or create it as a custom exercise.' : 'Nothing matches. Clear a filter or try another word.'));
      }
      if (allowNew && q && !all.some((it) => it.key === q)) {
        nodes.push(h('button', { type: 'button', class: 'add-row picker-create-q', onclick: () => openCreate(cleanName(input.value)) }, icon('plus'), `Create “${cleanName(input.value)}”`));
      }
      list.replaceChildren(...nodes);
      active = shown.findIndex((it) => !present.has(it.key));
      paintActive();
    }

    function row(it, i) {
      const added = present.has(it.key) || (it.alias && present.has(it.alias.toLowerCase()));
      const last = !added ? lastFor(it.key) : null;
      const meta = it.cardio ? 'Cardio: time, plus distance or speed if you like' : [it.primary[0] ?? (it.record?.needsMuscle ? 'Muscle not set' : 'No muscle set'), it.equipment ? equipmentLabel(it.equipment) : null, it.record?.custom ? 'Custom' : null].filter(Boolean).join(', ');
      const star = h('button', {
        type: 'button', class: 'icon-btn subtle star', 'aria-pressed': String(!!it.record?.favourite),
        'aria-label': `${it.record?.favourite ? 'Remove' : 'Add'} ${exName(it.name)} ${it.record?.favourite ? 'from' : 'to'} favourites`,
        onclick: async (e) => {
          e.stopPropagation();
          if (!it.record && it.entry) await store.addLibraryExercise(it.entry);
          it.record = await store.toggleFavourite(it.name);
          compute();
        },
      }, icon('star'));
      const opt = h('div', {
        id: `opt-${i}`, role: 'option', class: 'picker-opt', 'aria-selected': 'false', 'aria-disabled': added ? 'true' : null,
        dataset: { key: it.key },
      },
      h('div', { class: 'opt-text' },
        h('span', { class: 'opt-name' }, exName(it.name)),
        exName(it.name) !== it.name ? h('span', { class: 'opt-full' }, it.name) : null,
        h('span', { class: 'opt-meta' }, added ? 'Already added' : meta),
        it.alias && !added ? h('span', { class: 'opt-last' }, `You log it as ${it.alias}`) : null,
        last ? h('span', { class: 'opt-last num' }, `Last ${formatShort(last.date)}: ${formatSets(last.sets, true)}`) : null),
      it.cardio ? null : star);
      opt.addEventListener('pointerdown', (e) => { if (!e.target.closest('.star')) e.preventDefault(); });
      opt.addEventListener('click', (e) => { if (!e.target.closest('.star') && !added) choose(it); });
      return opt;
    }

    function paintActive() {
      list.querySelectorAll('.picker-opt').forEach((el, i) => {
        el.classList.toggle('active', i === active);
        el.setAttribute('aria-selected', String(i === active));
      });
      if (active >= 0) input.setAttribute('aria-activedescendant', `opt-${active}`);
      else input.removeAttribute('aria-activedescendant');
    }

    async function choose(it) {
      if (it.cardio) { result = it.name; dlg.close(); return; }
      if (it.alias) { result = it.alias; dlg.close(); return; } // your own name for this library exercise
      if (it.entry && !it.record) await store.addLibraryExercise(it.entry);
      else await store.ensureExercise(it.name);
      result = it.name;
      dlg.close();
    }

    // ---------- create a custom exercise ----------
    function openCreate(name) {
      const select = (id, label, values, labelOf, required) => h('div', { class: 'field' },
        h('label', { for: id, class: 'label' }, label),
        h('select', { id, required: required || null },
          h('option', { value: '' }, required ? 'Choose…' : 'None'), values.map((v) => h('option', { value: v }, labelOf(v)))));
      const nameIn = h('input', { id: 'cx-name', type: 'text', value: name, required: true, maxlength: '80', autocapitalize: 'words', autocomplete: 'off' });
      const form = h('form', {
        class: 'stack picker-form',
        onsubmit: async (e) => {
          e.preventDefault();
          try {
            const rec = await store.createCustomExercise({
              name: nameIn.value, primary: form.querySelector('#cx-primary').value,
              secondary: form.querySelector('#cx-secondary').value || null, equipment: form.querySelector('#cx-equipment').value || null,
            });
            result = rec.name;
            dlg.close();
          } catch (err) { toast(err.message); }
        },
      },
      h('h2', {}, 'Create custom exercise'),
      h('div', { class: 'field' }, h('label', { for: 'cx-name', class: 'label' }, 'Name'), nameIn),
      select('cx-primary', 'Main muscle', GROUPS, (g) => g, true),
      select('cx-secondary', 'Also works (optional)', GROUPS, (g) => g, false),
      select('cx-equipment', 'Equipment (optional)', EQUIPMENT, equipmentLabel, false),
      h('div', { class: 'row-btns' },
        h('button', { type: 'submit', class: 'btn primary' }, icon('plus'), 'Create exercise'),
        h('button', { type: 'button', class: 'btn subtle', onclick: () => { body.replaceChildren(...[createBtn, list].filter(Boolean)); input.focus(); } }, 'Back to list')));
      body.replaceChildren(form);
      (name ? form.querySelector('#cx-primary') : nameIn).focus();
    }

    input.addEventListener('input', () => { limit = PAGE; compute(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        let i = active;
        do { i += dir; } while (i >= 0 && i < shown.length && present.has(shown[i].key));
        if (i >= 0 && i < shown.length) { active = i; paintActive(); list.querySelector(`#opt-${i}`)?.scrollIntoView({ block: 'nearest' }); }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const it = shown[active];
        if (it) choose(it); else if (allowNew && cleanName(input.value)) openCreate(cleanName(input.value));
      }
    });
    closeBtn.addEventListener('click', () => dlg.close());
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });

    document.body.append(dlg);
    dlg.showModal();
    input.focus();
    compute();
  });
}
