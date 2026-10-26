# Shared health adapter and Android capability matrix (#59)

Design for keeping Apple HealthKit code isolated and planning Android (Health Connect) equivalents. Code lives in `src/lib/health-adapter/`; nothing under `src/lib/health/` was changed. No Android integration exists yet: every Android entry below is a plan, not a shipped feature.

## What was added

- `types.ts`: platform-neutral contracts (`HealthAdapter`). No HealthKit or Health Connect identifiers, permission strings or package names may appear here or in anything screens/server models import.
- `capabilities.ts`: `PlatformMatrix` type, the iOS and Android data tables, `resolveCapability` (matrix + live provider availability to a result) and `describeCapability` (user-facing wording).
- `ios.ts`: thin iOS wrapper over the existing `src/lib/health/*` exports. The only file that knows HealthKit identifiers.
- `fake-adapter.ts`, `contract-suite.ts`: in-memory adapter and the contract tests every adapter must pass (`runHealthAdapterContract`).

### Contract summary

- Capability result is always explicit: `supported`, `unsupported` (will not change on this device or build: `platform`, `os-version`, `work-profile`, `not-implemented`) or `unavailable` (the user can fix it: `provider-missing`, `provider-update-required`, `native-build-required`). Reads and writes return the same statuses instead of empty data or exceptions. A read can also return `permission-required` when the adapter knows access is missing.
- Permissions are per data type and per access kind: `read`, `write`, plus `history` and `background` (extra read grants that exist on Android). One kind per `requestPermissions` call. Social sharing is not a health permission and has no entry. `unknown` is a first-class state because iOS never reveals read grants.
- Reads: steps and sleep as local-date daily totals (days without data omitted, as today), weight as timestamped readings, workouts optional. A read that the platform cut short says so with `truncatedFrom`.
- Changes: pulled, not pushed (Health Connect cannot notify apps of new data). `readChanges` returns upserts, deleted ids and an opaque cursor; an unusable cursor returns `cursor-expired`.
- Writes carry our record id and a version; same or older version does nothing; `remove` touches only samples this app wrote. This mirrors the iOS export queue and maps to Health Connect `clientRecordId` and `clientRecordVersion`.
- Sample ids are `ios:<id>` / `android:<id>` and provenance has `origin` (`this-app` / `other-app` / `unknown`) so importers can skip our own exports.

## Capability matrix

"Platform" is what the store offers; "App" is what this repo has wired through today. Android values were checked against developer.android.com on 2026-10-26 (see Sources). Items marked (U) could not be verified and are recorded as unverified in the data table.

