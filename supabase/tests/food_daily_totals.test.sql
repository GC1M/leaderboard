begin;
select plan(13);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'a@x.com'),
  ('00000000-0000-0000-0000-0000000000d2', 'b@x.com'),
  ('00000000-0000-0000-0000-0000000000d3', 'c@x.com');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, true), set_config('role', 'authenticated', true);
$$;

insert into food_entries (user_id, client_id, meal, consumed_at, timezone, grams, food_name, provider, energy_kcal, protein_g, carbs_g) values
  ('00000000-0000-0000-0000-0000000000d1', gen_random_uuid(), 'lunch', '2026-11-01 18:00+00', 'UTC', 100, 'A', 'custom', 100, 5, null),
  ('00000000-0000-0000-0000-0000000000d1', gen_random_uuid(), 'dinner', '2026-11-01 19:00+00', 'UTC', 100, 'B', 'custom', 50, 0, null),
  ('00000000-0000-0000-0000-0000000000d1', gen_random_uuid(), 'snack', '2026-11-03 03:00+00', 'America/Chicago', 100, 'C', 'custom', null, null, null),
  ('00000000-0000-0000-0000-0000000000d2', gen_random_uuid(), 'lunch', '2026-11-01 18:00+00', 'UTC', 100, 'Other', 'custom', 999, 1, 1),
  -- Chicago ends daylight time on 2026-11-01 at 02:00: 01:30 happens twice, and 23:59 CST is still Nov 1.
  ('00000000-0000-0000-0000-0000000000d3', gen_random_uuid(), 'snack', '2026-11-01 06:30+00', 'America/Chicago', 10, 'D1', 'custom', 1, 1, 1),
  ('00000000-0000-0000-0000-0000000000d3', gen_random_uuid(), 'snack', '2026-11-01 07:30+00', 'America/Chicago', 10, 'D2', 'custom', 2, 1, 1),
  ('00000000-0000-0000-0000-0000000000d3', gen_random_uuid(), 'snack', '2026-11-02 05:59+00', 'America/Chicago', 10, 'D3', 'custom', 4, 1, 1),
  ('00000000-0000-0000-0000-0000000000d3', gen_random_uuid(), 'snack', '2026-11-02 06:00+00', 'America/Chicago', 10, 'D4', 'custom', 8, 1, 1);

select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');

select is((select count(*) from food_daily_totals('2026-10-01', '2026-11-30')), 2::bigint, 'days without entries have no row; the entry at 03:00 UTC is Nov 2 in Chicago');
select is((select energy_kcal from food_daily_totals('2026-11-01', '2026-11-01')), 150::numeric, 'sums the caller''s own entries only');
select is((select protein_g from food_daily_totals('2026-11-01', '2026-11-01')), 5::numeric, 'a recorded zero adds as zero');
select is((select carbs_g from food_daily_totals('2026-11-01', '2026-11-01')), null, 'a nutrient nobody knew stays null, not 0');
select is((select carbs_g_incomplete from food_daily_totals('2026-11-01', '2026-11-01')), true, 'and is flagged incomplete');
select is((select energy_kcal_incomplete from food_daily_totals('2026-11-01', '2026-11-01')), false, 'a fully known nutrient is complete');
select is((select local_date::text from food_daily_totals('2026-11-02', '2026-11-30')), '2026-11-02', 'groups by the entry''s own local_date');
select throws_ok($$select * from food_daily_totals('2025-11-01', '2026-12-31')$$, '22023', null, 'a range over 366 days is an error, not an empty set');
select throws_ok($$select * from food_daily_totals('2026-11-02', '2026-11-01')$$, '22023', null, 'from after to is an error');

reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select is((select energy_kcal from food_daily_totals('2026-11-01', '2026-11-01')), 999::numeric, 'another user sees only their own');

reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d3');
select is((select energy_kcal from food_daily_totals('2026-11-01', '2026-11-01')), 7::numeric, 'across the DST change, both 01:30s and 23:59 CST are Nov 1');
select is((select energy_kcal from food_daily_totals('2026-11-02', '2026-11-02')), 8::numeric, 'and midnight CST is Nov 2');

reset role;
select set_config('role', 'anon', true);
select throws_ok($$select * from food_daily_totals('2026-11-01', '2026-11-02')$$, '42501', null, 'anon cannot call it');

select * from finish();
rollback;
