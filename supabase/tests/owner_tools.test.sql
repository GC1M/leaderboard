begin;
select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@x.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'member@x.com'),
  ('00000000-0000-0000-0000-0000000000c1', 'outsider@x.com');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, true), set_config('role', 'authenticated', true);
$$;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
create temp table g as select id, invite_code from create_group('Owners');
grant select on g to authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select join_group((select invite_code from g));
-- profiles default to UTC, so the member's today is current_date in UTC
insert into daily_metrics values (auth.uid(), current_date, 'steps', 79000, 'manual', now());
insert into daily_metrics values (auth.uid(), current_date - 1, 'steps', 5000, 'healthkit', now());
insert into daily_metrics values (auth.uid(), current_date, 'weight_kg', 90, 'manual', now());
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
insert into daily_metrics values (auth.uid(), current_date, 'steps', 1000, 'manual', now());

-- non-owners can't use either tool
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select remove_member((select id from g), '00000000-0000-0000-0000-0000000000a1')$$, 'only the group owner can remove members', 'member cannot remove');
select throws_ok($$select delete_member_manual_entry((select id from g), auth.uid(), 'steps')$$, 'only the group owner can delete entries', 'member cannot use owner delete');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select delete_member_manual_entry((select id from g), '00000000-0000-0000-0000-0000000000b1', 'weight_kg')$$, 'weight entries cannot be deleted by the owner', 'owner cannot touch weight');
select throws_ok($$select delete_member_manual_entry((select id from g), '00000000-0000-0000-0000-0000000000c1', 'steps')$$, 'not a member of this group', 'owner cannot delete an outsider''s entry');
select lives_ok($$select delete_member_manual_entry((select id from g), '00000000-0000-0000-0000-0000000000b1', 'steps')$$, 'owner deletes a member''s manual steps for today');
select is((select count(*)::int from daily_metrics where user_id = '00000000-0000-0000-0000-0000000000b1' and metric = 'steps' and date = current_date), 0, 'today''s manual entry is gone');
select is((select count(*)::int from daily_metrics where user_id = '00000000-0000-0000-0000-0000000000b1' and source = 'healthkit'), 1, 'health rows are untouched');
select throws_ok($$select delete_member_manual_entry((select id from g), '00000000-0000-0000-0000-0000000000b1', 'steps')$$, 'no manual entry for today', 'deleting twice reports it');
-- "today" is the member's, from their profile timezone (UTC+14 here), not the caller's
reset role;
update profiles set timezone = 'Pacific/Kiritimati' where id = '00000000-0000-0000-0000-0000000000b1';
insert into daily_metrics values ('00000000-0000-0000-0000-0000000000b1', (now() at time zone 'Pacific/Kiritimati')::date, 'steps', 900, 'manual', now())
  on conflict (user_id, date, metric) do update set value = excluded.value, source = excluded.source;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select delete_member_manual_entry((select id from g), '00000000-0000-0000-0000-0000000000b1', 'steps')$$, 'deletes the member''s today in their timezone');
reset role;
select is((select count(*)::int from daily_metrics where user_id = '00000000-0000-0000-0000-0000000000b1' and source = 'manual' and metric = 'steps'), 0, 'their timezone''s manual row is gone');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');

select throws_ok($$select remove_member((select id from g), auth.uid())$$, 'the owner cannot be removed', 'owner cannot remove self');
select lives_ok($$select remove_member((select id from g), '00000000-0000-0000-0000-0000000000b1')$$, 'owner removes member');
select is((select count(*)::int from group_members where group_id = (select id from g)), 1, 'only the owner is left');
select throws_ok($$select remove_member((select id from g), '00000000-0000-0000-0000-0000000000b1')$$, 'not a member of this group', 'removing twice reports it');

select * from finish();
rollback;
