begin;
select plan(72);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'alice@x.com'),
  ('00000000-0000-0000-0000-0000000000f2', 'bob@x.com');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, true), set_config('role', 'authenticated', true);
$$;

-- The FDC cache is written by the server (service role, which bypasses RLS), never by a client.
insert into foods (id, provider, provider_id, source_data_type, source_version, name, energy_kcal, protein_g, carbs_g, fat_g, fiber_g)
  values ('00000000-0000-0000-0000-00000000f001', 'usda_fdc', '171688', 'SR Legacy', '2018-04', 'Apple, raw', 52, 0.26, 13.8, 0.17, null);
insert into food_portions (food_id, label, gram_weight)
  values ('00000000-0000-0000-0000-00000000f001', '1 medium', 182);

select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');

insert into foods (id, user_id, provider, name, energy_kcal, protein_g, sodium_mg)
  values ('00000000-0000-0000-0000-00000000f011', auth.uid(), 'custom', 'Alice granola', 450, 10, 0);
insert into food_portions (food_id, label, gram_weight)
  values ('00000000-0000-0000-0000-00000000f011', '1 bowl', 60);

-- Unknown vs zero.
select is((select sodium_mg from foods where name = 'Alice granola'), 0::numeric, 'a recorded zero stays 0');
select is((select carbs_g from foods where name = 'Alice granola'), null, 'an unlisted nutrient stays unknown');
select is((select fiber_g from foods where name = 'Apple, raw'), null, 'a provider nutrient with no value stays unknown');

-- Provider foods are readable but not writable by clients.
select is((select count(*) from foods where provider = 'usda_fdc'), 1::bigint, 'signed-in users read the provider cache');
select throws_ok($$insert into foods (provider, provider_id, name) values ('usda_fdc', '1', 'Fake')$$,
  '42501', null, 'clients cannot insert provider foods');
select is_empty($$update foods set energy_kcal = 1 where provider = 'usda_fdc' returning 1$$, 'clients cannot update provider foods');
select is_empty($$delete from foods where provider = 'usda_fdc' returning 1$$, 'clients cannot delete provider foods');
select throws_ok($$insert into food_portions (food_id, label, gram_weight) values ('00000000-0000-0000-0000-00000000f001', 'fake', 5)$$,
  '42501', null, 'clients cannot add portions to provider foods');

-- Food and portion constraints.
select throws_ok($$insert into foods (user_id, provider, name, energy_kcal) values (auth.uid(), 'custom', 'Bad', -1)$$,
  '23514', null, 'negative energy rejected');
select throws_ok($$insert into foods (user_id, provider, name, protein_g) values (auth.uid(), 'custom', 'Bad', 101)$$,
  '23514', null, 'more than 100 g per 100 g rejected');
select throws_ok($$insert into foods (user_id, provider, name) values (auth.uid(), 'custom', '  ')$$,
  '23514', null, 'a food needs a name');
select throws_ok($$insert into foods (user_id, provider, provider_id, name) values (auth.uid(), 'custom', '7', 'Bad')$$,
  '23514', null, 'a custom food has no provider id');
select throws_ok($$insert into food_portions (food_id, label, gram_weight) values ('00000000-0000-0000-0000-00000000f011', 'zero', 0)$$,
  '23514', null, 'a portion needs a positive gram weight');
select throws_ok($$insert into food_portions (food_id, label, gram_weight) values ('00000000-0000-0000-0000-00000000f011', 'none', null)$$,
  '23502', null, 'a portion without a gram weight is rejected');

-- Entries: the snapshot is for the amount eaten; local_date follows the entry timezone.
insert into food_entries (id, user_id, client_id, food_id, meal, consumed_at, timezone, grams, portion_label, portion_count,
  food_name, provider, provider_id, source_data_type, source_version, energy_kcal, protein_g, carbs_g)
  values ('00000000-0000-0000-0000-00000000f101', auth.uid(), '00000000-0000-0000-0000-00000000c001',
    '00000000-0000-0000-0000-00000000f001', 'snack', '2026-11-08 03:30:00+00', 'America/Chicago', 182, '1 medium', 1,
    'Apple, raw', 'usda_fdc', '171688', 'SR Legacy', '2018-04', 94.64, 0.47, null);
