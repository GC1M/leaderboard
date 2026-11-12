-- Friends (request, then accept or decline) and chat: one thread per group, per competition, and per friend pair.

create table public.friendships (
  requester_id uuid not null references public.profiles on delete cascade,
  addressee_id uuid not null references public.profiles on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);
-- One row per pair whichever way it was asked. Declining, cancelling and unfriending delete the row.
create unique index friendships_pair on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index on public.friendships (addressee_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null default auth.uid() references public.profiles on delete cascade,
  group_id uuid references public.groups on delete cascade,
  competition_id uuid references public.competitions on delete cascade,
  recipient_id uuid references public.profiles on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  check (num_nonnulls(group_id, competition_id, recipient_id) = 1),
  check (recipient_id is null or recipient_id <> sender_id)
);
create index on public.messages (group_id, created_at desc) where group_id is not null;
create index on public.messages (competition_id, created_at desc) where competition_id is not null;
create index on public.messages (least(sender_id, recipient_id), greatest(sender_id, recipient_id), created_at desc) where recipient_id is not null;

-- Security definer so the policies below don't recurse through friendships and competition_participants RLS.
create function public.are_friends(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.friendships
    where status = 'accepted'
      and ((requester_id = (select auth.uid()) and addressee_id = p_user_id)
        or (requester_id = p_user_id and addressee_id = (select auth.uid())))
  );
$$;

-- Any request either way, so both sides can see each other's name while it is pending.
create function public.has_friendship(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.friendships
    where (requester_id = (select auth.uid()) and addressee_id = p_user_id)
       or (requester_id = p_user_id and addressee_id = (select auth.uid()))
  );
$$;

-- Joined participants who are still in the competition's group.
create function public.in_competition(p_competition_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.competition_participants p
    join public.competitions c on c.id = p.competition_id
    where p.competition_id = p_competition_id and p.user_id = (select auth.uid()) and p.status = 'joined'
      and public.is_group_member(c.group_id)
  );
$$;

create function public.can_use_thread(p_group_id uuid, p_competition_id uuid, p_other_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when p_group_id is not null then public.is_group_member(p_group_id)
    when p_competition_id is not null then public.in_competition(p_competition_id)
    else public.are_friends(p_other_id)
  end;
$$;

revoke execute on function public.are_friends(uuid), public.has_friendship(uuid), public.in_competition(uuid),
  public.can_use_thread(uuid, uuid, uuid) from public, anon;
grant execute on function public.are_friends(uuid), public.has_friendship(uuid), public.in_competition(uuid),
  public.can_use_thread(uuid, uuid, uuid) to authenticated;

alter table public.friendships enable row level security;
alter table public.messages enable row level security;

create policy friendships_select on public.friendships for select to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));
-- Requests go to people you share a group with (competitions live inside groups, so that covers them too).
create policy friendships_request on public.friendships for insert to authenticated
  with check (requester_id = (select auth.uid()) and status = 'pending' and public.shares_group_with(addressee_id));
create policy friendships_accept on public.friendships for update to authenticated
  using (addressee_id = (select auth.uid()) and status = 'pending')
  with check (addressee_id = (select auth.uid()) and status = 'accepted');
create policy friendships_delete on public.friendships for delete to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));
-- Accepting may only flip the status, never rewrite who asked whom.
revoke update on public.friendships from authenticated;
grant update (status) on public.friendships to authenticated;

create policy messages_select on public.messages for select to authenticated
  using (
    (recipient_id is null or (select auth.uid()) in (sender_id, recipient_id))
    and public.can_use_thread(group_id, competition_id,
      case when sender_id = (select auth.uid()) then recipient_id else sender_id end)
  );
create policy messages_insert on public.messages for insert to authenticated
  with check (sender_id = (select auth.uid()) and public.can_use_thread(group_id, competition_id, recipient_id));
-- No update or delete: messages are append-only for now.
revoke update, delete on public.messages from authenticated;

-- Friends (and pending requesters) can see each other's display name after they stop sharing a group.
drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_group_with(id) or public.has_friendship(id));

alter publication supabase_realtime add table public.messages;
