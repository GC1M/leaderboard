import { act } from 'react';
import { StyleSheet } from 'react-native';
import { createRoot } from 'test-renderer';

import Sleep from '@/app/sleep';
import { Segmented } from '@/components/history/Segmented';
import { StepRow } from '@/components/steps/StepRow';
import { WeeklyHistoryView } from '@/components/workouts/WeeklyHistory';

let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: mockFontScale }),
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'me' } }, loading: false }) }));
jest.mock('@/lib/health/sync', () => ({ useHealthExport: () => ({ entries: [] }), useHealthSync: () => ({}) }));
jest.mock('@/lib/sleep', () => ({ getMyManualSleep: () => Promise.resolve([]), getMyRecentSleep: () => Promise.resolve([]) }));
jest.mock('@/components/history/BarHistory', () => ({ BarHistory: () => null }));
jest.mock('@/components/health/ExportOption', () => ({ ExportOption: () => null, useExportChoice: () => ({}) }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

let root: ReturnType<typeof createRoot>;
afterEach(() => {
  act(() => root.unmount());
  mockFontScale = 1;
});

async function render(el: React.ReactElement) {
  const r = (root = createRoot());
  await act(async () => r.render(el));
  return r.container as any;
}

const texts = (c: any, s: string) => c.queryAll((n: any) => n.type === 'Text' && JSON.stringify(n.props.children).includes(s));
const style = (n: any) => StyleSheet.flatten(n.props.style) ?? {};

describe('step row', () => {
  const row = () => render(<StepRow date="2026-10-27" today="2026-10-27" row={{ value: 12345, source: 'manual' } as any} />);
  const outer = (c: any) => c.queryAll((n: any) => n.props.accessibilityLabel?.startsWith('Today, '))[0];

  test('keeps the value beside the day at default size', async () => {
    expect(style(outer(await row())).flexDirection).toBe('row');
  });

  test('stacks the value under the day at accessibility sizes', async () => {
    mockFontScale = 3.1;
    expect(style(outer(await row())).flexDirection).toBe('column');
  });
});

describe('segmented control', () => {
  const seg = () => render(<Segmented label="Time range" options={[{ value: 30, label: '30D' }, { value: 90, label: '90D' }]} value={30} onChange={() => {}} />);
  const parts = (c: any) => ({
    group: c.queryAll((n: any) => n.props.accessibilityRole === 'radiogroup' && n.type === 'View')[0],
    option: c.queryAll((n: any) => n.props.accessibilityRole === 'radio' && n.type === 'View')[0],
  });

  test('splits into equal parts at default size', async () => {
    const { group, option } = parts(await seg());
    expect(style(group).flexWrap).toBeUndefined();
    expect(style(option).flex).toBe(1);
    expect(style(option).flexBasis).toBeUndefined();
  });

  test('sizes options to their labels and wraps at accessibility sizes', async () => {
    mockFontScale = 3.1;
    const { group, option } = parts(await seg());
    expect(style(group).flexWrap).toBe('wrap');
    expect(style(option).flexBasis).toBe('auto');
    expect(style(option).flexShrink).toBe(0);
  });
});

describe('workouts weekly total', () => {
  const week = { weekStart: '2026-10-26', count: 3, durationS: 7200, distanceM: null, distanceCount: 0, energyKcal: null, energyCount: 0, imported: 0, manual: 3 };
  test('caps the big total so it cannot break mid-word', async () => {
    const c = await render(<WeeklyHistoryView totals={[week]} unit="km" />);
    expect(texts(c, '3 workouts')[0].props.maxFontSizeMultiplier).toBe(1.5);
  });
});

describe('sleep entry', () => {
  const inputs = (c: any) => c.queryAll((n: any) => n.props.placeholder === 'YYYY-MM-DD HH:mm' && n.props.onChangeText && typeof n.type === 'string');

  test('date-time inputs stay single line at default size', async () => {
    const fields = inputs(await render(<Sleep />));
    expect(fields).toHaveLength(2);
    fields.forEach((f: any) => expect(f.props.multiline).toBeFalsy());
  });

  test('date-time inputs wrap at accessibility sizes and Return still submits', async () => {
    mockFontScale = 3.1;
    const fields = inputs(await render(<Sleep />));
    expect(fields).toHaveLength(2);
    fields.forEach((f: any) => {
      expect(f.props.multiline).toBe(true);
      expect(f.props.submitBehavior).toBe('blurAndSubmit');
    });
  });
});