select is((select local_date from food_entries where id = '00000000-0000-0000-0000-00000000f101'), '2026-11-07'::date,
  'local_date is the calendar date in the entry timezone');
select is((select carbs_g from food_entries where id = '00000000-0000-0000-0000-00000000f101'), null, 'an unknown nutrient in a snapshot stays unknown');

-- local_date across the US fall-back (clocks go back at 07:00Z on 2026-11-01).
create function pg_temp.local_day(ts timestamptz, tz text) returns date language sql as $$
  with e as (insert into food_entries (user_id, client_id, meal, consumed_at, timezone, grams, food_name, provider, provider_id)
    values (auth.uid(), gen_random_uuid(), 'lunch', ts, tz, 10, 'Tz', 'usda_fdc', '1') returning local_date)
  select local_date from e
$$;
select is(pg_temp.local_day('2026-11-01 04:30:00+00', 'America/Chicago'), '2026-10-31'::date, 'before the change it is still Oct 31 (CDT)');
select is(pg_temp.local_day('2026-11-01 07:30:00+00', 'America/Chicago'), '2026-11-01'::date, 'the repeated hour after the change is Nov 1 (CST)');
select is(pg_temp.local_day('2026-11-01 04:30:00+00', 'UTC'), '2026-11-01'::date, 'the same instant is Nov 1 in UTC');
select is(pg_temp.local_day('2026-11-01 06:30:00+00', 'America/Chicago'), '2026-11-01'::date, 'the first 1:30 am (CDT) is Nov 1');
-- Local midnight is 05:00Z while CDT applies; a fixed CST offset would put this on Oct 31.
select is(pg_temp.local_day('2026-11-01 05:00:00+00', 'America/Chicago'), '2026-11-01'::date, 'local midnight under CDT starts Nov 1');
-- After the change the offset is -6; a fixed CDT offset would put 05:30Z on Nov 2.
select is(pg_temp.local_day('2026-11-02 05:30:00+00', 'America/Chicago'), '2026-11-01'::date, 'after the change 23:30 CST is still Nov 1');
select is(pg_temp.local_day('2026-11-01 04:30:00+00', 'GMT'), '2026-11-01'::date, 'GMT is accepted as a timezone');

-- Entry constraints.
select throws_ok($$insert into food_entries (user_id, client_id, meal, consumed_at, timezone, grams, food_name, provider, provider_id)
  values (auth.uid(), '00000000-0000-0000-0000-00000000c001', 'lunch', now(), 'UTC', 10, 'Dup', 'usda_fdc', '1')$$,
  '23505', null, 'the same client id cannot be saved twice');
insert into food_entries (user_id, client_id, meal, consumed_at, timezone, grams, food_name, provider, provider_id)
  values (auth.uid(), '00000000-0000-0000-0000-00000000c001', 'lunch', now(), 'UTC', 10, 'Dup', 'usda_fdc', '1')
  on conflict (user_id, client_id) do nothing;
select is((select count(*) from food_entries where client_id = '00000000-0000-0000-0000-00000000c001'), 1::bigint,
  'a retried save with on conflict do nothing keeps one row');
select throws_ok($$insert into food_entries (user_id, client_id, meal, consumed_at, timezone, grams, food_name, provider, provider_id)
  values (auth.uid(), gen_random_uuid(), 'lunch', now(), 'UTC', 0, 'Bad', 'usda_fdc', '1')$$,
  '23514', null, 'grams must be positive');
select throws_ok($$insert into food_entries (user_id, client_id, meal, consumed_at, timezone, grams, portion_label, food_name, provider, provider_id)
  values (auth.uid(), gen_random_uuid(), 'lunch', now(), 'UTC', 10, '1 cup', 'Bad', 'usda_fdc', '1')$$,
  '23514', null, 'a portion label needs a count');
select throws_ok($$insert into food_entries (user_id, client_id, meal, consumed_at, timezone, grams, portion_label, portion_count, food_name, provider, provider_id)
  values (auth.uid(), gen_random_uuid(), 'lunch', now(), 'UTC', 10, '1 cup', 0, 'Bad', 'usda_fdc', '1')$$,
  '23514', null, 'a portion count must be positive');
