# Food data source (#44)

Decision: USDA FoodData Central (FDC) is the primary provider. User-created custom foods are always available and are the fallback when FDC has no match or is unreachable. Open Food Facts is a possible later addition for barcode and international branded coverage. A paid provider is not needed.

Nutrition values are estimates with visible provenance. They are not medical advice.

## Comparison

| | USDA FoodData Central | Open Food Facts | Edamam (commercial) |
|---|---|---|---|
| Coverage | Foundation, SR Legacy, FNDDS survey foods, Experimental, and Branded (US label data, updated monthly) | Crowdsourced packaged products worldwide, strongest for barcodes, uneven completeness | 100k+ foods, basic and packaged, free-text parsing |
| License | CC0 1.0 public domain | Database under ODbL, contents under DbCL, images CC BY-SA | Proprietary contract |
| Attribution | Credit requested, not required | Required (ODbL), custom User-Agent expected | Required on every plan, breach means suspension |
| Rate limits | 1,000 requests/hour per key (HTTP 429, key blocked 1 hour if exceeded), higher on request | As of 2026-11: search 10/min, product reads 15/min per IP (per user when calls come straight from a mobile app), bulk export advised for large use | Daily hit quotas by plan |
| Cost | Free (api.data.gov key) | Free | Paid tiers listed at $99 to $499/month; the Nutrition Data API page says it is retired, so terms are unconfirmed |
| Portion gram weights | Yes: `foodPortions` with `gramWeight` on Foundation/SR Legacy/FNDDS; Branded has `servingSize` plus `householdServingFullText` | Mostly a free-text `serving_size` string, weights not reliably structured | Measures with gram weights |
| Key handling | Key must stay private (leaked keys are deactivated), so calls go through our server | No key | Key and app id, server side |

Nutritionix was also considered, but its pricing page could not be fetched (HTTP 402), so its numbers are not recorded here. The `foodPortions`/`gramWeight` field names were confirmed in #45 against the FDC OpenAPI spec and live responses (see "FDC fields confirmed in #45" below).

## Why FDC

1. Public domain data, so caching rows in our own database is allowed with no licensing friction.
2. Free, with a limit (1,000/hour per key) that a server-side cache comfortably stays under.
3. Foundation and SR Legacy foods carry portion gram weights, which is what makes portion-based logging possible.
4. No blocker found. Weaknesses are US-centric branded data and no guaranteed barcode search, which custom foods and a later Open Food Facts addition cover.

## Strategy

