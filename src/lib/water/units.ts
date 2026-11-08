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

// Largest daily target (20 L), the same bound setWaterTarget enforces.
export const MAX_TARGET_ML = 20000;

const round1 = (n: number) => Math.round(n * 10) / 10;

// Whole mL; fl oz to one decimal. A stored amount is rounded only for display, and a tiny one never reads as 0.
export function formatWater(ml: number, unit: WaterUnit): string {
  if (unit === 'floz') {
    const oz = round1(unitFromMl(ml, 'floz'));
    return ml > 0 && oz === 0 ? '<0.1 fl oz' : `${oz} fl oz`;
  }
  if (ml > 0 && Math.round(ml) === 0) return '<1 mL';
  return Math.round(ml) >= 1000 ? `${Math.round(ml / 10) / 100} L` : `${Math.round(ml)} mL`;
}

// The limit in the user's unit, rounded like the amount shown for it (5000 mL is 169.1 fl oz).
const maxInUnit = (unit: WaterUnit, maxMl = MAX_ENTRY_ML) => round1(unitFromMl(maxMl, unit));

// Amount in mL, rounded to 0.1 mL so a round trip through fl oz does not drift; null when not above 0 or over the limit.
// The limit is checked in the user's unit, so the number in the error message is accepted, and saves as at most maxMl.
export function entryMl(value: number, unit: WaterUnit, maxMl = MAX_ENTRY_ML): number | null {
  if (!Number.isFinite(value) || value <= 0 || value > maxInUnit(unit, maxMl)) return null;
  const ml = Math.min(round1(mlFromUnit(value, unit)), maxMl);
  return ml > 0 ? ml : null;
}

export const limitText = (unit: WaterUnit, maxMl = MAX_ENTRY_ML) => `${maxInUnit(unit, maxMl)} ${unit === 'floz' ? 'fl oz' : 'mL'}`;
export const amountError = (unit: WaterUnit) => `Enter an amount above 0 and up to ${limitText(unit)}.`;

// Quick-add sizes in the chosen unit: a glass, a bottle and a large bottle.
export const QUICK_ADD: Record<WaterUnit, number[]> = { ml: [250, 500, 750], floz: [8, 16, 24] };

// The US and its territories, which use US customary units.
const US_CUSTOMARY = ['US', 'PR', 'GU', 'VI', 'AS', 'MP', 'UM'];

export function defaultWaterUnit(locale: string | undefined): WaterUnit {
  const region = locale?.split(/[-_]/).find((p) => /^[A-Za-z]{2}$/.test(p) && p === p.toUpperCase());
  return region && US_CUSTOMARY.includes(region) ? 'floz' : 'ml';
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
