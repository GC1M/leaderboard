// QA (#64): on iOS the export queue keeps the HealthKit writers and the shared server mapping. Health Connect writers
// (deviceLocal) are Android only.
import { Platform } from 'react-native';

import { createExportQueue, exportWriters, writeTypesFor, type ExportEntry, type ExportMapping } from './export-queue';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: null }) }));
jest.mock('@/lib/metrics', () => ({ getMyRecentSteps: jest.fn(), upsertDailyMetrics: jest.fn() }));
const mockSave = jest.fn(async () => ({ uuid: 'hk-1' }));
jest.mock('@kingstinct/react-native-healthkit', () => ({ isHealthDataAvailable: () => true, saveQuantitySample: mockSave }));
const mockInsert = jest.fn();
jest.mock('./health-connect', () => ({ ...jest.requireActual('./health-connect'), insertHealthConnectRecord: (...a: unknown[]) => mockInsert(...a) }));

jest.replaceProperty(Platform, 'OS', 'ios');
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('./sync'); // registers every writer for the current platform
/* eslint-disable @typescript-eslint/no-require-imports */
const { MANUAL_KINDS } = require('./manual-export');
const { WATER_KIND, WATER_TYPE, waterWriter } = require('./water-export');
const { FOOD_KIND } = require('./food-export');
const { WORKOUT_KIND } = require('./workout-export');
/* eslint-enable @typescript-eslint/no-require-imports */

const kinds = () => [MANUAL_KINDS.weight, MANUAL_KINDS.sleep, MANUAL_KINDS.steps, WORKOUT_KIND, FOOD_KIND, WATER_KIND];

test('every export kind has a HealthKit writer on iOS, none deviceLocal', () => {
  for (const k of kinds()) {
    expect(exportWriters[k]).toBeDefined();
    expect(exportWriters[k]!.deviceLocal).toBeFalsy();
    for (const t of writeTypesFor(k)) expect(t).toMatch(/^HK/);
  }
  expect(exportWriters[WATER_KIND]).toBe(waterWriter);
  expect(writeTypesFor(WATER_KIND)).toEqual([WATER_TYPE]);
  expect(writeTypesFor(MANUAL_KINDS.steps)).toEqual(['HKQuantityTypeIdentifierStepCount']); // steps export still offered on iOS
});

test('iOS water export writes to HealthKit and records the shared server mapping', async () => {
  const mapping = { get: jest.fn<ReturnType<ExportMapping['get']>, Parameters<ExportMapping['get']>>(async () => null), record: jest.fn(async (..._a: Parameters<ExportMapping['record']>) => {}), remove: jest.fn(async (..._a: Parameters<ExportMapping['remove']>) => {}) };
  const store = new Map<string, ExportEntry>();
  const q = createExportQueue({
    checkAccount: async () => {},
    store: { list: async () => [...store.values()], put: async (e) => void store.set(e.recordId, e), remove: async (_k, id) => void store.delete(id), clear: async () => store.clear() },
    mapping,
    writers: exportWriters,
    access: () => 'granted',
  });
  await q.initialize();
  await q.enqueue(WATER_KIND, 'w1', 'save', { ml: 250, at: '2026-11-01T12:00:00.000Z' }, 10);
  expect(mockSave).toHaveBeenCalledWith(WATER_TYPE, 'mL', 250, expect.any(Date), expect.any(Date), expect.anything());
  expect(mockInsert).not.toHaveBeenCalled();
  expect(mapping.get).toHaveBeenCalledWith(WATER_KIND, 'w1');
  expect(mapping.record).toHaveBeenCalledWith(WATER_KIND, 'w1', 'hk-1', 10);
  expect(q.getSnapshot().entries[0]).toMatchObject({ status: 'success', sampleUuid: 'hk-1' });

  // Another device already exported a newer version: iOS still trusts the shared mapping and skips the write.
  mockSave.mockClear();
  mapping.get.mockResolvedValueOnce({ syncVersion: 99 });
  await q.enqueue(WATER_KIND, 'w2', 'save', { ml: 100, at: '2026-11-01T13:00:00.000Z' }, 20);
  expect(mockSave).not.toHaveBeenCalled();
  expect(mapping.record).not.toHaveBeenCalledWith(WATER_KIND, 'w2', expect.anything(), expect.anything());
  q.stop();
});
