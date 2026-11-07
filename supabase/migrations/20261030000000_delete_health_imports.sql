-- Issue #26: delete what Apple Health imported, without deleting the account. Manual entries, groups,
-- goals, and sharing choices stay. The app stops imports first, so nothing re-uploads until the user
-- reconnects.
create function public.delete_my_health_imports() returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  -- Same lock as apply_health_changes, so a late upload can't interleave with the delete.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || m, 0))
  from unnest(array['steps', 'sleep', 'weight']) m;
  delete from public.daily_metrics where user_id = auth.uid() and source = 'healthkit';
  delete from public.weight_measurements where user_id = auth.uid() and source = 'healthkit';
end $$;

revoke execute on function public.delete_my_health_imports() from public, anon;
grant execute on function public.delete_my_health_imports() to authenticated;
