import { StyleSheet, Text, View } from 'react-native';
import { Card, glass, useLargeText } from '@/components/ui';
import type { Highlight } from '@/lib/competitions';
import { useTheme } from '@/theme';

const EMOJI: Record<string, string> = { biggest: '🚀', wins: '👑', streak: '🔥', perfect: '💯', improved: '📈', steady: '🎯', battle: '⚔️' };

// Fun facts about the race so far as a grid of small tiles. Names are the group's display names; you read as "You", in teal.
export function Highlights({ items, names, uid }: { items: Highlight[]; names: Record<string, string>; uid: string }) {
  const c = useTheme();
  const large = useLargeText();
  if (!items.length) return null;
  const who = (ids: string[]) => ids.map((id) => (id === uid ? 'You' : names[id] ?? 'Someone')).join(ids.length === 2 ? ' vs ' : ', ');
  return (
    <Card icon={{ ios: 'star.fill', android: 'star', web: 'star' }} label="Highlights" color={c.steps}>
      <View style={styles.grid}>
        {items.map((h) => (
          <View key={h.key} accessible accessibilityLabel={`${h.title}: ${who(h.who)}. ${h.detail}.`} style={[styles.tile, glass(c), large && { flexBasis: '100%' }]}>
            <Text style={styles.emoji}>{EMOJI[h.key]}</Text>
            <Text style={[styles.title, { color: c.inkFaint }]}>{h.title}</Text>
            <Text style={[styles.who, { color: h.who.includes(uid) ? c.accent : c.ink }]}>{who(h.who)}</Text>
            <Text style={[styles.detail, { color: c.inkSoft }]}>{h.detail}</Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { flexGrow: 1, flexBasis: '45%', borderRadius: 16, padding: 12, gap: 2 },
  emoji: { fontSize: 22, lineHeight: 26 },
  title: { fontSize: 12, lineHeight: 16, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3 },
  who: { fontSize: 16, lineHeight: 21, fontWeight: '700' },
  detail: { fontSize: 12, lineHeight: 16 },
});
