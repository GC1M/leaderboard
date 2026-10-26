import { saveHealthSleep } from './sleep';
const mockUpsert = jest.fn();
const mockSession = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: () => mockSession() }, from: () => ({ upsert: mockUpsert }) } }));
beforeEach(() => { jest.clearAllMocks(); mockSession.mockResolvedValue({ data: { session: { user: { id: 'a' } } } }); mockUpsert.mockResolvedValue({ error: null }); });
const day = { date: '2026-10-25', value: 450, windowStart: '2026-10-24T23:00:00Z', windowEnd: '2026-10-25T06:30:00Z' };
test('writes minutes and sleep windows with the captured owner', async () => {
  await saveHealthSleep('a', [day]);
  expect(mockUpsert.mock.calls[0][0][0]).toMatchObject({ user_id: 'a', metric: 'sleep_min', source: 'healthkit', value: 450 });
});
test('account changes cannot redirect a Health payload', async () => {
  await expect(saveHealthSleep('b', [day])).rejects.toThrow('account changed');
  expect(mockUpsert).not.toHaveBeenCalled();
});
test('rejects invalid minutes and propagates upload failure', async () => {
  await expect(saveHealthSleep('a', [{ ...day, value: NaN }])).rejects.toThrow('Invalid sleep');
  mockUpsert.mockResolvedValue({ error: { message: 'offline' } });
  await expect(saveHealthSleep('a', [day])).rejects.toThrow("Couldn't save sleep");
});
