// CSV export and import. Pure functions (session types are looked up by name in the types registry).
import { allTypes, typeName, autoShort, BREAK } from './types.js';
import { SITE_KEYS, BODY_FAT } from './measure.js';
// Rows: one per set ("set"), per logged rest day ("rest day"), per skipped planned day with a reason
// ("skipped"), per exercise in your catalog ("exercise": custom exercises and muscle tags), and per Body log
// value: "bodyweight" (weight column, kg) and "measurement" (site + value columns: cm, or % for bodyFat).

export const HEADER = [
  'date', 'session type', 'exercise', 'set number', 'weight', 'reps', 'set type', 'done', 'record', 'skip reason',
  'primary muscle', 'secondary muscles', 'equipment', 'custom', 'site', 'value',
];
const MEASURE_KEYS = [...SITE_KEYS, BODY_FAT.key];

/** Quote when needed, and defuse spreadsheet formulas in free text (=, +, -, @ at the start). */
export function csvField(v) {
  let s = v == null ? '' : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * sessions → CSV text (CRLF, header first, oldest day first; exercise rows last).
 * skipReasons: { date: reason }. catalog: [{ name, primary, secondary, equipment, custom }]. body: Body log entries.
 */
export function sessionsToCSV(sessions, skipReasons = {}, catalog = [], body = []) {
  const byKey = new Map(catalog.map((r) => [r.name.toLowerCase(), r]));
  const muscles = (name) => {
    const r = byKey.get(String(name).toLowerCase());
    return [r?.primary?.[0] ?? '', (r?.secondary ?? []).join('; '), r?.equipment ?? '', r ? (r.custom ? 'yes' : 'no') : ''];
  };
  const rows = [];
  const logged = new Set();
  for (const s of sessions) {
    if (s.type === 'Break') { rows.push([s.date, 'Break', '', '', '', '', '', '', 'rest day', '', '', '', '', '']); continue; }
    logged.add(s.date);
    for (const ex of s.exercises) {
      ex.sets.forEach((set, i) => {
        rows.push([s.date, s.type ? typeName(s.type) : '', ex.name, i + 1, set.weight ?? '', set.reps ?? '', set.type ?? 'working', set.done ? 'yes' : 'no', 'set', '', ...muscles(ex.name)]);
      });
    }
  }
  for (const [date, reason] of Object.entries(skipReasons)) {
    if (!logged.has(date)) rows.push([date, '', '', '', '', '', '', '', 'skipped', reason, '', '', '', '']);
  }
  for (const e of body) {
    if (e.weight != null) rows.push([e.date, '', '', '', e.weight, '', '', '', 'bodyweight']);
    for (const k of MEASURE_KEYS) if (e[k] != null) rows.push([e.date, '', '', '', '', '', '', '', 'measurement', '', '', '', '', '', k, e[k]]);
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)); // stable: keeps set order within a day
  const exRows = [...catalog].sort((a, b) => a.name.localeCompare(b.name))
    .map((r) => ['', '', r.name, '', '', '', '', '', 'exercise', '', ...muscles(r.name)]);
  const pad = (r) => [...r, ...Array(Math.max(0, HEADER.length - r.length)).fill('')];
  return `${[HEADER, ...rows, ...exRows].map((r) => pad(r).map(csvField).join(',')).join('\r\n')}\r\n`;
}

/** RFC 4180-ish parser: quoted fields, doubled quotes, CRLF or LF. → string[][] */
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') q = false; else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x !== ''));
}

const unguard = (s) => (/^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s);

/**
 * CSV text → a backup-shaped object for migrateBackup(): { schemaVersion: 8, sessions, exercises, skipReasons, sessionTypes, body }.
 * Accepts this app's CSV from 1.4 on (older files simply lack the muscle columns). Throws if it isn't one.
 */
export function csvToBackup(text) {
  const rows = parseCSV(String(text ?? '').replace(/^﻿/, ''));
  const head = (rows.shift() ?? []).map((x) => x.trim().toLowerCase());
  const col = Object.fromEntries(head.map((name, i) => [name, i]));
  if (col.date == null || col.exercise == null || col['set number'] == null) throw new Error('This CSV isn’t a workout export. Use a file exported from this app.');
  const get = (r, name) => (col[name] == null ? '' : unguard(r[col[name]] ?? '').trim());
  const sessions = new Map();
  const exercises = new Map();
  // The CSV names a session type; map it to its id (by name, or an id), creating any type this device lacks.
  const known = allTypes();
  const created = [];
  const typeIdFor = (name) => {
    if (!name) return null;
    if (name === BREAK) return BREAK;
    const hit = known.find((t) => t.name.toLowerCase() === name.toLowerCase()) ?? known.find((t) => t.id === name)
      ?? created.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (hit) return hit.id;
    const id = `t-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'type'}-csv`;
    created.push({ id, name: name.slice(0, 40), short: autoShort(name), color: null, kind: 'lift', builtin: false, hidden: false, archived: false, order: known.length + created.length });
    return id;
  };
  const skipReasons = {};
  const body = new Map(); // date → Body log entry
  const noteExercise = (r) => {
    const name = get(r, 'exercise');
    const primary = get(r, 'primary muscle');
    if (!name || (!primary && get(r, 'custom') !== 'yes' && !exercises.has(name.toLowerCase()))) return;
    exercises.set(name.toLowerCase(), {
      name, primary: primary ? [primary] : [], secondary: get(r, 'secondary muscles').split(';').map((x) => x.trim()).filter(Boolean),
      equipment: get(r, 'equipment') || null, custom: get(r, 'custom') === 'yes',
    });
  };
  for (const r of rows) {
    const date = get(r, 'date');
    const record = get(r, 'record') || 'set';
    if (record === 'exercise') { noteExercise(r); continue; }
    if (record === 'skipped') { if (date) skipReasons[date] = get(r, 'skip reason'); continue; }
    if (record === 'bodyweight' || record === 'measurement') {
      if (!date) continue;
      const e = body.get(date) ?? { date };
      if (record === 'bodyweight') e.weight = get(r, 'weight');
      else if (MEASURE_KEYS.includes(get(r, 'site'))) e[get(r, 'site')] = get(r, 'value');
      body.set(date, e);
      continue;
    }
    if (!date) continue;
    const s = sessions.get(date) ?? { date, type: typeIdFor(get(r, 'session type')), notes: '', exercises: [] };
    sessions.set(date, s);
    if (record === 'rest day') { s.type = 'Break'; continue; }
    const name = get(r, 'exercise');
    if (!name) continue;
    let ex = s.exercises.find((e) => e.name.toLowerCase() === name.toLowerCase());
    if (!ex) { ex = { name, sets: [] }; s.exercises.push(ex); }
    ex.sets.push({
      weight: get(r, 'weight') === '' ? null : Number(get(r, 'weight')),
      reps: get(r, 'reps') === '' ? null : Number(get(r, 'reps')),
      type: get(r, 'set type') || 'working',
      done: get(r, 'done') !== 'no',
    });
    noteExercise(r);
  }
  return {
    schemaVersion: 8, sessions: [...sessions.values()], exercises: [...exercises.values()], skipReasons,
    body: [...body.values()],
    sessionTypes: [...known, ...created], // this device's types plus any the file named that it lacked
  };
}
