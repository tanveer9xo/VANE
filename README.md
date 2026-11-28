# VANE

VANE is a personal lifting logbook that installs to your phone's home screen and works offline.
No accounts, no backend: everything is stored on the device (IndexedDB).

## Features

- **Calendar.** The month reads as a rack of plates:
  - **Plate markers** on a white (or dark) card of rounded day cells. A solid disc in the session colour means done, a ring means planned, and a faded ring means missed. A short grey dash marks a Break day, and a dash with a tick a logged rest day. The type name sits under every plate, so colour is never the only cue. Today's date sits in a filled circle; a small dot marks a weigh-in. The header shows "9 of 10 planned done".
  - **Week strip:** session-coloured pills, filled with a check on done days.
  - **Main button.** It follows today's state: "Start today's Upper", "Continue today's Upper", or "Today's Upper done ✓ View". Below it is a quick **Log weigh-in** link.
  - **This week.** A strip of seven tappable days with plates, a ring around today, and "2 of 5 done".
  - **Month summary.** Workouts done, consistency and the current streak. Consistency uses the same definitions as Progress → Consistency (finished weeks only, no percentage on thin data), so the two screens always agree. Break days, rest days and unplanned days never break the day streak; a missed planned day does.
  - **Key.** A compact legend that opens on tap.
  - **Weekly review.** Sessions done vs planned, volume vs the week before, PRs and bodyweight change, for this week or last week.
  - **Banners.** A dismissible backup nudge after 7 days without a backup, and an install banner that only shows when the app isn't installed (on iPhone it gives the "Share → Add to Home Screen" hint).
- **Planner.**
  - **Weekly schedule.** The default is Mon Push, Tue Pull, Wed Legs, Thu Break, Fri Upper, Sat Lower, Sun Break. Edits apply from today.
  - **Templates** for Push, Pull, Legs, Upper, Lower and Full body. Each exercise has sets × rep range, rest, weight step and a **primary muscle** tag.
- **Day screen.** Built for logging a set in two taps.
  - **Sticky session bar:** the type chip (tap to change), "6/9 sets", the time since the first tick, and a treadmill-minutes field.
  - **Header block** in the session colour: back, session name (tap to change), date, ⋯ menu, a big "6 of 21 sets" with a progress bar, the elapsed time and treadmill minutes. A slim bar in the same colour slides in once you scroll past it.
  - **Exercise cards:** an icon tile tinted with the session colour, the name, "3 sets, 6 to 10 reps", a "1/3" counter and a collapse chevron.
  - **Set rows:** `1 [−] 40 kg [+] [−] 8 reps [+] ○` as a rounded pill. An open set has an outlined circle. A ticked set gets the session tint and a filled check that pops.
  - **Ticking:** a set with an empty weight or reps can't be ticked. The row shakes and a toast says what's missing. Ticking gives a light haptic where supported.
  - **Collapse:** the exercise header shows "2/3". When every set is ticked, the exercise collapses to one line ("40×8 ×3 ✓") and the screen scrolls to the next unfinished exercise. Tap the line to open it again.
  - **Overload hint:** one row with the suggestion and what you did ("Last time: 8, 7, 7 reps."), hidden once any set of that exercise is ticked. The "Last" line above it lists every set from last time, warm-ups marked W.
  - **Per-exercise notes** (seat height, grip, machine setting) carry over and show the next time you do that exercise.
  - **First time:** a new exercise has no history, so its weight is left empty and focused, with "First time. Starting weight?".
  - **Adding exercises:** an **Add exercise** row at the end of the list (and in the ⋯ menu) opens the exercise picker.
