import { reconcileHealth, type HealthChanges, type HealthJournal, type JournalState } from '../changes';
import { APP_RECORD_KEY } from '../export-metadata';
import { loadHealthKit } from '../healthkit';
import { queryWaterChanges, type HealthWater } from '../water';

jest.mock('../healthkit', () => ({ HEALTH_TYPES: { water: 'HKQuantityTypeIdentifierDietaryWater' }, loadHealthKit: jest.fn() }));

const hw = (uuid: string, extra: Partial<HealthWater> = {}): HealthWater => ({
  uuid, startDate: new Date('2026-10-25T10:00:00Z'), quantity: 250, ...extra,
});
const memory = () => {
  let state: JournalState | null = null;
  const journal: HealthJournal = { read: async () => (state ? JSON.parse(JSON.stringify(state)) : null), write: async (_m, s) => { state = JSON.parse(JSON.stringify(s)); } };
  return { journal, state: () => state };
};

// Read access granted. The anchored query returns, oldest first, a full page (500) of water this app exported to
// Health (a regular logger with "Also save to Apple Health" on for ~2 months before connecting imports), then a
// page with a third-party sample. HealthKit only returns the second page once the first page's anchor is used.
test('a first page made only of our own exports does not stop the import forever', async () => {
  const own = Array.from({ length: 500 }, (_, i) => hw(`own-${i}`, { metadata: { [APP_RECORD_KEY]: `water:${i}` } }));
  const all = [...own, hw('watch')];
  // A stand-in for HealthKit's anchored query: the anchor is an index into the store, and the NOT metadata
  // predicate drops samples carrying that key, as HealthKit does.
  const queryQuantitySamplesWithAnchor = jest.fn(async (_t: string, o: { limit: number; anchor?: string; filter?: { NOT?: { metadata: { withMetadataKey: string } }[] } }) => {
    const key = o.filter?.NOT?.[0]?.metadata.withMetadataKey;
    const from = Number(o.anchor ?? 0);
    const seen = all.map((x, i) => [x, i] as const).filter(([x, i]) => i >= from && !(key && x.metadata?.[key] !== undefined)).slice(0, o.limit);
    const next = seen.length ? seen[seen.length - 1][1] + 1 : from;
    return { samples: seen.map(([x]) => x), deletedSamples: [], newAnchor: String(next) };
  });
  jest.mocked(loadHealthKit).mockReturnValue({ queryQuantitySamplesWithAnchor } as never);
  const query = (_m: string, s: JournalState) => queryWaterChanges(s, 500);
  const uploaded: string[] = [];
  const upload = jest.fn(async (_m: string, c: HealthChanges) => { c.water?.forEach((w) => uploaded.push(w.health_uuid)); });
  const mem = memory();

  // Several foreground syncs (each reads up to 3 pages). Before the fix every read returned the same 500 own
  // exports with no anchor, so nothing ever imported.
  for (let i = 0; i < 3; i++) await reconcileHealth('water', { journal: mem.journal, checkOwner: async () => {}, upload, query });

  expect(uploaded).toEqual(['watch']);
});
