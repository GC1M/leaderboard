begin;
select plan(45);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a6', 'alice@x.com'),
  ('00000000-0000-0000-0000-0000000000b6', 'bob@x.com');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, true), set_config('role', 'authenticated', true);
$$;

-- What the app does when a template is applied: copy its values into a new manual workout on the chosen
-- day. Nothing links the workout back to the template.
create function pg_temp.apply_template(p_template uuid, p_day timestamptz) returns uuid language sql as $$
  select save_manual_workout(null, jsonb_build_object(
    'activity_type', wt.activity_type, 'started_at', p_day, 'ended_at', p_day + interval '1 hour', 'timezone', 'UTC',
    'exercises', coalesce((
      select jsonb_agg(jsonb_build_object('exercise_id', te.exercise_id, 'sets', coalesce((
        select jsonb_agg(jsonb_build_object('reps', ts.reps, 'load_kg', ts.load_kg) order by ts.position)
        from workout_template_sets ts where ts.template_exercise_id = te.id), '[]'::jsonb)) order by te.position)
      from workout_template_exercises te where te.template_id = wt.id), '[]'::jsonb)))
  from workout_templates wt where wt.id = p_template
$$;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a6');

insert into exercises (id, user_id, name, category)
  values ('00000000-0000-0000-0000-00000000a6e1', auth.uid(), 'Sled Push', 'strength');
insert into workout_templates (id, user_id, name, activity_type, duration_s)
  values ('00000000-0000-0000-0000-00000000a601', auth.uid(), 'Push', 'Strength', 3600);
insert into workout_template_exercises (id, template_id, exercise_id, position)
  values ('00000000-0000-0000-0000-00000000a611', '00000000-0000-0000-0000-00000000a601',
    (select id from exercises where name = 'Deadlift'), 0);
insert into workout_template_sets (template_exercise_id, position, reps, load_kg)
  values ('00000000-0000-0000-0000-00000000a611', 0, 5, 100);

-- Constraints.
select throws_ok($$insert into workout_templates (user_id, name, activity_type) values (auth.uid(), '  ', 'Strength')$$,
  '23514', null, 'a template needs a name');
select throws_ok($$insert into workout_templates (user_id, name, activity_type) values (auth.uid(), 'Bad', '')$$,
  '23514', null, 'a template needs an activity type');
select throws_ok($$insert into workout_templates (user_id, name, activity_type, duration_s) values (auth.uid(), 'Bad', 'Strength', 0)$$,
  '23514', null, 'a planned duration must be positive');
select lives_ok($$insert into workout_templates (user_id, name, activity_type) values (auth.uid(), 'Open', 'Strength')$$,
  'the duration is optional');
select throws_ok($$insert into workout_template_sets (template_exercise_id, position) values ('00000000-0000-0000-0000-00000000a611', 1)$$,
  '23514', null, 'a planned set needs at least one value');
select throws_ok($$insert into workout_template_sets (template_exercise_id, position, reps) values ('00000000-0000-0000-0000-00000000a611', 1, -1)$$,
  '23514', null, 'negative reps rejected');
select lives_ok($$insert into workout_template_sets (template_exercise_id, position, reps, load_kg) values ('00000000-0000-0000-0000-00000000a611', 1, 0, 0)$$,
  'planned zeros are allowed');
set constraints all immediate; -- positions are deferred so reorders work; check them now
select throws_ok($$insert into workout_template_sets (template_exercise_id, position, reps) values ('00000000-0000-0000-0000-00000000a611', 1, 8)$$,
  '23505', null, 'set positions are unique within an exercise');
select throws_ok($$insert into workout_template_exercises (template_id, exercise_id, position)
  values ('00000000-0000-0000-0000-00000000a601', (select id from exercises where name = 'Plank'), 0)$$,
  '23505', null, 'exercise positions are unique within a template');

-- save_workout_template: atomic create/update, array order becomes position.
select lives_ok($$select save_workout_template(null, jsonb_build_object('name', 'Legs', 'activity_type', 'Strength', 'duration_s', 2700,
  'exercises', jsonb_build_array(
    jsonb_build_object('exercise_id', (select id from exercises where name = 'Deadlift'), 'sets', jsonb_build_array(jsonb_build_object('reps', 5, 'load_kg', 100))),
    jsonb_build_object('exercise_id', (select id from exercises where name = 'Running'), 'sets', jsonb_build_array(jsonb_build_object('duration_s', 600, 'distance_m', 2000))))))$$,
  'save creates a template with ordered exercises and sets');
