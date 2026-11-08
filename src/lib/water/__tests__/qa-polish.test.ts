// QA (issue #155): water polish. Each test here failed before its fix.
import { barSummary } from '@/lib/health/format';

import { amountError, defaultWaterUnit, entryMl, formatWater, MAX_ENTRY_ML } from '../units';

jest.mock('@/lib/secure-storage', () => ({ secureStorage: { getItem: async () => null, setItem: async () => {} } }));

test('the fl oz limit in the error message is the limit that is enforced', () => {
  // before the fix: the message said 169 fl oz, yet 169.07 was accepted
  const limit = Number(amountError('floz').match(/up to ([\d.]+) fl oz/)![1]);
  expect(entryMl(169.07, 'floz')).not.toBeNull();
  expect(limit).toBeGreaterThanOrEqual(169.07);
  expect(entryMl(limit + 0.1, 'floz')).toBeNull();
  // a 5000 mL entry shows as the limit, and saving that unchanged stays within the server bound
  expect(formatWater(MAX_ENTRY_ML, 'floz')).toBe(`${limit} fl oz`);
  expect(entryMl(limit, 'floz')).toBe(MAX_ENTRY_ML);
});

test('an entry under 0.5 mL never displays as 0', () => {
  expect(entryMl(0.4, 'ml')).toBe(0.4);
  expect(formatWater(0.4, 'ml')).toBe('<1 mL'); // before the fix: "0 mL"
  expect(formatWater(1, 'floz')).toBe('<0.1 fl oz'); // before the fix: "0 fl oz"
  expect(formatWater(0, 'ml')).toBe('0 mL');
});

test('US territories default to fl oz', () => {
  for (const r of ['PR', 'GU', 'VI', 'AS', 'MP', 'UM']) expect(defaultWaterUnit(`en-${r}`)).toBe('floz');
  expect(defaultWaterUnit('es-MX')).toBe('ml');
});

test('the top water day is "Most", not "Best"; other metrics keep "Best"', () => {
  const label = () => 'd';
  expect(barSummary(['2026-11-01'], [500], String, 'water', new Date(), label)).toContain('Most 500');
  expect(barSummary(['2026-11-01'], [500], String, 'steps', new Date(), label)).toContain('Best 500');
});
