// VANE branding: one source (js/brand.js) for the name, the icon and the splash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_NAME, BRAND, markSVG, splashHTML } from '../js/brand.js';
import { THEMES } from '../js/theme.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(join(root, f), 'utf8');

test('the app is called VANE everywhere a person sees the name', () => {
  assert.equal(APP_NAME, 'VANE');
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.name, 'VANE');
  assert.equal(m.short_name, 'VANE');
  const html = read('index.html');
  assert.match(html, /<title>VANE<\/title>/);
  assert.match(html, /name="apple-mobile-web-app-title" content="VANE"/);
});

test('manifest and theme-color metas use the page colours for light and dark', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.background_color, THEMES.light.page);
  assert.equal(m.theme_color, THEMES.light.page);
  assert.deepEqual(m.color_scheme_dark, { background_color: THEMES.dark.page, theme_color: THEMES.dark.page });
  const html = read('index.html');
  assert.match(html, new RegExp(`name="theme-color" content="${THEMES.light.page}"[^>]*data-scheme="light"`));
  assert.match(html, new RegExp(`name="theme-color" content="${THEMES.dark.page}"[^>]*data-scheme="dark"`));
  for (const ic of m.icons) assert.ok(read('sw.js').includes(`'./${ic.src}'`), `${ic.src} is precached`);
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
});

test('icon colours are the indigo accent on the dark page colour', () => {
  assert.equal(BRAND.ground, THEMES.dark.page);
  assert.equal(BRAND.ring, THEMES.light.accent);
  assert.equal(BRAND.vane, THEMES.dark.accent);
});

test('icons/icon.svg and the index.html splash match js/brand.js (run npm run icons after changing the mark)', () => {
  assert.equal(read('icons/icon.svg').trim(), markSVG({ ground: 'rounded' }));
  assert.ok(read('index.html').includes(`<!-- splash -->${splashHTML()}<!-- /splash -->`));
});

test('PNG icons have the sizes the manifest and index.html promise', () => {
  const dims = (f) => { const b = readFileSync(join(root, f)); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
  assert.deepEqual(dims('icons/icon-192.png'), [192, 192]);
  assert.deepEqual(dims('icons/icon-512.png'), [512, 512]);
  assert.deepEqual(dims('icons/icon-maskable-512.png'), [512, 512]);
  assert.deepEqual(dims('icons/apple-touch-icon.png'), [180, 180]);
});

test('maskable mark stays inside the 80 % safe circle', () => {
  // Farthest drawn point: an arm's top end (132, 150) plus half the 60-unit round stroke.
  const far = Math.hypot(256 - 132, 256 - 150) + 30;
  assert.ok(far * 0.8 <= 0.4 * 512, `maskable mark reaches ${(far * 0.8).toFixed(1)} of a 204.8 radius`);
  assert.ok(far <= 256, 'the full-size mark fits the square');
});
