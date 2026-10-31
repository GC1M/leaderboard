begin;
select plan(8);
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000122', 'numeric122@example.com');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000122', true);

select throws_ok($$insert into daily_metrics(user_id,date,metric,value,source) values (auth.uid(), current_date, 'steps', 7.5, 'manual')$$, '23514', null, 'fractional steps rejected at the server');
select lives_ok($$insert into daily_metrics(user_id,date,metric,value,source) values (auth.uid(), current_date, 'steps', 0, 'manual')$$, 'a recorded zero is valid');

select throws_ok($$select save_manual_workout(null, jsonb_build_object('activity_type','Running', 'started_at',now()-interval '1 hour','ended_at',now(),'timezone','UTC','exercises',jsonb_build_array(jsonb_build_object('exercise_id',(select id from exercises limit 1),'sets',jsonb_build_array(jsonb_build_object('reps',2.5))))))$$, '22P02', null, 'the RPC rejects fractional reps instead of rounding');
select throws_ok($$select save_workout_template(null, jsonb_build_object('name','Invalid reps','activity_type','Strength','exercises',jsonb_build_array(jsonb_build_object('exercise_id',(select id from exercises limit 1),'sets',jsonb_build_array(jsonb_build_object('reps',2.5))))))$$, '22P02', null, 'templates reject fractional reps as well');
select lives_ok($$select save_manual_workout(null, jsonb_build_object('activity_type','Running', 'started_at',now()-interval '1 hour','ended_at',now(),'timezone','UTC','duration_s',1800.5,'exercises',jsonb_build_array(jsonb_build_object('exercise_id',(select id from exercises limit 1),'sets',jsonb_build_array(jsonb_build_object('reps',5,'load_kg',22.5,'distance_m',1500.25,'duration_s',90.5))))))$$, 'decimal loads, distances and time remain valid');
select throws_ok($$select save_manual_workout(null, jsonb_build_object('activity_type','Strength', 'started_at',now()-interval '1 hour','ended_at',now(),'timezone','UTC','exercises',jsonb_build_array(jsonb_build_object('exercise_id',(select id from exercises limit 1),'sets',jsonb_build_array(jsonb_build_object('load_kg','NaN'))))))$$, '23514', null, 'NaN cannot bypass load validation');
select throws_ok($$select save_workout_template(null, jsonb_build_object('name','Invalid distance','activity_type','Running','exercises',jsonb_build_array(jsonb_build_object('exercise_id',(select id from exercises limit 1),'sets',jsonb_build_array(jsonb_build_object('distance_m','Infinity'))))))$$, '23514', null, 'infinite template measurements rejected');
select lives_ok($$select save_workout_template(null, jsonb_build_object('name','Decimal plan','activity_type','Running','duration_s',1800.5,'exercises',jsonb_build_array(jsonb_build_object('exercise_id',(select id from exercises limit 1),'sets',jsonb_build_array(jsonb_build_object('reps',0,'load_kg',0,'distance_m',2500.25,'duration_s',90.5))))))$$, 'template decimals and explicit zeros remain valid');
select * from finish();
rollback;
