begin;
select plan(4);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a3', 'alice@x.com', '{"full_name":"Alice"}'),
  ('00000000-0000-0000-0000-0000000000b3', 'bob@x.com', '{"full_name":"Bob"}'),
  ('00000000-0000-0000-0000-0000000000c3', 'carol@x.com', '{"full_name":"Carol"}');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, true), set_config('role', 'authenticated', true);
$$;

-- Alice owns the group; Bob recorded zero steps today; Carol recorded nothing.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a3');
create temp table g as select id, invite_code from create_group('G');
grant select on g to authenticated;
reset role; -- Health rows arrive through the import RPCs, so seed them as the database owner
insert into daily_metrics (user_id, date, metric, value, source) values (auth.uid(), current_date, 'steps', 4000, 'healthkit');
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
select join_group((select invite_code from g));
insert into daily_metrics (user_id, date, metric, value, source) values (auth.uid(), current_date, 'steps', 0, 'manual');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
select join_group((select invite_code from g));

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a3');
select results_eq(
  $$select display_name, value, rank, state from group_leaderboard((select id from g), 'steps', 'day')$$,
  $$values ('Alice'::text, 4000::numeric, 1::bigint, 'recorded'::text), ('Bob', 0, 2, 'recorded'), ('Carol', null, 3, 'no_data')$$,
  'a recorded zero is a value; no rows is no_data');

-- Bob stops sharing: his zero is hidden, and so is the fact that he recorded anything.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b3');
delete from metric_shares where user_id = auth.uid() and metric = 'steps';
select results_eq(
  $$select value, state from group_leaderboard((select id from g), 'steps', 'day') where display_name = 'Bob'$$,
  $$values (0::numeric, 'recorded'::text)$$, 'you always see your own value');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a3');
select results_eq(
  $$select value, state from group_leaderboard((select id from g), 'steps', 'day') where display_name = 'Bob'$$,
  $$values (null::numeric, 'not_shared'::text)$$, 'an unshared metric carries no value');
select results_eq(
  $$select state from group_leaderboard((select id from g), 'screen_min', 'day') order by display_name$$,
  $$values ('no_data'::text), ('no_data'), ('no_data')$$, 'metrics without sharing are never not_shared');

select * from finish();
rollback;
