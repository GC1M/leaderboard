-- Day-by-day scores are for the people racing: a group member who has not joined (or has left or been removed) gets
-- no rows, while totals in the standings stay visible to the whole group as before. Everything else is unchanged.
create or replace function public.competition_daily_values(p_id uuid)
returns table(user_id uuid,day date,value numeric)
language plpgsql stable security definer set search_path = '' as $$
declare c public.competitions;
begin
  select * into c from public.competitions where id=p_id;
  if not found or auth.uid() is null or not public.is_group_member(c.group_id) then raise exception 'competition unavailable'; end if;
  if c.status='cancelled' then return; end if;
  if not exists(select 1 from public.competition_participants p where p.competition_id=p_id and p.user_id=auth.uid() and p.status='joined') then return; end if;
  return query
  select d.uid,d.day,d.val
  from public.competition_day_values(p_id) d
  join public.competition_live_scores(p_id) l on l.user_id=d.uid and l.eligibility='eligible'
  where d.val is not null
  order by d.uid,d.day;
end $$;
revoke execute on function public.competition_daily_values(uuid) from public,anon;
grant execute on function public.competition_daily_values(uuid) to authenticated;
