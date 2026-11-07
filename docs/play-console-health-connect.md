# Play Console: Health Connect declaration notes

Notes for filling in the Health Connect declaration in the Google Play Console before the first Android release that reads or writes Health Connect data. Nothing here has been submitted. Fill it in from the Play Console itself (App content, then the health apps / Health Connect declaration), because Google changes the form; the answers below are what this app does today, taken from the code.

## What the app reads and writes

Keep this table equal to `android.permissions` in `app.config.ts`. Google rejects declarations that list a permission the manifest does not request, and Health Connect refuses at runtime any permission the manifest does not declare.

| Permission | Data | Why the app needs it | Where in the app |
| --- | --- | --- | --- |
| `android.permission.health.READ_STEPS` | Steps | Daily step totals for the user's own history, group leaderboards and step competitions. Steps are shared with a group on join (that is what a group is for) and the member can turn it off per group. | Summary, Steps, group leaderboards, competitions |
| `android.permission.health.READ_SLEEP` | Sleep sessions | One nightly sleep total per day for history and opt-in group sharing. | Summary, Sleep history |
| `android.permission.health.READ_WEIGHT` | Weight | Weight readings for the user's own history; the latest reading is shown to a group only if the user opts in for that group. | Weight history |
| `android.permission.health.READ_EXERCISE` | Exercise sessions | Workout summaries (type, start, end, duration) for workout history and opt-in workout competitions. Routes are not read. | Workouts |
| `android.permission.health.READ_HEALTH_DATA_HISTORY` | Older data | First import reaches back about 90 days (steps, sleep) and further for weight, past Health Connect's default 30 days. Only if the build requests it. | First import |
| `android.permission.health.WRITE_WEIGHT` | Weight | Saves weight the user types into the app to Health Connect, only after the user turns that on. | Weight entry |
| `android.permission.health.WRITE_SLEEP` | Sleep sessions | Saves manually entered sleep, only after the user turns that on. | Sleep entry |
| `android.permission.health.WRITE_EXERCISE` | Exercise sessions | Saves workouts logged in the app, only after the user turns that on. | Workout logging |
| `android.permission.health.WRITE_NUTRITION` | Nutrition | Saves food logged in the app, only after the user turns that on. | Food diary |

Not requested: background reads (`READ_HEALTH_DATA_IN_BACKGROUND`; sync runs only while the app is open), exercise routes, hydration (water is not built for Android yet), steps writes (left out on purpose so Health Connect's step totals never count the app's own entries).

Final list check before submitting:

```bash
npx expo config --type introspect --platform android | grep 'android.permission.health'
```

## Answers for the declaration

- Core purpose: a social fitness app where friends share chosen health metrics in private groups and run competitions. Health data is the core feature, not incidental.
- Who sees the data: the user, plus members of groups the user belongs to, per metric and per group. Steps are shared on join and can be turned off; sleep, weight, workouts and food are shared only after an explicit opt-in for that group.
- Storage: uploaded to the app's Supabase backend under the user's account (row-level security, owner-only by default). Local journal on the device is encrypted (SQLCipher).
- Not used for: advertising, selling, credit or insurance decisions, or any purpose other than showing the data back to the user and to groups they chose. No third-party analytics receive health data.
- Deletion: in-app "Delete imported Health data" removes imported rows from the server; account deletion removes everything. Disconnecting stops imports.
- Users can revoke in Health Connect at any time; the app checks granted permissions before every sync and shows the metric as needing permission.

## Things the Play Console will need that only the owner can provide

- A public privacy policy URL that names Health Connect data, what is collected, why, retention and deletion. The in-app privacy screen is `/profile/privacy` (`src/app/privacy.tsx` redirects there); the hosted policy must say the same.
- The permissions rationale screen: Health Connect opens the app with `androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE` (Android 13 and lower) or the `VIEW_PERMISSION_USAGE` activity alias (Android 14+). The `react-native-health-connect` config plugin adds both to the manifest; it must land on a screen that shows the privacy policy. Confirm on a real device that tapping the privacy link in the Health Connect permission sheet opens it.
- Possibly a short demo video of each data type's use and the permission flow, if the form asks for one.
- Data safety form: declare health and fitness data as collected, not shared with third parties, encrypted in transit, deletable on request.

## Still to verify on a device or in the console

- The exact form fields and whether a video is required (changes over time).
- That review accepts `READ_HEALTH_DATA_HISTORY` with the 90-day import justification; if not, drop it and accept the 30-day first import (the app already reports truncated history honestly).
- Health Connect permission sheet shows every type above and nothing else.
