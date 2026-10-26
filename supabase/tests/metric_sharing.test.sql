begin;
select plan(25);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a2', 'alice@x.com', '{"full_name":"Alice"}'),
  ('00000000-0000-0000-0000-0000000000b2', 'bob@x.com', '{"full_name":"Bob"}'),
  ('00000000-0000-0000-0000-0000000000c2', 'carol@x.com', '{"full_name":"Carol"}'),
  ('00000000-0000-0000-0000-0000000000d2', 'dave@x.com', '{"full_name":"Dave"}');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, true), set_config('role', 'authenticated', true);
$$;

-- G1: bob (owner) + alice. G2: carol (owner) + alice. Dave is in neither.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
create temp table g1 as select id, invite_code from create_group('G1');
grant select on g1 to authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
create temp table g2 as select id, invite_code from create_group('G2');
grant select on g2 to authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select join_group((select invite_code from g1));
select join_group((select invite_code from g2));

insert into daily_metrics (user_id, date, metric, value, source) values (auth.uid(), current_date, 'steps', 9000, 'healthkit');
insert into daily_metrics (user_id, date, metric, value, source, window_start, window_end)
  values (auth.uid(), current_date, 'sleep_min', 420, 'healthkit', now() - interval '8 hours', now() - interval '1 hour');
insert into weight_measurements (user_id, measured_at, kg, source) values
  (auth.uid(), now() - interval '2 days', 81, 'healthkit'),
  (auth.uid(), now() - interval '1 day', 80, 'healthkit');
insert into goals (user_id, metric, start_value, target_value, start_date) values (auth.uid(), 'weight_kg', 82, 78, current_date - 10);

-- defaults
select results_eq($$select metric from metric_shares where user_id = auth.uid() order by group_id = (select id from g1) desc$$,
  $$values ('steps'::text), ('steps')$$, 'joining shares steps only; sleep and weight are off');

-- G2 opts out of steps; G1 opts into sleep and weight
select lives_ok($$delete from metric_shares where group_id = (select id from g2) and user_id = auth.uid() and metric = 'steps'$$, 'member turns steps off for one group');
select lives_ok($$insert into metric_shares (group_id, user_id, metric) values
  ((select id from g1), auth.uid(), 'sleep'), ((select id from g1), auth.uid(), 'weight')$$, 'member opts into sleep and weight for one group');
select throws_ok($$insert into metric_shares (group_id, user_id, metric) values ((select id from g1), auth.uid(), 'heart_rate')$$,
  '23514', null, 'unknown metric rejected');

-- bob (G1, where alice shares everything)
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select is((select value from daily_metrics where user_id = '00000000-0000-0000-0000-0000000000a2' and metric = 'steps'), 9000::numeric,
  'G1 mate reads shared steps');
select is((select count(*)::int from daily_metrics where user_id = '00000000-0000-0000-0000-0000000000a2' and metric = 'sleep_min'), 0,
  'sleep rows (with their asleep window) are never directly readable by peers');
select results_eq($$select user_id, minutes from group_sleep((select id from g1), current_date - 7, current_date)$$,
  $$values ('00000000-0000-0000-0000-0000000000a2'::uuid, 420::numeric)$$, 'shared sleep returns daily minutes only');
select results_eq($$select kg from group_latest_weight((select id from g1))$$, $$values (80::numeric)$$, 'shared weight returns the latest reading only');
select is((select count(*)::int from weight_measurements), 0, 'raw weight readings stay owner-only even when shared');
select is((select value from group_leaderboard((select id from g1), 'steps', 'day') where display_name = 'Alice'), 9000::numeric, 'G1 leaderboard ranks shared steps');
select is((select value from group_leaderboard((select id from g1), 'weight_kg', 'week') where display_name = 'Alice'), 50::numeric, 'G1 leaderboard shows shared weight progress');

-- owner cannot act for a member
select throws_ok($$insert into metric_shares (group_id, user_id, metric) values ((select id from g1), '00000000-0000-0000-0000-0000000000a2', 'steps')$$,
  '42501', null, 'owner cannot share for a member');
delete from metric_shares where user_id = '00000000-0000-0000-0000-0000000000a2';
update daily_metrics set value = 1 where user_id = '00000000-0000-0000-0000-0000000000a2';
reset role;
select is((select count(*)::int from metric_shares where user_id = '00000000-0000-0000-0000-0000000000a2' and group_id = (select id from g1)), 3,
  'owner cannot revoke a member''s shares');
select is((select value from daily_metrics where user_id = '00000000-0000-0000-0000-0000000000a2' and metric = 'steps'), 9000::numeric,
  'owner cannot edit a member''s measurements');

-- carol (G2, where alice shares nothing)
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
insert into daily_metrics (user_id, date, metric, value, source) values (auth.uid(), current_date, 'steps', 100, 'manual');
select is((select count(*)::int from daily_metrics where user_id = '00000000-0000-0000-0000-0000000000a2'), 0, 'G2 mate cannot read unshared steps');
select is((select count(*)::int from group_sleep((select id from g2), current_date - 7, current_date)), 0, 'G2 gets no sleep');
select is((select count(*)::int from group_latest_weight((select id from g2))), 0, 'G2 gets no weight');
select results_eq($$select value, rank from group_leaderboard((select id from g2), 'steps', 'day') where display_name = 'Alice'$$,
  $$values (0::numeric, 2::bigint)$$, 'G2 leaderboard hides unshared steps (ranked last)');
select is((select value from group_leaderboard((select id from g2), 'weight_kg', 'week') where display_name = 'Alice'), 0::numeric, 'G2 leaderboard hides weight progress');

-- non-member
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select throws_ok($$select * from group_sleep((select id from g1), current_date - 7, current_date)$$, 'not a member of this group', 'non-member cannot read group sleep');
select throws_ok($$select * from group_latest_weight((select id from g1))$$, 'not a member of this group', 'non-member cannot read group weight');
select is((select count(*)::int from metric_shares), 0, 'non-member sees no shares');

-- revoking takes effect on the next read
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
delete from metric_shares where group_id = (select id from g1) and user_id = auth.uid() and metric in ('steps', 'sleep');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select is((select count(*)::int from daily_metrics where user_id = '00000000-0000-0000-0000-0000000000a2'), 0, 'revoked steps are no longer readable');
select is((select count(*)::int from group_sleep((select id from g1), current_date - 7, current_date)), 0, 'revoked sleep is no longer returned');

-- leaving drops that group's shares
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
delete from group_members where group_id = (select id from g1) and user_id = auth.uid();
reset role;
select is((select count(*)::int from metric_shares where user_id = '00000000-0000-0000-0000-0000000000a2' and group_id = (select id from g1)), 0,
  'leaving a group removes its shares');

select * from finish();
rollback;
