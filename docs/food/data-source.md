# Food data source (#44)

Decision: USDA FoodData Central (FDC) is the primary provider. User-created custom foods are always available and are the fallback when FDC has no match or is unreachable. Open Food Facts is a possible later addition for barcode and international branded coverage. A paid provider is not needed.

Nutrition values are estimates with visible provenance. They are not medical advice.

## Comparison

| | USDA FoodData Central | Open Food Facts | Edamam (commercial) |
|---|---|---|---|
| Coverage | Foundation, SR Legacy, FNDDS survey foods, Experimental, and Branded (US label data, updated monthly) | Crowdsourced packaged products worldwide, strongest for barcodes, uneven completeness | 100k+ foods, basic and packaged, free-text parsing |
| License | CC0 1.0 public domain | Database under ODbL, contents under DbCL, images CC BY-SA | Proprietary contract |
| Attribution | Credit requested, not required | Required (ODbL), custom User-Agent expected | Required on every plan, breach means suspension |
| Rate limits | 1,000 requests/hour per key (HTTP 429, key blocked 1 hour if exceeded), higher on request | Search 10/min, product 15/min per IP, bulk export advised for large use | Daily hit quotas by plan |
| Cost | Free (api.data.gov key) | Free | Paid tiers listed at $99 to $499/month; the Nutrition Data API page says it is retired, so terms are unconfirmed |
| Portion gram weights | Yes: `foodPortions` with `gramWeight` on Foundation/SR Legacy/FNDDS; Branded has `servingSize` plus `householdServingFullText` | Mostly a free-text `serving_size` string, weights not reliably structured | Measures with gram weights |
| Key handling | Key must stay private (leaked keys are deactivated), so calls go through our server | No key | Key and app id, server side |

Nutritionix was also considered, but its pricing page could not be fetched (HTTP 402), so its numbers are not recorded here. The `foodPortions`/`gramWeight` field names come from FDC's published API schema, not from the pages fetched above, so #45 should confirm them against the OpenAPI spec.

## Why FDC

1. Public domain data, so caching rows in our own database is allowed with no licensing friction.
2. Free, with a limit (1,000/hour per key) that a server-side cache comfortably stays under.
3. Foundation and SR Legacy foods carry portion gram weights, which is what makes portion-based logging possible.
4. No blocker found. Weaknesses are US-centric branded data and no guaranteed barcode search, which custom foods and a later Open Food Facts addition cover.

## Strategy

- The FDC key lives only in server code (an edge function or service role path, built in #45). It is never shipped in the app or committed.
- Foods fetched from FDC are cached in `public.foods` (`provider = 'usda_fdc'`) by the server only. Clients read the cache and cannot write it.
- Each cached row stores `source_data_type` (Foundation, SR Legacy, Branded, ...) and `source_version` (the FDC release or publication date) so history can say where a value came from.
- If FDC fails, the app searches the cache and the user's custom foods, and always lets the user enter a custom food.
- A portion is only usable when it has a valid gram weight (`gram_weight > 0`). Portions without one are not stored.
- Unknown nutrients are NULL, never 0.

## Attribution the UI must show

On food search and detail screens, and in any history view showing a USDA food:

> Nutrition data from the U.S. Department of Agriculture, Agricultural Research Service. FoodData Central. fdc.nal.usda.gov.

Custom foods are labeled "Custom food" and logged amounts of them "Your estimate". All values are labeled as estimates.

## Sources

- https://fdc.nal.usda.gov/api-guide/ (rate limits, key rules, CC0, suggested citation)
- https://fdc.nal.usda.gov/data-documentation/ (data types and update cadence)
- https://openfoodfacts.github.io/openfoodfacts-server/api/ (rate limits, licenses, User-Agent)
- https://developer.edamam.com/edamam-nutrition-data-api (pricing, attribution)
