-- New accounts without a name in their sign-in metadata (email code sign-in) used the part of the
-- email before the @, which every group member could see. Default to a neutral "Player XXXX" instead,
-- taken from the user id so it is stable. Existing profiles keep their names.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      'Player ' || upper(left(replace(new.id::text, '-', ''), 4))
    )
  );
  return new;
end $$;
