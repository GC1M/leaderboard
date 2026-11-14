import { StyleSheet, Text, View } from 'react-native';
import { Card, Icon, glass, useLargeText } from '@/components/ui';
import type { SymbolViewProps } from 'expo-symbols';
import type { Highlight } from '@/lib/competitions';
import { useTheme } from '@/theme';

const ICONS: Record<string, SymbolViewProps['name']> = {
  biggest: { ios: 'bolt.fill', android: 'bolt', web: 'bolt' },
  wins: { ios: 'crown.fill', android: 'workspace_premium', web: 'workspace_premium' },
  streak: { ios: 'flame.fill', android: 'local_fire_department', web: 'local_fire_department' },
  perfect: { ios: 'checkmark.seal.fill', android: 'verified', web: 'verified' },
  improved: { ios: 'chart.line.uptrend.xyaxis', android: 'trending_up', web: 'trending_up' },
  steady: { ios: 'scope', android: 'my_location', web: 'my_location' },
  battle: { ios: 'figure.fencing', android: 'sports_kabaddi', web: 'sports_kabaddi' },
};

// Fun facts about the race so far as a grid of small tiles. Names are the group's display names; you read as "You", in teal.
export function Highlights({ items, names, uid }: { items: Highlight[]; names: Record<string, string>; uid: string }) {
  const c = useTheme();
  const large = useLargeText();
  if (!items.length) return null;
  // A battle is two sides; anything else is a tie, read as a list.
  const who = (h: Highlight) => {
    const n = h.who.map((id) => (id === uid ? 'You' : names[id] ?? 'Someone'));
    return h.key === 'battle' ? n.join(' vs ') : n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}` : n[0];
  };
  return (
    <Card icon={{ ios: 'star.fill', android: 'star', web: 'star' }} label="Highlights" color={c.steps}>
      <View style={styles.grid}>
        {items.map((h) => (
          <View key={h.key} accessible accessibilityLabel={`${h.title}: ${who(h)}. ${h.detail}.`} style={[styles.tile, glass(c), large && { flexBasis: '100%' }]}>
            <Icon name={ICONS[h.key]} color={h.key === 'wins' ? c.medal[0] : c.steps} size={20} />
            <Text style={[styles.title, { color: c.inkFaint }]}>{h.title}</Text>
            <Text style={[styles.who, { color: h.who.includes(uid) ? c.accent : c.ink }]}>{who(h)}</Text>
            <Text style={[styles.detail, { color: c.inkSoft }]}>{h.detail}</Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { flexGrow: 1, flexBasis: '45%', borderRadius: 16, padding: 12, gap: 4 },
  title: { fontSize: 12, lineHeight: 16, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3 },
  who: { fontSize: 16, lineHeight: 21, fontWeight: '700' },
  detail: { fontSize: 12, lineHeight: 16 },
});
