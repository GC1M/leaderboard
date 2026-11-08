// End-to-end smoke test of the main flows over the real Supabase API (PostgREST + GoTrue + RLS + RPCs).
// Run against a local stack: `supabase start`, then `node scripts/smoke/api-smoke.mjs`.
// Test users are created and removed through the admin API; keys are never printed.
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { getLocalStack } from './local-stack.mjs';

const { url, anonKey, serviceKey } = getLocalStack();
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, serviceKey, opts);
const anon = createClient(url, anonKey, opts);

let passed = 0;
class SmokeFailure extends Error {}

function check(cond, msg) {
  if (!cond) throw new SmokeFailure(msg);
}
function eq(actual, expected, msg) {
  check(JSON.stringify(actual) === JSON.stringify(expected), `${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
// Unwrap a supabase-js result, failing with the step's message and the server's error.
function ok({ data, error }, msg) {
  check(!error, `${msg}: ${error?.code ?? ''} ${error?.message ?? ''}`.trim());
  return data;
}
function rejected({ data, error }, msg) {
  check(error, `${msg}: expected an error but the call succeeded (${JSON.stringify(data)?.slice(0, 200)})`);
  return error;
}
async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    console.error(`FAIL  ${name}\n      ${e instanceof SmokeFailure ? e.message : (e?.stack ?? e)}`);
    throw e;
  }
  passed += 1;
  console.log(`ok    ${name}`);
}

const run = randomUUID().slice(0, 8);
const password = `Smoke-${randomUUID()}`;
const created = [];

async function makeUser(label) {
  const email = `smoke-${label}-${run}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: `Smoke ${label}` } });
  check(!error, `create user ${label}: ${error?.message}`);
  created.push(data.user.id);
  const client = createClient(url, anonKey, opts);
  const { data: s, error: e2 } = await client.auth.signInWithPassword({ email, password });
  check(!e2 && s.session, `sign in ${label}: ${e2?.message}`);
  return { id: data.user.id, email, client };
}

const adminCount = async (table, userId) => {
  const { count, error } = await admin.from(table).select('*', { count: 'exact', head: true }).eq('user_id', userId);
  check(!error, `count ${table}: ${error?.message}`);
  return count;
};

