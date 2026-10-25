import { act } from 'react';
import { createRoot } from 'test-renderer';

import { LeaderboardRowView } from './LeaderboardRowView';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

async function render(el: React.ReactElement) {
  const r = createRoot();
  await act(async () => {
    r.render(el);
  });
  return JSON.stringify(r.container);
}

test('highlights the current user', async () => {
  const out = await render(
    <LeaderboardRowView row={{ userId: 'a', name: 'Alice', value: 12345, rank: 1 }} rankLabel="1" metric="steps" isYou />,
  );
  expect(out).toContain('(you)');
  expect(out).toContain('12,345');
  expect(out).toContain('#e6f0ff');
});

test('other users are not highlighted; no-data rows say so', async () => {
  const out = await render(
    <LeaderboardRowView row={{ userId: 'b', name: 'Bob', value: 0, rank: 3 }} rankLabel="-" metric="steps" isYou={false} />,
  );
  expect(out).not.toContain('(you)');
  expect(out).not.toContain('#e6f0ff');
  expect(out).toContain('no data yet');
});
