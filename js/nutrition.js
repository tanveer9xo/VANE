// Nutrition targets (schema v9): optional, off by default, adults only. Pure functions; everything is an
// estimate shown as a range. Stored on this phone only.
//
//   nutrition: { enabled, sex: 'male'|'female'|'unspecified'|null, birthYear, weightKg, activity, lossPct,
//                hideNumbers, updatedAt }        (height lives in the profile: heightCm)
//   intake:    { 'YYYY-MM-DD': { kcal, protein } }   manual daily totals, no food database
//
// How it's counted:
//   BMR (Mifflin-St Jeor) = 10 × kg + 6.25 × cm − 5 × age + s, s = +5 male, −161 female, −78 "prefer not to
//   say" (the midpoint; its range spans both). Maintenance = BMR × activity factor.
//   Goal: Lose fat −10 to −25 % (default −20 %), Build muscle +5 to +10 %, Recomp 0 to −5 %, Get stronger and
//   Stay consistent (or no goal) maintenance. A loss is capped at about 1 % of bodyweight a week
//   (7,700 kcal per kg), and no target goes below a floor (1,500 kcal male, 1,200 female, 1,350 otherwise).
//   Protein 1.6–2.2 g per kg bodyweight (default 1.8); Lose fat and Recomp 2.0–2.2 (default 2.0).

export const SEXES = { male: 'Male', female: 'Female', unspecified: 'Prefer not to say' };
export const ACTIVITY = {
  sedentary: { label: 'Sedentary', note: 'Mostly sitting; little walking', factor: 1.2 },
  light: { label: 'Light', note: 'On your feet some of the day, or 1–3 sessions a week', factor: 1.375 },
  moderate: { label: 'Moderate', note: 'Active job or 3–5 sessions a week', factor: 1.55 },
  very: { label: 'Very active', note: 'Physical job or hard training most days', factor: 1.725 },
};
const SEX_OFFSET = { male: 5, female: -161, unspecified: -78 };
const FLOOR = { male: 1500, female: 1200, unspecified: 1350 };
export const LOSS_CHOICES = [10, 15, 20, 25];
export const ADULT_AGE = 18;
const KCAL_PER_KG = 7700;

export const DEFAULT_NUTRITION = {
  enabled: false, sex: null, birthYear: null, weightKg: null, activity: null, lossPct: 20, hideNumbers: false, updatedAt: 0,
};

const intIn = (v, lo, hi) => { const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };

export function normalizeNutrition(raw, thisYear = new Date().getFullYear()) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const w = Number(r.weightKg);
  const n = {
    enabled: r.enabled === true,
    sex: Object.prototype.hasOwnProperty.call(SEXES, r.sex) ? r.sex : null,
    birthYear: intIn(r.birthYear, 1900, thisYear),
    weightKg: Number.isFinite(w) && w >= 20 && w <= 400 ? Math.round(w * 10000) / 10000 : null,
    activity: Object.prototype.hasOwnProperty.call(ACTIVITY, r.activity) ? r.activity : null,
    lossPct: LOSS_CHOICES.includes(Number(r.lossPct)) ? Number(r.lossPct) : 20,
    hideNumbers: r.hideNumbers === true,
    updatedAt: Number.isFinite(r.updatedAt) ? r.updatedAt : 0,
  };
  if (isMinor(n.birthYear, thisYear)) n.enabled = false; // never on for under-18s
  return n;
}

/** { 'YYYY-MM-DD': { kcal, protein } } with sane numbers only. */
export function normalizeIntake(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [date, v] of Object.entries(raw)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const kcal = intIn(v?.kcal, 0, 20000);
    const protein = intIn(v?.protein, 0, 1000);
    if (kcal != null || protein != null) out[date] = { kcal, protein };
  }
  return out;
}

/**
 * The youngest age a birth year allows (with no birthday, someone born in 2008 may still be 17 in late 2026),
 * so the adult check can't let an under-18 through. null without a birth year.
 */
export const youngestAge = (birthYear, thisYear) => (birthYear ? thisYear - birthYear - 1 : null);
/** Under 18 (on the youngest reading). No birth year → not known to be a minor, but targets need one anyway. */
export const isMinor = (birthYear, thisYear) => birthYear != null && youngestAge(birthYear, thisYear) < ADULT_AGE;
/** Age used in the formula: this year minus the birth year (at most a year out; ±5 kcal). */
export const formulaAge = (birthYear, thisYear) => thisYear - birthYear;

