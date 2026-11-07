import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Segmented } from '@/components/history/Segmented';
import { WeightChart } from '@/components/history/WeightChart';
import { ExportOption, useExportChoice } from '@/components/health/ExportOption';
import { DateField, NumberField, Overflow } from '@/components/inputs';
import { Button, ErrorText, Row, Screen, Section, Skeleton, styles } from '@/components/ui';
import { alert } from '@/lib/alert';
import { useAuth } from '@/lib/auth';
import { useEditorNavigation } from '@/lib/editor-navigation';
import { readingDateLabel, startOfLocalDay } from '@/lib/health/dates';
import { formatWeight, RANGES, type Range, type WeightUnit } from '@/lib/health/format';
import { canExport, MANUAL_KINDS } from '@/lib/health/manual-export';
import { validateWeight } from '@/lib/health/rules';
import { useHealthExport } from '@/lib/health/sync';
import { displayWeight, kgFromDisplay } from '@/lib/health/weight';
import { convertDecimal } from '@/lib/numeric-input';
import { clearMeasurementDraft, loadMeasurementDraft, saveMeasurementDraft } from '@/lib/measurement-draft';
import { useWeightUnit } from '@/lib/weight-unit';
import { deleteManualWeight, getMyLatestWeight, getMyWeightHistory, saveManualWeight } from '@/lib/weight';
import { useTheme } from '@/theme';

