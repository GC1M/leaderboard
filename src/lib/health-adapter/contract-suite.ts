import { CAPABILITY_MATRICES, type PlatformMatrix } from './capabilities';
import { HEALTH_DATA_TYPES, type AccessKind, type HealthAdapter, type HealthDataType, type ReadResult, type WeightReading } from './types';

// Reusable contract tests: every adapter (iOS, Android, fakes) must pass these. Call from a *.test.ts file.
// Optional hooks let a test adapter stage data it cannot get any other way; leave one out to skip its checks.
export type ContractOptions = {
  make: () => HealthAdapter | Promise<HealthAdapter>;
  matrix?: PlatformMatrix; // defaults to the shipped matrix for the adapter's platform
  hooks?: {
    seedExternalWeight?: (adapter: HealthAdapter, reading: WeightReading) => void;
    deleteWeight?: (adapter: HealthAdapter, id: string) => void;
    makeUnavailable?: () => HealthAdapter | Promise<HealthAdapter>;
  };
  historyLimitDays?: number; // set when reads are limited without the history grant
};

// Native identifiers must not reach shared code: HealthKit type ids, Health Connect permission strings, package names.
export const PLATFORM_IDENTIFIER = /HK[A-Za-z]*Identifier|HKMetadata|HKQuantity|HKCategory|HKWorkout|android\.permission|androidx\.|com\.apple\.|com\.google\.android|Record::class/;

const reading = (id: string, measuredAt: string, origin: 'this-app' | 'other-app' = 'other-app'): WeightReading => ({ id, measuredAt, kg: 70, provenance: { origin, recording: 'automatic' } });
// Reads any type through its reader; undefined when the contract has no reader for it (nutrition, water).
const read = (a: HealthAdapter, type: HealthDataType, days = 7): Promise<ReadResult<unknown>> | undefined => {
  const range = { days };
  switch (type) {
    case 'steps': return a.readSteps(range);
    case 'sleep': return a.readSleep(range);
    case 'weight': return a.readWeight(range);
    case 'workouts': return a.readWorkouts?.(range);
    default: return undefined;
  }
};

