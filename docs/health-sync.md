# Health import and reconciliation

Health reads run only on a native iPhone build, after the account explicitly connects this device. HealthKit cannot disclose whether read permission is granted: empty results are not evidence of deletion.

## Normalization

- Sleep: union all sources' asleep intervals, excluding in-bed and awake categories. Join asleep intervals separated by up to 90 minutes into a session, attribute it to its final asleep end's local date, and include naps. This explicit policy prevents overlap double-counting but does not claim to match Apple's private source-priority rules when trackers disagree. The date is computed in the current device timezone; changing timezone can move a session to another date on the next recomputation. Test interrupted nights, naps, multiple sources and DST on a device.
- Weight: canonical kg at original observation time. Preserve multiple daily readings. For exact-time collisions between Health sources, the greatest sample UUID wins deterministically, matching the existing one-row-per-time-and-source schema; manual measurements remain separate. Display conversion never changes stored precision. The latest-reading query has no recent-history lower bound.
- Steps: use HealthKit statistics for affected calendar days, not sums of raw samples from overlapping sources. Never cap valid Health totals.

- Workouts: each Health workout UUID is one `workouts` row (`source = 'healthkit'`). The same UUID is an upsert, so repeats, retries and corrections replace the row (including cleared distance/energy). Sessions with different UUIDs are separate samples and are all kept, even when they overlap in time (for example a watch and a phone both recording a run); the app does not guess which one is "real". Workouts this app exported to Health (they carry `LeaderboardRecordId`, see `isOwnExport`) are skipped, so an export never comes back as a duplicate. Daily steps are never converted into workouts and workouts never feed step totals. Duration is kept (falling back to end minus start if Health omits it); distance and energy are kept only when recorded, so missing stays null and a recorded zero stays 0. Supported activity types get readable names; a type the app doesn't know (including types from newer iOS versions) is imported as `Other`. Workouts older than the fixed ~90-day history boundary are not imported.

## Journal and upload protocol

The account-specific on-device SQLite journal is encrypted with SQLCipher, with a random key in the Keychain. No raw samples are sent to the server: the journal keeps sample IDs/times and the minimum values needed to recompute summaries. The server receives daily steps/sleep summaries and timestamped kg readings. Do not log the journal, SQLCipher key, or sample values.

`reconcileHealth` reads at most three pages of 500 changes per invocation. Steps/sleep start with a fixed ~90-day history boundary (sleep has two extra context days); weight pages are unbounded in date to preserve older readings. A latest-weight seed makes the most recent reading available before a long historical import finishes. The lower-bound predicate never slides once its anchor is established, so later corrections to imported days remain visible after they age beyond the initial window.

For each page, atomically persist the next sample snapshot and pending upload. Send the idempotent `apply_health_changes` transaction, then checkpoint the anchor. Failed uploads and interrupted checkpoint writes replay the exact pending request. Explicit tombstones remove known samples and recompute their affected keys. Unknown tombstones and ambiguous empty queries never clear server rows. Raw data imported before this journal existed has no provable deletion provenance; it is not cleared on absence alone.

Workouts use the same journal and anchor protocol with a separate server function, `apply_health_workouts`, which is atomic and idempotent. A tombstone deletes only a workout this journal imported and only a row last written by this device; manual workouts are never touched. Read permission for workouts is requested like the other types, and a denied or limited workouts permission only affects the workouts metric.

Server checks bind the request to the captured account. Manual overrides are never overwritten/deleted. Device ownership prevents one Health store deleting another device's uploaded row; if a second device last wrote a row, that device must reconcile its own deletion. This is intentionally conservative across independently populated Health stores.

A fresh native build is required after adding `expo-sqlite` with `useSQLCipher: true`. The journal refuses an unencrypted build. SQLCipher key loss makes the old journal unreadable; stop sync and use the local-history deletion/reconnect flow rather than silently discarding provenance. `resetHealthAnchors` re-queries visible history while retaining known samples; it does not infer deletions from absence. Invalid/expired native anchors surface as errors and require an explicit history recheck.

## Integration with account/data controls

