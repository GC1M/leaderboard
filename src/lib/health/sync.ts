import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { getMyRecentSteps, upsertDailyMetrics } from '@/lib/metrics';

import { isHealthAvailable, needsStepsPermission, readDailySteps } from './healthkit';
import { planSync } from './rules';

export const SYNC_DAYS = 7;

export type SyncResult =
  | { status: 'unavailable' }
  | { status: 'needs-permission' }
  | { status: 'synced'; written: number; at: Date };

export async function syncSteps(): Promise<SyncResult> {
  if (!isHealthAvailable()) return { status: 'unavailable' };
  if (await needsStepsPermission()) return { status: 'needs-permission' };
  const [health, existing] = await Promise.all([readDailySteps(SYNC_DAYS), getMyRecentSteps(SYNC_DAYS)]);
  const rows = planSync(health, existing);
  await upsertDailyMetrics(rows);
  return { status: 'synced', written: rows.length, at: new Date() };
}

// Syncs when the app returns to the foreground and on demand via `sync()` (pull-to-refresh).
export function useStepSync(onSynced?: () => void) {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const cb = useRef(onSynced);
  useEffect(() => {
    cb.current = onSynced;
  }, [onSynced]);

  const sync = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setSyncing(true);
    try {
      const r = await syncSteps();
      setResult(r);
      setError(null);
      if (r.status === 'synced') cb.current?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't sync your steps.");
    } finally {
      busy.current = false;
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    // Fetch on mount, then again on every foreground.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void sync();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void sync();
    });
    return () => sub.remove();
  }, [sync]);

  return { sync, syncing, result, error };
}
