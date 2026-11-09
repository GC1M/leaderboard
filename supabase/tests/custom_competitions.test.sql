begin;
select plan(31);
insert into auth.users(id,email) values('00000000-0000-0000-0000-000000000050','a50@example.com'),('00000000-0000-0000-0000-000000000150','b50@example.com');
insert into groups(id,name,invite_code,owner_id) values('00000000-0000-0000-0000-000000005000','Custom','CUST5088','00000000-0000-0000-0000-000000000050');
insert into group_members(group_id,user_id,role) values('00000000-0000-0000-0000-000000005000','00000000-0000-0000-0000-000000000050','owner'),('00000000-0000-0000-0000-000000005000','00000000-0000-0000-0000-000000000150','member');
insert into metric_shares(group_id,user_id,metric) select '00000000-0000-0000-0000-000000005000',user_id,m from group_members, unnest(array['workouts','water']) m where group_id='00000000-0000-0000-0000-000000005000';
-- Source rows already imported: steps on three consecutive days then a gap, workouts, and water against a 2 L target.
insert into daily_metrics(user_id,date,metric,value,source) values
 ('00000000-0000-0000-0000-000000000050',current_date-4,'steps',1000,'healthkit'),('00000000-0000-0000-0000-000000000050',current_date-3,'steps',2000,'healthkit'),('00000000-0000-0000-0000-000000000050',current_date-2,'steps',3000,'healthkit'),('00000000-0000-0000-0000-000000000050',current_date,'steps',500,'healthkit'),
 ('00000000-0000-0000-0000-000000000150',current_date-4,'steps',0,'healthkit'),('00000000-0000-0000-0000-000000000150',current_date-1,'steps',100,'manual');
insert into workouts(user_id,source,activity_type,started_at,ended_at,timezone,duration_s,health_uuid,health_device_id) values
 ('00000000-0000-0000-0000-000000000050','healthkit','Running',(current_date-3)::timestamp at time zone 'UTC'+interval '7 hours',(current_date-3)::timestamp at time zone 'UTC'+interval '8 hours','UTC',1800,gen_random_uuid(),gen_random_uuid()),
 ('00000000-0000-0000-0000-000000000050','healthkit','Cycling',(current_date-1)::timestamp at time zone 'UTC'+interval '7 hours',(current_date-1)::timestamp at time zone 'UTC'+interval '8 hours','UTC',2700,gen_random_uuid(),gen_random_uuid()),
 ('00000000-0000-0000-0000-000000000150','manual','Yoga',(current_date-2)::timestamp at time zone 'UTC'+interval '7 hours',(current_date-2)::timestamp at time zone 'UTC'+interval '8 hours','UTC',600,null,null);
insert into water_targets(user_id,daily_ml) values('00000000-0000-0000-0000-000000000050',2000);
insert into water_entries(user_id,source,health_uuid,health_device_id,consumed_at,timezone,ml) values
 ('00000000-0000-0000-0000-000000000050','healthkit',gen_random_uuid(),gen_random_uuid(),(current_date-4)::timestamp at time zone 'UTC'+interval '9 hours','UTC',2500),
 ('00000000-0000-0000-0000-000000000050','healthkit',gen_random_uuid(),gen_random_uuid(),(current_date-3)::timestamp at time zone 'UTC'+interval '9 hours','UTC',1000),
 ('00000000-0000-0000-0000-000000000050','healthkit',gen_random_uuid(),gen_random_uuid(),(current_date-3)::timestamp at time zone 'UTC'+interval '20 hours','UTC',1000),
 ('00000000-0000-0000-0000-000000000050','healthkit',gen_random_uuid(),gen_random_uuid(),(current_date-2)::timestamp at time zone 'UTC'+interval '9 hours','UTC',300);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000050',true);
