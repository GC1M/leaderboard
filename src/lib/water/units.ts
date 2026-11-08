import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { secureStorage } from '@/lib/secure-storage';

// Water is stored in millilitres. Fluid ounces are US customary fl oz, for display and entry only.
export const ML_PER_FL_OZ = 29.5735295625;
export type WaterUnit = 'ml' | 'floz';

// Largest single manual entry (5 L). The server enforces the same bound (water_manual_bounds).
export const MAX_ENTRY_ML = 5000;

export const mlFromUnit = (value: number, unit: WaterUnit) => (unit === 'floz' ? value * ML_PER_FL_OZ : value);
export const unitFromMl = (ml: number, unit: WaterUnit) => (unit === 'floz' ? ml / ML_PER_FL_OZ : ml);

// Whole mL; fl oz to one decimal. A stored amount is rounded only for display.
export function formatWater(ml: number, unit: WaterUnit): string {
  if (unit === 'floz') return `${Math.round(unitFromMl(ml, 'floz') * 10) / 10} fl oz`;
  return ml >= 1000 ? `${Math.round(ml / 10) / 100} L` : `${Math.round(ml)} mL`;
}

// Entry amount in mL, rounded to 0.1 mL so a round trip through fl oz does not drift; null when not a valid single drink.
export function entryMl(value: number, unit: WaterUnit): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const ml = Math.round(mlFromUnit(value, unit) * 10) / 10;
  return ml > 0 && ml <= MAX_ENTRY_ML ? ml : null;
}

export const amountError = (unit: WaterUnit) =>
  `Enter an amount above 0 and up to ${unit === 'floz' ? `${Math.floor(unitFromMl(MAX_ENTRY_ML, 'floz'))} fl oz` : `${MAX_ENTRY_ML} mL`}.`;

// Quick-add sizes in the chosen unit: a glass, a bottle and a large bottle.
export const QUICK_ADD: Record<WaterUnit, number[]> = { ml: [250, 500, 750], floz: [8, 16, 24] };

export function defaultWaterUnit(locale: string | undefined): WaterUnit {
  const region = locale?.split(/[-_]/).find((p) => /^[A-Za-z]{2}$/.test(p) && p === p.toUpperCase());
  return region === 'US' ? 'floz' : 'ml';
}

const KEY = 'water-unit';
const systemDefault = () => defaultWaterUnit(Intl.DateTimeFormat().resolvedOptions().locale);
let known: WaterUnit | undefined;

export async function loadWaterUnit(): Promise<WaterUnit> {
  try {
    const v = await secureStorage.getItem(KEY);
    if (v === 'ml' || v === 'floz') return (known = v);
  } catch { /* fall back to the locale */ }
  return systemDefault();
}

// Per-viewer unit, re-read on focus like the weight unit.
export function useWaterUnit(): [WaterUnit, (u: WaterUnit) => void] {
  const [unit, setUnit] = useState<WaterUnit>(() => known ?? systemDefault());
  const taps = useRef(0);
  useFocusEffect(useCallback(() => {
    const at = taps.current;
    void loadWaterUnit().then((u) => { if (taps.current === at) setUnit(u); });
  }, []));
  return [unit, (u) => {
    taps.current++;
    known = u;
    setUnit(u);
    secureStorage.setItem(KEY, u).catch(() => {});
  }];
}
