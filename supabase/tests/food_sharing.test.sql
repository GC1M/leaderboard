begin;
select plan(35);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a9', 'alice@x.com', '{"full_name":"Alice"}'),
  ('00000000-0000-0000-0000-0000000000b9', 'bob@x.com', '{"full_name":"Bob"}'),
  ('00000000-0000-0000-0000-0000000000c9', 'carol@x.com', '{"full_name":"Carol"}'),
  ('00000000-0000-0000-0000-0000000000d9', 'dave@x.com', '{"full_name":"Dave"}');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, true), set_config('role', 'authenticated', true);
$$;

-- G1: bob (owner) + alice + carol. G2: carol (owner) + alice. Dave is in neither.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b9');
create temp table g1 as select id, invite_code from create_group('G1');
grant select on g1 to authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c9');
create temp table g2 as select id, invite_code from create_group('G2');
grant select on g2 to authenticated;
select join_group((select invite_code from g1));
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select join_group((select invite_code from g1));
select join_group((select invite_code from g2));

-- Alice's food: Nov 1 two entries (carbs unknown in one), Nov 2 a zero-kcal entry plus an entry at 03:00 UTC on
-- Nov 3 in Chicago (still Nov 2 there), nothing after. Plus a recipe and a custom food. Carol logs food and shares nothing.
reset role;
insert into food_entries (user_id, client_id, meal, consumed_at, timezone, grams, food_name, provider, energy_kcal, protein_g, carbs_g, fat_g) values
  ('00000000-0000-0000-0000-0000000000a9', gen_random_uuid(), 'lunch', '2026-11-01 18:00+00', 'UTC', 100, 'Secret Lunch', 'custom', 100, 5, 10, 1),
  ('00000000-0000-0000-0000-0000000000a9', gen_random_uuid(), 'dinner', '2026-11-01 19:00+00', 'UTC', 100, 'Secret Dinner', 'custom', 50, 0, null, 2),
  ('00000000-0000-0000-0000-0000000000a9', gen_random_uuid(), 'snack', '2026-11-02 10:00+00', 'UTC', 10, 'Water', 'custom', 0, 0, 0, 0),
  ('00000000-0000-0000-0000-0000000000a9', gen_random_uuid(), 'snack', '2026-11-03 03:00+00', 'America/Chicago', 10, 'Late Snack', 'custom', 7, 1, 1, 1),
  ('00000000-0000-0000-0000-0000000000c9', gen_random_uuid(), 'lunch', '2026-11-01 18:00+00', 'UTC', 100, 'Carol Lunch', 'custom', 999, 9, 9, 9);
insert into foods (provider, name, user_id, energy_kcal) values ('custom', 'Secret Custom Food', '00000000-0000-0000-0000-0000000000a9', 10);
insert into food_recipes (user_id, name) values ('00000000-0000-0000-0000-0000000000a9', 'Secret Recipe');
insert into food_recipe_ingredients (recipe_id, position, grams, food_name)
  values ((select id from food_recipes where name = 'Secret Recipe'), 0, 100, 'Secret Ingredient');

-- The server returns these columns and no others.
select is((select proargnames from pg_proc where oid = 'public.group_food(uuid,date,date)'::regprocedure),
  array['p_group_id', 'p_from', 'p_to', 'user_id', 'local_date', 'energy_kcal', 'protein_g', 'carbs_g', 'fat_g',
    'energy_kcal_incomplete', 'protein_g_incomplete', 'carbs_g_incomplete', 'fat_g_incomplete'],
  'group_food returns only member, day, four totals and their incomplete flags');

-- private by default
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select is((select count(*)::int from metric_shares where user_id = auth.uid() and metric = 'food'), 0, 'food is not shared by default');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b9');
select is((select count(*)::int from group_food((select id from g1), '2026-10-25', '2026-11-10')), 0, 'nothing is returned before the member opts in');

-- alice opts in to G1 only
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select lives_ok($$insert into metric_shares (group_id, user_id, metric) values ((select id from g1), auth.uid(), 'food')$$, 'member opts into food for one group');

-- bob (owner of G1): daily totals on local_date, nothing finer; a day with no entries has no row
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b9');
select results_eq($$select user_id, local_date::text, energy_kcal, protein_g, carbs_g, fat_g,
    energy_kcal_incomplete, protein_g_incomplete, carbs_g_incomplete, fat_g_incomplete
  from group_food((select id from g1), '2026-10-25', '2026-11-10')$$,
  $$values ('00000000-0000-0000-0000-0000000000a9'::uuid, '2026-11-01', 150::numeric, 5::numeric, 10::numeric, 3::numeric, false, false, true, false),
    ('00000000-0000-0000-0000-0000000000a9'::uuid, '2026-11-02', 7::numeric, 1::numeric, 1::numeric, 1::numeric, false, false, false, false)$$,
  'the group gets daily totals only, by local_date (03:00 UTC Nov 3 is Nov 2 in Chicago), with unknown carbs flagged incomplete');
select is((select count(*)::int from group_food((select id from g1), '2026-11-04', '2026-11-10')), 0, 'a day without entries has no row (no data, not 0)');
select throws_ok($$select * from group_food((select id from g1), '2026-11-02', '2026-11-01')$$, '22023', null, 'from after to is an error');
select throws_ok($$select * from group_food((select id from g1), '2026-01-01', '2026-11-01')$$, '22023', null, 'a range over 31 days is an error');
select throws_ok($$select * from group_food((select id from g2), '2026-10-25', '2026-11-10')$$, 'not a member of this group', 'being in one group gives no access to another group''s food');

