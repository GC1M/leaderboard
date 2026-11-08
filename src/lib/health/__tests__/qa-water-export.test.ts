// QA (#58): Apple Health water export, HealthKit mocked. Each test here failed before its fix.
import { createExportQueue, exportWriters } from '../export-queue';
import { getHealthWriteAccess, resetHealthKitCache } from '../healthkit';
import { pendingWaterSaves, removeWaterExport, settleWaterExport, WATER_KIND, type WaterRow } from '../water-export';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

// In-memory HealthKit honouring sync versions (same stand-in as water-export.test.ts).
type Sample = { type: string; quantity: number; metadata: Record<string, unknown> };
let store: Sample[] = [];
let denied = false;
const hk = {
  isHealthDataAvailable: jest.fn(() => true),
  authorizationStatusFor: jest.fn(() => (denied ? 1 : 2)),
  saveQuantitySample: jest.fn(async (type: string, _u: string, quantity: number, _s: Date, _e: Date, metadata: Record<string, unknown>) => {
    const old = store.find((s) => s.metadata.HKMetadataKeySyncIdentifier === metadata.HKMetadataKeySyncIdentifier);
    if (old && (metadata.HKMetadataKeySyncVersion as number) <= (old.metadata.HKMetadataKeySyncVersion as number)) return undefined;
    store = store.filter((s) => s !== old);
    store.push({ type, quantity, metadata });
    return { uuid: `s-${store.length}` };
  }),
  deleteObjects: jest.fn(async (type: string, filter: { metadata: { value: string } }) => {
    store = store.filter((s) => !(s.type === type && s.metadata.LeaderboardRecordId === filter.metadata.value));
  }),
};
beforeAll(() => jest.doMock('@kingstinct/react-native-healthkit', () => hk));
afterAll(() => jest.dontMock('@kingstinct/react-native-healthkit'));
beforeEach(() => { jest.clearAllMocks(); resetHealthKitCache(); store = []; denied = false; });

function setup() {
  const queue = createExportQueue({
    checkAccount: async () => {},
    store: { list: async () => [], put: async () => {}, remove: async () => {}, clear: async () => {} },
    mapping: { get: async () => null, record: async () => {}, remove: async () => {} },
    writers: exportWriters,
    access: getHealthWriteAccess,
  });
  const controls = { getEntries: () => queue.getSnapshot().entries, enqueue: queue.enqueue, forget: queue.forget };
  return { queue, controls };
}
const row: WaterRow = { id: 'w1', updated_at: '2026-11-06T13:00:00.000Z', consumed_at: '2026-11-06T12:00:00.000Z', ml: 250 };

// Water write access revoked in Settings, then an entry is logged: its save waits on permission and never reaches Health.
async function neverExported() {
  const s = setup();
  await s.queue.initialize();
  denied = true;
  for (const p of pendingWaterSaves([row], [])) await s.queue.enqueue(WATER_KIND, p.id, 'save', p.payload, p.version);
  expect(store).toEqual([]);
  expect(hk.saveQuantitySample).not.toHaveBeenCalled();
  expect(s.queue.getSnapshot().entries).toEqual([expect.objectContaining({ op: 'save', status: 'failed', reason: 'permission', attemptVersion: undefined })]);
  return s;
}

describe('a delete for an entry whose export never succeeded', () => {
  it('deleting the entry (what choice.deleted does) leaves nothing queued, not a stuck permission delete', async () => {
    const { queue, controls } = await neverExported();
    // useWaterExport().deleted after removeWater deleted the server row:
    await removeWaterExport(controls, 'w1');
    // Nothing of w1 was ever in Health, so there is nothing to remove and nothing should wait on permission.
    expect(queue.getSnapshot().entries).toEqual([]);
  });

  it('Remove from Health (account deletion / Delete Water History) succeeds when no water ever reached Health', async () => {
    const { controls } = await neverExported();
    // Profile removeAccount(true) runs settleWaterExport(…, true) whenever any food or water was exported.
    await expect(settleWaterExport(controls, true)).resolves.toBeUndefined();
  });
});
