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
    <LeaderboardRowView row={{ userId: 'a', name: 'Alice', value: 12345, rank: 1 }} rankLabel="1" metric="steps" isYou leader={12345} />,
  );
  expect(out).toContain('"You"');
  expect(out).toContain('12,345');
  expect(out).toContain('"width":"100%"');
  expect(out).toContain('#E3E9FF');
});

test('other users are not highlighted; no-data rows say so', async () => {
  const out = await render(
    <LeaderboardRowView row={{ userId: 'b', name: 'Bob', value: 0, rank: 3 }} rankLabel="-" metric="steps" isYou={false} leader={12345} />,
  );
  expect(out).not.toContain('"You"');
  expect(out).not.toContain('#E3E9FF');
  expect(out).toContain('No data');
  expect(out).toContain('"width":"0%"');
});

test('medal color for the podium and the source caption', async () => {
  const out = await render(
    <LeaderboardRowView
      row={{ userId: 'c', name: 'Cy', value: 900, rank: 1 }}
      rankLabel="1"
      metric="steps"
      isYou={false}
      leader={900}
      source={{ text: 'Manual', manual: true }}
    />,
  );
  expect(out).toContain('#9A6B00'); // gold
  expect(out).toContain('#8A5A00'); // manual color
  expect(out).toContain('Rank 1, Cy, 900, Manual');
});
