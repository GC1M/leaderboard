begin;
select plan(14);
insert into auth.users(id,email) values('00000000-0000-0000-0000-000000000a51','a51@example.com'),('00000000-0000-0000-0000-000000000b51','b51@example.com'),('00000000-0000-0000-0000-000000000c51','c51@example.com');
insert into groups(id,name,invite_code,owner_id) values('00000000-0000-0000-0000-000000005100','QA sweep','QASWEEP2','00000000-0000-0000-0000-000000000a51');
insert into group_members(group_id,user_id,role) values('00000000-0000-0000-0000-000000005100','00000000-0000-0000-0000-000000000a51','owner'),('00000000-0000-0000-0000-000000005100','00000000-0000-0000-0000-000000000b51','member'),('00000000-0000-0000-0000-000000005100','00000000-0000-0000-0000-000000000c51','member');
insert into competitions(id,group_id,creator_id,name,metric,starts_at,ends_at,timezone) values('00000000-0000-0000-0000-000000005101','00000000-0000-0000-0000-000000005100','00000000-0000-0000-0000-000000000a51','Done','steps',(current_date-6)::timestamp at time zone 'UTC',(current_date-3)::timestamp at time zone 'UTC','UTC');
insert into competition_participants(competition_id,user_id) select '00000000-0000-0000-0000-000000005101',user_id from group_members where group_id='00000000-0000-0000-0000-000000005100';
insert into daily_metrics(user_id,date,metric,value,source) values('00000000-0000-0000-0000-000000000a51',current_date-5,'steps',7000,'healthkit'),('00000000-0000-0000-0000-000000000b51',current_date-5,'steps',7000,'healthkit'),('00000000-0000-0000-0000-000000000c51',current_date-5,'steps',5000,'healthkit');

insert into competitions(id,group_id,creator_id,name,metric,starts_at,ends_at,timezone) values('00000000-0000-0000-0000-000000005102','00000000-0000-0000-0000-000000005100','00000000-0000-0000-0000-000000000a51','Next','steps',(current_date+2)::timestamp at time zone 'UTC',(current_date+5)::timestamp at time zone 'UTC','UTC');
insert into competition_participants(competition_id,user_id) values('00000000-0000-0000-0000-000000005102','00000000-0000-0000-0000-000000000a51');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, true), set_config('role', 'authenticated', true);
$$;
select pg_temp.as_user('00000000-0000-0000-0000-000000000a51');

-- Profiles
select throws_ok($$update profiles set timezone='Bogus/Zone' where id=auth.uid()$$,'22023',null,'an unknown time zone is rejected');
select throws_ok($$update profiles set display_name='   ' where id=auth.uid()$$,'23514',null,'a blank name is rejected');
select throws_ok($$update profiles set display_name=repeat('x',41) where id=auth.uid()$$,'23514',null,'a name over 40 characters is rejected');

-- Numbers
select throws_ok($$insert into daily_metrics(user_id,date,metric,value,source) values(auth.uid(),current_date,'screen_min','NaN','manual')$$,'23514',null,'NaN is rejected');
select throws_ok($$insert into daily_metrics(user_id,date,metric,value,source,window_start,window_end) values(auth.uid(),current_date,'sleep_min',2000,'manual',now()-interval '1 day',now())$$,'23514',null,'manual sleep over a day is rejected');
select throws_ok($$insert into weight_measurements(user_id,measured_at,kg,source) values(auth.uid(),'2099-01-01',80,'manual')$$,'23514',null,'a future manual weight is rejected');

-- Finalized standings stay frozen
select finalize_competition('00000000-0000-0000-0000-000000005101');
update profiles set timezone='Europe/London' where id=auth.uid();
select is((select rank from competition_standings('00000000-0000-0000-0000-000000005101') where user_id=auth.uid()),1::bigint,'a later time zone change does not hide a finalized score');
select is((select rank from competition_standings('00000000-0000-0000-0000-000000005101') where user_id='00000000-0000-0000-0000-000000000c51'),3::bigint,'and does not re-rank the others');
select pg_temp.as_user('00000000-0000-0000-0000-000000000b51');
delete from group_members where group_id='00000000-0000-0000-0000-000000005100' and user_id=auth.uid();
select join_group('QASWEEP2');
insert into metric_shares(group_id,user_id,metric) values('00000000-0000-0000-0000-000000005100',auth.uid(),'steps') on conflict do nothing;
select is((select score from competition_standings('00000000-0000-0000-0000-000000005101') where user_id=auth.uid()),7000::numeric,'leaving and rejoining keeps a finalized result');

-- Owner tools
delete from metric_shares where user_id=auth.uid() and metric='steps';
insert into daily_metrics(user_id,date,metric,value,source) values(auth.uid(),(now() at time zone 'UTC')::date,'steps',100,'manual') on conflict (user_id,date,metric) do update set value=100,source='manual';
select pg_temp.as_user('00000000-0000-0000-0000-000000000a51');
select throws_ok($$select delete_member_manual_entry('00000000-0000-0000-0000-000000005100','00000000-0000-0000-0000-000000000b51','steps')$$,'P0001','this member does not share steps with the group','the owner cannot touch steps a member does not share');
select isnt((select regenerate_invite_code('00000000-0000-0000-0000-000000005100')),'QASWEEP2','the owner can replace the invite code');
select pg_temp.as_user('00000000-0000-0000-0000-000000000c51');
select throws_ok($$select regenerate_invite_code('00000000-0000-0000-0000-000000005100')$$,'P0001','only the group owner can change the invite code','members cannot replace the invite code');
select throws_ok($$select join_group('QASWEEP2')$$,'P0001','invalid invite code','the old code stops working');

-- An owner who joined a competition in their own group can delete their account
select pg_temp.as_user('00000000-0000-0000-0000-000000000a51');
select lives_ok($$select delete_my_account()$$,'an owner in their own competition can delete their account');

select * from finish();
rollback;
