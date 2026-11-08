import { act } from 'react';
import { createRoot } from 'test-renderer';

import FoodScan from '@/app/(tabs)/(summary)/food/scan';

// Screen-level checks for photo assistance (#51, #53, #54): cancel and retry while reading, review before save,
// one save per tap, and a menu that saves nothing until a food is logged.
const mockPick = jest.fn();
const mockRead = jest.fn();
const mockCreate = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockKind: string | undefined;
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true, push: (...a: unknown[]) => mockPush(...a), replace: (...a: unknown[]) => mockReplace(...a) }),
  useLocalSearchParams: () => ({ kind: mockKind }),
  useSegments: () => [],
}));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/food/photo', () => ({
  ...jest.requireActual('@/lib/food/photo'),
  pickPhoto: (...a: unknown[]) => mockPick(...a),
  readPhoto: (...a: unknown[]) => mockRead(...a),
}));
jest.mock('@/lib/food/search', () => ({ ...jest.requireActual('@/lib/food/search'), createCustomFood: (...a: unknown[]) => mockCreate(...a) }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const lines = (...text: string[]) => text.map((t) => ({ text: t, confidence: 0.95 }));
const LABEL = lines('Serving size 1 bar (40g)', 'Calories 180', 'Total Fat 8g', 'Protein 4g');
const MENU = lines('Mains', 'Grilled Salmon 24.00', 'with lemon butter and greens', 'Margherita Pizza 16.50');

let root: ReturnType<typeof createRoot>;
afterEach(() => act(() => root?.unmount()));
async function render() {
  root = createRoot();
  await act(async () => root.render(<FoodScan />));
  return root.container as any;
}
const find = (c: any, label: string, prop: string) => c.queryAll((n: any) => n.props[prop] && n.props.accessibilityLabel === label)[0];
const has = (c: any, label: string) => !!find(c, label, 'onClick');
const click = (c: any, label: string) => act(async () => find(c, label, 'onClick').props.onClick());
const type = (c: any, label: string, value: string) => act(async () => find(c, label, 'onChangeText').props.onChangeText(value));
const text = (c: any) => JSON.stringify(c);

beforeEach(() => {
  jest.clearAllMocks();
  mockKind = undefined;
  mockPick.mockResolvedValue('file:///cache/photo.jpg');
  mockCreate.mockResolvedValue({ id: 'food-1' });
});

test('cancel while reading returns to the start, and a late result is ignored', async () => {
  let finish!: (v: unknown) => void;
  mockRead.mockReturnValue(new Promise((r) => { finish = r; }));
  const c = await render();
  await click(c, 'Take Photo');
  expect(has(c, 'Cancel')).toBe(true);
  await click(c, 'Cancel');
  expect(has(c, 'Take Photo')).toBe(true);
  await act(async () => finish(LABEL));
  expect(has(c, 'Take Photo')).toBe(true);
  expect(has(c, 'Save Food')).toBe(false);
  expect(mockCreate).not.toHaveBeenCalled();
});

test('a failed read shows an error and trying again reaches the review', async () => {
  mockRead.mockRejectedValueOnce(new Error('vision failed')).mockResolvedValueOnce(LABEL);
  const c = await render();
  await click(c, 'Choose Photo');
  expect(text(c)).toContain("Couldn't read that photo. Try again.");
  await click(c, 'Choose Photo');
  expect(has(c, 'Save Food')).toBe(true);
});

test('values are reviewed and edited before one save, converted to per 100 g', async () => {
  mockRead.mockResolvedValue(LABEL);
  let done!: (v: unknown) => void;
  mockCreate.mockReturnValue(new Promise((r) => { done = r; }));
  const c = await render();
  await click(c, 'Take Photo');
  expect(mockCreate).not.toHaveBeenCalled();
  await type(c, 'Name', 'Oat bar');
  await type(c, 'Protein (g) per serving', '5');
  await click(c, 'Save Food');
  await click(c, 'Save Food');
  expect(mockCreate).toHaveBeenCalledTimes(1);
  const { name, per100g } = mockCreate.mock.calls[0][0];
  expect(name).toBe('Oat bar');
  expect(per100g).toMatchObject({ energy_kcal: 450, fat_g: 20, protein_g: 12.5, carbs_g: null });
  await act(async () => done({ id: 'food-1' }));
  expect(mockReplace).toHaveBeenCalledWith({ pathname: '/food/[id]', params: { id: 'food-1' } });
});

test('a menu lists dishes, saves nothing, and a picked dish opens search as an estimate', async () => {
  mockKind = 'menu';
  mockRead.mockResolvedValue(MENU);
  const c = await render();
  await click(c, 'Take Photo');
  expect(text(c)).toContain('this is an estimate');
  await click(c, 'Try Another Photo');
  expect(has(c, 'Take Photo')).toBe(true);
  expect(mockCreate).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
  await click(c, 'Take Photo');
  const dish = c.queryAll((n: any) => n.props.onClick && n.props.accessibilityLabel?.startsWith('Grilled Salmon'))[0];
  await act(async () => dish.props.onClick());
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/food', params: { q: 'Grilled Salmon', estimate: '1', details: 'with lemon butter and greens' } });
  expect(mockCreate).not.toHaveBeenCalled();
});
