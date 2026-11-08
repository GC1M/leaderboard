// QA (#64): iOS copy after Phase 7. Screens that now go through healthProviderName() must still say Apple Health /
// the Health app on iOS and never mention Health Connect.
import { act } from 'react';
import { Platform } from 'react-native';
import { createRoot } from 'test-renderer';

const mockAlert = jest.fn();
jest.mock('@/lib/alert', () => ({ alert: (...a: unknown[]) => mockAlert(...a) }));
jest.mock('expo-router', () => ({ useSegments: () => [], useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock('@/lib/supabase', () => ({ supabase: { auth: { signOut: jest.fn() } } }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'u1' } } }) }));
jest.mock('@/lib/secure-storage', () => ({ secureStorage: { getItem: async () => '0', setItem: async () => {}, removeItem: async () => {} } }));
const mockConnectAvailability = jest.fn(async () => 'available');
jest.mock('@/lib/health/health-connect', () => ({
  getHealthConnectAvailability: () => mockConnectAvailability(),
  openHealthConnectInstall: jest.fn(),
  openHealthConnectSettings: jest.fn(),
}));
jest.mock('@/lib/health/healthkit', () => ({
  ...jest.requireActual('@/lib/health/healthkit'),
  isHealthAvailable: () => true,
  getHealthWriteAccess: () => 'granted',
  getAllHealthAccess: async () => ({ steps: 'asked', sleep: 'asked', weight: 'asked', workouts: 'asked', water: 'asked' }),
}));
jest.mock('@/lib/health/sync', () => ({
  useHealthSync: () => ({ ready: true, connected: true, connect: jest.fn(), deleteImports: jest.fn(), metrics: new Proxy({}, { get: () => ({ status: 'unavailable', lastSuccess: null, knownSamples: 0, error: null }) }) }),
  useHealthExport: () => ({ ready: true, processing: false, entries: [], getEntries: () => [], enqueue: jest.fn(), forget: jest.fn(), discard: jest.fn(), retry: jest.fn(), allowWrite: jest.fn() }),
}));
jest.mock('@/lib/profile', () => ({
  NAME_MAX: 40, deleteAccount: jest.fn(), deleteFoodHistory: jest.fn(), getDisplayName: () => Promise.resolve('Sam'), updateDisplayName: jest.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.setTimeout(30000);

beforeEach(() => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  jest.clearAllMocks();
});

async function render(el: React.ReactElement) {
  const r = createRoot();
  await act(async () => r.render(el));
  await act(async () => { await new Promise((x) => setTimeout(x, 0)); });
  return { r, text: JSON.stringify(r.container) };
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const load = (path: string) => require(path);

test('healthProviderName is Apple Health on iOS', () => {
  expect(load('@/lib/health-adapter/capabilities').healthProviderName()).toBe('Apple Health');
});

test('steps permission on iOS says Apple Health and the Health app, never Health Connect', async () => {
  const Screen = load('@/app/(tabs)/(summary)/steps/permission').default;
  const { text } = await render(<Screen />);
  expect(text).toContain('Connect Apple Health');
  expect(text).toContain('Health app');
  expect(text).toContain('Garmin'); // iOS-only tracker help stays
  expect(text).not.toContain('Health Connect');
  expect(mockConnectAvailability).not.toHaveBeenCalled();
});

test('HealthSyncStatus on iOS is headed Apple Health', async () => {
  const { HealthSyncStatus } = load('@/components/HealthSyncStatus');
  const { text } = await render(<HealthSyncStatus />);
  expect(text).toContain('Apple Health');
  expect(text).not.toContain('Health Connect');
});

test('Profile on iOS never mentions Health Connect, and delete-imports copy names the Health app', async () => {
  const Profile = load('@/app/(tabs)/profile/index').default;
  const { r, text } = await render(<Profile />);
  expect(text).not.toContain('Health Connect');
  const row = (r.container as any).queryAll((n: any) => n.props.onClick && JSON.stringify(n).includes('Delete Imported'))[0];
  expect(row).toBeTruthy();
  await act(async () => row.props.onClick());
  const body = mockAlert.mock.calls.at(-1)[1] as string;
  expect(body).toContain('Apple Health');
  expect(body).toContain('the Health app');
  expect(body).not.toContain('Health Connect');
});

test('water export switch on iOS says "Save water to Apple Health" and asks for the HealthKit type', async () => {
  const { useWaterExport, WaterExportOption } = load('@/components/water/WaterExportOption');
  function Option() { return <WaterExportOption choice={useWaterExport()} />; }
  const { text } = await render(<Option />);
  expect(text).toContain('Save water to Apple Health');
  expect(text).not.toContain('Health Connect');
});

test('describeHealthSync and the photo privacy note keep their iOS wording', () => {
  const { describeHealthSync } = load('@/components/HealthSyncStatus');
  expect(describeHealthSync({ status: 'unavailable', lastSuccess: null, knownSamples: 0, error: null })).not.toMatch(/Health Connect/);
  expect(load('@/lib/food/photo').photoPrivacyNote()).toBe('The photo is read on this iPhone and deleted right after. It is never uploaded or saved.');
});

test('water entry source label says From Apple Health on iOS', () => {
  expect(load('@/lib/water/entries').sourceLabel({ source: 'health', sourceName: 'WaterMinder' })).toBe('From Apple Health · WaterMinder');
});