select throws_ok($$insert into food_entries (user_id, client_id, meal, consumed_at, timezone, grams, portion_label, portion_count, food_name, provider, provider_id)
  values (auth.uid(), gen_random_uuid(), 'lunch', now(), 'UTC', 10, '1 cup', 'Infinity', 'Bad', 'usda_fdc', '1')$$,
  '23514', null, 'an infinite portion count is rejected');
select throws_ok($$insert into food_entries (user_id, client_id, meal, consumed_at, timezone, grams, portion_label, portion_count, food_name, provider, provider_id)
  values (auth.uid(), gen_random_uuid(), 'lunch', now(), 'UTC', 10, '  ', 1, 'Bad', 'usda_fdc', '1')$$,
  '23514', null, 'a portion label cannot be blank');
select throws_ok($$insert into food_entries (user_id, client_id, meal, consumed_at, timezone, grams, food_name, provider, provider_id)
  values (auth.uid(), gen_random_uuid(), 'brunch', now(), 'UTC', 10, 'Bad', 'usda_fdc', '1')$$,
  '23514', null, 'meal must be a known slot');
select throws_ok($$insert into food_entries (user_id, client_id, meal, consumed_at, timezone, grams, food_name, provider, provider_id, energy_kcal)
  values (auth.uid(), gen_random_uuid(), 'lunch', now(), 'UTC', 10, 'Bad', 'usda_fdc', '1', 'NaN')$$,
  '23514', null, 'a NaN nutrient is rejected');
select throws_ok($$insert into food_entries (user_id, client_id, meal, consumed_at, timezone, grams, food_name, provider, provider_id, protein_g)
  values (auth.uid(), gen_random_uuid(), 'lunch', now(), 'UTC', 10, 'Bad', 'usda_fdc', '1', 'Infinity')$$,
  '23514', null, 'an infinite nutrient is rejected');
select throws_ok($$insert into food_entries (user_id, client_id, meal, consumed_at, timezone, grams, food_name, provider, provider_id, sodium_mg)
  values (auth.uid(), gen_random_uuid(), 'lunch', now(), 'UTC', 10, 'Bad', 'usda_fdc', '1', -1)$$,
  '23514', null, 'a negative nutrient is rejected');
select throws_ok($$insert into food_entries (user_id, client_id, meal, consumed_at, timezone, grams, food_name, provider, provider_id)
  values (auth.uid(), gen_random_uuid(), 'lunch', 'infinity', 'UTC', 10, 'Bad', 'usda_fdc', '1')$$,
  '23514', null, 'an infinite consumed_at is rejected');
select throws_ok($$insert into food_entries (user_id, client_id, meal, consumed_at, timezone, grams, food_name, provider, provider_id)
  values (auth.uid(), gen_random_uuid(), 'lunch', '-infinity', 'UTC', 10, 'Bad', 'usda_fdc', '1')$$,
  '23514', null, 'a -infinity consumed_at is rejected');
select throws_ok($$insert into food_entries (user_id, client_id, meal, consumed_at, timezone, grams, food_name, provider, provider_id)
  values (auth.uid(), gen_random_uuid(), 'lunch', now(), 'Mars/Base', 10, 'Bad', 'usda_fdc', '1')$$,
  '22023', null, 'an unknown timezone is rejected');
select throws_ok($$insert into food_entries (user_id, client_id, meal, consumed_at, timezone, grams, food_name, provider, provider_id)
  values (auth.uid(), gen_random_uuid(), 'lunch', now(), 'EST', 10, 'Bad', 'usda_fdc', '1')$$,
  '22023', null, 'an abbreviation zone is rejected');
select throws_ok($$insert into food_entries (user_id, client_id, meal, consumed_at, timezone, grams, food_name, provider, provider_id)
  values (auth.uid(), gen_random_uuid(), 'lunch', now(), 'UTC+5', 10, 'Bad', 'usda_fdc', '1')$$,
  '22023', null, 'a POSIX offset zone is rejected');
