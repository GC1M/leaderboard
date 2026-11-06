import { buildEdit, type Entry, entryFromRow, groupDay, historyDays, loadDay, mergePending, removeEntry, saveEdit } from './diary';
import { emptyNutrients } from './nutrition';
import type { Food } from './search';

const mockGetFood = jest.fn();
const mockEnqueue = jest.fn();
const mockFlush = jest.fn();
const mockLoad = jest.fn();
const mockDiscard = jest.fn();
const mockRows = jest.fn();
const mockDeleteEq = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ order: () => mockRows() }) }),
      delete: () => ({ eq: (...a: unknown[]) => mockDeleteEq(...a) }),
    }),
  },
}));
jest.mock('@/lib/timezone', () => ({ deviceTimezone: () => 'America/Chicago' }));
jest.mock('./search', () => ({ getFood: (...a: unknown[]) => mockGetFood(...a) }));
jest.mock('./pending', () => ({
  enqueue: (...a: unknown[]) => mockEnqueue(...a),
  flushPending: (...a: unknown[]) => mockFlush(...a),
  loadPending: (...a: unknown[]) => mockLoad(...a),
  discard: (...a: unknown[]) => mockDiscard(...a),
}));

const row = (o: Record<string, unknown> = {}) => ({
  id: 'e1', client_id: 'c1', food_id: 'f1', meal: 'lunch', consumed_at: '2026-11-06T18:00:00Z', timezone: 'UTC', local_date: '2026-11-06',
  grams: 100, portion_label: null, portion_count: null, is_estimated: false, food_name: 'Rice', food_brand: null, provider: 'usda_fdc', provider_id: '1',
  source_data_type: 'SR Legacy', source_version: '2019', energy_kcal: 130, protein_g: 2.7, carbs_g: null, fat_g: 0, ...o,
}) as never;
const entry = (o: Record<string, unknown> = {}): Entry => entryFromRow(row(o));
const food: Food = { id: 'f1', name: 'Rice', brand: null, provider: 'usda_fdc', providerId: '1', sourceDataType: 'SR Legacy', sourceVersion: '2019', per100g: { ...emptyNutrients(), energy_kcal: 200, protein_g: 4 }, portions: [{ id: 'p1', label: 'cup', gramWeight: 150 }] };

describe('groupDay', () => {
  test('an empty day has no meals and no totals: no data, not zero', () => {
    const d = groupDay([]);
    expect(d.count).toBe(0);
    expect(d.meals).toEqual([]);
    expect(d.totals.energy_kcal).toBeNull();
  });

  test('groups by meal in order with totals; unknown is incomplete and a recorded zero is a number', () => {
    const d = groupDay([entry({ id: 'a', meal: 'dinner' }), entry({ id: 'b', meal: 'breakfast', energy_kcal: 70, fat_g: 0 }), entry({ id: 'c', meal: 'dinner', energy_kcal: 30, fat_g: 1 })]);
    expect(d.meals.map((m) => m.meal)).toEqual(['breakfast', 'dinner']);
    expect(d.meals[1].totals.energy_kcal).toBe(160);
    expect(d.totals.energy_kcal).toBe(230);
    expect(d.totals.fat_g).toBe(1);
    expect(d.totals.carbs_g).toBeNull();
    expect(d.incomplete).toContain('carbs_g');
    expect(d.incomplete).not.toContain('energy_kcal');
    expect(groupDay([entry({ energy_kcal: null })]).incomplete).toContain('energy_kcal');
  });
});

describe('mergePending', () => {
  test('applies a queued edit to its row and adds queued new entries, marked not synced', () => {
    const logRow = row({ id: undefined, client_id: 'c2', consumed_at: '2026-11-06T20:00:00Z' });
    const out = mergePending([row()], [
      { kind: 'edit', id: 'e1', patch: { grams: 50 }, error: 'x' },
      { kind: 'log', clientId: 'c2', row: logRow },
      { kind: 'log', clientId: 'c1', row: row() },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: 'e1', grams: 50, pending: 'edit', syncError: 'x' });
    expect(out[1]).toMatchObject({ id: null, clientId: 'c2', pending: 'log' });
  });
});

describe('buildEdit', () => {
  test('a new amount recomputes grams, portion and every nutrient from the source food together', () => {
    const p = buildEdit(entry(), { quantity: { mode: 'portion', portion: food.portions[0], count: 2 } }, food);
    expect(p).toMatchObject({ grams: 300, portion_label: 'cup', portion_count: 2, energy_kcal: 600, protein_g: 12, carbs_g: null });
  });

  test('without the source food the stored snapshot is scaled and unknown stays unknown', () => {
    const p = buildEdit(entry(), { quantity: { mode: 'grams', amount: 250 } }, null);
    expect(p).toMatchObject({ grams: 250, portion_label: null, portion_count: null, energy_kcal: 325, protein_g: 6.75, carbs_g: null, fat_g: 0 });
  });

  test('meal, time and estimate edits change only their columns; the time takes the device timezone', () => {
    expect(buildEdit(entry(), { meal: 'dinner', isEstimated: true, consumedAt: new Date('2026-11-06T18:00:00Z') }, null)).toEqual({ meal: 'dinner', is_estimated: true });
    expect(buildEdit(entry(), { consumedAt: new Date('2026-11-07T01:00:00Z') }, null)).toEqual({ consumed_at: '2026-11-07T01:00:00.000Z', timezone: 'America/Chicago' });
    expect(buildEdit(entry(), { meal: 'lunch', isEstimated: false }, null)).toEqual({});
  });

  test('rejects an unusable amount or time', () => {
    expect(() => buildEdit(entry(), { quantity: { mode: 'grams', amount: 0 } }, null)).toThrow('amount');
    expect(() => buildEdit(entry(), { consumedAt: new Date(Number.NaN) }, null)).toThrow('valid time');
  });
});

