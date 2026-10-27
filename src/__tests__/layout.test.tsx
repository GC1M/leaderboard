import * as SplashScreen from 'expo-splash-screen';
import { act } from 'react';
import { createRoot } from 'test-renderer';

import RootLayout from '@/app/_layout';
import JoinByLink from '@/app/join/[code]';

const mockAuth = jest.fn();
const mockReplace = jest.fn();
let mockParams: { code?: string | string[] } = {};
let mockSegments: string[] = [];
jest.mock('@/lib/auth', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => mockAuth(),
}));
jest.mock('@/components/WebDialogHost', () => ({ WebDialogHost: () => null }));
jest.mock('@/lib/supabase', () => ({ watchAppStateForAuthRefresh: () => () => {} }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
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
  return { Stack, Redirect: () => null, useRouter: () => ({ replace: mockReplace }), useGlobalSearchParams: () => mockParams, useLocalSearchParams: () => mockParams, useSegments: () => mockSegments };
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


test('signed-out invite survives the auth guard and resumes its confirmation after sign-in', async () => {
  mockParams = { code: 'abcd-2345' };
  mockSegments = ['sign-in'];
  mockReplace.mockClear();
  mockAuth.mockReturnValue({ session: null, loading: false });
  const r = createRoot();
  await act(async () => r.render(<RootLayout />));
  expect(mockReplace).not.toHaveBeenCalled();
  mockSegments = ['(tabs)'];
  mockAuth.mockReturnValue({ session: { user: { id: 'user' } }, loading: false });
  await act(async () => r.render(<RootLayout />));
  expect(mockReplace).toHaveBeenCalledWith('/join/ABCD2345');
  mockReplace.mockClear();
  mockSegments = ['join', '[code]'];
  await act(async () => r.render(<RootLayout />));
  expect(mockReplace).not.toHaveBeenCalled();
  await act(async () => r.unmount());
});

test('native: the invite resumes once after sign-in even though the guard flip dropped the code param', async () => {
  mockParams = { code: 'abcd-2345' };
  mockSegments = ['join', '[code]'];
  mockReplace.mockClear();
  mockAuth.mockReturnValue({ session: null, loading: false });
  const r = createRoot();
  await act(async () => r.render(<JoinByLink />));
  await act(async () => r.render(<RootLayout />));
  mockParams = {};
  mockSegments = ['(tabs)'];
  mockAuth.mockReturnValue({ session: { user: { id: 'user' } }, loading: false });
  await act(async () => r.render(<RootLayout />));
  expect(mockReplace).toHaveBeenCalledWith('/join/ABCD2345');
  mockReplace.mockClear();
  mockSegments = ['groups'];
  await act(async () => r.render(<RootLayout />));
  expect(mockReplace).not.toHaveBeenCalled();
  await act(async () => r.unmount());
});

test('native warm start: a link opened on the mounted sign-in screen resumes after the guard flip settles', async () => {
  mockParams = {};
  mockSegments = ['sign-in'];
  mockReplace.mockClear();
  mockAuth.mockReturnValue({ session: null, loading: false });
  const r = createRoot();
  await act(async () => r.render(<RootLayout />));
  // The link pushes join/[code] over sign-in, which parks the invite and redirects back to sign-in.
  mockParams = { code: 'abcd-2345' };
  mockSegments = ['join', '[code]'];
  await act(async () => r.render(<JoinByLink />));
  await act(async () => r.render(<RootLayout />));
  mockSegments = ['sign-in'];
  await act(async () => r.render(<RootLayout />));
  // Signed in, but the guard has not swapped sign-in out yet: a replace now is overwritten by the flip.
  mockAuth.mockReturnValue({ session: { user: { id: 'user' } }, loading: false });
  await act(async () => r.render(<RootLayout />));
  expect(mockReplace).not.toHaveBeenCalled();
  // The flip lands on (tabs) and drops the sign-in route's code param.
  mockParams = {};
  mockSegments = ['(tabs)'];
  await act(async () => r.render(<RootLayout />));
  expect(mockReplace).toHaveBeenCalledWith('/join/ABCD2345');
  await act(async () => r.unmount());
});

test.each(['https://outside.example', '', ['ABCD2345', 'WXYZ6789']])('does not redirect to untrusted or ambiguous invite params: %s', async (code) => {
  mockParams = { code };
  mockSegments = ['(tabs)'];
  mockReplace.mockClear();
  mockAuth.mockReturnValue({ session: { user: { id: 'user' } }, loading: false });
  await render();
  expect(mockReplace).not.toHaveBeenCalled();
});
