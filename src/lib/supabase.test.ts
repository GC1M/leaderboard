const mockCreateClient = jest.fn(() => ({}));
jest.mock('@supabase/supabase-js', () => ({ createClient: mockCreateClient }));
jest.mock('./secure-storage', () => ({ secureStorage: { marker: 'secure' } }));

function storageFor(os: string) {
  jest.resetModules();
  mockCreateClient.mockClear();
  jest.doMock('react-native', () => ({ Platform: { OS: os }, AppState: { addEventListener: jest.fn() } }));
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://x';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'k';
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./supabase');
  const opts = (mockCreateClient.mock.calls[0] as unknown[])[2] as { auth: { storage?: unknown } };
  return opts.auth.storage;
}

test('native uses the SecureStore adapter', () => {
  expect(storageFor('ios')).toEqual({ marker: 'secure' });
});

test('web leaves storage undefined so supabase-js uses localStorage', () => {
  expect(storageFor('web')).toBeUndefined();
});