select is((select array_agg(e.name order by te.position) from workout_template_exercises te
  join exercises e on e.id = te.exercise_id join workout_templates t on t.id = te.template_id where t.name = 'Legs'),
  array['Deadlift', 'Running']::text[], 'array order became exercise position');
select lives_ok($$select save_workout_template(null, jsonb_build_object('name', 'Sleds', 'activity_type', 'Strength',
  'exercises', jsonb_build_array(jsonb_build_object('exercise_id', (select id from exercises where name = 'Sled Push'),
    'sets', jsonb_build_array(jsonb_build_object('reps', 10, 'load_kg', 60))))))$$, 'a template can use her custom exercise');
select throws_ok($$delete from exercises where name = 'Sled Push'$$, '23503', null, 'a custom exercise used in a template cannot be deleted');
select lives_ok($$update workout_templates set updated_at = '2000-01-01' where id = '00000000-0000-0000-0000-00000000a601'$$, 'a template can be updated');
select cmp_ok((select updated_at from workout_templates where id = '00000000-0000-0000-0000-00000000a601'), '>', '2020-01-01'::timestamptz,
  'updated_at is touched on update');

-- Bob sees and touches none of Alice's templates, and cannot use her custom exercise.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b6');
select is((select count(*)::int from workout_templates), 0, 'other user cannot read templates');
select is((select count(*)::int from workout_template_exercises) + (select count(*)::int from workout_template_sets), 0,
  'other user cannot read template exercises or sets');
select throws_ok($$insert into workout_template_exercises (template_id, exercise_id, position)
  values ('00000000-0000-0000-0000-00000000a601', (select id from exercises where name = 'Deadlift'), 5)$$,
  '42501', null, 'other user cannot add to her template');
select throws_ok($$insert into workout_templates (user_id, name, activity_type)
  values ('00000000-0000-0000-0000-0000000000a6', 'Planted', 'Strength')$$, '42501', null, 'cannot write a template as someone else');
select lives_ok($$update workout_templates set name = 'Hacked' where id = '00000000-0000-0000-0000-00000000a601'$$, 'updating her template is a no-op for him');
select lives_ok($$delete from workout_templates where id = '00000000-0000-0000-0000-00000000a601'$$, 'deleting her template is a no-op for him');
select throws_ok($$select save_workout_template('00000000-0000-0000-0000-00000000a601', jsonb_build_object('name', 'Hacked', 'activity_type', 'Strength'))$$,
  'P0001', 'template not found', 'another user cannot save over her template');
select throws_ok($$select save_workout_template(null, jsonb_build_object('name', 'Mine', 'activity_type', 'Strength',
  'exercises', jsonb_build_array(jsonb_build_object('exercise_id', '00000000-0000-0000-0000-00000000a6e1',
    'sets', jsonb_build_array(jsonb_build_object('reps', 1))))))$$, '42501', null, 'cannot plan with her custom exercise');
select lives_ok($$select save_workout_template(null, jsonb_build_object('name', 'Bobs', 'activity_type', 'Strength',
  'exercises', jsonb_build_array(jsonb_build_object('exercise_id', (select id from exercises where name = 'Plank'),
    'sets', jsonb_build_array(jsonb_build_object('duration_s', 60))))))$$, 'he saves a template of his own');

set local role anon;
select throws_ok($$select count(*) from workout_templates$$, '42501', null, 'anon cannot read templates');
select throws_ok($$select save_workout_template(null, '{}'::jsonb)$$, '42501', null, 'anon cannot call save_workout_template');

-- Back as Alice: her template survived, and save replaces the children atomically.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a6');
select is((select name from workout_templates where id = '00000000-0000-0000-0000-00000000a601'), 'Push', 'her template is untouched by the other user');
select lives_ok($$select save_workout_template('00000000-0000-0000-0000-00000000a601', jsonb_build_object('name', 'Push v2', 'activity_type', 'Strength',
  'duration_s', 3600, 'exercises', jsonb_build_array(jsonb_build_object('exercise_id', (select id from exercises where name = 'Deadlift'),
    'sets', jsonb_build_array(jsonb_build_object('reps', 5, 'load_kg', 100))))))$$, 'save updates a template');
