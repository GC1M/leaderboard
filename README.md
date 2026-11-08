<p align="center">
  <img src="assets/images/icon.png" alt="Leaderboard logo" width="96" />
</p>

# Leaderboard

Free social leaderboard app for friend groups: steps, workouts, weight goals, and screen time. Expo Router / React Native / TypeScript on Supabase.

## Prerequisites

- Node 22 (what CI uses, see `.github/workflows/ci.yml`).
- Docker, for the local Supabase stack.
- Supabase CLI 2.122.0 (what CI uses). Run it as `npx supabase@2.122.0 ...` or install that exact version.
- For iPhone Health testing: macOS with Xcode, a physical iPhone, and a paid Apple Developer team (see below).

## Quick start (no Apple Health)

```bash
npm ci
cp .env.example .env   # fill in the variables below
npm start              # press i for the iOS simulator, or a for Android
```

Web works without a native build. iOS date/time sheets use a local Expo module, so use a development build on the simulator (`npx expo prebuild --platform ios`, then `npx expo run:ios`); Expo Go cannot open those sheets. Apple Health additionally needs a signed physical-device build. See "Apple Health needs a native build" and [Phase 1/2 UX validation](docs/phase12-ux-validation.md).

Checks (all run in CI): `npm run typecheck`, `npm run lint`, `npm test`. The full pipeline (coverage floor, database and types checks, API and web smoke tests, audit and secrets scan) is described in `docs/ci.md`.

## Environment variables

Names only. Copy `.env.example` to `.env`; never commit values.

| Name | Purpose |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL (`http://localhost:54321` for the local stack). On a phone, use your Mac's LAN IP instead of `localhost` (`ipconfig getifaddr en0`); it changes when your network does |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (`npx supabase@2.122.0 status` prints the local one) |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Google sign-in. Leave empty to hide the Google button. The only Google value Android needs (see [docs/android-sign-in.md](docs/android-sign-in.md)) |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | Google sign-in on iOS |
| `GOOGLE_IOS_URL_SCHEME` | Build time only, read by `app.config.ts`. Reversed iOS client ID (`com.googleusercontent.apps.<id>`). The Google plugin is only added when it is set, so changing it needs a new native build. Android builds don't need it: without Firebase the plugin only edits the iOS Info.plist |

## Supabase

Config, migrations and pgTAP tests live in `supabase/`.

```bash
npx supabase@2.122.0 start                 # local stack (needs Docker)
npx supabase@2.122.0 db reset              # apply all migrations in supabase/migrations to the local DB
npx supabase@2.122.0 test db               # pgTAP tests in supabase/tests (also run in CI)
npx supabase@2.122.0 gen types typescript --local > src/lib/database.types.ts   # after any schema change
```

For a hosted project, link it (`npx supabase@2.122.0 link --project-ref <ref>`) and push migrations with `npx supabase@2.122.0 db push`.

Sign-in: email OTP and Google (when configured) are the supported methods for this milestone. Phone OTP also exists in the code (`src/app/sign-in.tsx`, `src/lib/phone.ts`); locally it uses the test numbers in `supabase/config.toml`, and real SMS needs a provider configured. Sign in with Apple is out of scope for this milestone, although the code and `app.config.ts` still contain it (`usesAppleSignIn`, `expo-apple-authentication`). Apple Health permission is separate from sign-in and is always required for the iOS health features.

### Food search key (issue #45)

Food search calls USDA FoodData Central from the `food-search` edge function (`supabase/functions/food-search/`). The FDC key lives only on the server as the function secret `FDC_API_KEY`. It is never in the app bundle, `.env`, or git.

1. Get a free key at https://fdc.nal.usda.gov/api-key-signup (1,000 requests per hour per key).
2. Local: copy `supabase/functions/.env.example` to `supabase/functions/.env` (gitignored), set `FDC_API_KEY=`, then run `npx supabase@2.122.0 functions serve`. This needs Docker and the local stack (`supabase start`) to be running.
3. Hosted: `npx supabase@2.122.0 secrets set FDC_API_KEY=<key>` and `npx supabase@2.122.0 functions deploy food-search`.

