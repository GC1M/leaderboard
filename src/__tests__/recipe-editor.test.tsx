import { act } from 'react';
import { createRoot } from 'test-renderer';
import { RecipeEditor } from '@/components/food/RecipeEditor';

const mockAlert = jest.fn();
const mockSave = jest.fn();
const mockDismiss = jest.fn();
const mockRepeat = jest.fn();
let mockGuard: { enabled: boolean; callback: (x: { repeat: () => void }) => void };
const mockBack = jest.fn(() => { if (mockGuard.enabled) mockGuard.callback({ repeat: mockRepeat }); });
const mockRouter = { push: jest.fn(), dismissTo: mockDismiss, canGoBack: () => true, back: mockBack };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useSegments: () => [],
  usePreventRemove: (enabled: boolean, callback: typeof mockGuard.callback) => { mockGuard = { enabled, callback }; return () => { mockGuard.enabled = false; }; },
}));
jest.mock('@/lib/alert', () => ({ alert: (...args: unknown[]) => mockAlert(...args) }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/food/recipes', () => ({ getRecipe: jest.fn(), saveRecipe: (...args: unknown[]) => mockSave(...args) }));
jest.mock('@/lib/food/search', () => ({ FoodSearchError: class extends Error {}, searchFoods: jest.fn(), searchCachedFoods: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

let root: ReturnType<typeof createRoot>;
async function render(el: React.ReactElement) { root = createRoot(); await act(async () => root.render(el)); return root.container as any; }
const click = async (c: any, label: string) => act(async () => c.queryAll((n: any) => n.props.onClick && n.props.accessibilityLabel === label)[0].props.onClick());
beforeEach(() => jest.clearAllMocks());
afterEach(() => act(() => root?.unmount()));

test('leaving an untouched new recipe is not blocked', async () => {
  const c = await render(<RecipeEditor />);
  expect(mockGuard.enabled).toBe(false);
  await click(c, 'Cancel');
  expect(mockAlert).not.toHaveBeenCalled();
});

test('Cancel with edits asks first, Keep Editing stays and Discard leaves', async () => {
  const c = await render(<RecipeEditor />);
  await act(async () => c.queryAll((n: any) => n.props.onChangeText && n.props.accessibilityLabel === 'Recipe name')[0].props.onChangeText('Salad'));
  expect(mockGuard.enabled).toBe(true);
  await click(c, 'Cancel');
  expect(mockAlert).toHaveBeenCalledTimes(1);
  const buttons = mockAlert.mock.calls[0][2];
  expect(buttons.map((b: { text: string }) => b.text)).toEqual(['Keep Editing', 'Discard Changes']);
  expect(mockRepeat).not.toHaveBeenCalled();
  await act(async () => buttons[1].onPress());
  expect(mockRepeat).toHaveBeenCalled();
  expect(mockSave).not.toHaveBeenCalled();
});
