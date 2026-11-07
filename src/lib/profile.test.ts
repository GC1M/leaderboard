import { deleteAccount, deleteFoodHistory, signOut as signOutDevice, updateDisplayName } from './profile';
import { supabase } from './supabase';

jest.mock('./supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(), auth: { getSession: jest.fn(), signOut: jest.fn(), storageKey: 'sb-auth' } },
}));
const mockDeleteJournal = jest.fn(async (_uid: string) => {});
const mockRemoveItem = jest.fn(async (_key: string) => {});
jest.mock('./health/journal', () => ({ deleteHealthJournal: (uid: string) => mockDeleteJournal(uid) }));
jest.mock('./secure-storage', () => ({ secureStorage: { removeItem: (key: string) => mockRemoveItem(key) } }));
const rpc = supabase.rpc as unknown as jest.Mock;
const from = supabase.from as unknown as jest.Mock;
const signOut = supabase.auth.signOut as unknown as jest.Mock;
(supabase.auth.getSession as unknown as jest.Mock).mockResolvedValue({ data: { session: { user: { id: 'me' } } } });

beforeEach(() => jest.clearAllMocks());

test('updateDisplayName trims and validates', async () => {
  await expect(updateDisplayName('  ')).rejects.toThrow(/1 to 40/);
  await expect(updateDisplayName('x'.repeat(41))).rejects.toThrow(/1 to 40/);
  const eq = jest.fn().mockResolvedValue({ error: null });
  const update = jest.fn(() => ({ eq }));
  from.mockReturnValue({ update });
  await expect(updateDisplayName('  Shivam ')).resolves.toBe('Shivam');
  expect(update).toHaveBeenCalledWith({ display_name: 'Shivam' });
  expect(eq).toHaveBeenCalledWith('id', 'me');
});

test('deleteAccount signs out locally only after the server delete succeeds', async () => {
  rpc.mockResolvedValue({ error: { message: 'boom' } });
  await expect(deleteAccount()).rejects.toThrow(/Couldn't delete your account/);
  expect(signOut).not.toHaveBeenCalled();
  expect(mockDeleteJournal).not.toHaveBeenCalled();
  rpc.mockResolvedValue({ error: null });
  mockDeleteJournal.mockRejectedValueOnce(new Error('locked'));
  await deleteAccount();
  expect(rpc).toHaveBeenCalledWith('delete_my_account');
  expect(mockDeleteJournal).toHaveBeenCalledWith('me');
  expect(mockRemoveItem).toHaveBeenCalledWith('health-connection-me');
  expect(mockRemoveItem).toHaveBeenCalledWith('template-drafts-me');
  expect(mockRemoveItem).toHaveBeenCalledWith('food-pending-me');
  expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(mockRemoveItem).toHaveBeenCalledWith('health-export-me-food');
  expect(mockRemoveItem).toHaveBeenCalledWith('water-pending-me');
  expect(mockRemoveItem).toHaveBeenCalledWith('health-export-me-water');
});

test('signOut clears the stored session when the server cannot be reached', async () => {
  signOut.mockResolvedValueOnce({ error: null });
  await signOutDevice();
  expect(signOut).toHaveBeenCalledTimes(1);
  expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(mockRemoveItem).not.toHaveBeenCalled();
  signOut.mockResolvedValueOnce({ error: new Error('Network request failed') }).mockResolvedValueOnce({ error: null });
  await signOutDevice();
  expect(mockRemoveItem).toHaveBeenCalledWith('sb-auth');
  expect(signOut).toHaveBeenCalledTimes(3);
});

test('deleteFoodHistory clears the unsent food queue only after the server delete succeeds', async () => {
  rpc.mockResolvedValue({ error: { message: 'boom' } });
  await expect(deleteFoodHistory()).rejects.toThrow(/Couldn't delete your food history/);
  expect(mockRemoveItem).not.toHaveBeenCalled();
  rpc.mockClear();
  rpc.mockResolvedValue({ error: null });
  await deleteFoodHistory();
  // Twice: the second one catches an entry a flush in flight saved after the first.
  expect(rpc.mock.calls.filter((c) => c[0] === 'delete_my_food_history')).toHaveLength(2);
  expect(mockRemoveItem).toHaveBeenCalledWith('food-pending-me');
  expect(signOut).not.toHaveBeenCalled();
});
