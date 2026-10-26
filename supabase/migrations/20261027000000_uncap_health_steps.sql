-- Health step totals are measurements and are stored as read; the 80,000 cap applies to manual entry only.
-- Steps are always a finite whole number. numeric accepts NaN and Infinity, and NaN sorts above every
-- number, so reject both explicitly (the old `value <= 80000` did this implicitly).
alter table public.daily_metrics
  drop constraint steps_sanity_cap,
  add constraint steps_sanity_cap check (
    metric <> 'steps'
    or (value < 'Infinity' and value = trunc(value) and (source <> 'manual' or value <= 80000))
  );
