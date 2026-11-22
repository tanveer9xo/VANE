// Deep links: every hash route is checked against an allow-list before any screen sees it. Pure.
// The app only reads location.hash (never the query string). Anything not listed, malformed percent-encoding,
// over-long links or control characters fall back to the Calendar.
//
//   #/  #/cal/YYYY-MM  #/day/YYYY-MM-DD  #/plan  #/timer
//   #/progress  #/progress/<exercise>  #/progress/~records|~map|~consistency  #/progress/~body[/YYYY-MM-DD]
//   #/settings[/profile|nutrition|backup|targets]  #/welcome/1…5  #/body[/YYYY-MM-DD] (old link)
import { isValidISODate, parseMonthKey } from './dates.js';

export const MAX_HASH = 300;
const SETTINGS = ['profile', 'nutrition', 'backup', 'targets'];
const SEGMENTS = ['~records', '~map', '~consistency', '~body'];
const HOME = Object.freeze({ name: 'cal', args: [] });
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

const decode = (s) => { try { return decodeURIComponent(s); } catch { return null; } };

/**
 * '#/day/2026-11-20' → { name: 'day', args: ['2026-11-20'] }, or { name: 'cal', args: [], invalid: true }
 * for anything not on the list (the router then replaces the link with #/).
 */
export function parseRoute(hash) {
  const raw = String(hash ?? '');
  if (raw.length > MAX_HASH) return { ...HOME, invalid: true };
  const parts = raw.replace(/^#\/?/, '').split('/').filter((p, i, a) => p !== '' || i < a.length - 1);
  const segs = parts.map(decode);
  if (segs.some((s) => s == null || CONTROL.test(s))) return { ...HOME, invalid: true };
  const [name = '', ...args] = segs;
  const ok = (n, a = []) => ({ name: n, args: a });
  const bad = { ...HOME, invalid: true };
  const date = (s) => isValidISODate(s);
  switch (name) {
    case '': return ok('cal');
    case 'cal': return !args.length ? ok('cal') : args.length === 1 && parseMonthKey(args[0]) ? ok('cal', args) : bad;
    case 'day': return args.length === 1 && date(args[0]) ? ok('day', args) : bad;
    case 'plan': case 'timer': return args.length ? bad : ok(name);
    case 'welcome': return args.length <= 1 && (!args.length || /^[1-5]$/.test(args[0])) ? ok('welcome', args) : bad;
    case 'settings': return !args.length ? ok('settings') : args.length === 1 && SETTINGS.includes(args[0]) ? ok('settings', args) : bad;
    case 'body': return !args.length || (args.length === 1 && date(args[0])) ? ok('body', args) : bad;
    case 'progress': {
      if (!args.length) return ok('progress');
      const [seg, extra] = args;
      if (SEGMENTS.includes(seg)) {
        if (args.length === 1) return ok('progress', [seg]);
        // ~body may carry a day to open (anything else is ignored rather than rejected).
        return seg === '~body' && args.length === 2 ? ok('progress', date(extra) ? [seg, extra] : [seg]) : bad;
      }
      // An exercise key: plain text, looked up in your catalog and shown with textContent.
      return args.length === 1 && !seg.startsWith('~') && seg.length <= 120 ? ok('progress', [seg]) : bad;
    }
    default: return bad;
  }
}
