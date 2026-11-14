import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { Segmented } from '@/components/history/Segmented';
import { DateField } from '@/components/inputs';
import { Button, ErrorText, Field, Screen, Skeleton, styles } from '@/components/ui';
import { createCompetition, METRICS, SCORING, type CompetitionMetric, type CompetitionScoring } from '@/lib/competitions';
import { listMyGroups, type MyGroup } from '@/lib/groups';
import { localDateKey } from '@/lib/health/dates';
import { useTheme } from '@/theme';
// A row of selectable pills, read as a radio group.
function Chips<T extends string>({ label, options, value, onChange }: { label: string; options: readonly { value: T; label: string }[]; value: T | null; onChange: (v: T) => void }) {
  const c = useTheme();
  return <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
    {options.map((m) => { const on = m.value === value; return <Pressable key={m.value} accessibilityRole="radio" accessibilityLabel={m.label} accessibilityState={{ selected: on }} onPress={() => onChange(m.value)}
      style={{ minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 22, borderWidth: on ? 2 : 1, borderColor: on ? c.accent : c.border, backgroundColor: on ? c.surface : c.lane }}>
      <Text style={[styles.bodyStrong, { color: on ? c.accent : c.ink }]}>{m.label}</Text>
    </Pressable>; })}
  </View>;
}
// Helper text under a switch or field, in the same caption style as the rest of the form.
function Toggle({ label, helper, value, onChange, disabled }: { label: string; helper: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const c = useTheme();
  return <View style={{ gap: 4 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><Text style={[styles.body, { color: c.ink, flex: 1 }]}>{label}</Text><Switch accessibilityLabel={label} value={value} onValueChange={onChange} disabled={disabled} /></View>
    <Text style={[styles.caption, { color: c.inkSoft }]}>{helper}</Text>
  </View>;
}
// From a group the group is given; from the Compete tab there is none, so the form starts with a group picker.
export default function NewCompetition() {
  const { id } = useLocalSearchParams<{ id?: string }>(); const router = useRouter(); const c = useTheme();
  const [groups, setGroups] = useState<MyGroup[] | null>(id ? [] : null); const [group, setGroup] = useState<string | null>(id ?? null);
  const [name, setName] = useState(''); const [metric, setMetric] = useState<CompetitionMetric>('steps'); const [scoring, setScoring] = useState<CompetitionScoring>('total');
  const [start, setStart] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d; });
  const [last, setLast] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 7); return d; });
  const [late, setLate] = useState(false); const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const lock = useRef(false);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  useEffect(() => {
    if (id) return;
    let live = true;
    listMyGroups().then((g) => { if (live) { setGroups(g); if (g.length === 1) setGroup(g[0].id); } }, () => live && setError("Couldn't load your groups."));
    return () => { live = false; };
  }, [id]);
  // A start day that has passed can only be joined late, so the switch is on and locked.
  const started = localDateKey(start) <= localDateKey(new Date());
  const save = async () => {
    if (lock.current) return;
    if (!group) return setError('Choose a group.');
    if (!name.trim()) return setError('Give the competition a name.');
    const end = new Date(last); end.setDate(end.getDate() + 1);
    lock.current = true; setBusy(true); setError(null);
    try {
      const competitionId = await createCompetition({ groupId: group, name, metric, firstDay: localDateKey(start), endDay: localDateKey(end), timezone, includeManual: manual, lateJoins: late || started, scoring });
      // From a group, the new competition replaces this form in the same stack (Social or Summary); from Compete it opens there.
      if (id) router.replace(`../${competitionId}`, { relativeToDirectory: true }); else router.replace(`/compete/${group}/${competitionId}`);
    }
    catch (e) { setError((e as Error).message); } finally { lock.current = false; setBusy(false); }
  };
  return <Screen title="New Competition" back backLabel="Cancel">
    {!id && <View style={{ gap: 8 }}>
      <Text style={[styles.bodyStrong, { color: c.ink }]}>Group</Text>
      {groups === null ? <Skeleton label="Loading groups" rows={1} /> : groups.length ? <Chips label="Group" options={groups.map((g) => ({ value: g.id, label: g.name }))} value={group} onChange={setGroup} />
        : <Text style={[styles.body, { color: c.inkSoft }]}>Competitions run inside a group. Create or join one in Social first.</Text>}
    </View>}
    <Field label="Name" value={name} onChangeText={setName} maxLength={80} placeholder="A week of walking" />
    <View style={{ gap: 8 }}>
      <Text style={[styles.bodyStrong, { color: c.ink }]}>Metric</Text>
      <Chips label="Metric" options={METRICS} value={metric} onChange={setMetric} />
      <Text style={[styles.caption, { color: c.inkSoft }]}>Weight, food and sleep are never ranked. Scores come from what everyone has already imported or logged.</Text>
    </View>
    <DateField label="Starts on" mode="date" value={start} onChange={setStart} />
    <Text style={[styles.caption, { color: c.inkSoft }]}>Up to 90 days ago. Past days are scored from imported history.</Text>
    <DateField label="Last scoring day" mode="date" value={last} onChange={setLast} />
    <Toggle label="Late joins" helper={started ? 'Let people join after it has started. Required because the start day has passed.' : 'Let people join after it has started.'} value={late || started} onChange={setLate} disabled={started} />
    <View style={{ gap: 8 }}>
      <Text style={[styles.bodyStrong, { color: c.ink }]}>Scoring</Text>
      <Segmented label="Scoring" options={SCORING} value={scoring} onChange={setScoring} />
      <Text style={[styles.caption, { color: c.inkSoft }]}>Total adds every day up. Daily average divides by the days so far. Best streak counts consecutive days above zero.</Text>
    </View>
    <Toggle label="Count manual entries" helper="Otherwise only Health entries score." value={manual} onChange={setManual} />
    <Text style={[styles.caption, { color: c.inkSoft }]}>1–90 full days in {timezone}. Creating a competition does not enroll you. The rules cannot be edited later.</Text>
    <ErrorText>{error}</ErrorText><Button label="Create competition" busy={busy} disabled={groups !== null && !groups.length && !id} onPress={() => void save()} />
  </Screen>;
}
