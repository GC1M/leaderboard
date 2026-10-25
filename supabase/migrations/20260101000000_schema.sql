-- Core schema, RLS, RPCs. See PLAN.md "Data model".

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null,
  avatar_url text,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now()
);

create function public.gen_invite_code() returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no I, O, 0, 1
  code text := '';
begin
  for i in 1..8 loop
    code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return code;
end $$;

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 60),
  invite_code text not null unique default public.gen_invite_code(),
  owner_id uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now()
);

create table public.group_members (
  group_id uuid not null references public.groups on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index on public.group_members (user_id);

create table public.daily_metrics (
  user_id uuid not null references public.profiles on delete cascade,
  date date not null,
  metric text not null check (metric in ('steps', 'workout_minutes', 'weight_kg', 'screen_min')),
  value numeric not null check (value >= 0),
  source text not null check (source in ('healthkit', 'health_connect', 'manual')),
  updated_at timestamptz not null default now(),
  primary key (user_id, date, metric),
  constraint steps_sanity_cap check (metric <> 'steps' or value <= 80000)
);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  metric text not null check (metric in ('steps', 'workout_minutes', 'weight_kg', 'screen_min')),
  start_value numeric not null check (start_value >= 0),
  target_value numeric not null check (target_value >= 0),
  start_date date not null,
  end_date date,
  check (end_date is null or end_date >= start_date)
);
create index on public.goals (user_id, metric, start_date);

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger daily_metrics_touch before update on public.daily_metrics
  for each row execute function public.touch_updated_at();

-- profile row on signup
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(new.email, '@', 1), ''),
      'Player'
    )
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS helpers (security definer so policies on group_members don't recurse)
create function public.is_group_member(p_group_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group_id and user_id = (select auth.uid())
  );
$$;

create function public.shares_group_with(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.group_members me
    join public.group_members them using (group_id)
    where me.user_id = (select auth.uid()) and them.user_id = p_user_id
  );
$$;

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.daily_metrics enable row level security;
alter table public.goals enable row level security;

create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_group_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- groups are created via create_group(); no insert policy on purpose
create policy groups_select on public.groups for select to authenticated
  using (public.is_group_member(id));
create policy groups_update on public.groups for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy groups_delete on public.groups for delete to authenticated
  using (owner_id = (select auth.uid()));

-- joining is via join_group(); no insert policy on purpose
create policy group_members_select on public.group_members for select to authenticated
  using (public.is_group_member(group_id));
create policy group_members_leave on public.group_members for delete to authenticated
  using (user_id = (select auth.uid()));

-- others never see raw weight; weight progress is exposed via group_leaderboard()
create policy daily_metrics_select on public.daily_metrics for select to authenticated
  using (
    user_id = (select auth.uid())
    or (metric <> 'weight_kg' and public.shares_group_with(user_id))
  );
create policy daily_metrics_insert on public.daily_metrics for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy daily_metrics_update on public.daily_metrics for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy daily_metrics_delete on public.daily_metrics for delete to authenticated
  using (user_id = (select auth.uid()));

-- weight goals hold raw kg, so group-mates only see non-weight goals
create policy goals_select on public.goals for select to authenticated
  using (
    user_id = (select auth.uid())
    or (metric <> 'weight_kg' and public.shares_group_with(user_id))
  );
create policy goals_insert on public.goals for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy goals_update on public.goals for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy goals_delete on public.goals for delete to authenticated
  using (user_id = (select auth.uid()));

create function public.create_group(name text) returns public.groups
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  g public.groups;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  insert into public.groups (name, owner_id) values (create_group.name, uid) returning * into g;
  insert into public.group_members (group_id, user_id, role) values (g.id, uid, 'owner');
  return g;
end $$;

create function public.join_group(code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  gid uuid;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select id into gid from public.groups where invite_code = upper(trim(join_group.code));
  if gid is null then raise exception 'invalid invite code'; end if;
  insert into public.group_members (group_id, user_id) values (gid, uid)
  on conflict do nothing;
  return gid;
end $$;

-- p_period: 'day' (caller's today) or 'week' (Monday through Sunday containing today).
-- weight_kg returns % progress toward the active goal, never raw kg.
-- screen_min ranks ascending (less is better); everything else descending.
create function public.group_leaderboard(p_group_id uuid, p_metric text, p_period text)
returns table (user_id uuid, display_name text, value numeric, rank bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  tz text;
  today date;
  d_from date;
  d_to date;
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

  select p.timezone into tz from public.profiles p where p.id = auth.uid();
  today := (now() at time zone coalesce(tz, 'UTC'))::date;
  if p_period = 'day' then
    d_from := today; d_to := today;
  else
    d_from := date_trunc('week', today)::date; d_to := d_from + 6;
  end if;

  return query
  with vals as (
    select m.user_id as uid, p.display_name as name,
      case when p_metric = 'weight_kg' then (
        select least(100, greatest(0,
          (g.start_value - w.value) / nullif(g.start_value - g.target_value, 0) * 100))
        from public.goals g
        cross join lateral (
          select dm.value from public.daily_metrics dm
          where dm.user_id = m.user_id and dm.metric = 'weight_kg'
            and dm.date between g.start_date and d_to
          order by dm.date desc limit 1
        ) w
        where g.user_id = m.user_id and g.metric = 'weight_kg'
          and g.start_date <= today and coalesce(g.end_date, 'infinity') >= today
        order by g.start_date desc limit 1
      ) else (
        select sum(dm.value) from public.daily_metrics dm
        where dm.user_id = m.user_id and dm.metric = p_metric and dm.date between d_from and d_to
      ) end as v
    from public.group_members m
    join public.profiles p on p.id = m.user_id
    where m.group_id = p_group_id
  )
  select vals.uid, vals.name, coalesce(vals.v, 0)::numeric,
    rank() over (order by coalesce(vals.v, 0) * (case when p_metric = 'screen_min' then -1 else 1 end) desc)
  from vals
  order by 4, 2;
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.create_group(text), public.join_group(text),
  public.group_leaderboard(uuid, text, text),
  public.is_group_member(uuid), public.shares_group_with(uuid)
to authenticated;