- The FDC key lives only in the `food-search` edge function (`supabase/functions/food-search/`, built in #45) as the secret `FDC_API_KEY`. It is never shipped in the app or committed. Setup is in the README.
- Foods fetched from FDC are cached in `public.foods` (`provider = 'usda_fdc'`) by the server only. Clients read the cache and cannot write it.
- Each cached row stores `source_data_type` (Foundation, SR Legacy, Branded, ...) and `source_version` (the FDC release or publication date) so history can say where a value came from.
- If FDC fails, the app searches the cache and the user's custom foods, and always lets the user enter a custom food.
- A portion is only usable when it has a valid gram weight (`gram_weight > 0`). Portions without one are not stored.
- Unknown nutrients are NULL, never 0.

## Mapping FDC nutrients to our columns

The server maps FDC nutrient numbers to per-100 g columns (`supabase/functions/_shared/fdc.ts`). Energy precedence for `energy_kcal`:

1. Energy in kcal (nutrient number 208, id 1008).
2. Atwater Specific Factors energy (number 958, id 2048), when there is no 208. Foundation foods usually carry only 957 and 958.
3. Atwater General Factors energy (number 957, id 2047), when there is neither 208 nor 958.
4. Energy in kJ (268, id 1062) divided by 4.184 (`kjToKcal` in `src/lib/food/nutrition.ts`).
5. Otherwise NULL. Never 0 and never computed from macros.

Other columns: protein 203, fat 204, carbs 205, fiber 291, sugars 269 (then 269.3, which Foundation uses), saturated fat 606 (g) and sodium 307 (mg). Every nutrient follows the same rule: a missing, wrong-unit, negative or out-of-range value is NULL, a reported 0 is 0.

## FDC fields confirmed in #45

Checked on 2026-11-06 against the OpenAPI spec (https://fdc.nal.usda.gov/api-spec/fdc_api.yaml, last modified 2020-04-30) and live calls to `api.nal.usda.gov/fdc/v1` for Foundation, SR Legacy and Branded foods. The spec lags the live API in places, and where they differ the live response is what the code follows.

- Search (`GET /foods/search`): `query`, `dataType` (comma separated), `pageSize` (max 200), `pageNumber` (starting at 1). Each food has `fdcId`, `description`, `dataType`, `publishedDate` (ISO) and `foodNutrients[]` with `nutrientId`, `nutrientNumber`, `unitName` (uppercase, such as `KCAL`, `G`) and `value`. The spec's abridged nutrient names (`number`, `amount`) do not match this. Branded search results can list the same nutrient more than once, including per-serving values, so the server does not read nutrients from search results.
- Details (`GET /foods?fdcIds=a,b&format=full&nutrients=...`, up to 20 ids and 25 nutrient numbers): one call returns every food, so a search costs two FDC requests. `foodNutrients[].nutrient.number` is a string, `nutrient.unitName` is lowercase (`kcal`, `kJ`, `g`, `mg`) and `amount` is per 100 g. A nutrient with no `amount` is unknown. `publicationDate` is `M/D/YYYY`.
- `foodPortions[]` (Foundation, SR Legacy): `gramWeight` (grams for `amount` units), `amount`, `modifier` (such as `slice`, `cup`), optional `portionDescription`, and `measureUnit.name` (`undetermined` when there is no real unit; Foundation sometimes has only `RACC`, the reference serving, shown as "serving"). Branded foods return an empty `foodPortions`.
- Branded serving: `servingSize` with `servingSizeUnit`, which is `GRM` in live data (the spec example says `g`), plus `householdServingFullText` such as `3/4 cup (20g)`. It is used as a portion only when the unit is a mass unit. `brandName` and `brandOwner` carry the brand.
- Nutrient numbers confirmed: 208 kcal, 268 kJ, 957 and 958 (names "Energy (Atwater General Factors)" and "Energy (Atwater Specific Factors)", ids 2047 and 2048), 203, 204, 205, 291, 269 (SR Legacy, Branded), 269.3 (Foundation), 606, 307.
- Errors: 429 `OVER_RATE_LIMIT`, and 403 `API_KEY_INVALID` for a bad key.
- Search covers Foundation, SR Legacy and Branded. Survey (FNDDS) and Experimental foods are not searched yet. Results list Foundation and SR Legacy foods before Branded ones.
- Known gap: Branded nutrients are per 100 of the serving unit. A Branded food measured in ml (`servingSizeUnit` such as `MLT`, or no unit) is per 100 ml, so it is skipped (not cached, not returned) until a density source exists.

## Request limits and fallback

- The key is shared and allows 1,000 requests per hour, and a search makes 2. Each user may make 30 searches per rolling hour and all users together 400 (about 800 FDC calls, under the 1,000 limit); the edge function checks this with `food_search_allow` (table `food_search_log`, service role only, deleted with the account) and answers 429 `rate_limited` beyond it.
- The app searches only from 3 characters, after a 700 ms pause or when the user submits.
- When FDC answers 429, times out or errors, the function returns matching foods already in the cache with `fromCache: true` and a `failure` code, and the app says it is showing saved results. With no cached match it returns the error code, and the app still offers a custom food.

## Estimates, logging and history

- Snapshot nutrients on `food_entries` are computed by the client (per-100 g values scaled to the eaten grams, `scaleNutrients`). The server only bounds them (non-negative, finite, upper limits) and cannot verify them, so they are estimates and never medical advice.
- "Immutable snapshot" means later edits to the food never change logged entries. An entry's own nutrients change only when the user edits its amount, in one UPDATE together with grams.
- The amount of an entry is editable in place (grams, portion, `is_estimated` and the nutrients, recomputed together by the client). The row id stays the same so Health export mappings (#48) stay stable. Identity never changes: user, client id, food id (it can only become null when a food is deleted), food name, brand, provider, provider id, source data type and version, and created_at.
- No entries for a date means no data, not 0 kcal.
- `local_date` is the calendar date in the entry's own device timezone (a zone name such as America/Chicago, or UTC or GMT; the server sets it from `consumed_at` and `timezone`). Group summaries (#49) must group by `local_date`, not by converting `consumed_at` with the viewer's or the group's timezone.

## Attribution the UI must show

On food search and detail screens, and in any history view showing a USDA food:

> Nutrition data from the U.S. Department of Agriculture, Agricultural Research Service. FoodData Central. fdc.nal.usda.gov.

Custom foods are labeled "Custom food" in search and on the food screen. In the diary, entries of a custom food carry the tag "Custom", and entries the user marks as a guess carry the tag "Estimate" (`is_estimated`; the log and entry screens have a "Mark as an estimate" switch). Entries not yet on the server carry "Not synced". All values are labeled as estimates.

## Sources

- https://fdc.nal.usda.gov/api-guide/ (rate limits, key rules, CC0, suggested citation)
- https://fdc.nal.usda.gov/data-documentation/ (data types and update cadence)
- https://openfoodfacts.github.io/openfoodfacts-server/api/ (rate limits, licenses, User-Agent)
- https://developer.edamam.com/edamam-nutrition-data-api (pricing, attribution)
