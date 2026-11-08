import { act } from 'react';
import { createRoot } from 'test-renderer';

import Water from '@/app/(tabs)/(summary)/water';
import WaterEntryDetail from '@/app/(tabs)/(summary)/water/entry/[id]';
import { entryFromRow, type WaterEntry } from '@/lib/water/entries';

const mockLoadDay = jest.fn();
const mockLog = jest.fn();
let mockNotices: string[] = [];
let mockUnit = 'ml';
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true, push: jest.fn() }),
  useLocalSearchParams: () => ({ date: '2026-11-06', id: 'e1' }),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]),
  useSegments: () => [],
}));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'u1' } } }) }));
jest.mock('@/lib/health/sync', () => ({ useHealthSync: () => ({ connected: false, metrics: {}, sync: async () => {} }) }));
// Stable, like the real hook: a new sync each render would reload the day forever.
const mockChoice = { sync: async () => {}, deleted: async () => {} };
jest.mock('@/components/water/WaterExportOption', () => ({ useWaterExport: () => mockChoice, WaterExportOption: () => null }));
jest.mock('@/lib/water/units', () => ({ ...jest.requireActual('@/lib/water/units'), useWaterUnit: () => [mockUnit, () => {}] }));
jest.mock('@/lib/water/entries', () => ({
  ...jest.requireActual('@/lib/water/entries'),
  loadWaterDay: (...a: unknown[]) => mockLoadDay(...a),
  logWater: (...a: unknown[]) => mockLog(...a),
  getWaterTarget: async () => null,
  waterQueue: { flushPending: async () => 0, takeNotices: () => mockNotices.splice(0) },
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const entry = (o: Record<string, unknown> = {}): WaterEntry =>
  entryFromRow({ id: 'e1', client_id: 'c1', source: 'manual', ml: 500, consumed_at: '2026-11-06T18:00:00Z', timezone: 'UTC', local_date: '2026-11-06', ...o } as never);
const loaded = (entries: WaterEntry[]) => ({ entries, error: null, waiting: { count: 0, error: null } });

let root: ReturnType<typeof createRoot>;
afterEach(() => act(() => root?.unmount()));
async function render(el: React.ReactElement) {
  root = createRoot();
  await act(async () => root.render(el));
  return root.container as any;
}
const dump = (c: unknown) => JSON.stringify(c, (k, v) => (k === 'refreshControl' || k === '_owner' ? undefined : v));
const press = (c: any, label: string) => act(async () => c.queryAll((n: any) => n.props.accessibilityLabel === label && n.props.onClick)[0].props.onClick());

beforeEach(() => {
  jest.clearAllMocks();
  mockUnit = 'ml';
  mockLog.mockResolvedValue(true);
});

test('a day with no entries says "No water logged", never 0 mL; a day with entries shows the total and sources', async () => {
  mockLoadDay.mockResolvedValue(loaded([]));
  let text = dump(await render(<Water />));
  expect(text).toContain('No water logged');
  expect(text).not.toMatch(/\b0 mL/);
  act(() => root.unmount());
  mockLoadDay.mockResolvedValue(loaded([entry(), entry({ id: 'e2', client_id: null, source: 'healthkit', source_name: 'WaterMinder', ml: 750 })]));
  text = dump(await render(<Water />));
  expect(text).toContain('1.25 L');
  expect(text).toContain('Added here');
  expect(text).toContain('From Apple Health · WaterMinder');
  expect(text).not.toContain('Your target');
});

test('an edit dropped because the entry was deleted on another device is reported', async () => {
  mockNotices = ['This entry was deleted on another device.'];
  mockLoadDay.mockResolvedValue(loaded([]));
  expect(dump(await render(<Water />))).toContain('This entry was deleted on another device.');
});

test('quick add in fl oz logs the amount in mL', async () => {
  mockUnit = 'floz';
  mockLoadDay.mockResolvedValue(loaded([]));
  const c = await render(<Water />);
  await press(c, 'Add 8 fl oz');
  expect(mockLog).toHaveBeenCalledWith(236.6, expect.any(Date));
});

test('an invalid custom amount shows the error and logs nothing', async () => {
  mockLoadDay.mockResolvedValue(loaded([]));
  const c = await render(<Water />);
  await act(async () => c.queryAll((n: any) => n.props.accessibilityLabel?.startsWith('Amount (mL)') && n.props.onChangeText)[0].props.onChangeText('6000'));
  await press(c, 'Log Water');
  expect(mockLog).not.toHaveBeenCalled();
  expect(dump(c)).toContain('Enter an amount above 0 and up to 5000 mL.');
});

test('an imported entry is read-only', async () => {
  mockLoadDay.mockResolvedValue(loaded([entry({ client_id: null, source: 'healthkit', source_name: 'WaterMinder' })]));
  const c = await render(<WaterEntryDetail />);
  const text = dump(c);
  expect(text).toContain('From Apple Health · WaterMinder');
  expect(text).toContain('use the Health app');
  expect(text).not.toContain('Save Changes');
  expect(text).not.toContain('Delete Entry');
});