type Reading = { id?: string; kg: number; measuredAt: string; source?: string };
type Result = { days: number; rows?: Reading[]; latest?: Reading | null; error?: string };
type Draft = { text: string; when: string; unit: WeightUnit; editing: string | null };
export default function Weight() {
  const c = useTheme();
  const me = useAuth().session?.user.id ?? '';
  const [preferred] = useWeightUnit();
  const [unit, setUnit] = useState<WeightUnit>(preferred);
  const [days, setDays] = useState<Range>(30);
  const [tries, setTries] = useState(0);
  const [res, setRes] = useState<Result | null>(null);
  const [view, setView] = useState<'history' | 'detail' | 'edit'>('history');
  const [selected, setSelected] = useState<Reading | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [text, setText] = useState('');
  const [when, setWhen] = useState(new Date());
  const [editing, setEditing] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [whenError, setWhenError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unitsOpen, setUnitsOpen] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.all([getMyWeightHistory(me, startOfLocalDay(new Date(), days - 1)), getMyLatestWeight(me)]).then(
      ([rows, latest]) => live && setRes({ days, rows, latest }),
      (e) => live && setRes({ days, error: e instanceof Error ? e.message : "Couldn't load weight." }),
    );
    return () => { live = false; };
  }, [me, days, tries]);
  useEffect(() => {
    let live = true;
    void loadMeasurementDraft(me, 'weight').then((raw) => {
      const d = raw as Partial<Draft> | null;
      if (live && d && typeof d.text === 'string' && typeof d.when === 'string' && Number.isFinite(Date.parse(d.when)) && (d.unit === 'kg' || d.unit === 'lb') && (d.editing === null || typeof d.editing === 'string')) setDraft(d as Draft);
    });
    return () => { live = false; };
  }, [me]);
  const snapshot = { text, when: when.toISOString(), unit, editing };
  const latestForm = useRef({ snapshot, changed, view });
  useEffect(() => { latestForm.current = { snapshot, changed, view }; });
  const persist = async () => { const x = latestForm.current; if (x.changed && x.view === 'edit') await saveMeasurementDraft(me, 'weight', x.snapshot); };
  useEffect(() => {
    const timer = setTimeout(() => { const x = latestForm.current; if (x.changed && x.view === 'edit') void saveMeasurementDraft(me, 'weight', x.snapshot); }, 400);
    return () => clearTimeout(timer);
  }, [me, text, when, unit, editing, changed, view]);
  const clear = async () => { latestForm.current.changed = false; setChanged(false); setDraft(null); await clearMeasurementDraft(me, 'weight'); };
  useEditorNavigation(view === 'edit' && changed && !busy, persist, clear);
  const exp = useHealthExport();
  const choice = useExportChoice('weight');
  // Switching units back, with no typing in between, restores the exact text rather than a rounded conversion.
  const unitUndo = useRef<{ unit: 'kg' | 'lb'; text: string; shown: string } | null>(null);
  const send = (id: string, op: 'save' | 'delete', payload: unknown) => { void exp.enqueue(MANUAL_KINDS.weight, id, op, payload).catch(() => {}); };
  const current = res?.days === days ? res : null;
  const displayUnit = view === 'history' ? preferred : unit;
  const begin = (r?: Reading) => { setEditing(r?.id ?? null); setUnit(preferred); setText(r ? String(Number(displayWeight(r.kg, preferred).toFixed(3))) : ''); setWhen(r ? new Date(r.measuredAt) : new Date()); setChanged(false); setFormError(null); setWhenError(null); setView('edit'); };
  const cancel = () => {
    if (!changed) return setView(selected ? 'detail' : 'history');
    alert('Unsaved changes', 'Keep editing, save a draft for later, or discard.', [
      { text: 'Keep Editing', style: 'cancel' },
      { text: 'Save Draft', onPress: () => void persist().then(() => { setDraft(snapshot); setChanged(false); setView('history'); }) },
      { text: 'Discard Changes', style: 'destructive', onPress: () => void clear().then(() => setView(selected ? 'detail' : 'history')) },
    ]);
  };
  const save = async () => {
    if (busy) return;
    const v = validateWeight(text, unit);
    if (!v.ok) return setFormError(v.message);
    if (!Number.isFinite(when.getTime()) || when.getTime() > Date.now()) return setWhenError('Choose a measurement time that has passed.');
    setBusy(true); setFormError(null);
    try {
      const id = await saveManualWeight(me, { id: editing ?? undefined, kg: v.kg, measuredAt: when.toISOString() });
      if (choice.on) send(id, 'save', { kg: v.kg, at: when.toISOString() });
      await clear(); setSelected({ id, kg: v.kg, measuredAt: when.toISOString(), source: 'manual' }); setView('detail'); setTries((t) => t + 1);
    } catch (e) { setFormError(e instanceof Error ? e.message : "Couldn't save weight."); }
    finally { setBusy(false); }
  };
  const remove = () => alert(`Delete ${selected ? formatWeight(selected.kg, unit) : 'weight'} reading?`, `Measured ${selected ? new Date(selected.measuredAt).toLocaleString() : ''}. This cannot be undone.`, [
    { text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => {
      if (busy || !selected?.id) return; setBusy(true);
      try { await deleteManualWeight(me, selected.id); if (choice.on) send(selected.id, 'delete', null); setSelected(null); setView('history'); setTries((t) => t + 1); }
      catch (e) { setFormError((e as Error).message); } finally { setBusy(false); }
    } },
  ]);
  if (view === 'edit') return <Screen title={editing ? 'Edit Weight' : 'Add Weight'} back backLabel="Cancel" onBack={cancel}>
    <NumberField label={`Weight (${unit})`} value={text} onChangeText={(v) => { setText(v); setChanged(true); setFormError(null); }} placeholder={unit === 'kg' ? '75.0' : '165.0'} error={formError} />
    <Button plain label={`Weight unit: ${unit} · Change for this entry`} onPress={() => setUnitsOpen((v) => !v)} />
    {unitsOpen && <Segmented label="Weight unit for this entry" options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }] as const} value={unit} onChange={(u) => {
      try {
        const back = unitUndo.current;
        const next = back && back.unit === u && back.shown === text ? back.text : convertDecimal(text, (v) => displayWeight(kgFromDisplay(v, unit), u));
        unitUndo.current = { unit, text, shown: next };
        setText(next); setUnit(u); setChanged(true);
      } catch (e) { setFormError((e as Error).message); }
    }} />}
    <DateField label="When" value={when} onChange={(v) => { setWhen(v); setChanged(true); setWhenError(null); }} />
    <ErrorText>{whenError}</ErrorText>
    <ExportOption type="weight" choice={choice} note="Saved to Apple Health as body mass at this time. Group sharing is separate." />
    <Button label={editing ? 'Save Changes' : 'Save Weight'} busy={busy} disabled={!text.trim()} onPress={() => void save()} />
  </Screen>;
  if (view === 'detail' && selected) return <Screen title="Weight Reading" back onBack={() => { setSelected(null); setView('history'); }} headerActions={canExport(selected.source ?? '') && <Button plain label="Edit" disabled={busy} onPress={() => begin(selected)} />}>
    <Section><Row wrap label="Weight" value={formatWeight(selected.kg, unit)} /><Row wrap label="Measured" value={new Date(selected.measuredAt).toLocaleString()} /><Row wrap label="Source" value={selected.source === 'manual' ? 'Manual' : 'Apple Health'} last /></Section>
    <ErrorText>{formError}</ErrorText>
    {canExport(selected.source ?? '') ? <Overflow name="weight reading"><Row wrap label="Delete Reading" danger disabled={busy} last onPress={remove} /></Overflow> : <Text style={[styles.body, { color: c.inkSoft }]}>Imported readings can be changed in Apple Health.</Text>}
  </Screen>;
  return <Screen title="My Weight" back>
    {current?.error ? <View><ErrorText>{current.error}</ErrorText><Button plain label="Try Again" onPress={() => { setRes(null); setTries((t) => t + 1); }} /></View> : !current ? <Skeleton label="Loading weight" rows={2} /> : current.latest ? <>
      <Text style={[styles.heading, { color: c.ink }]}>{formatWeight(current.latest.kg, displayUnit)}</Text>
      <Text style={[styles.caption, { color: c.inkSoft }]}>Latest, {readingDateLabel(new Date(current.latest.measuredAt))}</Text>
      <Segmented label="Time range" options={RANGES.map((r) => ({ value: r, label: `${r}D` }))} value={days} onChange={setDays} />
      {current.rows?.length ? <WeightChart readings={current.rows} days={days} to={new Date()} unit={displayUnit} /> : <Text style={[styles.body, { color: c.inkSoft }]}>{`No readings in the last ${days} days. Try a wider range.`}</Text>}
      <Section title="History">{[...(current.rows ?? [])].reverse().map((r, i, all) => <Row wrap key={r.id ?? r.measuredAt} label={formatWeight(r.kg, displayUnit)} value={`${new Date(r.measuredAt).toLocaleString()} · ${r.source === 'manual' ? 'Manual' : 'Apple Health'}`} last={i === all.length - 1} onPress={() => { setSelected(r); setUnit(preferred); setFormError(null); setView('detail'); }} />)}</Section>
    </> : <Text style={[styles.body, { color: c.inkSoft }]}>No weight recorded yet.</Text>}
    <Button label="Add Weight" onPress={() => begin()} />
    {draft && <Button secondary label="Resume Weight Draft" onPress={() => { setText(draft.text); setWhen(new Date(draft.when)); setUnit(draft.unit); setEditing(draft.editing); setChanged(true); setView('edit'); }} />}
    <Text style={[styles.caption, { color: c.inkSoft }]}>Only you can see this history. Group sharing is controlled in Group Info.</Text>
  </Screen>;
}
