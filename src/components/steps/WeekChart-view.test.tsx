import { act } from 'react';
import { createRoot } from 'test-renderer';

import { WeekChart } from './WeekChart';

const dates = ['2026-10-20', '2026-10-21'];
test('collapses an entirely missing window but retains a chart for a recorded zero', async () => {
  const r = createRoot();
  await act(async () => r.render(<WeekChart dates={dates} rows={[]} />));
  expect(JSON.stringify(r.container)).toContain('No step data in the last 7 days');
  expect(JSON.stringify(r.container)).not.toContain('dashed');
  await act(async () => r.render(<WeekChart dates={dates} rows={[{ date: dates[0], value: 0, source: 'manual' }]} />));
  expect(JSON.stringify(r.container)).toContain('dashed');
  expect(JSON.stringify(r.container)).toContain('Average 0');
});
