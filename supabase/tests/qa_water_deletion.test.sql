begin;
select plan(6);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000d1', 'qa-del@w.com', '{"full_name":"QaDel"}');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, true), set_config('role', 'authenticated', true);
$$;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');

-- Another app wrote a Health sample dated in the future (wrong clock, or a pre-logged reminder). It is imported.
select apply_health_water(auth.uid(), '44444444-0000-0000-0000-00000000000d',
  ('[{"health_uuid":"55555555-0000-0000-0000-000000000001","consumed_at":"' || (now() + interval '30 days')::text
   || '","timezone":"UTC","ml":400}]')::jsonb, '{}');
select is((select count(*)::int from water_entries), 1, 'future-dated Health sample is imported');

select delete_my_water_history();
select is((select count(*)::int from water_entries), 0, 'Delete Water History removes it');

-- The next recheck re-sends the same sample. Before the fix it came back, being dated after the cutoff.
select apply_health_water(auth.uid(), '44444444-0000-0000-0000-00000000000d',
  ('[{"health_uuid":"55555555-0000-0000-0000-000000000001","consumed_at":"' || (now() + interval '30 days')::text
   || '","timezone":"UTC","ml":400}]')::jsonb, '{}');
select is((select count(*)::int from water_entries), 0,
  'a Health sample deleted with the water history does not come back on a re-import, even if dated in the future');

-- A second deletion keeps blocking it, and water drunk after the deletion still imports.
select delete_my_water_history();
select apply_health_water(auth.uid(), '44444444-0000-0000-0000-00000000000d',
  ('[{"health_uuid":"55555555-0000-0000-0000-000000000001","consumed_at":"' || (now() + interval '30 days')::text
   || '","timezone":"UTC","ml":400},{"health_uuid":"55555555-0000-0000-0000-000000000003","consumed_at":"'
   || (now() + interval '10 minutes')::text || '","timezone":"UTC","ml":200}]')::jsonb, '{}');
select is((select count(*)::int from water_entries where health_uuid = '55555555-0000-0000-0000-000000000001'), 0,
  'a second Delete Water History does not release a sample the first one blocked');
select is((select count(*)::int from water_entries where health_uuid = '55555555-0000-0000-0000-000000000003'), 1,
  'water drunk after the deletion still imports');

-- Boundary (documented behaviour, kept green): a sample at exactly the cutoff is skipped.
select apply_health_water(auth.uid(), '44444444-0000-0000-0000-00000000000d',
  ('[{"health_uuid":"55555555-0000-0000-0000-000000000002","consumed_at":"'
   || (select deleted_at::text from water_history_cutoffs) || '","timezone":"UTC","ml":100}]')::jsonb, '{}');
select is((select count(*)::int from water_entries where health_uuid = '55555555-0000-0000-0000-000000000002'), 0,
  'a sample consumed exactly at the deletion time is skipped');

select * from finish();
rollback;
