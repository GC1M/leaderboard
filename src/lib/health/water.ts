import { EXCLUDE_OWN_EXPORTS, isOwnExport } from './export-metadata';
import { HEALTH_TYPES, loadHealthKit } from './healthkit';
import type { ChangePage, JournalState, StoredSample } from './changes';

// One imported water sample, in the shape apply_health_water expects. 0 mL is a recorded zero, never synthesized.
export type WaterChange = { health_uuid: string; consumed_at: string; timezone: string; ml: number; source_name: string | null };
export type HealthWater = {
  uuid: string; startDate: Date; quantity: number; metadata?: { [key: string]: unknown } | null;
  sourceRevision?: { source?: { name?: string } } | null;
};

// Each entry keeps the zone it was drunk in: HKTimeZone when the writing app set it, else this device's zone.
// The server validates the name and falls back to the profile zone. Returns null for a sample that can't be stored.
export function mapWater(s: HealthWater, timezone: string): WaterChange | null {
  const at = s.startDate.getTime();
  if (!s.uuid || !Number.isFinite(at) || !Number.isFinite(s.quantity) || s.quantity < 0) return null;
  const zone = s.metadata?.HKTimeZone;
  return {
    health_uuid: s.uuid, consumed_at: s.startDate.toISOString(), ml: s.quantity,
    timezone: typeof zone === 'string' && zone ? zone : timezone, source_name: s.sourceRevision?.source?.name || null,
  };
}

// Our own exports are also skipped here, in case one gets past the query's predicate.
export function waterPage(
  samples: readonly HealthWater[], deleted: readonly string[], anchor: string, hasMore: boolean, timezone: string,
): ChangePage {
  const rows = samples.filter((s) => !isOwnExport(s.metadata)).map((s) => mapWater(s, timezone))
    .filter((r): r is WaterChange => r !== null);
  // The journal only needs ids to know what this device imported; details go straight to the server.
  const stored = rows.map((r): StoredSample => ({ id: r.health_uuid, start: r.consumed_at, end: r.consumed_at, value: r.ml }));
  return { samples: stored, deleted: [...deleted], anchor, hasMore, water: rows };
}

export async function queryWaterChanges(state: JournalState, limit: number): Promise<ChangePage> {
  const hk = loadHealthKit();
  if (!hk) throw new Error('Apple Health requires a native iPhone build.');
  const page = await hk.queryQuantitySamplesWithAnchor(HEALTH_TYPES.water, {
    // Unlike workouts, water excludes our own exports in the query itself: a full first page of them would otherwise
    // look empty, so the anchor would never advance and other apps' water would never import. Water had this
    // predicate from its first release, so it stays fixed for every anchor.
    limit, anchor: state.anchor, unit: 'mL', filter: { date: { startDate: new Date(state.from) }, ...EXCLUDE_OWN_EXPORTS },
  });
  // Same value as deviceTimezone(); importing it would load the Supabase client into the Health query module.
  return waterPage(page.samples as unknown as HealthWater[], page.deletedSamples.map((s) => s.uuid), page.newAnchor,
    page.samples.length + page.deletedSamples.length >= limit, Intl.DateTimeFormat().resolvedOptions().timeZone);
}
