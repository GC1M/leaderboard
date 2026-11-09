import { act } from 'react';
import { createRoot } from 'test-renderer';
import { DailyStepsCard } from './DailySteps';
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('expo-router', () => ({ useRouter: () => ({}), useSegments: () => [] }));
const day = (d: string, value: number | null, excluded = 0, future = false) => ({ day: d, value, excluded, future });
const render = async (props: Parameters<typeof DailyStepsCard>[0]) => {
  const root = createRoot(); await act(async () => root.render(<DailyStepsCard {...props} />));
  const text = JSON.stringify(root.container); await act(async () => root.unmount()); return text;
};
test('live card names today, keys missing and excluded days, and summarizes for VoiceOver', async () => {
  const days = [day('2026-11-01', 4000), day('2026-11-02', null), day('2026-11-03', null, 900), day('2026-11-04', 0), day('2026-11-05', null, 0, true)];
  const text = await render({ days, today: '2026-11-04', live: true, pace: { name: 'Maya', perDay: 3000 } });
  expect(text).toContain('Today 0');
  expect(text).toContain('Dashed: no data. Outline: excluded by the rules');
  expect(text).toMatch(/Your steps, 4 of 5 days\. Total 4,000\..*1 day with no data\. 1 day only had entries this competition excludes\. Maya's pace 3,000 a day\. Your average 2,000 a day\./);
  expect(text).toContain('"accessibilityRole":"image"');
});
test('ended card never says today and counts the last day as missing', async () => {
  const text = await render({ days: [day('2026-11-01', 5000), day('2026-11-02', null)], today: '2026-11-02', live: false, pace: null });
  expect(text).not.toMatch(/[Tt]oday/);
  expect(text).toContain('1 day with no data');
});
test('single-day competition shows the total without the pace legend', async () => {
  const text = await render({ days: [day('2026-11-01', 1200)], today: '2026-11-01', live: true, pace: { name: 'Maya', perDay: 3000 } });
  expect(text).toContain('1,200'); expect(text).not.toContain('Line:');
});