set local role authenticated;
select has_column('competitions','late_joins','late_joins column exists');
select has_column('competitions','scoring','scoring column exists');
-- Metrics
select throws_ok($$select create_competition('00000000-0000-0000-0000-000000005000','Weight','weight_kg',current_date+1,current_date+3,'UTC')$$,'P0001','weight, food and sleep are never ranked; choose steps, workout minutes, workouts, water days or active days','weight is refused');
select throws_ok($$select create_competition('00000000-0000-0000-0000-000000005000','Food','food_kcal',current_date+1,current_date+3,'UTC')$$,'P0001','weight, food and sleep are never ranked; choose steps, workout minutes, workouts, water days or active days','food is refused');
select throws_ok($$select create_competition('00000000-0000-0000-0000-000000005000','Sleep','sleep_min',current_date+1,current_date+3,'UTC')$$,'P0001','weight, food and sleep are never ranked; choose steps, workout minutes, workouts, water days or active days','sleep is refused');
select throws_ok($$select create_competition('00000000-0000-0000-0000-000000005000','Screen','screen_min',current_date+1,current_date+3,'UTC')$$,'P0001',null,'screen time is refused');
select throws_ok($$select create_competition('00000000-0000-0000-0000-000000005000','Bad scoring','steps',current_date+1,current_date+3,'UTC',false,false,'median')$$,'P0001','scoring must be total, daily_average or best_streak','unknown scoring mode refused');
-- Start day: past accepted (scored from imported history), future still accepted, too far back and already over refused.
create temp table comps(name text, id uuid);
insert into comps select 'future', create_competition('00000000-0000-0000-0000-000000005000','Future','steps',current_date+1,current_date+8,'UTC');
select is((select status from competitions where id=(select id from comps where name='future')),'scheduled','a future start is still accepted');
select throws_ok($$select create_competition('00000000-0000-0000-0000-000000005000','Over','steps',current_date-5,current_date-1,'UTC',false,true)$$,'P0001','choose a last scoring day of today or later','a competition entirely in the past is refused');
select throws_ok($$select create_competition('00000000-0000-0000-0000-000000005000','Dead','steps',current_date-5,current_date+1,'UTC',false,false)$$,'P0001','a competition that has already started needs late joins on','a past start without late joins is refused');
insert into comps select 'steps', create_competition('00000000-0000-0000-0000-000000005000','Past steps','steps',current_date-4,current_date+1,'UTC',false,true,'total');
select is((select late_joins from competitions where id=(select id from comps where name='steps')),true,'a past start with late joins is accepted');
select lives_ok($$select join_competition((select id from comps where name='steps'))$$,'late joins let you join after the start');
select is((select score from competition_standings((select id from comps where name='steps')) where user_id=auth.uid()),6500::numeric,'past days are scored from steps already imported');
-- Late joins off: joining is refused once started; on: open until the last scoring day.
reset role;
insert into competitions(group_id,creator_id,name,metric,starts_at,ends_at,timezone,late_joins) values
 ('00000000-0000-0000-0000-000000005000','00000000-0000-0000-0000-000000000050','Closed','steps',(current_date-1)::timestamp at time zone 'UTC',(current_date+2)::timestamp at time zone 'UTC','UTC',false),
 ('00000000-0000-0000-0000-000000005000','00000000-0000-0000-0000-000000000050','Ended','steps',(current_date-3)::timestamp at time zone 'UTC',(current_date)::timestamp at time zone 'UTC','UTC',true);
