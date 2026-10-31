-- #38: versioned, opt-in competitions. Only server RPCs may mutate these tables.
create table public.competition_rules (
  version integer primary key check (version > 0),
  rules jsonb not null check (jsonb_typeof(rules) = 'object')
);
insert into public.competition_rules values (1, '{
  "metrics": ["steps"], "ties": "shared_rank_with_gaps", "missing": "unranked_null",
  "join": "before_start", "leave": "before_end", "manual_default": false,
  "steps_timezone": "participant_profile_must_match_competition",
  "bounds": "whole_local_days_start_inclusive_end_exclusive", "max_days": 90,
  "corrections": "accepted_until_explicit_finalization", "finalize": "at_least_24h_after_end",
  "visibility": "current_group_membership_and_metric_sharing_always_required"
}');

create table public.competitions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups on delete cascade,
  creator_id uuid references public.profiles on delete set null,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  metric text not null check (metric in ('steps', 'workout_count', 'workout_duration')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null,
  scoring_version integer not null default 1 references public.competition_rules,
  include_manual boolean not null default false,
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled', 'finalized')),
  finalized_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check ((status = 'finalized') = (finalized_at is not null)),
  check ((status = 'cancelled') = (cancelled_at is not null)),
  unique (id, group_id)
);
create index on public.competitions (group_id, starts_at desc);

create table public.competition_participants (
  competition_id uuid not null references public.competitions on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  status text not null default 'joined' check (status in ('joined', 'left', 'removed')),
  joined_at timestamptz not null default now(),
  departed_at timestamptz,
  primary key (competition_id, user_id),
  check ((status = 'joined') = (departed_at is null))
);
create index on public.competition_participants (user_id);

create function public.validate_competition() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_timezone_names z where z.name = new.timezone) then
    raise exception 'invalid competition timezone';
  end if;
  if (new.starts_at at time zone new.timezone)::time <> time '00:00'
    or (new.ends_at at time zone new.timezone)::time <> time '00:00'
    or (new.ends_at at time zone new.timezone)::date - (new.starts_at at time zone new.timezone)::date not between 1 and 90 then
    raise exception 'competitions require 1 to 90 whole local calendar days';
  end if;
  if tg_op = 'INSERT' and (new.creator_id is null or not exists (
    select 1 from public.group_members m where m.group_id = new.group_id and m.user_id = new.creator_id
  )) then raise exception 'creator must belong to the group'; end if;
  if tg_op = 'UPDATE' and (new.group_id, new.metric, new.starts_at, new.ends_at, new.timezone, new.scoring_version, new.include_manual, new.name)
    is distinct from (old.group_id, old.metric, old.starts_at, old.ends_at, old.timezone, old.scoring_version, old.include_manual, old.name) then
    raise exception 'competition rules cannot be edited after creation';
  end if;
  return new;
end $$;
create trigger competitions_validate before insert or update on public.competitions
for each row execute function public.validate_competition();

alter table public.competition_rules enable row level security;
alter table public.competitions enable row level security;
alter table public.competition_participants enable row level security;
create policy competition_rules_read on public.competition_rules for select to authenticated using (true);
create policy competitions_read on public.competitions for select to authenticated using (public.is_group_member(group_id));
create policy competition_participants_read on public.competition_participants for select to authenticated using (
  exists (select 1 from public.competitions c where c.id = competition_id and public.is_group_member(c.group_id))
);
-- Defense in depth: no direct API writes, even if a permissive policy is added accidentally.
revoke all on public.competition_rules, public.competitions, public.competition_participants from anon, authenticated;
grant select on public.competition_rules, public.competitions, public.competition_participants to authenticated;
revoke execute on function public.validate_competition() from public, anon, authenticated;
