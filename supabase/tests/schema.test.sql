begin;
select plan(19);

-- fixtures (postgres role bypasses RLS; trigger creates profiles)
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@x.com', '{"full_name":"Alice"}'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@x.com', '{}'),
  ('00000000-0000-0000-0000-00000000000c', 'carol@x.com', '{}');

select is((select display_name from profiles where id = '00000000-0000-0000-0000-00000000000a'), 'Alice', 'profile uses metadata name');
select is((select display_name from profiles where id = '00000000-0000-0000-0000-00000000000b'), 'bob', 'profile falls back to email prefix');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, true), set_config('role', 'authenticated', true);
$$;

-- alice creates group G1, bob joins; carol creates G2
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
create temp table g1 as select id, invite_code from create_group('G1');
grant select on g1 to authenticated;
select matches((select invite_code from g1), '^[A-HJ-NP-Z2-9]{8}$', 'invite code is 8 unambiguous chars');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select create_group('G2');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select throws_ok($$select join_group('NOPE0000')$$, 'invalid invite code', 'bad code rejected');
select lives_ok($$select join_group(lower((select invite_code from g1)))$$, 'good code (any case) joins');
select is((select count(*)::int from group_members where group_id = (select id from g1)), 2, 'bob sees both members of G1');
select throws_ok($$insert into group_members (group_id, user_id) values ((select id from g1), '00000000-0000-0000-0000-00000000000c')$$, '42501', null, 'no direct insert on group_members');

-- metrics: today in UTC (profiles default to UTC)
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into daily_metrics (user_id, date, metric, value, source) values
  (auth.uid(), current_date, 'steps', 5000, 'manual'),
  (auth.uid(), current_date - 1, 'steps', 100, 'manual'),
  (auth.uid(), current_date - 7, 'steps', 1000, 'manual'),
  (auth.uid(), current_date, 'weight_kg', 90, 'manual');
insert into goals (user_id, metric, start_value, target_value, start_date)
  values (auth.uid(), 'weight_kg', 100, 80, current_date - 30);
select throws_ok($$insert into daily_metrics values (auth.uid(), current_date - 5, 'steps', 80001, 'manual')$$, '23514', null, 'steps over 80000 rejected');
select lives_ok($$insert into daily_metrics values (auth.uid(), current_date - 5, 'steps', 80000, 'manual')$$, 'steps at cap accepted');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into daily_metrics (user_id, date, metric, value, source) values
  (auth.uid(), current_date, 'steps', 7000, 'manual'),
  (auth.uid(), current_date, 'weight_kg', 95, 'manual');
insert into goals (user_id, metric, start_value, target_value, start_date)
  values (auth.uid(), 'weight_kg', 100, 80, current_date - 30);

-- RLS isolation / privacy
select is((select count(*)::int from daily_metrics where user_id = '00000000-0000-0000-0000-00000000000a' and metric = 'steps'), 4, 'group-mate sees steps');
select is((select count(*)::int from daily_metrics where user_id = '00000000-0000-0000-0000-00000000000a' and metric = 'weight_kg'), 0, 'group-mate cannot read raw weight');
select is((select count(*)::int from goals where user_id = '00000000-0000-0000-0000-00000000000a'), 0, 'group-mate cannot read weight goal');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select is((select count(*)::int from daily_metrics where user_id <> auth.uid()), 0, 'non-member sees no metrics');
select is((select count(*)::int from profiles), 1, 'non-member sees only own profile');
select throws_ok($$select * from group_leaderboard((select id from g1), 'steps', 'day')$$, 'not a member of this group', 'non-member cannot read leaderboard');

-- leaderboard
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select results_eq(
  $$select display_name, value, rank from group_leaderboard((select id from g1), 'steps', 'day')$$,
  $$values ('bob'::text, 7000::numeric, 1::bigint), ('Alice', 5000, 2)$$, 'day ranking order');
select is(
  (select value from group_leaderboard((select id from g1), 'steps', 'week') where display_name = 'Alice'),
  (select sum(value) from daily_metrics where user_id = '00000000-0000-0000-0000-00000000000a' and metric = 'steps' and date >= date_trunc('week', current_date)),
  'week window starts Monday');
select ok(
  (select value from group_leaderboard((select id from g1), 'steps', 'week') where display_name = 'Alice')
  < (select sum(value) from daily_metrics where user_id = '00000000-0000-0000-0000-00000000000a' and metric = 'steps'),
  'week window excludes older rows');
select results_eq(
  $$select value from group_leaderboard((select id from g1), 'weight_kg', 'week') order by rank$$,
  $$values (50::numeric), (25)$$, 'weight is % progress, not kg');

select * from finish();
rollback;
