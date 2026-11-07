# Workouts to Apple Health (#35)

Builds on the shared export queue from #34 (see "Export to Apple Health" in `health-sync.md`). Writer and mapping live in `src/lib/health/workout-export.ts`; the switch is `src/components/workouts/WorkoutExportOption.tsx`, hooked into `WorkoutEditor` and registered from `sync.tsx` so a queued workout retries after restart.

## What is exported

A workout created in this app (`source = 'manual'`) is saved as one Health workout (`HKWorkout`) through `saveWorkoutSample`, only when the user turns on "Also save to Apple Health" for it.

- Activity type: the typed activity name mapped to `HKWorkoutActivityType` (same names the Health importer shows, plus a few aliases such as Strength = traditional strength training, Run, Walk, Bike). Anything unrecognised is exported as Other; the app keeps the name as typed.
- Time: the real start and end. Health derives the duration from them. The logger always sets end = start + duration.
- Distance and energy: only a workout-level `distance_m` or `energy_kcal` that was actually recorded, in meters and kcal. The logger records neither today (per-set distance stays on the set, and calories are not tracked), so nothing is exported for them. Missing or zero is omitted.
- Never written: heart rate, routes, energy estimates, or any associated quantity sample (the sample list is always empty), and imported (`healthkit`-source) workouts.

## What stays in the app

The exercise catalog, templates, exercises, sets, reps, load, per-set time and distance, and notes are not sent to Health. HealthKit has no model for them, and a workout summary is all the Health app and other apps will show: activity, date, start/end, duration, and distance/energy when present. A strength session therefore appears in Health as "Traditional Strength Training, 45 min" without its lifts. Other apps that read workouts see the same summary. This is not full interoperability.

## Permissions

Write access is requested only for the workout type (`HKWorkoutTypeIdentifier`, `toShare` only) when the user turns the switch on, never together with read access, the connect consent or group sharing. If Health does not grant it, the switch stays off and says how to allow it. A queued workout whose permission is later revoked stays `failed` with reason `permission`, keeps the local workout, and exports after the user allows it (Retry on the edit screen).

## Retries, edits, deletes

Uses the #34 queue and `health_exports` mapping unchanged: kind `workout`, recordId `workouts.id`, one entry per workout, newest version wins.

- Retry: a failed write retries on launch, foreground and the next enqueue with the same sync identifier and version, so it never duplicates.
- Edit: saving an edited workout re-enqueues with a higher version; HealthKit replaces the sample with the same `HKMetadataKeySyncIdentifier`. The switch starts on for a workout this device already exported; turning it off and saving removes it from Health.
- Delete: deleting the workout enqueues a delete, which removes the Health workout by our `LeaderboardRecordId` metadata and clears the mapping. HealthKit only lets an app delete its own samples.
- Limit: a delete is only queued for workouts this device has an export entry for. A workout exported from another device, or after the switch was off, is removed in the Health app. If the app is killed after the workout row is deleted but before the delete is queued, the Health workout stays; remove it in Health.

## No re-import (#30, PR #80)

Every exported sample carries `LeaderboardRecordId = workout:<workouts.id>` (`exportMetadata`). PR #80's `workoutPage` drops samples where `isOwnExport(metadata)` is true, and its own test uses the `workout:` prefix, so an exported workout is not imported as a new `healthkit` session once #80 merges. Merge order does not matter: before #80 there is no importer, and after it the key is already on every exported workout. No file owned by #80 is touched. The server mapping also holds the Health sample uuid (`health_exports.sample_uuid`); #80 does not read it, so the metadata key is the only dedupe today. Deleting our workout in Health is reported to the importer as a tombstone for a uuid it never imported, which its journal ignores.

## Not verifiable off a device

Native `saveWorkoutSample` and `deleteObjects` for workouts cannot run in jest or Expo Go; tests mock HealthKit and check the arguments. On a physical iPhone, check that: the workout appears in Health with the right type, times and duration and without heart rate, route or energy; an edit replaces rather than adds (including changing the activity type); a delete removes it; a denied permission keeps the workout and retries after allowing; and, with #80 merged, the next import does not add a duplicate.

## Follow-ups after #80 and #81 merge

- Replace the activity table in `workout-export.ts` with an inverse of `activityName` from `workouts.ts`.
- Move the switch onto #81's `ExportOption`/`useExportChoice` once it accepts a workout type; the remembered-choice key (`health-export-<user>-workout`) already matches its scheme.
- Add a link to this page from `health-sync.md`.
