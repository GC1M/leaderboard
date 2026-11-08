-- 1. Health-labelled rows only arrive through the import RPCs.
-- A client could insert its own rows labelled 'healthkit' and skip the 80,000 manual step cap and a
-- competition's manual exclusion. Direct table writes are now limited to manual rows (and file imports for
-- workouts). apply_health_changes and apply_health_workouts run as definer so they can still write Health
-- rows; both already require auth.uid() = p_owner and validate the payload. Deletes are unchanged.
-- ponytail: this raises the bar, it does not prove provenance. The RPCs still accept values the client read,
-- so a modified client can upload made-up "Health" numbers. Real proof needs App Attest or a server-side
-- Health source; until then competition contributions flag steps over 100,000 for review.
alter policy daily_metrics_insert on public.daily_metrics
  with check (user_id = (select auth.uid()) and source = 'manual');
alter policy daily_metrics_update on public.daily_metrics
  with check (user_id = (select auth.uid()) and source = 'manual');
alter policy weight_measurements_all on public.weight_measurements
  with check (user_id = (select auth.uid()) and source = 'manual');
alter policy workouts_all on public.workouts
  with check (user_id = (select auth.uid()) and source <> 'healthkit');
alter function public.apply_health_changes(uuid, uuid, text, jsonb, text[], jsonb, text[]) security definer;
alter function public.apply_health_workouts(uuid, uuid, jsonb, uuid[]) security definer;

-- 2. A competition can no longer be cancelled after it ends. Removing a participant stays possible until
-- finalization, with a reason in the activity log, because the review window after the end is when bad data
-- gets noticed. Otherwise unchanged from 20261107030000_competition_integrity.sql.
create or replace function public.moderate_competition(p_id uuid,p_action text,p_reason text,p_user_id uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.competitions;
begin
  select * into c from public.competitions where id=p_id for update;
  if not found or auth.uid() is null or not public.is_group_member(c.group_id) then raise exception 'competition unavailable'; end if;
  if not(coalesce(c.creator_id=auth.uid(),false) or exists(select 1 from public.groups g where g.id=c.group_id and g.owner_id=auth.uid())) then raise exception 'only the creator or current group owner can moderate'; end if;
  if c.status='finalized' then raise exception 'finalized results cannot be moderated'; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 500 then raise exception 'give a moderation reason of 1 to 500 characters'; end if;
  perform set_config('app.competition_reason',btrim(p_reason),true);
  if p_action='cancel' then
    if c.status<>'cancelled' and now()>=c.ends_at then raise exception 'ended competitions cannot be cancelled'; end if;
    if c.status<>'cancelled' then update public.competitions set status='cancelled',cancelled_at=now() where id=p_id; end if;
  elsif p_action='remove' then
    if c.status='cancelled' then raise exception 'competition is cancelled'; end if;
    update public.competition_participants set status='removed',departed_at=now() where competition_id=p_id and user_id=p_user_id and status='joined';
    if not found then raise exception 'participant is not enrolled'; end if;
  else raise exception 'unsupported moderation action'; end if;
  perform set_config('app.competition_reason','',true);
end $$;

-- 3. Re-apply the null-creator fix to finalize_competition. #129 corrected it by editing
-- 20261107020000_competition_scoring.sql in place, which a database that already applied that file never re-runs.
-- Without coalesce, a deleted creator (creator_id null) made the check null and let any group member finalize.
create or replace function public.finalize_competition(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.competitions;
begin
  select * into c from public.competitions where id=p_id for update;
  if not found or auth.uid() is null or not public.is_group_member(c.group_id) then raise exception 'competition unavailable'; end if;
  if not(coalesce(c.creator_id=auth.uid(),false) or exists(select 1 from public.groups g where g.id=c.group_id and g.owner_id=auth.uid()) or exists(select 1 from public.competition_participants p where p.competition_id=p_id and p.user_id=auth.uid() and p.status='joined')) then raise exception 'only participants, the creator or group owner can finalize'; end if;
  if c.status='finalized' then return; end if;
  if c.status='cancelled' then raise exception 'cancelled competitions cannot be finalized'; end if;
  if now()<c.ends_at+interval '24 hours' then raise exception 'finalization opens 24 hours after the end'; end if;
  insert into public.competition_results select p_id,s.* from public.competition_live_scores(p_id) s;
  update public.competitions set status='finalized',finalized_at=now() where id=p_id;
end $$;
