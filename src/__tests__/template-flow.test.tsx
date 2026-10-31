import { act } from 'react';
import { createRoot } from 'test-renderer';
import { TemplateEditor } from '@/components/workouts/TemplateEditor';
import { ExercisePicker } from '@/components/workouts/ExercisePicker';
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockClear = jest.fn();
const mockDraft = jest.fn();
const mockAlert = jest.fn();
const mockPush = jest.fn();
const mockDismiss = jest.fn();
let mockGuard: { enabled: boolean; callback: (x: { repeat: () => void }) => void };
const mockBack = jest.fn(() => { if (mockGuard.enabled) mockGuard.callback({ repeat: jest.fn() }); });
const mockTemplate = { id: 'original', user_id: 'me', name: 'Push day', activity_type: 'Traditional Strength Training', duration_s: 1800, notes: '', updated_at: '', exercises: [{ id: 'ex1', exerciseId: 'bench', name: 'Bench Press', notes: '', sets: [{ id: 's1', template_exercise_id: 'ex1', position: 0, reps: 8, load_kg: 40, duration_s: null, distance_m: null }] }] };
const mockExercises = [{ id: 'bench', name: 'Bench Press', category: 'strength', isCustom: false }, { id: 'run', name: 'Running', category: 'cardio', isCustom: false }];
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, dismissTo: mockDismiss, canGoBack: () => true, back: mockBack }),
  useSegments: () => [],
  useFocusEffect: (fn: () => void) => { jest.requireActual('react').useEffect(fn, [fn]); },
  usePreventRemove: (enabled: boolean, callback: typeof mockGuard.callback) => { mockGuard = { enabled, callback }; return () => { mockGuard.enabled = false; }; },
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'me' } } }) }));
jest.mock('@/lib/alert', () => ({ alert: (...args: unknown[]) => mockAlert(...args) }));
jest.mock('@/lib/weight-unit', () => ({ loadWeightUnit: () => Promise.resolve('kg') }));
jest.mock('@/lib/distance-unit', () => ({ loadDistanceUnit: () => Promise.resolve('km') }));
jest.mock('@/lib/workout-template-draft', () => ({ loadTemplateDraft: () => Promise.resolve(null), clearTemplateDraft: (...args: unknown[]) => mockClear(...args), saveTemplateDraft: (...args: unknown[]) => mockDraft(...args) }));
jest.mock('@/lib/workout-templates', () => ({ getTemplate: () => Promise.resolve(mockTemplate), createTemplate: (...args: unknown[]) => mockCreate(...args), updateTemplate: (...args: unknown[]) => mockUpdate(...args) }));
jest.mock('@/lib/workouts', () => ({ listExercises: () => Promise.resolve(mockExercises) }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
let root: ReturnType<typeof createRoot>;
async function render(el: React.ReactElement) { root = createRoot(); await act(async () => root.render(el)); return root.container as any; }
const click = async (c: any, label: string) => act(async () => c.queryAll((n: any) => n.props.onClick && n.props.accessibilityLabel === label)[0].props.onClick());
beforeEach(() => { jest.clearAllMocks(); mockCreate.mockResolvedValue('copy-id'); });
afterEach(() => act(() => root?.unmount()));
test('duplicate remains unsaved until explicit Save Template and returns through the list', async () => {
  const c = await render(<TemplateEditor duplicateId="original" />);
  expect(JSON.stringify(c)).toContain('Push day (copy)'); expect(JSON.stringify(c)).not.toContain('Start Workout');
  expect(mockCreate).not.toHaveBeenCalled(); await click(c, 'Save Template');
  expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'Push day (copy)', exercises: [expect.objectContaining({ exerciseId: 'bench' })] }));
  expect(mockClear).toHaveBeenCalledWith('me', null); expect(mockDismiss).toHaveBeenCalledWith('/workouts/templates'); expect(mockPush).toHaveBeenCalledWith('/workouts/templates/copy-id');
});
test('cancelling and discarding a duplicate creates no saved template', async () => {
  const c = await render(<TemplateEditor duplicateId="original" />); await click(c, 'Cancel');
  const buttons = mockAlert.mock.calls[0][2]; expect(buttons.map((b: { text: string }) => b.text)).toEqual(['Keep Editing', 'Save Draft', 'Discard Changes']);
  await act(async () => buttons.find((b: { text: string }) => b.text === 'Discard Changes').onPress());
  expect(mockCreate).not.toHaveBeenCalled(); expect(mockClear).toHaveBeenCalledWith('me', null);
});
test('category changes retain existing exercises and their measurements', async () => {
  const c = await render(<TemplateEditor id="original" />); await click(c, 'Cardio');
  expect(JSON.stringify(c)).toContain('Bench Press'); await click(c, 'Save Template');
  expect(mockUpdate).toHaveBeenCalledWith('original', expect.objectContaining({ activityType: 'Running', exercises: [expect.objectContaining({ sets: [expect.objectContaining({ reps: 8, loadKg: 40 })] })] }));
});
test('exercise search defaults to the selected category, Show All allows a mixed workout', async () => {
  const pick = jest.fn(); const c = await render(<ExercisePicker initialCategory="cardio" onPick={pick} onCancel={jest.fn()} />);
  expect(JSON.stringify(c)).toContain('Running'); expect(JSON.stringify(c)).not.toContain('Bench Press');
  await click(c, 'Show All'); expect(JSON.stringify(c)).toContain('Bench Press');
});
