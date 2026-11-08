// QA (issue #58): units and amount entry. Each test here failed before its fix.
import { formatWater } from '../units';

jest.mock('@/lib/secure-storage', () => ({ secureStorage: { getItem: async () => null, setItem: async () => {} } }));

test('a total that rounds to 1000 mL is shown as 1 L, like 1000 mL itself', () => {
  expect(formatWater(1000, 'ml')).toBe('1 L');
  expect(formatWater(999.5, 'ml')).toBe('1 L'); // before the fix: "1000 mL"
  expect(formatWater(999.6, 'ml')).toBe('1 L');
});
