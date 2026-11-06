-- Daily food totals for the 7/30/90-day history (#47). One row per day that has entries, grouped by the
-- entry's own local_date. A nutrient total is null when no entry knew it, and *_incomplete says some entries
-- did not, so the total is a lower bound. Days with no entries have no row (no data, not 0 kcal).
-- Security invoker: row level security limits this to the caller's own entries, and the user_id filter keeps
-- the index in play.
create function public.food_daily_totals(p_from date, p_to date) returns table (
  local_date date, entries int,
  energy_kcal numeric, protein_g numeric, carbs_g numeric, fat_g numeric,
  energy_kcal_incomplete boolean, protein_g_incomplete boolean, carbs_g_incomplete boolean, fat_g_incomplete boolean
) language sql stable security invoker set search_path = '' as $$
  select e.local_date, count(*)::int,
    sum(e.energy_kcal), sum(e.protein_g), sum(e.carbs_g), sum(e.fat_g),
    bool_or(e.energy_kcal is null), bool_or(e.protein_g is null), bool_or(e.carbs_g is null), bool_or(e.fat_g is null)
  from public.food_entries e
  where e.user_id = (select auth.uid())
    and p_to - p_from between 0 and 366
    and e.local_date between p_from and p_to
  group by e.local_date
  order by e.local_date;
$$;

revoke all on function public.food_daily_totals(date, date) from public, anon;
grant execute on function public.food_daily_totals(date, date) to authenticated;