-- direct reads by a group-mate, even the owner and even while alice shares
select is((select count(*)::int from food_entries), 0, 'a group-mate cannot read food entries');
select is((select count(*)::int from foods where user_id is not null), 0, 'a group-mate cannot read custom foods');
select is((select count(*)::int from food_portions) + (select count(*)::int from food_recipes) + (select count(*)::int from food_recipe_ingredients), 0,
  'a group-mate cannot read portions, recipes or ingredients');
select throws_ok($$insert into metric_shares (group_id, user_id, metric) values ((select id from g1), '00000000-0000-0000-0000-0000000000a9', 'food')$$,
  '42501', null, 'owner cannot share food for a member');
delete from food_entries where user_id = '00000000-0000-0000-0000-0000000000a9';
delete from metric_shares where user_id = '00000000-0000-0000-0000-0000000000a9' and metric = 'food';
reset role;
select is((select count(*)::int from food_entries where user_id = '00000000-0000-0000-0000-0000000000a9'), 4, 'owner cannot delete a member''s food entries');
select is((select count(*)::int from metric_shares where user_id = '00000000-0000-0000-0000-0000000000a9' and metric = 'food'), 1, 'owner cannot revoke a member''s food share');

-- carol (member of G1): sees alice, and her own unshared food is hidden
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c9');
select is((select count(*)::int from group_food((select id from g1), '2026-10-25', '2026-11-10') where user_id = '00000000-0000-0000-0000-0000000000c9'), 0,
  'a member who shares nothing is hidden although she logged food');
select is((select count(*)::int from group_food((select id from g1), '2026-10-25', '2026-11-10')), 2, 'a consenting member is returned to other members');
select is((select count(*)::int from group_food((select id from g2), '2026-10-25', '2026-11-10')), 0, 'G2 gets nothing: alice shares food with G1 only');

-- non-member
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d9');
select throws_ok($$select * from group_food((select id from g1), '2026-10-25', '2026-11-10')$$, 'not a member of this group', 'non-member cannot read group food');
select is((select count(*)::int from food_entries) + (select count(*)::int from metric_shares), 0, 'non-member reads no food rows and no shares');

-- revocation takes effect immediately
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select lives_ok($$delete from metric_shares where group_id = (select id from g1) and user_id = auth.uid() and metric = 'food'$$, 'member revokes food');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b9');
select is((select count(*)::int from group_food((select id from g1), '2026-10-25', '2026-11-10')), 0, 'revoked food is no longer returned');

-- a shared day of zero kcal is a row with 0, distinct from the days with no row
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select lives_ok($$insert into metric_shares (group_id, user_id, metric) values ((select id from g1), auth.uid(), 'food')$$, 'member shares again');
reset role;
delete from food_entries where user_id = '00000000-0000-0000-0000-0000000000a9' and food_name <> 'Water';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b9');
select results_eq($$select local_date::text, energy_kcal from group_food((select id from g1), '2026-10-25', '2026-11-10')$$,
  $$values ('2026-11-02', 0::numeric)$$, 'a logged day of zero kcal is 0, and days without entries have no row');

-- leaving a group drops the share
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
delete from group_members where group_id = (select id from g1) and user_id = auth.uid();
reset role;
select is((select count(*)::int from metric_shares where user_id = '00000000-0000-0000-0000-0000000000a9' and group_id = (select id from g1)), 0, 'leaving a group removes its shares');

-- food cannot be a competition metric
select is((select bool_or(pg_get_constraintdef(oid) like '%food%') from pg_constraint where conrelid = 'public.competitions'::regclass and contype = 'c'),
  false, 'competitions cannot be about food');

-- delete food history
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a9');
select lives_ok($$select delete_my_food_history()$$, 'member deletes their food history');
reset role;
select is((select count(*)::int from food_entries where user_id = '00000000-0000-0000-0000-0000000000a9')
  + (select count(*)::int from food_recipes where user_id = '00000000-0000-0000-0000-0000000000a9')
  + (select count(*)::int from foods where user_id = '00000000-0000-0000-0000-0000000000a9'), 0, 'entries, recipes and custom foods are gone');
select is((select count(*)::int from food_recipe_ingredients), 0, 'recipe ingredients are gone');
select is((select count(*)::int from food_entries where user_id = '00000000-0000-0000-0000-0000000000c9'), 1, 'someone else''s food is untouched');

-- account deletion removes everything
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c9');
select lives_ok($$select delete_my_account()$$, 'member deletes their account');
reset role;
select is((select count(*)::int from food_entries where user_id = '00000000-0000-0000-0000-0000000000c9'), 0, 'food entries go with the account');

-- anon
set local role anon;
select throws_ok($$select count(*) from food_entries$$, '42501', null, 'anon cannot read food entries');
select throws_ok($$select * from group_food('00000000-0000-0000-0000-000000000000', '2026-11-01', '2026-11-02')$$, '42501', null, 'anon cannot call group_food');
select throws_ok($$select delete_my_food_history()$$, '42501', null, 'anon cannot delete food history');

select * from finish();
rollback;
