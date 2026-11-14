# Phases 1 to 5 device test run

One sitting, about 3 hours, on a signed development build on a physical iPhone with Apple Health. Automated checks (Jest, pgTAP, API and web smoke) already cover logic, RLS and the API; this list is only what a device can show. It gathers the checklists in `README.md`, `docs/phase12-ux-validation.md`, `docs/food/health-export.md`, `docs/food/validation.md` and `docs/food/photo-assist.md` in an order that avoids redoing setup. Those files keep the detail behind each line.

Record each result as pass, fail (with what you saw) or skipped, then tick the matching boxes on the GitHub issue named in each heading. Destructive steps (sign-out, Delete Food History, Delete Account) are last on purpose.

## 0. Setup (about 20 minutes)

- [ ] `docker info` works, then `npx supabase@2.122.0 start` (local backend, Mailpit at `http://localhost:54324` for email codes).
- [ ] Fresh build from `develop` installed on the iPhone (free-team builds expire after 7 days; delete `com.apple.developer.applesignin` from `ios/Leaderboard/Leaderboard.entitlements` before building). Metro on port 8084: `npx expo start --dev-client --port 8084`.
- [ ] Account A on the iPhone. Account B on a simulator or the web build (`npx expo start --web`), so invites, sharing and standings can be checked from the other side. Put both in one group.
- [ ] In the Health app, make sure there are a few days of steps, at least one night of sleep, a weight entry and at least one Apple Watch or phone workout. Add one manual weight in Health for today so the import has something fresh.
- [ ] Have ready: five US nutrition labels, three EU labels (one in kJ only if possible), one glossy or curved pack, a printed or on-screen restaurant menu, and CSV exports from Strong, Hevy, Fitbod and JEFIT if you use them (AirDrop or Files).

## 1. Apple Health reads (#27)

- [ ] Connect Apple Health: the permission sheet lists steps, sleep, weight and workouts. Allow all. Steps, sleep and weight import.
- [ ] For three days, compare steps, sleep duration and weight with the same day in the Health app. Note any difference and its cause (time zone, overlapping sources, rounding) on #27.
- [ ] Add a weight in Health, bring the app to the foreground: it appears without a manual refresh.
- [ ] Airplane mode, pull to refresh: a clear failure. Turn it off: the sync recovers by itself or on retry, with nothing doubled.
- [ ] Settings, Health, Leaderboard: turn off sleep only. The app shows sleep as not allowed and steps and weight keep syncing. Turn it back on.
- [ ] Edit or delete a sample in Health: the app reflects it on the next sync.

## 2. Navigation and entry (#122)

- [ ] Weight entry with the on-screen keyboard: `75.`, `75.5`, `75,5`, paste, select and replace. Done closes every numeric keyboard and Save stays above it.
- [ ] Native date and time sheets open, cancel, and save a changed value.
- [ ] Edit and delete a manual steps, sleep and weight record. Imported records are read-only. Leaving a dirty editor offers Keep Editing, Save Draft and Discard Changes; a saved draft comes back after relaunch.
- [ ] Switch tabs mid-edit and come back: the draft is still there. Reselecting a tab returns to its root and protects unsaved changes.
- [ ] Large Text (accessibility sizes), VoiceOver on one screen per tab, and dark mode: nothing cut off, the last history row and Save buttons clear the tab bar.

## 3. Workouts (#35, #37, #120)

