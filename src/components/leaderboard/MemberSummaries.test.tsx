import { act } from 'react';
import { createRoot } from 'test-renderer';

import type { MemberSummary } from '@/lib/group-summaries';

import { MemberSummaries } from './MemberSummaries';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

test('shows each member\'s workout summary, or why there is none', async () => {
  const none = { state: 'no_data' } as const;
  const items: MemberSummary[] = [
    { userId: 'a', name: 'Ann', sleep: none, weight: none, workouts: { state: 'recorded', count: 3, durationS: 7800, weekStart: '2000-01-03' } },
    { userId: 'b', name: 'Bo', sleep: none, weight: none, workouts: { state: 'not_shared' } },
    { userId: 'c', name: 'Cy', sleep: none, weight: none, workouts: { state: 'no_data' } },
  ];
  const r = createRoot();
  await act(async () => {
    r.render(<MemberSummaries items={items} me="a" unit="kg" />);
  });
  const out = JSON.stringify(r.container);
  expect(out).toContain('Sleep, weight and workouts');
  expect(out).toContain('Workouts: 3 workouts, 2h 10m, week of jan 3');
  expect(out).toContain('Workouts: Not shared');
  expect(out).toContain('Workouts: No recent workouts');
});
