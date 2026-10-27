const mockAlert = jest.fn();

function load(os: string) {
  jest.resetModules();
  jest.doMock('react-native', () => ({ Platform: { OS: os }, Alert: { alert: mockAlert } }));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./alert') as typeof import('./alert');
}

beforeEach(() => mockAlert.mockClear());

test('native uses the system alert', () => {
  const buttons = [{ text: 'OK' }];
  load('ios').alert('Title', 'Body', buttons);
  expect(mockAlert).toHaveBeenCalledWith('Title', 'Body', buttons);
});

test('web queues named actions and does not run one until selected', () => {
  const { alert, getWebDialog, closeWebDialog, subscribeWebDialog } = load('web');
  const go = jest.fn();
  const listener = jest.fn();
  const unsubscribe = subscribeWebDialog(listener);
  const remove = { text: 'Remove from Group', style: 'destructive' as const, onPress: go };
  alert('Bob', 'Choose an action', [remove, { text: 'Cancel', style: 'cancel' }]);
  expect(getWebDialog()?.buttons[0].text).toBe('Remove from Group');
  expect(go).not.toHaveBeenCalled();
  closeWebDialog(remove);
  expect(go).toHaveBeenCalledTimes(1);
  expect(getWebDialog()).toBeNull();
  expect(listener).toHaveBeenCalledTimes(2);
  unsubscribe();
  alert('Information');
  expect(listener).toHaveBeenCalledTimes(2);
  expect(getWebDialog()?.buttons).toEqual([{ text: 'OK' }]);
});

test('cancel and backdrop dismissal run no callback and preserve the next queued dialog', () => {
  const { alert, getWebDialog, closeWebDialog } = load('web');
  const go = jest.fn();
  const cancel = { text: 'Cancel', style: 'cancel' as const, onPress: go };
  alert('One', undefined, [{ text: 'Delete', onPress: go }, cancel]);
  alert('Two');
  closeWebDialog(cancel);
  expect(getWebDialog()?.title).toBe('Two');
  closeWebDialog();
  closeWebDialog();
  expect(go).not.toHaveBeenCalled();
  expect(getWebDialog()).toBeNull();
});

test('a selected action can open a nested confirmation', () => {
  const { alert, getWebDialog, closeWebDialog } = load('web');
  const remove = jest.fn();
  const action = { text: 'Remove', onPress: () => alert('Remove Bob?', undefined, [{ text: 'Confirm', onPress: remove }]) };
  alert('Bob', undefined, [action]);
  closeWebDialog(action);
  expect(getWebDialog()?.title).toBe('Remove Bob?');
  expect(remove).not.toHaveBeenCalled();
  closeWebDialog(getWebDialog()!.buttons[0]);
  expect(remove).toHaveBeenCalledTimes(1);
});
