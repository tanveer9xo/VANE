// Display units. Everything is stored in kg and cm (backups, CSV and history never change); the profile's
// unit only changes how numbers are shown and typed. A pound value is stored at 4 dp so it reads back exactly.
import { parseWeight } from './model.js';

export const KG_PER_LB = 0.45359237;
export const CM_PER_IN = 2.54;
const round = (n, dp) => Math.round(n * 10 ** dp) / 10 ** dp;
const fmt = (n, dp) => (n == null || !Number.isFinite(n) ? '' : String(Number(n.toFixed(dp))));

let current = 'kg';
/** 'kg' | 'lb' — set from the profile at start-up and whenever it changes. */
export const setUnits = (u) => { current = u === 'lb' ? 'lb' : 'kg'; };
export const units = () => current;
/** Weight unit label ('kg' | 'lb') and length unit label ('cm' | 'in'). */
export const wUnit = () => current;
export const lUnit = () => (current === 'lb' ? 'in' : 'cm');

/** kg → the number shown, and back. */
export const toShownW = (kg, u = current) => (kg == null ? null : u === 'lb' ? kg / KG_PER_LB : kg);
export const fromShownW = (v, u = current) => (v == null ? null : u === 'lb' ? round(v * KG_PER_LB, 4) : round(v, 4));
export const toShownL = (cm, u = current) => (cm == null ? null : u === 'lb' ? cm / CM_PER_IN : cm);
export const fromShownL = (v, u = current) => (v == null ? null : u === 'lb' ? round(v * CM_PER_IN, 2) : round(v, 2));

/** "135" (no unit), "135 lb" (with unit). dp = max decimals shown. */
export const fmtW = (kg, dp = 2) => fmt(toShownW(kg), dp);
export const fmtWU = (kg, dp = 2) => `${fmtW(kg, dp)} ${current}`;
export const fmtL = (cm, dp = 1) => fmt(toShownL(cm), dp);
export const fmtLU = (cm, dp = 1) => `${fmtL(cm, dp)} ${lUnit()}`;
/** Volume (kg × reps) in the shown unit, rounded to a whole number. */
export const shownVolume = (kgReps) => Math.round(toShownW(kgReps));

/** Typed weight in the shown unit → kg (4 dp), or null. "0" stays 0 (bodyweight). */
export const parseShownW = (input, u = current) => { const n = parseWeight(input); return n == null ? null : fromShownW(n, u); };
export const parseShownL = (input, u = current) => { const n = parseWeight(input); return n == null ? null : fromShownL(n, u); };

/** −/+ step choices per unit, as kg values (what's stored) with their labels. */
export const STEP_CHOICES = {
  kg: [1, 2.5, 5].map((n) => ({ kg: n, label: `${n} kg` })),
  lb: [2.5, 5, 10].map((n) => ({ kg: round(n * KG_PER_LB, 4), label: `${n} lb` })),
};
export const ALL_STEP_KG = [...STEP_CHOICES.kg, ...STEP_CHOICES.lb].map((c) => c.kg);

/** The matching step in the other unit (2.5 kg ↔ 5 lb, 1 kg ↔ 2.5 lb, 5 kg ↔ 10 lb); unknown → middle. */
export function stepForUnits(stepKg, u) {
  const from = STEP_CHOICES[u === 'lb' ? 'kg' : 'lb'];
  const to = STEP_CHOICES[u === 'lb' ? 'lb' : 'kg'];
  const own = to.findIndex((c) => Math.abs(c.kg - stepKg) < 1e-3);
  if (own >= 0) return to[own].kg;
  const i = from.findIndex((c) => Math.abs(c.kg - stepKg) < 1e-3);
  return to[i >= 0 ? i : 1].kg;
}

// Cardio distance and speed: km and km/h, or miles and mph with lb. Stored in km and km/h.
export const KM_PER_MI = 1.609344;
export const dUnit = () => (current === 'lb' ? 'mi' : 'km');
export const spUnit = () => (current === 'lb' ? 'mph' : 'km/h');
export const toShownD = (km) => (km == null ? null : current === 'lb' ? km / KM_PER_MI : km);
export const fromShownD = (v) => (v == null ? null : current === 'lb' ? round(v * KM_PER_MI, 3) : round(v, 3));
export const fmtD = (km, dp = 2) => fmt(toShownD(km), dp);
export const fmtSp = (kmh, dp = 1) => fmt(toShownD(kmh), dp);
