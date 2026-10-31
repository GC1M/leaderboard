import { act } from 'react';
import { Platform } from 'react-native';
import { createRoot } from 'test-renderer';
import Weight from '@/app/(tabs)/(summary)/weight';
const mockAlert = jest.fn();
const mockDelete = jest.fn();
const mockSave = jest.fn();
const mockReading = { id: 'w1', kg: 80, measuredAt: new Date(Date.now() - 3600_000).toISOString(), source: 'manual' };
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), canGoBack: () => true }), useFocusEffect: jest.fn(), useSegments: () => [], usePreventRemove: () => jest.fn() }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'me' } }, loading: false }) }));
jest.mock('@/lib/alert', () => ({ alert: (...args: unknown[]) => mockAlert(...args) }));
jest.mock('@/lib/weight-unit', () => ({ useWeightUnit: () => ['kg', jest.fn()] }));
jest.mock('@/lib/measurement-draft', () => ({ loadMeasurementDraft: () => Promise.resolve(null), saveMeasurementDraft: jest.fn(), clearMeasurementDraft: jest.fn() }));
jest.mock('@/lib/health/sync', () => ({ useHealthExport: () => ({ enqueue: jest.fn() }) }));
jest.mock('@/components/health/ExportOption', () => ({ ExportOption: () => null, useExportChoice: () => ({ on: false }) }));
jest.mock('@/lib/weight', () => ({
  getMyWeightHistory: () => Promise.resolve([mockReading]), getMyLatestWeight: () => Promise.resolve(mockReading),
  saveManualWeight: (...args: unknown[]) => mockSave(...args), deleteManualWeight: (...args: unknown[]) => mockDelete(...args),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
let root: ReturnType<typeof createRoot>;
afterEach(() => { act(() => root?.unmount()); jest.restoreAllMocks(); });
async function render() { root = createRoot(); await act(async () => root.render(<Weight />)); return root.container as any; }
const button = (c: any, label: string) => c.queryAll((n: any) => n.props.onClick && n.props.accessibilityLabel === label)[0];
const click = async (c: any, label: string) => act(async () => button(c, label).props.onClick());
const type = async (c: any, label: string, value: string) => act(async () => c.queryAll((n: any) => n.props.onChangeText && n.props.accessibilityLabel === label)[0].props.onChangeText(value));
beforeEach(() => { jest.clearAllMocks(); mockSave.mockResolvedValue('new-id'); });
test('typing, locale paste, editing units, saving and reopening a measurement', async () => {
  const c = await render(); await click(c, 'Add Weight'); await type(c, 'Weight (kg)', '75.');
  expect(button(c, 'Save Weight').props.accessibilityState.disabled).toBe(false);
  await click(c, 'Weight unit: kg · Change for this entry'); await click(c, 'lb');
  const field = c.queryAll((n: any) => n.props.onChangeText && n.props.accessibilityLabel === 'Weight (lb)')[0];
  expect(field.props.value).toBe('165.35');
  await click(c, 'kg');
  expect(c.queryAll((n: any) => n.props.onChangeText && n.props.accessibilityLabel === 'Weight (kg)')[0].props.value).toBe('75.');
  await click(c, 'Save Weight');
  expect(mockSave.mock.calls[0][1].kg).toBe(75);
  expect(JSON.stringify(c)).toContain('Weight Reading');
  await click(c, 'Edit'); await type(c, 'Weight (kg)', '74,5'); await click(c, 'Save Changes');
  expect(mockSave.mock.calls[1][1]).toMatchObject({ id: 'new-id', kg: 74.5 });
});
test('invalid pasted input is retained and cannot save as a different number', async () => {
  const c = await render(); await click(c, 'Add Weight'); await type(c, 'Weight (kg)', '7,5,0'); await click(c, 'Save Weight');
  expect(mockSave).not.toHaveBeenCalled(); expect(JSON.stringify(c)).toContain('7,5,0');
});
test('history opens detail; deletion is in overflow and requires confirmation', async () => {
  const c = await render();
  await click(c, c.queryAll((n: any) => n.props.onClick && n.props.accessibilityLabel?.startsWith('80.0 kg,'))[0].props.accessibilityLabel);
  await click(c, 'More actions for weight reading'); await click(c, 'Delete Reading');
  expect(mockDelete).not.toHaveBeenCalled(); expect(mockAlert.mock.calls[0][0]).toContain('80.0 kg');
  await act(async () => mockAlert.mock.calls[0][2].find((b: { text: string }) => b.text === 'Delete').onPress());
  expect(mockDelete).toHaveBeenCalledWith('me', 'w1');
});
test('Cancel offers Keep Editing, Save Draft and Discard Changes', async () => {
  const c = await render(); await click(c, 'Add Weight'); await type(c, 'Weight (kg)', '75'); await click(c, 'Cancel');
  expect(mockAlert.mock.calls[0][2].map((b: { text: string }) => b.text)).toEqual(['Keep Editing', 'Save Draft', 'Discard Changes']);
});

test('future measurement times show an error under When, not Weight', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  const c = await render(); await click(c, 'Add Weight'); await type(c, 'Weight (kg)', '75');
  await act(async () => c.queryAll((n: any) => n.type === 'input' && n.props['aria-label'] === 'When')[0].props.onChange({ target: { value: '2999-01-01T08:00' } }));
  await click(c, 'Save Weight'); expect(mockSave).not.toHaveBeenCalled();
  const parts = JSON.stringify(c).split('When'); expect(parts[0]).not.toContain('Choose a measurement time that has passed.'); expect(parts.at(-1)).toContain('Choose a measurement time that has passed.');
});
