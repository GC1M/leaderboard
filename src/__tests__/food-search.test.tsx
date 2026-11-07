import { act } from 'react';
import { createRoot } from 'test-renderer';

import FoodSearch from '@/app/(tabs)/(summary)/food/index';
import { emptyNutrients } from '@/lib/food/nutrition';
import { FoodSearchError, type Food } from '@/lib/food/search';

const mockSearch = jest.fn();
const mockCached = jest.fn();
const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), canGoBack: () => true, push: (...a: unknown[]) => mockPush(...a) }), useSegments: () => [], useLocalSearchParams: () => mockParams }));
jest.mock('@/lib/food/photo', () => ({ photoScanAvailable: () => true }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/food/search', () => ({
  ...jest.requireActual('@/lib/food/search'),
  searchFoods: (...a: unknown[]) => mockSearch(...a),
  searchCachedFoods: (...a: unknown[]) => mockCached(...a),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const almonds: Food = {
  id: 'f1', name: 'Almonds, raw', brand: null, provider: 'usda_fdc', providerId: '1', sourceDataType: 'Foundation', sourceVersion: '2022-10-28',
  per100g: { ...emptyNutrients(), energy_kcal: 584 }, portions: [],
};
const page = (o = {}) => ({ foods: [almonds], page: 1, totalHits: 1, fromCache: false, failure: null, ...o });

let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockCached.mockResolvedValue([]);
  mockParams = {};
});
afterEach(() => {
  act(() => root?.unmount());
  jest.useRealTimers();
});
async function searchFor(text: string) {
  root = createRoot();
  await act(async () => root.render(<FoodSearch />));
  const c = root.container as any;
  const input = c.queryAll((n: any) => n.props.onChangeText && n.props.accessibilityLabel === 'Search foods')[0];
  await act(async () => input.props.onChangeText(text));
  await act(async () => { await jest.advanceTimersByTimeAsync(800); });
  return c;
}
const text = (c: any) => JSON.stringify(c);

test('the USDA attribution and the estimate note are on the search screen before and after a search', async () => {
  root = createRoot();
  await act(async () => root.render(<FoodSearch />));
  expect(text(root.container)).toContain('FoodData Central');
  expect(text(root.container)).toContain('estimates, not medical advice');
  act(() => root.unmount());
  mockSearch.mockResolvedValue(page());
  const c = await searchFor('almonds');
  expect(text(c)).toContain('Almonds, raw');
  expect(text(c)).toContain('Department of Agriculture');
});

test.each([
  ['rate_limited', 'busy'],
  ['provider_timeout', 'too long'],
  ['not_configured', 'not available'],
  ['provider_error', 'reach the food database'],
])('USDA outage (%s) with saved foods says so, still lists them, and keeps Add a Custom Food', async (failure, wording) => {
  mockSearch.mockResolvedValue(page({ fromCache: true, failure }));
  const c = await searchFor('almonds');
  expect(text(c)).toContain(wording);
  expect(text(c)).toContain('Showing saved results.');
  expect(text(c)).toContain('Almonds, raw');
  expect(text(c)).toContain('Saved foods');
  expect(text(c)).toContain('Add a Custom Food');
});

test('USDA outage with nothing saved shows the error, a retry, and a custom food that carries the typed name', async () => {
  mockSearch.mockRejectedValue(new FoodSearchError('provider_error'));
  const c = await searchFor('almonds');
  expect(text(c)).toContain('reach the food database');
  expect(text(c)).toContain('Try Again');
  expect(text(c)).not.toContain('Almonds, raw');
  const add = c.queryAll((n: any) => n.props.onClick && JSON.stringify(n).includes('Add a Custom Food'))[0];
  act(() => add.props.onClick());
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/food/custom', params: { name: 'almonds' } });
});

test('an outage while the cache is searched too still ends in an error, never a blank list or an empty-result message', async () => {
  mockSearch.mockRejectedValue(new Error('offline'));
  mockCached.mockRejectedValue(new Error('offline'));
  const c = await searchFor('almonds');
  expect(text(c)).toContain("Couldn't search foods");
  expect(text(c)).not.toContain('No matches');
});

test('Try Again after an outage searches again and shows the live results', async () => {
  mockSearch.mockRejectedValueOnce(new FoodSearchError('provider_timeout')).mockResolvedValue(page());
  const c = await searchFor('almonds');
  const retry = c.queryAll((n: any) => n.props.onClick && JSON.stringify(n).includes('Try Again'))[0];
  await act(async () => retry.props.onClick());
  await act(async () => { await jest.advanceTimersByTimeAsync(800); });
  expect(text(c)).toContain('USDA foods');
  expect(text(c)).not.toContain('too long');
});

test('offers label and menu scans when photo reading is available', async () => {
  root = createRoot();
  await act(async () => root.render(<FoodSearch />));
  expect(text(root.container)).toContain('Scan a Nutrition Label');
  expect(text(root.container)).toContain('Scan a Menu');
});

test('a dish from a menu scan is searched, shows the estimate note, and opens the food as an estimate', async () => {
  mockParams = { q: 'Chicken Burrito', estimate: '1', details: 'rice, beans, salsa' };
  mockSearch.mockResolvedValue(page());
  root = createRoot();
  await act(async () => root.render(<FoodSearch />));
  await act(async () => { await jest.advanceTimersByTimeAsync(800); });
  const c = root.container as any;
  expect(mockSearch).toHaveBeenCalledWith('Chicken Burrito');
  expect(text(c)).toContain('The menu lists: rice, beans, salsa');
  expect(text(c)).not.toContain('Scan a Menu');
  const row = c.queryAll((n: any) => n.props.onClick && String(n.props.accessibilityLabel ?? '').startsWith('Almonds, raw'))[0];
  await act(async () => row.props.onClick());
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/food/[id]', params: { id: 'f1', estimate: '1', details: 'rice, beans, salsa' } });
});