export function runHealthAdapterContract(name: string, options: ContractOptions) {
  const matrixOf = (a: HealthAdapter) => options.matrix ?? CAPABILITY_MATRICES[a.platform];

  describe(`${name}: HealthAdapter contract`, () => {
    describe('capabilities', () => {
      it('answers every type and direction with an explicit, well-formed result', async () => {
        const a = await options.make();
        for (const type of HEALTH_DATA_TYPES) for (const access of ['read', 'write'] as const) {
          const result = await a.getCapability(type, access);
          expect(['supported', 'unsupported', 'unavailable']).toContain(result.status);
          if (result.status !== 'supported') expect(typeof result.reason).toBe('string');
        }
      });
      it('reports platform gaps from the matrix as unsupported, never as supported', async () => {
        const a = await options.make();
        const matrix = matrixOf(a);
        expect(matrix.platform).toBe(a.platform);
        if ((await a.getAvailability()).status !== 'available') return;
        for (const type of HEALTH_DATA_TYPES) for (const access of ['read', 'write'] as const) {
          const result = await a.getCapability(type, access);
          if (!matrix.entries[type][access]) expect(result).toEqual({ status: 'unsupported', reason: 'platform' });
          else if (!matrix.entries[type].implemented[access]) expect(result).toEqual({ status: 'unsupported', reason: 'not-implemented' });
          else expect(result).toEqual({ status: 'supported' });
        }
      });
      it('returns an explicit result instead of empty data or an exception for unsupported reads and writes', async () => {
        const a = await options.make();
        for (const type of HEALTH_DATA_TYPES) {
          const readCap = await a.getCapability(type, 'read');
          const pending = read(a, type);
          if (readCap.status !== 'supported' && pending) expect(await pending).toEqual(readCap);
          const writeCap = await a.getCapability(type, 'write');
          if (writeCap.status !== 'supported') expect(await a.remove(type, 'record-1')).toEqual(writeCap);
        }
        const changes = await a.readChanges('weight', null);
        if ((await a.getCapability('weight', 'read')).status !== 'supported') expect(changes.status).not.toBe('ok');
      });
      it('says unavailable, not empty, when the provider cannot be used', async () => {
        if (!options.hooks?.makeUnavailable) return;
        const a = await options.hooks.makeUnavailable();
        const availability = await a.getAvailability();
        expect(availability.status).not.toBe('available');
        for (const type of HEALTH_DATA_TYPES) {
          expect(await a.getCapability(type, 'read')).toEqual(availability);
          const result = await read(a, type);
          if (result) expect(result).toEqual(availability);
        }
        expect(await a.getPermission('weight', 'read')).toBe('unavailable');
      });
    });

    describe('permissions', () => {
      it('keeps read and write separate, per data type', async () => {
        const a = await options.make();
        const before = await a.getPermission('weight', 'write');
        const snapshot = await a.requestPermissions('read', ['weight']);
        expect(Object.keys(snapshot)).toEqual(['weight']);
        expect(await a.getPermission('weight', 'write')).toBe(before);
        expect(await a.getPermission('weight', 'write')).not.toBe('granted');
        const writable = await a.getCapability('weight', 'write');
        expect(await a.write({ recordId: 'r1', version: 1, payload: { type: 'weight', measuredAt: '2026-10-26T08:00:00.000Z', kg: 70 } }))
          .toEqual(writable.status === 'supported' ? { status: 'permission-required', access: 'write' } : writable);
        const readState = await a.getPermission('weight', 'read');
        await a.requestPermissions('write', ['weight']);
        expect(await a.getPermission('weight', 'read')).toBe(readState);
      });
      it('does not let access to one type grant another', async () => {
        const a = await options.make();
        await a.requestPermissions('read', ['steps']);
        expect(await a.getPermission('sleep', 'read')).not.toBe('granted');
        expect(await a.getPermission('weight', 'read')).not.toBe('granted');
      });
      it('asks for no more than the access kinds in the contract (no social sharing)', async () => {
        const kinds: AccessKind[] = ['read', 'write', 'history', 'background'];
        const a = await options.make();
        const states = await Promise.all(kinds.map((k) => a.getPermission('steps', k)));
        states.forEach((s) => expect(['granted', 'denied', 'not-asked', 'unknown', 'unavailable']).toContain(s));
      });
      it('asks for read access before returning data', async () => {
        const a = await options.make();
        if ((await a.getCapability('weight', 'read')).status !== 'supported') return;
        if ((await a.getPermission('weight', 'read')) === 'unknown') return; // the OS never reveals read access
        expect(await a.readWeight({ days: 7 })).toEqual({ status: 'permission-required', access: 'read' });
      });
    });

    describe('reads', () => {
      it('returns the same stable, platform-prefixed ids on every read', async () => {
        const a = await options.make();
        if (!options.hooks?.seedExternalWeight) return;
        const now = new Date();
        options.hooks.seedExternalWeight(a, reading(`${a.platform}:w1`, new Date(now.getTime() - 3600_000).toISOString()));
        await a.requestPermissions('read', ['weight']);
        const first = await a.readWeight({ days: 7, now });
        const second = await a.readWeight({ days: 7, now });
        expect(first).toEqual(second);
        if (first.status !== 'ok') throw new Error('expected data');
        expect(first.data.length).toBeGreaterThan(0);
        for (const r of first.data) {
          expect(r.id.startsWith(`${a.platform}:`)).toBe(true);
          expect(['this-app', 'other-app', 'unknown']).toContain(r.provenance.origin);
        }
      });
      it('says when the platform limited how far back it could read', async () => {
        if (!options.historyLimitDays) return;
        const a = await options.make();
        await a.requestPermissions('read', ['weight']);
        const limited = await a.readWeight({ days: options.historyLimitDays * 3 });
        expect(limited.status === 'ok' && limited.truncatedFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        const within = await a.readWeight({ days: options.historyLimitDays });
        expect(within.status === 'ok' && within.truncatedFrom).toBeFalsy();
        await a.requestPermissions('history', ['weight']);
        const extended = await a.readWeight({ days: options.historyLimitDays * 3 });
        expect(extended.status === 'ok' && extended.truncatedFrom).toBeFalsy();
      });
    });

    describe('changes', () => {
      it('reports deletions by id and treats an unknown cursor as expired', async () => {
        const a = await options.make();
        if (!options.hooks?.seedExternalWeight || !options.hooks.deleteWeight) return;
        await a.requestPermissions('read', ['weight']);
        options.hooks.seedExternalWeight(a, reading(`${a.platform}:c1`, '2026-10-20T08:00:00.000Z'));
        const first = await a.readChanges('weight', null);
        if (first.status !== 'ok') throw new Error('expected changes');
        expect(first.data.upserts.map((u) => u.id)).toContain(`${a.platform}:c1`);
        options.hooks.deleteWeight(a, `${a.platform}:c1`);
        const second = await a.readChanges('weight', first.data.cursor);
        expect(second).toMatchObject({ status: 'ok', data: { upserts: [], deletedIds: [`${a.platform}:c1`], hasMore: false } });
        expect(await a.readChanges('weight', 'not-a-cursor')).toEqual({ status: 'cursor-expired' });
      });
    });

    describe('writes', () => {
      it('is idempotent per record id and version, and replaces on a higher version', async () => {
        const a = await options.make();
        if (!options.hooks?.seedExternalWeight) return;
        await a.requestPermissions('read', ['weight']);
        await a.requestPermissions('write', ['weight']);
        const at = new Date(Date.now() - 3600_000).toISOString();
        const first = await a.write({ recordId: 'r1', version: 1, payload: { type: 'weight', measuredAt: at, kg: 70 } });
        const again = await a.write({ recordId: 'r1', version: 1, payload: { type: 'weight', measuredAt: at, kg: 70 } });
        const stale = await a.write({ recordId: 'r1', version: 0, payload: { type: 'weight', measuredAt: at, kg: 99 } });
        expect(first.status).toBe('ok');
        expect(again).toEqual(first);
        expect(stale).toEqual(first);
        await a.write({ recordId: 'r1', version: 2, payload: { type: 'weight', measuredAt: at, kg: 71 } });
        const all = await a.readWeight({ days: 7 });
        if (all.status !== 'ok') throw new Error('expected data');
        expect(all.data.filter((r) => r.provenance.origin === 'this-app').map((r) => r.kg)).toEqual([71]);
      });
      it('removes only samples this app wrote', async () => {
        const a = await options.make();
        if (!options.hooks?.seedExternalWeight) return;
        await a.requestPermissions('read', ['weight']);
        await a.requestPermissions('write', ['weight']);
        options.hooks.seedExternalWeight(a, reading(`${a.platform}:ext`, new Date(Date.now() - 7200_000).toISOString()));
        const at = new Date(Date.now() - 3600_000).toISOString();
        await a.write({ recordId: 'mine', version: 1, payload: { type: 'weight', measuredAt: at, kg: 70 } });
        await a.remove('weight', 'mine');
        await a.remove('weight', 'ext'); // not a record id we wrote: nothing happens
        const all = await a.readWeight({ days: 7 });
        if (all.status !== 'ok') throw new Error('expected data');
        expect(all.data.map((r) => r.id)).toEqual([`${a.platform}:ext`]);
      });
    });

    describe('shared contracts', () => {
      it('never expose native identifiers in any result', async () => {
        const a = await options.make();
        const collected: unknown[] = [await a.getAvailability()];
        for (const type of HEALTH_DATA_TYPES) {
          for (const access of ['read', 'write'] as const) collected.push(await a.getCapability(type, access));
          for (const access of ['read', 'write', 'history', 'background'] as const) collected.push(await a.getPermission(type, access));
          collected.push(await a.requestPermissions('read', [type]), await read(a, type), await a.remove(type, 'r1'));
        }
        collected.push(await a.readChanges('weight', null), await a.readChanges('weight', 'bad'));
        await a.requestPermissions('write', ['weight']);
        collected.push(await a.write({ recordId: 'r1', version: 1, payload: { type: 'weight', measuredAt: '2026-10-26T08:00:00.000Z', kg: 70 } }));
        expect(JSON.stringify(collected)).not.toMatch(PLATFORM_IDENTIFIER);
      });
    });
  });
}