Stop the account coordinator before calling `deleteHealthJournal(userId)` to remove local imported history and its key. Removing cloud data must disable future imports until the account explicitly reconnects. Account deletion and disconnect controls are owned by issue #26; do not delete Health samples in Apple's store when deleting our imported copies.

Foreground orchestration and user-visible status are implemented separately in issue #22. Personal sleep/weight dashboards remain issue #24. No background delivery or Apple sign-in is introduced here.

## Foreground coordinator

`HealthSyncProvider` is mounted under `AuthProvider`, with one coordinator per account. Connect consent is stored under the user ID in Keychain storage; granting Apple's sheet alone never connects another account. Launch/foreground and pull-to-refresh share one in-flight run. Each metric fails independently, and a failed/no-data check does not update its last-success time. A large import continues in bounded slices while the app is active and resumes after restart.

Summary exposes per-metric state, last completed import, retry, history recheck, and Stop Health Imports. My Steps uses the same coordinator. After replacing a manual override with Health, it explicitly rechecks history to refill the row even if Health has no new anchored events. A recheck preserves pending upload retries and old date keys, so it can safely repair calendar-date reassignment after a device timezone change.

Sign-out disposes the coordinator and invalidates its upload guards; the SQL owner check independently rejects an old account payload authenticated with a new account's token. Connection-metadata writes are serialized so a pending successful sync cannot re-enable consent after Stop Health Imports. Local journal cleanup is exposed separately for the data-control feature; stopping imports does not erase existing history.

## Export to Apple Health (#34)

Shared write infrastructure for features that save app records (workouts, manual weight/steps/sleep) to Health. Feature code registers an `ExportWriter` per record `kind` (`registerExportWriter`) and calls `useHealthExport().enqueue(kind, recordId, 'save' | 'delete', payload, version?)`. Nothing here exports a specific type yet.

- Permission: write access is requested per data type with `requestHealthWriteAccess(types)` (`toShare` only), never together with read access, the connect consent, or group sharing. `getHealthWriteAccess` is truthful (granted/denied/not-asked), unlike read access. An entry whose type is not allowed stays queued as `failed` with reason `permission` and exports after the user allows it.
- Queue: `export-queue.ts`, one per signed-in account, persisted in the same SQLCipher per-account database as the journal (table `health_export_queue`), so it survives restart. One entry per `(kind, recordId)`, newest version wins, a same-or-older version is ignored. States: `pending`, `success`, `failed` (reason `permission` or `error`). Failed entries retry on launch, foreground and the next enqueue. Errors surfaced to the UI are generic and never include payload values; do not log payloads.
- Idempotency: every saved sample carries `HKMetadataKeySyncIdentifier` (`leaderboard:<kind>:<recordId>`), `HKMetadataKeySyncVersion` (the entry version, default `Date.now()`) and our own `LeaderboardRecordId` key (`exportMetadata`). Re-saving the same identifier with a higher version replaces the sample, so retries, a crash between save and bookkeeping, and iCloud-synced devices do not duplicate. The server table `health_exports` (owner-only RLS, cascades on account deletion) stores `(kind, recordId) -> sample uuid, sync version, device`; `record_health_export` only accepts a newer version. A device that finds a version at or above its own on the server skips the write. Limit: two devices with separate Health stores export only from the device that queued the record.
- Edits and deletes: an edit re-enqueues with a higher version. A delete calls `deleteObjects` filtered on our `LeaderboardRecordId`; HealthKit also only lets an app delete its own samples, so imported third-party samples are never touched or re-exported.
- No import loop: the importer drops samples carrying our key (`queryChanges`), and statistics/latest-weight queries exclude them with `EXCLUDE_OWN_EXPORTS`. The anchored query predicate is not changed, since it must stay fixed per anchor.
- Accounts: `stop()` on sign-out or account switch invalidates any export in flight; unfinished entries stay in that account's own local store. Account deletion removes the whole local database (queue included) and the server rows cascade. Stop/delete imports keeps the queue (`deleteImportedJournal` clears only imported history).
- Requires a new iOS build: `NSHealthUpdateUsageDescription` is now set. Add the write types a feature needs when it registers its writer.
