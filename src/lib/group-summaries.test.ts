import { buildMemberSummaries, sleepText, weightText } from './group-summaries';

const members = [
  { userId: 'a', name: 'Ann' },
  { userId: 'b', name: 'Bo' },
  { userId: 'c', name: 'Cy' },
];
const now = new Date(2026, 9, 26, 12);

describe('buildMemberSummaries', () => {
  const out = buildMemberSummaries(
    members,
    { a: ['sleep', 'weight'], b: ['sleep', 'weight'], c: ['steps'] },
    [
      { user_id: 'a', date: '2026-10-24', minutes: 400 },
      { user_id: 'a', date: '2026-10-25', minutes: 0 },
    ],
    [{ user_id: 'a', measured_on: '2026-10-19', kg: 70 }],
  );
  it('takes the latest sleep date and keeps a recorded zero as a value', () => {
    expect(out[0].sleep).toEqual({ state: 'recorded', value: 0, date: '2026-10-25' });
  });
  it('shared but never synced is no data', () => {
    expect(out[1].sleep).toEqual({ state: 'no_data' });
    expect(out[1].weight).toEqual({ state: 'no_data' });
  });
  it('an unshared metric is not shared even if readings exist', () => {
    const o = buildMemberSummaries(
      members,
      { c: ['steps'] },
      [{ user_id: 'c', date: '2026-10-25', minutes: 300 }],
      [{ user_id: 'c', measured_on: '2026-10-25', kg: 80 }],
    );
    expect(o[2].sleep).toEqual({ state: 'not_shared' });
    expect(o[2].weight).toEqual({ state: 'not_shared' });
  });
});

describe('text', () => {
  it('shows value with a date label, stale dates included', () => {
    expect(sleepText({ state: 'recorded', value: 440, date: '2026-10-26' }, now)).toBe('7h 20m, Today');
    expect(sleepText({ state: 'recorded', value: 0, date: '2026-10-25' }, now)).toBe('0m, Yesterday');
    expect(weightText({ state: 'recorded', value: 70, date: '2026-10-19' }, 'kg', now)).toBe('70.0 kg, Oct 19');
    expect(weightText({ state: 'recorded', value: 70, date: '2026-10-19' }, 'lb', now)).toBe('154.3 lb, Oct 19');
  });
  it('states without a value', () => {
    expect(sleepText({ state: 'no_data' }, now)).toBe('No data');
    expect(weightText({ state: 'not_shared' }, 'kg', now)).toBe('Not shared');
  });
});
