import { amountError, defaultWaterUnit, entryMl, formatWater, MAX_ENTRY_ML, mlFromUnit, ML_PER_FL_OZ, unitFromMl } from './units';

jest.mock('@/lib/secure-storage', () => ({ secureStorage: { getItem: async () => null, setItem: async () => {} } }));

test('converts mL and US fl oz both ways', () => {
  expect(mlFromUnit(8, 'floz')).toBeCloseTo(236.588, 3);
  expect(unitFromMl(ML_PER_FL_OZ * 16, 'floz')).toBeCloseTo(16, 10);
  expect(mlFromUnit(250, 'ml')).toBe(250);
  expect(unitFromMl(250, 'ml')).toBe(250);
});

test('entry amounts round to 0.1 mL and stay within bounds', () => {
  expect(entryMl(8, 'floz')).toBe(236.6);
  expect(entryMl(250, 'ml')).toBe(250);
  expect(entryMl(MAX_ENTRY_ML, 'ml')).toBe(MAX_ENTRY_ML);
  expect(entryMl(MAX_ENTRY_ML + 1, 'ml')).toBeNull();
  expect(entryMl(170, 'floz')).toBeNull(); // about 5027 mL
  for (const bad of [0, -1, NaN, Infinity, 0.01]) expect(entryMl(bad, 'ml')).toBeNull();
});

test('formats whole mL, litres from 1000 mL, and fl oz to one decimal', () => {
  expect(formatWater(249.6, 'ml')).toBe('250 mL');
  expect(formatWater(1250, 'ml')).toBe('1.25 L');
  expect(formatWater(250, 'floz')).toBe('8.5 fl oz');
  expect(amountError('floz')).toContain('169.1 fl oz');
  expect(amountError('ml')).toContain('5000 mL');
});

test('defaults to fl oz only in the US', () => {
  expect(defaultWaterUnit('en-US')).toBe('floz');
  expect(defaultWaterUnit('es_US')).toBe('floz');
  expect(defaultWaterUnit('en-GB')).toBe('ml');
  expect(defaultWaterUnit('en')).toBe('ml');
  expect(defaultWaterUnit(undefined)).toBe('ml');
});
