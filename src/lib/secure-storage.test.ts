import * as SecureStore from 'expo-secure-store';

import { secureStorage } from './secure-storage';

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    AFTER_FIRST_UNLOCK: 'AFTER_FIRST_UNLOCK',
    __store: store,
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => {
      if (v.length > 2048) throw new Error('value too large');
      store.set(k, v);
    }),
    deleteItemAsync: jest.fn(async (k: string) => {
      store.delete(k);
    }),
  };
});

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;

beforeEach(() => store.clear());

test('round-trips a small value', async () => {
  await secureStorage.setItem('k', 'hello');
  expect(await secureStorage.getItem('k')).toBe('hello');
});

test('returns null for a missing key', async () => {
  expect(await secureStorage.getItem('nope')).toBeNull();
});

test('round-trips a value over the 2KB limit', async () => {
  const big = JSON.stringify({ token: 'x'.repeat(5000), name: 'é'.repeat(500) });
  await secureStorage.setItem('k', big);
  expect(store.size).toBeGreaterThan(2);
  expect(await secureStorage.getItem('k')).toBe(big);
});

test('shrinking a value drops stale parts', async () => {
  await secureStorage.setItem('k', 'x'.repeat(5000));
  await secureStorage.setItem('k', 'small');
  expect([...store.keys()].sort()).toEqual(['k', 'k.0']);
  expect(await secureStorage.getItem('k')).toBe('small');
});

test('removeItem deletes every part', async () => {
  await secureStorage.setItem('k', 'x'.repeat(5000));
  await secureStorage.removeItem('k');
  expect(store.size).toBe(0);
  expect(await secureStorage.getItem('k')).toBeNull();
});

test('a missing part reads as null', async () => {
  await secureStorage.setItem('k', 'x'.repeat(5000));
  store.delete('k.1');
  expect(await secureStorage.getItem('k')).toBeNull();
});

test('writes and reads with keychainAccessible AFTER_FIRST_UNLOCK', async () => {
  await secureStorage.setItem('k', 'hello');
  await secureStorage.getItem('k');
  const opts = { keychainAccessible: 'AFTER_FIRST_UNLOCK' };
  for (const call of (SecureStore.setItemAsync as jest.Mock).mock.calls) expect(call[2]).toEqual(opts);
  for (const call of (SecureStore.getItemAsync as jest.Mock).mock.calls) expect(call[1]).toEqual(opts);
});

test('web uses localStorage because expo-secure-store has no web implementation', async () => {
  jest.resetModules();
  jest.doMock('react-native', () => ({ Platform: { OS: 'web' } }));
  const local = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => local.get(k) ?? null,
    setItem: (k: string, v: string) => local.set(k, v),
    removeItem: (k: string) => local.delete(k),
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const web = (require('./secure-storage') as typeof import('./secure-storage')).secureStorage;
  await web.setItem('k', 'x'.repeat(5000));
  expect(local.get('k')).toHaveLength(5000);
  expect(await web.getItem('k')).toHaveLength(5000);
  await web.removeItem('k');
  expect(await web.getItem('k')).toBeNull();
});
