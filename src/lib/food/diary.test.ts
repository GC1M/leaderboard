import { buildEdit, type Entry, entryFromRow, getEntry, groupDay, historyDays, loadDay, mergePending, removeEntry, saveEdit } from './diary';
import { emptyNutrients } from './nutrition';
import type { Food } from './search';

const mockEnqueue = jest.fn();
const mockFlush = jest.fn();
const mockLoad = jest.fn();
const mockDiscard = jest.fn();
const mockRows = jest.fn();
const mockDeleteEq = jest.fn();
const mockIn = jest.fn();
const mockLookup = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ order: () => mockRows(), maybeSingle: () => mockLookup() }), in: (...a: unknown[]) => mockIn(...a) }),
      delete: () => ({ eq: (...a: unknown[]) => mockDeleteEq(...a) }),
    }),
  },
}));
jest.mock('@/lib/timezone', () => ({ deviceTimezone: () => 'America/Chicago' }));
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
  test('a new amount scales the entry snapshot, not the food: later edits of the food never reach a logged entry', () => {
    // Logged at 130 kcal per 100 g. The food has since been changed to 200 kcal per 100 g; the entry still scales its own 130.
    const p = buildEdit(entry(), { quantity: { mode: 'portion', portion: food.portions[0], count: 2 } });
    expect(p).toMatchObject({ grams: 300, portion_label: 'cup', portion_count: 2, energy_kcal: 390, protein_g: 8.1, carbs_g: null });
  });

  test('unknown stays unknown and a recorded zero stays zero', () => {
    const p = buildEdit(entry(), { quantity: { mode: 'grams', amount: 250 } });
    expect(p).toMatchObject({ grams: 250, portion_label: null, portion_count: null, energy_kcal: 325, protein_g: 6.75, carbs_g: null, fat_g: 0 });
  });

  test('meal, time and estimate edits change only their columns; the time takes the device timezone', () => {
    expect(buildEdit(entry(), { meal: 'dinner', isEstimated: true, consumedAt: new Date('2026-11-06T18:00:00Z') })).toEqual({ meal: 'dinner', is_estimated: true });
    expect(buildEdit(entry(), { consumedAt: new Date('2026-11-07T01:00:00Z') })).toEqual({ consumed_at: '2026-11-07T01:00:00.000Z', timezone: 'America/Chicago' });
    expect(buildEdit(entry(), { meal: 'lunch', isEstimated: false })).toEqual({});
  });

  test('rejects an unusable amount or time', () => {
    expect(() => buildEdit(entry(), { quantity: { mode: 'grams', amount: 0 } })).toThrow('amount');
    expect(() => buildEdit(entry(), { consumedAt: new Date(Number.NaN) })).toThrow('valid time');
  });
});

