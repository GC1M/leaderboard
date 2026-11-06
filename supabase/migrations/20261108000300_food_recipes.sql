-- Issue #46: ingredient recipes and reusable meals. Docs: docs/food/data-source.md.
--
-- A recipe is a plan, not a log: owner-only and never shared. A reusable meal is just a recipe with servings = 1
-- and no cooked weight, so there is one model and no flag. Each ingredient keeps its own copy of the food name
-- and per-100 g nutrients from when it was added, so recipe totals are stable, readable offline and unaffected by
-- later edits or deletion of the food. NULL nutrient = unknown, never 0 (a total built from unknowns is shown as
-- incomplete). Applying a recipe logs ONE food_entries row (provider = 'recipe') with the recipe name and the
-- scaled totals; nothing links the entry back to the recipe, so editing or deleting a recipe never changes history.

create table public.food_recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  -- Assumptions the totals rest on, such as raw or cooked ingredients.
  notes text check (char_length(notes) <= 2000),
  -- How many servings the recipe makes.
  servings numeric not null default 1 check (servings > 0 and servings <= 1000),
  -- Total cooked weight; null = not weighed, and the ingredient weights are used instead.
  yield_g numeric check (yield_g > 0 and yield_g <= 100000),
  updated_at timestamptz not null default now()
);
create index on public.food_recipes (user_id, updated_at desc);

create trigger food_recipes_touch before update on public.food_recipes
  for each row execute function public.touch_updated_at();

-- food_id is only a pointer for convenience: deleting the food keeps the ingredient and its copy.
create table public.food_recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.food_recipes on delete cascade,
  food_id uuid references public.foods on delete set null,
  position integer not null check (position >= 0 and position < 100),
  grams numeric not null check (grams > 0 and grams <= 100000),
  food_name text not null check (char_length(btrim(food_name)) between 1 and 200),
  -- Per 100 g, same bounds as foods.
  energy_kcal numeric check (energy_kcal >= 0 and energy_kcal <= 1000),
  protein_g numeric check (protein_g >= 0 and protein_g <= 100),
  carbs_g numeric check (carbs_g >= 0 and carbs_g <= 100),
  fat_g numeric check (fat_g >= 0 and fat_g <= 100),
  fiber_g numeric check (fiber_g >= 0 and fiber_g <= 100),
  sugars_g numeric check (sugars_g >= 0 and sugars_g <= 100),
  sat_fat_g numeric check (sat_fat_g >= 0 and sat_fat_g <= 100),
  sodium_mg numeric check (sodium_mg >= 0 and sodium_mg <= 100000),
  unique (recipe_id, position) deferrable initially deferred
);
create index on public.food_recipe_ingredients (food_id) where food_id is not null;

alter table public.food_recipes enable row level security;
alter table public.food_recipe_ingredients enable row level security;
revoke all on public.food_recipes, public.food_recipe_ingredients from anon;

create policy food_recipes_all on public.food_recipes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- The food subquery runs under the caller's RLS, so an ingredient can only point at a visible food.
create policy food_recipe_ingredients_all on public.food_recipe_ingredients for all to authenticated
  using (exists (select 1 from public.food_recipes r where r.id = recipe_id and r.user_id = (select auth.uid())))
  with check (
    exists (select 1 from public.food_recipes r where r.id = recipe_id and r.user_id = (select auth.uid()))
    and (food_id is null or exists (select 1 from public.foods f where f.id = food_id))
  );

-- Atomic save of a recipe with its ingredients: insert when p_id is null, else update and replace the
-- ingredients. security invoker, so RLS still decides what the caller may touch. p_recipe shape:
-- {name, notes?, servings, yield_g?, ingredients: [{food_id?, food_name, grams, energy_kcal?, protein_g?, ...}]}
-- Array order becomes position. Account deletion needs nothing extra: delete_my_account removes the auth user,
-- which cascades through profiles to recipes and their ingredients.
create function public.save_food_recipe(p_id uuid, p_recipe jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v_id uuid; i jsonb; n int := 0;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_id is null then
    insert into public.food_recipes (user_id, name, notes, servings, yield_g)
    values (auth.uid(), p_recipe->>'name', p_recipe->>'notes', (p_recipe->>'servings')::numeric, (p_recipe->>'yield_g')::numeric)
    returning id into v_id;
  else
    update public.food_recipes set name = p_recipe->>'name', notes = p_recipe->>'notes',
      servings = (p_recipe->>'servings')::numeric, yield_g = (p_recipe->>'yield_g')::numeric
    where id = p_id and user_id = auth.uid()
    returning id into v_id;
    if v_id is null then raise exception 'recipe not found'; end if;
    delete from public.food_recipe_ingredients where recipe_id = v_id;
  end if;
  for i in select * from jsonb_array_elements(coalesce(p_recipe->'ingredients', '[]'::jsonb)) loop
    insert into public.food_recipe_ingredients (recipe_id, food_id, position, grams, food_name,
      energy_kcal, protein_g, carbs_g, fat_g, fiber_g, sugars_g, sat_fat_g, sodium_mg)
    values (v_id, (i->>'food_id')::uuid, n, (i->>'grams')::numeric, i->>'food_name',
      (i->>'energy_kcal')::numeric, (i->>'protein_g')::numeric, (i->>'carbs_g')::numeric, (i->>'fat_g')::numeric,
      (i->>'fiber_g')::numeric, (i->>'sugars_g')::numeric, (i->>'sat_fat_g')::numeric, (i->>'sodium_mg')::numeric);
    n := n + 1;
  end loop;
  return v_id;
end $$;
revoke execute on function public.save_food_recipe(uuid, jsonb) from public, anon;
grant execute on function public.save_food_recipe(uuid, jsonb) to authenticated;

-- Recipe entries: provider = 'recipe' with no provider id and no food (the entry is its own snapshot).
-- Only usda_fdc rows carry a provider id; custom and recipe rows never do.
alter table public.food_entries drop constraint food_entries_provider_check;
alter table public.food_entries drop constraint food_entries_check1;
alter table public.food_entries add constraint food_entries_provider_check check (provider in ('usda_fdc', 'custom', 'recipe'));
alter table public.food_entries add constraint food_entries_provider_id_match check ((provider = 'usda_fdc') = (provider_id is not null));
alter table public.food_entries add constraint food_entries_recipe_no_food check (provider <> 'recipe' or food_id is null);
