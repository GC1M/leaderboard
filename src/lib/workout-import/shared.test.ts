import { importWorkouts, newExercises, previewImport, UNKNOWN_FILE } from '.';
import { parseCsv } from './csv';
import { importRouteFor } from './route';
import { num, parseDate } from './shared';
import { hideHealthDuplicates, type Workout } from '../workouts';

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, embedded newlines, CRLF, a BOM and blank lines', () => {
    expect(parseCsv('﻿a,b\r\n"x, ""y""","line\nbreak"\r\n\r\n1,\n')).toEqual([['a', 'b'], ['x, "y"', 'line\nbreak'], ['1', '']]);
  });
  it('picks semicolons when the header uses them', () => {
    expect(parseCsv('a;b\n1,5;2')).toEqual([['a', 'b'], ['1,5', '2']]);
  });
});

describe('num and parseDate', () => {
  it('reads numbers, decimal commas, empties; rejects the rest', () => {
    expect([num(''), num('5'), num('62,5'), num('1.25')]).toEqual([null, 5, 62.5, 1.25]);
    expect(num('-3')).toBeNaN();
    expect(num('abc')).toBeNaN();
  });
  it('reads the date formats the apps write', () => {
    expect(parseDate('2024-03-02 18:30:00')).toEqual(new Date(2024, 2, 2, 18, 30));
    expect(parseDate('2024-03-02T18:30')).toEqual(new Date(2024, 2, 2, 18, 30));
    expect(parseDate('2025-01-30 12:34:56\u202fpm')).toEqual(new Date(2025, 0, 30, 12, 34, 56));
    expect(parseDate('2025-01-30 12:05:00 AM')).toEqual(new Date(2025, 0, 30, 0, 5));
    expect(parseDate('2025-01-30 6:05:00 PM')).toEqual(new Date(2025, 0, 30, 18, 5));
    expect(parseDate('2024-03-02 18:30:00 +0000')).toEqual(new Date(Date.UTC(2024, 2, 2, 18, 30)));
    expect(parseDate('2024-03-02T18:30:00.000Z')).toEqual(new Date(Date.UTC(2024, 2, 2, 18, 30)));
    expect(parseDate('26 Oct 2024, 18:05')).toEqual(new Date(2024, 9, 26, 18, 5));
    expect(parseDate('2024-02-30 10:00')).toBeNull();
    expect(parseDate('yesterday')).toBeNull();
  });
});

describe('previewImport', () => {
  it('rejects files it does not know, and exports with no usable workouts', () => {
    expect(() => previewImport('name,value\na,1', { weight: 'kg', distance: 'km' })).toThrow(UNKNOWN_FILE);
    expect(() => previewImport('', { weight: 'kg', distance: 'km' })).toThrow(UNKNOWN_FILE);
    expect(() => previewImport('Date,Workout Name,Exercise Name,Set Order,Reps\nbad,X,Y,1,5', { weight: 'kg', distance: 'km' }))
      .toThrow('No workouts found in this Strong export.');
  });
});

const CSV = 'Date,Workout Name,Exercise Name,Set Order,Weight,Reps\n2024-03-02 18:30:00,Push,bench press,1,60,5\n2024-03-02 18:30:00,Push,Cable Fly,1,10,12';

describe('newExercises', () => {
  it('lists names with no case-insensitive match', () => {
    const p = previewImport(CSV, { weight: 'kg', distance: 'km' });
    expect(newExercises(p.workouts, ['Bench Press', 'Squat'])).toEqual(['Cable Fly']);
  });
});

describe('importWorkouts', () => {
  beforeEach(() => mockRpc.mockReset());
  it('sends canonical rows in batches of 50 and counts what was new', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => `2024-03-${String((i % 28) + 1).padStart(2, '0')} ${String(Math.floor(i / 28) + 6).padStart(2, '0')}:00:00,W${i},Squat,1,100,5`);
    const p = previewImport(['Date,Workout Name,Exercise Name,Set Order,Weight,Reps', ...rows].join('\n'), { weight: 'kg', distance: 'km' });
    mockRpc.mockResolvedValueOnce({ data: 50, error: null }).mockResolvedValueOnce({ data: 4, error: null });
    await expect(importWorkouts(p, 'Europe/Berlin')).resolves.toEqual({ added: 54, existing: 6 });
    expect(mockRpc).toHaveBeenCalledTimes(2);
    const [name, args] = mockRpc.mock.calls[0];
    expect(name).toBe('import_workouts');
    expect(args.p_app).toBe('strong');
    expect(args.p_workouts).toHaveLength(50);
    expect(args.p_workouts[0]).toMatchObject({
      source_key: p.workouts[0].key, activity_type: 'W0', timezone: 'Europe/Berlin', duration_s: null,
      exercises: [{ name: 'Squat', category: 'strength', notes: null, sets: [{ reps: 5, load_kg: 100, duration_s: null, distance_m: null }] }],
    });
    expect(mockRpc.mock.calls[1][1].p_workouts).toHaveLength(10);
  });
  it('says how far it got when a batch fails, and that a retry is safe', async () => {
    const p = previewImport(CSV, { weight: 'kg', distance: 'km' });
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
    await expect(importWorkouts(p, 'UTC')).rejects.toThrow("Couldn't import your workouts. Check your connection and try again; workouts already imported won't be added twice.");
  });
});

describe('share sheet route', () => {
  it('sends shared files to the import screen and leaves other links alone', () => {
    expect(importRouteFor('file:///private/var/Inbox/strong%20export.csv')).toBe('/workouts/import?file=file%3A%2F%2F%2Fprivate%2Fvar%2FInbox%2Fstrong%2520export.csv');
    expect(importRouteFor('leaderboard://join/ABC123')).toBeNull();
  });
});

describe('hideHealthDuplicates', () => {
  const base = { user_id: 'u', timezone: 'UTC', duration_s: null, distance_m: null, energy_kcal: null, notes: null, health_uuid: null, health_device_id: null, source_app: null, source_key: null, updated_at: '' };
  const w = (id: string, source: Workout['source'], start: string, end: string): Workout =>
    ({ ...base, id, source, activity_type: id, started_at: start, ended_at: end });
  it('drops a Health workout that overlaps an imported one, keeps the rest', () => {
    const rows = [
      w('strong', 'import', '2024-03-02T18:30:00+00:00', '2024-03-02T19:30:00+00:00'),
      w('health copy', 'healthkit', '2024-03-02T18:31:00.000Z', '2024-03-02T19:29:00.000Z'),
      w('health walk', 'healthkit', '2024-03-02T19:30:00Z', '2024-03-02T20:00:00Z'),
      w('manual', 'manual', '2024-03-02T18:30:00Z', '2024-03-02T19:00:00Z'),
    ];
    expect(hideHealthDuplicates(rows).map((r) => r.id)).toEqual(['strong', 'health walk', 'manual']);
  });
});