Without the key the function answers `not_configured`; the app then shows saved foods and still lets you add a custom food. Each search makes two FDC calls (search, then details for the portions), so each user is limited to 30 searches per rolling hour and all users together to 400 (`food_search_allow`, table `food_search_log`); over that the function answers `rate_limited`. If FDC fails, the function returns matching foods already cached, flagged `fromCache`.

## Apple Health needs a native build

Expo Go is not enough. It cannot load the HealthKit module or SQLCipher, so Health shows as unavailable there (`src/lib/health/healthkit.ts`). A Health build needs:

- the HealthKit entitlement and usage strings, added by the `@kingstinct/react-native-healthkit` plugin in `app.config.ts`
- `expo-sqlite` with `useSQLCipher: true` (also in `app.config.ts`). The on-device Health journal refuses to run on an unencrypted build (`src/lib/health/journal.ios.ts`), so an old dev build must be rebuilt.

See `docs/health-sync.md` for how import and reconciliation work.

### Apple signing prerequisites

- An Apple team. A free personal team can sign HealthKit for a development build (builds expire after 7 days), but not Sign in with Apple: delete `com.apple.developer.applesignin` from the generated `ios/Leaderboard/Leaderboard.entitlements` first. TestFlight needs the paid Apple Developer Program.
- App ID with bundle id `com.shivamlalakiya.leaderboard` (from `app.config.ts`) and the HealthKit capability enabled.
- The iPhone in Developer Mode, registered to the team.

### Build and run on a device

`eas.json` has build profiles, but they are only set up for Android so far (see [Android builds and releases](docs/android-release.md)). For iOS, use a local build:

```bash
npx expo run:ios --device
```

This generates `ios/` (prebuild), signs with your team (pick it in Xcode on first run) and installs a development build. Then `npm start` and open the app on the phone. If you move to EAS later, create the config then (`eas build:configure`); nothing here depends on it.

### Tester installation via TestFlight (still to do by the owner)

None of this has been done or verified yet.

1. Create the app record in App Store Connect for `com.shivamlalakiya.leaderboard`.
2. Produce a release build (archive from Xcode after `npx expo run:ios --configuration Release --device`, or set up EAS).
3. Upload to App Store Connect and wait for processing.
4. Add testers (internal testers need App Store Connect roles; external testers need a beta review) and send invites.
5. Testers install TestFlight, accept the invite, install the build, then sign in and connect Apple Health in the app.
6. Confirm the HealthKit permission sheet appears and steps, sleep and weight import on a tester device.

## Device verification checklist (owner, issue #27)

Run on a signed physical-device build with real Health data.

- [ ] Request and read steps, sleep and weight
- [ ] Foreground refresh picks up new Health data
- [ ] Offline then retry: a failed sync recovers when back online
- [ ] Permission changes: deny/allow each metric in Settings > Health, app shows the right state
- [ ] Sign-out and account switch: no Health data or sync carries over
- [ ] Account deletion
- [ ] Delete imported Health data
- [ ] Values match the same day/window in Apple Health; investigate and document any differences

## Phase 2 regression checklist (workouts, issue #37)

Run on a signed physical-device build with real Health data, after the Phase 1 checklist above. CI covers logic, RLS and the bundle; these steps cover what only a device can show.

**Logging and templates**
- [ ] Log a strength workout (sets, reps, load) and a timed or distance activity; each saves and appears in My Workouts with the right totals
- [ ] Switch kg/lb mid-entry: the lifted weight does not change, only its label
- [ ] Force-quit mid-entry, reopen: the draft is offered and restores what was typed
- [ ] Edit and delete a manual workout; the weekly totals update
- [ ] Create, edit, duplicate and delete a template; applying it twice to different days gives two independent workouts, and editing the template afterwards leaves both unchanged

**Import**
- [ ] Workouts recorded by Apple Watch or another app appear once; re-syncing, correcting or deleting them in Health is reflected, and missing distance/energy shows as not recorded
- [ ] A workout recorded by the watch and one by the phone at the same time both appear (documented dedup rule)
- [ ] Deny workout permission only: steps, sleep and weight still sync

