begin;
select plan(4);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000d1', 'qa-del@w.com', '{"full_name":"QaDel"}');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, true), set_config('role', 'authenticated', true);
$$;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');

-- Another app wrote a Health sample dated in the future (wrong clock, or a pre-logged reminder). More than an hour
-- ahead it is skipped, the same bound manual water has. Before the fix it was imported, and after Delete Water History
-- the next recheck brought it back because it was dated after the cutoff.
select apply_health_water(auth.uid(), '44444444-0000-0000-0000-00000000000d',
  ('[{"health_uuid":"55555555-0000-0000-0000-000000000001","consumed_at":"' || (now() + interval '30 days')::text
   || '","timezone":"UTC","ml":400}]')::jsonb, '{}');
select is((select count(*)::int from water_entries), 0, 'a Health sample dated more than an hour ahead is skipped');

-- Within the hour it is imported, deleted with the history, and stays deleted on the next recheck.
select apply_health_water(auth.uid(), '44444444-0000-0000-0000-00000000000d',
  ('[{"health_uuid":"55555555-0000-0000-0000-000000000003","consumed_at":"' || (now() + interval '30 minutes')::text
   || '","timezone":"UTC","ml":400}]')::jsonb, '{}');
select delete_my_water_history();
select apply_health_water(auth.uid(), '44444444-0000-0000-0000-00000000000d',
  ('[{"health_uuid":"55555555-0000-0000-0000-000000000003","consumed_at":"' || (now() + interval '30 minutes')::text
   || '","timezone":"UTC","ml":400}]')::jsonb, '{}');
select is((select count(*)::int from water_entries), 0,
  'a Health sample deleted with the water history does not come back on a re-import, even if dated ahead');
select ok((select deleted_at from water_history_cutoffs) >= now() + interval '30 minutes', 'the cutoff covers it');

-- Boundary (documented behaviour, kept green): a sample at exactly the cutoff is skipped.
select apply_health_water(auth.uid(), '44444444-0000-0000-0000-00000000000d',
  ('[{"health_uuid":"55555555-0000-0000-0000-000000000002","consumed_at":"'
   || (select deleted_at::text from water_history_cutoffs) || '","timezone":"UTC","ml":100}]')::jsonb, '{}');
select is((select count(*)::int from water_entries where health_uuid = '55555555-0000-0000-0000-000000000002'), 0,
  'a sample consumed exactly at the deletion time is skipped');

select * from finish();
rollback;
