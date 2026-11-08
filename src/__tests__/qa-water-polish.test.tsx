// QA (issue #155): water screen polish. Each test here failed before its fix.
import { act } from 'react';
import { createRoot } from 'test-renderer';

import Water from '@/app/(tabs)/(summary)/water';
import WaterEntryDetail from '@/app/(tabs)/(summary)/water/entry/[id]';
import { entryFromRow, type WaterEntry } from '@/lib/water/entries';

const mockLoadDay = jest.fn();
const mockSaveEdit = jest.fn();
const mockSetTarget = jest.fn();
let mockTarget: number | null = null;
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
const mockChoice = { sync: async () => {}, deleted: async () => {} };
jest.mock('@/components/water/WaterExportOption', () => ({ useWaterExport: () => mockChoice, WaterExportOption: () => null }));
jest.mock('@/lib/water/units', () => ({ ...jest.requireActual('@/lib/water/units'), useWaterUnit: () => [mockUnit, () => {}] }));
jest.mock('@/lib/water/entries', () => ({
  ...jest.requireActual('@/lib/water/entries'),
  loadWaterDay: (...a: unknown[]) => mockLoadDay(...a),
  saveWaterEdit: (...a: unknown[]) => mockSaveEdit(...a),
  getWaterTarget: async () => mockTarget,
  setWaterTarget: (...a: unknown[]) => mockSetTarget(...a),
  waterQueue: { flushPending: async () => 0, takeNotices: () => [] },
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
const type = (c: any, label: string, v: string) =>
  act(async () => c.queryAll((n: any) => n.props.accessibilityLabel?.startsWith(label) && n.props.onChangeText)[0].props.onChangeText(v));
const textNode = (c: any, s: string) => c.queryAll((n: any) => n.type === 'Text' && [n.props.children].flat().join('').startsWith(s))[0];

beforeEach(() => {
  jest.clearAllMocks();
  mockSaveEdit.mockResolvedValue(undefined);
  mockSetTarget.mockResolvedValue(undefined);
  mockLoadDay.mockResolvedValue(loaded([entry({ ml: 251.37 })]));
  mockTarget = null;
  mockUnit = 'ml';
});

test('saving an edit whose amount is the same number in other text keeps the stored mL', async () => {
  mockUnit = 'floz';
  const c = await render(<WaterEntryDetail />); // prefilled "8.5"
  await type(c, 'Amount (fl oz)', '8.50');
  await press(c, 'Save Changes');
  // before the fix: ml 251.4, a re-save that drifts the stored 251.37 mL
  expect(mockSaveEdit).toHaveBeenCalledWith('u1', expect.anything(), expect.objectContaining({ ml: undefined }));
});

test('the target limit is stated in fl oz when entering fl oz', async () => {
  mockUnit = 'floz';
  const c = await render(<Water />);
  await press(c, 'Set a Target');
  await type(c, 'Daily target (fl oz)', '700');
  await press(c, 'Save Target');
  expect(dump(c)).toContain('Enter a target above 0 and up to 676.3 fl oz.'); // before the fix: "up to 20 L"
  expect(mockSetTarget).not.toHaveBeenCalled();
});

test('a tiny stored entry shown as 0 fl oz can still be saved unchanged, for example after a time edit', async () => {
  mockUnit = 'floz';
  mockLoadDay.mockResolvedValue(loaded([entry({ ml: 0.4 })]));
  const c = await render(<WaterEntryDetail />); // prefilled "0"
  await press(c, 'Save Changes');
  expect(mockSaveEdit).toHaveBeenCalledWith('u1', expect.anything(), expect.objectContaining({ ml: undefined }));
});

test('an unchanged target that rounds to 0 in fl oz closes the editor instead of showing an error', async () => {
  mockUnit = 'floz';
  mockTarget = 0.4;
  const c = await render(<Water />);
  await act(async () => (c as any).queryAll((n: any) => n.props.accessibilityLabel?.startsWith('Target') && n.props.onClick)[0].props.onClick());
  await press(c, 'Save Target');
  expect(dump(c)).not.toContain('Enter a target above 0');
  expect(mockSetTarget).not.toHaveBeenCalled();
});

test('the day total scales with text size at least as much as the target caption', async () => {
  mockTarget = 2000;
  const c = await render(<Water />);
  const total = textNode(c, '251 mL');
  const caption = textNode(c, 'Your target');
  // before the fix: the total was capped at 1.5x while the caption under it was not
  expect(total.props.maxFontSizeMultiplier ?? Infinity).toBeGreaterThanOrEqual(caption.props.maxFontSizeMultiplier ?? Infinity);
});
