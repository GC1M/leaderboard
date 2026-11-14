begin;
select plan(5);
-- Two members joined and share steps; a third member is in the group but never joined, a fourth joined then left.
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-000000000070','a70@example.com'),('00000000-0000-0000-0000-000000000170','b70@example.com'),
 ('00000000-0000-0000-0000-000000000270','c70@example.com'),('00000000-0000-0000-0000-000000000370','d70@example.com');
insert into groups(id,name,invite_code,owner_id) values('00000000-0000-0000-0000-000000007000','Joined','JOIN7088','00000000-0000-0000-0000-000000000070');
insert into group_members(group_id,user_id,role) values
 ('00000000-0000-0000-0000-000000007000','00000000-0000-0000-0000-000000000070','owner'),
 ('00000000-0000-0000-0000-000000007000','00000000-0000-0000-0000-000000000170','member'),
 ('00000000-0000-0000-0000-000000007000','00000000-0000-0000-0000-000000000270','member'),
 ('00000000-0000-0000-0000-000000007000','00000000-0000-0000-0000-000000000370','member');
update profiles set timezone='UTC' where id in ('00000000-0000-0000-0000-000000000070','00000000-0000-0000-0000-000000000170','00000000-0000-0000-0000-000000000270','00000000-0000-0000-0000-000000000370');
insert into daily_metrics(user_id,date,metric,value,source) values
 ('00000000-0000-0000-0000-000000000070',current_date-2,'steps',1000,'healthkit'),('00000000-0000-0000-0000-000000000170',current_date-2,'steps',2000,'healthkit');
insert into competitions(id,group_id,creator_id,name,metric,starts_at,ends_at,timezone,late_joins) values
 ('00000000-0000-0000-0000-000000007001','00000000-0000-0000-0000-000000007000','00000000-0000-0000-0000-000000000070','Joined only','steps',(current_date-2)::timestamp at time zone 'UTC',(current_date+2)::timestamp at time zone 'UTC','UTC',true);
insert into competition_participants(competition_id,user_id,status,departed_at) values
 ('00000000-0000-0000-0000-000000007001','00000000-0000-0000-0000-000000000070','joined',null),
 ('00000000-0000-0000-0000-000000007001','00000000-0000-0000-0000-000000000170','joined',null),
 ('00000000-0000-0000-0000-000000007001','00000000-0000-0000-0000-000000000370','left',now());

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000070',true);
select is((select count(*) from competition_daily_values('00000000-0000-0000-0000-000000007001')),2::bigint,'a joined participant sees every racer''s days');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000270',true);
select is((select count(*) from competition_daily_values('00000000-0000-0000-0000-000000007001')),0::bigint,'a group member who never joined sees no days');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000370',true);
select is((select count(*) from competition_daily_values('00000000-0000-0000-0000-000000007001')),0::bigint,'a member who left the competition sees no days');
-- Water days: only your own flags, never another member's (they would reveal a private target).
reset role;
insert into metric_shares(group_id,user_id,metric) values('00000000-0000-0000-0000-000000007000','00000000-0000-0000-0000-000000000070','water'),('00000000-0000-0000-0000-000000007000','00000000-0000-0000-0000-000000000170','water') on conflict do nothing;
insert into water_targets(user_id,daily_ml) values('00000000-0000-0000-0000-000000000070',1000),('00000000-0000-0000-0000-000000000170',1000);
insert into water_entries(user_id,source,health_uuid,health_device_id,consumed_at,timezone,ml) values
 ('00000000-0000-0000-0000-000000000070','healthkit',gen_random_uuid(),gen_random_uuid(),(current_date-1)::timestamp at time zone 'UTC'+interval '9 hours','UTC',1500),
 ('00000000-0000-0000-0000-000000000170','healthkit',gen_random_uuid(),gen_random_uuid(),(current_date-1)::timestamp at time zone 'UTC'+interval '9 hours','UTC',1500);
insert into competitions(id,group_id,creator_id,name,metric,starts_at,ends_at,timezone,late_joins,include_manual) values
 ('00000000-0000-0000-0000-000000007002','00000000-0000-0000-0000-000000007000','00000000-0000-0000-0000-000000000070','Water','water_days_on_target',(current_date-2)::timestamp at time zone 'UTC',(current_date+2)::timestamp at time zone 'UTC','UTC',true,true);
insert into competition_participants(competition_id,user_id) values('00000000-0000-0000-0000-000000007002','00000000-0000-0000-0000-000000000070'),('00000000-0000-0000-0000-000000007002','00000000-0000-0000-0000-000000000170');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000070',true);
select is((select array_agg(distinct user_id) from competition_daily_values('00000000-0000-0000-0000-000000007002')),array['00000000-0000-0000-0000-000000000070'::uuid],'water days come back for the caller only');
-- Finalized: standings freeze, so the live days stop.
reset role;
update competitions set status='finalized',finalized_at=now() where id='00000000-0000-0000-0000-000000007001';
set local role authenticated;
select is((select count(*) from competition_daily_values('00000000-0000-0000-0000-000000007001')),0::bigint,'a finalized competition has no live days');
select * from finish();
rollback;
