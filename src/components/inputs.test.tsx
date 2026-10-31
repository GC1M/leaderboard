import { act } from 'react';
import { createRoot } from 'test-renderer';
import { DurationField } from './inputs';
jest.mock('expo-router', () => ({ useRouter: () => ({}), useSegments: () => [] }));
test('duration uses hours/minutes, follows reordered values and preserves existing fractional minutes', async () => {
  const root = createRoot(); const onChange = jest.fn();
  await act(async () => root.render(<DurationField label="Time" value="1.5" onChange={onChange} />));
  const c = root.container as any;
  const field = (name: string) => c.queryAll((n: any) => n.props.onChangeText && n.props.accessibilityLabel === `Time ${name}`)[0];
  expect(field('minutes').props.value).toBe('1.5');
  expect(c.queryAll((n: any) => n.props.accessibilityLabel === 'Time seconds')).toHaveLength(0);
  await act(async () => root.render(<DurationField label="Time" value="62.25" onChange={onChange} />));
  expect(field('hours').props.value).toBe('1'); expect(field('minutes').props.value).toBe('2.25');
  await act(async () => field('minutes').props.onChangeText('2,5'));
  expect(onChange).toHaveBeenLastCalledWith('62.5');
  await act(async () => field('hours').props.onChangeText('1.5'));
  expect(onChange).toHaveBeenLastCalledWith('invalid');
  await act(async () => root.unmount());
});
