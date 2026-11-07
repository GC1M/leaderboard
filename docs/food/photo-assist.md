# Food photo assistance (#51 to #54)

Take or choose a photo of a nutrition label or a menu, check what the app read, then save. Nothing is saved, shared or exported to Apple Health until you confirm it.

## Design

Decision: text is read on the device with Apple Vision (`VNRecognizeTextRequest`, accurate level, language correction off so numbers and units are not rewritten). No photo is uploaded and no cloud model is called.

- Free at any scale, no API key to protect, no server cost or rate limit.
- No image retention policy is needed: the picker copies the photo into the app cache, `readPhoto` deletes that copy in a `finally` block whether reading worked or not, and the original in the photo library is never touched. Nothing reaches our server, logs or backups. Account deletion has nothing extra to remove.
- iOS only for now (`modules/leaderboard-text-recognizer`, autolinked like `leaderboard-date-picker`). On Android and web the scan buttons are hidden. Phase 7 can add ML Kit text recognition behind the same `recognize(uri)` call.

Limits: images only (`mediaTypes: ['images']`), no EXIF or location, 20 MB maximum. The picker crop is off because iOS only offers a square crop, which cuts off tall labels.

## Labels (#52)

`src/lib/food/scan.ts` turns Vision text boxes into lines (boxes on one row are joined left to right), then `parseLabel` reads:

- Energy in kcal, or kJ converted to kcal (noted). The "2,000 calories a day" footnote and "Calories from fat" are ignored.
- Fat, saturated fat, carbs, sugars, fiber, protein (grams, mg converted) and sodium (mg, g converted). EU salt becomes sodium at 400 mg per g of salt (noted).
- Basis: per serving (US) or per 100 g / 100 ml (EU). With two columns the column order comes from the header line. The serving weight comes from the serving size line, preferring a weight in brackets.
- Decimal commas ("3,5 g"). "1,046" is only read as a thousands separator for energy; elsewhere it needs the user.

A value is left blank with a note ("Label shows ...") instead of guessed when the line's confidence is under 0.5, the number is ambiguous, OCR swapped O for 0, the label says "less than", sodium has no unit, or it is implausible: more than 100 g per 100 g (900 kcal, 40,000 mg sodium), or a part larger than its total (saturated fat over fat, sugars or fiber over carbs). Calories more than 25% (and 20 kcal) away from 4P + 4C + 9F show a warning. A missing nutrient is unknown, never 0.

The review screen shows every field for editing, the basis, the serving weight and the raw text, which can be corrected and read again. If nothing was read, the same screen is manual entry. Saving converts to per 100 g (`labelToPer100g`) and creates a custom food, then the normal log screen asks for amount, meal and time. A label is a transcription, so the entry is not marked as an estimate unless you switch it on.

## Menus (#53)

`parseMenu` lists dishes from the menu text (prices removed, lower-case or long lines kept as the dish's description). Nothing estimates nutrition from a dish name or photo: tapping a dish opens food search with the dish name, you pick the closest food and the amount you ate, and the entry starts with "Mark as an estimate" on. The screens say portions and recipes vary and show what the menu lists. You can pick nothing and go back. Estimated status and the provider of the chosen food are stored with the entry as for any other entry, and diary totals, sharing and Health export only see it once logged.

There is no server input, model or provider key in this feature, so there is nothing to rate limit.

## Quality gate (#54)

`src/lib/food/scan.test.ts` holds the test set: a US Nutrition Facts panel with % Daily Value columns and footnote, an EU two-column label with salt, a serving-first two-column bar label, a German decimal-comma kJ-only label, a noisy capture (O for 0, a low-confidence line, "<1g", "1,250g"), non-label text, and a menu with prices, descriptions, a duplicate and a blurry line.

| Measure | Result |
| --- | --- |
| Values on the labels read correctly | 24 of 24 |
| Values not on the label, or unreadable, filled in anyway | 0 |
| Unit and basis errors (kJ, mg/g, salt, per serving vs per 100 g) | 0 |
| Implausible or inconsistent values saved without a flag | 0 |

`src/lib/food/photo.test.ts` covers deletion of the photo after reading and after a failure, the size limit, a cancelled picker and camera permission denied.

These are text-level fixtures. Real photos add Vision misreads (glare, curved packs, small print), so the device checks below are still required before release.

## Device checklist (physical iPhone)

- [ ] Camera and photo library prompts show the purpose strings; denying camera shows the message and Choose Photo still works.
- [ ] Five real US labels and three EU labels: every value matches the label after review, the basis and serving weight are right, and the saved custom food's per 100 g values are correct.
- [ ] A glossy or curved label and a blurry photo: unreadable values come up blank with a note, never wrong numbers.
- [ ] A menu photo lists the dishes; picking one searches for it, the log screen starts as an estimate and shows the menu note; going back saves nothing.
- [ ] Cancel while reading returns to the start and nothing is saved. Try Again after a failure works.
- [ ] After a scan, the app's `Library/Caches/ImagePicker` folder holds no photo (check with Xcode's container download).
- [ ] A scanned food logged with "Save food to Apple Health" on exports once, like any other entry, and Large Text and VoiceOver read the review screen in full.
