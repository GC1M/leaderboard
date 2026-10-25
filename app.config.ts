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
  },
  android: {
    package: 'com.shivamlalakiya.leaderboard',
    adaptiveIcon: {
      backgroundColor: '#2340D8',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
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
    [
      '@kingstinct/react-native-healthkit',
      {
        NSHealthShareUsageDescription:
          'Leaderboard reads your daily step count from Apple Health so your friends see a score they can trust. Only daily totals are uploaded, never your location or workouts.',
        NSHealthUpdateUsageDescription: false,
        background: false,
      },
    ],
    'expo-apple-authentication',
    ...(googleIosUrlScheme
      ? [['@react-native-google-signin/google-signin', { iosUrlScheme: googleIosUrlScheme }] as [string, object]]
      : []),
  ],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