**Export to Health** (details in docs/workout-export.md)
- [ ] Turn on "Also save to Apple Health" for a workout: it appears in Health with the right type, times and duration, and with no heart rate, route or energy
- [ ] Edit it (including changing the activity type): Health shows one workout, updated; delete it here: it disappears from Health
- [ ] Deny write permission, save, then allow it: the entry retries and exports; the entry was kept locally throughout
- [ ] Next import does not add the exported workout back as a second session
- [ ] Manual weight, sleep and steps export with the right values and source; steps are not added on top of an already synced daily total

**Import from other apps** (issue #120)
- [ ] Export a CSV from Strong, Hevy, Fitbod and JEFIT; share it to Leaderboard from the share sheet, and also pick it with Import from Another App: both open the preview
- [ ] The preview shows the app, workout count, date range and set count; files without units ask for kg/lb and km/mi; new exercise names and skipped rows are listed
- [ ] After import every workout, exercise and set is there in order, warm-up/drop/failure sets are noted on the exercise, and the source reads as the app's name
- [ ] Importing the same file again, or a newer export that overlaps it, adds nothing; an imported workout you edited keeps the edit
- [ ] A session the app also wrote to Apple Health is counted once (the detailed one) in history, weekly totals and group totals
- [ ] An unrelated CSV is rejected with a clear message and saves nothing; imported workouts are private until shared and start with "Also save to Apple Health" off

**Sharing and privacy**
- [ ] Group Info: Workouts is off by default and after joining; turning it on shows only weekly count and total time to group members; turning it off removes it immediately
- [ ] Leaving or being removed from a group stops sharing; rejoining does not turn it back on
- [ ] The privacy page matches what the app reads, saves to Health, stores and shares
- [ ] Account deletion removes workouts, templates and exported-record mappings; sign-out then another account shows none of the first account's data

## Phase 4 regression checklist (food, issue #50)

Run on a signed physical-device build with Apple Health, after the Phase 1 and 2 checklists. CI covers the arithmetic, the edge function, RLS and the API; the audit is in `docs/food/validation.md`. The Health write checks are in `docs/food/health-export.md` and `docs/food/validation.md`.

**Search and log**
- [ ] Search "banana": USDA foods list with the USDA attribution and the estimate note; open one, log 150 g and then 1 portion; the calories match the per-100 g value scaled by the grams
- [ ] A nutrient the food does not report shows "Unknown", not 0, on the food screen and in the diary
- [ ] Offline (airplane mode), search: saved foods show with "Showing saved results" or a clear error, and Add a Custom Food still works
- [ ] Add a custom food with only calories; log it; the diary tags it Custom and the other nutrients are Unknown

**Diary**
- [ ] Edit an entry's amount: the nutrients scale from that entry, and a later edit of the food does not change it. Change its meal and time: it moves to the right meal and day
- [ ] Mark an entry as an estimate: the Estimate tag shows
- [ ] Delete an entry while offline: it asks for a connection and nothing is lost. Log offline: the entry shows Not synced, and syncs once online, exactly once
- [ ] A day with no entries says "No food logged", never 0 kcal. A day with an unknown nutrient shows "At least" totals
- [ ] History 7, 30 and 90 days: days with food show totals, days without are skipped

**Recipes**
- [ ] Create a recipe with a cooked weight and 4 servings; per serving and per 100 g are right, and an ingredient missing a nutrient is flagged
- [ ] Log 1 serving, then edit the recipe: the diary entry does not change. Logging by grams works only when a cooked weight was entered
- [ ] A reusable meal (1 serving, no cooked weight) logs as a whole

**Sharing and deletion**
- [ ] Group Info: Food is off after joining; turning it on shows only daily totals to members; turning it off hides it at once. The owner cannot turn it on for you
- [ ] Leaving a group stops sharing; rejoining does not turn it back on
- [ ] Profile, Delete Food History: entries, recipes and custom foods are gone, sharing choices stay, and the group shows no food
- [ ] Delete Account: food, recipes and shares are gone; another account on the device shows none of it

**Apple Health on and off**
- [ ] With "Save food to Apple Health" on, a logged food appears in Health with the right units; edit and delete update it (steps in `docs/food/health-export.md`)
- [ ] Turn it off, choose Keep, then On again: nothing is written twice. Turn it off, choose Remove: the samples go
- [ ] Delete Food History and Delete Account offer Remove from Health or Keep in Health, and do what they say

## Phase 6 regression checklist (water, issue #58)

Run on a signed physical-device build with Apple Health, after the Phase 1, 2 and 4 checklists. CI covers the conversions, the pending queue, RLS and the group summaries. The data rules are in `docs/water.md`; the Health write steps are in `docs/water-export.md`.

**Logging**
- [ ] Log 250 mL and 8 fl oz with "Save water to Apple Health" on: Health shows the same amounts (8 fl oz is 236.6 mL)
- [ ] Each quick-add button logs once, with the time now; a custom amount above 5000 mL or 0 shows an error and logs nothing
- [ ] Edit an entry's amount and time, then delete another: Health shows the change once, with no duplicate or leftover sample
- [ ] A day with no entries says "No water logged", never 0 mL. A target shows only after you set one, and Clear Target removes it

**Health permissions**
- [ ] Deny water write, log water: the entries stay here and show a retry. Allow water in Health and retry: each is saved once
- [ ] Deny water read only: steps, sleep, weight and workouts still sync, and Water says access may be limited
- [ ] Log water in another app (for example WaterMinder): it appears once, labelled "From Apple Health · WaterMinder", and is read-only
- [ ] Change and then delete that sample in Health: the day updates after the next import
- [ ] Water this app saved to Health is not imported back as a second entry

**Days, offline and history**
- [ ] Log water late in the evening, then change the phone's time zone: the entry stays on the day it was drunk
- [ ] Log offline (airplane mode): the entry shows Not synced, then syncs once online, exactly once
- [ ] History 7, 30 and 90 days: days with water show totals, days without are gaps, the target line shows only with a target
- [ ] Compare several day totals with the Health app's water totals for the same days

**Sharing and deletion**
- [ ] Group Info: Water is off after joining. Turn it on: a group-mate sees only your daily total. Turn it off: they see Not shared on their next load
- [ ] Sign out and sign in as another account: no water, pending entries or target from the first account show
- [ ] Profile, Delete Water History: entries and target are gone, sharing choices stay, the group shows no water. Keep in Health and Remove from Health do what they say
- [ ] Delete Account: water is gone, and the Remove from Health choice removes the water this app saved

## Competition rules (version 1, issue #43)

These are the defaults the server enforces (`supabase/migrations/20261107*_competition_*.sql`). The app shows the same rules on the create, detail and standings screens.

- Steps only. Weight, sleep and food are never ranked; workout metrics are not enabled yet.
- 1 to 90 whole calendar days in one timezone chosen at creation. Every participant must use that timezone; anyone else is shown as a timezone mismatch with no score.
- Creating a competition does not enroll anyone. Members opt in before the start, and must keep step sharing on for the group.
- Apple Health entries count; manual entries are excluded unless the creator allowed them at creation. Rules cannot be edited after creation.
- Missing data is unranked, recorded zeroes count, and ties share a rank.
- Leaving the competition, leaving the group, turning off sharing or deleting the account removes the score from live and final standings.
- Results stay provisional until a participant, the creator or the group owner finalizes them, at least 24 hours after the end. Finalizing freezes a server snapshot; later edits do not change it.
- The creator or group owner can cancel before the end, or remove a participant until results are finalized, with a reason that is kept in the audit log.
- Health-labelled steps, sleep, weight and workouts reach the server only through the Health import functions; direct writes must be manual. This stops a client from relabelling manual entries as Health, but the import still trusts the values the phone read. Step days over 100,000 are flagged for review in the participant's contributions.

## Competition checklist (issue #43)

SQL tests cover the lifecycle, scoring, permissions and boundaries (`supabase/tests/competition_*.test.sql`). On a device:

- [ ] Create a competition, share its invite, open the link on a second account: it lands on the group join screen and says joining the group does not enroll
- [ ] Join the group, then the competition, before the start
- [ ] During the competition, standings show both participants, refresh after a step sync, and hide a participant who turns off step sharing
- [ ] After the end plus 24 hours, finalize; the result stays the same after editing a step entry
