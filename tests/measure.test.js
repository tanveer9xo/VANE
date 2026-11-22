// Body measurements (schema v8): subsets, unit conversion, per-site figures, migration, CSV.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SITES, GROUPS, DEFAULT_TRACKED, normalizeTracked, trackedSites, cleanMeasurements, siteStats, siteSeries, waistToHeight, BODY_FAT,
} from '../js/measure.js';
import { normalizeBodyEntry, migrateBackup, SCHEMA_VERSION, pickSettings, DEFAULT_SETTINGS } from '../js/model.js';
import { setUnits, parseShownL, fmtL, fmtLU, toShownL } from '../js/units.js';
import { sessionsToCSV, csvToBackup } from '../js/csv.js';

test('the sites, and which are tracked by default', () => {
  assert.deepEqual(SITES.map((s) => s.key), ['neck', 'shoulders', 'chest', 'armL', 'armR', 'forearm', 'waist', 'hips', 'thighL', 'thighR', 'calf']);
  assert.deepEqual(DEFAULT_TRACKED, ['chest', 'waist', 'hips', 'upperArm', 'thigh']);
  assert.deepEqual(trackedSites(DEFAULT_TRACKED).map((s) => s.key), ['chest', 'armL', 'armR', 'waist', 'hips', 'thighL', 'thighR']);
  assert.ok(GROUPS.find((g) => g.id === 'bodyFat').label.includes('your own estimate'));
  assert.deepEqual(DEFAULT_SETTINGS.measureSites, DEFAULT_TRACKED);
  assert.deepEqual(normalizeTracked(['calf', 'bogus', 'neck']), ['neck', 'calf'], 'unknown ids dropped, body order kept');
  assert.deepEqual(normalizeTracked(null), DEFAULT_TRACKED);
  assert.deepEqual(pickSettings({ measureSites: ['bodyFat', 'x'] }).measureSites, ['bodyFat']);
  assert.deepEqual(pickSettings({ measureSites: [] }).measureSites, [], 'tracking nothing is allowed');
});

test('subset entries: any one value is enough; nothing is required', () => {
  assert.deepEqual(normalizeBodyEntry({ date: '2026-11-20', chest: 101.5, updatedAt: 1 }), { date: '2026-11-20', weight: null, waist: null, chest: 101.5, updatedAt: 1 });
  assert.deepEqual(normalizeBodyEntry({ date: '2026-11-20', bodyFat: '18,5', updatedAt: 1 }), { date: '2026-11-20', weight: null, waist: null, bodyFat: 18.5, updatedAt: 1 });
  assert.equal(normalizeBodyEntry({ date: '2026-11-20', weight: 80.2, updatedAt: 1 }).weight, 80.2);
  assert.equal(normalizeBodyEntry({ date: '2026-11-20' }), null, 'an empty entry is dropped');
  assert.equal(normalizeBodyEntry({ date: '2026-11-20', chest: 5, weight: 3 }), null, 'only out-of-range values: dropped');
  const mixed = normalizeBodyEntry({ date: '2026-11-20', weight: 3, armL: 38, calf: 'abc', updatedAt: 1 });
  assert.deepEqual(mixed, { date: '2026-11-20', weight: null, waist: null, armL: 38, updatedAt: 1 }, 'bad values are dropped, good ones kept');
  assert.deepEqual(cleanMeasurements({ thighL: 60.123, bodyFat: 18.27, neck: 200 }), { thighL: 60.12, bodyFat: 18.3 });
});

test('unit conversion: shown in inches, stored in cm, exact round trip', () => {
  try {
    setUnits('lb');
    const cm = parseShownL('32');
    assert.equal(cm, 81.28);
    assert.equal(fmtL(cm), '32');
    assert.equal(fmtLU(101.6), '40 in');
    assert.equal(fmtL(parseShownL('15.25'), 2), '15.25');
    assert.equal(Math.round(toShownL(2.54) * 100) / 100, 1);
  } finally { setUnits('kg'); }
  assert.equal(parseShownL('81.3'), 81.3);
  assert.equal(fmtLU(81.3), '81.3 cm');
});

test('per-site figures: latest, since first, since last; only entries that have the site', () => {
  const entries = [
    { date: '2026-10-01', weight: 82, chest: 100 },
    { date: '2026-10-15', weight: 81.5 },
    { date: '2026-11-01', chest: 101.2 },
    { date: '2026-11-15', chest: 102, waist: 85 },
  ];
  const st = siteStats(entries, 'chest');
  assert.equal(st.latest.date, '2026-11-15');
  assert.equal(st.count, 3);
  assert.equal(st.sinceFirst, 2);
  assert.equal(st.sinceLast, 0.8);
  assert.equal(siteStats(entries, 'waist').sinceFirst, null, 'one entry: no change yet');
  assert.equal(siteStats(entries, 'calf'), null);
  assert.deepEqual(siteSeries(entries, 'chest').map((p) => p.value), [100, 101.2, 102]);
});

test('waist-to-height: a plain ratio, only with both', () => {
  assert.equal(waistToHeight(85, 180), 0.47);
  assert.equal(waistToHeight(85, null), null);
  assert.equal(waistToHeight(null, 180), null);
});

test('v7 → v8: every Body log entry survives as it was', () => {
  assert.ok(SCHEMA_VERSION >= 8);
  const out = migrateBackup({
    schemaVersion: 7, sessions: [],
    body: [{ date: '2026-11-01', weight: 82.4, waist: 86, updatedAt: 5 }, { date: '2026-11-02', weight: 82.1, waist: null, updatedAt: 6 }],
  });
  assert.deepEqual(out.body, [{ date: '2026-11-01', weight: 82.4, waist: 86, updatedAt: 5 }, { date: '2026-11-02', weight: 82.1, waist: null, updatedAt: 6 }]);
  const v8 = migrateBackup({ schemaVersion: 8, sessions: [], body: [{ date: '2026-11-03', chest: 101, bodyFat: 17, updatedAt: 7 }] });
  assert.deepEqual(v8.body[0], { date: '2026-11-03', weight: null, waist: null, chest: 101, bodyFat: 17, updatedAt: 7 });
});

test('CSV: bodyweight and measurement rows round-trip; old CSVs still import', () => {
  const body = [{ date: '2026-11-03', weight: 81.2, waist: 85, armL: 38.5, bodyFat: 17.5 }, { date: '2026-11-04', weight: null, chest: 101 }];
  const csv = sessionsToCSV([], {}, [], body);
  assert.match(csv, /2026-11-03,,,,81\.2,,,,bodyweight/);
  assert.match(csv, /2026-11-03,(,){7}measurement,(,){5}armL,38\.5/);
  const back = migrateBackup(csvToBackup(csv));
  assert.deepEqual(back.body.map(({ updatedAt, ...e }) => e), [
    { date: '2026-11-03', weight: 81.2, waist: 85, armL: 38.5, bodyFat: 17.5 },
    { date: '2026-11-04', weight: null, waist: null, chest: 101 },
  ]);
  assert.equal(back.sessions.length, 0, 'body-only dates create no workouts');
  const old = csvToBackup('date,session type,exercise,set number,weight,reps\r\n2026-11-11,Push,Bench,1,80,10\r\n');
  assert.deepEqual(old.body, []);
});

test('in lb mode, waist ratio is unit-free', () => {
  try { setUnits('lb'); assert.equal(waistToHeight(parseShownL('33.5'), parseShownL('70')), 0.48); } finally { setUnits('kg'); }
  assert.equal(BODY_FAT.max, 70);
});
