# Phase 1/2 UX regression checks (#122)

The signed-in routes now live under four tab stacks. Public URLs (`/weight`, `/sleep`, `/steps`, `/workouts`, `/groups`, `/profile`) are unchanged. The old `/privacy` URL redirects to Profile's privacy page. A tab reselect returns its stack to the root; changing tabs retains the other stacks and drafts. Completing an editor dismisses back through its section before opening the saved detail.

## Native rebuild

The native date/time sheets use the local Expo module in `modules/leaderboard-date-picker`. It is discovered by Expo autolinking; there are no new npm dependencies. An already installed development build must be rebuilt:

```sh
npx expo prebuild --platform ios
npx expo run:ios
```

Web uses browser date/time controls. Expo Go cannot load this local module and shows a rebuild message when a date picker is opened. Simulator testing can verify UI only; Apple Health needs a signed physical-device build.

## Automated checks

The native picker source also passes standalone Swift typechecking against the cached ExpoModulesCore framework and iOS Simulator SDK. This is separate from building and exercising the full app.

Run `npm run typecheck`, `npm run lint -- --no-cache`, `npm test -- --coverage`, the iOS/web exports in CI, and `supabase test db`.

- Numeric tests cover typed/pasted decimal separators and intermediate `75.`, reject ambiguous grouped steps such as `7,5`, preserve blanks versus recorded zeroes, and check conversions through canonical values.
- UI tests cover weight save/reopen/edit, overflow deletion confirmation, unsaved-change choices, template duplication without an immediate server write, mixed-category retention, exercise filtering/Show All, and sharing pending/error rollback.
- History tests cover a truly empty account, records outside the selected window, and recorded zeroes.
- Database tests cover whole-number steps/reps through the API, decimal loads/distances/time, explicit zeroes and finite-number constraints. Existing sharing/RLS/import/export/account-isolation tests remain in place.
- The web smoke script adds signed-in empty histories, decimal typing/paste/conversion, persistent tabs, saving a weight draft, and preserving a workout draft while switching tabs. Existing invite/sign-in continuation checks remain.

## Hands-on iOS checks still required

These checks cannot be established by passing unit tests or JS bundle export. In the implementation session CoreSimulator service access, Docker access and binding a localhost smoke server were denied by the environment. No physical iPhone was connected. In particular, the reported inability to type weight has **not** been reproduced or attributed to an app-side focus bug. The app now supplies a decimal input, explicit validation and a numeric-keyboard Done accessory.

- Toggle Simulator → I/O → Keyboard → Connect Hardware Keyboard. Test both hardware and onscreen entry of `75.`, `75.5`, `75,5`, paste, selection and replacement. Compare another text field. Repeat on a physical iPhone.
- Confirm Done dismisses every numeric keyboard and that the save action stays above the keyboard/safe area. Open and cancel the native date and time sheets; select a new date/time and save/reopen it.
- For steps, sleep and weight, open history rows, edit manual records, and delete only after the named confirmation. Imported records remain read-only. Cancel each editor with Keep Editing / Save Draft / Discard Changes; reopen saved drafts. Repeat after relaunch.
- Select Strength, Core, Cardio, Mobility and Full Body from the themed workout-type dropdown. There is no separate Activity selector. Full Body must list every exercise category without needing Show All; other types remain filtered by default. Verify hours/minutes duration entry, retained sets when changing type, existing Apple Health activity mappings and unit overrides preserving physical quantities and Profile defaults. The workout detail shows Delete Workout directly, with confirmation.
- Create/save a template; duplicate then cancel (no new server record); duplicate then save. Start separate workouts, edit/delete the template, and verify the workouts are unchanged.
- Repeat save/edit/delete cycles and use Back. Completed editors must not replay. Open detail/editor URLs directly and verify safe parent navigation. Reselect the active tab, including with a dirty editor; confirm unsaved changes are protected.
- Switch tabs during editing, then return and resume the same draft. Sign out and sign in to another account: prior-account routes/data/drafts must not appear. Resume an invite through sign-in without auto-joining.
- Toggle each group sharing switch. Under slow/failing networking, verify pending feedback, duplicate-write prevention and rollback. Verify summaries disappear after revocation. Apple Health read/write settings remain separate.
- Check a small display, accessibility text sizes, VoiceOver labels/touch targets and light/dark appearance. Verify the final history row, overflow actions and Save buttons scroll fully clear of the tab bar.
- Run the separate physical-device Health import/export checklist in README; simulator results do not validate HealthKit behavior.
