-- Prevent one screening result from being saved repeatedly after a page refresh.
-- Run after 20260828_0002_screening_history.sql.

alter table public.screening_records
  add column if not exists origin_screening_id text;

create unique index if not exists screening_records_user_origin_screening_idx
  on public.screening_records (user_id, origin_screening_id)
  where origin_screening_id is not null;
