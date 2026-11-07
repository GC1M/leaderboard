import type { ExpoConfig } from 'expo/config';

// The Google plugin throws without an iOS URL scheme, so it is only added when one is configured.
// Scheme looks like com.googleusercontent.apps.<id>, the reversed iOS client ID.
const googleIosUrlScheme = process.env.GOOGLE_IOS_URL_SCHEME;

const config: ExpoConfig = {
  name: 'Leaderboard',
  slug: 'leaderboard',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'leaderboard',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: 'com.shivamlalakiya.leaderboard',
    usesAppleSignIn: true,
    infoPlist: {
      // Puts Leaderboard in the share sheet for CSV files, so a workout export from Strong, Hevy, Fitbod or JEFIT opens
      // the import preview (see src/app/+native-intent.tsx). iOS hands over a copy, never the other app's file.
      CFBundleDocumentTypes: [
        { CFBundleTypeName: 'CSV File', CFBundleTypeRole: 'Viewer', LSHandlerRank: 'Alternate', LSItemContentTypes: ['public.comma-separated-values-text'] },
      ],
      LSSupportsOpeningDocumentsInPlace: false,
    },
  },
  android: {
    package: 'com.shivamlalakiya.leaderboard',
    adaptiveIcon: {
      backgroundColor: '#2340D8',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    // Health Connect reads (#60) and writes of app-created entries (#61; never steps). History lets the first import reach
    // 90 days back instead of 30 days before the first grant.
    permissions: [
      'android.permission.health.READ_STEPS',
      'android.permission.health.READ_SLEEP',
      'android.permission.health.READ_WEIGHT',
      'android.permission.health.READ_EXERCISE',
      'android.permission.health.READ_HEALTH_DATA_HISTORY',
      'android.permission.health.WRITE_WEIGHT',
      'android.permission.health.WRITE_SLEEP',
      'android.permission.health.WRITE_EXERCISE',
      'android.permission.health.WRITE_NUTRITION',
    ],
  },
  web: {
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#0D1424',
        image: './assets/images/splash-icon.png',
        imageWidth: 76,
        dark: { backgroundColor: '#0B1020', image: './assets/images/splash-icon.png' },
      },
    ],
    'expo-secure-store',
    ['expo-sqlite', { useSQLCipher: true }],
    [
      '@kingstinct/react-native-healthkit',
      {
        NSHealthShareUsageDescription:
          'Leaderboard reads steps, sleep, weight, and workouts from Apple Health and uploads daily step totals, nightly sleep summaries, weight readings, and workout summaries to your private account. Choose what to share separately in each group. Never your location.',
        NSHealthUpdateUsageDescription:
          'Leaderboard can save things you log in the app, such as weight, to Apple Health. It only asks for the types you choose and never changes data from other apps.',
        background: false,
      },
    ],
    // Adds the Health Connect permission rationale intent filter and activity alias. The library needs Android 8 (API 26).
    'react-native-health-connect',
    ['expo-build-properties', { android: { minSdkVersion: 26 } }],
    'expo-apple-authentication',
    [
      'expo-image-picker',
      {
        photosPermission: 'Leaderboard reads a photo you choose of a nutrition label or menu to fill in food details. The photo is read on your iPhone and is not uploaded.',
        cameraPermission: 'Leaderboard uses the camera to photograph a nutrition label or menu. The photo is read on your iPhone and is not uploaded.',
        microphonePermission: false,
      },
    ],
    ...(googleIosUrlScheme
      ? [['@react-native-google-signin/google-signin', { iosUrlScheme: googleIosUrlScheme }] as [string, object]]
      : []),
  ],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
