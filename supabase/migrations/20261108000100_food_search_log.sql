-- Issue #45: per-user limit on food searches, so one user cannot use up the shared FDC key (1,000 requests
-- per hour, and each search makes 2). The food-search edge function calls food_search_allow with the
-- service role. Clients have no access to the table or the function.

create table public.food_search_log (
  user_id uuid not null references public.profiles on delete cascade,
  searched_at timestamptz not null default now()
);
create index on public.food_search_log (user_id, searched_at);

alter table public.food_search_log enable row level security;
-- No policies: RLS denies every client. Revoke as well, so there is no grant to lean on.
revoke all on public.food_search_log from anon, authenticated;

-- True and records the search when the user has made fewer than p_limit searches in the last hour,
-- false otherwise. Rows older than an hour are pruned for that user on each call.
create function public.food_search_allow(p_user uuid, p_limit int) returns boolean
language plpgsql security definer set search_path = '' as $$
declare used int;
begin
  perform pg_advisory_xact_lock(hashtext(p_user::text));
  delete from public.food_search_log where user_id = p_user and searched_at < now() - interval '1 hour';
  select count(*) into used from public.food_search_log where user_id = p_user;
  if used >= p_limit then return false; end if;
  insert into public.food_search_log (user_id) values (p_user);
  return true;
end $$;
revoke all on function public.food_search_allow(uuid, int) from public, anon, authenticated;
grant execute on function public.food_search_allow(uuid, int) to service_role;
