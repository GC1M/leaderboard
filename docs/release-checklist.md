# First release checklist (Phases 1 to 5)

Owner-only steps. Nothing here has been done yet. Do them in order; each needs your accounts or hands.

## 1. Before merging `develop` into `main`

- [ ] Every Phase 1 to 5 PR is merged into `develop` and the latest `develop` CI run is green (`ci-ok`).
- [ ] The device run in `docs/device-test-checklist.md` is done on a build from that `develop` commit, failures are fixed or filed, and the issue boxes are ticked.
- [ ] Phase 6 (water) and Phase 7 (Android) are either merged and device-checked too, or held back on their branches. `main` should not get half a phase.
- [ ] Open a PR `develop` into `main` (a merge commit, not a squash, so `develop` history stays shared). Merge once CI is green.

## 2. Hosted Supabase

- [ ] Create or pick the hosted project, then `npx supabase@2.122.0 link --project-ref <ref>`.
- [ ] `npx supabase@2.122.0 db push` from the `main` checkout. Check `supabase migration list` shows every file in `supabase/migrations/` applied, with none edited after it was pushed.
- [ ] Auth: email OTP template and SMTP sender set, redirect URLs include `leaderboard://`, Google client IDs set if Google sign-in is wanted.
- [ ] `npx supabase@2.122.0 secrets set FDC_API_KEY=<key>` and `npx supabase@2.122.0 functions deploy food-search`.
- [ ] Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` for the release build to the hosted project (never the service role key).

## 3. TestFlight

- [ ] Paid Apple Developer Program membership (the free team cannot upload). Re-enable Sign in with Apple in the entitlements only if it ships; it is out of scope now.
- [ ] App Store Connect app record for `com.shivamlalakiya.leaderboard`, HealthKit capability on the App ID, privacy nutrition labels covering Health, food and photos (photos stay on device).
- [ ] Release build from `main` (Xcode archive after `npx expo run:ios --configuration Release --device`, or EAS once `eas.json` exists), upload, wait for processing.
- [ ] Add internal testers, install on one tester phone, and repeat sections 1 and 7 of the device checklist against the hosted backend.

## 4. Phone sign-in (#100), your decision

Phone OTP is in the code but no text is ever sent: real SMS needs a paid provider (Twilio or similar) configured in Supabase Auth. Email OTP and Google already work, so the first release can ship without it. Options:

- Hide the "Use Phone Number Instead" button on the sign-in screen (`src/app/sign-in.tsx`, a small change) for the first release and keep #100 open (no cost). Today it is visible and testers who tap it never get a code.
- Or set up the provider, put a spend cap on it, test with your own number, then close #100.
