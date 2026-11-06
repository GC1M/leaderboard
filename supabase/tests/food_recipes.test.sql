begin;
select plan(29);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a7', 'alice@x.com'),
  ('00000000-0000-0000-0000-0000000000b7', 'bob@x.com');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', u, true), set_config('role', 'authenticated', true);
$$;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a7');

insert into foods (id, user_id, provider, name, energy_kcal, protein_g)
  values ('00000000-0000-0000-0000-00000000a701', auth.uid(), 'custom', 'Alice rice', 130, 2.7);

-- Save: ingredients keep their own copy of the food values; an unlisted nutrient stays unknown.
create temp table r as select save_food_recipe(null, jsonb_build_object(
  'name', 'Rice bowl', 'notes', 'Rice is cooked.', 'servings', 2, 'yield_g', 500,
  'ingredients', jsonb_build_array(
    jsonb_build_object('food_id', '00000000-0000-0000-0000-00000000a701', 'food_name', 'Alice rice', 'grams', 300, 'energy_kcal', 130, 'protein_g', 2.7),
    jsonb_build_object('food_name', 'Mystery sauce', 'grams', 50, 'energy_kcal', 200)))) as id;
select isnt((select id from r), null, 'a recipe is saved');
select is((select count(*) from food_recipe_ingredients where recipe_id = (select id from r)), 2::bigint, 'with its ingredients');
select is((select fiber_g from food_recipe_ingredients where food_name = 'Mystery sauce'), null, 'an unlisted ingredient nutrient stays unknown');

update foods set energy_kcal = 999 where id = '00000000-0000-0000-0000-00000000a701';
select is((select energy_kcal from food_recipe_ingredients where food_name = 'Alice rice'), 130::numeric, 'editing a food does not change the ingredient copy');

select save_food_recipe((select id from r), jsonb_build_object('name', 'Rice bowl 2', 'servings', 1,
  'ingredients', jsonb_build_array(jsonb_build_object('food_name', 'Rice only', 'grams', 100, 'energy_kcal', 130))));
select results_eq($$select count(*)::int, min(food_name) from food_recipe_ingredients where recipe_id = (select id from r)$$,
  $$values (1, 'Rice only')$$, 'updating replaces the ingredients');

-- Deleting a food keeps the ingredient and its copy.
select save_food_recipe((select id from r), jsonb_build_object('name', 'Rice bowl', 'servings', 2,
  'ingredients', jsonb_build_array(jsonb_build_object('food_id', '00000000-0000-0000-0000-00000000a701', 'food_name', 'Alice rice', 'grams', 300, 'energy_kcal', 130))));
delete from foods where id = '00000000-0000-0000-0000-00000000a701';
select results_eq($$select food_id is null, food_name, energy_kcal from food_recipe_ingredients where recipe_id = (select id from r)$$,
  $$values (true, 'Alice rice', 130::numeric)$$, 'deleting a food keeps the ingredient copy');

-- Constraints.
select throws_ok($$insert into food_recipes (user_id, name, servings) values (auth.uid(), 'Bad', 0)$$, '23514', null, 'servings must be positive');
select throws_ok($$insert into food_recipes (user_id, name, yield_g) values (auth.uid(), 'Bad', 0)$$, '23514', null, 'a cooked weight must be positive');
select throws_ok($$insert into food_recipes (user_id, name) values (auth.uid(), '  ')$$, '23514', null, 'a recipe needs a name');
select throws_ok($$insert into food_recipe_ingredients (recipe_id, position, grams, food_name) values ((select id from r), 5, 0, 'Bad')$$, '23514', null, 'ingredient grams must be positive');
select throws_ok($$insert into food_recipe_ingredients (recipe_id, position, grams, food_name, protein_g) values ((select id from r), 5, 10, 'Bad', 101)$$, '23514', null, 'more than 100 g per 100 g is rejected');