select is((select count(*)::int from workout_template_exercises where id = '00000000-0000-0000-0000-00000000a611'), 0, 'the old exercise row is gone');
select throws_ok($$select save_workout_template('00000000-0000-0000-0000-00000000a601', jsonb_build_object('name', 'Broken', 'activity_type', 'Strength',
  'exercises', jsonb_build_array(
  jsonb_build_object('exercise_id', (select id from exercises where name = 'Plank'), 'sets', jsonb_build_array(jsonb_build_object('reps', 1))),
  jsonb_build_object('exercise_id', (select id from exercises where name = 'Plank'), 'sets', jsonb_build_array(jsonb_build_object())))))$$,
  '23514', null, 'an invalid set fails the whole save');
select is((select name || ':' || (select count(*) from workout_template_exercises where template_id = t.id)
  from workout_templates t where t.id = '00000000-0000-0000-0000-00000000a601'), 'Push v2:1', 'the failed save left the template as it was');

-- Applying a template copies it: repeatable, and independent of the template in both directions.
select lives_ok($$select pg_temp.apply_template('00000000-0000-0000-0000-00000000a601', '2026-11-02 18:00+00')$$, 'apply to a chosen day');
select lives_ok($$select pg_temp.apply_template('00000000-0000-0000-0000-00000000a601', '2026-11-09 18:00+00')$$, 'apply the same template again');
select is((select count(*)::int from workouts where source = 'manual' and activity_type = 'Strength'), 2, 'two applications make two workouts');
select is((select count(*)::int from workout_sets), 2, 'each has its own sets');
select lives_ok($$select save_workout_template('00000000-0000-0000-0000-00000000a601', jsonb_build_object('name', 'Push v3', 'activity_type', 'Strength',
  'exercises', jsonb_build_array(jsonb_build_object('exercise_id', (select id from exercises where name = 'Deadlift'),
    'sets', jsonb_build_array(jsonb_build_object('reps', 1, 'load_kg', 200))))))$$, 'the template is edited afterwards');
select is((select array_agg(load_kg order by load_kg) from workout_sets), array[100, 100]::numeric[], 'past sessions keep the planned values from when they were made');
select lives_ok($$select save_manual_workout((select id from workouts order by started_at limit 1), jsonb_build_object('activity_type', 'Strength',
  'started_at', '2026-11-02 18:00+00'::timestamptz, 'ended_at', '2026-11-02 19:00+00'::timestamptz, 'timezone', 'UTC', 'exercises', jsonb_build_array(
  jsonb_build_object('exercise_id', (select id from exercises where name = 'Deadlift'), 'sets', jsonb_build_array(jsonb_build_object('reps', 5, 'load_kg', 110))))))$$,
  'an applied workout is edited on its own');
select is((select load_kg from workout_template_sets ts join workout_template_exercises te on te.id = ts.template_exercise_id
  where te.template_id = '00000000-0000-0000-0000-00000000a601'), 200::numeric, 'editing the workout leaves the template alone');
select lives_ok($$delete from workout_templates where id = '00000000-0000-0000-0000-00000000a601'$$, 'the template is deleted');
select is((select count(*)::int from workout_template_exercises where template_id = '00000000-0000-0000-0000-00000000a601'), 0, 'deleting a template removes its exercises and sets');
select is((select count(*)::int from workouts) * 10 + (select count(*)::int from workout_sets), 22, 'past sessions survive the deletion, sets included');

-- Back to the schema's own mode: `set constraints all immediate` above would otherwise hide the deferred exercise FK.
set constraints all deferred;

-- Account deletion cascades through delete_my_account (including her custom exercise, which her templates use).
select lives_ok($$select delete_my_account()$$, 'she deletes her account');
reset role;
select is((select count(*)::int from workout_templates where user_id = '00000000-0000-0000-0000-0000000000a6'), 0, 'her templates are gone');
select is((select count(*)::int from workout_templates) + (select count(*)::int from workout_template_exercises)
  + (select count(*)::int from workout_template_sets), 3, 'her template exercises and sets are gone too, and the other user''s template stays');

select * from finish();
rollback;