- **Exercise library and picker.** 876 exercises from [free-exercise-db](https://github.com/yuhonas/free-exercise-db) (public domain), bundled as a trimmed `data/exercises.json` (no images) and cached for offline use.
  - **Finding exercises:** a search box, plus muscle and equipment filter chips (they scroll sideways). Favourites (☆) come first, then your 10 most recent, then everything A–Z, drawn 40 rows at a time with "Show more".
  - **Your own names:** a library entry you already log under your own name says "You log it as DB Chest Press". Picking it adds your name, so history stays on one exercise.
  - **Create custom exercise:** name, main muscle, optional second muscle, equipment.
  - **One-time question:** exercises the library doesn't recognise are asked about once ("Which muscle does this train?"), on the calendar and the Body map.
  - **Finish workout:** opens a summary sheet with duration, volume, sets, PRs, treadmill minutes and notes. Confirming marks the day complete ("Workout finished").
  - **⋯ menu:** previous/next day, change type, add missing template exercises, copy from the last session of the type, **Copy to another date**, **Keep screen awake**, and clear the day.
- **Timer tab.**
  - **Countdown:** a large ring with presets (0:45, 1:00, 1:30, 2:00, 3:00, plus a custom value). The last-used preset is remembered. Start, Pause, Reset and −15/+15.
  - **Stopwatch:** start, lap and reset.
  - **Settings:** sound, vibration, "Auto-start after ticking a set", and **Test (5 s)**.
  - **One shared timer:** the bar on other screens and this tab show the same timer. Tap the bar to open this tab; the tab shows a dot while anything runs.
- **Progress.** Five segments: **Charts**, **Records**, **Body map**, **Body** and **Consistency** (the bar scrolls sideways on narrow phones).
  - **Charts per exercise:** any library or custom exercise opens here; search to switch. An exercise with no sets yet shows an empty state.
    - **Trend chip:** Up, Flat or Down from the est. 1RM slope over the last 4 sessions (±1%).
    - **Stalled note:** shown after 4+ sessions without a new best.
    - **PR badges:** on the chart points that set a new best.
    - **History:** the full session list.
  - **Body map:** front and back figures (original, made of simple shapes) with weekly sets per muscle group. Each region is filled on a single-hue indigo ramp, and always labelled with its name and number.
    - **Window:** this week, or the last 4 weeks as a weekly average.
    - **Tap a muscle:** sets, target, planned vs done this week, last trained, and the exercises that hit it.
    - **Undertrained:** groups under half their target are marked ↓ and listed under the map by gap.
    - **Also:** a "View as table" toggle and a "How it's counted" sheet.
  - **Consistency:** how much of your plan you complete, skip and add to.
    - **Headline:** weekly adherence (e.g. 90%, "9 of 10 planned sessions") with the stricter on-the-day rate beside it. Choose 4 weeks, 12 weeks or all time. This week so far is shown separately and never counts toward the percentage.
    - **Counts:** done, skipped and extra, with rest days logged on planned days noted as not skips.
    - **Streaks:** current and best streak in weeks that hit the target (every planned session, or the minimum from Settings), and a day streak that Break days don't break.
    - **Charts:** a planned (outlined) vs done (filled) bar per week; a day-by-day heatmap; rolling 4-week adherence; and skip rate by session type and by weekday, most skipped first. Each has a "View as table" toggle. Tap a heatmap day to open it.
    - **Skip reasons:** optional one-tap reasons (Busy, Travel, Tired, Sick, Other) for missed planned days, set here or on the day screen. They stay on the phone and are in the JSON backup and CSV.
    - **"How it's counted":** an info sheet with every definition.
    - **Too little data:** under 2 finished weeks with a plan you see "Not enough data yet" and the counts, never a percentage.
  - **Charts:** search for an exercise and pick a metric (est. 1RM, top weight or volume). Each chart has a tap tooltip and a "View as table" toggle. Below it are the session list and **Sets per muscle this week** (horizontal bars).
  - **Records:** a compact table per exercise (1 / 3 / 5 / 8+ reps → "32.5 kg × 8", date), each with the same accent icon tile. Rows held by the same set are merged ("1–8+").
  - **Charts** open with four stats: best est. 1RM, heaviest set, sessions and last session.
  - **Body:** a weigh-in form with today's date and your last weight filled in. Four cards:
    - Latest.
    - "Change, last 7 days" (7-day average against a week earlier).
    - "Since first entry", which becomes "Change, last 30 days" once 30 days of data exist.
    - Waist, or the number of weigh-ins.
  - **Body chart:** daily dots and a 7-day average, with a legend.
- **Settings.**
  - **Stats:** a summary of your workouts.
  - **Backup:** JSON export, share and import, and **CSV export and import**.
    - The CSV has one row per set (with muscle columns) and one per logged rest day, skip reason and catalog exercise, so custom exercises and muscle tags round-trip.
    - CSVs from 1.4–1.6 import too.
  - **Preferences:** treadmill minutes, week start, default rest, weight step, minimum sessions per week (blank = your planned sessions) and keep screen awake.
  - **Weekly sets per muscle:** the body map target, 10 by default, with an optional number per muscle group.
  - **About:** version, check for updates, install help, storage status and credits (exercise library, icons, font).

## Run locally

There's no build step. Any static file server works:

```sh
npm start                  # = python3 -m http.server 8080
# open http://localhost:8080
```

If `npm start` says *Address already in use*, an earlier server is still running. Open http://localhost:8080, or stop it with Ctrl+C in its terminal.

Service workers need `localhost` or HTTPS, so `file://` won't work. On a phone on the same Wi-Fi, `http://<your-computer-ip>:8080` runs the app, but offline mode and install need HTTPS (see Deploy).

## Tests

```sh
npm test              # unit tests (node:test, no dependencies); date tests also run in two other time zones
npm run test:browser  # end-to-end at 360 px in headless Chrome, once in light and once in dark (CHROME=/path/to/chrome)
```

- **Unit tests** cover dates, the model and its migrations (including v3 → v4 and every older backup format), stats and PRs, plan logic, copying a workout, the consistency definitions (a session moved within the week, a session moved into the next week, Break days, extras, rest days, a schedule change mid-history, the first-week baseline, a week with nothing planned, the running week, thin data, streaks and month figures), the timer and stopwatch, hints, records rows, weekly review, sets per muscle, CSV and body trends.
- **The browser test** pins the clock to Fri 20 Nov 2026 and imports a v3 backup. It then checks:
  - the nav restructure;
  - plate states;
  - blocked and done set states;
  - collapse;
  - the shared timer across the bar and the Timer tab, and the stopwatch;
  - the finish sheet and copy to another date;
  - progress, records and body;
  - an offline reload with fonts;
  - a seeded history with hand-worked figures: the Consistency headline, counts, streaks and every heatmap cell must match it;
  - no stray "null" text;
  - toasts, the rest bar, the nav and the content never overlap on the day, timer and calendar screens, and toasts queue one at a time;
  - Appearance: switching to Dark is saved on the device, sets the status-bar colour, and is applied before the first paint after a reload;
  - nothing spills sideways at 320, 360 and 412 px, and tap targets are at least 44 px tall;
  - the font and the icons load with the network off.
- **Screenshots** for review are written to `docs/screenshots/light/` and `docs/screenshots/dark/` on every run.

**Session colours.** Validated with the dataviz skill's `validate_palette.js` on both page surfaces. `--mode dark` against `#0F1226`: all checks pass. `--mode light` against `#F4F5FA`: everything passes except contrast for Legs (2.97:1) and Cardio (2.93:1), so in light mode session marks only sit on white cards (all ≥ 3:1 there) and always next to their name or an icon. The worst adjacent pair is Upper↔Legs: CVD ΔE 8.8, normal vision 15.2. If you change a colour, re-run the validator and `npm test` (tests/theme.test.js checks every contrast pair).

**Heatmap colours.** One indigo ramp per theme, each passing `validate_palette.js --ordinal` on its card: light `#9A9AEC → #6E6EDC → #3F3FB0`, dark `#5C5CC4 → #8C8CF0 → #C8C8FA`. Done is the strongest step, extra the middle, skipped an outline, so fill versus outline also carries the meaning, and the legend names each one.

## Manual test checklist

Run through this on a real phone after deploying, since browsers differ here.

**Timer in the background**
- [ ] Tick a set today. The bar appears with the exercise's rest (Squat/Deadlift 3:00, isolation 1:00, others 1:30), and the Timer tab shows a dot.
- [ ] Tap the bar. The Timer tab shows the same time on the ring. +15 there, then go back: the bar has the extra 15 s. Pause on one screen and the other shows "Paused".
- [ ] Lock the phone for longer than the rest, then unlock. The bar shows "Go" or has cleared, with no stale countdown and no late beep.
- [ ] Start 90 s, switch apps for 30 s, come back. About 60 s remain.
- [ ] Reload or kill the app mid-rest and reopen. The timer resumes with the right time. The stopwatch also survives a reload.
- [ ] With the screen on, let it reach zero. With Sound on you hear a beep; the screen flashes; Android vibrates (iPhone can't, so check the beep and flash). Turn Sound or Vibration off on the Timer tab and check each stops.
- [ ] Turn off "Auto-start after ticking a set". Ticking no longer starts the timer. A past or future day never starts it.
- [ ] VoiceOver/TalkBack announces the rest at the start, every 30 s, at 10 s and at the end. It doesn't read every second.

**Keep screen awake**
- [ ] Turn on Settings → Keep screen awake (or ⋯ → Keep screen awake on a day). Open today's workout and leave the phone untouched past its auto-lock time. The screen stays on.
- [ ] Leave the day screen, or open a past or future day. The phone auto-locks normally again.
- [ ] Switch apps and come back to today. The screen stays awake again (the lock is re-requested).
- [ ] In a browser without the Screen Wake Lock API (older iOS Safari), the toggle is greyed out with "Not supported in this browser" and nothing else breaks.

**Fonts and icons load offline**
- [ ] Open the app online once, then turn on airplane mode and force-quit it. Reopen it: text is in Plus Jakarta Sans (round, geometric), not the system font, and every nav item, button and exercise tile has its icon.
- [ ] In desktop Chrome DevTools → Network → Offline, reload. There are no failed requests, and `document.fonts.check('700 16px "Plus Jakarta Sans"')` is `true`.

**Appearance**
- [ ] Settings → Appearance → Dark. The app turns dark at once and the phone's status bar matches. Force-quit and reopen: it starts dark with no light flash.
- [ ] Choose System, then switch the phone between light and dark mode. The app follows.
- [ ] In both themes, check the day screen in bright light: the header, done rows, Finish workout and the rest bar are in the session colour, and all text is easy to read.

**Nothing overlaps**
- [ ] Tick a set so the rest bar shows, then scroll to the very bottom of the day. The last row and the notes sit above the bar; the bar sits above the nav.
- [ ] Trigger a few toasts (e.g. change a setting twice). They show one at a time above the bar or nav, and on the Timer tab they never cover the mode switch or the controls.

**Install on Android**
- [ ] Open the HTTPS URL in Chrome. The calendar shows an install banner. Tap **Install** and the banner goes away. After installing, it never shows again (also after dismissing).
- [ ] Launch from the home screen. It opens full screen; the status bar matches the theme once the app has loaded (the launch splash uses one fixed colour, see Decisions).
- [ ] Settings → App shows "Installed and running as an app" and persistent storage.

**Install on iPhone**
- [ ] Open the URL in Safari. The calendar shows "Install: tap Share, then 'Add to Home Screen'". Dismiss it and it stays dismissed.
- [ ] Share → Add to Home Screen → Add, then launch from the icon. Full screen, safe areas respected (nothing under the notch or the home indicator), and the tab bar is reachable.
- [ ] Data entered in Safari before installing doesn't appear in the installed app (separate storage). Use Export → Import if needed.

**Exercise library, picker and body map**
- [ ] Open the picker offline: search "bench", filter Chest + Dumbbell, star one; it appears under Favourites next time. Scrolling stays smooth on a slow phone.
- [ ] Create a custom exercise with a main and a second muscle; log a set; Body map counts 1 and 0.5.
- [ ] After updating from 1.6, exercises the library doesn't know ask once which muscle they train. Answer or skip; it doesn't ask again. Your old history keeps its exact names.
- [ ] Body map: tap a muscle, check the sheet. Switch This week / Last 4 weeks and Front / Back. Change a target in Settings and see the undertrained list change.
- [ ] Export the CSV, then import it on another phone (or after Erase): sessions, custom exercises and muscle tags come back.

**Consistency**
- [ ] With a plan and a couple of weeks of use, Progress → Consistency shows a percentage. On a fresh install it shows "Not enough data yet" and the counts.
- [ ] Do Wednesday's session on a Thursday (a Break day). Wednesday shows a ring with a dot ("done on another day"), Thursday a solid cell, and the week still counts as complete.
- [ ] Skip a planned day and let the week end. It shows as an outline and under Skipped. Tap a reason under "Skipped days", or open that day and tap one. The count appears. Tap the same reason again to clear it.
- [ ] Log a rest day on a planned day: it is left out of the planned count, not counted as a skip.
- [ ] Settings → Minimum sessions per week: set 3 and check the weekly streak counts weeks with 3 or more workouts.
- [ ] The calendar's month consistency matches the Consistency screen for the same weeks. Tap a heatmap day to open it.
- [ ] Export the CSV and open it in a spreadsheet: rest days show as "rest day", and skipped days with a reason as "skipped".

**Day screen states**
- [ ] An open set has an outlined circle on a neutral row; a ticked set has a filled check on a row tinted in the session colour. You can tell them apart at arm's length in bright light.
- [ ] Clear a weight and tap its check. The row shakes, a toast says "Set 2 needs a weight…", and nothing is ticked.
- [ ] Tick every set of an exercise. It collapses to one line and the next unfinished exercise scrolls into view. Tap the line to open it again.
- [ ] Finish workout shows duration, volume, sets, PRs, treadmill and notes. Confirm, and the calendar button says "Today's … done ✓".

**Set types are excluded from PRs**
- [ ] Log Squat 100×5 on a past day. Today, mark a set **W**, enter 140×5 and tick it: no trophy or "PR", and volume is unchanged.
- [ ] Change it to **F**: it counts (trophy, "PR", Records update).

**Overload hint rules** (rep range 8–10, step 2.5)
- [ ] 35×10 ×3 last time → "Try +2.5 kg: 37.5 × 8" with "Last time: 10, 10, 10 reps." **Apply** fills only unticked sets.
- [ ] 35×9, 35×7, 35×6 → "Repeat 35 kg and aim for 8+ reps". 35×6, 35×6, 35×5 → "Drop to 32.5 kg × 8". 35×8, 35×9, 35×7 → "Aim for +1 rep at 35 kg".
- [ ] Tick any set of that exercise and the hint disappears.

**First run and profile (1.8)**
- [ ] Fresh install (or Erase all data): the five screens show with progress dots, Back and Skip on each; the VANE wordmark is on the welcome screen.
- [ ] Skip every screen: you land on the Calendar with nothing changed (kg, 90 s rest, 2.5 kg step, default plan).
- [ ] Answer everything (lb, Get stronger, 3+ years, Upper/Lower × 4, 180 lb): "Your week" shows Upper/Lower; Start → Calendar with "Hi, …", 180 lb on the weigh-in, a 2.5 lb step, 2:30 rest and a good week of 4.
- [ ] Custom split → Start opens the Planner.
- [ ] Settings → Profile: switch kg ↔ lb and check the day screen, Body, Calendar and Settings follow, with no history rewritten.
- [ ] An existing install upgrading to 1.8 shows no flow, only the "Set up your profile" card; dismissing it keeps it gone.

**Polish (1.9.1)**
- [ ] Progress at 320 px: the sub-tab row scrolls; an edge fades wherever more tabs sit past it.
- [ ] Onboarding step 4: each split card lists its days (e.g. "Mon Push, Wed Pull, Fri Legs") and follows sessions per week. Picking a split brings Sessions per week fully into view above Next.
- [ ] Settings → Profile card: your name and goal, or "Set up your profile" when nothing is answered. There's no height field in onboarding or Profile.
- [ ] Bro split on the Planner: a future day you never edited switches to the new type. A future day you edited keeps yours, with "Changed from …".

**Session types (1.9)**
- [ ] Planner → Bro split: five types in five colours, Mon–Fri; next week's calendar cells read C+T, B+B, Legs, Shldr, Arms.
- [ ] Open next Monday: Chest + Triceps with its template. The type switcher lists every type plus Break.
- [ ] Add types until the colours run out: the 9th coloured type is grey and still shows its label.
- [ ] Rename a type with logged days: the days show the new name. Delete it: it's archived and past days keep its name and colour. Delete a type with no history: it's gone.

**Quick entry**
- [ ] Tapping a number selects it; ± steps by the exercise's step. When the keyboard opens, the tab bar, timer bar and + Exercise button hide.

## Deploy

The repository root *is* the site. All paths are relative, so it works at a domain root or a sub-path such as `username.github.io/workout-tracker/`.

**Before every deploy, bump the version** in `sw.js` (`VERSION`) and `js/model.js` (`APP_VERSION`); this release is 1.16.0. Installed copies then show "A new version is ready" with an **Update** button, or you can use Settings → App → Check for updates. `npm test` fails if the two values differ, or if a file in `js/`, `css/`, `icons/` or `fonts/` is missing from the service worker's precache list.

### GitHub Pages
The repo `VANE` is served at `https://<you>.github.io/VANE/`. Every URL in the app is relative (manifest `start_url`/`scope`/`id` are `./`, the service worker registers `./sw.js` and precaches `./…`), so the sub-path just works. `npm run test:subpath` proves it: it serves the built site under `/VANE/` and checks the service worker scope, the precache, the manifest, Chrome's install criteria and offline use.

1. Push to `main`. `.github/workflows/pages.yml` runs the unit tests and the sub-path check, builds the site with `tools/build-site.mjs` (app files only: no tests, tools or docs) and publishes it.
2. One time: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Each deploy: bump `VERSION` in `sw.js` and `APP_VERSION` in `js/model.js` so installed phones get the update. `.nojekyll` makes sure every file is served as-is.

### Netlify
- **Drag and drop:** app.netlify.com → *Add new site → Deploy manually*, then drop this folder.
- **From Git:** *Import from Git*. `netlify.toml` publishes `.` and serves `sw.js` with `no-cache`.
- **From the CLI:** `npx netlify-cli deploy --prod --dir .`

## Install on your phone

### Android (Chrome)
1. Open the HTTPS URL in Chrome.
2. Tap **Install** in the calendar banner, use Settings → App → **Install app**, or Chrome's ⋮ menu → **Install app**.
3. Launch from the home screen. It runs full screen and offline, and Chrome usually grants persistent storage.

### iPhone / iPad (Safari)
1. Open the HTTPS URL in **Safari**.
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Launch from the home screen icon.

> **iOS caveat:** the home-screen app has its own storage, separate from Safari's. Install first, then log, or move data with Export → Import. iOS can clear data for web apps you haven't opened in a long time, so back up now and then. The calendar nudges you after 7 days without a backup.

## How it works

```
index.html            App shell (5 tabs, toast + timer live regions); preloads the fonts
manifest.webmanifest  PWA manifest (standalone, portrait, icons incl. maskable)
sw.js                 Service worker: precaches every file incl. fonts; cache-first; versioned caches
fonts/                Plus Jakarta Sans 500–700 (variable, latin subset woff2, OFL)
css/styles.css        Light and dark tokens, components, 320–412 px layout, reduced-motion and forced-colours support
js/app.js             Boot + hash router
js/store.js           In-memory state ↔ IndexedDB; debounced autosave flushed on navigation and backgrounding
js/db.js              IndexedDB wrapper + structural upgrades
js/model.js           Schema, defaults, muscles, parsing, record/backup migrations
js/plan.js            Schedule lookup, templates → day, day status, streak, consistency, copy workout
js/stats.js           Epley 1RM, history, records, PR detection, weekly stats, set formatting
js/review.js          Weekly review, sets per muscle, records table rows
js/consistency.js     Planned / done / skipped / extra, adherence, streaks, heatmap states (the one place the definitions live)
js/muscles.js         The 14 muscle groups and the one mapping from library (and v4) muscle names to them
js/library.js         Loads data/exercises.json; name matching, aliases, the exercise catalog and its v4 → v5 build
js/volume.js          Body-map maths: weighted sets per group, windows, targets, status, planned vs done
data/exercises.json   free-exercise-db, trimmed (id, name, muscles, equipment, level, category), precached
js/progression.js     Overload hint rules (+ the reason shown with each)
js/timer.js           Shared rest countdown + stopwatch (timestamp-based), Web Audio beep, sticky bar
js/wakelock.js        Screen Wake Lock with re-acquire on visibility change
js/csv.js             One-row-per-set CSV export (formula-safe)
js/body.js            Bodyweight moving average and change
js/chart.js           Line chart (crosshair, tooltip, end label, table view) and horizontal bars
js/dates.js           Local-date helpers (no UTC conversions)
js/theme.js           Session colours (base, block, tints), theme tokens, appearance (system/light/dark)
js/icons.js           Tabler outline icons as an inline SVG sprite (MIT, icons/TABLER-LICENSE.txt)
js/ui.js, js/pwa.js   DOM helpers, plates, sheets, dialogs, toasts; install prompt, updates, storage
js/views/*.js         calendar, day, picker, planner, timer, progress (+records), bodymap, body, consistency, settings
tests/*.test.js       Unit tests (node --test)
tests/browser/e2e.mjs Browser test over the Chrome DevTools protocol (no dependencies)
```

Routes: `#/cal/2026-11`, `#/day/2026-11-20`, `#/plan`, `#/timer`, `#/progress[/<exercise>]`, `#/progress/~records`, `#/progress/~map`, `#/progress/~body[/<date>]`, `#/progress/~consistency`, `#/settings[/backup|/targets]`. The 1.3 route `#/body` redirects to Progress → Body.

### Data model (schema v11, IndexedDB v2)

| store       | key    | value |
|-------------|--------|-------|
| `sessions`  | `date` | `{ v: 12, date, type, exercises, notes, startedAt, finishedAt, createdAt, updatedAt }`. `type` is a session-type **id**, `'Break'` (logged rest) or `null`. A cardio exercise is `{ kind: 'cardio', name, sets: [], cardio: { minutes, distanceKm, speedKmh, incline, kcal, done, timerStartedAt } }` (empty = null). |
| `exercises` | `key`  | the exercise catalog: `{ key, name, libId, primary: [group], secondary: [group], equipment, custom, favourite, needsMuscle }` |
| `body`      | `date` | `{ date, weight (kg) \| null, waist (cm) \| null, neck, shoulders, chest, armL, armR, forearm, hips, thighL, thighR, calf (cm, only those recorded), bodyFat (%, optional), updatedAt }`. Any subset; nothing is required (v8). |
| `meta`      | `key`  | `settings`, `schedule`, `templates`, `skipReasons`, `profile`, `sessionTypes`, `nutrition`, `intake`, `lastExportAt` (and v4's `muscles`, kept but no longer used) |

- **Session exercise:** `{ id, name, target: { sets, repsMin, repsMax } | null, weightStep, restSeconds, hintDismissed, note, sets }`.
- **Set:** `{ weight, reps, done, type: 'warmup' | 'working' | 'failure' }`.
- **`startedAt` / `finishedAt`:** epoch ms of the first tick (today only) and of "Finish workout"; `null` when unknown.
- **`skipReasons`:** `{ 'YYYY-MM-DD': 'Busy' | 'Travel' | 'Tired' | 'Sick' | 'Other' }`. Optional; only used for days that turn out to be skipped. A logged rest day is a session with `type: 'Break'`.
- **Exercise catalog:** one record per name you log; the name itself is never changed. `libId` links it to the library, and `primary`/`secondary` are display groups. `needsMuscle` marks the one-time question.
- **`settings`:**
  - general: `{ weekStartsOn, defaultRestSeconds, weightStep, keepAwake, weeklyMin }` (`weeklyMin`: sessions per week that make a good week, or `null` to use the plan)
  - body map: `{ muscleTarget: 10, muscleTargets: { Chest: 12, … } }`
  - timer: `{ timerSound, timerVibrate, autoStartRest, timerPreset }`
- **`schedule`:** `[{ from: 'YYYY-MM-DD', days: { mon…sun } }]`. **`templates`:** `{ Push: [{ name, sets, repsMin, repsMax, weightStep, restSeconds } | { name, kind: 'cardio', minutes }], … }` (cardio items from v12; `minutes` is the default time or `null`). A `null` step or rest means "use the setting".
- **`sessionTypes`** (v7): `[{ id, name, short, color: 'red'…'pink' | null, kind: 'lift' | 'cardio' | 'other', builtin, hidden, archived, order }]`.
  - Sessions, the plan (`schedule[].days`) and `templates` all refer to a type by **id**, so renaming or recolouring never rewrites history.
  - The built-in ids are the original names (`'Push'`, `'Full body'`, …), so data from before v7 needed no rewrite. New types get `t-…` ids.
- **`profile`** (v6): `{ name, units: 'kg' | 'lb', goal, experience, split, sessionsPerWeek, heightCm, onboarding: 'pending' | 'done' | 'existing', setupCardDismissed, updatedAt }`. It holds no sex, birth date or medical information.
- **Units:** weights are always stored in kg and lengths in cm. A value typed in lb is stored at 4 decimal places (135 lb → 61.2349 kg), so it reads back exactly. The profile's unit only changes what's shown and typed (`js/units.js`).

Backup file: `{ app, schemaVersion: 9, appVersion, exportedAt, units: 'kg' (stored units), profile, sessionTypes, nutrition, intake, settings, schedule, templates, skipReasons, body, exercises, sessions }`.

### Migrations

- **Records** (run on startup, rewritten in place):
  - v1 → v2 marks existing sets `done` and adds `target`.
  - v2 → v3 adds set `type`, `weightStep`, `restSeconds` and `hintDismissed`.
  - v3 → v4 adds `note: ''` to exercises and `startedAt`/`finishedAt: null` to sessions.
  - **v4 → v5** leaves sessions as they are, apart from the version number. The **exercise catalog** is built on startup (`library.js buildCatalog`):
    - **Matching:** every name in your history and templates is matched to the library, by an alias table for the built-in names, then by normalised name (case, punctuation, plurals, DB/BB/KB).
    - **Your v4 choices:** a muscle tag you set yourself wins for the main muscle; custom names stay custom.
    - **No match:** names nothing recognises get the one-time muscle question.
    - It's idempotent and never renames or drops history.
  - **v5 → v6** leaves sessions as they are, apart from the version number. On the first v6 start, stored data without a profile gets one: `onboarding: 'existing'` if any workout is logged (no first-run flow, just a one-time "Set up your profile" card), otherwise `'pending'` (the flow). Template steps that only repeated the global step become `null`, so they follow the setting that your experience answer now sets. The numbers are the same as before, and steps you chose yourself stay.
  - **v7 → v8:** Body log entries keep their weight and waist exactly; the other measurement sites are new and optional, and weight stops being required.
  - **v8 → v9:** nutrition starts off with no answers, and the intake log starts empty. Nothing else changes.
  - **v6 → v7** leaves sessions as they are, apart from the version number. On the first v7 start, the built-in types become the stored `sessionTypes` list. Every session, plan day and template already holds the right id.
- **Backups:** unversioned and v1 to v6 files (v6 → v7 adds `sessionTypes: null`, meaning the built-ins). A v7 file's own custom types count as known while its sessions, plan and templates are read, so nothing referring to them is dropped. "Replace all" takes the file's types; "Merge" adds the ones you don't have and never changes yours. CSV carries type **names**: they map back to the same ids, and an unknown name becomes a new type.
- **Older backups:** unversioned and v1 to v5 files are upgraded step by step on import (v5 → v6 adds `profile: null` and the same template-step rule; "Replace all" takes a file's profile answers, while this phone keeps its own first-run state) (v4's custom names and muscle tags become catalog records the same way). v3 → v4 also adds `muscles: {}` and `skipReasons: {}`; a v4 file made without them still imports. Merge keeps your own muscle tags and lets the file's skip reasons win on a clash (they're per date, like sessions); Replace takes the file's.
- **To change the schema:** bump `SCHEMA_VERSION`, add `SESSION_MIGRATIONS[n]` and `BACKUP_MIGRATIONS[n]`. If stores change, bump `DB_VERSION` in `js/db.js`.

### Body measurements (1.10)
- **Sites:** neck, shoulders, chest, upper arm (left and right), forearm, waist, hips, thigh (left and right), calf, plus body fat % ("your own estimate").
- **What's tracked:** choose sites in Settings → Profile or on the Body tab. The defaults are chest, waist, hips, upper arm and thigh.
- **Logging:** a Body log entry can hold any subset. Lengths show in cm or inches (profile units) and are stored in cm.
- **Per site:** latest value, the change since the first and since the previous entry, and a trend chart titled with the site's name.
- **Waist-to-height:** shown only when a height is stored (latest waist ÷ height), as a plain number with a "How it's counted" note. Height isn't asked in onboarding or Profile; it comes from the Nutrition setup or a 1.8 profile.
- **Weight:** the bodyweight field starts empty with "Last: …" beside it, so logging only a measurement never logs an old weight again.
- **CSV:** `bodyweight` rows (kg) and `measurement` rows (`site`, `value` in cm or %).

### Updates (1.10)
- **The banner:** a new version installs in the background, then a banner at the top of the page says "Update ready. Tap to refresh". It sits in the page flow, never over content, and it isn't a toast.
- **Your choices:** tap it to update, or dismiss it until Settings → About → Check for updates brings it back. About shows the version.
- **Data is never touched:** updating saves any edit in progress first, then replaces only the app's own file cache (`workout-tracker-*`). IndexedDB and localStorage stay as they are.
- **Tested:** `npm run test:update` bumps the version on a test server and checks the banner, Dismiss, the reload and that every record survives.

### Cardio in templates (1.16, data format v12)
- **Templates:** a session type's template (Planner → Templates) can hold cardio exercises from the same Cardio group, anywhere in the order: Treadmill first as a warm-up, or last. Each has an optional **default time**, and no sets, reps, rest or muscle. The Cardio type has a template too (Treadmill to start), and saved splits keep cardio items with the rest of their templates.
- **On the day:** a planned day opens with the template in order, cardio included, with Time pre-filled from the default. It isn't Done, and nothing is saved until you change something or tap Done.
- **Migration (v11 → v12):** the old **Default treadmill minutes** setting (before 1.14 it pre-filled the Treadmill chip on every training day, 20 by default) becomes a **Treadmill** item with that time at the end of every lifting template, on the Cardio type's Treadmill, and in saved splits' templates. If the setting was 0 (off), nothing is added. On a phone already on 1.15, where the setting is no longer in the settings, the snapshot taken before 1.15 supplies it. The migration check also makes sure no template loses an exercise.
- **Rest timer:** the rest bar no longer starts after the set that completes the workout, and a rest still running from the set before stops.

### Install and data safety (1.15)
- **Install:**
  - **Android/Chromium:** the browser's `beforeinstallprompt` is kept for an **Install VANE** button in Settings → App (above About) and a one-time, dismissible Calendar card.
  - **iPhone/iPad Safari** (which has no prompt): **Add to your home screen** opens the three steps (Share → Add to Home Screen → Add), with a note that it must be Safari.
  - **Elsewhere:** other iOS browsers can't install a web app, so nothing is offered. Once installed (or running standalone) Settings shows a quiet **Installed**.
  - **No nagging:** dismissing the Calendar card is remembered.
- **Updates never touch your data:** an update only replaces this app's own file caches (`workout-tracker-*`), never IndexedDB, localStorage or anyone else's caches on the same origin. In-flight edits are saved first, and the reload returns to the same screen.
- **Updates that change the data format:** the "Update ready" banner says **Export a backup before updating**, with an Export button. It asks the waiting version which format it brings; `SCHEMA` in `sw.js` matches `SCHEMA_VERSION`, and a test checks.
- **Migrations are snapshot-first and all-or-nothing** (`js/migrate.js`):
  1. **Snapshot:** before stored data is migrated, every store is copied into a `snapshots` store (IndexedDB v3). The last 2 are kept.
  2. **Migrate and check:** the migration runs in memory, then a check compares workouts, sets, session types, saved splits and Body log entries.
  3. **Write once:** only then is everything written in one transaction, with a `schemaVersion` marker.
  4. **If the check fails:** nothing is written. The app shows **VANE couldn't update your data**, with an Export button for the snapshot (an importable backup) and Try again.
- **Data from a newer version** (a stale cached copy of the app): nothing is read-modify-written. The app shows **Update VANE to open this data** and starts the update.
- **Storage:** VANE asks the browser to persist storage at first launch and after install. Settings → Backup shows **Storage protected: Yes / Not guaranteed** with a short explanation, plus the date of the last backup; the Calendar reminds you weekly.
- **Tests:**
  - `tests/migrate.test.js` upgrades realistic stored data from every format v1–v10 and deep-compares it, rolls back an interrupted migration, and round-trips export → import.
  - `npm run test:datasafety` covers real IndexedDB: snapshot, rollback, newer data and the 2-snapshot limit.
  - `npm run test:update` covers a data-changing update with a workout in progress and other sites' storage untouched.
  - `npm run test:install` covers every install state at 320/360/412 px in light and dark.

### Cardio (1.14)
- **Adding:** Add exercise has a **Cardio** group: Treadmill, Walking, Running, Jogging, Cycling, Rowing, Stairs and Other cardio. A cardio exercise can go on any day and is one entry, with no sets, kg or reps.
- **The card:**
  - **Time** (minutes) is the only thing **Done** needs. A Start/Stop timer can fill it in.
  - **Optional fields:** Distance (km or mi, per profile), Avg speed (km/h or mph), Incline % and Calories. Empty stays empty, never 0.
  - **Calculation:** with Time plus Distance or Speed, the other is worked out live and marked "calculated". It's shown, never stored. With only Time, Distance and Speed stay blank.
- **Part of the day:** a day with cardio is still one session, and cardio shows as a small badge on the day and on its calendar cell. A Cardio-type day opens with its template (Treadmill to start).
- **Totals:** weekly cardio minutes (finished entries) appear in Settings → Stats and in the Calendar's "This week". Distance totals count only entries that have a distance.
- **History:** Progress → Charts → Cardio has one history per activity. Time is always shown; Distance and Speed appear only when entries have them.
- **Backups:** JSON and CSV (`cardio` rows: minutes, distance km, speed km/h, incline %, calories) keep empty values empty.
- **Migration (v10 → v11):** a workout's old treadmill minutes became a Treadmill entry in that workout, marked done if the workout was done. The old "Default treadmill minutes" setting (which pre-filled 20 minutes on every workout) is gone.

### Saved splits (1.12)
- **Saving:** Planner → **Save as my split** names a snapshot of the current week: the 7 days, the session types it uses (name, short label, colour) and their templates (exercises, sets, rep ranges, rest and step).
- **Where they appear:** under "Start from a split", marked **Yours**, next to the presets. Each one can be applied, renamed, duplicated, updated ("Save the current week into this split") or deleted. You can keep up to 10.
- **Applying:** a confirm sheet says exactly what changes first. Your week is replaced from today, and the split's types and templates are restored exactly as saved: a type renamed, archived or deleted since comes back, and the sheet says which. Other lifting types are hidden, not deleted. Logged workouts and past days never change.
- **Elsewhere:** saved splits are in JSON export and import (schema v10), and in onboarding's split list when any exist.

### Security (1.13)
See [SECURITY.md](SECURITY.md) for the threat model, the CSP and its meta-tag limits, and the shared-origin caveat for `<username>.github.io`.
- **In short:** everything you type or import is rendered as text, and imports are size-, depth- and count-capped with prototype keys refused. Deep links go through an allow-list (`js/routes.js`). The strict CSP allows no inline script, no eval and no other hosts.
- **Service worker:** it handles same-origin GET requests inside its own path only.
- **CI:** the actions are pinned to commit SHAs, with least-privilege permissions and Dependabot.
- **Tests:** `npm run test:security` exercises all of this in a real browser.

### Recomp and nutrition (1.11)
- **Recomp goal:** "Recomp (lose fat, build muscle)" is a goal in onboarding and Profile. Its hints and weekly review judge waist, strength and the weight trend together; the review leads with waist.
- **Nutrition is opt-in:** Settings → Nutrition is off by default and also offered as a card on the Body tab. Every answer is optional and stays on the phone: sex (Male / Female / Prefer not to say), birth year, height, current weight (pre-filled from the Body log) and activity.
- **Adults only:** never shown or switched on under 18. With only a birth year, it assumes the youngest possible age.
- **Calculation** (`js/nutrition.js`):
  - Mifflin-St Jeor BMR (+5 male, −161 female, −78 "Prefer not to say", shown with a range spanning both) × activity factor (1.2, 1.375, 1.55 or 1.725).
  - Goal adjustment: Lose fat −10 to −25 % (−20 % default), Build muscle +5 to +10 %, Recomp 0 to −5 %, otherwise maintenance.
  - Limits: a loss is capped at about 1 % of bodyweight a week, with floors of 1,500 / 1,200 / 1,350 kcal.
  - Protein: 1.6–2.2 g/kg (1.8 by default); Lose fat and Recomp 2.0–2.2.
- **What you see:** an estimate with its ranges, a "How it's counted" sheet, a doctor note, a switch to hide all numbers, a prompt when Body log weight moves more than 2 kg, and an optional manual daily log (calories and protein totals) with progress bars.

### Exercise display names (1.9.1)

Library names can be long ("Barbell Bench Press - Medium Grip"), so the app shows a short form ("Bench Press") everywhere: the Day screen, Planner, Progress, Records, the body map and the weekly review. The picker shows the short name with the full library name on a detail line, and search matches either.
- **Which names change:** only names spelled exactly as in the library. Names you typed yourself are shown as you typed them, and stored names never change. The full name stays as a tooltip, and CSV and JSON keep full names.
- **How:** a curated list (`DISPLAY_NAMES` in `js/library.js`) plus a generic clean-up (drop " - variant" and "(…)", Dumbbell → DB).
- **Ambiguity:** a short name is used only when it's unambiguous. If two library entries would share it, or it matches a name you log yourself, the full name shows instead.

### Session types (1.9)

- **Planner → Session types:**
  - **Add or Edit:** name, short label (≤ 6 characters, for calendar cells), colour, and Hide.
  - **Delete:** a type with history (logged days or past plan days) is **archived** instead. It leaves the pickers and your plan from today, while past days keep its name and colour. A type without history is removed with its template.
  - **Templates:** each lifting type's template is edited in the Templates card, with exercises from the library and sets × rep range.
- **Presets** (Planner and onboarding): Push/Pull/Legs, Upper/Lower, Full body, **Bro split** (Chest + Triceps, Back + Biceps, Legs, Shoulders, Arms; Mon–Fri) and **Arnold split** (Chest + Back, Shoulders + Arms, Legs; 6 days).
  - **Applying one:** it reuses a type of the same name, creates the rest with starter templates, puts the preset's types first, and fills the week from today.
  - **Other types:** the remaining lifting types are hidden (their history stays). Cardio and Other are left alone.
- **Colours:** 8 slots (Red, Blue, Gold, Green, Violet, Orange, Cyan, Pink), validated with the dataviz `validate_palette.js` against the light (#FFFFFF) and dark (#1B2040) cards.
  - **Validator result:** lightness, chroma, contrast and normal-vision separation pass. Pink↔Cyan is a CVD WARN (7.8), which is allowed with a second cue.
  - **Assignment:** a new type takes the next colour no visible type uses. Beyond 8 it gets a neutral grey.
  - **Second cue:** every plate, pill and Consistency row shows the type's name or short label, so colour is never the only cue.
  - **Hidden types:** they keep their colour for their own history, so a reused colour can appear on old days next to a different label.

### Profile: what each answer changes

| answer | changes | from |
|---|---|---|
| Name | "Hi, Sam" on the Calendar | now |
| Units (kg / lb) | every weight and length shown or typed; the −/+ step converts (2.5 kg ↔ 5 lb, 1 kg ↔ 2.5 lb, 5 kg ↔ 10 lb) | now (data stays kg/cm) |
| Goal | a goal sentence after each overload hint; which figure leads the weekly review, plus a one-line headline | now |
| Experience | default step and rest: New 2.5 kg / 5 lb and 1:30, 1–3 years 2.5 kg / 5 lb and 2:00, 3+ years 1 kg / 2.5 lb and 2:30 | now (per-exercise values still win) |
| Split + sessions | fills the weekly plan from today from the existing templates (PPL, Upper/Lower or Full body, spread across the week); Custom leaves the plan alone and opens the Planner | today on; past days keep their plan |
| Sessions per week | the good-week minimum on Consistency (also editable there and in Settings) | now |
| Bodyweight / waist | the first Body log entry, dated today | once |
| Height | no longer asked (1.9.1); a value stored by 1.8 is kept in the profile and in backups | – |

The first-run flow (`#/welcome/1…5`) shows on a new install (and after "Erase all data") until it's finished or skipped through. Next saves that screen's answer; Skip moves on without saving it. Everything stays on the device, and nothing is sent anywhere (the browser test checks that no request leaves the app).

### Overload hint rules

In `js/progression.js`, comparing last session's ticked working sets with the rep range:

1. **All sets at the top of the range** → "Try +step kg" at the bottom of the range.
2. **2+ sets below the bottom** → "Repeat X kg", or "Drop to X − step" when ≥ 75% missed.
3. **Otherwise** → "Aim for +1 rep" at the same weight.

Each hint carries a `reason` listing last time's reps ("Last time: 8, 7, 7 reps.").

### Design

- **Direction.** Friendly, rounded cards with a bold, session-coloured header and big numerals. Icons on every nav item, action and category.
- **Themes.** Light (page `#F4F5FA`, cards `#FFFFFF`, text `#1E2140` / `#5F6485`, inputs `#F0F1F7`) and dark (page `#0F1226`, cards `#1B2040`, rows `#232A55`, text `#F2F3FA` / `#A3A9D0`). Settings → Appearance: System, Light or Dark.
  - The choice is saved on the device (`localStorage`) and in settings (so it's in backups).
  - A small inline script in `index.html` applies it before the stylesheet renders, so there's no flash.
  - It keeps the `theme-color` tags in sync with the active theme.
- **Accent.** Indigo `#5B5BD6` (light) and `#8C8CF0` (dark) for links, the selected tab, toggles and the timer when no session is running.
- **Dark done-tints** keep each hue (OKLCH, L ≈ 0.33) instead of mixing with the navy card. Legs is darker and Full body more saturated, so they're ΔE 11 apart (they were 2.7); every other pair is ≥ 5. `tests/theme.test.js` enforces both.
- **Session colours** theme the day screen: the header, progress bar, primary buttons, rest bar and done tint.
  - Each hue has a darker **block** shade for white text (all ≥ 4.8:1; Upper is `#1E7A57`, 5.3:1) and a **tint** per theme for done rows.
  - `tests/theme.test.js` checks every pair.
- **Contrast.** Body and secondary text are ≥ 4.5:1 on every surface in both themes. Marks and icons are ≥ 3:1 on the cards they sit on.
- **Type.** Plus Jakarta Sans 500/600/700 for everything, with tabular numerals for weights, reps and timers. The set count is 32 px, set values 20–22 px and the timer 64 px+.
- **Shape.** Cards 20 px, set rows 13 px, pills fully round. Tonal separation; one light shadow on floating things (rest bar, toasts, sheets).
- **Motion.** Only in response to taps: the check pops, the progress bar fills and the count bumps, cards collapse, and the timer ring moves. No page-load animation. Everything is off with `prefers-reduced-motion`.
- **Charts.**
  - Marks: a 2 px line in the session colour with a 12% area fill; 8 px markers with a surface ring.
  - Reading values: a crosshair and tooltip on tap, hover or arrow keys; a direct label on the latest value; a "View as table" toggle.
  - Never a dual axis.

### Branding

- **Name:** VANE. It's used in the manifest, the `<title>`, the Apple home-screen title, the Calendar brand row and Settings → About. Internal names (IndexedDB `workout-tracker`, the backup's `app` field and the cache prefix) are unchanged, so existing data and backups keep working.
- **Mark:** a weather-vane arrow crossing a plate ring, in the indigo accent on `#0F1226`. Original artwork, defined once in `js/brand.js`.
- **Icons:** `npm run icons` renders `icons/icon.svg`, the 192 and 512 icons, the maskable 512 (mark inside the 80 % safe circle) and the Apple touch icon with headless Chrome. It also syncs the inline splash in `index.html`, and a unit test fails if they drift.
- **Splash:** inline in `index.html`. It's visible from the first paint and removed as soon as the first screen renders; a 6 s timeout only matters if the app fails to start.
- **Manifest colours:** the light page colour, plus a `color_scheme_dark` block. That block is a proposed member that browsers which don't support it ignore; the runtime `theme-color` metas are what switch the status bar.
- **Home-screen preview:** `tests/browser/home-screen.html` shows the real icon files under iOS, circle and squircle masks.

### Body map rules

All in `js/volume.js`, shown in the app under "How it's counted":

- **What counts:** only ticked working sets (failure sets count; warm-ups, unticked and planned sets don't). Each set counts **1** for every main muscle group of its exercise and **0.5** for every group it also works.
- **Muscle groups:** 14 display groups. Lats, mid back and traps → Back; abductors and adductors → Adductors/Abductors. The library's own call is kept, e.g. its Deadlift is lower back first.
- **This week** runs from the first day of the week to today. **Last 4 weeks** is the four finished weeks before this one, ÷ 4.
- **Target:** 10 sets per week unless set in Settings.
  - **Status:** under 50% is **Undertrained** (↓); no sets is **No sets yet**.
  - **Fill:** 0 / ≤25% / ≤50% / <100% / ≥100% of target.
- **Ramp colours:** validated with `validate_palette.js --ordinal` in both themes: light `#A8A8EE → #3535A0` on white, dark `#4B50AE → #CECEFB` on the dark card. Every region also carries its name and number.
- **Planned this week** uses each day's own workout when it has exercises (its working sets), otherwise that day's template from the weekly plan.

### Consistency definitions

All in `js/consistency.js`, shown in the app under "How it's counted":

- **Planned:** a training day in the schedule version that applied on that date, from the first day of use, not Break and not a logged rest day.
- **Done:** a planned session completed on its own day, or covered by a workout on another day of the same week. A workout on an unplanned or Break day fills the week's earliest open planned session; each workout covers at most one.
- **Skipped:** a planned session in a finished week that nothing covered. Moving a session into the *next* week is a skip in the first week.
- **Extra:** a completed workout that covers nothing.
- **Weekly adherence** = done ÷ planned, pooled over the finished weeks in the range (each week is capped at 100% because a workout covers at most one session). **On the day** = done on the planned date ÷ planned.
- The running week is excluded and shown as "so far". Under 2 finished weeks with a plan there is no percentage.
- **Streaks:** a week hits when every planned session is done, or when it has at least `weeklyMin` workouts. Weeks with a target of zero (nothing planned, or the partial first week under a minimum) are neutral.

### Decisions

- **One session per day**, keyed by date. An import with two sessions on one date merges them.
- **Completed** means at least one ticked working set, Cardio minutes on a Cardio day, or a finished workout. Pre-filled numbers are only suggestions until ticked. Viewing a planned day saves nothing.
- **Streak** counts completed days back from today. Break, rest and unplanned days are skipped; a missed planned day ends it; today still planned doesn't break it.
- **Copy to another date** builds a planned day: same type and exercises, nothing ticked, weights from the latest time each exercise was logged before that date (or the source's own sets), and exercise notes kept.
- **Weigh-in marker:** a calendar cell is one 44 px tap target that opens the day. A second, smaller target inside it would be too small to hit reliably. So the day screen has a "Weigh-in 80.6 kg ›" row, and the calendar a "Log weigh-in" link, that open Progress → Body for that date.
- **Set row widths:**
  - At 360–399 px the ± buttons are 32 px wide and 46 px tall, so a value like "32.5 kg" fits on one row with the reps.
  - From 400 px they're 40 px wide.
  - Below 360 px the row splits onto two lines, so every button is 44 × 44.
  - Every other control is at least 44 px tall.
- **Toasts** only confirm things you did: import, export, share, copy, a weigh-in, finishing a workout, and deletes with Undo. Autosaves never toast; the day header already says "Saved".
  - One at a time, queued, in one place above the nav (and above the rest bar), each gone after 2 s.
  - Leaving a screen clears its toasts, so "Imported 12 workouts" only shows right after an import. A toast that announces the navigation itself ("Day cleared, Undo") survives that one move.
  - Every screen has bottom padding as tall as the toast slot, so the last row can always scroll clear of a toast.
  - The browser test refuses to take any screenshot while a toast covers text or a control.
- **"Nice, workout finished."** appears only when you tick the last open set (the day is then finished) or tap Finish workout. Unticking that last set straight away un-finishes it.
- **Clear or delete a day:** it asks first, then offers Undo.
- **Banners:** at most one at a time, the backup reminder first, then install.
- **Manifest colours are static.** The launch splash and the initial status bar use one value from the manifest (light `#F4F5FA`, accent `#5B5BD6`). Once the page loads, the `theme-color` tag follows the active theme: light and dark variants for System, and a single value when you pick Light or Dark.
- **Sticky progress:** the header block scrolls away with the page, and a slim bar in the session colour (name, sets, time) slides in at the top so progress stays visible.
- **Timer limits:** a web app can't fire alarms when suspended. The beep is scheduled on the audio clock while the app is open. After a lock, the bar shows "Go" and flashes instead of beeping late. Timer state lives in `localStorage` (device-local, short-lived).
- **Dates** are local calendar dates, never `toISOString()`. **Weights** accept `22,5`, are rounded to 0.01 kg, and `0` = bodyweight.
