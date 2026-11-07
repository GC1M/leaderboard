begin;
select plan(44);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a7', 'alice@w.com', '{"full_name":"Alice"}'),
  ('00000000-0000-0000-0000-0000000000b7', 'bob@w.com', '{"full_name":"Bob"}'),
  ('00000000-0000-0000-0000-0000000000c7', 'carol@w.com', '{"full_name":"Carol"}');
update profiles set timezone = 'America/Chicago' where id = '00000000-0000-0000-0000-0000000000a7';

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, true), set_config('role', 'authenticated', true);
$$;

-- G1: bob (owner) + alice. G2: carol (owner) + alice.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b7');
create temp table g1 as select id, invite_code from create_group('G1');
grant select on g1 to authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c7');
create temp table g2 as select id, invite_code from create_group('G2');
grant select on g2 to authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a7');
select join_group((select invite_code from g1));
select join_group((select invite_code from g2));

-- Manual entries: alice logs 250 mL in Chicago at 03:00 UTC Nov 3 (still Nov 2 there) and 500 mL on Nov 3.
select lives_ok($$insert into water_entries (user_id, source, client_id, consumed_at, timezone, ml) values
  (auth.uid(), 'manual', '11111111-0000-0000-0000-000000000001', '2026-11-03 03:00+00', 'America/Chicago', 250),
  (auth.uid(), 'manual', '11111111-0000-0000-0000-000000000002', '2026-11-03 18:00+00', 'America/Chicago', 500)$$,
  'owner logs manual water');
select is((select local_date::text from water_entries where client_id = '11111111-0000-0000-0000-000000000001'), '2026-11-02',
  'local_date is the calendar date in the entry''s own zone');
select throws_ok($$insert into water_entries (user_id, source, client_id, consumed_at, timezone, ml) values
  (auth.uid(), 'manual', '11111111-0000-0000-0000-000000000001', '2026-11-03 03:00+00', 'UTC', 100)$$,
  '23505', null, 'a retried save with the same client id cannot add a second row');
select throws_ok($$insert into water_entries (user_id, source, client_id, consumed_at, timezone, ml) values
  (auth.uid(), 'manual', gen_random_uuid(), now(), 'UTC', 0)$$, '23514', null, 'a manual entry of 0 mL is rejected');
select throws_ok($$insert into water_entries (user_id, source, client_id, consumed_at, timezone, ml) values
  (auth.uid(), 'manual', gen_random_uuid(), now(), 'UTC', 5001)$$, '23514', null, 'a manual entry above 5 L is rejected');
select throws_ok($$insert into water_entries (user_id, source, client_id, consumed_at, timezone, ml) values
  (auth.uid(), 'manual', gen_random_uuid(), now(), 'UTC', 'NaN')$$, '23514', null, 'NaN is rejected');
select throws_ok($$insert into water_entries (user_id, source, client_id, consumed_at, timezone, ml) values
  (auth.uid(), 'manual', gen_random_uuid(), now() + interval '2 hours', 'UTC', 100)$$, '23514', null, 'a future manual entry is rejected');
select throws_ok($$insert into water_entries (user_id, source, client_id, consumed_at, timezone, ml) values
  (auth.uid(), 'manual', gen_random_uuid(), now(), 'EST', 100)$$, '22023', null, 'a zone abbreviation is rejected');
select throws_ok($$insert into water_entries (user_id, source, health_uuid, health_device_id, consumed_at, timezone, ml) values
  (auth.uid(), 'healthkit', gen_random_uuid(), gen_random_uuid(), now(), 'UTC', 100)$$, '42501', null,
  'a client cannot insert an imported row directly');
select throws_ok($$insert into water_entries (user_id, source, client_id, consumed_at, timezone, ml) values
  ('00000000-0000-0000-0000-0000000000b7', 'manual', gen_random_uuid(), now(), 'UTC', 100)$$, '42501', null,
  'a client cannot write water for another user');

select throws_ok($$insert into water_entries (user_id, source, client_id, health_uuid, consumed_at, timezone, ml) values
  (auth.uid(), 'manual', gen_random_uuid(), gen_random_uuid(), now(), 'UTC', 100)$$, '23514', null, 'a manual row cannot carry a Health UUID');

