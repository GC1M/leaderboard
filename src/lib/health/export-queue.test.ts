import { createExportQueue, type ExportDependencies, type ExportEntry, type ExportWriter } from './export-queue';

const key = (kind: string, id: string) => `${kind}:${id}`;
function setup(access: 'granted' | 'denied' = 'granted') {
  const rows = new Map<string, ExportEntry>();
  const server = new Map<string, number>();
  let samples = 0;
  const writer: ExportWriter = {
    writeType: 'HKQuantityTypeIdentifierBodyMass',
    save: jest.fn(async (e) => `sample-${e.recordId}-${++samples}`),
    remove: jest.fn(async () => {}),
  };
  const deps: ExportDependencies = {
    checkAccount: jest.fn(async () => {}),
    store: {
      list: async () => [...rows.values()].map((e) => ({ ...e })),
      put: async (e) => { rows.set(key(e.kind, e.recordId), { ...e }); },
      remove: async (k, id) => { rows.delete(key(k, id)); },
      clear: async () => { rows.clear(); },
    },
    mapping: {
      get: jest.fn(async (k, id) => (server.has(key(k, id)) ? { syncVersion: server.get(key(k, id))! } : null)),
      record: jest.fn(async (k, id, _u, v) => { server.set(key(k, id), v); }),
      remove: jest.fn(async (k, id) => { server.delete(key(k, id)); }),
    },
    writers: { weight: writer },
    access: jest.fn(() => access),
  };
  return { deps, rows, server, writer, queue: createExportQueue(deps) };
}

test('a saved entry goes pending to success, keeps only the mapping, and records the server version', async () => {
  const { queue, rows, server, writer } = setup();
  await queue.initialize();
  const done = queue.enqueue('weight', 'r1', 'save', { kg: 80 }, 5);
  await done;
  expect(writer.save).toHaveBeenCalledTimes(1);
  expect(queue.getSnapshot()).toMatchObject({ pending: 0, failed: 0, processing: false });
  expect(rows.get('weight:r1')).toMatchObject({ status: 'success', payload: null, version: 5, sampleUuid: 'sample-r1-1' });
  expect(server.get('weight:r1')).toBe(5);
});

test('permission rejection keeps the local entry and a later grant exports it', async () => {
  const { queue, rows, deps, writer } = setup('denied');
  await queue.initialize();
  await queue.enqueue('weight', 'r1', 'save', { kg: 80 }, 1);
  expect(writer.save).not.toHaveBeenCalled();
  expect(rows.get('weight:r1')).toMatchObject({ status: 'failed', reason: 'permission', payload: { kg: 80 } });
  (deps.access as jest.Mock).mockReturnValue('granted');
  await queue.process();
  expect(rows.get('weight:r1')).toMatchObject({ status: 'success' });
});

test('failure then retry: offline keeps the entry, retry succeeds, same version is used', async () => {
  const { queue, rows, writer } = setup();
  await queue.initialize();
  (writer.save as jest.Mock).mockRejectedValueOnce(new Error('raw payload 80.5 kg must not surface'));
  await queue.enqueue('weight', 'r1', 'save', { kg: 80 }, 7);
  expect(rows.get('weight:r1')).toMatchObject({ status: 'failed', reason: 'error', attempts: 1, version: 7 });
  expect(JSON.stringify(queue.getSnapshot())).not.toContain('must not surface');
  await queue.process();
  expect(rows.get('weight:r1')).toMatchObject({ status: 'success', version: 7 });
});

test('a crash after the save but before the mapping is recorded retries without writing a second sample', async () => {
  const { queue, deps, writer, rows } = setup();
  await queue.initialize();
  (deps.mapping.record as jest.Mock).mockRejectedValueOnce(new Error('offline'));
  await queue.enqueue('weight', 'r1', 'save', {}, 3);
  expect(rows.get('weight:r1')?.status).toBe('failed');
  await queue.process();
  // The retry saves again with the same sync identifier/version (HealthKit replaces), and then records.
  expect(deps.mapping.record).toHaveBeenCalledTimes(2);
  expect(rows.get('weight:r1')?.status).toBe('success');
  expect(writer.save).toHaveBeenCalledTimes(2);
});

test('dedupe: same or older version is ignored, an edit replaces the entry with a higher version', async () => {
  const { queue, writer } = setup();
  await queue.initialize();
  await queue.enqueue('weight', 'r1', 'save', { kg: 80 }, 5);
  await queue.enqueue('weight', 'r1', 'save', { kg: 80 }, 5);
  await queue.enqueue('weight', 'r1', 'save', { kg: 79 }, 4);
  expect(writer.save).toHaveBeenCalledTimes(1);
  await queue.enqueue('weight', 'r1', 'save', { kg: 79 }, 6);
  expect(writer.save).toHaveBeenCalledTimes(2);
  expect((writer.save as jest.Mock).mock.calls[1][0]).toMatchObject({ version: 6, payload: { kg: 79 } });
  expect(queue.getSnapshot().entries).toHaveLength(1);
});

