import { type ReactNode, useState } from 'react';
import { requireOptionalNativeModule } from 'expo';
import { Keyboard, Platform, Pressable, Text, View } from 'react-native';
import { Button, ErrorText, Field, Icon, Row, Section, styles, useLargeText } from './ui';
import { decimalValue, numericError } from '@/lib/numeric-input';
import { useTheme } from '@/theme';

type NumberProps = React.ComponentProps<typeof Field> & { whole?: boolean };
export function NumberField({ whole, error, ...props }: NumberProps) {
  return <Field {...props} keyboardType={whole ? 'number-pad' : 'decimal-pad'} inputMode={whole ? 'numeric' : 'decimal'} returnKeyType="done" onSubmitEditing={Keyboard.dismiss} error={error || numericError(props.value ?? '', whole)} helper={props.helper ?? (whole ? 'Whole numbers only.' : 'Decimals may use a dot or comma.')} />;
}

// Editors store minutes for backwards-compatible drafts. The UI makes h/m/s unambiguous.
export function DurationField({ label, value, onChange, optional }: { label: string; value: string; onChange: (v: string) => void; optional?: boolean }) {
  const c = useTheme();
  const large = useLargeText();
  const split = (raw: string) => {
    const total = Math.round(Number(raw.replace(',', '.')) * 60 * 1e6) / 1e6;
    return raw && Number.isFinite(total) && total >= 0 ? [String(Math.floor(total / 3600)), String(Math.floor(total / 60) % 60), String(Number((total % 60).toFixed(6)))] : ['', '', ''];
  };
  const [state, setState] = useState(() => ({ source: value, parts: split(value), error: null as string | null }));
  if (state.source !== value) setState({ source: value, parts: split(value), error: null });
  const { parts, error } = state;
  const update = (index: number, text: string) => {
    const next = parts.map((v, i) => i === index ? text : v);
    const bad = next.slice(0, 2).some((v) => v !== '' && !/^\d+$/.test(v)) || (!!next[2] && decimalValue(next[2]) === null) || Number(next[1]) >= 60 || (decimalValue(next[2]) ?? 0) >= 60;
    const source = bad ? 'invalid' : next.every((v) => v === '') ? '' : String((Number(next[0]) * 3600 + Number(next[1]) * 60 + (decimalValue(next[2]) ?? 0)) / 60);
    setState({ source, parts: next, error: bad ? 'Use whole hours, 0–59 minutes and seconds below 60.' : null });
    // Never turn invalid input into a different valid duration.
    onChange(source);
  };
  return <View style={{ gap: 8 }}>
    <Text style={[styles.bodyStrong, { color: c.ink }]}>{label}{optional ? ' (optional)' : ''}</Text>
    <View style={{ flexDirection: large ? 'column' : 'row', gap: 8 }}>
      {['Hours', 'Minutes', 'Seconds'].map((name, i) => <View key={name} style={{ flex: large ? undefined : 1 }}><NumberField label={name} accessibilityLabel={`${label} ${name.toLowerCase()}`} whole={i < 2} value={parts[i]} onChangeText={(v) => update(i, v)} helper=" " /></View>)}
    </View>
    <ErrorText>{error}</ErrorText>
  </View>;
}

export function DateField({ label, value, onChange, mode = 'datetime' }: { label: string; value: Date; onChange: (v: Date) => void; mode?: 'date' | 'time' | 'datetime' }) {
  const c = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = Number.isFinite(value.getTime());
  if (Platform.OS === 'web') {
    const pad = (n: number) => String(n).padStart(2, '0');
    const date = valid ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` : '';
    const time = valid ? `${pad(value.getHours())}:${pad(value.getMinutes())}` : '';
    return <View style={{ gap: 8 }}><Text style={[styles.bodyStrong, { color: c.ink }]}>{label}</Text>
      <input aria-label={label} type={mode === 'datetime' ? 'datetime-local' : mode} value={mode === 'datetime' ? `${date}T${time}` : mode === 'date' ? date : time}
        onChange={(e) => {
          const raw = e.target.value;
          if (!raw) return;
          const next = new Date(mode === 'time' ? `${date}T${raw}` : mode === 'date' ? `${raw}T${time || '00:00'}` : raw);
          if (Number.isFinite(next.getTime())) onChange(next);
        }} style={{ minHeight: 48, minWidth: 0, width: '100%', boxSizing: 'border-box', borderRadius: 10, border: `1px solid ${c.border}`, padding: 12, font: 'inherit', fontSize: 17, color: String(c.ink), background: String(c.surface), colorScheme: c.bg === '#000000' ? 'dark' : 'normal' }} />
    </View>;
  }
  const pick = async () => {
    setBusy(true); setError(null); Keyboard.dismiss();
    try {
      const picker = requireOptionalNativeModule<{ pick: (label: string, value: number, mode: string) => Promise<number | null> }>('LeaderboardDatePicker');
      if (!picker) throw new Error('Rebuild the iOS app to enable the native date and time picker.');
      const result = await picker.pick(label, valid ? value.getTime() : Date.now(), mode);
      if (result !== null) onChange(new Date(result));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not open date picker.'); }
    finally { setBusy(false); }
  };
  return <View style={{ gap: 8 }}><Section><Row label={label} value={valid ? value.toLocaleString(undefined, mode === 'date' ? { dateStyle: 'medium' } : mode === 'time' ? { timeStyle: 'short' } : { dateStyle: 'medium', timeStyle: 'short' }) : 'Choose'} onPress={() => void pick()} disabled={busy} last /></Section><ErrorText>{error}</ErrorText></View>;
}

export function RemoveButton({ label, onPress }: { label: string; onPress: () => void }) {
  const c = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-end' }}><Icon name={{ ios: 'minus.circle', android: 'remove_circle_outline', web: 'remove_circle_outline' }} color={c.danger} size={24} /></Pressable>;
}
export function Overflow({ name, children }: { name: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <View><Button plain label={`More actions for ${name}`} onPress={() => setOpen((v) => !v)} />{open && <Section>{children}</Section>}</View>;
}