-- Edit keeps the row id; the identity cannot change.
select lives_ok($$update water_entries set ml = 300 where client_id = '11111111-0000-0000-0000-000000000001'$$, 'owner edits an amount');
select throws_ok($$update water_entries set client_id = gen_random_uuid() where client_id = '11111111-0000-0000-0000-000000000001'$$,
  '23514', null, 'the client id cannot change');

-- Health import: two samples from another app, one with a zone the server does not accept.
select lives_ok($$select apply_health_water(auth.uid(), '22222222-0000-0000-0000-00000000000d',
  '[{"health_uuid":"33333333-0000-0000-0000-000000000001","consumed_at":"2026-11-03T15:00:00Z","timezone":"Europe/Paris","ml":330,"source_name":"WaterMinder"},
    {"health_uuid":"33333333-0000-0000-0000-000000000002","consumed_at":"2026-11-03T16:00:00Z","timezone":"Not/AZone","ml":0,"source_name":"Watch"}]'::jsonb,
  '{}')$$, 'Health water imports');
select is((select timezone from water_entries where health_uuid = '33333333-0000-0000-0000-000000000002'), 'America/Chicago',
  'an unknown sample zone falls back to the profile zone');
select is((select ml from water_entries where health_uuid = '33333333-0000-0000-0000-000000000002'), 0::numeric,
  'a recorded 0 mL Health sample is kept as zero');
select is((select source_name from water_entries where health_uuid = '33333333-0000-0000-0000-000000000001'), 'WaterMinder',
  'the source name is preserved');
-- Repeating the same import changes nothing; a correction updates the same row.
select lives_ok($$select apply_health_water(auth.uid(), '22222222-0000-0000-0000-00000000000d',
  '[{"health_uuid":"33333333-0000-0000-0000-000000000001","consumed_at":"2026-11-03T15:00:00Z","timezone":"Europe/Paris","ml":330,"source_name":"WaterMinder"}]'::jsonb, '{}')$$,
  'a repeated import is accepted');
select is((select count(*)::int from water_entries where source = 'healthkit'), 2, 'a repeated import does not duplicate');
select throws_ok($$select apply_health_water(auth.uid(), '22222222-0000-0000-0000-00000000000d',
  '[{"health_uuid":"33333333-0000-0000-0000-000000000003","consumed_at":"2026-11-03T15:00:00Z","timezone":"UTC","ml":"Infinity"}]'::jsonb, '{}')$$,
  'P0001', 'invalid Health value', 'Infinity is rejected');
select throws_ok($$select apply_health_water('00000000-0000-0000-0000-0000000000b7', '22222222-0000-0000-0000-00000000000d', '[]'::jsonb, '{}')$$,
  'P0001', 'Health account changed', 'an import for another account is refused');
-- A tombstone from another device does not delete this device's row.
select lives_ok($$select apply_health_water(auth.uid(), '22222222-0000-0000-0000-00000000000e', '[]'::jsonb,
  '{33333333-0000-0000-0000-000000000002}')$$, 'a tombstone from another device runs');
select is((select count(*)::int from water_entries where source = 'healthkit'), 2, 'another device''s tombstone deletes nothing');
select lives_ok($$select apply_health_water(auth.uid(), '22222222-0000-0000-0000-00000000000d', '[]'::jsonb,
  '{33333333-0000-0000-0000-000000000002}')$$, 'this device''s tombstone runs');
select is((select count(*)::int from water_entries where source = 'healthkit'), 1, 'a deletion in Health removes the imported row');

-- An out-of-range sample is skipped instead of failing the batch.
select lives_ok($$select apply_health_water(auth.uid(), '22222222-0000-0000-0000-00000000000d',
  '[{"health_uuid":"33333333-0000-0000-0000-000000000009","consumed_at":"2026-11-03T15:00:00Z","timezone":"UTC","ml":250000}]'::jsonb, '{}')$$,
  'a batch with a sample above 20 L still applies');
select is((select count(*)::int from water_entries where health_uuid = '33333333-0000-0000-0000-000000000009'), 0, 'the out-of-range sample is skipped');

-- Imported rows cannot be edited or deleted directly.
update water_entries set ml = 1 where source = 'healthkit';
delete from water_entries where source = 'healthkit';
select is((select ml from water_entries where source = 'healthkit'), 330::numeric, 'an imported row cannot be edited or deleted by the client');

