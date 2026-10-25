-- In-app account deletion (App Store guideline 5.1.1(v)). Deleting the auth user cascades to the
-- profile, memberships, metrics and goals, and to groups the user owns (their members lose those groups).
create function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from auth.users where id = auth.uid();
end $$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
