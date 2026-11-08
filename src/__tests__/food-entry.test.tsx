import { act } from 'react';
import { createRoot } from 'test-renderer';

import EntryDetail from '@/app/(tabs)/(summary)/food/entry/[id]';
import type { Entry } from '@/lib/food/diary';
import { emptyNutrients } from '@/lib/food/nutrition';

// The logged entry screen keeps the data source's attribution (#50): USDA entries credit FoodData Central,
// custom foods and recipes do not.
const mockGetEntry = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
  useLocalSearchParams: () => ({ id: 'e1' }),
  useSegments: () => [],
}));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'me' } } }) }));
jest.mock('@/components/food/FoodExportOption', () => ({ useFoodExport: () => ({ on: false }) }));
jest.mock('@/lib/food/diary', () => ({ ...jest.requireActual('@/lib/food/diary'), getEntry: (...a: unknown[]) => mockGetEntry(...a) }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const entry = (provider: Entry['provider']): Entry => ({
  id: 'e1', clientId: 'c1', foodId: null, meal: 'lunch', consumedAt: '2026-11-01T12:00:00Z', timezone: 'UTC', localDate: '2026-11-01',
  grams: 150, portionLabel: null, portionCount: null, isEstimated: false, name: 'Bananas, raw', brand: null, provider,
  providerId: provider === 'usda_fdc' ? '173944' : null, sourceDataType: null, sourceVersion: null,
  nutrients: { ...emptyNutrients(), energy_kcal: 134 }, pending: null, syncError: null, updatedAt: '2026-11-01T12:00:01Z',
});

let root: ReturnType<typeof createRoot>;
afterEach(() => act(() => root?.unmount()));
async function render() {
  root = createRoot();
  await act(async () => root.render(<EntryDetail />));
  return JSON.stringify(root.container as any);
}

test.each([
  ['usda_fdc', true],
  ['custom', false],
  ['recipe', false],
] as const)('a %s entry shows the USDA attribution: %s', async (provider, shown) => {
  mockGetEntry.mockResolvedValue(entry(provider));
  const text = await render();
  expect(text).toContain('Bananas, raw');
  expect(text.includes('Department of Agriculture')).toBe(shown);
});
