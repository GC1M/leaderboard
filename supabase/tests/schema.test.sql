begin;
select plan(29);

-- fixtures (postgres role bypasses RLS; trigger creates profiles)
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@x.com', '{"full_name":"Alice"}'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@x.com', '{}'),
  ('00000000-0000-0000-0000-00000000000c', 'carol@x.com', '{}');

select is((select display_name from profiles where id = '00000000-0000-0000-0000-00000000000a'), 'Alice', 'profile uses metadata name');
select is((select display_name from profiles where id = '00000000-0000-0000-0000-00000000000b'), 'Player 0000', 'profile falls back to a neutral name, never the email');

select ok((select bool_and(public.gen_invite_code() ~ '^[A-HJ-NP-Z2-9]{8}$') from generate_series(1, 200)), 'gen_invite_code always yields 8 unambiguous chars');

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
  (auth.uid(), current_date, 'screen_min', 100, 'manual');
insert into weight_measurements (user_id, measured_at, kg, source) values (auth.uid(), now(), 90, 'manual');
insert into goals (user_id, metric, start_value, target_value, start_date)
  values (auth.uid(), 'weight_kg', 100, 80, current_date - 30);
insert into metric_shares (group_id, user_id, metric) values ((select id from g1), auth.uid(), 'weight');
select throws_ok($$insert into daily_metrics values (auth.uid(), current_date - 5, 'steps', 80001, 'manual')$$, '23514', null, 'manual steps over 80000 rejected');
select lives_ok($$insert into daily_metrics values (auth.uid(), current_date - 5, 'steps', 80000, 'manual')$$, 'manual steps at cap accepted');
reset role; -- checks on Health rows, which only the import RPCs write, run as the database owner
select lives_ok($$insert into daily_metrics values (auth.uid(), current_date - 6, 'steps', 100000, 'healthkit')$$, 'health steps above manual cap accepted');
select is((select value from daily_metrics where user_id = auth.uid() and date = current_date - 6 and metric = 'steps'), 100000::numeric, 'health steps stored uncapped');
select throws_ok($$update daily_metrics set source = 'manual' where user_id = auth.uid() and date = current_date - 6 and metric = 'steps'$$, '23514', null, 'uncapped health row cannot become manual');
delete from daily_metrics where user_id = auth.uid() and date = current_date - 6 and metric = 'steps';
select throws_ok($$insert into daily_metrics values (auth.uid(), current_date - 6, 'steps', 'NaN', 'healthkit')$$, '23514', null, 'NaN steps rejected');
select throws_ok($$insert into daily_metrics values (auth.uid(), current_date - 6, 'steps', 'Infinity', 'healthkit')$$, '23514', null, 'infinite steps rejected');
select throws_ok($$insert into daily_metrics values (auth.uid(), current_date - 6, 'steps', 1.5, 'healthkit')$$, '23514', null, 'fractional steps rejected');
set local role authenticated;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into daily_metrics (user_id, date, metric, value, source) values
  (auth.uid(), current_date, 'steps', 7000, 'manual');
insert into weight_measurements (user_id, measured_at, kg, source) values (auth.uid(), now(), 95, 'manual');
insert into goals (user_id, metric, start_value, target_value, start_date)
  values (auth.uid(), 'weight_kg', 100, 80, current_date - 30);

-- RLS isolation / privacy
select is((select count(*)::int from group_steps((select id from g1), current_date - 30, current_date) where user_id = '00000000-0000-0000-0000-00000000000a'), 4, 'group-mate sees steps');
select is((select count(*)::int from weight_measurements where user_id = '00000000-0000-0000-0000-00000000000a'), 0, 'group-mate cannot read raw weight');
select is((select count(*)::int from goals where user_id = '00000000-0000-0000-0000-00000000000a'), 0, 'group-mate cannot read weight goal');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select is((select count(*)::int from daily_metrics where user_id <> auth.uid()), 0, 'non-member sees no metrics');
select is((select count(*)::int from profiles), 1, 'non-member sees only own profile');
select throws_ok($$select * from group_leaderboard((select id from g1), 'steps', 'day')$$, 'not a member of this group', 'non-member cannot read leaderboard');

-- leaderboard
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select results_eq(
  $$select display_name, value, rank from group_leaderboard((select id from g1), 'steps', 'day')$$,
  $$values ('Player 0000'::text, 7000::numeric, 1::bigint), ('Alice', 5000, 2)$$, 'day ranking order');
select is(
  (select value from group_leaderboard((select id from g1), 'steps', 'week') where display_name = 'Alice'),
  (select sum(steps) from group_steps((select id from g1), date_trunc('week', current_date)::date, current_date + 7) where user_id = '00000000-0000-0000-0000-00000000000a'),
  'week window starts Monday');
select ok(
  (select value from group_leaderboard((select id from g1), 'steps', 'week') where display_name = 'Alice')
  < (select sum(steps) from group_steps((select id from g1), current_date - 30, current_date + 7) where user_id = '00000000-0000-0000-0000-00000000000a'),
  'week window excludes older rows');
select results_eq(
  $$select value from group_leaderboard((select id from g1), 'weight_kg', 'week') order by rank$$,
  $$values (50::numeric), (25)$$, 'weight is % progress, not kg');

select results_eq(
  $$select display_name, rank from group_leaderboard((select id from g1), 'screen_min', 'day') order by rank$$,
  $$values ('Alice'::text, 1::bigint), ('Player 0000', 2)$$, 'member with no screen_min data ranks last');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
delete from group_members where user_id = auth.uid();
select is((select count(*)::int from group_members where group_id = (select id from g1) and role = 'owner'), 1, 'owner cannot leave own group');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
delete from group_members where user_id = auth.uid();
select is((select count(*)::int from group_members where group_id = (select id from g1)), 0, 'member can leave (no longer sees group)');

select * from finish();
rollback;
