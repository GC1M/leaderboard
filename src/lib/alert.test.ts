const mockAlert = jest.fn();

function load(os: string) {
  jest.resetModules();
  jest.doMock('react-native', () => ({ Platform: { OS: os }, Alert: { alert: mockAlert } }));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('./alert') as typeof import('./alert')).alert;
}

beforeEach(() => {
  mockAlert.mockClear();
  (globalThis as { window?: unknown }).window = { confirm: jest.fn(), alert: jest.fn() };
});

const win = () => (globalThis as unknown as { window: { confirm: jest.Mock; alert: jest.Mock } }).window;

test('native uses the system alert', () => {
  const buttons = [{ text: 'OK' }];
  load('ios')('Title', 'Body', buttons);
  expect(mockAlert).toHaveBeenCalledWith('Title', 'Body', buttons);
});

test('web runs the action when confirmed and skips cancel', () => {
  const cancel = jest.fn(), go = jest.fn();
  win().confirm.mockReturnValue(true);
  load('web')('Sign out?', 'Body', [{ text: 'Cancel', style: 'cancel', onPress: cancel }, { text: 'Sign Out', onPress: go }]);
  expect(win().confirm).toHaveBeenCalledWith('Sign out?\n\nBody');
  expect(go).toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
});

test('web runs nothing when declined', () => {
  const go = jest.fn();
  win().confirm.mockReturnValue(false);
  load('web')('Sign out?', undefined, [{ text: 'Sign Out', onPress: go }]);
  expect(go).not.toHaveBeenCalled();
});

test('web offers several actions in turn and runs the first accepted', () => {
  const a = jest.fn(), b = jest.fn();
  win().confirm.mockReturnValueOnce(false).mockReturnValueOnce(true);
  load('web')('Bob', undefined, [{ text: 'Delete Steps', onPress: a }, { text: 'Remove', onPress: b }, { text: 'Cancel', style: 'cancel' }]);
  expect(win().confirm).toHaveBeenLastCalledWith('Bob\n\nRemove?');
  expect(a).not.toHaveBeenCalled();
  expect(b).toHaveBeenCalled();
});