-- Totals by local day with a source split; days without entries have no row.
select results_eq($$select local_date::text, entries, total_ml, manual_ml, health_ml from water_daily_totals('2026-11-01', '2026-11-05')$$,
  $$values ('2026-11-02', 1, 300::numeric, 300::numeric, 0::numeric), ('2026-11-03', 2, 830::numeric, 500::numeric, 330::numeric)$$,
  'daily totals group by local date and split by source; no row means no data');
select throws_ok($$select * from water_daily_totals('2026-11-05', '2026-11-01')$$, '22023', null, 'an inverted range is refused');

-- Targets are private.
select lives_ok($$insert into water_targets (user_id, daily_ml) values (auth.uid(), 2000)$$, 'owner sets a target');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b7');
select is((select count(*)::int from water_targets), 0, 'a group-mate cannot read the target');
select is((select count(*)::int from water_entries), 0, 'a group-mate cannot read water entries');

-- Sharing: off by default, per group, revocable.
select is((select count(*)::int from group_water((select id from g1), '2026-11-01', '2026-11-05')), 0, 'nothing is shared by default');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a7');
insert into metric_shares (group_id, user_id, metric) values ((select id from g1), auth.uid(), 'water');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b7');
select results_eq($$select local_date::text, total_ml from group_water((select id from g1), '2026-11-01', '2026-11-05')$$,
  $$values ('2026-11-02', 300::numeric), ('2026-11-03', 830::numeric)$$, 'a group that was shared with sees daily totals only');
select is((select proargnames from pg_proc where oid = 'public.group_water(uuid,date,date)'::regprocedure),
  array['p_group_id', 'p_from', 'p_to', 'user_id', 'local_date', 'total_ml'], 'group_water returns only member, day and total');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c7');
select is((select count(*)::int from group_water((select id from g2), '2026-11-01', '2026-11-05')), 0, 'a share with one group does not leak to another');
select throws_ok($$select * from group_water((select id from g1), '2026-11-01', '2026-11-05')$$, 'P0001', 'not a member of this group',
  'a non-member cannot read a group');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a7');
delete from metric_shares where metric = 'water';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b7');
select is((select count(*)::int from group_water((select id from g1), '2026-11-01', '2026-11-05')), 0, 'revoking stops the next read');

-- Deleting imported Health data removes imported water only.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a7');
select delete_my_health_imports();
select is((select count(*)::int from water_entries), 2, 'Delete Imported Health Data keeps manual water and removes imported water');

-- Deleting water history removes all water, the target and the export mapping.
select record_health_export('water', (select id::text from water_entries limit 1), null, 1, gen_random_uuid());
select delete_my_water_history();
select is((select count(*)::int from water_entries) + (select count(*)::int from water_targets)
  + (select count(*)::int from health_exports where kind = 'water'), 0, 'Delete Water History removes entries, target and export mapping');
-- A recheck re-sends old samples: water drunk before the deletion stays deleted, later water imports.
select apply_health_water(auth.uid(), '22222222-0000-0000-0000-00000000000d',
  ('[{"health_uuid":"33333333-0000-0000-0000-000000000001","consumed_at":"2026-11-03T15:00:00Z","timezone":"UTC","ml":330},'
   || '{"health_uuid":"33333333-0000-0000-0000-00000000000a","consumed_at":"' || (now() + interval '1 minute')::text || '","timezone":"UTC","ml":200}]')::jsonb, '{}');
select is((select count(*)::int from water_entries where health_uuid = '33333333-0000-0000-0000-000000000001'), 0,
  'imported water deleted with the history does not come back on a re-import');
select is((select count(*)::int from water_entries where health_uuid = '33333333-0000-0000-0000-00000000000a'), 1,
  'water drunk after the deletion still imports');

-- Account deletion cascades.
insert into water_entries (user_id, source, client_id, consumed_at, timezone, ml) values (auth.uid(), 'manual', gen_random_uuid(), now(), 'UTC', 100);
insert into water_targets (user_id, daily_ml) values (auth.uid(), 1500);
select delete_my_account();
reset role;
select is((select count(*)::int from water_entries where user_id = '00000000-0000-0000-0000-0000000000a7')
  + (select count(*)::int from water_targets where user_id = '00000000-0000-0000-0000-0000000000a7'), 0,
  'account deletion removes water entries and target');

select * from finish();
rollback;
