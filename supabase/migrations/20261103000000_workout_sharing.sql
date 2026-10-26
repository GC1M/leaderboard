-- Issue #33: share workouts with a group, per group, through the same metric_shares switch as steps, sleep
-- and weight. A row means "show my weekly workout summary to this group"; no row means not shared, and
-- nothing is shared on join (only steps are).
--   workouts: per member and local week, the number of workouts and their total duration, via
--             group_workouts(). Never the activity, exercises, sets, loads, notes, distance, energy, source
--             or any timestamp finer than the week.
-- Peers never read workouts, workout_exercises, workout_sets or exercises directly: those tables stay
-- owner-only (policies from 20261031000000_workouts.sql), so a share given to one group can't leak through
-- another path. Revoking a share, leaving or being removed from the group (cascade from group_members), and
-- deleting the account (cascade from profiles) all stop the next read, because group_workouts reads
-- metric_shares on every call.
alter table public.metric_shares drop constraint metric_shares_metric_check;
alter table public.metric_shares add constraint metric_shares_metric_check
  check (metric in ('steps', 'sleep', 'weight', 'workouts'));

-- Weekly workout counts and total time for members who share workouts with this group. Weeks start on
-- Monday in the member's profile timezone, like the leaderboard's week; week_start is that Monday. Only
-- workouts that started on a local date in p_from..p_to count, so pass whole weeks. A week without
-- workouts has no row. Duration falls back to end minus start when Health or the editor left it null.
create function public.group_workouts(p_group_id uuid, p_from date, p_to date)
returns table (user_id uuid, week_start date, workout_count integer, total_duration_s numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'not a member of this group';
  end if;
  return query
  select l.uid, l.wk, count(*)::integer, sum(l.secs)
  from (
    select w.user_id as uid,
      (w.started_at at time zone p.timezone)::date as local_day,
      date_trunc('week', w.started_at at time zone p.timezone)::date as wk,
      coalesce(w.duration_s, extract(epoch from w.ended_at - w.started_at)) as secs
    from public.workouts w
    join public.profiles p on p.id = w.user_id
    join public.metric_shares s on s.user_id = w.user_id and s.group_id = p_group_id and s.metric = 'workouts'
  ) l
  where l.local_day between p_from and p_to
  group by l.uid, l.wk
  order by l.wk, l.uid;
end $$;

-- Defense in depth for direct API access: the anon role has no business with these tables, and the
-- workout tables' policies are already authenticated-only.
revoke all on public.workouts, public.workout_exercises, public.workout_sets, public.exercises,
  public.metric_shares from anon;

-- New functions are executable by public by default.
revoke execute on function public.group_workouts(uuid, date, date) from public, anon;
grant execute on function public.group_workouts(uuid, date, date) to authenticated;
