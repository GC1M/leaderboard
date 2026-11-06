begin;
select plan(30);

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

-- Food constraints.
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
  is_custom, food_name, provider, provider_id, source_data_type, source_version, energy_kcal, protein_g, carbs_g)
  values ('00000000-0000-0000-0000-00000000f101', auth.uid(), '00000000-0000-0000-0000-00000000c001',
    '00000000-0000-0000-0000-00000000f001', 'snack', '2026-11-08 03:30:00+00', 'America/Chicago', 182, '1 medium', 1,
    false, 'Apple, raw', 'usda_fdc', '171688', 'SR Legacy', '2018-04', 94.64, 0.47, null);
select is((select local_date from food_entries where id = '00000000-0000-0000-0000-00000000f101'), '2026-11-07'::date,
  'local_date is the calendar date in the entry timezone');
select is((select carbs_g from food_entries where id = '00000000-0000-0000-0000-00000000f101'), null, 'an unknown nutrient in a snapshot stays unknown');
select throws_ok($$insert into food_entries (user_id, client_id, meal, consumed_at, timezone, grams, is_custom, food_name, provider)
  values (auth.uid(), '00000000-0000-0000-0000-00000000c001', 'lunch', now(), 'UTC', 10, false, 'Dup', 'usda_fdc')$$,
  '23505', null, 'the same client id cannot be saved twice');
select throws_ok($$insert into food_entries (user_id, client_id, meal, consumed_at, timezone, grams, is_custom, food_name, provider)
  values (auth.uid(), gen_random_uuid(), 'lunch', now(), 'UTC', 0, false, 'Bad', 'usda_fdc')$$,
  '23514', null, 'grams must be positive');
select throws_ok($$insert into food_entries (user_id, client_id, meal, consumed_at, timezone, grams, portion_label, is_custom, food_name, provider)
  values (auth.uid(), gen_random_uuid(), 'lunch', now(), 'UTC', 10, '1 cup', false, 'Bad', 'usda_fdc')$$,
  '23514', null, 'a portion label needs a count');
select throws_ok($$insert into food_entries (user_id, client_id, meal, consumed_at, timezone, grams, is_custom, food_name, provider)
  values (auth.uid(), gen_random_uuid(), 'brunch', now(), 'UTC', 10, false, 'Bad', 'usda_fdc')$$,
  '23514', null, 'meal must be a known slot');
select throws_ok($$insert into food_entries (user_id, client_id, meal, consumed_at, timezone, grams, is_custom, food_name, provider)
  values (auth.uid(), gen_random_uuid(), 'lunch', now(), 'Mars/Base', 10, false, 'Bad', 'usda_fdc')$$,
  '22023', null, 'an unknown timezone is rejected');

-- Snapshot immutability: later food edits and direct edits never change history.
update foods set energy_kcal = 999 where id = '00000000-0000-0000-0000-00000000f011';
insert into food_entries (id, user_id, client_id, food_id, meal, consumed_at, timezone, grams, is_custom, food_name, provider, energy_kcal)
  values ('00000000-0000-0000-0000-00000000f102', auth.uid(), gen_random_uuid(), '00000000-0000-0000-0000-00000000f011',
    'breakfast', now(), 'UTC', 60, true, 'Alice granola', 'custom', 270);
select throws_ok($$update food_entries set energy_kcal = 1 where id = '00000000-0000-0000-0000-00000000f102'$$,
  '23514', null, 'the nutrient snapshot cannot be edited');
select throws_ok($$update food_entries set grams = 1 where id = '00000000-0000-0000-0000-00000000f102'$$,
  '23514', null, 'the amount cannot be edited');
select lives_ok($$update food_entries set meal = 'lunch', consumed_at = '2026-11-09 01:00:00+00', timezone = 'Asia/Tokyo' where id = '00000000-0000-0000-0000-00000000f102'$$,
  'meal, time and timezone can be edited');
select is((select local_date from food_entries where id = '00000000-0000-0000-0000-00000000f102'), '2026-11-09'::date,
  'editing the time recomputes local_date');
delete from foods where id = '00000000-0000-0000-0000-00000000f011';
select results_eq($$select food_id is null, energy_kcal, food_name from food_entries where id = '00000000-0000-0000-0000-00000000f102'$$,
  $$values (true, 270::numeric, 'Alice granola')$$, 'deleting a custom food keeps the entry and its snapshot');

-- RLS isolation.
insert into foods (id, user_id, provider, name) values ('00000000-0000-0000-0000-00000000f012', auth.uid(), 'custom', 'Alice secret');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select is((select count(*) from food_entries), 0::bigint, 'another user sees no entries');
select is((select count(*) from foods where user_id is not null), 0::bigint, 'another user sees no custom foods');
select throws_ok($$insert into food_entries (user_id, client_id, food_id, meal, consumed_at, timezone, grams, is_custom, food_name, provider)
  values (auth.uid(), gen_random_uuid(), '00000000-0000-0000-0000-00000000f012', 'lunch', now(), 'UTC', 10, true, 'x', 'custom')$$,
  '42501', null, 'an entry cannot point at another user''s custom food');

-- Account deletion removes custom foods, portions and entries.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
insert into food_portions (food_id, label, gram_weight) values ('00000000-0000-0000-0000-00000000f012', '1', 5);
select delete_my_account();
reset role;
select is((select count(*) from food_entries where user_id = '00000000-0000-0000-0000-0000000000f1')
  + (select count(*) from foods where user_id = '00000000-0000-0000-0000-0000000000f1')
  + (select count(*) from food_portions where food_id = '00000000-0000-0000-0000-00000000f012'), 0::bigint,
  'account deletion removes food rows');

select * from finish();
rollback;
