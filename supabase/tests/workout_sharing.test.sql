begin;
select plan(54);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a7', 'alice@x.com', '{"full_name":"Alice"}'),
  ('00000000-0000-0000-0000-0000000000b7', 'bob@x.com', '{"full_name":"Bob"}'),
  ('00000000-0000-0000-0000-0000000000c7', 'carol@x.com', '{"full_name":"Carol"}'),
  ('00000000-0000-0000-0000-0000000000d7', 'dave@x.com', '{"full_name":"Dave"}');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, true), set_config('role', 'authenticated', true);
$$;

-- G1: bob (owner) + alice. G2: carol (owner) + alice + bob. Dave is in neither. All profiles are UTC.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b7');
create temp table g1 as select id, invite_code from create_group('G1');
grant select on g1 to authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c7');
create temp table g2 as select id, invite_code from create_group('G2');
grant select on g2 to authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b7');
select join_group((select invite_code from g2));
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a7');
select join_group((select invite_code from g1));
select join_group((select invite_code from g2));

-- Alice's data, on fixed UTC days so the week buckets don't depend on the hour the test runs. Note: this file
-- never runs `set constraints all immediate` until the account deletion check at the end, and restores it there.
--   this week: a manual workout (1h, with an exercise, sets and notes) and an imported one (30m, 5 km, 300 kcal)
--   last week: a manual workout with no duration_s (40m between start and end)
create temp table day0 as select date_trunc('day', now() at time zone 'UTC') as d;
grant select on day0 to authenticated;
insert into exercises (user_id, name, category) values (auth.uid(), 'Secret Lift', 'strength');
select save_manual_workout(null, jsonb_build_object('activity_type', 'Secret Strength',
  'started_at', (select (d + interval '1 hour') at time zone 'UTC' from day0),
  'ended_at', (select (d + interval '2 hours') at time zone 'UTC' from day0),
  'timezone', 'UTC', 'duration_s', 3600, 'notes', 'private note',
  'exercises', jsonb_build_array(jsonb_build_object('exercise_id', (select id from exercises where name = 'Secret Lift'),
    'notes', 'private exercise note', 'sets', jsonb_build_array(jsonb_build_object('reps', 5, 'load_kg', 140))))));
reset role; -- Health rows arrive through the import RPCs, so seed them as the database owner
insert into workouts (user_id, source, activity_type, started_at, ended_at, timezone, duration_s, distance_m, energy_kcal, health_uuid, health_device_id)
  values (auth.uid(), 'healthkit', 'Running', (select (d + interval '3 hours') at time zone 'UTC' from day0),
    (select (d + interval '3 hours 30 minutes') at time zone 'UTC' from day0), 'UTC', 1800, 5000, 300,
    '00000000-0000-0000-0000-00000000f007', '00000000-0000-0000-0000-00000000d007');
set local role authenticated;
insert into workouts (user_id, source, activity_type, started_at, ended_at, timezone)
  values (auth.uid(), 'manual', 'Yoga', (select (d - interval '7 days' + interval '9 hours') at time zone 'UTC' from day0),
    (select (d - interval '7 days' + interval '9 hours 40 minutes') at time zone 'UTC' from day0), 'UTC');
-- Steps, sleep and weight, to show they keep working next to workouts.
reset role; -- Health rows arrive through the import RPCs, so seed them as the database owner
insert into daily_metrics (user_id, date, metric, value, source) values (auth.uid(), current_date, 'steps', 9000, 'healthkit');
set local role authenticated;
reset role; -- Health rows arrive through the import RPCs, so seed them as the database owner
insert into daily_metrics (user_id, date, metric, value, source, window_start, window_end)
  values (auth.uid(), current_date, 'sleep_min', 420, 'healthkit', now() - interval '8 hours', now() - interval '1 hour');
set local role authenticated;
reset role; -- Health rows arrive through the import RPCs, so seed them as the database owner
insert into weight_measurements (user_id, measured_at, kg, source) values (auth.uid(), now() - interval '1 day', 80, 'healthkit');
set local role authenticated;

-- The server returns these columns and no others.
select is((select proargnames from pg_proc where oid = 'public.group_workouts(uuid,date,date)'::regprocedure),
  array['p_group_id', 'p_from', 'p_to', 'user_id', 'week_start', 'workout_count', 'total_duration_s'],
  'group_workouts returns only member, week, count and total duration');

-- defaults: joining shares steps only
select is((select count(*)::int from metric_shares where user_id = auth.uid() and metric = 'workouts'), 0, 'workouts are not shared by default');
select throws_ok($$insert into metric_shares (group_id, user_id, metric) values ((select id from g1), auth.uid(), 'heart_rate')$$,
  '23514', null, 'unknown metric still rejected');

-- bob (in G1 and G2) gets nothing before alice opts in
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b7');
select is((select count(*)::int from group_workouts((select id from g1), (select (d - interval '14 days')::date from day0), (select (d + interval '1 day')::date from day0))), 0,
  'nothing is returned before the member opts in');

