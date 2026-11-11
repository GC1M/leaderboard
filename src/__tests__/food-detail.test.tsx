import { act } from 'react';
import { createRoot } from 'test-renderer';

import FoodDetail from '@/app/(tabs)/(summary)/food/[id]';
import { emptyNutrients } from '@/lib/food/nutrition';
import type { Food } from '@/lib/food/search';

const mockLog = jest.fn();
const mockGetFood = jest.fn();
const mockReplace = jest.fn();
const mockDismissTo = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true, replace: (...a: unknown[]) => mockReplace(...a), dismissTo: (...a: unknown[]) => mockDismissTo(...a) }),
  useLocalSearchParams: () => ({ id: 'f1' }),
  useSegments: () => [],
}));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/timezone', () => ({ deviceTimezone: () => 'UTC' }));
let mockUuid = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `client-${++mockUuid}` }));
jest.mock('@/lib/food/search', () => ({ ...jest.requireActual('@/lib/food/search'), getFood: (...a: unknown[]) => mockGetFood(...a) }));
jest.mock('@/lib/food/log', () => ({ ...jest.requireActual('@/lib/food/log'), logFood: (...a: unknown[]) => mockLog(...a) }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const banana: Food = {
  id: 'f1', name: 'Bananas, raw', brand: null, provider: 'usda_fdc', providerId: '173944', sourceDataType: 'SR Legacy', sourceVersion: '2019-04-01',
  per100g: { ...emptyNutrients(), energy_kcal: 89, protein_g: 1.09, carbs_g: 22.84, fat_g: null },
  portions: [{ id: 'p1', label: 'medium', gramWeight: 118 }],
};

let root: ReturnType<typeof createRoot>;
afterEach(() => act(() => root?.unmount()));
async function render() {
  root = createRoot();
  await act(async () => root.render(<FoodDetail />));
  return root.container as any;
}
const find = (c: any, label: string, prop: string) => c.queryAll((n: any) => n.props[prop] && n.props.accessibilityLabel === label)[0];
const click = (c: any, label: string) => act(async () => find(c, label, 'onClick').props.onClick());
const type = (c: any, label: string, value: string) => act(async () => find(c, label, 'onChangeText').props.onChangeText(value));
const row = (c: any, label: string) => c.queryAll((n: any) => n.props.accessibilityLabel?.startsWith(`${label}, `))[0]?.props.accessibilityLabel;

beforeEach(() => {
  jest.clearAllMocks();
  mockUuid = 0;
  mockGetFood.mockResolvedValue(banana);
  mockLog.mockResolvedValue(undefined);
});

test('shows nutrition for the entered grams, Unknown for a missing nutrient, and the attribution', async () => {
  const c = await render();
  expect(row(c, 'Calories')).toBe('Calories, 89 kcal');
  expect(row(c, 'Protein')).toBe('Protein, 1.1 g');
  expect(row(c, 'Fat')).toBe('Fat, Unknown');
  await type(c, 'Amount (g)', '150');
  expect(row(c, 'Calories')).toBe('Calories, 134 kcal');
  expect(row(c, 'Carbs')).toBe('Carbs, 34.3 g');
  const text = JSON.stringify(c);
  expect(text).toContain('Department of Agriculture');
  expect(text).toContain('estimates, not medical advice');
});

test('an invalid amount blocks logging', async () => {
  const c = await render();
  await type(c, 'Amount (g)', '0');
  expect(find(c, 'Log Food', 'onClick').props.accessibilityState.disabled).toBe(true);
  expect(row(c, 'Calories')).toBe('Calories, -');
  await type(c, 'Amount (g)', '7,5,0');
  expect(find(c, 'Log Food', 'onClick').props.accessibilityState.disabled).toBe(true);
});

test('logging a portion sends the resolved quantity and shows a confirmation', async () => {
  const c = await render();
  await click(c, 'Portion');
  expect(JSON.stringify(c)).toContain('medium (118 g)');
  await type(c, 'Number of portions', '2');
  expect(row(c, 'Calories')).toBe('Calories, 210 kcal');
  await click(c, 'Dinner');
  await click(c, 'Log Food');
  expect(mockLog).toHaveBeenCalledTimes(1);
  expect(mockLog.mock.calls[0][0]).toMatchObject({
    food: banana, meal: 'dinner', clientId: 'client-1', quantity: { mode: 'portion', count: 2, portion: banana.portions[0] },
  });
  expect(JSON.stringify(c)).toContain('was added to dinner');
  await click(c, 'Log Another Food');
  // Pops back to the search screen already under this one instead of stacking a second copy.
  expect(mockDismissTo).toHaveBeenCalledWith('/food');
});

test('a failed save keeps the form and can be retried', async () => {
  mockLog.mockRejectedValueOnce(new Error("Couldn't log that food. Try again."));
  const c = await render();
  await click(c, 'Log Food');
  expect(JSON.stringify(c)).toContain("Couldn't log that food. Try again.");
  await click(c, 'Log Food');
  expect(mockLog.mock.calls.map((a) => a[0].clientId)).toEqual(['client-1', 'client-1']);
  expect(JSON.stringify(c)).toContain('was added to');
});

test('a retry, even with changed values, keeps one client id so it updates the same entry', async () => {
  mockLog.mockRejectedValue(new Error('fail'));
  const c = await render();
  await click(c, 'Log Food');
  await type(c, 'Amount (g)', '120');
  await click(c, 'Log Food');
  await click(c, 'Lunch');
  await click(c, 'Log Food');
  expect(mockLog.mock.calls.map((a) => a[0].clientId)).toEqual(['client-1', 'client-1', 'client-1']);
  expect(mockUuid).toBe(1);
});

test('says so when a shown nutrient is unknown, and uses the bounds message for a bad amount', async () => {
  const c = await render();
  expect(JSON.stringify(c)).toContain('Some values are unknown for this food.');
  await type(c, 'Amount (g)', '0');
  expect(JSON.stringify(c)).toContain('Enter an amount above 0 and up to 100,000 g.');
});

test('portions are only offered when the food has one with a gram weight', async () => {
  mockGetFood.mockResolvedValue({ ...banana, portions: [] });
  const c = await render();
  expect(find(c, 'Portion', 'onClick')).toBeUndefined();
});

test('a missing food explains itself', async () => {
  mockGetFood.mockResolvedValue(null);
  const c = await render();
  expect(JSON.stringify(c)).toContain('no longer available');
});

test('the estimate switch is sent with the log, and an unsynced log says so and opens the diary for that day', async () => {
  mockLog.mockResolvedValue(false);
  const c = await render();
  await act(async () => find(c, 'Mark as an estimate', 'onChange').props.onChange({ nativeEvent: { value: true } }));
  await click(c, 'Log Food');
  expect(mockLog.mock.calls[0][0]).toMatchObject({ isEstimated: true });
  expect(JSON.stringify(c)).toContain('not synced yet');
  await click(c, 'View Diary');
  expect(mockReplace).toHaveBeenCalledWith({ pathname: '/food/diary', params: { date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) } });
});
