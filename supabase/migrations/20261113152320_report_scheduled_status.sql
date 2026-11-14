-- Keep the enum addition separate so later migrations can safely use the new value.
alter type public.report_status add value if not exists 'scheduled' after 'assigned';

alter table public.reports
  add column if not exists scheduled_at timestamptz;

create index if not exists reports_scheduled_at
  on public.reports (scheduled_at)
  where scheduled_at is not null;
