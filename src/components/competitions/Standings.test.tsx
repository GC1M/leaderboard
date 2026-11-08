import { act } from 'react';
import { createRoot } from 'test-renderer';
import { CompetitionStandings } from './Standings';
const row = { user_id: 'a', display_name: 'Alice', score: 0, rank: 1, eligibility: 'eligible', manual_entries: 0, health_entries: 1, excluded_entries: 0, updated_at: null };
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('expo-router', () => ({ useRouter: () => ({}), useSegments: () => [] }));
test('standings distinguish zero, no data and revoked sharing and show ties', async () => {
  const root = createRoot();
  await act(async () => root.render(<CompetitionStandings uid="a" metric="steps" rows={[row, { ...row, user_id: 'b', display_name: 'Bob' }, { ...row, user_id: 'c', display_name: 'Carol', score: null, rank: null, eligibility: 'no_data', health_entries: 0 }, { ...row, user_id: 'd', display_name: 'Dan', score: null, rank: null, eligibility: 'not_sharing', health_entries: 0 }]} />));
  const text = JSON.stringify(root.container); expect(text).toContain('0 steps'); expect(text).toContain('No data'); expect(text).toContain('Not sharing'); expect(text.match(/"T1"/g)).toHaveLength(2); expect(text).toContain('Tied for 1st'); expect(text).toContain('1 Health entry · 0 manual entries');
  await act(async () => root.unmount());
});
