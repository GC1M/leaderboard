-- QA (#58): water sharing and revocation as signed-in users.
begin;
select plan(24);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000001a1', 'qa-alice@w.com', '{"full_name":"Alice"}'),
  ('00000000-0000-0000-0000-0000000001b1', 'qa-bob@w.com', '{"full_name":"Bob"}'),
  ('00000000-0000-0000-0000-0000000001c1', 'qa-carol@w.com', '{"full_name":"Carol"}'),
  ('00000000-0000-0000-0000-0000000001d1', 'qa-dave@w.com', '{"full_name":"Dave"}');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, true), set_config('role', 'authenticated', true);
$$;

-- G1: bob (owner), alice, carol. G2: dave (owner), alice.
select pg_temp.as_user('00000000-0000-0000-0000-0000000001b1');
create temp table g1 as select id, invite_code from create_group('G1');
grant select on g1 to authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000001d1');
create temp table g2 as select id, invite_code from create_group('G2');
grant select on g2 to authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000001c1');
select join_group((select invite_code from g1));
select pg_temp.as_user('00000000-0000-0000-0000-0000000001a1');
select join_group((select invite_code from g1));
select join_group((select invite_code from g2));

-- Alice: two drinks on Nov 5 (UTC), one on Nov 3, a recorded 0 mL Health sample on Nov 1, a target.
insert into water_entries (user_id, source, client_id, consumed_at, timezone, ml, source_name) values
  (auth.uid(), 'manual', gen_random_uuid(), '2026-11-05 08:00+00', 'UTC', 250, 'Secret'),
  (auth.uid(), 'manual', gen_random_uuid(), '2026-11-05 12:00+00', 'UTC', 300, null),
  (auth.uid(), 'manual', gen_random_uuid(), '2026-11-03 12:00+00', 'UTC', 400, null);
select apply_health_water(auth.uid(), gen_random_uuid(),
  '[{"health_uuid":"aaaaaaaa-0000-0000-0000-000000000001","ml":0,"consumed_at":"2026-11-01T12:00:00Z","timezone":"UTC","source_name":"Bottle"}]', '{}');
insert into water_targets (user_id, daily_ml) values (auth.uid(), 2000);

-- Off by default.
select pg_temp.as_user('00000000-0000-0000-0000-0000000001b1');
select is((select count(*) from group_water((select id from g1), '2026-10-30', '2026-11-06'))::int, 0, 'not shared by default');

select pg_temp.as_user('00000000-0000-0000-0000-0000000001a1');
insert into metric_shares (group_id, user_id, metric) values ((select id from g1), auth.uid(), 'water');

select pg_temp.as_user('00000000-0000-0000-0000-0000000001b1');
select results_eq($$select local_date::text, total_ml from group_water((select id from g1), '2026-10-30', '2026-11-06')$$,
  $$values ('2026-11-01', 0::numeric), ('2026-11-03', 400::numeric), ('2026-11-05', 550::numeric)$$,
  'one total per day with entries; days without entries absent; a 0 mL Health day is a recorded 0');
select is((select proargnames[4:] from pg_proc where oid = 'public.group_water(uuid, date, date)'::regprocedure),
  array['user_id', 'local_date', 'total_ml'],
  'group_water returns only user, day and total');

-- Shared in G1 only: G2 sees nothing.
select pg_temp.as_user('00000000-0000-0000-0000-0000000001d1');
select is((select count(*) from group_water((select id from g2), '2026-10-30', '2026-11-06'))::int, 0, 'a share in G1 is not visible from G2');
select throws_ok($$select * from group_water((select id from g1), '2026-11-01', '2026-11-06')$$, 'P0001',
  'not a member of this group', 'a non-member cannot read group water');

-- Range edges.
select pg_temp.as_user('00000000-0000-0000-0000-0000000001b1');
select lives_ok($$select * from group_water((select id from g1), '2026-10-06', '2026-11-05')$$, '31 days, both ends included');
select throws_ok($$select * from group_water((select id from g1), '2026-10-05', '2026-11-05')$$, '22023', null, '32 days rejected');
select throws_ok($$select * from group_water((select id from g1), '2026-11-05', '2026-11-04')$$, '22023', null, 'inverted rejected');
select throws_ok($$select * from group_water((select id from g1), null, '2026-11-04')$$, '22023', null, 'null bound rejected');
select throws_ok($$select * from group_water((select id from g1), '0001-01-01', '9999-12-31')$$, '22023', null, 'huge range rejected');

