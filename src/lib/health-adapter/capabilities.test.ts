import { HEALTH_TYPES } from '../health/healthkit';
import { ANDROID_MATRIX, CAPABILITY_MATRICES, IOS_MATRIX, describeCapability, resolveCapability, type PlatformMatrix } from './capabilities';
import { HEALTH_DATA_TYPES } from './types';

describe.each([IOS_MATRIX, ANDROID_MATRIX])('$platform matrix', (matrix: PlatformMatrix) => {
  it('covers every data type', () => {
    expect(Object.keys(matrix.entries).sort()).toEqual([...HEALTH_DATA_TYPES].sort());
  });
  it('never claims an implemented path the platform does not offer', () => {
    for (const entry of Object.values(matrix.entries)) {
      if (entry.implemented.read) expect(entry.read).toBe(true);
      if (entry.implemented.write) expect(entry.write).toBe(true);
    }
  });
  it('lists as unverified only facts that exist', () => {
    for (const entry of Object.values(matrix.entries)) entry.unverified.forEach((f) => expect(['read', 'write', 'history', 'background']).toContain(f));
  });
  it('contains no native identifiers', () => {
    expect(JSON.stringify(matrix)).not.toMatch(/HK[A-Za-z]*Identifier|android\.permission|androidx\./);
  });
});

describe('iOS entries match the existing Apple Health behavior', () => {
  // The app imports workouts and water (src/lib/health/workouts.ts, water.ts) but the adapter has no reader for them yet. Listing the gap here keeps
  // the check strict: a newly imported metric fails this test until it is wired or added here on purpose.
  const IMPORTED_BUT_NOT_WIRED = ['workouts', 'water'];
  it('reads exactly the imported metrics the adapter wires', () => {
    const imported = Object.keys(HEALTH_TYPES).filter((t) => !IMPORTED_BUT_NOT_WIRED.includes(t)).sort();
    const read = HEALTH_DATA_TYPES.filter((t) => IOS_MATRIX.entries[t].implemented.read).sort();
    expect(read).toEqual(imported);
    expect(imported).toEqual(['sleep', 'steps', 'weight']);
    expect(Object.keys(HEALTH_TYPES).sort()).toEqual([...imported, ...IMPORTED_BUT_NOT_WIRED].sort());
  });
  it('allows writing every imported metric but wires no writer through the adapter (the export queue writes directly)', () => {
    for (const metric of Object.keys(HEALTH_TYPES) as (keyof typeof HEALTH_TYPES)[]) {
      expect(IOS_MATRIX.entries[metric].write).toBe(true);
      expect(IOS_MATRIX.entries[metric].implemented.write).toBe(false);
    }
  });
  it('is foreground-only with no platform history window, as in docs/health-sync.md', () => {
    for (const entry of Object.values(IOS_MATRIX.entries)) {
      expect(entry.background).toBe('foreground-only');
      expect(entry.history).toEqual({ defaultDays: null, extendedBy: null });
    }
  });
});

describe('Android entries', () => {
  it('offers every type for read and write but has no adapter wired yet', () => {
    for (const entry of Object.values(ANDROID_MATRIX.entries)) {
      expect(entry.read && entry.write).toBe(true);
      expect(entry.implemented).toEqual({ read: false, write: false });
    }
  });
  it('limits reads to 30 days unless the history permission is granted, and needs a permission for background reads', () => {
    for (const entry of Object.values(ANDROID_MATRIX.entries)) {
      expect(entry.history).toEqual({ defaultDays: 30, extendedBy: 'permission' });
      expect(entry.background).toBe('permission-required');
    }
  });
  it('requires Android 9', () => {
    expect(ANDROID_MATRIX.minimum.os).toBe('Android 9 (API 28)');
  });
});

describe('resolveCapability', () => {
  const available = { status: 'available' } as const;
  it('reports provider problems before per-type ones', () => {
    expect(resolveCapability(IOS_MATRIX, { status: 'unavailable', reason: 'native-build-required' }, 'steps', 'read')).toEqual({ status: 'unavailable', reason: 'native-build-required' });
    expect(resolveCapability(ANDROID_MATRIX, { status: 'unsupported', reason: 'work-profile' }, 'steps', 'read')).toEqual({ status: 'unsupported', reason: 'work-profile' });
  });
  it('separates what the platform lacks from what the app has not built', () => {
    const noWrites = { ...IOS_MATRIX, entries: { ...IOS_MATRIX.entries, water: { ...IOS_MATRIX.entries.water, write: false } } };
    expect(resolveCapability(noWrites, available, 'water', 'write')).toEqual({ status: 'unsupported', reason: 'platform' });
    expect(resolveCapability(IOS_MATRIX, available, 'water', 'read')).toEqual({ status: 'unsupported', reason: 'not-implemented' });
    expect(resolveCapability(IOS_MATRIX, available, 'steps', 'read')).toEqual({ status: 'supported' });
  });
  it('has wording for every reason', () => {
    const reasons = ['platform', 'os-version', 'work-profile', 'not-implemented'] as const;
    for (const reason of reasons) expect(describeCapability({ status: 'unsupported', reason }, CAPABILITY_MATRICES.android, 'sleep')).toMatch(/Health Connect/);
    for (const reason of ['provider-missing', 'provider-update-required', 'native-build-required'] as const) {
      expect(describeCapability({ status: 'unavailable', reason }, CAPABILITY_MATRICES.ios, 'sleep')).toMatch(/Apple Health/);
    }
  });
});