async function main() {
  let a, b, bench, running, workoutId, templateId, group, copyId, competition, completed;
  const started = new Date(Date.now() - 2 * 3600e3);
  const ended = new Date(Date.now() - 3600e3);
  const workout = (extra = {}) => ({
    activity_type: 'Strength', started_at: started.toISOString(), ended_at: ended.toISOString(), timezone: 'UTC', duration_s: 3600, notes: 'smoke',
    exercises: [
      { exercise_id: bench, notes: null, sets: [{ reps: 5, load_kg: 100 }, { reps: 5, load_kg: 102.5 }] },
      { exercise_id: running, notes: 'easy', sets: [{ duration_s: 600, distance_m: 2000 }] },
    ],
    ...extra,
  });

  await step('sign up and sign in two users; each gets a profile', async () => {
    a = await makeUser('a');
    b = await makeUser('b');
    const p = ok(await a.client.from('profiles').select('id, display_name').eq('id', a.id).maybeSingle(), 'read own profile');
    check(p, 'user A has no profiles row (handle_new_user trigger did not run)');
    eq(p.display_name, 'Smoke a', 'profile display_name comes from user metadata');
    eq(ok(await a.client.from('profiles').select('id').eq('id', b.id), 'read B profile as A').length, 0, 'A sees B profile before sharing a group');
  });

  await step('starter exercise catalog is readable', async () => {
    const rows = ok(await a.client.from('exercises').select('id, name').in('name', ['Bench Press', 'Running']), 'read exercises');
    bench = rows.find((r) => r.name === 'Bench Press')?.id;
    running = rows.find((r) => r.name === 'Running')?.id;
    check(bench && running, 'starter exercises "Bench Press" and "Running" are missing');
  });

  await step('save_manual_workout stores a workout with exercises and sets; reading it back works', async () => {
    workoutId = ok(await a.client.rpc('save_manual_workout', { p_id: null, p_workout: workout() }), 'save_manual_workout');
    check(typeof workoutId === 'string', 'save_manual_workout did not return an id');
    // Same select the app uses (src/lib/workouts.ts getWorkout).
    const w = ok(await a.client.from('workouts')
      .select('*, workout_exercises(id, exercise_id, position, notes, exercises(name), workout_sets(*))').eq('id', workoutId).maybeSingle(), 'read workout back');
    check(w, 'saved workout not found when reading it back');
    eq([w.source, w.activity_type, w.user_id], ['manual', 'Strength', a.id], 'workout columns');
    const ex = [...w.workout_exercises].sort((x, y) => x.position - y.position);
    eq(ex.map((e) => e.exercises.name), ['Bench Press', 'Running'], 'exercise order and names');
    const sets = [...ex[0].workout_sets].sort((x, y) => x.position - y.position);
    eq(sets.map((s) => [s.reps, Number(s.load_kg)]), [[5, 100], [5, 102.5]], 'sets of first exercise');
    eq([Number(ex[1].workout_sets[0].duration_s), Number(ex[1].workout_sets[0].distance_m)], [600, 2000], 'cardio set');
    const list = ok(await a.client.from('workouts').select('id').eq('user_id', a.id), 'list own workouts');
    eq(list.map((r) => r.id), [workoutId], 'own workouts list');
  });

  await step('save_manual_workout validates input and update replaces children', async () => {
    rejected(await a.client.rpc('save_manual_workout', { p_id: null, p_workout: workout({ ended_at: new Date(started.getTime() - 1000).toISOString() }) }), 'workout ending before it starts');
    rejected(await a.client.rpc('save_manual_workout', { p_id: null, p_workout: workout({ exercises: [{ exercise_id: bench, sets: [{}] }] }) }), 'empty set');
    const id = ok(await a.client.rpc('save_manual_workout', { p_id: workoutId, p_workout: workout({ exercises: [{ exercise_id: bench, sets: [{ reps: 8 }] }] }) }), 'update workout');
    eq(id, workoutId, 'update keeps the id');
    const n = ok(await a.client.from('workout_exercises').select('id').eq('workout_id', workoutId), 'exercises after update');
    eq(n.length, 1, 'exercises after update replace the old ones');
    ok(await a.client.rpc('save_manual_workout', { p_id: workoutId, p_workout: workout() }), 'restore workout');
  });

  await step('another user cannot read, change or delete the workout', async () => {
    eq(ok(await b.client.from('workouts').select('id').eq('id', workoutId), 'B reads A workout').length, 0, 'B can read A workout');
    eq(ok(await b.client.from('workout_exercises').select('id').eq('workout_id', workoutId), 'B reads A exercises').length, 0, 'B can read A workout_exercises');
    eq(ok(await b.client.from('workout_sets').select('id'), 'B reads sets').length, 0, 'B can read workout_sets');
    rejected(await b.client.rpc('save_manual_workout', { p_id: workoutId, p_workout: workout() }), 'B updates A workout');
    ok(await b.client.from('workouts').delete().eq('id', workoutId), 'B deletes A workout (RLS filters it out)');
    eq(await adminCount('workouts', a.id), 1, "A workout count after B's delete attempt");
  });

  await step('save_workout_template, then applying it yields an independent workout', async () => {
    const tpl = { name: 'Push day', activity_type: 'Strength', duration_s: 3000, notes: null,
      exercises: [{ exercise_id: bench, notes: null, sets: [{ reps: 5, load_kg: 80 }, { reps: 5, load_kg: 80 }] }] };
    templateId = ok(await a.client.rpc('save_workout_template', { p_id: null, p_template: tpl }), 'save_workout_template');
    eq(ok(await b.client.from('workout_templates').select('id').eq('id', templateId), 'B reads A template').length, 0, 'B can read A template');
    // Apply = read the template the way the app does, then save a new manual workout from its values.
    const t = ok(await a.client.from('workout_templates')
      .select('*, workout_template_exercises(id, exercise_id, position, notes, workout_template_sets(*))').eq('id', templateId).maybeSingle(), 'read template back');
    check(t && t.workout_template_exercises.length === 1, 'template did not come back with its exercise');
    const applied = {
      activity_type: t.activity_type, started_at: started.toISOString(), ended_at: ended.toISOString(), timezone: 'UTC', duration_s: t.duration_s,
      exercises: t.workout_template_exercises.map((e) => ({
        exercise_id: e.exercise_id, notes: e.notes,
        sets: [...e.workout_template_sets].sort((x, y) => x.position - y.position).map((s) => ({ reps: s.reps, load_kg: s.load_kg, duration_s: s.duration_s, distance_m: s.distance_m })),
      })),
    };
    copyId = ok(await a.client.rpc('save_manual_workout', { p_id: null, p_workout: applied }), 'save workout from template');
    check(copyId !== workoutId, 'applied workout reused an existing id');
    // Change then delete the template: the workout made from it must not move.
    ok(await a.client.rpc('save_workout_template', { p_id: templateId, p_template: { ...tpl, name: 'Push day v2', exercises: [{ exercise_id: bench, sets: [{ reps: 1, load_kg: 200 }] }] } }), 'update template');
    ok(await a.client.from('workout_templates').delete().eq('id', templateId), 'delete template');
    eq(await adminCount('workout_templates', a.id), 0, 'templates left after delete');
    const w = ok(await a.client.from('workouts').select('duration_s, workout_exercises(workout_sets(reps, load_kg))').eq('id', copyId).maybeSingle(), 'read applied workout');
    check(w, 'workout made from a template vanished when the template was deleted');
    eq(w.workout_exercises[0].workout_sets.map((s) => [s.reps, Number(s.load_kg)]), [[5, 80], [5, 80]], 'applied workout sets after template edit and delete');
    templateId = ok(await a.client.rpc('save_workout_template', { p_id: null, p_template: tpl }), 're-save template (kept for the account deletion check)');
  });

  await step('group create, join by invite code, membership and leaderboard', async () => {
    rejected(await b.client.rpc('group_workouts', { p_group_id: randomUUID(), p_from: '2020-01-01', p_to: '2099-01-01' }), 'group_workouts on a group B is not in');
    group = ok(await a.client.rpc('create_group', { name: `Smoke ${run}` }), 'create_group');
    check(group?.id && group.invite_code, 'create_group did not return id and invite_code');
    eq(ok(await b.client.from('groups').select('id').eq('id', group.id), 'B reads group before joining').length, 0, 'B can see a group before joining');
    rejected(await b.client.rpc('join_group', { code: 'NOTACODE' }), 'join_group with a bad code');
    eq(ok(await b.client.rpc('join_group', { code: group.invite_code.toLowerCase() }), 'join_group'), group.id, 'join_group returns the group id');
    const members = ok(await a.client.from('group_members').select('user_id, role').eq('group_id', group.id), 'list members');
    eq(members.map((m) => `${m.role}:${m.user_id}`).sort(), [`member:${b.id}`, `owner:${a.id}`].sort(), 'members and roles');
    const lb = ok(await b.client.rpc('group_leaderboard', { p_group_id: group.id, p_metric: 'steps', p_period: 'week' }), 'group_leaderboard');
    eq(lb.map((r) => r.user_id).sort(), [a.id, b.id].sort(), 'leaderboard lists both members');
  });

  await step('workout sharing is off by default, shares only count and duration, and revoke hides it', async () => {
    const week = (d) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7) - 7); return x.toISOString().slice(0, 10); };
    const range = { p_group_id: group.id, p_from: week(Date.now()), p_to: new Date(Date.now() + 86400e3).toISOString().slice(0, 10) };
    const shares = ok(await a.client.from('metric_shares').select('metric').eq('group_id', group.id).eq('user_id', a.id), 'read own shares');
    check(!shares.some((s) => s.metric === 'workouts'), 'workouts are shared by default; they must be opt-in');
    eq(ok(await b.client.rpc('group_workouts', range), 'group_workouts before sharing'), [], 'group_workouts before A shares');

    ok(await a.client.from('metric_shares').upsert({ group_id: group.id, user_id: a.id, metric: 'workouts' }, { ignoreDuplicates: true }), 'share workouts');
    const rows = ok(await b.client.rpc('group_workouts', range), 'group_workouts after sharing');
    // A has two workouts started in the window: the original (3600 s) and the one applied from the template (3000 s).
    eq(rows.length, 1, 'group_workouts rows after sharing');
    eq(Object.keys(rows[0]).sort(), ['total_duration_s', 'user_id', 'week_start', 'workout_count'], 'group_workouts only exposes count and duration');
    eq([rows[0].user_id, rows[0].workout_count, Number(rows[0].total_duration_s)], [a.id, 2, 6600], 'group_workouts values');
    // Peers still cannot read the underlying rows through any other path.
    eq(ok(await b.client.from('workouts').select('id'), 'B reads workouts after A shares').length, 0, 'B can read workouts rows after A shares');

    ok(await a.client.from('metric_shares').delete().match({ group_id: group.id, user_id: a.id, metric: 'workouts' }), 'revoke workouts share');
    eq(ok(await b.client.rpc('group_workouts', range), 'group_workouts after revoke'), [], 'group_workouts after A revokes');
  });

  await step('food: log, daily totals, share to the group, a member reads it, revoke hides it', async () => {
    const day = new Date().toISOString().slice(0, 10);
    const range = { p_group_id: group.id, p_from: day, p_to: day };
    const logged = ok(await a.client.from('food_entries').insert({
      user_id: a.id, client_id: randomUUID(), meal: 'lunch', consumed_at: new Date().toISOString(), timezone: 'UTC', grams: 200, food_name: 'Smoke Rice', provider: 'custom',
      energy_kcal: 260, protein_g: 5.4, fat_g: 0.6,
    }).select('id, local_date').single(), 'log a food entry');
    eq(logged.local_date, day, 'the server sets local_date from consumed_at and timezone');
    // Carbs were not entered: the total is unknown (null), flagged incomplete, never 0.
    const totals = ok(await a.client.rpc('food_daily_totals', { p_from: day, p_to: day }), 'food_daily_totals');
    eq(totals.map((t) => [t.entries, Number(t.energy_kcal), t.carbs_g, t.carbs_g_incomplete]), [[1, 260, null, true]], 'own daily totals');
    eq(ok(await b.client.rpc('group_food', range), 'group_food before sharing'), [], 'group_food before A shares');

    ok(await a.client.from('metric_shares').upsert({ group_id: group.id, user_id: a.id, metric: 'food' }, { ignoreDuplicates: true }), 'share food');
    const rows = ok(await b.client.rpc('group_food', range), 'group_food after sharing');
    eq(rows.map((r) => [r.user_id, r.local_date, Number(r.energy_kcal), r.carbs_g]), [[a.id, day, 260, null]], 'the member reads the daily total');
    check(!Object.keys(rows[0]).some((k) => /name|grams|meal|client_id/.test(k)), 'group_food exposes only daily totals');
    eq(ok(await b.client.from('food_entries').select('id'), 'B reads food entries').length, 0, 'B can read A food entries');

    ok(await a.client.from('metric_shares').delete().match({ group_id: group.id, user_id: a.id, metric: 'food' }), 'revoke food share');
    eq(ok(await b.client.rpc('group_food', range), 'group_food after revoke'), [], 'group_food after A revokes');
    eq(await adminCount('food_entries', a.id), 1, 'revoking does not delete the entries');
    ok(await a.client.rpc('delete_my_food_history'), 'delete_my_food_history');
    eq(await adminCount('food_entries', a.id), 0, 'entries left after delete_my_food_history');
  });

  const day = (offset) => new Date(Date.now() + offset * 86400e3).toISOString().slice(0, 10);
  await step('competition creation, invite preview and group membership never auto-enroll', async () => {
    for (const u of [a, b]) ok(await u.client.from('profiles').update({ timezone: 'UTC' }).eq('id', u.id), 'set competition timezone');
    competition = ok(await a.client.rpc('create_competition', { p_group_id: group.id, p_name: 'Smoke challenge', p_metric: 'steps', p_start_day: day(2), p_end_day: day(4), p_timezone: 'UTC' }), 'create competition');
    eq(ok(await a.client.from('competition_participants').select('user_id').eq('competition_id', competition), 'participants before consent'), [], 'creator and group members are not enrolled');
    const preview = ok(await b.client.rpc('competition_invite', { p_id: competition, p_code: group.invite_code }), 'preview invite');
    eq(preview.id, competition, 'invite points at competition');
    ok(await b.client.rpc('join_competition', { p_id: competition }), 'explicit opt-in');
    ok(await b.client.rpc('leave_competition', { p_id: competition }), 'leave before start');
    eq(ok(await b.client.from('competition_participants').select('status').eq('competition_id', competition).single(), 'left participation').status, 'left', 'historical participation is preserved');
    rejected(await b.client.rpc('moderate_competition', { p_id: competition, p_action: 'cancel', p_reason: 'Unauthorized' }), 'member moderation');
    ok(await a.client.rpc('moderate_competition', { p_id: competition, p_action: 'cancel', p_reason: 'Smoke test complete' }), 'cancel with reason');
    rejected(await b.client.rpc('join_competition', { p_id: competition }), 'join cancelled competition');
  });

  await step('server scores distinguish zero, excluded manual entries and source corrections', async () => {
    // Admin-only historical fixture: production clients cannot create backdated competitions or enroll late.
    completed = randomUUID();
    ok(await admin.from('competitions').insert({ id: completed, group_id: group.id, creator_id: a.id, name: 'Completed smoke', metric: 'steps', starts_at: `${day(-5)}T00:00:00Z`, ends_at: `${day(-2)}T00:00:00Z`, timezone: 'UTC' }), 'seed historical competition');
    ok(await admin.from('competition_participants').insert([a, b].map((u) => ({ competition_id: completed, user_id: u.id }))), 'seed prior opt-ins');
    ok(await admin.from('daily_metrics').insert([
      { user_id: a.id, date: day(-4), metric: 'steps', value: 100, source: 'healthkit' },
      { user_id: a.id, date: day(-3), metric: 'steps', value: 999, source: 'manual' },
      { user_id: b.id, date: day(-4), metric: 'steps', value: 0, source: 'healthkit' },
    ]), 'seed source readings');
    let scores = ok(await b.client.rpc('competition_standings', { p_id: completed }), 'read provisional scores');
    eq(scores.map((r) => Number(r.score)), [100, 0], 'excluded manual reading does not inflate score; recorded zero is ranked');
    const mine = ok(await a.client.rpc('my_competition_contributions', { p_id: completed }), 'own source explanations');
    check(mine.some((r) => r.reason === 'manual_entries_excluded' && !r.included), 'manual exclusion explanation missing');
    check(ok(await b.client.rpc('my_competition_contributions', { p_id: completed }), 'B own records').every((r) => Number(r.value) === 0), 'own-record RPC leaked A readings');
    ok(await admin.from('daily_metrics').update({ value: 150 }).match({ user_id: a.id, date: day(-4), metric: 'steps' }), 'correct source');
    scores = ok(await a.client.rpc('competition_standings', { p_id: completed }), 'read corrected score');
    eq(Number(scores.find((r) => r.user_id === a.id).score), 150, 'pre-finalization corrections recompute');
    rejected(await b.client.from('competition_results').insert({ competition_id: completed, user_id: b.id, score: 999999 }), 'client cannot write a score');
  });

  await step('concurrent standings and finalization produce one immutable snapshot', async () => {
    const results = await Promise.all([
      a.client.rpc('finalize_competition', { p_id: completed }),
      b.client.rpc('finalize_competition', { p_id: completed }),
      b.client.rpc('competition_standings', { p_id: completed }),
    ]);
    results.forEach((r) => ok(r, 'concurrent scoring request'));
    eq(ok(await admin.from('competition_results').select('user_id').eq('competition_id', completed), 'snapshot rows').length, 2, 'one snapshot row per participant');
    eq(ok(await a.client.from('competition_audit').select('id').eq('competition_id', completed).eq('event', 'finalized'), 'finalization events').length, 1, 'one finalization audit event');
    ok(await admin.from('daily_metrics').delete().match({ user_id: a.id, date: day(-4), metric: 'steps' }), 'delete source after snapshot');
    eq(Number(ok(await b.client.rpc('competition_standings', { p_id: completed }), 'frozen scores').find((r) => r.user_id === a.id).score), 150, 'post-finalization deletion leaves snapshot unchanged');
    ok(await a.client.from('metric_shares').delete().match({ group_id: group.id, user_id: a.id, metric: 'steps' }), 'revoke step sharing');
    const hidden = ok(await b.client.rpc('competition_standings', { p_id: completed }), 'privacy after finalization');
    const row = hidden.find((r) => r.user_id === a.id);
    eq([row.score, row.rank, row.updated_at, row.health_entries, row.manual_entries, row.excluded_entries], [null, null, null, 0, 0, 0], 'revocation masks score, rank, freshness and sources');
    eq(Number(hidden.find((r) => r.user_id === b.id).rank), 1, 'visible ranks recompute');
    const outsider = await makeUser('outsider');
    rejected(await outsider.client.rpc('competition_standings', { p_id: completed }), 'outsider standings');
    rejected(await anon.rpc('competition_standings', { p_id: completed }), 'signed-out standings');
    eq(ok(await outsider.client.from('competition_audit').select('id').eq('competition_id', completed), 'outsider audit'), [], 'outsider cannot read activity');
  });

  await step('anonymous (signed-out) clients cannot read or write workout data', async () => {
    for (const table of ['workouts', 'workout_exercises', 'workout_sets', 'exercises', 'workout_templates', 'workout_template_exercises', 'workout_template_sets', 'metric_shares', 'profiles', 'groups']) {
      const { data, error } = await anon.from(table).select('*').limit(1);
      check(error || (data ?? []).length === 0, `anon read ${table} returned data`);
    }
    rejected(await anon.rpc('save_manual_workout', { p_id: null, p_workout: workout() }), 'anon save_manual_workout');
    rejected(await anon.rpc('save_workout_template', { p_id: null, p_template: { name: 'x', activity_type: 'x' } }), 'anon save_workout_template');
    rejected(await anon.rpc('group_workouts', { p_group_id: group.id, p_from: '2020-01-01', p_to: '2099-01-01' }), 'anon group_workouts');
    rejected(await anon.rpc('delete_my_account'), 'anon delete_my_account');
  });

  await step('delete_my_account removes the user, their workouts and templates; others are untouched', async () => {
    ok(await a.client.rpc('save_manual_workout', { p_id: null, p_workout: workout() }), 'extra workout before deleting');
    check((await adminCount('workouts', a.id)) >= 2 && (await adminCount('workout_templates', a.id)) === 1, 'precondition: A has workouts and a template');
    ok(await a.client.rpc('delete_my_account'), 'delete_my_account');
    eq(await adminCount('workouts', a.id), 0, 'workouts left after delete_my_account');
    eq(await adminCount('workout_templates', a.id), 0, 'templates left after delete_my_account');
    const { data } = await admin.auth.admin.getUserById(a.id);
    check(!data?.user, 'auth user still exists after delete_my_account');
    eq(ok(await admin.from('profiles').select('id').eq('id', a.id), 'profile after delete').length, 0, 'profile rows left after delete_my_account');
    check(ok(await admin.from('profiles').select('id').eq('id', b.id).maybeSingle(), 'B profile'), 'deleting A also removed B');
    // A owned the group; it goes with them.
    eq(ok(await admin.from('groups').select('id').eq('id', group.id), 'group after owner deletion').length, 0, 'group left after owner deleted account');
    for (const table of ['competitions', 'competition_results', 'competition_audit', 'competition_participants']) {
      const field = table === 'competitions' ? 'id' : 'competition_id';
      eq(ok(await admin.from(table).select(field).in(field, [completed, competition]), `${table} after account deletion`), [], `${table} cascades with the deleted group`);
    }
  });

  console.log(`\n${passed} steps passed`);
}

let failed = false;
try {
  await main();
} catch (e) {
  failed = true;
  if (!(e instanceof SmokeFailure)) console.error(e);
} finally {
  // Best effort; deleting an auth user cascades through everything else.
  for (const id of created) await admin.auth.admin.deleteUser(id).catch(() => {});
}
process.exit(failed ? 1 : 0);
