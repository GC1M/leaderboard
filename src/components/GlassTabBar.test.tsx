import { act } from 'react';
import { createRoot } from 'test-renderer';

import { GlassTabBar } from './GlassTabBar';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const routes = [{ key: 's', name: '(summary)' }, { key: 'g', name: 'groups' }];
const descriptors = { s: { options: { title: 'Summary' } }, g: { options: { title: 'Groups' } } };

async function setup(prevent = false) {
  const emit = jest.fn(() => ({ defaultPrevented: prevent }));
  const navigateToTab = jest.fn();
  const r = createRoot();
  const props: any = { state: { index: 0, routes }, descriptors, emitter: { emit }, navigateToTab, insets: { top: 0, bottom: 0, left: 0, right: 0 } };
  await act(async () => r.render(<GlassTabBar {...props} />));
  const press = (label: string) => act(async () => (r.container as any).queryAll((n: any) => n.props.accessibilityLabel === label && n.props.onClick)[0].props.onClick());
  return { emit, navigateToTab, press };
}

test('tapping the tab you are on emits tabPress, so its stack pops to the first screen', async () => {
  const { emit, navigateToTab, press } = await setup();
  await press('Summary');
  expect(emit).toHaveBeenCalledWith({ type: 'tabPress', target: 's', canPreventDefault: true });
  expect(navigateToTab).not.toHaveBeenCalled();
});

test('tapping another tab emits tabPress and switches to it unless prevented', async () => {
  const a = await setup();
  await a.press('Groups');
  expect(a.emit).toHaveBeenCalledWith({ type: 'tabPress', target: 'g', canPreventDefault: true });
  expect(a.navigateToTab).toHaveBeenCalledWith('g');
  const b = await setup(true);
  await b.press('Groups');
  expect(b.navigateToTab).not.toHaveBeenCalled();
});
