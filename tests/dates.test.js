import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toISODate, parseISODate, isValidISODate, addDays, addMonths, monthGrid, startOfWeek, parseMonthKey, daysBetween,
} from '../js/dates.js';

test('toISODate uses local calendar date, not UTC', () => {
  // 23:30 local on Jan 31 must stay Jan 31 regardless of the machine's TZ offset.
  assert.equal(toISODate(new Date(2026, 0, 31, 23, 30)), '2026-01-31');
  assert.equal(toISODate(new Date(2026, 0, 1, 0, 5)), '2026-01-01');
});

test('parseISODate validates and round-trips', () => {
  assert.equal(toISODate(parseISODate('2026-11-19')), '2026-11-19');
  assert.equal(parseISODate('2026-02-30'), null);
  assert.equal(parseISODate('2026-13-01'), null);
  assert.equal(parseISODate('26-1-1'), null);
  assert.equal(parseISODate(undefined), null);
  assert.ok(isValidISODate('2024-02-29'));
  assert.ok(!isValidISODate('2025-02-29'));
});

test('addDays crosses months, years and DST changes', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  // DST transitions (Europe late March / late Oct; NZ/Brazil in other months) — walk a full year.
  let d = '2026-01-01';
  for (let i = 0; i < 365; i++) d = addDays(d, 1);
  assert.equal(d, '2027-01-01');
  assert.equal(daysBetween('2026-01-01', '2027-01-01'), 365);
});

test('addMonths wraps years both ways', () => {
  assert.deepEqual(addMonths({ year: 2026, month: 12 }, 1), { year: 2027, month: 1 });
  assert.deepEqual(addMonths({ year: 2026, month: 1 }, -1), { year: 2025, month: 12 });
  assert.deepEqual(addMonths({ year: 2026, month: 5 }, -17), { year: 2024, month: 12 });
});

test('parseMonthKey', () => {
  assert.deepEqual(parseMonthKey('2026-11'), { year: 2026, month: 11 });
  assert.equal(parseMonthKey('2026-13'), null);
  assert.equal(parseMonthKey(undefined), null);
});

test('startOfWeek honours Monday/Sunday start', () => {
  // 2026-11-19 is a Thursday
  assert.equal(startOfWeek('2026-11-19', 1), '2026-11-16');
  assert.equal(startOfWeek('2026-11-19', 0), '2026-11-15');
  assert.equal(startOfWeek('2026-11-16', 1), '2026-11-16');
  assert.equal(startOfWeek('2026-11-15', 1), '2026-11-09');
});

test('monthGrid is 6×7, starts on week start, flags in-month days', () => {
  const g = monthGrid({ year: 2026, month: 11 }, 1);
  assert.equal(g.length, 42);
  assert.equal(g[0].iso, '2026-10-26'); // Monday before Nov 1 (a Sunday)
  assert.equal(g.filter((d) => d.inMonth).length, 30);
  assert.equal(g.find((d) => d.inMonth).iso, '2026-11-01');
  const sun = monthGrid({ year: 2026, month: 11 }, 0);
  assert.equal(sun[0].iso, '2026-11-01');
});
