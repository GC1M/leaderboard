-- Issue #23: the leaderboard used value 0 for "no data" and "not shared", so a recorded zero looked
-- the same as both. value is now null unless the member recorded something, and state says why:
--   recorded:   value is the member's total (or weight progress), and may be 0.
--   no_data:    the member shares this metric (or it isn't shareable) but recorded nothing.
--   not_shared: the member doesn't share this metric with this group. Never carries a value, so it
--               says nothing about whether data exists. Who shares what is already visible to
--               members through metric_shares.
-- Changing the return type needs a drop; the grant goes with it.
drop function public.group_leaderboard(uuid, text, text);

create function public.group_leaderboard(p_group_id uuid, p_metric text, p_period text)
returns table (user_id uuid, display_name text, value numeric, rank bigint, state text)
language plpgsql stable security definer set search_path = '' as $$
declare
  tz text;
  today date;
  d_from date;
  d_to date;
  share_key text;
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'not a member of this group';
  end if;
  if p_metric not in ('steps', 'workout_minutes', 'weight_kg', 'screen_min') then
    raise exception 'invalid metric';
  end if;
  if p_period not in ('day', 'week') then
    raise exception 'invalid period';
  end if;
  share_key := case p_metric when 'steps' then 'steps' when 'weight_kg' then 'weight' end;

  select p.timezone into tz from public.profiles p where p.id = auth.uid();
  today := (now() at time zone coalesce(tz, 'UTC'))::date;
  if p_period = 'day' then
    d_from := today; d_to := today;
  else
    d_from := date_trunc('week', today)::date; d_to := d_from + 6;
  end if;

  return query
  with members as (
    select m.user_id as uid, p.display_name as name, p.timezone as mtz,
      share_key is not null and m.user_id <> auth.uid() and not exists (
        select 1 from public.metric_shares s
        where s.group_id = p_group_id and s.user_id = m.user_id and s.metric = share_key
      ) as hidden
    from public.group_members m
    join public.profiles p on p.id = m.user_id
    where m.group_id = p_group_id
  ), vals as (
    select members.uid, members.name, members.hidden,
      case when members.hidden then null
      when p_metric = 'weight_kg' then (
        select least(100, greatest(0,
          (g.start_value - w.kg) / nullif(g.start_value - g.target_value, 0) * 100))
        from public.goals g
        cross join lateral (
          select wm.kg from public.weight_measurements wm
          where wm.user_id = members.uid
            and (wm.measured_at at time zone members.mtz)::date between g.start_date and d_to
          order by wm.measured_at desc, (wm.source = 'manual') desc, wm.updated_at desc, wm.id desc
          limit 1
        ) w
        where g.user_id = members.uid and g.metric = 'weight_kg'
          and g.start_date <= today and coalesce(g.end_date, 'infinity') >= today
        order by g.start_date desc limit 1
      ) else (
        select sum(dm.value) from public.daily_metrics dm
        where dm.user_id = members.uid and dm.metric = p_metric and dm.date between d_from and d_to
      ) end as v
    from members
  )
  select vals.uid, vals.name, vals.v,
    rank() over (order by (vals.v is null), coalesce(vals.v, 0) * (case when p_metric = 'screen_min' then -1 else 1 end) desc),
    case when vals.hidden then 'not_shared' when vals.v is null then 'no_data' else 'recorded' end
  from vals
  order by 4, 2;
end $$;

revoke execute on function public.group_leaderboard(uuid, text, text) from public, anon;
grant execute on function public.group_leaderboard(uuid, text, text) to authenticated;
