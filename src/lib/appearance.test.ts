import { Appearance } from 'react-native';
import { loadAppearance, saveAppearance } from './appearance';

const mockGet = jest.fn();
const mockSet = jest.fn();
jest.mock('@/lib/secure-storage', () => ({ secureStorage: { getItem: (k: string) => mockGet(k), setItem: (k: string, v: string) => mockSet(k, v) } }));
const setScheme = jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => {});

beforeEach(() => { mockGet.mockReset(); mockSet.mockReset(); setScheme.mockClear(); });

test('a saved choice overrides the phone, and System hands control back', async () => {
  mockGet.mockResolvedValue('dark');
  expect(await loadAppearance()).toBe('dark');
  expect(setScheme).toHaveBeenLastCalledWith('dark');
  await saveAppearance('system');
  expect(setScheme).toHaveBeenLastCalledWith('unspecified');
  expect(mockSet).toHaveBeenCalledWith('appearance', 'system');
});
test('junk or unreadable storage keeps the current choice', async () => {
  await saveAppearance('light');
  mockGet.mockResolvedValueOnce('purple');
  expect(await loadAppearance()).toBe('light');
  mockGet.mockRejectedValueOnce(new Error('locked'));
  expect(await loadAppearance()).toBe('light');
});
test('a failed save still applies the choice', async () => {
  mockSet.mockRejectedValue(new Error('full'));
  await saveAppearance('dark');
  expect(setScheme).toHaveBeenLastCalledWith('dark');
});
