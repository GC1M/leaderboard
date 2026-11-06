import { act } from 'react';
import { createRoot } from 'test-renderer';

import type { MemberSummary } from '@/lib/group-summaries';

import { MemberSummaries } from './MemberSummaries';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

test('shows each member\'s workout summary, or why there is none', async () => {
  const none = { state: 'no_data' } as const;
  const items: MemberSummary[] = [
    { userId: 'a', name: 'Ann', sleep: none, weight: none, workouts: { state: 'recorded', count: 3, durationS: 7800, weekStart: '2000-01-03' }, food: { state: 'recorded', date: '2000-01-03', energy: { value: 0, incomplete: false }, protein: { value: null, incomplete: true }, carbs: { value: 5, incomplete: true }, fat: { value: 1, incomplete: false } } },
    { userId: 'b', name: 'Bo', sleep: none, weight: none, workouts: { state: 'not_shared' }, food: { state: 'not_shared' } },
    { userId: 'c', name: 'Cy', sleep: none, weight: none, workouts: { state: 'no_data' }, food: { state: 'no_data' } },
  ];
  const r = createRoot();
  await act(async () => {
    r.render(<MemberSummaries items={items} me="a" unit="kg" />);
  });
  const out = JSON.stringify(r.container);
  expect(out).toContain('Sleep, weight, workouts and food');
  expect(out).toContain('Workouts: 3 workouts, 2h 10m, week of jan 3');
  expect(out).toContain('Workouts: Not shared');
  expect(out).toContain('Workouts: No recent workouts');
  expect(out).toContain('Food: 0 kcal, carbs at least 5 g, fat 1 g, jan 3');
  expect(out).toContain('Food: Not shared');
  expect(out).toContain('Food: No food logged');
  expect(out).not.toContain('Food: 0 kcal, protein');
});