/** Mifflin-St Jeor BMR in kcal/day. */
export function bmr({ sex, kg, cm, age }) {
  return 10 * kg + 6.25 * cm - 5 * age + SEX_OFFSET[sex ?? 'unspecified'];
}

/** The goal's change to maintenance, as fractions: { lo, hi, target } (negative = a deficit). */
export function goalAdjustment(goal, lossPct = 20) {
  switch (goal) {
    case 'fat': return { lo: -0.25, hi: -0.10, target: -lossPct / 100 };
    case 'muscle': return { lo: 0.05, hi: 0.10, target: 0.075 };
    case 'recomp': return { lo: -0.05, hi: 0, target: -0.025 };
    default: return { lo: 0, hi: 0, target: 0 }; // Get stronger, Stay consistent, or no goal: maintenance
  }
}

/** Protein in g/kg: { lo, hi, target }. */
export function proteinPerKg(goal) {
  return goal === 'fat' || goal === 'recomp' ? { lo: 2.0, hi: 2.2, target: 2.0 } : { lo: 1.6, hi: 2.2, target: 1.8 };
}

const r10 = (n) => Math.round(n / 10) * 10;
const r5 = (n) => Math.round(n / 5) * 5;

/** What's missing before an estimate can be shown (labels, in setup order). */
export function missingFor(n, heightCm) {
  return [
    !n.birthYear && 'birth year', !heightCm && 'height', !n.weightKg && 'current weight', !n.activity && 'activity level',
  ].filter(Boolean);
}

/**
 * The estimate, or null when something's missing or for under-18s.
 * → { bmr: { lo, hi }, maintenance: { lo, hi }, calories: { target, lo, hi }, protein: { target, lo, hi },
 *     capped, floored }
 */
export function targets(n, { goal, heightCm, thisYear = new Date().getFullYear() }) {
  if (missingFor(n, heightCm).length || isMinor(n.birthYear, thisYear)) return null;
  const age = formulaAge(n.birthYear, thisYear);
  const kg = n.weightKg;
  // "Prefer not to say": the midpoint, with a range spanning the male and female formulas.
  const sexes = n.sex === 'male' || n.sex === 'female' ? [n.sex] : ['female', 'male'];
  const mid = bmr({ sex: n.sex ?? 'unspecified', kg, cm: heightCm, age });
  const bmrs = sexes.map((sex) => bmr({ sex, kg, cm: heightCm, age }));
  const factor = ACTIVITY[n.activity].factor;
  const adj = goalAdjustment(goal, n.lossPct);
  const maxDeficit = (0.01 * kg * KCAL_PER_KG) / 7; // about 1 % of bodyweight a week
  const floor = FLOOR[n.sex ?? 'unspecified'];
  let capped = false;
  let floored = false;
  const apply = (maint, f) => {
    let kcal = maint * (1 + f);
    if (maint - kcal > maxDeficit) { kcal = maint - maxDeficit; if (f === adj.target) capped = true; }
    if (kcal < floor) { kcal = floor; if (f === adj.target) floored = true; }
    return kcal;
  };
  const target = apply(mid * factor, adj.target);
  const ends = bmrs.flatMap((b) => [apply(b * factor, adj.lo), apply(b * factor, adj.hi)]);
  const p = proteinPerKg(goal);
  return {
    bmr: { lo: r10(Math.min(...bmrs)), hi: r10(Math.max(...bmrs)) },
    maintenance: { lo: r10(Math.min(...bmrs) * factor), hi: r10(Math.max(...bmrs) * factor) },
    calories: { target: r10(target), lo: r10(Math.min(...ends, target)), hi: r10(Math.max(...ends, target)) },
    protein: { target: r5(p.target * kg), lo: r5(p.lo * kg), hi: r5(p.hi * kg) },
    capped, floored,
  };
}

/** Bodyweight in the Body log has moved more than 2 kg from the weight the targets use. */
export function weightDrift(n, latestKg) {
  if (!n.weightKg || latestKg == null) return null;
  const d = latestKg - n.weightKg;
  return Math.abs(d) > 2 ? Math.round(d * 10) / 10 : null;
}
