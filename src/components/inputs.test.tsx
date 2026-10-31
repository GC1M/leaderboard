import { act } from 'react';
import { createRoot } from 'test-renderer';
import { DurationField } from './inputs';
jest.mock('expo-router', () => ({ useRouter: () => ({}), useSegments: () => [] }));
test('duration follows external values when removing/reordering sets and preserves fractional seconds', async () => {
  const root = createRoot(); const onChange = jest.fn();
  await act(async () => root.render(<DurationField label="Time" value="1.5" onChange={onChange} />));
  const c = root.container as any;
  const field = (name: string) => c.queryAll((n: any) => n.props.onChangeText && n.props.accessibilityLabel === `Time ${name}`)[0];
  expect(field('minutes').props.value).toBe('1'); expect(field('seconds').props.value).toBe('30');
  await act(async () => root.render(<DurationField label="Time" value="2.25" onChange={onChange} />));
  expect(field('minutes').props.value).toBe('2'); expect(field('seconds').props.value).toBe('15');
  await act(async () => field('seconds').props.onChangeText('15,5'));
  expect(onChange).toHaveBeenLastCalledWith(String(135.5 / 60));
  await act(async () => field('minutes').props.onChangeText('1.5'));
  expect(onChange).toHaveBeenLastCalledWith('invalid');
  await act(async () => root.unmount());
});