- [ ] Log a strength workout (sets, reps, load) and a cardio one. Totals in My Workouts are right. Switching kg/lb mid-entry changes only the label.
- [ ] Force-quit mid-entry, reopen: the draft is offered and restores what was typed.
- [ ] Template: create, edit, duplicate, delete. Applying it twice gives two independent workouts that a later template edit does not change.
- [ ] Imported Health workouts appear once. A watch and a phone workout at the same time both appear. Missing distance or energy shows as not recorded.
- [ ] Turn on "Also save to Apple Health" for a manual workout: Health shows the right type, start, end and duration, and no heart rate, route or energy.
- [ ] Edit it (including the activity type): Health shows one updated workout. Delete it: it leaves Health. The next import does not bring it back as a second session.
- [ ] Deny workout write permission, save, then allow it: the entry exports on retry and was kept in the app throughout.
- [ ] Manual weight, sleep and steps export with the right values; steps are not added on top of the synced daily total.
- [ ] CSV import (#120), for each app you have: share the export to Leaderboard and also use Import from Another App. The preview shows app, workout count, date range and sets, and asks for units when the file has none. After import every set is there in order, warm-up, drop and failure sets are noted, re-importing adds nothing, and a session the app also wrote to Health counts once.
- [ ] An unrelated CSV is rejected and saves nothing. Imported workouts start private, with "Also save to Apple Health" off.
- [ ] Group Info: Workouts sharing is off after joining; turned on, account B sees only the weekly count and total time; turned off, it disappears at once.

## 4. Food (#48, #50)

- [ ] Search "banana": USDA results show the USDA FoodData Central attribution and the estimate note. Log 150 g, then 1 portion: calories match the per-100 g value scaled.
- [ ] A nutrient the food does not report shows Unknown, not 0, on the food screen and in the diary. A day with an unknown nutrient shows "At least" totals; a day with nothing says "No food logged".
- [ ] Custom food with only calories: logs, tagged Custom, other nutrients Unknown. A custom food and a recipe entry show no USDA attribution.
- [ ] Edit an entry's amount, meal and time: it scales and moves. Editing the food afterwards does not change the entry.
- [ ] Offline: search shows saved foods or a clear error. Log offline: Not synced, then syncs once when back online. Delete offline: asks for a connection, nothing lost.
- [ ] Recipe with a cooked weight and 4 servings: per serving and per 100 g are right, a missing ingredient nutrient is flagged. Editing the recipe after logging leaves the diary entry unchanged.
- [ ] History 7, 30 and 90 days: days with food show totals, empty days are skipped.
- [ ] Group Info: Food sharing off after joining; on, account B sees only daily totals; off hides it at once. The owner cannot turn it on for you.
- [ ] Every food screen says values are estimates, not medical advice.

**Food to Apple Health** (detail in `docs/food/health-export.md`)

- [ ] Turn on "Save food to Apple Health": the sheet lists eight nutrient types. Allow some, deny others, log a food: only the allowed ones appear in Health.
- [ ] Units in Health: calories in kcal, grams for macros, sodium in mg (410 mg shows as 410 mg). The food name is on the sample and the source is this app.
- [ ] A custom food with only calories writes only calories. A recorded 0 g shows as 0.
- [ ] Edit the amount: Health shows the new values and no leftover samples. Force-quit mid-sync and reopen: still one set.
- [ ] Allow a nutrient you denied: the next diary load rewrites the entry with it. A food older than 90 days is not exported.
- [ ] Revoke one nutrient after exporting, then edit the entry: a permission failure, one copy, not two. Re-allow and retry to finish.
- [ ] Delete the entry: all its samples leave Health. After the next Health import, nothing exported comes back as imported data.
- [ ] Switch off, choose Keep, switch on again: nothing written twice. Switch off, choose Remove: the samples go.

## 5. Food photo scanning (#51 to #54)

- [ ] Camera and photo library prompts show their purpose strings. Deny camera: a message shows and Choose Photo still works.
- [ ] Five US and three EU labels: after review every value matches the label, the basis (per serving or per 100 g) and serving weight are right, and the saved food's per 100 g values are correct. Note any misread on #54.
- [ ] Glossy or curved pack and a blurry photo: unreadable values are blank with a note, never wrong numbers.
- [ ] Menu photo: dishes are listed; picking one opens search, and the log screen starts marked as an estimate with the menu note. Going back saves nothing.
- [ ] Cancel while reading: back to the start, nothing saved. Try Again after a failure works.
- [ ] After a scan, download the app container in Xcode (Devices and Simulators): `Library/Caches/ImagePicker` holds no photo.
- [ ] A scanned food logged with Health export on exports once. Large Text and VoiceOver read the review screen in full.

## 6. Competitions (#43)

- [ ] Account A creates a competition that starts tomorrow and shares the invite. Account B opens the link: it lands on the group join screen and says joining the group does not enroll.
- [ ] Both join the competition before the start. The detail screen's Competition Rules section matches `docs/competitions/rules-v1.md`.
- [ ] To see live and final standings in one sitting, shift its dates on the local database only (never on a hosted project), then reopen the app:

  ```sql
  -- psql postgresql://postgres:postgres@127.0.0.1:54322/postgres
  alter table public.competitions disable trigger competitions_validate; -- dates are immutable otherwise
  update public.competitions set starts_at = starts_at - interval '3 days', ends_at = ends_at - interval '3 days' where id = '<competition id>';
  alter table public.competitions enable trigger competitions_validate;
  ```

- [ ] During it: standings show both participants, refresh after a step sync, and hide a participant who turns off step sharing.
- [ ] Shift it so the end is more than 24 hours ago, finalize, then edit a step entry: the final result does not change.

## 7. Account switching and deletion (#27, #37, #50, last)

- [ ] Sign out of A and sign in as B on the iPhone: none of A's Health data, workouts, food, drafts or routes appear, and no sync runs for A.
- [ ] Back on A, Profile, Your Data, Delete Imported Health Data: imported records go, manual ones stay, and nothing re-imports until Apple Health is reconnected.
- [ ] Delete Food History with Health export on: Delete and Remove from Health leaves no food samples from this app in Health; Keep in Health leaves them. Offline, it asks for a connection and removes nothing.
- [ ] Delete Account with Remove from Health: Health samples go first, then the account. Afterwards another account on the device shows none of A's data, and Health keeps A's samples only if Keep was chosen.

## After the run

Comment on each issue with the date, iOS version, build commit and any failures, then tick the boxes that passed. Failures get their own issue.
