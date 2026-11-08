import { Platform } from 'react-native';

import { localDateKey, startOfLocalDay } from '../health/dates';
import { resetHealthConnectCache } from '../health/health-connect';
import { createAndroidHealthAdapter } from './android';

jest.mock('@/lib/metrics', () => ({ getMyRecentSteps: jest.fn(), upsertDailyMetrics: jest.fn() }));

// QA (#64). Minimal Health Connect for the adapter's step aggregation; one aggregate call fails transiently.
const grants = new Set<string>();
let failCall = -1, calls = 0;
const mockHc = {
  getSdkStatus: jest.fn(async () => 3),
  initialize: jest.fn(async () => true),
  getGrantedPermissions: jest.fn(async () => [...grants].map((k) => ({ accessType: k.split(':')[0], recordType: k.split(':')[1] }))),
  requestPermission: jest.fn(async (p: unknown[]) => p),
  readRecords: jest.fn(async () => ({ records: [] })),
  aggregateRecord: jest.fn(async () => {
    if (calls++ === failCall) throw Object.assign(new Error('android.os.RemoteException: binder transaction failed'), { code: 'UNDERLYING_ERROR' });
    return { COUNT_TOTAL: 100, dataOrigins: ['com.watch'] };
  }),
};
jest.mock('react-native-health-connect', () => mockHc);

beforeEach(() => {
  jest.replaceProperty(Platform, 'OS', 'android');
  resetHealthConnectCache();
  grants.clear(); failCall = -1; calls = 0;
  jest.clearAllMocks();
});

it('readSteps: a transient error on day 30+ is an error, not a silent "no history access" truncation', async () => {
  grants.add('read:Steps');
  failCall = 40; // day index 40, well inside the 90 requested, history access granted
  const now = new Date(2026, 9, 28, 12);
  const result = await createAndroidHealthAdapter().readSteps({ days: 90, now }).catch((e: Error) => ({ status: 'threw', message: e.message }));
  expect(result).not.toMatchObject({ status: 'ok', truncatedFrom: localDateKey(startOfLocalDay(now, 39)) });
});
