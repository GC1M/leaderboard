import { secureStorage } from './secure-storage';
import { clearAllDrafts, clearDraft, listDrafts, loadDraft, saveDraft } from './workout-draft';
import { emptyForm } from './workout-form';

const mockMem = new Map<string, string>();
jest.mock('./secure-storage', () => ({
  secureStorage: {
    getItem: jest.fn(async (k: string) => mockMem.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => void mockMem.set(k, v)),
    removeItem: jest.fn(async (k: string) => void mockMem.delete(k)),
  },
}));

const form = emptyForm(new Date(2026, 9, 26, 9, 5), 'kg', 'km');
const fresh = { editingId: null, form };
const edit = { editingId: 'w1', form: { ...form, activityType: 'Edited' } };

beforeEach(() => mockMem.clear());

test('saves, resumes and clears a draft per account', async () => {
  await saveDraft('u1', fresh);
  expect(await loadDraft('u1', null)).toEqual(fresh);
  expect(await loadDraft('u2', null)).toBeNull();
  await clearDraft('u1', null);
  expect(await loadDraft('u1', null)).toBeNull();
  expect(await listDrafts('u1')).toEqual([]);
});

test('a new entry and an edit keep separate drafts', async () => {
  await saveDraft('u1', edit);
  await saveDraft('u1', fresh);
  await saveDraft('u1', fresh);
  expect(await loadDraft('u1', 'w1')).toEqual(edit);
  expect(await loadDraft('u1', null)).toEqual(fresh);
  expect(await listDrafts('u1')).toEqual(['w1', null]);
  await clearDraft('u1', null);
  expect(await listDrafts('u1')).toEqual(['w1']);
  expect(await loadDraft('u1', 'w1')).toEqual(edit);
});

test('clearing all drafts removes every one for the account only', async () => {
  await saveDraft('u1', edit);
  await saveDraft('u1', fresh);
  await saveDraft('u2', fresh);
  await clearAllDrafts('u1');
  expect(await listDrafts('u1')).toEqual([]);
  expect(await loadDraft('u1', 'w1')).toBeNull();
  expect(await loadDraft('u2', null)).toEqual(fresh);
});

test('storage failures never throw', async () => {
  (secureStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('full'));
  (secureStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('locked'));
  await expect(saveDraft('u1', fresh)).resolves.toBeUndefined();
  await expect(loadDraft('u1', null)).resolves.toBeNull();
});

test('a clear waits for an in-flight autosave so discarded drafts cannot reappear', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  (secureStorage.setItem as jest.Mock).mockImplementationOnce(async (k: string, v: string) => { await gate; mockMem.set(k, v); });
  const saving = saveDraft('u1', fresh);
  const clearing = clearDraft('u1', null);
  release(); await Promise.all([saving, clearing]);
  expect(await loadDraft('u1', null)).toBeNull();
  expect(await listDrafts('u1')).toEqual([]);
});
