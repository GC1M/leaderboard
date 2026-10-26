begin;
select plan(21);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a5', 'alice@x.com'),
  ('00000000-0000-0000-0000-0000000000b5', 'bob@x.com');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, true), set_config('role', 'authenticated', true);
$$;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a5');

select cmp_ok((select count(*)::int from exercises where user_id is null), '>=', 30, 'starter catalog is seeded');
select throws_ok($$insert into exercises (user_id, name, category) values (null, 'Hack', 'strength')$$, '42501', null, 'users cannot add catalog rows');
select lives_ok($$insert into exercises (user_id, name, category) values (auth.uid(), 'Sled Push', 'strength')$$, 'user adds a custom exercise');
select throws_ok($$insert into exercises (user_id, name, category) values (auth.uid(), 'sled push', 'strength')$$, '23505', null, 'custom names are unique per user, ignoring case');

insert into workouts (id, user_id, source, activity_type, started_at, ended_at, timezone, duration_s, notes)
  values ('00000000-0000-0000-0000-00000000a501', auth.uid(), 'manual', 'strength', now() - interval '1 hour', now(), 'America/Chicago', 3600, 'legs');
insert into workout_exercises (id, workout_id, exercise_id, position)
  values ('00000000-0000-0000-0000-00000000a511', '00000000-0000-0000-0000-00000000a501',
    (select id from exercises where name = 'Deadlift'), 0);
insert into workout_sets (workout_exercise_id, position, reps, load_kg, duration_s, distance_m)
  values ('00000000-0000-0000-0000-00000000a511', 0, 5, 100, null, null);

select is((select distance_m from workouts where id = '00000000-0000-0000-0000-00000000a501'), null, 'unavailable fields stay null');
select throws_ok($$insert into workout_sets (workout_exercise_id, position) values ('00000000-0000-0000-0000-00000000a511', 1)$$,
  '23514', null, 'a set needs at least one value');
select throws_ok($$insert into workout_sets (workout_exercise_id, position, reps) values ('00000000-0000-0000-0000-00000000a511', 1, -1)$$,
  '23514', null, 'negative reps rejected');
select lives_ok($$insert into workout_sets (workout_exercise_id, position, reps, load_kg) values ('00000000-0000-0000-0000-00000000a511', 1, 0, 0)$$,
  'recorded zeros are allowed');
set constraints all immediate; -- positions are deferred so reorders work; check them now
select throws_ok($$insert into workout_sets (workout_exercise_id, position, reps) values ('00000000-0000-0000-0000-00000000a511', 1, 8)$$,
  '23505', null, 'set positions are unique within an exercise');
select throws_ok($$insert into workouts (user_id, source, activity_type, started_at, ended_at, timezone)
  values (auth.uid(), 'manual', 'run', now(), now() - interval '1 minute', 'UTC')$$, '23514', null, 'end cannot precede start');
select throws_ok($$insert into workouts (user_id, source, activity_type, started_at, ended_at, timezone)
  values (auth.uid(), 'healthkit', 'run', now(), now(), 'UTC')$$, '23514', null, 'imported workouts need Health ids');
select throws_ok($$insert into workouts (user_id, source, activity_type, started_at, ended_at, timezone, health_uuid, health_device_id)
  values (auth.uid(), 'manual', 'run', now(), now(), 'UTC', gen_random_uuid(), gen_random_uuid())$$, '23514', null, 'manual workouts carry no Health ids');

insert into workouts (id, user_id, source, activity_type, started_at, ended_at, timezone, health_uuid, health_device_id)
  values ('00000000-0000-0000-0000-00000000a502', auth.uid(), 'healthkit', 'running', now() - interval '1 hour', now(), 'UTC',
    '00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000d001');
select throws_ok($$insert into workouts (user_id, source, activity_type, started_at, ended_at, timezone, health_uuid, health_device_id)
  values (auth.uid(), 'healthkit', 'running', now(), now(), 'UTC', '00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000d001')$$,
  '23505', null, 'the same Health workout cannot import twice');
select throws_ok($$insert into workout_exercises (workout_id, exercise_id, position)
  values ('00000000-0000-0000-0000-00000000a502', (select id from exercises where name = 'Deadlift'), 0)$$,
  '23503', null, 'imported summaries cannot have exercises');

-- Bob sees and touches none of Alice's detail, nor her custom exercise.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b5');
select is((select count(*)::int from workouts), 0, 'other user cannot read workouts');
select is((select count(*)::int from workout_exercises) + (select count(*)::int from workout_sets), 0, 'other user cannot read exercises or sets');
select is((select count(*)::int from exercises where name = 'Sled Push'), 0, 'custom exercises are private');
select throws_ok($$insert into workout_exercises (workout_id, exercise_id, position)
  values ('00000000-0000-0000-0000-00000000a501', (select id from exercises where name = 'Deadlift'), 5)$$,
  '42501', null, 'other user cannot add to her workout');
select throws_ok($$insert into workouts (user_id, source, activity_type, started_at, ended_at, timezone)
  values ('00000000-0000-0000-0000-0000000000a5', 'manual', 'run', now(), now(), 'UTC')$$, '42501', null, 'cannot write as someone else');

-- Account deletion cascades.
reset role;
delete from auth.users where id = '00000000-0000-0000-0000-0000000000a5';
select is((select count(*)::int from workouts) + (select count(*)::int from workout_exercises) + (select count(*)::int from workout_sets)
  + (select count(*)::int from exercises where user_id is not null), 0, 'account deletion removes workouts, exercises, sets and custom exercises');
select cmp_ok((select count(*)::int from exercises where user_id is null), '>=', 30, 'catalog survives');

select * from finish();
rollback;
