import { FakeHealthAdapter } from './fake-adapter';
import { runHealthAdapterContract } from './contract-suite';
import { describeCapability } from './capabilities';

runHealthAdapterContract('FakeHealthAdapter', {
  make: () => new FakeHealthAdapter(),
  matrix: new FakeHealthAdapter().matrix,
  historyLimitDays: 30,
  hooks: {
    seedExternalWeight: (a, reading) => (a as FakeHealthAdapter).seedWeight(reading),
    deleteWeight: (a, id) => (a as FakeHealthAdapter).deleteWeight(id),
    makeUnavailable: () => {
      const a = new FakeHealthAdapter();
      a.availability = { status: 'unavailable', reason: 'provider-missing' };
      return a;
    },
  },
});

describe('FakeHealthAdapter', () => {
  it('stops reading when a permission is revoked instead of returning an empty list', async () => {
    const a = new FakeHealthAdapter();
    await a.requestPermissions('read', ['steps']);
    expect((await a.readSteps({ days: 7 })).status).toBe('ok');
    a.revoke('steps', 'read');
    expect(await a.readSteps({ days: 7 })).toEqual({ status: 'permission-required', access: 'read' });
  });
  it('gives each missing capability honest wording', async () => {
    const a = new FakeHealthAdapter();
    expect(describeCapability(await a.getCapability('water', 'read'), a.matrix, 'water')).toBe("Health Connect doesn't support water on this device.");
    a.availability = { status: 'unavailable', reason: 'provider-update-required' };
    expect(describeCapability(await a.getCapability('steps', 'read'), a.matrix, 'steps')).toBe('Update Health Connect to use steps.');
    a.availability = { status: 'unsupported', reason: 'os-version' };
    expect(describeCapability(await a.getCapability('steps', 'read'), a.matrix, 'steps')).toBe('Health Connect needs Android 9 (API 28) or newer.');
    expect(describeCapability({ status: 'supported' }, a.matrix, 'steps')).toBeNull();
  });
});
