import { useColorScheme } from 'react-native';

// Tokens from the PLAN.md design section, kept local until the shared theme.ts lands.
const light = { bg: '#F3F5F8', surface: '#FFFFFF', ink: '#0D1424', inkSoft: '#4A5568', border: '#8A94A6', line: '#DDE2EA', accent: '#2340D8', onAccent: '#FFFFFF', danger: '#B42318', manual: '#8A5A00' };
const dark = { bg: '#0B1020', surface: '#151C30', ink: '#EEF1F7', inkSoft: '#A3AEC2', border: '#6B7691', line: '#26304A', accent: '#8FA3FF', onAccent: '#0B1020', danger: '#FF8A80', manual: '#F5C451' };

export function useStepsTheme() {
  return useColorScheme() === 'dark' ? dark : light;
}
