begin;
select plan(22);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a8', 'imp-a@x.com', '{"full_name":"Ana"}'),
  ('00000000-0000-0000-0000-0000000000b8', 'imp-b@x.com', '{"full_name":"Ben"}');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, true), set_config('role', 'authenticated', true);
$$;

-- w1: two exercises, one from the catalog under another case, one unknown. w2: a cardio set only.
create temp table payload as select '[
 {"source_key":"2026-10-20T08:00:00.000Z|Push Day","activity_type":"Push Day","started_at":"2026-10-20T08:00:00Z",
  "ended_at":"2026-10-20T09:00:00Z","timezone":"UTC","duration_s":3600,"notes":"felt good","exercises":[
   {"name":"bench press","category":"strength","notes":"Set 1: warm-up","sets":[{"reps":10,"load_kg":40},{"reps":5,"load_kg":100}]},
   {"name":"Cable Fly (Custom)","category":"strength","sets":[{"reps":12,"load_kg":15}]}]},
 {"source_key":"2026-10-21T07:00:00.000Z|Run","activity_type":"Run","started_at":"2026-10-21T07:00:00Z",
  "ended_at":"2026-10-21T07:30:00Z","timezone":"UTC","exercises":[
   {"name":"Running","category":"cardio","sets":[{"duration_s":1800,"distance_m":5000}]}]}
]'::jsonb as j;
grant select on payload to authenticated;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a8');
select is(import_workouts('strong', (select j from payload)), 2, 'both workouts are new');
select is(import_workouts('strong', (select j from payload)), 0, 'the same file again adds nothing');
select is((select count(*)::int from workouts), 2, 'no duplicates');
select is(import_workouts('hevy', (select j from payload)), 2, 'the same keys from another app are different workouts');
delete from workouts where source_app = 'hevy';

select results_eq($$select source, source_app, activity_type, duration_s, notes from workouts order by started_at$$,
  $$values ('import'::text, 'strong'::text, 'Push Day'::text, 3600::numeric, 'felt good'::text),
    ('import', 'strong', 'Run', null, null)$$, 'workouts are stored as imports, missing values stay null');
select results_eq($$select e.name, e.user_id is null, we.position, we.notes from workout_exercises we
  join exercises e on e.id = we.exercise_id join workouts w on w.id = we.workout_id
  where w.activity_type = 'Push Day' order by we.position$$,
  $$values ('Bench Press'::text, true, 0, 'Set 1: warm-up'::text), ('Cable Fly (Custom)', false, 1, null)$$,
  'catalog names match case-insensitively, unknown names become custom exercises, order and notes kept');
select results_eq($$select s.position, s.reps, s.load_kg from workout_sets s
  join workout_exercises we on we.id = s.workout_exercise_id join exercises e on e.id = we.exercise_id
  where e.name = 'Bench Press' order by s.position$$,
  $$values (0, 10, 40::numeric), (1, 5, 100::numeric)$$, 'sets keep their order');

-- A newer export overlapping the old one: the known workout is skipped (and so is any edit made to it), the new one lands.
create temp table w1 as select id from workouts where activity_type = 'Push Day';
grant select on w1 to authenticated;
select lives_ok($$select save_manual_workout((select id from w1), jsonb_build_object('activity_type', 'Push (edited)',
  'started_at', '2026-10-20T08:00:00Z', 'ended_at', '2026-10-20T09:10:00Z', 'timezone', 'UTC',
  'exercises', jsonb_build_array(jsonb_build_object('exercise_id', (select id from exercises where name = 'Bench Press'),
    'sets', jsonb_build_array(jsonb_build_object('reps', 8, 'load_kg', 90))))))$$, 'an imported workout can be edited');
select results_eq($$select source, source_app, activity_type from workouts where id = (select id from w1)$$,
  $$values ('import'::text, 'strong'::text, 'Push (edited)'::text)$$, 'an edit keeps the import source and key');
select is(import_workouts('strong', (select j || '[{"source_key":"2026-10-22T08:00:00.000Z|Legs","activity_type":"Legs",
  "started_at":"2026-10-22T08:00:00Z","ended_at":"2026-10-22T09:00:00Z","timezone":"UTC","exercises":[
  {"name":"Cable Fly (Custom)","category":"strength","sets":[{"reps":10}]}]}]'::jsonb from payload)), 1, 'only the new workout is added');
select is((select activity_type from workouts where id = (select id from w1)), 'Push (edited)', 'the re-import did not overwrite the edit');
select is((select count(*)::int from exercises where user_id is not null), 1, 'a custom exercise is created once and reused');

-- Failures save nothing.
select throws_ok($$select import_workouts('strava', (select j from payload))$$, '23514', null, 'unknown app is rejected');
select throws_ok($$select import_workouts('strong', '[{"source_key":"k","activity_type":"Bad","started_at":"2026-10-23T08:00:00Z",
  "ended_at":"2026-10-23T09:00:00Z","timezone":"UTC","exercises":[{"name":"Bench Press","category":"strength","sets":[{}]}]}]')$$,
  '23514', null, 'a set with no values is rejected');
select is((select count(*)::int from workouts where activity_type = 'Bad'), 0, 'the failed batch left nothing behind');
select throws_ok($$insert into workouts (user_id, source, activity_type, started_at, ended_at, timezone)
  values (auth.uid(), 'import', 'X', now(), now(), 'UTC')$$, '23514', null, 'an import needs its app and key');

-- Owner-only.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b8');
select is((select count(*)::int from workouts) + (select count(*)::int from workout_exercises), 0, 'another user sees none of it');
select is(import_workouts('strong', (select j from payload)), 2, 'another user importing the same file gets their own copies');

-- Health duplicate rule: a Health row overlapping an imported one is left out of group totals.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a8');
create temp table g as select id, invite_code from create_group('Imports');
grant select on g to authenticated;
insert into metric_shares (group_id, user_id, metric) values ((select id from g), auth.uid(), 'workouts');
reset role; -- Health rows arrive through the import RPCs, so seed them as the database owner
insert into workouts (user_id, source, activity_type, started_at, ended_at, timezone, duration_s, health_uuid, health_device_id) values
  (auth.uid(), 'healthkit', 'Traditional Strength Training', '2026-10-20T08:01:00Z', '2026-10-20T09:00:00Z', 'UTC', 3540,
   '00000000-0000-0000-0000-00000000f008', '00000000-0000-0000-0000-00000000d008'),
  (auth.uid(), 'healthkit', 'Walking', '2026-10-20T18:00:00Z', '2026-10-20T18:30:00Z', 'UTC', 1800,
   '00000000-0000-0000-0000-00000000f009', '00000000-0000-0000-0000-00000000d008');
set local role authenticated;
select results_eq($$select workout_count, total_duration_s from group_workouts((select id from g), '2026-10-19', '2026-10-25')$$,
  $$values (4, (4200 + 1800 + 3600 + 1800)::numeric)$$,
  'the overlapping Health copy is not counted; the separate Health walk is');

-- Account deletion removes imports too.
select lives_ok($$select delete_my_account()$$, 'user deletes their account');
reset role;
select lives_ok($$set constraints all immediate$$, 'deferred foreign keys hold once the cascades finish');
set constraints all deferred;
select is((select count(*)::int from workouts where user_id = '00000000-0000-0000-0000-0000000000a8'), 0, 'imported workouts are gone');

select * from finish();
rollback;
