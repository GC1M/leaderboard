# Phase 4 food validation (#50)

Maps every acceptance item of #50 to the test that proves it, lists the gaps this PR filled, and holds what only a physical iPhone can show. Earlier phases: `../phase12-ux-validation.md`, `../competitions/rules-v1.md`. Model, sources and arithmetic rules: `data-source.md`. Health export design: `health-export.md`.

Nutrition values are estimates with visible provenance, not medical advice.

## How to run everything

```
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint .
./node_modules/.bin/jest --coverage          # floors are in package.json (jest.coverageThreshold)

npx supabase@2.122.0 start -x studio,imgproxy,logflare,vector
npx supabase@2.122.0 db reset
npx supabase@2.122.0 test db                 # pgTAP, supabase/tests/*.test.sql
npx supabase@2.122.0 gen types typescript --local > src/lib/database.types.ts   # git diff must be empty
node scripts/smoke/api-smoke.mjs             # two real users over the local API (npm run smoke:api)
npx supabase@2.122.0 stop
```

Only the food parts: `jest src/lib/food src/lib/health/food-export src/__tests__/food- src/__tests__/recipe-editor` and `supabase test db supabase/tests/food_*.test.sql`.

## Audit: acceptance criterion, covered by, gap

Files are in `src/lib/food/` unless a path is given. SQL files are in `supabase/tests/`. "Fixtures" is `fixtures.test.ts`, added here.

### 1. Fixtures cover grams/servings, kcal/kJ, unknown nutrients, recipe yield, edits and immutable snapshots

| Criterion | Covered by | Gap |
|---|---|---|
| Grams and portions to grams | `log.test.ts` resolveQuantity, consumedNutrients; `nutrition.test.ts` portion and mass tests; Fixtures "grams and servings" (hand-checked table) | none |
| kcal and kJ | `nutrition.test.ts` kcal and kJ; `fdc.test.ts` kJ-only energy, Atwater order; Fixtures "kcal and kJ" (both ways, provider kJ rounding, wrong unit) | none |
| Unknown nutrients stay unknown | `nutrition.test.ts` scale/sum/unknown; `diary.test.ts` groupDay; `food-diary.test.tsx` incomplete totals; Fixtures "unknown nutrients" | none |
| Recipe yield | `recipe.test.ts` totals, per serving, per 100 g, portions, meal; Fixtures "recipe yield" (yield 800, 600, none) | none |
| Edits scale the saved snapshot | `diary.test.ts` buildEdit, saveEdit; `recipe.test.ts` recipe entry edit; Fixtures "edits scale the entry snapshot" (incl. two edits compose) | none |
| Immutable snapshots after food or recipe edits | `diary.test.ts` buildEdit scales entry not food; `recipe.test.ts` recipe snapshot unchanged; `food_model.test.sql` identity trigger; Fixtures "immutable snapshots" | none |

### 2. Provider outages, permissions, privacy, account deletion, export idempotency

