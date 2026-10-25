-- Health step totals are measurements and are stored as read; the 80,000 cap applies to manual entry only.
alter table public.daily_metrics
  drop constraint steps_sanity_cap,
  add constraint steps_sanity_cap check (metric <> 'steps' or source <> 'manual' or value <= 80000);
