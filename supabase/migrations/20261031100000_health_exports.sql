-- Issue #34: which app records this account has written to Apple Health. The sample itself lives only in
-- Apple's store; this row keeps the sync identifier/version so a retry or another device can tell an export
-- already happened. Private to the owner; deleted with the account.
create table public.health_exports (
  user_id uuid not null references public.profiles on delete cascade,
  kind text not null check (length(kind) between 1 and 40),
  record_id text not null check (length(record_id) between 1 and 80),
  sample_uuid uuid,
  sync_version bigint not null check (sync_version >= 0),
  device_id uuid not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, record_id)
);

alter table public.health_exports enable row level security;
create policy health_exports_all on public.health_exports for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Only a newer sync version replaces the mapping, so a late retry from an older edit cannot win.
create function public.record_health_export(
  p_kind text, p_record_id text, p_sample_uuid uuid, p_version bigint, p_device uuid
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.health_exports(user_id, kind, record_id, sample_uuid, sync_version, device_id)
  values (auth.uid(), p_kind, p_record_id, p_sample_uuid, p_version, p_device)
  on conflict (user_id, kind, record_id) do update
    set sample_uuid = excluded.sample_uuid, sync_version = excluded.sync_version,
        device_id = excluded.device_id, updated_at = now()
    where public.health_exports.sync_version < excluded.sync_version;
  get diagnostics n = row_count;
  return n > 0;
end $$;

revoke execute on function public.record_health_export(text,text,uuid,bigint,uuid) from public, anon;
grant execute on function public.record_health_export(text,text,uuid,bigint,uuid) to authenticated;
