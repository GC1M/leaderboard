-- Device ownership prevents a tombstone from one Health store deleting another device's upload.
alter table public.daily_metrics add column health_device_id uuid;
alter table public.weight_measurements add column health_device_id uuid;

create function public.apply_health_changes(
  p_owner uuid, p_device uuid, p_metric text, p_daily jsonb,
  p_remove_daily text[], p_weight jsonb, p_remove_weight text[]
) returns void language plpgsql security invoker set search_path = '' as $$
declare r jsonb; storage_metric text;
begin
  if auth.uid() is null or auth.uid() <> p_owner then raise exception 'Health account changed'; end if;
  if p_device is null or p_metric not in ('steps','sleep','weight') or p_metric is null then raise exception 'invalid Health import'; end if;
  if jsonb_typeof(p_daily) <> 'array' or jsonb_typeof(p_weight) <> 'array' or p_daily is null or p_weight is null then raise exception 'invalid Health payload'; end if;
  if (p_metric = 'weight' and (jsonb_array_length(p_daily) > 0 or cardinality(p_remove_daily) > 0))
    or (p_metric <> 'weight' and (jsonb_array_length(p_weight) > 0 or cardinality(p_remove_weight) > 0)) then raise exception 'mixed Health payload'; end if;
  -- All writers for the same user/metric serialize; retry is an atomic idempotent transaction.
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text || ':' || p_metric, 0));
  if p_metric = 'weight' then
    delete from public.weight_measurements where user_id = p_owner and source = 'healthkit'
      and health_device_id = p_device and measured_at = any(p_remove_weight::timestamptz[]);
    for r in select * from jsonb_array_elements(p_weight) loop
      insert into public.weight_measurements(user_id,measured_at,kg,source,health_device_id)
      values (p_owner,(r->>'measured_at')::timestamptz,(r->>'kg')::numeric,'healthkit',p_device)
      on conflict (user_id,measured_at,source) do update set kg=excluded.kg,health_device_id=excluded.health_device_id;
    end loop;
  else
    storage_metric := case when p_metric='steps' then 'steps' else 'sleep_min' end;
    delete from public.daily_metrics where user_id=p_owner and metric=storage_metric and source='healthkit'
      and health_device_id=p_device and date=any(p_remove_daily::date[]);
    for r in select * from jsonb_array_elements(p_daily) loop
      if (r->>'value')::numeric < 0 or (r->>'value')::numeric = 'NaN'::numeric
        or (r->>'value')::numeric = 'Infinity'::numeric
        or (p_metric='steps' and (r->>'value')::numeric <> trunc((r->>'value')::numeric)) then raise exception 'invalid Health value'; end if;
      if p_metric='sleep' and (r->>'window_start' is null or r->>'window_end' is null) then raise exception 'missing sleep window'; end if;
      insert into public.daily_metrics(user_id,date,metric,value,source,window_start,window_end,health_device_id)
      values(p_owner,(r->>'date')::date,storage_metric,(r->>'value')::numeric,'healthkit',(r->>'window_start')::timestamptz,(r->>'window_end')::timestamptz,p_device)
      on conflict (user_id,date,metric) do update set value=excluded.value,window_start=excluded.window_start,
        window_end=excluded.window_end,health_device_id=excluded.health_device_id
        where public.daily_metrics.source='healthkit'; -- never overwrite a manual override
    end loop;
  end if;
end $$;
revoke execute on function public.apply_health_changes(uuid,uuid,text,jsonb,text[],jsonb,text[]) from public, anon;
grant execute on function public.apply_health_changes(uuid,uuid,text,jsonb,text[],jsonb,text[]) to authenticated;
