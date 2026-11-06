begin;
select plan(10);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'a@x.com'),
  ('00000000-0000-0000-0000-0000000000e2', 'b@x.com');

-- As the service role (the edge function): the limit counts per user and per rolling hour.
select is(food_search_allow('00000000-0000-0000-0000-0000000000e1', 2), true, 'first search allowed');
select is(food_search_allow('00000000-0000-0000-0000-0000000000e1', 2), true, 'second search allowed');
select is(food_search_allow('00000000-0000-0000-0000-0000000000e1', 2), false, 'third search over the limit');
select is(food_search_allow('00000000-0000-0000-0000-0000000000e2', 2), true, 'another user has their own count');

update food_search_log set searched_at = now() - interval '2 hours' where user_id = '00000000-0000-0000-0000-0000000000e1';
select is(food_search_allow('00000000-0000-0000-0000-0000000000e1', 2), true, 'searches older than an hour stop counting');
select is((select count(*) from food_search_log where user_id = '00000000-0000-0000-0000-0000000000e1'), 1::bigint, 'and are pruned');

-- Clients can neither read nor write the table, nor call the function.
create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, true), set_config('role', 'authenticated', true);
$$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select throws_ok($$select * from food_search_log$$, '42501', null, 'clients cannot read the log');
select throws_ok($$insert into food_search_log (user_id) values (auth.uid())$$, '42501', null, 'clients cannot write the log');
select throws_ok($$select food_search_allow(auth.uid(), 1000000)$$, '42501', null, 'clients cannot call the limiter');

-- Account deletion cascades through profiles.
reset role;
delete from auth.users where id = '00000000-0000-0000-0000-0000000000e1';
select is((select count(*) from food_search_log where user_id = '00000000-0000-0000-0000-0000000000e1'), 0::bigint, 'deleting the account deletes its search log');

select * from finish();
rollback;
