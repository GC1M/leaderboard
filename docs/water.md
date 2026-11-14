# Water tracking (Phase 6, issues #55 to #58)

Server: `supabase/migrations/20261110000000_water.sql`. App: `src/lib/water/` (data), `src/app/(tabs)/(summary)/water/` (screens). Apple Health export: `docs/water-export.md`.

## Data model

- `water_entries`: one row per drink, with `ml`, `consumed_at`, `timezone` and `local_date` (set by the server from that zone). `source` is `manual` (added in this app, keyed by a device-made `client_id` so a retry never duplicates) or `healthkit` (an Apple Health sample, keyed by its UUID, with `source_name`, the app or device Health says recorded it).
- `water_targets`: an optional personal daily target. No row means no target. The app never suggests a number.
- Manual entries are saved on the iPhone first (`waterQueue`, per account) and synced, so logging works offline. Pending and failed entries show as Not synced with Retry Sync; an unsynced edit can be discarded.
- Imported entries are read-only in the app. They change or go away only when they change in Health.
- A Health sample is skipped if it is below 0 mL or above 20 L. A sample zone the server does not accept falls back to the profile zone, then UTC. Water this app saved to Health is left out of the import query itself.

## Units

Stored in millilitres only. Fluid ounces (US, 29.5735295625 mL) are for entry and display. An entry is rounded to 0.1 mL, so a round trip through fl oz does not drift. A single manual entry is above 0 and at most 5000 mL (checked in the app and on the server). The unit is a per-device choice, defaulting to fl oz in the US and mL elsewhere.

## Days and time zones

Each entry keeps the zone it was drunk in, and its day is the calendar date there. Daily totals group by that day, so travelling never moves an old entry to another day. A new or edited time is on the device clock and takes the device zone.

## Missing vs zero

A day with no entries has no total: the app says "No water logged", the history leaves a gap, and the Summary card says no data. It is never shown as 0 mL. A recorded 0 mL sample from Health is a recorded zero.

## Sharing

Per group, off by default, through the Water switch in Group Info. A group sees one number per member per day (`group_water` returns only user, date and total mL), shown as the latest day in the past week. Never each drink, its time or source, and never ranked. Turning the switch off hides it on the group's next read.

## Deletion

- Delete Water History (Profile, Your Data): every water entry (manual and imported), the target, the export mapping and the changes waiting on this iPhone. The user chooses whether water this app saved to Health is removed too; the choice applies to this iPhone, and another device keeps its own record of what it saved. Water other apps saved to Health is never touched. Imports then skip water drunk before the deletion, and the deleted Health samples dated after it (table `water_history_cutoffs`, which never moves back on a later deletion), so a recheck or another device cannot bring it back; water drunk later still imports.
- Delete Imported Health Data: imported water goes, manual water stays.
- Delete Account: everything cascades on the server; this iPhone's water queue and export state are cleared. The same Keep or Remove from Health choice is offered.
- Sign-out and account switch: the queue and export state are keyed by account, so nothing carries across.
