// VANE brand: the app name and its mark (a weather-vane arrow crossing a plate ring), in one place.
// Pure strings, no DOM, so tools/build-icons.mjs can import it in Node to render the PNG icons, and a
// test can check icons/icon.svg and the splash in index.html still match. Original artwork.
export const APP_NAME = 'VANE';

/** Brand colours: the indigo accent pair on the dark page colour. */
export const BRAND = { ground: '#0F1226', ring: '#5B5BD6', vane: '#8C8CF0', pivot: '#CECEFB' };

// A bold "V" of two strokes, drawn on a 512 grid around (256, 256): the left arm in the ring blue, the right in
// the lighter vane blue. Everything stays within r ≈ 195 of the centre, inside the maskable safe zone.
const MARK = [
  `<path d="M132 150L256 378" fill="none" stroke="${BRAND.ring}" stroke-width="60" stroke-linecap="round"/>`,
  `<path d="M380 150L256 378" fill="none" stroke="${BRAND.vane}" stroke-width="60" stroke-linecap="round"/>`,
].join('');

/**
 * The mark as SVG.
 *   ground: 'rounded' (app icon with corners), 'square' (full bleed: maskable, Apple touch), 'none' (mark only)
 *   scale:  shrink the mark inside the square (maskable icons keep it inside the 80 % safe circle)
 */
export function markSVG({ ground = 'rounded', scale = 1, size = null, attrs = '' } = {}) {
  const bg = ground === 'rounded' ? `<rect width="512" height="512" rx="112" fill="${BRAND.ground}"/>`
    : ground === 'square' ? `<rect width="512" height="512" fill="${BRAND.ground}"/>` : '';
  const off = Math.round(256 * (1 - scale) * 1000) / 1000;
  const mark = scale === 1 ? MARK : `<g transform="translate(${off} ${off}) scale(${scale})">${MARK}</g>`;
  const dim = size ? ` width="${size}" height="${size}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"${dim}${attrs ? ` ${attrs}` : ''}>${bg}${mark}</svg>`;
}

/** The splash markup that index.html carries inline (kept in sync by tools/build-icons.mjs; a test checks). */
export function splashHTML() {
  return `<div id="splash" class="splash" aria-hidden="true">${markSVG({ size: 72 })}<span class="wordmark">${APP_NAME}</span></div>`;
}
