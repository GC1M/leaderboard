import { planSync, validateSleep, validateSteps, validateWeight } from './rules';

describe('validateSteps', () => {
  it.each([
    ['0', 0],
    ['8,412', 8412],
    [' 80000 ', 80000],
  ])('accepts %p', (input, expected) => {
    expect(validateSteps(input)).toEqual({ ok: true, value: expected });
  });
  it.each(['80001', '-1', '12.5', 'abc', '', '1e3'])('rejects %p', (input) => {
    expect(validateSteps(input).ok).toBe(false);
  });
  it('gives the friendly cap message', () => {
    expect(validateSteps('80001')).toEqual({ ok: false, message: "Steps can't be more than 80,000 in a day." });
  });
});

describe('planSync merge rule', () => {
  const health = [
    { date: '2026-10-24', value: 9000.4 },
    { date: '2026-10-25', value: 100000 },
  ];
  it('writes health rows rounded, never capped', () => {
    expect(planSync(health, [])).toEqual({
      rows: [
        { date: '2026-10-24', value: 9000, source: 'healthkit' },
        { date: '2026-10-25', value: 100000, source: 'healthkit' },
      ],
      skipped: [],
    });
  });
  it('skips and reports invalid totals instead of inventing a value', () => {
    const bad = [
      { date: '2026-10-22', value: -5 },
      { date: '2026-10-23', value: NaN },
      { date: '2026-10-24', value: Infinity },
      { date: '2026-10-25', value: 0 },
    ];
    expect(planSync(bad, [])).toEqual({
      rows: [{ date: '2026-10-25', value: 0, source: 'healthkit' }],
      skipped: bad.slice(0, 3),
    });
  });
  it('never overwrites a manual day, even when health is higher', () => {
    const out = planSync(health, [{ date: '2026-10-24', value: 100, source: 'manual' }]);
    expect(out.rows.map((r) => r.date)).toEqual(['2026-10-25']);
  });
  it('overwrites an older healthkit row', () => {
    const out = planSync(health, [{ date: '2026-10-24', value: 5, source: 'healthkit' }]);
    expect(out.rows.map((r) => r.date)).toEqual(['2026-10-24', '2026-10-25']);
  });
});

describe('validateWeight and validateSleep', () => {
  it('converts pounds to kg and rejects bad input', () => {
    expect(validateWeight('165', 'lb')).toEqual({ ok: true, kg: 74.843 });
    expect(validateWeight('72,5', 'kg')).toEqual({ ok: true, kg: 72.5 });
    for (const bad of ['', '0', 'abc', '1000', '-3']) expect(validateWeight(bad, 'kg').ok).toBe(false);
  });
  it('needs a past interval of at most 24 hours', () => {
    const end = new Date(Date.now() - 3600_000);
    expect(validateSleep(new Date(end.getTime() - 8 * 3600_000), end)).toEqual({ ok: true });
    expect(validateSleep(end, end).ok).toBe(false);
    expect(validateSleep(new Date(end.getTime() - 25 * 3600_000), end).ok).toBe(false);
    expect(validateSleep(new Date(), new Date(Date.now() + 3600_000)).ok).toBe(false);
    expect(validateSleep(null, end).ok).toBe(false);
  });
});
