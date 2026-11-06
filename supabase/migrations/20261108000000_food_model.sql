-- Issue #44: food catalog, portions and logged entries. Docs: docs/food/data-source.md.
--
-- Units: nutrients per 100 g in the catalog, grams for quantities, energy in kcal. kJ is display only
--   (1 kcal = 4.184 kJ, defined once in src/lib/food/nutrition.ts); no kJ is ever stored.
-- Unknown vs zero: a NULL nutrient is unknown. 0 is a recorded zero. Never write 0 for "no data".
-- Foods: provider = 'usda_fdc' rows are a server-written cache of FoodData Central (user_id is null,
--   readable by every signed-in user, written only with the service role). provider = 'custom' rows
--   belong to one user and are visible only to them.
-- Entries: private to the owner. Each entry copies the food identity and the nutrients for the amount
--   eaten at log time, so later edits to a food never change history. Totals are for the consumed
--   amount, not per 100 g.

create table public.foods (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('usda_fdc', 'custom')),
  -- FDC id for usda_fdc rows, null for custom.
  provider_id text check (char_length(provider_id) between 1 and 40),
  -- Where and when the values come from, e.g. 'Foundation' / '2026-04' (FDC data type and release).
  source_data_type text check (char_length(source_data_type) between 1 and 60),
  source_version text check (char_length(source_version) between 1 and 60),
  user_id uuid references public.profiles on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  brand text check (char_length(brand) <= 200),
  energy_kcal numeric check (energy_kcal >= 0 and energy_kcal <= 1000),
  protein_g numeric check (protein_g >= 0 and protein_g <= 100),
  carbs_g numeric check (carbs_g >= 0 and carbs_g <= 100),
  fat_g numeric check (fat_g >= 0 and fat_g <= 100),
  fiber_g numeric check (fiber_g >= 0 and fiber_g <= 100),
  sugars_g numeric check (sugars_g >= 0 and sugars_g <= 100),
  sat_fat_g numeric check (sat_fat_g >= 0 and sat_fat_g <= 100),
  sodium_mg numeric check (sodium_mg >= 0 and sodium_mg <= 100000),
  updated_at timestamptz not null default now(),
  check ((provider = 'custom') = (user_id is not null)),
  check ((provider = 'custom') = (provider_id is null)),
  unique (provider, provider_id)
);
create index on public.foods (user_id) where user_id is not null;

create trigger foods_touch before update on public.foods
  for each row execute function public.touch_updated_at();

-- A portion (1 cup, 1 slice) is only usable with a gram weight, so the weight is required and positive.
create table public.food_portions (
  id uuid primary key default gen_random_uuid(),
  food_id uuid not null references public.foods on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 100),
  gram_weight numeric not null check (gram_weight > 0 and gram_weight <= 100000),
  unique (food_id, label)
);

-- Deleting a food or a profile's custom food keeps history: the entry's own copy stays, food_id goes null.
create table public.food_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  -- Generated on the device when the entry is drafted; saving the same one twice cannot duplicate.
  client_id uuid not null,
  food_id uuid references public.foods on delete set null,
  meal text not null check (meal in ('breakfast', 'lunch', 'dinner', 'snack')),
  consumed_at timestamptz not null,
  -- IANA zone of the device when eaten; local_date is the calendar date there (set by trigger).
  timezone text not null,
  local_date date not null,
  -- Quantity resolved to grams. A portion entry also keeps what the user picked (label and count).
  grams numeric not null check (grams > 0 and grams <= 100000),
  portion_label text check (char_length(portion_label) between 1 and 100),
  portion_count numeric check (portion_count > 0),
  -- Estimated: the quantity is a guess. Custom: the food is user-defined. Both must be labeled in the UI.
  is_estimated boolean not null default false,
  is_custom boolean not null,
  -- Immutable snapshot of the food and the nutrients for `grams`.
  food_name text not null check (char_length(btrim(food_name)) between 1 and 200),
  food_brand text,
  provider text not null check (provider in ('usda_fdc', 'custom')),
  provider_id text,
  source_data_type text,
  source_version text,
  energy_kcal numeric check (energy_kcal >= 0),
  protein_g numeric check (protein_g >= 0),
  carbs_g numeric check (carbs_g >= 0),
  fat_g numeric check (fat_g >= 0),
  fiber_g numeric check (fiber_g >= 0),
  sugars_g numeric check (sugars_g >= 0),
  sat_fat_g numeric check (sat_fat_g >= 0),
  sodium_mg numeric check (sodium_mg >= 0),
  updated_at timestamptz not null default now(),
  check ((portion_label is null) = (portion_count is null)),
  unique (user_id, client_id)
);
create index on public.food_entries (user_id, local_date);
create index on public.food_entries (food_id) where food_id is not null;

create function public.food_entry_prepare() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- An unknown zone raises here (22023) instead of being stored.
  new.local_date := (new.consumed_at at time zone new.timezone)::date;
  -- The snapshot never changes. food_id may only go to null (the foreign key does that when a food is deleted).
  if tg_op = 'UPDATE' and (
    (new.user_id, new.client_id, new.grams, new.portion_label, new.portion_count, new.is_estimated,
      new.is_custom, new.food_name, new.food_brand, new.provider, new.provider_id, new.source_data_type,
      new.source_version, new.energy_kcal, new.protein_g, new.carbs_g, new.fat_g, new.fiber_g,
      new.sugars_g, new.sat_fat_g, new.sodium_mg)
    is distinct from
    (old.user_id, old.client_id, old.grams, old.portion_label, old.portion_count, old.is_estimated,
      old.is_custom, old.food_name, old.food_brand, old.provider, old.provider_id, old.source_data_type,
      old.source_version, old.energy_kcal, old.protein_g, old.carbs_g, old.fat_g, old.fiber_g,
      old.sugars_g, old.sat_fat_g, old.sodium_mg)
    or (new.food_id is distinct from old.food_id and new.food_id is not null)
  ) then
    raise exception 'a logged food snapshot cannot be changed' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Only meal, consumed_at and timezone can be edited. Changing the amount means a new entry.
create trigger food_entries_prepare before insert or update on public.food_entries
  for each row execute function public.food_entry_prepare();

alter table public.foods enable row level security;
alter table public.food_portions enable row level security;
alter table public.food_entries enable row level security;
revoke all on public.foods, public.food_portions, public.food_entries from anon;

-- Provider rows are read-only to clients: no insert/update/delete policy covers them, so only the
-- service role (which bypasses RLS) can write the FDC cache.
create policy foods_select on public.foods for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));
create policy foods_write on public.foods for all to authenticated
  using (provider = 'custom' and user_id = (select auth.uid()))
  with check (provider = 'custom' and user_id = (select auth.uid()));

create policy food_portions_select on public.food_portions for select to authenticated
  using (exists (select 1 from public.foods f where f.id = food_id));
create policy food_portions_write on public.food_portions for all to authenticated
  using (exists (select 1 from public.foods f where f.id = food_id and f.provider = 'custom' and f.user_id = (select auth.uid())))
  with check (exists (select 1 from public.foods f where f.id = food_id and f.provider = 'custom' and f.user_id = (select auth.uid())));

-- The food subquery runs under the caller's RLS, so an entry can only point at a visible food.
create policy food_entries_all on public.food_entries for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (food_id is null or exists (select 1 from public.foods f where f.id = food_id))
  );

-- Account deletion needs nothing extra: delete_my_account removes the auth user, which cascades through
-- profiles to the user's custom foods (and their portions) and their entries.
