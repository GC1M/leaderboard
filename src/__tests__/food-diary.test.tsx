import { act } from 'react';
import { createRoot } from 'test-renderer';

import Diary from '@/app/(tabs)/(summary)/food/diary';
import { type Entry, entryFromRow } from '@/lib/food/diary';

const mockLoadDay = jest.fn();
const mockFlush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true, push: jest.fn() }),
  useLocalSearchParams: () => ({ date: '2026-11-06' }),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]),
  useSegments: () => [],
}));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'u1' } } }) }));
jest.mock('@/lib/food/pending', () => ({ flushPending: (...a: unknown[]) => mockFlush(...a), takeNotices: () => [] }));
jest.mock('@/lib/food/diary', () => ({ ...jest.requireActual('@/lib/food/diary'), loadDay: (...a: unknown[]) => mockLoadDay(...a) }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const entry = (o: Record<string, unknown> = {}, pending: Entry['pending'] = null): Entry =>
  entryFromRow({
    id: 'e1', client_id: 'c1', meal: 'lunch', consumed_at: '2026-11-06T18:00:00Z', timezone: 'UTC', local_date: '2026-11-06', grams: 150,
    food_name: 'Granola', provider: 'custom', is_estimated: true, energy_kcal: 450, protein_g: 10, carbs_g: null, fat_g: 12, ...o,
  } as never, pending, pending ? "Couldn't sync. Check your connection and retry." : null);

let root: ReturnType<typeof createRoot>;
afterEach(() => act(() => root?.unmount()));
async function render() {
  root = createRoot();
  await act(async () => root.render(<Diary />));
  return root.container as any;
}
// The refresh control prop is a React element that points back at its owner, so it is left out.
const dump = (c: unknown) => JSON.stringify(c, (k, v) => (k === 'refreshControl' || k === '_owner' ? undefined : v));
const label = (c: any, text: string) => c.queryAll((n: any) => n.props.accessibilityLabel?.includes(text))[0]?.props.accessibilityLabel;

beforeEach(() => {
  jest.clearAllMocks();
  mockFlush.mockResolvedValue(0);
});

test('a day with no entries says "No food logged", never 0 kcal', async () => {
  mockLoadDay.mockResolvedValue({ entries: [], error: null });
  const text = dump(await render());
  expect(text).toContain('No food logged');
  expect(text).not.toContain('0 kcal');
  expect(text).not.toContain('Day total');
});

test('an entry shows its name, amount, kcal and Custom and Estimate tags, and unknown totals are flagged incomplete', async () => {
  mockLoadDay.mockResolvedValue({ entries: [entry()], error: null });
  const c = await render();
  expect(label(c, 'Granola')).toBe('Granola, 150 g, 450 kcal, Custom, Estimate');
  const text = dump(c);
  expect(text).toContain('Custom · Estimate');
  expect(text).toContain('Lunch, 450 kcal');
  expect(text).toContain('incomplete');
  expect(label(c, 'Carbs, ')).toBe('Carbs, Unknown');
});

test('an entry waiting to sync is marked Not synced, with the failure and a retry', async () => {
  mockLoadDay.mockResolvedValue({ entries: [entry({ id: undefined, is_estimated: false }, 'log')], error: null });
  const c = await render();
  expect(label(c, 'Granola')).toBe('Granola, 150 g, 450 kcal, Custom, Not synced');
  const text = dump(c);
  expect(text).toContain('1 change is not synced yet');
  expect(label(c, 'Retry Sync')).toBe('Retry Sync');
  mockLoadDay.mockClear();
  await act(async () => c.queryAll((n: any) => n.props.accessibilityLabel === 'Retry Sync' && n.props.onClick)[0].props.onClick());
  expect(mockFlush).toHaveBeenCalledTimes(2);
  expect(mockLoadDay).toHaveBeenCalled();
});

test('a failed load with nothing to show does not read as an empty day, and offers Try Again', async () => {
  mockLoadDay.mockResolvedValue({ entries: [], error: "Couldn't load your food. Pull down to try again." });
  const c = await render();
  const text = dump(c);
  expect(text).toContain("Couldn't load your food");
  expect(text).not.toContain('No food logged');
  mockLoadDay.mockResolvedValue({ entries: [], error: null });
  await act(async () => c.queryAll((n: any) => n.props.accessibilityLabel === 'Try Again' && n.props.onClick)[0].props.onClick());
  expect(dump(c)).toContain('No food logged');
});

test('a failed load still shows entries saved on the device', async () => {
  mockLoadDay.mockResolvedValue({ entries: [entry({ id: undefined }, 'log')], error: "Couldn't load your food. Pull down to try again." });
  expect(label(await render(), 'Granola')).toContain('Not synced');
});
