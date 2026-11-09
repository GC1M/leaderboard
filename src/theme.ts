import { type ColorValue, DynamicColorIOS, Platform, useColorScheme } from 'react-native';

import { useAppearance } from '@/lib/appearance';

// "Liquid glass on paper": a soft teal and rust wash on paper, frosted translucent cards with a light top edge, deep
// teal for "you". Light is the default; dark follows the system or the Appearance setting. Each token is
// [light, dark, high contrast light, high contrast dark]. On iOS the colors resolve natively, so Increase Contrast
// picks the last two. Text was checked at 4.5:1 and marks at 3:1 against the blended card color (#F3F6F4 light,
// #24292B dark), including over the wash.
const tokens = {
  bg: ['#E6EBE8', '#12171A', '#E6EBE8', '#000000'],
  // Cards are translucent so the wash shows through them.
  surface: ['rgba(255,255,255,0.55)', 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0.92)', 'rgba(255,255,255,0.14)'],
  // Card outline, and its brighter top edge that reads as a glass highlight.
  edge: ['rgba(255,255,255,0.65)', 'rgba(255,255,255,0.14)', 'rgba(20,25,26,0.35)', 'rgba(255,255,255,0.5)'],
  edgeTop: ['rgba(255,255,255,0.85)', 'rgba(255,255,255,0.22)', 'rgba(20,25,26,0.35)', 'rgba(255,255,255,0.5)'],
  // Floating tab bar and Log button: more opaque than cards so labels stay legible over anything.
  glass: ['rgba(255,255,255,0.92)', 'rgba(30,36,38,0.94)', '#FFFFFF', '#12171A'],
  ink: ['#12191B', '#E7ECEA', '#000000', '#FFFFFF'],
  line: ['rgba(20,25,26,0.10)', 'rgba(255,255,255,0.10)', 'rgba(0,0,0,0.35)', 'rgba(255,255,255,0.4)'],
  inkSoft: ['#3F4B4D', '#B3BEBC', '#2E3436', '#CDD4D3'],
  // Faintest text: captions, units and periods.
  inkFaint: ['#535E5C', '#A0AAA8', '#454C4E', '#B4BCBD'],
  // Input outlines, quiet chart marks and everyone else's lane fill. At least 3:1 on the card.
  border: ['#6E7A78', '#8A9694', '#4F5A58', '#A8B2B0'],
  accent: ['#176A6E', '#4FB8BE', '#0F4447', '#7FD8DD'],
  onAccent: ['#FFFFFF', '#0B1214', '#FFFFFF', '#000000'],
  youTint: ['rgba(23,106,110,0.10)', 'rgba(79,184,190,0.12)', 'rgba(15,68,71,0.16)', 'rgba(127,216,221,0.18)'],
  danger: ['#B42318', '#FF8A80', '#8F1A10', '#FFA59E'],
  manual: ['#805300', '#E0AE52', '#6B4500', '#FFD66B'],
  // Empty lane track and skeleton rows.
  lane: ['rgba(20,25,26,0.10)', 'rgba(255,255,255,0.10)', 'rgba(20,25,26,0.2)', 'rgba(255,255,255,0.2)'],
  // Steps metric color: card labels and daily step bars only, never "you".
  steps: ['#A44A0B', '#F0A060', '#8F3E06', '#FFB880'],
} as const;
// Rank 1 to 3 numerals only. At least 4.5:1 on the card and the you tint.
const medals = [
  ['#8A5F00', '#D9A93A', '#6E4C00', '#FFD66B'],
  ['#5F6B7A', '#A9B4C2', '#46505C', '#DCE3EE'],
  ['#9C4F1F', '#D58C5B', '#7A3C14', '#F2B48A'],
] as const;

type Tone = readonly [string, string, string, string];
const resolve = ([light, dark, highContrastLight, highContrastDark]: Tone, scheme: 0 | 1): ColorValue =>
  Platform.OS === 'ios' ? DynamicColorIOS({ light, dark, highContrastLight, highContrastDark }) : scheme ? dark : light;
const build = (scheme: 0 | 1) => ({
  ...(Object.fromEntries(Object.entries(tokens).map(([k, v]) => [k, resolve(v, scheme)])) as Record<keyof typeof tokens, ColorValue>),
  medal: medals.map((m) => resolve(m, scheme)),
  dark: scheme === 1,
  // The teal and rust wash behind every screen, as a CSS background-image for `experimental_backgroundImage`.
  // Plain strings, not dynamic colors, so it is picked by scheme (iOS high contrast keeps the same wash).
  wash: scheme
    ? 'radial-gradient(60% 40% at 20% 10%, rgba(79,184,190,0.14), transparent 70%), radial-gradient(50% 35% at 90% 45%, rgba(240,160,96,0.10), transparent 70%), radial-gradient(60% 40% at 30% 95%, rgba(79,184,190,0.10), transparent 70%)'
    : 'radial-gradient(60% 40% at 20% 10%, rgba(23,106,110,0.22), transparent 70%), radial-gradient(50% 35% at 90% 45%, rgba(181,82,14,0.16), transparent 70%), radial-gradient(60% 40% at 30% 95%, rgba(23,106,110,0.14), transparent 70%)',
});
const light = build(0);
const dark = build(1);

export type Theme = typeof light;

// Two radii only: containers (cards, grouped lists) and controls (buttons, inputs, pills).
export const radius = { card: 22, control: 16 } as const;
// Serif for large titles and the one-line highlight. Loaded in the root layout; falls back to the system font.
export const serif = { title: 'Newsreader_600SemiBold', text: 'Newsreader_500Medium' };
// Rounded system numerals on iOS for ranks and big values, like Apple Health.
export const rounded = Platform.OS === 'ios' ? 'ui-rounded' : undefined;

export function useTheme(): Theme {
  const system = useColorScheme(); const [choice] = useAppearance();
  return (choice === 'system' ? system : choice) === 'dark' ? dark : light;
}