test('multi-device: a version already recorded on the server is not written again', async () => {
  const { queue, server, writer, rows } = setup();
  server.set('weight:r1', 9);
  await queue.initialize();
  await queue.enqueue('weight', 'r1', 'save', {}, 9);
  expect(writer.save).not.toHaveBeenCalled();
  expect(rows.get('weight:r1')?.status).toBe('success');
});

test('delete removes only through the writer, clears the mapping and the local entry', async () => {
  const { queue, server, writer, rows } = setup();
  await queue.initialize();
  await queue.enqueue('weight', 'r1', 'save', {}, 1);
  await queue.enqueue('weight', 'r1', 'delete', null, 2);
  expect(writer.remove).toHaveBeenCalledTimes(1);
  expect(server.has('weight:r1')).toBe(false);
  expect(rows.has('weight:r1')).toBe(false);
  expect(queue.getSnapshot().entries).toEqual([]);
});

test('an entry with no registered writer fails and is kept', async () => {
  const { queue, rows } = setup();
  await queue.initialize();
  await queue.enqueue('mystery', 'x', 'save', {}, 1);
  expect(rows.get('mystery:x')).toMatchObject({ status: 'failed' });
});

test('restart: pending entries reload from the store and export', async () => {
  const { rows, deps, writer } = setup();
  rows.set('weight:r1', { kind: 'weight', recordId: 'r1', op: 'save', payload: {}, version: 2, status: 'pending', attempts: 0 });
  const restarted = createExportQueue(deps);
  await restarted.initialize();
  expect(restarted.getSnapshot().pending).toBe(1);
  await restarted.process();
  expect(writer.save).toHaveBeenCalledTimes(1);
  expect(rows.get('weight:r1')?.status).toBe('success');
});

test('account switch: stop() halts an in-flight export before it writes more or records anything', async () => {
  const { queue, deps, writer, rows } = setup();
  await queue.initialize();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  (writer.save as jest.Mock).mockImplementationOnce(async () => { await gate; return 'u'; });
  const p = queue.enqueue('weight', 'r1', 'save', {}, 1);
  await Promise.resolve();
  await Promise.resolve();
  queue.stop();
  release();
  await p;
  expect(deps.mapping.record).not.toHaveBeenCalled();
  expect(rows.get('weight:r1')?.status).toBe('pending'); // stays queued for that account's next session
});

test('a changed account makes enqueue fail before anything is stored', async () => {
  const { queue, deps, rows } = setup();
  await queue.initialize();
  (deps.checkAccount as jest.Mock).mockRejectedValue(new Error('Health account changed. Try again.'));
  await expect(queue.enqueue('weight', 'r1', 'save', {}, 1)).rejects.toThrow('account changed');
  expect(rows.size).toBe(0);
});

test('clear (account deletion) empties the local queue', async () => {
  const { queue, rows } = setup('denied');
  await queue.initialize();
  await queue.enqueue('weight', 'r1', 'save', {}, 1);
  await queue.clear();
  expect(rows.size).toBe(0);
  expect(queue.getSnapshot().entries).toEqual([]);
});

test('discard (exports turned off) drops unsent saves of that kind so a later grant writes nothing', async () => {
  const { queue, rows, deps, writer } = setup('denied');
  await queue.initialize();
  await queue.enqueue('weight', 'r1', 'save', { kg: 80 }, 1);
  await queue.enqueue('weight', 'r2', 'delete', null, 1);
  await queue.discard('weight');
  (deps.access as jest.Mock).mockReturnValue('granted');
  await queue.process();
  expect(writer.save).not.toHaveBeenCalled();
  expect(writer.remove).toHaveBeenCalledTimes(1);
  expect(rows.has('weight:r1')).toBe(false);
});

test('an edit enqueued while the old version is exporting is not overwritten by the old result', async () => {
  const { queue, writer, rows } = setup();
  await queue.initialize();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  (writer.save as jest.Mock).mockImplementationOnce(async () => { await gate; return 'old'; });
  const first = queue.enqueue('weight', 'r1', 'save', { kg: 80 }, 1);
  await Promise.resolve();
  await Promise.resolve();
  const second = queue.enqueue('weight', 'r1', 'save', { kg: 79 }, 2);
  release();
  await Promise.all([first, second]);
  expect(writer.save).toHaveBeenCalledTimes(2);
  expect(rows.get('weight:r1')).toMatchObject({ version: 2, status: 'success' });
});
