// E.164 normalizer. Numbers without a + prefix are assumed to be US/Canada (+1).
export function normalizePhone(input: string): string | null {
  // "+44 (0) 20 ..." writes the trunk 0, which is not dialled internationally. Italy keeps its leading 0, so a
  // bare 0 after the country code is only dropped for the UK.
  const trimmed = input.trim().replace(/^(\+.*?)\(0\)/, '$1');
  if (!/^\+?[\d\s().-]+$/.test(trimmed)) return null;
  let digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) {
    if (digits.startsWith('440')) digits = `44${digits.slice(3)}`;
    if (digits.startsWith('1')) return /^1[2-9]\d{9}$/.test(digits) ? `+${digits}` : null;
    return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
  }
  if (digits.length === 10 && /^[2-9]/.test(digits)) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1') && /^[2-9]/.test(digits[1])) return `+${digits}`;
  return null;
}
