import * as SplashScreen from 'expo-splash-screen';
import { act } from 'react';
import { createRoot } from 'test-renderer';

import RootLayout from './_layout';

const mockAuth = jest.fn();
jest.mock('@/lib/auth', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => mockAuth(),
}));
jest.mock('@/lib/supabase', () => ({ watchAppStateForAuthRefresh: () => () => {} }));
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn().mockResolvedValue(true),
  hideAsync: jest.fn().mockResolvedValue(true),
}));
jest.mock('expo-router', () => {
  const Stack = Object.assign(function Stack() {
    return null;
  }, {
    Protected: function Protected() {
      return null;
    },
    Screen: function Screen() {
      return null;
    },
  });
  return { Stack };
});

const render = async () => {
  const r = createRoot();
  await act(async () => {
    r.render(<RootLayout />);
  });
};

test('splash stays up while the session loads, then hides', async () => {
  expect(SplashScreen.preventAutoHideAsync).toHaveBeenCalled();
  mockAuth.mockReturnValue({ session: null, loading: true });
  await render();
  expect(SplashScreen.hideAsync).not.toHaveBeenCalled();

  mockAuth.mockReturnValue({ session: null, loading: false });
  await render();
  expect(SplashScreen.hideAsync).toHaveBeenCalled();
});
