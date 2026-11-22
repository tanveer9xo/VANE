// Renders the app icons from js/brand.js with headless Chrome (no dependencies) and syncs the inline splash.
//   node tools/build-icons.mjs        (npm run icons)    CHROME=/path/to/chrome to override
// Writes icons/icon.svg, icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png, and the
// splash markup between the <!-- splash --> markers in index.html.
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { markSVG, splashHTML } from '../js/brand.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9334;
const WORK = mkdtempSync(join(tmpdir(), 'vane-icons-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const ICONS = [
  { file: 'icon-192.png', size: 192, ground: 'rounded' },
  { file: 'icon-512.png', size: 512, ground: 'rounded' },
  // Maskable: full bleed, mark inside the 80 % safe circle. Apple touch: square (iOS rounds it), a little inset.
  { file: 'icon-maskable-512.png', size: 512, ground: 'square', scale: 0.8 },
  { file: 'apple-touch-icon.png', size: 180, ground: 'square', scale: 0.88 },
];

// ---- SVG + splash ----
writeFileSync(join(ROOT, 'icons', 'icon.svg'), `${markSVG({ ground: 'rounded' })}\n`);
const indexPath = join(ROOT, 'index.html');
const html = readFileSync(indexPath, 'utf8');
const synced = html.replace(/<!-- splash -->[\s\S]*?<!-- \/splash -->/, `<!-- splash -->${splashHTML()}<!-- /splash -->`);
if (synced === html && !html.includes(splashHTML())) throw new Error('index.html has no <!-- splash --> markers');
writeFileSync(indexPath, synced);

// ---- PNGs ----
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(WORK, 'p')}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
try {
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch { await sleep(200); }
  }
  if (!target) throw new Error('Chrome did not start');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result); }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });

  await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } }); // transparent corners
  for (const ic of ICONS) {
    await send('Emulation.setDeviceMetricsOverride', { width: ic.size, height: ic.size, deviceScaleFactor: 1, mobile: false });
    const page = `<!doctype html><html><body style="margin:0;background:transparent">${markSVG({ ground: ic.ground, scale: ic.scale ?? 1, size: ic.size, attrs: 'style="display:block"' })}</body></html>`;
    await send('Page.navigate', { url: `data:text/html;base64,${Buffer.from(page).toString('base64')}` });
    await sleep(250);
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: ic.size, height: ic.size, scale: 1 } });
    writeFileSync(join(ROOT, 'icons', ic.file), Buffer.from(shot.data, 'base64'));
    console.log(`icons/${ic.file}  ${ic.size}×${ic.size}`);
  }
  ws.close();
} finally {
  chrome.kill();
  setTimeout(() => rmSync(WORK, { recursive: true, force: true }), 300);
}
