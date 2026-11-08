begin;
select plan(2);

-- A profile zone Postgres knows but the water rule (Area/City, UTC or GMT) does not accept. profiles_timezone_check
-- allows it (any zone Postgres can convert with), e.g. written by a web client whose system zone is EST5EDT, UCT or Zulu.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000005a1', 'qa-sync-sql@w.com', '{"full_name":"QA Sync"}');
update profiles set timezone = 'EST5EDT' where id = '00000000-0000-0000-0000-0000000005a1';

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, true), set_config('role', 'authenticated', true);
$$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000005a1');

-- One sample with an unusable HKTimeZone ('PST') next to a good one. The contract says the bad zone falls back to the
-- profile zone "rather than failing the batch"; before the fix the fallback zone was itself rejected and the whole page failed,
-- every retry, so no later water ever imports.
select lives_ok($$select apply_health_water(auth.uid(), '00000000-0000-0000-0000-00000000d5a1',
  '[{"health_uuid":"00000000-0000-0000-0000-0000000005b1","consumed_at":"2026-11-05T10:00:00Z","timezone":"PST","ml":250,"source_name":"X"},
    {"health_uuid":"00000000-0000-0000-0000-0000000005b2","consumed_at":"2026-11-05T11:00:00Z","timezone":"America/Chicago","ml":300,"source_name":"X"}]',
  '{}')$$, 'a sample zone the server rejects never fails the import batch, even when the profile zone is not Area/City');
select is((select count(*)::int from water_entries where user_id = auth.uid()), 2, 'both samples are imported');

select * from finish();
rollback;