-- alice opts into workouts, sleep and weight for G1 only
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a7');
select lives_ok($$insert into metric_shares (group_id, user_id, metric) values ((select id from g1), auth.uid(), 'workouts')$$,
  'member opts into workouts for one group');
select lives_ok($$insert into metric_shares (group_id, user_id, metric) values
  ((select id from g1), auth.uid(), 'sleep'), ((select id from g1), auth.uid(), 'weight')$$, 'sleep and weight opt in as before');

-- bob, G1: the weekly summary and nothing else
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b7');
select results_eq($$select user_id, week_start, workout_count, total_duration_s
  from group_workouts((select id from g1), (select (d - interval '14 days')::date from day0), (select (d + interval '1 day')::date from day0))$$,
  $$values ('00000000-0000-0000-0000-0000000000a7'::uuid, (select (date_trunc('week', d) - interval '7 days')::date from day0), 1, 2400::numeric),
    ('00000000-0000-0000-0000-0000000000a7'::uuid, (select date_trunc('week', d)::date from day0), 2, 5400::numeric)$$,
  'G1 mate gets weekly count and total time, imported and manual together, end minus start when duration is unset');
select is((select count(*)::int from group_workouts((select id from g1), (select (d - interval '14 days')::date from day0), (select (d - interval '1 day')::date from day0))), 1,
  'the date range bounds the weeks returned (last week only)');
select is((select count(*)::int from group_workouts((select id from g2), (select (d - interval '14 days')::date from day0), (select (d + interval '1 day')::date from day0))), 0,
  'the same mate gets nothing through G2, where workouts are not shared');

-- direct access by a group-mate who is given the summary
select is((select count(*)::int from workouts), 0, 'a group-mate cannot read workout rows, even when shared');
select is((select count(*)::int from workout_exercises) + (select count(*)::int from workout_sets), 0, 'a group-mate cannot read exercises or sets');
select is((select count(*)::int from exercises where name = 'Secret Lift'), 0, 'a group-mate cannot see a custom exercise');
select throws_ok($$insert into metric_shares (group_id, user_id, metric) values ((select id from g1), '00000000-0000-0000-0000-0000000000a7', 'workouts')$$,
  '42501', null, 'owner cannot share for a member');
delete from workouts where user_id = '00000000-0000-0000-0000-0000000000a7';
update workouts set notes = 'x' where user_id = '00000000-0000-0000-0000-0000000000a7';
delete from metric_shares where user_id = '00000000-0000-0000-0000-0000000000a7' and metric = 'workouts';
reset role;
select is((select count(*)::int from workouts where user_id = '00000000-0000-0000-0000-0000000000a7'), 3, 'a group-mate cannot delete workouts');
select is((select notes from workouts where activity_type = 'Secret Strength'), 'private note', 'a group-mate cannot edit workouts');
select is((select count(*)::int from metric_shares where user_id = '00000000-0000-0000-0000-0000000000a7' and group_id = (select id from g1) and metric = 'workouts'), 1,
  'owner cannot revoke a member''s workout share');

-- steps, sleep and weight sharing still work next to it
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b7');
select results_eq($$select user_id, steps from group_steps((select id from g1), current_date - 7, current_date)$$,
  $$values ('00000000-0000-0000-0000-0000000000a7'::uuid, 9000::numeric)$$, 'shared steps still come through the group');
select results_eq($$select user_id, minutes from group_sleep((select id from g1), current_date - 7, current_date)$$,
  $$values ('00000000-0000-0000-0000-0000000000a7'::uuid, 420::numeric)$$, 'shared sleep still comes through the group');
select results_eq($$select user_id, kg from group_latest_weight((select id from g1))$$,
  $$values ('00000000-0000-0000-0000-0000000000a7'::uuid, 80::numeric)$$, 'shared weight still comes through the group');
select results_eq($$select value, state from group_leaderboard((select id from g1), 'steps', 'day') where display_name = 'Alice'$$,
  $$values (9000::numeric, 'recorded'::text)$$, 'the steps leaderboard still ranks shared steps');

-- carol (G2 owner): alice shares no workouts there
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c7');
select is((select count(*)::int from group_workouts((select id from g2), (select (d - interval '14 days')::date from day0), (select (d + interval '1 day')::date from day0))), 0,
  'G2 gets no workouts');

-- dave (non-member)
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d7');
select throws_ok($$select * from group_workouts((select id from g1), current_date - 14, current_date + 1)$$,
  'not a member of this group', 'non-member cannot read group workouts');
select is((select count(*)::int from workouts) + (select count(*)::int from workout_exercises) + (select count(*)::int from workout_sets)
  + (select count(*)::int from metric_shares), 0, 'non-member reads no workout tables and no shares');

-- revoking takes effect on the next read, and only for that group's workouts
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a7');
select lives_ok($$delete from metric_shares where group_id = (select id from g1) and user_id = auth.uid() and metric = 'workouts'$$, 'member revokes workouts');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b7');
select is((select count(*)::int from group_workouts((select id from g1), (select (d - interval '14 days')::date from day0), (select (d + interval '1 day')::date from day0))), 0,
  'revoked workouts are no longer returned');