select throws_ok($$insert into food_entries (user_id, client_id, meal, consumed_at, timezone, grams, food_name, provider)
  values (auth.uid(), gen_random_uuid(), 'lunch', now(), 'UTC', 10, 'Bad', 'usda_fdc')$$,
  '23514', null, 'a provider entry needs a provider id');
select throws_ok($$insert into food_entries (user_id, client_id, meal, consumed_at, timezone, grams, food_name, provider, provider_id)
  values (auth.uid(), gen_random_uuid(), 'lunch', now(), 'UTC', 10, 'Bad', 'custom', '5')$$,
  '23514', null, 'a custom entry cannot carry a provider id');
select throws_ok($$insert into food_entries (user_id, client_id, meal, consumed_at, timezone, grams, food_name, provider, provider_id)
  values (auth.uid(), gen_random_uuid(), 'lunch', now(), 'UTC', 10, repeat('x', 201), 'usda_fdc', '1')$$,
  '23514', null, 'the food name is length capped');
select throws_ok($$insert into food_entries (user_id, client_id, meal, consumed_at, timezone, grams, food_name, provider, provider_id, source_version)
  values (auth.uid(), gen_random_uuid(), 'lunch', now(), 'UTC', 10, 'Bad', 'usda_fdc', '1', repeat('x', 61))$$,
  '23514', null, 'provenance text is length capped');

-- Identity is immutable; the amount is editable in place so the row id (and later export mappings) stay stable.
update foods set energy_kcal = 999 where id = '00000000-0000-0000-0000-00000000f011';
insert into food_entries (id, user_id, client_id, food_id, meal, consumed_at, timezone, grams, food_name, provider, energy_kcal)
  values ('00000000-0000-0000-0000-00000000f102', auth.uid(), gen_random_uuid(), '00000000-0000-0000-0000-00000000f011',
    'breakfast', now(), 'UTC', 60, 'Alice granola', 'custom', 270);
select is((select energy_kcal from food_entries where id = '00000000-0000-0000-0000-00000000f102'), 270::numeric,
  'editing the food later does not change an existing entry');
select lives_ok($$update food_entries set grams = 30, portion_label = '1/2 bowl', portion_count = 0.5, is_estimated = true,
  energy_kcal = 135, protein_g = 3, carbs_g = null where id = '00000000-0000-0000-0000-00000000f102'$$,
  'the amount and its snapshot can be edited together');
select results_eq($$select grams, energy_kcal, carbs_g, is_estimated from food_entries where id = '00000000-0000-0000-0000-00000000f102'$$,
  $$values (30::numeric, 135::numeric, null::numeric, true)$$, 'the edited amount is stored');
select throws_ok($$update food_entries set food_name = 'Renamed' where id = '00000000-0000-0000-0000-00000000f102'$$,
  '23514', null, 'the food name cannot be edited');
select throws_ok($$update food_entries set provider = 'usda_fdc', provider_id = '9' where id = '00000000-0000-0000-0000-00000000f102'$$,
  '23514', null, 'the provider cannot be edited');
select throws_ok($$update food_entries set source_version = 'x' where id = '00000000-0000-0000-0000-00000000f102'$$,
  '23514', null, 'source provenance cannot be edited');
select throws_ok($$update food_entries set client_id = gen_random_uuid() where id = '00000000-0000-0000-0000-00000000f102'$$,
  '23514', null, 'the client id cannot be edited');
select throws_ok($$update food_entries set created_at = now() - interval '1 day' where id = '00000000-0000-0000-0000-00000000f102'$$,
  '23514', null, 'created_at cannot be edited');
select throws_ok($$update food_entries set food_id = '00000000-0000-0000-0000-00000000f001' where id = '00000000-0000-0000-0000-00000000f102'$$,
  '23514', null, 'an entry cannot be re-pointed at another food');
select throws_ok($$update food_entries set user_id = '00000000-0000-0000-0000-0000000000f2' where id = '00000000-0000-0000-0000-00000000f102'$$,
  '23514', null, 'an entry cannot be reassigned to another user');
