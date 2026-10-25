-- Owner tools: remove a member, delete a member's bad entry. See PLAN.md "Schema gaps".

-- Owner removes someone else; the owner can't remove themselves (delete the group instead).
create function public.remove_member(p_group_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.groups g where g.id = p_group_id and g.owner_id = auth.uid()) then
    raise exception 'only the group owner can remove members';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'the owner cannot be removed';
  end if;
  delete from public.group_members where group_id = p_group_id and user_id = p_user_id;
  if not found then raise exception 'not a member of this group'; end if;
end $$;

-- Owner deletes one day's entry for a member of their group. Never weight: owners can't see raw weight.
create function public.delete_member_metric(p_group_id uuid, p_user_id uuid, p_date date, p_metric text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.groups g where g.id = p_group_id and g.owner_id = auth.uid()) then
    raise exception 'only the group owner can delete entries';
  end if;
  if p_metric = 'weight_kg' then
    raise exception 'weight entries cannot be deleted by the owner';
  end if;
  if not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = p_user_id) then
    raise exception 'not a member of this group';
  end if;
  delete from public.daily_metrics where user_id = p_user_id and date = p_date and metric = p_metric;
  if not found then raise exception 'no entry for that day'; end if;
end $$;

-- New functions are executable by public by default.
revoke execute on function public.remove_member(uuid, uuid), public.delete_member_metric(uuid, uuid, date, text) from public, anon;
grant execute on function public.remove_member(uuid, uuid), public.delete_member_metric(uuid, uuid, date, text) to authenticated;