insert into comps select 'closed', id from competitions where name='Closed';
insert into comps select 'ended', id from competitions where name='Ended';
set local role authenticated;
select throws_ok($$select join_competition((select id from comps where name='closed'))$$,'P0001','enrollment closes when the competition starts','late joins off still closes enrollment at the start');
select throws_ok($$select join_competition((select id from comps where name='ended'))$$,'P0001','enrollment closes after the last scoring day','late joins never extend past the last scoring day');
-- Each metric scores from the imported rows.
insert into comps select 'minutes', create_competition('00000000-0000-0000-0000-000000005000','Minutes','workout_minutes',current_date-4,current_date+1,'UTC',false,true);
insert into comps select 'count', create_competition('00000000-0000-0000-0000-000000005000','Count','workout_count',current_date-4,current_date+1,'UTC',true,true);
insert into comps select 'water', create_competition('00000000-0000-0000-0000-000000005000','Water','water_days_on_target',current_date-4,current_date+1,'UTC',false,true);
insert into comps select 'active', create_competition('00000000-0000-0000-0000-000000005000','Active','active_days',current_date-4,current_date+1,'UTC',false,true);
insert into comps select 'average', create_competition('00000000-0000-0000-0000-000000005000','Average','steps',current_date-4,current_date+1,'UTC',false,true,'daily_average');
insert into comps select 'streak', create_competition('00000000-0000-0000-0000-000000005000','Streak','steps',current_date-4,current_date+1,'UTC',false,true,'best_streak');
insert into comps select 'water_streak', create_competition('00000000-0000-0000-0000-000000005000','Water streak','water_days_on_target',current_date-4,current_date+1,'UTC',false,true,'best_streak');
select join_competition(id) from comps where name in ('minutes','count','water','active','average','streak','water_streak');
select is((select score from competition_standings((select id from comps where name='minutes')) where user_id=auth.uid()),75::numeric,'workout minutes sum imported workout durations in minutes');
select is((select score from competition_standings((select id from comps where name='count')) where user_id=auth.uid()),2::numeric,'workout count counts imported workouts');
select is((select score from competition_standings((select id from comps where name='water')) where user_id=auth.uid()),2::numeric,'water days on target count days whose total reaches the target');
select is((select score from competition_standings((select id from comps where name='active')) where user_id=auth.uid()),5::numeric,'active days count days with steps above zero or a workout, once each');
-- Scoring modes: 6500 steps over 5 days scored so far; the streak is the three consecutive days before the gap.
select is((select score from competition_standings((select id from comps where name='average')) where user_id=auth.uid()),1300::numeric,'daily average divides the total by the days scored so far');
select is((select score from competition_standings((select id from comps where name='streak')) where user_id=auth.uid()),3::numeric,'best streak is the longest run of consecutive days above zero');
select is((select score from competition_standings((select id from comps where name='water_streak')) where user_id=auth.uid()),2::numeric,'best streak works for day-count metrics too');
select is((select unit from my_competition_contributions((select id from comps where name='minutes')) limit 1),'min','contributions name their unit');
select is((select count(*)::int from my_competition_contributions((select id from comps where name='active')) where unit='min'),2,'active days list workouts alongside steps');
-- The other member: a zero steps day is data, a manual-only day is excluded, a manual workout counts when the rules say so.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000150',true);
select join_competition(id) from comps where name in ('steps','count','minutes','active','streak');
select is((select score from competition_standings((select id from comps where name='steps')) where user_id=auth.uid()),0::numeric,'a recorded zero scores zero, not no data');
select is((select score from competition_standings((select id from comps where name='count')) where user_id=auth.uid()),1::numeric,'a manual workout counts when manual entries are included');
select is((select eligibility from competition_standings((select id from comps where name='minutes')) where user_id=auth.uid()),'manual_entries_excluded','a manual workout is excluded otherwise');
select is((select score from competition_standings((select id from comps where name='active')) where user_id=auth.uid()),0::numeric,'a zero steps day is not an active day');
select is((select score from competition_standings((select id from comps where name='streak')) where user_id=auth.uid()),0::numeric,'no day above zero is a streak of zero');
delete from metric_shares where user_id=auth.uid() and metric in ('workouts','water');
select throws_ok($$select join_competition((select id from comps where name='water_streak'))$$,'P0001',null,'water competitions need water sharing');
select is((select eligibility from competition_standings((select id from comps where name='count')) where user_id=auth.uid()),'not_sharing','workout competitions need workout sharing');
select * from finish();
rollback;
