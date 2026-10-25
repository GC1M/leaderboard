import { useColorScheme } from 'react-native';

// Tokens from the PLAN.md design section ("Race board"). One accent, and it means "you".
const light = {
  bg: '#F3F5F8',
  surface: '#FFFFFF',
  ink: '#0D1424',
  inkSoft: '#4A5568',
  border: '#8A94A6',
  line: '#DDE2EA',
  accent: '#2340D8',
  onAccent: '#FFFFFF',
  youTint: '#E3E9FF',
  danger: '#B42318',
  manual: '#8A5A00',
  lane: '#C9D0DC',
};

const dark: typeof light = {
  bg: '#0B1020',
  surface: '#151C30',
  ink: '#EEF1F7',
  inkSoft: '#A3AEC2',
  border: '#6B7691',
  line: '#26304A',
  accent: '#8FA3FF',
  onAccent: '#0B1020',
  youTint: '#1F2A52',
  danger: '#FF8A80',
  manual: '#F5C451',
  lane: '#2E3957',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
