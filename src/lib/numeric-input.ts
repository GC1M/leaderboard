// Do not strip characters from a paste: "7,5" must never become 75.
export function decimalValue(raw: string): number | null {
  const s = raw.trim();
  if (!/^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(s)) return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
export function numericError(raw: string, whole = false): string | null {
  if (!raw.trim()) return null;
  return (whole ? /^\d+$/.test(raw.trim()) : decimalValue(raw) !== null)
    ? null : whole ? 'Use whole numbers only.' : 'Use a decimal number, such as 75.5 or 75,5.';
}
export function convertDecimal(raw: string, convert: (n: number) => number): string {
  const n = decimalValue(raw);
  if (!raw.trim()) return raw;
  if (n === null) throw new Error('Correct the invalid number before changing units.');
  return String(Number(convert(n).toFixed(6)));
}