describe('saveEdit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFlush.mockResolvedValue(0);
    mockGetFood.mockResolvedValue(food);
  });

  test('queues one edit of the entry from the source food, then syncs', async () => {
    expect(await saveEdit('u1', entry(), { quantity: { mode: 'grams', amount: 50 } })).toBe(true);
    expect(mockEnqueue).toHaveBeenCalledWith('u1', { kind: 'edit', id: 'e1', patch: expect.objectContaining({ grams: 50, energy_kcal: 100 }) });
  });

  test('falls back to scaling the snapshot when the food cannot be read, and reports a failed sync', async () => {
    mockGetFood.mockRejectedValue(new Error('offline'));
    mockFlush.mockResolvedValue(1);
    expect(await saveEdit('u1', entry(), { quantity: { mode: 'grams', amount: 50 } })).toBe(false);
    expect(mockEnqueue.mock.calls[0][1].patch.energy_kcal).toBe(65);
  });

  test('editing an entry that never synced updates its queued log, and no change does nothing', async () => {
    mockLoad.mockResolvedValue([{ kind: 'log', clientId: 'c9', row: { grams: 100 } }]);
    await saveEdit('u1', entryFromRow(row({ id: undefined, client_id: 'c9' }), 'log'), { meal: 'snack' });
    expect(mockEnqueue).toHaveBeenCalledWith('u1', { kind: 'log', clientId: 'c9', row: { grams: 100, meal: 'snack' } });
    mockEnqueue.mockClear();
    expect(await saveEdit('u1', entry(), {})).toBe(true);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});

test('history skips days with no known total instead of drawing zeros', () => {
  const day = (date: string, energy_kcal: number | null) => ({ date, entries: 1, energy_kcal, protein_g: 0, carbs_g: null, fat_g: null, incomplete: false, kcalIncomplete: false });
  expect(historyDays([day('2026-11-01', 100), day('2026-11-02', null)], 'energy_kcal')).toEqual([{ date: '2026-11-01', value: 100 }]);
  expect(historyDays([day('2026-11-01', 100)], 'protein_g')).toEqual([{ date: '2026-11-01', value: 0 }]);
  expect(historyDays([day('2026-11-01', 100)], 'carbs_g')).toEqual([]);
});

describe('removeEntry', () => {
  beforeEach(() => jest.clearAllMocks());

  test('deletes the row by id and drops any queued edit of it', async () => {
    mockDeleteEq.mockResolvedValue({ error: null });
    await removeEntry('u1', entry());
    expect(mockDeleteEq).toHaveBeenCalledWith('id', 'e1');
    expect(mockDiscard).toHaveBeenCalledWith('u1', expect.objectContaining({ kind: 'edit', id: 'e1' }));
  });

  test('a failed delete throws and keeps the queue; an entry that never synced is only dropped locally', async () => {
    mockDeleteEq.mockResolvedValue({ error: { message: 'secret' } });
    await expect(removeEntry('u1', entry())).rejects.toThrow("Couldn't delete that entry. Try again.");
    expect(mockDiscard).not.toHaveBeenCalled();
    mockDeleteEq.mockClear();
    await removeEntry('u1', entryFromRow(row({ id: undefined, client_id: 'c9' }), 'log'));
    expect(mockDeleteEq).not.toHaveBeenCalled();
    expect(mockDiscard).toHaveBeenCalledWith('u1', expect.objectContaining({ kind: 'log', clientId: 'c9' }));
  });
});

describe('loadDay', () => {
  test('keeps this day only, shows saved entries when the server fails, and reports the error', async () => {
    mockLoad.mockResolvedValue([{ kind: 'log', clientId: 'c2', row: row({ id: undefined, client_id: 'c2' }) }, { kind: 'log', clientId: 'c3', row: row({ id: undefined, client_id: 'c3', consumed_at: '2026-11-20T12:00:00' }) }]);
    mockRows.mockResolvedValue({ data: null, error: { message: 'offline' } });
    const r = await loadDay('u1', entryFromRow(row({ consumed_at: '2026-11-06T18:00:00Z' }), 'log').localDate);
    expect(r.entries.map((e) => e.clientId)).toEqual(['c2']);
    expect(r.error).toContain('Pull down');
  });

  test('merges server rows with the queue', async () => {
    mockLoad.mockResolvedValue([]);
    mockRows.mockResolvedValue({ data: [row()], error: null });
    expect(await loadDay('u1', '2026-11-06')).toMatchObject({ error: null, entries: [{ id: 'e1' }] });
  });
});
