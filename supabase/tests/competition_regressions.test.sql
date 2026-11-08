begin;
select plan(24);
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-000000000043','a43@example.com'),
 ('00000000-0000-0000-0000-000000000143','b43@example.com'),
 ('00000000-0000-0000-0000-000000000243','c43@example.com'),
 ('00000000-0000-0000-0000-000000000343','outsider43@example.com');
update profiles set timezone='America/New_York' where id::text like '%0043' or id::text like '%0143' or id::text like '%0243';
insert into groups(id,name,invite_code,owner_id) values('00000000-0000-0000-0000-000000004300','Fairness','FAIR4388','00000000-0000-0000-0000-000000000043');
insert into group_members(group_id,user_id,role) values
 ('00000000-0000-0000-0000-000000004300','00000000-0000-0000-0000-000000000043','owner'),
 ('00000000-0000-0000-0000-000000004300','00000000-0000-0000-0000-000000000143','member'),
 ('00000000-0000-0000-0000-000000004300','00000000-0000-0000-0000-000000000243','member');
insert into competitions(id,group_id,creator_id,name,metric,starts_at,ends_at,timezone,include_manual) values
 ('00000000-0000-0000-0000-000000004301','00000000-0000-0000-0000-000000004300','00000000-0000-0000-0000-000000000043','Spring','steps','2026-03-08 05:00Z','2026-03-09 04:00Z','America/New_York',false),
 ('00000000-0000-0000-0000-000000004302','00000000-0000-0000-0000-000000004300','00000000-0000-0000-0000-000000000043','Fall','steps','2025-11-02 04:00Z','2025-11-03 05:00Z','America/New_York',true);
insert into competition_participants(competition_id,user_id) select c.id,m.user_id from competitions c cross join group_members m where m.group_id=c.group_id;
insert into daily_metrics(user_id,date,metric,value,source) values
 ('00000000-0000-0000-0000-000000000043','2026-03-08','steps',100,'healthkit'),
 ('00000000-0000-0000-0000-000000000143','2026-03-08','steps',100,'healthkit'),
 ('00000000-0000-0000-0000-000000000243','2026-03-08','steps',0,'healthkit'),
 ('00000000-0000-0000-0000-000000000043','2026-03-09','steps',999,'healthkit'),
 ('00000000-0000-0000-0000-000000000043','2025-11-02','steps',50,'manual');
select is((select extract(epoch from ends_at-starts_at)::int/3600 from competitions where name='Spring'),23,'spring uses one local day, not 24 elapsed hours');
select is((select extract(epoch from ends_at-starts_at)::int/3600 from competitions where name='Fall'),25,'fall uses one local day, not 24 elapsed hours');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000043',true);set local role authenticated;
select is((select score from competition_standings('00000000-0000-0000-0000-000000004301') where user_id=auth.uid()),100::numeric,'spring start included and end excluded');
select is((select count(*)::int from competition_standings('00000000-0000-0000-0000-000000004301') where rank=1),2,'equal scores tie');
select is((select rank from competition_standings('00000000-0000-0000-0000-000000004301') where score=0),3::bigint,'recorded zero follows shared first places at rank 3');
select is((select count(*)::int from my_competition_contributions('00000000-0000-0000-0000-000000004301')),1,'source explanations expose only own in-period readings');
select is((select score from competition_standings('00000000-0000-0000-0000-000000004302') where user_id=auth.uid()),50::numeric,'manual entries count only when enabled at creation');
update daily_metrics set value=150001 where user_id=auth.uid() and date='2026-03-08' and metric='steps';
select is((select score from competition_standings('00000000-0000-0000-0000-000000004301') where user_id=auth.uid()),150001::numeric,'review flags never silently alter measurements');
select is((select flagged from my_competition_contributions('00000000-0000-0000-0000-000000004301')),true,'unusually high readings ask for review');
select is((select count(*)::int from competition_audit where competition_id='00000000-0000-0000-0000-000000004301' and target_id=auth.uid() and event='contribution_changed'),2,'insert and correction each record generic activity');
update profiles set timezone='UTC' where id=auth.uid();
select is((select eligibility from competition_standings('00000000-0000-0000-0000-000000004301') where user_id=auth.uid()),'timezone_mismatch','travel does not silently remap local-date totals');
select is((select score from competition_standings('00000000-0000-0000-0000-000000004301') where user_id=auth.uid()),null,'timezone mismatch masks score');
select is((select updated_at from competition_standings('00000000-0000-0000-0000-000000004301') where user_id=auth.uid()),null,'timezone mismatch masks source freshness');
select is((select reason from my_competition_contributions('00000000-0000-0000-0000-000000004301')),'timezone_mismatch','own explanation matches eligibility');
update profiles set timezone='America/New_York' where id=auth.uid();
select throws_ok($$select leave_competition('00000000-0000-0000-0000-000000004301')$$,'P0001','leaving closes when the competition ends','enrolled participant cannot leave after the end');
select throws_ok($$select finalize_competition(create_competition('00000000-0000-0000-0000-000000004300','Too early','steps',current_date+2,current_date+3,'UTC'))$$,'P0001','finalization opens 24 hours after the end','creator cannot finalize before the grace period');
reset role;
delete from group_members where user_id='00000000-0000-0000-0000-000000000143';
select is((select status from competition_participants where competition_id='00000000-0000-0000-0000-000000004301' and user_id='00000000-0000-0000-0000-000000000143'),'left','group departure ends participation');
insert into group_members(group_id,user_id,role) values('00000000-0000-0000-0000-000000004300','00000000-0000-0000-0000-000000000143','member');
set local role authenticated;
select is((select count(*)::int from competition_standings('00000000-0000-0000-0000-000000004301') where user_id='00000000-0000-0000-0000-000000000143'),0,'returning to group never restores competition consent');
reset role;
delete from auth.users where id='00000000-0000-0000-0000-000000000243';
set local role authenticated;
select is((select count(*)::int from competition_standings('00000000-0000-0000-0000-000000004301')),1,'account deletion removes participation without breaking scoring');
reset role;
-- A non-owner creator can delete their account while the group survives. NULL must never grant powers.
update competitions set creator_id=null where id='00000000-0000-0000-0000-000000004301';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000143',true);set local role authenticated;
select throws_ok($$select moderate_competition('00000000-0000-0000-0000-000000004301','cancel','Not my competition')$$,'P0001','only the creator or current group owner can moderate','deleted creator does not authorize an ordinary member');
select throws_ok($$select finalize_competition('00000000-0000-0000-0000-000000004301')$$,'P0001','only participants, the creator or group owner can finalize','deleted creator does not authorize a nonparticipant');
select throws_ok($$select join_competition('00000000-0000-0000-0000-000000004301')$$,'P0001','enrollment closes when the competition starts','former participant cannot enroll after the start');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000343',true);
select throws_ok($$select * from competition_standings('00000000-0000-0000-0000-000000004301')$$,'P0001','competition unavailable','outsider cannot read standings');
select throws_ok($$select * from my_competition_contributions('00000000-0000-0000-0000-000000004301')$$,'P0001','competition unavailable','outsider cannot read contribution explanations');
select * from finish();
rollback;