describe('saveEdit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFlush.mockResolvedValue(0);
  });

  test('queues one edit of the entry scaled from its own snapshot, then syncs', async () => {
    expect(await saveEdit('u1', entry(), { quantity: { mode: 'grams', amount: 50 } })).toBe(true);
    expect(mockEnqueue).toHaveBeenCalledWith('u1', { kind: 'edit', id: 'e1', patch: expect.objectContaining({ grams: 50, energy_kcal: 65 }) });
  });

  test('reports a failed sync as false, with the same patch queued', async () => {
    mockFlush.mockResolvedValue(1);
    expect(await saveEdit('u1', entry(), { quantity: { mode: 'grams', amount: 50 } })).toBe(false);
    expect(mockEnqueue.mock.calls[0][1].patch.energy_kcal).toBe(65);
  });

  test('an entry whose queued log was uploaded meanwhile is edited by the id the server gave it', async () => {
    mockLoad.mockResolvedValue([]);
    mockLookup.mockResolvedValue({ data: { id: 'srv1' }, error: null });
    await saveEdit('u1', entryFromRow(row({ id: undefined, client_id: 'c9' }), 'log'), { meal: 'snack' });
    expect(mockEnqueue).toHaveBeenCalledWith('u1', { kind: 'edit', id: 'srv1', patch: { meal: 'snack' } });
  });

  test('an unsynced entry that cannot be found anywhere throws instead of reporting success, and the queue is untouched', async () => {
    mockLoad.mockResolvedValue([]);
    mockLookup.mockResolvedValue({ data: null, error: null });
    await expect(saveEdit('u1', entryFromRow(row({ id: undefined, client_id: 'c9' }), 'log'), { meal: 'snack' })).rejects.toThrow('This entry changed. Reload it.');
    mockLookup.mockResolvedValue({ data: null, error: { message: 'offline' } });
    await expect(saveEdit('u1', entryFromRow(row({ id: undefined, client_id: 'c9' }), 'log'), { meal: 'snack' })).rejects.toThrow("Couldn't save that entry");
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockFlush).not.toHaveBeenCalled();
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

  test('deletes the row by id and drops its queued edit and any queued log of the same client id', async () => {
    mockDeleteEq.mockResolvedValue({ error: null });
    await removeEntry('u1', entry());
    expect(mockDeleteEq).toHaveBeenCalledWith('id', 'e1');
    expect(mockDiscard).toHaveBeenCalledWith('u1', expect.objectContaining({ kind: 'edit', id: 'e1' }));
    expect(mockDiscard).toHaveBeenCalledWith('u1', expect.objectContaining({ kind: 'log', clientId: 'c1' }));
  });

  test('a failed delete throws, says a connection is needed, and keeps the queue', async () => {
    mockDeleteEq.mockResolvedValue({ error: { message: 'secret' } });
    await expect(removeEntry('u1', entry())).rejects.toThrow('A connection is needed to delete');
    expect(mockDiscard).not.toHaveBeenCalled();
  });

  test('an entry that never synced is removed locally first, even offline, and a queued purge deletes any server copy after the in-flight flush', async () => {
    const order: string[] = [];
    mockDiscard.mockImplementation(async () => void order.push('discard'));
    mockEnqueue.mockImplementation(async () => void order.push('purge queued'));
    mockFlush.mockImplementation(async () => { order.push('flush'); throw new Error('offline'); });
    await removeEntry('u1', entryFromRow(row({ id: undefined, client_id: 'c9' }), 'log'));
    expect(order).toEqual(['purge queued', 'discard', 'flush']);
    expect(mockEnqueue).toHaveBeenCalledWith('u1', { kind: 'purge', clientId: 'c9' });
    expect(mockDeleteEq).not.toHaveBeenCalled();
    mockDiscard.mockReset();
    mockEnqueue.mockReset();
    mockFlush.mockReset();
  });
});

describe('removeEntry and the Health export', () => {
  beforeEach(() => jest.clearAllMocks());

  test('tells the export about the deleted id right after the server delete, before the queue is cleaned, even with a queued edit', async () => {
    const order: string[] = [];
    mockDeleteEq.mockImplementation(async () => { order.push('server'); return { error: null }; });
    mockDiscard.mockImplementation(async () => { order.push('discard'); });
    await removeEntry('u1', entryFromRow(row(), 'edit'), async (id) => { order.push(`export:${id}`); });
    expect(order).toEqual(['server', 'export:e1', 'discard', 'discard']);
  });

  test('does not queue a Health delete when the server delete fails', async () => {
    mockDeleteEq.mockResolvedValue({ error: { message: 'x' } });
    const onRemoved = jest.fn();
    await expect(removeEntry('u1', entry(), onRemoved)).rejects.toThrow();
    expect(onRemoved).not.toHaveBeenCalled();
  });

  test('an entry that looked unsynced but reached the server is found by client id and its Health copy is queued before the flush', async () => {
    const order: string[] = [];
    mockLookup.mockResolvedValue({ data: { id: 'x9' } });
    mockEnqueue.mockImplementation(async () => void order.push('purge queued'));
    mockFlush.mockImplementation(async () => { order.push('flush'); return 0; });
    const onRemoved = jest.fn(async (id: string) => void order.push(`export:${id}`));
    await removeEntry('u1', entryFromRow(row({ id: undefined, client_id: 'c9' }), 'log'), onRemoved);
    expect(order).toEqual(['purge queued', 'export:x9', 'flush']);
    mockEnqueue.mockReset();
    mockFlush.mockReset();
  });

  test('an unsynced entry the server never had, or an offline lookup, has nothing to remove from Health', async () => {
    const onRemoved = jest.fn(async () => {});
    mockFlush.mockResolvedValue(0);
    mockLookup.mockResolvedValueOnce({ data: null });
    await removeEntry('u1', entryFromRow(row({ id: undefined, client_id: 'c9' }), 'log'), onRemoved);
    mockLookup.mockRejectedValueOnce(new Error('offline'));
    await removeEntry('u1', entryFromRow(row({ id: undefined, client_id: 'c9' }), 'log'), onRemoved);
    expect(onRemoved).not.toHaveBeenCalled();
  });
});

