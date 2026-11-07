begin;
select plan(8);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a5', 'alice@x.com'),
  ('00000000-0000-0000-0000-0000000000b5', 'bob@x.com');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, true), set_config('role', 'authenticated', true);
$$;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a5');
select is(record_health_export('weight', 'r1', '10000000-0000-0000-0000-000000000001', 5, '20000000-0000-0000-0000-000000000001'),
  true, 'first export is recorded');
select is(record_health_export('weight', 'r1', '10000000-0000-0000-0000-000000000002', 5, '20000000-0000-0000-0000-000000000002'),
  false, 'a retry with the same version does not replace it');
select is(record_health_export('weight', 'r1', '10000000-0000-0000-0000-000000000003', 3, '20000000-0000-0000-0000-000000000002'),
  false, 'an older edit cannot replace a newer one');
select is(record_health_export('weight', 'r1', '10000000-0000-0000-0000-000000000004', 6, '20000000-0000-0000-0000-000000000002'),
  true, 'a newer edit replaces it');
select results_eq($$select sample_uuid, sync_version from health_exports$$,
  $$values ('10000000-0000-0000-0000-000000000004'::uuid, 6::bigint)$$, 'one mapping row holds the newest version');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b5');
select is((select count(*)::int from health_exports), 0, 'another user cannot read it');
select throws_ok($$insert into health_exports(user_id, kind, record_id, sync_version, device_id)
  values ('00000000-0000-0000-0000-0000000000a5', 'weight', 'r2', 1, '20000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'cannot write a row for someone else');

reset role;
delete from auth.users where id = '00000000-0000-0000-0000-0000000000a5';
select is((select count(*)::int from health_exports), 0, 'account deletion removes the mappings');

select * from finish();
rollback;
