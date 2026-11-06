# Food to Apple Health (#48)

Builds on the shared export queue from #34 (see "Export to Apple Health" in `../health-sync.md`) and follows the workout export (`../workout-export.md`). Writer: `src/lib/health/food-export.ts`. Switch and wiring: `src/components/food/FoodExportOption.tsx`, shown on the food diary. Nutrition values are estimates, not medical advice.

## What is exported

When the user turns on "Save food to Apple Health", each `food_entries` row logged in this app is saved as one Health food correlation (`HKCorrelationTypeIdentifierFood`) holding one quantity sample per KNOWN nutrient, all dated at `consumed_at`. The correlation carries the food name in `HKMetadataKeyFoodType` (raw key `HKFoodType`).

| Entry column | Health type | Unit written |
|---|---|---|
| `energy_kcal` | `dietaryEnergyConsumed` | kcal |
| `protein_g` | `dietaryProtein` | g |
| `carbs_g` | `dietaryCarbohydrates` | g |
| `fat_g` | `dietaryFatTotal` | g |
| `fiber_g` | `dietaryFiber` | g |
| `sugars_g` | `dietarySugar` | g |
| `sat_fat_g` | `dietaryFatSaturated` | g |
| `sodium_mg` | `dietarySodium` | mg |

Units: the entry stores kcal, grams and milligrams, the same units HealthKit is given, so nothing is converted. Energy is kcal (kJ is display only and never stored). Sodium is a mass in mg exactly as stored, never grams, and never an amount of salt. Values are for the amount eaten, not per 100 g.

Rules:

- A NULL (unknown) nutrient is not written. Never as zero. A recorded 0 is a known value and is written as 0. An entry with no known nutrient writes nothing.
- Only entries that have reached the server and are not waiting on a queued edit are exported (`canExportFood`). Pending, unsynced or failed-to-sync entries are skipped until they sync.
- Only app-authored entries exist in `food_entries`; nothing imported from Health is ever in it, so nothing imported is written back. Every sample carries `LeaderboardRecordId = food:<entry id>`, which the Health importers skip.
- Ingredients, recipes, meal names, brands, source data type, photos and notes stay in the app.

## Permissions

Turning the switch on shows the Health sheet for the eight nutrient types (`toShare` only, never read access). The user can allow any subset, independently. Only allowed nutrients are written: a denied nutrient is simply left out of the correlation, and the entry still exports while at least one type is allowed. If none is allowed the switch stays off and says how to allow it. A queued entry whose permission is later revoked for every type stays `failed` with reason `permission`, keeps the diary entry, and exports after the user allows it (Retry on the diary). Nutrients allowed after an entry was exported are added when that entry is next edited.

## Mapping, retries, edits, deletes

Uses the #34 queue and `health_exports` mapping unchanged (no SQL): kind `food`, recordId `food_entries.id`, one queue entry per diary entry. The id stays the same when an amount is edited.

- Version: the row's `updated_at` in ms is the export version, so loading the diary again never re-exports a row, and any change to the row (amount, meal, time) exports a new version.
- Retry: a failed write retries on launch, foreground and the next enqueue. Before writing, the writer removes any correlation and members already saved for that record, so a retry after a lost mapping write never doubles correlation members (HealthKit's sync identifier only replaces the correlation object, not its members).
- Edit: the new version removes the old correlation and members, then writes new ones from the new values.
- Delete: deleting an entry in the diary enqueues a delete, which removes its correlation and members by the `LeaderboardRecordId` metadata and clears the mapping. HealthKit only lets an app delete its own samples.
- Switch off: stops saving new and edited entries and drops saves not yet written. Entries already in Health stay, and are still removed when deleted in the app.
- Limits: only entries on a day the user opens in the diary while the switch is on are queued, so turning it on later exports each day as it is viewed. A delete is only queued for an entry this device has an export entry for; one exported from another device, or after the switch was off, is removed in the Health app.

## External display limitations

- Health shows the members of a food correlation as separate nutrient samples under Browse, Nutrition (Calories, Protein, Carbohydrates and so on). There is no combined "meal" card, and the correlation is not grouped in its own view.
- The food name (`HKFoodType`) is shown only in some views, such as the sample detail of a nutrient sample, and some apps that read nutrition ignore it. Do not rely on it being visible.
- The meal (breakfast, lunch and so on) has no Health field, so it is not exported.
- Another app that reads dietary samples sees the same quantities and may add them to its own totals.
- Nutrients the user did not allow, or that we do not know, are missing in Health, not zero.

## Not verifiable off a device

`saveCorrelationSample` and `deleteObjects` cannot run in jest or Expo Go. Tests (`food-export.test.ts`) drive the real queue and writer against an in-memory HealthKit stand-in and check correlation contents, units, unknown nutrients, retry, edit, delete and per-type permission. The shared `HealthAdapter` and its fake adapter do not model food (nutrition is marked unsupported there), and the export queue does not go through the adapter, so the adapter contract suite is not involved.

## Physical iPhone checklist (PENDING, not yet done)

Needs a development build on a real iPhone with Health.

- [ ] Turn the switch on and check the Health sheet lists all eight nutrient types; allow some and deny others, then log a food and confirm only the allowed ones appear.
- [ ] Compare each value and unit in Health (Browse, Nutrition) with the diary entry: calories in kcal (not kJ), protein, carbs, fat, fiber, sugars and saturated fat in g, sodium in mg (for example 410 mg shows as 410 mg, not 0.41 g or 410 g).
- [ ] An unknown nutrient (for example a custom food with only calories) shows only calories, with no 0 for the others.
- [ ] A recorded 0 (for example 0 g sugars) shows as 0.
- [ ] Check the sample details for the food name and that the source is this app.
- [ ] Edit the amount: Health shows the new values and no leftover old samples (and no empty or duplicate food in the correlation).
- [ ] Edit and then force-quit mid-sync, reopen: still one set of samples.
- [ ] Delete the entry: all its samples are gone from Health, including after deleting the correlation (confirm HealthKit's delete of the correlation, which is best effort, leaves nothing behind).
- [ ] Turn off airplane mode after logging offline: the entry exports only once it has synced.
- [ ] Revoke all nutrient permissions in Settings, log a food, then re-allow and tap Retry: it exports once.
- [ ] After the next Health import, nothing the app exported comes back as imported data.
