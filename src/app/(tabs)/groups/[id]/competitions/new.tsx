import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { DateField } from '@/components/inputs';
import { Button, ErrorText, Field, Screen, styles } from '@/components/ui';
import { createCompetition } from '@/lib/competitions';
import { localDateKey } from '@/lib/health/dates';
import { useTheme } from '@/theme';
export default function NewCompetition() {
  const { id } = useLocalSearchParams<{ id: string }>(); const router = useRouter(); const c = useTheme();
  const [name, setName] = useState(''); const [start, setStart] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d; });
  const [last, setLast] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 7); return d; });
  const [manual, setManual] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const lock = useRef(false);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const save = async () => {
    if (lock.current) return;
    if (!name.trim()) return setError('Give the competition a name.');
    const end = new Date(last); end.setDate(end.getDate() + 1);
    lock.current = true; setBusy(true); setError(null);
    try { const competitionId = await createCompetition({ groupId: id, name, firstDay: localDateKey(start), endDay: localDateKey(end), timezone, includeManual: manual }); router.replace(`/groups/${id}/competitions/${competitionId}`); }
    catch (e) { setError((e as Error).message); } finally { lock.current = false; setBusy(false); }
  };
  return <Screen title="New Competition" back backLabel="Cancel">
    <Field label="Name" value={name} onChangeText={setName} maxLength={80} placeholder="A week of walking" />
    <Text style={[styles.bodyStrong, { color: c.ink }]}>Steps · {timezone}</Text>
    <DateField label="Starts on" mode="date" value={start} onChange={setStart} />
    <DateField label="Last scoring day" mode="date" value={last} onChange={setLast} />
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><Text style={[styles.body, { color: c.ink, flex: 1 }]}>Include manual steps</Text><Switch accessibilityLabel="Include manual steps" value={manual} onValueChange={setManual} /></View>
    <Text style={[styles.caption, { color: c.inkSoft }]}>1–90 full days. Everyone must use {timezone}. Enrollment closes at the start. Creating a competition does not enroll you. The dates and eligibility rules cannot be edited later.</Text>
    <ErrorText>{error}</ErrorText><Button label="Create Competition" busy={busy} onPress={() => void save()} />
  </Screen>;
}
