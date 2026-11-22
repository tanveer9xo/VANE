// Progressive-overload hints. Pure and deliberately simple — tune the rules here.
//
// Input: the *working* sets from the last logged session of an exercise (warm-ups are already
// excluded by the caller), the exercise's rep range and weight step.
//
// Rules, checked in this order:
//   1. INCREASE — every working set reached the top of the rep range
//                 → "Try +2.5 kg": heaviest weight + step, at the bottom of the range.
//   2. REPEAT   — 2 or more working sets fell short of the bottom of the range
//                 → "Repeat 35 kg" (or drop one step if MOST sets missed — see DROP_IF_MISSED_SHARE).
//   3. ADD REP  — anything else → "Aim for +1 rep" at the same weight (capped at the top of the range).
//
// A hint is only a suggestion: the UI shows it with an "Apply" button and never changes numbers on its own.

/** Rule 2 needs at least this many sets below the range. */
export const MISSED_SETS_FOR_REPEAT = 2;

/** If at least this share of working sets missed the range, suggest a small drop instead of a repeat. */
export const DROP_IF_MISSED_SHARE = 0.75;

const kgFmt = (n) => String(Number(n.toFixed(2)));

/**
 * @param {{weight:number, reps:number}[]} lastWorking  last session's done working sets
 * @param {{repsMin:number|null, repsMax:number|null}|null} range
 * @param {number} step  weight step in kg
 * @param {{ fmt?: (kg:number)=>string, unit?: string, goalNote?: (kind:string)=>string|null }} [opts]
 *   fmt/unit show weights in the profile's units (stored values stay kg); goalNote adds the goal's sentence.
 * @returns {null | { kind: 'increase'|'repeat'|'drop'|'rep', text: string, reason: string, weight: number, reps: number[] }}
 *   `weight` and `reps` (one per planned working set, by position) are what "Apply" fills in.
 */
export function suggest(lastWorking, range, step, opts = {}) {
  const hint = rule(lastWorking, range, step, opts.fmt ?? kgFmt, opts.unit ?? 'kg');
  const note = hint && opts.goalNote?.(hint.kind);
  return hint && note ? { ...hint, reason: `${hint.reason} ${note}` } : hint;
}

function rule(lastWorking, range, step, fmt, unit) {
  const sets = (lastWorking ?? []).filter((s) => s.weight > 0 && s.reps > 0);
  if (!sets.length || !range || range.repsMin == null) return null;
  const { repsMin, repsMax } = range;
  const top = Math.max(...sets.map((s) => s.weight));
  const lastTime = `Last time: ${sets.map((s) => s.reps).join(', ')} reps.`;

  // 1. Every working set hit the top of the range → add weight, reset reps to the bottom.
  if (sets.every((s) => s.reps >= repsMax)) {
    const weight = top + step;
    return {
      kind: 'increase',
      text: `Try +${fmt(step)} ${unit}: ${fmt(weight)} × ${repsMin}`,
      reason: lastTime,
      weight,
      reps: sets.map(() => repsMin),
    };
  }

  // 2. Missed the bottom of the range on 2+ sets → hold (or drop if most sets missed).
  const missed = sets.filter((s) => s.reps < repsMin).length;
  if (missed >= MISSED_SETS_FOR_REPEAT) {
    if (missed / sets.length >= DROP_IF_MISSED_SHARE && top - step > 0) {
      const weight = top - step;
      return {
        kind: 'drop', text: `Drop to ${fmt(weight)} ${unit} × ${repsMin}`, reason: lastTime,
        weight, reps: sets.map(() => repsMin),
      };
    }
    return {
      kind: 'repeat', text: `Repeat ${fmt(top)} ${unit} and aim for ${repsMin}+ reps`, reason: lastTime,
      weight: top, reps: sets.map(() => repsMin),
    };
  }

  // 3. Otherwise → one more rep per set at the same weight.
  const reps = sets.map((s) => Math.min(repsMax, s.reps + 1));
  return { kind: 'rep', text: `Aim for +1 rep at ${fmt(top)} ${unit}`, reason: lastTime, weight: top, reps };
}