describe('loadDay', () => {
  beforeEach(() => jest.clearAllMocks());

  test('keeps this day only, shows saved entries when the server fails, and reports the error', async () => {
    mockLoad.mockResolvedValue([{ kind: 'log', clientId: 'c2', row: row({ id: undefined, client_id: 'c2', local_date: undefined }) }, { kind: 'log', clientId: 'c3', row: row({ id: undefined, client_id: 'c3', local_date: undefined, consumed_at: '2026-11-20T12:00:00' }) }]);
    mockRows.mockResolvedValue({ data: null, error: { message: 'offline' } });
    const day = entryFromRow(row({ id: undefined, local_date: undefined }), 'log').localDate;
    const r = await loadDay('u1', day);
    expect(r.entries.map((e) => e.clientId)).toEqual(['c2']);
    expect(r.error).toContain('Pull down');
  });

  test('merges server rows with the queue', async () => {
    mockLoad.mockResolvedValue([]);
    mockRows.mockResolvedValue({ data: [row()], error: null });
    expect(await loadDay('u1', '2026-11-06')).toMatchObject({ error: null, entries: [{ id: 'e1' }] });
  });

  test('an edit that moves an entry to another day leaves the old day and appears on the new one', async () => {
    const moved = new Date(2026, 10, 9, 12).toISOString();
    mockLoad.mockResolvedValue([{ kind: 'edit', id: 'e1', patch: { consumed_at: moved, timezone: 'America/Chicago' } }]);
    mockRows.mockResolvedValue({ data: [row()], error: null });
    expect((await loadDay('u1', '2026-11-06')).entries).toEqual([]);
    expect(mockIn).not.toHaveBeenCalled();
    mockRows.mockResolvedValue({ data: [], error: null });
    mockIn.mockResolvedValue({ data: [row()], error: null });
    const r = await loadDay('u1', '2026-11-09');
    expect(mockIn).toHaveBeenCalledWith('id', ['e1']);
    expect(r.entries).toMatchObject([{ id: 'e1', localDate: '2026-11-09', pending: 'edit' }]);
  });
});

test('a queued edit that does not change the time keeps the server local date', () => {
  // The entry was logged in another timezone, so its day is not the one this device would compute.
  const r = row({ consumed_at: '2026-11-06T03:00:00Z', timezone: 'Asia/Tokyo', local_date: '2026-11-06' });
  expect(mergePending([r], [{ kind: 'edit', id: 'e1', patch: { grams: 50 } }])[0].localDate).toBe('2026-11-06');
});

test('a row with a queued purge is not shown', () => {
  expect(mergePending([row()], [{ kind: 'purge', clientId: 'c1' }])).toEqual([]);
});

test('getEntry answers null, not undefined, for a row hidden by a queued purge', async () => {
  mockLookup.mockResolvedValue({ data: row(), error: null });
  mockLoad.mockResolvedValue([{ kind: 'purge', clientId: 'c1' }]);
  expect(await getEntry('u1', 'e1')).toBeNull();
  mockLoad.mockResolvedValue([]);
  expect(await getEntry('u1', 'e1')).toMatchObject({ id: 'e1' });
});
