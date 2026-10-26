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

Expo Go and simulators are fine for everything except Apple Health. See "Apple Health needs a native build".

Checks (all run in CI): `npm run typecheck`, `npm run lint`, `npm test`. The full pipeline (coverage floor, database and types checks, API and web smoke tests, audit and secrets scan) is described in `docs/ci.md`.

## Environment variables

Names only. Copy `.env.example` to `.env`; never commit values.

| Name | Purpose |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL (`http://localhost:54321` for the local stack). On a phone, use your Mac's LAN IP instead of `localhost` (`ipconfig getifaddr en0`); it changes when your network does |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (`npx supabase@2.122.0 status` prints the local one) |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Google sign-in. Leave empty to hide the Google button |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | Google sign-in on iOS |
| `GOOGLE_IOS_URL_SCHEME` | Build time only, read by `app.config.ts`. Reversed iOS client ID (`com.googleusercontent.apps.<id>`). The Google plugin is only added when it is set, so changing it needs a new native build |

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

## Apple Health needs a native build

Expo Go is not enough. It cannot load the HealthKit module or SQLCipher, so Health shows as unavailable there (`src/lib/health/healthkit.ts`). A Health build needs:

- the HealthKit entitlement and usage strings, added by the `@kingstinct/react-native-healthkit` plugin in `app.config.ts`
- `expo-sqlite` with `useSQLCipher: true` (also in `app.config.ts`). The on-device Health journal refuses to run on an unencrypted build (`src/lib/health/journal.ios.ts`), so an old dev build must be rebuilt.

See `docs/health-sync.md` for how import and reconciliation work.

### Apple signing prerequisites

- A paid Apple Developer Program team. A free personal team cannot use the HealthKit capability or TestFlight.
- App ID with bundle id `com.shivamlalakiya.leaderboard` (from `app.config.ts`) and the HealthKit capability enabled.
- The iPhone in Developer Mode, registered to the team.

### Build and run on a device

There is no `eas.json` in this repo yet, so there is no EAS build config. Use a local build:

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

**Sharing and privacy**
- [ ] Group Info: Workouts is off by default and after joining; turning it on shows only weekly count and total time to group members; turning it off removes it immediately
- [ ] Leaving or being removed from a group stops sharing; rejoining does not turn it back on
- [ ] The privacy page matches what the app reads, saves to Health, stores and shares
- [ ] Account deletion removes workouts, templates and exported-record mappings; sign-out then another account shows none of the first account's data