-- Recipe entries: provider recipe, no provider id, no food; the entry is its own snapshot.
select lives_ok($$insert into food_entries (id, user_id, client_id, meal, consumed_at, timezone, grams, portion_label, portion_count, food_name, provider, energy_kcal)
  values ('00000000-0000-0000-0000-00000000a7e1', auth.uid(), gen_random_uuid(), 'lunch', now(), 'UTC', 250, 'serving', 1, 'Rice bowl', 'recipe', 270)$$,
  'a recipe entry can be logged');
select throws_ok($$insert into food_entries (user_id, client_id, meal, consumed_at, timezone, grams, food_name, provider, provider_id)
  values (auth.uid(), gen_random_uuid(), 'lunch', now(), 'UTC', 10, 'Bad', 'recipe', '5')$$, '23514', null, 'a recipe entry cannot carry a provider id');
select throws_ok($$insert into food_entries (user_id, client_id, meal, consumed_at, timezone, grams, food_name, provider)
  values (auth.uid(), gen_random_uuid(), 'lunch', now(), 'UTC', 10, 'Bad', 'usda_fdc')$$, '23514', null, 'a usda entry still needs a provider id');
insert into foods (id, user_id, provider, name) values ('00000000-0000-0000-0000-00000000a702', auth.uid(), 'custom', 'Alice oats');
select throws_ok($$insert into food_entries (user_id, client_id, food_id, meal, consumed_at, timezone, grams, food_name, provider)
  values (auth.uid(), gen_random_uuid(), '00000000-0000-0000-0000-00000000a702', 'lunch', now(), 'UTC', 10, 'Bad', 'recipe')$$, '23514', null, 'a recipe entry cannot point at a food');
select throws_ok($$insert into food_entries (user_id, client_id, meal, consumed_at, timezone, grams, food_name, provider)
  values (auth.uid(), gen_random_uuid(), 'lunch', now(), 'UTC', 10, 'Bad', 'meal')$$, '23514', null, 'an unknown provider is rejected');
select throws_ok($$update food_entries set food_name = 'Renamed' where id = '00000000-0000-0000-0000-00000000a7e1'$$, '23514', null, 'a recipe entry''s name cannot be edited');
select lives_ok($$update food_entries set grams = 125, portion_count = 0.5, energy_kcal = 135 where id = '00000000-0000-0000-0000-00000000a7e1'$$, 'a recipe entry''s amount can be edited with its snapshot');
update food_recipes set name = 'Changed', servings = 4 where id = (select id from r);
select results_eq($$select food_name, energy_kcal from food_entries where id = '00000000-0000-0000-0000-00000000a7e1'$$,
  $$values ('Rice bowl', 135::numeric)$$, 'editing the recipe does not change the entry');

-- RLS isolation.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b7');
select is((select count(*) from food_recipes), 0::bigint, 'another user sees no recipes');
select is((select count(*) from food_recipe_ingredients), 0::bigint, 'another user sees no ingredients');
select is_empty($$update food_recipes set name = 'Hacked' returning 1$$, 'another user cannot update a recipe');
select is_empty($$delete from food_recipe_ingredients returning 1$$, 'another user cannot delete an ingredient');
select throws_ok($$select save_food_recipe((select id from r), '{"name":"x","servings":1}'::jsonb)$$, 'P0001', null, 'another user cannot save over a recipe');
select throws_ok($$insert into food_recipe_ingredients (recipe_id, position, grams, food_name) values ((select id from r), 9, 1, 'x')$$, '42501', null, 'an ingredient cannot be added to another user''s recipe');
select throws_ok($$insert into food_recipes (user_id, name) values ('00000000-0000-0000-0000-0000000000a7', 'x')$$, '42501', null, 'a recipe cannot be created for another user');

-- Account deletion cascades.
reset role;
delete from auth.users where id = '00000000-0000-0000-0000-0000000000a7';
select is((select count(*) from food_recipes), 0::bigint, 'deleting the account removes its recipes');
select is((select count(*) from food_recipe_ingredients), 0::bigint, 'and their ingredients');
select is((select count(*) from food_entries where provider = 'recipe'), 0::bigint, 'and the recipe entries');

select * from finish();
rollback;
