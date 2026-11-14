import { act } from 'react';
import { createRoot } from 'test-renderer';
import { DayGrid } from './DayGrid';
import { Highlights } from './Highlights';
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('expo-router', () => ({ useRouter: () => ({}), useSegments: () => [] }));
const render = async (node: React.ReactElement) => {
  const root = createRoot(); await act(async () => root.render(node));
  const text = JSON.stringify(root.container); await act(async () => root.unmount()); return text;
};
const days = ['a', 'b', 'c', 'd'];
const rows = [
  { user_id: 'maya', display_name: 'Maya', rank: 1, cells: [12480, 900, null, null] },
  { user_id: 'me', display_name: 'Sam', rank: 2, cells: [9800, 1200, 0, null] },
];

test('the grid shows short amounts, crowns day winners, says you, and speaks a summary', async () => {
  const text = await render(<DayGrid rows={rows} days={days} elapsed={3} uid="me" metric="steps" unit="Steps" />);
  expect(text).toContain('"12K"'); expect(text).toContain('"1.2K"');
  expect(text).toContain('👑');
  expect(text).toContain('"Today"');
  expect(text).toContain('Steps each day, 3 of 4 days. Maya: won 1 day, 1 without data. You: won 1 day, 0 without data.');
});

test('on/off metrics show checks and days on target', async () => {
  const water = [{ ...rows[0], cells: [1, 0, 1, null] }, { ...rows[1], cells: [1, 1, null, null] }];
  const text = await render(<DayGrid rows={water} days={days} elapsed={3} uid="me" metric="water_days_on_target" unit="Water days" />);
  expect(text).toContain('✓'); expect(text).not.toContain('👑');
  expect(text).toContain('Maya: 2 of 3 days. You: 2 of 3 days.');
});

test('one racer or no elapsed day draws nothing', async () => {
  expect(await render(<DayGrid rows={rows.slice(0, 1)} days={days} elapsed={2} uid="me" metric="steps" unit="Steps" />)).not.toContain('Day by day');
  expect(await render(<DayGrid rows={rows} days={days} elapsed={0} uid="me" metric="steps" unit="Steps" />)).not.toContain('Day by day');
});

test('highlights name you as You and pair a battle with vs', async () => {
  const text = await render(<Highlights uid="me" names={{ me: 'Sam', maya: 'Maya' }} items={[{ key: 'battle', title: 'Closest battle', who: ['maya', 'me'], detail: '200 steps apart' }, { key: 'biggest', title: 'Biggest day', who: ['me'], detail: '1,400 steps on Nov 12' }]} />);
  expect(text).toContain('Closest battle: Maya vs You. 200 steps apart.');
  expect(text).toContain('⚔️'); expect(text).toContain('🚀');
  expect(await render(<Highlights uid="me" names={{}} items={[]} />)).not.toContain('Highlights');
});
