-- #50: one member's food from first log to account deletion, as the app does it (as the signed-in user, through
-- row level security). Log, edit, share to a group, a member reads group_food, revoke, delete history, log again,
-- then delete the account and check that nothing of hers is left anywhere, and nothing of anyone else's is touched.
begin;
select plan(28);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a5', 'alice@x.com', '{"full_name":"Alice"}'),
  ('00000000-0000-0000-0000-0000000000b5', 'bob@x.com', '{"full_name":"Bob"}');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, true), set_config('role', 'authenticated', true);
$$;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b5');
create temp table g as select id, invite_code from create_group('Lifecycle');
grant select on g to authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a5');
select join_group((select invite_code from g));

-- Bob logs too, so there is something of someone else's to leave alone.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b5');
insert into food_entries (user_id, client_id, meal, consumed_at, timezone, grams, food_name, provider, energy_kcal)
  values (auth.uid(), gen_random_uuid(), 'lunch', '2026-11-05 18:00+00', 'UTC', 100, 'Bob Lunch', 'custom', 400);

-- 1. Alice logs 100 g of a food at 130 kcal / 2.7 g protein, carbs unknown.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a5');
select lives_ok($$insert into food_entries (user_id, client_id, meal, consumed_at, timezone, grams, food_name, provider, energy_kcal, protein_g, fat_g)
  values (auth.uid(), '00000000-0000-0000-0000-00000000c001', 'lunch', '2026-11-05 18:00+00', 'UTC', 100, 'Rice', 'custom', 130, 2.7, 0)$$, 'logs an entry');
-- 2. She edits the amount to 250 g, with the nutrients scaled by the client (130 * 2.5 = 325, 2.7 * 2.5 = 6.75).
select lives_ok($$update food_entries set grams = 250, energy_kcal = 325, protein_g = 6.75 where client_id = '00000000-0000-0000-0000-00000000c001'$$, 'edits the amount and its snapshot');
select throws_ok($$update food_entries set food_name = 'Renamed' where client_id = '00000000-0000-0000-0000-00000000c001'$$, null, null, 'the identity of a logged entry cannot be rewritten');
select is((select local_date::text from food_entries where client_id = '00000000-0000-0000-0000-00000000c001'), '2026-11-05', 'the server sets the local date');

-- 3. Nothing is visible to the group before she opts in.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b5');
select is((select count(*)::int from group_food((select id from g), '2026-11-01', '2026-11-10')), 0, 'before opting in, the group sees nothing');

-- 4. She shares; Bob reads the edited daily total and nothing finer.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a5');
select lives_ok($$insert into metric_shares (group_id, user_id, metric) values ((select id from g), auth.uid(), 'food')$$, 'shares food with the group');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b5');
select results_eq($$select user_id, local_date::text, energy_kcal, protein_g, carbs_g, energy_kcal_incomplete, carbs_g_incomplete from group_food((select id from g), '2026-11-01', '2026-11-10')$$,
  $$values ('00000000-0000-0000-0000-0000000000a5'::uuid, '2026-11-05', 325::numeric, 6.75::numeric, null::numeric, false, true)$$,
  'a member reads the edited total, with unknown carbs flagged incomplete and not shown as 0');
select is((select count(*)::int from food_entries where user_id = '00000000-0000-0000-0000-0000000000a5'), 0, 'but cannot read the entry itself');

-- 5. She revokes: gone at once. Her entries stay hers.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a5');
select lives_ok($$delete from metric_shares where user_id = auth.uid() and metric = 'food'$$, 'revokes the share');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b5');
select is((select count(*)::int from group_food((select id from g), '2026-11-01', '2026-11-10')), 0, 'after revoking, the group sees nothing');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a5');
select is((select count(*)::int from food_entries), 1, 'her entry is still hers');