-- Direct reads and writes on someone else's water.
select is((select count(*) from water_entries)::int, 0, 'a member cannot read another''s entries');
select is((select count(*) from water_targets)::int, 0, 'a member cannot read another''s target');
select is((select count(*) from water_history_cutoffs)::int, 0, 'a member cannot read another''s cutoff');
select throws_ok($$insert into metric_shares (group_id, user_id, metric)
  values ((select id from g1), '00000000-0000-0000-0000-0000000001a1', 'water')$$, '42501', null, 'cannot share for another member');
select throws_ok($$insert into metric_shares (group_id, user_id, metric)
  values ((select id from g2), auth.uid(), 'water')$$, '23503', null, 'cannot share with a group you are not in');
update metric_shares set metric = 'sleep' where user_id = '00000000-0000-0000-0000-0000000001a1' and metric = 'water';
delete from metric_shares where user_id = '00000000-0000-0000-0000-0000000001a1' and metric = 'water';
select is((select count(*) from metric_shares where user_id = '00000000-0000-0000-0000-0000000001a1' and metric = 'water')::int, 1,
  'another member cannot change or remove a share');
select throws_ok($$select apply_health_water('00000000-0000-0000-0000-0000000001a1', gen_random_uuid(), '[]', '{}')$$,
  'P0001', 'Health account changed', 'cannot import water for someone else');

-- Revocation is immediate.
select pg_temp.as_user('00000000-0000-0000-0000-0000000001a1');
delete from metric_shares where group_id = (select id from g1) and user_id = auth.uid() and metric = 'water';
select pg_temp.as_user('00000000-0000-0000-0000-0000000001b1');
select is((select count(*) from group_water((select id from g1), '2026-10-30', '2026-11-06'))::int, 0, 'revoked: gone on the next read');

-- Removal drops the share, a rejoin does not restore it, and the removed member cannot read the group.
select pg_temp.as_user('00000000-0000-0000-0000-0000000001a1');
insert into metric_shares (group_id, user_id, metric) values ((select id from g1), auth.uid(), 'water');
select pg_temp.as_user('00000000-0000-0000-0000-0000000001c1');
insert into metric_shares (group_id, user_id, metric) values ((select id from g1), auth.uid(), 'water');
insert into water_entries (user_id, source, client_id, consumed_at, timezone, ml) values
  (auth.uid(), 'manual', gen_random_uuid(), '2026-11-05 09:00+00', 'UTC', 111);
select pg_temp.as_user('00000000-0000-0000-0000-0000000001b1');
select remove_member((select id from g1), '00000000-0000-0000-0000-0000000001a1');
select is((select array_agg(distinct user_id) from group_water((select id from g1), '2026-10-30', '2026-11-06')),
  array['00000000-0000-0000-0000-0000000001c1'::uuid], 'a removed member''s water no longer shows');
select pg_temp.as_user('00000000-0000-0000-0000-0000000001a1');
select throws_ok($$select * from group_water((select id from g1), '2026-11-01', '2026-11-06')$$, 'P0001',
  'not a member of this group', 'a removed member cannot read the group''s water');
select join_group((select invite_code from g1));
select is((select count(*) from metric_shares where group_id = (select id from g1) and user_id = auth.uid() and metric = 'water')::int, 0,
  'rejoining does not restore the water share');
select pg_temp.as_user('00000000-0000-0000-0000-0000000001c1');
delete from group_members where group_id = (select id from g1) and user_id = auth.uid();
select throws_ok($$select * from group_water((select id from g1), '2026-11-01', '2026-11-06')$$, 'P0001',
  'not a member of this group', 'a member who left cannot read the group''s water');
select pg_temp.as_user('00000000-0000-0000-0000-0000000001b1');
select is((select count(*) from group_water((select id from g1), '2026-10-30', '2026-11-06'))::int, 0, 'a member who left no longer shows');

-- Deleting history keeps the share but leaves nothing to show.
select pg_temp.as_user('00000000-0000-0000-0000-0000000001a1');
insert into metric_shares (group_id, user_id, metric) values ((select id from g2), auth.uid(), 'water') on conflict do nothing;
select delete_my_water_history();
select pg_temp.as_user('00000000-0000-0000-0000-0000000001d1');
select is((select count(*) from group_water((select id from g2), '2026-10-30', '2026-11-06'))::int, 0, 'deleted history leaves no total');

select * from finish();
rollback;
