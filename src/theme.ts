import { type ColorValue, Platform, PlatformColor, useColorScheme } from 'react-native';

// Surfaces, text and separators follow Apple's semantic system colors on iOS, so they also adapt to
// Increase Contrast. The hex values are Apple's defaults, used on Android and web.
// Brand colors (accent, "you", medals, manual) are ours; contrast figures are in PLAN.md "Tokens".
const system = (name: string, hex: string): ColorValue => (Platform.OS === 'ios' ? PlatformColor(name) : hex);

const light = {
  bg: system('systemGroupedBackground', '#F2F2F7'),
  surface: system('secondarySystemGroupedBackground', '#FFFFFF'),
  ink: system('label', '#000000'),
  line: system('separator', '#C6C6C8'),
  inkSoft: '#4A5568',
  border: '#7A8496',
  accent: '#2340D8',
  onAccent: '#FFFFFF',
  youTint: '#E3E9FF',
  danger: '#B42318',
  manual: '#8A5A00',
  lane: '#C9D0DC',
  // Rank 1 to 3 numerals only. At least 3:1 (large text) on bg and youTint.
  medal: ['#9A6B00', '#5F6B7A', '#9C4F1F'],
};

const dark: typeof light = {
  bg: system('systemGroupedBackground', '#000000'),
  surface: system('secondarySystemGroupedBackground', '#1C1C1E'),
  ink: system('label', '#FFFFFF'),
  line: system('separator', '#38383A'),
  inkSoft: '#A3AEC2',
  border: '#6B7691',
  accent: '#8FA3FF',
  onAccent: '#0B1020',
  youTint: '#1F2A52',
  danger: '#FF8A80',
  manual: '#F5C451',
  lane: '#2E3957',
  medal: ['#F2C14E', '#C3CCDA', '#E09A6B'],
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
