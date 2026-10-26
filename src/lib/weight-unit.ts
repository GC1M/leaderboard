import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { defaultWeightUnit, type WeightUnit } from '@/lib/health/format';
import { secureStorage } from '@/lib/secure-storage';

const KEY = 'weight-unit';
const systemDefault = () => defaultWeightUnit(Intl.DateTimeFormat().resolvedOptions().locale);

export async function loadWeightUnit(fallback: WeightUnit = systemDefault()): Promise<WeightUnit> {
  try {
    const v = await secureStorage.getItem(KEY);
    return v === 'kg' || v === 'lb' ? v : fallback;
  } catch {
    return fallback;
  }
}

export async function saveWeightUnit(unit: WeightUnit): Promise<void> {
  try {
    await secureStorage.setItem(KEY, unit);
  } catch {
    // The choice still applies until the screen closes; it just won't be remembered.
  }
}

// Per-viewer unit. Re-read on focus so a change made on the weight screen shows on Summary.
export function useWeightUnit(): [WeightUnit, (u: WeightUnit) => void] {
  const [unit, setUnit] = useState<WeightUnit>(systemDefault);
  useFocusEffect(useCallback(() => { void loadWeightUnit().then(setUnit); }, []));
  return [unit, (u) => { setUnit(u); void saveWeightUnit(u); }];
}
