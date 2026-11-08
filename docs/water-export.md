# Water to Apple Health (#56)

Builds on the shared export queue from #34 (see "Export to Apple Health" in `health-sync.md`) and follows the food export (`food/health-export.md`), simpler: water is one quantity sample, not a correlation. Writer: `src/lib/health/water-export.ts`. Switch and wiring: `src/components/water/WaterExportOption.tsx`, shown on the water screen.

## What is exported

When the user turns on "Save water to Apple Health", each manual `water_entries` row is saved as one `HKQuantityTypeIdentifierDietaryWater` sample in mL (the stored unit, so nothing is converted; fl oz is display only), dated at `consumed_at` for both start and end.

Rules:

- Only manual rows (`source = 'manual'`). Water imported from Health (`source = 'healthkit'`) is never written back. Every sample carries `LeaderboardRecordId = water:<entry id>`, which the Health importer skips.
- Only entries the server has, from the last 90 days (`EXPORT_DAYS`, by `local_date`). An entry still waiting to sync has no id and is exported once it syncs.

## Permissions

Turning the switch on asks Health for write access to water only (`toShare`, never read). If it is not allowed the switch stays off and says how to allow it. If it is revoked later, queued entries fail with reason `permission` and stay on the phone; the option says they are kept and waiting, and Retry shows the Health sheet again.

## Sync, edits and deletes

- `recordId` is `water_entries.id`, which never changes. The queue version is `updated_at` in ms, so an edit is queued again at a higher version.
- The sample's sync version is the queue's attempt version (`attemptVersions`), above every earlier attempt, so a retry or an edit replaces the old sample through `HKMetadataKeySyncIdentifier = leaderboard:water:<id>` instead of adding a copy.
- `sync()` runs when the switch turns on and after the water screen loads or logs. It queues rows not queued at their version and a delete for exported entries the server no longer has (checked by id, so a row outside the window is not deleted).
- Delete: the screen passes `choice.deleted` to `removeWater`, which queues the Health delete after the server delete, with a version above every earlier one. It removes only our sample by record key.
- Switch off, Delete Water History and account deletion use `settleWaterExport`: Keep forgets every water save without writing; Remove queues a delete for each and fails if any is still queued, so an account is not deleted while its Health copies remain. This applies to this device only.

## Not verifiable off a device

`saveQuantitySample` and `deleteObjects` cannot run in jest. `water-export.test.ts` drives the real queue and writer against an in-memory HealthKit stand-in that honours sync versions.

## Physical iPhone checklist (PENDING, not yet done)

- [ ] Turn the switch on: the Health sheet lists only Water. Log 250 mL: Health shows 250 mL from this app at that time.
- [ ] Edit the amount: Health shows the new value and no leftover sample.
- [ ] Force-quit mid-sync and reopen: still one sample.
- [ ] Delete the entry: its sample is gone; other apps' water is untouched.
- [ ] Revoke water in Settings, log, then re-allow and Retry: it exports once.
- [ ] After the next Health import, the exported water does not come back as imported.
