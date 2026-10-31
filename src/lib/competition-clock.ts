import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
// Display deadlines follow the clock while the server remains authoritative for every action.
export function useCompetitionClock() {
  const [now, setNow] = useState(() => new Date());
  useFocusEffect(useCallback(() => { setNow(new Date()); }, []));
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(timer); }, []);
  return now;
}
