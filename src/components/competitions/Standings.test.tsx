import { act } from 'react';
import { createRoot } from 'test-renderer';
import { CompetitionStandings, GapHighlight } from './Standings';
const row: { user_id: string; display_name: string; score: number | null; rank: number | null; eligibility: string; manual_entries: number; health_entries: number; excluded_entries: number; updated_at: string | null } = { user_id: 'a', display_name: 'Alice', score: 0, rank: 1, eligibility: 'eligible', manual_entries: 0, health_entries: 1, excluded_entries: 0, updated_at: null };
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('expo-router', () => ({ useRouter: () => ({}), useSegments: () => [] }));
test('standings distinguish zero, no data and revoked sharing and show ties', async () => {
  const root = createRoot();
  const rows = [row, { ...row, user_id: 'b', display_name: 'Bob' }, { ...row, user_id: 'c', display_name: 'Carol', score: null, rank: null, eligibility: 'no_data', health_entries: 0 }, { ...row, user_id: 'd', display_name: 'Dan', score: null, rank: null, eligibility: 'not_sharing', health_entries: 0 }];
  await act(async () => root.render(<><GapHighlight uid="a" metric="steps" rows={rows} /><CompetitionStandings uid="a" metric="steps" rows={rows} /></>));
  const text = JSON.stringify(root.container); expect(text).toContain('0 steps'); expect(text).toContain('No data'); expect(text).toContain('Not sharing'); expect(text.match(/"T1"/g)).toHaveLength(2); expect(text).toContain('Tied for 1st'); expect(text).toContain('1 Health entry, 0 manual entries');
  await act(async () => root.unmount());
});
test('gap highlight covers leader, last place, solo and unranked viewers', async () => {
  const root = createRoot();
  const text = async (uid: string, rows: typeof row[]) => { await act(async () => root.render(<GapHighlight uid={uid} metric="steps" rows={rows} />)); return JSON.stringify(root.container); };
  const a = { ...row, score: 10 }; const b = { ...row, user_id: 'b', display_name: 'Bob', score: 7, rank: 2 };
  const lead = await text('a', [a, b]); expect(lead).toContain('You lead by 3 steps'); expect(lead).toContain('Bob is 3 steps behind you'); expect(lead).toContain('Bob 7 steps');
  const last = await text('b', [a, b]); expect(last).toContain('3 steps behind Alice for 1st'); expect(last).not.toContain('behind you');
  const solo = await text('a', [a]); expect(solo).toContain('You are in 1st'); expect(solo).not.toContain('accessibilityElementsHidden');
  expect(await text('a', [{ ...a, score: null, rank: null }, b])).not.toContain('Your race');
  await act(async () => root.unmount());
});
test('standings lead with your place and flag stale rows', async () => {
  const root = createRoot(); const now = new Date('2026-11-08T12:00:00Z');
  const rows = [{ ...row, score: 10, updated_at: '2026-11-08T01:00:00Z' }, { ...row, user_id: 'b', display_name: 'Bob', score: 7, rank: 2, updated_at: '2026-11-08T11:00:00Z' }];
  await act(async () => root.render(<CompetitionStandings uid="b" metric="steps" rows={rows} now={now} />));
  const text = JSON.stringify(root.container); expect(text).toContain('You are 2nd of 2'); expect(text.match(/Data from/g)).toHaveLength(1);
  await act(async () => root.render(<CompetitionStandings uid="b" metric="steps" rows={[]} />)); expect(JSON.stringify(root.container)).toContain('No one has joined yet');
  await act(async () => root.unmount());
});
