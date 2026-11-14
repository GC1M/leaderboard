begin;
select plan(9);
-- Two members share steps; a third member joined but does not share, and a non-member exists too.
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-000000000060','a60@example.com'),('00000000-0000-0000-0000-000000000160','b60@example.com'),
 ('00000000-0000-0000-0000-000000000260','c60@example.com'),('00000000-0000-0000-0000-000000000360','d60@example.com');
insert into groups(id,name,invite_code,owner_id) values('00000000-0000-0000-0000-000000006000','Race','RACE6088','00000000-0000-0000-0000-000000000060');
insert into group_members(group_id,user_id,role) values
 ('00000000-0000-0000-0000-000000006000','00000000-0000-0000-0000-000000000060','owner'),
 ('00000000-0000-0000-0000-000000006000','00000000-0000-0000-0000-000000000160','member'),
 ('00000000-0000-0000-0000-000000006000','00000000-0000-0000-0000-000000000260','member');
-- Joining a group shares steps by default; the third member turns that off.
delete from metric_shares where group_id='00000000-0000-0000-0000-000000006000' and user_id='00000000-0000-0000-0000-000000000260' and metric='steps';
update profiles set timezone='UTC' where id in ('00000000-0000-0000-0000-000000000060','00000000-0000-0000-0000-000000000160','00000000-0000-0000-0000-000000000260');
insert into daily_metrics(user_id,date,metric,value,source) values
 ('00000000-0000-0000-0000-000000000060',current_date-3,'steps',1000,'healthkit'),('00000000-0000-0000-0000-000000000060',current_date-1,'steps',3000,'healthkit'),
 ('00000000-0000-0000-0000-000000000060',current_date-2,'steps',700,'manual'),
 ('00000000-0000-0000-0000-000000000160',current_date-3,'steps',500,'healthkit'),('00000000-0000-0000-0000-000000000160',current_date-2,'steps',500,'healthkit'),
 ('00000000-0000-0000-0000-000000000260',current_date-3,'steps',9000,'healthkit');
insert into competitions(id,group_id,creator_id,name,metric,starts_at,ends_at,timezone,late_joins,include_manual) values
 ('00000000-0000-0000-0000-000000006001','00000000-0000-0000-0000-000000006000','00000000-0000-0000-0000-000000000060','Race','steps',(current_date-3)::timestamp at time zone 'UTC',(current_date+2)::timestamp at time zone 'UTC','UTC',true,false);
insert into competition_participants(competition_id,user_id) values
 ('00000000-0000-0000-0000-000000006001','00000000-0000-0000-0000-000000000060'),
 ('00000000-0000-0000-0000-000000006001','00000000-0000-0000-0000-000000000160'),
 ('00000000-0000-0000-0000-000000006001','00000000-0000-0000-0000-000000000260');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000160',true);
set local role authenticated;
select is((select count(*) from competition_daily_values('00000000-0000-0000-0000-000000006001') where user_id='00000000-0000-0000-0000-000000000060'),2::bigint,'a member sees the other sharing participant''s days with counted steps');
select is((select value from competition_daily_values('00000000-0000-0000-0000-000000006001') where user_id='00000000-0000-0000-0000-000000000060' and day=current_date-1),3000::numeric,'each day carries that day''s counted value');
select is((select count(*) from competition_daily_values('00000000-0000-0000-0000-000000006001') where user_id='00000000-0000-0000-0000-000000000060' and day=current_date-2),0::bigint,'a day with only excluded manual entries is absent, not zero');
select is((select count(*) from competition_daily_values('00000000-0000-0000-0000-000000006001') where user_id='00000000-0000-0000-0000-000000000260'),0::bigint,'a participant who does not share the metric has no days, matching the standings');
select is((select sum(value) from competition_daily_values('00000000-0000-0000-0000-000000006001') where user_id='00000000-0000-0000-0000-000000000160'),(select score from competition_standings('00000000-0000-0000-0000-000000006001') where user_id='00000000-0000-0000-0000-000000000160'),'the days add up to the standing score');
select is((select score from competition_standings('00000000-0000-0000-0000-000000006001') where user_id='00000000-0000-0000-0000-000000000060'),4000::numeric,'live scores still total the counted days after the refactor');
select throws_ok($$select * from competition_day_values('00000000-0000-0000-0000-000000006001')$$,'42501',null,'the internal day values are not callable by members');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000360',true);
select throws_ok($$select * from competition_daily_values('00000000-0000-0000-0000-000000006001')$$,'P0001','competition unavailable','a non-member is refused');

reset role;
update competitions set status='cancelled',cancelled_at=now() where id='00000000-0000-0000-0000-000000006001';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000160',true);
set local role authenticated;
select is((select count(*) from competition_daily_values('00000000-0000-0000-0000-000000006001')),0::bigint,'a cancelled competition has no days');
select * from finish();
rollback;
