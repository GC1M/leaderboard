import { act } from 'react';
import { createRoot } from 'test-renderer';
import { BarHistory } from './BarHistory';
import { localDateKey } from '@/lib/health/dates';
jest.mock('expo-router', () => ({ useRouter: () => ({}), useSegments: () => [] }));
let root: ReturnType<typeof createRoot>;
afterEach(() => act(() => root?.unmount()));
async function render(rows: { date: string; value: number }[], any: boolean) {
  root = createRoot(); await act(async () => root.render(<BarHistory fetch={() => Promise.resolve(rows)} hasAny={() => Promise.resolve(any)} fmt={(v) => `${v} steps`} noun="steps" />)); return root.container as any;
}
test('a completely empty account has one empty state and no chart or range selector', async () => {
  const c = await render([], false); expect(JSON.stringify(c)).toContain('No steps recorded yet.');
  expect(c.queryAll((n: any) => n.props.accessibilityRole === 'radiogroup')).toHaveLength(0);
  expect(c.queryAll((n: any) => n.props.accessibilityRole === 'image')).toHaveLength(0);
});
test('history outside the selected range retains the range selector', async () => {
  const c = await render([], true); expect(c.queryAll((n: any) => n.props.accessibilityRole === 'radiogroup').length).toBeGreaterThan(0);
  expect(JSON.stringify(c)).toContain('No steps recorded in the last 7 days.');
});
test('a recorded zero draws a chart rather than the empty state', async () => {
  const c = await render([{ date: localDateKey(new Date()), value: 0 }], true);
  expect(c.queryAll((n: any) => n.props.accessibilityRole === 'image').length).toBeGreaterThan(0); expect(JSON.stringify(c)).not.toContain('No steps recorded');
});
