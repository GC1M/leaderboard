-- Issue #49: share a daily nutrition summary with a group, per group, through the same metric_shares switch as
-- steps, sleep, weight and workouts. A row means "show my daily totals to this group"; no row means not shared,
-- and nothing is shared on join.
--   food: per member and local day that has entries, the day's total energy and protein, carbs and fat, each
--         with an incomplete flag, via group_food(). A day with no entries has no row (no data, not 0). Never a
--         food, its name or brand, a recipe, an amount, a meal, a photo, a count or any time of day.
-- Why these fields: the totals are already what the owner sees in the diary, and a flag keeps a partly
-- known day from reading as a precise one. Fiber, sugar, sodium and the entry count are left out: nobody in
-- the group needs them, and a count of entries says more about meals than a total does.
-- Food is never ranked: competitions only accept steps and workouts (their metric check and the sharing
-- lookup in the competition functions both name those metrics), so a food share cannot feed a leaderboard.
-- Peers never read food_entries, foods, food_portions, food_recipes or food_recipe_ingredients directly:
-- those tables stay owner-only, so a share given to one group can't leak through another path. Revoking a
-- share, leaving or being removed from the group (cascade from group_members), and deleting the account
-- (cascade from profiles) all stop the next read, because group_food reads metric_shares on every call.
alter table public.metric_shares drop constraint metric_shares_metric_check;
alter table public.metric_shares add constraint metric_shares_metric_check
  check (metric in ('steps', 'sleep', 'weight', 'workouts', 'food'));

-- Daily totals for members who share food with this group, on each entry's own local_date. A nutrient is null
-- when no entry that day knew it, and *_incomplete says some entries did not, so the total is a lower bound.
-- At most 31 days per call.
create function public.group_food(p_group_id uuid, p_from date, p_to date)
returns table (
  user_id uuid, local_date date,
  energy_kcal numeric, protein_g numeric, carbs_g numeric, fat_g numeric,
  energy_kcal_incomplete boolean, protein_g_incomplete boolean, carbs_g_incomplete boolean, fat_g_incomplete boolean
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'not a member of this group';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 31 then
    raise exception 'invalid date range' using errcode = '22023';
  end if;
  return query
  select e.user_id, e.local_date,
    sum(e.energy_kcal), sum(e.protein_g), sum(e.carbs_g), sum(e.fat_g),
    bool_or(e.energy_kcal is null), bool_or(e.protein_g is null), bool_or(e.carbs_g is null), bool_or(e.fat_g is null)
  from public.food_entries e
  join public.metric_shares s on s.user_id = e.user_id and s.group_id = p_group_id and s.metric = 'food'
  where e.local_date between p_from and p_to
  group by e.user_id, e.local_date
  order by e.local_date, e.user_id;
end $$;

revoke execute on function public.group_food(uuid, date, date) from public, anon;
grant execute on function public.group_food(uuid, date, date) to authenticated;

-- Delete food history (#49): every food entry, recipe (and its ingredients) and custom food (and its
-- portions) of the caller. Provider foods are shared by everyone and stay. Sharing choices stay, so a
-- member who shares food then simply has no data. Security invoker: row level security limits each delete to
-- the caller's own rows.
create function public.delete_my_food_history() returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from public.food_entries where user_id = auth.uid();
  delete from public.food_recipes where user_id = auth.uid();
  delete from public.foods where user_id = auth.uid() and provider = 'custom';
end $$;

revoke execute on function public.delete_my_food_history() from public, anon;
grant execute on function public.delete_my_food_history() to authenticated;
