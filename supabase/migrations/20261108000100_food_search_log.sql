-- Issue #45: limits on food searches, so one user (or all users together) cannot use up the shared FDC key
-- (1,000 requests per hour, and each search makes 2). The food-search edge function calls food_search_allow
-- with the service role. Clients have no access to the table or the function.

create table public.food_search_log (
  user_id uuid not null references public.profiles on delete cascade,
  searched_at timestamptz not null default now()
);
create index on public.food_search_log (user_id, searched_at);

alter table public.food_search_log enable row level security;
-- No policies: RLS denies every client. Revoke as well, so there is no grant to lean on.
revoke all on public.food_search_log from anon, authenticated;

-- True and records the search when the user has made fewer than p_limit searches in the last hour and all
-- users together fewer than p_global_limit; false otherwise. Rows older than an hour are pruned on each call,
-- so the table never holds more than about an hour of searches. One lock serializes the checks, which is fine
-- at this volume.
create function public.food_search_allow(p_user uuid, p_limit int, p_global_limit int) returns boolean
language plpgsql security definer set search_path = '' as $$
declare mine int; everyone int;
begin
  perform pg_advisory_xact_lock(hashtext('food_search_allow'));
  delete from public.food_search_log where searched_at < now() - interval '1 hour';
  select count(*) filter (where user_id = p_user), count(*) into mine, everyone from public.food_search_log;
  if mine >= p_limit or everyone >= p_global_limit then return false; end if;
  insert into public.food_search_log (user_id) values (p_user);
  return true;
end $$;
revoke all on function public.food_search_allow(uuid, int, int) from public, anon, authenticated;
grant execute on function public.food_search_allow(uuid, int, int) to service_role;
