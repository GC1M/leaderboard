// QA (issue #58): units and amount entry on the Water screen. Each test here failed before its fix.
import { act } from 'react';
import { createRoot } from 'test-renderer';

import Water from '@/app/(tabs)/(summary)/water';

const mockSetTarget = jest.fn();
let mockTarget: number | null = null;
let mockUnit = 'ml';
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true, push: jest.fn() }),
  useLocalSearchParams: () => ({ date: '2026-11-06' }),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]),
  useSegments: () => [],
}));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'u1' } } }) }));
jest.mock('@/lib/health/sync', () => ({ useHealthSync: () => ({ connected: false, metrics: {}, sync: async () => {} }) }));
const mockChoice = { sync: async () => {}, deleted: async () => {} };
jest.mock('@/components/water/WaterExportOption', () => ({ useWaterExport: () => mockChoice, WaterExportOption: () => null }));
// A real, switchable unit (the Segmented control calls the setter).
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/lib/water/units', () => ({ ...jest.requireActual('@/lib/water/units'), useWaterUnit: () => require('react').useState(mockUnit) }));
jest.mock('@/lib/water/entries', () => ({
  ...jest.requireActual('@/lib/water/entries'),
  loadWaterDay: async () => ({ entries: [], error: null, waiting: { count: 0, error: null } }),
  logWater: async () => true,
  getWaterTarget: async () => mockTarget,
  setWaterTarget: (...a: unknown[]) => mockSetTarget(...a),
  waterQueue: { flushPending: async () => 0, takeNotices: () => [] },
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

let root: ReturnType<typeof createRoot>;
afterEach(() => act(() => root?.unmount()));
async function render() {
  root = createRoot();
  await act(async () => root.render(<Water />));
  return root.container as any;
}
const press = (c: any, label: string) => act(async () => c.queryAll((n: any) => n.props.accessibilityLabel === label && n.props.onClick)[0].props.onClick());
const type = (c: any, label: string, v: string) =>
  act(async () => c.queryAll((n: any) => n.props.accessibilityLabel?.startsWith(label) && n.props.onChangeText)[0].props.onChangeText(v));

beforeEach(() => {
  jest.clearAllMocks();
  mockSetTarget.mockResolvedValue(undefined);
  mockTarget = null;
  mockUnit = 'ml';
});

test('saving the target in fl oz without changing it keeps the stored mL', async () => {
  mockTarget = 2000;
  mockUnit = 'floz';
  const c = await render();
  await act(async () => c.queryAll((n: any) => n.props.accessibilityLabel?.startsWith('Target') && n.props.onClick)[0].props.onClick());
  await press(c, 'Save Target'); // the field still holds the prefilled "67.6"
  // before the fix: setWaterTarget(u1, 1999.2), the target silently drops by 0.8 mL on every unchanged save
  expect(mockSetTarget).not.toHaveBeenCalledWith('u1', 1999.2);
});

test('switching units while editing the target does not reinterpret the typed number', async () => {
  mockUnit = 'floz';
  const c = await render();
  await press(c, 'Set a Target');
  await type(c, 'Daily target (fl oz)', '64'); // 64 fl oz is about 1892.7 mL
  await press(c, 'mL'); // the amount field is cleared on a unit switch; the target field is not
  // Before the fix Save Target stayed open and saved setWaterTarget(u1, 64), a 64 mL target the user never entered.
  const save = c.queryAll((n: any) => n.props.accessibilityLabel === 'Save Target' && n.props.onClick)[0];
  if (save) await act(async () => save.props.onClick());
  expect(mockSetTarget).not.toHaveBeenCalledWith('u1', 64);
});
