# Security

VANE is a single-user, offline workout log. It runs entirely in your browser: there's no server, no account, no
analytics and no network call after the app's own files are downloaded. Your data lives in this browser's
storage on this device (IndexedDB, plus the appearance choice in localStorage) and leaves it only when you
export a backup.

## Threat model

| Threat | Protection | Where |
|---|---|---|
| Script injection through anything you type or import (exercise names, notes, session types, profile, backups, CSV) | Everything user-entered or imported is rendered as text (`textContent` / text nodes via `h()`), never as HTML. The only `innerHTML` uses render fixed app constants (icons, the body map, the brand mark). A strict CSP blocks inline and external script even if a bug slipped through. | `js/ui.js`, `index.html` |
| A hostile or broken backup file | 20 MB size cap before reading; JSON nesting capped at 32 levels before parsing; every field passes a normaliser that keeps known keys and types only. `__proto__` / `constructor` / `prototype` keys are never copied. Counts are capped: 20,000 workouts, 20,000 Body log entries, 60 exercises a day, 50 sets per exercise, 100 session types, 10 saved splits. A refused file says why, and nothing is imported. | `js/importguard.js`, `js/model.js`, `tests/security.test.js` |
| CSV formula injection when a CSV export is opened in a spreadsheet | Cells starting with `= + - @` are prefixed with `'` on export and unprefixed on import. | `js/csv.js` |
| Crafted links (`#/…`) | Every hash route is checked against an allow-list (screens, dates, month keys, settings pages, onboarding steps). Malformed percent-encoding, control characters and links over 300 characters go to the Calendar. The query string is never read. | `js/routes.js` |
| Third-party code (supply chain) | The app has no dependencies and loads nothing from other hosts. The font, icons and exercise library are bundled. The CI actions are pinned to commit SHAs, with weekly Dependabot update PRs. | `.github/` |
| A compromised build or deploy | Workflow permissions: read-only by default; only the deploy job can write Pages (`pages: write`, `id-token: write`). Checkout doesn't keep credentials. Deploys go through GitHub's OIDC Pages flow, with no stored secrets. | `.github/workflows/pages.yml` |
| Clickjacking | `js/boot.js` refuses to show the app inside a frame. | `js/boot.js` |
| A poisoned update or cache | The service worker handles only same-origin GET requests inside its own path, and caches only plain successful static files (no redirects, errors or opaque responses). Precaching bypasses the HTTP cache (`cache: 'reload'`), update checks use `updateViaCache: 'none'`, and a failed download leaves the old version running. The cache is versioned, and activation deletes only this app's old caches (`workout-tracker-*`). | `sw.js`, `js/pwa.js` |
| Losing data during an update | An update saves in-flight edits first and replaces only this app's own file caches, never IndexedDB, localStorage or anyone else's caches on the origin. | `js/pwa.js`, `sw.js`, `tests/browser/update.mjs` |
| A data migration going wrong | Snapshot of every store first (the last 2 kept); the migration runs in memory and is checked (workouts, sets, types, saved splits, Body log) before one atomic write. A failed check writes nothing and offers the snapshot as an exportable backup. Data from a newer version is never modified by an older copy of the app. | `js/migrate.js`, `js/store.js`, `tests/browser/datasafety.mjs` |

## Content-Security-Policy

`index.html` sets:

```
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self';
manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'
```

It allows no inline script, no `eval`, no inline styles and no external hosts. The first-paint code lives in `js/boot.js`, and the session colours in `css/sessions.css` (generated from `js/theme.js` by `npm run css`). Dynamic styles are set through CSSOM (`el.style`), which the CSP allows.

**What a `<meta>` CSP can't do (GitHub Pages can't send custom headers):**
- **`frame-ancestors` is ignored in a meta tag.** Framing is handled by `js/boot.js` instead, but a framing page could still load the app hidden. That's harmless, since nothing shows and the app holds no secrets.
- **No reporting** (`report-uri` / `report-to`), so violations aren't reported anywhere.
- **No `Cross-Origin-Opener-Policy`, `Permissions-Policy`, `Referrer-Policy` or HSTS of our own.** GitHub Pages serves HTTPS and HSTS for `github.io`. External links use `rel="noopener noreferrer"`.
- **The policy only starts once the meta tag is parsed.** Nothing comes before it except the charset.

## The shared-origin caveat (`<username>.github.io`)

Browsers isolate sites by **origin** (scheme + host + port), not by path. Every GitHub Pages site under the same account shares one origin: `https://<username>.github.io/VANE/`, `https://<username>.github.io/another-repo/` and the user site `<username>.github.io`. Code on any of them can:

- read and change VANE's IndexedDB (your workouts, Body log, profile, nutrition) and localStorage;
- read and overwrite VANE's Cache Storage, i.e. replace the cached app files, which the service worker then serves.

A service worker from another repo can't take over VANE's `/VANE/` scope (GitHub Pages doesn't send `Service-Worker-Allowed`), but the shared storage is enough. **Only publish other Pages sites under this account if you trust their code as much as VANE's.** For real isolation, use a custom domain (e.g. `vane.example.com` via the repo's Pages settings) or a separate GitHub account or organisation for VANE.

## What isn't protected

- **Someone with your unlocked phone,** or anything running in your browser profile (for example a malicious browser extension), can read your data. It isn't encrypted at rest beyond what the device does.
- **Exported backups are plain JSON or CSV.** Keep them somewhere private.
- **Browsers can evict storage under pressure.** Ask for persistent storage in Settings → Backup and keep backups.
- **Health estimates are not medical advice.** The nutrition estimates are averages (see "How it's counted").

## Checks

- `npm test` includes `tests/security.test.js`: the routes allow-list, the import guard, malicious backups, the CSP, the service worker rules and the workflow pinning.
- `npm run test:security` loads the built site under `/VANE/`. It checks that the CSP blocks inline script and `eval`, that imported script text shows as text and never runs, that oversized, deeply nested and wrong-typed files are refused with a message, and that crafted links fall back to the Calendar.
- `npm audit` reports 0 vulnerabilities (no dependencies).

## Reporting

Open an issue on the repository, or contact the owner privately for anything sensitive.