-- 6. She keeps a recipe, a custom food, a search and a Health export record, then deletes her history.
select lives_ok($$insert into foods (provider, name, user_id, energy_kcal) values ('custom', 'My Food', auth.uid(), 10)$$, 'creates a custom food');
select lives_ok($$insert into food_recipes (user_id, name) values (auth.uid(), 'My Recipe')$$, 'creates a recipe');
select lives_ok($$insert into food_recipe_ingredients (recipe_id, position, grams, food_name) values ((select id from food_recipes where name = 'My Recipe'), 0, 100, 'Ingredient')$$, 'adds an ingredient');
reset role;
insert into food_search_log (user_id) values ('00000000-0000-0000-0000-0000000000a5');
insert into health_exports (user_id, kind, record_id, sync_version, device_id) values
  ('00000000-0000-0000-0000-0000000000a5', 'food', 'e1', 1, gen_random_uuid()), ('00000000-0000-0000-0000-0000000000a5', 'workout', 'w1', 1, gen_random_uuid());
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a5');
select lives_ok($$select delete_my_food_history()$$, 'deletes her food history');
reset role;
select is((select count(*)::int from food_entries where user_id = '00000000-0000-0000-0000-0000000000a5')
  + (select count(*)::int from food_recipes where user_id = '00000000-0000-0000-0000-0000000000a5')
  + (select count(*)::int from foods where user_id = '00000000-0000-0000-0000-0000000000a5')
  + (select count(*)::int from food_recipe_ingredients), 0, 'entries, recipes, ingredients and custom foods are gone');
select is((select count(*)::int from food_entries where user_id = '00000000-0000-0000-0000-0000000000b5'), 1, 'Bob''s food is untouched');
select is((select count(*)::int from profiles where id = '00000000-0000-0000-0000-0000000000a5'), 1, 'her account is still there');

-- 7. She logs again and shares again, so the account deletion has something of every kind to remove.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a5');
select lives_ok($$insert into food_entries (user_id, client_id, meal, consumed_at, timezone, grams, food_name, provider, energy_kcal)
  values (auth.uid(), gen_random_uuid(), 'dinner', '2026-11-06 23:00+00', 'UTC', 50, 'Soup', 'custom', 60)$$, 'logs again after deleting history');
select lives_ok($$insert into metric_shares (group_id, user_id, metric) values ((select id from g), auth.uid(), 'food')$$, 'shares again');
select lives_ok($$insert into food_recipes (user_id, name) values (auth.uid(), 'Second Recipe')$$, 'creates another recipe');
select lives_ok($$insert into foods (provider, name, user_id, energy_kcal) values ('custom', 'Second Food', auth.uid(), 10)$$, 'creates another custom food');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b5');
select is((select count(*)::int from group_food((select id from g), '2026-11-01', '2026-11-10')), 1, 'the group sees the new day');

-- 8. Account deletion removes everything of hers, and the group no longer lists her.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a5');
select lives_ok($$select delete_my_account()$$, 'deletes the account');
reset role;
select is((select count(*)::int from food_entries where user_id = '00000000-0000-0000-0000-0000000000a5')
  + (select count(*)::int from food_recipes where user_id = '00000000-0000-0000-0000-0000000000a5')
  + (select count(*)::int from foods where user_id = '00000000-0000-0000-0000-0000000000a5')
  + (select count(*)::int from metric_shares where user_id = '00000000-0000-0000-0000-0000000000a5')
  + (select count(*)::int from food_search_log where user_id = '00000000-0000-0000-0000-0000000000a5')
  + (select count(*)::int from health_exports where user_id = '00000000-0000-0000-0000-0000000000a5'), 0,
  'entries, recipes, custom foods, shares, search log and Health export records all went with the account');
select is((select count(*)::int from food_recipe_ingredients), 0, 'recipe ingredients went with their recipes');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b5');
select is((select count(*)::int from group_food((select id from g), '2026-11-01', '2026-11-10')), 0, 'the group no longer sees her food');
select is((select count(*)::int from food_entries), 1, 'Bob still has his entry');

select * from finish();
rollback;
