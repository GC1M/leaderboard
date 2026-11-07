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

// A compact selector using the same surface, border and typography as the other fields.
export function DropdownField<T extends string>({ label, options, value, onChange }: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const c = useTheme();
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  return <View style={{ gap: 8 }}>
    <Text style={[styles.bodyStrong, { color: c.ink }]}>{label}</Text>
    <Pressable
      accessibilityRole="combobox"
      accessibilityLabel={label}
      accessibilityValue={{ text: selected?.label }}
      accessibilityState={{ expanded: open }}
      onPress={() => { Keyboard.dismiss(); setOpen((v) => !v); }}
      style={{ minHeight: 48, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: open ? c.accent : c.border, backgroundColor: c.surface, flexDirection: 'row', alignItems: 'center', gap: 12 }}
    >
      <Text style={[styles.body, { color: c.ink, flex: 1 }]}>{selected?.label}</Text>
      <Icon name={{ ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }} color={c.inkSoft} size={18} />
    </Pressable>
    {open && <Section><View accessibilityRole="radiogroup" accessibilityLabel={`${label} options`}>
      {options.map((option) => <Pressable
        key={option.value}
        accessibilityRole="radio"
        accessibilityLabel={option.label}
        accessibilityState={{ selected: option.value === value }}
        onPress={() => { onChange(option.value); setOpen(false); }}
        style={{ minHeight: 48, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}
      >
        <Text style={[styles.body, { color: option.value === value ? c.accent : c.ink, flex: 1 }]}>{option.label}</Text>
        {option.value === value && <Icon name={{ ios: 'checkmark', android: 'check', web: 'check' }} color={c.accent} size={18} />}
      </Pressable>)}
    </View></Section>}
  </View>;
}

// Editors store minutes for backwards-compatible drafts. The UI uses hours and minutes; fractional minutes preserve existing shorter sets.
export function DurationField({ label, value, onChange, optional, saveError }: { label: string; value: string; onChange: (v: string) => void; optional?: boolean; saveError?: string | null }) {
  const c = useTheme();
  const large = useLargeText();
  const split = (raw: string) => {
    const total = Number(raw.replace(',', '.'));
    return raw && Number.isFinite(total) && total >= 0 ? [String(Math.floor(total / 60)), String(Number((total % 60).toFixed(6)))] : ['', ''];
  };
  const [state, setState] = useState(() => ({ source: value, parts: split(value), error: null as string | null }));
  if (state.source !== value) setState({ source: value, parts: split(value), error: null });
  const { parts, error } = state;
  const update = (index: number, text: string) => {
    const next = parts.map((v, i) => i === index ? text : v);
    const minutes = decimalValue(next[1]);
    const bad = (!!next[0] && !/^\d+$/.test(next[0])) || (!!next[1] && minutes === null) || (minutes ?? 0) >= 60;
    const source = bad ? 'invalid' : next.every((v) => v === '') ? '' : String(Number(next[0]) * 60 + (minutes ?? 0));
    setState({ source, parts: next, error: bad ? 'Use whole hours and minutes from 0 to less than 60.' : null });
    // Never turn invalid input into a different valid duration.
    onChange(source);
  };
  return <View style={{ gap: 8 }}>
    <Text style={[styles.bodyStrong, { color: c.ink }]}>{label}{optional ? ' (optional)' : ''}</Text>
    <View style={{ flexDirection: large ? 'column' : 'row', gap: 8 }}>
      {['Hours', 'Minutes'].map((name, i) => <View key={name} style={{ flex: large ? undefined : 1 }}><NumberField label={name} accessibilityLabel={`${label} ${name.toLowerCase()}`} whole={i === 0} value={parts[i]} onChangeText={(v) => update(i, v)} helper=" " /></View>)}
    </View>
    <ErrorText>{error ?? saveError}</ErrorText>
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