| Criterion | Covered by | Gap | Filled by |
|---|---|---|---|
| Provider failure codes (429, 403, 5xx, network, timeout) | `fdc.test.ts` failureFor; `search.test.ts` typed failures | The edge function itself (status codes, 401, 405, 400, 503, limit, mapping to HTTP) had no test | `food-search-function.test.ts`: real handler, Deno and Supabase stubbed |
| Cached fallback | `search.test.ts` fromCache flag | Server side fallback (cache hit, no cache, page 2, details call failing, wildcard escape) untested | `food-search-function.test.ts` |
| Outage in the UI | none | Search screen never rendered: saved-results notice, error with Try Again, custom food still offered | `src/__tests__/food-search.test.tsx` |
| Search limits per user and globally | `food_search_log.test.sql` | none | |
| Health permission per type | `health/food-export.test.ts` "permissions" (subset, all denied, revoked after export, mask, re-allow) | none | |
| Sharing off by default, consent, revocation, leaving, removal | `food_sharing.test.sql`; `group-summaries.test.ts` food | none | |
| Owner bypass (owner cannot read, share for, delete or revoke a member's food) | `food_sharing.test.sql` direct reads, insert 42501, delete and revoke | none | |
| Non-member, other group, anon | `food_sharing.test.sql` | none | |
| Food is not a ranking or competition metric | `food_sharing.test.sql`; `competition_*.test.sql` | none | |
| Delete food history (server, queue, Health choice) | `food_sharing.test.sql` delete history; `profile.test.ts` deleteFoodHistory (queue cleared only after server delete, two passes, generation bump); `profile-screen.test.tsx` Keep or Remove; `health/food-export.test.ts` settle keep or remove; `health/export-queue.test.ts` forget and discard emit first | none | |
| Account deletion, server cascade | `delete_account.test.sql` (no food); `food_sharing.test.sql` (entries only) | Recipes, ingredients, custom foods, shares, search log and Health export rows were never checked to cascade | `food_lifecycle.test.sql` |
| Account deletion, local queue | `profile.test.ts` deleteAccount removes `food-pending-<uid>`; `pending.test.ts` clearFoodPending waits for a flush in flight | none | |
| Account deletion, Health choice | `profile-screen.test.tsx` Delete Account keep or remove, stops if remove fails | none | |
| Export idempotency | `health/food-export.test.ts` "queues ... nothing the second time", version, mask; `health/export-queue.test.ts` dedupe, crash before mapping, multi-device | none | |
| End to end lifecycle | none (pieces only) | log, edit, share, member reads, revoke, delete history, log again, delete account in one run | `food_lifecycle.test.sql`; API smoke food step |
| API over the real stack | `scripts/smoke/api-smoke.mjs` had no food | insert, `food_daily_totals`, share, `group_food`, revoke | new food step in `api-smoke.mjs` |

### 3. Device, licensing, CI

| Criterion | Covered by | Gap |
|---|---|---|
| Health writes confirmed on a physical device | Logic only in `health/food-export.test.ts` (in-memory HealthKit stand-in) | PENDING: the checklist below. Issue stays open until it is done |
| Database licensing documented | `data-source.md` "Licensing and attribution" (added here: CC0, caching allowed, credit requested, what changes if Open Food Facts is added) | none |
| Attribution shown in the UI | `food-search.test.tsx` (search screen); `food-detail.test.tsx` (food screen); entry screen shows it for USDA entries (`entry/[id].tsx`) | No automated test of the entry screen line. Covered by the manual checklist |
| CI passes, coverage above the floor | `.github/workflows` (tsc, eslint, jest --coverage, db reset, test db, types diff, API smoke) | none |

## Physical iPhone checklist for Health writes (PENDING)

Needs a development build on a real iPhone, signed in, with Health. The per-type permission, unit, edit, delete, retry, offline and no-reimport steps are in the checklist at the end of `health-export.md` ("Physical iPhone checklist"). Run that one first. It is not repeated here. Then these, which exist because of the Keep or Remove choice and the account flows (#49):

- [ ] Switch off with food in Health: the sheet asks. Keep leaves the samples in Health and turning the switch on again does not write them a second time. Remove deletes every food sample this app wrote, and the Health app shows none left under Browse, Nutrition.
- [ ] Delete Food History with the switch on: Delete and Remove from Health leaves no food samples from this app in Health. Delete, Keep in Health leaves them. Samples for other apps are never touched.
- [ ] Delete Food History while offline: it says a connection is needed, nothing is removed from Health, and the diary still has its entries.
- [ ] Delete Account and Remove from Health: Health samples go first, then the account. If a Health delete fails (revoke a nutrient permission to force it), the account is kept and the message says some food could not be removed.
- [ ] After Delete Account, sign in as a different account: no food, no pending entries, and the first account's samples are only in Health if Keep was chosen.
- [ ] Large Text and VoiceOver: the diary, search results and the Keep or Remove sheets read in full.

## Attribution check (manual)

- [ ] Search screen, a USDA food screen and a logged USDA entry each show the USDA FoodData Central attribution. A custom food and a recipe entry do not.
- [ ] Every food screen says values are estimates, not medical advice.
