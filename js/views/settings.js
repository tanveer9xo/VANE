// Settings tab: stats summary, backup (JSON + CSV), preferences, app.
import { h, icon, toast, dialog, confirmDialog, brandMark } from '../ui.js';
import { APP_NAME } from '../brand.js';
import * as store from '../store.js';
import { APP_VERSION, SCHEMA_VERSION, parseMinutes, normalizeRest, isTrainingType } from '../model.js';
import { weekStats, fmtInt, fmtNum } from '../stats.js';
import { todayISO, toISODate, relativeDay } from '../dates.js';
import {
  install, isStandalone, promptInstall, installHelp, storageInfo, requestPersistence, checkForUpdate,
} from '../pwa.js';
import { isCompleted, weekProgress } from '../plan.js';
import { sessionsToCSV, csvToBackup } from '../csv.js';
import { GROUPS } from '../muscles.js';
import { wakeLockSupported } from '../wakelock.js';
import { applyAppearance, savedAppearance } from '../theme.js';
import { STEP_CHOICES, shownVolume, wUnit } from '../units.js';
import { GOALS } from '../profile.js';
import { nutritionSummary } from './nutrition.js';

export function renderSettings(root, section) {
  const view = h('div', { class: 'view settings-view' });
  root.append(view);
  // Re-run the route so the router's cleanup/teardown stays consistent.
  const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
  const offInstall = (() => { install.listeners.add(rerender); return () => install.listeners.delete(rerender); })();

  const today = todayISO();
  const list = store.allSessions();
  const logged = list.filter((s) => s.date <= today && isCompleted(s)).length;
  const planned = list.filter((s) => s.date > today && isTrainingType(s.type)).length;
  const { thisWeek, lastWeek } = weekStats(list, today, store.state.settings.weekStartsOn, isCompleted);
  const wk = weekProgress((d) => store.getSession(d), store.state.schedule, today, store.state.settings.weekStartsOn);
  const stat = (label, value, sub) => h('div', { class: 'stat' }, h('dt', {}, label), h('dd', { class: 'num stat-v' }, value), sub ? h('dd', { class: 'stat-sub' }, sub) : null);

  // ---- stats ----
  const stats = h('section', { class: 'card', 'aria-labelledby': 'stats-h' },
    h('h2', { id: 'stats-h' }, 'Stats'),
    h('dl', { class: 'stat-row' },
      stat('Workouts', String(logged), planned ? `${planned} planned ahead` : 'all time'),
      stat('This week', `${wk.completed} of ${wk.planned}`, 'done of planned'),
      stat('Volume this week', `${fmtInt(shownVolume(thisWeek.volume))} ${wUnit()}`, `${thisWeek.sets} sets`),
      stat('Treadmill this week', `${fmtNum(thisWeek.cardioMinutes)} min`, null)),
    h('p', { class: 'fine' },
      `Last week: ${lastWeek.sessions} workout${lastWeek.sessions === 1 ? '' : 's'}, ${fmtInt(shownVolume(lastWeek.volume))} ${wUnit()}, ${fmtNum(lastWeek.cardioMinutes)} min on the treadmill. Volume is weight × reps over ticked working sets.`));

  // ---- appearance ----
  const appearance = h('section', { class: 'card', 'aria-labelledby': 'look-h' },
    h('h2', { id: 'look-h' }, 'Appearance'),
    h('div', { class: 'seg seg-wide', role: 'group', 'aria-label': 'Appearance' },
      [['system', 'System', 'appearance'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']].map(([id, label, ic]) => h('button', {
        class: 'seg-btn', 'aria-pressed': String(savedAppearance() === id), dataset: { appearance: id },
        onclick: async (e) => {
          applyAppearance(id);
          e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.appearance === id)));
          await store.saveSettings({ appearance: id });
        },
      }, icon(ic), label))),
    h('p', { class: 'fine' }, 'System follows your phone’s light or dark mode. Saved on this phone.'));

  // ---- backup ----
  const lastExport = store.state.lastExportAt
    ? relativeDay(toISODate(new Date(store.state.lastExportAt)), today).toLowerCase()
    : 'never';
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json,text/csv,.csv', class: 'sr-only', id: 'import-file', onchange: onImportFile });
  const canShareFiles = typeof navigator.canShare === 'function'
    && navigator.canShare({ files: [new File(['{}'], 'x.json', { type: 'application/json' })] });

  const backup = h('section', { class: 'card', id: 'backup', 'aria-labelledby': 'backup-h' },
    h('h2', { id: 'backup-h' }, 'Backup'),
    h('p', { class: 'fine' }, 'Your data lives only on this phone. Export a backup now and then, for example to Files, Drive or email.'),
    h('p', { class: 'fine' }, `Last backup: ${lastExport}.`),
    h('div', { class: 'stack' },
      h('button', { class: 'btn primary block', onclick: download }, icon('download'), 'Export backup (JSON)'),
      canShareFiles ? h('button', { class: 'btn block', onclick: share }, icon('share'), 'Share backup') : null,
      h('button', { class: 'btn block', onclick: downloadCSV }, icon('table'), 'Export sets as CSV'),
      h('label', { class: 'btn block', for: 'import-file' }, icon('upload'), 'Import a backup'),
      fileInput),
    h('p', { class: 'fine' }, 'The JSON backup restores everything. The CSV has one row per set, plus your custom exercises and muscle tags; it can be imported too (sessions, rest days, skip reasons and exercises).'));

  // ---- preferences ----
  const switchRow = (id, label, sub, checked, onchange, disabled = false) => h('div', { class: 'field-row' },
    h('label', { for: id }, label, sub ? h('small', {}, sub) : null),
    h('input', { id, type: 'checkbox', class: 'switch', checked, disabled, onchange }));
  const prefs = h('section', { class: 'card', 'aria-labelledby': 'prefs-h' },
    h('h2', { id: 'prefs-h' }, 'Preferences'),
    h('div', { class: 'field-row' },
      h('label', { for: 'def-cardio' }, 'Default treadmill minutes'),
      h('input', {
        id: 'def-cardio', class: 'num-input', type: 'text', inputmode: 'numeric', autocomplete: 'off',
        value: store.state.settings.defaultCardioMinutes ?? '', placeholder: '0',
        onchange: async (e) => {
          const v = parseMinutes(e.target.value);
          await store.saveSettings({ defaultCardioMinutes: v ?? 0 });
          e.target.value = v ?? 0;
        },
      })),
    h('div', { class: 'field-row' },
      h('label', { for: 'week-start' }, 'Week starts on'),
      h('select', {
        id: 'week-start', value: String(store.state.settings.weekStartsOn),
        onchange: async (e) => { await store.saveSettings({ weekStartsOn: Number(e.target.value) }); rerender(); },
      }, h('option', { value: '1' }, 'Monday'), h('option', { value: '0' }, 'Sunday'))),
    h('div', { class: 'field-row' },
      h('label', { for: 'def-rest' }, 'Default rest', h('small', {}, 'seconds, when an exercise has none')),
      h('input', {
        id: 'def-rest', class: 'num-input', type: 'text', inputmode: 'numeric', autocomplete: 'off',
        value: store.state.settings.defaultRestSeconds,
        onchange: async (e) => {
          const v = normalizeRest(e.target.value);
          if (v == null) { toast('Rest must be 10 to 900 seconds.'); e.target.value = store.state.settings.defaultRestSeconds; return; }
          await store.saveSettings({ defaultRestSeconds: v });
        },
      })),
    h('div', { class: 'field-row' },
      h('label', { for: 'weight-step' }, 'Weight step', h('small', {}, 'for the − and + buttons')),
      h('select', {
        id: 'weight-step', value: String(store.state.settings.weightStep),
        onchange: async (e) => { await store.saveSettings({ weightStep: Number(e.target.value) }); },
      }, (() => {
        // The choices for your units; a step from the other unit (or an older custom one) stays selectable.
        const list = [...STEP_CHOICES[store.state.profile.units]];
        if (!list.some((c) => Math.abs(c.kg - store.state.settings.weightStep) < 1e-3)) list.push({ kg: store.state.settings.weightStep, label: `${store.state.settings.weightStep} kg` });
        return list.map((c) => h('option', { value: String(c.kg) }, c.label));
      })())),
    h('div', { class: 'field-row' },
      h('label', { for: 'weekly-min' }, 'Minimum sessions per week', h('small', {}, 'blank = your planned sessions')),
      h('input', {
        id: 'weekly-min', class: 'num-input', type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: 'plan',
        value: store.state.settings.weeklyMin ?? '',
        onchange: async (e) => {
          const raw = e.target.value.trim();
          const n = /^\d{1,2}$/.test(raw) ? Number(raw) : null;
          if (raw && (n == null || n < 1 || n > 14)) { toast('Enter 1 to 14, or leave blank.'); e.target.value = store.state.settings.weeklyMin ?? ''; return; }
          await store.saveSettings({ weeklyMin: n });
          e.target.value = n ?? '';
        },
      })),
    switchRow('keep-awake-pref', 'Keep screen awake',
      wakeLockSupported() ? 'While today’s workout is open' : 'Not supported in this browser',
      !!store.state.settings.keepAwake,
      async (e) => { await store.saveSettings({ keepAwake: e.target.checked }); },
      !wakeLockSupported()),
    h('p', { class: 'fine' }, `Units are ${wUnit()} (change them in Profile). Enter 0 for bodyweight sets. Timer sound, vibration and auto-start are on the Timer tab.`));

  // ---- app & storage ----
  const storageLine = h('p', { class: 'muted' }, 'Checking storage');
  const persistBtn = h('button', {
    class: 'btn block', hidden: true,
    onclick: async () => {
      const ok = await requestPersistence();
      toast(ok ? 'Storage is now persistent' : 'The browser said no. Installing the app usually helps.');
      refreshStorage();
    },
  }, 'Ask for persistent storage');
  async function refreshStorage() {
    const info = await storageInfo();
    const used = info.estimate ? `${Math.max(1, Math.round(info.estimate.usage / 1024))} KB used. ` : '';
    storageLine.textContent = !info.supported
      ? `${used}This browser doesn’t offer persistent storage, so keep backups.`
      : info.persisted
        ? `${used}Persistent: the browser won’t clear your data when space runs low.`
        : `${used}Not persistent yet: the browser could clear data if the phone runs low on space.`;
    persistBtn.hidden = !info.supported || info.persisted;
  }
  refreshStorage();

  const updateBtn = h('button', {
    class: 'btn block',
    onclick: async () => {
      updateBtn.disabled = true;
      const r = await checkForUpdate();
      updateBtn.disabled = false;
      toast(r === 'ready' ? 'An update is ready: tap the banner at the top.' : r === 'found' ? 'Downloading the update. A banner appears at the top when it’s ready.' : r === 'none' ? `You have the latest version (${APP_VERSION}).` : 'Updates need the installed app or a secure connection.');
    },
  }, 'Check for updates');

  const app = h('section', { class: 'card', id: 'about', 'aria-labelledby': 'app-h' },
    h('h2', { id: 'app-h' }, 'About'),
    h('div', { class: 'about-brand' }, brandMark(56),
      h('div', {}, h('p', { class: 'wordmark' }, APP_NAME), h('p', { class: 'about-version' }, 'Version ', h('span', { class: 'num' }, APP_VERSION)))),
    h('dl', { class: 'kv' },
      h('div', {}, h('dt', {}, 'Data format'), h('dd', { class: 'num' }, `v${SCHEMA_VERSION}`)),
      h('div', {}, h('dt', {}, 'Works offline'), h('dd', {}, 'Yes'))),
    updateBtn,
    isStandalone()
      ? h('p', { class: 'muted' }, icon('check'), ' Installed and running as an app.')
      : install.prompt
        ? h('button', { class: 'btn primary block', onclick: promptInstall }, icon('phone'), 'Install app')
        : installHelp(),
    storageLine,
    persistBtn,
    h('p', { class: 'fine credit' }, 'Exercise library: ',
      h('a', { href: 'https://github.com/yuhonas/free-exercise-db', target: '_blank', rel: 'noopener' }, 'free-exercise-db'),
      ' by yuhonas, public domain (Unlicense). Icons: Tabler Icons (MIT). Font: Plus Jakarta Sans (SIL OFL).'));

  // ---- weekly sets per muscle (body map targets) ----
  const groupInput = (id, value, placeholder, label, onSave) => h('input', {
    id, class: 'num-input', type: 'text', inputmode: 'numeric', autocomplete: 'off', value: value ?? '', placeholder, 'aria-label': label,
    onchange: async (e) => {
      const raw = e.target.value.trim();
      const n = /^\d{1,2}$/.test(raw) ? Number(raw) : null;
      if (raw && (n == null || n < 1 || n > 40)) { toast('Enter 1 to 40 sets, or leave blank.'); e.target.value = value ?? ''; return; }
      await onSave(n);
    },
  });
  const targets = store.state.settings.muscleTargets ?? {};
  const fallback = store.state.settings.muscleTarget ?? 10;
  const targetsCard = h('section', { class: 'card', id: 'targets', 'aria-labelledby': 'targets-h' },
    h('h2', { id: 'targets-h' }, 'Weekly sets per muscle'),
    h('p', { class: 'fine' }, 'The body map compares each muscle group with its weekly target. Under half of it shows as undertrained.'),
    h('div', { class: 'field-row' },
      h('label', { for: 'target-all' }, 'Default target', h('small', {}, 'sets per week, every muscle')),
      groupInput('target-all', fallback, '10', 'Default weekly sets per muscle', async (n) => { await store.saveSettings({ muscleTarget: n ?? 10 }); rerender(); })),
    h('div', { class: 'targets-grid' }, GROUPS.map((g) => h('label', { for: `target-${g}` }, g,
      groupInput(`target-${g}`, targets[g], String(fallback), `${g}: weekly target sets`, async (n) => {
        const next = { ...(store.state.settings.muscleTargets ?? {}) };
        if (n == null) delete next[g]; else next[g] = n;
        await store.saveSettings({ muscleTargets: next });
      })))),
    h('p', { class: 'fine' }, 'Leave a muscle blank to use the default.'));

  const danger = h('section', { class: 'card', 'aria-labelledby': 'danger-h' },
    h('h2', { id: 'danger-h' }, 'Erase'),
    h('button', { class: 'btn danger-ghost block', onclick: eraseAll }, icon('trash'), 'Erase all data'));

  // ---- profile ----
  const pf = store.state.profile;
  // Name and goal; with nothing answered yet, an invitation instead.
  const answered = !!(pf.name || pf.goal || pf.experience || pf.split || pf.sessionsPerWeek);
  const title = pf.name || (answered ? 'Your profile' : 'Set up your profile');
  const summary = pf.goal ? `Goal: ${GOALS[pf.goal]}` : answered ? 'No goal set' : 'Units, goal, experience and your split';
  const profileCard = h('section', { class: 'card', id: 'profile', 'aria-labelledby': 'profile-h' },
    h('h2', { id: 'profile-h' }, 'Profile'),
    h('a', { class: 'row-link', href: '#/settings/profile' },
      h('span', { class: 'row-ic' }, icon('user')),
      h('span', { class: 'row-text' }, h('strong', {}, title), h('small', {}, summary)),
      icon('chevR')),
    h('p', { class: 'fine' }, 'Stays on this phone.'));

  // ---- nutrition (optional, off by default) ----
  const nutritionRow = h('section', { class: 'card', id: 'nutrition', 'aria-labelledby': 'nutrition-h' },
    h('h2', { id: 'nutrition-h' }, 'Nutrition'),
    h('a', { class: 'row-link', href: '#/settings/nutrition' },
      h('span', { class: 'row-ic' }, icon('flame')),
      h('span', { class: 'row-text' }, h('strong', {}, 'Calorie and protein estimates'), h('small', { id: 'nutrition-summary' }, nutritionSummary())),
      icon('chevR')));

  view.append(
    h('header', { class: 'topbar' }, h('h1', { tabindex: '-1' }, 'Settings')),
    h('div', { class: 'stack' }, profileCard, nutritionRow, appearance, stats, backup, prefs, targetsCard, app, danger));
  if (section === 'backup') requestAnimationFrame(() => backup.scrollIntoView({ block: 'start' }));
  if (section === 'targets') requestAnimationFrame(() => targetsCard.scrollIntoView({ block: 'start' }));

  // ---- actions ----
  function save(file) {
    const url = URL.createObjectURL(file);
    const a = h('a', { href: url, download: file.name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function backupFile() {
    const json = JSON.stringify(store.exportPayload(), null, 2);
    return new File([json], `workout-backup-${today}.json`, { type: 'application/json' });
  }

  async function download() {
    const file = backupFile();
    save(file);
    await store.markExported();
    toast(`Exported ${file.name}`);
    rerender();
  }

  function downloadCSV() {
    const sessions = store.allSessions().filter((s) => !store.isEmpty(s));
    const file = new File([sessionsToCSV(sessions, store.state.skipReasons, [...store.state.catalog.values()], store.bodyEntries())], `workout-sets-${today}.csv`, { type: 'text/csv' });
    save(file);
    toast(`Exported ${file.name}`);
  }

  async function share() {
    try {
      await navigator.share({ files: [backupFile()], title: 'Workout backup' });
      await store.markExported();
      rerender();
    } catch (err) {
      if (err.name !== 'AbortError') toast('Sharing didn’t work. Use Export instead.');
    }
  }

  async function onImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    let parsed;
    try {
      const text = await file.text();
      const isCSV = /\.csv$/i.test(file.name) || /^\uFEFF?date,/i.test(text);
      parsed = store.migrateBackup(isCSV ? csvToBackup(text) : JSON.parse(text));
    } catch (err) {
      toast(err instanceof SyntaxError ? 'That file isn’t valid JSON. Pick a backup .json or an exported .csv.' : err.message);
      return;
    }
    const n = parsed.sessions.length;
    const choice = await dialog({
      title: `Import ${n} workout${n === 1 ? '' : 's'}?`,
      message: `${parsed.skipped ? `${parsed.skipped} invalid entr${parsed.skipped === 1 ? 'y' : 'ies'} will be skipped. ` : ''}`
        + 'Merge keeps your data and replaces only the days in the file. Replace all wipes this phone first.',
      buttons: [
        { label: 'Cancel', value: 'cancel' },
        { label: 'Replace all', value: 'replace', kind: 'danger' },
        { label: 'Merge', value: 'merge', kind: 'primary' },
      ],
    });
    if (choice === 'cancel') return;
    try {
      await store.importData(parsed, choice);
      toast(`Imported ${n} workout${n === 1 ? '' : 's'}`);
      rerender();
    } catch (err) {
      console.error(err);
      toast('Import failed. Nothing was changed.');
    }
  }

  async function eraseAll() {
    const ok = await confirmDialog({
      title: 'Erase all data?',
      message: 'Every workout on this phone will be deleted. Export a backup first if you might want it back.',
      confirmLabel: 'Erase all data',
      danger: true,
    });
    if (!ok) return;
    await store.eraseAll();
    toast('All data erased');
    rerender();
  }

  return () => offInstall();
}
