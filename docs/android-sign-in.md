# Android sign-in, links and lifecycle (issue #62)

Android offers email one-time codes and Google. Sign in with Apple is iOS only and is hidden on Android. Phone codes work the same as on iOS when the Supabase SMS provider is on.

## Google Cloud OAuth clients

Create these in one Google Cloud project (APIs and Services, Credentials). Never put real IDs in the repo; only the web client ID goes in `.env` or EAS environment variables.

1. **Web application** client. Its ID is `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`. The app passes it to `GoogleSignin.configure({ webClientId })` so the ID token's audience is the web client, which Supabase checks. Its client secret goes only in the Supabase dashboard, never in the app.
2. **Android** clients, one per signing key, each with package name `com.shivamlalakiya.leaderboard` and that key's SHA-1:
   - the debug keystore (`keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android`, or `cd android && ./gradlew signingReport` after `npx expo prebuild`)
   - the EAS upload key (`eas credentials`, Android, shows the SHA-1)
   - the Play App Signing key (Play Console, Test and release, App integrity, App signing key certificate)

   Android clients have no secret and their IDs are not used by the app. Google matches them by package name plus the signature of the installed APK. A missing or wrong SHA-1 shows up as `DEVELOPER_ERROR` (code `10`), which the app reports as "Google sign-in isn't set up for this version of the app".

The iOS client and `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` / `GOOGLE_IOS_URL_SCHEME` are only for iOS. The Google config plugin is only added when `GOOGLE_IOS_URL_SCHEME` is set; without Firebase it only edits the iOS Info.plist, so an Android-only build needs nothing from it (the native module is autolinked either way).

## Supabase dashboard

Authentication, Sign In / Providers, Google: enable it, set the Web client ID and secret. If you list more than one client ID (for example the iOS client too), use the comma separated Client IDs field. The Android client IDs only need adding there if you ever send Android-audience tokens; this app always requests web-audience tokens. Email provider must stay on for one-time codes.

## How the app behaves on Android

- Google button shows only with `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` set and the native module present (hidden in Expo Go).
- Before the picker the app calls `hasPlayServices` (missing or old Play services gets the update dialog and a plain message), then clears the cached Google account so the picker always shows. That keeps account switching possible after sign-out.
- The one-time code field uses `autoComplete="one-time-code"`, which React Native maps to Android's `sms-otp` autofill hint.
- Session is stored with expo-secure-store (Android Keystore) and survives restarts; refresh pauses in the background. Sign-out and account deletion clear per-account local state the same way as on iOS, and the navigation stack is keyed by user ID so the next account starts clean.
- Join links (`leaderboard://join/<CODE>`, optionally `?competition=<id>`) go through the same JS flow on both platforms: a signed-out user is sent to sign-in, the invite is parked in memory and its confirmation screen reopens after sign-in. A link never joins or enrolls by itself and every group read is still behind RLS.
- Android back on a join screen opened from outside goes home instead of closing the app.

## Not done (follow-ups)

- **Install handoff.** A link tapped before the app is installed is lost on both platforms; Android would need the Play Install Referrer or a link service.
- **Android App Links** (verified `https://` links with `assetlinks.json`). Only the custom `leaderboard://` scheme is registered.
- **CSV share into the app** stays iOS only. Android would need a `text/csv` VIEW/SEND intent filter and reading the `content://` URI in the import route.

## Device checks (need a real Android device and the Google Cloud setup)

1. Email code: request, autofill or type, signed in.
2. Google: picker appears, sign in, sign out, sign in again with a different account.
3. Device without Play services or with an unregistered SHA-1: plain error, email code still works.
4. Kill the app and reopen: still signed in.
5. Signed out, open `adb shell am start -a android.intent.action.VIEW -d "leaderboard://join/ABCD2345"`: sign-in, then the join confirmation. Repeat with the app killed (cold start) and in the background (warm start).
6. Signed in, open the same link cold, press back: lands on the home tab, the app stays open.
7. Grant a permission from Settings and return: the app resumes on the same screen and keeps the session.
