// Import safety: checks a backup file before it is parsed, and shared limits for what a backup may hold.
// Pure. A VANE backup is small (a year of daily workouts is well under 2 MB), so these limits only ever
// stop broken or hostile files, with a clear message.

export const MAX_IMPORT_BYTES = 20 * 1024 * 1024; // 20 MB
export const MAX_DEPTH = 32; // a real backup nests about 6 deep
export const LIMITS = { sessions: 20000, body: 20000, exercises: 5000, types: 100, exercisesPerSession: 60, setsPerExercise: 50 };

/** Object keys that must never be copied from a file into an object (prototype tricks). */
export const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
export const safeKey = (k) => typeof k === 'string' && k !== '' && !RESERVED_KEYS.has(k);

const mb = (n) => `${Math.round((n / 1024 / 1024) * 10) / 10} MB`;

/** Throws a clear error if a file is too big to be a backup. */
export function checkFileSize(bytes) {
  if (bytes > MAX_IMPORT_BYTES) {
    throw new Error(`This file is too big to be a VANE backup (${mb(bytes)}; the limit is ${mb(MAX_IMPORT_BYTES)}). Nothing was imported.`);
  }
}

/**
 * Throws if JSON text nests deeper than MAX_DEPTH (a real backup never does; very deep nesting can exhaust the
 * parser). One linear pass that skips over strings, so it's cheap even for a large file.
 */
export function checkJSONDepth(text, max = MAX_DEPTH) {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 92) i++; // backslash: skip the escaped character
      else if (c === 34) inString = false;
    } else if (c === 34) inString = true;
    else if (c === 123 || c === 91) { if (++depth > max) throw new Error('This file is nested too deeply to be a VANE backup. Nothing was imported.'); }
    else if (c === 125 || c === 93) depth--;
  }
}

/** Size + depth checks, then JSON.parse with a plain message for broken JSON. */
export function parseBackupText(text) {
  checkFileSize(new Blob([text]).size);
  checkJSONDepth(text);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('That file isn’t valid JSON. Pick a backup .json or an exported .csv. Nothing was imported.');
  }
}
