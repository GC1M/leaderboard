begin;
select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'leaver@x.com'),
  ('00000000-0000-0000-0000-0000000000e1', 'stayer@x.com');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, true), set_config('role', 'authenticated', true);
$$;

-- stayer owns a group the leaver joined; leaver owns a group the stayer joined
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
create temp table kept as select id, invite_code from create_group('Kept');
grant select on kept to authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
create temp table gone as select id, invite_code from create_group('Gone');
grant select on gone to authenticated;
select join_group((select invite_code from kept));
insert into daily_metrics values (auth.uid(), current_date, 'steps', 500, 'manual', now());
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select join_group((select invite_code from gone));

select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select lives_ok($$select delete_my_account()$$, 'user deletes their own account');

reset role;
select is((select count(*)::int from auth.users where id = '00000000-0000-0000-0000-0000000000d1'), 0, 'auth user is gone');
select is((select count(*)::int from profiles where id = '00000000-0000-0000-0000-0000000000d1'), 0, 'profile is gone');
select is((select count(*)::int from daily_metrics where user_id = '00000000-0000-0000-0000-0000000000d1'), 0, 'metrics are gone');
select is((select count(*)::int from groups where id = (select id from gone)), 0, 'owned group is gone');
select is((select count(*)::int from group_members where group_id = (select id from kept)), 1, 'membership elsewhere is gone, the other owner stays');

set local role anon;
select throws_ok($$select delete_my_account()$$, '42501', null, 'anon cannot call it');

select * from finish();
rollback;