select lives_ok($$update food_entries set meal = 'lunch', consumed_at = '2026-11-09 01:00:00+00', timezone = 'Asia/Tokyo' where id = '00000000-0000-0000-0000-00000000f102'$$,
  'meal, time and timezone can be edited');
select is((select local_date from food_entries where id = '00000000-0000-0000-0000-00000000f102'), '2026-11-09'::date,
  'editing the time recomputes local_date');

-- Alice's rows for the isolation checks below.
insert into foods (id, user_id, provider, name) values ('00000000-0000-0000-0000-00000000f012', auth.uid(), 'custom', 'Alice secret');
insert into food_portions (id, food_id, label, gram_weight) values ('00000000-0000-0000-0000-00000000f021', '00000000-0000-0000-0000-00000000f012', '1', 5);

-- Deleting a custom food keeps the entry and its snapshot.
delete from foods where id = '00000000-0000-0000-0000-00000000f011';
select results_eq($$select food_id is null, energy_kcal, food_name from food_entries where id = '00000000-0000-0000-0000-00000000f102'$$,
  $$values (true, 135::numeric, 'Alice granola')$$, 'deleting a custom food keeps the entry and its snapshot');

-- RLS isolation.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select is((select count(*) from food_entries), 0::bigint, 'another user sees no entries');
select is((select count(*) from foods where user_id is not null), 0::bigint, 'another user sees no custom foods');
select is((select count(*) from food_portions), 1::bigint, 'another user sees only the provider portions');
select is_empty($$update foods set name = 'Hacked' where id = '00000000-0000-0000-0000-00000000f012' returning 1$$, 'another user cannot update a custom food');
select is_empty($$delete from foods where id = '00000000-0000-0000-0000-00000000f012' returning 1$$, 'another user cannot delete a custom food');
select is_empty($$update food_portions set gram_weight = 1 where id = '00000000-0000-0000-0000-00000000f021' returning 1$$, 'another user cannot update a portion');
select is_empty($$delete from food_portions where id = '00000000-0000-0000-0000-00000000f021' returning 1$$, 'another user cannot delete a portion');
select is_empty($$update food_entries set meal = 'dinner' where id = '00000000-0000-0000-0000-00000000f101' returning 1$$, 'another user cannot update an entry');
select is_empty($$delete from food_entries where id = '00000000-0000-0000-0000-00000000f101' returning 1$$, 'another user cannot delete an entry');
select throws_ok($$insert into food_portions (food_id, label, gram_weight) values ('00000000-0000-0000-0000-00000000f012', 'mine', 5)$$,
  '42501', null, 'a portion cannot be added to another user''s custom food');
select throws_ok($$insert into food_entries (user_id, client_id, food_id, meal, consumed_at, timezone, grams, food_name, provider)
  values (auth.uid(), gen_random_uuid(), '00000000-0000-0000-0000-00000000f012', 'lunch', now(), 'UTC', 10, 'x', 'custom')$$,
  '42501', null, 'an entry cannot point at another user''s custom food');
select throws_ok($$insert into food_entries (user_id, client_id, meal, consumed_at, timezone, grams, food_name, provider)
  values ('00000000-0000-0000-0000-0000000000f1', gen_random_uuid(), 'lunch', now(), 'UTC', 10, 'x', 'custom')$$,
  '42501', null, 'an entry cannot be written for another user');

-- Signed-out clients get nothing.
reset role;
set role anon;
select throws_ok($$select 1 from foods$$, '42501', null, 'anon cannot read foods');
select throws_ok($$select 1 from food_portions$$, '42501', null, 'anon cannot read portions');
select throws_ok($$select 1 from food_entries$$, '42501', null, 'anon cannot read entries');
reset role;

-- Account deletion removes custom foods, portions and entries.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select delete_my_account();
reset role;
select is((select count(*) from food_entries where user_id = '00000000-0000-0000-0000-0000000000f1')
  + (select count(*) from foods where user_id = '00000000-0000-0000-0000-0000000000f1')
  + (select count(*) from food_portions where food_id = '00000000-0000-0000-0000-00000000f012'), 0::bigint,
  'account deletion removes food rows');

select * from finish();
rollback;
