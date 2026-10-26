import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { defaultWeightUnit, type WeightUnit } from '@/lib/health/format';
import { secureStorage } from '@/lib/secure-storage';

const KEY = 'weight-unit';
const systemDefault = () => defaultWeightUnit(Intl.DateTimeFormat().resolvedOptions().locale);

// Last known choice in this app session, so screens after the first don't flash the default.
let known: WeightUnit | undefined;

export async function loadWeightUnit(fallback: WeightUnit = systemDefault()): Promise<WeightUnit> {
  try {
    const v = await secureStorage.getItem(KEY);
    if (v === 'kg' || v === 'lb') known = v;
    return v === 'kg' || v === 'lb' ? v : fallback;
  } catch {
    return fallback;
  }
}

export async function saveWeightUnit(unit: WeightUnit): Promise<void> {
  known = unit;
  try {
    await secureStorage.setItem(KEY, unit);
  } catch {
    // The choice still applies until the screen closes; it just won't be remembered.
  }
}

// Per-viewer unit. Re-read on focus so a change made on the weight screen shows on Summary.
export function useWeightUnit(): [WeightUnit, (u: WeightUnit) => void] {
  const [unit, setUnit] = useState<WeightUnit>(() => known ?? systemDefault());
  // A tap while the stored value is loading wins over that older value.
  const taps = useRef(0);
  useFocusEffect(useCallback(() => {
    const at = taps.current;
    void loadWeightUnit().then((u) => { if (taps.current === at) setUnit(u); });
  }, []));
  return [unit, (u) => { taps.current++; setUnit(u); void saveWeightUnit(u); }];
}
