// Colours and appearance. The one source of truth: CSS reads these as custom properties, and the
// unit tests check every contrast pair below.
//
// Session colours: 8 palette slots in a fixed order (js/types.js assigns them to session types), validated with
// the dataviz skill's validate_palette.js on the cards they sit on (light #FFFFFF, dark #1B2040): lightness,
// chroma, contrast ≥ 3:1 and normal-vision separation all pass in both themes. CVD: Pink↔Cyan is 7.8 (deutan),
// in the warn band that is allowed only with a second cue, and a type always shows its name or short label.
// On the light page (#F4F5FA) Gold and Cyan are 2.9–3.0:1, so session marks only sit on white cards.
// block = a darker shade for coloured blocks with white text (≥ 4.5:1). tint = the done-row tint, light and dark.
// Dark tints keep each hue (OKLCH, L≈0.33) instead of mixing with the navy card; every pair is ≥ 5 apart.
// neutral = types beyond the 8 colours (and Other); break = rest days.

export const SESSION_COLORS = {
  red: { base: '#E0584E', block: '#BE4B42', tintL: '#FBE8E6', tintD: '#5A201C' },
  blue: { base: '#4C8BE8', block: '#3E72BE', tintL: '#E6EFFC', tintD: '#1A355C' },
  gold: { base: '#B08A10', block: '#8D6E0D', tintL: '#F4EFDE', tintD: '#332705' },
  green: { base: '#2FA073', block: '#1E7A57', tintL: '#E2F2EB', tintD: '#103F2C' },
  violet: { base: '#9B7AE0', block: '#7E63B5', tintL: '#F1ECFB', tintD: '#3A2C57' },
  orange: { base: '#CC7430', block: '#A75F27', tintL: '#F8ECE2', tintD: '#652F00' },
  cyan: { base: '#1F9DB8', block: '#187C91', tintL: '#E0F1F5', tintD: '#093C47' },
  pink: { base: '#D04A86', block: '#B03A6E', tintL: '#FAE6EF', tintD: '#58133A' },
  neutral: { base: '#6B7090', block: '#6B7090', tintL: '#EAEBEF', tintD: '#2E3353' },
  break: { base: '#8A8FA8', block: '#6D7185', tintL: '#EFEFF3', tintD: '#363B59' },
};
/** The 8 assignable colours, in order (same as PALETTE_KEYS in types.js). */
export const PALETTE = ['red', 'blue', 'gold', 'green', 'violet', 'orange', 'cyan', 'pink'].map((k) => SESSION_COLORS[k].base);
// Class names before v7 (a rest timer saved by 1.8 may still carry one).
const LEGACY = { push: 'red', pull: 'blue', legs: 'gold', upper: 'green', lower: 'violet', full: 'orange', cardio: 'cyan', other: 'neutral' };

export const THEMES = {
  light: {
    page: '#F4F5FA', card: '#FFFFFF', well: '#F0F1F7', text: '#1E2140', sec: '#5F6485',
    accent: '#5B5BD6', accentBlock: '#5B5BD6', accentTint: '#ECECFB', line: '#E4E6F0',
  },
  dark: {
    page: '#0F1226', card: '#1B2040', well: '#232A55', text: '#F2F3FA', sec: '#A3A9D0',
    accent: '#8C8CF0', accentBlock: '#5B5BD6', accentTint: '#2A2F63', line: '#2A3060',
  },
};

/** The CSS for every colour class, in both themes: .t-red { --c, --c-block, --c-tint } */
export function sessionCSS() {
  const entries = [...Object.entries(SESSION_COLORS), ...Object.entries(LEGACY).map(([old, key]) => [old, SESSION_COLORS[key]])];
  const rules = entries.map(([key, c]) => (
    `.t-${key}{--c:${c.base};--c-block:${c.block};--c-tint:${c.tintL}}`
    + `:root[data-theme="dark"] .t-${key}{--c-tint:${c.tintD}}`));
  return rules.join('\n');
}

// ---------------------------------------------------------------------------
// Appearance: 'system' | 'light' | 'dark'. Saved on the device (localStorage, so index.html can apply it
// before first paint) and in settings (so it travels with a backup).
// ---------------------------------------------------------------------------
export const APPEARANCES = ['system', 'light', 'dark'];
const KEY = 'appearance';
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

export const resolveTheme = (pref, systemDark) => (pref === 'light' || pref === 'dark' ? pref : systemDark ? 'dark' : 'light');

export function savedAppearance() {
  try { const v = localStorage.getItem(KEY); return APPEARANCES.includes(v) ? v : 'system'; } catch { return 'system'; }
}

/** Apply a preference now: data-theme on <html>, the status-bar colour, and remember it on this device. */
export function applyAppearance(pref) {
  const p = APPEARANCES.includes(pref) ? pref : 'system';
  try { localStorage.setItem(KEY, p); } catch { /* private mode: still applies for this session */ }
  const theme = resolveTheme(p, media?.matches);
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.appearance = p;
  root.style.colorScheme = theme;
  // One theme-color tag that follows the active theme (the per-scheme tags only cover "system").
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    if (p === 'system') {
      m.setAttribute('content', m.dataset.scheme === 'dark' ? THEMES.dark.page : THEMES.light.page);
      if (m.dataset.scheme) m.setAttribute('media', `(prefers-color-scheme: ${m.dataset.scheme})`);
    } else {
      m.setAttribute('content', THEMES[theme].page);
      m.removeAttribute('media');
    }
  });
  return theme;
}

/** Follow the system setting while the preference is "system". */
export function watchSystemTheme() {
  media?.addEventListener?.('change', () => { if (savedAppearance() === 'system') applyAppearance('system'); });
}