select is((select count(*)::int from group_steps((select id from g1), current_date - 7, current_date)), 1, 'revoking workouts leaves steps shared');

-- leaving a group drops its workout share
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a7');
select lives_ok($$insert into metric_shares (group_id, user_id, metric) values
  ((select id from g1), auth.uid(), 'workouts'), ((select id from g2), auth.uid(), 'workouts')$$, 'member shares workouts with both groups');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c7');
select is((select count(*)::int from group_workouts((select id from g2), (select (d - interval '14 days')::date from day0), (select (d + interval '1 day')::date from day0))), 2,
  'G2 now gets the weekly summary');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a7');
delete from group_members where group_id = (select id from g2) and user_id = auth.uid();
select throws_ok($$select * from group_workouts((select id from g2), current_date - 14, current_date + 1)$$,
  'not a member of this group', 'a member who left cannot read the group''s workouts');
reset role;
select is((select count(*)::int from metric_shares where user_id = '00000000-0000-0000-0000-0000000000a7' and group_id = (select id from g2)), 0,
  'leaving a group removes its shares');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c7');
select is((select count(*)::int from group_workouts((select id from g2), (select (d - interval '14 days')::date from day0), (select (d + interval '1 day')::date from day0))), 0,
  'the group gets nothing from a member who left');

-- removal by the owner takes the share with it, and rejoining does not bring it back
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b7');
select lives_ok($$select remove_member((select id from g1), '00000000-0000-0000-0000-0000000000a7')$$, 'owner removes a member');
select is((select count(*)::int from group_workouts((select id from g1), (select (d - interval '14 days')::date from day0), (select (d + interval '1 day')::date from day0))), 0,
  'a removed member''s workouts are no longer returned');
reset role;
select is((select count(*)::int from metric_shares where user_id = '00000000-0000-0000-0000-0000000000a7' and group_id = (select id from g1)), 0,
  'removal drops every share for that group');
select is((select count(*)::int from workouts where user_id = '00000000-0000-0000-0000-0000000000a7'), 3, 'removal leaves the member''s own workouts alone');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a7');
select throws_ok($$select * from group_workouts((select id from g1), current_date - 14, current_date + 1)$$,
  'not a member of this group', 'a removed member cannot read the group''s workouts');
select join_group((select invite_code from g1));
select is((select count(*)::int from metric_shares where user_id = auth.uid() and group_id = (select id from g1) and metric = 'workouts'), 0,
  'rejoining does not restore the workout share');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b7');
select is((select count(*)::int from group_workouts((select id from g1), (select (d - interval '14 days')::date from day0), (select (d + interval '1 day')::date from day0))), 0,
  'and the group still gets nothing');

-- account deletion removes everything, whichever order the cascades run in
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a7');
select lives_ok($$insert into metric_shares (group_id, user_id, metric) values ((select id from g1), auth.uid(), 'workouts')$$, 'member shares workouts again');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b7');
select is((select count(*)::int from group_workouts((select id from g1), (select (d - interval '14 days')::date from day0), (select (d + interval '1 day')::date from day0))), 2,
  'the group gets the summary again');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a7');
select lives_ok($$select delete_my_account()$$, 'member deletes their account');
reset role;
-- workout_exercises.exercise_id is deferred so the cascade order doesn't matter. `set constraints all immediate`
-- runs the deferred checks now, and would otherwise stay on for the rest of this transaction: put it back.
select lives_ok($$set constraints all immediate$$, 'deferred foreign keys hold once the cascades finish');
set constraints all deferred;
select is((select count(*)::int from workouts where user_id = '00000000-0000-0000-0000-0000000000a7'), 0, 'workouts are gone');
select is((select count(*)::int from workout_exercises) + (select count(*)::int from workout_sets), 0, 'exercises and sets are gone');
select is((select count(*)::int from exercises where user_id is not null), 0, 'custom exercises are gone');
select is((select count(*)::int from metric_shares where user_id = '00000000-0000-0000-0000-0000000000a7'), 0, 'every share is gone');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b7');
select is((select count(*)::int from group_workouts((select id from g1), (select (d - interval '14 days')::date from day0), (select (d + interval '1 day')::date from day0))), 0,
  'the group gets nothing from a deleted account');
reset role;
select cmp_ok((select count(*)::int from exercises where user_id is null), '>=', 30, 'the starter catalog survives');

-- anon has no direct or function access
set local role anon;
select throws_ok($$select count(*) from workouts$$, '42501', null, 'anon cannot read workouts');
select throws_ok($$select count(*) from workout_exercises$$, '42501', null, 'anon cannot read workout exercises');
select throws_ok($$select count(*) from workout_sets$$, '42501', null, 'anon cannot read workout sets');
select throws_ok($$select count(*) from exercises$$, '42501', null, 'anon cannot read exercises');
select throws_ok($$select count(*) from metric_shares$$, '42501', null, 'anon cannot read shares');
select throws_ok($$select * from group_workouts('00000000-0000-0000-0000-000000000000', current_date - 14, current_date + 1)$$,
  '42501', null, 'anon cannot call group_workouts');

select * from finish();
rollback;
