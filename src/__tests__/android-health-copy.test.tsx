import { act } from 'react';
import { Platform } from 'react-native';
import { createRoot } from 'test-renderer';

const mockInstall = jest.fn();
let mockAvailability = 'provider-update-required';
jest.mock('expo-router', () => ({ useSegments: () => [], useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock('@/lib/health/sync', () => ({ useHealthSync: () => ({ connect: jest.fn() }) }));
jest.mock('@/lib/health/health-connect', () => ({
  getHealthConnectAvailability: async () => mockAvailability,
  openHealthConnectInstall: () => mockInstall(),
  openHealthConnectSettings: jest.fn(),
}));
jest.mock('@/lib/health/healthkit', () => ({
  getAllHealthAccess: async () => (mockAvailability === 'available'
    ? { steps: 'asked', sleep: 'asked', weight: 'asked', workouts: 'asked' }
    : { steps: 'unavailable', sleep: 'unavailable', weight: 'unavailable', workouts: 'unavailable' }),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.setTimeout(30000); // first render cold-loads react-native, slow on CI

beforeEach(() => jest.replaceProperty(Platform, 'OS', 'android'));

async function render(path: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Screen = require(path).default;
  const r = createRoot();
  await act(async () => r.render(<Screen />));
  return { r, text: JSON.stringify(r.container) };
}

test('Health access on Android names Health Connect and offers the Play Store when it is missing', async () => {
  const { r, text } = await render('@/app/(tabs)/(summary)/steps/permission');
  expect(text).toContain('Connect Health Connect');
  expect(text).toContain('missing or needs an update');
  expect(text).not.toMatch(/Apple Health|iPhone|Garmin/);
  const button = (r.container as any).queryAll((n: any) => n.props.onClick && JSON.stringify(n).includes('"Get Health Connect"'))[0];
  await act(async () => button.props.onClick());
  expect(mockInstall).toHaveBeenCalled();
});

test('Health access on Android points to Health Connect settings once answered', async () => {
  mockAvailability = 'available';
  const { text } = await render('@/app/(tabs)/(summary)/steps/permission');
  expect(text).toContain('App permissions');
  expect(text).toContain('Open Health Connect');
  expect(text).not.toContain('Health app');
});

test('the privacy policy on Android never mentions Apple Health or the iPhone', async () => {
  const { text } = await render('@/app/(tabs)/profile/privacy');
  expect(text).toContain('What Leaderboard reads from Health Connect');
  expect(text).toContain('about 30 days');
  expect(text).toContain('What Leaderboard saves to Health Connect');
  expect(text).toContain('Steps are not saved to Health Connect.');
  expect(text).not.toMatch(/Apple Health|iPhone|distance or energy only if/);
});

test('sync status explains a truncated Health Connect import', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { describeHealthSync } = require('@/components/HealthSyncStatus');
  expect(describeHealthSync({ status: 'synced', lastSuccess: null, knownSamples: 3, error: null, truncatedFrom: new Date(2026, 9, 1).toISOString() }))
    .toMatch(/^Import completed\. Showing data since .*allow access to past data in Health Connect/);
  expect(describeHealthSync({ status: 'unavailable', lastSuccess: null, knownSamples: 0, error: null })).toMatch(/Health Connect/);
});
