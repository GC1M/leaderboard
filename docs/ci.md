# CI

One workflow, `.github/workflows/ci.yml`. It runs on every pull request, on pushes to `main` and `develop`, and on demand (Actions tab, "Run workflow", or `gh workflow run ci.yml --ref <branch>`). A newer run on the same branch or PR cancels the older one; runs on `main` and `develop` are never cancelled. The workflow has read-only `contents` permission and every job has a timeout.

## Jobs

| Job | What it checks | Needs Docker to run locally |
| --- | --- | --- |
| `check` | `npm run typecheck`, `npm run lint`, `npm test -- --coverage` (fails below the coverage floor), then `expo export` for iOS and web with dummy env | no |
| `db` | `supabase start` applies every migration from scratch, `supabase test db` runs the pgTAP tests, and `supabase gen types typescript --local` must equal `src/lib/database.types.ts` byte for byte | yes |
| `smoke-api` | `scripts/smoke/api-smoke.mjs` against the local stack: two users, profile row, `save_manual_workout` round trip, owner-only RLS, `save_workout_template` then apply, group create and join by invite code, workout sharing (off by default, count and duration only, revoke hides it again), anonymous access denied, `delete_my_account` cleanup | yes |
| `smoke-web` | Exports the web build against the local stack, serves it, and loads it in headless Chromium (`scripts/smoke/web-smoke.mjs`): the sign-in screen renders, no uncaught page errors, "Send Me a Code" reaches the real auth service, and with every Supabase call failing the app still renders and shows an error message instead of going blank | yes |
| `supply-chain` | `npm audit --omit=dev --audit-level=high` (report only, never fails the job) and a gitleaks scan of the full git history (fails the job on a finding) | gitleaks runs as a Docker image; `npm audit` does not need Docker |
| `ci-ok` | Succeeds only if all of the jobs above succeeded. This is the one status to make required | no |

## Run the checks locally

Node 22, `npm ci` first.

```bash
npm run typecheck && npm run lint
npm test -- --coverage          # prints the summary, writes coverage/ (lcov, json-summary)
npm audit --omit=dev --audit-level=high
```

With Docker running and the Supabase CLI at 2.122.0 (`npx supabase@2.122.0 ...`):

```bash
supabase start
supabase test db
supabase gen types typescript --local | diff -u src/lib/database.types.ts -   # no output means no drift
npm run smoke:api               # reads URL and keys from `supabase status -o env`; never prints them
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key from supabase status> \
  npx expo export --platform web --output-dir dist
npx playwright install chromium   # first time only
npm run smoke:web               # serves dist/ and drives Chromium
```

`node scripts/smoke/web-smoke.mjs dist` (without `--backend`) skips the check that needs the stack, so it also works against a build exported with a dummy URL.

## Reading a failure

- `check`: the failing step names the check. A coverage failure prints which metric is under the floor ("coverage threshold for statements (77%) not met"). The `jest-coverage` artifact has the lcov report; open `coverage/lcov-report/index.html`.
- `db`, "Generated types match": the job summary shows the diff, and the `database-types-generated` artifact holds the generated file. Regenerate and commit: `npx supabase@2.122.0 gen types typescript --local > src/lib/database.types.ts`. Do not hand-edit that file.
- `db`, other steps: a migration failed to apply (the error names the file) or a pgTAP test failed.
- `smoke-api`: each step prints `ok` or `FAIL <step>` with the expected and actual values. The last step of a failing job dumps the tail of the auth, REST and database container logs.
- `smoke-web`: the failure line names the check; the `web-smoke-screenshots` artifact has a screenshot of the page at that moment.
- `supply-chain`: open the job summary for the `npm audit` report. A gitleaks failure lists rule, file, line and short commit hash (secret values are redacted); the `gitleaks-report` artifact has the same as JSON. If it is a real secret, rotate it first; rewriting history is not enough.

## Coverage floor

`jest.coverageThreshold.global` in `package.json` is a floor set just below the numbers measured when it was added (statements 79.65%, branches 73.32%, functions 75.47%, lines 83.02% became 77, 71, 73, 81). It only catches regressions. Coverage covers files that tests import, so a screen with no test is not counted against the percentage.

To ratchet: run `npm test -- --coverage`, and when the summary is two or more points above a floor, raise that floor to about one point under the new number in `package.json` in the same PR that added the tests. Never lower a floor to get a PR through without saying why in the PR.

## Report-only and blocking

- `npm audit` is report-only because of pre-existing findings: when it was added it reported 6 high severity entries from `node-forge` (GHSA-86w9-cpqp-85rv) and `zod` (GHSA-mrhx-c7xc-m3w5), reached through `expo` and `@expo/cli`. The fix is an Expo upgrade, not something to patch here. To make it blocking, delete `continue-on-error: true` from that step once the report is clean.
- gitleaks found nothing in the history when it was added, so it blocks.

## Making `ci-ok` required (repository admin)

This is a repository setting, so CI does not do it for you. Settings, Branches, edit the rule for `develop` (and `main`), enable "Require status checks to pass before merging", search for `ci-ok`, select it, and save. One check is enough because `ci-ok` fails if any other job fails, is skipped or is cancelled. If you add a job to the workflow, add it to `needs` of `ci-ok`.

## Known limits

- iOS simulator runs are not part of required CI. HealthKit and SQLCipher need a signed native build on a physical iPhone (see "Apple Health needs a native build" in the README), and a simulator build would not exercise Health. CI only checks that the iOS bundle compiles (`expo export --platform ios`). Health import and sync logic is covered by unit tests and the pgTAP tests, not end to end.
- `smoke-web` does not sign in: reading the emailed code is out of scope, so it stops at "the code step appears". Signed-in screens are not rendered in a browser by CI.
- The smoke tests run against one local stack with default config. They do not cover Google or Apple sign-in, phone OTP, storage or edge functions.
- Coverage only counts files that tests import (see above), so the global percentage overstates how much of the app is tested.
- Docker-based jobs start the full Supabase stack and take a few minutes each; `smoke-api` and `smoke-web` skip the services they do not use.
- The `supabase` CLI version is pinned to 2.122.0 in the workflow; generated types differ between CLI versions, so bump the pin and regenerate `database.types.ts` together.
