begin;
select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a4', 'alice@x.com'),
  ('00000000-0000-0000-0000-0000000000b4', 'bob@x.com');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, true), set_config('role', 'authenticated', true);
$$;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b4');
reset role; -- Health rows arrive through the import RPCs, so seed them as the database owner
insert into daily_metrics (user_id, date, metric, value, source) values (auth.uid(), current_date, 'steps', 800, 'healthkit');
set local role authenticated;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a4');
create temp table g as select id from create_group('G');
reset role; -- Health rows arrive through the import RPCs, so seed them as the database owner
insert into daily_metrics (user_id, date, metric, value, source) values
  (auth.uid(), current_date, 'steps', 9000, 'healthkit'),
  (auth.uid(), current_date - 1, 'steps', 3000, 'manual');
set local role authenticated;
reset role; -- Health rows arrive through the import RPCs, so seed them as the database owner
insert into daily_metrics (user_id, date, metric, value, source, window_start, window_end)
  values (auth.uid(), current_date, 'sleep_min', 420, 'healthkit', now() - interval '8 hours', now() - interval '1 hour');
set local role authenticated;
reset role; -- Health rows arrive through the import RPCs, so seed them as the database owner
insert into weight_measurements (user_id, measured_at, kg, source) values
  (auth.uid(), now() - interval '1 day', 80, 'healthkit'),
  (auth.uid(), now(), 79, 'manual');
set local role authenticated;

select lives_ok($$select delete_my_health_imports()$$, 'user deletes their imported Health data');
select results_eq($$select date, value from daily_metrics where user_id = auth.uid()$$,
  $$values (current_date - 1, 3000::numeric)$$, 'imported steps and sleep are gone; manual steps stay');
select results_eq($$select kg from weight_measurements where user_id = auth.uid()$$, $$values (79::numeric)$$,
  'imported weight is gone; manual weight stays');
select is((select count(*)::int from metric_shares where user_id = auth.uid()), 1, 'sharing choices stay');

reset role;
select is((select count(*)::int from daily_metrics where user_id = '00000000-0000-0000-0000-0000000000b4'), 1, 'other users are untouched');

set local role anon;
select throws_ok($$select delete_my_health_imports()$$, '42501', null, 'anon cannot call it');

select * from finish();
rollback;
