begin;
select plan(15);
insert into auth.users(id,email) values('00000000-0000-0000-0000-000000000061','a61@example.com'),('00000000-0000-0000-0000-000000000161','b61@example.com');
insert into groups(id,name,invite_code,owner_id) values('00000000-0000-0000-0000-000000006100','Source','SRCE6100','00000000-0000-0000-0000-000000000061');
insert into group_members(group_id,user_id,role) values('00000000-0000-0000-0000-000000006100','00000000-0000-0000-0000-000000000061','owner'),('00000000-0000-0000-0000-000000006100','00000000-0000-0000-0000-000000000161','member');
-- Ended 1 day ago, so still before finalization.
insert into competitions(id,group_id,creator_id,name,metric,starts_at,ends_at,timezone) values('00000000-0000-0000-0000-000000006101','00000000-0000-0000-0000-000000006100','00000000-0000-0000-0000-000000000061','Ended','steps',(current_date-4)::timestamp at time zone 'UTC',(current_date-1)::timestamp at time zone 'UTC','UTC');
insert into competition_participants(competition_id,user_id) select '00000000-0000-0000-0000-000000006101',user_id from group_members where group_id='00000000-0000-0000-0000-000000006100';
insert into daily_metrics(user_id,date,metric,value,source) values('00000000-0000-0000-0000-000000000161',current_date-10,'steps',4000,'healthkit');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000061',true);
set local role authenticated;

-- Direct writes cannot label rows as Health data.
select throws_ok($$insert into daily_metrics(user_id,date,metric,value,source) values(auth.uid(),current_date-3,'steps',120000,'healthkit')$$,'42501',null,'client cannot insert Health-labelled steps');
select throws_ok($$insert into daily_metrics(user_id,date,metric,value,source) values(auth.uid(),current_date-3,'steps',5000,'health_connect')$$,'42501',null,'client cannot insert Health Connect-labelled steps');
select throws_ok($$insert into weight_measurements(user_id,measured_at,kg,source) values(auth.uid(),now(),80,'healthkit')$$,'42501',null,'client cannot insert Health-labelled weight');
select throws_ok($$insert into workouts(user_id,source,activity_type,started_at,ended_at,timezone,health_uuid,health_device_id) values(auth.uid(),'healthkit','Running',now()-interval '1 hour',now(),'UTC',gen_random_uuid(),gen_random_uuid())$$,'42501',null,'client cannot insert Health-labelled workouts');
select lives_ok($$insert into daily_metrics(user_id,date,metric,value,source) values(auth.uid(),current_date-3,'steps',5000,'manual')$$,'manual steps still insert');
select throws_ok($$update daily_metrics set source='healthkit' where user_id=auth.uid() and date=current_date-3$$,'42501',null,'client cannot relabel a manual row as Health');
select lives_ok($$insert into weight_measurements(user_id,measured_at,kg,source) values(auth.uid(),now(),80,'manual')$$,'manual weight still inserts');

-- The import RPCs still write Health rows for the signed-in owner only.
select lives_ok($$select apply_health_changes(auth.uid(),'00000000-0000-0000-0000-00000000d061','steps','[{"date":"2026-01-02","value":7000}]'::jsonb,'{}','[]'::jsonb,'{}')$$,'Health import RPC writes steps');
select is((select source from daily_metrics where user_id=auth.uid() and date='2026-01-02'),'healthkit','imported row is labelled Health');
select lives_ok($$select apply_health_workouts(auth.uid(),'00000000-0000-0000-0000-00000000d061',jsonb_build_array(jsonb_build_object('activity_type','Running','started_at','2026-01-02T08:00:00Z','ended_at','2026-01-02T08:30:00Z','timezone','UTC','duration_s',1800,'health_uuid','00000000-0000-0000-0000-00000000e061')),'{}')$$,'Health workout RPC writes workouts');
select throws_ok($$select apply_health_changes('00000000-0000-0000-0000-000000000161','00000000-0000-0000-0000-00000000d061','steps','[{"date":"2026-01-03","value":7000}]'::jsonb,'{}','[]'::jsonb,'{}')$$,'P0001','Health account changed','definer RPC still refuses another owner');
select lives_ok($$delete from daily_metrics where user_id=auth.uid() and date='2026-01-02'$$,'owner can still delete Health rows');

-- Ended competitions cannot be cancelled; removal stays possible before finalization.
select throws_ok($$select moderate_competition('00000000-0000-0000-0000-000000006101','cancel','Changed my mind')$$,'P0001','ended competitions cannot be cancelled','creator cannot cancel after the end');
select lives_ok($$select moderate_competition('00000000-0000-0000-0000-000000006101','remove','Phone shared with a dog','00000000-0000-0000-0000-000000000161')$$,'creator can still remove a participant before finalization');
select is((select status from competitions where id='00000000-0000-0000-0000-000000006101'),'scheduled','competition is not cancelled');
select * from finish();
rollback;
