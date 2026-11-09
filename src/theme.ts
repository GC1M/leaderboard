import { type ColorValue, DynamicColorIOS, Platform, useColorScheme } from 'react-native';

// "Field notes": paper background, lighter paper cards, deep teal for "you". Light is the default; dark follows the
// system setting. Each token is [light, dark, high contrast light, high contrast dark]. On iOS the colors resolve
// natively, so Increase Contrast picks the last two. Every pair was checked for WCAG contrast (text 4.5:1, large
// numerals and meaningful marks 3:1) and for color-vision separation of you / lane / steps.
const tokens = {
  bg: ['#EDF0EE', '#12171A', '#EDF0EE', '#000000'],
  surface: ['#F7F8F6', '#1B2225', '#FFFFFF', '#12171A'],
  ink: ['#14181A', '#E7ECEA', '#000000', '#FFFFFF'],
  line: ['#D3D8D5', '#2E3639', '#9AA3A1', '#5C6567'],
  inkSoft: ['#454C4E', '#A9B2B1', '#2E3436', '#CDD4D3'],
  // Faintest text: captions, units and periods.
  inkFaint: ['#5E6967', '#98A1A3', '#454C4E', '#B4BCBD'],
  // Input outlines and everyone else's lane fill. At least 3:1 on the card.
  border: ['#86918F', '#6F7A79', '#6B7573', '#8A9493'],
  accent: ['#1E5F63', '#4FB8BE', '#0F4447', '#7FD8DD'],
  onAccent: ['#FFFFFF', '#0B1214', '#FFFFFF', '#000000'],
  youTint: ['#E1E9E7', '#22373A', '#D5E0DF', '#1E3B3D'],
  danger: ['#B42318', '#FF8A80', '#8F1A10', '#FFA59E'],
  manual: ['#8A5A00', '#F5C451', '#6B4500', '#FFD66B'],
  // Empty lane track and skeleton rows.
  lane: ['#DCE1DE', '#2A3336', '#C3CAC7', '#3A4447'],
  // Steps metric color: card labels and daily step bars only, never "you".
  steps: ['#B5520E', '#F0A060', '#8F3E06', '#FFB880'],
} as const;
// Rank 1 to 3 numerals only. At least 4.5:1 on the card and the you tint.
const medals = [
  ['#8A5F00', '#F2C14E', '#6E4C00', '#FFD66B'],
  ['#5F6B7A', '#C3CCDA', '#46505C', '#DCE3EE'],
  ['#9C4F1F', '#E09A6B', '#7A3C14', '#F2B48A'],
] as const;

type Tone = readonly [string, string, string, string];
const resolve = ([light, dark, highContrastLight, highContrastDark]: Tone, scheme: 0 | 1): ColorValue =>
  Platform.OS === 'ios' ? DynamicColorIOS({ light, dark, highContrastLight, highContrastDark }) : scheme ? dark : light;
const build = (scheme: 0 | 1) => ({
  ...(Object.fromEntries(Object.entries(tokens).map(([k, v]) => [k, resolve(v, scheme)])) as Record<keyof typeof tokens, ColorValue>),
  medal: medals.map((m) => resolve(m, scheme)),
  dark: scheme === 1,
});
const light = build(0);
const dark = build(1);

export type Theme = typeof light;

// Serif for large titles and the one-line highlight. Loaded in the root layout; falls back to the system font.
export const serif = { title: 'Newsreader_600SemiBold', text: 'Newsreader_500Medium' };
// Rounded system numerals on iOS for ranks and big values, like Apple Health.
export const rounded = Platform.OS === 'ios' ? 'ui-rounded' : undefined;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
