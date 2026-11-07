begin;
select plan(18);
-- #43: live (not yet finalized) lifecycle, permissions and timezone boundaries.
insert into auth.users(id,email) values
  ('00000000-0000-0000-0000-000000000043','owner43@example.com'),
  ('00000000-0000-0000-0000-000000000143','member43@example.com'),
  ('00000000-0000-0000-0000-000000000243','utc43@example.com'),
  ('00000000-0000-0000-0000-000000000343','outsider43@example.com'),
  ('00000000-0000-0000-0000-000000000443','watcher43@example.com'),
  ('00000000-0000-0000-0000-000000000543','deleted43@example.com');
update profiles set timezone='America/Los_Angeles' where id<>'00000000-0000-0000-0000-000000000243' and id::text like '%43';
update profiles set timezone='UTC' where id='00000000-0000-0000-0000-000000000243';
insert into groups(id,name,invite_code,owner_id) values('00000000-0000-0000-0000-000000004300','Validation','VALID438','00000000-0000-0000-0000-000000000043');
insert into group_members(group_id,user_id,role) values
  ('00000000-0000-0000-0000-000000004300','00000000-0000-0000-0000-000000000043','owner'),
  ('00000000-0000-0000-0000-000000004300','00000000-0000-0000-0000-000000000143','member'),
  ('00000000-0000-0000-0000-000000004300','00000000-0000-0000-0000-000000000243','member'),
  ('00000000-0000-0000-0000-000000004300','00000000-0000-0000-0000-000000000443','member'),
  ('00000000-0000-0000-0000-000000004300','00000000-0000-0000-0000-000000000543','member');
-- Running now: started three local days ago in Los Angeles, ends in two.
insert into competitions(id,group_id,creator_id,name,metric,starts_at,ends_at,timezone) values('00000000-0000-0000-0000-000000004301','00000000-0000-0000-0000-000000004300','00000000-0000-0000-0000-000000000043','Live steps','steps',
  (current_date-3)::timestamp at time zone 'America/Los_Angeles',(current_date+2)::timestamp at time zone 'America/Los_Angeles','America/Los_Angeles');
insert into competition_participants(competition_id,user_id) select '00000000-0000-0000-0000-000000004301',user_id from group_members
  where group_id='00000000-0000-0000-0000-000000004300' and user_id<>'00000000-0000-0000-0000-000000000443';
insert into daily_metrics(user_id,date,metric,value,source) values
  ('00000000-0000-0000-0000-000000000043',current_date-4,'steps',5000,'healthkit'),
  ('00000000-0000-0000-0000-000000000043',current_date-3,'steps',100,'healthkit'),
  ('00000000-0000-0000-0000-000000000143',current_date-1,'steps',300,'healthkit'),
  ('00000000-0000-0000-0000-000000000243',current_date-1,'steps',400,'healthkit'),
  ('00000000-0000-0000-0000-000000000543',current_date-1,'steps',50,'healthkit');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000043',true);
set local role authenticated;
create temp table live as select * from competition_standings('00000000-0000-0000-0000-000000004301');
select is((select score from live where user_id=auth.uid()),100::numeric,'local start day counts and the day before does not');
select is((select eligibility from live where user_id='00000000-0000-0000-0000-000000000243'),'timezone_mismatch','a participant in another timezone is flagged');
select is((select score from live where user_id='00000000-0000-0000-0000-000000000243'),null,'a timezone mismatch never shows a score');
select is((select rank from live where user_id='00000000-0000-0000-0000-000000000143'),1::bigint,'live standings rank by score');
reset role;
insert into daily_metrics(user_id,date,metric,value,source) values('00000000-0000-0000-0000-000000000043',current_date-2,'steps',500,'healthkit');
set local role authenticated;
select is((select rank from competition_standings('00000000-0000-0000-0000-000000004301') where user_id=auth.uid()),1::bigint,'a new sync updates live standings immediately');
select throws_ok($$select finalize_competition('00000000-0000-0000-0000-000000004301')$$,'P0001','finalization opens 24 hours after the end','a running competition cannot be finalized');

-- Members who are not participants can watch but not finalize.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000443',true);
select is((select count(*)::int from competition_standings('00000000-0000-0000-0000-000000004301') where user_id=auth.uid()),0,'a watching member is not listed');
select throws_ok($$select finalize_competition('00000000-0000-0000-0000-000000004301')$$,'P0001','only participants, the creator or group owner can finalize','a watching member cannot finalize');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000343',true);
select throws_ok($$select * from competition_standings('00000000-0000-0000-0000-000000004301')$$,'P0001','competition unavailable','outsiders cannot read standings');

-- Revoking sharing mid-competition hides the live score and its source counts.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000143',true);
delete from metric_shares where user_id=auth.uid() and metric='steps';
select is((select eligibility from competition_standings('00000000-0000-0000-0000-000000004301') where user_id=auth.uid()),'not_sharing','revocation is reflected live');
select is((select coalesce(score,0)+manual_entries+health_entries+excluded_entries from competition_standings('00000000-0000-0000-0000-000000004301') where user_id=auth.uid()),0::numeric,'revocation masks the live score and counts');
select lives_ok($$select leave_competition('00000000-0000-0000-0000-000000004301')$$,'a participant can leave mid-competition');
select is((select count(*)::int from competition_standings('00000000-0000-0000-0000-000000004301') where user_id=auth.uid()),0,'a participant who left is no longer listed');

reset role;
delete from group_members where user_id='00000000-0000-0000-0000-000000000243';
select is((select status from competition_participants where user_id='00000000-0000-0000-0000-000000000243'),'left','leaving the group ends competition participation');
select lives_ok($$delete from auth.users where id='00000000-0000-0000-0000-000000000543'$$,'a participant can delete their account mid-competition');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000043',true);
set local role authenticated;
select is((select count(*)::int from competition_standings('00000000-0000-0000-0000-000000004301') where user_id='00000000-0000-0000-0000-000000000543'),0,'a deleted account disappears from standings');
set local role anon;
select throws_ok($$select * from competition_standings('00000000-0000-0000-0000-000000004301')$$,'42501',null,'anonymous callers cannot read standings');
reset role;
-- Concurrent finalizations lock the competition row; the key keeps one frozen row per participant either way.
select col_is_pk('public','competition_results',array['competition_id','user_id'],'one frozen result per participant');
select * from finish();
rollback;
