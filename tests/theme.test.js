// Colour contrast in both themes, checked from the single source of truth (js/theme.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SESSION_COLORS, THEMES, sessionCSS, resolveTheme, APPEARANCES } from '../js/theme.js';
import { pickSettings, DEFAULT_SETTINGS } from '../js/model.js';

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('body text and secondary text reach 4.5:1 on every surface, in both themes', () => {
  for (const [name, t] of Object.entries(THEMES)) {
    for (const surface of ['page', 'card', 'well']) {
      assert.ok(contrast(t.text, t[surface]) >= 4.5, `${name} text on ${surface}`);
      assert.ok(contrast(t.sec, t[surface]) >= 4.5, `${name} secondary on ${surface}: ${contrast(t.sec, t[surface]).toFixed(2)}`);
      assert.ok(contrast(t.accent, t[surface]) >= 4.5, `${name} accent text on ${surface}: ${contrast(t.accent, t[surface]).toFixed(2)}`);
    }
    assert.ok(contrast('#FFFFFF', t.accentBlock) >= 4.5, `${name} white on the accent block`);
  }
});

test('white text on every session block reaches 4.5:1 (Green uses #1E7A57)', () => {
  assert.equal(SESSION_COLORS.green.block, '#1E7A57');
  for (const [slug, c] of Object.entries(SESSION_COLORS)) {
    assert.ok(contrast('#FFFFFF', c.block) >= 4.5, `${slug} block ${c.block}: ${contrast('#FFFFFF', c.block).toFixed(2)}`);
  }
});

test('text on the done tints reaches 4.5:1 in both themes', () => {
  for (const [slug, c] of Object.entries(SESSION_COLORS)) {
    for (const [tint, t] of [[c.tintL, THEMES.light], [c.tintD, THEMES.dark]]) {
      assert.ok(contrast(t.text, tint) >= 4.5, `${slug} text on ${tint}`);
      assert.ok(contrast(t.sec, tint) >= 4.5, `${slug} secondary on ${tint}: ${contrast(t.sec, tint).toFixed(2)}`);
    }
  }
});

test('session marks reach 3:1 on the cards they sit on (icons and plates)', () => {
  for (const [slug, c] of Object.entries(SESSION_COLORS)) {
    if (slug === 'neutral' || slug === 'break') continue; // neutral greys, always with a name
    assert.ok(contrast(c.base, THEMES.light.card) >= 3, `${slug} on the light card`);
    assert.ok(contrast(c.base, THEMES.dark.card) >= 3, `${slug} on the dark card`);
    assert.ok(contrast(c.block, THEMES.light.card) >= 3, `${slug} block shade as an icon on the light card`);
  }
});

test('session CSS covers every type in both themes', () => {
  const css = sessionCSS();
  for (const slug of Object.keys(SESSION_COLORS)) {
    assert.ok(css.includes(`.t-${slug}{--c:`), slug);
    assert.ok(css.includes(`:root[data-theme="dark"] .t-${slug}{--c-tint:`), `${slug} dark`);
  }
});

test('appearance: system follows the phone, light and dark are fixed; it is a validated setting', () => {
  assert.deepEqual(APPEARANCES, ['system', 'light', 'dark']);
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
  assert.equal(resolveTheme('bogus', true), 'dark');
  assert.equal(DEFAULT_SETTINGS.appearance, 'system');
  assert.deepEqual(pickSettings({ appearance: 'dark' }), { appearance: 'dark' });
  assert.deepEqual(pickSettings({ appearance: 'neon' }), {});
});

// OKLab ΔE (×100) for the dark done-tints: they must look different from each other.
const lin = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
function oklab(hex) {
  const [r, g, b] = lin(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
const dE = (a, b) => { const [x, y] = [oklab(a), oklab(b)]; return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) * 100; };

test('dark done-tints are clearly different: Gold vs Orange ≥ 10, every other pair of the 8 ≥ 5', () => {
  const slugs = ['red', 'blue', 'gold', 'green', 'violet', 'orange', 'cyan', 'pink'];
  assert.ok(dE(SESSION_COLORS.gold.tintD, SESSION_COLORS.orange.tintD) >= 10, `gold–orange ${dE(SESSION_COLORS.gold.tintD, SESSION_COLORS.orange.tintD).toFixed(1)}`);
  for (let i = 0; i < slugs.length; i++) {
    for (let j = i + 1; j < slugs.length; j++) {
      const d = dE(SESSION_COLORS[slugs[i]].tintD, SESSION_COLORS[slugs[j]].tintD);
      assert.ok(d >= 5, `${slugs[i]}–${slugs[j]} ${d.toFixed(1)}`);
    }
  }
});
