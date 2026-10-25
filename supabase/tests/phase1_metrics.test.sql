begin;
select plan(18);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'alice@x.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'bob@x.com');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, true), set_config('role', 'authenticated', true);
$$;

-- alice and bob share a group
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
create temp table g as select id, invite_code from create_group('G');
grant select on g to authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select join_group((select invite_code from g));

-- sleep
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$insert into daily_metrics (user_id, date, metric, value, source, window_start, window_end)
  values (auth.uid(), current_date, 'sleep_min', 450, 'healthkit', now() - interval '8 hours', now() - interval '30 minutes')$$,
  'sleep summary with its window is accepted');
select throws_ok($$insert into daily_metrics (user_id, date, metric, value, source, window_start, window_end)
  values (auth.uid(), current_date - 1, 'sleep_min', 60, 'healthkit', now(), now() - interval '1 hour')$$,
  '23514', null, 'window ending before it starts is rejected');
select throws_ok($$insert into daily_metrics (user_id, date, metric, value, source, window_start)
  values (auth.uid(), current_date - 1, 'sleep_min', 60, 'healthkit', now())$$,
  '23514', null, 'half-open window is rejected');
select lives_ok($$insert into daily_metrics values (auth.uid(), current_date, 'steps', 0, 'healthkit')$$,
  'recorded zero steps is a row, distinct from no row');
select throws_ok($$insert into daily_metrics values (auth.uid(), current_date, 'weight_kg', 70, 'manual')$$,
  '23514', null, 'weight no longer goes in daily_metrics');

-- weight
select lives_ok($$insert into weight_measurements (user_id, measured_at, kg, source) values
  (auth.uid(), '2026-10-20 07:00+00', 80.4, 'healthkit'),
  (auth.uid(), '2026-10-20 19:00+00', 80.9, 'healthkit'),
  (auth.uid(), '2026-10-21 07:00+00', 80.2, 'healthkit'),
  (auth.uid(), '2026-10-21 07:00+00', 80.0, 'manual')$$,
  'several readings per day, and same-time readings from different sources, are kept');
select is((select count(*)::int from weight_measurements), 4, 'nothing averaged or dropped');
select lives_ok($$insert into weight_measurements (user_id, measured_at, kg, source)
  values (auth.uid(), '2026-10-21 07:00+00', 80.3, 'healthkit')
  on conflict (user_id, measured_at, source) do update set kg = excluded.kg$$,
  're-importing the same reading upserts');
select is((select count(*)::int from weight_measurements), 4, 're-import does not duplicate');
select results_eq($$select kg, source from latest_weight$$, $$values (80.0::numeric, 'manual'::text)$$,
  'latest is the newest reading, manual wins a timestamp tie');
select throws_ok($$insert into weight_measurements (user_id, measured_at, kg, source) values (auth.uid(), now(), 0, 'manual')$$,
  '23514', null, 'zero kg is rejected: no reading means no row');
insert into goals (user_id, metric, start_value, target_value, start_date) values (auth.uid(), 'weight_kg', 82, 78, current_date - 10);
insert into weight_measurements (user_id, measured_at, kg, source) values (auth.uid(), now() - interval '1 minute', 80, 'healthkit');
select is((select value from group_leaderboard((select id from g), 'weight_kg', 'week') where user_id = auth.uid()), 50::numeric,
  'weight leaderboard progress reads weight_measurements');

-- group-mate view
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from daily_metrics where metric = 'steps'), 1, 'group-mate still sees steps');
select is((select count(*)::int from daily_metrics where metric = 'sleep_min'), 0, 'group-mate cannot see sleep');
select is((select count(*)::int from weight_measurements), 0, 'group-mate cannot see weight readings');
select is((select count(*)::int from latest_weight), 0, 'group-mate cannot see latest weight');
select throws_ok($$insert into weight_measurements (user_id, measured_at, kg, source)
  values ('00000000-0000-0000-0000-0000000000a1', now(), 70, 'manual')$$,
  '42501', null, 'cannot write weight for someone else');

-- account deletion takes weight with it
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select delete_my_account();
reset role;
select is((select count(*)::int from weight_measurements), 0, 'weight readings are deleted with the account');

select * from finish();
rollback;
