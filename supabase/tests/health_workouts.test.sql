begin;
select plan(14);
insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000a5','wk-a@x.com'),('00000000-0000-0000-0000-0000000000b5','wk-b@x.com');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a5',true);
set local role authenticated;
-- w1: full workout. w2: overlaps w1 from another source, no distance or energy. w3: recorded zeros.
create temp table payload as select '[
 {"health_uuid":"10000000-0000-0000-0000-000000000001","activity_type":"Running","started_at":"2026-10-25T10:00:00Z","ended_at":"2026-10-25T10:30:00Z","timezone":"UTC","duration_s":1800,"distance_m":5000,"energy_kcal":300},
 {"health_uuid":"10000000-0000-0000-0000-000000000002","activity_type":"Running","started_at":"2026-10-25T10:05:00Z","ended_at":"2026-10-25T10:25:00Z","timezone":"UTC","duration_s":1200},
 {"health_uuid":"10000000-0000-0000-0000-000000000003","activity_type":"Yoga","started_at":"2026-10-24T10:00:00Z","ended_at":"2026-10-24T10:30:00Z","timezone":"UTC","duration_s":1800,"distance_m":0,"energy_kcal":0}
]'::jsonb as j;
select lives_ok($$select public.apply_health_workouts(auth.uid(),'00000000-0000-0000-0000-000000000001',(select j from payload),'{}')$$,'import succeeds');
select lives_ok($$select public.apply_health_workouts(auth.uid(),'00000000-0000-0000-0000-000000000001',(select j from payload),'{}')$$,'retry is idempotent');
select is((select count(*) from public.workouts),3::bigint,'same Health UUID is an upsert; overlapping sessions are both kept');
select is((select distance_m from public.workouts where health_uuid='10000000-0000-0000-0000-000000000002'),null,'missing distance stays null');
select is((select energy_kcal from public.workouts where health_uuid='10000000-0000-0000-0000-000000000003'),0::numeric,'recorded zero stays zero');
select public.apply_health_workouts(auth.uid(),'00000000-0000-0000-0000-000000000001',
  '[{"health_uuid":"10000000-0000-0000-0000-000000000001","activity_type":"Cycling","started_at":"2026-10-25T10:00:00Z","ended_at":"2026-10-25T10:40:00Z","timezone":"UTC","duration_s":2400}]','{}');
select results_eq($$select activity_type, duration_s, distance_m from public.workouts where health_uuid='10000000-0000-0000-0000-000000000001'$$,
  $$values ('Cycling'::text, 2400::numeric, null::numeric)$$,'a correction replaces the row, including cleared values');
select public.apply_health_workouts(auth.uid(),'00000000-0000-0000-0000-000000000002','[]','{10000000-0000-0000-0000-000000000001}');
select is((select count(*) from public.workouts),3::bigint,'another device cannot delete the row');
select public.apply_health_workouts(auth.uid(),'00000000-0000-0000-0000-000000000001','[]','{10000000-0000-0000-0000-000000000001,10000000-0000-0000-0000-000000000099}');
select is((select count(*) from public.workouts),2::bigint,'own tombstone deletes; unknown tombstone is a no-op');
insert into public.workouts(user_id,source,activity_type,started_at,ended_at,timezone) values (auth.uid(),'manual','Lifting','2026-10-25T10:00:00Z','2026-10-25T11:00:00Z','UTC');
select throws_ok($$select public.apply_health_workouts('00000000-0000-0000-0000-0000000000b5','00000000-0000-0000-0000-000000000001','[]','{}')$$,'P0001','Health account changed','captured owner cannot change');
select throws_ok($$select public.apply_health_workouts(auth.uid(),'00000000-0000-0000-0000-000000000001','[{"health_uuid":"10000000-0000-0000-0000-000000000004","activity_type":"Running","started_at":"2026-10-25T10:00:00Z","ended_at":"2026-10-25T10:30:00Z","timezone":"UTC","duration_s":-1}]','{}')$$,'23514',null,'negative values are rejected');
select public.apply_health_workouts(auth.uid(),'00000000-0000-0000-0000-000000000001','[]','{10000000-0000-0000-0000-000000000003}');
select is((select count(*) from public.workouts where source='manual'),1::bigint,'tombstones never touch manual workouts');
select lives_ok($$select public.delete_my_health_imports()$$,'deleting imports also covers workouts');
select is((select count(*) from public.workouts),1::bigint,'only the manual workout remains');
set local role anon;
select throws_ok($$select public.apply_health_workouts('00000000-0000-0000-0000-0000000000a5','00000000-0000-0000-0000-000000000001','[]','{}')$$,'42501',null,'anon cannot call it');
select * from finish();
rollback;
