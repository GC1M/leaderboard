import { loadWeightUnit, saveWeightUnit } from './weight-unit';

const mockGet = jest.fn();
const mockSet = jest.fn();
jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('@/lib/secure-storage', () => ({ secureStorage: { getItem: (k: string) => mockGet(k), setItem: (k: string, v: string) => mockSet(k, v) } }));

beforeEach(() => jest.resetAllMocks());

test('returns the stored unit', async () => {
  mockGet.mockResolvedValue('lb');
  expect(await loadWeightUnit('kg')).toBe('lb');
});
test('falls back when nothing or junk is stored, or the read throws', async () => {
  mockGet.mockResolvedValueOnce(null);
  expect(await loadWeightUnit('kg')).toBe('kg');
  mockGet.mockResolvedValueOnce('stone');
  expect(await loadWeightUnit('lb')).toBe('lb');
  mockGet.mockRejectedValueOnce(new Error('locked'));
  expect(await loadWeightUnit('lb')).toBe('lb');
});
test('saves under one key, and a failed write does not throw', async () => {
  mockSet.mockResolvedValueOnce(undefined);
  await saveWeightUnit('lb');
  expect(mockSet).toHaveBeenCalledWith('weight-unit', 'lb');
  mockSet.mockRejectedValueOnce(new Error('locked'));
  await expect(saveWeightUnit('kg')).resolves.toBeUndefined();
});
