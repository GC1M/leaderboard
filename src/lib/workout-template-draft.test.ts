import { secureStorage } from './secure-storage';
import { clearAllDrafts, listDrafts, loadDraft, saveDraft } from './workout-draft';
import { emptyForm } from './workout-form';
import { clearAllTemplateDrafts, clearTemplateDraft, listTemplateDrafts, loadTemplateDraft, saveTemplateDraft } from './workout-template-draft';

const mockMem = new Map<string, string>();
jest.mock('./secure-storage', () => ({
  secureStorage: {
    getItem: jest.fn(async (k: string) => mockMem.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => void mockMem.set(k, v)),
    removeItem: jest.fn(async (k: string) => void mockMem.delete(k)),
  },
}));

const form = emptyForm(new Date(2026, 9, 26, 9, 5), 'kg', 'km');
const fresh = { editingId: null, name: 'Push day', form };
const edit = { editingId: 't1', name: 'Edited', form: { ...form, activityType: 'Edited' } };

beforeEach(() => mockMem.clear());

test('saves, resumes and clears a draft per account', async () => {
  await saveTemplateDraft('u1', fresh);
  expect(await loadTemplateDraft('u1', null)).toEqual(fresh);
  expect(await loadTemplateDraft('u2', null)).toBeNull();
  await clearTemplateDraft('u1', null);
  expect(await loadTemplateDraft('u1', null)).toBeNull();
  expect(await listTemplateDrafts('u1')).toEqual([]);
});

test('a new template and an edit keep separate drafts, and saving again updates in place', async () => {
  await saveTemplateDraft('u1', edit);
  await saveTemplateDraft('u1', fresh);
  await saveTemplateDraft('u1', { ...fresh, name: 'Pull day' });
  expect(await loadTemplateDraft('u1', 't1')).toEqual(edit);
  expect(await loadTemplateDraft('u1', null)).toEqual({ ...fresh, name: 'Pull day' });
  expect(await listTemplateDrafts('u1')).toEqual(['t1', null]);
  await clearTemplateDraft('u1', null);
  expect(await listTemplateDrafts('u1')).toEqual(['t1']);
  expect(await loadTemplateDraft('u1', 't1')).toEqual(edit);
});

test('a draft whose value is gone or corrupt is not offered', async () => {
  await saveTemplateDraft('u1', edit);
  await saveTemplateDraft('u1', fresh);
  mockMem.set('template-draft-u1-t1', '{broken');
  expect(await loadTemplateDraft('u1', 't1')).toBeNull();
  expect(await listTemplateDrafts('u1')).toEqual([null]);
});

test('template drafts and workout drafts never touch each other', async () => {
  await saveDraft('u1', { editingId: null, form });
  await saveTemplateDraft('u1', fresh);
  await clearTemplateDraft('u1', null);
  expect(await loadDraft('u1', null)).toEqual({ editingId: null, form });
  await saveTemplateDraft('u1', fresh);
  await clearAllDrafts('u1');
  expect(await listDrafts('u1')).toEqual([]);
  expect(await loadTemplateDraft('u1', null)).toEqual(fresh);
});

test('clearing all drafts removes every one for the account only', async () => {
  await saveTemplateDraft('u1', edit);
  await saveTemplateDraft('u1', fresh);
  await saveTemplateDraft('u2', fresh);
  await clearAllTemplateDrafts('u1');
  expect(await listTemplateDrafts('u1')).toEqual([]);
  expect(await loadTemplateDraft('u1', 't1')).toBeNull();
  expect(await loadTemplateDraft('u2', null)).toEqual(fresh);
});

test('storage failures never throw', async () => {
  (secureStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('full'));
  (secureStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('locked'));
  await expect(saveTemplateDraft('u1', fresh)).resolves.toBeUndefined();
  await expect(loadTemplateDraft('u1', null)).resolves.toBeNull();
});
