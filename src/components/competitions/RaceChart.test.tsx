import { act } from 'react';
import { createRoot } from 'test-renderer';
import { RaceChart } from './RaceChart';
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('expo-router', () => ({ useRouter: () => ({}), useSegments: () => [] }));
const render = async (props: Parameters<typeof RaceChart>[0]) => {
  const root = createRoot(); await act(async () => root.render(<RaceChart {...props} />));
  const text = JSON.stringify(root.container); await act(async () => root.unmount()); return text;
};
const maya = { user_id: 'a', display_name: 'Maya', rank: 1, score: 6000, totals: [2000, 4000, 6000] };
const me = { user_id: 'me', display_name: 'Sam', rank: 2, score: 4500, totals: [1000, 3000, 4500] };
test('one panel per ranked member in standing order, you in teal, with a spoken summary of the gap', async () => {
  const text = await render({ lines: [maya, me], uid: 'me', unit: 'Steps', dayCount: 7 });
  expect(text).toContain('Steps added up day by day, 3 of 7 days. Maya leads with 6,000. You are 2nd with 4,500, 1,500 behind.');
  expect(text.indexOf('"Maya"')).toBeLessThan(text.indexOf('"You"'));
  expect(text).toContain('"6,000"'); expect(text).toContain('"4,500"');
});
test('a race needs two ranked members and at least one elapsed day', async () => {
  expect(await render({ lines: [maya], uid: 'me', unit: 'Steps', dayCount: 7 })).not.toContain('Race so far');
  expect(await render({ lines: [{ ...maya, totals: [] }, { ...me, totals: [] }], uid: 'me', unit: 'Steps', dayCount: 7 })).not.toContain('Race so far');
  expect(await render({ lines: [maya, me], uid: 'a', unit: 'Steps', dayCount: 3 })).toContain('You lead with 6,000.');
});