| Type | iOS read | iOS write | Android read | Android write |
| --- | --- | --- | --- | --- |
| Steps | App: yes | Platform yes (U vs Apple docs); App: no writer yet | Platform yes (`READ_STEPS`); App: no | Platform yes (`WRITE_STEPS`); App: no |
| Sleep | App: yes | Platform yes (U); App: no writer yet | Platform yes (`READ_SLEEP`, one session record with optional stages); App: no | Platform yes (`WRITE_SLEEP`); App: no |
| Weight | App: yes | Platform yes (write permission path exercised in `healthkit.test.ts`); App: no writer yet | Platform yes (`READ_WEIGHT`); App: no | Platform yes (`WRITE_WEIGHT`); App: no |
| Workouts | Platform yes (U); App: not yet (open PR #80) | Platform yes (U); App: not yet (open PR #82 area) | Platform yes (`READ_EXERCISE`, routes need `READ_EXERCISE_ROUTE`); App: no | Platform yes (`WRITE_EXERCISE`, `WRITE_EXERCISE_ROUTE`); App: no |
| Nutrition | Platform yes (U); App: no | Platform yes (U); App: no | Platform yes (`READ_NUTRITION`); App: no | Platform yes (`WRITE_NUTRITION`); App: no |
| Water | Platform yes (U); App: no | Platform yes (U); App: no | Platform yes (`READ_HYDRATION`, a separate record type from nutrition); App: no | Platform yes (`WRITE_HYDRATION`); App: no |

| Limit | iOS (as the app uses it) | Android Health Connect |
| --- | --- | --- |
| History window | No platform window. The app starts steps/sleep ~90 days back by its own choice; weight has no lower bound (`docs/health-sync.md`). | By default an app can read data from up to 30 days before any permission was first granted; older requests error. Extend with `READ_HEALTH_DATA_HISTORY`. On Android 14+ an app has no limit reading its own data; on 13 and lower the 30 days apply to everything. Deleting the app revokes the permission and resets the window to the new grant date. |
| Foreground / background | Foreground only: `background: false` in `app.config.ts`, no background delivery. | Foreground by default. Background reads need `READ_HEALTH_DATA_IN_BACKGROUND` (declared in the manifest, and the user must grant it) and `FEATURE_READ_HEALTH_DATA_IN_BACKGROUND` must report available. Background rate limits are stricter than foreground. |
| New-data notification | None used; reconcile on foreground. | None: apps cannot be notified. Check on each foreground and periodically while foregrounded. Changes tokens expire if unused for 30 days; use a re-read strategy. |
| Read access visibility | Cannot be inspected; empty is ambiguous. | Granted permissions can be listed, and users can revoke at any time, so check before every use. |
| Rate limits | n/a | Exist (periodic and daily call quotas for reads and for writes, plus write memory limits), numbers not published on the pages checked (U). Prefer aggregation and changes tokens over raw rereads. |
| Write batching | n/a | Chunk requests to at most 1000 records per write; write only new or changed data. |

## Minimum supported OS, device and provider

Android (verified):

- Android 9 (API 28) or higher with Google Play services. The client SDK supports Android 8 (API 26), but only Android 9+ can use Health Connect, so Android 8 users get `unsupported / os-version`.
- Android 14 (API 34) and higher: Health Connect is part of the system; it cannot be uninstalled. Android 13 and lower: the Health Connect app from Google Play must be installed and kept updated. Check with `HealthConnectClient.getSdkStatus` (`SDK_UNAVAILABLE`, `SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED`, `SDK_AVAILABLE`); map these to `unsupported`/`unavailable: provider-missing`/`provider-update-required`/`available`.
- Not supported in a work profile: permissions may appear grantable but the APIs are unusable and nothing is written. Surface as `unsupported / work-profile`.
- Use `getFeatureStatus` for newer features. System-module features stay unavailable on Android 13 and lower even with the app installed.
- Built-in step counting needs Android 14 and SDK extension 20 (extension 22 to look up the device data source). From the June 2026 Health Connect update, on-device steps are attributed to a device-specific synthetic package name instead of `android`; aggregate reads with no origin filter are unaffected, and any source breakdown must not hardcode it.
- The app must declare each data type it reads or writes in the Play Console, and declare matching permissions in the manifest, plus a privacy-policy rationale activity.
- Apps older than Android 14 need a native Health Connect React Native module; none has been chosen or evaluated here (U).

iOS: needs a native iPhone build; the module does not load in Expo Go, on Android or on web. Minimum iOS version is not set in `app.config.ts`; it comes from the React Native/Expo toolchain and was not confirmed (U).

## How missing capabilities surface in the UI

1. Ask the adapter, not the platform. Screens call `getCapability(type, access)` (or use `resolveCapability` with the matrix) and branch on the three statuses. They never inspect `Platform.OS` or native errors.
2. Say why, in plain words, using `describeCapability`: platform gap ("Health Connect doesn't support water on this device."), OS too old, work profile, not built yet ("... isn't available in this version of the app yet."), and for fixable cases the action ("Install / Update Health Connect to use sleep.").
3. Never show an empty chart as "0" or "no data" when the real answer is unsupported, unavailable, permission-required or `truncatedFrom`. Show the state instead, and for truncation say "Showing data since <date>; allow history access to see more" when the `history` grant is available.
4. Request `read`, `write`, `history` and `background` separately, only when the feature the user just turned on needs them; hide a feature whose capability is `unsupported` rather than offering a button that fails, and keep `unavailable` visible with its fix.
5. Treat permission `unknown` (iOS reads) as unknown: never label it connected or denied.
6. Do not require food or water work to start Android: nutrition and water stay `not-implemented` and simply do not appear.

## Sources (developer.android.com, retrieved 2026-10-26)

- Check availability: https://developer.android.com/health-and-fitness/health-connect/availability (Android 9 / API 28 with Play services, Android 14 framework vs Play app for 13 and lower, no work profile)
- Get started: https://developer.android.com/health-and-fitness/health-connect/get-started (SDK supports API 26, app needs API 28; `getSdkStatus`; 30-day default read window; permissions in manifest; Play Console data-type declaration)
- Read raw data: https://developer.android.com/health-and-fitness/health-connect/read-data (foreground and background reads, background permission, read restrictions for Android 14+ vs 13 and lower, history permission, on-device steps and the June 2026 attribution change)
- Check for feature availability: https://developer.android.com/health-and-fitness/health-connect/features/availability (feature flags for background read and history; system-module features unavailable on 13 and lower)
- Data types: https://developer.android.com/health-and-fitness/health-connect/data-types (read and write permissions for steps, sleep, weight, exercise, nutrition, hydration; additional background and history permissions)
- Synchronize data: https://developer.android.com/health-and-fitness/health-connect/sync-data (`clientRecordId` and `clientRecordVersion` upsert, changes tokens expire after 30 days unused, no new-data notification, deletions give id only, foreground reads, 1000 records per write)
- Plan to avoid rate limiting: https://developer.android.com/health-and-fitness/health-connect/rate-limiting (limits exist; no numbers; background stricter)
- Sleep sessions: https://developer.android.com/health-and-fitness/health-connect/features/sleep-sessions (session with stages, aggregate `SLEEP_DURATION_TOTAL`)
- `HealthConnectClient.Companion` reference (SDK status constants): https://developer.android.com/reference/androidx/health/connect/client/HealthConnectClient.Companion

## Verified vs unverified

Verified against the pages above: minimum Android 9; Android 14 framework vs Play app; work-profile exclusion; the six data types and their read/write permissions; 30-day default history and the history permission; own-data exception on Android 14+; foreground default and background permission plus feature check; no new-data notification; changes token 30-day expiry; upsert by client record id and version; 1000-record write chunks; on-device steps requirements and the June 2026 attribution change.

Unverified (recorded as such in the matrix or here, not guessed): exact rate-limit numbers; whether writes work while the app is in the background; which feature flags work with the Play-installed app on Android 13 and lower (the docs only say system-module features do not; use `getFeatureStatus` at runtime); minimum Health Connect app version for history/background reads; iOS minimum OS version; Apple-side confirmation for iOS write support of steps and sleep and for workouts, nutrition and water (the iOS column reflects the code in this repo and the HealthKit usage in `docs/health-sync.md`, not a re-check of Apple documentation); the choice and maturity of an Android React Native library.

## Deferred: needs edits to files other open PRs touch

Kept out of this change on purpose (open PRs #80 workout import, #81 manual Health export, #82 manual workout logging touch these):

- Routing existing screens and the sync coordinator through `HealthAdapter` instead of importing `src/lib/health/*` directly (`sync.tsx`, `coordinator.ts`, `healthkit.ts`, `changes.ts`, screens under `src/app` and `src/components`). The adapter exists; adoption is a follow-up.
- Neutral server naming: `daily_metrics.source` and `workouts.source` use `'healthkit'`, and `workouts.health_uuid` / `health_device_id` are Apple-shaped, in `supabase/migrations` and `src/lib/database.types.ts` and the `StepRow` type in `rules.ts`. Android rows need a neutral source value (for example `'health'`) via a migration plus regenerated types.
- `requestHealthAccess()` in `healthkit.ts` always requests all three read types in one sheet. The iOS wrapper calls the native request directly for per-type read access; once PR #81 settles, `healthkit.ts` could expose a per-metric version and the wrapper should use it.
- Wiring iOS writes and workout reads through the adapter: the wrapper reports `not-implemented` until `registerExportWriter` writers (#81, #82) and workout import (#80) land, then the iOS matrix `implemented` flags and wrapper methods should be updated together (`ios.test.ts` and `capabilities.test.ts` pin the current state and will fail to remind you).
- Wrapping the journal-based change feed (`changes.ts`) as `readChanges`.
