import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { secureStorage } from './secure-storage';
import { defaultDistanceUnit, type DistanceUnit } from './workout-form';
const fallback = () => defaultDistanceUnit(Intl.DateTimeFormat().resolvedOptions().locale);
let known: DistanceUnit | undefined;
export async function loadDistanceUnit(): Promise<DistanceUnit> {
  try {
    const u = await secureStorage.getItem('distance-unit');
    if (u === 'km' || u === 'mi') { known = u; return u; }
  } catch { /* Use the device's region. */ }
  return fallback();
}
export async function saveDistanceUnit(u: DistanceUnit) {
  known = u;
  try { await secureStorage.setItem('distance-unit', u); } catch { /* Keep the session choice. */ }
}
export function useDistanceUnit(): [DistanceUnit, (u: DistanceUnit) => void] {
  const [unit, setUnit] = useState(() => known ?? fallback());
  const taps = useRef(0);
  useFocusEffect(useCallback(() => {
    let live = true;
    const at = taps.current;
    void loadDistanceUnit().then((u) => { if (live && at === taps.current) setUnit(u); });
    return () => { live = false; };
  }, []));
  return [unit, (u) => { taps.current++; setUnit(u); void saveDistanceUnit(u); }];
}
