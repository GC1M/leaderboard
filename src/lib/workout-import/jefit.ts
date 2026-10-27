import { parseCsv } from './csv';
import { headerIndex, type ImportFormat, kg, parseDate, type ReadResult, type SetRow } from './shared';

// JEFIT: Settings > Data Controls > Export Data. Not one table but sections, each opened by a line like
// "### EXERCISE LOGS ##########" and closed by a line of #. Layout per the notes in NicolaiGoon/n-gym
// (docs/jefit-export-format.md, from a real October 2026 export):
//   SETTING           mass is " kg" or " lb", the unit of every weight in the file
//   WORKOUT SESSIONS  _id, starttime, endtime (unix seconds)
//   EXERCISE LOGS     belongsession (session _id), eid, belongSys, ename, mydate, logs ("40x8,40x8,40x5,")
// An exercise is (eid, belongSys); JEFIT renamed exercises over the years, so the most recent non-empty name wins.
// JEFIT saves a new log row every time a set is added, each holding all sets so far: a row that extends an earlier
// row for the same exercise in the same session replaces it. Weight 0 is bodyweight. "0x0" entries are cardio
// placeholders (cardio lives in CARDIO LOGS, which has no sets) and are not imported.

type Section = { line: number; rows: string[][] };

function sections(text: string): Map<string, Section> {
  const out = new Map<string, Section>();
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  let name: string | null = null, start = 0;
  const close = (end: number) => {
    if (name !== null) out.set(name, { line: start + 1, rows: parseCsv(lines.slice(start + 1, end).join('\n')) });
    name = null;
  };
  lines.forEach((l, i) => {
    const open = l.match(/^#{3}\s*([A-Za-z][A-Za-z ]*?)\s*#*\s*$/);
    if (open) { close(i); name = open[1].toUpperCase(); start = i; }
    else if (/^#+\s*$/.test(l)) close(i);
  });
  close(lines.length);
  return out;
}

// Rows of a section as header-indexed records; a block's repeated header row isn't a record.
function table(s: Section | undefined) {
  const [head = [], ...rest] = s?.rows ?? [];
  const h = headerIndex(head);
  const same = (r: string[]) => r.length === head.length && r.every((v, i) => v.trim() === head[i].trim());
  return { h, records: rest.map((r, i) => ({ r, line: (s?.line ?? 0) + i + 2 })).filter(({ r }) => !same(r)) };
}

const massUnit = (text: string) => {
  const { h, records } = table(sections(text).get('SETTING'));
  const m = records[0] ? h.get(records[0].r, 'mass').toLowerCase() : '';
  return m === 'kg' || m === 'lb' || m === 'lbs' ? m : '';
};

export const jefit: ImportFormat = {
  app: 'jefit',
  label: 'JEFIT',
  detect: (text) => /^#{3}\s*EXERCISE LOGS/im.test(text),
  statesUnits: (text) => massUnit(text) !== '',
  read(text, units): ReadResult {
    const all = sections(text);
    const unit = massUnit(text);
    const out: ReadResult = { rows: [], skipped: [] };

    const sessions = new Map<string, { start: Date; end: Date }>();
    const s = table(all.get('WORKOUT SESSIONS'));
    for (const { r } of s.records) {
      const start = Number(s.h.get(r, 'starttime')), end = Number(s.h.get(r, 'endtime'));
      if (start > 0) sessions.set(s.h.get(r, '_id'), { start: new Date(start * 1000), end: new Date(Math.max(start, end) * 1000) });
    }

    const logs = table(all.get('EXERCISE LOGS'));
    const id = (r: string[]) => `${logs.h.get(r, 'eid')}:${logs.h.get(r, 'belongsys')}`;
    const names = new Map<string, { name: string; date: string }>();
    for (const { r } of logs.records) {
      const name = logs.h.get(r, 'ename'), date = logs.h.get(r, 'mydate'), prev = names.get(id(r));
      if (name && (!prev || date >= prev.date)) names.set(id(r), { name, date });
    }

    // One entry per exercise instance in a session, in file order, after collapsing the cumulative rows.
    type Entry = { line: number; session: string; start: Date; end: Date | null; exercise: string; logs: string };
    const entries: Entry[] = [];
    const latest = new Map<string, Entry>();
    for (const { r, line } of logs.records) {
      const session = logs.h.get(r, 'belongsession');
      const known = sessions.get(session);
      const start = known?.start ?? parseDate(logs.h.get(r, 'mydate'));
      if (!start) { out.skipped.push({ row: line, reason: 'a date that could not be read' }); continue; }
      const exercise = names.get(id(r))?.name ?? '';
      if (!exercise) { out.skipped.push({ row: line, reason: 'no exercise name' }); continue; }
      const list = logs.h.get(r, 'logs').replace(/,+$/, '');
      const k = `${session}|${start.toISOString()}|${id(r)}`;
      const prev = latest.get(k);
      if (prev && list.startsWith(prev.logs)) { prev.logs = list; prev.line = line; continue; }
      const e = { line, session, start, end: known?.end ?? null, exercise, logs: list };
      entries.push(e);
      latest.set(k, e);
    }

    for (const e of entries) {
      const sets = e.logs.split(',').map((p) => p.trim().match(/^(\d+(?:\.\d+)?)x(\d+)$/)).filter((m) => m !== null)
        .map((m) => ({ load: Number(m[1]), reps: Number(m[2]) })).filter((p) => p.reps > 0);
      if (!sets.length) { out.skipped.push({ row: e.line, reason: 'no sets with reps' }); continue; }
      for (const p of sets) {
        const row: SetRow = {
          row: e.line,
          workout: { name: 'JEFIT Workout', startedAt: e.start, endedAt: e.end, durationS: e.end ? (e.end.getTime() - e.start.getTime()) / 1000 : null },
          exercise: e.exercise,
          set: { reps: p.reps, loadKg: kg(p.load === 0 ? null : p.load, unit, units.weight), durationS: null, distanceM: null },
        };
        out.rows.push(row);
      }
    }
    return out;
  },
};
